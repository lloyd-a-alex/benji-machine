/**
 * KNITCAT V2 — the BodyModel.
 *
 * A body, as data. It wraps a normalised measurement set plus the qualitative facts the
 * Fit Engine reasons about (body type, posture, an ease preference, the size label it came
 * from) and exposes the small derived helpers templates need: the ratio of waist to bust,
 * the total drop from nape to hem, the armhole depth. A model can be built from a
 * KnitScript `body:` section, from a standard size label, or from both merged (a size sets
 * the base, hand measurements override the ones the knitter actually took).
 *
 * Everything accepts the KnitScript `{value,unit}` length shape transparently via
 * {@link module:project/units.toCm}, so `bust: 96cm`, `bust: 96` and `bust:{cm:96}` all
 * normalise to the same centimetre number.
 *
 * DOM-free.
 *
 * @module fit/body-model
 */

import { normalizeMeasurements } from './measurements.js';
import { resolveSize } from './standard-sizes.js';
import { toCm } from '../project/units.js';

export const BODY_TYPES = Object.freeze(['hourglass', 'pear', 'apple', 'rectangle', 'inverted-triangle']);
export const POSTURES = Object.freeze(['neutral', 'forward-head', 'sloped-shoulders', 'sway-back', 'flat-back']);

export class BodyModel {
  /**
   * @param {object} [opts]
   * @param {Record<string,number>} [opts.measurements]
   * @param {string} [opts.name] @param {string} [opts.system] @param {string} [opts.sizeLabel]
   * @param {string} [opts.bodyType] @param {string} [opts.posture] @param {string} [opts.easePreference]
   */
  constructor(opts = {}) {
    this.name = opts.name || 'Body';
    this.system = opts.system || 'custom';
    this.sizeLabel = opts.sizeLabel || null;
    this.measurements = normalizeMeasurements(opts.measurements);
    this.bodyType = BODY_TYPES.includes(opts.bodyType) ? opts.bodyType : 'rectangle';
    this.posture = POSTURES.includes(opts.posture) ? opts.posture : 'neutral';
    this.easePreference = opts.easePreference || 'standard';
    /** True when measurements came from a chart rather than real numbers. */
    this.fromChart = !!opts.fromChart;
  }

  /** Read one measurement in cm. @param {string} key @returns {number} */
  get(key) { return this.measurements[key]; }

  /** Nape-to-hem drop used for body length. @returns {number} */
  get totalDrop() { return this.measurements.backLength + this.measurements.neckToShoulder; }

  /** How much the waist pinches in relative to the bust (>0.9 = hourglass-ish). */
  get waistToBust() { return this.measurements.bust ? this.measurements.waist / this.measurements.bust : 1; }

  /** Classify the body type from the numbers if the caller did not say. @returns {string} */
  inferBodyType() {
    const m = this.measurements;
    const bustHip = m.bust - m.hip;
    if (Math.abs(m.waist - m.bust) < 5 && Math.abs(m.hip - m.bust) < 5) return 'rectangle';
    if (bustHip >= 5) return 'inverted-triangle';
    if (bustHip <= -5) return 'pear';
    if (m.waist > m.bust - 2) return 'apple';
    return 'hourglass';
  }

  /**
   * Build from a KnitScript body section (already-interpreted values).
   * @param {object} body @returns {BodyModel}
   */
  static fromSpec(body) {
    if (!body || typeof body !== 'object') return new BodyModel();
    const measurements = {};
    for (const [k, v] of Object.entries(body)) {
      if (k === 'easePreference' || k === 'system' || k === 'bodyType' || k === 'posture' || k === 'name') continue;
      const cm = toCm(v, NaN);
      if (Number.isFinite(cm)) measurements[k] = cm;
    }
    return new BodyModel({
      measurements,
      system: String(body.system || 'custom'),
      name: body.name ? String(body.name) : 'Body',
      bodyType: body.bodyType, posture: body.posture,
      easePreference: String(body.easePreference || 'standard')
    });
  }

  /**
   * Build from a size label ("US 12"), optionally overridden by hand measurements.
   * @param {string} system @param {string|number} size @param {Record<string,number>} [overrides]
   * @returns {BodyModel}
   */
  static fromSize(system, size, overrides) {
    const { measurements } = resolveSize(system, size);
    const merged = Object.assign({}, measurements, overrides && typeof overrides === 'object' ? overrides : {});
    return new BodyModel({ measurements: merged, system: String(system), sizeLabel: String(size), fromChart: true });
  }
}
