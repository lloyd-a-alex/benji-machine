/**
 * Interactive Tank Top Tailoring CAD Visualizer
 *
 * Renders the parametric 2D garment silhouette with:
 * 1. Anatomic armhole scye curves & scoop neckline
 * 2. A real STITCH grid whose cell size is driven by the knitter's gauge
 *    (stitches / rows per 10cm swatch) so the grid genuinely fits their yarn
 * 3. Free-hand drawing directly onto that stitch grid, keeping the
 *    left/right symmetry mirror ("keep the symmetry thing but just draw")
 * 4. Dimension callout lines, ribbing divider and grain line
 */

import { TankTopTailoringEngine } from '../tailor/tank-top-engine.js';

export class TankTopCanvas {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    this.engine = new TankTopTailoringEngine(options);
    this.zoom = 0.8;
    this.panX = 0;
    this.panY = 0;

    // Drawing layer (stitch grid painting). Kept fully independent from the
    // parametric silhouette so turning it off leaves the old view untouched.
    this.drawMode = false;
    this.symmetry = true;          // mirror left/right across centre (default on)
    this.painted = new Set();      // "r,c" keys of contrast stitches
    this._painting = false;
    this._paintValue = 1;

    this.setupEvents();
    this.resize();
    this.render();
  }

  setParams(newParams) {
    this.engine.setParams(newParams);
    this.render();
  }

  getCurrentParams() {
    return this.engine.params;
  }

  setGauge(newGauge) {
    this.engine.setGauge(newGauge);
    this.render();
  }

  getCurrentGauge() {
    return this.engine.gauge;
  }

  setDrawMode(on) {
    this.drawMode = !!on;
    this.canvas.style.cursor = this.drawMode ? 'crosshair' : 'grab';
    this.render();
    return this.drawMode;
  }

  toggleSymmetry() {
    this.symmetry = !this.symmetry;
    this.render();
    return this.symmetry;
  }

  clearDrawing() {
    this.painted.clear();
    this.render();
  }

  // ---- Stitch grid geometry (derived from the engine's gauge-aware pattern) ----
  computeGrid() {
    const pattern = this.engine.computePattern();
    const dims = pattern.dimensions;
    const cols = Math.max(2, dims.castOnStitches);
    const rows = Math.max(2, dims.totalRows);
    const halfW = dims.widthMm / 2;
    const top = dims.heightMm;
    return {
      pattern, dims, cols, rows,
      left: -halfW, right: halfW, bottom: 0, top,
      cellW: dims.widthMm / cols,
      cellH: top / rows
    };
  }

  cellRectMm(g, r, c) {
    return { x: g.left + c * g.cellW, y: r * g.cellH, w: g.cellW, h: g.cellH };
  }

  cellCenterMm(g, r, c) {
    return { x: g.left + (c + 0.5) * g.cellW, y: (r + 0.5) * g.cellH };
  }

  screenToCell(clientX, clientY) {
    const g = this.computeGrid();
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const mmX = (px - this.panX) / this.zoom;
    const mmY = (this.panY - py) / this.zoom; // Y is flipped in the render transform
    const c = Math.floor((mmX - g.left) / g.cellW);
    const r = Math.floor((mmY - g.bottom) / g.cellH);
    if (r < 0 || r >= g.rows || c < 0 || c >= g.cols) return null;
    return { r, c, g };
  }

  isInsideGarment(g, x, y) {
    const pts = g.pattern.frontProfileMm;
    // Build the full closed outline (right half + mirrored left half).
    const poly = pts.map(p => [p.x, p.y]);
    for (let i = pts.length - 1; i >= 0; i--) poly.push([-pts[i].x, pts[i].y]);
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  paintAt(clientX, clientY, value) {
    const cell = this.screenToCell(clientX, clientY);
    if (!cell) return;
    const { r, c, g } = cell;
    const centre = this.cellCenterMm(g, r, c);
    if (!this.isInsideGarment(g, centre.x, centre.y)) return; // stay inside the tee

    const apply = (rr, cc) => {
      if (cc < 0 || cc >= g.cols) return;
      const key = `${rr},${cc}`;
      if (value) this.painted.add(key);
      else this.painted.delete(key);
    };

    apply(r, c);
    if (this.symmetry) apply(r, g.cols - 1 - c); // keep the left/right mirror
    this.render();
  }

  // Returns a numeric [row][col] matrix (0/1) of the drawn stitches for export.
  getPaintedMatrix() {
    const g = this.computeGrid();
    const m = [];
    for (let r = 0; r < g.rows; r++) {
      const row = new Array(g.cols).fill(0);
      for (let c = 0; c < g.cols; c++) if (this.painted.has(`${r},${c}`)) row[c] = 1;
      m.push(row);
    }
    return { matrix: m, cols: g.cols, rows: g.rows, dims: g.dims };
  }

  setupEvents() {
    this.canvas.style.cursor = 'grab';
    // Long-press on a finger should never summon the browser context menu.
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoom = Math.max(0.3, Math.min(2.5, this.zoom * factor));
      this.render();
    });

    let isDragging = false;
    let startMouse = { x: 0, y: 0 };

    // Pointer Events: one code path for mouse, touch and pen.
    this._pointers = new Map();
    this._pinch = null;

    this.canvas.addEventListener('pointerdown', e => {
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size >= 2) {
        this._beginPinch();
        return;
      }
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* window listeners still cover it */ }

      const paintIntent = this.drawMode && !e.altKey && (e.button === 0 || e.button === 2);
      if (paintIntent) {
        this._painting = true;
        this._paintValue = (e.button === 2) ? 0 : 1;
        this.paintAt(e.clientX, e.clientY, this._paintValue);
        return;
      }
      isDragging = true;
      startMouse = { x: e.clientX, y: e.clientY };
      this.canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('pointermove', e => {
      if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pinch) {
        this._updatePinch();
        return;
      }
      if (this._painting) {
        this.paintAt(e.clientX, e.clientY, this._paintValue);
        return;
      }
      if (isDragging) {
        this.panX += e.clientX - startMouse.x;
        this.panY += e.clientY - startMouse.y;
        startMouse = { x: e.clientX, y: e.clientY };
        this.render();
      }
    });

    const endPointer = e => {
      this._pointers.delete(e.pointerId);
      if (this._pinch && this._pointers.size < 2) this._pinch = null;
      this._painting = false;
      isDragging = false;
      this.canvas.style.cursor = this.drawMode ? 'crosshair' : 'grab';
    };
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);

    window.addEventListener('resize', () => {
      this.resize();
    });
  }

  /** Two fingers: stop painting/panning and navigate instead. */
  _beginPinch() {
    this._painting = false;
    const [a, b] = [...this._pointers.values()];
    this._pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    };
    this.canvas.style.cursor = 'grabbing';
  }

  /** Pinch distance → zoom about the fingers; midpoint drift → pan. */
  _updatePinch() {
    const pts = [...this._pointers.values()];
    if (pts.length < 2 || !this._pinch) return;
    const [a, b] = pts;
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    this.panX += mid.x - this._pinch.mid.x;
    this.panY += mid.y - this._pinch.mid.y;

    const next = Math.max(0.3, Math.min(2.5, this.zoom * (dist / this._pinch.dist)));
    // Keep the point under the fingers fixed while scaling.
    const rect = this.canvas.getBoundingClientRect();
    const px = mid.x - rect.left;
    const py = mid.y - rect.top;
    this.panX += (px - this.panX) * (1 - next / this.zoom);
    this.panY += (py - this.panY) * (1 - next / this.zoom);
    this.zoom = next;

    this._pinch = { dist, mid };
    this.render();
  }

  resize() {
    const parent = this.canvas.parentElement;
    // Skip while the tab is hidden — a 0×0 layout would bake in a stale buffer
    if (parent && parent.clientWidth > 0 && parent.clientHeight > 0) {
      this.canvas.width = parent.clientWidth;
      this.canvas.height = parent.clientHeight;
      this.centerView();
      this.render();
    }
  }

  centerView() {
    this.panX = this.canvas.width / 2;
    this.panY = this.canvas.height * 0.82;
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Dark atelier CAD background
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, w, h);

    const g = this.computeGrid();
    const pts = g.pattern.frontProfileMm;
    const dims = g.dims;

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, -this.zoom); // Invert Y so up is positive mm

    const halfWidthMm = dims.widthMm / 2;
    const totalHeightMm = dims.heightMm;

    // 1. Garment body fill (drawn first so the stitch grid sits on top of it)
    ctx.beginPath();
    ctx.moveTo(0, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(-pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.fill();

    // 2. Gauge-accurate stitch grid (each cell = 1 stitch x 1 row). Cell size is
    //    driven by stitches/rows per 10cm, so finer yarn yields a finer grid.
    ctx.lineWidth = 0.4;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.beginPath();
    for (let c = 0; c <= g.cols; c++) {
      const x = g.left + c * g.cellW;
      ctx.moveTo(x, 0); ctx.lineTo(x, totalHeightMm);
    }
    for (let r = 0; r <= g.rows; r++) {
      const y = r * g.cellH;
      ctx.moveTo(g.left, y); ctx.lineTo(g.right, y);
    }
    ctx.stroke();

    // 3. Painted stitches (contrast colour), clipped to the garment silhouette.
    for (const key of this.painted) {
      const [rStr, cStr] = key.split(',');
      const r = parseInt(rStr, 10), c = parseInt(cStr, 10);
      const rect = this.cellRectMm(g, r, c);
      const centre = this.cellCenterMm(g, r, c);
      if (!this.isInsideGarment(g, centre.x, centre.y)) continue;
      ctx.fillStyle = this.drawMode ? 'rgba(244, 63, 94, 0.85)' : 'rgba(244, 63, 94, 0.7)';
      ctx.fillRect(rect.x + rect.w * 0.08, rect.y + rect.h * 0.08, rect.w * 0.84, rect.h * 0.84);
    }

    // 4. Cutting boundary stroke (redraw on top so it stays crisp)
    ctx.beginPath();
    ctx.moveTo(0, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(-pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.0 / this.zoom;
    ctx.stroke();

    // 5. Hem Ribbing Divider Line
    const ribbingYMm = this.engine.params.ribbingHeightCm * 10;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.2 / this.zoom;
    ctx.setLineDash([4 / this.zoom, 4 / this.zoom]);
    ctx.beginPath();
    ctx.moveTo(-halfWidthMm, ribbingYMm);
    ctx.lineTo(halfWidthMm, ribbingYMm);
    ctx.stroke();
    ctx.setLineDash([]);

    // 6. Center Grain Line
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.0 / this.zoom;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(0, totalHeightMm - 10);
    ctx.stroke();

    ctx.restore();

    // 7. On-screen CAD dimension overlays (screen space)
    this.renderDimensionOverlays(ctx, g.pattern);
  }

  renderDimensionOverlays(ctx, pattern) {
    const dims = pattern.dimensions;
    const p = this.engine.params;
    const g = this.engine.gauge;

    // Overlay Card in top-left
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;

    const cardW = 340;
    const cardH = 232;
    ctx.beginPath();
    ctx.roundRect(20, 20, cardW, cardH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px -apple-system, sans-serif';
    ctx.fillText("Benji's Tank Top Shaping Specifications", 35, 42);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    ctx.fillText(`Gauge (your yarn):    ${g.stitchesPer10Cm.toFixed(1)} sts × ${g.rowsPer10Cm.toFixed(1)} rows / 10cm`, 35, 62);
    ctx.fillText(`Chest Circumference:  ${p.chestCircumferenceCm} cm (Ease: +${p.easeCm} cm)`, 35, 82);
    ctx.fillText(`Cast-On Needles:      ${dims.castOnStitches} sts (L${dims.halfStitches} to R${dims.halfStitches})`, 35, 100);
    ctx.fillText(`Hem Ribbing:          ${dims.ribbingRows} rows (${p.ribbingType} rib)`, 35, 118);
    ctx.fillText(`Underarm Bind-Off:    ${dims.initialBindOffSts} sts each side`, 35, 136);
    ctx.fillText(`Armhole Scye Dec:     1 st every 2 rows × ${dims.gradualDecSts}`, 35, 154);
    ctx.fillText(`Front Scoop Split:    Row ${dims.frontNeckSplitRow} (Hold ${dims.neckStitchesTotal} sts)`, 35, 172);
    ctx.fillText(`Strap Width:          ${dims.strapStitches} sts (${p.strapWidthCm} cm)`, 35, 190);
    ctx.fillText(`Total Rows to Knit:   ${dims.totalRows} rows`, 35, 208);
    ctx.fillText(`Stitches drawn:       ${this.painted.size}`, 35, 226);
  }
}
