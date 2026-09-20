/**
 * KNITCAT — yarn consumption estimate (browser-free).
 *
 * Generalises the ad-hoc tank-top estimator into one shared tool: given a plan and
 * a measured gauge, estimate the yardage across all its parts, and (optionally) the
 * weight once you tell it your yarn's metres-per-gram. It is a topology estimate,
 * not a promise — a knit loop wraps roughly two stitch-widths plus one row-height
 * of yarn — so the number is honest about being an approximation you swatch against.
 *
 * @module tailor/yarn-estimate
 */

const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

/**
 * @param {object} plan   ClothesEngine plan (reads parts[].castOn / .rows)
 * @param {object} gauge  { stitchesPer10Cm, rowsPer10Cm }
 * @param {object} [opts] { gramsPerMeter } — a yarn's meterage density
 * @returns {{meters:number, grams:number|null, totalStitches:number}}
 */
export function estimateYarn(plan, gauge = {}, opts = {}) {
  const stsPer10 = finite(gauge.stitchesPer10Cm ?? plan?.gauge?.stitchesPer10Cm, 0);
  const rowsPer10 = finite(gauge.rowsPer10Cm ?? plan?.gauge?.rowsPer10Cm, 0);
  if (stsPer10 <= 0 || rowsPer10 <= 0 || !plan?.parts?.length) {
    return { meters: 0, grams: null, totalStitches: 0 };
  }
  const cellW = 100 / stsPer10;   // mm width of one stitch
  const cellH = 100 / rowsPer10;  // mm height of one row
  const perLoopMm = 2 * cellW + cellH; // a knit loop wraps ~2 widths + 1 row

  let totalStitches = 0;
  for (const part of plan.parts) {
    totalStitches += finite(part.castOn, 0) * finite(part.rows, 0) * 0.9; // ~10% off for shaping
  }
  const meters = (totalStitches * perLoopMm) / 1000;
  const gpm = finite(opts.gramsPerMeter, 0);
  const grams = gpm > 0 ? meters * gpm : null;
  return { meters, grams, totalStitches };
}
