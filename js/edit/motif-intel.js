/**
 * KNITCAT — Motif & Shape Intelligence.
 *
 * The companion to {@link module:edit/pattern-intel}. Where Pattern Intelligence asks
 * "is the *card* the right shape" (crop, tile, repeat, symmetry, speckle), this module
 * asks "what *shapes* are inside it" — the connected figures a knitter actually sees,
 * and the morphological edits that thicken, thin, outline or close them.
 *
 * It is deliberately stacked on top of the primitives the two earlier layers already
 * own rather than re-deriving them: cell blank/punched semantics come from
 * `js/edit/modes.js`, the bounding-box and morphological neighbourhood helpers and the
 * symmetry scores come from `js/edit/pattern-intel.js`, and the run/float numbers stay
 * in `js/core/chart-analysis.js`. Nothing here duplicates those — this is the *shape*
 * vocabulary that was missing.
 *
 * Why content morphology and motif detection matter at the machine and not just on
 * screen:
 *
 *   - A scanned or hand-punched card is a cloud of holes; the knitter thinks in
 *     *figures* (leaves, diamonds, cables). Counting and locating the connected
 *     components turns "there's something in the corner" into "three motifs, the big
 *     one 8 stitches wide".
 *   - Isolated single stitches catch on the carriage and thin webs sag; a sturdier
 *     fabric is one dilate away. Conversely a mushy blob of colour is one erode away
 *     from a crisp shape.
 *   - A colorwork edging wants the *outline* of a motif in a contrasting yarn; a
 *     structural area wants its enclosed holes punched closed so the fabric does not
 *     cave in.
 *
 * Conventions match Pattern Intelligence exactly: modifying verbs return
 * `{ ok, matrix, … }` (or `{ ok:false, error | oversize }` and change nothing), read-only
 * analysis returns a plain object, ragged input is squared first, and a horizontal
 * mirror corrects lace transfer handedness with `mirrorValue`.
 *
 * @module edit/motif-intel
 */

import { blankValue, isPunched } from './modes.js';
import { mirrorValue } from './chart-ops.js';
import { square, punchedValue, neighbors, symmetryReport } from './pattern-intel.js';

const clampInt = (n, min, max) => Math.max(min, Math.min(max, Number.isFinite(n) ? Math.trunc(n) : min));

// ─── 1. connected components (motifs) ────────────────────────────────────────

const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];
/** The eight Moore directions, for erosion and boundary tests that zero-pad the card. */
const DIRS8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

/**
 * Label every contiguous group of worked cells. `connectivity` 8 treats diagonals as
 * touching (a chain of eyelets reads as one motif); 4 keeps corner-touching figures
 * separate. Returns the regions in first-seen order with their cell list, area and
 * tight bounds, plus a `labels` matrix (`0` = not worked, `n>0` = the nth region) so a
 * caller can recolour or spotlight per motif.
 *
 * @param {Array<Array<*>>} matrix
 * @param {object} [opts]
 * @param {string} [opts.mode='lace']
 * @param {4|8} [opts.connectivity=8]
 * @returns {{ok:true, count:number, regions:Array<{label:number, cells:Array<Array<number>>, area:number, r1:number, c1:number, r2:number, c2:number, rows:number, cols:number}>, labels:Array<Array<number>>, rows:number, cols:number}}
 */
export function connectedComponents(matrix, { mode = 'lace', connectivity = 8 } = {}) {
  const src = square(matrix, mode);
  const blank = blankValue(mode);
  const rows = src.length;
  const cols = src[0].length;
  const labels = new Array(rows);
  for (let r = 0; r < rows; r++) labels[r] = new Array(cols).fill(0);
  const deltas = connectivity === 4 ? ORTHOGONAL : [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const regions = [];
  let label = 0;
  const stack = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (labels[r][c] || !isPunched(mode, src[r][c])) continue;
      label++;
      const cells = [];
      let r1 = r;
      let r2 = r;
      let c1 = c;
      let c2 = c;
      stack.push([r, c]);
      labels[r][c] = label;
      while (stack.length) {
        const [cr, cc] = stack.pop();
        cells.push([cr, cc]);
        if (cr < r1) r1 = cr;
        if (cr > r2) r2 = cr;
        if (cc < c1) c1 = cc;
        if (cc > c2) c2 = cc;
        for (const [dr, dc] of deltas) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (labels[nr][nc] || !isPunched(mode, src[nr][nc])) continue;
          labels[nr][nc] = label;
          stack.push([nr, nc]);
        }
      }
      regions.push({ label, cells, area: cells.length, r1, c1, r2, c2, rows: r2 - r1 + 1, cols: c2 - c1 + 1 });
    }
  }
  return { ok: true, count: regions.length, regions, labels, rows, cols, blank };
}

