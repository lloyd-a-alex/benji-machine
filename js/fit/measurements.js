/**
 * KNITCAT V2 — canonical body measurements.
 *
 * One authoritative list of every measurement the Fit Engine knows about, its kind
 * (circumference / length / width / angle), its unit and its default. Both the standard
 * size charts and the Project body nodes read from here, so there is exactly one place
 * that says what "bust" means and whether it is a circumference in centimetres. Keeping
 * the vocabulary centralised is what lets a size-chart row, a KnitScript `body:` section
 * and a photo-import estimate all be merged field-by-field without disagreement.
 *
 * DOM-free.
 *
 * @module fit/measurements
 */

/** @typedef {'circumference'|'length'|'width'|'angle'} MeasurementKind */

/**
 * Every measurement, in drafting order. `kind` drives how the Fit Engine uses it
 * (a circumference wraps the body; a width spans it flat; an angle slopes).
 * @type {Array<{key:string, kind:MeasurementKind, label:string, default:number}>}
 */
export const MEASUREMENTS = Object.freeze([
  { key: 'bust', kind: 'circumference', label: 'Bust / chest', default: 96 },
  { key: 'underbust', kind: 'circumference', label: 'Underbust', default: 82 },
  { key: 'waist', kind: 'circumference', label: 'Waist', default: 82 },
  { key: 'highHip', kind: 'circumference', label: 'High hip', default: 92 },
  { key: 'hip', kind: 'circumference', label: 'Hip', default: 100 },
  { key: 'thigh', kind: 'circumference', label: 'Thigh', default: 56 },
  { key: 'knee', kind: 'circumference', label: 'Knee', default: 38 },
  { key: 'calf', kind: 'circumference', label: 'Calf', default: 36 },
  { key: 'ankle', kind: 'circumference', label: 'Ankle', default: 22 },
  { key: 'upperArm', kind: 'circumference', label: 'Upper arm', default: 32 },
  { key: 'wrist', kind: 'circumference', label: 'Wrist', default: 18 },
  { key: 'neck', kind: 'circumference', label: 'Neck', default: 38 },
  { key: 'backLength', kind: 'length', label: 'Back length (C7–waist)', default: 46 },
  { key: 'frontLength', kind: 'length', label: 'Front length', default: 44 },
  { key: 'totalLength', kind: 'length', label: 'Total length', default: 62 },
  { key: 'armholeDepth', kind: 'length', label: 'Armhole depth', default: 22 },
  { key: 'sleeveLength', kind: 'length', label: 'Sleeve length', default: 48 },
  { key: 'sleeveCapHeight', kind: 'length', label: 'Sleeve cap height', default: 12 },
  { key: 'neckToShoulder', kind: 'length', label: 'Neck to shoulder', default: 8 },
  { key: 'shoulderWidth', kind: 'width', label: 'Shoulder width', default: 42 },
  { key: 'crossBack', kind: 'width', label: 'Cross back', default: 36 },
  { key: 'crossFront', kind: 'width', label: 'Cross front', default: 34 },
  { key: 'shoulderSlope', kind: 'angle', label: 'Shoulder slope', default: 12 },
  { key: 'neckSlope', kind: 'angle', label: 'Neck slope', default: 45 },
  { key: 'bustApex', kind: 'length', label: 'Bust apex drop', default: 26 }
]);

/** key → definition, for O(1) lookups. */
export const MEASUREMENT_BY_KEY = Object.freeze(
  MEASUREMENTS.reduce((map, m) => { map[m.key] = m; return map; }, {})
);

/** A fresh measurement set filled with the canonical defaults. @returns {Record<string,number>} */
export function defaultMeasurements() {
  const out = {};
  for (const m of MEASUREMENTS) out[m.key] = m.default;
  return out;
}

/**
 * Merge partial measurement overrides onto defaults, ignoring unknown keys and
 * non-finite numbers so a stray `undefined` from a half-written file cannot poison a body.
 * @param {Record<string,number>} [overrides] @returns {Record<string,number>}
 */
export function normalizeMeasurements(overrides) {
  const out = defaultMeasurements();
  if (!overrides || typeof overrides !== 'object') return out;
  for (const [k, v] of Object.entries(overrides)) {
    if (MEASUREMENT_BY_KEY[k] && Number.isFinite(v)) out[k] = v;
  }
  return out;
}
