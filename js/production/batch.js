/**
 * KNITCAT V2 — Production: batch planning (spec §6.3).
 *
 * "Make 10 hats by Friday, on the KH-830, and tell me if I'm crazy." The batch planner takes a
 * quantity, a deadline, a daily time budget and a Project, and answers the six questions the spec
 * lists — total hours, hours/day, yarn needed, materials needed, cost, feasible? — by composing the
 * other production modules (costing + time) and a first-principles yarn-requirement model. It then
 * splits the quantity into concrete {@link Batch}es with start/end dates so a maker can see the
 * whole schedule on a wall.
 *
 * Two kinds of output:
 *   - {@link planBatch} — the *analysis*: a feasibility verdict plus the numbers behind it.
 *   - {@link splitIntoBatches} / {@link scheduleBatches} — the *work breakdown*: date-boxed batch
 *     objects (id, quantity, startDate, endDate, assignedTo, status, notes) matching spec §6.2,
 *     laid out against working days so nothing silently overlaps.
 *
 * Yarn requirement: grams = (Project's `yarn.totalMeters` × weight-per-meter) when the graph
 * supplies it, else a gauge-derived estimate (stitches × stitch-meters ≈ meters, × WPM). We always
 * add a wastage allowance. Deterministic and DOM-free.
 *
 * @module production/batch
 */

import { addWorkingDays, clamp, money, nodeNum, num, round, sum, workingDaysBetween, makeId } from './_util.js';
import { buildCosting } from './costing.js';
import { estimateHours, deadlineFeasibility } from './time.js';

/**
 * @typedef {object} BatchAnalysis
 * @property {number} quantity @property {number} totalHours @property {number} hoursPerDay
 * @property {number} availableDays @property {number} yarnGrams @property {YarnNeed[]} yarnNeeds
 * @property {number} materialsCost @property {object} costing @property {object} time
 * @property {boolean} feasible @property {string} verdict @property {string[]} warnings
 */

/**
 * @typedef {object} YarnNeed
 * @property {string} yarnId @property {string} colorId @property {string} [name]
 * @property {number} metersPerUnit @property {number} gramsPerUnit @property {number} gramsTotal
 * @property {number} ballsTotal @property {number} available
 */

/**
 * Plan a batch: the analysis behind "can I make N by D, and what will it take/cost?"
 * @param {any} project
 * @param {{
 *   quantity?:number, deadline?:string, startDate?:string, hoursPerDay?:number,
 *   wastagePct?:number, currency?:string, labourRate?:number, markup?:number
 * }} [options]
 * @returns {BatchAnalysis}
 */
export function planBatch(project, options = {}) {
  const warnings = [];
  const quantity = Math.max(1, Math.round(num(options.quantity, 1)));
  const hoursPerDay = clamp(num(options.hoursPerDay, 4), 0.25, 24);
  const startDate = options.startDate || new Date().toISOString().slice(0, 10);
  const wastage = clamp(num(options.wastagePct, 10), 0, 100) / 100;

  const time = estimateHours(project, { quantity, ...options });
  const costing = buildCosting(project, { quantity, currency: options.currency, labourRate: options.labourRate, markup: options.markup, wastagePct: num(options.wastagePct, 10) });
  const totalHours = round(time.batchHours, 2);

  const availableDays = options.deadline ? workingDaysBetween(startDate, options.deadline) : 0;
  const requiredPerDay = availableDays > 0 ? round(totalHours / availableDays, 2) : Infinity;

  // Yarn requirement per unit.
  const yarnNeeds = computeYarnNeeds(project, quantity, wastage);
  const yarnGrams = round(sum(yarnNeeds.map((y) => y.gramsTotal)), 0);

  const feas = deadlineFeasibility(time, { deadline: options.deadline, startDate, hoursPerDay });
  const materialShort = yarnNeeds.filter((y) => y.available != null && y.available < y.gramsTotal);
  for (const s of materialShort) warnings.push(`Short on ${s.name || s.yarnId}/${s.colorId}: need ${Math.round(s.gramsTotal)}g, have ${Math.round(s.available)}g.`);
  if (!feas.feasible) warnings.push(feas.note);

  const feasible = feas.feasible && materialShort.length === 0;
  const verdict = feasible
    ? `Feasible: ${totalHours} h over ${availableDays} working days (${requiredPerDay} h/day ≤ ${hoursPerDay}).`
    : `Not feasible yet — ${warnings[0] || 'see warnings'}`;

  return {
    quantity,
    totalHours,
    hoursPerDay,
    requiredHoursPerDay: round(requiredPerDay, 2),
    availableDays,
    yarnGrams,
    yarnNeeds,
    materialsCost: costing.batch ? money(costing.batch.yarn) : 0,
    costing,
    time,
    feasible,
    verdict,
    warnings
  };
}

