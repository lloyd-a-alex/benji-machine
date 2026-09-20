/**
 * KNITCAT V2 — the Constraint Graph: the single fusion engine.
 *
 * This is the difference between "six features bolted onto one app" and "one system".
 * Every fact about a project — a body measurement, a yarn's gauge, a garment's finished
 * width, a cast-on count, a cost, a time estimate — is a *node*. Every value derived
 * from other values is a node with a `compute` function and a list of `inputs` (the
 * node ids it depends on). The graph holds the dependency edges, and when any node is
 * {@link ConstraintGraph#set set}, the change propagates: every downstream node is
 * marked dirty and recomputed in topological order, and the list of what actually
 * changed is returned so the UI can narrate "you changed the yarn → gauge updated →
 * cast-on went 108 → 120 → feasibility re-checked".
 *
 * Design guarantees this engine must never break (they are the whole point):
 *   • You cannot forget to update the shoulders. A change to any input recomputes every
 *     dependent value, transitively, exactly once per propagation.
 *   • Recompute is *lazy and minimal*: only dirty nodes run their `compute`.
 *   • Propagation is *order-correct*: a node is computed only after all its inputs.
 *   • A cycle is reported, never deadlocked — {@link ConstraintGraph#topologicalOrder}
 *     throws a descriptive error naming the cycle rather than spinning forever.
 *   • A value that recomputes to a deep-equal result is *not* reported as changed and
 *     does not re-dirty its dependents, so a no-op `set` costs nothing downstream.
 *   • A `compute` that throws is contained: the error is captured on the node, the node
 *     keeps its last good value, and propagation continues — one bad formula cannot
 *     take the whole model down.
 *
 * DOM-free and dependency-free: pure JavaScript, importable under `node --test`.
 *
 * @module project/constraint-graph
 */

/**
 * A structurally-deep equality check good enough for the value types the graph carries
 * (numbers, strings, booleans, null, arrays and plain objects, including typed arrays).
 * Used to decide whether a recompute actually changed anything, so we never propagate
 * a value that is equal in every observable way.
 * @param {*} a
 * @param {*} b
 * @returns {boolean} true when `a` and `b` are deep-equal
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  // NaN === NaN is false, but for change detection two NaNs are "the same".
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  // Typed arrays and ArrayBuffers: compare byte-for-byte.
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const key of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

/**
 * @typedef {object} ConstraintNode
 * @property {string} id  stable identifier, e.g. `"body.bust"` or `"pattern.castOn"`
 * @property {string[]} inputs  ids of the nodes this node reads
 * @property {(inputs: Record<string, any>, ctx: object) => any} compute  the formula
 * @property {any} value  the current (last good) computed or set value
 * @property {boolean} dirty  whether `value` needs recomputation
 * @property {boolean} isInput  true for source nodes a human sets directly
 * @property {Error|null} error  the last `compute` failure, if any
 * @property {Error|null} lastError  sticky last error (kept for diagnostics)
 */

/**
 * A directed acyclic graph of derived values with dirty-tracking propagation. Build it
 * by {@link ConstraintGraph#define define}-ing nodes then {@link ConstraintGraph#set
 * set}-ing the source nodes; read results with {@link ConstraintGraph#get get}.
 */
export class ConstraintGraph {
  constructor() {
    /** @type {Map<string, ConstraintNode>} */
    this.nodes = new Map();
    /** nodeId → Set<nodeId> of nodes that depend on it (its downstream subscribers). */
    this.edges = new Map();
    /** Cached topological order; invalidated whenever the structure changes. */
    this.topoCache = null;
    /** Optional shared context object handed to every `compute(inputs, ctx)`. */
    this.context = {};
    /** Monotonic counter to stamp the last propagation, for change-detection UIs. */
    this.revision = 0;
  }

