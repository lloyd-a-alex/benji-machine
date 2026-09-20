/**
 * KNITCAT V2 — Production: customers (spec §6.10 Customers).
 *
 * A tiny CRM. A customer is who an order bills to; the value is in the *derived* stats the shop
 * owner actually wants — lifetime value, order count, average basket, last order date, favourite
 * colours (inferred from the yarn in their orders) and an RFM segment (recency / frequency /
 * monetary) that tells you who to email before a drop. Everything is computed from a list of
 * orders, so there is no separate source of truth to fall out of sync: {@link customerStats} is a
 * pure fold over that customer's orders.
 *
 * DOM-free; deterministic given the same customers + orders.
 *
 * @module production/customer
 */

import { ORDER_STATUSES, daysBetween, makeId, money, num, round, sum, titleCase } from './_util.js';

/**
 * @typedef {object} Customer
 * @property {string} id @property {string} [name] @property {string} [email]
 * @property {string} [phone] @property {string} [address] @property {string} [notes]
 * @property {string} [source] @property {Object<string,string>} [tags]
 * @property {string} createdAt
 */

/**
 * @typedef {object} CustomerStats
 * @property {string} customerId @property {number} orders @property {number} revenue
 * @property {number} profit @property {number} avgOrder @property {string} firstOrder
 * @property {string} lastOrder @property {number} daysSinceLast @property {boolean} repeat
 * @property {string} segment @property {Object<string,number>} favouriteColours
 */

/** Create a blank customer record. @returns {Customer} */
export function createCustomer(input = {}) {
  return {
    id: input.id || makeId('cus'),
    name: input.name || 'Unnamed',
    email: input.email || '',
    phone: input.phone || '',
    address: input.address || '',
    notes: input.notes || '',
    source: input.source || 'direct',
    tags: input.tags && typeof input.tags === 'object' ? input.tags : {},
    createdAt: input.createdAt || new Date().toISOString().slice(0, 10)
  };
}

/** Orders belonging to a customer, newest first by placedAt. @returns {import('./order.js').Order[]} */
export function ordersFor(orders, customerId) {
  return (orders || []).filter((o) => String(o.customerId) === String(customerId)).sort((a, b) => String(b.placedAt).localeCompare(String(a.placedAt)));
}

/**
 * Fold a customer's orders into stats: revenue, profit, basket size, recency and an RFM segment.
 * @param {Array} orders all known orders @param {string} customerId @param {{asOf?:string, revenueStatuses?:string[]}} [opts]
 * @returns {CustomerStats}
 */
export function customerStats(orders, customerId, opts = {}) {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  // A "revenue" order is one that will actually be paid (not cancelled/refunded).
  const revenueStatuses = opts.revenueStatuses || ORDER_STATUSES.filter((s) => s !== 'cancelled' && s !== 'refunded');
  const isRevenue = new Set(revenueStatuses);
  const mine = ordersFor(orders, customerId);
  const paid = mine.filter((o) => isRevenue.has(o.status));

  const revenue = money(sum(paid.map((o) => num(o.total))));
  const cost = money(sum(paid.map((o) => orderCostOf(o))));
  const profit = money(revenue - cost);
  const avgOrder = paid.length ? money(revenue / paid.length) : 0;
  const dates = paid.map((o) => o.placedAt).filter(Boolean).sort();
  const firstOrder = dates[0] || '';
  const lastOrder = dates[dates.length - 1] || '';
  const daysSinceLast = lastOrder ? daysBetween(lastOrder, asOf) : Infinity;

  const colours = {};
  for (const o of paid) {
    for (const it of o.items || []) {
      for (const b of it.bom || []) {
        if (b.colorId) colours[b.colorId] = round((colours[b.colorId] || 0) + num(b.grams), 1);
      }
    }
  }

  return {
    customerId: String(customerId),
    orders: paid.length,
    revenue,
    profit,
    avgOrder,
    firstOrder,
    lastOrder,
    daysSinceLast: Number.isFinite(daysSinceLast) ? daysSinceLast : -1,
    repeat: paid.length > 1,
    favouriteColours: colours,
    segment: segment({ orders: paid.length, daysSinceLast, revenue })
  };
}

function orderCostOf(o) {
  return sum((o.items || []).map((it) => num(it.unitCost) * num(it.quantity)));
}

/**
 * Simple RFM segmentation into shop-owner language.
 * @returns {'new'|'regular'|'vip'|'lapsed'|'at-risk'|'one-and-done'}
 */
export function segment({ orders = 0, daysSinceLast = 999, revenue = 0 }) {
  const recent = daysSinceLast <= 60;
  const active = daysSinceLast <= 180;
  if (orders >= 4 && recent) return 'vip';
  if (orders >= 2 && active) return 'regular';
  if (orders >= 2 && !active) return 'at-risk';
  if (orders === 1 && recent) return 'new';
  if (orders === 1 && !recent) return 'one-and-done';
  if (orders === 0) return 'new';
  return 'lapsed';
}

/** Rank customers by lifetime revenue. @returns {CustomerStats[]} */
export function topCustomers(orders, customers, limit = 10) {
  const ids = new Set((customers || []).map((c) => c.id));
  for (const o of orders || []) if (o.customerId) ids.add(o.customerId);
  const stats = [...ids].map((id) => customerStats(orders, id));
  return stats.sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

/** Customers likely to churn (bought before, nothing in `days`). @returns {CustomerStats[]} */
export function atRiskCustomers(orders, customers, days = 120) {
  const stats = (customers || []).map((c) => customerStats(orders, c.id));
  return stats.filter((s) => s.orders > 0 && s.daysSinceLast > days);
}

/** De-duplicate and enrich a customer list; keeps first-seen fields, refreshes on merge. @returns {Customer[]} */
export function mergeCustomers(existing, incoming) {
  const map = new Map();
  for (const c of existing || []) if (c && c.id) map.set(c.id, { ...createCustomer(c) });
  for (const c of incoming || []) {
    if (!c) continue;
    const id = c.id || makeId('cus');
    const prev = map.get(id);
    map.set(id, prev ? { ...prev, ...strip(c), id } : createCustomer({ ...c, id }));
  }
  return [...map.values()];
}

function strip(c) {
  const { id, ...rest } = c;
  return rest;
}

/** A readable "Jane — 3 orders, £240, VIP" line. */
export function customerLine(customer, stats) {
  const name = (customer && customer.name) || titleCase(stats.customerId) || 'Customer';
  return `${name} — ${stats.orders} order${stats.orders === 1 ? '' : 's'}, ${money(stats.revenue)}, ${stats.segment}`;
}
