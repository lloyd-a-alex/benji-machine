/**
 * KNITCAT — Chart-aware yarn consumption (pure, DOM-free, testable).
 *
 * The production quote has always split a garment's yarn between the colours by their *visible
 * cell share* on the chart — the more of a colour you can see, the more of it you buy. For a plain
 * or single-colour fabric that is exactly right. For stranded colourwork it is materially wrong:
 * in fair isle the carriage lays BOTH colours on essentially every needle of every row — one
 * knits a loop at the front, the other is *carried behind as a float* even where it shows nothing.
 * A minority colour dotted across a dominant ground therefore consumes far more yarn than its
 * 20%-of-the-pixels share suggests, and a knitter following that quote runs out of contrast yarn.
 *
 * This module turns the flat cell count into a **yarn-path weight**: the length of strand each
 * colour physically travels, measured off the actual chart. It reuses the same run/density
 * vocabulary as `js/core/chart-analysis.js` so the browser's machine-fit verdict, the feasibility
 * advisor and the cost engine all read the same geometry.
 *
 * Model (dimensionless, in "loop" units — one knit loop ≈ 2 stitch-widths + 1 row-height of yarn):
 *   • a cell a colour *knits*            → 1.00 loop  (LOOP_WEIGHT)
 *   • a cell a colour *carries a float*  → 0.34 loop  (FLOAT_WEIGHT ≈ one stitch pitch behind)
 *   • lace / slip / tuck (single-bed)    → 1.00 loop per cell, no carry → density factor 1, so
 *                                           their numbers are unchanged by this module by design.
 *   • fair isle with N distinct colours  → every row lays `1 + (N-1)·FLOAT` per cell, so total
 *                                           yarn rises above the flat-area estimate and the split
 *                                           re-weights toward the carried colour.
 *
 * `analyzeYarnConsumption` never throws and never mutates: feed it a malformed chart and you get a
 * neutral `{ densityFactor: 1, shares: {} }` back, which the caller treats as "use the old model".
 *
 * @module core/yarn-consumption
 */

import { colorCellCounts } from './chart-analysis.js';
import { logger } from './logging.js';

const log = logger('core/yarn-consumption');

// Colour counting is one primitive shared with `analyzeChart` (see `core/chart-analysis.js`), so
// "how many colours is this card" is counted identically by the machine-fit gate and the yarn model.
// Re-exported here so consumers of the yarn estimator reach it from the obvious place.
export { colorCellCounts };

/** A stitch a colour actually knits: one full loop of yarn drawn through. */
export const LOOP_WEIGHT = 1;
/**
 * A cell a colour is *carried* across without knitting. The strand runs roughly straight behind
 * the needle beds — about one stitch-width per cell — whereas a knit loop wraps two widths plus a
 * row. That ratio (≈ 1 / 3) is the extra, invisible yarn a float eats. Tuned so a balanced 2-colour
 * fair-isle field lands around a ~1.3× uplift on the flat-area estimate, matching shop rules of
 * thumb for stranded yardage.
 */
export const FLOAT_WEIGHT = 0.34;

/**
 * Analyse a chart's yarn demand: a density factor (how much more or less yarn the fabric actually
 * uses versus a flat one-loop-per-cell area estimate) and a per-colour share of that yarn based on
 * the real path each colour travels, not just the pixels it shows.
 *
 * Only stranded fair isle grows a density factor; every other mode keeps `densityFactor: 1` and a
 * proportional cell-share split, so adopting this module is a no-op for lace, slip and tuck.
 *
 * @param {Array<Array<*>>} matrix  the chart (row 0 = cast-on edge)
 * @param {string} [mode='fair_isle']
 * @returns {{mode:string, cells:number, colors:number, densityFactor:number, shares:Map<number,number>, counts:Map<number,number>}}
 */
export function analyzeYarnConsumption(matrix, mode = 'fair_isle') {
  const { counts, cells } = colorCellCounts(matrix, mode);
  const colors = counts.size;

  // Nothing to reason about (empty or a degenerate one-cell-wide read): stay neutral.
  if (!cells || colors === 0) {
    // A caller who passed a matrix with rows but got no cells back means the chart
    // was malformed — the neutral model is a silent downgrade, so note it.
    if (Array.isArray(matrix) && matrix.length) log.debug('yarn consumption saw rows but no countable cells — returning the neutral model', { rows: matrix.length, mode });
    return { mode, cells: 0, colors: 0, densityFactor: 1, shares: new Map(), counts };
  }

  // Fair isle is the only mode where a colour is carried across cells it does not knit. Both every
  // other mode and a single-colour fair-isle field (one colour, nothing to carry) collapse to the
  // flat model: one loop per cell, split by visible share.
  const stranded = mode === 'fair_isle' && colors >= 2;
  const shares = new Map();

  if (!stranded) {
    for (const [idx, n] of counts) shares.set(idx, n / cells);
    return { mode, cells, colors, densityFactor: 1, shares, counts };
  }

  // Stranded: each colour knits its own cells at a full loop, and floats behind every other cell.
  // weight(c) = count(c)·LOOP + (cells - count(c))·FLOAT. Sum = cells·(1 + (N-1)·FLOAT), so the
  // density factor is exactly that per-cell uplift and the shares normalise to 1 by construction.
  let totalWeight = 0;
  const weights = new Map();
  for (const [idx, n] of counts) {
    const w = n * LOOP_WEIGHT + (cells - n) * FLOAT_WEIGHT;
    weights.set(idx, w);
    totalWeight += w;
  }
  for (const [idx, w] of weights) shares.set(idx, totalWeight > 0 ? w / totalWeight : 0);
  const densityFactor = totalWeight / cells;

  return { mode, cells, colors, densityFactor, shares, counts };
}
