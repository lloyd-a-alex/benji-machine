/**
 * KNITCAT V2 — the yarn database (spec §3.2).
 *
 * Two layers become one searchable registry: the shipped seed ({@link
 * module:yarn/yarn-db-seed.SEED_YARNS}) and whatever the user adds (custom yarns, stash
 * discoveries, Ravelry imports). Every yarn that enters the registry is *normalised* into the
 * canonical {@link Yarn} shape so the rest of the Yarn Lab, the Fit Engine and the Compiler can
 * rely on the fields being present and well-formed: `meterage` always resolves to metres-per-
 * gram, `gaugeRange` always has finite `[min,max]` stitch and row tuples, `fiber` is always an
 * array of `{name,percentage}` that sums to ~100, and each colour gets a computed CIELAB `lab`
 * so colour math never has to redo the conversion.
 *
 * The registry is DOM-free and dependency-light: it is just an array behind a `Map` index with
 * query helpers. Persistence is the caller's job (the stash module keeps a copy in storage).
 *
 * @module yarn/database
 */

import { SEED_YARNS } from './yarn-db-seed.js';
import { hexToLab } from './color.js';
import { normalizeFiber, YARN_WEIGHTS } from './behavior.js';

/**
 * A canonicalised yarn record. Every field below is guaranteed present after
 * {@link normalizeYarn} runs, which is what the registry stores.
 *
 * @typedef {object} Yarn
 * @property {string} id
 * @property {string} brand
 * @property {string} name
 * @property {string} weight a {@link module:yarn/behavior.YARN_WEIGHTS} member (or 'unknown')
 * @property {Array<{name:string, percentage:number}>} fiber
 * @property {{metersPer100g:number, gramsPerBall:number, metersPerBall:number, yardsPerBall:number, raw:object}} meterage
 * @property {{min:number, max:number}} needleRange mm
 * @property {{stitches:[number,number], rows:[number,number], per:number}} gaugeRange per 10cm
 * @property {Array<{name:string, hex:string, code?:string, lab:{L:number,a:number,b:number}}>} colors
 * @property {string} care
 * @property {string} origin
 * @property {boolean} discontinued
 * @property {string} notes
 * @property {boolean} custom true when user-supplied rather than shipped
 */

/** Weight names the app recognises; anything else normalises to a nearest bucket. */
const WEIGHT_ALIASES = {
  '4-ply': 'fingering', 'sock': 'fingering', 'fingering': 'fingering', 'baby': 'sport',
  '5-ply': 'sport', 'sport': 'sport', 'dk': 'dk', 'double-knitting': 'dk', '8-ply': 'dk',
  'aran': 'aran', '10-ply': 'worsted', 'worsted': 'worsted', 'light-worsted': 'worsted',
  'lightworsted': 'worsted', 'chunky': 'bulky', 'bulky': 'bulky', '12-ply': 'bulky',
  'super-bulky': 'super-bulky', 'superbulky': 'super-bulky', 'jumbo': 'jumbo',
  '3-ply': 'light-fingering', 'light-fingering': 'light-fingering', 'lace': 'lace',
  '2-ply': 'lace', 'cobweb': 'lace'
};

/** The midpoints we fall back to when a yarn ships without a gauge range, by weight. */
const WEIGHT_GAUGE = {
  lace: [32, 40], 'light-fingering': [28, 36], fingering: [27, 32], sport: [23, 26],
  dk: [21, 24], worsted: [18, 20], aran: [16, 18], bulky: [12, 14],
  'super-bulky': [8, 11], jumbo: [6, 8]
};

/**
 * Normalise one raw yarn object into the canonical {@link Yarn}. Robust to the messy shapes
 * the seed and third-party imports arrive in (duplicate `rows`/`stitches` keys, the string
 * `'auto'`, `m/50g` vs `yd/oz`, single fibre strings, colour arrays without codes).
 *
 * @param {object} raw @param {object} [opts] { custom?:boolean }
 * @returns {Yarn}
 */
