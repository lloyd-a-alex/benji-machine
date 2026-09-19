/**
 * Selection sets, and the geometry that builds and edits them.
 *
 * The editor used to hold a selection as a rectangle `{r1,c1,r2,c2}`, which is
 * fine for a marquee and useless for everything else: a lasso, a flood-fill
 * region, "everything that is a yarnover", an inverted selection or a feathered
 * edge are none of them rectangles. So a selection here is a `Set` of `"r,c"`
 * keys — a set membership test is O(1), it survives a transform without losing
 * the cells you actually meant, and it can be diffed and measured.
 *
 * Nothing in this file touches the DOM, a canvas or the editor instance: every
 * function takes plain data and returns plain data, so the whole of selection
 * behaviour can be asserted under `node --test`.
 */

/** Row 7, column 12 → "7,12". Strings, because a Set of numbers cannot hold two axes. */
export const cellKey = (r, c) => `${r},${c}`;

export function parseCellKey(key) {
  const [r, c] = String(key).split(',');
  return { r: Number(r), c: Number(c) };
}

export function keysToCells(keys) {
  return [...keys].map(parseCellKey);
}

export function cellsToKeys(cells) {
  return new Set(cells.map(cell => (Array.isArray(cell) ? cellKey(cell[0], cell[1]) : cellKey(cell.r, cell.c))));
}

export function emptyKeys() {
  return new Set();
}

export function isInside(r, c, rows, cols) {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

/** Drop any key outside the grid, e.g. after the card shrinks. */
export function clipKeys(keys, rows, cols) {
  const out = new Set();
  for (const key of keys) {
    const { r, c } = parseCellKey(key);
    if (isInside(r, c, rows, cols)) out.add(key);
  }
  return out;
}

// ─── rectangles ──────────────────────────────────────────────────────────────

/** Order a dragged marquee so r1 ≤ r2 no matter which corner was grabbed. */
export function normalizeRect(rect) {
  if (!rect) return null;
  const r1 = Math.min(rect.r1, rect.r2);
  const r2 = Math.max(rect.r1, rect.r2);
  const c1 = Math.min(rect.c1, rect.c2);
  const c2 = Math.max(rect.c1, rect.c2);
  return { r1, r2, c1, c2 };
}

export function clampRect(rect, rows, cols) {
  const n = normalizeRect(rect);
  if (!n) return null;
  // A marquee that misses the card altogether must stay "nothing selected".
  // Clamping it onto the nearest edge instead would paint a phantom selection at
  // the border and then delete real stitches there.
  if (n.r1 > rows - 1 || n.r2 < 0 || n.c1 > cols - 1 || n.c2 < 0) return null;
  const r1 = Math.max(0, Math.min(n.r1, rows - 1));
  const r2 = Math.max(0, Math.min(n.r2, rows - 1));
  const c1 = Math.max(0, Math.min(n.c1, cols - 1));
  const c2 = Math.max(0, Math.min(n.c2, cols - 1));
  if (r1 > r2 || c1 > c2) return null;
  return { r1, r2, c1, c2 };
}

export function rectKeys(rect) {
  const out = new Set();
  if (!rect) return out;
  const n = normalizeRect(rect);
  for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) out.add(cellKey(r, c));
  return out;
}

/** Smallest rectangle covering a set of keys — the marquee the ruler draws. */
export function rectFromKeys(keys) {
  let r1 = Infinity;
  let r2 = -Infinity;
  let c1 = Infinity;
  let c2 = -Infinity;
  for (const key of keys) {
    const { r, c } = parseCellKey(key);
    if (r < r1) r1 = r;
    if (r > r2) r2 = r;
    if (c < c1) c1 = c;
    if (c > c2) c2 = c;
  }
  if (!Number.isFinite(r1)) return null;
  return { r1, r2, c1, c2 };
}

export function rectSize(rect) {
  const n = normalizeRect(rect);
  if (!n) return { w: 0, h: 0, cells: 0 };
  const w = n.c2 - n.c1 + 1;
  const h = n.r2 - n.r1 + 1;
  return { w, h, cells: w * h };
}

