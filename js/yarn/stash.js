/**
 * KNITCAT V2 — the stash manager (spec §3.3).
 *
 * The knitter's *physical* yarn: what they own, where it lives, what it cost, how much is
 * left after projects have eaten into it. This is the difference between a yarn database (a
 * catalogue of everything) and a stash (the seven half-balls on the shelf that decide whether
 * this month's project is free or £40). A `StashEntry` references a normalised
 * {@link module:yarn/database.Yarn} plus a chosen colourway and the real-world bookkeeping —
 * quantity, remaining, dye lot, location, price, the projects it has been used in.
 *
 * The behaviours a knitter actually asks of a stash are all here:
 *  - {@link Stash#add} / {@link Stash#addCustom} — get yarn in.
 *  - {@link Stash#deduct} / {@link Stash#useInProject} — consume balls toward a project.
 *  - {@link Stash#shoppingList} — "I want to knit this, what must I buy?"
 *  - {@link Stash#whatCanIMake} — "what is already sitting on my shelf that could do this?"
 *  - {@link Stash#value} / {@link Stash#byWeight} — know what you have.
 *
 * DOM-free and storage-agnostic: `toPlain()`/`Stash.fromPlain()` round-trip through the app's
 * persistence layer; nothing here touches `localStorage` or the network.
 *
 * @module yarn/stash
 */

import { getDefaultDatabase, normalizeYarn, ballsForMeters } from './database.js';
import { deltaE } from './color.js';
void deltaE;

/**
 * @typedef {object} StashEntry
 * @property {string} id
 * @property {object} yarn the normalised {@link module:yarn/database.Yarn}
 * @property {object} color the chosen colourway ({name,hex,code,lab})
 * @property {string} dyeLot
 * @property {number} quantity balls/skeins originally bought
 * @property {number} quantityRemaining balls/skeins left
 * @property {string} location
 * @property {string} acquiredAt ISO date
 * @property {number} price per ball
 * @property {string} currency
 * @property {string[]} photos
 * @property {string} notes
 * @property {string[]} projects project ids this yarn has been used in
 */

let SEQ = 0;
function nextId(prefix) {
  SEQ += 1;
  return `${prefix}-${Date.now().toString(36)}-${SEQ.toString(36)}`;
}

/**
 * The stash. Holds {@link StashEntry} records, indexed by id and grouped by yarn id.
 */
export class Stash {
  /** @param {import('./database.js').YarnDatabase} [db] the registry custom yarns land in. */
  constructor(db = getDefaultDatabase()) {
    /** @type {Map<string,StashEntry>} */
    this.entries = new Map();
    this.db = db;
  }

  get size() { return this.entries.size; }

  /** All entries as an array (insertion order). @returns {StashEntry[]} */
  all() { return [...this.entries.values()]; }

  /**
   * Add a known yarn (from the database) to the stash by picking its colourway.
   * @param {string} yarnId @param {{colorIndex?:number, color?:object, quantity?:number, price?:number, currency?:string, dyeLot?:string, location?:string}} [opts]
   * @returns {StashEntry|null} null when the yarn id is unknown.
   */
  add(yarnId, opts = {}) {
    const yarn = this.db.get(yarnId);
    if (!yarn) return null;
    const color = opts.color || yarn.colors[opts.colorIndex || 0] || { name: 'Natural', hex: '#e8e0d0', lab: { L: 90, a: 0, b: 6 } };
    const quantity = Math.max(0, Number(opts.quantity != null ? opts.quantity : 1));
    const entry = this._makeEntry(yarn, color, quantity, opts);
    this.entries.set(entry.id, entry);
    return entry;
  }

  /**
   * Add a fully custom yarn (not in the database) — it is normalised, registered as a custom
   * yarn, and stashed in one step.
   * @param {object} rawYarn @param {object} [opts] stash options (quantity, price, …)
   * @returns {StashEntry}
   */
  addCustom(rawYarn, opts = {}) {
    const yarn = normalizeYarn(rawYarn, { custom: true });
    if (!this.db.get(yarn.id)) this.db.add(yarn, { custom: true });
    return this.add(yarn.id, Object.assign({ color: rawYarn.color || (yarn.colors && yarn.colors[0]) }, opts));
  }

  /** @private */
  _makeEntry(yarn, color, quantity, opts = {}) {
    return {
      id: opts.id || nextId('stash'),
      yarn,
      color,
      dyeLot: String(opts.dyeLot || ''),
      quantity,
      quantityRemaining: Math.max(0, Number(opts.quantityRemaining != null ? opts.quantityRemaining : quantity)),
      location: String(opts.location || ''),
      acquiredAt: opts.acquiredAt || new Date().toISOString(),
      price: Number(opts.price) || 0,
      currency: opts.currency || '£',
      photos: Array.isArray(opts.photos) ? opts.photos.slice() : [],
      notes: String(opts.notes || ''),
      projects: Array.isArray(opts.projects) ? opts.projects.slice() : []
    };
  }

