/**
 * KNITCAT V2 — Production: pricing (spec §6.8).
 *
 * The pricing calculator a maker actually needs to not sell themselves short: cost-plus, target
 * margin, wholesale-vs-retail, market comparison, tiered quantity breaks, and a ladder of discounts
 * that still protects a floor price. It sits on top of {@link buildCosting} (which knows the true
 * unit cost) and answers the questions a shop owner asks out loud:
 *
 *   - "What do I charge?" — {@link priceFromCost} with either a markup or a target-margin model.
 *   - "What's my wholesale price?" — {@link wholesalePrice} (a factor of retail), with the
 *     discipline of a *minimum viable* wholesale so you never sell below cost by accident.
 *   - "Am I priced against the market?" — {@link marketAnalysis} (a full price-band recommendation
 *     from a set of comparable market prices: median, percentile positioning, elasticity hint).
 *   - "What do I give a bulk buyer / a repeat customer / a launch promo?" — {@link applyDiscount}
 *     with a floor so no discount can put you underwater, and {@link quantityBreaks}.
 *
 * All money is two-decimal and half-up; all functions are pure. DOM-free.
 *
 * @module production/pricing
 */

import { DEFAULT_WHOLESALE_FACTOR, DEFAULT_MARKUP } from './costing.js';
import { buildCosting } from './costing.js';
import { clamp, money, num, round, sum } from './_util.js';

/**
 * Compute a selling price from a cost, via markup or a target margin (whichever is given).
 * @param {number|{unitCost:number}} cost a number, or a costing object
 * @param {{markup?:number, targetMarginPct?:number, roundTo?:number}} [opts]
 * @returns {{price:number, model:string}}
 */
export function priceFromCost(cost, opts = {}) {
  const unitCost = typeof cost === 'object' && cost ? num(cost.unitCost) : num(cost);
  let price;
  let model;
  if (opts.targetMarginPct != null) {
    const m = clamp(num(opts.targetMarginPct), 0, 95) / 100;
    price = m >= 1 ? unitCost : unitCost / (1 - m);
    model = `target margin ${round(num(opts.targetMarginPct), 1)}%`;
  } else {
    const mk = num(opts.markup, DEFAULT_MARKUP) || DEFAULT_MARKUP;
    price = unitCost * mk;
    model = `markup ×${round(mk, 2)}`;
  }
  return { price: money(charmRound(price, opts.roundTo)), model };
}

/** Optional psychological rounding: to nearest unit, .50/.99 charm pricing, or raw. */
function charmRound(price, mode) {
  const p = num(price);
  if (mode === 'charm99') return Math.floor(p) + 0.99;
  if (mode === 'charm95') return Math.floor(p) + 0.95;
  if (mode === 'nearest5') return Math.round(p / 5) * 5;
  if (mode === 'nearest') return Math.round(p);
  return money(p);
}

/**
 * Wholesale price from a retail price, floored so it never dips below unit cost + a margin.
 * @param {number} retailPrice @param {number} unitCost @param {{factor?:number, minMarginPct?:number}} [opts]
 * @returns {{wholesale:number, factor:number, floored:boolean}}
 */
export function wholesalePrice(retailPrice, unitCost, opts = {}) {
  const factor = clamp(num(opts.factor, DEFAULT_WHOLESALE_FACTOR), 0.05, 1);
  const raw = num(retailPrice) * factor;
  const floor = num(unitCost) * (1 + clamp(num(opts.minMarginPct, 15), 0, 500) / 100);
  const floored = raw < floor;
  return { wholesale: money(charmRound(floored ? floor : raw, opts.roundTo)), factor, floored };
}

/**
 * Position our price against a set of comparable market prices.
 * @param {number} ourPrice @param {number[]} marketPrices @returns {object}
 */
