/**
 * Chart surgery: every whole-cell operation the editor can perform on a matrix.
 *
 * Everything here is pure — it takes a matrix and returns a *new* matrix — for
 * two reasons that are both load-bearing in this app:
 *
 *   1. the undo tree stores matrices by value, so an operation that mutated its
 *      input would quietly rewrite history;
 *   2. these are the operations a knitter trusts with a pattern they have already
 *      designed, so each one has to be assertable in `node --test` without a
 *      browser, a canvas or a click.
 *
 * Sizes: a card that has rows inserted stays inside the caller's `maxRows` /
 * `maxCols` only if the caller says so; these functions do the maths and report
 * `oversize`, and the UI turns that into a refusal that names the machine. That
 * split keeps the physics of a particular needle bed out of the algebra.
 */

import { blankValue, isLaceMode, isPunched, normalizeCell, convertRegionBetweenModes } from './modes.js';
import { STITCH_TYPE } from '../math/knit-topology.js';
import {
  cellKey,
  parseCellKey,
  keysToCells,
  moveKeysBy,
  normalizeRect,
  clampRect
} from './select-ops.js';

// ─── basics ──────────────────────────────────────────────────────────────────

export function cloneMatrix(matrix) {
  return matrix.map(row => [...row]);
}

export function matrixInfo(matrix) {
  const rows = matrix.length;
  // Widest row, not row 0: a card that has been clipped or spliced can be ragged,
  // and a bounding box built from the first row silently drops stitches.
  let cols = 0;
  for (let r = 0; r < rows; r++) cols = Math.max(cols, (matrix[r] || []).length);
  let ragged = -1;
  for (let r = 0; r < rows; r++) {
    if ((matrix[r] || []).length !== cols) {
      ragged = r;
      break;
    }
  }
  return { rows, cols, ragged };
}

/** A fresh card, filled with the mode's blank value. */
export function makeMatrix(rows, cols, { mode = 'lace' } = {}) {
  const blank = blankValue(mode);
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) out[r] = new Array(cols).fill(blank);
  return out;
}

/** The value an empty cell of this mode holds. */
function blankFor(mode) {
  return blankValue(mode);
}

function withLimits(matrix, { maxRows = Infinity, maxCols = Infinity } = {}) {
  const { rows, cols } = matrixInfo(matrix);
  return rows > maxRows || cols > maxCols ? { matrix, ok: false, oversize: { rows, cols, maxRows, maxCols } } : { matrix, ok: true };
}

// ─── single-cell editing (type it, do not hunt for it) ────────────────────────

export function getCell(matrix, r, c) {
  const row = matrix[r];
  return row && c >= 0 && c < row.length ? row[c] : undefined;
}

/** Bounds-checked write. Never throws, never grows the card. */
export function setCell(matrix, r, c, value) {
  const { rows, cols } = matrixInfo(matrix);
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= rows || c < 0 || c >= cols) {
    return { ok: false, error: `No cell at row ${r}, column ${c} on a ${rows}×${cols} card.`, matrix };
  }
  const out = cloneMatrix(matrix);
  out[r][c] = value;
  return { ok: true, matrix: out, previous: matrix[r][c], r, c, value };
}

export function setCells(matrix, entries) {
  let out = matrix;
  let changed = 0;
  const skipped = [];
  for (const entry of entries) {
    const result = setCell(out, entry.r, entry.c, entry.value);
    if (result.ok) {
      out = result.matrix;
      if (result.previous !== entry.value) changed++;
    } else {
      skipped.push(`${entry.r},${entry.c}`);
    }
  }
  return { matrix: out, changed, skipped };
}

/**
 * Read a typed cell address.
 *
 * "row 4, col 12", "r4c12", "4,12" and "needle 12 / row 4" all mean the same
 * thing to a knitter and nothing to a `parseInt`, and the whole point of numeric
 * editing is that the field accepts the way people already write coordinates.
 * Rows and columns are 1-based here because that is how charts and needle beds
 * are counted; the matrix is 0-based.
 */
