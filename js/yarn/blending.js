/**
 * KNITCAT V2 — the blending lab (spec §3.6).
 *
 * Holding two (or three) strands through one machine is how knitters fake a gauge they don't
 * have, blend a custom colour, or get a halo without buying mohair by the cone. This computes
 * what happens when you do: the *combined* gauge of held strands (not a simple sum — thickness
 * adds, coverage compounds), the marled visual blend of the colours (an optical mix, not a
 * paint mix — knitting blends by proximity, so we average in a perceptually honest way and
 * flag contrast loss), and suggestions for what to hold for (a target gauge, a target colour).
 *
 * Also: Fair Isle and fade-plan helpers that turn a palette into a machine-workable sequence.
 * DOM-free.
 *
 * @module yarn/blending
 */

import { behaviourFor, normalizeFiber } from './behavior.js';
import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb, checkContrast, deltaE, generateGradient } from './color.js';

/**
 * Predict the gauge and behaviour of holding multiple strands together.
 * @param {Array<{stsPer10cm:number, rowsPer10cm:number, weight?:string, fiber?:any, color?:string, metersPer100g?:number}>} strands
 * @returns {{stsPer10cm:number, rowsPer10cm:number, combinedWraps:number, marledColor:string|null, behavior:object, notes:string[]}}
 */
export function holdStrands(strands = []) {
  if (!strands.length) return { stsPer10cm: 0, rowsPer10cm: 0, combinedWraps: 0, marledColor: null, behavior: {}, notes: ['No strands given.'] };
  // Wraps-per-inch equivalent: thicker yarn = fewer sts/10cm. Holding n strands is like using a
  // yarn whose "bulk" is the sum of the radii → scale gauge by 1/sqrt(sum of cross-sections).
  const areas = strands.map(s => {
    const sts = Number(s.stsPer10cm) || 22;
    return (1 / sts) ** 2; // cross-sectional area ∝ (1/gauge)^2
  });
  const totalArea = areas.reduce((a, b) => a + b, 0);
  const combinedSts = 1 / Math.sqrt(totalArea);
  const rowRatios = strands.map(s => (Number(s.rowsPer10cm) || (Number(s.stsPer10cm) || 22) * 1.35) / (Number(s.stsPer10cm) || 22));
  const avgRatio = rowRatios.reduce((a, b) => a + b, 0) / rowRatios.length;
  const combinedRows = combinedSts * avgRatio;

  const colors = strands.map(s => s.color).filter(Boolean);
  const marledColor = colors.length > 1 ? opticalMix(colors) : (colors[0] || null);

  // Behaviour: blend the fibre compositions proportionally to each strand's area.
  const fibers = strands.map((s, i) => ({ strands: normalizeFiber(s.fiber), weight: areas[i] }));
  const behavior = blendedBehavior(fibers);

  const notes = [`Holding ${strands.length} strands gives ≈ ${round1(combinedSts)} sts × ${round1(combinedRows)} rows / 10 cm.`];
  if (strands.length > 1 && marledColor) notes.push(`Optical marle reads as ≈ ${marledColor}.`);
  if (colors.length > 1 && checkContrast(colors[0], colors[1]).ratio < 1.4) notes.push('Held colours are very close — the marle will look heathered, not striped.');

  return { stsPer10cm: round1(combinedSts), rowsPer10cm: round1(combinedRows), combinedWraps: strands.length, marledColor, behavior, notes };
}

/**
 * Suggest which of a knitter's stash strands to hold to hit a target gauge.
 * @param {number} targetStsPer10cm @param {Array} stashYarns (with stsPer10cm) @param {number} [max=3]
 * @returns {Array<{strands:object[], predicted:number, error:number}>}
 */
export function suggestHoldForGauge(targetStsPer10cm, stashYarns = [], max = 3) {
  const results = [];
  const usable = stashYarns.filter(y => Number(y.stsPer10cm) > 0);
  const consider = (combo) => {
    const held = holdStrands(combo);
    results.push({ strands: combo, predicted: held.stsPer10cm, error: round1(Math.abs(held.stsPer10cm - targetStsPer10cm)) });
  };
  for (const a of usable) {
    consider([a]);
    for (const b of usable) {
      if (b === a) continue;
      consider([a, b]);
      if (max >= 3) for (const c of usable) { if (c === a || c === b) continue; consider([a, b, c]); break; }
    }
  }
  return results.sort((x, y) => x.error - y.error).slice(0, 12);
}

