/**
 * KNITCAT — garment outline exports (browser-free).
 *
 * The tank-top engine could emit a laser-cutter DXF and a 1:1 printable SVG with a
 * seam allowance, but only for the tank top. This module takes *any* closed outline
 * in millimetres (from garment-geometry) and produces the same three artefacts for
 * every garment: a DXF for the laser / CNC bed, a seam-allowance print SVG, and a
 * plain 1:1 cut SVG. Nothing here touches the DOM.
 *
 * @module tailor/garment-export
 */

const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / (pts.length || 1), y: y / (pts.length || 1) };
}

/** Push every vertex `d` mm directly away from the centroid (a cheap offset). */
function offsetOutline(pts, d) {
  const c = centroid(pts);
  return pts.map(p => {
    const dx = p.x - c.x, dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1e-6;
    return { x: p.x + (dx / len) * d, y: p.y + (dy / len) * d };
  });
}

/**
 * Laser / CNC-ready DXF (AC1009, millimetres) of the outline.
 * CUT_LINE closed polygon + a GRAIN_LINE + a Benji signature text entity.
 *
 * @param {Array<{x:number,y:number}>} outlineMm closed polygon in mm
 * @param {object} [opts] { grainLineMm:{x1,y1,x2,y2}, heightMm }
 */
export function outlineToDxf(outlineMm, opts = {}) {
  const pts = Array.isArray(outlineMm) ? outlineMm : [];
  if (pts.length < 2) return '';
  const heightMm = finite(opts.heightMm, pts.reduce((m, p) => Math.max(m, p.y), 0));
  const grain = opts.grainLineMm || { x1: 0, y1: Math.min(30, heightMm * 0.1), x2: 0, y2: heightMm * 0.9 };

  const dxf = [];
  dxf.push('0\nSECTION', '2\nHEADER', '9\n$ACADVER', '1\nAC1009', '9\n$INSUNITS', '70\n4', '0\nENDSEC');
  dxf.push('0\nSECTION', '2\nTABLES', '0\nTABLE', '2\nLAYER', '70\n2',
    '0\nLAYER\n2\nCUT_LINE\n70\n0\n62\n1\n6\nCONTINUOUS',
    '0\nLAYER\n2\nGRAIN_LINE\n70\n0\n62\n5\n6\nCONTINUOUS',
    '0\nENDTAB', '0\nENDSEC');
  dxf.push('0\nSECTION', '2\nENTITIES');

  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    dxf.push(`0\nLINE\n8\nCUT_LINE\n10\n${p1.x.toFixed(3)}\n20\n${p1.y.toFixed(3)}\n30\n0.0\n11\n${p2.x.toFixed(3)}\n21\n${p2.y.toFixed(3)}\n31\n0.0`);
  }
  dxf.push(`0\nLINE\n8\nGRAIN_LINE\n10\n${finite(grain.x1).toFixed(3)}\n20\n${finite(grain.y1).toFixed(3)}\n30\n0.0\n11\n${finite(grain.x2).toFixed(3)}\n21\n${finite(grain.y2).toFixed(3)}\n31\n0.0`);
  dxf.push(`0\nTEXT\n8\nGRAIN_LINE\n10\n0.0\n20\n${(heightMm / 2).toFixed(3)}\n30\n0.0\n40\n6.0\n1\nmade for Benji`);

  dxf.push('0\nENDSEC', '0\nEOF');
  return dxf.join('\n');
}

/**
 * Printable vector SVG of the outline at 1:1, with an optional seam allowance.
 *
 * @param {Array<{x:number,y:number}>} outlineMm closed polygon in mm
 * @param {object} opts { widthMm, heightMm, seamAllowance, title, castOn, rows, gauge }
 */
export function outlineToSvg(outlineMm, opts = {}) {
  const pts = Array.isArray(outlineMm) ? outlineMm : [];
  if (pts.length < 2) return '';
  const seam = finite(opts.seamAllowance, 10);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const widthMm = finite(opts.widthMm, Math.max(...xs) - Math.min(...xs));
  const heightMm = finite(opts.heightMm, Math.max(...ys) - Math.min(...ys));
  const m = seam + 20;
  const w = widthMm + m * 2;
  const h = heightMm + m * 2;
  const cx = w / 2;
  const toX = x => cx + x;
  const toY = y => (h - m) - y; // flip so y grows upward from the hem

  const pathOf = list => list.map((p, i) => `${i ? 'L' : 'M'} ${toX(p.x).toFixed(2)} ${toY(p.y).toFixed(2)}`).join(' ') + ' Z';

  const svg = [];
  svg.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${(w / 10).toFixed(1)}cm" height="${(h / 10).toFixed(1)}cm" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}">`);
  svg.push(`<style>
    .cut-edge { fill: none; stroke: #e11d48; stroke-width: 0.8; stroke-linecap: round; }
    .seam-line { fill: none; stroke: #0284c7; stroke-width: 0.5; stroke-dasharray: 2, 2; }
    .grain-line { stroke: #0f172a; stroke-width: 0.6; marker-end: url(#arrow); }
    .text-label { font-family: -apple-system, monospace; font-size: 5px; fill: #0f172a; font-weight: bold; }
  </style>`);
  svg.push(`<defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#0f172a" />
    </marker>
  </defs>`);

  if (seam > 0) svg.push(`<path class="seam-line" d="${pathOf(offsetOutline(pts, -seam))}" />`);
  svg.push(`<path class="cut-edge" d="${pathOf(pts)}" />`);
  svg.push(`<line class="grain-line" x1="${cx}" y1="${h - m - 10}" x2="${cx}" y2="${m + 10}"/>`);
  svg.push(`<text class="text-label" x="${cx + 5}" y="${h / 2}">${(opts.title || 'PATTERN').toUpperCase()} — 1:1</text>`);
  if (opts.castOn != null) svg.push(`<text class="text-label" x="${cx + 5}" y="${h / 2 + 8}">CAST ON: ${opts.castOn} STS</text>`);
  if (opts.rows != null) svg.push(`<text class="text-label" x="${cx + 5}" y="${h / 2 + 15}">ROWS: ${opts.rows}</text>`);
  svg.push(`<text class="text-label" x="${cx + 5}" y="${h / 2 + 22}">${opts.gauge || ''} · made for Benji ♥</text>`);
  svg.push(`</svg>`);
  return svg.join('\n');
}
