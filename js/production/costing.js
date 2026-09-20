/**
 * KNITCAT V2 — Production: costing (spec §6.4).
 *
 * Turns a Project (and a chosen labour rate / markup / quantity) into an honest, itemised cost
 * model — the spreadsheet a selling knitter keeps losing in a notebook. The Compiler's
 * `manufacturing` backend already emits a coarse roll-up; this module is the *authoritative,
 * reusable* costing engine the whole Production system (and the Compiler) reads from, so a price
 * quoted in an order, a batch plan and a dashboard is always the same number.
 *
 * A cost is built from five independent buckets, each traceable to a Project node or an explicit
 * override so nothing is a magic number:
 *
 *   1. **Yarn** — `cost.yarn` from the graph, or a manual per-unit yardage × price-per-100m,
 *      with a configurable wastage allowance (knitters always run short).
 *   2. **Labour** — `time.totalHours` (which itself comes from stitch count ÷ throughput +
 *      finishing) × an hourly rate, optionally with a learning-curve discount for repeat units in
 *      a batch (unit N takes rate × N^(b-1), the Wright learning model — see time.js).
 *   3. **Materials** — notions, labels, packaging, `cost.materials`.
 *   4. **Overhead** — `cost.overhead`, or a % of the running cost, or a per-unit flat.
 *   5. **Quantity** — everything scales; per-unit vs. batch totals are both reported.
 *
 * Then the selling maths: total cost, per-unit cost, suggested price (markup or target-margin),
 * profit, margin %, break-even at a market price, and a wholesale price (a fraction of retail).
 *
 * Everything is a pure function of its inputs — feed the same Project + options twice and you get
 * the same Costing. DOM-free.
 *
 * @module production/costing
 */

import { money, nodeNum, num, round, sum, clamp } from './_util.js';

/**
 * @typedef {object} Costing
 * @property {number} quantity
 * @property {string} currency
 * @property {{yarn:number, labour:number, materials:number, overhead:number}} perUnit itemised unit cost
 * @property {{yarn:number, labour:number, materials:number, overhead:number, total:number}} batch batch totals
 * @property {number} unitCost total cost for one piece
 * @property {number} totalCost cost for the whole batch
 * @property {number} labourRate hourly rate actually used
 * @property {number} markup multiplier used for the suggested price
 * @property {number} suggestedPrice retail price per unit
 * @property {number} wholesalePrice per-unit wholesale price
 * @property {number} profit per-unit profit at the suggested price
 * @property {number} marginPct per-unit profit as % of price
 * @property {number} breakEvenUnits units to sell to cover a one-off setup cost
 * @property {CostBreakdown[]} breakdown per-line traceability
 * @property {string[]} warnings things that look wrong (zero yarn, negative margin, …)
 */

/**
 * @typedef {object} CostBreakdown
 * @property {string} key
 * @property {string} label
 * @property {number} perUnit
 * @property {number} total
 * @property {string} basis where the number came from (a node id or an override)
 */

/** Default retail markup when the Project doesn't specify one (matches cost-nodes DEFAULT_MARKUP). */
export const DEFAULT_MARKUP = 2.4;
/** Default fraction of the retail price a wholesaler pays. */
export const DEFAULT_WHOLESALE_FACTOR = 0.5;
/** Default yarn wastage allowance as a fraction (10% extra for swatching, joins, mistakes). */
export const DEFAULT_WASTAGE = 0.1;

/**
 * Build a full costing for a Project.
 *
 * @param {any} project a live Project (reads cost/time nodes) or a plain snapshot
 * @param {{
 *   quantity?:number, currency?:string, labourRate?:number, markup?:number,
 *   targetMarginPct?:number, wholesaleFactor?:number, wastagePct?:number,
 *   materials?:number, overhead?:number, overheadPct?:number,
 *   setupCost?:number, learningCurve?:number, unitYardage?:number, yarnPricePer100m?:number,
 *   hoursPerUnit?:number, retailPrice?:number
 * }} [options]
 * @returns {Costing}
 */
