/**
 * KNITCAT — shared punchcard geometry for the physical-card importers.
 *
 * The DXF and G-code readers both end up holding a cloud of hole centres in
 * millimetres and needing a 0/1 grid out of them. That is the same job twice, so it
 * lives here once: pick a pitch (from the machine profile when we have one, from the
 * data when we do not), snap every centre to the nearest lattice point, and lay the
 * holes into a rectangular matrix anchored at the sparsest corner.
 *
 * DOM-free and side-effect-free — `node --test` can drive the whole thing with an
 * array of `{x, y}` points and no browser.
 *
 * @module importers/grid-quantize
 */

import { logger } from '../core/logging.js';

/** Shared geometry seam: log the snap decisions that silently drop or trim holes. */
const log = logger('importers/grid-quantize');

/** Hard ceilings so a pathological file cannot allocate a continent-sized grid. */
export const MAX_GRID_ROWS = 4000;
export const MAX_GRID_COLS = 4000;
export const MAX_GRID_CELLS = 400000;

/**
 * Estimate the spacing of a set of coordinates from the smallest meaningful gap
 * between consecutive unique values. A punchcard grid is evenly spaced, so the mode
 * of the small gaps is the pitch; taking the *smallest* gap instead would latch onto
 * two holes that happen to sit a hair apart and shatter the lattice into noise.
 * @param {number[]} values
 * @returns {number} estimated pitch, or 0 when there is nothing to measure
 */
export function estimatePitch(values) {
  const uniq = [...new Set(values.filter(v => Number.isFinite(v)))].sort((a, b) => a - b);
  if (uniq.length < 2) return 0;
  const gaps = [];
  for (let i = 1; i < uniq.length; i++) {
    const g = uniq[i] - uniq[i - 1];
    if (g > 1e-6) gaps.push(g);
  }
  if (!gaps.length) return 0;
  // The modal gap, tie-broken toward the smaller value: for a regular grid every
  // expected gap is the pitch, so the most common spacing *is* the pitch.
  const counts = new Map();
  for (const g of gaps) {
    const key = Math.round(g * 1000) / 1000;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = Infinity;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Turn a list of `{x, y}` hole centres into a 0/1 punchcard matrix.
 *
 * Origin is the minimum x / minimum y of the cloud (not the machine's absolute zero),
 * because the import should describe the *pattern* regardless of where on the bed it
 * was laid out. Rows run with increasing y first (row 0 at the top, like every other
 * KNITCAT chart); columns with increasing x.
 *
 * @param {Array<{x:number,y:number}>} holes
 * @param {{pitchX?:number, pitchY?:number, maxCells?:number}} [opts]
 * @returns {{ok:boolean, matrix?:number[][], rows?:number, cols?:number, warnings?:string[], error?:string}}
 */
export function holesToMatrix(holes, { pitchX, pitchY, maxCells = MAX_GRID_CELLS } = {}) {
  const clean = (Array.isArray(holes) ? holes : []).filter(
    h => h && Number.isFinite(h.x) && Number.isFinite(h.y)
  );
  if (!clean.length) { log.warn('holesToMatrix got no usable hole centres'); return { ok: false, error: 'No punch holes were found to import.' }; }

  const xs = clean.map(h => h.x);
  const ys = clean.map(h => h.y);
  // A linear scan, NOT `Math.min(...xs)`: a fine punchcard photographed at a few
  // megapixels yields a hundred-thousand-plus hole centres, and spreading an array
  // that large across a function's arguments blows the JS engine's argument stack
  // (RangeError). The loop is O(n) and cannot overflow.
  let x0 = Infinity;
  let y0 = Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < x0) x0 = xs[i];
    if (ys[i] < y0) y0 = ys[i];
  }
  const fx = Number.isFinite(pitchX) && pitchX > 0 ? pitchX : estimatePitch(xs);
  const fy = Number.isFinite(pitchY) && pitchY > 0 ? pitchY : estimatePitch(ys);
  if (!fx || !fy) { log.warn('hole spacing could not be resolved', { pitchX, pitchY, holes: clean.length }); return { ok: false, error: 'The hole spacing could not be read from this file.' }; }

  const warnings = [];
  // Quantise by rounding to the nearest lattice index; a hole that lands far from
  // any lattice point (beyond half a pitch of the bounding span) is a measurement
  // error, not a cell, and would inflate the grid, so it is clamped and reported.
  const colOf = h => Math.round((h.x - x0) / fx);
  const rowOf = h => Math.round((h.y - y0) / fy);
  let cols = 0;
  let rows = 0;
  for (const h of clean) {
    cols = Math.max(cols, colOf(h) + 1);
    rows = Math.max(rows, rowOf(h) + 1);
  }
  if (rows > MAX_GRID_ROWS || cols > MAX_GRID_COLS) {
    log.warn('implied grid exceeds hard row/col ceilings', { rows, cols });
    return { ok: false, error: `The implied grid is ${rows}\u00d7${cols} — larger than KNITCAT can hold.` };
  }
  if (rows * cols > maxCells) {
    const scale = Math.sqrt((rows * cols) / maxCells);
    rows = Math.max(1, Math.floor(rows / scale));
    cols = Math.max(1, Math.floor(cols / scale));
    warnings.push(`A ${rows}\u00d7${cols} grid was the largest that fit the size limit; the far edge was trimmed.`);
    log.warn('grid trimmed to fit the size limit', { rows, cols, maxCells });
  }

  const matrix = [];
  for (let r = 0; r < rows; r++) matrix.push(new Array(cols).fill(0));
  let snapped = 0;
  for (const h of clean) {
    const c = colOf(h);
    const r = rowOf(h);
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      matrix[r][c] = 1;
      snapped++;
    }
  }
  if (!snapped) { log.warn('no holes snapped into the trimmed grid', { rows, cols, holes: clean.length }); return { ok: false, error: 'None of the holes lined up to a usable grid.' }; }
  const dropped = clean.length - snapped;
  if (dropped > 0) { warnings.push(`${dropped} hole${dropped === 1 ? '' : 's'} fell outside the trimmed grid and were dropped.`); log.warn(`${dropped} hole(s) fell outside the grid and were dropped`, { rows, cols }); }
  return { ok: true, matrix, rows, cols, warnings };
}
