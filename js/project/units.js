/**
 * KNITCAT V2 — shared unit + rounding helpers for the Project constraint nodes.
 *
 * Small, pure numeric utilities every node pack reaches for: turning a KnitScript
 * `{value,unit}` length into centimetres, rounding a stitch count to a chosen multiple
 * (rib and raglan need the cast-on divisible by 4, a 2x2 rib by 4, a 1x1 by 2), and
 * clamping. Keeping them here means body/garment/gauge/pattern/cost nodes all agree on
 * what "round to a knit-friendly number" means instead of each rolling its own.
 *
 * DOM-free.
 *
 * @module project/units
 */

import { UNITS_TO_CM } from '../knitscript/interpreter.js';

/**
 * Coerce anything measurement-shaped into a centimetre number.
 * Accepts a plain number (assumed cm), a `{value,unit}` length, or an object with a
 * `.cm` field. Returns `fallback` (default 0) for anything unrecognised so a missing
 * property degrades to a known default instead of NaN poisoning the whole graph.
 * @param {*} v @param {number} [fallback=0] @returns {number}
 */
export function toCm(v, fallback = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v && typeof v === 'object') {
    if (typeof v.cm === 'number') return v.cm;
    if (typeof v.value === 'number') {
      const f = UNITS_TO_CM[v.unit];
      return Number.isFinite(f) ? v.value * f : v.value;
    }
  }
  return fallback;
}

/** Read a raw scalar count (stitches, balls, grams) from a value shape. */
export function toNumber(v, fallback = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v && typeof v === 'object') {
    if (typeof v.value === 'number') return v.value;
    if (typeof v.left === 'number') return v.left; // a pair's primary
  }
  return fallback;
}

/**
 * Round `n` to the nearest multiple of `m` (m>=1). Used to make cast-on counts land on
 * pattern repeats. Never returns below `m` unless n is 0.
 * @param {number} n @param {number} m @returns {number}
 */
export function roundToMultiple(n, m) {
  if (!Number.isFinite(n)) return 0;
  const mult = Math.max(1, Math.floor(m) || 1);
  if (n === 0) return 0;
  const r = Math.round(n / mult) * mult;
  return r === 0 ? mult : r;
}

/** Round up to the next multiple of `m`. */
export function ceilToMultiple(n, m) {
  const mult = Math.max(1, Math.floor(m) || 1);
  return Math.ceil((Number.isFinite(n) ? n : 0) / mult) * mult;
}

/** Clamp `n` into [lo,hi]; NaN returns lo. */
export function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
