/**
 * Guides, repeats and snapping: the ruler the missing-tools list asked for.
 *
 * A guide is a line at a fractional cell position that nothing is drawn *on* — it
 * exists so the eye can line a repeat up, and so a drag can be caught and made
 * exact. That distinction matters for knitting: guides never reach the punchcard, so
 * a knitter can lay out 12 repeats of a motif with lines everywhere and still
 * compile a clean card.
 *
 * Repeats are guides with two edges: a rectangle that the editor can tile, count
 * and (crucially) fill. `repeatTiles` is the arithmetic that answers "how many times
 * does this motif fit across 200 needles" — which is the first question anybody
 * asks when they design for a machine, and the one a pixel-based canvas never
 * answers.
 */

import { clampRect, normalizeRect, snapValue, alignOffsets, distributeOffsets, regionsFromKeys, moveKeysBy, rectFromKeys } from './select-ops.js';

let guideCounter = 0;

function nextId(prefix) {
  guideCounter += 1;
  return `${prefix}${guideCounter}`;
}

export const GUIDE_AXES = ['col', 'row'];

/** A vertical guide is `axis: 'col'` (it sits at a needle position). */
export function createGuide({ at = 0, axis = 'col', name = null, locked = false, color = null, id = null } = {}) {
  const position = Number(at);
  if (!Number.isFinite(position)) return null;
  return {
    id: id || nextId('guide'),
    axis: GUIDE_AXES.includes(axis) ? axis : 'col',
    at: position,
    name: name || (axis === 'col' ? `Needle ${position + 1}` : `Row ${position + 1}`),
    locked: Boolean(locked),
    color
  };
}

export function addGuide(guides, spec) {
  const guide = createGuide(spec);
  if (!guide) return { ok: false, error: 'A guide needs a numeric position.', guides };
  guides.push(guide);
  return { ok: true, guide, guides };
}

export function removeGuide(guides, id) {
  const before = guides.length;
  const out = guides.filter(guide => guide.id !== id);
  guides.length = 0;
  guides.push(...out);
  return { ok: guides.length < before, removed: before - guides.length, guides };
}

export function moveGuide(guides, id, at, { rows = Infinity, cols = Infinity } = {}) {
  const guide = guides.find(candidate => candidate.id === id);
  if (!guide) return { ok: false, error: 'That guide is gone.', guides };
  if (guide.locked) return { ok: false, error: `"${guide.name}" is locked.`, guides };
  const limit = guide.axis === 'col' ? cols : rows;
  const position = Number(at);
  if (!Number.isFinite(position)) return { ok: false, error: 'A guide needs a numeric position.', guides };
  guide.at = Math.max(-0.5, Math.min(limit + 0.5, position));
  guide.name = guide.axis === 'col' ? `Needle ${guide.at + 1}` : `Row ${guide.at + 1}`;
  return { ok: true, guide, guides };
}

export function toggleGuideLock(guides, id) {
  const guide = guides.find(candidate => candidate.id === id);
  if (!guide) return { ok: false, error: 'That guide is gone.', guides };
  guide.locked = !guide.locked;
  return { ok: true, locked: guide.locked, guides };
}

export function guidesOnAxis(guides, axis) {
  return guides.filter(guide => guide.axis === axis).sort((a, b) => a.at - b.at);
}

/** The guide positions a snapper needs: plain numbers, cheapest comparison first. */
export function guideValues(guides, axis) {
  return guidesOnAxis(guides, axis).map(guide => guide.at);
}

// ─── repeats ─────────────────────────────────────────────────────────────────

export function createRepeat({ r1 = 0, c1 = 0, r2 = 0, c2 = 0, name = 'Repeat', id = null } = {}) {
  const rect = normalizeRect({ r1, c1, r2, c2 });
  if (!rect) return null;
  return { id: id || nextId('repeat'), name: String(name), ...rect, rows: rect.r2 - rect.r1 + 1, cols: rect.c2 - rect.c1 + 1 };
}