export function parseCellAddress(text) {
  if (typeof text !== 'string') return { ok: false, error: 'Type a cell address, for example "row 4, col 12".' };
  const clean = text.trim().toLowerCase();
  if (!clean) return { ok: false, error: 'No cell address typed.' };
  const nums = clean.match(/\d+/g);
  if (!nums || !nums.length) return { ok: false, error: `"${text}" has no numbers in it.` };
  if (nums.length === 1) {
    return { ok: false, error: 'Needs both a row and a column, like "row 4, col 12".' };
  }
  const asNumbers = nums.map(Number);
  let row;
  let col;
  if (/needle|col|c\b/.test(clean) && /row|r\b/.test(clean)) {
    // Order-independent: pull each number by the word beside it. The word-first
    // form is tried first because "needle 12" is how people write it, and a
    // number-first alternation would happily read "4 needle" out of "row 4,
    // needle 12" and move the wrong stitch.
    const grab = word => {
      const before = clean.match(new RegExp(`${word}\\s*(\\d+)`));
      if (before) return Number(before[1]);
      const after = clean.match(new RegExp(`(\\d+)\\s*${word}`));
      return after ? Number(after[1]) : NaN;
    };
    row = grab('row');
    row = Number.isFinite(row) ? row : grab('r');
    col = grab('needle');
    col = Number.isFinite(col) ? col : grab('col');
    col = Number.isFinite(col) ? col : grab('c');
  } else {
    // Bare "4,12": charts are read row first, then column/needle.
    [row, col] = asNumbers;
  }
  if (!Number.isFinite(row) || !Number.isFinite(col)) {
    return { ok: false, error: `Could not find a row and a column in "${text}".` };
  }
  if (row < 1 || col < 1) return { ok: false, error: 'Rows and needles are counted from 1.' };
  return { ok: true, r: row - 1, c: col - 1, row, col };
}

export function formatCellAddress(r, c) {
  return { label: `row ${r + 1} · needle ${c + 1}`, r1: r + 1, c1: c + 1 };
}

// ─── rows and columns ────────────────────────────────────────────────────────

export function insertRows(matrix, index, count = 1, { mode = 'lace', ...limits } = {}) {
  const { rows, cols } = matrixInfo(matrix);
  const at = Math.max(0, Math.min(rows, Math.trunc(index)));
  const n = Math.max(1, Math.trunc(count));
  const blank = blankFor(mode);
  const out = cloneMatrix(matrix);
  const added = [];
  for (let i = 0; i < n; i++) {
    out.splice(at + i, 0, new Array(cols).fill(blank));
    added.push(at + i);
  }
  return { ...withLimits(out, limits), inserted: added, at, indexUsed: at };
}

export function deleteRows(matrix, index, count = 1) {
  const { rows } = matrixInfo(matrix);
  const at = Math.max(0, Math.min(rows - 1, Math.trunc(index)));
  const n = Math.max(1, Math.trunc(count));
  const out = cloneMatrix(matrix);
  const removed = out.splice(at, Math.min(n, out.length - at));
  return { matrix: out, ok: true, removed: removed.length, at };
}

export function insertColumns(matrix, index, count = 1, { mode = 'lace', ...limits } = {}) {
  const { cols } = matrixInfo(matrix);
  const at = Math.max(0, Math.min(cols, Math.trunc(index)));
  const n = Math.max(1, Math.trunc(count));
  const blank = blankFor(mode);
  const out = matrix.map(row => {
    const cells = [...row];
    const filler = new Array(n).fill(blank);
    cells.splice(at, 0, ...filler);
    return cells;
  });
  return { ...withLimits(out, limits), inserted: Array.from({ length: n }, (_, i) => at + i), at };
}

export function deleteColumns(matrix, index, count = 1) {
  const { cols } = matrixInfo(matrix);
  const at = Math.max(0, Math.min(cols - 1, Math.trunc(index)));
  const n = Math.max(1, Math.trunc(count));
  let out = matrix.map(row => [...row]);
  for (let i = 0; i < Math.min(n, cols); i++) out = out.map(row => (row.length > at ? row.slice(0, at).concat(row.slice(at + 1)) : row));
  return { matrix: out, ok: true, removed: Math.min(n, cols), at };
}

export function reverseRow(matrix, index, { mode = 'lace' } = {}) {
  const { rows } = matrixInfo(matrix);
  if (index < 0 || index >= rows) return { ok: false, error: `Row ${index + 1} is off the card.`, matrix };
  const out = cloneMatrix(matrix);
  const src = out[index];
  const flipped = [...src].reverse();
  // A horizontal read of the row reverses the lean of every transfer, exactly as
  // a mirror flip does — otherwise knitting the row backwards gives the wrong lace.
  out[index] = isLaceMode(mode) ? flipped.map(v => mirrorValue(v, 'flipH')) : flipped;
  return { ok: true, matrix: out, index };
}

