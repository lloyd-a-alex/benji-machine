/**
 * KNITCAT V2 — the yarn substitution engine (spec §3.4 / §11.4).
 *
 * A knitter has a pattern that calls for Yarn A and a ball of Yarn B. *What actually changes?*
 * This is the question YarnSub answers badly and no CAD system answers at all. `substitute()`
 * produces a {@link SubstitutionReport}: the gauge delta, the yardage delta (how many more or
 * fewer metres per gram, hence how many more balls), the weight and fibre deltas scored through
 * the behaviour model, an optional colour match, an overall grade, and — the part that saves a
 * project — the concrete *adjustments* to make to the pattern (new cast-on, new row count, new
 * needle recommendation, expected finished-measurement drift) so the knitter is not left doing
 * the maths by hand.
 *
 * The whole thing is pure and DOM-free; it reads only the two normalised yarns and the
 * pattern's stated gauge.
 *
 * @module yarn/substitution
 */

import { representativeGauge, normalizeYarn } from './database.js';
import { behaviourFor } from './behavior.js';
import { deltaE } from './color.js';

/**
 * @typedef {object} SubstitutionReport
 * @property {object} original
 * @property {object} substitute
 * @property {{stitches:number, rows:number, unit:string}} gaugeDelta
 * @property {{original:number, substitute:number, percent:number}} yardageDelta
 * @property {{original:number, substitute:number, percent:number}} weightDelta
 * @property {{sameFibers:string[], added:string[], removed:string[], behaviorDelta:object}} fiberDelta
 * @property {{deltaE:number, hex:string}|null} colorMatch
 * @property {'excellent'|'good'|'acceptable'|'poor'} recommendation
 * @property {Array<{kind:string, from:*, to:*, note:string}>} adjustments
 * @property {string[]} warnings
 * @property {object} recalc helpers for re-deriving the pattern
 */

/**
 * Compare two yarns for substitution.
 * @param {object} original a raw or normalised yarn (the pattern's call)
 * @param {object} substitute a raw or normalised yarn (what the knitter has)
 * @param {{stitchesPer10cm?:number, rowsPer10cm?:number, castOn?:number, totalRows?:number, meters?:number, ballPrice?:number}} [patternGauge]
 *   the pattern's *assumed* gauge and numbers; when omitted the original yarn's gauge stands in.
 * @returns {SubstitutionReport}
 */
export function substitute(original, substitute, patternGauge = {}) {
  const a = original && original.gaugeRange ? original : normalizeYarn(original || {});
  const b = substitute && substitute.gaugeRange ? substitute : normalizeYarn(substitute || {});

  const ga = patternGauge.stitchesPer10cm ? { stsPer10cm: Number(patternGauge.stitchesPer10cm), rowsPer10cm: Number(patternGauge.rowsPer10cm) || representativeGauge(a).rowsPer10cm } : representativeGauge(a);
  const gb = representativeGauge(b);

  const gaugeDelta = {
    stitches: round1(gb.stsPer10cm - ga.stsPer10cm),
    rows: round1(gb.rowsPer10cm - ga.rowsPer10cm),
    unit: 'per-10cm'
  };

  const ypa = (a.meterage && a.meterage.metersPer100g) || 0;
  const ypb = (b.meterage && b.meterage.metersPer100g) || 0;
  const yardageDelta = {
    original: round1(ypa),
    substitute: round1(ypb),
    percent: ypa ? round1(((ypb - ypa) / ypa) * 100) : 0
  };

  const wpa = (a.meterage && a.meterage.gramsPerBall) || 0;
  const wpb = (b.meterage && b.meterage.gramsPerBall) || 0;
  const weightDelta = {
    original: round1(wpa),
    substitute: round1(wpb),
    percent: wpa ? round1(((wpb - wpa) / wpa) * 100) : 0
  };

  const fiberDelta = compareFibers(a.fiber, b.fiber);
  const colorMatch = matchColor(a.colors && a.colors[0], b.colors);
  const { recommendation, warnings } = gradeRecommendation(gaugeDelta, yardageDelta, fiberDelta, colorMatch, a, b);
  const adjustments = computeAdjustments(a, b, Object.assign({ stitchesPer10cm: ga.stsPer10cm, rowsPer10cm: ga.rowsPer10cm }, patternGauge));

  return {
    original: a,
    substitute: b,
    gaugeDelta,
    yardageDelta,
    weightDelta,
    fiberDelta,
    colorMatch,
    recommendation,
    adjustments,
    warnings,
    recalc: {
      newGauge: gb,
      /** Re-derive a stitch count that was computed on the pattern gauge. */
      stitches(oldCount) { return Math.round((Number(oldCount) || 0) * (gb.stsPer10cm / ga.stsPer10cm)); },
      rows(oldCount) { return Math.round((Number(oldCount) || 0) * (gb.rowsPer10cm / ga.rowsPer10cm)); },
      meters(oldMeters) { return round1((Number(oldMeters) || 0) * (gb.stsPer10cm / ga.stsPer10cm) * (ga.rowsPer10cm / gb.rowsPer10cm)); }
    }
  };
}