  /** Update mutable fields on an existing entry. @returns {StashEntry|null} */
  update(id, patch = {}) {
    const e = this.entries.get(id);
    if (!e) return null;
    Object.assign(e, patch);
    if (patch.quantity != null) e.quantity = Math.max(0, Number(patch.quantity) || 0);
    if (patch.quantityRemaining != null) e.quantityRemaining = clamp(e.quantityRemaining, 0, e.quantity);
    this.entries.set(id, e);
    return e;
  }

  /** Remove an entry entirely. @returns {boolean} */
  remove(id) { return this.entries.delete(id); }

  /** Add balls back (un-knit, counted wrongly, found behind the machine). */
  restock(id, balls = 1) {
    const e = this.entries.get(id);
    if (!e) return null;
    e.quantity += Math.max(0, Number(balls) || 0);
    e.quantityRemaining += Math.max(0, Number(balls) || 0);
    return e;
  }

  /**
   * Deduct `balls` from an entry's remaining count and note the project. Refuses to go below
   * zero and reports the shortfall so callers can prompt to buy more.
   * @param {string} id @param {number} balls @param {string} [projectId]
   * @returns {{deducted:number, remaining:number, shortfall:number, entry:StashEntry}}
   */
  deduct(id, balls, projectId) {
    const e = this.entries.get(id);
    if (!e) return { deducted: 0, remaining: 0, shortfall: Math.max(0, Number(balls) || 0), entry: null };
    const want = Math.max(0, Number(balls) || 0);
    const deducted = Math.min(want, e.quantityRemaining);
    e.quantityRemaining -= deducted;
    const shortfall = want - deducted;
    if (projectId && !e.projects.includes(projectId)) e.projects.push(projectId);
    return { deducted, remaining: e.quantityRemaining, shortfall, entry: e };
  }

  /**
   * Consume yarn for a project expressed in *metres*: figure out how many balls that is from
   * the entry's meterage, deduct them, and record the project. Returns whether the stash fully
   * covered it.
   * @param {string} id @param {number} meters @param {string} [projectId]
   */
  useInProject(id, meters, projectId) {
    const e = this.entries.get(id);
    if (!e) return { ok: false, ballsNeeded: 0, shortfall: 0 };
    const ballsNeeded = ballsForMeters(e.yarn, meters);
    const res = this.deduct(id, ballsNeeded, projectId);
    return { ok: res.shortfall === 0, ballsNeeded, deducted: res.deducted, shortfall: res.shortfall, remaining: res.remaining };
  }

  /**
   * Build a shopping list: for each requirement (a yarn + colour + metres needed), report what
   * the stash already covers and how many balls to buy.
   * @param {Array<{yarnId?:string, stashId?:string, colorHex?:string, meters:number, label?:string}>} requirements
   * @returns {Array<{label:string, have:number, need:number, buy:number, cost:number, unit:'balls', matched:Array<{entryId:string, remaining:number}>}>}
   */
  shoppingList(requirements = []) {
    return requirements.map(req => {
      const meters = Number(req.meters) || 0;
      const matches = this._candidateEntries(req);
      let haveMeters = 0;
      const matched = [];
      for (const e of matches) {
        const perBall = (e.yarn.meterage && e.yarn.meterage.metersPerBall) || 100;
        const contrib = e.quantityRemaining * perBall;
        haveMeters += contrib;
        matched.push({ entryId: e.id, remaining: e.quantityRemaining });
        if (haveMeters >= meters) break;
      }
      const needBalls = matches.length ? ballsForMeters(matches[0].yarn, meters) : Math.ceil(meters / 100);
      const haveBalls = matched.reduce((n, m) => n + m.remaining, 0);
      const buy = Math.max(0, needBalls - haveBalls);
      const pricePerBall = matches.length ? matches[0].price : 0;
      return {
        label: req.label || (matches[0] ? `${matches[0].yarn.brand} ${matches[0].yarn.name} ${matches[0].color.name}` : (req.label || 'yarn')),
        have: haveBalls,
        need: needBalls,
        buy,
        cost: round2(buy * pricePerBall),
        unit: 'balls',
        matched
      };
    });
  }