export function marketAnalysis(ourPrice, marketPrices) {
  const sorted = (marketPrices || []).map((p) => num(p)).filter((p) => p > 0).sort((a, b) => a - b);
  if (!sorted.length) return { available: false, suggested: null, note: 'No market data supplied.' };
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const ours = num(ourPrice);
  // Where does our price sit, 0 (cheapest) .. 1 (priciest)?
  const position = high > low ? clamp((ours - low) / (high - low), 0, 1) : 0.5;
  const recommended = ours < q1 ? 'raise' : ours > q3 ? 'consider-lowering' : 'competitive';
  return {
    available: true,
    low: money(low),
    q1: money(q1),
    median: money(median),
    q3: money(q3),
    high: money(high),
    ours: money(ours),
    positionPct: round(position * 100, 0),
    recommended,
    suggested: money(median),
    note: `You sit at the ${round(position * 100, 0)}th percentile of ${sorted.length} comparables (median ${money(median)}).`
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Apply a discount to a price but never below a floor (unit cost, or cost + min margin).
 * @param {number} price @param {number} unitCost
 * @param {{amountPct?:number, amount?:number, floorPctAboveCost?:number}} [discount]
 * @returns {{final:number, discountAmount:number, floored:boolean, discountPct:number}}
 */
export function applyDiscount(price, unitCost, discount = {}) {
  const base = num(price);
  const cost = num(unitCost);
  const floor = cost * (1 + clamp(num(discount.floorPctAboveCost, 0), 0, 500) / 100);
  let final;
  if (discount.amountPct != null) final = base * (1 - clamp(num(discount.amountPct), 0, 100) / 100);
  else if (discount.amount != null) final = base - clamp(num(discount.amount), 0, base);
  else final = base;
  const floored = final < floor;
  if (floored) final = floor;
  const discountAmount = money(base - final);
  return { final: money(final), discountAmount, floored, discountPct: base > 0 ? round((discountAmount / base) * 100, 1) : 0 };
}

/**
 * Quantity-break schedule: per-unit price that steps down as quantity rises, each tier keeping a
 * minimum margin. Never prices below `unitCost × (1 + minMarginPct)`.
 * @param {number} unitCost @param {number} retailPrice
 * @param {Array<{minQty:number, discountPct:number}>} [tiers]
 * @param {{minMarginPct?:number}} [opts]
 * @returns {Array<{minQty:number, discountPct:number, price:number, marginPct:number, floored:boolean}>}
 */
export function quantityBreaks(unitCost, retailPrice, tiers, opts = {}) {
  const cost = num(unitCost);
  const retail = num(retailPrice);
  const minMargin = clamp(num(opts.minMarginPct, 10), 0, 500) / 100;
  const floor = cost * (1 + minMargin);
  const list = (Array.isArray(tiers) && tiers.length ? tiers : [
    { minQty: 1, discountPct: 0 },
    { minQty: 5, discountPct: 5 },
    { minQty: 10, discountPct: 10 },
    { minQty: 25, discountPct: 15 },
    { minQty: 50, discountPct: 20 }
  ]).slice().sort((a, b) => num(a.minQty) - num(b.minQty));
  return list.map((t) => {
    const raw = retail * (1 - clamp(num(t.discountPct), 0, 100) / 100);
    const floored = raw < floor;
    const price = money(floored ? floor : raw);
    return { minQty: Math.max(1, Math.round(num(t.minQty, 1))), discountPct: num(t.discountPct), price, marginPct: price > 0 ? round(((price - cost) / price) * 100, 1) : 0, floored };
  });
}

/**
 * An end-to-end price recommendation for a Project: cost it, price it three ways, sanity-check the
 * margin, and warn if the result is under water.
 * @param {any} project @param {{quantity?:number, currency?:string, targetMarginPct?:number, marketPrices?:number[]}} [options]
 * @returns {object}
 */
export function recommendPrice(project, options = {}) {
  const costing = buildCosting(project, options);
  const byMarkup = priceFromCost(costing.unitCost, { markup: options.markup != null ? options.markup : costing.markup, roundTo: options.roundTo });
  const byMargin = priceFromCost(costing.unitCost, { targetMarginPct: options.targetMarginPct != null ? options.targetMarginPct : 55, roundTo: options.roundTo });
  const market = options.marketPrices && options.marketPrices.length ? marketAnalysis(byMargin.price, options.marketPrices) : { available: false };
  const wholesale = wholesalePrice(byMarkup.price, costing.unitCost, { factor: options.wholesaleFactor });
  const price = options.targetMarginPct != null ? byMargin.price : byMarkup.price;
  const marginPct = price > 0 ? round(((price - costing.unitCost) / price) * 100, 1) : 0;
  const warnings = [];
  if (price <= costing.unitCost) warnings.push('Recommended price does not clear unit cost.');
  if (marginPct < 30) warnings.push('Margin under 30% — risky once returns/fees are considered.');
  return {
    currency: costing.currency,
    unitCost: costing.unitCost,
    price: money(price),
    byMarkup,
    byMargin,
    wholesale,
    market,
    marginPct,
    profitPerUnit: money(price - costing.unitCost),
    quantityBreaks: quantityBreaks(costing.unitCost, money(price)),
    warnings
  };
}
