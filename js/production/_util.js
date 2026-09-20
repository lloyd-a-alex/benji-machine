/**
 * KNITCAT V2 — Production System: shared primitives (spec §6).
 *
 * Every module in `js/production/*` is DOM-free, deterministic and JSON-friendly so the whole
 * production stack can run under Node in the test battery and be serialised straight into a
 * `.kcard`. This file collects the handful of things that recur across plans, batches, orders,
 * inventory, costing, time, pricing and customers:
 *
 *   - monotonic-ish, collision-resistant **ids** (so a factory floor can create thousands of
 *     orders without a database),
 *   - **money** helpers that treat currency as a plain two-decimal number and never float-drift
 *     (rounding half-up on the *cents*, the way an accountant expects a £20 product to behave),
 *   - **date** arithmetic on ISO `YYYY-MM-DD` strings (deadlines, ship dates, working days) with
 *     no `Date` timezone surprises — we parse to UTC noon so a day is always exactly one day,
 *   - a **safe reader** for Project graph nodes that never throws on a missing node (the graph's
 *     `get` throws; Production reads many optional figures, so we want `0`/`null`, not a stack),
 *   - tiny **text** and **collection** utilities (slugify, title-case, sum, groupBy, pct) used to
 *     render SKUs, order references and roll-up reports.
 *
 * Nothing here imports anything DOM-touching. `num`/`round2`/`clamp` intentionally mirror the
 * defensive style used by the Compiler backends so a half-populated Project is never fatal.
 *
 * @module production/_util
 */

/** Counter mixed into generated ids so two entities made in the same millisecond never collide. */
let _idCounter = 0;

/**
 * Generate a short, sortable, collision-resistant id with a semantic prefix.
 * @param {string} prefix e.g. 'ord', 'bat', 'plan', 'inv', 'cus'
 * @returns {string} e.g. `ord-1f3a2b-0007`
 */
export function makeId(prefix = 'id') {
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 1e6).toString(36).padStart(4, '0');
  _idCounter = (_idCounter + 1) % 0xffff;
  const c = _idCounter.toString(36).padStart(3, '0');
  return `${safeSlug(prefix)}-${t}${r}-${c}`;
}

/** The set of recognised production-plan statuses (spec §6.2). */
export const PLAN_STATUSES = ['planning', 'in-progress', 'complete', 'shipped'];
/** The set of recognised order statuses. */
export const ORDER_STATUSES = ['pending', 'confirmed', 'in-production', 'ready', 'shipped', 'delivered', 'cancelled', 'refunded'];
/** The set of recognised batch statuses. */
export const BATCH_STATUSES = ['queued', 'scheduled', 'in-progress', 'blocked', 'complete', 'cancelled'];
/** QC verdicts for a single checklist line. */
export const QC_VERDICTS = ['pass', 'fail', 'na'];

/**
 * Coerce anything to a finite number, falling back to a default.
 * @param {*} v @param {number} [dflt=0] @returns {number}
 */
