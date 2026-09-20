/**
 * KNITCAT V2 — Production: time tracking (spec §6.5).
 *
 * Selling knitters are paid for their time whether or not they count it; the ones who do count it
 * are the ones who stay in business. This module owns two related things:
 *
 *   1. **Estimation** — a bottom-up model that turns a Project's structure (stitch count, rows,
 *      machine throughput, finishing) into an hours forecast per operation, so a batch plan and a
 *      quote share one number. It reads the graph's `time.*` nodes when present and can decompose
 *      a piece into knit / set-up / seaming / blocking / weaving-in / QC / packing operations.
 *
 *   2. **Actuals** — a light timesheet. Log time against a plan, batch, piece or operation; roll
 *      it up; and compare estimate vs. actual with a *learning curve*: the first unit of a batch
 *      is slow, later ones faster (Wright's model, exponent b, unit i takes est × i^(b-1) at the
 *      unit level). We fit the realised exponent from logged data so the next batch's quote
 *      reflects how this maker actually works, not a textbook.
 *
 * Pure and DOM-free: {@link estimateHours} is a function of the Project; the timesheet is a plain
 * data structure ({@link createTimeSheet}, {@link logTime}, {@link rollupTime}) you can serialise.
 *
 * @module production/time
 */

import { clamp, dayMs, money, nodeNum, num, round, sum, daysBetween } from './_util.js';

/** Standard operation decomposition with default minutes, used when the graph has no richer model. */
export const OPERATION_TEMPLATE = [
  { key: 'set-up', label: 'Machine set-up & carriage prep', minutesPerBatch: 20, scalesWith: 'batch' },
  { key: 'knit', label: 'Knitting', minutesPerUnit: null, scalesWith: 'unit' }, // from stitch count
  { key: 'seaming', label: 'Seaming & joining', minutesPerUnit: 25, scalesWith: 'unit' },
  { key: 'blocking', label: 'Blocking', minutesPerUnit: 15, scalesWith: 'unit' },
  { key: 'weaving', label: 'Weaving in ends', minutesPerUnit: 18, scalesWith: 'unit' },
  { key: 'qc', label: 'Quality control', minutesPerUnit: 8, scalesWith: 'unit' },
  { key: 'packing', label: 'Finishing, labelling & packing', minutesPerUnit: 12, scalesWith: 'unit' }
];

/**
 * @typedef {object} TimeEstimate
 * @property {OperationEstimate[]} operations
 * @property {number} unitHours hours for one piece (knit + per-unit ops)
 * @property {number} batchHours hours for `quantity` pieces incl. set-up
 * @property {number} totalStitches
 * @property {number} stitchesPerMinute
 * @property {number} learningCurve fitted exponent (0 = none) for batch averaging
 */

/**
 * @typedef {object} OperationEstimate
 * @property {string} key @property {string} label @property {number} hoursPerUnit
 * @property {number} hoursTotal @property {string} scalesWith
 */

/**
 * Estimate the hours for a Project (optionally for a whole batch), decomposed per operation.
 *
 * @param {any} project
 * @param {{
 *   quantity?:number, stitchesPerMinute?:number, hoursPerUnit?:number,
 *   finishingHours?:number, extraOperations?:Array, learningCurve?:number,
 *   perOperation?:Object<string, number>
 * }} [options]
 * @returns {TimeEstimate}
 */
export function estimateHours(project, options = {}) {
  const quantity = Math.max(1, Math.round(num(options.quantity, 1)));
  const spm = Math.max(1, num(options.stitchesPerMinute, nodeNum(project, 'cost.stitchesPerMinute', 130)) || 130);
  const totalStitches = Math.max(0, Math.round(nodeNum(project, 'time.totalStitches', 0)));
  const learningCurve = clamp(num(options.learningCurve, 0), -1, 0);

  // Knitting hours: prefer an explicit hoursPerUnit override, else derive from stitches ÷ throughput.
  const knitHoursPerUnit = options.hoursPerUnit != null
    ? num(options.hoursPerUnit)
    : totalStitches > 0
      ? totalStitches / (spm * 60)
      : nodeNum(project, 'time.knitHours', 0);

  const operations = [];
  operations.push(mkOp('set-up', 'Machine set-up & carriage prep', (options.setupMinutes != null ? num(options.setupMinutes) : 20) / 60, 'batch', quantity));
  operations.push(mkOp('knit', 'Knitting', knitHoursPerUnit, 'unit', quantity));
  operations.push(mkOp('seaming', 'Seaming & joining', (optMinutes(options, 'seaming', 25)) / 60, 'unit', quantity));
  operations.push(mkOp('blocking', 'Blocking', (optMinutes(options, 'blocking', 15)) / 60, 'unit', quantity));
  operations.push(mkOp('weaving', 'Weaving in ends', (optMinutes(options, 'weaving', 18)) / 60, 'unit', quantity));
  operations.push(mkOp('qc', 'Quality control', (optMinutes(options, 'qc', 8)) / 60, 'unit', quantity));
  operations.push(mkOp('packing', 'Finishing, labelling & packing', (optMinutes(options, 'packing', 12)) / 60, 'unit', quantity));
  for (const extra of Array.isArray(options.extraOperations) ? options.extraOperations : []) {
    if (extra && extra.key) operations.push(mkOp(extra.key, extra.label || extra.key, num(extra.hoursPerUnit, num(extra.hours, 0)), extra.scalesWith || 'unit', quantity));
  }

  const unitHours = round(sum(operations.filter((o) => o.scalesWith === 'unit').map((o) => o.hoursPerUnit)), 3);
  const batchHours = round(sum(operations.map((o) => o.hoursTotal)), 3);
  return { operations, unitHours, batchHours, totalStitches, stitchesPerMinute: spm, learningCurve };
}

