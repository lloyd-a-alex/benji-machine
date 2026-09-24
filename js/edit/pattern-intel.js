/**
 * KNITCAT — Pattern Intelligence.
 *
 * `js/edit/chart-ops.js` is *surgery*: it inserts, deletes, swaps and rotates rows
 * and needle columns, and it transforms the whole card rigidly. Those are the verbs
 * a knitter reaches for while building a shape by hand. This module is the other
 * half of the toolkit — the verbs for *understanding and normalising a design you
 * already have*: crop the empty bed away, find the smallest true repeat, mirror one
 * half onto the other to make a symmetric chart, clean speckle off a scanned punch
 * card, frame a card for handling, offset it into a brick (half-drop) repeat, and
 * measure how dense the stitching actually is.
 *
 * Everything is pure and DOM-free — take a matrix, return a *new* matrix (or a plain
 * report object) — for exactly the reasons stated at the top of chart-ops: the undo
 * tree stores matrices by value, and a knitter must be able to trust these with a
 * pattern they have already drawn, asserted here in `node --test` without a browser.
 *
 * A few conventions shared across the file:
 *
 *   - Modifying operations return `{ ok, matrix, … }`; on refusal they return
 *     `{ ok: false, error | oversize }` and leave nothing to apply. The UI layer
 *     (`js/ui/chart-commands.js`) turns `oversize` into a refusal that names the
 *     machine, exactly as it does for chart-ops, so the physics of a needle bed stay
 *     out of this algebra.
 *   - Read-only analysis returns a plain data object and never a matrix.
 *   - Cells are judged "worked" or "blank" through {@link isPunched} so a lace card
 *     of symbols and a Fair Isle card of `0`/`1` are handled by the same code.
 *   - Ragged input (a card that has been spliced) is squared to the widest row and
 *     padded with the mode's blank before any geometry is trusted.
 *   - Where a horizontal mirror would swap the handedness of a lace transfer, the
 *     reflected value is corrected with {@link mirrorValue}, the same guard the rigid
 *     flips use — otherwise a "symmetric" lace chart would pull sideways at the bed.
 *
 * @module edit/pattern-intel
 */

import { blankValue, isPunched, isLaceMode } from './modes.js';
import { STITCH_TYPE } from '../math/knit-topology.js';
import { matrixInfo, mirrorValue } from './chart-ops.js';

// ─── shared helpers ──────────────────────────────────────────────────────────

/** Read a cell, returning the mode's blank for out-of-range or ragged-short rows. */
export function cellAt(matrix, r, c, blank) {
  const row = matrix[r];
  return row && c < row.length ? row[c] : blank;
}

/** A rectangular copy of `matrix` at the widest row, short cells filled with blank. */
export function square(matrix, mode) {
  const blank = blankValue(mode);
  const { rows, cols } = matrixInfo(matrix);
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = cellAt(matrix, r, c, blank);
    out[r] = row;
  }
  return out;
}

/** The "worked" value to synthesise for a mode (a filled blank in lace becomes an eyelet). */
export function punchedValue(mode) {
  return isLaceMode(mode) ? STITCH_TYPE.EYELET : 1;
}

/** Flag a grown card that would exceed the caller's needle bed. Mirrors chart-ops. */
function oversizeFor(rows, cols, { maxRows = Infinity, maxCols = Infinity } = {}) {
  if (rows > maxRows || cols > maxCols) return { rows, cols, maxRows, maxCols };
  return null;
}

const clampInt = (n, min, max) => Math.max(min, Math.min(max, Number.isFinite(n) ? Math.trunc(n) : min));

// ─── 1. bounding box + crop ──────────────────────────────────────────────────

/**
 * The rectangle that tightly holds every worked cell.
 * @returns {{r1:number,c1:number,r2:number,c2:number,rows:number,cols:number}|null}
 *   `null` when the card is entirely blank (there is nothing to bound).
 */
export function contentBounds(matrix, { mode = 'lace' } = {}) {
  const blank = blankValue(mode);
  const { rows, cols } = matrixInfo(matrix);
  let r1 = Infinity;
  let c1 = Infinity;
  let r2 = -Infinity;
  let c2 = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isPunched(mode, cellAt(matrix, r, c, blank))) {
        if (r < r1) r1 = r;
        if (r > r2) r2 = r;
        if (c < c1) c1 = c;
        if (c > c2) c2 = c;
      }
    }
  }
  if (r2 < 0) return null;
  return { r1, c1, r2, c2, rows: r2 - r1 + 1, cols: c2 - c1 + 1 };
}