export function rectsIntersect(a, b) {
  if (!a || !b) return false;
  const x = normalizeRect(a);
  const y = normalizeRect(b);
  return !(x.c2 < y.c1 || y.c2 < x.c1 || x.r2 < y.r1 || y.r2 < x.r1);
}

export function wholeGridKeys(rows, cols) {
  return rectKeys({ r1: 0, c1: 0, r2: rows - 1, c2: cols - 1 });
}

// ─── growing and shrinking ───────────────────────────────────────────────────

const NEIGHBOURS_4 = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
];
const NEIGHBOURS_8 = NEIGHBOURS_4.concat([[-1, -1], [-1, 1], [1, -1], [1, 1]]);

function neighbourList(connectivity) {
  return connectivity === 8 ? NEIGHBOURS_8 : NEIGHBOURS_4;
}

/**
 * Grow a selection by `passes` cells.
 *
 * The growth is *additive per pass against the original set*, not cumulative
 * within one pass, otherwise a single "expand by 1" would smear along whichever
 * cell the iterator happened to reach first.
 */
export function expandKeys(keys, { rows, cols, passes = 1, connectivity = 4 } = {}) {
  const hood = neighbourList(connectivity);
  // The seed is clipped first: a selection that has drifted off the card (after a
  // resize, or hand-built) must not drag its off-card cells along into every
  // later operation.
  let current = clipKeys(keys, rows, cols);
  for (let p = 0; p < passes; p++) {
    const next = new Set(current);
    for (const key of current) {
      const { r, c } = parseCellKey(key);
      for (const [dr, dc] of hood) {
        const nr = r + dr;
        const nc = c + dc;
        if (isInside(nr, nc, rows, cols)) next.add(cellKey(nr, nc));
      }
    }
    current = next;
  }
  return current;
}

/** Shrink by deleting every cell that has a missing neighbour. */
export function contractKeys(keys, { rows, cols, passes = 1, connectivity = 4 } = {}) {
  const hood = neighbourList(connectivity);
  let current = clipKeys(keys, rows, cols);
  for (let p = 0; p < passes; p++) {
    const next = new Set();
    for (const key of current) {
      const { r, c } = parseCellKey(key);
      let solid = true;
      for (const [dr, dc] of hood) {
        if (!current.has(cellKey(r + dr, c + dc))) {
          solid = false;
          break;
        }
      }
      if (solid) next.add(key);
    }
    current = next;
  }
  return current;
}

/** Everything you did *not* pick — the single most-requested selection command. */
export function invertKeys(keys, { rows, cols } = {}) {
  const out = wholeGridKeys(rows, cols);
  for (const key of keys) out.delete(key);
  return out;
}

export function keysIntersect(a, b) {
  const [small, large] = a.size > b.size ? [b, a] : [a, b];
  const out = new Set();
  for (const key of small) if (large.has(key)) out.add(key);
  return out;
}

export function keysUnion(a, b) {
  return new Set([...a, ...b]);
}

export function keysSubtract(a, b) {
  const out = new Set(a);
  for (const key of b) out.delete(key);
  return out;
}

/**
 * Soften an edge.
 *
 * A knitting grid has no alpha channel: a needle either works or it does not. So
 * "feather" cannot mean a half-transparent ring — what it *can* mean, and what
 * colourwork designers actually do, is a dithered transition: the added ring
 * keeps alternate cells, so the boundary reads as a gradient of holes instead of
 * a cliff. Parity is fixed to (r + c) % 2 === 0 so the same selection always
 * feathers the same way, instead of crackling on every repaint.
 */
export function featherKeys(keys, { rows, cols, passes = 1 } = {}) {
  const base = clipKeys(keys, rows, cols);
  const ring = expandKeys(base, { rows, cols, passes });
  const out = new Set(base);
  const added = new Set();
  for (const key of ring) {
    if (base.has(key)) continue;
    const { r, c } = parseCellKey(key);
    if ((r + c) % 2 === 0) added.add(key);
  }
  return { keys: keysUnion(out, added), added };
}

// ─── building a selection from the chart ─────────────────────────────────────

