/**
 * Realistic Physical Yarn & Knitted Fabric Simulator
 */

import { KnitTopologyNetwork, STITCH_TYPE } from '../math/knit-topology.js';

// Set to true via window.__KNITCAT_DEBUG__ to emit per-frame timing logs.
const DEBUG = typeof window !== 'undefined' ? !!window.__KNITCAT_DEBUG__ : false;

export class YarnSimulator {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.dpr = 1;

    this.rows = options.rows || 24;
    this.cols = options.cols || 24;
    this.topology = new KnitTopologyNetwork(this.rows, this.cols, 22, 18);
    this.topology.collisionEnabled = false;

    this.yarnColorMain = options.yarnColorMain || '#f8fafc';
    this.yarnColorContrast = options.yarnColorContrast || '#38bdf8';
    this.yarnThickness = 4.2;
    this.yarnTension = 1.0;
    this.viewMode = 'shaded';
    this.materialProfile = {
      name: 'cotton',
      stiffness: 0.98,
      restMultiplier: 0.95,
      damping: 0.82
    };

    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.isMouseDown = false;
    this.lastMouse = { x: 0, y: 0 };

    this.animating = true;
    this.animFrameId = null;
    this.prevStrainEnergy = Infinity;
    this.energySleepThreshold = 1e-4;

