/**
 * Interactive Knitting Pattern Grid Canvas Editor
 *
 * High-performance 2D Canvas matrix editor featuring:
 * - Sub-pixel panning & smooth zoom
 * - Vectorized knitting glyphs (Standard Japanese & Hand-Knit symbols)
 * - Drawing tools: Pencil, Line, Rect, Circle, Flood Fill, Heart, Smudge
 * - A real selection engine: magic wand, lasso, Bézier, spline, marquee, the
 *   expand/contract/feather/invert family — all of it delegated to the DOM-free
 *   `js/edit/select-ops.js`, with a `Set` of "r,c" keys as the single truth.
 * - A layer stack (js/edit/layers.js): `matrix` is a *getter over the composite*,
 *   so every downstream consumer (compiler, punchcard, yarn sim, exports) reads
 *   the flattened card while the drawing writes go to the active layer.
 * - Branching undo (js/edit/history.js): every committed state stays reachable,
 *   abandoned branches survive until explicitly deleted, checkpoints are named.
 * - Draggable guides, repeat tiles and interactive knitter's annotations.
 * - Industrial needle bed ruler & coordinate HUD
 */

import { STITCH_TYPE } from '../math/knit-topology.js';
// One source of truth for what a cell means in each mode. The lace<->numeric
// conversion used to be duplicated here, which risked the editor and the
// clipboard/exports telling different stories about the same chart (see modes.js).
import { convertMatrixBetweenModes, isDirectMode, blankValue } from '../edit/modes.js';
// The selection engine. A selection is a Set of "r,c" keys; nothing in this file
// recomputes a lasso, a feather or an invert locally — that logic lives in one
// tested place and this editor is only its client.
import {
  cellKey,
  parseCellKey,
  keysToCells,
  clipKeys,
  normalizeRect,
  clampRect,
  rectKeys,
  rectFromKeys,
  wholeGridKeys,
  expandKeys,
  contractKeys,
  invertKeys,
  featherKeys,
  floodRegion,
  selectByValue,
  toggleKeys,
  polygonKeys,
  lineCells,
  rectOutlineCells,
  ellipseCells,
  bezierCells,
  splineCells,
  regionsFromKeys,
  alignOffsets,
  distributeOffsets,
  moveKeysBy
} from '../edit/select-ops.js';
// Branching history: patches against the parent, so 250 undo levels cost 250
// strokes, not 250 whole cards.
import { createHistory, HistoryTree } from '../edit/history.js';
// The layer stack: `matrix` is a view over composite(stack).
import {
  createStack,
  composite,
  paintAt,
  eraseAt,
  resizeStack,
  convertStackModes,
  addLayer,
  removeLayer,
  renameLayer,
  setLayerVisible,
  toggleLayerVisible,
  setLayerLocked,
  moveLayerBy,
  mergeDown,
  clearLayer,
  activeLayer,
  findLayer,
  setLayerProperty,
  flattenStack,
  stackInfo
} from '../edit/layers.js';
// Guides, repeat tiles and snapping.
import {
  addGuide,
  removeGuide,
  moveGuide,
  toggleGuideLock,
  addRepeat,
  removeRepeat,
  repeatTiles,
  snapPosition
} from '../edit/guides.js';
// Knitter's annotations, drawn on the card and never compiled.
import {
  addAnnotation,
  updateAnnotation,
  moveAnnotation,
  deleteAnnotation,
  dimensionText,
  sanitizeAnnotations
} from '../edit/annotations.js';
// Chart operations used by the interactive tools (smudge, soften previews,
// region flips) so the editor never re-implements a matrix transform.
import { smudgePath, flipRegion, invertRegion } from '../edit/chart-ops.js';
import { logger } from '../core/logging.js';

const log = logger('ui/canvas-editor');

/**
 * A wand click on a big blank card would otherwise grab the whole bed and the
 * next Delete would wipe real work. Past this many cells the wand refuses and
 * says how many it found — same cap the plan calls for, same reason Photoshop
 * narks out on a runaway magic wand.
 */
export const SELECTION_FLOOD_LIMIT = 20000;

/** Pixels of slop before a pointer press counts as grabbing a guide line. */
const GUIDE_HIT_PX = 4;

/** Pixels of slop for grabbing an annotation pin dot to drag it. */
const ANNOTATION_HIT_PX = 6;

export class CanvasEditor {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    // A null 2D context means nothing will ever render and every later draw call
    // throws — the single worst silent failure in a canvas app. Say it loudly.
    if (!this.ctx) log.error('canvas 2D context is unavailable — the editor cannot render', { hasElement: !!canvasElement });

    this.rows = options.rows || 60;
    this.cols = options.cols || 24;
    this.mode = options.mode || 'lace'; // 'lace', 'fair_isle', 'tuck', 'slip'

    // Physical profile (for mm read-outs on dimension annotations). Optional:
    // the editor works without one and falls back to cell counts.
    this.profile = options.profile || null;

    // ── Layers ───────────────────────────────────────────────────────────────
    // The card itself no longer lives in `this.matrix`; it lives in a stack of
    // layers, and `matrix` is a view over the composite of that stack.
    this.stack = createStack({ rows: this.rows, cols: this.cols, mode: this.mode });

    // ── History: a tree, not a stack ─────────────────────────────────────────
    this.tree = createHistory({ matrix: this._snapshotComposite(), mode: this.mode, limit: 250, label: 'Blank card' });
    // Layer snapshots ride alongside tree nodes: a patch replays the *card*, but
    // only the stack says which layer owned each cell. Keys are node ids.
    this._stackStates = new Map();
    this._rememberStack(this.tree.currentId);
    this._nextLabel = null;

    // Viewport transform
    this.zoom = 22; // Pixels per grid cell
    this.panX = 60;
    this.panY = 60;

    // Interaction state
    this.activeTool = 'pencil'; // see setActiveTool for the full registry
    this.activeStitch = STITCH_TYPE.EYELET; // Current stitch for painting in lace mode
    this.activeColor = 1; // 0 = main yarn A, 1 = contrast yarn B

    this.isMouseDown = false;
    this.isPanning = false;
    this.lastMousePos = { x: 0, y: 0 };
    this.dragStartCell = null;
    this.hoverCell = { r: -1, c: -1 };

    // Performance optimization
    this.renderThrottle = 0;
    this.lastRenderTime = 0;

    // ── Selection ────────────────────────────────────────────────────────────
    // The Set of "r,c" keys is the truth. The legacy `{r1,c1,r2,c2}` rectangle
    // survives as a derived getter/setter so older callers keep working.
    this._selectionKeys = new Set();
    this._dragSelection = null; // live marquee while the pointer is down

    this.clipboard = null; // { rows, cols, cells[][] } captured for paste

    // Advisory highlight: a transient set of cells the feasibility advisor can
    // point at ("this is the float I mean"). Purely visual — it never touches the
    // matrix or history. { cells:[[r,c]...], color, fill, label } or null.
    this.highlight = null;

    // Knitter's notes drawn on the card (from the annotations engine). Now a real
    // interactive list of annotation records (note/pin/label/dimension/arrow/
    // symbol), draggable by their pin dots, and persisted with the project.
    this.annotations = [];

    // Ruler guides and repeat tiles, drawn on the canvas and draggable.
    this.guides = [];
    this.repeats = [];
    // When true, marquee edges and guide drags snap to nearby guides/repeats.
    this.snapGuides = true;

    // Multi-click tool state (lasso / bezier / spline / measure / smudge).
    this._lasso = null;
    this._bezierPoints = [];
    this._splinePoints = [];
    this._measureDrag = null;
    this._smudgePath = null;
    this._guideDrag = null;
    this._annotationDrag = null;
    this._noteInput = null;

    // Symmetry options
    this.symmetryH = false;
    this.symmetryV = false;

    // Callback on change
    this.onChange = options.onChange || (() => { });
    // Optional notifier so selection caps and snap feedback can toast.
    this.onNotify = options.notify || null;