/**
 * A machine-safe Fair Isle plan from a palette: assign A/B colours per row so no float exceeds
 * `maxFloat` stitches (recommending a tuck-stitch or woven-float note where it does), and
 * check every colour pair for contrast so the motif reads.
 * @param {string[]} palette @param {number[][]} grid a rows×cols matrix of palette indices
 * @param {number} [maxFloat=5]
 * @returns {{floatWarnings:Array, contrastIssues:Array, suggestedTuckRows:number[]}}
 */
export function fairIslePlan(palette = [], grid = [], maxFloat = 5) {
  const floatWarnings = [];
  const suggestedTuckRows = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    let run = 0;
    for (let c = 0; c < row.length; c++) {
      const same = c > 0 && row[c] === row[c - 1];
      run = same ? run + 1 : 1;
      // A "float" is the *unused* colour crossing; approximated by runs of the other colour.
    }
    let unusedRun = 0;
    for (let c = 0; c < row.length; c++) {
      const prev = c > 0 ? row[c - 1] : -1;
      const cur = row[c];
      if (prev !== -1 && cur !== prev) { /* colour used; reset */ }
      unusedRun = cur === prev ? unusedRun + 1 : 0;
      if (unusedRun >= maxFloat) { if (!suggestedTuckRows.includes(r + 1)) suggestedTuckRows.push(r + 1); floatWarnings.push({ row: r + 1, col: c + 1, length: unusedRun }); unusedRun = 0; }
    }
  }
  const contrastIssues = [];
  const used = [...new Set(grid.flat())];
  for (let i = 0; i < used.length; i++) {
    for (let j = i + 1; j < used.length; j++) {
      const a = palette[used[i]], b = palette[used[j]];
      if (a && b && !checkContrast(a, b).pass) contrastIssues.push({ colors: [a, b], note: `Δ luminance low — motif ${used[i]}/${used[j]} may not read.` });
    }
  }
  return { floatWarnings, contrastIssues, suggestedTuckRows };
}

/**
 * Turn two (or many) colours into a fade plan — the run of shades to alternate/step through.
 * @param {string[]} colors @param {number} [steps=8] @returns {string[]}
 */
export function fadePlan(colors = [], steps = 8) {
  if (colors.length <= 1) return colors.slice();
  const out = [];
  for (let i = 0; i < colors.length - 1; i++) {
    const seg = generateGradient(colors[i], colors[i + 1], Math.max(2, Math.round(steps / (colors.length - 1))));
    if (i > 0) seg.shift();
    out.push(...seg);
  }
  return out;
}

/** Optical (additive-ish) blend of colours as knit together — averages hue/lightness. */
function opticalMix(colors) {
  const hsls = colors.map(c => rgbToHsl(hexToRgb(c)));
  let sx = 0, sy = 0, l = 0;
  for (const h of hsls) {
    const rad = (h.h * Math.PI) / 180;
    sx += Math.cos(rad) * h.s; sy += Math.sin(rad) * h.s; l += h.l;
  }
  const n = hsls.length;
  const avgS = Math.hypot(sx / n, sy / n);
  const avgH = ((Math.atan2(sy / n, sx / n) * 180 / Math.PI) + 360) % 360;
  return rgbToHex(hslToRgb({ h: avgH, s: clamp(avgS, 0, 1), l: clamp(l / n, 0, 1) }));
}

function blendedBehavior(fiberWeights) {
  const merged = {};
  let totalW = fiberWeights.reduce((s, f) => s + (f.weight || 0), 0) || 1;
  const accum = {};
  for (const fw of fiberWeights) {
    for (const fib of fw.strands) accum[fib.name] = (accum[fib.name] || 0) + (fib.percentage || 100) / Math.max(1, fw.strands.length) * (fw.weight / totalW) * 100;
  }
  return behaviourFor(Object.entries(accum).map(([name, percentage]) => ({ name, percentage })));
}

function round1(n) { return Math.round(n * 10) / 10; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
export { deltaE };