export function addRepeat(repeats, spec) {
  const repeat = createRepeat(spec);
  if (!repeat) return { ok: false, error: 'That repeat has no cells in it.', repeats };
  repeats.push(repeat);
  return { ok: true, repeat, repeats };
}

export function removeRepeat(repeats, id) {
  const before = repeats.length;
  const out = repeats.filter(repeat => repeat.id !== id);
  repeats.length = 0;
  repeats.push(...out);
  return { ok: repeats.length < before, repeats };
}

/**
 * Where the repeat tiles on the card, in tiles-across × tiles-down.
 *
 * A partial tile at the far edge is reported but marked, because "it fits 8 times
 * with 4 needles left over" is the honest answer a knitter needs before committing
 * to a motif width — and 24-stitch punchcard windows make this arithmetic constant.
 */
export function repeatTiles(repeat, rows, cols, { startR = 0, startC = 0 } = {}) {
  if (!repeat || repeat.rows <= 0 || repeat.cols <= 0) {
    return { ok: false, error: 'No repeat selected.', across: 0, down: 0, tiles: [] };
  }
  const across = Math.floor(cols / repeat.cols);
  const down = Math.floor(rows / repeat.rows);
  const tiles = [];
  for (let i = 0; i < down; i++) {
    for (let j = 0; j < across; j++) {
      tiles.push({
        row: i,
        col: j,
        r1: startR + i * repeat.rows,
        c1: startC + j * repeat.cols,
        rows: repeat.rows,
        cols: repeat.cols,
        partial: false
      });
    }
  }
  const leftoverCols = cols - across * repeat.cols;
  const leftoverRows = rows - down * repeat.rows;
  return {
    ok: true,
    across,
    down,
    tiles,
    leftoverCols,
    leftoverRows,
    coversWholeCard: leftoverCols === 0 && leftoverRows === 0,
    // The phrasing the UI shows: it has to say what does not fit, not just nod.
    summary: `${across} × ${down} tiles` + (leftoverCols || leftoverRows ? `, ${leftoverCols} needle(s) and ${leftoverRows} row(s) left over` : ', exact fit')
  };
}

/** Every cell inside a tiled repeat, for "fill the whole card with this repeat". */
export function tiledKeys(repeat, rows, cols, options = {}) {
  const result = repeatTiles(repeat, rows, cols, options);
  const keys = new Set();
  if (!result.ok) return keys;
  for (const tile of result.tiles) {
    for (let r = tile.r1; r < tile.r1 + tile.rows; r++) {
      for (let c = tile.c1; c < tile.c1 + tile.cols; c++) keys.add(`${r},${c}`);
    }
  }
  return keys;
}

// ─── snapping ────────────────────────────────────────────────────────────────

export const DEFAULT_SNAP = { enabled: true, threshold: 0.45, guides: true, cells: true, repeats: true };

export function snapConfig(overrides = {}) {
  return { ...DEFAULT_SNAP, ...overrides };
}

/**
 * Snap one drag position.
 *
 * Order of preference is guides → repeat edges → whole cells, because a guide is the
 * thing the user put there on purpose and a cell boundary is the thing the machine
 * requires anyway. Returns the original value when nothing catches it, so a slow,
 * careful drag is never fought by the tool.
 */