/**
 * Per-yarn requirement for the batch, reading the graph's yarn nodes when available and falling
 * back to a gauge-derived estimate. `available` is left null unless the caller passes a stash map.
 * @param {any} project @param {number} quantity @param {number} wastage
 * @param {Object<string, number>} [availableByYarn] grams available keyed `yarnId::colorId`
 * @returns {YarnNeed[]}
 */
export function computeYarnNeeds(project, quantity = 1, wastage = 0.1, availableByYarn = null) {
  const q = Math.max(1, Math.round(num(quantity, 1)));
  const w = clamp(num(wastage), 0, 1) + 1;
  const spec = project && project.spec && project.spec.sections ? project.spec.sections : {};
  const yarnSection = spec.yarn || {};
  const names = Object.keys(yarnSection);
  const needs = [];

  const totalMeters = nodeNum(project, 'yarn.totalMeters', 0);
  const metersPerUnit = totalMeters > 0 ? totalMeters : 0;

  for (const name of names.length ? names : ['main']) {
    const meters = nodeNum(project, `yarn.${name}.meters`, 0) || (names.length <= 1 ? metersPerUnit : 0);
    const wpm = nodeNum(project, `yarn.${name}.gramsPerMeter`, 0) || weightPerMeter(name, yarnSection[name]);
    const gramsPerUnit = round(Math.max(0, meters * wpm) * w, 1);
    const yarnId = (yarnSection[name] && yarnSection[name].id) || name;
    const colorId = (yarnSection[name] && (yarnSection[name].colorId || yarnSection[name].color)) || 'natural';
    needs.push({
      yarnId,
      colorId,
      name: (yarnSection[name] && yarnSection[name].brand ? `${yarnSection[name].brand} ${name}` : name),
      metersPerUnit: round(meters, 1),
      gramsPerUnit,
      gramsTotal: round(gramsPerUnit * q, 1),
      ballsTotal: ballsFor(gramsPerUnit * q, yarnSection[name]),
      available: availableByYarn ? num(availableByYarn[`${yarnId}::${colorId}`], availableByYarn[`${name}::${colorId}`]) : null
    });
  }
  return needs;
}

function weightPerMeter(name, cfg) {
  // ~ grams per meter by weight bucket when the graph has no explicit WPM.
  const weight = String((cfg && cfg.weight) || '').toLowerCase();
  const table = { lace: 0.5, fingering: 0.9, sport: 1.3, dk: 1.75, worsted: 2.2, aran: 2.6, bulky: 3.6, 'super-bulky': 5 };
  return table[weight] || 1.9;
}

function ballsFor(totalGrams, cfg) {
  const perBall = num(cfg && cfg.gramsPerBall, num(cfg && cfg.ballWeight, 100)) || 100;
  return Math.ceil(totalGrams / perBall);
}

/**
 * @typedef {object} Batch
 * @property {string} id @property {number} quantity @property {string} startDate
 * @property {string} endDate @property {string} assignedTo @property {string} status
 * @property {string} notes @property {number} hours @property {number} [orderIndex]
 */

