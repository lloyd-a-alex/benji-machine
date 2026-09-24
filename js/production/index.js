/**
 * KNITCAT V2 — the Production System (spec §6).
 *
 * "Etsy + Shopify + accounting + project management" for knitters who sell — the reason a
 * professional pays monthly rather than once. Six concern-modules live here, all operating on the
 * *same* Project the rest of KNITCAT uses, so a costing quoted in an order, a batch schedule and a
 * tech-pack export can never disagree:
 *
 *   plan.js      the ProductionPlan root: binds a Project to quantity + deadline and *projects* a
 *                full dashboard view (cost, time, price, batches, reservations, QC) on demand.
 *   batch.js     batch planning + the feasibility answer + splitting a run into date-boxed batches.
 *   order.js     the order lifecycle (status machine, totals, discounts, tax, BOM roll-up).
 *   inventory.js raw yarn stock (with reservations) + finished goods, reorder alerts, BOM checks.
 *   qc.js        the quality-control checklist, measurement tolerances, scoring, Project targets.
 *   costing.js   the authoritative cost model (yarn/labour/materials/overhead + learning curve).
 *   time.js      hours estimation + timesheet actuals + estimate-vs-actual + learning-curve fit.
 *   pricing.js   cost-plus / target-margin / wholesale / market analysis / quantity breaks.
 *   customer.js  a tiny CRM: lifetime value, RFM segmentation, favourite colours, churn risk.
 *
 * This barrel re-exports every public symbol so the facade, the UI panels and the tests reach the
 * whole system through one import. `summariseProduction` is the convenience roll-up the dashboard
 * calls; it composes the individual engines for a plan. DOM-free — safe to import under Node.
 *
 * @module production
 */

export {
  makeId, money, round, num, clamp, sum, mean, pct, slug, titleCase, makeSku, groupBy,
  addDays, addWorkingDays, daysBetween, workingDaysBetween, today, isoDay, formatMoney,
  nodeVal, nodeNum, PLAN_STATUSES, ORDER_STATUSES, BATCH_STATUSES, QC_VERDICTS
} from './_util.js';

export {
  buildCosting, applyLearningCurve, unitCostAt, repricing, compareMarket,
  DEFAULT_MARKUP, DEFAULT_WHOLESALE_FACTOR, DEFAULT_WASTAGE
} from './costing.js';

export {
  estimateHours, createTimeSheet, logTime, rollupTime, estimateVsActual,
  fitLearningCurve, predictUnitMinutes, deadlineFeasibility, timeSummaryLine, OPERATION_TEMPLATE
} from './time.js';

export {
  planBatch, computeYarnNeeds, splitIntoBatches, scheduleBatches, batchSummary
} from './batch.js';

export {
  createOrder, recomputeTotals, setOrderItems, addOrderItem, removeOrderItem,
  canTransition, transitionOrder, setTracking, orderCost, orderProfit, orderMarginPct,
  orderBom, isOverdue, ordersByStatus, openOrders, ORDER_TRANSITIONS
} from './order.js';

export {
  createInventory, upsertStock, adjustStock, reserveStock, releaseReservation, consumeStock,
  reorderAlerts, stockValue, upsertFinished, sellFinished, availableFinished,
  finishedRetailValue, finishedCostValue, checkStockForBom
} from './inventory.js';

export {
  createChecklist, setCheck, recordMeasurement, evaluateQc, checksByCategory, qcProgress,
  resetChecklist, mergeInspections, targetsFromProject, QC_TEMPLATE
} from './qc.js';

export {
  priceFromCost, wholesalePrice, marketAnalysis, applyDiscount, quantityBreaks, recommendPrice
} from './pricing.js';

export {
  createCustomer, ordersFor, customerStats, segment, topCustomers, atRiskCustomers,
  mergeCustomers, customerLine
} from './customer.js';

export {
  createPlan, canMovePlan, advancePlan, computePlan, planToPlain, planFromPlain,
  planNarrative, PLAN_TRANSITIONS
} from './plan.js';

export {
  buildDesignQuote, resolveDesignChart, chartColorHistogram, renderQuoteSheet
} from './quote.js';

import { computePlan } from './plan.js';
import { batchSummary } from './batch.js';
import { openOrders } from './order.js';
import { reorderAlerts } from './inventory.js';
import { money, num, round, sum } from './_util.js';

/**
 * A high-level, dashboard-ready summary of the whole production operation. Given a plan (and its
 * live Project) it returns the headline numbers plus the action items a maker needs the moment
 * they open the Production tab: revenue at risk, overdue orders, stock to reorder, QC verdicts and
 * whether the current plan is feasible. Pure; DOM-free.
 *
 * @param {import('./plan.js').ProductionPlan} plan
 * @param {any} project
 * @param {{orders?:Array, marketPrices?:number[]}} [opts]
 * @returns {object}
 */
export function summariseProduction(plan, project, opts = {}) {
  const view = computePlan(plan, project, opts);
  const orders = opts.orders || plan.orders || [];
  const open = openOrders(orders);
  const overdue = open.filter((o) => o.dueDate && String(o.dueDate) < view.plan.startDate);
  const alerts = reorderAlerts(view.inventory);
  const summary = batchSummary(view.batches);
  const pipelineValue = money(sum(open.map((o) => num(o.total))));
  return {
    feasible: view.feasible,
    status: view.plan.status,
    dashboard: view.dashboard,
    batches: { count: summary.count, inProgress: view.batches.filter((b) => b.status === 'in-progress').length, progressPct: summary.progressPct },
    orders: { total: orders.length, open: open.length, overdue: overdue.length, pipelineValue },
    inventory: { reorderAlerts: alerts.length, value: money(view.inventory.stock.reduce((t, s) => t + num(s.quantity) * num(s.unitCost), 0)) },
    qc: { verdict: view.qc.score.verdict, blocking: view.qc.score.blocking.length },
    warnings: view.warnings,
    view
  };
}

/**
 * The version stamp for the Production System, mirrored by the facade's diagnostics so a support
 * ticket can say exactly which build produced a number.
 */
export const PRODUCTION_VERSION = '2.0.0';