export function reverseColumn(matrix, index, { mode = 'lace' } = {}) {
  const { rows } = matrixInfo(matrix);
  if (index < 0 || index >= matrixInfo(matrix).cols) return { ok: false, error: `Needle ${index + 1} is off the card.`, matrix };
  const out = cloneMatrix(matrix);
  const column = out.map(row => row[index]).reverse();
  for (let r = 0; r < rows; r++) out[r][index] = column[r];
  // Rows reversed: a transfer still lands on the same neighbouring needle, so the
  // glyph does not change. This is the asymmetry that makes vertical flips safe.
  return { ok: true, matrix: out, index };
}

export function swapRows(matrix, a, b) {
  const { rows } = matrixInfo(matrix);
  if (a < 0 || b < 0 || a >= rows || b >= rows) return { ok: false, error: 'Both rows must be on the card.', matrix };
  if (a === b) return { ok: true, matrix: cloneMatrix(matrix), swapped: false };
  const out = cloneMatrix(matrix);
  const tmp = out[a];
  out[a] = out[b];
  out[b] = tmp;
  return { ok: true, matrix: out, swapped: true, a, b };
}

export function swapColumns(matrix, a, b) {
  const { cols } = matrixInfo(matrix);
  if (a < 0 || b < 0 || a >= cols || b >= cols) return { ok: false, error: 'Both needles must be on the card.', matrix };
  if (a === b) return { ok: true, matrix: cloneMatrix(matrix), swapped: false };
  const out = matrix.map(row => {
    const cells = [...row];
    const tmp = cells[a];
    cells[a] = cells[b];
    cells[b] = tmp;
    return cells;
  });
  return { ok: true, matrix: out, swapped: true, a, b };
}

/** Slide a row to a new position, pushing everything between it over. */
export function moveRow(matrix, from, to) {
  const { rows } = matrixInfo(matrix);
  if (from < 0 || from >= rows || to < 0 || to >= rows) return { ok: false, error: 'Both rows must be on the card.', matrix };
  const out = cloneMatrix(matrix);
  const [row] = out.splice(from, 1);
  out.splice(Math.min(to, out.length), 0, row);
  return { ok: true, matrix: out, from, to };
}

export function moveColumn(matrix, from, to) {
  const { cols } = matrixInfo(matrix);
  if (from < 0 || from >= cols || to < 0 || to >= cols) return { ok: false, error: 'Both needles must be on the card.', matrix };
  const out = matrix.map(row => [...row]);
  for (const row of out) {
    const [cell] = row.splice(from, 1);
    row.splice(Math.min(to, row.length), 0, cell);
  }
  return { ok: true, matrix: out, from, to };
}

export function copyRow(matrix, index) {
  const { rows } = matrixInfo(matrix);
  if (index < 0 || index >= rows) return { ok: false, error: 'That row is off the card.' };
  return { ok: true, cells: [...matrix[index]], cols: matrix[index].length };
}

export function copyColumn(matrix, index) {
  const { cols } = matrixInfo(matrix);
  if (index < 0 || index >= cols) return { ok: false, error: 'That needle is off the card.' };
  return { ok: true, cells: matrix.map(row => row[index]), rows: matrix.length };
}

/** Put a captured row back: over the top of an existing one, or as a new one. */
export function pasteRow(matrix, index, cells, { op = 'replace', mode = 'lace' } = {}) {
  const { rows, cols } = matrixInfo(matrix);
  if (index < 0 || index >= rows + (op === 'insert' ? 1 : 0)) {
    return { ok: false, error: 'That row is off the card.', matrix };
  }
  const out = cloneMatrix(matrix);
  const line = new Array(cols).fill(blankFor(mode));
  for (let c = 0; c < Math.min(cols, cells.length); c++) line[c] = cells[c];
  const trimmed = cells.length > cols;
  if (op === 'insert') out.splice(index, 0, line);
  else out[index] = line;
  return { ok: true, matrix: out, index, trimmed, wrote: Math.min(cols, cells.length) };
}

/**
 * Weave a second chart into the first: one row of `overlay` after every
 * `every`-th row of `base`, cycling the overlay so any length works.
 *
 * This is how a lace repeat is actually added to a stocking-stitch body — every
 * fourth row becomes the eyelet row — so the overlay is read as a repeat, not as
 * a fixed block, and `offset` lets you start partway through it.
 */
