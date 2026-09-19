/**
 * Pattern modes, and what a cell means in each of them.
 *
 * The rules used to live as a static method on the canvas editor, which meant
 * anything that wanted to convert a *region* rather than the whole card — the
 * clipboard, a pasted Fair Isle block dropped into a lace chart, an export, a
 * test — had to import a DOM-touching class to ask. So the semantics live here,
 * dependency-free, and `CanvasEditor` keeps a thin delegating method.
 *
 * Two families of mode:
 *
 *   - `lace` stores Japanese-style symbols (`'K'`, `'O'`, `'TL'`, …) because a
 *     lace chart has to say *which* operation each needle performs;
 *   - `fair_isle`, `tuck` and `slip` store `0`/`1` because those carriages only
 *     ask whether a needle is in work for this pass.
 *
 * Crossing between the families is lossy in one direction and that is fine and
 * documented: symbol → punched keeps the information ("is this needle doing
 * something?"), punched → symbol has to guess *what*, and defaults to an eyelet
 * because that is the mark a knitter most often means when they punch a hole in a
 * lace card.
 */

import { STITCH_TYPE } from '../math/knit-topology.js';

export const PATTERN_MODES = ['lace', 'fair_isle', 'tuck', 'slip'];

/** Lace cells that leave the needle knitting plainly: the "nothing here" values. */
export const LACE_BLANKS = [STITCH_TYPE.KNIT, STITCH_TYPE.EMPTY, STITCH_TYPE.PURL];

export function isDirectMode(mode) {
  return mode === 'fair_isle' || mode === 'tuck' || mode === 'slip';
}

export function isLaceMode(mode) {
  return mode === 'lace';
}

export function isKnownMode(mode) {
  return PATTERN_MODES.includes(mode);
}

/** The value a cell holds when nothing is worked there. */
export function blankValue(mode) {
  return isLaceMode(mode) ? STITCH_TYPE.KNIT : 0;
}

/** Does this cell mean "active" for the compiler and the ruler? */
export function isPunched(mode, value) {
  if (isLaceMode(mode)) return !LACE_BLANKS.includes(value);
  return value === 1 || value === true;
}

export function normalizeCell(mode, value) {
  if (isLaceMode(mode)) {
    return Object.values(STITCH_TYPE).includes(value) ? value : STITCH_TYPE.KNIT;
  }
  return isPunched(mode, value) ? 1 : 0;
}

/**
 * Convert a whole matrix when the mode changes. `from`/`to` may be the same, in
 * which case the matrix is only cleaned (a stray `'K'` in a Fair Isle card).
 */
export function convertMatrixBetweenModes(from, to, matrix) {
  const out = new Array(matrix.length);
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const cells = new Array(row.length);
    for (let c = 0; c < row.length; c++) cells[c] = convertCellBetweenModes(from, to, row[c]);
    out[r] = cells;
  }
  return out;
}

export function convertCellBetweenModes(from, to, value) {
  const fromDirect = isDirectMode(from);
  const toDirect = isDirectMode(to);
  if (fromDirect === toDirect) {
    // Within one family the representation already agrees; only tidy it.
    return toDirect ? (isPunched(to, value) ? 1 : 0) : normalizeCell('lace', value);
  }
  if (!fromDirect && toDirect) return isPunched(from, value) ? 1 : 0;
  // Direct → lace. The hole has to become *some* symbol, and the symbol must be a
  // symbol: leaving a numeric 1 in a lace matrix is exactly the desync that made
  // the compiler read a punched card out of a chart that no longer is one.
  return isPunched(from, value) ? STITCH_TYPE.EYELET : STITCH_TYPE.KNIT;
}

/**
 * Convert a rectangular region in place, leaving the rest of the card alone.
 *
 * This is the difference between "switch modes" and "convert what I selected":
 * a knitter with a lace repeat inside a Fair Isle yoke needs the second one, and
 * it is also how a Fair Isle block pasted into a lace chart becomes real lace
 * primitives instead of a field of `'K'`.
 */
export function convertRegionBetweenModes(matrix, { r1, r2, c1, c2 }, from, to) {
  const out = matrix.map(row => [...row]);
  let changed = 0;
  for (let r = Math.max(0, r1); r <= Math.min(out.length - 1, r2); r++) {
    for (let c = Math.max(0, c1); c <= Math.min(out[r].length - 1, c2); c++) {
      const next = convertCellBetweenModes(from, to, out[r][c]);
      if (next !== out[r][c]) changed++;
      out[r][c] = next;
    }
  }
  return { matrix: out, changed };
}

/** Short human label for a cell value, for the inspector and the schedule. */
export function describeCellValue(mode, value) {
  if (isDirectMode(mode)) return value === 1 ? 'punched (yarn B)' : 'blank (yarn A)';
  return LACE_BLANKS.includes(value) ? `plain (${value})` : `worked (${value})`;
}
