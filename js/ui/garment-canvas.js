/**
 * KNITCAT — unified interactive garment tailor canvas.
 *
 * The tank-top CAD visualizer was the best preview in the app: a continuous 2D
 * silhouette, a real stitch grid whose cell size is driven by the knitter's gauge,
 * free-hand painting with a left/right mirror, and CAD dimension callouts. But it
 * only ever drew a tank top. This class generalises it to *any* garment in the
 * catalogue by rendering the `plan.geometry.outlineMm` that ClothesEngine now
 * produces for every structure — so a hat, a sock, a sweater and the tank top all
 * get the same gauge-aware, paintable, mirror-capable preview.
 *
 * @module ui/garment-canvas
 */

import { ClothesEngine } from '../tailor/clothes-catalog.js';
import { TankTopTailoringEngine } from '../tailor/tank-top-engine.js';
import { buildGeometry } from '../tailor/garment-geometry.js';
import { logger } from '../core/logging.js';

const log = logger('ui/garment-canvas');

export class GarmentCanvas {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    if (!this.ctx) log.error('garment canvas 2D context is unavailable — the preview cannot render', { hasElement: !!canvasElement });
    this.dpr = 1;

    this.clothes = new ClothesEngine();
    // Legacy tank engine kept for the exports / estimators the old tank wiring calls.
    this.engine = new TankTopTailoringEngine(options.tankParams || {});
    this.garment = null;
    this.plan = null;
    this.geometry = buildGeometry('tank', { params: this.engine.params, gauge: this.engine.gauge, cols: 24, rows: 24 });

    this.zoom = 0.8;
    this.panX = 0;
    this.panY = 0;

    // Drawing layer (stitch grid painting), independent of the parametric silhouette.
    this.drawMode = false;
    this.symmetry = true;          // mirror left/right across centre (default on)
    this.painted = new Set();      // "r,c" keys of contrast stitches
    this._painting = false;
    this._paintValue = 1;