export function interleaveRows(base, overlay, { every = 1, offset = 0, mode = 'lace' } = {}) {
  const step = Math.max(1, Math.trunc(every));
  if (!overlay.length) return { ok: false, error: 'Nothing to interleave — the overlay chart is empty.', matrix: cloneMatrix(base) };
  const blank = blankFor(mode);
  const cols = matrixInfo(base).cols;
  const out = [];
  const inserted = [];
  let cursor = ((offset % overlay.length) + overlay.length) % overlay.length;
  for (let r = 0; r < base.length; r++) {
    out.push([...base[r]]);
    if ((r + 1) % step === 0) {
      const source = overlay[cursor % overlay.length];
      const line = new Array(cols).fill(blank);
      for (let c = 0; c < Math.min(cols, source.length); c++) line[c] = source[c];
      inserted.push(out.length);
      out.push(line);
      cursor++;
    }
  }
  return { ok: true, matrix: out, inserted, rows: out.length };
}

// ─── whole-chart transforms ──────────────────────────────────────────────────

/**
 * Glyphs that change meaning when the chart is read the other way round.
 *
 * Only the *sideways* ones: a left-leaning transfer moves the loop to needle i−1,
 * so when needles are mirrored it has to become a right-leaning one. Turning the
 * chart upside down swaps no needles, so those survive untouched — which is why
 * `flipV` has an empty map rather than being an oversight.
 */
const MIRROR_HORIZONTAL = {
  [STITCH_TYPE.TRANSFER_LEFT]: STITCH_TYPE.TRANSFER_RIGHT,
  [STITCH_TYPE.TRANSFER_RIGHT]: STITCH_TYPE.TRANSFER_LEFT,
  [STITCH_TYPE.TRANSFER_DOUBLE_L]: STITCH_TYPE.TRANSFER_DOUBLE_R,
  [STITCH_TYPE.TRANSFER_DOUBLE_R]: STITCH_TYPE.TRANSFER_DOUBLE_L,
  [STITCH_TYPE.DOUBLE_DEC_LEFT]: STITCH_TYPE.DOUBLE_DEC_RIGHT,
  [STITCH_TYPE.DOUBLE_DEC_RIGHT]: STITCH_TYPE.DOUBLE_DEC_LEFT
};

export function mirrorValue(value, kind) {
  if (kind === 'flipV') return value;
  return MIRROR_HORIZONTAL[value] ?? value;
}

const QUARTER_WARNING =
  'A quarter turn lays every transfer sideways: a loop that moved to needle i−1 now points along the rows, which no single-bed carriage can do. Check the leans (or switch to a centred decrease) before knitting this.';

/**
 * kind: flipH | flipV | rot180 | rot90cw | rot90ccw | transpose | antitranspose
 *
 * `transpose` is the "flip diagonal" of the missing-tools list: needles and rows
 * exchange places, which is how you rescue a chart drawn the wrong way round. The
 * lean is mirrored to match, because the reflection is across a diagonal.
 */
export function transformMatrix(matrix, kind, { mode = 'lace', ...limits } = {}) {
  const { rows, cols } = matrixInfo(matrix);
  const at = (r, c) => (matrix[r] ? matrix[r][c] : blankFor(mode));
  const warnings = [];
  const out = [];

  const map = (r, c) => {
    switch (kind) {
      case 'flipH':
        return [r, cols - 1 - c];
      case 'flipV':
        return [rows - 1 - r, c];
      case 'rot180':
        return [rows - 1 - r, cols - 1 - c];
      case 'transpose':
        return [c, r];
      case 'antitranspose':
        return [cols - 1 - c, rows - 1 - r];
      case 'rot90cw':
        return [c, rows - 1 - r];
      case 'rot90ccw':
        return [cols - 1 - c, r];
      default:
        return null;
    }
  };

  const turned = kind === 'rot90cw' || kind === 'rot90ccw';
  const swapAxes = kind === 'transpose' || kind === 'antitranspose' || turned;
  const outRows = swapAxes ? cols : rows;
  const outCols = swapAxes ? rows : cols;
  const glyphKind = kind === 'flipH' || kind === 'rot180' || kind === 'transpose' || kind === 'antitranspose' ? 'flipH' : 'none';

  for (let r = 0; r < outRows; r++) out.push(new Array(outCols).fill(blankFor(mode)));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [tr, tc] = map(r, c);
      // Built by walking the *input*: inverting each mapping algebraically would
      // be cleverer and is the kind of code that hides an off-by-one for years.
      let value = at(r, c);
      if (isLaceMode(mode) && glyphKind === 'flipH') value = mirrorValue(value, 'flipH');
      out[tr][tc] = value;
    }
  }
  if (turned && isLaceMode(mode)) warnings.push(QUARTER_WARNING);
  return { ...withLimits(out, limits), kind, warnings, rows: outRows, cols: outCols };
}