/**
 * A one-glance summary of the figures on the card — how many, the largest, and the
 * median size — the read-only digest the Shape menu reports.
 */
export function motifSummary(matrix, { mode = 'lace', connectivity = 8 } = {}) {
  const cc = connectedComponents(matrix, { mode, connectivity });
  if (!cc.count) return { ok: true, count: 0, largest: null, total: 0, isolated: 0, isolatedCells: [] };
  let largest = cc.regions[0];
  let total = 0;
  const isolatedCells = [];
  for (const reg of cc.regions) {
    if (reg.area > largest.area) largest = reg;
    total += reg.area;
    if (reg.area === 1) isolatedCells.push(reg.cells[0]);
  }
  return { ok: true, count: cc.count, total, isolated: isolatedCells.length, isolatedCells, largest };
}

// ─── 2. content morphology ───────────────────────────────────────────────────

/**
 * Grow the worked area outward: every blank cell touching a worked cell (8-way) becomes
 * worked, repeated `iterations` times. The sturdi-fier — it welds single-stitch chains
 * into carriage-safe ribbons. Lace gains eyelets along the edge; direct modes gain
 * punched cells.
 */
export function dilateContent(matrix, { mode = 'lace', iterations = 1 } = {}) {
  let src = square(matrix, mode);
  const blank = blankValue(mode);
  const fill = punchedValue(mode);
  const times = clampInt(iterations, 1, 64);
  let added = 0;
  for (let pass = 0; pass < times; pass++) {
    const rows = src.length;
    const cols = src[0].length;
    const out = src.map(row => [...row]);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (isPunched(mode, src[r][c])) continue;
        for (const [nr, nc] of neighbors(r, c, rows, cols)) {
          if (isPunched(mode, src[nr][nc])) {
            out[r][c] = fill;
            added++;
            break;
          }
        }
      }
    }
    src = out;
  }
  return { ok: true, matrix: src, added, iterations: times, blank };
}

/**
 * Shrink the worked area inward: a worked cell survives only when all eight of its
 * neighbours are also worked, with anything past the card edge read as blank — so a
 * shape that touches the border is treated as having boundary there too. Repeated
 * `iterations` times. The crisper — it peels fuzz off a mushy colour block.
 */
export function erodeContent(matrix, { mode = 'lace', iterations = 1 } = {}) {
  let src = square(matrix, mode);
  const blank = blankValue(mode);
  const times = clampInt(iterations, 1, 64);
  let removed = 0;
  for (let pass = 0; pass < times; pass++) {
    const rows = src.length;
    const cols = src[0].length;
    const out = src.map(row => [...row]);
    let changedThisPass = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isPunched(mode, src[r][c])) continue;
        let stripped = false;
        for (const [dr, dc] of DIRS8) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || !isPunched(mode, src[nr][nc])) {
            stripped = true;
            break;
          }
        }
        if (stripped) {
          out[r][c] = blank;
          removed++;
          changedThisPass = true;
        }
      }
    }
    src = out;
    if (!changedThisPass) break;
  }
  return { ok: true, matrix: src, removed, iterations: times };
}

/**
 * Keep only the boundary band of the worked area — the outer `thickness` rings of
 * stitches — blanking the interior. Built from erosion so a thickness of 1 is exactly
 * "cells an erode would remove", thickness 2 keeps one more ring, and so on. The
 * contrasting-outlining tool for colorwork edgings.
 */
export function outlineContent(matrix, { mode = 'lace', thickness = 1 } = {}) {
  const src = square(matrix, mode);
  const blank = blankValue(mode);
  const t = clampInt(thickness, 1, 64);
  const inner = erodeContent(src, { mode, iterations: t }).matrix;
  const rows = src.length;
  const cols = src[0].length;
  const out = new Array(rows);
  let kept = 0;
  for (let r = 0; r < rows; r++) {
    out[r] = new Array(cols).fill(blank);
    for (let c = 0; c < cols; c++) {
      const wasWorked = isPunched(mode, src[r][c]);
      const stillWorked = isPunched(mode, inner[r][c]);
      if (wasWorked && !stillWorked) {
        out[r][c] = src[r][c];
        kept++;
      }
    }
  }
  return { ok: true, matrix: out, kept };
}

/**
 * Punch closed every *enclosed* blank — a blank not reachable from the card edge
 * through other blanks. Unlike the single-cell `fillSpecks`, this closes holes of any
 * size (a whole white diamond inside a colour block), which is what stops a colorwork
 * fabric caving in. Border-touching background is left alone.
 */