export function snapPosition(value, { guides = [], repeats = [], axis = 'col', config = DEFAULT_SNAP } = {}) {
  const settings = snapConfig(config);
  if (!settings.enabled) return { value, snapped: false, guide: null, kind: null };
  if (settings.guides && guides.length) {
    const hit = snapValue(value, guides, { threshold: settings.threshold });
    if (hit.snapped) return { ...hit, kind: 'guide' };
  }
  if (settings.repeats && repeats.length) {
    const edges = [];
    for (const repeat of repeats) {
      edges.push(axis === 'col' ? repeat.c1 : repeat.r1);
      edges.push((axis === 'col' ? repeat.c2 : repeat.r2) + 1);
    }
    const hit = snapValue(value, edges, { threshold: settings.threshold });
    if (hit.snapped) return { ...hit, kind: 'repeat' };
  }
  if (settings.cells) {
    // Quantise, do not second-guess: a needle is a whole needle, so once cell
    // snapping is on, a position between two of them is always pulled to the closer
    // one. A threshold here would be arbitrary — every position is within 0.5 of a
    // whole number, so it would snap almost everything anyway and leave a dead zone
    // at the half-way point for no reason.
    const nearest = Math.round(value);
    return { value: nearest, snapped: nearest !== value, guide: nearest, kind: 'cell' };
  }
  return { value, snapped: false, guide: null, kind: null };
}

// ─── applying alignment to a live selection ──────────────────────────────────

/**
 * Align the regions of a selection and return the moved key set.
 *
 * `select-ops` does the arithmetic; this does the bookkeeping: each disconnected
 * region is moved as a unit, and a move that would push a region off the card is
 * refused for that region rather than clipped, because half a motif arriving at the
 * edge is worse than none.
 */
export function applyAlign(keys, mode, { rows, cols, groups = null } = {}) {
  const parts = splitByKeys(keys, groups);
  const boxes = parts.map(region => regionFromKeys(region));
  const offsets = alignOffsets(boxes, mode);
  return moveGroups(parts, offsets, { rows, cols });
}

export function applyDistribute(keys, axis, { rows, cols, groups = null } = {}) {
  const parts = splitByKeys(keys, groups);
  const boxes = parts.map(region => regionFromKeys(region));
  const offsets = distributeOffsets(boxes, axis);
  return moveGroups(parts, offsets, { rows, cols });
}

function regionFromKeys(keys) {
  const rect = rectFromKeys(keys);
  return rect ? { r1: rect.r1, r2: rect.r2, c1: rect.c1, c2: rect.c2 } : { r1: 0, r2: -1, c1: 0, c2: -1 };
}

/** Split a selection into its disconnected pieces, or into the given groups. */
function splitByKeys(keys, groups) {
  if (Array.isArray(groups) && groups.length) {
    return groups.map(group => (group instanceof Set ? group : new Set(group)));
  }
  return regionsFromKeys(keys).map(region => region.keys);
}

function moveGroups(groups, offsets, { rows, cols }) {
  let out = new Set();
  let moved = 0;
  const blocked = [];
  for (let i = 0; i < groups.length; i++) {
    const delta = offsets[i] || { dr: 0, dc: 0 };
    const shifted = moveKeysBy(groups[i], delta.dr, delta.dc);
    const clipped = clampKeysTo(shifted, rows, cols);
    if (clipped.length) {
      blocked.push({ index: i, cells: clipped.length });
      continue;
    }
    for (const key of shifted) out.add(key);
    if (delta.dr || delta.dc) moved++;
  }
  return { keys: out, moved, blocked, regions: groups.length };
}

function clampKeysTo(keys, rows, cols) {
  if (!Number.isFinite(rows) && !Number.isFinite(cols)) return [];
  const outside = [];
  for (const key of keys) {
    const [r, c] = key.split(',').map(Number);
    if (r < 0 || c < 0 || (Number.isFinite(rows) && r >= rows) || (Number.isFinite(cols) && c >= cols)) outside.push(key);
  }
  return outside;
}

/** Guide/rect helpers used by the renderer; kept here so drawing code stays dumb. */
export function normalizeGuideList(guides = []) {
  return guides
    .filter(guide => guide && Number.isFinite(guide.at))
    .map(guide => ({ ...guide, axis: guide.axis === 'row' ? 'row' : 'col' }));
}

export function rectWithin(rect, rows, cols) {
  return clampRect(rect, rows, cols);
}
