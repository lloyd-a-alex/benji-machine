/**
 * KNITCAT V2 — Production: inventory (spec §6.6).
 *
 * Two inventories a selling knitter actually has to run, unified behind one store:
 *
 *   1. **Raw stock** — cones/skeins of yarn on the shelf, keyed by `yarnId + colorId`, with a
 *      quantity, a reserved count (committed to open orders but not yet consumed) and a derived
 *      `available`. Reorder alerts fire when available dips under a per-line reorder point.
 *   2. **Finished goods** — completed pieces ready to ship, keyed by SKU, with quantity, location,
 *      unit cost, price, sold count and margin. This is the "what can I ship today" board.
 *
 * The point of doing this in code, not a spreadsheet, is *reservation integrity*: when an order is
 * confirmed, {@link reserveStock} locks the yarn a batch will consume so a second order can't
 * double-book the last cone; when the batch runs, {@link consumeStock} turns reserved→used; if an
 * order is cancelled, {@link releaseReservation} gives it back. Every one of these is a pure
 * transform returning a new store, so the timesheet/order flow can keep prior snapshots for undo
 * and the test battery can pin the invariants (never negative, available = quantity − reserved).
 *
 * All amounts are grams for yarn (matching the Yarn Lab's stash units) and integers for finished
 * goods. DOM-free.
 *
 * @module production/inventory
 */

import { clamp, makeSku, money, num, round, sum, titleCase } from './_util.js';

/**
 * @typedef {object} StockLine
 * @property {string} id @property {string} yarnId @property {string} colorId
 * @property {string} [name] @property {number} quantity grams on hand
 * @property {number} reserved grams committed to open work
 * @property {number} available quantity − reserved (>= 0)
 * @property {number} reorderPoint grams; alert when available drops below
 * @property {number} [unitCost] per gram
 * @property {string} [location] @property {string} [supplier]
 */

/**
 * @typedef {object} FinishedGood
 * @property {string} sku @property {string} [name] @property {string} [projectId]
 * @property {number} quantity @property {number} sold @property {number} onHand quantity − sold
 * @property {string} location @property {number} unitCost @property {number} price
 * @property {number} unitMargin @property {number} value onHand × unitCost
 */

/**
 * @typedef {object} Inventory
 * @property {StockLine[]} stock
 * @property {FinishedGood[]} finished
 * @property {Object<string, Array<{orderId:string, yarnId:string, colorId:string, grams:number}}>} reservations
 */

/** Create an empty inventory. @returns {Inventory} */
export function createInventory() {
  return { stock: [], finished: [], reservations: {} };
}

function stockId(yarnId, colorId) {
  return `${yarnId}::${colorId}`;
}

/**
 * Add or update a raw-stock line (idempotent on yarnId+colorId). @returns {Inventory}
 */
export function upsertStock(inv, line = {}) {
  const yarnId = String(line.yarnId || '');
  const colorId = String(line.colorId || '');
  if (!yarnId) return inv;
  const id = stockId(yarnId, colorId);
  const quantity = Math.max(0, num(line.quantity));
  const reserved = clamp(num(line.reserved), 0, quantity);
  const next = {
    id,
    yarnId,
    colorId,
    name: line.name || `${titleCase(yarnId)} ${titleCase(colorId)}`.trim(),
    quantity,
    reserved,
    available: round(quantity - reserved, 2),
    reorderPoint: Math.max(0, num(line.reorderPoint)),
    unitCost: num(line.unitCost),
    location: line.location || 'shelf',
    supplier: line.supplier || ''
  };
  const idx = inv.stock.findIndex((s) => s.id === id);
  const stock = inv.stock.slice();
  if (idx >= 0) stock[idx] = Object.assign({}, stock[idx], next, { reserved: stock[idx].reserved }); // keep live reservations
  else stock.push(next);
  // Recompute available for the kept line.
  return { ...inv, stock: stock.map(recomputeAvailable) };
}

function recomputeAvailable(line) {
  const reserved = clamp(num(line.reserved), 0, num(line.quantity));
  return { ...line, reserved, available: round(num(line.quantity) - reserved, 2) };
}

/**
 * Adjust the on-hand quantity of a stock line by a delta (e.g. a restock or a mistake).
 * @returns {Inventory}
 */
