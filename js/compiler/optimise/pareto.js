/**
 * KNITCAT V2 — the Pareto frontier (spec §4.4 "The optimiser produces a Pareto frontier").
 *
 * Optimising a pattern is never one objective: the fewest-passes order is rarely the least-waste
 * order and almost never the best-looking order. Rather than silently pick one, the optimiser
 * evaluates several *weightings* of the three cost axes (time/machine, yarn, appearance) and keeps
 * the non-dominated set — the frontier of honest trade-offs a knitter can actually choose between.
 *
 * This module is pure maths over `{time, yarn, appearance, ir, changes}` candidates. It supplies:
 *   - {@link paretoFrontier} — the non-dominated subset (minimising every axis),
 *   - {@link isDominated} — the dominance test,
 *   - {@link weightedPick} — the single candidate that best matches one knitter's stated priority,
 *   - {@link rankCandidates} — order candidates by a weighted scalar (tie-break on total cost).
 *
 * DOM-free.
 *
 * @module compiler/optimise/pareto
 */

import { logger } from '../../core/logging.js';

const log = logger('compiler/optimise/pareto');

/** The three axes, all minimised. */
export const AXES = Object.freeze(['time', 'yarn', 'appearance']);

/**
 * Is candidate `a` dominated by `b` (b at-least-as-good on every axis and strictly better on one)?
 * @param {object} a @param {object} b @returns {boolean}
 */
export function isDominated(a, b) {
  let anyBetter = false;
  for (const ax of AXES) {
    const av = axisValue(a, ax), bv = axisValue(b, ax);
    if (bv > av) return false;      // b worse on this axis ⇒ cannot dominate
    if (bv < av) anyBetter = true;
  }
  return anyBetter;
}

/** The non-dominated subset, preserving input order. @param {object[]} candidates @returns {object[]} */
export function paretoFrontier(candidates = []) {
  const valid = candidates.filter(c => c && !c.error);
  return valid.filter(a => !valid.some(b => b !== a && isDominated(a, b)));
}

/** Weighted scalar cost; lower is better. weights default to equal. */
export function weightedCost(c, weights = {}) {
  const w = { time: weights.time ?? 1, yarn: weights.yarn ?? 1, appearance: weights.appearance ?? 1 };
  return axisValue(c, 'time') * w.time + axisValue(c, 'yarn') * w.yarn + axisValue(c, 'appearance') * w.appearance;
}

/** Rank candidates by weighted cost. @returns {object[]} with `.weightedCost` attached. */
export function rankCandidates(candidates = [], weights = {}) {
  return candidates
    .filter(c => c && !c.error)
    .map(c => Object.assign({}, c, { weightedCost: round2(weightedCost(c, weights)) }))
    .sort((a, b) => a.weightedCost - b.weightedCost || (totalCost(a) - totalCost(b)));
}

/**
 * Pick the single candidate best matching a stated priority.
 * @param {object[]} candidates @param {'time'|'yarn'|'appearance'|'balanced'|{time:number,yarn:number,appearance:number}} priority
 */
export function weightedPick(candidates = [], priority = 'balanced') {
  const weights = typeof priority === 'string' ? weightsForPriority(priority) : priority;
  const ranked = rankCandidates(candidates, weights);
  return ranked[0] || null;
}

/** Standard weightings for the named priorities the UI offers. */
export function weightsForPriority(priority) {
  switch (priority) {
    case 'time': case 'fast': return { time: 3, yarn: 1, appearance: 1 };
    case 'yarn': case 'cheap': case 'economy': return { time: 1, yarn: 3, appearance: 1 };
    case 'appearance': case 'pretty': return { time: 1, yarn: 1, appearance: 3 };
    default: {
      // An unrecognised priority name silently becomes "balanced" — worth a line, so
      // "I asked to optimise for X and nothing changed" is diagnosable.
      if (typeof priority === 'string' && priority) log.debug(`unknown optimiser priority "${priority}" — falling back to balanced weights`, { priority });
      return { time: 1, yarn: 1, appearance: 1 };
    }
  }
}

/** Normalised [0..1] axis vector for scatter/plot rendering in the UI. */
export function paretoAxes(candidates = []) {
  const valid = candidates.filter(c => c && !c.error);
  if (!valid.length) return [];
  const mins = {}, maxs = {};
  for (const ax of AXES) {
    const vals = valid.map(c => axisValue(c, ax));
    mins[ax] = Math.min(...vals); maxs[ax] = Math.max(...vals);
  }
  const range = ax => (maxs[ax] - mins[ax]) || 1;
  return valid.map(c => {
    const point = {};
    for (const ax of AXES) point[ax] = (axisValue(c, ax) - mins[ax]) / range(ax);
    point.onFrontier = paretoFrontier(valid).includes(c);
    point.candidate = c;
    return point;
  });
}

/**
 * Read a candidate's value on an axis. Candidates from `optimise/index.js` carry normalised
 * numeric `time`/`yarn`/`appearance` fields; a raw single-pass result carrying a `metrics.cost`
 * is mapped onto whichever axis the caller tagged it with (default `time`).
 */
function axisValue(c, ax) {
  if (typeof c[ax] === 'number' && Number.isFinite(c[ax])) return c[ax];
  if (c.metrics && typeof c.metrics.cost === 'number') return c.metrics.cost;
  return Number(c[ax]) || 0;
}
function totalCost(c) { return AXES.reduce((s, ax) => s + axisValue(c, ax), 0); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