export function normalizeYarn(raw, opts = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const weight = normalizeWeight(src.weight);
  const meterage = normalizeMeterage(src.meterage);
  const fiber = normalizeFiber(src.fiber);
  const gaugeRange = normalizeGaugeRange(src.gaugeRange, weight);
  const needleRange = normalizeNeedles(src.needleRange, weight);
  const colors = normalizeColors(src.colors);
  return {
    id: String(src.id || slug(`${src.brand || ''}-${src.name || 'yarn'}`)),
    brand: String(src.brand || 'Unknown'),
    name: String(src.name || 'Untitled yarn'),
    weight,
    fiber,
    meterage,
    needleRange,
    gaugeRange,
    colors,
    care: String(src.care || 'hand-wash'),
    origin: String(src.origin || ''),
    discontinued: Boolean(src.discontinued),
    notes: String(src.notes || ''),
    custom: Boolean(opts.custom || src.custom)
  };
}

/** Resolve a yarn's representative gauge (mid of its range) as `{stsPer10cm, rowsPer10cm}`. */
export function representativeGauge(yarn) {
  const g = yarn && yarn.gaugeRange ? yarn.gaugeRange : { stitches: [20, 22], rows: [26, 28] };
  return {
    stsPer10cm: mid(g.stitches, 21),
    rowsPer10cm: mid(g.rows, 28)
  };
}

/** Metres of this yarn needed for `grams` of it. */
export function metersForGrams(yarn, grams) {
  const per = (yarn.meterage && yarn.meterage.metersPer100g) || 0;
  return (per * (Number(grams) || 0)) / 100;
}

/** Balls required to cover `meters`, rounding up, with a small wastage buffer. */
export function ballsForMeters(yarn, meters, wastage = 1.05) {
  const perBall = (yarn.meterage && yarn.meterage.metersPerBall) || 100;
  if (!perBall) return 0;
  return Math.ceil(((Number(meters) || 0) * wastage) / perBall);
}

/**
 * The live registry. Construct one per session; it starts seeded and accumulates user yarns.
 */
export class YarnDatabase {
  /** @param {Array<object>} [seed] override the shipped seed (tests use a tiny one). */
  constructor(seed = SEED_YARNS) {
    /** @type {Map<string,Yarn>} */
    this.byIndex = new Map();
    /** insertion order of ids, for stable listing. @type {string[]} */
    this.order = [];
    this.addAll(seed, { custom: false });
  }

  /** How many yarns are registered. */
  get size() { return this.order.length; }

  /**
   * Add (or replace by id) a yarn.
   * @param {object} raw @param {object} [opts] @returns {Yarn}
   */
  add(raw, opts = {}) {
    const yarn = normalizeYarn(raw, opts);
    if (!this.byIndex.has(yarn.id)) this.order.push(yarn.id);
    this.byIndex.set(yarn.id, yarn);
    return yarn;
  }

  /** Add many. @returns {Yarn[]} */
  addAll(list = [], opts = {}) { return list.map(y => this.add(y, opts)); }

  /** Look up by exact id. @returns {Yarn|undefined} */
  get(id) { return this.byIndex.get(String(id)); }

  /** Look up by brand + name (case-insensitive). @returns {Yarn|undefined} */
  find(brand, name) {
    const b = String(brand || '').toLowerCase();
    const n = String(name || '').toLowerCase();
    for (const id of this.order) {
      const y = this.byIndex.get(id);
      if (y.brand.toLowerCase() === b && y.name.toLowerCase() === n) return y;
    }
    return undefined;
  }

  /** Remove a yarn by id. @returns {boolean} */
  remove(id) {
    if (!this.byIndex.has(id)) return false;
    this.byIndex.delete(id);
    this.order = this.order.filter(x => x !== id);
    return true;
  }

  /** All yarns as an array, in insertion order. @returns {Yarn[]} */
  all() { return this.order.map(id => this.byIndex.get(id)); }