/**
 * Trim the empty border away so the design fills the card, optionally leaving a
 * margin of `padding` blank rows/columns around it.
 */
export function cropToContent(matrix, { mode = 'lace', padding = 0 } = {}) {
  const bounds = contentBounds(matrix, { mode });
  if (!bounds) return { ok: false, error: 'The card has no worked cells to crop to.' };
  const blank = blankValue(mode);
  const { rows, cols } = matrixInfo(matrix);
  const pad = clampInt(padding, 0, Math.max(rows, cols));
  const r1 = Math.max(0, bounds.r1 - pad);
  const c1 = Math.max(0, bounds.c1 - pad);
  const r2 = Math.min(rows - 1, bounds.r2 + pad);
  const c2 = Math.min(cols - 1, bounds.c2 + pad);
  const out = [];
  for (let r = r1; r <= r2; r++) {
    const row = new Array(c2 - c1 + 1);
    for (let c = c1; c <= c2; c++) row[c - c1] = cellAt(matrix, r, c, blank);
    out.push(row);
  }
  return { ok: true, matrix: out, trimmed: { top: r1, left: c1, bottom: rows - 1 - r2, right: cols - 1 - c2 } };
}

// ─── 2. tile / pad / border (resize with intent) ─────────────────────────────

/**
 * Repeat the whole card into a bigger grid — `across` copies wide by `down` tall.
 * This is "make my motif a stitch multiple", done exactly rather than by hand.
 */
export function tileMatrix(matrix, { mode = 'lace', across = 1, down = 1, maxRows = Infinity, maxCols = Infinity } = {}) {
  const src = square(matrix, mode);
  const a = clampInt(across, 1, 200);
  const d = clampInt(down, 1, 200);
  const rows = src.length * d;
  const cols = src[0].length * a;
  const oversize = oversizeFor(rows, cols, { maxRows, maxCols });
  if (oversize) return { ok: false, oversize };
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const band = src[r % src.length];
    const row = new Array(cols);
    for (let tileC = 0; tileC < a; tileC++) {
      for (let c = 0; c < band.length; c++) row[tileC * band.length + c] = band[c];
    }
    out[r] = row;
  }
  return { ok: true, matrix: out, across: a, down: d };
}

/**
 * Grow the card to at least `rows`×`cols` by padding with blank, keeping the design
 * placed by `anchor` ('center' by default, or any of n/s/e/w/nw/ne/sw/se). Never
 * crops an oversized card — shrinking is a different decision.
 */
export function padToSize(matrix, { mode = 'lace', rows, cols, anchor = 'center', maxRows = Infinity, maxCols = Infinity } = {}) {
  const src = square(matrix, mode);
  const h0 = src.length;
  const w0 = src[0].length;
  const targetR = clampInt(rows, h0, 100000);
  const targetC = clampInt(cols, w0, 100000);
  const oversize = oversizeFor(targetR, targetC, { maxRows, maxCols });
  if (oversize) return { ok: false, oversize };
  if (targetR === h0 && targetC === w0) return { ok: true, matrix: src, added: { rows: 0, cols: 0 } };
  const blank = blankValue(mode);
  const a = String(anchor || 'center').toLowerCase();
  const extraR = targetR - h0;
  const extraC = targetC - w0;
  // Read the anchor as compass letters, but only outside the word "centre/center"
  // (which contains an 'e') so the default really centres on both axes.
  const tag = a.replace(/cent(?:re|er)/g, 'mid');
  const vAlign = tag.includes('n') ? 'n' : tag.includes('s') ? 's' : 'mid';
  const hAlign = tag.includes('w') ? 'w' : tag.includes('e') ? 'e' : 'mid';
  const top = vAlign === 'n' ? 0 : vAlign === 's' ? extraR : Math.floor(extraR / 2);
  const left = hAlign === 'w' ? 0 : hAlign === 'e' ? extraC : Math.floor(extraC / 2);
  const out = new Array(targetR);
  for (let r = 0; r < targetR; r++) out[r] = new Array(targetC).fill(blank);
  for (let r = 0; r < h0; r++) for (let c = 0; c < w0; c++) out[r + top][c + left] = src[r][c];
  return { ok: true, matrix: out, added: { rows: extraR, cols: extraC } };
}

/**
 * Frame the card with `thickness` rings of a chosen value (blank by default — a plain
 * selvedge; pass a punched value for a solid border). Grows the card.
 */
