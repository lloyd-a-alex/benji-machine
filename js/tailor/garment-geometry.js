/**
 * KNITCAT — generalized garment geometry.
 *
 * The tank-top CAD engine was the best thing in the tailor: it turned a set of
 * measurements into a *continuous* 2D cutting outline (a clothoid armhole scye and
 * an elliptical scoop neck), not a boxy rectangle. But only the tank top got that
 * treatment — every other garment in the catalogue fell back to a crude rect.
 *
 * This module lifts that machinery out of the tank top and applies it to *every*
 * structure, so a hat, a sock, a shawl and a sweater are all described by the same
 * kind of precise outline the tank top had. It is browser-free and pure: given a
 * structure plus its millimetre dimensions it returns a closed polygon the preview
 * canvas, the DXF exporter and the print-SVG all consume.
 *
 * Every returned outline is expressed in absolute millimetres, centred on x = 0,
 * with y running from 0 (cast-on hem) up to heightMm (shoulder / crown). Round
 * garments are laid flat, so the outline width equals the flattened circumference
 * and the stitch grid maps one cell to one needle.
 *
 * @module tailor/garment-geometry
 */

import { TankTopTailoringEngine } from './tank-top-engine.js';

const finite = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

/**
 * Sample an ellipse arc into `steps` points (endpoints included).
 * centre (cx,cy), radii (rx,ry), angles a0..a1 (radians).
 */
function arc(cx, cy, rx, ry, a0, a1, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + (a1 - a0) * t;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}

/** A rectangle centred on x = 0, spanning y 0..heightMm. */
function rectOutline(hw, heightMm) {
  return [
    { x: -hw, y: 0 }, { x: hw, y: 0 },
    { x: hw, y: heightMm }, { x: -hw, y: heightMm }
  ];
}

/** Straight sides that close under a half-elliptical dome (hats, rounded caps). */
function domeOutline(hw, heightMm, bodyTopY) {
  const out = [{ x: -hw, y: 0 }, { x: hw, y: 0 }, { x: hw, y: bodyTopY }];
  const dome = arc(0, bodyTopY, hw, heightMm - bodyTopY, 0, Math.PI, 16);
  for (let i = 1; i < dome.length - 1; i++) out.push(dome[i]);
  out.push({ x: -hw, y: bodyTopY });
  return out;
}

/**
 * A seamed body / tank silhouette: chest straight to the underarm, a clothoid-ish
 * scye up to a narrowed shoulder, then an elliptical neck scoop to centre front.
 * Built as a right half then mirrored, exactly like the tank engine did.
 */
function bodyOutline(hw, heightMm, opts = {}) {
  const underarmY = heightMm * finite(opts.underarmFrac, 0.62);
  const shoulderHalf = hw * finite(opts.shoulderFrac, 0.8);
  const neckHalf = hw * finite(opts.neckFrac, 0.3);
  const neckDrop = heightMm * finite(opts.neckDropFrac, 0.14);

  const right = [{ x: hw, y: 0 }, { x: hw, y: underarmY }];
  // Armhole scye: quadratic bulge from underarm out to the shoulder tip.
  const cxp = hw, cyp = heightMm;
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    const x = (1 - t) * (1 - t) * hw + 2 * (1 - t) * t * cxp + t * t * shoulderHalf;
    const y = (1 - t) * (1 - t) * underarmY + 2 * (1 - t) * t * cyp + t * t * heightMm;
    right.push({ x, y });
  }
  // Shoulder seam to the neck, then the elliptical scoop down to centre front.
  right.push({ x: neckHalf, y: heightMm });
  const scoop = arc(0, heightMm, neckHalf, neckDrop, 0, Math.PI / 2, 12)
    .map(p => ({ x: p.x, y: p.y - neckDrop + neckDrop }));
  // The arc already runs (neckHalf,heightMm)→(0,heightMm-neckDrop) with centre at
  // (0,heightMm); translate is a no-op but keeps intent explicit.
  for (let i = 1; i < scoop.length; i++) right.push(scoop[i]);

  // Assemble the full closed loop: right half, then its reverse mirrored.
  const outline = [{ x: 0, y: 0 }, ...right];
  for (let i = right.length - 1; i >= 0; i--) outline.push({ x: -right[i].x, y: right[i].y });
  return outline;
}

/** Mitten: a rounded hand tube with a thumb gusset bumping out on one side. */
function handOutline(hw, heightMm) {
  const bodyHalf = hw * 0.8;
  const topY = heightMm * 0.78;
  const out = [{ x: -bodyHalf, y: 0 }, { x: bodyHalf, y: 0 }, { x: bodyHalf, y: heightMm * 0.3 }];
  // Thumb: half-ellipse from the flank out to the full half-width and back.
  const rx = hw - bodyHalf, ry = heightMm * 0.12, cy = heightMm * 0.425;
  const thumb = arc(bodyHalf, cy, rx, ry, -Math.PI / 2, Math.PI / 2, 10);
  for (let i = 1; i < thumb.length; i++) out.push(thumb[i]);
  out.push({ x: bodyHalf, y: topY });
  // Dome the fingertips.
  const dome = arc(0, topY, bodyHalf, heightMm - topY, 0, Math.PI, 12);
  for (let i = 1; i < dome.length - 1; i++) out.push(dome[i]);
  out.push({ x: -bodyHalf, y: topY });
  return out;
}