export function num(v, dflt = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Round to two decimals, half-up, money-safe. @param {*} v @returns {number} */
export function money(v) {
  const n = num(v);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Round to at most `dp` decimals (default 2), half-up. @param {*} v @param {number} [dp=2] @returns {number} */
export function round(v, dp = 2) {
  const f = Math.pow(10, dp);
  const n = num(v);
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Clamp `v` into [lo,hi]. @returns {number} */
export function clamp(v, lo, hi) {
  const n = num(v, lo);
  return Math.max(lo, Math.min(hi, n));
}

/** Sum an array of numbers (non-numbers ignored). @param {Array} arr @returns {number} */
export function sum(arr) {
  if (!Array.isArray(arr)) return 0;
  let t = 0;
  for (const x of arr) t += num(x);
  return t;
}

/** Mean of an array of numbers, or 0 for empty. @param {Array} arr @returns {number} */
export function mean(arr) {
  if (!Array.isArray(arr) || !arr.length) return 0;
  return sum(arr) / arr.length;
}

/** Round a 0..1 ratio to a 0..100 integer percentage. @returns {number} */
export function pct(ratio) {
  return Math.round(clamp(num(ratio), 0, 1) * 100);
}

/**
 * A Project-node reader that never throws. The graph's `get` throws on a missing node; Production
 * reads many *optional* figures (a plan can exist before a yarn is chosen), so we swallow and give
 * a default. Works against both a live Project and a plain snapshot object.
 * @param {{get:Function,has?:Function}|object|null} project
 * @param {string} id node id e.g. 'cost.total'
 * @param {number} [dflt=0]
 * @returns {number}
 */
export function nodeNum(project, id, dflt = 0) {
  return num(nodeVal(project, id, dflt), dflt);
}

/**
 * A Project-node reader (any type) that never throws.
 * @param {any} project @param {string} id @param {*} [dflt=null] @returns {*}
 */
export function nodeVal(project, id, dflt = null) {
  if (!project) return dflt;
  try {
    if (typeof project.has === 'function' && !project.has(id)) return dflt;
    if (typeof project.get === 'function') {
      const v = project.get(id);
      return v === undefined ? dflt : v;
    }
    if (project[id] !== undefined) return project[id];
  } catch {
    /* missing node — return the default */
  }
  return dflt;
}

/** Turn arbitrary text into a lowercase dashed slug (for SKUs, refs, keys). @returns {string} */
export function slug(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Slug but underscore-joined and uppercase (SKU bodies). @returns {string} */
export function safeSlug(text) {
  return slug(text).replace(/-/g, '_') || 'x';
}

/** Title-case a phrase for human-readable labels. @returns {string} */
export function titleCase(text) {
  return String(text == null ? '' : text)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Build a stable, readable SKU from parts, uppercased and dash-joined, ≤ 24 chars.
 * @param {...(string|number)} parts @returns {string}
 */
export function makeSku(...parts) {
  const body = parts
    .filter((p) => p !== undefined && p !== null && String(p).length)
    .map((p) => String(p).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-');
  return (body || 'SKU').slice(0, 24);
}

/** Group an array of objects by a string-or-function key. @returns {Record<string,any[]>} */
export function groupBy(arr, key) {
  const out = {};
  const get = typeof key === 'function' ? key : (o) => o && o[key];
  for (const item of Array.isArray(arr) ? arr : []) {
    const k = String(get(item));
    (out[k] || (out[k] = [])).push(item);
  }
  return out;
}

/** Parse `YYYY-MM-DD` (or a `Date`) to a UTC-noon epoch ms, or NaN. @returns {number} */
export function dayMs(date) {
  if (date instanceof Date) return Math.floor(date.getTime() / 86400000) * 86400000 + 43200000;
  const s = String(date == null ? '' : date).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? NaN : Math.floor(t / 86400000) * 86400000 + 43200000;
  }
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

/** Today's date as `YYYY-MM-DD` (UTC). @returns {string} */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Format a day-epoch ms back to `YYYY-MM-DD`. @returns {string} */
export function isoDay(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Add `days` to an ISO date string. Weekends are counted (calendar days).
 * @param {string|Date} date @param {number} days @returns {string} `YYYY-MM-DD`
 */
export function addDays(date, days) {
  const base = dayMs(date);
  if (!Number.isFinite(base)) return isoDay(dayMs(today()));
  return isoDay(base + Math.round(num(days)) * 86400000);
}

/**
 * Whole calendar days between two ISO dates (`to - from`). Positive if `to` is later.
 * @param {string|Date} from @param {string|Date} to @returns {number}
 */
export function daysBetween(from, to) {
  const a = dayMs(from);
  const b = dayMs(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * Add `workingDays` (Mon–Fri) to a date, skipping weekends.
 * @param {string|Date} date @param {number} workingDays @param {Set<number>} [holidays] UTC-day ms to skip
 * @returns {string} `YYYY-MM-DD`
 */
export function addWorkingDays(date, workingDays, holidays) {
  let ms = dayMs(date);
  if (!Number.isFinite(ms)) ms = dayMs(today());
  // Normalise to a Monday-aligned start; step one day at a time counting weekdays.
  let remaining = Math.round(num(workingDays));
  const sign = remaining < 0 ? -1 : 1;
  remaining = Math.abs(remaining);
  const hol = holidays instanceof Set ? holidays : new Set(Array.isArray(holidays) ? holidays : []);
  while (remaining > 0) {
    ms += sign * 86400000;
    const dow = new Date(ms).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (hol.has(ms)) continue;
    remaining--;
  }
  return isoDay(ms);
}

/**
 * Count working days between two ISO dates (inclusive of `from`, exclusive of `to`).
 * @param {string|Date} from @param {string|Date} to @returns {number}
 */
export function workingDaysBetween(from, to) {
  let a = dayMs(from);
  const b = dayMs(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  let count = 0;
  while (a < b) {
    const dow = new Date(a).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    a += 86400000;
  }
  return count;
}

/** Is a value a non-empty plain object? @returns {boolean} */
export function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Shallow-clone a JSON-safe value (drops functions/undefined). @returns {*} */
export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/** Format a number as a currency string with a symbol, no float drift. @returns {string} */
export function formatMoney(value, currency = 'GBP') {
  const symbols = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥', CNY: '¥' };
  const sym = symbols[String(currency).toUpperCase()] || `${String(currency).toUpperCase()} `;
  const n = money(value);
  const neg = n < 0;
  const abs = Math.abs(n).toFixed(2);
  return `${neg ? '-' : ''}${sym}${abs}`;
}
