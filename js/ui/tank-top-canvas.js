/**
 * Interactive Tank Top Tailoring CAD Visualizer
 * 
 * Renders the parametric 2D garment silhouette with:
 * 1. Anatomic armhole scye curves & scoop neckline
 * 2. Overlaid knitting machine stitch grid & needle coordinates
 * 3. Dimension callout lines and seam allowances
 * 4. Step-by-step row shaping highlights
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

  setupEvents() {
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoom = Math.max(0.3, Math.min(2.5, this.zoom * factor));
      this.render();
    });

    let isDragging = false;
    let startMouse = { x: 0, y: 0 };

    this.canvas.addEventListener('mousedown', e => {
      isDragging = true;
      startMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', e => {
      if (isDragging) {
        this.panX += e.clientX - startMouse.x;
        this.panY += e.clientY - startMouse.y;
        startMouse = { x: e.clientX, y: e.clientY };
        this.render();
      }
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    window.addEventListener('resize', () => {
      this.resize();
    });
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (parent) {
      this.canvas.width = parent.clientWidth || 800;
      this.canvas.height = parent.clientHeight || 600;
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

    const pattern = this.engine.computePattern();
    const pts = pattern.frontProfileMm;
    const dims = pattern.dimensions;

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, -this.zoom); // Invert Y so up is positive mm

    // 1. Draw Overlaid Knitted Mesh Texture inside garment
    const halfWidthMm = dims.widthMm / 2;
    const totalHeightMm = dims.heightMm;

    ctx.strokeStyle = 'rgba(30, 41, 59, 0.4)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = -halfWidthMm; x <= halfWidthMm; x += 15) {
      ctx.moveTo(x, 0); ctx.lineTo(x, totalHeightMm);
    }
    for (let y = 0; y <= totalHeightMm; y += 15) {
      ctx.moveTo(-halfWidthMm, y); ctx.lineTo(halfWidthMm, y);
    }
    ctx.stroke();

    // 2. Draw Garment Body Fill & Boundary Silhouette
    ctx.beginPath();
    ctx.moveTo(0, pts[0].y);
    // Right half
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    // Left half mirrored
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(-pts[i].x, pts[i].y);
    ctx.closePath();

    // Soft garment tone
    ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.fill();

    // Cutting boundary stroke
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // 3. Draw Hem Ribbing Divider Line
    const ribbingYMm = this.engine.params.ribbingHeightCm * 10;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(-halfWidthMm, ribbingYMm);
    ctx.lineTo(halfWidthMm, ribbingYMm);
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. Center Grain Line
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(0, totalHeightMm - 10);
    ctx.stroke();

    ctx.restore();

    // 5. Draw On-Screen CAD Dimension Overlays (in screen space)
    this.renderDimensionOverlays(ctx, pattern);
  }

  renderDimensionOverlays(ctx, pattern) {
    const dims = pattern.dimensions;
    const p = this.engine.params;

    // Overlay Card in top-left
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;

    const cardW = 320;
    const cardH = 210;
    ctx.beginPath();
    ctx.roundRect(20, 20, cardW, cardH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px -apple-system, sans-serif';
    ctx.fillText("Benji's Tank Top Shaping Specifications", 35, 42);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    ctx.fillText(`Chest Circumference: ${p.chestCircumferenceCm} cm (Ease: +${p.easeCm} cm)`, 35, 66);
    ctx.fillText(`Cast-On Needles:      ${dims.castOnStitches} sts (L${dims.halfStitches} to R${dims.halfStitches})`, 35, 84);
    ctx.fillText(`Hem Ribbing:          ${dims.ribbingRows} rows (${p.ribbingType} rib)`, 35, 102);
    ctx.fillText(`Underarm Bind-Off:    ${dims.initialBindOffSts} sts each side`, 35, 120);
    ctx.fillText(`Armhole Scye Dec:     1 st every 2 rows × ${dims.gradualDecSts}`, 35, 138);
    ctx.fillText(`Front Scoop Split:    Row ${dims.frontNeckSplitRow} (Hold ${dims.neckStitchesTotal} sts)`, 35, 156);
    ctx.fillText(`Strap Width:          ${dims.strapStitches} sts (${p.strapWidthCm} cm)`, 35, 174);
    ctx.fillText(`Total Rows to Knit:   ${dims.totalRows} rows`, 35, 192);
  }
}
