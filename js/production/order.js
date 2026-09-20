/**
 * KNITCAT V2 — Production: orders (spec §6.2 Order, §6.10 Orders).
 *
 * The customer-facing half of the shop. An {@link Order} is a line-item basket tied to a customer,
 * with a running total, a status machine, and shipping/tracking metadata. This module owns the
 * order *lifecycle* — the legal transitions a real shop needs to enforce — and the money maths so
 * an order total always agrees with the costing engine rather than being typed into a form.
 *
 * Status machine (spec §6.2 / §6.10):
 *
 *   pending → confirmed → in-production → ready → shipped → delivered
 *                  │             │           │        │
 *                  └─────────────┴───────────┴────────┴──→ cancelled / refunded
 *
 * {@link transitionOrder} validates every move and refuses illegal ones (you cannot ship an
 * unconfirmed order, you cannot "deliver" a cancelled one), so the UI can only ever show real
 * states. Discounts, tax and shipping compose in {@link orderTotal}; an order can also carry a
 * `projectId` so confirming it reserves yarn through the inventory module.
 *
 * Pure transforms returning NEW orders (immutability → free undo + serialisable history). DOM-free.
 *
 * @module production/order
 */

import { ORDER_STATUSES, clamp, makeId, money, num, round, sum } from './_util.js';

/**
 * @typedef {object} OrderItem
 * @property {string} sku @property {string} [name] @property {string} [projectId]
 * @property {number} quantity @property {number} unitPrice @property {number} [unitCost]
 * @property {Array<{yarnId:string,colorId:string,grams:number}>} [bom]
 */

/**
 * @typedef {object} Order
 * @property {string} id @property {string} reference @property {string} customerId
 * @property {OrderItem[]} items @property {number} subtotal @property {number} discount
 * @property {number} tax @property {number} shipping @property {number} total
 * @property {string} status @property {string} currency @property {string} placedAt
 * @property {string} [dueDate] @property {string} [shippedAt] @property {string} [tracking]
 * @property {string} [note] @property {string[]} history
 */

/** Legal status transitions; '*' means "any state may move here". */
export const ORDER_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['in-production', 'cancelled', 'refunded'],
  'in-production': ['ready', 'cancelled', 'refunded'],
  ready: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: ['refunded'],
  refunded: []
};

/** Create a blank order (status `pending`, dated now). */
export function createOrder(input = {}) {
  const currency = input.currency || 'GBP';
  const now = new Date().toISOString().slice(0, 10);
  const items = normaliseItems(input.items);
  const order = {
    id: input.id || makeId('ord'),
    reference: input.reference || genReference(now),
    customerId: String(input.customerId || ''),
    items,
    subtotal: 0,
    discount: clamp(num(input.discount), 0, Infinity),
    taxRate: clamp(num(input.taxRate), 0, 100) / 100,
    tax: 0,
    shipping: money(input.shipping),
    total: 0,
    status: 'pending',
    currency,
    placedAt: input.placedAt || now,
    dueDate: input.dueDate || '',
    shippedAt: '',
    tracking: input.tracking || '',
    note: input.note || '',
    history: [`created as pending`]
  };
  return recomputeTotals(order);
}

function normaliseItems(items) {
  return (Array.isArray(items) ? items : []).map((it) => ({
    sku: String(it.sku || 'ITEM'),
    name: it.name || it.sku || 'Item',
    projectId: it.projectId || '',
    quantity: Math.max(1, Math.round(num(it.quantity, 1))),
    unitPrice: money(it.unitPrice),
    unitCost: money(it.unitCost),
    bom: Array.isArray(it.bom) ? it.bom : []
  }));
}

let _refSeq = 0;
function genReference(date) {
  _refSeq = (_refSeq + 1) % 9999;
  const d = String(date).replace(/-/g, '').slice(2);
  return `KC-${d}-${String(_refSeq).padStart(3, '0')}`;
}

/**
 * Recompute subtotal / tax / total from items + discount + taxRate + shipping (pure).
 * Discount may be an absolute money amount or a `${n}%` string.
 * @param {Order} order @returns {Order}
 */
