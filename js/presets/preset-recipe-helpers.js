/**
 * KNITCAT - Pattern recipe toolkit.
 *
 * The library aims to hold a hundred and more real-world patterns. If every one of
 * them carried its own hand-written double loop we would not be able to read any of
 * them, and a typo in one would be invisible. So the repeating machinery of chart
 * authoring lives here once, and each recipe below reads like the instruction lines
 * of a printed pattern: "on row 0, at each 12-stitch multiple, transfer left".
 *
 * Chart convention (unchanged from the rest of the app):
 *   - `matrix[0]` is the BOTTOM of the card, the cast-on edge. Rows count upwards in
 *     the direction the fabric grows. Anything that belongs at the start of a piece
 *     (a cast-on edging, a picot) therefore lives at row 0; anything that belongs at
 *     the end (a bind-off edging, a neck slant) lives at the top row.
 *   - Columns are needles, left to right as you face the machine.
 *   - Lace cells hold Japanese-chart symbols from STITCH_TYPE; direct modes
 *     (fair_isle / tuck / slip) hold 0 and 1, exactly as `js/edit/modes.js` defines.
 *
 * Balance, which is the thing a machine knitter actually has to think about:
 * an eyelet casts a new loop on (`+1`) and a transfer takes a needle out of work
 * (`-1`), so a worked row is only safe if the two counts match. `laceBalance`
 * measures that, and the test suite refuses to ship a lace recipe that is off.
 * (This is why real straight-bed lace is written as yarn-over *paired with* a
 * transfer, and why the double-bed transfer+rack idea from a DB machine cannot be
 * transplanted onto a single bed without the transfers coming from somewhere.)
 */

import { STITCH_TYPE as S } from '../math/knit-topology.js';

/** Values that mean "this needle just knits" in a lace chart. */
export const PLAIN = [S.KNIT, S.PURL, S.EMPTY, undefined, null];

/** How one symbol changes the number of loops in work. */
export const STITCH_DELTA = {
  [S.EYELET]: 1,
  [S.TRANSFER_LEFT]: -1,
  [S.TRANSFER_RIGHT]: -1,
  [S.TRANSFER_DOUBLE_L]: -2,
  [S.TRANSFER_DOUBLE_R]: -2,
  [S.DOUBLE_DEC_LEFT]: -2,
  [S.DOUBLE_DEC_RIGHT]: -2,
  [S.CENTER_DEC]: -2
};

/** Every symbol the lace recipes are allowed to place. */
export const LACE_ALPHABET = Object.values(S);

export function isPlain(value) {
  return PLAIN.includes(value);
}

/** Net loop change for a whole row (or any list of cells). */
export function laceBalance(row = []) {
  let delta = 0;
  for (const cell of row) delta += STITCH_DELTA[cell] || 0;
  return delta;
}

/** Net loop change for a whole chart. Zero is what a flat-bed card wants. */
export function chartBalance(matrix = []) {
  return matrix.reduce((total, row) => total + laceBalance(row), 0);
}

/**
 * Deterministic pseudo-random in [0, 1) — the same seed must give the same motif,
 * otherwise "generate" would be a slot machine and nobody could recover a pattern
 * they had just liked.
 */