export function buildCosting(project, options = {}) {
  const warnings = [];
  const breakdown = [];
  const quantity = Math.max(1, Math.round(num(options.quantity, 1)));
  const currency = options.currency || 'GBP';
  const wastage = clamp(num(options.wastagePct, DEFAULT_WASTAGE * 100), 0, 100) / 100;

  // ---- Yarn --------------------------------------------------------------
  // Prefer an explicit yardage × price quote; otherwise read the graph's yarn cost.
  let yarnPerUnit;
  let yarnBasis;
  if (options.unitYardage != null && options.yarnPricePer100m != null) {
    yarnPerUnit = (num(options.unitYardage) * (1 + wastage) * num(options.yarnPricePer100m)) / 100;
    yarnBasis = `override: ${num(options.unitYardage)}m × ${num(options.yarnPricePer100m)}/100m ×(1+${round(wastage * 100, 0)}% waste)`;
  } else {
    yarnPerUnit = nodeNum(project, 'cost.yarn', 0);
    yarnBasis = 'cost.yarn';
    if (yarnPerUnit > 0) yarnPerUnit *= 1 + wastage; // graph yarn has no wastage allowance baked in
  }
  yarnPerUnit = money(yarnPerUnit);
  if (yarnPerUnit <= 0) warnings.push('No yarn cost — assign a yarn with a price (or set unitYardage + yarnPricePer100m).');
  breakdown.push({ key: 'yarn', label: 'Yarn', perUnit: yarnPerUnit, total: money(yarnPerUnit * quantity), basis: yarnBasis });

  // ---- Labour ------------------------------------------------------------
  const hours = num(options.hoursPerUnit, nodeNum(project, 'time.totalHours', 0));
  const rate = num(options.labourRate, nodeNum(project, 'cost.labourRate', nodeNum(project, 'cost.labourRate', 12) || 12));
  const labourPerUnit = money(hours * rate);
  // Learning curve: for a batch of `quantity`, total labour is sum of unit_i cost. With rate
  // exponent b (0 = no learning, negative = faster over time), unit i costs base × i^b.
  const lcExp = options.learningCurve == null ? 0 : clamp(num(options.learningCurve), -1, 0);
  const labourTotal = money(applyLearningCurve(labourPerUnit, quantity, lcExp));
  const labourBasis = `time.totalHours(${round(hours, 2)}h) × rate(${money(rate)})${lcExp < 0 ? ' × learning ' + round(lcExp, 3) : ''}`;
  if (hours <= 0) warnings.push('No time estimate — cost the piece with hoursPerUnit or set gauge/rows.');
  breakdown.push({ key: 'labour', label: 'Labour', perUnit: labourPerUnit, total: labourTotal, basis: labourBasis });

  // ---- Materials ---------------------------------------------------------
  const materialsPerUnit = money(options.materials != null ? num(options.materials) : nodeNum(project, 'cost.materials', 0));
  breakdown.push({ key: 'materials', label: 'Materials', perUnit: materialsPerUnit, total: money(materialsPerUnit * quantity), basis: options.materials != null ? 'override' : 'cost.materials' });

  // ---- Overhead ----------------------------------------------------------
  let overheadPerUnit;
  let overheadBasis;
  if (options.overheadPct != null) {
    const running = yarnPerUnit + labourPerUnit + materialsPerUnit;
    overheadPerUnit = running * (clamp(num(options.overheadPct), 0, 500) / 100);
    overheadBasis = `${num(options.overheadPct)}% of running cost`;
  } else {
    overheadPerUnit = options.overhead != null ? num(options.overhead) : nodeNum(project, 'cost.overhead', 0);
    overheadBasis = options.overhead != null ? 'override' : 'cost.overhead';
  }
  overheadPerUnit = money(overheadPerUnit);
  breakdown.push({ key: 'overhead', label: 'Overhead', perUnit: overheadPerUnit, total: money(overheadPerUnit * quantity), basis: overheadBasis });

  // ---- Roll-up -----------------------------------------------------------
  const perUnit = { yarn: yarnPerUnit, labour: labourPerUnit, materials: materialsPerUnit, overhead: overheadPerUnit };
  const unitCost = money(sum(Object.values(perUnit)));
  const batch = {
    yarn: money(yarnPerUnit * quantity),
    labour: labourTotal,
    materials: money(materialsPerUnit * quantity),
    overhead: money(overheadPerUnit * quantity),
  };
  batch.total = money(sum(Object.values(batch)));
  const totalCost = money(batch.total);

  // ---- Pricing -----------------------------------------------------------
  const markup = num(options.markup, nodeNum(project, 'cost.markup', DEFAULT_MARKUP) || DEFAULT_MARKUP);
  const wholesaleFactor = clamp(num(options.wholesaleFactor, DEFAULT_WHOLESALE_FACTOR), 0.05, 1);
  let suggestedPrice;
  if (options.targetMarginPct != null) {
    // Price so that profit/price = target margin:  p = cost / (1 - m).
    const m = clamp(num(options.targetMarginPct), 0, 95) / 100;
    suggestedPrice = m >= 1 ? unitCost : money(unitCost / (1 - m));
  } else {
    suggestedPrice = money(options.retailPrice != null ? num(options.retailPrice) : unitCost * markup);
  }
  const wholesalePrice = money(suggestedPrice * wholesaleFactor);
  const profit = money(suggestedPrice - unitCost);
  const marginPct = suggestedPrice > 0 ? round((profit / suggestedPrice) * 100, 1) : 0;
  if (profit <= 0) warnings.push(`Suggested price (${money(suggestedPrice)}) does not clear unit cost (${money(unitCost)}) — you would lose money.`);

  const setupCost = money(options.setupCost != null ? num(options.setupCost) : 0);
  const contribution = suggestedPrice - unitCost;
  const breakEvenUnits = contribution > 0 && setupCost > 0 ? Math.ceil(setupCost / contribution) : 0;

  return {
    quantity,
    currency,
    perUnit,
    batch,
    unitCost,
    totalCost,
    labourRate: money(rate),
    markup: round(markup, 2),
    suggestedPrice,
    wholesalePrice,
    profit,
    marginPct,
    breakEvenUnits,
    setupCost,
    learningCurve: lcExp,
    breakdown,
    warnings,
  };
}