export function valueAt(matrix, r, c) {
  const row = matrix[r];
  return row ? row[c] : undefined;
}

/**
 * Do two cells belong to the same region?
 *
 * `match: 'value'` is exact (a Fair Isle 1 is not a 0; a yarnover is not a
 * transfer). `match: 'punched'` is the punchcard view: everything that is not the
 * blank value is one region, which is what you want when filling a colour block
 * that happens to contain a few different lace glyphs.
 */
export function valuesMatch(a, b, { match = 'value', blank } = {}) {
  if (match === 'punched') {
    const aOn = a !== blank && a !== 0 && a !== false && a !== undefined;
    const bOn = b !== blank && b !== 0 && b !== false && b !== undefined;
    return aOn === bOn;
  }
  return a === b;
}

/**
 * Magic wand: the connected region touching (startR,startC).
 *
 * Returns `{ keys, size, capped }`. `capped` is set when the region is bigger
 * than `limit`, and then the selection is deliberately *not* returned: a wand
 * click on a blank 240×400 card would otherwise silently grab 96 000 cells and
 * the next Delete would wipe the pattern.
 */
export function floodRegion(
  matrix,
  startR,
  startC,
  { connectivity = 4, match = 'value', blank = null, limit = Infinity } = {}
) {
  const rows = matrix.length;
  const cols = matrix[0] ? matrix[0].length : 0;
  const keys = new Set();
  const capped = attempted => ({ keys: emptyKeys(), size: 0, capped: true, attempted });
  if (!isInside(startR, startC, rows, cols)) return { keys, size: 0, capped: false, attempted: 0 };
  const seed = valueAt(matrix, startR, startC);
  const hood = neighbourList(connectivity);
  const queue = [[startR, startC]];
  keys.add(cellKey(startR, startC));
  // The seed is counted too: a `limit` of 0 has to mean "select nothing", and a
  // caller that only checked the loop would hand back a one-cell selection.
  if (keys.size > limit) return capped(keys.size);
  while (queue.length) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of hood) {
      const nr = r + dr;
      const nc = c + dc;
      const key = cellKey(nr, nc);
      if (!isInside(nr, nc, rows, cols) || keys.has(key)) continue;
      if (!valuesMatch(valueAt(matrix, nr, nc), seed, { match, blank })) continue;
      keys.add(key);
      // `size` always describes `keys`, so a caller can trust either one; the
      // region it *would* have been is `attempted`, which is what the warning
      // needs to say before it refuses to delete half the card.
      if (keys.size > limit) return capped(keys.size);
      queue.push([nr, nc]);
    }
  }
  return { keys, size: keys.size, capped: false, attempted: keys.size };
}

/** "Select every cell of this stitch type", over the whole card or a subset. */
export function selectByValue(matrix, value, { within = null } = {}) {
  const out = new Set();
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r];
    for (let c = 0; c < row.length; c++) {
      if (within && !within.has(cellKey(r, c))) continue;
      if (row[c] === value) out.add(cellKey(r, c));
    }
  }
  return out;
}

export function selectWhere(matrix, predicate, { within = null } = {}) {
  const out = new Set();
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r];
    for (let c = 0; c < row.length; c++) {
      if (within && !within.has(cellKey(r, c))) continue;
      if (predicate(row[c], r, c)) out.add(cellKey(r, c));
    }
  }
  return out;
}

/** Shift-click a cell to add its whole region, or remove it when already there. */
export function toggleKeys(keys, addition, { rows = Infinity, cols = Infinity } = {}) {
  const incoming = clipKeys(addition, rows, cols);
  const kept = keysSubtract(keys, incoming);
  const gained = keysSubtract(incoming, keys);
  // A toggle is a symmetric difference, even when the region only half overlaps:
  // what was selected leaves and what was not arrives. Reporting "removed" and
  // silently dropping the unselected half would make a shift-drag eat cells the
  // pointer never touched.
  const out = new Set(kept);
  for (const key of gained) out.add(key);
  const removed = keys.size - kept.size;
  // The label names whichever half dominated, so the status line can read
  // "removed 3 stitches from the selection" instead of a vague "updated".
  return { keys: out, mode: removed > gained.size ? 'removed' : 'added', added: gained.size, removed };
}