function optMinutes(options, key, dflt) {
  if (options.perOperation && options.perOperation[key] != null) return num(options.perOperation[key]);
  const t = OPERATION_TEMPLATE.find((o) => o.key === key);
  return t && t.minutesPerUnit != null ? t.minutesPerUnit : dflt;
}

function mkOp(key, label, hoursPerUnit, scalesWith, quantity) {
  const h = round(hoursPerUnit, 3);
  return { key, label, hoursPerUnit: h, hoursTotal: round(scalesWith === 'batch' ? h : h * quantity, 3), scalesWith };
}

// ---------------------------------------------------------------------------
// Timesheet (actuals)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} TimeEntry
 * @property {string} id @property {string} planId @property {string} [batchId]
 * @property {string} [piece] @property {string} operation @property {number} minutes
 * @property {string} date @property {string} [by] @property {string} [note]
 */

/** Create an empty timesheet bound to a plan (or a standalone log). @returns {import('./_util.js').Object} */
export function createTimeSheet(planId = '') {
  return { planId: String(planId || ''), entries: [] };
}

/**
 * Append a time entry (returns a NEW timesheet; the input is never mutated).
 * @param {ReturnType<typeof createTimeSheet>} sheet
 * @param {{batchId?:string, piece?:string, operation?:string, minutes:number, date?:string, by?:string, note?:string}} entry
 * @returns {ReturnType<typeof createTimeSheet>}
 */
export function logTime(sheet, entry = {}) {
  const minutes = num(entry.minutes);
  const e = {
    id: `te-${Date.now().toString(36)}-${(sheet.entries.length + 1).toString(36)}`,
    planId: sheet.planId || '',
    batchId: entry.batchId || '',
    piece: entry.piece || '',
    operation: entry.operation || 'knit',
    minutes: minutes,
    date: entry.date || new Date().toISOString().slice(0, 10),
    by: entry.by || '',
    note: entry.note || ''
  };
  return { planId: sheet.planId, entries: sheet.entries.concat([e]) };
}

/**
 * Roll a timesheet up by any dimension.
 * @param {ReturnType<typeof createTimeSheet>} sheet
 * @param {'operation'|'batch'|'piece'|'day'|'by'} [group='operation']
 * @returns {{totalMinutes:number, totalHours:number, groups:Record<string, number>, count:number}}
 */
export function rollupTime(sheet, group = 'operation') {
  const entries = (sheet && sheet.entries) || [];
  const totalMinutes = sum(entries.map((e) => num(e.minutes)));
  /** @type {Record<string, number>} */
  const groups = {};
  for (const e of entries) {
    const k = String(e[group] != null && e[group] !== '' ? e[group] : '(none)');
    groups[k] = round((groups[k] || 0) + num(e.minutes), 2);
  }
  return { totalMinutes, totalHours: round(totalMinutes / 60, 2), groups, count: entries.length };
}

/**
 * Compare a time estimate against logged actuals, with a per-operation breakdown and an overall
 * variance. `actualHours` is taken from the timesheet; missing operations show as unlogged.
 * @param {TimeEstimate} estimate @param {ReturnType<typeof createTimeSheet>} sheet
 * @returns {{estimatedHours:number, actualHours:number, varianceHours:number, variancePct:number, perOperation:Array}}
 */