export function fillEnclosedHoles(matrix, { mode = 'lace' } = {}) {
  const src = square(matrix, mode);
  const blank = blankValue(mode);
  const fill = punchedValue(mode);
  const rows = src.length;
  const cols = src[0].length;
  // Reachability flood of blanks from every edge blank cell (4-way: background seeps
  // orthogonally, so a diagonally-pinched gap still counts as sealed).
  const reachable = new Array(rows);
  for (let r = 0; r < rows; r++) reachable[r] = new Array(cols).fill(false);
  const stack = [];
  const seed = (r, c) => {
    if (!isPunched(mode, src[r][c]) && !reachable[r][c]) {
      reachable[r][c] = true;
      stack.push([r, c]);
    }
  };
  for (let r = 0; r < rows; r++) {
    seed(r, 0);
    seed(r, cols - 1);
  }
  for (let c = 0; c < cols; c++) {
    seed(0, c);
    seed(rows - 1, c);
  }
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [dr, dc] of ORTHOGONAL) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (reachable[nr][nc] || isPunched(mode, src[nr][nc])) continue;
      reachable[nr][nc] = true;
      stack.push([nr, nc]);
    }
  }
  const out = src.map(row => [...row]);
  let filled = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isPunched(mode, src[r][c]) && !reachable[r][c]) {
        out[r][c] = fill;
        filled++;
      }
    }
  }
  return { ok: true, matrix: out, filled, blank };
}

// ─── 3. symmetry classification + kaleidoscope ───────────────────────────────

/**
 * Turn the raw {@link symmetryReport} fractions into a verdict: does the card hold a
 * left↔right (vertical axis), top↔bottom (horizontal axis) and/or 180° mirror within
 * `tolerance` (default near-exact), and a short human name for the combination.
 */
export function classifySymmetry(matrix, { mode = 'lace', tolerance = 0.98 } = {}) {
  const rep = symmetryReport(matrix, { mode });
  const tol = clampInt(tolerance * 100, 0, 100) / 100;
  const vertical = rep.vertical.pct >= tol;
  const horizontal = rep.horizontal.pct >= tol;
  const rotational = rep.rotational.pct >= tol;
  let name = 'asymmetric';
  if (vertical && horizontal && rotational) name = 'fully mirrored';
  else if (vertical && horizontal) name = 'four-way symmetric';
  else if (vertical) name = 'left–right symmetric';
  else if (horizontal) name = 'top–bottom symmetric';
  else if (rotational) name = 'two-fold (180°) symmetric';
  return {
    ok: true,
    vertical,
    horizontal,
    rotational,
    name,
    scores: { vertical: rep.vertical.pct, horizontal: rep.horizontal.pct, rotational: rep.rotational.pct }
  };
}

/**
 * Build a symmetric field from one corner motif by reflecting it across both axes into
 * four quadrants — a whole kaleidoscope from a quarter of the work. Lace transfers are
 * re-handed on the mirrored axes (`mirrorValue`) so the reflected quarters still knit
 * true. Optionally tile the finished symmetric block `across`×`down`.
 *
 * @param {Array<Array<*>>} matrix  the source, treated as the top-left quadrant
 * @param {object} [opts]
 * @param {string} [opts.mode='lace']
 * @param {number} [opts.across=1]  repeats of the kaleidoscope block, wide
 * @param {number} [opts.down=1]    repeats of the block, tall
 * @param {number} [opts.maxRows]
 * @param {number} [opts.maxCols]
 */
export function kaleidoscope(matrix, { mode = 'lace', across = 1, down = 1, maxRows = Infinity, maxCols = Infinity } = {}) {
  const src = square(matrix, mode);
  const h = src.length;
  const w = src[0].length;
  // top-left original, top-right flipped in columns, bottom-left flipped in rows,
  // bottom-right flipped in both — each horizontal reflection re-hands transfers.
  const block = new Array(h * 2);
  for (let r = 0; r < h * 2; r++) block[r] = new Array(w * 2);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const v = src[r][c];
      block[r][c] = v;
      block[r][2 * w - 1 - c] = mirrorValue(v, 'flipH');
      block[2 * h - 1 - r][c] = v;
      block[2 * h - 1 - r][2 * w - 1 - c] = mirrorValue(v, 'flipH');
    }
  }
  const a = clampInt(across, 1, 100);
  const d = clampInt(down, 1, 100);
  const rows = h * 2 * d;
  const cols = w * 2 * a;
  if (rows > maxRows || cols > maxCols) {
    return { ok: false, oversize: { rows, cols, maxRows, maxCols } };
  }
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const band = block[r % (h * 2)];
    const row = new Array(cols);
    for (let tileC = 0; tileC < a; tileC++) for (let c = 0; c < w * 2; c++) row[tileC * w * 2 + c] = band[c];
    out[r] = row;
  }
  return { ok: true, matrix: out, across: a, down: d };
}
