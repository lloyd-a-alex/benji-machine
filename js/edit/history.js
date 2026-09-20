/**
 * History that remembers branches, because designers do.
 *
 * A linear undo stack throws work away: undo five steps, change something, and the
 * five steps are gone — including the repeat you decided against but wanted to
 * compare later. This is a *tree*. Every committed state stays reachable from its
 * parent, `undo` walks up, `redo` walks down, and a branch you abandoned is still
 * there to be jumped back to until you explicitly delete it. That is what the
 * missing-tools list means by non-destructive history.
 *
 * Two things keep it honest about memory:
 *
 *   - nodes store a *patch* against their parent, not a copy of the card. A pencil
 *     stroke on a 200-needle card is a handful of cells, so fifty undo steps cost
 *     about fifty strokes rather than fifty cards;
 *   - a node's full matrix is reconstructed by replaying patches from the root and
 *     then memoised, because nodes are immutable once committed — so a cached
 *     matrix can never go stale behind our back.
 *
 * Nothing in here touches the DOM, so the tree can be tested (and it is, in
 * `tests/editor-history.test.mjs`) and reused by autosave, which wants the same
 * "what changed" answer for a different reason.
 */

import { cloneMatrix, matrixInfo } from './chart-ops.js';

export const DEFAULT_HISTORY_LIMIT = 200;

// ─── patches ─────────────────────────────────────────────────────────────────

/**
 * Cells that differ between two matrices of the same size.
 *
 * Cells that only exist in one of them (the card grew or shrank) are reported too,
 * with `from`/`to` of `undefined`, because an operation that resized the card has
 * to be undoable as a resize — otherwise undo silently eats the new rows.
 */
export function diffMatrices(before, after) {
  const a = before || [];
  const b = after || [];
  const patch = [];
  const rows = Math.max(a.length, b.length);
  let cols = 0;
  for (let r = 0; r < rows; r++) cols = Math.max(cols, (a[r] || []).length, (b[r] || []).length);
  const shapeBefore = matrixInfo(a);
  const shapeAfter = matrixInfo(b);
  if (shapeBefore.rows !== shapeAfter.rows || shapeBefore.cols !== shapeAfter.cols) {
    // Cell coordinates alone cannot say "this card used to be two rows shorter".
    patch.push({
      size: { rows: shapeAfter.rows, cols: shapeAfter.cols },
      from: { rows: shapeBefore.rows, cols: shapeBefore.cols },
    });
  }
  for (let r = 0; r < rows; r++) {
    const rowA = a[r] || [];
    const rowB = b[r] || [];
    for (let c = 0; c < cols; c++) {
      const from = c < rowA.length ? rowA[c] : undefined;
      const to = c < rowB.length ? rowB[c] : undefined;
      if (from !== to) patch.push({ r, c, from, to });
    }
  }
  return patch;
}

/** Reverse of `diffMatrices`: the patch that turns `to` back into `from`. */
export function invertPatch(patch) {
  return patch
    .map((cell) =>
      cell.size
        ? { size: cell.from, from: cell.size }
        : { r: cell.r, c: cell.c, from: cell.to, to: cell.from },
    )
    .reverse();
}

/**
 * Apply a patch forward (or backward) to a copy of `matrix`.
 *
 * Growing is allowed and is the whole point: `to: undefined` means "this cell did
 * not exist yet", so undoing an inserted row has to shrink the card back, and a
 * bounds check that refused it would strand the resize. Splicing cells out one at a
 * time cannot do that either, because every removal shifts the coordinates of the
 * cells after it — hence the shape entry, and assign-then-crop.
 */
export function applyPatch(matrix, patch, { inverse = false } = {}) {
  const out = cloneMatrix(matrix);
  const cells = [];
  let shape = null;
  for (const cell of patch || []) {
    if (cell.size) {
      shape = inverse ? cell.from : cell.size;
      continue;
    }
    cells.push(cell);
  }
  for (const cell of cells) {
    const to = inverse ? cell.from : cell.to;
    while (out.length <= cell.r) out.push([]);
    const row = out[cell.r];
    while (row.length <= cell.c) row.push(undefined);
    row[cell.c] = to;
  }
  if (!out.length) return out;
  if (shape) {
    // Crop or pad to the recorded shape. Every cell inside it has already been
    // written, because the patch covers the union of the two cards, so this loses
    // nothing — it is the step that makes undoing a resize leave no trace.
    out.length = Math.max(0, shape.rows);
    for (let r = 0; r < out.length; r++) {
      if (!out[r]) out[r] = [];
      out[r].length = shape.cols;
    }
    return out;
  }
  // Rectangular again: a patch written against a ragged card should not be able to
  // leave one short row behind.
  const { cols } = matrixInfo(out);
  for (let r = 0; r < out.length; r++) {
    if (!out[r]) out[r] = [];
    while (out[r].length < cols) out[r].push(undefined);
    if (out[r].length > cols) out[r].length = cols;
  }
  return out;
}