/**
 * Which of a set of candidate yarns is the best substitute for `original`?
 * @param {object} original @param {object[]} candidates @param {object} [patternGauge] @param {number} [limit=5]
 * @returns {Array<{yarn:object, report:SubstitutionReport, score:number}>}
 */
export function rankSubstitutes(original, candidates = [], patternGauge = {}, limit = 5) {
  const scored = candidates.map(c => {
    const report = substitute(original, c, patternGauge);
    return { yarn: c, report, score: recommendationScore(report.recommendation) - Math.abs(report.gaugeDelta.stitches) * 0.4 };
  });
  return scored.sort((x, y) => y.score - x.score).slice(0, limit);
}

/** @private */
function recommendationScore(rec) {
  return { excellent: 4, good: 3, acceptable: 2, poor: 1 }[rec] || 0;
}

/**
 * Compare two fibre lists: which fibres are shared, added, removed, and how the predicted
 * behaviour shifts on the traits a substitution actually changes the hand of.
 */
export function compareFibers(origFiber = [], subFiber = []) {
  const om = pctMap(origFiber);
  const sm = pctMap(subFiber);
  const keys = new Set([...om.keys(), ...sm.keys()]);
  const sameFibers = [];
  const added = [];
  const removed = [];
  for (const k of keys) {
    if (om.has(k) && sm.has(k)) sameFibers.push({ name: k, original: om.get(k), substitute: sm.get(k) });
    else if (sm.has(k)) added.push(k);
    else removed.push(k);
  }
  const ba = behaviourFor(origFiber);
  const bb = behaviourFor(subFiber);
  const traits = ['drape', 'stretch', 'recovery', 'warmth', 'breathability', 'pillingRisk', 'felting'];
  const behaviorDelta = {};
  for (const t of traits) behaviorDelta[t] = round2((num(bb[t]) - num(ba[t])));
  return { sameFibers, added, removed, behaviorDelta, originalBehavior: ba, substituteBehavior: bb };
}

/**
 * Match a colourway of the original to the closest colourway of the substitute.
 * @returns {{deltaE:number, hex:string, name:string}|null}
 */
export function matchColor(originalColor, subColors = []) {
  if (!originalColor || !originalColor.hex || !subColors.length) return null;
  let best = null;
  for (const c of subColors) {
    const hex = c.hex || c;
    const d = safeDeltaE(originalColor.hex, hex);
    if (!best || d < best.deltaE) best = { deltaE: round1(d), hex, name: c.name || hex };
  }
  return best;
}

/**
 * Grade the substitution and collect human warnings.
 * @private (exported for testing)
 */