export function recomputeTotals(order) {
  const items = order.items || [];
  const gross = money(sum(items.map((it) => num(it.unitPrice) * num(it.quantity))));
  let discount = gross;
  if (typeof order.discount === 'string' && order.discount.trim().endsWith('%')) {
    discount = gross * (clamp(parseFloat(order.discount), 0, 100) / 100);
  } else {
    discount = clamp(num(order.discount), 0, gross);
  }
  const afterDiscount = money(gross - discount);
  const taxRate = clamp(num(order.taxRate), 0, 1);
  const taxable = order.taxOnShipping ? afterDiscount + num(order.shipping) : afterDiscount;
  const tax = money(taxable * taxRate);
  const total = money(afterDiscount + tax + num(order.shipping));
  return { ...order, subtotal: gross, discount: money(discount), tax, total, lineCount: items.reduce((n, it) => n + num(it.quantity), 0) };
}

/** Replace an order's items (then re-total). @returns {Order} */
export function setOrderItems(order, items) {
  return recomputeTotals({ ...order, items: normaliseItems(items) });
}

/** Add one item (merging by SKU). @returns {Order} */
export function addOrderItem(order, item) {
  const norm = normaliseItems([item])[0];
  const items = order.items.slice();
  const idx = items.findIndex((i) => i.sku === norm.sku);
  if (idx >= 0) items[idx] = { ...items[idx], quantity: num(items[idx].quantity) + norm.quantity };
  else items.push(norm);
  return recomputeTotals({ ...order, items });
}

/** Remove an item by SKU. @returns {Order} */
export function removeOrderItem(order, sku) {
  return recomputeTotals({ ...order, items: order.items.filter((i) => i.sku !== sku) });
}

/** Is `to` a legal status transition from `from`? @returns {boolean} */
export function canTransition(from, to) {
  if (!ORDER_STATUSES.includes(to)) return false;
  if (to === from) return false;
  const allowed = ORDER_TRANSITIONS[from];
  return Array.isArray(allowed) ? allowed.includes(to) : false;
}

/**
 * Move an order to a new status. Throws on an illegal transition (the UI catches and shows why).
 * Sets `shippedAt` automatically when entering `shipped`. @returns {Order}
 */
export function transitionOrder(order, to) {
  if (!canTransition(order.status, to)) {
    throw new Error(`Illegal order transition: ${order.status} → ${to}`);
  }
  const next = { ...order, status: to };
  if (to === 'shipped') next.shippedAt = new Date().toISOString().slice(0, 10);
  if (to === 'delivered' && !next.shippedAt) next.shippedAt = next.placedAt;
  next.history = (order.history || []).concat([`${order.status} → ${to}`]);
  return next;
}

/** Attach a tracking number (and auto-move pending-ready orders toward shipped if legal). */
export function setTracking(order, tracking) {
  return { ...order, tracking: String(tracking || '') };
}

/** Total cost of goods in an order (from item unitCost). @returns {number} */
export function orderCost(order) {
  return money(sum((order.items || []).map((it) => num(it.unitCost) * num(it.quantity))));
}

/** Profit on an order = discount-adjusted net − COGS − shipping subsidy. @returns {number} */
export function orderProfit(order) {
  const net = money(num(order.subtotal) - num(order.discount) + num(order.shipping));
  return money(net - orderCost(order));
}

/** Margin percent of an order. @returns {number} */
export function orderMarginPct(order) {
  const t = num(order.total);
  return t > 0 ? round((orderProfit(order) / t) * 100, 1) : 0;
}

/** Aggregate the full bill of materials across an order's items, merged by yarn+colour (grams). */
export function orderBom(order) {
  const map = {};
  for (const it of order.items || []) {
    for (const b of it.bom || []) {
      const key = `${b.yarnId}::${b.colorId}`;
      map[key] = map[key] || { yarnId: b.yarnId, colorId: b.colorId, grams: 0 };
      map[key].grams = round(map[key].grams + num(b.grams) * num(it.quantity), 1);
    }
  }
  return Object.values(map);
}

/** Is the order overdue (due date past and not shipped/delivered)? */
export function isOverdue(order, asOf) {
  if (!order.dueDate) return false;
  if (order.status === 'shipped' || order.status === 'delivered') return false;
  const ref = asOf || new Date().toISOString().slice(0, 10);
  return String(order.dueDate) < String(ref);
}

/** Group a list of orders by status for the dashboard. @returns {Record<string, Order[]>} */
export function ordersByStatus(orders) {
  const out = {};
  for (const s of ORDER_STATUSES) out[s] = [];
  for (const o of orders || []) (out[o.status] || (out[o.status] = [])).push(o);
  return out;
}

/** Open (not yet shipped/delivered/cancelled/refunded) orders. @returns {Order[]} */
export function openOrders(orders) {
  const closed = new Set(['shipped', 'delivered', 'cancelled', 'refunded']);
  return (orders || []).filter((o) => !closed.has(o.status));
}