/** Sock side profile: a vertical leg that turns 90° into the foot (an L). */
function sockOutline(hw, heightMm) {
  const legHalf = hw * 0.55;
  const footTopY = heightMm * 0.32;   // ankle line
  return [
    { x: -hw * 0.9, y: heightMm },     // cuff back
    { x: legHalf * 0.7, y: heightMm },  // cuff front
    { x: legHalf * 0.7, y: footTopY },  // down the front of the leg to the ankle
    { x: hw, y: footTopY },             // across the instep to the toe
    { x: hw, y: 0 },                    // toe front (short)
    { x: -hw * 0.9, y: 0 },             // sole back to the heel
    { x: -hw * 0.9, y: footTopY }       // heel wall up
  ];
}

/** Top-down triangle shawl: wide borders along the top edge, point at the nape. */
function triangleOutline(hw, heightMm) {
  return [
    { x: 0, y: 0 },            // the point
    { x: hw, y: heightMm },    // right wing
    { x: -hw, y: heightMm }    // left wing
  ];
}

/**
 * Build the continuous outline for any structure.
 *
 * @param {string} structure  hat | tube | flat | body | hand | sock | triangle | tank
 * @param {object} spec
 *   @param {number} spec.cols        needles across (grid columns)
 *   @param {number} spec.rows        rows (grid)
 *   @param {number} [spec.cellW]     mm per stitch (default 100/stsPer10cm ≈ derived)
 *   @param {number} [spec.cellH]     mm per row
 *   @param {number} [spec.widthMm]   explicit panel width (else cols*cellW)
 *   @param {number} [spec.heightMm]  explicit panel height (else rows*cellH)
 *   @param {object} [spec.params]    tank shaping params (only used by 'tank')
 *   @param {object} [spec.gauge]     tank gauge (only used by 'tank')
 *   @param {object} [spec.shape]     optional fractions for the body silhouette
 * @returns {{structure:string,outlineMm:Array<{x:number,y:number}>,mirror:boolean,
 *            widthMm:number,heightMm:number,cols:number,rows:number,
 *            grainLineMm:{x1:number,y1:number,x2:number,y2:number}}}
 */
export function buildGeometry(structure, spec = {}) {
  const cols = Math.max(2, Math.round(finite(spec.cols, 24)));
  const rows = Math.max(2, Math.round(finite(spec.rows, 24)));

  // 'tank' delegates straight to the proven engine so its scye / scoop are exact.
  if (structure === 'tank') {
    const engine = new TankTopTailoringEngine(spec.params || {});
    if (spec.gauge) engine.setGauge(spec.gauge);
    const pattern = engine.computePattern();
    const d = pattern.dimensions;
    const pts = pattern.frontProfileMm;
    const outline = pts.map(p => ({ x: p.x, y: p.y }));
    for (let i = pts.length - 1; i >= 0; i--) outline.push({ x: -pts[i].x, y: pts[i].y });
    return {
      structure, outlineMm: sanitize(outline), mirror: false,
      widthMm: d.widthMm, heightMm: d.heightMm, cols, rows,
      grainLineMm: { x1: 0, y1: 30, x2: 0, y2: d.heightMm - 30 }
    };
  }

  const cellW = finite(spec.cellW, 4.5);
  const cellH = finite(spec.cellH, 5.0);
  const widthMm = finite(spec.widthMm, cols * cellW);
  const heightMm = finite(spec.heightMm, rows * cellH);
  const hw = widthMm / 2;

  let outline;
  switch (structure) {
    case 'hat': outline = domeOutline(hw, heightMm, heightMm * 0.6); break;
    case 'body': outline = bodyOutline(hw, heightMm, spec.shape); break;
    case 'hand': outline = handOutline(hw, heightMm); break;
    case 'sock': outline = sockOutline(hw, heightMm); break;
    case 'triangle': outline = triangleOutline(hw, heightMm); break;
    case 'tube':
    case 'flat':
    default: outline = rectOutline(hw, heightMm); break;
  }

  return {
    structure, outlineMm: sanitize(outline), mirror: false,
    widthMm, heightMm, cols, rows,
    grainLineMm: { x1: 0, y1: Math.min(20, heightMm * 0.1), x2: 0, y2: heightMm * 0.9 }
  };
}

/** Replace any non-finite coordinate with a clamped value so exports never NaN. */
function sanitize(pts) {
  return pts.map(p => ({ x: finite(p.x, 0), y: finite(p.y, 0) }));
}
