/**
 * KNITCAT V2 — the Compiler (spec §4).
 *
 * The single entry point that fuses the whole "design → machine" story into one pipeline:
 *
 *   Project ──derive──▶ IR ──validate──▶ ──optimise──▶ ──verify──▶ ──backends──▶ outputs
 *
 *   - **derive** (./derive.js) turns the live Project + Fit Engine into an explicit IR.
 *   - **validate** (./ir.js) fails loudly on a structurally broken IR before anything else runs.
 *   - **optimise** (./optimise) reorders carries, minimises colour changes and aligns repeats,
 *     choosing the best of a Pareto frontier for the knitter's stated priority.
 *   - **verify** (./verify) runs the nine-check feasibility suite and returns specific fixes.
 *   - **backends** (./backends) emit written/chart/machine/punchcard/dxf/gcode/manufacturing —
 *     all from the *same* IR, so seven outputs can never disagree with each other.
 *
 * `compileProject` is the function the facade and UI call. It is defensive end-to-end: a failure
 * in any stage is captured in the returned report rather than throwing (except a structural IR
 * failure, which is a genuine programming error worth surfacing). DOM-free — safe under Node.
 *
 * @module compiler
 */

export * from './ir.js';
export { deriveIr, translatePiece } from './derive.js';
export { optimiseIr, scoreIr } from './optimise/index.js';
export { verifyIr, summarizeVerification, CHECKS, DEFAULT_CHECKS } from './verify/index.js';
export { BACKENDS, BACKEND_IDS, DEFAULT_OUTPUTS, runBackends } from './backends/index.js';
export { chartBackend } from './backends/chart.js';
export { writtenBackend } from './backends/written.js';
export { machineBackend } from './backends/machine.js';
export { punchcardBackend } from './backends/punchcard.js';
export { dxfBackend } from './backends/dxf.js';
export { gcodeBackend } from './backends/gcode.js';
export { manufacturingBackend } from './backends/manufacturing.js';
export { ayabBackend, csvBackend, dakBackend, binaryBackend, passapBackend, knitmateBackend, CARD_BACKENDS, CARD_BACKEND_IDS } from './backends/cards.js';

import { deriveIr } from './derive.js';
import { validateIr, totalRows, countOperations } from './ir.js';
import { optimiseIr } from './optimise/index.js';
import { verifyIr, summarizeVerification } from './verify/index.js';
import { runBackends, DEFAULT_OUTPUTS, BACKEND_IDS } from './backends/index.js';
import { logger } from '../core/logging.js';

const log = logger('compiler');

/**
 * @typedef {object} CompileReport
 * @property {object} ir the (optimised) intermediate representation
 * @property {object.<string,*>} outputs backend id → emitted output
 * @property {import('./verify/index.js').CheckResult[]} verification every check verdict
 * @property {object} summary pass/warn/fail rollup
 * @property {string[]} errors pipeline-level errors (backend throws, unknown ids)
 * @property {object} metrics headline numbers (rows, pieces, decreases, increases)
 * @property {object} optimisation chosen candidate + frontier (when optimise ran)
 * @property {boolean} ok true when verification had no failures/errors
 */

/**
 * Compile a Project into every requested output, running the full pipeline.
 * @param {import('../project/project.js').Project} project
 * @param {{
 *   outputs?:string[], optimize?:boolean, verify?:boolean, checks?:string[],
 *   priority?:string|object, pieces?:object[], skipFit?:boolean, quantity?:number,
 *   currency?:string, stitchMeters?:number, backendOptions?:object
 * }} [options]
 * @returns {CompileReport}
 */
export function compileProject(project, options = {}) {
  const errors = [];
  const wantOutputs = normaliseOutputIds(options.outputs);

  let ir;
  try {
    ir = deriveIr(project, { pieces: options.pieces, skipFit: options.skipFit });
  } catch (e) {
    log.logError('compiler derive stage failed', e, { context: { stage: 'derive' } });
    return emptyReport(`derive failed: ${e && e.message ? e.message : e}`, ['derive'], wantOutputs);
  }

  try {
    validateIr(ir);
  } catch (e) {
    // A structurally invalid IR is a genuine programming error, not bad user data.
    log.logError('compiler produced an invalid IR', e, { context: { stage: 'validate', errors: e && e.errors } });
    return emptyReport(`invalid IR: ${e && e.message ? e.message : e}`, ['validate'], wantOutputs, ir);
  }

  let optimisation = null;
  if (options.optimize !== false) {
    try {
      const opt = optimiseIr(ir, { priority: options.priority, stitchMeters: options.stitchMeters });
      ir = opt.ir;
      optimisation = { chosen: opt.chosen, frontier: opt.frontier, candidates: opt.candidates, changes: opt.changes, metrics: opt.metrics };
    } catch (e) {
      log.logError('optimise stage threw — continuing with the un-optimised IR', e, { context: { stage: 'optimise' } });
      errors.push(`optimise skipped: ${e && e.message ? e.message : e}`);
    }
  }

  let verification = [];
  let summary = { ok: true, verdict: 'pass', passed: 0, warnings: 0, failures: 0, errors: 0, blocking: [] };
  if (options.verify !== false) {
    try {
      verification = verifyIr(ir, { checks: options.checks, project, options });
      summary = summarizeVerification(verification);
      ir.checks = verification;
    } catch (e) {
      log.logError('verify stage threw — skipping feasibility checks', e, { context: { stage: 'verify' } });
      errors.push(`verify skipped: ${e && e.message ? e.message : e}`);
    }
  }

  const backendOptions = Object.assign({}, options.backendOptions, {
    project, quantity: options.quantity, currency: options.currency
  });
  const { results: outputs, errors: backendErrors } = runBackends(ir, wantOutputs, backendOptions);
  // runBackends already logs each backend failure at the source; here we only fold them
  // into the report's flat error list so `ok` reflects them.
  for (const [id, msg] of Object.entries(backendErrors)) errors.push(`backend ${id}: ${msg}`);

  return {
    ir, outputs, verification, summary, errors, optimisation,
    metrics: {
      pieces: (ir.pieces || []).length,
      rows: totalRows(ir),
      decreases: countOperations(ir, 'decrease'),
      increases: countOperations(ir, 'increase'),
      shortRows: countOperations(ir, 'short-row'),
      yarnChanges: countOperations(ir, 'yarn-change')
    },
    ok: summary.ok && !errors.length
  };
}

/** Accept 'all', a single string, or an array; reject nothing (unknown ids surface in the report). */
function normaliseOutputIds(outputs) {
  if (!outputs) return DEFAULT_OUTPUTS.slice();
  if (outputs === 'all') return BACKEND_IDS.slice();
  const list = Array.isArray(outputs) ? outputs : [outputs];
  return list.length ? list : DEFAULT_OUTPUTS.slice();
}

function emptyReport(message, stages, wantOutputs, ir) {
  return {
    ir: ir || null,
    outputs: Object.fromEntries(wantOutputs.map(id => [id, null])),
    verification: [],
    summary: { ok: false, verdict: 'fail', passed: 0, warnings: 0, failures: 1, errors: 0, blocking: [{ id: 'pipeline', verdict: 'fail', message, fix: 'Fix the upstream derive/validate stage.' }] },
    errors: [message],
    optimisation: null,
    metrics: { pieces: 0, rows: 0, decreases: 0, increases: 0, shortRows: 0, yarnChanges: 0 },
    failedStages: stages,
    ok: false
  };
}