/**
 * Split a total quantity into `batchCount` batches (or by a fixed `size`), date-boxed across
 * working days from `startDate`, each carrying its share of the estimated hours.
 *
 * @param {{quantity?:number, batchCount?:number, size?:number, startDate?:string,
 *   endDate?:string, totalHours?:number, assignedTo?:string}} spec
 * @returns {Batch[]}
 */
export function splitIntoBatches(spec = {}) {
  const quantity = Math.max(1, Math.round(num(spec.quantity, 1)));
  const totalHours = num(spec.totalHours, 0);
  let batchCount = Math.max(1, Math.round(num(spec.batchCount, 0)));
  let size = Math.max(1, Math.round(num(spec.size, 0)));
  if (batchCount <= 0 && size > 0) batchCount = Math.ceil(quantity / size);
  if (batchCount <= 0) batchCount = Math.min(quantity, 4);
  batchCount = Math.min(batchCount, quantity); // never more batches than pieces
  size = Math.ceil(quantity / batchCount);

  const startDate = spec.startDate || new Date().toISOString().slice(0, 10);
  const windows = distributeWindows(startDate, spec.endDate, batchCount);
  const batches = [];
  let made = 0;
  for (let i = 0; i < batchCount; i++) {
    const qty = Math.min(size, quantity - made);
    made += qty;
    batches.push({
      id: makeId('bat'),
      quantity: qty,
      startDate: windows[i].start,
      endDate: windows[i].end,
      assignedTo: spec.assignedTo || '',
      status: 'queued',
      hours: round((totalHours * qty) / quantity, 2),
      notes: '',
      orderIndex: i + 1
    });
    if (made >= quantity) break;
  }
  return batches;
}

/** Divide a working-day span into `n` sequential windows. */
function distributeWindows(startDate, endDate, n) {
  const totalDays = endDate ? workingDaysBetween(startDate, endDate) : n * 3;
  const per = Math.max(1, Math.floor((totalDays || n) / n));
  const windows = [];
  let cursor = startDate;
  for (let i = 0; i < n; i++) {
    const end = addWorkingDays(cursor, per - 1);
    windows.push({ start: cursor, end });
    cursor = addWorkingDays(end, 1);
  }
  return windows;
}

/**
 * Schedule batches so they run back-to-back on working days from `startDate`, re-deriving each
 * batch's dates from its hour budget ÷ hoursPerDay. Mutates nothing; returns new batch objects.
 * @param {Batch[]} batches @param {{startDate?:string, hoursPerDay?:number}} [opts]
 * @returns {Batch[]}
 */
export function scheduleBatches(batches, opts = {}) {
  const hoursPerDay = clamp(num(opts.hoursPerDay, 4), 0.25, 24);
  let cursor = opts.startDate || (batches[0] && batches[0].startDate) || new Date().toISOString().slice(0, 10);
  return (batches || []).map((b) => {
    const days = Math.max(1, Math.ceil(num(b.hours) / hoursPerDay));
    const start = cursor;
    const end = addWorkingDays(start, days - 1);
    cursor = addWorkingDays(end, 1);
    return { ...b, startDate: start, endDate: end };
  });
}

/** Roll a list of batches up into totals. @returns {{count:number, quantity:number, hours:number, complete:number, progressPct:number}} */
export function batchSummary(batches) {
  const list = Array.isArray(batches) ? batches : [];
  const complete = list.filter((b) => b.status === 'complete').length;
  const quantity = sum(list.map((b) => num(b.quantity)));
  const doneQty = sum(list.filter((b) => b.status === 'complete').map((b) => num(b.quantity)));
  return {
    count: list.length,
    quantity: Math.round(quantity),
    hours: round(sum(list.map((b) => num(b.hours))), 2),
    complete,
    progressPct: quantity > 0 ? round((doneQty / quantity) * 100, 0) : 0
  };
}
