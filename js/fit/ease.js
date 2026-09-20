/**
 * KNITCAT V2 — ease profiles.
 *
 * "Ease" is the difference between the body and the finished garment — the room that turns
 * a tube into something wearable. Negative ease grips (a fitted sleeve), zero skims,
 * positive drapes. Different points of a garment want different amounts at once: a relaxed
 * pullover is generous at the chest but still close at the cuff, or it flaps. This resolves
 * a single ease *preference* plus any per-point overrides into an ease number at every
 * drafting point, so a template can just ask `ease.at('cuff')`.
 *
 * DOM-free.
 *
 * @module fit/ease
 */

/** Base chest ease (cm) per named preference. */
export const PREFERENCE_BASE = Object.freeze({
  close: -2, fitted: 2.5, slim: 4, standard: 6, relaxed: 8, oversized: 15
});

/**
 * How each drafting point scales from the chest ease. A cuff is barely ease-adjusted (it
 * must still pass over the hand); the body carries most of the preference. Values are
 * multipliers of the chest ease, with an additive floor where a minimum matters.
 */
const POINT_SHAPE = Object.freeze({
  chest: { mult: 1, min: 0 },
  bust: { mult: 1, min: 0 },
  waist: { mult: 0.7, min: 0 },
  hip: { mult: 0.6, min: 0 },
  arm: { mult: 1.1, min: 2 },
  upperArm: { mult: 1.1, min: 2 },
  cuff: { mult: 0.15, min: 2 },
  neck: { mult: 0, min: 0 },
  sleeveHem: { mult: 0.2, min: 2 },
  leg: { mult: 0.9, min: 1 }
});

export class EaseProfile {
  /**
   * @param {string} [preference] @param {Record<string,number>} [overrides] cm per point
   */
  constructor(preference = 'standard', overrides = {}) {
    const pref = String(preference || 'standard').toLowerCase();
    this.preference = PREFERENCE_BASE[pref] != null ? pref : 'standard';
    this.base = PREFERENCE_BASE[this.preference];
    this.overrides = overrides && typeof overrides === 'object' ? overrides : {};
  }

  /**
   * Ease in cm at a drafting point, honouring an explicit override first, then the shaped
   * preference, then a sensible floor so a cuff is never skin-tight by arithmetic accident.
   * @param {string} point @returns {number}
   */
  at(point) {
    if (Number.isFinite(this.overrides[point])) return this.overrides[point];
    const shape = POINT_SHAPE[point] || { mult: 0.8, min: 0 };
    return Math.max(shape.min, round1(this.base * shape.mult));
  }

  /** Resolve a whole set at once for the common points. @returns {Record<string,number>} */
  resolve() {
    const out = {};
    for (const point of Object.keys(POINT_SHAPE)) out[point] = this.at(point);
    for (const [k, v] of Object.entries(this.overrides)) if (Number.isFinite(v)) out[k] = v;
    return out;
  }
}

function round1(n) { return Math.round(n * 10) / 10; }