/**
 * Wright learning-curve total for `quantity` units at `baseCost` for the first unit.
 * Cumulative-average model: total = baseCost × Σ i^b for i=1..n. b=0 → linear (n × base).
 * @param {number} baseCost @param {number} quantity @param {number} exponent ≤ 0
 * @returns {number}
 */
export function applyLearningCurve(baseCost, quantity, exponent = 0) {
  const base = num(baseCost);
  const n = Math.max(0, Math.round(num(quantity)));
  const b = clamp(num(exponent, 0), -1, 0);
  if (b === 0 || n <= 1) return money(base * n);
  let total = 0;
  for (let i = 1; i <= n; i++) total += Math.pow(i, b);
  return money(base * total);
}

/**
 * The effective average cost of unit `index` (1-based) under a learning curve — used to price a
 * specific position in a batch and to show "the 10th one is cheaper than the 1st".
 * @param {number} baseUnitCost @param {number} index @param {number} exponent
 * @returns {number}
 */
export function unitCostAt(baseUnitCost, index, exponent = 0) {
  return money(num(baseUnitCost) * Math.pow(Math.max(1, num(index, 1)), clamp(num(exponent, 0), -1, 0)));
}

/**
 * Recompute just the pricing line for an existing costing (e.g. after the maker overrides the
 * price) without rebuilding the whole cost model. Pure.
 * @param {Costing} costing @param {{price:number, wholesaleFactor?:number}} patch
 * @returns {Costing} a shallow-updated costing
 */
export function repricing(costing, patch = {}) {
  const price = money(patch.price != null ? patch.price : costing.suggestedPrice);
  const wf = clamp(num(patch.wholesaleFactor, DEFAULT_WHOLESALE_FACTOR), 0.05, 1);
  const profit = money(price - costing.unitCost);
  return Object.assign({}, costing, {
    suggestedPrice: price,
    wholesalePrice: money(price * wf),
    profit,
    marginPct: price > 0 ? round((profit / price) * 100, 1) : 0,
  });
}

/** Compare our costing against a market reference price. @returns {{delta:number, deltaPct:number, verdict:string}} */
export function compareMarket(costing, marketPrice) {
  const ours = num(costing && costing.suggestedPrice);
  const theirs = money(marketPrice);
  const delta = money(ours - theirs);
  const deltaPct = theirs > 0 ? round((delta / theirs) * 100, 1) : 0;
  const verdict = deltaPct < -15 ? 'underpriced' : deltaPct > 15 ? 'overpriced' : 'in-line';
  return { ours, theirs, delta, deltaPct, verdict };
}