  /**
   * Declare (or redeclare) a node. Redeclaring an existing id refreshes its formula and
   * edges while preserving any current value, so a hot-reloaded definition is seamless.
   * @param {string} id
   * @param {string[]} inputs  dependency node ids (a source/input node passes `[]`)
   * @param {(inputs: Record<string, any>, ctx: object) => any} [compute]  formula; when
   *   omitted the node is a plain settable input that stores whatever it is given.
   * @param {any} [initial]  the starting value for an input node
   * @param {{isInput?: boolean}} [opts]
   * @returns {this} for chaining
   */
  define(id, inputs = [], compute = null, initial = undefined, opts = {}) {
    if (typeof id !== 'string' || !id) throw new Error('ConstraintGraph.define needs a non-empty string id.');
    const deps = Array.isArray(inputs) ? inputs.filter(i => typeof i === 'string' && i) : [];
    const existing = this.nodes.get(id);
    const node = existing || { id, inputs: [], compute: null, value: undefined, dirty: true, isInput: false, error: null, lastError: null };
    node.inputs = deps;
    node.compute = typeof compute === 'function' ? compute : null;
    node.isInput = opts.isInput === true || (node.compute === null);
    if (!existing) {
      node.value = initial;
      node.dirty = true;
      this.nodes.set(id, node);
    }
    // Rebuild the downstream adjacency contributed by *this* node (drop old, add new).
    for (const dep of deps) {
      if (!this.edges.has(dep)) this.edges.set(dep, new Set());
      this.edges.get(dep).add(id);
    }
    this.topoCache = null;
    return this;
  }

  /** Does a node with this id exist? @param {string} id @returns {boolean} */
  has(id) { return this.nodes.has(id); }

