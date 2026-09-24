/**
 * KNITCAT V2 — a human view of the optimiser's Pareto frontier (spec §4.4, the UI half).
 *
 * The optimiser ({@link module:compiler/optimise.optimiseIr}) already computes everything a
 * knitter would want to *decide* with: several candidate pass-orderings, each scored on the
 * three honest costs (machine time, yarn, appearance/joins), the non-dominated frontier among
 * them, and the single candidate that best matches a stated priority. Until now all of that was
 * thrown away after the choice was made — the compiler panel showed a bare "optimised" tick, and
 * there was no way to ask for "least yarn" instead of "balanced".
 *
 * This module is the read-only bridge: it turns an `optimisation` report into a flat,
 * render-ready comparison — one row per named priority with its three costs, each candidate's
 * delta against the balanced baseline, and the frontier points normalised for a scatter. It adds
 * no new maths: it defers entirely to {@link module:compiler/optimise/pareto} (`weightedPick`,
 * `paretoFrontier`, `paretoAxes`) so the panel can never disagree with what the compiler actually
 * chose. DOM-free, deterministic, total (never throws) — safe to unit-test directly and safe to
 * call on a half-built report.
 *
 * @module compiler/optimise/summary
 */

import { weightedPick, paretoFrontier, paretoAxes, AXES } from './pareto.js';

/**
 * The priorities the UI offers, in display order. `priority` is the exact token
 * `weightedPick`/`weightsForPriority` already understand, so a choice here and a compile
 * elsewhere cannot drift apart.
 */
export const PRIORITY_OPTIONS = Object.freeze([
  { priority: 'balanced', label: 'Balanced', hint: 'even weight on time, yarn and tidiness' },
  { priority: 'fast', label: 'Fewest passes', hint: 'shortest machine time — usually more colour changes' },
  { priority: 'yarn', label: 'Least yarn', hint: 'minimise yarn — usually longer carriage travel' },
  { priority: 'appearance', label: 'Best looking', hint: 'tidiest joins and matched repeats — other costs rise' },
]);

const AXIS_LABEL = Object.freeze({ time: 'time', yarn: 'yarn', appearance: 'joins' });

/** Round a cost for display without implying false precision. */
function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

/** A candidate's numeric cost on an axis, defensive against a missing/garbage field. */
function costOf(candidate, axis) {
  if (!candidate) return 0;
  const direct = candidate[axis];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const fromMetrics = candidate.metrics && candidate.metrics[axis];
  return typeof fromMetrics === 'number' && Number.isFinite(fromMetrics) ? fromMetrics : 0;
}

/**
 * Two candidates "the same" if they score identically on every axis (and, when tagged, share an
 * objective). Necessary because `weightedPick`/`rankCandidates` hand back shallow *copies* — the
 * compiler's `chosen` is never reference-equal to an entry of `candidates`, so the only honest
 * identity test is by value.
 */
function sameCandidate(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if ((a.objective || '') !== (b.objective || '')) return false;
  return AXES.every((axis) => costOf(a, axis) === costOf(b, axis));
}

/** Percentage change of `value` against `base`; negative means cheaper (all axes are minimised). */
function pctChange(value, base) {
  if (!(base > 0)) return 0;
  return Math.round(((value - base) / base) * 100);
}

/** "18% less" / "12% more" / "same" — a signed percentage read as a plain phrase. */
function phrase(pct, axis) {
  const unit = AXIS_LABEL[axis] || axis;
  if (pct <= -3) return `${-pct}% less ${unit}`;
  if (pct >= 3) return `${pct}% more ${unit}`;
  return `same ${unit}`;
}

/** A one-line trade-off summary relative to the balanced baseline. */
function blurbFor(delta) {
  const parts = ['time', 'yarn', 'appearance'].map((axis) => phrase(delta[axis], axis));
  return parts.join(' · ');
}