export function estimateVsActual(estimate, sheet) {
  const roll = rollupTime(sheet, 'operation');
  const perOperation = (estimate.operations || []).map((op) => {
    const actualMin = roll.groups[op.key] || 0;
    const estHours = op.hoursTotal;
    const actHours = round(actualMin / 60, 3);
    return {
      key: op.key, label: op.label, estimatedHours: estHours, actualHours: actHours,
      varianceHours: round(actHours - estHours, 3),
      variancePct: estHours > 0 ? round(((actHours - estHours) / estHours) * 100, 1) : (actHours > 0 ? 100 : 0)
    };
  });
  const estimatedHours = round(estimate.batchHours, 3);
  const actualHours = roll.totalHours;
  return {
    estimatedHours,
    actualHours,
    varianceHours: round(actualHours - estimatedHours, 3),
    variancePct: estimatedHours > 0 ? round(((actualHours - estimatedHours) / estimatedHours) * 100, 1) : (actualHours > 0 ? 100 : 0),
    perOperation
  };
}

/**
 * Fit a Wright learning-curve exponent from logged unit times (log-log least squares).
 * Given pairs (unitIndex, minutes) the model is t = a·i^b → log t = log a + b·log i.
 * Returns b clipped to [-1, 0] (we assume it never gets *slower*), and the implied first-unit time.
 * @param {Array<{index:number, minutes:number}>} samples
 * @returns {{exponent:number, firstUnitMinutes:number, r2:number, samples:number}}
 */
export function fitLearningCurve(samples) {
  const pts = (Array.isArray(samples) ? samples : [])
    .map((s) => ({ i: num(s.index, s.i), t: num(s.minutes, s.t) }))
    .filter((p) => p.i >= 1 && p.t > 0);
  if (pts.length < 2) return { exponent: 0, firstUnitMinutes: pts.length ? pts[0].t : 0, r2: 0, samples: pts.length };
  const xs = pts.map((p) => Math.log(p.i));
  const ys = pts.map((p) => Math.log(p.t));
  const n = pts.length;
  const mx = sum(xs) / n;
  const my = sum(ys) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) {
    sxy += (xs[k] - mx) * (ys[k] - my);
    sxx += (xs[k] - mx) ** 2;
    syy += (ys[k] - my) ** 2;
  }
  const b = sxx !== 0 ? sxy / sxx : 0;
  const logA = my - b * mx;
  const firstUnitMinutes = money(Math.exp(logA));
  const r2 = syy !== 0 ? clamp((sxy * sxy) / (sxx * syy), 0, 1) : 0;
  return { exponent: round(clamp(b, -1, 0), 4), firstUnitMinutes, r2: round(r2, 3), samples: n };
}

/**
 * Predict the minutes for unit `index` of a batch given a fitted curve.
 * @param {number} firstUnitMinutes @param {number} index @param {number} exponent
 * @returns {number}
 */
export function predictUnitMinutes(firstUnitMinutes, index, exponent) {
  return round(num(firstUnitMinutes) * Math.pow(Math.max(1, num(index, 1)), clamp(num(exponent), -1, 0)), 2);
}

/**
 * Given total available hours/day and the batch hours, is the deadline feasible?
 * @param {TimeEstimate} estimate @param {{deadline?:string, startDate?:string, hoursPerDay?:number}} sched
 * @returns {{feasible:boolean, requiredHoursPerDay:number, availableDays:number, note:string}}
 */
export function deadlineFeasibility(estimate, sched = {}) {
  const hoursPerDay = clamp(num(sched.hoursPerDay, 4), 0.25, 24);
  const availableDays = sched.deadline && sched.startDate ? daysBetween(sched.startDate, sched.deadline) : 0;
  const required = estimate.batchHours;
  if (!sched.deadline) return { feasible: true, requiredHoursPerDay: 0, availableDays: 0, note: 'No deadline set — cannot judge feasibility.' };
  if (availableDays <= 0) return { feasible: false, requiredHoursPerDay: Infinity, availableDays, note: 'Deadline is before the start date.' };
  const requiredPerDay = round(required / availableDays, 2);
  const feasible = requiredPerDay <= hoursPerDay;
  return {
    feasible,
    requiredHoursPerDay: requiredPerDay,
    availableDays,
    note: feasible
      ? `Comfortable: ${requiredPerDay} h/day over ${availableDays} days (budget ${hoursPerDay} h/day).`
      : `Tight: needs ${requiredPerDay} h/day over ${availableDays} days but only ${hoursPerDay} available — extend the deadline or cut quantity.`
  };
}

/** Human "worked N h across M days" caption from a timesheet. @returns {string} */
export function timeSummaryLine(sheet) {
  const roll = rollupTime(sheet, 'operation');
  const days = new Set(sheet.entries.map((e) => e.date)).size;
  return `${money(roll.totalHours)} h logged across ${roll.count} entries (${days} day${days === 1 ? '' : 's'})`;
}
