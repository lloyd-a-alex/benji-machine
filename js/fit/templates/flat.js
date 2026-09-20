/**
 * KNITCAT V2 — one-piece and flat-lay constructions.
 *
 * The remaining four templates are the ones that avoid the standard sleeve altogether —
 * prized by machine knitters because they minimize or eliminate set-in seaming:
 *
 *   - {@link dolman}         body and sleeves in one piece, a deep angled "armline" created
 *                            by increasing from the hem outward and back in — no shoulder or
 *                            armhole seam, one continuous fabric with a diamond under the arm.
 *   - {@link kimono}         a literal T: one flat rectangle body with two rectangular sleeve
 *                            extensions, minimal shaping, side and underarm seams only.
 *   - {@link sideToSide}     knit from one side seam to the other across the shoulders, with
 *                            short rows squaring off the shoulders and neck; sleeves are part
 *                            of the same run.
 *   - {@link seamlessHybrid} bottom-up body + top-down sleeves joined at the shoulder — the
 *                            machine-knitter's "no seaming at all" construction.
 *
 * DOM-free.
 *
 * @module fit/templates/flat
 */

import {
  piece, ribRows, knitRows, distributedDecreases, distributedIncreases,
  stsFor, rowsFor, toMultiple
} from './_helpers.js';
import { shortRowSchedule } from '../short-rows.js';

/** Dolman / butterfly: one piece, angled armline worked by increases from the underarm. */
export function dolman(body, gauge, ease, style = {}) {
  const spc = gauge.stsPer10cm || 22;
  const rpc = gauge.rowsPer10cm || 30;
  const neckWidthSts = stsFor(style.neckWidthCm || 20, spc);
  const halfBust = Math.round(stsFor((body.bust || 90) + (ease.bust || 6), spc) / 2);
  const sleeveWidthSts = stsFor((body.upperArm || 30) + (ease.arm || 6), spc);
  const totalAcross = neckWidthSts + 2 * (sleeveWidthSts + halfBust); // neck + 2*(sleeve+body)
  const bodyRows = rowsFor(style.lengthCm || 60, rpc);
  const underarmSts = halfBust; // vertical distance represented in sts for the armline
  const pieces = [];

  // Worked as one flat piece from cuff to cuff across the top, then down both fronts.
  pieces.push(piece({
    id: 'body', name: 'Dolman body (one piece)', castOn: neckWidthSts,
    segments: [
      // Left sleeve out, left body down: increase toward the underarm.
      distributedIncreases(sleeveWidthSts, rowsFor(style.sleeveLengthCm || 40, rpc), 'left'),
      knitRows(2),
      distributedIncreases(halfBust, rowsFor((style.lengthCm || 60) * 0.5, rpc), 'left'),
      // Mirror: this is a schematic single-panel; compiler renders the Cuff→Cuff band.
      ...knitRows(bodyRows).slice(0, 1),
      distributedDecreases(halfBust, rowsFor((style.lengthCm || 60) * 0.5, rpc), 'right'),
      distributedDecreases(sleeveWidthSts, rowsFor(style.sleeveLengthCm || 40, rpc), 'right')
    ],
    extra: { dimensions: { totalAcross, neckWidthSts, sleeveWidthSts, underarmSts } }
  }));
  return pieces;
}

/** Kimono: a flat T of rectangles, seamed at sides and underarms. */
export function kimono(body, gauge, ease, style = {}) {
  const spc = gauge.stsPer10cm || 22;
  const rpc = gauge.rowsPer10cm || 30;
  const backWidth = stsFor((body.bust || 90) / 2 + (ease.bust || 6), spc);
  const sleeveWidth = stsFor((body.upperArm || 30) + (ease.arm || 4), spc);
  const frontPanel = Math.round(backWidth / 2);
  const lengthRows = rowsFor(style.lengthCm || 65, rpc);
  const sleeveRows = rowsFor(style.sleeveLengthCm || 40, rpc);
  const pieces = [];

  pieces.push(piece({ id: 'back', name: 'Back panel', castOn: backWidth, segments: [knitRows(lengthRows)], extra: { dimensions: { widthSts: backWidth } } }));
  for (const side of ['left', 'right']) {
    pieces.push(piece({ id: `front-${side}`, name: `Front ${side}`, castOn: frontPanel, segments: [knitRows(lengthRows)], extra: { seams: [{ with: 'back', edge: 'shoulder' }] } }));
  }
  for (const side of ['left', 'right']) {
    pieces.push(piece({ id: `sleeve-${side}`, name: `Sleeve (${side})`, castOn: sleeveWidth, segments: [knitRows(sleeveRows)], extra: { seams: [{ with: `front-${side}`, edge: 'underarm' }] } }));
  }
  return pieces;
}

