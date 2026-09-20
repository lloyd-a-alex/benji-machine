/**
 * KNITCAT V2 — the verifier runner (spec §4.5).
 *
 * Runs every constraint check over an IR and returns a verdict list, each with a *specific,
 * actionable fix* — "float of 9 sts at row 42 exceeds 7 — add a tuck stitch or catch the float
 * every 5" — not a red X. This is the feasibility advisor grown up into a full suite: it is the
 * gate between "the compiler produced something" and "the compiler produced something that will
 * actually work on your machine, on your body, with your yarn."
 *
 * Checks are independent, pure, and defensive: one throwing (bad upstream data) becomes a
 * `error` verdict, never a crash of the whole suite. The default list mirrors the spec's
 * `verify: [fit, gauge, machine, float, tuck, ease, color, time, yarn]`. DOM-free.
 *
 * @module compiler/verify
 */

export { verifyFit } from './fit.js';
export { verifyGauge } from './gauge.js';
export { verifyMachine } from './machine.js';
export { verifyFloat } from './float.js';
export { verifyTuck } from './tuck.js';
export { verifyEase } from './ease.js';
export { verifyColor } from './color.js';
export { verifyTime } from './time.js';
export { verifyYarn } from './yarn.js';

import { verifyFit } from './fit.js';
import { verifyGauge } from './gauge.js';
import { verifyMachine } from './machine.js';
import { verifyFloat } from './float.js';
import { verifyTuck } from './tuck.js';
import { verifyEase } from './ease.js';
import { verifyColor } from './color.js';
import { verifyTime } from './time.js';
import { verifyYarn } from './yarn.js';
import { makeResult } from './_result.js';

export { makeResult, VERDICT_WEIGHT, pass, warn, fail } from './_result.js';

/** Registry of checks by id. */
export const CHECKS = Object.freeze({
  fit: verifyFit, gauge: verifyGauge, machine: verifyMachine, float: verifyFloat,
  tuck: verifyTuck, ease: verifyEase, color: verifyColor, time: verifyTime, yarn: verifyYarn
});

/** Default verification order. */
export const DEFAULT_CHECKS = Object.freeze(['fit', 'gauge', 'machine', 'float', 'tuck', 'ease', 'color', 'time', 'yarn']);

/**
 * The verdict every check returns.
 * @typedef {object} CheckResult
 * @property {string} id
 * @property {('pass'|'warn'|'fail'|'error')} verdict
 * @property {string} message
 * @property {string} fix a specific, actionable instruction
 * @property {number} score
 */

/**
 * Run a set of checks over an IR (optionally against a Project for graph-backed checks).
 * @param {import('../ir.js').KnitIR} ir
 * @param {{checks?:string[], project?:object, options?:object}} [ctx]
 * @returns {CheckResult[]}
 */
export function verifyIr(ir, ctx = {}) {
  const ids = ctx.checks && ctx.checks.length ? ctx.checks : DEFAULT_CHECKS;
  return ids.map(id => runCheck(id, ir, ctx));
}

/** Run one check by id, catching throws into an `error` verdict. */
export function runCheck(id, ir, ctx = {}) {
  const fn = CHECKS[id];
  if (!fn) return makeResult(id, 'error', `No check named "${id}".`, `Known checks: ${DEFAULT_CHECKS.join(', ')}.`);
  try {
    return fn(ir, ctx.project, ctx.options || {});
  } catch (e) {
    return makeResult(id, 'error', `Check "${id}" threw: ${e && e.message}`, 'Fix the IR upstream (derive stage).');
  }
}

/**
 * Summarise a verdict list.
 * @param {CheckResult[]} results
 * @returns {{ok:boolean, verdict:'pass'|'warn'|'fail', passed:number, warnings:number, failures:number, errors:number, blocking:CheckResult[]}}
 */
export function summarizeVerification(results = []) {
  let passed = 0, warnings = 0, failures = 0, errors = 0;
  const blocking = [];
  for (const r of results) {
    if (r.verdict === 'pass') passed++;
    else if (r.verdict === 'warn') warnings++;
    else if (r.verdict === 'fail') { failures++; blocking.push(r); }
    else { errors++; blocking.push(r); }
  }
  const verdict = failures || errors ? 'fail' : warnings ? 'warn' : 'pass';
  return { ok: verdict === 'pass', verdict, passed, warnings, failures, errors, blocking };
}
