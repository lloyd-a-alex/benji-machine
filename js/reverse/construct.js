/**
 * KNITCAT V2 — Reverse Engineer: construction inference (spec §5.7).
 *
 * Given the silhouette features from {@link module:reverse/silhouette} and any detected fabric
 * clues, decide *how the garment was built*: raglan, set-in sleeve, drop shoulder, circular yoke or
 * dolman. The spec calls this "a classification problem; use a decision tree on features extracted
 * from the silhouette", so that is exactly what this is — an explicit, readable, hand-tuned tree
 * (not a black box) so the maker can see *why* the app thinks it is a raglan and override it.
 *
 * Each rule contributes to a score per construction; the top score wins, but every candidate is
 * returned with its confidence and the human-readable list of evidence that fired. The construction
 * ids map straight onto the Fit Engine's template ids, so a confident "raglan" here means the
 * reconstructed KnitScript will draft with `bottom-up-raglan`. DOM-free.
 *
 * @module reverse/construct
 */

/** The constructions the inference can name → Fit Engine template ids. */
export const CONSTRUCTIONS = Object.freeze({
  raglan: 'bottom-up-raglan',
  'set-in': 'bottom-up-set-in',
  'drop-shoulder': 'drop-shoulder',
  'circular-yoke': 'circular-yoke',
  dolman: 'dolman',
  kimono: 'kimono'
});

/**
 * Infer the garment construction from silhouette features (+ optional fabric pattern hints).
 * @param {object} features the `features` from {@link module:reverse/silhouette#extractSilhouette}
 * @param {{pattern?:string, seamLines?:Array}} [hints]
 * @returns {{construction:string, templateId:string, confidence:number, ranked:Array, evidence:string[]}}
 */
export function inferConstruction(features, hints = {}) {
  const f = features || {};
  const shoulderSlope = num(f.shoulderSlope);
  const sleeveProtrusion = num(f.sleeveProtrusion);
  const aspect = num(f.aspect) || 1;
  const widestAtTop = Boolean(f.widestAtTop);
  const profile = Array.isArray(f.profile) ? f.profile : [];
  // A "neck notch" is a dip at the very top centre of the width profile.
  const neckNotch = profile.length >= 3 ? clamp01((Math.max(profile[1], profile[2]) - profile[0]) / (profile[1] || 1)) : 0;

  const scores = {};
  const evidence = [];

  // Raglan: sloped, continuous diagonal from underarm to neck → moderate slope, sleeves merge into
  // the body silhouette without a hard step at the shoulder.
  scores.raglan = 0.4
    + clamp01(shoulderSlope * 1.6) * 0.3
    + clamp01(sleeveProtrusion * 0.8) * 0.2
    + (widestAtTop ? 0.1 : 0);
  if (shoulderSlope > 0.2 && sleeveProtrusion > 0.3) evidence.push('diagonal shoulder-to-underarm line (sloped shoulders merging into sleeves) → raglan');

  // Set-in: a distinct step where the sleeve meets a vertical armhole — high sleeve protrusion AND a
  // near-vertical body edge (low shoulder slope, sharp width discontinuity near the top).
  scores['set-in'] = 0.3
    + clamp01(sleeveProtrusion * 1.2) * 0.3
    + clamp01(1 - shoulderSlope * 2) * 0.25
    + (widestAtTop ? 0.15 : 0);
  if (sleeveProtrusion > 0.6 && shoulderSlope < 0.15) evidence.push('sleeves project at a fixed shoulder point with a vertical armhole → set-in sleeve');

  // Drop shoulder: body is a rectangle, sleeves hang straight off a horizontal shoulder seam — low
  // slope, sleeves wide relative to body, widest band in the upper third, boxy.
  scores['drop-shoulder'] = 0.3
    + clamp01(1 - shoulderSlope * 3) * 0.3
    + clamp01(sleeveProtrusion) * 0.2
    + clamp01(1 - Math.abs(aspect - 1) * 1.5) * 0.2;
  if (shoulderSlope < 0.1 && sleeveProtrusion > 0.4) evidence.push('boxy body with straight sleeves below a horizontal shoulder line → drop shoulder');

  // Circular yoke: no shoulder seam, radial symmetry, a yoke band of pattern near the top; often
  // detected via a colourwork ring (pattern hint) and a smooth round shoulder.
  scores['circular-yoke'] = 0.25
    + (hints.pattern === 'fair-isle' ? 0.3 : 0)
    + clamp01(neckNotch * 1.2) * 0.2
    + clamp01(shoulderSlope * 1.2) * 0.15
    + (neckNotch > 0.4 ? 0.1 : 0);
  if (hints.pattern === 'fair-isle' && neckNotch > 0.3) evidence.push('symmetrical colourwork band radiating from the neck, no shoulder seam → circular yoke');

  // Dolman / kimono: sleeves are part of the body — very wide upper silhouette, T-shape, minimal
  // separate sleeve protrusion because the sleeve *is* the body's width.
  scores.dolman = 0.2
    + clamp01((aspect - 1.1) * 1.4) * 0.35
    + clamp01(1 - sleeveProtrusion) * 0.25
    + clamp01(1 - shoulderSlope * 2) * 0.2;
  scores.kimono = scores.dolman * 0.9 + (aspect > 1.4 ? 0.15 : 0);
  if (aspect > 1.2 && sleeveProtrusion < 0.3) evidence.push('sleeves cut from the same piece as the body (wide T-shape) → dolman/kimono');

  const ranked = Object.entries(scores)
    .map(([construction, s]) => ({ construction, templateId: CONSTRUCTIONS[construction], confidence: round2(clamp01(s)) }))
    .sort((a, b) => b.confidence - a.confidence);

  const best = ranked[0];
  return {
    construction: best.construction,
    templateId: best.templateId,
    confidence: best.confidence,
    ranked,
    evidence: dedupe(evidence),
    note: best.confidence < 0.45 ? 'Low confidence — confirm the construction manually.' : 'Best-guess construction from the silhouette.'
  };
}

/**
 * Convenience: run inference directly on a silhouette result object.
 * @param {{features:object}} silhouette @param {object} [hints]
 */
export function inferFromSilhouette(silhouette, hints = {}) {
  return inferConstruction(silhouette && silhouette.features, hints);
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function dedupe(arr) { return Array.from(new Set(arr)); }
