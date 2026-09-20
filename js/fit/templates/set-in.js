/**
 * KNITCAT V2 — set-in sleeve constructions.
 *
 * The set-in sleeve is the tailored look: a curved armhole in the body and a shaped sleeve
 * cap that eases into it, seamed at the shoulder. It is the hardest to get right by hand and
 * the one that most betrays a machine-knit garment as professional. Two directions:
 *
 *   - {@link bottomUpSetIn}  body to a shaped armhole, sleeves with a cap shaped to match,
 *                            then sew the cap in.
 *   - {@link topDownSetIn}   work the body with a straight-ish armhole, pick up around it,
 *                            short-row the cap, then work the sleeve down.
 *
 * The sleeve cap is where set-in lives or dies; the cap increase/decrease schedule here
 * mirrors the armhole depth so cap height = armhole depth, and the ease at the cap is the
 * classic 5-10% extra. DOM-free.
 *
 * @module fit/templates/set-in
 */

import {
  piece, ribRows, knitRows, distributedDecreases, distributedIncreases,
  underarmBindOff, stsFor, rowsFor, toMultiple
} from './_helpers.js';
import { shortRowSchedule } from '../short-rows.js';

function sharedDims(body, gauge, ease, style) {
  const bustSts = stsFor((body.bust || 90) + (ease.bust || ease.chest || 6), gauge.stsPer10cm || 22);
  const hipSts = stsFor((body.hip || body.bust || 90) + (ease.hip || 4), gauge.stsPer10cm || 22);
  const waistSts = stsFor((body.waist || body.bust || 90) + (ease.waist || 4), gauge.stsPer10cm || 22);
  const cuffSts = toMultiple(stsFor((body.wrist || 18) * 1.1, gauge.stsPer10cm || 22), 2);
  const upperArmSts = stsFor((body.upperArm || 30) + (ease.arm || 6), gauge.stsPer10cm || 22);
  const underarmSts = Math.round(bustSts * 0.09);
  const shoulderSts = stsFor((body.shoulderWidth || 42) / 2, gauge.stsPer10cm || 22);
  const armholeDepthCm = style.armholeDepthCm || 20;
  const bodyLenCm = style.lengthCm || 62;
  const sleeveLenCm = style.sleeveLengthCm || 46;
  return {
    bustSts, hipSts, waistSts, cuffSts, upperArmSts, underarmSts, shoulderSts,
    hemRows: rowsFor(style.hemHeightCm || 5, gauge.rowsPer10cm || 30),
    cuffRows: rowsFor(style.cuffHeightCm || 5, gauge.rowsPer10cm || 30),
    bodyRowsToArmhole: rowsFor(bodyLenCm - armholeDepthCm, gauge.rowsPer10cm || 30),
    armholeRows: rowsFor(armholeDepthCm, gauge.rowsPer10cm || 30),
    sleeveRows: rowsFor(sleeveLenCm, gauge.rowsPer10cm || 30),
    capEasePct: style.capEasePct || 0.07,
    bodyLenCm, sleeveLenCm, armholeDepthCm
  };
}