/** Flip a *region* of the chart — the "pattern flip within selection" tool. */
export function flipRegion(matrix, rect, axis = 'h', { mode = 'lace' } = {}) {
  // Clamped, because a marquee can hang off the edge of the card and writing to
  // row 9 of a 2-row chart would throw halfway through and leave a torn card.
  const n = clampToMatrix(rect, matrix);
  if (!n) return { ok: false, error: 'Nothing selected to flip.', matrix: cloneMatrix(matrix) };
  const out = cloneMatrix(matrix);
  const h = n.r2 - n.r1 + 1;
  const w = n.c2 - n.c1 + 1;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const [sr, sc] = axis === 'v' ? [n.r1 + (h - 1 - r), n.c1 + c] : [n.r1 + r, n.c1 + (w - 1 - c)];
      let value = getCell(matrix, sr, sc);
      if (isLaceMode(mode) && axis !== 'v') value = mirrorValue(value, 'flipH');
      out[n.r1 + r][n.c1 + c] = value;
    }
  }
  return { ok: true, matrix: out, cells: h * w };
}

/**
 * Invert the whole card, or a region.
 *
 * In lace "invert" cannot mean `!value`: the blanks are `'K'` and the marks are
 * symbols, so the useful reading is *punched ↔ plain*, and the punched side
 * collapses to an eyelet for the same reason a pasted hole becomes an eyelet.
 */
export function invertRegion(matrix, rect, { mode = 'lace' } = {}) {
  const n = rect ? clampToMatrix(normalizeRect(rect), matrix) : null;
  const out = cloneMatrix(matrix);
  let changed = 0;
  const { rows, cols } = matrixInfo(matrix);
  const r1 = n ? n.r1 : 0;
  const r2 = n ? n.r2 : rows - 1;
  const c1 = n ? n.c1 : 0;
  const c2 = n ? n.c2 : cols - 1;
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const punched = isPunched(mode, out[r][c]);
      out[r][c] = punched ? blankFor(mode) : isLaceMode(mode) ? STITCH_TYPE.EYELET : 1;
      changed++;
    }
  }
  return { ok: true, matrix: out, changed };
}

export function invertCells(matrix, keys, { mode = 'lace' } = {}) {
  const out = cloneMatrix(matrix);
  let changed = 0;
  for (const key of keys) {
    const { r, c } = parseCellKey(key);
    if (!out[r] || c < 0 || c >= out[r].length) continue;
    const punched = isPunched(mode, out[r][c]);
    out[r][c] = punched ? blankFor(mode) : isLaceMode(mode) ? STITCH_TYPE.EYELET : 1;
    changed++;
  }
  return { ok: true, matrix: out, changed };
}

/**
 * Find and replace one symbol for another across the card (or a selection).
 *
 * This is the global fix-up a knitter always needs and never had a way to do
 * without clicking cell by cell: "I meant a right-leaning transfer everywhere I
 * typed TL", or "turn every plain knit inside this yoke into a purl bump." It is
 * strict-equality on the stored value — the same matching `selectByValue` and the
 * symbol legend use — so `TL` never collides with `T2L`, and it leaves every other
 * cell byte-for-byte alone.
 *
 * Returns `matched` (cells that held the find symbol) and `changed` (cells that
 * actually moved to the replace symbol). They are equal whenever the two symbols
 * differ, but `matched` lets the caller say "there were no TL stitches at all"
 * honestly instead of reporting a silent zero-cell success.
 */
export function replaceValue(matrix, find, replace, { mode = 'lace', within = null } = {}) {
  if (find === replace) {
    return { ok: false, error: 'Find and replace are the same symbol.', matrix: cloneMatrix(matrix), matched: 0, changed: 0 };
  }
  const out = cloneMatrix(matrix);
  let matched = 0;
  let changed = 0;
  for (let r = 0; r < out.length; r++) {
    const row = out[r];
    for (let c = 0; c < row.length; c++) {
      if (within && !within.has(cellKey(r, c))) continue;
      if (row[c] !== find) continue;
      matched++;
      if (row[c] !== replace) {
        row[c] = replace;
        changed++;
      }
    }
  }
  return { ok: true, matrix: out, matched, changed };
}

function clampToMatrix(rect, matrix) {
  const { rows, cols } = matrixInfo(matrix);
  // One implementation of "is this marquee on the card" shared with select-ops:
  // two of them always disagree eventually, and the disagreement is a crash.
  return clampRect(rect, rows, cols);
}