    this.setupEvents();
    this.resize();
  }

  updateFabric(stitchMatrix, colorMatrix = null) {
    if (!stitchMatrix || stitchMatrix.length === 0) return;
    const t0 = performance.now();
    try {
      this.rows = stitchMatrix.length;
      this.cols = stitchMatrix[0]?.length || 24;
      this.topology = new KnitTopologyNetwork(this.rows, this.cols, 22, 18);
      this.topology.buildFromStitchMatrix(stitchMatrix, colorMatrix);
      this.applyMaterialProfile(this.materialProfile);

      // Fast Jacobi warm-up without quadratic collision passes
      this.topology.collisionEnabled = false;
      for (let i = 0; i < 6; i++) {
        this.topology.stepPhysics(3, 0.016, this.topology.damping);
      }

      this.prevStrainEnergy = this.topology.totalStrainEnergy;
      this.animating = true;
      this.centerFabric();
      this.render();
      this.startAnimationLoop();
      if (DEBUG) console.log(`[KNITCAT][Yarn] updateFabric completed in ${Math.round(performance.now() - t0)}ms (${this.rows}×${this.cols})`);
    } catch (err) {
      console.error('[KNITCAT][Yarn] updateFabric error:', err);
    }
  }

  applyMaterialProfile(profile) {
    if (!profile || !this.topology?.constraints) return;
    this.materialProfile = { ...this.materialProfile, ...profile };
    this.topology.damping = this.materialProfile.damping;

    // Tension is yarn *tightness*, not solver stiffness. Pushing stiffness > 1
    // makes the relaxation overshoot and the whole lattice flips out. Instead:
    //   - stiffness eases toward the solver-stable cap as tension rises
    //   - rest length shortens as tension rises (fabric pulls taut / dense)
    // At tension = 1.0 this reproduces the original material exactly.
    const T = Math.max(0.2, Math.min(3.0, this.yarnTension || 1.0));
    const baseStiff = this.materialProfile.stiffness;
    const stiff = Math.max(0.15, Math.min(1.0, baseStiff * (0.5 + 0.5 * T)));
    const restScale = Math.max(0.78, Math.min(1.22, this.materialProfile.restMultiplier / (0.6 + 0.4 * T)));

    for (const c of this.topology.constraints) {
      if (c.baseRestLength == null) c.baseRestLength = c.restLength;
      c.stiffness = stiff;
      c.restLength = c.baseRestLength * restScale;
    }
  }

  setYarnColors(main, contrast) {
    if (main) this.yarnColorMain = main;
    if (contrast) this.yarnColorContrast = contrast;
  }

  setTension(tensionFactor) {
    this.yarnTension = Math.max(0.2, Math.min(3.0, tensionFactor));
    this.applyMaterialProfile(this.materialProfile);
    // Force at least one honest comparison. The sleep detector compares against
    // prevStrainEnergy, and leaving the pre-tension value in there meant the very
    // next frame looked "settled" and put the fabric straight back to sleep — so
    // changing tension appeared to do nothing at all.
    this.prevStrainEnergy = Infinity;
    this.wake();
  }

  /**
   * Resume the physics loop. The solver parks itself once the fabric settles, so
   * anything that perturbs it has to say "wake up" rather than just flipping a
   * flag the parked loop is no longer reading.
   */
  wake() {
    this.animating = true;
    this.startAnimationLoop();
  }

  resetMounting() {
    if (!this.topology?.matrix) return;
    const topo = this.topology;

    for (let r = 0; r < topo.rows; r++) {
      for (let c = 0; c < topo.cols; c++) {
        const node = topo.matrix[r][c];
        if (!node) continue;
        const zOffset = (node.type === STITCH_TYPE.PURL) ? -2.5 : 2.0;
        node.pos.set(
          (c - topo.cols / 2) * topo.spacingX,
          (r - topo.rows / 2) * topo.spacingY,
          zOffset
        );
        node.prevPos = node.pos.clone();
        node.acc.set(0, 0, 0);
        node.isFixed = (r === 0 || r === topo.rows - 1);
      }
    }

    topo.totalStrainEnergy = 0;
    this.prevStrainEnergy = Infinity;
    this.wake();
    this.centerFabric();
    this.render();
    if (DEBUG) console.log('[KNITCAT][Yarn] Fabric mounting reset to needle-bed anchors');
  }

  centerFabric() {
    const w = this.canvas.width / (this.dpr || 1);
    const h = this.canvas.height / (this.dpr || 1);
    this.panX = w / 2;
    this.panY = h / 2;
  }

  resize() {
    const parent = this.canvas.parentElement;
    // Ignore resize events fired while the tab is hidden (0×0 layout)
    if (parent && parent.clientWidth > 0 && parent.clientHeight > 0) {
      // Back the buffer with devicePixelRatio device pixels while the pan/zoom view
      // keeps working in CSS pixels: render sets a base dpr transform and the layout
      // helpers divide by it, so the fabric stays crisp on HiDPI screens.
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      this.dpr = dpr;
      this.canvas.width = Math.round(parent.clientWidth * dpr);
      this.canvas.height = Math.round(parent.clientHeight * dpr);
      this.centerFabric();
      // The canvas buffer was just reallocated (and cleared). The physics loop may
      // be parked, so paint immediately or the view stays blank until something
      // perturbs the fabric.
      this.render();
    }
  }

  setupEvents() {
    // Keep refs so destroy() can detach every listener (no leaked handlers).
    this._listeners = [];
    const on = (target, type, handler, opts) => {
      target.addEventListener(type, handler, opts);
      this._listeners.push({ target, type, handler, opts });
    };

    // Pointer Events, not mouse events. Every other canvas in this app takes
    // pointers; the yarn view was the odd one out, which meant the single most
    // tactile thing in the whole tool — pulling fabric around — did nothing on a
    // phone or a drawing tablet.
    try { this.canvas.style.touchAction = 'none'; } catch (_) { /* inline style is optional */ }

    // Active pointers by id, so two-finger pinch and one-finger pan don't fight.
    this._pointers = new Map();
    this._pinchStartDist = 0;
    this._pinchStartZoom = 1;

    on(this.canvas, 'pointerdown', e => {
      this.canvas.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.wake();
      if (this._pointers.size === 1) {
        this.isMouseDown = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      } else if (this._pointers.size === 2) {
        // Second finger down: this is a zoom gesture, not a pan.
        this.isMouseDown = false;
        const [a, b] = [...this._pointers.values()];
        this._pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this._pinchStartZoom = this.zoom;
      }
    });

    on(this.canvas, 'pointermove', e => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._pointers.size >= 2) {
        const [a, b] = [...this._pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.zoom = Math.max(0.3, Math.min(4.0, this._pinchStartZoom * (dist / this._pinchStartDist)));
        this.render();
        return;
      }
      if (this.isMouseDown) {
        this.panX += e.clientX - this.lastMouse.x;
        this.panY += e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.render();
      }
    });

    const lift = e => {
      // Registered on both the canvas and the window, so a single release arrives
      // twice via bubbling. Bail on the second one instead of re-running the
      // one-finger handover below.
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.delete(e.pointerId);
      if (this._pointers.size === 0) this.isMouseDown = false;
      // Dropping back to one finger: re-anchor the pan so the fabric doesn't jump.
      else if (this._pointers.size === 1) {
        const only = [...this._pointers.values()][0];
        this.lastMouse = { x: only.x, y: only.y };
        this.isMouseDown = true;
      }
    };
    on(this.canvas, 'pointerup', lift);
    on(this.canvas, 'pointercancel', lift);
    // Safety net: if the pointer is captured and released outside the canvas, the
    // up event still has to land somewhere.
    on(window, 'pointerup', lift);

    on(this.canvas, 'wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoom = Math.max(0.3, Math.min(4.0, this.zoom * factor));
      this.render();
    }, { passive: false });

    // Coalesce the resize storm: an on-screen keyboard opening fires a dozen
    // layout changes a second, and each one used to resize and re-centre.
    let resizeQueued = false;
    on(window, 'resize', () => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        this.resize();
      });
    });
  }

  /** Detach all listeners and stop the loop. Safe to call more than once. */
  destroy() {
    this.stop();
    if (this._listeners) {
      for (const { target, type, handler, opts } of this._listeners) {
        target.removeEventListener(type, handler, opts);
      }
      this._listeners = null;
    }
  }

  startAnimationLoop() {
    if (this.animFrameId) return;
    const loop = () => {
      // Release the frame budget once the fabric has settled. The previous version
      // kept requesting frames forever and merely skipped the physics, so an idle
      // yarn tab still pinned a slot on the browser's animation clock — the single
      // biggest battery drain in the app for no visible reason.
      if (!this.animating) {
        this.animFrameId = null;
        return;
      }
      this.topology.stepPhysics(4, 0.016, this.topology.damping);
      const energy = this.topology.totalStrainEnergy;
      // Never sleep while gravity is draping the fabric — keep integrating
      if (!this.topology.gravityEnabled &&
          Math.abs(this.prevStrainEnergy - energy) < this.energySleepThreshold) {
        this.animating = false;
      }
      this.prevStrainEnergy = energy;
      this.render();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  stop() {
    this.animating = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  render() {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    try {
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 0.5;
      const bgSpacing = 30;
      ctx.beginPath();
      for (let x = 0; x < w; x += bgSpacing) {
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
      }
      for (let y = 0; y < h; y += bgSpacing) {
        ctx.moveTo(0, y); ctx.lineTo(w, y);
      }
      ctx.stroke();

      ctx.save();
      ctx.translate(this.panX, this.panY);
      ctx.scale(this.zoom, this.zoom);

      if (this.topology) {
        const geometries = this.topology.generateDetailedYarnGeometry();

        if (geometries && geometries.length > 0) {
          geometries.sort((a, b) => {
            const midA = Math.floor(a.points.length / 2);
            const midB = Math.floor(b.points.length / 2);
            const zA = a.points[midA]?.z || 0;
            const zB = b.points[midB]?.z || 0;
            return zA - zB;
          });

          for (const geom of geometries) {
            this.renderYarnStrand(ctx, geom);
          }
        }
      }
    } catch (err) {
      console.warn('[KNITCAT][Yarn] render error:', err);
    } finally {
      ctx.restore();
    }
  }

  _strokeCatmullRomPath(ctx, pts, yOffset, xOffset = 0) {
    const numSubdivisions = 5;
    ctx.beginPath();
    let started = false;

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      for (let s = 0; s < numSubdivisions; s++) {
        const t = s / numSubdivisions;
        const t2 = t * t;
        const t3 = t2 * t;
        const f0 = -0.5 * t3 + t2 - 0.5 * t;
        const f1 = 1.5 * t3 - 2.5 * t2 + 1.0;
        const f2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
        const f3 = 0.5 * t3 - 0.5 * t2;
        const sx = (p0.x * f0 + p1.x * f1 + p2.x * f2 + p3.x * f3) + xOffset;
        const sy = -(p0.y * f0 + p1.y * f1 + p2.y * f2 + p3.y * f3) + yOffset;
        if (!started) {
          ctx.moveTo(sx, sy);
          started = true;
        } else {
          ctx.lineTo(sx, sy);
        }
      }
    }

    const last = pts[pts.length - 1];
    ctx.lineTo(last.x + xOffset, -last.y + yOffset);
    ctx.stroke();
  }

  renderYarnStrand(ctx, geom) {
    const pts = geom.points;
    if (!pts || pts.length < 2) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (this.viewMode === 'wireframe') {
      ctx.strokeStyle = (geom.colorIndex === 1) ? this.yarnColorContrast : '#94a3b8';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const sx = pts[i].x;
        const sy = -pts[i].y;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      return;
    }

    if (this.viewMode === 'stress') {
      const tension = geom.tension || 1.0;
      const hue = Math.max(0, Math.min(240, 240 - (tension - 0.5) * 160));
      ctx.strokeStyle = `hsl(${hue}, 90%, 55%)`;
      ctx.lineWidth = this.yarnThickness;
      this._strokeCatmullRomPath(ctx, pts, 0);
      return;
    }

    const baseColor = (geom.colorIndex === 1) ? this.yarnColorContrast : this.yarnColorMain;
    const strokeWidth = this.yarnThickness;

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = strokeWidth + 2.5;
    this._strokeCatmullRomPath(ctx, pts, 2.5);

    ctx.strokeStyle = baseColor;
    ctx.lineWidth = strokeWidth;
    this._strokeCatmullRomPath(ctx, pts, 0);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = strokeWidth * 0.35;
    this._strokeCatmullRomPath(ctx, pts, -0.8, -0.6);
  }

  exportObj() {
    const geoms = this.topology?.generateDetailedYarnGeometry?.() || [];
    let obj = '# Benji KNITCAT Yarn Fabric Export\n';
    obj += `# Loops: ${geoms.length}\n`;
    let vertexIndex = 1;

    for (let g = 0; g < geoms.length; g++) {
      const geom = geoms[g];
      const start = vertexIndex;
      for (const p of geom.points) {
        obj += `v ${p.x.toFixed(4)} ${p.y.toFixed(4)} ${p.z.toFixed(4)}\n`;
        vertexIndex++;
      }
      obj += `g loop_${g}_${geom.type || 'strand'}\n`;
      for (let i = 0; i < geom.points.length - 1; i++) {
        obj += `l ${start + i} ${start + i + 1}\n`;
      }
    }

    return obj;
  }
}
