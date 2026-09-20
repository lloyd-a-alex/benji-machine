/**
 * KNITCAT V2 — Production: the plan (spec §6.2 ProductionPlan, §6.3, §6.10 Dashboard).
 *
 * The root object of the Production System and the seam where it welds onto the rest of KNITCAT.
 * A {@link ProductionPlan} binds one Project to a quantity, a deadline and a customer set, then
 * *derives* everything else from the live graph on demand: the batch schedule (batch.js), the
 * cost and price (costing.js + pricing.js), the hours and their feasibility (time.js), the yarn to
 * reserve (inventory.js) and the QC checklist to sign each piece off with (qc.js). Nothing here
 * caches a stale copy — `computePlan` re-reads the Project each call, so if the maker swaps a yarn
 * the plan's cost, time and yarn needs all move together. That is the fusion the spec demands.
 *
 * A plan is a plain, JSON-safe object ({@link createPlan}) so it stores in a `.kcard` and replays
 * in the test battery; {@link computePlan} is the pure projector that turns that stored plan + the
 * live Project into the rich view (dashboard numbers, batches, reservations, checklist). Status
 * transitions are validated the same way orders' are.
 *
 * DOM-free.
 *
 * @module production/plan
 */

import {
  PLAN_STATUSES, addWorkingDays, clamp, makeId, money, num, round, sum, today
} from './_util.js';
import { buildCosting } from './costing.js';
import { estimateHours } from './time.js';
import { planBatch, splitIntoBatches, scheduleBatches, batchSummary } from './batch.js';
import { createInventory, reserveStock, checkStockForBom } from './inventory.js';
import { createChecklist, targetsFromProject, evaluateQc } from './qc.js';
import { recommendPrice } from './pricing.js';

/**
 * @typedef {object} ProductionPlan
 * @property {string} id @property {string} projectId @property {string} [name]
 * @property {number} quantity @property {string} deadline @property {string} startDate
 * @property {string} status @property {string} currency
 * @property {Array} batches @property {Array} orders @property {object} inventory
 * @property {object|null} qc @property {object} packaging @property {Object<string,number>} budget
 * @property {string} createdAt @property {string} [note] @property {string[]} history
 */

/**
 * Create a blank, stored plan (no derived figures yet — that's computePlan's job).
 * @param {{projectId?:string, name?:string, quantity?:number, deadline?:string, startDate?:string,
 *   currency?:string, batchCount?:number, assignedTo?:string, packaging?:object}} [input]
 * @returns {ProductionPlan}
 */
export function createPlan(input = {}) {
  const startDate = input.startDate || today();
  return {
    id: input.id || makeId('plan'),
    projectId: String(input.projectId || ''),
    name: input.name || 'Production plan',
    quantity: Math.max(1, Math.round(num(input.quantity, 1))),
    deadline: input.deadline || addWorkingDays(startDate, 14),
    startDate,
    status: 'planning',
    currency: input.currency || 'GBP',
    batchCount: Math.max(0, Math.round(num(input.batchCount, 0))),
    assignedTo: input.assignedTo || '',
    hoursPerDay: clamp(num(input.hoursPerDay, 4), 0.25, 24),
    batches: [],
    orders: [],
    inventory: input.inventory || createInventory(),
    qc: null,
    packaging: Object.assign({ includeCareCard: true, includeBusinessCard: false, giftWrap: false, brandSticker: '', tissue: false }, input.packaging || {}),
    budget: Object.assign({ labourRate: 12, markup: 2.4, targetMarginPct: 55, wastagePct: 10, overheadPct: 0 }, input.budget || {}),
    createdAt: input.createdAt || today(),
    note: input.note || '',
    history: ['created as planning']
  };
}

/** Legal plan status transitions. */
export const PLAN_TRANSITIONS = {
  planning: ['in-progress', 'cancelled'],
  'in-progress': ['complete', 'cancelled'],
  complete: ['shipped', 'in-progress'],
  shipped: [],
  cancelled: ['planning']
};

/** Is a plan status move legal? @returns {boolean} */
export function canMovePlan(from, to) {
  if (!PLAN_STATUSES.includes(to) || to === from) return false;
  return (PLAN_TRANSITIONS[from] || []).includes(to);
}

/** Move a plan's status (throws on illegal moves). @returns {ProductionPlan} */
export function advancePlan(plan, to) {
  if (!canMovePlan(plan.status, to)) throw new Error(`Illegal plan transition: ${plan.status} → ${to}`);
  return { ...plan, status: to, history: (plan.history || []).concat([`${plan.status} → ${to}`]) };
}

/**
 * @typedef {object} PlanView
 * @property {ProductionPlan} plan @property {object} costing @property {object} time
 * @property {object} pricing @property {object} batch @property {Array} batches
 * @property {object} inventory @property {object} qc @property {object} dashboard
 * @property {boolean} feasible @property {string[]} warnings
 */

/**
 * Project a stored plan + the live Project into a full, computed view. Pure: same inputs → same
 * output, and it never mutates the plan. This is what the dashboard and the export feed off.
 * @param {ProductionPlan} plan @param {any} project @param {{autoReserve?:boolean, marketPrices?:number[]}} [opts]
 * @returns {PlanView}
 */