// ─── painting a set ──────────────────────────────────────────────────────────

export function paintCells(matrix, keys, value, { only = null } = {}) {
  const out = cloneMatrix(matrix);
  let changed = 0;
  let skipped = 0;
  for (const key of keys) {
    const { r, c } = parseCellKey(key);
    if (!out[r] || c < 0 || c >= out[r].length) {
      skipped++;
      continue;
    }
    if (only && !only(out[r][c], r, c)) {
      skipped++;
      continue;
    }
    const next = typeof value === 'function' ? value(r, c) : value;
    if (out[r][c] !== next) changed++;
    out[r][c] = next;
  }
  return { ok: true, matrix: out, changed, skipped };
}

export function eraseCells(matrix, keys, { mode = 'lace' } = {}) {
  return paintCells(matrix, keys, blankFor(mode));
}

/**
 * Move selected content by a delta (the arrow-key nudge).
 *
 * Written as "clear, then write", against a *copy* of the source, so a move
 * cannot smear when the destination overlaps the origin — the bug that makes
 * drag-the-selection tools lose stitches in a lot of grid editors.
 * Anything that would land off the card is reported, not silently dropped.
 */
export function moveContent(matrix, keys, dr, dc, { mode = 'lace', wrap = false } = {}) {
  const { rows, cols } = matrixInfo(matrix);
  const source = cloneMatrix(matrix);
  const out = matrix.map(row => [...row]);
  const blank = blankFor(mode);
  const wanted = keysToCells(keys);
  let moved = 0;
  const outside = [];
  for (const { r, c } of wanted) {
    if (!wrap) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
        outside.push(cellKey(r, c));
        continue;
      }
    }
    out[r][c] = blank;
  }
  for (const { r, c } of wanted) {
    const nr = wrap ? ((r + dr) % rows + rows) % rows : r + dr;
    const nc = wrap ? ((c + dc) % cols + cols) % cols : c + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
    out[nr][nc] = source[r][c];
    moved++;
  }
  return { ok: true, matrix: out, moved, blocked: outside.length, keys: moveKeysBy(keys, dr, dc) };
}

// ─── motifs: paste, stamp, pattern brush ─────────────────────────────────────

/**
 * A motif is a rectangular block of cells plus the mode it was drawn in.
 * Everything that moves a design around — paste, stamp, snippet library, dragging
 * a preset onto the canvas — goes through this one shape.
 */
export function makeMotif(matrix, rect, { mode = 'lace', name = '' } = {}) {
  const n = clampToMatrix(normalizeRect(rect), matrix) || {
    r1: 0,
    c1: 0,
    r2: matrixInfo(matrix).rows - 1,
    c2: matrixInfo(matrix).cols - 1
  };
  const cells = [];
  let punched = 0;
  for (let r = n.r1; r <= n.r2; r++) {
    const line = [];
    for (let c = n.c1; c <= n.c2; c++) {
      const value = matrix[r][c];
      line.push(value);
      if (isPunched(mode, value)) punched++;
    }
    cells.push(line);
  }
  return {
    name,
    mode,
    rows: cells.length,
    cols: cells.length ? cells[0].length : 0,
    cells,
    punched,
    capturedAt: new Date().toISOString()
  };
}

export function motifBounds(motif) {
  const rows = motif?.cells?.length || 0;
  const cols = rows ? motif.cells[0].length : 0;
  return { rows, cols };
}

/** Flip / turn / mask a motif without touching the card. */
export function transformMotif(motif, { flipH = false, flipV = false, rotate = 0 } = {}) {
  let cells = motif.cells.map(row => [...row]);
  const mode = motif.mode;
  if (flipH) {
    cells = cells.map(row => row.reverse()).map(row => (isLaceMode(mode) ? row.map(v => mirrorValue(v, 'flipH')) : row));
  }
  if (flipV) cells = cells.reverse();
  const turns = ((rotate % 360) + 360) % 360;
  if (turns === 90 || turns === 270) {
    const h = cells.length;
    const w = cells[0].length;
    const out = new Array(w).fill(null).map(() => new Array(h));
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (turns === 90) out[c][h - 1 - r] = cells[r][c];
        else out[w - 1 - c][r] = cells[r][c];
      }
    }
    cells = out;
  } else if (turns === 180) {
    cells = cells.map(row => [...row].reverse()).reverse();
  }
  return { ...motif, cells, rows: cells.length, cols: cells.length ? cells[0].length : 0 };
}