// ─── lasso and freeform paths ────────────────────────────────────────────────

/**
 * Ray-casting point-in-polygon, on cell centres.
 *
 * The boundary is ignored deliberately: a freehand lasso is never exact, and
 * "the centre is inside" is the rule that makes a squiggle around a shape select
 * the shape rather than a ring of half-caught cells.
 */
export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = yi > y !== yj > y;
    if (!crosses) continue;
    const xAtY = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (x < xAtY) inside = !inside;
  }
  return inside;
}

/** Cells whose centre lies inside the lasso. Polygon points are `{r,c}` or `[r,c]`. */
export function polygonKeys(polygon, { rows, cols } = {}) {
  const out = new Set();
  if (!polygon || polygon.length < 3) return out;
  const pts = polygon.map(p => (Array.isArray(p) ? [p[0], p[1]] : [p.r, p.c]));
  const box = rectFromKeys(cellsToKeys(pts.map(r => ({ r: Math.floor(r[0]), c: Math.floor(r[1]) }))));
  const r1 = Math.max(0, Math.floor(box.r1));
  const r2 = Math.min((rows ?? Infinity) - 1, Math.ceil(box.r2));
  const c1 = Math.max(0, Math.floor(box.c1));
  const c2 = Math.min((cols ?? Infinity) - 1, Math.ceil(box.c2));
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      if (pointInPolygon(c, r, pts.map(([pr, pc]) => [pc, pr]))) out.add(cellKey(r, c));
    }
  }
  return out;
}

/** Bresenham, in (row, column) space. Always includes both endpoints. */
export function lineCells(r0, c0, r1, c1) {
  const cells = [];
  let r = Math.round(r0);
  let c = Math.round(c0);
  const tr = Math.round(r1);
  const tc = Math.round(c1);
  const dr = Math.abs(tr - r);
  const dc = Math.abs(tc - c);
  const sr = r < tr ? 1 : -1;
  const sc = c < tc ? 1 : -1;
  let err = dr - dc;
  for (let guard = 0; guard < 100000; guard++) {
    cells.push(cellKey(r, c));
    if (r === tr && c === tc) break;
    const e2 = 2 * err;
    if (e2 > -dc) {
      err -= dc;
      r += sr;
    }
    if (e2 < dr) {
      err += dr;
      c += sc;
    }
  }
  return new Set(cells);
}

/** Rectangle border only — the outline tools must not fill. */
export function rectOutlineCells(rect) {
  const n = normalizeRect(rect);
  const out = new Set();
  if (!n) return out;
  for (let c = n.c1; c <= n.c2; c++) {
    out.add(cellKey(n.r1, c));
    out.add(cellKey(n.r2, c));
  }
  for (let r = n.r1; r <= n.r2; r++) {
    out.add(cellKey(r, n.c1));
    out.add(cellKey(r, n.c2));
  }
  return out;
}

/** Ellipse in cell space, via the midpoint test so the ring is one cell thick. */
export function ellipseCells(r0, c0, r1, c1, { filled = false } = {}) {
  const n = normalizeRect({ r1: r0, c1: c0, r2: r1, c2: c1 });
  const out = new Set();
  if (!n) return out;
  const h = n.r2 - n.r1 + 1;
  const w = n.c2 - n.c1 + 1;
  const cr = n.r1 + (h - 1) / 2;
  const cc = n.c1 + (w - 1) / 2;
  const ar = Math.max(0.5, h / 2 - 0.5);
  const ac = Math.max(0.5, w / 2 - 0.5);
  const rMin = Math.floor(cr - ar - 1);
  const rMax = Math.ceil(cr + ar + 1);
  const cMin = Math.floor(cc - ac - 1);
  const cMax = Math.ceil(cc + ac + 1);
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      const d = ((r - cr) / ar) ** 2 + ((c - cc) / ac) ** 2;
      if (filled ? d <= 1.06 : Math.abs(d - 1) <= 0.34) out.add(cellKey(r, c));
    }
  }
  return out;
}

