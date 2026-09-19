/**
 * Layers: more than one drawing on the same card.
 *
 * A knitter's reasons for layers are specific, and the design follows them:
 *
 *   - a colourwork chart over a stitch-pattern base, so the float analysis can be
 *     run on one without erasing the other;
 *   - an eyelet layer over a plain layer, so a repeat can be tried and peeled off;
 *   - a "notes" layer of arrows and pins that must never reach the punchcard;
 *   - the reference image / tracing layer from the missing-tools list.
 *
 * The rule that makes compositing predictable is *topmost non-blank wins*: a layer
 * only speaks for a cell when it has something there. That is what makes a layer
 * stack safe on a needle bed — a hidden layer cannot contribute stitches, and an
 * empty layer cannot punch holes by accident.
 *
 * Every layer is a plain matrix of the stack's size. Keeping them that way means
 * every operation in `chart-ops.js` works on a layer unchanged, instead of needing
 * a second copy of the whole editor.
 */

import { blankValue, convertRegionBetweenModes } from './modes.js';
import { cloneMatrix, makeMatrix, matrixInfo } from './chart-ops.js';

let layerCounter = 0;

function nextLayerId(prefix = 'layer') {
  layerCounter += 1;
  return `${prefix}${layerCounter}`;
}

/**
 * Layer `kind` decides what may happen to it.
 *   pattern     — reaches the carriage
 *   reference   — an image underlay; never compiles, always drawn first
 *   annotation  — labels and pins; never compiles
 */
export const LAYER_KINDS = ['pattern', 'reference', 'annotation'];

export function compileRelevant(kind) {
  return kind === 'pattern';
}

export function createLayer({
  rows = 0,
  cols = 0,
  mode = 'lace',
  name = 'Layer',
  kind = 'pattern',
  visible = true,
  locked = false,
  opacity = 1,
  id = null
} = {}) {
  const blank = blankValue(mode);
  return {
    id: id || nextLayerId(kind === 'pattern' ? 'pattern' : kind),
    name: String(name),
    kind: LAYER_KINDS.includes(kind) ? kind : 'pattern',
    visible: Boolean(visible),
    locked: Boolean(locked),
    opacity: clampOpacity(opacity),
    mode,
    // A fully blank matrix, not a sparse map: every chart operation is written
    // against a rectangular grid, and a sparse layer would need its own version of
    // all of them. The blank itself is always derived from `mode` — storing it too
    // would be a second source of truth, and the two would drift on the first
    // Fair Isle → lace conversion.
    matrix: rows > 0 && cols > 0 ? makeMatrix(rows, cols, { mode }) : []
  };
}

export function clampOpacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

/**
 * A new stack. `layers` is bottom-first: index 0 is drawn under everything, which
 * is the order a compositor wants and the reverse of what most people picture, so
 * the panel labels it explicitly rather than relying on the reader knowing.
 */
export function createStack({ rows = 0, cols = 0, mode = 'lace', name = 'Pattern' } = {}) {
  const base = createLayer({ rows, cols, mode, name: 'Base' });
  return { name: String(name), mode, rows, cols, layers: [base], activeId: base.id };
}

export function stackInfo(stack) {
  const { rows, cols } = matrixInfo(topPatternMatrix(stack) || []);
  return {
    layers: stack.layers.length,
    rows: stack.rows || rows,
    cols: stack.cols || cols,
    mode: stack.mode,
    visible: stack.layers.filter(layer => layer.visible && compileRelevant(layer.kind)).length,
    locked: stack.layers.filter(layer => layer.locked).length
  };
}

export function findLayer(stack, id) {
  return stack.layers.find(layer => layer.id === id) || null;
}

export function activeLayer(stack) {
  return findLayer(stack, stack.activeId) || stack.layers[stack.layers.length - 1] || null;
}

export function indexOf(stack, id) {
  return stack.layers.findIndex(layer => layer.id === id);
}

/** Top-most *pattern* matrix — what the compiler and the punchcard preview read. */
export function topPatternMatrix(stack) {
  for (let i = stack.layers.length - 1; i >= 0; i--) {
    if (compileRelevant(stack.layers[i].kind)) return stack.layers[i].matrix;
  }
  return [];
}