export function addBorder(matrix, { mode = 'lace', thickness = 1, value, maxRows = Infinity, maxCols = Infinity } = {}) {
  const src = square(matrix, mode);
  const t = clampInt(thickness, 0, 200);
  if (!t) return { ok: true, matrix: src, thickness: 0 };
  const fill = value === undefined ? blankValue(mode) : value;
  const h0 = src.length;
  const w0 = src[0].length;
  const rows = h0 + t * 2;
  const cols = w0 + t * 2;
  const oversize = oversizeFor(rows, cols, { maxRows, maxCols });
  if (oversize) return { ok: false, oversize };
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) out[r] = new Array(cols).fill(fill);
  for (let r = 0; r < h0; r++) for (let c = 0; c < w0; c++) out[r + t][c + t] = src[r][c];
  return { ok: true, matrix: out, thickness: t };
}

// ─── 3. repeat detection + symmetry ──────────────────────────────────────────

/** Do two whole rows (by index) hold identical values? */
function rowsEqual(matrix, a, b, blank) {
  const { cols } = matrixInfo(matrix);
  for (let c = 0; c < cols; c++) if (cellAt(matrix, a, c, blank) !== cellAt(matrix, b, c, blank)) return false;
  return true;
}

/** Do two whole needle columns hold identical values? */
function colsEqual(matrix, a, b, blank) {
  const { rows } = matrixInfo(matrix);
  for (let r = 0; r < rows; r++) if (cellAt(matrix, r, a, blank) !== cellAt(matrix, r, b, blank)) return false;
  return true;
}

/**
 * The smallest vertical and horizontal period that reproduces the whole card — the
 * stitch multiple, discovered instead of guessed. `rowPeriod === rows` (and likewise
 * for columns) means no smaller repeat was found.
 */
export function detectRepeat(matrix, { mode = 'lace' } = {}) {
  const blank = blankValue(mode);
  const { rows, cols } = matrixInfo(matrix);
  let rowPeriod = rows;
  for (let p = 1; p <= rows; p++) {
    let good = true;
    for (let r = 0; r + p < rows; r++) {
      if (!rowsEqual(matrix, r, r + p, blank)) {
        good = false;
        break;
      }
    }
    if (good) {
      rowPeriod = p;
      break;
    }
  }
  let colPeriod = cols;
  for (let p = 1; p <= cols; p++) {
    let good = true;
    for (let c = 0; c + p < cols; c++) {
      if (!colsEqual(matrix, c, c + p, blank)) {
        good = false;
        break;
      }
    }
    if (good) {
      colPeriod = p;
      break;
    }
  }
  return {
    ok: true,
    rowPeriod,
    colPeriod,
    repeatRows: rows,
    repeatCols: cols,
    isFullRow: rowPeriod === rows,
    isFullCol: colPeriod === cols
  };
}

/**
 * How close the card is to mirror symmetry, reported as fractions in `[0,1]` for a
 * vertical axis (left↔right), a horizontal axis (top↔bottom) and 180° rotation. Raw
 * value equality — a *visual* symmetry measure; for punched modes it is exact, for
 * lace it ignores transfer handedness.
 */
export function symmetryReport(matrix, { mode = 'lace' } = {}) {
  const src = square(matrix, mode);
  const blank = blankValue(mode);
  const rows = src.length;
  const cols = src[0].length;
  const score = cmp => {
    let same = 0;
    let total = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        total++;
        if (src[r][c] === cmp(r, c)) same++;
      }
    }
    return { same, total, pct: total ? same / total : 1 };
  };
  return {
    ok: true,
    vertical: score((r, c) => src[r][cols - 1 - c]),
    horizontal: score((r, c) => src[rows - 1 - r][c]),
    rotational: score((r, c) => src[rows - 1 - r][cols - 1 - c])
  };
}

/**
 * Make the card mirror-symmetric by copying one half onto the other.
 * `axis` 'h' mirrors left↔right (default `keep: 'first'` preserves the left half);
 * `axis` 'v' mirrors top↔bottom (`keep: 'first'` preserves the top). Lace transfers
 * are corrected with {@link mirrorValue} on the horizontal axis so the mirrored half
 * still knits true.
 */