/**
 * A cubic Bézier, sampled and snapped to cells.
 *
 * Sample count scales with the control-point spread (8 per cell of extent) so a
 * 3-needle curve is not oversampled into 400 points and a 200-needle sweep is not
 * drawn as a polygon. Duplicates collapse in the returned Set, which is what
 * makes a coarse sampling harmless.
 */
export function bezierCells(p0, p1, p2, p3) {
  const spread = Math.max(
    Math.abs(p3.r - p0.r),
    Math.abs(p3.c - p0.c),
    Math.abs(p1.r - p0.r),
    Math.abs(p2.r - p0.r)
  );
  const steps = Math.max(16, Math.round(spread * 8));
  const out = new Set();
  const cubic = (a, b, c, d, t) => {
    const mt = 1 - t;
    return mt ** 3 * a + 3 * mt ** 2 * t * b + 3 * mt * t ** 2 * c + t ** 3 * d;
  };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.add(
      cellKey(
        Math.round(cubic(p0.r, p1.r, p2.r, p3.r, t)),
        Math.round(cubic(p0.c, p1.c, p2.c, p3.c, t))
      )
    );
  }
  return out;
}

/**
 * A smooth curve through *given* points (Catmull-Rom), for the "draw a lace
 * diagonal by clicking along it" workflow. Bézier needs handles nobody has.
 */
export function splineCells(points, { steps = 12 } = {}) {
  const pts = points.map(p => (Array.isArray(p) ? { r: p[0], c: p[1] } : { r: p.r, c: p.c }));
  if (pts.length < 2) return new Set(pts.map(p => cellKey(Math.round(p.r), Math.round(p.c))));
  const withEnds = [pts[0], ...pts, pts[pts.length - 1]];
  const out = new Set();
  const cr = (a, b, c, d, t) =>
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t ** 2 + (3 * b - a - 3 * c + d) * t ** 3);
  for (let i = 0; i + 3 < withEnds.length; i++) {
    const p0 = withEnds[i];
    const p1 = withEnds[i + 1];
    const p2 = withEnds[i + 2];
    const p3 = withEnds[i + 3];
    const extent = Math.max(Math.abs(p2.r - p1.r), Math.abs(p2.c - p1.c));
    const n = Math.max(2, Math.round((steps / 8) * (1 + extent)));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      out.add(cellKey(Math.round(cr(p0.r, p1.r, p2.r, p3.r, t)), Math.round(cr(p0.c, p1.c, p2.c, p3.c, t))));
    }
  }
  const last = withEnds[withEnds.length - 2];
  out.add(cellKey(Math.round(last.r), Math.round(last.c)));
  return out;
}

// ─── regions, alignment and distribution ─────────────────────────────────────

/**
 * Split a selection into its separate blobs (4-connectivity), each with a
 * bounding box. Align and distribute need "the N things you picked", and on a
 * chart the things are connected regions of cells, not objects with identities.
 */
export function regionsFromKeys(keys) {
  const remaining = new Set(keys);
  const regions = [];
  while (remaining.size) {
    const start = remaining.values().next().value;
    const stack = [start];
    const members = new Set();
    remaining.delete(start);
    while (stack.length) {
      const key = stack.pop();
      members.add(key);
      const { r, c } = parseCellKey(key);
      for (const [dr, dc] of NEIGHBOURS_4) {
        const nk = cellKey(r + dr, c + dc);
        if (remaining.has(nk)) {
          remaining.delete(nk);
          stack.push(nk);
        }
      }
    }
    regions.push({ keys: members, bounds: rectFromKeys(members) });
  }
  return regions.sort((a, b) => a.bounds.r1 - b.bounds.r1 || a.bounds.c1 - b.bounds.c1);
}

/**
 * Offsets that line N regions up against each other.
 *
 * The modes are named after *matrix indices*, not after the screen. That is
 * deliberate: row 0 is the cast-on edge, which the canvas draws at the bottom,
 * so a "top" that meant "smallest row number" would move the wrong way the first
 * time anybody flipped a chart. The UI labels these "align to cast-on edge",
 * "align to left needle" and so on, and says which edge it locked to.
 *
 *   min-col | max-col | centre-col | min-row | max-row | centre-row
 */