export function computePlan(plan, project, opts = {}) {
  const warnings = [];
  const quantity = Math.max(1, Math.round(num(plan.quantity, 1)));
  const budget = plan.budget || {};

  const time = estimateHours(project, { quantity, stitchesPerMinute: budget.stitchesPerMinute, finishingHours: budget.finishingHours });
  const costing = buildCosting(project, {
    quantity,
    currency: plan.currency,
    labourRate: budget.labourRate,
    markup: budget.markup,
    targetMarginPct: budget.targetMarginPct,
    wastagePct: budget.wastagePct,
    overheadPct: budget.overheadPct,
    learningCurve: budget.learningCurve
  });
  const pricing = recommendPrice(project, { quantity, currency: plan.currency, markup: budget.markup, targetMarginPct: budget.targetMarginPct, marketPrices: opts.marketPrices });

  const batch = planBatch(project, {
    quantity,
    deadline: plan.deadline,
    startDate: plan.startDate,
    hoursPerDay: plan.hoursPerDay,
    wastagePct: budget.wastagePct,
    currency: plan.currency,
    labourRate: budget.labourRate,
    markup: budget.markup
  });
  for (const w of batch.warnings) warnings.push(w);

  // Materialise + schedule batches (stored batches win; else derive a schedule).
  const sourceBatches = plan.batches && plan.batches.length
    ? plan.batches
    : splitIntoBatches({ quantity, batchCount: plan.batchCount, startDate: plan.startDate, endDate: plan.deadline, totalHours: time.batchHours, assignedTo: plan.assignedTo });
  const batches = scheduleBatches(sourceBatches, { startDate: plan.startDate, hoursPerDay: plan.hoursPerDay });
  const summary = batchSummary(batches);

  // Inventory reservation check for the yarn this batch needs.
  const yarnNeeds = batch.yarnNeeds || [];
  const bom = yarnNeeds.map((y) => ({ yarnId: y.yarnId, colorId: y.colorId, grams: y.gramsTotal }));
  const stockCheck = checkStockForBom(plan.inventory || createInventory(), bom);
  let inventory = plan.inventory || createInventory();
  if (opts.autoReserve && stockCheck.sufficient) {
    inventory = reserveStock(inventory, { orderId: plan.id, items: bom }).inventory;
  } else if (!stockCheck.sufficient) {
    for (const s of stockCheck.shortages) warnings.push(`Stock short for ${s.id}: need ${s.want}g, have ${s.have}g.`);
  }

  // QC checklist seeded with the pattern's own targets.
  const qc = plan.qc && plan.qc.checks ? evaluateQc(plan.qc) : createChecklist({ projectId: plan.projectId, title: `QC · ${plan.name}`, targets: targetsFromProject(project) });

  const dashboard = {
    name: plan.name,
    status: plan.status,
    quantity,
    revenue: money(sum((plan.orders || []).filter((o) => o.status !== 'cancelled' && o.status !== 'refunded').map((o) => num(o.total)))),
    totalCost: costing.totalCost,
    profit: money(pricing.price * quantity - costing.totalCost),
    suggestedPrice: pricing.price,
    hours: round(time.batchHours, 2),
    deadline: plan.deadline,
    progressPct: summary.progressPct,
    feasible: batch.feasible,
    qcVerdict: qc.score.verdict
  };

  return {
    plan, costing, time, pricing, batch, batches, inventory, qc, dashboard,
    feasible: batch.feasible && stockCheck.sufficient,
    warnings: dedupe(warnings)
  };
}

/**
 * Serialise a plan (+ optional computed view) into a JSON-safe store object.
 * @param {ProductionPlan} plan @param {PlanView} [view] @returns {object}
 */
export function planToPlain(plan, view) {
  const out = JSON.parse(JSON.stringify({ ...plan }));
  if (view) {
    out._computed = {
      feasible: view.feasible,
      dashboard: view.dashboard,
      batchSummary: batchSummary(view.batches),
      warnings: view.warnings
    };
  }
  return out;
}

/** Rehydrate a stored plan object. @returns {ProductionPlan} */
export function planFromPlain(plain) {
  const base = createPlan({});
  const merged = Object.assign(base, plain || {});
  merged._computed = undefined;
  return merged;
}

/** A one-paragraph English summary of a computed plan, for the dashboard header. */
export function planNarrative(view) {
  const d = view.dashboard;
  const symbols = { GBP: '£', USD: '$', EUR: '€' };
  const sym = symbols[String(d.currency || view.plan.currency || 'GBP').toUpperCase()] || '';
  const feasibility = view.feasible ? 'is feasible' : 'is NOT feasible yet';
  return `${d.name}: make ${d.quantity} by ${view.plan.deadline}. Est. ${d.hours} h, ${sym}${money(d.totalCost)} cost, ${sym}${money(d.suggestedPrice)} each (${sym}${money(d.profit)} batch profit). It ${feasibility}. QC: ${d.qcVerdict}.`;
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x);
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}