export function makeSymmetric(matrix, { mode = 'lace', axis = 'h', keep = 'first' } = {}) {
  const src = square(matrix, mode);
  const out = src.map(row => [...row]);
  const rows = out.length;
  const cols = out[0].length;
  const mirrorValueNeeded = axis === 'h';
  let changed = 0;
  const write = (r, c, value) => {
    if (out[r][c] !== value) {
      out[r][c] = value;
      changed++;
    }
  };
  if (axis === 'h') {
    const last = Math.floor((cols - 1) / 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= last; c++) {
        const mc = cols - 1 - c;
        if (mc === c) continue;
        const srcC = keep === 'last' ? mc : c;
        const dstC = keep === 'last' ? c : mc;
        const v = out[r][srcC];
        write(r, dstC, mirrorValueNeeded ? mirrorValue(v, 'flipH') : v);
      }
    }
  } else {
    const last = Math.floor((rows - 1) / 2);
    for (let r = 0; r <= last; r++) {
      const mr = rows - 1 - r;
      if (mr === r) continue;
      const srcR = keep === 'last' ? mr : r;
      const dstR = keep === 'last' ? r : mr;
      for (let c = 0; c < cols; c++) write(dstR, c, out[srcR][c]);
    }
  }
  return { ok: true, matrix: out, axis, changed };
}

// ─── 4. speckle cleanup ──────────────────────────────────────────────────────

/** The eight in-bounds neighbour coordinates around a cell. */
export function neighbors(r, c, rows, cols) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push([nr, nc]);
    }
  }
  return out;
}

/**
 * Remove isolated worked cells (salt): a punched cell with fewer than
 * `minNeighbors` punched neighbours is blanked. The cleanup for a scanned or
 * mis-punched card that picked up stray single holes.
 */
export function despeckle(matrix, { mode = 'lace', minNeighbors = 1 } = {}) {
  const src = square(matrix, mode);
  const blank = blankValue(mode);
  const rows = src.length;
  const cols = src[0].length;
  const out = src.map(row => [...row]);
  const need = clampInt(minNeighbors, 0, 8);
  let removed = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isPunched(mode, src[r][c])) continue;
      let touched = 0;
      for (const [nr, nc] of neighbors(r, c, rows, cols)) if (isPunched(mode, src[nr][nc])) touched++;
      if (touched < need) {
        out[r][c] = blank;
        removed++;
      }
    }
  }
  return { ok: true, matrix: out, removed };
}

/**
 * Fill isolated blank cells (pepper): a blank cell whose every in-bounds neighbour is
 * worked becomes worked. Closes single gaps a scan missed, or a needle that should
 * have been in work inside a solid block.
 */
export function fillSpecks(matrix, { mode = 'lace' } = {}) {
  const src = square(matrix, mode);
  const blank = blankValue(mode);
  const fill = punchedValue(mode);
  const rows = src.length;
  const cols = src[0].length;
  const out = src.map(row => [...row]);
  let filled = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isPunched(mode, src[r][c])) continue;
      const nb = neighbors(r, c, rows, cols);
      if (!nb.length) continue;
      let allWorked = true;
      for (const [nr, nc] of nb) if (!isPunched(mode, src[nr][nc])) {
        allWorked = false;
        break;
      }
      if (allWorked) {
        out[r][c] = fill;
        filled++;
      }
    }
  }
  return { ok: true, matrix: out, filled };
}

// ─── 5. half-drop (brick) repeat + density ───────────────────────────────────

/**
 * Shift alternating columns down by `offset` rows (toroidal, so it wraps) — a motif
 * becomes a brick / half-drop repeat rather than a straight one. Default offset is
 * half the card height, the classic half-drop.
 */
export function halfDrop(matrix, { mode = 'lace', offset } = {}) {
  const src = square(matrix, mode);
  const rows = src.length;
  const cols = src[0].length;
  const out = src.map(row => [...row]);
  const shift = offset === undefined ? Math.floor(rows / 2) : ((Math.trunc(offset) % rows) + rows) % rows;
  for (let c = 1; c < cols; c += 2) {
    for (let r = 0; r < rows; r++) out[r][c] = src[(r - shift + rows * 2) % rows][c];
  }
  return { ok: true, matrix: out, offset: shift };
}

/**
 * Worked-cell density of the whole card plus the per-row and per-column counts, the
 * numbers behind "is this yoke going to pull" and "where are the dense bands".
 */
export function densityStats(matrix, { mode = 'lace' } = {}) {
  const blank = blankValue(mode);
  const { rows, cols } = matrixInfo(matrix);
  const perRow = new Array(rows).fill(0);
  const perCol = new Array(cols).fill(0);
  let punched = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isPunched(mode, cellAt(matrix, r, c, blank))) {
        punched++;
        perRow[r]++;
        perCol[c]++;
      }
    }
  }
  const total = rows * cols;
  return {
    ok: true,
    rows,
    cols,
    punched,
    total,
    density: total ? punched / total : 0,
    perRow,
    perCol
  };
}