    this.setupEvents();
    this.resizeCanvas();
    this.render();
  }

  // ─── composite view helpers ────────────────────────────────────────────────

  /** Flatten the stack right now. Used for history snapshots and copies. */
  _snapshotComposite() {
    return composite(this.stack).matrix;
  }

  /**
   * The card the machine will knit: a FRESH copy of the composited stack.
   *
   * Read-only by convention — writing to the returned arrays mutates a copy that
   * is thrown away. All drawing goes through applyStitchAt/paintKeys/setMatrix,
   * which is exactly the funnel that makes layers, undo and the punchcard agree.
   */
  get matrix() {
    return this._snapshotComposite();
  }

  /** Replace the whole card (and reset the layer stack to a single Base layer). */
  set matrix(newMatrix) {
    this._adoptMatrix(newMatrix);
  }

  /** Point the stack's Base layer at a matrix without touching history/render. */
  _adoptMatrix(newMatrix) {
    const rows = newMatrix.length;
    const cols = newMatrix[0] ? newMatrix[0].length : this.cols;
    this.rows = rows;
    this.cols = cols;
    this.stack = createStack({ rows, cols, mode: this.mode });
    this.stack.layers[0].matrix = newMatrix.map(row => [...row]);
    this.stack.rows = rows;
    this.stack.cols = cols;
    return this.stack;
  }

  initMatrix() {
    this._adoptMatrix(this._blankMatrix());
  }

  /** A blank card of the current size and mode. */
  _blankMatrix() {
    const blank = blankValue(this.mode);
    const out = [];
    for (let r = 0; r < this.rows; r++) out.push(new Array(this.cols).fill(blank));
    return out;
  }

  setDimensions(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    resizeStack(this.stack, rows, cols, { mode: this.mode });
    this.highlight = null; // resizing invalidates a spotlight on the old bounds
    this._clipSelectionToBounds();
    this._setLabel('Resize card');
    this.saveState();
    this.render();
    this.onChange();
  }

  setMode(newMode) {
    const oldMode = this.mode;
    if (newMode === oldMode) {
      this.render();
      return;
    }
    this.mode = newMode;
    // Convert the cell representation of EVERY layer whenever we cross between
    // Lace mode (which stores STITCH_TYPE strings such as 'K'/'O') and the
    // direct-pattern modes (fair_isle / tuck / slip, which store numeric 0/1).
    // Without this the punchcard compiler misreads every leftover 'K' as a
    // punched hole, so a Fair Isle drawing appears as a fully-punched card.
    const converted = convertStackModes(this.stack, oldMode, newMode);
    this.stack = converted.stack;
    this.tree.mode = newMode;
    this._clearSelectionKeys();
    this._setLabel(`Mode: ${newMode.replace('_', ' ')}`);
    this.saveState();
    this.render();
  }

  static isDirectMode(mode) {
    // Delegate: `isDirectMode` here is the module import, not this method, so no recursion.
    return isDirectMode(mode);
  }

  convertMatrixForMode(oldMode, newMode) {
    this._adoptMatrix(CanvasEditor.convertMatrixBetweenModes(oldMode, newMode, this._snapshotComposite()));
  }

  // Thin delegate to the DOM-free canonical converter in js/edit/modes.js, kept as a
  // static so the lace<->numeric logic stays unit-testable in Node without touching the
  // canvas. `convertMatrixBetweenModes` resolves to the module import, not this method.
  static convertMatrixBetweenModes(oldMode, newMode, matrix) {
    return convertMatrixBetweenModes(oldMode, newMode, matrix);
  }

  _normalizeStrayStrings() {
    const LACE_BLANK = [STITCH_TYPE.KNIT, STITCH_TYPE.EMPTY, STITCH_TYPE.PURL];
    const direct = isDirectMode(this.mode);
    for (const layer of this.stack.layers) {
      for (let r = 0; r < this.rows; r++) {
        const row = layer.matrix[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (direct && typeof row[c] === 'string') row[c] = LACE_BLANK.includes(row[c]) ? 0 : 1;
        }
      }
    }
  }

  setMatrix(newMatrix) {
    // A whole-card replacement has nowhere to put layer ownership: the incoming
    // matrix is the flattened card. Say so rather than silently dropping the stack —
    // and the history node we are about to commit still holds the pre-flatten stack,
    // so one Ctrl+Z gets the layers back exactly as they were.
    const dropped = this.stack.layers.length - 1;
    if (dropped > 0) {
      this._notify(`That replaced the whole card, so the ${dropped} extra layer${dropped === 1 ? '' : 's'} merged into one.`, {
        details: 'Undo brings the layer stack back.',
        kind: 'info',
        duration: 6000
      });
    }
    this._adoptMatrix(newMatrix);
    this.highlight = null; // a new card supersedes any spotlight on the old one
    this._clipSelectionToBounds();
    this.saveState();
    this.render();
    this.onChange();
  }

  /** Give the NEXT saveState() a human label (branch browser / undo tooltip). */
  setLabel(label) {
    this._nextLabel = label ? String(label) : null;
    return this;
  }

  _setLabel(label) {
    this._nextLabel = label;
  }

  // ─── history (branching tree) ──────────────────────────────────────────────

  /**
   * Commit the current composite card as a child of the node we are standing on.
   * Unchanged cards fold into the current node (an undo that does nothing is
   * indistinguishable from a broken button), so calling this after every stroke
   * is cheap.
   */
  saveState() {
    const matrix = this._snapshotComposite();
    const node = this.tree.commit({
      matrix,
      label: this._nextLabel || 'Edit',
      mode: this.mode,
      selection: this.getSelectionBounds()
    });
    this._nextLabel = null;
    this._rememberStack(node.id);
    return node;
  }

  /** Deep-copy the layer stack so undo can restore *which layer* owns a cell. */
  _cloneStack(s) {
    return {
      name: s.name,
      mode: s.mode,
      rows: s.rows,
      cols: s.cols,
      activeId: s.activeId,
      layers: s.layers.map(layer => ({
        ...layer,
        matrix: layer.matrix.map(row => [...row])
      }))
    };
  }

  _rememberStack(nodeId) {
    if (!nodeId) return;
    this._stackStates.set(nodeId, this._cloneStack(this.stack));
    // Drop snapshots of nodes the tree itself has folded away.
    if (this._stackStates.size > 300) {
      for (const id of [...this._stackStates.keys()]) {
        if (!this.tree.nodes.has(id)) this._stackStates.delete(id);
      }
    }
  }

  undo() {
    const node = this.tree.undo();
    if (!node) return false;
    this._restoreNode(node);
    return true;
  }

  redo(preferredId = null) {
    const node = this.tree.redo(preferredId);
    if (!node) return false;
    this._restoreNode(node);
    return true;
  }

  /** Jump to an arbitrary branch node — what the history browser offers. */
  jumpHistory(id) {
    if (!this.tree.jump(id)) return false;
    const node = this.tree.current();
    if (node) this._restoreNode(node);
    return true;
  }

  /**
   * The whole trail as flat, indented rows for the branch browser: each is
   * `{id, depth, label, checkpoint, current, cells}` in the order it should be
   * painted. Pure view of `tree.tree()` — no DOM — so it is unit-testable.
   */
  historyRows() {
    try { return this.tree.tree(); } catch (err) { log.debug('history tree view failed to read', { error: err?.message }); return []; }
  }

  /** Name the node we are standing on as a checkpoint (undoable-safe marker). */
  addCheckpoint(name) {
    const node = this.tree.checkpoint(name || 'Checkpoint');
    this._rememberStack(this.tree.currentId);
    this.onChange?.();
    return node || null;
  }

  /**
   * Delete a branch. Refused (with a message) when the target is the node in
   * view or the root, matching `HistoryTree.deleteBranch`'s own guarantees.
   */
  deleteHistoryBranch(id) {
    const result = this.tree.deleteBranch(id);
    if (result.ok) {
      for (const doomedId of [id]) this._stackStates.delete(doomedId);
      this.render();
      this.onChange();
    }
    return result;
  }

  /** Branches available to redo() from the current node (for a redo chooser). */
  redoChoices() {
    try { return this.tree.redoChoices() || []; } catch (err) { log.debug('redo choices failed to read', { error: err?.message }); return []; }
  }

  /** Compact history stats for the panel header (nodes, checkpoints, depth). */
  historyStats() {
    try { return this.tree.stats(); } catch (err) { log.debug('history stats failed to read', { error: err?.message }); return { nodes: 0, branches: 0, checkpoints: 0, depth: 0, cells: 0 }; }
  }

  _restoreNode(node) {
    const matrix = this.tree.currentMatrix();
    const snapshot = this._stackStates.get(node.id);
    if (snapshot) {
      this.stack = this._cloneStack(snapshot);
      this.rows = this.stack.rows || matrix.length;
      this.cols = this.stack.cols || (matrix[0] ? matrix[0].length : this.cols);
    } else {
      // Older nodes (or a tree restored from a file) carry only the card: a
      // single Base layer is a faithful approximation of a pre-layers session.
      this._adoptMatrix(matrix);
    }
    if (node && node.mode && node.mode !== this.mode) this.mode = node.mode;
    this.highlight = null;
    if (node && node.selection) this.selection = node.selection;
    else this._clearSelectionKeys();
    this.render();
    this.onChange();
  }

  /**
   * The undo trail as a portable object, for .kcard files and autosave.
   * Serialize only keeps the path to the current node — see history.js.
   */
  serializeHistory() {
    try {
      return this.tree.serialize();
    } catch (err) {
      log.logError('could not serialize the undo history', err);
      return null;
    }
  }

  /**
   * Adopt a serialized trail (from a saved project). Falls back to a fresh tree
   * over the current card when the payload is missing or malformed, so a broken
   * history can never stop a project from opening.
   */
  adoptHistory(data) {
    let tree = null;
    try {
      tree = data ? HistoryTree.deserialize(data) : null;
    } catch (err) {
      log.warn('a saved undo history was malformed and is being dropped', { error: err?.message });
      tree = null;
    }
    if (!tree) return false;
    this.tree = tree;
    this._stackStates = new Map();
    this._rememberStack(this.tree.currentId);
    return true;
  }

  /** Layer-manipulation commits: the composite is unchanged, the stack isn't. */
  _commitLayerOp(label) {
    const node = this.tree.commit({ matrix: this._snapshotComposite(), label, mode: this.mode });
    this._rememberStack(node.id);
    this.render();
    this.onChange();
    return node;
  }

  // ─── layers API (back the structure panel) ─────────────────────────────────

  getLayers() {
    return this.stack.layers.map((layer, index) => ({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      index,
      active: layer.id === this.stack.activeId
    }));
  }

  layerInfo() {
    return stackInfo(this.stack);
  }

  setActiveLayer(id) {
    if (!findLayer(this.stack, id)) return false;
    this.stack.activeId = id;
    this._commitLayerOp(`Layer: ${findLayer(this.stack, id).name}`);
    return true;
  }

  addNewLayer(opts = {}) {
    const layer = addLayer(this.stack, opts);
    this._commitLayerOp(`Add layer "${layer.name}"`);
    return layer;
  }

  removeLayerById(id) {
    const result = removeLayer(this.stack, id);
    if (result.ok) this._commitLayerOp('Remove layer');
    return result;
  }

  renameLayerById(id, name) {
    const result = renameLayer(this.stack, id, name);
    if (result.ok) this._commitLayerOp('Rename layer');
    return result;
  }

  toggleLayerVisibleById(id) {
    const result = toggleLayerVisible(this.stack, id);
    if (result.ok) this._commitLayerOp('Toggle layer');
    return result;
  }

  setLayerVisibleById(id, visible) {
    const result = setLayerVisible(this.stack, id, visible);
    if (result.ok) this._commitLayerOp('Toggle layer');
    return result;
  }

  setLayerLockedById(id, locked) {
    const result = setLayerLocked(this.stack, id, locked);
    if (result.ok) this._commitLayerOp('Lock layer');
    return result;
  }

  moveLayerById(id, delta) {
    const result = moveLayerBy(this.stack, id, delta);
    if (result.ok && result.moved) this._commitLayerOp('Reorder layers');
    return result;
  }

  mergeLayerDown(id) {
    const result = mergeDown(this.stack, id);
    if (result.ok) this._commitLayerOp('Merge layer down');
    return result;
  }

  clearActiveLayer() {
    const layer = activeLayer(this.stack);
    const result = layer ? clearLayer(this.stack, layer.id) : { ok: false, error: 'No active layer.' };
    if (result.ok) this.saveState();
    this.render();
    this.onChange();
    return result;
  }

  /**
   * Set a layer's opacity (0–1). The structure panel calls this on slider
   * release so a drag is one undoable step, not sixty. Delegates the clamping to
   * layers.js so the number can never go out of range here.
   */
  setLayerOpacityById(id, opacity) {
    const result = setLayerProperty(this.stack, id, 'opacity', opacity);
    if (result.ok) this._commitLayerOp('Layer opacity');
    return result;
  }

  /** Set a layer's kind (pattern / reference / annotation). */
  setLayerKindById(id, kind) {
    const result = setLayerProperty(this.stack, id, 'kind', kind);
    if (result.ok) this._commitLayerOp('Layer kind');
    return result;
  }

  /** Collapse the whole stack to a single pattern layer (one undoable step). */
  flattenLayers() {
    const result = flattenStack(this.stack);
    this._commitLayerOp('Flatten layers');
    return result;
  }

  /**
   * The whole stack, matrices and all, for the project file. `getLayers()` is the
   * cheap view the panels read; this is the one that has to round-trip, because a
   * card saved with a tracing layer under a colourwork layer must come back that
   * way or the knitter's whole document is a lie.
   */
  serializeStack() {
    return this._cloneStack(this.stack);
  }

  /**
   * Adopt a serialized stack (from a file). Validated hard: every layer must be a
   * matrix the size of the card, and there must be at least one pattern layer left
   * to draw on. Anything else returns `false` and leaves the single-Base stack that
   * `setMatrix` built, which always renders the card correctly.
   */
  adoptStack(raw) {
    if (!raw || !Array.isArray(raw.layers) || !raw.layers.length) return false;
    const rows = this.rows;
    const cols = this.cols;
    const layers = [];
    for (const layer of raw.layers) {
      if (!layer || !Array.isArray(layer.matrix)) return false;
      if (layer.matrix.length !== rows) return false;
      for (const row of layer.matrix) if (!Array.isArray(row) || row.length !== cols) return false;
      layers.push({
        id: typeof layer.id === 'string' && layer.id ? layer.id : undefined,
        name: String(layer.name ?? 'Layer').slice(0, 64),
        kind: ['pattern', 'reference', 'annotation'].includes(layer.kind) ? layer.kind : 'pattern',
        visible: layer.visible !== false,
        locked: Boolean(layer.locked),
        opacity: Number.isFinite(layer.opacity) ? Math.min(1, Math.max(0, layer.opacity)) : 1,
        mode: typeof layer.mode === 'string' ? layer.mode : this.mode,
        matrix: layer.matrix.map(row => [...row])
      });
    }
    if (!layers.some(layer => layer.kind === 'pattern')) return false;
    this.stack = {
      name: String(raw.name ?? 'Pattern'),
      mode: this.mode,
      rows,
      cols,
      layers,
      activeId: layers.find(l => l.id === raw.activeId) ? raw.activeId : layers[layers.length - 1].id
    };
    this.rows = rows;
    this.cols = cols;
    return true;
  }

  /**
   * Replace the card *and* keep a saved stack, the way `loadProjectText` wants:
   * composite first, stack second, and never leave the two disagreeing.
   */
  restoreStackFrom(raw) {
    if (!raw) return false;
    return this.adoptStack(raw);
  }

  // ─── selection engine (client of select-ops.js) ────────────────────────────

  /** The Set of "r,c" keys this editor treats as selected. Read-only intent. */
  get selectionKeys() {
    return this._selectionKeys;
  }

  getSelectionCells() {
    return keysToCells(this._selectionKeys);
  }

  hasSelection() {
    return this._selectionKeys.size > 0;
  }

  /**
   * Legacy rectangle API. Reading derives the smallest box around the keys;
   * writing turns a rectangle into key membership (so older callers — the copy
   * commands, `edit.selectAll`, the context menu — all keep working, and the
   * marquee is simply the special case of a selection that came from a rect).
   */
  get selection() {
    return this._selectionKeys.size ? rectFromKeys(this._selectionKeys) : null;
  }

  set selection(rect) {
    if (!rect) {
      this._clearSelectionKeys();
      return;
    }
    const clamped = clampRect(rect, this.rows, this.cols);
    this._selectionKeys = clamped ? rectKeys(clamped) : new Set();
  }

  setSelectionKeys(keys, { extend = false, label = 'Selection' } = {}) {
    const clipped = clipKeys(keys, this.rows, this.cols);
    this._selectionKeys = extend ? new Set([...this._selectionKeys, ...clipped]) : new Set(clipped);
    if (label) this._setLabel(label);
    this.render();
    return this._selectionKeys.size;
  }

  _clearSelectionKeys() {
    if (!this._selectionKeys.size) return;
    this._selectionKeys = new Set();
    this.render();
  }

  _clipSelectionToBounds() {
    if (!this._selectionKeys.size) return;
    this._selectionKeys = clipKeys(this._selectionKeys, this.rows, this.cols);
  }

  selectAll() {
    this.setSelectionKeys(wholeGridKeys(this.rows, this.cols), { label: 'Select all' });
    return this._selectionKeys.size;
  }

  clearSelection() {
    this._clearSelectionKeys();
  }

  invertSelection() {
    this.setSelectionKeys(invertKeys(this._selectionKeys, { rows: this.rows, cols: this.cols }), { label: 'Invert selection' });
    return this._selectionKeys.size;
  }

  expandSelection(passes = 1) {
    this.setSelectionKeys(
      expandKeys(this._selectionKeys, { rows: this.rows, cols: this.cols, passes }),
      { label: 'Expand selection' }
    );
    return this._selectionKeys.size;
  }

  contractSelection(passes = 1) {
    this.setSelectionKeys(
      contractKeys(this._selectionKeys, { rows: this.rows, cols: this.cols, passes }),
      { label: 'Contract selection' }
    );
    return this._selectionKeys.size;
  }

  featherSelection(passes = 1) {
    const result = featherKeys(this._selectionKeys, { rows: this.rows, cols: this.cols, passes });
    this.setSelectionKeys(result.keys, { label: 'Feather selection' });
    return result.added.size;
  }

  /** "Select every cell like this one" over the whole card (by value). */
  selectMatchingValue(value) {
    const keys = selectByValue(this._snapshotComposite(), value);
    this.setSelectionKeys(keys, { label: 'Select by value' });
    return keys.size;
  }

  selectPunched() {
    const comp = this._snapshotComposite();
    const blank = blankValue(this.mode);
    const keys = new Set();
    for (let r = 0; r < comp.length; r++) {
      for (let c = 0; c < comp[r].length; c++) if (comp[r][c] !== blank) keys.add(cellKey(r, c));
    }
    this.setSelectionKeys(keys, { label: 'Select punched' });
    return keys.size;
  }

  /** Shift-click: add a region, or remove it when already selected. */
  toggleSelectionKeys(addition) {
    const result = toggleKeys(this._selectionKeys, addition, { rows: this.rows, cols: this.cols });
    this._selectionKeys = result.keys;
    this.render();
    return result;
  }

  /**
   * Magic wand: the connected same-value region touching a cell. Returns
   * `{ keys, capped, attempted }`; on cap the selection is left untouched and
   * the caller can toast `attempted` so nobody deletes half a card by accident.
   */
  wandSelect(r, c, { extend = false, limit = SELECTION_FLOOD_LIMIT } = {}) {
    const comp = this._snapshotComposite();
    const result = floodRegion(comp, r, c, {
      match: 'value',
      blank: blankValue(this.mode),
      limit
    });
    if (result.capped) {
      this._notify(`That region is ${result.attempted.toLocaleString()} cells — too big to select.`, {
        details: `Draw a smaller marquee first, then use Select → Inverse inside it.`,
        duration: 7000
      });
      return result;
    }
    if (extend) this.toggleSelectionKeys(result.keys);
    else this.setSelectionKeys(result.keys, { label: 'Magic wand' });
    return result;
  }

  /**
   * Write cells and clear cells *onto the layer stack*, which is the difference
   * between a selection move and a whole-card replacement.
   *
   * Clearing looks the owning layer up through the composite's `sources` map, so a
   * stitch that came from the base layer is removed from the base layer — not
   * overpainted on the active one, which would leave the original underneath and
   * make the move look like it half-failed. Destinations always land on the active
   * layer: that is what "move it over here" means when you are drawing on one.
   *
   * @param {{blank?: Array<{r:number,c:number}>, write?: Array<{r:number,c:number,value:*}>, label?: string}} patch
   */
  editStackCells({ blank = [], write = [], label = 'Edit' } = {}) {
    const { sources } = composite(this.stack);
    const blankCell = blankValue(this.mode);
    for (const cell of blank) {
      const ownerId = sources.get(cellKey(cell.r, cell.c));
      const layer = ownerId ? findLayer(this.stack, ownerId) : null;
      if (!layer || layer.locked) continue;
      const row = layer.matrix[cell.r];
      if (row && cell.c < row.length) row[cell.c] = blankCell;
    }
    for (const cell of write) paintAt(this.stack, cell.r, cell.c, cell.value);
    this._setLabel(label);
    this.saveState();
    this._clipSelectionToBounds();
    this.render();
    this.onChange();
    return true;
  }

  // Align / distribute move the *content* of the separate blobs in a selection,
  // which is what a knitter means by "even out these motifs".
  alignSelection(mode = 'min-col') {
    const regions = regionsFromKeys(this._selectionKeys);
    if (regions.length < 2) return false;
    const offsets = alignOffsets(regions.map(region => region.bounds), mode);
    return this._moveRegions(regions, offsets, `Align ${mode}`);
  }

  distributeSelection(axis = 'h') {
    const regions = regionsFromKeys(this._selectionKeys);
    if (regions.length < 3) return false;
    const offsets = distributeOffsets(regions.map(region => region.bounds), axis);
    return this._moveRegions(regions, offsets, `Distribute ${axis === 'v' ? 'vertically' : 'horizontally'}`);
  }

  _moveRegions(regions, offsets, label) {
    const comp = this._snapshotComposite();
    // Snapshot each region's cells BEFORE blanking anything: regions cannot
    // overlap (regionsFromKeys partitions), but order must not matter anyway.
    const payloads = regions.map((region, i) => ({
      dr: offsets[i].dr,
      dc: offsets[i].dc,
      cells: [...region.keys].map(key => {
        const { r, c } = parseCellKey(key);
        return { r, c, value: comp[r][c] };
      })
    }));
    const blanked = [];
    const written = [];
    for (const payload of payloads) {
      for (const cell of payload.cells) {
        blanked.push({ r: cell.r, c: cell.c });
        const tr = cell.r + payload.dr;
        const tc = cell.c + payload.dc;
        if (tr >= 0 && tr < this.rows && tc >= 0 && tc < this.cols) written.push({ r: tr, c: tc, value: cell.value });
      }
    }
    this._selectionKeys = clipKeys(
      new Set(written.map(cell => cellKey(cell.r, cell.c))),
      this.rows,
      this.cols
    );
    return this.editStackCells({ blank: blanked, write: written, label });
  }

  /** Slide the selected content by (dr,dc), refusing moves that leave the card. */
  moveSelectionContent(dr, dc) {
    if (!this._selectionKeys.size || (!dr && !dc)) return false;
    const comp = this._snapshotComposite();
    const cells = [...this._selectionKeys].map(key => {
      const { r, c } = parseCellKey(key);
      return { r, c, value: comp[r][c] };
    });
    // Nothing may hang off the edge in silence: if any cell would leave the card,
    // the whole move is refused, exactly like `maxMove` advises the UI to.
    const outside = cells.filter(cell => cell.r + dr < 0 || cell.r + dr >= this.rows || cell.c + dc < 0 || cell.c + dc >= this.cols);
    if (outside.length) return { ok: false, error: `That would push ${outside.length} selected cell(s) off the card.`, blocked: outside.length };
    const moved = this.editStackCells({
      blank: cells.map(cell => ({ r: cell.r, c: cell.c })),
      write: cells.map(cell => ({ r: cell.r + dr, c: cell.c + dc, value: cell.value })),
      label: 'Move selection'
    });
    if (moved) this._selectionKeys = clipKeys(moveKeysBy(new Set(cells.map(cell => cellKey(cell.r, cell.c))), dr, dc), this.rows, this.cols);
    return moved;
  }

  /**
   * Snap a fractional cell position to the nearest guide (and repeat edge), the
   * way a marquee edge clicks onto a fold line. Returns {r,c,snapped}.
   */
  snapCell(r, c) {
    if (!this.snapGuides || (!this.guides.length && !this.repeats.length)) return { r, c, snapped: false };
    const rowSnap = snapPosition(r, { guides: this.guides, repeats: this.repeats, axis: 'row' });
    const colSnap = snapPosition(c, { guides: this.guides, repeats: this.repeats, axis: 'col' });
    return {
      r: rowSnap.snapped ? Math.round(rowSnap.value) : r,
      c: colSnap.snapped ? Math.round(colSnap.value) : c,
      snapped: rowSnap.snapped || colSnap.snapped
    };
  }

  // ─── legacy selection bounds API ───────────────────────────────────────────

  getSelectionBounds() {
    if (!this._selectionKeys.size) return null;
    const rect = rectFromKeys(this._selectionKeys);
    if (!rect) return null;
    const r1 = Math.max(0, Math.min(rect.r1, rect.r2));
    const r2 = Math.min(this.rows - 1, Math.max(rect.r1, rect.r2));
    const c1 = Math.max(0, Math.min(rect.c1, rect.c2));
    const c2 = Math.min(this.cols - 1, Math.max(rect.c1, rect.c2));
    if (r1 > r2 || c1 > c2) return null;
    return { r1, r2, c1, c2 };
  }

  copySelection() {
    const b = this.getSelectionBounds();
    if (!b) { this.clipboard = null; return false; }
    const comp = this._snapshotComposite();
    const cells = [];
    for (let r = b.r1; r <= b.r2; r++) {
      const row = [];
      for (let c = b.c1; c <= b.c2; c++) row.push(comp[r][c]);
      cells.push(row);
    }
    this.clipboard = { rows: cells.length, cols: cells[0].length, cells };
    return true;
  }

  deleteSelection() {
    if (!this._selectionKeys.size) return false;
    const changed = this.paintKeys(this._selectionKeys, this.getEraseValue());
    if (!changed) return false;
    this._setLabel('Delete selection');
    this.saveState();
    this.render();
    this.onChange();
    return true;
  }

  cutSelection() {
    const ok = this.copySelection();
    if (ok) this.deleteSelection();
    return ok;
  }

  // Paste at the current selection origin, else at the hovered cell, else top-left.
  pasteClipboard() {
    if (!this.clipboard) return false;
    let anchorR = 0, anchorC = 0;
    const b = this.getSelectionBounds();
    if (b) { anchorR = b.r1; anchorC = b.c1; }
    else if (this.hoverCell && this.hoverCell.r >= 0) { anchorR = this.hoverCell.r; anchorC = this.hoverCell.c; }

    const next = this._snapshotComposite();
    for (let r = 0; r < this.clipboard.rows; r++) {
      for (let c = 0; c < this.clipboard.cols; c++) {
        const tr = anchorR + r, tc = anchorC + c;
        if (tr >= 0 && tr < this.rows && tc >= 0 && tc < this.cols) {
          next[tr][tc] = this.clipboard.cells[r][c];
        }
      }
    }
    this._setLabel('Paste');
    this.setMatrix(next);
    // Move the marquee to cover the pasted block.
    this.selection = {
      r1: anchorR, c1: anchorC,
      r2: Math.min(this.rows - 1, anchorR + this.clipboard.rows - 1),
      c2: Math.min(this.cols - 1, anchorC + this.clipboard.cols - 1)
    };
    this.render();
    return true;
  }

  // Rotate the selected (or whole-grid) block 90 degrees. dir: 'cw' | 'ccw'.
  // The rotated block is written back from the same top-left origin and clipped
  // to the canvas, so a rotation can never overflow or throw.
  rotateSelection(dir = 'cw') {
    const b = this.getSelectionBounds() || { r1: 0, c1: 0, r2: this.rows - 1, c2: this.cols - 1 };
    const h = b.r2 - b.r1 + 1;
    const w = b.c2 - b.c1 + 1;
    const comp = this._snapshotComposite();
    const src = [];
    for (let r = 0; r < h; r++) {
      const row = [];
      for (let c = 0; c < w; c++) row.push(comp[b.r1 + r][b.c1 + c]);
      src.push(row);
    }
    const blank = this.getEraseValue();
    const next = comp.map(row => [...row]);
    // Destination is w tall x h wide.
    for (let dr = 0; dr < w; dr++) {
      for (let dc = 0; dc < h; dc++) {
        let sr, sc;
        if (dir === 'cw') { sr = h - 1 - dc; sc = dr; }      // (sr,sc) -> (sc, h-1-sr)
        else { sr = dc; sc = w - 1 - dr; }                    // ccw
        const tr = b.r1 + dr, tc = b.c1 + dc;
        if (tr >= 0 && tr < this.rows && tc >= 0 && tc < this.cols) {
          next[tr][tc] = (src[sr] && src[sr][sc] !== undefined) ? src[sr][sc] : blank;
        }
      }
    }
    this._setLabel(`Rotate selection ${dir}`);
    this.setMatrix(next);
    this.selection = {
      r1: b.r1, c1: b.c1,
      r2: Math.min(this.rows - 1, b.r1 + w - 1),
      c2: Math.min(this.cols - 1, b.c1 + h - 1)
    };
    this.render();
    return true;
  }

  // ---- Whole-card operations (kept from the classic editor API) ----

  clear() {
    for (const layer of this.stack.layers) {
      if (layer.kind === 'pattern' && !layer.locked) clearLayer(this.stack, layer.id);
    }
    this._setLabel('Clear card');
    this.saveState();
    this.render();
    this.onChange();
  }

  invert() {
    const next = invertRegion(this._snapshotComposite(), null, { mode: this.mode }).matrix;
    this._setLabel('Invert');
    this.setMatrix(next);
  }

  flipHorizontal() {
    const next = flipRegion(this._snapshotComposite(), null, 'h', { mode: this.mode }).matrix;
    this._clearSelectionKeys(); // a flip is a one-time op: don't leave a stale marquee
    this._setLabel('Flip horizontal');
    this.setMatrix(next);
  }

  flipVertical() {
    const next = flipRegion(this._snapshotComposite(), null, 'v', { mode: this.mode }).matrix;
    this._clearSelectionKeys(); // a flip is a one-time op: don't leave a stale marquee
    this._setLabel('Flip vertical');
    this.setMatrix(next);
  }

  /** Toroidal shift of the whole card (punchcard repeat alignment). */
  shift(deltaR, deltaC) {
    const comp = this._snapshotComposite();
    const newMatrix = [];
    for (let r = 0; r < this.rows; r++) {
      newMatrix[r] = [];
      const srcR = (r - deltaR + this.rows * 10) % this.rows;
      for (let c = 0; c < this.cols; c++) {
        const srcC = (c - deltaC + this.cols * 10) % this.cols;
        newMatrix[r][c] = comp[srcR][srcC];
      }
    }
    this._setLabel('Shift card');
    this.setMatrix(newMatrix);
  }

  // ─── guides & repeats ──────────────────────────────────────────────────────

  addGuideAt(axis, at, opts = {}) {
    const guide = addGuide(this.guides, { at, axis, ...opts });
    this._setLabel('Add guide');
    this.render();
    return guide;
  }

  removeGuideById(id) {
    const removed = removeGuide(this.guides, id);
    this.render();
    return removed;
  }

  toggleGuideLockById(id) {
    const result = toggleGuideLock(this.guides, id);
    this.render();
    return result;
  }

  /**
   * Replace the guide list wholesale (loading a project, clearing them all).
   * Anything without a finite position and a known axis is dropped rather than
   * guessed at, so a malformed file cannot put a line at `NaN`.
   * @param {Array} list
   * @param {{silent?: boolean}} [opts] `silent` skips the repaint — used when a
   *   project load sets guides, repeats and notes in one go.
   */
  setGuides(list, { silent = false } = {}) {
    this.guides = (Array.isArray(list) ? list : [])
      .filter(g => g && Number.isFinite(g.at) && (g.axis === 'col' || g.axis === 'row'))
      .map(g => ({ id: g.id, axis: g.axis, at: g.at, name: g.name ?? null, locked: Boolean(g.locked), color: g.color ?? null }));
    if (!silent) this.render();
    return this.guides.length;
  }

  addRepeatFromSelection(name = 'Repeat') {
    const b = this.getSelectionBounds();
    if (!b) return null;
    return addRepeat(this.repeats, { r1: b.r1, c1: b.c1, r2: b.r2, c2: b.c2, name });
  }

  addRepeatAt(rect, name = 'Repeat') {
    return addRepeat(this.repeats, { ...rect, name });
  }

  removeRepeatById(id) {
    const removed = removeRepeat(this.repeats, id);
    this.render();
    return removed;
  }

  setRepeats(list, { silent = false } = {}) {
    this.repeats = (Array.isArray(list) ? list : [])
      .filter(r => r && [r.r1, r.c1, r.r2, r.c2].every(v => Number.isFinite(v)))
      .map(r => ({
        id: r.id,
        name: r.name ?? 'Repeat',
        r1: Math.min(r.r1, r.r2),
        r2: Math.max(r.r1, r.r2),
        c1: Math.min(r.c1, r.c2),
        c2: Math.max(r.c1, r.c2)
      }));
    if (!silent) this.render();
    return this.repeats.length;
  }

  // ─── annotations ───────────────────────────────────────────────────────────

  /**
   * Draw the knitter's annotations as pinned labels on the card. Like the
   * advisory highlight this is view-only: the notes are never punched onto the
   * card and never reach the compiler.
   * @param {Array} list raw annotation records (or the legacy {r,c,text,color})
   */
  setAnnotations(list, { silent = false } = {}) {
    if (!Array.isArray(list)) {
      this.annotations = [];
    } else if (list.length && list.every(a => a && (typeof a.kind === 'string' || a.kind === undefined))) {
      const cleaned = sanitizeAnnotations(
        list.map(a => (a && a.kind ? a : { kind: 'note', ...a })),
        { rows: this.rows || Infinity, cols: this.cols || Infinity, limit: 500 }
      );
      this.annotations = cleaned.annotations;
    } else {
      this.annotations = [];
    }
    if (!silent) this.render();
    return this.annotations.length;
  }

  /** A copy — callers snapshot this into storage and must not hold the live array. */
  getAnnotations() {
    return this.annotations.map(annotation => ({ ...annotation }));
  }

  addAnnotationAt(kind, spec) {
    const result = addAnnotation(this.annotations, kind, spec);
    if (result.ok) this.render();
    return result;
  }

  updateAnnotationById(id, patch) {
    const result = updateAnnotation(this.annotations, id, patch);
    if (result.ok) this.render();
    return result;
  }

  moveAnnotationById(id, dr, dc) {
    const result = moveAnnotation(this.annotations, id, dr, dc);
    if (result.ok) this.render();
    return result;
  }

  deleteAnnotationById(id) {
    const result = deleteAnnotation(this.annotations, id);
    this.render();
    return result;
  }

  clearAnnotations() {
    if (!this.annotations.length) return;
    this.annotations = [];
    this.render();
  }

  // ─── tools ─────────────────────────────────────────────────────────────────

  /** Every tool id the editor understands, for toolbar/command validation. */
  static get TOOLS() {
    return [
      'pencil', 'eraser', 'fill', 'wand', 'lasso', 'bezier', 'spline', 'smudge',
      'line', 'rect', 'rectOutline', 'circle', 'circleOutline',
      'select', 'measure', 'annotate', 'heart', 'pan'
    ];
  }

  setActiveTool(tool) {
    this.activeTool = tool;
    // Switching tools abandons any half-finished multi-click path: the common
    // "oops" that used to leave stray spline points on the canvas.
    this._lasso = null;
    this._bezierPoints = [];
    this._splinePoints = [];
    this._measureDrag = null;
    this._smudgePath = null;

    // Update UI button states
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tool === tool) {
          btn.classList.add('active');
        }
      });
    }

    // Update cursor
    if (tool === 'pan') {
      this.canvas.style.cursor = 'grab';
    } else {
      this.canvas.style.cursor = 'crosshair';
    }
  }

  /** Commit the spline/bezier path(s) built so far into the selection. */
  finishPathTool() {
    if (this.activeTool === 'spline' && this._splinePoints.length >= 2) {
      const keys = splineCells(this._splinePoints);
      this._splinePoints = [];
      this.setSelectionKeys(keys, { extend: false, label: 'Spline selection' });
      return true;
    }
    if (this.activeTool === 'lasso' && this._lasso && this._lasso.length >= 3) {
      const keys = polygonKeys(this._lasso, { rows: this.rows, cols: this.cols });
      this._lasso = null;
      this.setSelectionKeys(keys, { label: 'Lasso selection' });
      return true;
    }
    return false;
  }

  cancelPathTool() {
    const had = Boolean(this._lasso) || this._bezierPoints.length > 0 || this._splinePoints.length > 0;
    this._lasso = null;
    this._bezierPoints = [];
    this._splinePoints = [];
    this._measureDrag = null;
    this._smudgePath = null;
    if (had) this.render();
    return had;
  }

  fitToView() {
    const rect = this.canvas.getBoundingClientRect();
    const availableWidth = rect.width - 40;
    const availableHeight = rect.height - 40;

    // Calculate optimal zoom to fit the grid
    const zoomX = availableWidth / this.cols;
    const zoomY = availableHeight / this.rows;
    this.zoom = Math.min(zoomX, zoomY);

    // Center the grid
    this.panX = (rect.width - this.cols * this.zoom) / 2;
    this.panY = (rect.height - this.rows * this.zoom) / 2;

    this.render();
  }

  throttle(func, limit) {
    let inThrottle;
    return function (...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // Coordinate transforms
  screenToCell(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = screenX - rect.left - this.panX;
    const y = screenY - rect.top - this.panY;

    const col = Math.floor(x / this.zoom);
    // In knitting, row 0 is at the bottom (cast-on), increasing upwards
    const row = this.rows - 1 - Math.floor(y / this.zoom);

    return { r: row, c: col };
  }

  /** Float version of screenToCell — lasso and snap need sub-cell precision. */
  screenToCellFloat(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = screenX - rect.left - this.panX;
    const y = screenY - rect.top - this.panY;
    return { r: this.rows - 1 - y / this.zoom, c: x / this.zoom };
  }

  cellToScreen(r, c) {
    const screenX = this.panX + c * this.zoom;
    const screenY = this.panY + (this.rows - 1 - r) * this.zoom;
    return { x: screenX, y: screenY };
  }

  // True when (r, c) falls on a real cell of the grid.
  _cellInBounds(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  _notify(message, opts = {}) {
    try {
      if (this.onNotify) this.onNotify(message, opts);
    } catch (_) { /* a missing notifier must never eat a stroke */ }
  }

  /**
   * Point the canvas at a set of cells the advisor is talking about. Purely
   * visual: draws a bright overlay and pans so they are on screen, without ever
   * mutating the matrix or the undo history.
   * @param {Array<[number, number]>} cells  [row, col] pairs to spotlight.
   * @param {{color?:string, fill?:string, label?:string}} [opts]
   */
  setHighlight(cells, opts = {}) {
    this.highlight = Array.isArray(cells) && cells.length
      ? { cells, color: opts.color || '#fde047', fill: opts.fill || 'rgba(253, 224, 71, 0.30)', label: opts.label || '' }
      : null;
    if (this.highlight) this.scrollToCells(cells);
    this.render();
    return this.highlight;
  }

  clearHighlight() {
    if (!this.highlight) return;
    this.highlight = null;
    this.render();
  }

  /** Pan the viewport so the centroid of `cells` sits in the middle of the view. */
  scrollToCells(cells) {
    if (!cells || !cells.length) return;
    let sr = 0, sc = 0;
    for (const [r, c] of cells) { sr += r; sc += c; }
    const avgR = sr / cells.length, avgC = sc / cells.length;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return; // hidden canvas — leave the pan alone
    // If the whole grid already fits, don't shove it off-centre.
    if (this.cols * this.zoom <= rect.width - 80 && this.rows * this.zoom <= rect.height - 80) {
      this.fitToView();
      return;
    }
    this.panX = rect.width / 2 - (avgC + 0.5) * this.zoom;
    this.panY = rect.height / 2 - (this.rows - 1 - avgR + 0.5) * this.zoom;
  }

  /** Which guide (if any) sits within reach of this screen point. */
  _guideAtPoint(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = screenX - rect.left - this.panX;
    const y = screenY - rect.top - this.panY;
    for (const guide of this.guides) {
      if (!guide || !Number.isFinite(guide.at)) continue;
      if (guide.axis === 'row') {
        const gy = (this.rows - guide.at) * this.zoom;
        if (Math.abs(gy - y) <= GUIDE_HIT_PX) return guide;
      } else {
        const gx = guide.at * this.zoom + this.zoom / 2;
        if (Math.abs(gx - x) <= GUIDE_HIT_PX) return guide;
      }
    }
    return null;
  }

  /** Which annotation pin sits under this screen point (dot first, then line). */
  _annotationAtPoint(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = screenX - rect.left - this.panX;
    const y = screenY - rect.top - this.panY;
    for (let i = this.annotations.length - 1; i >= 0; i--) {
      const a = this.annotations[i];
      if (!a || !this._cellInBounds(a.r, a.c)) continue;
      const ax = a.c * this.zoom + this.zoom * 0.2;
      const ay = (this.rows - 1 - a.r) * this.zoom + this.zoom * 0.2;
      if (Math.hypot(ax - x, ay - y) <= Math.max(ANNOTATION_HIT_PX, this.zoom * 0.35)) return a;
    }
    return null;
  }

  _floatFromEvent(e) {
    const cell = this.screenToCellFloat(e.clientX, e.clientY);
    return { r: cell.r, c: cell.c };
  }

  // Mouse, touch & pen handlers — Pointer Events so every input device works.
  setupEvents() {
    const canvas = this.canvas;

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Performance optimization: throttled rendering
    this.throttledRender = this.throttle(() => this.render(), 16); // ~60fps max

    // Live pointers over the canvas, for pinch-zoom / two-finger pan.
    this._pointers = new Map();
    this._pinch = null;

    canvas.addEventListener('pointerdown', e => {
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size >= 2) {
        this._beginPinch();
        return;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* window listeners still cover it */ }

      // Grab order matters: a guide line, then an annotation pin, then the tool.
      // Both drags must win over painting, otherwise a note sitting on the chart
      // is impossible to move without erasing the cell under it.
      if (e.button === 0 && !e.altKey) {
        const guide = this._guideAtPoint(e.clientX, e.clientY);
        if (guide && !guide.locked) {
          this._guideDrag = { guide, axis: guide.axis };
          return;
        }
        if (guide && guide.locked) return; // a click on a locked guide is a no-op, not a paint
        const annotation = this._annotationAtPoint(e.clientX, e.clientY);
        if (annotation) {
          this._annotationDrag = { annotation, last: this.screenToCell(e.clientX, e.clientY) };
          return;
        }
      }

      const cell = this.screenToCell(e.clientX, e.clientY);
      this.lastMousePos = { x: e.clientX, y: e.clientY };

      if (e.button === 1 || (e.altKey && !this._isSelectionTool()) || this.activeTool === 'pan' || (e.button === 0 && e.shiftKey && !this._isSelectionTool())) {
        // Pan tool (shift still pans outside the selection tools, where shift
        // belongs to the selection the way every image editor does it).
        this.isPanning = true;
        canvas.style.cursor = 'grabbing';
        return;
      }

      // Default to panning on empty space: a left-press that lands outside the
      // grid has no cell to paint or marquee, so rather than doing nothing it
      // navigates. Painting/selecting the moment you are over a cell is unchanged.
      if (e.button === 0 && !this._cellInBounds(cell.r, cell.c) && !this._isSelectionTool()) {
        this.isPanning = true;
        canvas.style.cursor = 'grabbing';
        return;
      }

      this.isMouseDown = true;
      this.dragStartCell = cell;
      if (this.highlight) this.highlight = null; // taking a paint stroke dismisses the advisor spotlight

      if (e.button === 2) {
        // Right click: Erase
        this.applyStitchAt(cell.r, cell.c, this.getEraseValue());
      } else {
        this._beginToolStroke(cell, e);
      }
      this.render();
    });

    window.addEventListener('pointermove', e => {
      if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pinch) {
        this._updatePinch();
        return;
      }
      if (this._guideDrag) {
        const pos = this.screenToCellFloat(e.clientX, e.clientY);
        const axis = this._guideDrag.axis;
        const raw = axis === 'row' ? this.rows - pos.r : pos.c;
        const snapped = snapPosition(raw, { guides: this.guides, repeats: this.repeats, axis });
        moveGuide(this.guides, this._guideDrag.guide.id, snapped.value, { rows: this.rows, cols: this.cols });
        this.render();
        return;
      }
      if (this._annotationDrag) {
        const cell = this.screenToCell(e.clientX, e.clientY);
        const dr = cell.r - this._annotationDrag.last.r;
        const dc = cell.c - this._annotationDrag.last.c;
        if (dr || dc) {
          moveAnnotation(this.annotations, this._annotationDrag.annotation.id, dr, dc);
          this._annotationDrag.last = cell;
          this.render();
        }
        return;
      }
      const cell = this.screenToCell(e.clientX, e.clientY);
      this.hoverCell = cell;

      if (this.isPanning) {
        this.panX += e.clientX - this.lastMousePos.x;
        this.panY += e.clientY - this.lastMousePos.y;
        this.lastMousePos = { x: e.clientX, y: e.clientY };
        this.render();
        return;
      }

      if (this.isMouseDown) {
        this._continueToolStroke(cell, e);
      } else {
        this.throttledRender();
      }
    });

    const endStroke = e => {
      this._pointers.delete(e.pointerId);
      if (this._pinch && this._pointers.size < 2) {
        this._pinch = null;
        canvas.style.cursor = 'crosshair';
      }
      if (this._guideDrag) {
        this._guideDrag = null;
        return;
      }
      if (this._annotationDrag) {
        this._annotationDrag = null;
        this.render();
        return;
      }
      if (this.isPanning) {
        this.isPanning = false;
        canvas.style.cursor = 'crosshair';
        return;
      }

      if (this.isMouseDown) {
        this.isMouseDown = false;
        const cell = this.screenToCell(e.clientX, e.clientY);
        this._endToolStroke(cell, e);
        this.saveState();
        this.render();
        this.onChange();
      }
    };
    window.addEventListener('pointerup', endStroke);
    window.addEventListener('pointercancel', endStroke);

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.88;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const newZoom = Math.max(8, Math.min(70, this.zoom * zoomFactor));
      // Zoom centered at mouse position
      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;

      this.render();
    });

    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.render();
    });

    // Editor-local keyboard: multi-click tools need Enter/Escape without asking
    // the app's global handler to know about canvas modes.
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', e => {
        if (e.defaultPrevented) return;
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        if (e.key === 'Enter') {
          if (this.activeTool === 'spline' || this.activeTool === 'lasso') {
            if (this.finishPathTool()) e.preventDefault();
          }
        } else if (e.key === 'Escape') {
          if (this.cancelPathTool()) e.preventDefault();
        }
      });
    }
  }

  _isSelectionTool() {
    return ['select', 'wand', 'lasso', 'bezier', 'spline'].includes(this.activeTool);
  }

  /** Press phase of every tool. Geometry tools wait for the drag to end. */
  _beginToolStroke(cell, e) {
    const additive = (e.shiftKey || e.ctrlKey || e.metaKey) && this._isSelectionTool();
    const float = this._floatFromEvent(e);
    switch (this.activeTool) {
      case 'pencil':
        this.applyStitchAt(cell.r, cell.c, this.getActiveDrawValue());
        break;
      case 'eraser':
        this.applyStitchAt(cell.r, cell.c, this.getEraseValue());
        break;
      case 'heart':
        this.stampHeartAt(cell.r, cell.c, this.getActiveDrawValue());
        break;
      case 'fill':
        this.floodFill(cell.r, cell.c, this.getActiveDrawValue());
        break;
      case 'wand':
        // shift keeps the old selection and toggles this region in/out of it.
        if (additive) this.toggleSelectionKeys(this._wandKeys(cell));
        else this.wandSelect(cell.r, cell.c);
        break;
      case 'lasso':
        this._lasso = [float];
        break;
      case 'bezier':
        this._bezierPoints.push(float);
        if (this._bezierPoints.length >= 4) {
          const [p0, p1, p2, p3] = this._bezierPoints;
          this._bezierPoints = [];
          const keys = clipKeys(bezierCells(p0, p1, p2, p3), this.rows, this.cols);
          if (additive) this.toggleSelectionKeys(keys);
          else this.setSelectionKeys(keys, { label: 'Bézier selection' });
        }
        break;
      case 'spline':
        this._splinePoints.push(float);
        break;
      case 'smudge':
        this._smudgePath = [{ r: cell.r, c: cell.c }];
        break;
      case 'measure':
        this._measureDrag = { r1: cell.r, c1: cell.c, r2: cell.r, c2: cell.c };
        break;
      case 'annotate':
        this._openNoteInput(cell.r, cell.c);
        this.isMouseDown = false;
        this.dragStartCell = null;
        break;
      default:
        // line/rect/rectOutline/circle/circleOutline/select wait for pointerup.
        break;
    }
  }

  _wandKeys(cell) {
    const comp = this._snapshotComposite();
    const result = floodRegion(comp, cell.r, cell.c, {
      match: 'value',
      blank: blankValue(this.mode),
      limit: SELECTION_FLOOD_LIMIT
    });
    if (result.capped) {
      this._notify(`That region is ${result.attempted.toLocaleString()} cells — too big to select.`, { duration: 6000 });
      return new Set();
    }
    return result.keys;
  }

  _continueToolStroke(cell, e) {
    const erasing = e.buttons === 2;
    switch (this.activeTool) {
      case 'pencil': {
        const val = erasing ? this.getEraseValue() : this.getActiveDrawValue();
        this.applyStitchAt(cell.r, cell.c, val);
        this.render();
        break;
      }
      case 'eraser':
        this.applyStitchAt(cell.r, cell.c, this.getEraseValue());
        this.render();
        break;
      case 'lasso':
        if (this._lasso) {
          const float = this._floatFromEvent(e);
          const last = this._lasso[this._lasso.length - 1];
          if (Math.hypot(float.r - last.r, float.c - last.c) >= 0.3) this._lasso.push(float);
          this.render();
        }
        break;
      case 'smudge':
        if (this._smudgePath) {
          const last = this._smudgePath[this._smudgePath.length - 1];
          if (last.r !== cell.r || last.c !== cell.c) this._smudgePath.push({ r: cell.r, c: cell.c });
          this.render();
        }
        break;
      case 'measure':
        if (this._measureDrag) {
          this._measureDrag.r2 = cell.r;
          this._measureDrag.c2 = cell.c;
          this.render();
        }
        break;
      case 'line':
      case 'rect':
      case 'rectOutline':
      case 'circle':
      case 'circleOutline':
      case 'select':
        // Preview geometry during drag
        this.render();
        break;
      default:
        break;
    }
  }

  _endToolStroke(cell, e) {
    const s = this.dragStartCell;
    const val = e.button === 2 ? this.getEraseValue() : this.getActiveDrawValue();

    switch (this.activeTool) {
      case 'lasso':
        if (this._lasso && this._lasso.length >= 3) {
          const keys = polygonKeys(this._lasso, { rows: this.rows, cols: this.cols });
          const additive = e.shiftKey || e.ctrlKey || e.metaKey;
          this._lasso = null;
          if (additive) this.toggleSelectionKeys(keys);
          else this.setSelectionKeys(keys, { label: 'Lasso selection' });
        } else {
          this._lasso = null;
        }
        break;
      case 'spline':
        // A single click can finish with Enter later; drags just extend points.
        break;
      case 'smudge':
        if (this._smudgePath && this._smudgePath.length >= 2) {
          const path = this._smudgePath;
          this._smudgePath = null;
          const next = smudgePath(this._snapshotComposite(), path, { mode: this.mode });
          const matrix = next && next.matrix ? next.matrix : next;
          if (Array.isArray(matrix)) {
            this._setLabel('Smudge');
            this.setMatrix(matrix);
          }
        } else {
          this._smudgePath = null;
        }
        break;
      case 'measure': {
        const drag = this._measureDrag;
        this._measureDrag = null;
        if (drag && (drag.r1 !== cell.r || drag.c1 !== cell.c)) {
          const result = this.addAnnotationAt('dimension', { r: drag.r1, c: drag.c1, r2: cell.r, c2: cell.c });
          if (result.ok) {
            const info = this.annotationReadout(result.annotation);
            this._notify(`Dimension: ${info.label}`, { duration: 3500 });
          }
        }
        break;
      }
      case 'select':
        if (s) {
          const snappedA = this.snapCell(s.r, s.c);
          const snappedB = this.snapCell(cell.r, cell.c);
          const rect = {
            r1: Math.min(snappedA.r, snappedB.r),
            c1: Math.min(snappedA.c, snappedB.c),
            r2: Math.max(snappedA.r, snappedB.r),
            c2: Math.max(snappedA.c, snappedB.c)
          };
          const keys = rectKeys(clampRect(rect, this.rows, this.cols) || rect);
          if (e.shiftKey || e.ctrlKey || e.metaKey) this.toggleSelectionKeys(keys);
          else this.setSelectionKeys(keys, { label: 'Marquee selection' });
        }
        break;
      case 'line':
        if (s) this._paintCells(lineCells(s.r, s.c, cell.r, cell.c), val);
        break;
      case 'rect':
        if (s) this._paintCells(rectKeys(normalizeRect({ r1: s.r, c1: s.c, r2: cell.r, c2: cell.c })), val);
        break;
      case 'rectOutline':
        if (s) this._paintCells(rectOutlineCells({ r1: s.r, c1: s.c, r2: cell.r, c2: cell.c }), val);
        break;
      case 'circle':
        if (s) this._paintCells(ellipseCells(s.r, s.c, cell.r, cell.c, { filled: true }), val);
        break;
      case 'circleOutline':
        if (s) this._paintCells(ellipseCells(s.r, s.c, cell.r, cell.c, { filled: false }), val);
        break;
      default:
        break;
    }
    this.dragStartCell = null;
  }

  _paintCells(keys, value) {
    // Geometry tools keep symmetry: every generated cell goes through the same
    // mirrored write the pencil uses, so a filled rect drawn with mirror on
    // appears four times exactly like Photoshop's symmetry painting.
    for (const key of keys) {
      const { r, c } = parseCellKey(key);
      this.applyStitchAt(r, c, value);
    }
  }

  /**
   * Inline note editor for the annotate tool: a real <input> parked over the
   * cell, so entering text works with every IME instead of a window.prompt
   * the browser may suppress.
   */
  _openNoteInput(r, c) {
    if (this._noteInput) this._commitNoteInput();
    if (typeof document === 'undefined' || !this.canvas.parentElement) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'kx-canvas-note-input';
    input.placeholder = 'Note… (Enter to pin)';
    input.maxLength = 2000;
    const pos = this.cellToScreen(r, c);
    input.style.position = 'absolute';
    input.style.left = `${pos.x}px`;
    input.style.top = `${pos.y}px`;
    input.style.zIndex = '30';
    input.dataset.cell = `${r},${c}`;
    this.canvas.parentElement.appendChild(input);
    this._noteInput = { input, r, c };
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); this._commitNoteInput(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); this._discardNoteInput(); }
      ev.stopPropagation();
    });
    input.addEventListener('blur', () => this._commitNoteInput());
    setTimeout(() => { try { input.focus(); } catch (_) { /* hidden tab */ } }, 0);
  }

  _commitNoteInput() {
    const pending = this._noteInput;
    if (!pending) return;
    this._noteInput = null;
    const text = String(pending.input.value || '').trim();
    pending.input.remove();
    if (text) {
      this.addAnnotationAt('note', { r: pending.r, c: pending.c, text });
    }
    this.render();
  }

  _discardNoteInput() {
    const pending = this._noteInput;
    if (!pending) return;
    this._noteInput = null;
    pending.input.remove();
    this.render();
  }

  /** Two fingers down: drop any stroke and switch to navigating. */
  _beginPinch() {
    this.isMouseDown = false;
    this.isPanning = false;
    this.dragStartCell = null;
    const [a, b] = [...this._pointers.values()];
    this._pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    };
    this.canvas.style.cursor = 'grabbing';
  }

  /** Pinch distance → zoom about the midpoint; midpoint drift → pan. */
  _updatePinch() {
    const pts = [...this._pointers.values()];
    if (pts.length < 2 || !this._pinch) return;
    const [a, b] = pts;
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rect = this.canvas.getBoundingClientRect();
    const px = mid.x - rect.left;
    const py = mid.y - rect.top;

    this.panX += mid.x - this._pinch.mid.x;
    this.panY += mid.y - this._pinch.mid.y;

    const newZoom = Math.max(8, Math.min(70, this.zoom * (dist / this._pinch.dist)));
    this.panX = px - (px - this.panX) * (newZoom / this.zoom);
    this.panY = py - (py - this.panY) * (newZoom / this.zoom);
    this.zoom = newZoom;

    this._pinch = { dist, mid };
    this.render();
  }

  resizeCanvas() {
    const parent = this.canvas.parentElement;
    // Skip while hidden (0×0) — otherwise the CSS 100% scaling stretches a
    // stale fallback buffer across the panel (e.g. on first tab switch).
    if (parent && parent.clientWidth > 0 && parent.clientHeight > 0) {
      // Back the canvas with `devicePixelRatio` device pixels per CSS pixel so lines
      // and Japanese glyphs stay crisp on hi-DPI screens. The CSS size stays logical
      // (`canvas { width:100%; height:100% }`), so pointer→cell maths and the ruler
      // keep working in CSS pixels untouched; render() re-applies the pixel-ratio
      // transform every frame (resizing the buffer resets the context transform).
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      this.dpr = dpr;
      this.canvas.width = Math.round(parent.clientWidth * dpr);
      this.canvas.height = Math.round(parent.clientHeight * dpr);
    }
  }

  // ─── values & painting ─────────────────────────────────────────────────────

  getActiveDrawValue() {
    if (this.mode === 'lace') return this.activeStitch;
    // Direct modes: honour the selected yarn (A = 0 background, B = 1 contrast/hole).
    return this.activeColor === 0 ? 0 : 1;
  }

  getEraseValue() {
    return blankValue(this.mode);
  }

  /**
   * The single per-cell write path: the active layer (symmetry mirrors
   * included). Every drawing tool lands here, which is what lets the layer
   * stack, the history commit and the punchcard preview agree on one story.
   */
  applyStitchAt(r, c, value) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
    // Erasing reaches through to the layer that OWNS the visible cell: writing a
    // blank to the active layer alone would make the eraser look broken whenever
    // two layers overlap (the lower one would keep punching through).
    const isBlank = value === blankValue(this.mode);
    const result = isBlank ? eraseAt(this.stack, r, c) : paintAt(this.stack, r, c, value);
    if (!result.ok) return false;

    // Handle symmetries
    if (this.symmetryH) {
      const mirrorC = this.cols - 1 - c;
      let mirrorVal = value;
      if (value === STITCH_TYPE.TRANSFER_LEFT) mirrorVal = STITCH_TYPE.TRANSFER_RIGHT;
      else if (value === STITCH_TYPE.TRANSFER_RIGHT) mirrorVal = STITCH_TYPE.TRANSFER_LEFT;
      if (isBlank) eraseAt(this.stack, r, mirrorC);
      else paintAt(this.stack, r, mirrorC, mirrorVal);
    }
    if (this.symmetryV) {
      const mirrorR = this.rows - 1 - r;
      if (isBlank) eraseAt(this.stack, mirrorR, c);
      else paintAt(this.stack, mirrorR, c, value);
    }
    return true;
  }

  /** Paint a whole key-set on the active layer. Returns cells actually changed. */
  paintKeys(keys, value) {
    let changed = 0;
    for (const key of keys) {
      const { r, c } = parseCellKey(key);
      if (this.applyStitchAt(r, c, value)) changed++;
    }
    return changed;
  }

  // ─── geometry drawing primitives (thin wrappers over select-ops) ───────────

  drawLine(r0, c0, r1, c1, value) {
    this._paintCells(lineCells(r0, c0, r1, c1), value);
  }

  drawRect(r0, c0, r1, c1, value) {
    this._paintCells(rectKeys(normalizeRect({ r1: r0, c1: c0, r2: r1, c2: c1 })), value);
  }

  drawCircle(r0, c0, r1, c1, value) {
    this._paintCells(ellipseCells(r0, c0, r1, c1, { filled: true }), value);
  }

  // Rectangle drawn as a 1-cell-thick perimeter only (outline), not filled.
  drawRectOutline(r0, c0, r1, c1, value) {
    this._paintCells(rectOutlineCells({ r1: r0, c1: c0, r2: r1, c2: c1 }), value);
  }

  // Ellipse drawn as a perimeter ring (outline), one cell thick.
  drawEllipseOutline(r0, c0, r1, c1, value) {
    this._paintCells(ellipseCells(r0, c0, r1, c1, { filled: false }), value);
  }

  stampHeartAt(centerR, centerC, value) {
    const heartOffsets = [
      [1, -1], [1, 1],
      [0, -2], [0, -1], [0, 0], [0, 1], [0, 2],
      [-1, -2], [-1, -1], [-1, 0], [-1, 1], [-1, 2],
      [-2, -1], [-2, 0], [-2, 1],
      [-3, 0]
    ];
    for (const [dr, dc] of heartOffsets) {
      this.applyStitchAt(centerR + dr, centerC + dc, value);
    }
    this._setLabel('Heart stamp');
    this.saveState();
    this.render();
    this.onChange();
  }

  /** Bucket fill: the same region math the wand uses, then paint it. */
  floodFill(startR, startC, targetValue) {
    if (startR < 0 || startR >= this.rows || startC < 0 || startC >= this.cols) return;
    const comp = this._snapshotComposite();
    const initialVal = comp[startR] ? comp[startR][startC] : undefined;
    if (initialVal === targetValue) return;
    const region = floodRegion(comp, startR, startC, {
      match: 'value',
      blank: blankValue(this.mode),
      limit: this.rows * this.cols
    });
    this._paintCells(region.keys, targetValue);
  }

  // ─── rendering ─────────────────────────────────────────────────────────────

  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    // Work in CSS pixels; the device-pixel-ratio scale is applied once here so every
    // coordinate below stays logical. `dpr` is set in resizeCanvas (defaults to 1 for
    // a hidden canvas, which matches the old 1:1 behaviour exactly).
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;

    // Background: Dark industrial CAD canvas
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.panX, this.panY);

    const totalGridWidth = this.cols * this.zoom;
    const totalGridHeight = this.rows * this.zoom;

    // Outer grid shadow & border
    ctx.fillStyle = '#131b2e';
    ctx.fillRect(0, 0, totalGridWidth, totalGridHeight);

    // Flatten the stack exactly once per frame: the cells, the layer tinting and
    // every tool preview read the same composite, so a redraw can never show a
    // card that is half one frame and half the next.
    const comp = composite(this.stack);
    const matrix = comp.matrix;
    const multiLayer = this.stack.layers.filter(l => l.visible && l.kind === 'pattern').length > 1;
    const activeId = this.stack.activeId;

    // Draw cells
    for (let r = 0; r < this.rows; r++) {
      const y = (this.rows - 1 - r) * this.zoom;

      for (let c = 0; c < this.cols; c++) {
        const x = c * this.zoom;
        const stitch = matrix[r] ? matrix[r][c] : blankValue(this.mode);

        // Alternating subtle column guide
        if (c % 2 === 0) {
          ctx.fillStyle = '#17223b';
          ctx.fillRect(x, y, this.zoom, this.zoom);
        }

        // Draw stitch glyph or color
        this.renderCellContent(ctx, x, y, this.zoom, stitch, r, c);

        // Layer-aware tinting: a tiny corner pip on cells whose visible value is
        // NOT coming from the layer being drawn on. That is the answer to "why
        // won't this cell erase?" — because the layer under it owns it.
        if (multiLayer && stitch !== blankValue(this.mode)) {
          const ownerId = comp.sources.get(cellKey(r, c));
          if (ownerId && ownerId !== activeId) {
            ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
            ctx.fillRect(x + this.zoom - 3, y + 1, 2, 2);
          }
        }
      }
    }

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let c = 0; c <= this.cols; c++) {
      const x = c * this.zoom;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalGridHeight);
    }
    for (let r = 0; r <= this.rows; r++) {
      const y = r * this.zoom;
      ctx.moveTo(0, y);
      ctx.lineTo(totalGridWidth, y);
    }
    ctx.stroke();

    // Major grid lines (every 5 stitches / rows)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    for (let c = 0; c <= this.cols; c += 6) {
      const x = c * this.zoom;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalGridHeight);
    }
    ctx.stroke();

    this.renderRepeats(ctx);
    this.renderGuides(ctx);

    // Active tool drag preview (geometry, lasso, bezier, spline, measure, smudge)
    if ((this.isMouseDown && this.dragStartCell && ['line', 'rect', 'rectOutline', 'circle', 'circleOutline'].includes(this.activeTool))
      || this._lasso || this._bezierPoints.length || this._splinePoints.length
      || this._measureDrag || (this._smudgePath && this._smudgePath.length)) {
      this.renderToolPreview(ctx);
    }

    // Selection: every picked cell gets a wash (lassos are not rectangles), plus
    // the classic dashed bounding box so the eye has an edge to hold.
    if (this._selectionKeys.size) {
      ctx.save();
      ctx.fillStyle = 'rgba(244, 63, 94, 0.18)';
      for (const key of this._selectionKeys) {
        const { r, c } = parseCellKey(key);
        if (!this._cellInBounds(r, c)) continue;
        ctx.fillRect(c * this.zoom, (this.rows - 1 - r) * this.zoom, this.zoom, this.zoom);
      }
      const b = this.getSelectionBounds();
      if (b) {
        const x1 = b.c1 * this.zoom;
        const y1 = (this.rows - 1 - b.r2) * this.zoom;
        const sw = (b.c2 - b.c1 + 1) * this.zoom;
        const sh = (b.r2 - b.r1 + 1) * this.zoom;
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2.0;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x1, y1, sw, sh);
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Advisory spotlight: the feasibility advisor pointing at the exact cells it
    // means. Drawn above cells/selection but below the rulers. Runs inside the
    // translated context, so x/y are grid-local just like everything above.
    if (this.highlight && this.highlight.cells && this.highlight.cells.length) {
      const hl = this.highlight;
      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = hl.color;
      ctx.fillStyle = hl.fill;
      for (const [r, c] of hl.cells) {
        if (!this._cellInBounds(r, c)) continue;
        const x = c * this.zoom;
        const y = (this.rows - 1 - r) * this.zoom;
        ctx.fillRect(x + 1, y + 1, this.zoom - 2, this.zoom - 2);
        ctx.strokeRect(x + 0.5, y + 0.5, this.zoom - 1, this.zoom - 1);
      }
      ctx.restore();
    }

    this.renderAnnotations(ctx);

    // Draw needle bed ruler and row numbers
    this.renderRulers(ctx, totalGridWidth, totalGridHeight);

    ctx.restore();
  }

  /** Ruler guides: cyan vertical (needle) lines, red horizontal (row) lines. */
  renderGuides(ctx) {
    if (!this.guides.length) return;
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.font = '9px monospace';
    for (const guide of this.guides) {
      if (!guide || !Number.isFinite(guide.at)) continue;
      const locked = Boolean(guide.locked);
      const color = guide.color || (guide.axis === 'row' ? '#f87171' : '#22d3ee');
      ctx.strokeStyle = color;
      ctx.globalAlpha = locked ? 0.55 : 0.9;
      ctx.setLineDash(locked ? [2, 3] : [6, 4]);
      ctx.beginPath();
      if (guide.axis === 'row') {
        const y = (this.rows - guide.at) * this.zoom;
        ctx.moveTo(0, y);
        ctx.lineTo(this.cols * this.zoom, y);
      } else {
        const x = guide.at * this.zoom + this.zoom / 2;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.rows * this.zoom);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (this.zoom >= 10) {
        ctx.fillStyle = color;
        if (guide.axis === 'row') {
          ctx.fillText(`${locked ? '\u{1F512} ' : ''}${guide.name || `row ${Math.round(guide.at) + 1}`}`, 4, (this.rows - guide.at) * this.zoom - 3);
        } else {
          ctx.fillText(`${locked ? '\u{1F512} ' : ''}${guide.name || `needle ${Math.round(guide.at) + 1}`}`, guide.at * this.zoom + this.zoom / 2 + 3, 10);
        }
      }
    }
    ctx.restore();
  }

  /** Repeat tiles: the source block in amber, its copies as faint ghosts. */
  renderRepeats(ctx) {
    if (!this.repeats.length) return;
    ctx.save();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#f59e0b';
    for (const repeat of this.repeats) {
      const n = normalizeRect(repeat);
      if (!n) continue;
      const x = n.c1 * this.zoom;
      const y = (this.rows - 1 - n.r2) * this.zoom;
      const rw = (n.c2 - n.c1 + 1) * this.zoom;
      const rh = (n.r2 - n.r1 + 1) * this.zoom;
      ctx.setLineDash([7, 4]);
      ctx.globalAlpha = 0.95;
      ctx.strokeRect(x, y, rw, rh);
      // Tiling ghosts: where the repeat says the card continues, drawn at a
      // quarter intensity so the eye reads "this repeats here" without a wall
      // of boxes.
      const tiling = repeatTiles(repeat, this.rows, this.cols);
      if (tiling && Array.isArray(tiling.tiles)) {
        ctx.globalAlpha = 0.25;
        for (const tile of tiling.tiles) {
          if (tile.r1 === n.r1 && tile.c1 === n.c1) continue;
          ctx.strokeRect(tile.c1 * this.zoom, (this.rows - 1 - tile.r2) * this.zoom, (tile.c2 - tile.c1 + 1) * this.zoom, (tile.r2 - tile.r1 + 1) * this.zoom);
        }
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /**
   * Human read-out for one annotation (dimension lines and notes share it).
   * Falls back to a cell count when no physical profile is attached, because a
   * dimension in a void is still a dimension in needles.
   */
  annotationReadout(annotation) {
    try {
      if (this.profile && typeof dimensionText === 'function') {
        const info = dimensionText(annotation, this.profile);
        if (info && info.label) return info;
      }
    } catch (_) { /* no pitch — cell units below */ }
    const end = annotation.end || { r: annotation.r, c: annotation.c };
    const cells = `${Math.abs(end.c - annotation.c) + 1} \u00d7 ${Math.abs(end.r - annotation.r) + 1} cells`;
    return { text: cells, label: cells, measurement: cells, full: cells };
  }

  /** Annotations by kind: pins & notes flagged, dimensions & arrows measured. */
  renderAnnotations(ctx) {
    if (!this.annotations || !this.annotations.length) return;
    ctx.save();
    ctx.font = `${Math.max(9, this.zoom * 0.55)}px sans-serif`;
    ctx.textBaseline = 'middle';
    for (const a of this.annotations) {
      if (!this._cellInBounds(a.r, a.c)) continue;
      const color = a.color || (a.kind === 'dimension' ? '#38bdf8' : '#fbbf24');
      const x = a.c * this.zoom;
      const y = (this.rows - 1 - a.r) * this.zoom;
      const cx = x + this.zoom / 2;
      const cy = y + this.zoom / 2;

      if ((a.kind === 'dimension' || a.kind === 'arrow') && a.end && this._cellInBounds(a.end.r, a.end.c)) {
        const ex = a.end.c * this.zoom + this.zoom / 2;
        const ey = (this.rows - 1 - a.end.r) * this.zoom + this.zoom / 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        // End ticks (dimension) or an arrowhead (arrow).
        if (a.kind === 'dimension') {
          for (const [px, py] of [[cx, cy], [ex, ey]]) {
            ctx.beginPath();
            ctx.moveTo(px, py - 4);
            ctx.lineTo(px, py + 4);
            ctx.stroke();
          }
        } else {
          const ang = Math.atan2(ey - cy, ex - cx);
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - 8 * Math.cos(ang - 0.4), ey - 8 * Math.sin(ang - 0.4));
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - 8 * Math.cos(ang + 0.4), ey - 8 * Math.sin(ang + 0.4));
          ctx.stroke();
        }
        const info = this.annotationReadout(a);
        const text = a.text ? `${a.text} · ${info.label}` : info.label;
        if (text) {
          const mx = (cx + ex) / 2;
          const my = (cy + ey) / 2;
          const tw = ctx.measureText(text).width + 6;
          ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
          ctx.fillRect(mx - tw / 2, my - 8, tw, 16);
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.fillText(text, mx, my);
          ctx.textAlign = 'left';
        }
        continue;
      }

      // note / pin / label / symbol: pin dot, then the text bubble.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + this.zoom * 0.2, y + this.zoom * 0.2, Math.max(2, this.zoom * 0.13), 0, Math.PI * 2);
      ctx.fill();
      const text = a.kind === 'symbol' && !a.text ? '★' : String(a.text || '');
      if (text) {
        if (a.kind === 'symbol') {
          ctx.fillStyle = color;
          ctx.fillText(text, x + this.zoom * 0.34, y + this.zoom * 0.5);
          continue;
        }
        const tw = ctx.measureText(text).width + 6;
        const bx = x + this.zoom * 0.34;
        const by = y + this.zoom * 0.08;
        ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
        ctx.fillRect(bx, by, tw, this.zoom * 0.84);
        ctx.fillStyle = color;
        ctx.fillText(text, bx + 3, by + this.zoom * 0.5);
      }
    }
    ctx.restore();
  }

  // Draws a knit stitch as a filled "V" (two legs meeting at the base) so a
  // colourwork / filled region reads as real stockinette rather than flat blocks.
  drawStitchV(ctx, x, y, size, color) {
    const pad = Math.max(1, size * 0.12);
    const left = x + pad, right = x + size - pad;
    const top = y + pad, bottom = y + size - pad;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, size * 0.16);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(x + size / 2, bottom);
    ctx.lineTo(right, top);
    ctx.stroke();
  }

  renderCellContent(ctx, x, y, size, stitch, r, c) {
    const cx = x + size / 2;
    const cy = y + size / 2;

    if (this.mode === 'fair_isle') {
      // Render each cell as an actual knit "V" stitch so the colourwork reads
      // like real stockinette (much easier to eyeball while knitting).
      const col = (stitch === 1) ? '#38bdf8' : '#e2e8f0';
      this.drawStitchV(ctx, x, y, size, col);
      return;
    }

    if (this.mode === 'tuck') {
      if (stitch === 0) {
        // Tuck loop marker (U symbol)
        ctx.fillStyle = '#f59e0b';
        ctx.font = `bold ${size * 0.65}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('∪', cx, cy);
      } else {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      }
      return;
    }

    if (this.mode === 'slip') {
      if (stitch === 0) {
        // Float dash marker (-)
        ctx.strokeStyle = '#ec4899';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x + 2, cy);
        ctx.lineTo(x + size - 2, cy);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      }
      return;
    }

    // Lace Mode Glyphs
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';

    switch (stitch) {
      case STITCH_TYPE.EYELET:
        // Circle (Standard international eyelet/yarnover symbol)
        ctx.strokeStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.32, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
        ctx.fill();
        break;

      case STITCH_TYPE.TRANSFER_LEFT:
        // Left-leaning decrease arrow (\)
        ctx.strokeStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(cx + size * 0.28, cy - size * 0.32);
        ctx.lineTo(cx - size * 0.28, cy + size * 0.32);
        // Arrow head pointing to (col - 1)
        ctx.lineTo(cx - size * 0.1, cy + size * 0.32);
        ctx.stroke();
        break;

      case STITCH_TYPE.TRANSFER_RIGHT:
        // Right-leaning decrease arrow (/)
        ctx.strokeStyle = '#34d399';
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.28, cy - size * 0.32);
        ctx.lineTo(cx + size * 0.28, cy + size * 0.32);
        // Arrow head pointing to (col + 1)
        ctx.lineTo(cx + size * 0.1, cy + size * 0.32);
        ctx.stroke();
        break;

      case STITCH_TYPE.TRANSFER_DOUBLE_L:
        // Two-needle left jump: two parallel backslash diagonals (STITCH_INFO double line).
        ctx.strokeStyle = '#0ea5e9';
        ctx.beginPath();
        ctx.moveTo(cx + size * 0.12, cy - size * 0.34);
        ctx.lineTo(cx - size * 0.3, cy + size * 0.18);
        ctx.moveTo(cx + size * 0.36, cy - size * 0.12);
        ctx.lineTo(cx - size * 0.06, cy + size * 0.38);
        ctx.stroke();
        break;

      case STITCH_TYPE.TRANSFER_DOUBLE_R:
        // Two-needle right jump: two parallel slash diagonals (mirror of the left one).
        ctx.strokeStyle = '#10b981';
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.12, cy - size * 0.34);
        ctx.lineTo(cx + size * 0.3, cy + size * 0.18);
        ctx.moveTo(cx - size * 0.36, cy - size * 0.12);
        ctx.lineTo(cx + size * 0.06, cy + size * 0.38);
        ctx.stroke();
        break;

      case STITCH_TYPE.DOUBLE_DEC_LEFT:
        // Left-leaning double decrease: a chevron pointing left over three needles.
        ctx.strokeStyle = '#c084fc';
        ctx.beginPath();
        ctx.moveTo(cx + size * 0.28, cy - size * 0.3);
        ctx.lineTo(cx - size * 0.24, cy);
        ctx.lineTo(cx + size * 0.28, cy + size * 0.3);
        ctx.stroke();
        break;

      case STITCH_TYPE.DOUBLE_DEC_RIGHT:
        // Right-leaning double decrease: a chevron pointing right (mirror of the left).
        ctx.strokeStyle = '#f472b6';
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.28, cy - size * 0.3);
        ctx.lineTo(cx + size * 0.24, cy);
        ctx.lineTo(cx - size * 0.28, cy + size * 0.3);
        ctx.stroke();
        break;

      case STITCH_TYPE.CENTER_DEC:
        // Double decrease inverted V (^)
        ctx.strokeStyle = '#f43f5e';
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.3, cy + size * 0.3);
        ctx.lineTo(cx, cy - size * 0.3);
        ctx.lineTo(cx + size * 0.3, cy + size * 0.3);
        ctx.stroke();
        break;

      case STITCH_TYPE.KNIT:
      default:
        // Vertical plain knit bar (|)
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(cx, cy - size * 0.25);
        ctx.lineTo(cx, cy + size * 0.25);
        ctx.stroke();
        break;
    }
  }

  // Live previews for every drag-based tool: the geometry outlines, the lasso
  // squiggle, the Bézier handles, the spline chain, the dimension line and the
  // smudge trail. None of them touch the matrix until pointerup commits.
  renderToolPreview(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.20)';
    ctx.lineWidth = 2.0;

    if (this.isMouseDown && this.dragStartCell && ['line', 'rect', 'rectOutline', 'circle', 'circleOutline'].includes(this.activeTool)) {
      const s = this.dragStartCell;
      const h = this.hoverCell;
      const x0 = s.c * this.zoom;
      const y0 = (this.rows - 1 - s.r) * this.zoom;
      const x1 = h.c * this.zoom;
      const y1 = (this.rows - 1 - h.r) * this.zoom;

      if (this.activeTool === 'line') {
        ctx.beginPath();
        ctx.moveTo(x0 + this.zoom / 2, y0 + this.zoom / 2);
        ctx.lineTo(x1 + this.zoom / 2, y1 + this.zoom / 2);
        ctx.stroke();
      } else if (this.activeTool === 'rect' || this.activeTool === 'rectOutline') {
        const rx = Math.min(x0, x1);
        const ry = Math.min(y0, y1);
        const rw = Math.abs(x1 - x0) + this.zoom;
        const rh = Math.abs(y1 - y0) + this.zoom;
        if (this.activeTool === 'rect') ctx.fillRect(rx, ry, rw, rh);
        ctx.setLineDash(this.activeTool === 'rectOutline' ? [4, 3] : []);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
      } else if (this.activeTool === 'circle' || this.activeTool === 'circleOutline') {
        const cx = (x0 + x1) / 2 + this.zoom / 2;
        const cy = (y0 + y1) / 2 + this.zoom / 2;
        const rxC = Math.abs(x1 - x0) / 2 + this.zoom / 2;
        const ryC = Math.abs(y1 - y0) / 2 + this.zoom / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rxC, ryC, 0, 0, Math.PI * 2);
        if (this.activeTool === 'circle') ctx.fill();
        ctx.setLineDash(this.activeTool === 'circleOutline' ? [4, 3] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // A cell coordinate → screen point inside the translated grid.
    const at = p => ({ x: p.c * this.zoom + this.zoom / 2, y: (this.rows - 1 - p.r) * this.zoom + this.zoom / 2 });

    if (this._lasso && this._lasso.length > 1) {
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.9)';
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      const first = at(this._lasso[0]);
      ctx.moveTo(first.x, first.y);
      for (const point of this._lasso.slice(1)) {
        const p = at(point);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this._bezierPoints.length) {
      const pts = this._bezierPoints.map(at);
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.9)';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(192, 132, 252, 0.9)';
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (this._splinePoints.length) {
      const pts = this._splinePoints.map(at);
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.9)';
      if (pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(52, 211, 153, 0.9)';
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (this._measureDrag) {
      const d = this._measureDrag;
      const a = at({ r: d.r1, c: d.c1 });
      const b = at({ r: d.r2, c: d.c2 });
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const label = `${Math.abs(d.c2 - d.c1) + 1} × ${Math.abs(d.r2 - d.r1) + 1}`;
      const tw = ctx.measureText(label).width + 6;
      ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
      ctx.fillRect((a.x + b.x) / 2 - tw / 2, (a.y + b.y) / 2 - 9, tw, 18);
      ctx.fillStyle = '#38bdf8';
      ctx.textAlign = 'center';
      ctx.fillText(label, (a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.textAlign = 'left';
    }

    if (this._smudgePath && this._smudgePath.length > 1) {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
      ctx.lineWidth = Math.max(3, this.zoom * 0.5);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const first = at(this._smudgePath[0]);
      ctx.moveTo(first.x, first.y);
      for (const point of this._smudgePath.slice(1)) {
        const p = at(point);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    // Selection tools with no stroke in flight: a crosshair hairline so the
    // wand/lasso/bezier user can see which needle the next click will pick.
    ctx.restore();
  }

  renderRulers(ctx, totalW, totalH) {
    ctx.font = '10px monospace';
    ctx.fillStyle = '#94a3b8';

    // Horizontal Top Needle Numbers
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let c = 0; c < this.cols; c++) {
      const x = c * this.zoom + this.zoom / 2;
      const needleNum = c + 1;
      if (needleNum === 1 || needleNum === this.cols || needleNum % 5 === 0) {
        ctx.fillText(`${needleNum}`, x, -6);
        ctx.fillRect(x - 0.5, -4, 1, 4);
      }
    }

    // Vertical Left Row Numbers (Knitting rows count 1 at bottom to N at top)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < this.rows; r++) {
      const y = (this.rows - 1 - r) * this.zoom + this.zoom / 2;
      const rowNum = r + 1;
      if (rowNum === 1 || rowNum === this.rows || rowNum % 5 === 0) {
        ctx.fillText(`${rowNum}`, -10, y);
        ctx.fillRect(-6, y - 0.5, 6, 1);
      }
    }
  }
}