  /**
   * Read a node's current value, computing it (and anything it depends on) first if it
   * is dirty. Reading a value never silently returns stale data.
   * @param {string} id
   * @returns {any}
   */
  get(id) {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`ConstraintGraph.get: no node "${id}".`);
    if (node.dirty) this._resolve(id);
    return node.value;
  }

  /**
   * Assign a source (input) value and propagate downstream. If the value is deep-equal
   * to the current one this is a complete no-op (no recompute, no change list), so the
   * UI can call `set` on every keystroke without churning the whole model.
   * @param {string} id
   * @param {any} value
   * @returns {string[]} the ids whose value actually changed, in propagation order
   */
  set(id, value) {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`ConstraintGraph.set: no node "${id}".`);
    if (deepEqual(node.value, value)) return [];
    node.value = value;
    node.error = null;
    this._markDirty(id);
    return this.propagate();
  }

  /**
   * Propagate from the current dirty set: recompute every dirty node in topological
   * order, recomputing transitively-dirty nodes exactly once.
   * @returns {string[]} ids whose value genuinely changed
   */
  propagate() {
    const order = this.topologicalOrder();
    const changed = [];
    for (const id of order) {
      const node = this.nodes.get(id);
      if (!node || !node.dirty) continue;
      if (this._resolveNode(node)) changed.push(id);
    }
    this.revision++;
    return changed;
  }

  /**
   * Resolve a single node (and, if it is a derived node, its dependencies first). Used
   * by {@link get} for on-demand evaluation. @param {string} id @returns {any}
   */
  _resolve(id) {
    const node = this.nodes.get(id);
    // Derived nodes must have their inputs fresh before computing.
    for (const dep of node.inputs) {
      const d = this.nodes.get(dep);
      if (d && d.dirty) this._resolve(dep);
    }
    this._resolveNode(node);
    return node.value;
  }

  /**
   * Compute one node if it is derived, clear its dirty flag, and report whether its
   * value actually changed. Input nodes just clear dirty (their value was set directly).
   * @param {ConstraintNode} node @returns {boolean} changed
   */
  _resolveNode(node) {
    if (!node.dirty) return false;
    if (node.compute === null) { node.dirty = false; return false; }
    const inputs = {};
    for (const dep of node.inputs) {
      const d = this.nodes.get(dep);
      inputs[dep] = d ? (d.dirty ? this._resolve(dep) : d.value) : undefined;
    }
    let next;
    try {
      next = node.compute(inputs, this.context);
      node.error = null;
    } catch (err) {
      // Contain a failing formula: keep the last good value, remember the error, and
      // let the rest of the graph settle. A broken yarn node must not wipe the body.
      node.error = err instanceof Error ? err : new Error(String(err));
      node.lastError = node.error;
      node.dirty = false;
      return false;
    }
    const changed = !deepEqual(next, node.value);
    node.value = next;
    node.dirty = false;
    return changed;
  }

  /**
   * Mark every transitive *dependent* of `id` dirty (the source node itself keeps the
   * value that was just set and is never recomputed). Walks the downstream edges with a
   * stack, stopping along any branch already dirty so repeated propagation stays cheap.
   * @param {string} id @returns {void}
   */
  _markDirty(id) {
    const stack = [...(this.edges.get(id) || [])];
    while (stack.length) {
      const cur = stack.pop();
      const node = this.nodes.get(cur);
      if (!node || node.dirty) continue; // already flagged → its subtree is too
      node.dirty = true;
      for (const dep of this.edges.get(cur) || []) stack.push(dep);
    }
  }

  /**
   * A stable topological ordering of all nodes (inputs before the values that use them).
   * Cached until the structure changes. Throws a descriptive error naming any cycle
   * rather than looping forever.
   * @returns {string[]}
   */
  topologicalOrder() {
    if (this.topoCache) return this.topoCache;
    const order = [];
    const state = new Map(); // id → 0 unvisited, 1 visiting, 2 done
    const stackPath = [];
    const visit = (id) => {
      const s = state.get(id) || 0;
      if (s === 2) return;
      if (s === 1) {
        const cycle = [...stackPath.slice(stackPath.indexOf(id)), id].join(' → ');
        throw new Error(`ConstraintGraph has a dependency cycle: ${cycle}.`);
      }
      state.set(id, 1);
      stackPath.push(id);
      const node = this.nodes.get(id);
      if (node) for (const dep of node.inputs) if (this.nodes.has(dep)) visit(dep);
      stackPath.pop();
      state.set(id, 2);
      order.push(id);
    };
    for (const id of this.nodes.keys()) visit(id);
    this.topoCache = order;
    return order;
  }

  /**
   * Snapshot every node's current value into a plain object. Forces a full propagation
   * first, so the snapshot is always internally consistent (no half-updated model).
   * @returns {Record<string, any>}
   */
  snapshot() {
    const order = this.topologicalOrder();
    for (const id of order) { const n = this.nodes.get(id); if (n.dirty) this._resolveNode(n); }
    const out = {};
    for (const [id, n] of this.nodes) out[id] = n.value;
    return out;
  }

  /**
   * Which downstream nodes would recompute if `id` changed? (Direct and transitive
   * dependents, excluding `id` itself.) Useful for the "what changed?" explainer.
   * @param {string} id @returns {string[]}
   */
  downstreamOf(id) {
    const seen = new Set();
    const stack = [...(this.edges.get(id) || [])];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const dep of this.edges.get(cur) || []) stack.push(dep);
    }
    seen.delete(id);
    return [...seen];
  }

  /** Number of nodes. @returns {number} */
  get size() { return this.nodes.size; }
}

/**
 * Convenience factory: build a graph from a declarative spec of nodes. Each entry is
 * `{ id, inputs?, compute?, value?, isInput? }`. Handy for the per-domain node packs.
 * @param {Array<object>} specs @param {object} [context]
 * @returns {ConstraintGraph}
 */
export function graphFromSpecs(specs, context = {}) {
  const g = new ConstraintGraph();
  g.context = context;
  for (const s of (Array.isArray(specs) ? specs : [])) {
    if (!s || typeof s.id !== 'string') continue;
    g.define(s.id, s.inputs || [], s.compute || null, s.value, { isInput: s.isInput === true || !s.compute });
  }
  // Seed input values, then compute everything once so the initial snapshot is warm.
  for (const s of (Array.isArray(specs) ? specs : [])) {
    if (s && s.compute == null && s.value !== undefined) { const n = g.nodes.get(s.id); if (n) n.value = s.value; }
  }
  g.propagate();
  return g;
}