export function alignOffsets(boxes, mode = 'min-col') {
  const still = () => (boxes || []).map(() => ({ dr: 0, dc: 0 }));
  if (!boxes || boxes.length < 2) return still();
  const [which, axisName] = String(mode).split('-');
  if (!['min', 'max', 'centre'].includes(which) || !['col', 'row'].includes(axisName)) return still();
  const vertical = axisName === 'row';
  const lo = box => (vertical ? box.r1 : box.c1);
  const hi = box => (vertical ? box.r2 : box.c2);
  const anchor = box =>
    which === 'max' ? hi(box) : which === 'centre' ? (lo(box) + hi(box)) / 2 : lo(box);
  const target =
    which === 'max'
      ? Math.max(...boxes.map(hi))
      : which === 'centre'
        ? (Math.min(...boxes.map(lo)) + Math.max(...boxes.map(hi))) / 2
        : Math.min(...boxes.map(lo));
  return boxes.map(box => {
    const shift = Math.round(target - anchor(box));
    return vertical ? { dr: shift, dc: 0 } : { dr: 0, dc: shift };
  });
}

/**
 * Offsets that space N regions evenly along 'h' (needles) or 'v' (rows).
 *
 * The outermost two hold position and the ones between are re-placed with equal
 * gaps — which is what a knitter wants from "distribute the motifs", and what
 * keeps a border pattern inside the bed.
 */
export function distributeOffsets(boxes, axis = 'h') {
  const still = () => (boxes || []).map(() => ({ dr: 0, dc: 0 }));
  if (!boxes || boxes.length < 3) return still();
  const isH = axis !== 'v';
  const start = b => (isH ? b.c1 : b.r1);
  const size = b => (isH ? b.c2 - b.c1 + 1 : b.r2 - b.r1 + 1);
  const end = b => (isH ? b.c2 : b.r2);
  const order = boxes.map((box, index) => ({ box, index })).sort((a, b) => start(a.box) - start(b.box));
  const first = order[0].box;
  const last = order[order.length - 1].box;
  const span = end(last) - start(first) + 1;
  const totalSize = order.reduce((sum, item) => sum + size(item.box), 0);
  const gap = (span - totalSize) / (order.length - 1);
  const deltas = new Array(boxes.length).fill(null);
  let cursor = start(first);
  for (const { box, index } of order) {
    const shift = Math.round(cursor) - start(box);
    deltas[index] = isH ? { dr: 0, dc: shift } : { dr: shift, dc: 0 };
    cursor += size(box) + gap;
  }
  return deltas.map(delta => delta || { dr: 0, dc: 0 });
}

/**
 * Snap a moving value to the nearest guide within `threshold`.
 * Returns `{ value, snapped, guide }` so the UI can say which guide caught it.
 */
export function snapValue(value, guides = [], { threshold = 0.5 } = {}) {
  let best = null;
  for (const guide of guides) {
    const at = typeof guide === 'number' ? guide : guide.at;
    const distance = Math.abs(at - value);
    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { at, distance };
    }
  }
  if (!best) return { value, snapped: false, guide: null };
  return { value: best.at, snapped: true, guide: best.at };
}

export function moveKeysBy(keys, dr, dc) {
  const out = new Set();
  for (const key of keys) {
    const { r, c } = parseCellKey(key);
    out.add(cellKey(r + dr, c + dc));
  }
  return out;
}

/** How far a selection can slide in one direction before it leaves the card. */
export function maxMove(keys, { rows, cols }, dr, dc) {
  let limit = Infinity;
  for (const key of keys) {
    const { r, c } = parseCellKey(key);
    const spanR = dr > 0 ? rows - 1 - r : r;
    const spanC = dc > 0 ? cols - 1 - c : c;
    const room = dr !== 0 ? spanR / Math.abs(dr) : dc !== 0 ? spanC / Math.abs(dc) : 0;
    limit = Math.min(limit, Math.floor(room));
  }
  return Number.isFinite(limit) ? limit : 0;
}
