/**
 * KNITCAT V2 — the optimiser driver (spec §4.4).
 *
 * Applies the three passes and produces both a single *chosen* IR (the knitter's stated
 * objective, resolved through the Pareto frontier) and the full candidate set so the UI can show
 * the trade-off. Order matters and is deliberate: machine → yarn → appearance, because the
 * machine pass establishes the row structure the yarn reordering and appearance repeat-matching
 * then annotate. To build the frontier we evaluate each *primary objective* by emphasising the
 * matching pass ordering and re-scoring every candidate on all three axes, so the comparison is
 * apples-to-apples.
 *
 * Shape-preserving and idempotent: running the optimiser on an already-optimised IR is a no-op on
 * measurements (asserted by the compiler tests). DOM-free.
 *
 * @module compiler/optimise
 */

export { machinePass } from './machine-pass.js';
export { yarnPass } from './yarn-pass.js';
export { appearancePass } from './appearance-pass.js';
export { paretoFrontier, isDominated, weightedPick, rankCandidates, weightsForPriority, paretoAxes, AXES } from './pareto.js';

import { machinePass } from './machine-pass.js';
import { yarnPass } from './yarn-pass.js';
import { appearancePass } from './appearance-pass.js';
import { paretoFrontier, weightedPick } from './pareto.js';

const DEFAULT_OBJECTIVES = ['time', 'yarn', 'appearance'];

/**
 * Optimise an IR.
 * @param {import('../ir.js').KnitIR} ir
 * @param {{objectives?:string[], priority?:string|object, stitchMeters?:number}} [opts]
 * @returns {{ir:import('../ir.js').KnitIR, candidates:object[], frontier:object[], chosen:object, changes:string[], metrics:object}}
 */
export function optimiseIr(ir, opts = {}) {
  const objectives = opts.objectives && opts.objectives.length ? opts.objectives : DEFAULT_OBJECTIVES;
  const allChanges = [];
  const candidates = [];

  // Evaluate each primary objective: emphasise its pass first, then run the rest.
  for (const objective of objectives) {
    const { ir: optIr, metrics, changes } = runOrder(ir, objective, opts);
    allChanges.push(...changes.map(c => `[${objective}] ${c}`));
    candidates.push({
      objective,
      ir: optIr,
      time: metrics.time,
      yarn: metrics.yarn,
      appearance: metrics.appearance,
      metrics,
      changes
    });
  }

  const frontier = paretoFrontier(candidates);
  const chosen = weightedPick(candidates, opts.priority || 'balanced') || candidates[0];

  // Score the whole (final) IR on all three axes for the summary panel.
  const scored = scoreIr(chosen ? chosen.ir : ir, opts);
  return {
    ir: chosen ? chosen.ir : ir,
    candidates,
    frontier,
    chosen,
    changes: dedupe(allChanges),
    metrics: scored.metrics
  };
}

/** Run the passes with `primary` first, then the others in canonical order. */
function runOrder(ir, primary, opts) {
  const order = [primary, ...DEFAULT_OBJECTIVES.filter(o => o !== primary)];
  let cur = ir;
  const changes = [];
  const per = {};
  for (const which of order) {
    const res = which === 'time' ? machinePass(cur)
      : which === 'yarn' ? yarnPass(cur, { stitchMeters: opts.stitchMeters })
        : appearancePass(cur);
    cur = res.ir;
    changes.push(...res.changes);
    per[which] = res.metrics.cost;
    if (which === 'time') cur.__time = res.metrics.cost;
    if (which === 'yarn') cur.__yarn = res.metrics.cost;
    if (which === 'appearance') cur.__appearance = res.metrics.cost;
  }
  // Re-score every axis on the final ordering so candidates are comparable.
  const final = scoreIr(cur, opts);
  return { ir: final.ir, metrics: final.metrics, changes };
}

/** Score an IR on time/yarn/appearance cost without mutating shape (for comparison). */
export function scoreIr(ir, opts = {}) {
  const m = machinePass(ir);
  const y = yarnPass(m.ir, { stitchMeters: opts.stitchMeters });
  const a = appearancePass(y.ir);
  return {
    ir: a.ir,
    metrics: { time: m.metrics.cost, yarn: y.metrics.cost, appearance: a.metrics.cost, detail: { machine: m.metrics, yarn: y.metrics, appearance: a.metrics } }
  };
}

function dedupe(list) { return [...new Set(list)]; }