export function patchSize(patch) {
  return (patch || []).length;
}

// ─── the tree ────────────────────────────────────────────────────────────────

let nodeCounter = 0;

function nextNodeId() {
  nodeCounter += 1;
  return `n${nodeCounter}`;
}

export class HistoryTree {
  /**
   * @param {object} options
   * @param {string[][]} options.matrix the starting card, stored as the root
   * @param {number} [options.limit] nodes kept before the oldest are folded away
   * @param {string} [options.mode] pattern mode recorded on each node, so undo can
   *   restore "I was in lace" rather than silently converting the card back
   */
  constructor({ matrix = [], limit = DEFAULT_HISTORY_LIMIT, mode = null, label = 'Blank card' } = {}) {
    this.limit = Math.max(2, Math.trunc(limit) || DEFAULT_HISTORY_LIMIT);
    this.mode = mode;
    this.nodes = new Map();
    this.rootId = nextNodeId();
    this.currentId = this.rootId;
    this._memo = new Map([[this.rootId, cloneMatrix(matrix)]]);
    this.nodes.set(this.rootId, {
      id: this.rootId,
      parentId: null,
      childIds: [],
      patch: [],
      label,
      checkpoint: true,
      checkpointName: label,
      mode,
      at: Date.now()
    });
  }

  get size() {
    return this.nodes.size;
  }

  /** The node the editor is looking at. */
  current() {
    return this.nodes.get(this.currentId);
  }

  /** Matrix of the current node, replaying patches from the root. */
  currentMatrix() {
    return this.matrixOf(this.currentId);
  }

  matrixOf(id) {
    const cached = this._memo.get(id);
    if (cached) return cached;
    const node = this.nodes.get(id);
    if (!node) return [];
    const base = this.matrixOf(node.parentId);
    // Forward patches are stored as "from → to"; walking down from the root applies
    // each one, so a cached matrix is derived, never trusted from a stale copy.
    const out = applyPatch(base, node.patch);
    this._memo.set(id, out);
    return out;
  }

  /**
   * Record a new state as a child of the current node.
   *
   * @returns {object} the node, so the caller can label it or set a checkpoint
   */
  commit({ matrix, patch, label = 'Edit', mode = this.mode, selection = null, checkpoint = null } = {}) {
    const parent = this.current();
    const delta = patch || diffMatrices(this.matrixOf(parent.id), matrix);
    if (!delta.length && mode === parent.mode && !checkpoint) {
      // Nothing changed: folding it into the current node keeps the tree readable
      // (an "undo" that does nothing is indistinguishable from a broken button).
      return parent;
    }
    const id = nextNodeId();
    const node = {
      id,
      parentId: parent.id,
      childIds: [],
      patch: delta,
      label,
      mode,
      selection,
      checkpoint: Boolean(checkpoint),
      checkpointName: checkpoint || null,
      at: Date.now()
    };
    this.nodes.set(id, node);
    parent.childIds.push(id);
    if (matrix) this._memo.set(id, cloneMatrix(matrix));
    this.currentId = id;
    if (this.nodes.size > this.limit) this._foldOldestBranch();
    return node;
  }

  /** Commit a whole card, diffing it against what is on screen now. */
  commitMatrix(matrix, { label = 'Edit', mode = this.mode, selection = null, checkpoint = null } = {}) {
    return this.commit({ matrix, label, mode, selection, checkpoint });
  }

  /**
   * Name the current state so it can be jumped back to.
   *
   * Checkpoints are the reason a knitter trusts undo enough to experiment: "before
   * the eyelet row" stays one click away no matter how much is edited afterwards.
   */
  checkpoint(name, id = this.currentId) {
    const node = this.nodes.get(id);
    if (!node) return null;
    node.checkpoint = true;
    node.checkpointName = String(name || `Checkpoint ${node.id}`);
    return node;
  }