/**
 * Place a motif with its top-left at (r,c).
 *
 * `masked` keeps the cells the motif leaves blank (its own blanks) untouched,
 * which is what you want when stamping a motif over a background — and what you
 * do *not* want when pasting a rectangle that must replace what is there. The
 * caller picks; the default is masked, because stamping is the common case.
 */
export function stampMotif(matrix, motif, { r = 0, c = 0, mode = null, masked = true } = {}) {
  const { rows, cols } = matrixInfo(matrix);
  const targetMode = mode || motif.mode;
  const source = motif.cells;
  const out = cloneMatrix(matrix);
  let placed = 0;
  let clipped = 0;
  let converted = 0;
  for (let sr = 0; sr < source.length; sr++) {
    const tr = r + sr;
    for (let sc = 0; sc < source[sr].length; sc++) {
      const tc = c + sc;
      if (tr < 0 || tr >= rows || tc < 0 || tc >= cols) {
        clipped++;
        continue;
      }
      let value = source[sr][sc];
      if (motif.mode !== targetMode) {
        const was = value;
        value = isPunched(motif.mode, value)
          ? isLaceMode(targetMode)
            ? STITCH_TYPE.EYELET
            : 1
          : blankValue(targetMode);
        if (was !== value) converted++;
      }
      if (masked && !isPunched(targetMode, value)) continue;
      if (out[tr][tc] === value) continue;
      out[tr][tc] = value;
      placed++;
    }
  }
  return { ok: true, matrix: out, placed, clipped, converted, masked };
}

/** Paste a raw block (from the clipboard) at an anchor, replacing what is there. */
export function pasteCells(matrix, cells, { r = 0, c = 0, mode = 'lace', masked = false } = {}) {
  return stampMotif(matrix, { cells, mode }, { r, c, mode, masked });
}

// ─── brushes ─────────────────────────────────────────────────────────────────

/**
 * Soften a region — the honest version of "blur".
 *
 * A punchcard has no grey, so a blur is a *majority* decision per cell, with the
 * lace glyph resolved by vote (the most common worked symbol wins, not an average
 * of symbols, which would be meaningless). Ties keep the cell as it was, so a
 * hard edge stays hard and a dithered edge becomes a dithered edge.
 */
export function softenRegion(matrix, rect, { passes = 1, mode = 'lace' } = {}) {
  let current = cloneMatrix(matrix);
  for (let p = 0; p < Math.max(1, passes); p++) {
    const n = clampToMatrix(normalizeRect(rect), current);
    if (!n) break;
    const source = cloneMatrix(current);
    const { rows, cols } = matrixInfo(current);
    for (let r = n.r1; r <= Math.min(n.r2, rows - 1); r++) {
      for (let c = n.c1; c <= Math.min(n.c2, cols - 1); c++) {
        const counts = new Map();
        let punched = 0;
        let total = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            const value = source[nr][nc];
            total++;
            if (isPunched(mode, value)) punched++;
            counts.set(value, (counts.get(value) || 0) + 1);
          }
        }
        const blank = blankFor(mode);
        const blanks = total - punched;
        if (punched === blanks) continue; // a tie: leave the needle alone
        if (punched < blanks) {
          current[r][c] = blank;
          continue;
        }
        if (isLaceMode(mode)) {
          // Most common *worked* symbol; fall back to an eyelet if the only
          // worked marks were carried in from a numeric card.
          let best = null;
          let bestCount = -1;
          for (const [value, count] of counts) {
            if (isPunched(mode, value) && count > bestCount) {
              best = value;
              bestCount = count;
            }
          }
          current[r][c] = typeof best === 'string' && best !== STITCH_TYPE.KNIT ? best : STITCH_TYPE.EYELET;
        } else {
          current[r][c] = 1;
        }
      }
    }
  }
  return { ok: true, matrix: current, passes };
}

/**
 * Smudge: everything along the stroke slides one step forward.
 *
 * Same shape as a paint program's smudge on a discrete grid — the cell at the
 * start of the drag takes the value of the cell behind it, so a motif dragged
 * across the card leaves a trail of itself rather than a painted line.
 */
export function smudgePath(matrix, path, { mode = 'lace' } = {}) {
  const keys = path instanceof Set ? [...path] : path;
  if (!keys || keys.length < 2) return { ok: false, error: 'Drag further to smudge anything.', matrix: cloneMatrix(matrix) };
  const out = cloneMatrix(matrix);
  const read = key => {
    const { r, c } = parseCellKey(key);
    const row = matrix[r];
    return row && c >= 0 && c < row.length ? row[c] : blankFor(mode);
  };
  let moved = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    const to = parseCellKey(keys[i + 1]);
    const target = out[to.r];
    if (!target || to.c < 0 || to.c >= target.length) continue;
    out[to.r][to.c] = read(keys[i]);
    moved++;
  }
  return { ok: true, matrix: out, moved };
}

