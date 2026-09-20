/**
 * KNITCAT V2 — standard sizing charts (US / UK / EU / JP).
 *
 * When a knitter says "make it a US 12" instead of giving thirty numbers, this resolves
 * a full measurement set. Each system's chart is a graded table: a few anchor sizes carry
 * the real bust/waist/hip, and the rest of the body is derived from them with standard
 * grade ratios (an armhole, shoulder and neck that grow with the chest, not a fixed
 * default bolted onto a big size). Cross-system aliases are handled so "UK 16" and
 * "EU 44" land on the same body.
 *
 * The tables are genuinely useful approximations of commercial pattern blocks; they are
 * not a substitute for measuring a person, and the Fit Report says so when you rely on
 * them. DOM-free.
 *
 * @module fit/standard-sizes
 */

import { defaultMeasurements } from './measurements.js';

/**
 * Anchor charts. `bust/waist/hip` in cm for each labelled size; other measurements are
 * graded from the bust below. Women's knitted-garment blocks (finished-body, not ease).
 */
export const CHARTS = Object.freeze({
  us: { '0': [81, 64, 87], '2': [84, 66, 90], '4': [87, 69, 93], '6': [90, 72, 96], '8': [94, 76, 99], '10': [98, 80, 103], '12': [103, 85, 108], '14': [108, 90, 113], '16': [113, 96, 118], '18': [118, 101, 123], '20': [124, 107, 128] },
  uk: { '6': [81, 64, 87], '8': [84, 66, 90], '10': [87, 69, 93], '12': [91, 73, 96], '14': [96, 79, 101], '16': [101, 84, 106], '18': [107, 90, 112], '20': [112, 95, 117], '22': [117, 101, 122], '24': [122, 106, 127] },
  eu: { '34': [81, 64, 87], '36': [84, 66, 90], '38': [87, 69, 93], '40': [91, 73, 96], '42': [96, 79, 101], '44': [101, 84, 106], '46': [107, 90, 112], '48': [112, 95, 117], '50': [117, 101, 122] },
  jp: { '5': [80, 58, 85], '7': [83, 61, 88], '9': [86, 64, 90], '11': [89, 67, 92], '13': [92, 70, 95], '15': [95, 73, 97] },
  // A unisex/men's chest chart for garments drafted off the chest rather than the bust.
  men: { 's': [91, 81, 96], 'm': [97, 86, 100], 'l': [102, 92, 104], 'xl': [107, 97, 108], 'xxl': [112, 102, 111] }
});

/**
 * Resolve a size label ("US 12", "eu44", "m") into a full measurement set graded from the
 * chart. Falls back to the canonical defaults if the label is unknown, flagging `matched`
 * false so the caller can warn rather than silently fit a random body.
 * @param {string} system @param {string|number} size
 * @returns {{measurements:Record<string,number>, matched:boolean, bust:number}}
 */
export function resolveSize(system, size) {
  const sys = String(system || 'us').toLowerCase();
  const chart = CHARTS[sys] || CHARTS.us;
  const key = String(size).trim().toLowerCase();
  const row = chart[key];
  if (!row) return { measurements: defaultMeasurements(), matched: false, bust: defaultMeasurements().bust };
  const [bust, waist, hip] = row;
  return { measurements: gradeFromBust(bust, waist, hip), matched: true, bust };
}

/**
 * Grade a whole body from the three real anchor numbers, scaling everything else off the
 * bust against the default body so proportions stay sane at every size.
 * @param {number} bust @param {number} waist @param {number} hip @returns {Record<string,number>}
 */
export function gradeFromBust(bust, waist, hip) {
  const base = defaultMeasurements();
  const r = base.bust ? bust / base.bust : 1;
  const out = Object.assign({}, base);
  out.bust = bust; out.waist = waist; out.hip = hip;
  // Horizontal measures scale with the chest ratio; vertical measures only partly (a
  // bigger bust is not automatically a taller person), so lengths scale with sqrt(r).
  const vr = Math.sqrt(r);
  for (const k of ['underbust', 'highHip', 'upperArm', 'neck', 'crossBack', 'crossFront', 'shoulderWidth', 'wrist', 'thigh', 'knee', 'calf', 'ankle']) {
    out[k] = round1(base[k] * r);
  }
  for (const k of ['backLength', 'frontLength', 'totalLength', 'armholeDepth', 'sleeveLength', 'sleeveCapHeight', 'neckToShoulder', 'bustApex']) {
    out[k] = round1(base[k] * vr);
  }
  return out;
}

/** Every "system size" label the picker should offer, e.g. ["US 0", …, "Men XL"]. */
export function allSizeLabels() {
  const out = [];
  for (const [sys, chart] of Object.entries(CHARTS)) {
    for (const size of Object.keys(chart)) out.push(`${sys.toUpperCase()} ${size}`);
  }
  return out;
}

function round1(n) { return Math.round(n * 10) / 10; }