/** Bottom-up set-in sleeve: front + back bodies and two capped sleeves, sewn together. */
export function bottomUpSetIn(body, gauge, ease, style = {}) {
  const d = sharedDims(body, gauge, ease, style);
  const halfBust = Math.round(d.bustSts / 2);
  const pieces = [];

  for (const face of ['front', 'back']) {
    const segs = [
      ribRows(d.hemRows, d.hipSts / 2 | 0, style.hemStyle || 'rib2x2'),
      distributedDecreases((d.hipSts - d.waistSts) / 2 | 0, Math.round(d.bodyRowsToArmhole * 0.4), 'both'),
      distributedIncreases((d.bustSts - d.waistSts) / 2 | 0, Math.round(d.bodyRowsToArmhole * 0.4), 'both'),
      knitRows(Math.max(0, d.bodyRowsToArmhole - Math.round(d.bodyRowsToArmhole * 0.8))),
      underarmBindOff(d.underarmSts, 1),
      distributedDecreases(halfBust - d.underarmSts * 2 - d.shoulderSts, d.armholeRows, 'both')
    ];
    pieces.push(piece({
      id: face, name: `${face[0].toUpperCase()}${face.slice(1)}`, castOn: Math.round(d.hipSts / 2),
      segments: segs, extra: { seams: [{ with: face === 'front' ? 'back' : 'front', edge: 'shoulder' }], dimensions: { shoulderSts: d.shoulderSts, armholeRows: d.armholeRows } }
    }));
  }

  for (const side of ['left', 'right']) {
    // Sleeve cap: increase to upper arm + ease, then shape the cap down over the armhole rows.
    const capSts = Math.round((d.upperArmSts + 2 * d.underarmSts) * (1 + d.capEasePct));
    const segs = [
      ribRows(d.cuffRows, d.cuffSts, style.cuffStyle || 'rib2x2'),
      distributedIncreases(capSts - d.cuffSts, Math.max(1, d.sleeveRows - d.cuffRows - d.armholeRows), 'both'),
      knitRows(2),
      underarmBindOff(d.underarmSts, 1),
      distributedDecreases(capSts - d.underarmSts * 2 - 2 * d.shoulderSts, d.armholeRows, 'both')
    ];
    pieces.push(piece({
      id: `sleeve-${side}`, name: `Sleeve (${side})`, castOn: d.cuffSts, segments: segs,
      extra: { seams: [{ with: 'front', edge: 'armhole' }], dimensions: { capSts, upperArmSts: d.upperArmSts } }
    }));
  }
  return pieces;
}

/** Top-down set-in: straight body with an armhole opening, pick up + short-row the cap, down. */
export function topDownSetIn(body, gauge, ease, style = {}) {
  const d = sharedDims(body, gauge, ease, style);
  const neckSts = stsFor((body.neck || 40) * 0.5, gauge.stsPer10cm || 22);
  const pieces = [];

  pieces.push(piece({
    id: 'body', name: 'Body (top-down set-in)', castOn: d.bustSts,
    segments: [
      knitRows(Math.max(0, d.bodyRowsToArmhole)),
      // Open the armhole: put underarm sts on hold, divide for sleeves, continue body.
      [{ row: 1, action: 'bind-off', count: d.underarmSts * 2, position: 'both', notes: 'hold/move underarm sts for armhole' }],
      distributedDecreases((d.bustSts - d.waistSts) / 2 | 0, Math.round(d.bodyRowsToArmhole * 0.4), 'both'),
      distributedIncreases((d.hipSts - d.waistSts) / 2 | 0, Math.round(d.bodyRowsToArmhole * 0.4), 'both'),
      ribRows(d.hemRows, d.hipSts / 2 | 0, style.hemStyle || 'rib2x2')
    ],
    extra: { dimensions: { neckSts, armholeRows: d.armholeRows } }
  }));

  for (const side of ['left', 'right']) {
    const picked = d.upperArmSts + 2 * d.underarmSts;
    const capSR = shortRowSchedule({ method: 'shoulder', totalStitches: picked, extraRows: d.armholeRows, anchor: side === 'left' ? 'left' : 'right' });
    const segs = [
      [{ row: 1, action: 'join', count: picked, position: 'distributed', notes: `pick up ${picked} around armhole` }],
      capSR.rows,
      knitRows(Math.max(0, d.sleeveRows - d.cuffRows - d.armholeRows)),
      distributedDecreases(picked - d.cuffSts, Math.round(d.sleeveRows * 0.4), 'both'),
      ribRows(d.cuffRows, d.cuffSts, style.cuffStyle || 'rib2x2')
    ];
    pieces.push(piece({
      id: `sleeve-${side}`, name: `Sleeve (${side})`, castOn: picked, segments: segs,
      extra: { pickUp: { from: 'body', edge: 'armhole', count: picked }, dimensions: { capRows: capSR.turns } }
    }));
  }
  return pieces;
}

export { sharedDims };