export function addLayer(
  stack,
  { at = stack.layers.length, name = `Layer ${stack.layers.length + 1}`, kind = 'pattern', copyFrom = null, visible = true, locked = false, opacity = 1 } = {}
) {
  const rows = stack.rows || matrixInfo(topPatternMatrix(stack)).rows;
  const cols = stack.cols || matrixInfo(topPatternMatrix(stack)).cols;
  const layer = createLayer({ rows, cols, mode: stack.mode, name, kind, visible, locked, opacity });
  if (copyFrom) {
    const source = findLayer(stack, copyFrom) || activeLayer(stack);
    if (source) layer.matrix = cloneMatrix(source.matrix);
  }
  const index = Math.max(0, Math.min(stack.layers.length, Math.trunc(at)));
  stack.layers.splice(index, 0, layer);
  stack.activeId = layer.id;
  return layer;
}

/**
 * Remove a layer — unless it is the last pattern layer standing.
 *
 * An empty card is a valid design state; a card with nowhere to draw is a crash
 * waiting for the next click, so the stack always keeps one writable pattern layer.
 */
export function removeLayer(stack, id) {
  const layer = findLayer(stack, id);
  if (!layer) return { ok: false, error: 'That layer is gone.', stack };
  const patterns = stack.layers.filter(candidate => compileRelevant(candidate.kind));
  if (compileRelevant(layer.kind) && patterns.length <= 1) {
    return { ok: false, error: 'A pattern needs at least one drawing layer. Clear it instead?', stack };
  }
  stack.layers = stack.layers.filter(candidate => candidate.id !== id);
  if (stack.activeId === id) {
    const next = activeLayer(stack);
    stack.activeId = next ? next.id : null;
  }
  return { ok: true, removed: layer.id, name: layer.name, stack };
}

export function setLayerProperty(stack, id, key, value) {
  const layer = findLayer(stack, id);
  if (!layer) return { ok: false, error: 'That layer is gone.', stack };
  if (key === 'opacity') layer.opacity = clampOpacity(value);
  else if (key === 'visible' || key === 'locked') layer[key] = Boolean(value);
  else if (key === 'name') layer.name = String(value).slice(0, 64) || layer.name;
  else if (key === 'kind') layer.kind = LAYER_KINDS.includes(value) ? value : layer.kind;
  else if (key === 'matrix') layer.matrix = Array.isArray(value) ? cloneMatrix(value) : layer.matrix;
  else return { ok: false, error: `Unknown layer property "${key}".`, stack };
  return { ok: true, layer, stack };
}

export function renameLayer(stack, id, name) {
  return setLayerProperty(stack, id, 'name', name);
}

export function setLayerVisible(stack, id, visible) {
  return setLayerProperty(stack, id, 'visible', visible);
}

export function setLayerLocked(stack, id, locked) {
  return setLayerProperty(stack, id, 'locked', locked);
}

export function toggleLayerVisible(stack, id) {
  const layer = findLayer(stack, id);
  if (!layer) return { ok: false, error: 'That layer is gone.', stack };
  layer.visible = !layer.visible;
  return { ok: true, visible: layer.visible, stack };
}

export function reorderLayer(stack, id, toIndex) {
  const from = indexOf(stack, id);
  if (from < 0) return { ok: false, error: 'That layer is gone.', stack };
  const target = Math.max(0, Math.min(stack.layers.length - 1, Math.trunc(toIndex)));
  if (target === from) return { ok: true, moved: false, from, to: target, stack };
  const [layer] = stack.layers.splice(from, 1);
  stack.layers.splice(target, 0, layer);
  return { ok: true, moved: true, from, to: target, stack };
}

export function moveLayerBy(stack, id, delta) {
  const from = indexOf(stack, id);
  if (from < 0) return { ok: false, error: 'That layer is gone.', stack };
  return reorderLayer(stack, id, from + Math.trunc(delta));
}

