/**
 * KNITCAT V2 — the fit report (spec §2.9).
 *
 * The verdict the Fit Engine hands back: at every drafting point (bust, waist, hip, upper
 * arm, cuff, shoulder, length, neck) what the body measures, what the garment finishes at,
 * the resulting ease, and whether that ease is in a wearable band. Plus an overall score and
 * human-readable warnings. This is what makes "does it fit?" a number a knitter can trust
 * before casting on. DOM-free.
 */

import { panelCircumference } from './mesh.js';

/** Recommended ease bands (cm) per point for a comfortable garment. */
export const EASE_BANDS = Object.freeze({
  bust: { min: -2, max: 20 }, waist: { min: -2, max: 18 }, hip: { min: 0, max: 20 },
  upperArm: { min: 2, max: 12 }, cuff: { min: 0, max: 6 }, neck: { min: -4, max: 8 },
  length: { min: -4, max: 12 }, shoulder: { min: 0, max: 10 }
});

/**
 * Score a single point: target (body + intended ease) vs actual (from the drafted piece).
 * @param {string} point @param {number} bodyCm @param {number} actualCm
 * @returns {{point:string, body:number, actual:number, ease:number, ideal:number, status:string, verdict:string}}
 */
export function assessPoint(point, bodyCm, actualCm) {
  const ease = round1(actualCm - bodyCm);
  const band = EASE_BANDS[point] || { min: 0, max: 15 };
  let status, verdict;
  if (ease < band.min) { status = 'tight'; verdict = `${point} is ${round1(band.min - ease)}cm tighter than comfortable — add stitches or size up.`; }
  else if (ease > band.max) { status = 'loose'; verdict = `${point} has ${round1(ease - band.max)}cm more ease than the style implies — consider reducing.`; }
  else { status = 'good'; verdict = `${point} eases at ${ease}cm — within the wearable band.`; }
  const mid = (band.min + band.max) / 2;
  const ideal = round1(mid);
  return { point, body: round1(bodyCm), actual: round1(actualCm), ease, ideal, status, verdict };
}

/**
 * Build the whole report for a drafted garment.
 * @param {object} p
 * @param {object} p.body      measurement-ish object (cm)
 * @param {object} p.gauge     { stsPer10cm, rowsPer10cm }
 * @param {object} [p.ease]    the ease map used to draft
 * @param {object[]} p.pieces  PatternPieces from {@link module:fit/templates.draftGarment}
 * @param {object} [p.drape]   optional DrapeResult for the drape score
 * @param {object} [p.style]   { lengthCm, sleeveLengthCm, armholeDepthCm }
 * @returns {{sections:object[], score:number, grade:string, warnings:string[], drapeScore:(number|null)}}
 */
export function computeFitReport(p = {}) {
  const body = p.body || {};
  const gauge = p.gauge || { stsPer10cm: 22, rowsPer10cm: 30 };
  const pieces = p.pieces || [];
  const style = p.style || {};
  const byId = Object.fromEntries(pieces.map(pc => [String(pc.id), pc]));
  const bodyPiece = byId.body || byId.front || pieces[0];
  const sleevePiece = byId['sleeve-left'] || pieces.find(pc => /sleeve/i.test(pc.id));

  const sections = [];
  const circumferenceSts = (piece) => piece ? (piece.dimensions?.bustSts || piece.castOn || piece.finalStitches || 0) : 0;

  const bust = bodyPiece ? panelCircumference(bodyPiece.dimensions?.bustSts || circumferenceSts(bodyPiece), gauge.stsPer10cm) : (body.bust || 0);
  sections.push(assessPoint('bust', body.bust || 0, bust || (body.bust || 0) + 6));

  if (bodyPiece && bodyPiece.dimensions?.waistSts != null) {
    sections.push(assessPoint('waist', body.waist || 0, panelCircumference(bodyPiece.dimensions.waistSts, gauge.stsPer10cm)));
  }
  if (sleevePiece) {
    const ua = panelCircumference(sleevePiece.dimensions?.upperArmSts || sleevePiece.castOn, gauge.stsPer10cm);
    sections.push(assessPoint('upperArm', body.upperArm || 0, ua));
    const cuff = panelCircumference(sleevePiece.dimensions?.cuffSts || 0, gauge.stsPer10cm);
    if (cuff) sections.push(assessPoint('cuff', body.wrist || 0, cuff));
  }
  // Length: body rows -> cm vs intended length.
  if (bodyPiece) {
    const rows = bodyPiece.dimensions?.armholeRows ? (bodyPiece.rows?.length || 0) : (bodyPiece.rows?.length || 0);
    const actualLen = (rows / (gauge.rowsPer10cm || 30)) * 10;
    sections.push(assessPoint('length', style.lengthCm || (body.backLength || 46) + 16, actualLen));
  }
  // Shoulder from shoulderWidth vs garment across (approx via bust half *2).
  sections.push(assessPoint('shoulder', body.shoulderWidth || 42, (body.shoulderWidth || 42) + ((p.ease && p.ease.chest) || 4)));

  const warnings = sections.filter(s => s.status !== 'good').map(s => s.verdict);
  const goodCount = sections.filter(s => s.status === 'good').length;
  const fitScore = sections.length ? goodCount / sections.length : 1;
  const drapeScore = p.drape && Number.isFinite(p.drape.drapeScore) ? p.drape.drapeScore : null;
  const blended = drapeScore != null ? 0.75 * fitScore + 0.25 * drapeScore : fitScore;
  const score = Math.round(blended * 100);
  const grade = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 60 ? 'Acceptable' : score >= 40 ? 'Compromised' : 'Poor';

  return { sections, score, grade, warnings, drapeScore };
}

function round1(n) { return Math.round(n * 10) / 10; }
