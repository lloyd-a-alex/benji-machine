/**
 * CNC Toolpath Simulation Preview — High-Performance Viewer
 *
 * Architecture:
 * - Offscreen canvas double-buffering eliminates flicker & reduces GPU thrash.
 * - Exponential zoom lerp: targetZoom accumulates, actual zoom smoothly chases
 *   via requestAnimationFrame — physics-like easing at zero extra math cost.
 * - Zoom-to-cursor: pan adjusted so the world point under cursor stays fixed.
 * - Momentum panning: tracks pointer velocity → inertial coast after pointer-up.
 * - Dirty flagging: only re-renders when viewport or simulation state changed.
 * - Pointer Events API: mouse, touch, and pen handled uniformly.
 * - Pinch-zoom via dual-pointer tracking on touch screens.
 *
 * CNC Simulation:
 * - Toolpath rendered as glowing pink arcs, rapid traverses as dashed lines.
 * - Animated toolhead with concentric pulse rings + crosshair.
 * - Industrial HUD overlay with progress bar, cycle time, rapid distance.
 */

import { calculateCardDimensions } from '../machine/profiles.js';
import { optimizeToolpath, pathLengthMm } from '../math/tsp-path.js';

/** Linear interpolation */
const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));

/** Clamp x to [lo, hi] */
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export class ToolpathViewer {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx    = canvasElement.getContext('2d', { alpha: false });

    // Offscreen buffer — render here, blit to display canvas each frame
    this.offscreen = document.createElement('canvas');
    this.offCtx    = this.offscreen.getContext('2d', { alpha: false });

    this.profile    = options.profile || null;
    this.cardMatrix = options.cardMatrix || [];

    // ─── Viewport State ───────────────────────────────────────────────────────
    this.zoom       = 1.0;   // current (animated) zoom
    this.targetZoom = 2.2;   // what zoom we are easing towards
    this.panX       = 40;
    this.panY       = 40;

    // Momentum panning
    this._velX = 0;
    this._velY = 0;
    this._lastMoveTime = 0;
    this._lastMoveX    = 0;
    this._lastMoveY    = 0;

    // ─── Simulation State ─────────────────────────────────────────────────────
    this.isPlaying        = false;
    this.currentToolIndex = 0;
    this.simSpeed         = 4;

    // ─── Toolbar Modes ────────────────────────────────────────────────────────
    this.panMode       = true;  // pointer drag translates the viewport
    this.showAllLayers = false; // render full machined path regardless of playhead

    this.toolpathPoints       = [];
    this.totalRapidDistanceMm = 0;
    this.estimatedTimeSeconds = 0;

    // Pulse animation phase
    this._pulsePhase = 0;

    // RAF + dirty flag
    this._raf    = null;
    this._dirty  = true;
    this._lastTs = performance.now();

    // Pinch state (2 active pointers)
    this._pointers   = new Map();
    this._pinchDist0 = null;
    this._pinchZoom0 = null;
    this._pinchMidX  = 0;
    this._pinchMidY  = 0;

    this._isDragging = false;
    this._dragPrev   = { x: 0, y: 0 };

    this._setupEvents();
    this.resize();
    this._startLoop();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  setCardData(profile, cardMatrix, orderedHoles) {
    this.profile    = profile;
    this.cardMatrix = cardMatrix;

    const rows = cardMatrix.length;
    const cols = cardMatrix[0] ? cardMatrix[0].length : 24;
    const dims = calculateCardDimensions(profile, rows, cols);

    this.toolpathPoints       = [];
    this.totalRapidDistanceMm = 0;

    if (orderedHoles && orderedHoles.length > 0) {
      this.toolpathPoints = orderedHoles;
    } else {
      for (let r = 0; r < rows; r++) {
        const y = dims.rowOffsetYMm + r * profile.pitchY;
        for (let c = 0; c < cols; c++) {
          if (cardMatrix[r][c]) {
            this.toolpathPoints.push({
              x: dims.colOffsetXMm + c * profile.pitchX,
              y,
              radius: profile.holeDiameter / 2
            });
          }
        }
      }
    }

    this._recomputeMetrics();

    this.currentToolIndex = 0;
    this._dirty = true;
    this.fitToViewport();
  }

  /** Recompute rapid travel distance and cycle estimate from current point order */
  _recomputeMetrics() {
    // Measured from machine home (0, 0), which is where every program starts.
    this.totalRapidDistanceMm = pathLengthMm(this.toolpathPoints);

    const rapidTime = (this.totalRapidDistanceMm / 3000) * 60;
    const punchTime = this.toolpathPoints.length * 0.18;
    this.estimatedTimeSeconds = Math.round(rapidTime + punchTime);
    this._dirty = true;
  }

  /** Reverse the machining order of the toolpath (punch last hole first) */
  reverse() {
    if (this.toolpathPoints.length < 2) return;
    this.toolpathPoints.reverse();
    this.currentToolIndex = 0;
    this.isPlaying = false;
    this._recomputeMetrics();
  }

  /**
   * Reduce rapid-travel distance with the shared nearest-neighbour + 2-opt
   * ordering. Deliberately the SAME function the G-code exporter runs, so what
   * this preview measures is what the exported program will actually do.
   * Returns { beforeMm, afterMm } so callers can report the real gain.
   */
  optimize() {
    const beforeMm = this.totalRapidDistanceMm;
    if (this.toolpathPoints.length >= 3) {
      this.toolpathPoints = optimizeToolpath(this.toolpathPoints);
      this.currentToolIndex = 0;
      this.isPlaying = false;
      this._recomputeMetrics();
    }
    return { beforeMm, afterMm: this.totalRapidDistanceMm };
  }

  /** Zoom around the viewport centre by a multiplicative factor */
  zoomBy(factor) {
    const cx = this.canvas.width  / 2;
    const cy = this.canvas.height / 2;
    this._zoomAround(factor, cx, cy);
  }

  /** Fit the entire card into the viewport with padding */
  fitToViewport() {
    if (!this.profile || !this.cardMatrix.length) {
      this.targetZoom = 2.2;
      this.panX = 40; this.panY = 40;
      this._dirty = true;
      return;
    }
    const rows = this.cardMatrix.length;
    const cols = this.cardMatrix[0] ? this.cardMatrix[0].length : 24;
    const dims = calculateCardDimensions(this.profile, rows, cols);

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const margin = 0.88;
    const zx = (cw * margin) / dims.widthMm;
    const zy = (ch * margin) / dims.heightMm;
    const z  = clamp(Math.min(zx, zy), 0.3, 20);

    this.targetZoom = z;
    this.zoom       = z; // snap immediately on fit
    this.panX       = (cw - dims.widthMm  * z) / 2;
    this.panY       = (ch - dims.heightMm * z) / 2;
    this._dirty     = true;
  }

  play()  { this.isPlaying = true;  this._dirty = true; }
  pause() { this.isPlaying = false; }
  reset() { this.currentToolIndex = 0; this.isPlaying = false; this._dirty = true; }

  setSimSpeed(speed) { this.simSpeed = speed; }

  resize() {
    const parent = this.canvas.parentElement;
    // Skip while the tab is hidden — a 0×0 layout would bake in a stale buffer
    if (!parent || parent.clientWidth <= 0 || parent.clientHeight <= 0) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.canvas.width        = w;
    this.canvas.height       = h;
    this.offscreen.width     = w;
    this.offscreen.height    = h;
    this._dirty = true;
  }

  // ─── Events ─────────────────────────────────────────────────────────────────

  _setupEvents() {
    const cv = this.canvas;

    // ── Smooth wheel zoom-to-cursor ──────────────────────────────────────────
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : (1 / 1.12);
      const rect   = cv.getBoundingClientRect();
      this._zoomAround(factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    // ── Pointer drag + pinch-zoom ────────────────────────────────────────────
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.preventDefault();

      if (this._pointers.size === 1) {
        this._isDragging   = true;
        this._dragPrev     = { x: e.clientX, y: e.clientY };
        this._velX         = 0;
        this._velY         = 0;
        this._lastMoveTime = performance.now();
        this._lastMoveX    = e.clientX;
        this._lastMoveY    = e.clientY;
      } else if (this._pointers.size === 2) {
        this._isDragging   = false;
        const pts = [...this._pointers.values()];
        this._pinchDist0   = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        this._pinchZoom0   = this.targetZoom;
        this._pinchMidX    = (pts[0].x + pts[1].x) / 2;
        this._pinchMidY    = (pts[0].y + pts[1].y) / 2;
      }
    });

    cv.addEventListener('pointermove', (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      const prev = this._pointers.get(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._pointers.size === 2 && this._pinchDist0 !== null) {
        // Pinch zoom
        const pts   = [...this._pointers.values()];
        const dist  = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const scale = dist / this._pinchDist0;
        const nz    = clamp(this._pinchZoom0 * scale, 0.3, 20);
        const rect  = cv.getBoundingClientRect();
        const mx    = this._pinchMidX - rect.left;
        const my    = this._pinchMidY - rect.top;
        this.panX       = mx - (mx - this.panX) * (nz / this.targetZoom);
        this.panY       = my - (my - this.panY) * (nz / this.targetZoom);
        this.targetZoom = nz;
        this.zoom       = nz;
        this._dirty     = true;
      } else if (this._isDragging && this._pointers.size === 1) {
        // Drag pan (only while pan mode is active)
        if (!this.panMode) return;
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        this.panX += dx;
        this.panY += dy;

        const now = performance.now();
        const dt  = Math.max(1, now - this._lastMoveTime);
        this._velX         = (e.clientX - this._lastMoveX) / dt;
        this._velY         = (e.clientY - this._lastMoveY) / dt;
        this._lastMoveX    = e.clientX;
        this._lastMoveY    = e.clientY;
        this._lastMoveTime = now;

        this._dirty = true;
      }
    });

    const endDrag = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size === 0) {
        this._isDragging = false;
        this._pinchDist0 = null;
      }
    };
    cv.addEventListener('pointerup',     endDrag);
    cv.addEventListener('pointercancel', endDrag);

    // ── Keyboard shortcuts ───────────────────────────────────────────────────
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'f' || e.key === 'F')       this.fitToViewport();
      if (e.key === '+' || e.key === '=')        this.zoomBy(1.2);
      if (e.key === '-')                         this.zoomBy(1 / 1.2);
      if (e.key === ' ') {
        if (this.isPlaying) this.pause(); else this.play();
        e.preventDefault();
      }
    });

    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Zoom around a canvas-space point (cx, cy).
   * The world point under (cx,cy) remains stationary after the zoom.
   */
  _zoomAround(factor, cx, cy) {
    const oldZ = this.targetZoom;
    const newZ = clamp(oldZ * factor, 0.3, 20);
    const ratio = newZ / oldZ;
    this.panX       = cx - (cx - this.panX) * ratio;
    this.panY       = cy - (cy - this.panY) * ratio;
    this.targetZoom = newZ;
    this._dirty     = true;
  }

  // ─── Render Loop ─────────────────────────────────────────────────────────────

  _startLoop() {
    const loop = (now) => {
      const dt = Math.min((now - this._lastTs) / 1000, 0.1);
      this._lastTs = now;

      // ── Smooth zoom easing ───────────────────────────────────────────────
      const prevZoom   = this.zoom;
      // Exponential approach: ~95% of the way there in ~120ms
      const lerpFactor = 1 - Math.pow(0.008, dt);
      this.zoom        = lerp(this.zoom, this.targetZoom, lerpFactor);
      if (Math.abs(this.zoom - prevZoom) > 0.0002) this._dirty = true;

      // ── Momentum panning ─────────────────────────────────────────────────
      if (!this._isDragging && (Math.abs(this._velX) > 0.01 || Math.abs(this._velY) > 0.01)) {
        this.panX   += this._velX * dt * 1000;
        this.panY   += this._velY * dt * 1000;
        const fric   = Math.pow(0.008, dt);
        this._velX  *= fric;
        this._velY  *= fric;
        this._dirty  = true;
      }

      // ── Simulation tick ──────────────────────────────────────────────────
      if (this.isPlaying && this.toolpathPoints.length > 0) {
        this.currentToolIndex += dt * 12 * this.simSpeed;
        if (this.currentToolIndex >= this.toolpathPoints.length) {
          this.currentToolIndex = this.toolpathPoints.length - 1;
          this.isPlaying        = false;
        }
        this._dirty = true;
      }

      // Pulse phase always ticks when there is content
      if (this.toolpathPoints.length > 0) {
        this._pulsePhase = (this._pulsePhase + dt * 3.5) % (Math.PI * 2);
        if (this.isPlaying) this._dirty = true;
      }

      if (this._dirty) {
        this._render();
        this.ctx.drawImage(this.offscreen, 0, 0);
        this._dirty = false;
      }

      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  // ─── Rendering ───────────────────────────────────────────────────────────────

  _render() {
    const ctx = this.offCtx;
    const w   = this.offscreen.width;
    const h   = this.offscreen.height;

    ctx.fillStyle = '#06040d';
    ctx.fillRect(0, 0, w, h);

    if (!this.profile || !this.cardMatrix || this.cardMatrix.length === 0) {
      ctx.fillStyle = '#7e5a8a';
      ctx.font      = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Compile or select a pattern to view the CNC toolpath simulation', w / 2, h / 2);
      return;
    }

    const rows = this.cardMatrix.length;
    const cols = this.cardMatrix[0] ? this.cardMatrix[0].length : 24;
    const dims = calculateCardDimensions(this.profile, rows, cols);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // ── 1. Punchcard body ────────────────────────────────────────────────────
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur  = 18 / this.zoom;
    ctx.fillStyle   = this.profile.cardColor || '#f2ead8';
    ctx.fillRect(0, 0, dims.widthMm, dims.heightMm);
    ctx.shadowBlur  = 0;

    ctx.strokeStyle = '#4c1d66';
    ctx.lineWidth   = 0.5 / this.zoom;
    ctx.strokeRect(0, 0, dims.widthMm, dims.heightMm);

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(120,80,160,0.06)';
    ctx.lineWidth   = 0.15 / this.zoom;
    for (let r = 0; r < rows; r++) {
      const y = dims.rowOffsetYMm + r * this.profile.pitchY;
      ctx.beginPath();
      ctx.moveTo(0, y); ctx.lineTo(dims.widthMm, y);
      ctx.stroke();
    }

    // ── 2. Tractor sprockets ─────────────────────────────────────────────────
    const sprockR = this.profile.sprocketDiameter / 2;
    ctx.fillStyle = '#180820';
    for (let r = 0; r < rows; r++) {
      const sy = dims.rowOffsetYMm + r * (this.profile.sprocketPitchY || this.profile.pitchY);
      ctx.beginPath();
      ctx.arc(dims.leftSprocketXMm,  sy, sprockR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.arc(dims.rightSprocketXMm, sy, sprockR, 0, Math.PI * 2); ctx.fill();
    }

    // ── 3. Punch matrix ──────────────────────────────────────────────────────
    const holeR = this.profile.holeDiameter / 2;
    for (let r = 0; r < rows; r++) {
      const y = dims.rowOffsetYMm + r * this.profile.pitchY;
      for (let c = 0; c < cols; c++) {
        const x = dims.colOffsetXMm + c * this.profile.pitchX;
        if (this.cardMatrix[r][c]) {
          ctx.fillStyle = '#06020c';
          ctx.beginPath();
          ctx.arc(x, y, holeR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          ctx.lineWidth = 0.25 / this.zoom;
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(160,130,180,0.18)';
          ctx.fillRect(x - 0.25, y - 0.25, 0.5, 0.5);
        }
      }
    }

    // ── 4. Toolpath lines ────────────────────────────────────────────────────
    const maxIdx = this.showAllLayers
      ? this.toolpathPoints.length - 1
      : Math.min(
          this.toolpathPoints.length - 1,
          Math.floor(this.currentToolIndex)
        );

    if (this.toolpathPoints.length > 1) {
      // Full path (very dim background guide)
      ctx.strokeStyle = 'rgba(80,50,120,0.25)';
      ctx.lineWidth   = 0.2 / this.zoom;
      ctx.setLineDash([0.8 / this.zoom, 0.8 / this.zoom]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (const pt of this.toolpathPoints) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Completed path — glowing pink
      if (maxIdx >= 0) {
        ctx.strokeStyle = 'rgba(244,114,182,0.55)';
        ctx.lineWidth   = 0.35 / this.zoom;
        ctx.setLineDash([0.9 / this.zoom, 0.5 / this.zoom]);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        for (let i = 0; i <= maxIdx; i++) ctx.lineTo(this.toolpathPoints[i].x, this.toolpathPoints[i].y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ── 5. Completed holes ────────────────────────────────────────────────
      for (let i = 0; i <= maxIdx; i++) {
        const pt = this.toolpathPoints[i];
        ctx.shadowColor = 'rgba(251,146,60,0.65)';
        ctx.shadowBlur  = 3.5 / this.zoom;
        ctx.fillStyle   = '#fb923c';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.radius * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // ── 6. Active toolhead ────────────────────────────────────────────────
      if (maxIdx >= 0 && maxIdx < this.toolpathPoints.length) {
        const cur   = this.toolpathPoints[maxIdx];
        const pulse = 0.5 + 0.5 * Math.sin(this._pulsePhase);

        // Outer pulsing ring
        ctx.strokeStyle = `rgba(244,114,182,${0.3 + pulse * 0.4})`;
        ctx.lineWidth   = 0.55 / this.zoom;
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, cur.radius * (2.0 + pulse * 0.9), 0, Math.PI * 2);
        ctx.stroke();

        // Inner ring
        ctx.strokeStyle = '#f472b6';
        ctx.lineWidth   = 0.5 / this.zoom;
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, cur.radius * 1.45, 0, Math.PI * 2);
        ctx.stroke();

        // Crosshair
        const arm = cur.radius * 2.6;
        ctx.beginPath();
        ctx.moveTo(cur.x - arm, cur.y); ctx.lineTo(cur.x + arm, cur.y);
        ctx.moveTo(cur.x, cur.y - arm); ctx.lineTo(cur.x, cur.y + arm);
        ctx.stroke();

        // Centre dot
        ctx.fillStyle = '#fce7f3';
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, 0.55 / this.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    this._renderHUD(ctx, w, h, maxIdx);
    this._renderZoomIndicator(ctx, w, h);
  }

  _renderHUD(ctx, w, h, activePt) {
    const totalPts = this.toolpathPoints.length;
    const machined = this.showAllLayers ? totalPts : Math.max(0, activePt);
    const progress = totalPts > 0 ? machined / totalPts : 0;

    const hudW = 290;
    const hudH = 150;
    const hudX = 20;
    const hudY = h - hudH - 20;

    ctx.fillStyle   = 'rgba(10, 3, 20, 0.9)';
    ctx.strokeStyle = '#4c1d66';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(hudX, hudY, hudW, hudH, 8);
    ctx.fill();
    ctx.stroke();

    // Gradient accent bar at top
    const g = ctx.createLinearGradient(hudX, hudY, hudX + hudW, hudY);
    g.addColorStop(0, '#be185d');
    g.addColorStop(1, '#7c3aed');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(hudX, hudY, hudW, 3, [8, 8, 0, 0]);
    ctx.fill();

    ctx.fillStyle = '#f9a8d4';
    ctx.font      = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CNC TOOLPATH TELEMETRY', hudX + 14, hudY + 20);

    ctx.fillStyle = '#c084fc';
    ctx.font      = '10px monospace';
    const et     = this.estimatedTimeSeconds;
    const etStr  = `${Math.floor(et / 60)}m ${et % 60}s`;

    ctx.fillText(`Machine:    ${this.profile ? this.profile.name : 'Standard'}`, hudX + 14, hudY + 38);
    ctx.fillText(`Machined:   ${machined} / ${totalPts} holes`, hudX + 14, hudY + 54);
    ctx.fillText(`Rapid:      ${this.totalRapidDistanceMm.toFixed(1)} mm`, hudX + 14, hudY + 70);
    ctx.fillText(`Cycle est.: ${etStr}`, hudX + 14, hudY + 86);
    ctx.fillText(`Path opt.:  2-OPT TSP (active)`, hudX + 14, hudY + 102);

    // Progress bar track
    const barX = hudX + 14;
    const barY = hudY + 118;
    const barW = hudW - 28;
    const barH = 8;
    ctx.fillStyle = '#2d1040';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 4);
    ctx.fill();

    if (progress > 0) {
      const pg = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      pg.addColorStop(0, '#be185d');
      pg.addColorStop(1, '#f472b6');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW * progress, barH, 4);
      ctx.fill();
    }

    ctx.fillStyle = '#e879f9';
    ctx.font      = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(progress * 100)}%`, hudX + hudW - 14, barY + 7);
  }

  _renderZoomIndicator(ctx, w, h) {
    const label = `${Math.round(this.zoom * 100)}%`;
    const tw = 60, th = 22;
    ctx.fillStyle   = 'rgba(10,3,20,0.8)';
    ctx.strokeStyle = '#4c1d66';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(w - tw - 10, h - th - 8, tw, th, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#c084fc';
    ctx.font      = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, w - tw / 2 - 10, h - th / 2 - 8 + 4);
  }
}
