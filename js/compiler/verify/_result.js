/**
 * KNITCAT V2 — the verifier's shared verdict shape.
 *
 * Every check returns the same little object; this is the one place it is built so the runner
 * and the nine checks never drift and never import each other (which would be a cycle). DOM-free.
 *
 * @module compiler/verify/_result
 */

/**
 * @typedef {object} CheckResult
 * @property {string} id
 * @property {('pass'|'warn'|'fail'|'error')} verdict
 * @property {string} message
 * @property {string} fix a specific, actionable instruction (empty when a clean pass)
 * @property {number} score 0 pass · 1 warn · 2 fail · 3 error
 */

/** Severity weight per verdict, for sorting and summarising. */
export const VERDICT_WEIGHT = Object.freeze({ pass: 0, warn: 1, fail: 2, error: 3 });

/**
 * Build a {@link CheckResult}.
 * @param {string} id @param {'pass'|'warn'|'fail'|'error'} verdict @param {string} message
 * @param {string} [fix] @param {object} [extra]
 * @returns {CheckResult}
 */
export function makeResult(id, verdict, message, fix = '', extra = {}) {
  return Object.assign({ id, verdict, message, fix, score: VERDICT_WEIGHT[verdict] ?? 0 }, extra);
}

/** Convenience for the very common pass verdict. */
export const pass = (id, message, extra) => makeResult(id, 'pass', message, '', extra);
export const warn = (id, message, fix, extra) => makeResult(id, 'warn', message, fix, extra);
export const fail = (id, message, fix, extra) => makeResult(id, 'fail', message, fix, extra);
