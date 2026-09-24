/**
 * KNITCAT V2 — the Project: the single object every system reads and writes.
 *
 * This is the "one source of truth" the whole re-architecture turns on. A `Project`
 * holds a normalised KnitScript spec, a {@link ConstraintGraph} wired from the six node
 * packs (body, gauge, garment, pattern, yarn, cost), and a change log. Everything else —
 * the Fit Engine, the Compiler, the Yarn Lab, Production — consumes the same graph, so a
 * change made anywhere propagates everywhere: `set('gauge.stitchesPer10cm', …)` recomputes
 * cast-on, feasibility, yardage, cost and time in one call and tells you exactly which
 * nodes moved. Undo is trivial because the graph is a pure function of its inputs.
 *
 * A Project is DOM-free and JSON-friendly: `toPlain()` gives a serialisable snapshot for
 * storage (`.kcard` / `.knit`), `Project.fromKnitScript(text)` parses a file into a live
 * model, and `toKnitScript()` writes it back out.
 *
 * @module project/project
 */

import { ConstraintGraph } from './constraint-graph.js';
import { parse } from '../knitscript/parser.js';
import { interpret } from '../knitscript/interpreter.js';
import { typecheck } from '../knitscript/typecheck.js';
import { serialize } from '../knitscript/serializer.js';
import { defineBodyNodes } from './nodes/body-nodes.js';
import { defineGaugeNodes } from './nodes/gauge-nodes.js';
import { defineGarmentNodes } from './nodes/garment-nodes.js';
import { definePatternNodes } from './nodes/pattern-nodes.js';
import { defineYarnNodes } from './nodes/yarn-nodes.js';
import { defineCostNodes } from './nodes/cost-nodes.js';
import { migrate } from './migrations.js';
import { validateProject } from './validate-deep.js';
import { logger } from '../core/logging.js';

const log = logger('project/project');

/** Current Project schema version; migrations up to this number run on load. */
export const PROJECT_VERSION = 3;

/** The node packs, in dependency order (inputs first, derived after). */
const NODE_PACKS = [defineBodyNodes, defineGaugeNodes, defineGarmentNodes, definePatternNodes, defineYarnNodes, defineCostNodes];

export class Project {
  /**
   * @param {{name:string, sections:object}} spec  a normalised KnitScript spec
   * @param {{machine?:object, context?:object}} [opts]  resolved machine profile + extra ctx
   */
  constructor(spec, opts = {}) {
    this.version = PROJECT_VERSION;
    this.spec = normalizeSpec(spec);
    this.name = this.spec.name;
    /** @type {Array<{node:string, from:*, to:*}>} the last propagation's change list. */
    this.lastChange = [];
    /** Monotonic edit counter, handy for the UI's "unsaved N changes" badge. */
    this.editCount = 0;
    this._buildGraph(opts);
  }

  /** @private */
  _buildGraph(opts) {
    const graph = new ConstraintGraph();
    graph.context = Object.assign({ spec: this.spec }, opts.context || {});
    if (opts.machine) graph.context.machine = opts.machine;
    for (const pack of NODE_PACKS) pack(graph, graph.context);
    graph.propagate(); // warm every derived node once
    this.graph = graph;
  }

  /**
   * Read a node's current (always-fresh) value.
   * @param {string} id @returns {*}
   */
  get(id) { return this.graph.get(id); }
  /** Does this node exist? @param {string} id @returns {boolean} */
  has(id) { return this.graph.has(id); }

  /**
   * Set an input and propagate. Records the change list on `lastChange` and bumps the
   * edit counter so the "what changed?" panel can narrate the ripple. A no-op for an id that
   * isn't a node (returns `[]`) — the strict, throwing version is `graph.set`; the Project is the
   * friendly facade the UI drives, and a stale or optional node id must never crash an edit.
   * @param {string} id @param {*} value @returns {string[]} changed node ids
   */
  set(id, value) {
    if (!this.graph.has(id)) { log.debug('set() targeted a node that does not exist — the edit was a no-op', { id }); return []; }
    const changed = this.graph.set(id, value);
    if (changed.length) {
      this.editCount++;
      this.lastChange = changed.map(node => {
        const n = this.graph.nodes.get(node);
        return { node, to: n ? n.value : undefined };
      });
    }
    return changed;
  }

  /**
   * Which downstream nodes depend on `id`? Powers the "what would change if…" preview.
   * @param {string} id @returns {string[]}
   */
  downstreamOf(id) { return this.graph.downstreamOf(id); }

  /** Every node's current value as a flat object. @returns {Record<string,any>} */
  snapshot() { return this.graph.snapshot(); }

  /** A named list of the derived values the UI shows most. @returns {Array<{id,value}>} */
  keyValues() {
    const want = ['pattern.castOn', 'pattern.neckStitches', 'garment.bodyRows', 'garment.finishedBust',
      'feasibility.fitToBed', 'yarn.totalMeters', 'cost.total', 'cost.suggestedPrice', 'time.totalHours'];
    return want.filter(id => this.has(id)).map(id => ({ id, value: this.get(id) }));
  }

  /** Re-render the whole spec back to KnitScript text. @returns {string} */
  toKnitScript() { return serialize(this.spec); }

  /** Soft semantic diagnostics for the current spec (no throw). @returns {Array} */
  validate() { return typecheck(this.spec); }

  /**
   * Inspect the *live constraint graph* for the failures a textual check can't see: a formula
   * that produced NaN/Infinity, a node whose function threw, a dependency cycle, or an impossible
   * cross-node relationship (zero cast-on with a positive gauge). Same Diagnostic shape as
   * {@link validate}, so the Verify panel can show KnitScript and model problems side by side.
   * @returns {Array<import('../knitscript/diagnostics.js').Diagnostic>}
   */
  deepValidate() { return validateProject(this); }

  /** Every problem, textual and structural, in one merged list (no throw). @returns {Array} */
  fullValidate() { return this.validate().concat(this.deepValidate()); }

  /** A plain, storage-ready object (spec + version + identity). @returns {object} */
  toPlain() {
    return { version: this.version, name: this.name, spec: this.spec, inputs: this._inputValues() };
  }

  /** @private grab the current values of every settable input node. */
  _inputValues() {
    const out = {};
    for (const [id, node] of this.graph.nodes) if (node.isInput) out[id] = node.value;
    return out;
  }

  /**
   * Build a Project from KnitScript source text.
   * @param {string} text @param {object} [opts]
   * @returns {Project}
   * @throws {import('../knitscript/parser.js').ParseError}
   */
  static fromKnitScript(text, opts = {}) {
    const spec = interpret(parse(text));
    return new Project(spec, opts);
  }

  /**
   * Rebuild a Project from a stored plain object, running migrations first.
   * @param {object} plain @param {object} [opts] @returns {Project}
   */
  static fromPlain(plain, opts = {}) {
    const migrated = plain && plain.version && plain.version < PROJECT_VERSION ? migrate(plain) : plain;
    const spec = migrated && migrated.spec ? migrated.spec : migrated;
    const p = new Project(spec, opts);
    if (migrated && migrated.inputs) {
      for (const [id, value] of Object.entries(migrated.inputs)) {
        if (p.has(id)) p.graph.set(id, value);
      }
      p.graph.propagate();
    }
    return p;
  }
}

/** Ensure a spec always has a sections map. */
function normalizeSpec(spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  return { name: s.name || 'Untitled project', sections: s.sections || {} };
}