  /** @private stash entries that could satisfy a requirement (by stash id, yarn id, or colour). */
  _candidateEntries(req) {
    const all = this.all();
    if (req.stashId) {
      const e = this.entries.get(req.stashId);
      if (e) return [e];
    }
    let pool = all;
    if (req.yarnId) pool = pool.filter(e => e.yarn.id === req.yarnId);
    if (req.colorHex) pool = pool.filter(e => colorClose(e.color && e.color.hex, req.colorHex));
    return pool.filter(e => e.quantityRemaining > 0);
  }

  /**
   * "What can I make?" — given a needed yardage and (optionally) a gauge/weight/fibre, return
   * the stash entries that could cover it on their own, ranked by how snugly they fit.
   * @param {{meters:number, stsPer10cm?:number, weight?:string, fiber?:string}} target
   * @returns {Array<{entry:StashEntry, covers:boolean, ballsNeeded:number, spare:number}>}
   */
  whatCanIMake(target = {}) {
    const meters = Number(target.meters) || 0;
    const results = [];
    for (const e of this.all()) {
      if (e.quantityRemaining <= 0) continue;
      if (target.weight && e.yarn.weight !== target.weight) continue;
      if (target.fiber && !e.yarn.fiber.some(f => f.name === target.fiber)) continue;
      if (target.stsPer10cm) {
        const [lo, hi] = e.yarn.gaugeRange.stitches;
        if (target.stsPer10cm < lo - 2 || target.stsPer10cm > hi + 2) continue;
      }
      const ballsNeeded = ballsForMeters(e.yarn, meters);
      const perBall = (e.yarn.meterage && e.yarn.meterage.metersPerBall) || 100;
      const availableMeters = e.quantityRemaining * perBall;
      results.push({ entry: e, covers: availableMeters >= meters, ballsNeeded, spare: round1(availableMeters - meters) });
    }
    return results.sort((a, b) => (b.covers - a.covers) || (Math.abs(a.spare) - Math.abs(b.spare)));
  }

  /** Total monetary value of what is still on the shelf. */
  value() {
    let money = 0;
    const currencies = new Set();
    for (const e of this.all()) { currencies.add(e.currency); money += e.quantityRemaining * (e.price || 0); }
    return { total: round2(money), currencies: [...currencies] };
  }

  /** Total balls owned vs remaining. */
  counts() {
    let owned = 0, remaining = 0;
    for (const e of this.all()) { owned += e.quantity; remaining += e.quantityRemaining; }
    return { owned, remaining, used: owned - remaining, entries: this.size };
  }

  /** Group the remaining weight (grams) by yarn weight bucket. */
  byWeight() {
    const g = {};
    for (const e of this.all()) {
      const gramsPerBall = (e.yarn.meterage && e.yarn.meterage.gramsPerBall) || 0;
      g[e.yarn.weight] = (g[e.yarn.weight] || 0) + e.quantityRemaining * gramsPerBall;
    }
    for (const k of Object.keys(g)) g[k] = Math.round(g[k]);
    return g;
  }

  /** Entries touched by a given project. */
  forProject(projectId) { return this.all().filter(e => e.projects.includes(projectId)); }

  /** Serialise for storage. */
  toPlain() {
    return this.all().map(e => ({
      id: e.id, yarnId: e.yarn.id, yarn: e.yarn, color: e.color, dyeLot: e.dyeLot,
      quantity: e.quantity, quantityRemaining: e.quantityRemaining, location: e.location,
      acquiredAt: e.acquiredAt, price: e.price, currency: e.currency, photos: e.photos,
      notes: e.notes, projects: e.projects
    }));
  }

  /** Rebuild a stash from stored plain entries. */
  static fromPlain(list = [], db = getDefaultDatabase()) {
    const stash = new Stash(db);
    for (const p of list) {
      const yarn = p.yarn ? normalizeYarn(p.yarn, { custom: p.yarn.custom }) : (db.get(p.yarnId) || null);
      if (!yarn) continue;
      const entry = stash._makeEntry(yarn, p.color || yarn.colors[0] || { name: 'Natural', hex: '#e8e0d0' }, p.quantity, {
        id: p.id, dyeLot: p.dyeLot, quantityRemaining: p.quantityRemaining, location: p.location,
        acquiredAt: p.acquiredAt, price: p.price, currency: p.currency, photos: p.photos,
        notes: p.notes, projects: p.projects
      });
      stash.entries.set(entry.id, entry);
    }
    return stash;
  }
}

function colorClose(a, b) {
  if (!a || !b) return true;
  try {
    return deltaE(a, b) < 18;
  } catch { return String(a).toLowerCase() === String(b).toLowerCase(); }
}

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