export function gradeRecommendation(gaugeDelta, yardageDelta, fiberDelta, colorMatch, a, b) {
  const warnings = [];
  const stsOff = Math.abs(gaugeDelta.stitches);
  const rowOff = Math.abs(gaugeDelta.rows);
  let score = 4;

  if (stsOff > 4) { score -= 2; warnings.push(`Gauge is off by ${gaugeDelta.stitches} sts/10cm — the finished piece changes size substantially; re-swatch and re-derive the pattern.`); }
  else if (stsOff > 2) { score -= 1; warnings.push(`Gauge differs by ${gaugeDelta.stitches} sts/10cm — expect ~${Math.round(stsOff * 3)}% size drift if you knit as written.`); }
  if (rowOff > 5) warnings.push(`Row gauge differs by ${gaugeDelta.rows}/10cm — lengths will shift; adjust row counts.`);

  if (yardageDelta.percent < -15) { score -= 1; warnings.push(`Substitute has ${Math.round(-yardageDelta.percent)}% less yardage per 100g — buy more balls.`); }
  if (yardageDelta.percent > 25) warnings.push(`Substitute has ${Math.round(yardageDelta.percent)}% more yardage per 100g — you may need fewer balls.`);

  const recDrop = num(fiberDelta.behaviorDelta.recovery);
  if (recDrop < -0.25) { score -= 1; warnings.push('Lower recovery — the garment may grow out (watch cuffs and elbows). Blocking will help but not fully.'); }
  if (num(fiberDelta.behaviorDelta.felting) > 0 && (fiberDelta.added.includes('wool') || fiberDelta.sameFibers.some(f => f.name === 'wool'))) {
    if (num(b.fiber && b.fiber.find ? 0 : 0) === 0 && !String(b.care || '').includes('superwash') && String(b.care || '').includes('hand')) {
      warnings.push('Non-superwash wool — felt-risk in a hot wash; keep the same care as the original.');
    }
  }
  if (!String(b.fiber || '').length) { /* already normalised */ }

  if (a.weight !== b.weight && a.weight !== 'unknown' && b.weight !== 'unknown') {
    warnings.push(`Weight differs (${a.weight} → ${b.weight}).`);
    if (weightClassGap(a.weight, b.weight) >= 2) score -= 2;
  }

  if (colorMatch && colorMatch.deltaE > 25) warnings.push(`Nearest colourway is ${Math.round(colorMatch.deltaE)} ΔE away — not a close colour match.`);

  const rec = ['poor', 'poor', 'acceptable', 'good', 'excellent'][clamp(score, 0, 4)];
  return { recommendation: rec, warnings };
}

/**
 * The concrete edits to make to the pattern (the part that saves the project).
 * @private (exported for testing)
 */
export function computeAdjustments(a, b, patternGauge = {}) {
  const ga = { sts: Number(patternGauge.stitchesPer10cm) || representativeGauge(a).stsPer10cm, rows: Number(patternGauge.rowsPer10cm) || representativeGauge(a).rowsPer10cm };
  const _gb = representativeGauge(b);
  const gb = { sts: _gb.stsPer10cm, rows: _gb.rowsPer10cm }; // align field names with `ga`
  const adjustments = [];

  if (patternGauge.castOn != null) {
    const newCastOn = Math.round(Number(patternGauge.castOn) * (gb.sts / ga.sts));
    adjustments.push({ kind: 'cast-on', from: patternGauge.castOn, to: newCastOn, note: `Scale cast-on by gauge ratio ${round2(gb.sts / ga.sts)}.` });
  }
  if (patternGauge.totalRows != null) {
    const newRows = Math.round(Number(patternGauge.totalRows) * (gb.rows / ga.rows));
    adjustments.push({ kind: 'row-count', from: patternGauge.totalRows, to: newRows, note: `Lengths hold only if you work ${round2(gb.rows / ga.rows)}× the rows.` });
  }
  if (patternGauge.meters != null) {
    const newMeters = round1(Number(patternGauge.meters) * (gb.sts / ga.sts) * (ga.rows / gb.rows));
    adjustments.push({ kind: 'yardage', from: patternGauge.meters, to: newMeters, note: 'Re-estimate metres for the new gauge and meterage.' });
  }

  const needle = round1(((b.needleRange.min || 0) + (b.needleRange.max || 0)) / 2);
  if (needle) adjustments.push({ kind: 'needle', from: a.needleRange, to: { mm: needle }, note: `Work at ${needle}mm to reach ${gb.sts} sts/10cm — swatch to confirm.` });

  if (Math.abs(gb.sts - ga.sts) > 1.5) {
    adjustments.push({ kind: 'gauge', from: `${ga.sts}/10cm`, to: `${gb.sts}/10cm`, note: 'Gauge is materially different — re-swatch before committing.' });
  }
  return adjustments;
}

function pctMap(fiber) {
  const list = Array.isArray(fiber) ? fiber : [];
  const m = new Map();
  for (const f of list) m.set(f.name, (m.get(f.name) || 0) + (Number(f.percentage) || 0));
  return m;
}

const WEIGHT_ORDER = ['lace', 'light-fingering', 'fingering', 'sport', 'dk', 'worsted', 'aran', 'bulky', 'super-bulky', 'jumbo'];
function weightClassGap(a, b) {
  const ia = WEIGHT_ORDER.indexOf(a), ib = WEIGHT_ORDER.indexOf(b);
  if (ia < 0 || ib < 0) return 0;
  return Math.abs(ia - ib);
}

function safeDeltaE(a, b) { try { return deltaE(a, b); } catch { return 999; } }
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(n))); }