  label(id = this.currentId, text = 'Edit') {
    const node = this.nodes.get(id);
    if (!node || !node.parentId) return node || null; // the root keeps its own name
    node.label = String(text);
    return node;
  }

  canUndo() {
    const node = this.nodes.get(this.currentId);
    return Boolean(node && node.parentId);
  }

  canRedo() {
    const node = this.nodes.get(this.currentId);
    return Boolean(node && node.childIds.length);
  }

  /** Siblings below the current node, newest first: what the redo chooser shows. */
  redoChoices() {
    const node = this.nodes.get(this.currentId);
    if (!node) return [];
    return node.childIds
      .map(id => this.nodes.get(id))
      .filter(Boolean)
      .sort((a, b) => b.at - a.at);
  }

  undo() {
    if (!this.canUndo()) return null;
    const node = this.nodes.get(this.currentId);
    this.currentId = node.parentId;
    return this.nodes.get(this.currentId);
  }

  /** Redo down a specific branch, or the most recent one by default. */
  redo(preferredId = null) {
    const choices = this.redoChoices();
    if (!choices.length) return null;
    const pick = (preferredId && choices.find(node => node.id === preferredId)) || choices[0];
    this.currentId = pick.id;
    return pick;
  }

  jump(id) {
    if (!this.nodes.has(id)) return false;
    this.currentId = id;
    return true;
  }

  jumpToCheckpoint(name) {
    for (const node of this.nodes.values()) {
      if (node.checkpoint && node.checkpointName === name) return this.jump(node.id) ? node : null;
    }
    return null;
  }

  checkpoints() {
    return [...this.nodes.values()]
      .filter(node => node.checkpoint)
      .sort((a, b) => a.at - b.at);
  }

  /** How many states deep the given node is, root included. */
  depth(id = this.currentId) {
    return this.pathTo(id).length;
  }

  /** Root → node, for the breadcrumb a status line shows. */
  pathTo(id = this.currentId) {
    const out = [];
    let node = this.nodes.get(id);
    while (node) {
      out.unshift(node);
      node = node.parentId ? this.nodes.get(node.parentId) : null;
    }
    return out;
  }

  /** Flat, indented description for the history panel and for tests. */
  tree() {
    const walk = (id, depth) => {
      const node = this.nodes.get(id);
      const rows = [{ id: node.id, depth, label: node.label, checkpoint: node.checkpointName || null, current: id === this.currentId, cells: patchSize(node.patch) }];
      // Newest branch last, so the trunk of the work reads top-to-bottom in the
      // order it was actually done.
      for (const child of [...node.childIds].sort((a, b) => (this.nodes.get(a)?.at || 0) - (this.nodes.get(b)?.at || 0))) {
        rows.push(...walk(child, depth + 1));
      }
      return rows;
    };
    return walk(this.rootId, 0);
  }

  /**
   * Delete a branch. The only destructive thing this tree does, and it refuses to
   * delete the node you are standing on — that would leave the editor looking at a
   * state that no longer exists.
   */
  deleteBranch(id) {
    const node = this.nodes.get(id);
    if (!node) return { ok: false, error: 'That history entry is gone.', removed: 0 };
    if (id === this.currentId) return { ok: false, error: 'Move off that entry before deleting it.', removed: 0 };
    if (!node.parentId) return { ok: false, error: 'The starting point cannot be deleted.', removed: 0 };
    const doomed = [];
    const collect = target => {
      doomed.push(target);
      for (const child of this.nodes.get(target).childIds) collect(child);
    };
    collect(id);
    const parent = this.nodes.get(node.parentId);
    parent.childIds = parent.childIds.filter(child => child !== id);
    for (const doomedId of doomed) {
      this.nodes.delete(doomedId);
      this._memo.delete(doomedId);
    }
    return { ok: true, removed: doomed.length };
  }