/**
 * Summarise an `optimisation` report (the object `compileProject` returns under `.optimisation`)
 * into a render-ready comparison of the priorities and the frontier.
 *
 * @param {object|null|undefined} optimisation the compiler's optimisation stage, or null
 * @returns {{
 *   ok: true,
 *   chosenPriority: string|null,
 *   totals: {time:number, yarn:number, appearance:number},
 *   options: Array<{priority:string, label:string, hint:string, time:number, yarn:number, appearance:number, delta:object, blurb:string, isChosen:boolean}>,
 *   frontier: Array<{objective:string, time:number, yarn:number, appearance:number}>,
 *   changeNotes: string[],
 *   axes: object[]
 * }|null} `null` when there is no optimisation to describe (so a caller renders nothing)
 */
export function summariseOptimisation(optimisation) {
  const candidates = Array.isArray(optimisation && optimisation.candidates)
    ? optimisation.candidates.filter((c) => c && !c.error)
    : [];
  if (!candidates.length) return null;

  // The balanced pick is the yardstick every other option is compared against; it is also what
  // the compiler itself defaults to, so "no change" against it means "no different to before".
  const baseline = weightedPick(candidates, 'balanced') || candidates[0];
  const baseCosts = {
    time: costOf(baseline, 'time'),
    yarn: costOf(baseline, 'yarn'),
    appearance: costOf(baseline, 'appearance'),
  };

  const chosen = (optimisation && optimisation.chosen) || baseline;

  const options = PRIORITY_OPTIONS.map((option) => {
    const candidate = weightedPick(candidates, option.priority) || baseline;
    const costs = {
      time: round2(costOf(candidate, 'time')),
      yarn: round2(costOf(candidate, 'yarn')),
      appearance: round2(costOf(candidate, 'appearance')),
    };
    const delta = {
      time: pctChange(costOf(candidate, 'time'), baseCosts.time),
      yarn: pctChange(costOf(candidate, 'yarn'), baseCosts.yarn),
      appearance: pctChange(costOf(candidate, 'appearance'), baseCosts.appearance),
    };
    return {
      priority: option.priority,
      label: option.label,
      hint: option.hint,
      ...costs,
      delta,
      blurb: blurbFor(delta),
      isChosen: sameCandidate(candidate, chosen),
    };
  });

  const chosenOption = options.find((o) => o.isChosen) || null;
  const frontierSource = Array.isArray(optimisation.frontier) && optimisation.frontier.length
    ? optimisation.frontier
    : paretoFrontier(candidates);

  return {
    ok: true,
    chosenPriority: chosenOption ? chosenOption.priority : null,
    totals: {
      time: round2(costOf(chosen, 'time')),
      yarn: round2(costOf(chosen, 'yarn')),
      appearance: round2(costOf(chosen, 'appearance')),
    },
    options,
    frontier: frontierSource.map((c) => ({
      objective: c.objective || 'candidate',
      time: round2(costOf(c, 'time')),
      yarn: round2(costOf(c, 'yarn')),
      appearance: round2(costOf(c, 'appearance')),
    })),
    changeNotes: Array.isArray(optimisation.changes) ? optimisation.changes.filter((x) => typeof x === 'string' && x) : [],
    axes: paretoAxes(candidates).map((point) => ({
      time: point.time,
      yarn: point.yarn,
      appearance: point.appearance,
      onFrontier: Boolean(point.onFrontier),
      objective: (point.candidate && point.candidate.objective) || '',
    })),
  };
}

/**
 * Normalise a user/UI priority token to one of the {@link PRIORITY_OPTIONS} ids, accepting the
 * aliases `weightsForPriority` already honours. Anything unrecognised falls back to `balanced`
 * rather than dropping the setting silently.
 *
 * @param {string|object|null|undefined} priority
 * @returns {string} one of 'balanced' | 'fast' | 'yarn' | 'appearance', or the object echoed back
 */
export function normalisePriority(priority) {
  if (priority && typeof priority === 'object') return priority; // custom weights pass straight through
  switch (priority) {
    case 'fast': case 'time': return 'fast';
    case 'yarn': case 'cheap': case 'economy': return 'yarn';
    case 'appearance': case 'pretty': return 'appearance';
    case 'balanced': case 'none': return 'balanced';
    default: return 'balanced';
  }
}