// ─── conversion and re-gauging ───────────────────────────────────────────────

export function convertRegion(matrix, rect, { from = 'lace', to = 'lace' } = {}) {
  const n = clampToMatrix(normalizeRect(rect), matrix);
  if (!n) return { ok: false, error: 'Nothing selected to convert.', matrix: cloneMatrix(matrix) };
  if (from === to) return { ok: true, matrix: cloneMatrix(matrix), changed: 0, mode: to };
  const result = convertRegionBetweenModes(matrix, n, from, to);
  return { ok: true, ...result, mode: to };
}

/**
 * Resample a chart to a new needle count.
 *
 * `nearest` keeps every source stitch and simply redistributes them (a shrunk card
 * can duplicate a column, which is exactly what "same pattern, finer gauge"
 * means); `repeat` tiles the design, which is what you want when moving a 24-stitch
 * punchcard repeat onto a 40-needle electronic bed. Nothing is interpolated into
 * a stitch type that was not drawn: a transfer is never "half" a transfer.
 */
export function resampleMatrix(matrix, { rows, cols, method = 'nearest' } = {}) {
  const { rows: h, cols: w } = matrixInfo(matrix);
  if (!h || !w) return { ok: false, error: 'The card is empty.', matrix: [] };
  const outRows = Math.max(1, Math.trunc(rows ?? h));
  const outCols = Math.max(1, Math.trunc(cols ?? w));
  const out = new Array(outRows);
  for (let r = 0; r < outRows; r++) {
    const line = new Array(outCols);
    for (let c = 0; c < outCols; c++) {
      if (method === 'repeat') {
        line[c] = matrix[r % h][c % w];
      } else {
        const sr = Math.min(h - 1, Math.round((r * (h - 1)) / Math.max(1, outRows - 1)));
        const sc = Math.min(w - 1, Math.round((c * (w - 1)) / Math.max(1, outCols - 1)));
        line[c] = matrix[sr][sc];
      }
    }
    out[r] = line;
  }
  return { ok: true, matrix: out, rows: outRows, cols: outCols, method };
}

/**
 * Move a design from one machine's physical gauge to another's.
 *
 * The scale comes from the needle pitches (mm per stitch, mm per row), never from
 * a guessed "look": 180 stitches at 4.5 mm are 810 mm of fabric, and 810 mm on a
 * 5 mm bed is 162 needles. Refuses nonsense pitches rather than inventing a chart.
 */
export function regaugeMatrix(matrix, { fromPitchX, fromPitchY, toPitchX, toPitchY, method = 'nearest' } = {}) {
  const numbers = [fromPitchX, toPitchX, fromPitchY ?? fromPitchX, toPitchY ?? toPitchX];
  if (numbers.some(n => !Number.isFinite(n) || n <= 0)) {
    return { ok: false, error: 'Both machines need a needle pitch in mm before a design can be re-gauged.' };
  }
  const { rows, cols } = matrixInfo(matrix);
  const scaleX = fromPitchX / toPitchX;
  const scaleY = (fromPitchY ?? fromPitchX) / (toPitchY ?? toPitchX);
  const result = resampleMatrix(matrix, {
    cols: Math.max(1, Math.round(cols * scaleX)),
    rows: Math.max(1, Math.round(rows * scaleY)),
    method
  });
  if (!result.ok) return result;
  const warnings = [];
  if (Math.abs(scaleX - 1) > 0.02) {
    warnings.push(
      `The pattern was re-spaced to ${result.cols} needles (from ${cols}); paired transfers may now sit a needle apart from their eyelet, so run a feasibility check before knitting.`
    );
  }
  return {
    ...result,
    scaleX,
    scaleY,
    widthMm: Number((cols * fromPitchX).toFixed(2)),
    warnings
  };
}

/** Stitch count for a target width, given a pitch — the ruler's arithmetic. */
export function stitchesForWidth(mm, pitchX) {
  if (!Number.isFinite(mm) || !Number.isFinite(pitchX) || pitchX <= 0) return null;
  return Math.round(mm / pitchX);
}

export function normalizeMatrixCells(matrix, mode) {
  return matrix.map(row => row.map(value => normalizeCell(mode, value)));
}