  /**
   * Stay under `limit`.
   *
   * Dropping abandoned leaves is the easy half; a long *linear* session has no spare
   * leaves at all, so the oldest link in the chain is folded into its parent — the
   * two patches are composed into one, which loses the ability to stop at that exact
   * step while keeping every state that still matters. Current position and named
   * checkpoints are never folded, so the tool cannot eat the thing you are looking at
   * or the row you told it to remember.
   */
  _foldOldestBranch() {
    const over = this.nodes.size - this.limit;
    if (over <= 0) return 0;
    let folded = 0;
    const droppable = () =>
      [...this.nodes.values()].filter(node => node.parentId && !node.childIds.length && node.id !== this.currentId && !node.checkpoint);
    for (const leaf of droppable().sort((a, b) => a.at - b.at)) {
      if (folded >= over) return folded;
      const result = this.deleteBranch(leaf.id);
      if (result.ok) folded += result.removed;
    }
    for (const middle of this._collapsibleMiddle()) {
      if (folded >= over) break;
      if (this._collapse(middle.id)) folded += 1;
    }
    return folded;
  }

  /** Single-child links on the trunk, oldest first. */
  _collapsibleMiddle() {
    return [...this.nodes.values()]
      .filter(node => node.parentId && node.childIds.length === 1 && node.id !== this.currentId && !node.checkpoint)
      .sort((a, b) => a.at - b.at);
  }

  /** Splice `node` out of the chain, composing its patch with its child's. */
  _collapse(id) {
    const node = this.nodes.get(id);
    if (!node || node.childIds.length !== 1) return false;
    const parent = this.nodes.get(node.parentId);
    const childId = node.childIds[0];
    const child = this.nodes.get(childId);
    if (!parent || !child) return false;
    const before = this.matrixOf(parent.id);
    const after = this.matrixOf(childId);
    child.patch = diffMatrices(before, after);
    child.parentId = parent.id;
    parent.childIds = parent.childIds.map(candidate => (candidate === id ? childId : candidate));
    this.nodes.delete(id);
    this._memo.delete(id);
    // Everything below moved up a link, so every cached matrix beneath it is now
    // derived from a different walk. Matrices are immutable but the *path* is not.
    this._memo = new Map([[this.rootId, this.matrixOf(this.rootId)]]);
    return true;
  }

  stats() {
    let deepest = 0;
    let cells = 0;
    for (const node of this.nodes.values()) {
      cells += patchSize(node.patch);
      deepest = Math.max(deepest, this.pathTo(node.id).length);
    }
    return { nodes: this.nodes.size, branches: this.tree().length, checkpoints: this.checkpoints().length, depth: deepest, cells, limit: this.limit };
  }

  // ─── persistence ───────────────────────────────────────────────────────────

  /**
   * Only the path to the current node is written out.
   *
   * A full tree could be tens of thousands of patches in a .kcard, and a file that
   * big is a file that fails to load — so a saved card carries the *undo trail of
   * where you stopped*, and the abandoned branches stay in the session. The
   * checkpoints that fall on that path survive, because those are the ones a
   * knitter would ask for by name.
   */
  serialize() {
    const path = this.pathTo(this.currentId);
    const rootNode = path[0];
    const root = this.matrixOf(rootNode.id);
    return {
      version: 1,
      root,
      // The name you gave the state you started from is yours to keep; a restore
      // that renamed it would be a small rude thing to do to somebody's work.
      rootCheckpoint: rootNode.checkpoint ? rootNode.checkpointName : null,
      mode: this.mode,
      limit: this.limit,
      entries: path.slice(1).map(node => ({
        patch: node.patch,
        label: node.label,
        mode: node.mode,
        selection: node.selection,
        checkpoint: node.checkpoint ? node.checkpointName : null,
        at: node.at
      }))
    };
  }

  static deserialize(data) {
    if (!data || !Array.isArray(data.root)) return null;
    const tree = new HistoryTree({
      matrix: data.root,
      mode: data.mode || null,
      limit: data.limit || DEFAULT_HISTORY_LIMIT,
      label: typeof data.rootCheckpoint === 'string' && data.rootCheckpoint ? data.rootCheckpoint : 'Restored card'
    });
    for (const entry of data.entries || []) {
      tree.commit({
        patch: entry.patch || [],
        label: entry.label || 'Edit',
        mode: entry.mode || data.mode || null,
        selection: entry.selection || null,
        checkpoint: entry.checkpoint || null
      });
    }
    return tree;
  }
}

/**
 * The undo/redo plumbing the editor actually wants: hand it a card, get back
 * "did anything change" plus the node. Kept as a function so tests and autosave
 * can use it without owning a tree.
 */
export function createHistory(options = {}) {
  return new HistoryTree(options);
}