    this.setupEvents();
    this.resize();
    this.render();
  }

  // ---- Garment selection ----------------------------------------------------
  /**
   * Show a catalogue garment. The plan's continuous geometry drives everything.
   * @param {object} garment a GARMENTS entry
   * @param {object} params  measured values
   * @param {object} gauge   { stitchesPer10Cm, rowsPer10Cm }
   */
  setGarment(garment, params = {}, gauge = {}) {
    this.garment = garment;
    this.plan = this.clothes.compute(garment, params, gauge);
    this.geometry = this.plan.geometry || this.geometry;
    this.painted.clear();
    this.centerView();
    this.render();
    return this.plan;
  }

  /** Recompute the current garment from new params / gauge (slider live-update). */
  refresh(params = {}, gauge = {}) {
    if (!this.garment) return null;
    this.plan = this.clothes.compute(this.garment, { ...(this.plan?.params || {}), ...params }, { ...(this.plan?.gauge || {}), ...gauge });
    this.geometry = this.plan.geometry || this.geometry;
    this.render();
    return this.plan;
  }

  setParams(newParams) {
    Object.assign(this.engine.params, newParams);
    if (!this.garment) {
      this.geometry = buildGeometry('tank', { params: this.engine.params, gauge: this.engine.gauge, cols: 24, rows: 24 });
    }
    this.render();
  }

  getCurrentParams() {
    return this.plan?.params || this.engine.params;
  }

  setGauge(newGauge) {
    Object.assign(this.engine.gauge, newGauge);
    if (!this.garment) {
      this.geometry = buildGeometry('tank', { params: this.engine.params, gauge: this.engine.gauge, cols: 24, rows: 24 });
    }
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

  // ---- Stitch grid geometry (derived from the current continuous outline) ----
  computeGrid() {
    const geo = this.geometry;
    const cols = Math.max(2, geo.cols || 2);
    const rows = Math.max(2, geo.rows || 2);
    const halfW = geo.widthMm / 2;
    const top = geo.heightMm;
    return {
      geo, cols, rows,
      outline: geo.outlineMm,
      left: -halfW, right: halfW, bottom: 0, top,
      cellW: geo.widthMm / cols,
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

  /** Point-in-polygon against the already-full closed outline. */
  isInsideGarment(g, x, y) {
    const poly = g.outline;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
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
    if (!this.isInsideGarment(g, centre.x, centre.y)) return; // stay inside the piece

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
    return { matrix: m, cols: g.cols, rows: g.rows, geometry: g.geo };
  }

  /**
   * Bulk-paint the drawing layer from a contrast matrix — the motif currently drawn
   * in the CAD editor — tiled across the piece and clipped to the silhouette so no
   * stitch lands off the garment. This is the reverse of {@link KnitApp.sendClothesToEditor}:
   * it closes the loop so a pattern authored in the editor becomes the fabric of a
   * garment without redrawing it by hand.
   * @param {Array<Array<number>>} matrix rows×cols where a truthy cell is a contrast stitch
   * @param {{tile?:boolean, clear?:boolean}} [opts] `tile` repeats the motif to fill the
   *   piece (default true); `clear` drops existing stitches first (default true).
   * @returns {number} how many stitches were painted
   */
  setPaintedMatrix(matrix, opts = {}) {
    const { tile = true, clear = true } = opts;
    if (clear) this.painted.clear();
    const src = Array.isArray(matrix) && matrix.length ? matrix : null;
    if (!src) { this.render(); return 0; }
    const srcRows = src.length;
    const srcCols = src.reduce((n, row) => Math.max(n, row ? row.length : 0), 0) || 1;
    const g = this.computeGrid();
    let count = 0;
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const centre = this.cellCenterMm(g, r, c);
        if (!this.isInsideGarment(g, centre.x, centre.y)) continue; // stay on the piece
        const sr = tile ? r % srcRows : r;
        const sc = tile ? c % srcCols : c;
        if (sr >= srcRows || sc >= (src[sr] ? src[sr].length : 0)) continue;
        if (!src[sr][sc]) continue;
        this.painted.add(`${r},${c}`);
        count++;
      }
    }
    this.render();
    return count;
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
      // Back the buffer with devicePixelRatio device pixels while the pan/zoom view
      // keeps working in CSS pixels (render sets a base dpr transform, the helpers
      // divide by it), so HiDPI screens get a crisp schematic and pointer→cell
      // mapping — which reads CSS px from getBoundingClientRect — still lines up.
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      this.dpr = dpr;
      this.canvas.width = Math.round(parent.clientWidth * dpr);
      this.canvas.height = Math.round(parent.clientHeight * dpr);
      this.centerView();
      this.render();
    }
  }

  centerView() {
    this.panX = this.canvas.width / (this.dpr || 1) / 2;
    this.panY = this.canvas.height / (this.dpr || 1) * 0.82;
  }

  render() {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;

    // Dark atelier CAD background
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, w, h);

    const g = this.computeGrid();
    const pts = g.outline;

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, -this.zoom); // Invert Y so up is positive mm

    const halfWidthMm = g.geo.widthMm / 2;
    const totalHeightMm = g.geo.heightMm;

    // 1. Garment body fill (drawn first so the stitch grid sits on top of it)
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
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
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.closePath();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.0 / this.zoom;
    ctx.stroke();

    // 5. Hem ribbing divider (only the tank block tracks an exact rib height).
    if (!this.garment) {
      const ribbingYMm = this.engine.params.ribbingHeightCm * 10;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.2 / this.zoom;
      ctx.setLineDash([4 / this.zoom, 4 / this.zoom]);
      ctx.beginPath();
      ctx.moveTo(-halfWidthMm, ribbingYMm);
      ctx.lineTo(halfWidthMm, ribbingYMm);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 6. Center grain line
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.0 / this.zoom;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(0, totalHeightMm - 10);
    ctx.stroke();

    ctx.restore();

    // 7. On-screen CAD dimension overlays (screen space)
    this.renderDimensionOverlays(ctx, g);
  }

  renderDimensionOverlays(ctx, g) {
    const geo = g.geo;
    const plan = this.plan;
    const p = this.engine.params;
    const gauge = plan ? plan.gauge : this.engine.gauge;
    const title = plan ? plan.garment.name : "Benji's Tank Top Shaping Specifications";

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const cardW = 340;
    const cardH = 168;
    ctx.beginPath();
    ctx.roundRect(20, 20, cardW, cardH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px -apple-system, sans-serif';
    ctx.fillText(title, 35, 42);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    ctx.fillText(`Gauge (your yarn):    ${gauge.stitchesPer10Cm.toFixed?.(1) ?? gauge.stitchesPer10Cm} sts × ${gauge.rowsPer10Cm.toFixed?.(1) ?? gauge.rowsPer10Cm} rows / 10cm`, 35, 62);
    ctx.fillText(`Grid:                 ${g.cols} sts × ${g.rows} rows`, 35, 80);
    ctx.fillText(`Outline:              ${geo.widthMm.toFixed(0)} × ${geo.heightMm.toFixed(0)} mm`, 35, 98);
    if (plan && plan.garment.structure === 'tank') {
      ctx.fillText(`Chest Circumference:  ${p.chestCircumferenceCm} cm (Ease: +${p.easeCm} cm)`, 35, 116);
    }
    ctx.fillText(`Symmetry mirror:      ${this.symmetry ? 'ON (left/right)' : 'off'}`, 35, 134);
    ctx.fillText(`Stitches drawn:       ${this.painted.size}`, 35, 152);
  }
}