export function adjustStock(inv, yarnId, colorId, deltaGrams) {
  const id = stockId(yarnId, colorId);
  return {
    ...inv,
    stock: inv.stock
      .map((s) => (s.id === id ? recomputeAvailable({ ...s, quantity: Math.max(0, num(s.quantity) + num(deltaGrams)) }) : s))
  };
}

/**
 * Reserve `grams` of a specific yarn+colour for an order. Returns a NEW inventory; if there isn't
 * enough available, it reserves as much as possible and reports the shortfall.
 * @param {Inventory} inv
 * @param {{orderId:string, items:Array<{yarnId:string, colorId:string, grams:number}>}} req
 * @returns {{inventory:Inventory, reserved:boolean, shortfall:Array}}
 */
export function reserveStock(inv, req = {}) {
  const orderId = String(req.orderId || '');
  const items = Array.isArray(req.items) ? req.items : [];
  let stock = inv.stock.slice();
  const reservations = { ...inv.reservations };
  const list = (reservations[orderId] || []).slice();
  const shortfall = [];
  let fullyReserved = true;

  for (const it of items) {
    if (!it || typeof it !== 'object') continue; // a null / primitive item is skipped, not crashed on
    const id = stockId(it.yarnId, it.colorId);
    const want = Math.max(0, num(it.grams));
    if (want === 0) continue;
    const idx = stock.findIndex((s) => s.id === id);
    const have = idx >= 0 ? num(stock[idx].available) : 0;
    const take = Math.min(have, want);
    if (take < want) {
      fullyReserved = false;
      shortfall.push({ yarnId: it.yarnId, colorId: it.colorId, want, got: take, missing: round(want - take, 2) });
    }
    if (take > 0) {
      if (idx >= 0) stock[idx] = recomputeAvailable({ ...stock[idx], reserved: num(stock[idx].reserved) + take });
      list.push({ orderId, yarnId: it.yarnId, colorId: it.colorId, grams: take });
    }
  }
  if (list.length) reservations[orderId] = list;
  return { inventory: { ...inv, stock, reservations }, reserved: fullyReserved, shortfall };
}

/** Give back every reservation held for an order (cancellation / re-plan). @returns {Inventory} */
export function releaseReservation(inv, orderId) {
  const held = (inv.reservations[orderId] || []).slice();
  if (!held.length) return inv;
  let stock = inv.stock.slice();
  for (const r of held) {
    const id = stockId(r.yarnId, r.colorId);
    const idx = stock.findIndex((s) => s.id === id);
    if (idx >= 0) stock[idx] = recomputeAvailable({ ...stock[idx], reserved: Math.max(0, num(stock[idx].reserved) - num(r.grams)) });
  }
  const reservations = { ...inv.reservations };
  delete reservations[orderId];
  return { ...inv, stock, reservations };
}

/**
 * Consume a batch: turn reserved grams for an order into used grams (quantity drops, reserved
 * drops), reflecting yarn physically knitted. Also accepts direct consumption with no prior
 * reservation (a personal project). @returns {{inventory:Inventory, consumed:number, missing:number}}
 */
export function consumeStock(inv, req = {}) {
  const orderId = String(req.orderId || '');
  const items = Array.isArray(req.items) ? req.items : [];
  let stock = inv.stock.slice();
  const reservations = { ...inv.reservations };
  let held = (reservations[orderId] || []).slice();
  let consumed = 0;
  let missing = 0;

  for (const it of items) {
    if (!it || typeof it !== 'object') continue; // a null / primitive item is skipped, not crashed on
    const id = stockId(it.yarnId, it.colorId);
    const want = Math.max(0, num(it.grams));
    const idx = stock.findIndex((s) => s.id === id);
    if (idx < 0) { missing += want; continue; }
    const line = stock[idx];
    // Prefer releasing from this order's reservation, then take from free stock.
    let fromReservation = 0;
    const ri = held.findIndex((h) => h.yarnId === it.yarnId && h.colorId === it.colorId && h.grams > 0);
    if (ri >= 0) {
      fromReservation = Math.min(held[ri].grams, want);
      held[ri] = { ...held[ri], grams: round(held[ri].grams - fromReservation, 2) };
    }
    const fromFree = Math.min(num(line.available), want - fromReservation);
    const total = round(fromReservation + fromFree, 2);
    const newQty = Math.max(0, round(num(line.quantity) - total, 2));
    const newReserved = Math.max(0, round(num(line.reserved) - fromReservation, 2));
    stock[idx] = { ...line, quantity: newQty, reserved: newReserved, available: round(newQty - newReserved, 2) };
    consumed += total;
    missing += Math.max(0, round(want - total, 2));
  }
  held = held.filter((h) => h.grams > 0.001);
  if (held.length) reservations[orderId] = held;
  else delete reservations[orderId];
  return { inventory: { ...inv, stock, reservations }, consumed: round(consumed, 2), missing: round(missing, 2) };
}