  /**
   * Free-text search across brand, name, weight, fibre and colour names.
   * @param {string} query @returns {Yarn[]}
   */
  search(query = '') {
    const q = String(query).toLowerCase().trim();
    if (!q) return this.all();
    const terms = q.split(/\s+/);
    return this.all().filter(y => {
      const hay = [
        y.brand, y.name, y.weight, y.origin,
        y.fiber.map(f => f.name).join(' '),
        y.colors.map(c => `${c.name} ${c.code || ''}`).join(' ')
      ].join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }

  /**
   * Filter by structured criteria; combine freely.
   * @param {{weight?:string|string[], brand?:string, fiber?:string, maxSts?:number, minSts?:number, discontinued?:boolean}} [crit]
   * @returns {Yarn[]}
   */
  filter(crit = {}) {
    return this.all().filter(y => {
      if (crit.weight) {
        const want = Array.isArray(crit.weight) ? crit.weight : [crit.weight];
        if (!want.includes(y.weight)) return false;
      }
      if (crit.brand && y.brand.toLowerCase() !== String(crit.brand).toLowerCase()) return false;
      if (crit.fiber && !y.fiber.some(f => f.name === crit.fiber)) return false;
      const sts = representativeGauge(y).stsPer10cm;
      if (crit.minSts != null && sts < crit.minSts) return false;
      if (crit.maxSts != null && sts > crit.maxSts) return false;
      if (crit.discontinued != null && y.discontinued !== crit.discontinued) return false;
      return true;
    });
  }

  /** Yarns whose (mid) gauge spans `stsPer10cm`. @returns {Yarn[]} */
  forGauge(stsPer10cm, tolerance = 2) {
    const target = Number(stsPer10cm);
    if (!Number.isFinite(target)) return [];
    return this.all().filter(y => {
      const [lo, hi] = y.gaugeRange.stitches;
      return target >= lo - tolerance && target <= hi + tolerance;
    });
  }

  /** Distinct brand names, sorted. @returns {string[]} */
  brands() { return [...new Set(this.all().map(y => y.brand))].sort(); }

  /** Count of yarns per weight bucket. @returns {Record<string,number>} */
  weightHistogram() {
    const h = {};
    for (const w of YARN_WEIGHTS) h[w] = 0;
    for (const y of this.all()) h[y.weight] = (h[y.weight] || 0) + 1;
    return h;
  }

  /** Total colourways across every yarn. @returns {number} */
  colorwayCount() { return this.all().reduce((n, y) => n + y.colors.length, 0); }
}

/**
 * A process-wide default registry so simple callers (`getDefaultDatabase().search('karisma')`)
 * do not have to manage lifetime. Tests should construct their own {@link YarnDatabase}.
 * @type {YarnDatabase|null}
 */
let DEFAULT_DB = null;
export function getDefaultDatabase() {
  if (!DEFAULT_DB) DEFAULT_DB = new YarnDatabase();
  return DEFAULT_DB;
}

/** Reset the default registry (used by tests / stash reloads). */
export function resetDefaultDatabase() { DEFAULT_DB = null; }

// ── field normalisers ───────────────────────────────────────────────────────

function normalizeWeight(w) {
  const key = String(w || '').toLowerCase().trim();
  if (WEIGHT_ALIASES[key]) return WEIGHT_ALIASES[key];
  if (YARN_WEIGHTS.includes(key)) return key;
  return 'unknown';
}

function normalizeGaugeRange(g, weight) {
  const fb = WEIGHT_GAUGE[weight] || [20, 24];
  const stitches = cleanPair(g && g.stitches, fb);
  const rows = cleanPair(g && g.rows, [fb[0] * 1.3, fb[0] * 1.5]);
  return { stitches, rows, per: Number(g && g.per) || 10 };
}

function cleanPair(value, fallback) {
  if (Array.isArray(value)) {
    const nums = value.map(Number).filter(Number.isFinite);
    if (nums.length >= 2) return [Math.min(...nums), Math.max(...nums)];
    if (nums.length === 1) return [nums[0], nums[0]];
  }
  const single = Number(value);
  if (Number.isFinite(single)) return [single, single];
  return [Math.round(fallback[0]), Math.round(fallback[1])];
}

function normalizeNeedles(n, weight) {
  const fallback = { lace: [3.5, 4.5], 'light-fingering': [2.75, 3.5], fingering: [2.25, 3.25], sport: [3, 3.75], dk: [4, 4.5], worsted: [4.5, 5.5], aran: [5, 6], bulky: [5.5, 8], 'super-bulky': [8, 12], jumbo: [12, 25] }[weight] || [4, 5];
  if (!n) return { min: fallback[0], max: fallback[1] };
  return { min: Number(n.min) || fallback[0], max: Number(n.max) || fallback[1] };
}

function normalizeColors(colors) {
  if (!Array.isArray(colors)) return [];
  return colors
    .filter(c => c && (c.hex || c))
    .map(c => {
      const hex = typeof c === 'string' ? c : c.hex;
      return {
        name: (typeof c === 'object' && c.name) || 'Unnamed',
        hex,
        code: (typeof c === 'object' && c.code) || undefined,
        lab: safeLab(hex)
      };
    });
}

function safeLab(hex) {
  try { return hexToLab(hex); } catch { return { L: 0, a: 0, b: 0 }; }
}

/**
 * Parse the `meterage` into per-100g and per-ball metrics regardless of how the label writes
 * it. Handles `{value,unit,per,unitWeight}` (seed shape), a `"100m/50g"` string, and the KnitScript
 * `{left:{value,unit}, right:{value,unit}}` pair.
 */
function normalizeMeterage(m) {
  const result = { metersPer100g: 0, gramsPerBall: 0, metersPerBall: 0, yardsPerBall: 0, raw: m || null };
  if (!m) return result;
  let meters = 0;
  let grams = 0;
  if (typeof m === 'string') {
    const match = m.match(/([\d.]+)\s*(m|yd|yds|yds?|yds|ft)?\s*[\/of]+\s*([\d.]+)\s*(g|kg|oz)?/i);
    if (match) {
      meters = toMeters(Number(match[1]), match[2] || 'm');
      grams = toGrams(Number(match[3]), match[4] || 'g');
    }
  } else if (m.left || m.right) {
    meters = toMeters(Number(m.left && m.left.value) || 0, (m.left && m.left.unit) || 'm');
    grams = toGrams(Number((m.right && m.right.value) != null ? m.right.value : m.right) || 0, (m.right && m.right.unit) || 'g');
  } else if (typeof m.value === 'number') {
    meters = toMeters(m.value, m.unit || 'm');
    grams = toGrams(Number(m.per) || m.unitWeight || 0, typeof m.unitWeight === 'string' ? m.unitWeight : 'g') || (Number(m.per) || 0);
    // seed shape is M(value,'m',per,'g') → per is the grams the value spans.
    grams = Number(m.per) || grams || 0;
  }
  result.metersPerBall = round2(meters);
  result.gramsPerBall = round2(grams);
  result.metersPer100g = grams > 0 ? round2((meters / grams) * 100) : 0;
  result.yardsPerBall = round2(meters / 0.9144);
  return result;
}

function toMeters(value, unit) {
  const u = String(unit || 'm').toLowerCase();
  if (u.startsWith('yd') || u === 'y') return value * 0.9144;
  if (u === 'cm') return value / 100;
  if (u === 'ft') return value * 0.3048;
  return value; // 'm'
}
function toGrams(value, unit) {
  const u = String(unit || 'g').toLowerCase();
  if (u === 'kg') return value * 1000;
  if (u === 'oz') return value * 28.3495;
  return value; // 'g'
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'yarn';
}
function mid(pair, fb) {
  if (!Array.isArray(pair) || !pair.length) return fb;
  const a = Number(pair[0]), b = Number(pair[pair.length - 1]);
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  return Math.round(((a + b) / 2) * 10) / 10;
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