export function makeRandom(seed = 1) {
  let state = (Number(seed) || 1) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return function random() {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/** A chart of nothing but plain knitting. */
export function blankLace(rows, cols, fill = S.KNIT) {
  const matrix = new Array(rows);
  for (let r = 0; r < rows; r++) matrix[r] = new Array(cols).fill(fill);
  return matrix;
}

/** A chart of nothing but blanks in a direct mode (0 = yarn A, unpunched). */
export function blankDirect(rows, cols) {
  const matrix = new Array(rows);
  for (let r = 0; r < rows; r++) matrix[r] = new Array(cols).fill(0);
  return matrix;
}

/** Row index helper: `onRow(r, 8, [0, 4])` is true on rows 0, 4, 8, 12, … */
export function onRow(r, period, phases) {
  return phases.includes(((r % period) + period) % period);
}

/**
 * Apply `fn(col, offset)` to every repeat multiple in the row.
 * `fn` returns the symbol, or `null`/`undefined` to leave the needle plain — that
 * is how a recipe keeps its edge needles quiet without bounds-checking by hand.
 */
export function eachRepeat(row, width, fn, offset = 0) {
  for (let base = 0; base + offset < row.length; base += width) {
    const col = base + offset;
    if (col < 0 || col >= row.length) continue;
    const value = fn(col, base);
    if (value !== null && value !== undefined) row[col] = value;
  }
  return row;
}

/** Left/right transfer pair, symmetric about `center`, `gap` needles either side. */
export function pairDecrease(row, center, gap = 0, outward = false) {
  const left = center - gap;
  const right = center + gap;
  // Inward: the left neighbour slides right into the spine and the right neighbour
  // slides left, so the two lean at each other. Outward is the mirror.
  if (left >= 0) row[left] = outward ? S.TRANSFER_LEFT : S.TRANSFER_RIGHT;
  if (right < row.length && right !== left) {
    row[right] = outward ? S.TRANSFER_RIGHT : S.TRANSFER_LEFT;
  }
  return row;
}

/**
 * The atom of machine lace: a yarn-over next to a transfer. Together they make one
 * hole and keep the loop count exactly where it was, which is the whole trick of
 * straight-bed lace and the reason the pairing direction decides which way the hole
 * leans.
 */
export function holePair(row, eyeletCol, direction = 'R', wrap = false) {
  const offset = direction === 'R' ? 1 : -1;
  let transfer = eyeletCol + offset;
  if (wrap) transfer = ((transfer % row.length) + row.length) % row.length;
  if (transfer < 0 || transfer >= row.length) return row;
  row[eyeletCol] = S.EYELET;
  row[transfer] = direction === 'R' ? S.TRANSFER_RIGHT : S.TRANSFER_LEFT;
  return row;
}

/**
 * The safe version of `holePair` for authoring: it places the eyelet *and* its
 * decrease together, or not at all, and it refuses to overwrite a needle another
 * atom has already claimed. Because a hole is always laid as one indivisible
 * eyelet+transfer pair, a row built only from `addHole` calls is balanced by
 * construction — which is why the lace recipes go through this rather than poking
 * symbols in by hand and hoping the counts line up.
 *
 * `claimed` is a Set of columns already used this row; pass the same Set across a
 * row and holes will never collide.
 */
export function addHole(row, eyeletCol, direction = 'R', claimed = null) {
  const offset = direction === 'R' ? 1 : -1;
  const transfer = eyeletCol + offset;
  const inBounds = c => c >= 0 && c < row.length;
  if (!inBounds(eyeletCol) || !inBounds(transfer)) return false;
  if (!isPlain(row[eyeletCol]) || !isPlain(row[transfer])) return false;
  if (claimed && (claimed.has(eyeletCol) || claimed.has(transfer))) return false;
  row[eyeletCol] = S.EYELET;
  row[transfer] = direction === 'R' ? S.TRANSFER_RIGHT : S.TRANSFER_LEFT;
  if (claimed) {
    claimed.add(eyeletCol);
    claimed.add(transfer);
  }
  return true;
}

/**
 * Lay a balanced row of holes at fixed repeat offsets. `pattern` is a list of
 * `[offsetInRepeat, direction]`; every hole goes through `addHole`, so whatever the
 * repeat width the row nets to zero loops. This is the workhorse the recipes use.
 */
export function holeRow(row, width, pattern, offset = 0) {
  const claimed = new Set();
  for (let base = -width; base < row.length + width; base += width) {
    for (const [rel, direction] of pattern) {
      addHole(row, base + offset + rel, direction, claimed);
    }
  }
  return row;
}

/**
 * Place a motif defined on a small grid into a big chart, tiled from `rowOffset`
 * and `colOffset` outwards. Values equal to `skip` (or plain, for lace) are left
 * alone so a motif can be layered over an existing ground.
 */
export function stamp(matrix, motif, { rowOffset = 0, colOffset = 0, tile = true, skip } = {}) {
  const height = motif.length;
  const width = Math.max(...motif.map(r => r.length));
  const rows = matrix.length;
  const cols = matrix[0] ? matrix[0].length : 0;
  const repeatsR = tile ? Math.ceil((rows - rowOffset) / height) : 1;
  const repeatsC = tile ? Math.ceil((cols - colOffset) / width) : 1;
  for (let rr = 0; rr < repeatsR; rr++) {
    for (let cc = 0; cc < repeatsC; cc++) {
      for (let r = 0; r < height; r++) {
        const targetR = rowOffset + rr * height + r;
        if (targetR >= rows) continue;
        for (let c = 0; c < width; c++) {
          const value = motif[r][c];
          if (value === skip) continue;
          const targetC = colOffset + cc * width + c;
          if (targetC >= cols) continue;
          matrix[targetR][targetC] = value;
        }
      }
    }
  }
  return matrix;
}

/**
 * Read a chart off a string block, the way a printed pattern chart looks.
 * Each entry of `lines` is one row, BOTTOM FIRST, and `map` translates characters
 * to cell values. Characters missing from the map are treated as the ground value.
 */
export function fromChart(lines, map = {}, { ground = 0 } = {}) {
  return lines.map(line => {
    const row = new Array(line.length);
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      row[c] = Object.prototype.hasOwnProperty.call(map, char) ? map[char] : ground;
    }
    return row;
  });
}

/** Mirror a grid left-right (for building symmetric motifs from one half). */
export function mirrorX(grid) {
  return grid.map(row => [...row].reverse());
}

/** Rotate a grid 90° clockwise. */
export function rotateCW(grid) {
  const height = grid.length;
  const width = grid[0].length;
  const out = new Array(width);
  for (let r = 0; r < width; r++) {
    out[r] = new Array(height);
    for (let c = 0; c < height; c++) out[r][c] = grid[height - 1 - c][r];
  }
  return out;
}

/** Shift every row sideways by an increasing amount — the diagonal drift of lace. */
export function shiftRows(matrix, stepFn) {
  for (let r = 0; r < matrix.length; r++) {
    const shift = stepFn(r, matrix[r]);
    if (!shift) continue;
    const row = matrix[r];
    const n = row.length;
    const k = ((shift % n) + n) % n;
    matrix[r] = row.slice(n - k).concat(row.slice(0, n - k));
  }
  return matrix;
}

/** Wrap a recipe in the metadata every preset in the library must carry. */
export function preset(spec) {
  if (!spec.id) throw new Error('preset() needs an id');
  if (!spec.name) throw new Error(`preset ${spec.id} needs a name`);
  if (!spec.family || !spec.group) throw new Error(`preset ${spec.id} needs family + group`);
  if (typeof spec.generate !== 'function') throw new Error(`preset ${spec.id} needs generate()`);
  return {
    repeat: [spec.cols, spec.rows],
    passesPerLaceRow: 4,
    balance: null,
    ...spec,
    tags: [...(spec.tags || [])]
  };
}

/**
 * Half-open interval test used by the shaping and edging recipes, where a motif is
 * defined by rows rather than by a periodic repeat.
 */
export function rowBand(r, start, end) {
  return r >= start && r <= end;
}

/** Pick a value from `list` by cycling with the row number. */
export function cycle(list, index) {
  return list[((index % list.length) + list.length) % list.length];
}

/**
 * Cheaper than a proof: assert at author time that a lace chart keeps its loop
 * count, so we never ship a card that drops needles out of work with nothing to
 * catch them. Used by the test suite rather than by the recipes themselves.
 */
export function assertBalanced(matrix, label = 'chart') {
  const imbalance = [];
  matrix.forEach((row, r) => {
    const delta = laceBalance(row);
    if (delta !== 0) imbalance.push(`row ${r}: ${delta > 0 ? '+' : ''}${delta}`);
  });
  if (imbalance.length) {
    throw new Error(`${label} is not stitch-balanced (${imbalance.slice(0, 4).join(', ')})`);
  }
  return true;
}