/** Side-to-side: knit horizontally across the body, short rows square the shoulders/neck. */
export function sideToSide(body, gauge, ease, style = {}) {
  const spc = gauge.stsPer10cm || 22;
  const rpc = gauge.rowsPer10cm || 30;
  // Here "cast on" is the vertical length across the body; rows run horizontally.
  const bodyLengthSts = stsFor(style.lengthCm || 60, spc);
  const acrossRows = rowsFor((body.bust || 90) + (ease.bust || 6), rpc);
  const pieces = [];

  const shoulderSR = shortRowSchedule({ method: 'neck', totalStitches: bodyLengthSts, extraRows: rowsFor(style.shoulderSlopeCm || 5, rpc), anchor: 'both' });
  const segs = [
    knitRows(Math.max(1, Math.floor(acrossRows / 4))),
    shoulderSR.rows,
    knitRows(Math.max(1, Math.floor(acrossRows / 2))),
    shoulderSR.rows.slice().reverse(),
    knitRows(Math.max(1, Math.floor(acrossRows / 4)))
  ];
  pieces.push(piece({
    id: 'body', name: 'Body (side-to-side)', castOn: bodyLengthSts, segments: segs,
    extra: { dimensions: { bodyLengthSts, acrossRows } }
  }));
  for (const side of ['left', 'right']) {
    const sleeveLenSts = stsFor((style.sleeveLengthCm || 46), spc);
    pieces.push(piece({
      id: `sleeve-${side}`, name: `Sleeve (${side})`, castOn: sleeveLenSts,
      segments: [knitRows(rowsFor((body.upperArm || 30) + (ease.arm || 6), rpc))],
      extra: { pickUp: { from: 'body', edge: 'armhole', count: sleeveLenSts } }
    }));
  }
  return pieces;
}

/** Seamless hybrid: bottom-up body, top-down sleeves, joined at the shoulder — no seaming. */
export function seamlessHybrid(body, gauge, ease, style = {}) {
  const spc = gauge.stsPer10cm || 22;
  const rpc = gauge.rowsPer10cm || 30;
  const bustSts = stsFor((body.bust || 90) + (ease.bust || 6), spc);
  const hipSts = stsFor((body.hip || body.bust || 90) + (ease.hip || 4), spc);
  const cuffSts = toMultiple(stsFor((body.wrist || 18) * 1.1, spc), 2);
  const upperArmSts = stsFor((body.upperArm || 30) + (ease.arm || 6), spc);
  const neckSts = stsFor((body.neck || 40) * 0.85, spc);
  const bodyRows = rowsFor(style.lengthCm || 62, rpc);
  const raglanRows = rowsFor(style.armholeDepthCm || 20, rpc);
  const pieces = [];

  // Body from the hem up to the underarm, worked in the round.
  pieces.push(piece({
    id: 'body', name: 'Body (bottom-up, seamless)', castOn: hipSts,
    segments: [
      ribRows(rowsFor(style.hemHeightCm || 5, rpc), hipSts, style.hemStyle || 'rib2x2'),
      distributedIncreases(bustSts - hipSts, Math.round(bodyRows * 0.4), 'both'),
      knitRows(Math.max(0, bodyRows - rowsFor(style.hemHeightCm || 5, rpc) - Math.round(bodyRows * 0.4))),
      [{ row: 1, action: 'bind-off', count: Math.round(bustSts * 0.08) * 2, position: 'both', notes: 'place underarm sts to hold' }]
    ],
    extra: { join: ['yoke'], dimensions: { bustSts } }
  }));

  // Sleeves top-down from the shoulder, joined to the body at the underarm hold.
  for (const side of ['left', 'right']) {
    pieces.push(piece({
      id: `sleeve-${side}`, name: `Sleeve (${side}, top-down)`, castOn: upperArmSts,
      segments: [
        knitRows(Math.max(0, Math.round(raglanRows * 0.5))),
        distributedDecreases(upperArmSts - cuffSts, rowsFor((style.sleeveLengthCm || 46), rpc), 'both'),
        ribRows(rowsFor(style.cuffHeightCm || 5, rpc), cuffSts, style.cuffStyle || 'rib2x2')
      ],
      extra: { join: ['body'] }
    }));
  }

  // Yoke joins live body + sleeve sts and closes with raglan decreases + neck.
  const joinSts = bustSts + 2 * upperArmSts - 2 * Math.round(bustSts * 0.08);
  pieces.push(piece({
    id: 'yoke', name: 'Yoke (hybrid join)', castOn: joinSts,
    segments: [
      [{ row: 1, action: 'join', count: joinSts, position: 'distributed', notes: 'join body + both sleeves' }],
      distributedDecreases(Math.max(0, joinSts - neckSts), raglanRows, 'four-lines')
    ],
    extra: { join: ['body', 'sleeve-left', 'sleeve-right'], dimensions: { neckSts } }
  }));
  return pieces;
}