/** Every stock line whose available is at/under its reorder point (and quantity > 0 or reorderPoint > 0). @returns {StockLine[]} */
export function reorderAlerts(inv) {
  return (inv.stock || []).filter((s) => num(s.reorderPoint) > 0 && num(s.available) <= num(s.reorderPoint));
}

/** Total raw-stock value at unit cost. @returns {number} */
export function stockValue(inv) {
  return money(sum((inv.stock || []).map((s) => num(s.quantity) * num(s.unitCost))));
}

/** Add or update a finished-goods line (idempotent on SKU). @returns {Inventory} */
export function upsertFinished(inv, good = {}) {
  const sku = String(good.sku || makeSku(good.name || 'item', good.size || ''));
  const quantity = Math.max(0, Math.round(num(good.quantity)));
  const sold = clamp(Math.round(num(good.sold)), 0, quantity);
  const unitCost = num(good.unitCost);
  const price = num(good.price);
  const next = {
    sku,
    name: good.name || titleCase(sku),
    projectId: good.projectId || '',
    quantity,
    sold,
    onHand: quantity - sold,
    location: good.location || 'shelf',
    unitCost,
    price,
    unitMargin: round(price - unitCost, 2),
    value: round((quantity - sold) * unitCost, 2)
  };
  const idx = inv.finished.findIndex((f) => f.sku === sku);
  const finished = inv.finished.slice();
  if (idx >= 0) finished[idx] = Object.assign({}, finished[idx], next);
  else finished.push(next);
  return { ...inv, finished };
}

/** Record `count` units of a SKU sold (moves quantity→sold, never below 0 on-hand). @returns {Inventory} */
export function sellFinished(inv, sku, count = 1) {
  return {
    ...inv,
    finished: inv.finished.map((f) => {
      if (f.sku !== sku) return f;
      const sold = clamp(Math.round(num(f.sold) + num(count)), 0, num(f.quantity));
      return { ...f, sold, onHand: num(f.quantity) - sold, value: round((num(f.quantity) - sold) * num(f.unitCost), 2) };
    })
  };
}

/** Finished-goods ready to ship (onHand > 0). @returns {FinishedGood[]} */
export function availableFinished(inv) {
  return (inv.finished || []).filter((f) => num(f.onHand) > 0);
}

/** Total finished-goods retail value on hand. @returns {number} */
export function finishedRetailValue(inv) {
  return money(sum((inv.finished || []).map((f) => num(f.onHand) * num(f.price))));
}

/** Total finished-goods cost value on hand. @returns {number} */
export function finishedCostValue(inv) {
  return money(sum((inv.finished || []).map((f) => num(f.onHand) * num(f.unitCost))));
}

/**
 * Check whether a bill of materials (list of {yarnId,colorId,grams}) is satisfiable from stock,
 * without mutating anything. Used by the batch planner and the order confirmations.
 * @param {Inventory} inv @param {Array<{yarnId:string,colorId:string,grams:number}>} bom
 * @returns {{sufficient:boolean, shortages:Array}}
 */
export function checkStockForBom(inv, bom = []) {
  const need = {};
  for (const item of bom) {
    const id = stockId(item.yarnId, item.colorId);
    need[id] = round((need[id] || 0) + num(item.grams), 2);
  }
  const shortages = [];
  for (const [id, want] of Object.entries(need)) {
    const line = (inv.stock || []).find((s) => s.id === id);
    const have = line ? num(line.available) : 0;
    if (have < want) shortages.push({ id, want, have, missing: round(want - have, 2) });
  }
  return { sufficient: shortages.length === 0, shortages };
}