/** The cell that wins for a layer, or `null` when the layer says nothing. */
function contribution(layer, r, c) {
  if (!layer.visible) return null;
  const row = layer.matrix[r];
  if (!row || c >= row.length) return null;
  const value = row[c];
  // Only the mode's own blank counts as "nothing here", and it has to be compared
  // by identity: in a punched card the blank *is* `0`, which is also a real answer
  // ("this needle is not in work"), so truthiness would silently drop it.
  if (value === undefined || value === null) return null;
  if (value === blankValue(layer.mode)) return null;
  return value;
}

/**
 * Flatten the stack into the card the machine will knit.
 *
 * `sources` records which layer each winning cell came from, which is what lets the
 * cell inspector answer "why is there an eyelet here?" — a question that is
 * otherwise unanswerable once three layers are stacked.
 */
export function composite(stack, { includeKind = 'pattern' } = {}) {
  const patterns = stack.layers.filter(layer => includeKind === 'all' || layer.kind === includeKind);
  const info = matrixInfo(topPatternMatrix(stack));
  const rows = Math.max(stack.rows || 0, info.rows, longestRow(patterns));
  const cols = Math.max(stack.cols || 0, info.cols, widest(patterns));
  const mode = stack.mode;
  const matrix = makeMatrix(rows, cols, { mode });
  const sources = new Map();
  // Bottom-up, overwriting only where a layer actually says something: that is the
  // "topmost non-blank wins" rule, expressed as "later writes win, blanks never
  // write". The consequence is worth stating out loud, because it surprises people
  // once — erasing on the top layer cannot remove a stitch a lower layer owns, so
  // `eraseAt` below looks the owning layer up instead of trusting the click.
  for (const layer of patterns) {
    for (let r = 0; r < rows; r++) {
      const row = matrix[r];
      if (!row) continue;
      for (let c = 0; c < cols; c++) {
        const value = contribution(layer, r, c);
        if (value === null) continue;
        row[c] = value;
        sources.set(`${r},${c}`, layer.id);
      }
    }
  }
  return { matrix, sources, rows, cols };
}

/** Write to the layer being drawn on. */
export function paintAt(stack, r, c, value, id = stack.activeId) {
  const layer = findLayer(stack, id);
  if (!layer) return { ok: false, error: 'No layer to draw on.', stack };
  if (layer.locked) return { ok: false, error: `"${layer.name}" is locked.`, stack };
  const row = layer.matrix[r];
  if (!row || c >= row.length) return { ok: false, error: 'That cell is off the card.', stack };
  const previous = row[c];
  if (previous === value) return { ok: true, changed: 0, layer: layer.id, stack };
  row[c] = value;
  return { ok: true, changed: 1, layer: layer.id, previous, stack };
}

/**
 * Erase where the visible stitch actually lives.
 *
 * The click lands on a composited cell; the blank has to be written to whichever
 * layer contributed it, or the eraser appears to do nothing whenever two layers
 * overlap — which is most of the time, in a colourwork-over-base chart.
 */
export function eraseAt(stack, r, c) {
  const { sources } = composite(stack);
  const ownerId = sources.get(`${r},${c}`);
  if (!ownerId) return { ok: true, changed: 0, layer: null, stack };
  return paintAt(stack, r, c, blankValue(stack.mode), ownerId);
}

function longestRow(layers) {
  let rows = 0;
  for (const layer of layers) rows = Math.max(rows, layer.matrix.length);
  return rows;
}

function widest(layers) {
  let cols = 0;
  for (const layer of layers) for (const row of layer.matrix) cols = Math.max(cols, row.length);
  return cols;
}

/**
 * Merge a layer down into the one beneath it and remove it.
 *
 * Only the visible, unlocked, in-kind pairs are allowed: merging a notes layer into
 * the punchcard would bake annotations into stitches, which is precisely the kind
 * of thing a knitter only notices after knitting it.
 */
export function mergeDown(stack, id) {
  const index = indexOf(stack, id);
  if (index < 0) return { ok: false, error: 'That layer is gone.', stack };
  if (index === 0) return { ok: false, error: 'The bottom layer has nothing to merge into.', stack };
  const upper = stack.layers[index];
  const lower = stack.layers[index - 1];
  if (upper.locked) return { ok: false, error: `"${upper.name}" is locked.`, stack };
  if (lower.locked) return { ok: false, error: `"${lower.name}" is locked.`, stack };
  if (!upper.visible) return { ok: false, error: `"${upper.name}" is hidden, so merging it would throw it away. Show it first.`, stack };
  if (upper.kind !== lower.kind) {
    return { ok: false, error: `"${upper.name}" (${upper.kind}) cannot be merged into "${lower.name}" (${lower.kind}).`, stack };
  }
  const rows = Math.max(lower.matrix.length, upper.matrix.length);
  const cols = Math.max(matrixInfo(lower.matrix).cols, matrixInfo(upper.matrix).cols);
  const merged = makeMatrix(rows, cols, { mode: lower.mode });
  let written = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const below = lower.matrix[r] ? lower.matrix[r][c] : undefined;
      const above = contribution(upper, r, c);
      merged[r][c] = above === null ? below === undefined ? blankValue(lower.mode) : below : above;
      if (above !== null && above !== below) written++;
    }
  }
  lower.matrix = merged;
  stack.layers.splice(index, 1);
  stack.activeId = lower.id;
  return { ok: true, merged: lower.id, into: lower.name, written, stack };
}

/**
 * Merge every visible pattern layer into the bottom one, and drop the hidden ones.
 *
 * A hidden layer is by definition not part of what you can see, so folding it in
 * would conjure stitches back at the moment you asked to simplify the file; it is
 * discarded, and counted, so the confirmation can say so.
 */
export function flattenStack(stack) {
  const patterns = stack.layers.filter(layer => compileRelevant(layer.kind));
  const hidden = patterns.filter(layer => !layer.visible).length;
  const stackOrder = patterns.filter(layer => layer.visible).map(layer => layer.id);
  for (const id of stackOrder.slice(1).reverse()) {
    const result = mergeDown(stack, id);
    if (!result.ok) return result;
  }
  for (const layer of patterns.filter(candidate => !candidate.visible && compileRelevant(candidate.kind))) {
    removeLayer(stack, layer.id);
  }
  return { ok: true, stack, layers: stack.layers.length, discarded: hidden };
}

/** Every layer's matrix resized to the card. */
export function resizeStack(stack, rows, cols, { mode = stack.mode } = {}) {
  const changed = [];
  for (const layer of stack.layers) {
    const next = makeMatrix(rows, cols, { mode: layer.mode || mode });
    for (let r = 0; r < Math.min(rows, layer.matrix.length); r++) {
      const source = layer.matrix[r] || [];
      for (let c = 0; c < Math.min(cols, source.length); c++) next[r][c] = source[c];
    }
    if (matrixInfo(layer.matrix).rows !== rows || matrixInfo(layer.matrix).cols !== cols) changed.push(layer.id);
    layer.matrix = next;
    layer.mode = layer.mode || mode;
  }
  stack.rows = rows;
  stack.cols = cols;
  stack.mode = mode;
  return { stack, resized: changed, rows, cols };
}

/** Convert every layer's alphabet when the card changes mode. */
export function convertStackModes(stack, from, to) {
  const out = { ...stack, mode: to, layers: stack.layers.map(layer => ({ ...layer })) };
  for (const layer of out.layers) {
    const result = convertRegionBetweenModes(layer.matrix, fullRegion(layer.matrix), layer.mode || from, to);
    layer.matrix = result.matrix;
    layer.mode = to;
  }
  return { stack: out, changed: out.layers.length };
}

function fullRegion(matrix) {
  const { rows, cols } = matrixInfo(matrix);
  return { r1: 0, r2: rows - 1, c1: 0, c2: cols - 1 };
}

export function clearLayer(stack, id) {
  const layer = findLayer(stack, id);
  if (!layer) return { ok: false, error: 'That layer is gone.', stack };
  if (layer.locked) return { ok: false, error: `"${layer.name}" is locked.`, stack };
  const { rows, cols } = matrixInfo(layer.matrix);
  layer.matrix = makeMatrix(rows, cols, { mode: layer.mode || stack.mode });
  return { ok: true, cleared: layer.id, stack };
}

/** A layer is writable when it is on, unlocked, and a pattern (or explicitly named). */
export function canDrawOn(layer) {
  return Boolean(layer) && layer.visible && !layer.locked;
}
