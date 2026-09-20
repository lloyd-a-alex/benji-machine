/**
 * KNITCAT V2 — the raglan construction family.
 *
 * Four of the twelve templates share the raglan geometry (diagonal lines from underarm to
 * neck); they differ only in direction and where the sleeve meets the body. This module
 * implements all four from the shared {@link module:fit/templates/_helpers.raglanTargets}
 * so a size or gauge change rewrites every one of them identically:
 *
 *   - {@link bottomUpRaglan}     body + sleeves knit to the armhole, joined, then 4 lines
 *                                of decreases carried to the neck (the spec §11.2 flagship).
 *   - {@link topDownRaglan}      start at the neck, increase along 4 lines, divide at the
 *                                underarm, then work sleeves down.
 *   - {@link modifiedRaglan}     raglan with a horizontal shoulder "saddle" inset — a flattened
 *                                cap that sits on the shoulder before the diagonal begins.
 *   - {@link saddleShoulder}     body to the shoulder, a strap knit across, sleeve picked up
 *                                from the strap.
 *
 * Each returns an array of {@link PatternPiece}. DOM-free.
 *
 * @module fit/templates/raglan
 */

import {
  piece, ribRows, knitRows, distributedDecreases, distributedIncreases,
  underarmBindOff, neckShaping, raglanTargets, stsFor, rowsFor
} from './_helpers.js';

/**
 * Bottom-up raglan (spec §11.2). Body knit flat/circular to the armhole, sleeves to the
 * armhole, joined, raglan decreases to the neck, then a picked-up collar.
 * @param {object} body @param {object} gauge @param {object} ease @param {object} [style]
 * @returns {object[]} PatternPieces
 */
export function bottomUpRaglan(body, gauge, ease, style = {}) {
  const t = raglanTargets(body, gauge, ease, style);
  const pieces = [];

  // BODY: cast on at hip, rib hem, taper to waist, widen to bust, straight to armhole,
  // bind off the underarms, leave live for the yoke.
  const bodySegs = [
    ribRows(t.hemRows, t.hipSts, style.hemStyle || 'rib2x2'),
    distributedDecreases(t.hipSts - t.waistSts, Math.max(1, Math.round(t.bodyRowsToArmhole * 0.4)), 'both'),
    distributedIncreases(t.bustSts - t.waistSts, Math.max(1, Math.round(t.bodyRowsToArmhole * 0.4)), 'both'),
    knitRows(Math.max(0, t.bodyRowsToArmhole - Math.round(t.bodyRowsToArmhole * 0.8))),
    underarmBindOff(t.underarmSts, 1)
  ];
  pieces.push(piece({
    id: 'body', name: 'Body', castOn: t.hipSts, segments: bodySegs,
    extra: {
      seams: [{ with: 'sleeve-left', edge: 'underarm-to-cuff' }, { with: 'sleeve-right', edge: 'underarm-to-cuff' }],
      dimensions: { bustSts: t.bustSts, hipSts: t.hipSts, waistSts: t.waistSts, armholeRows: t.armholeRows, lengthCm: t.totalLengthCm }
    }
  }));

  // SLEEVES x2: cast on at cuff, rib, increase to upper arm, bind off underarm, live for yoke.
  for (const side of ['left', 'right']) {
    const segs = [
      ribRows(t.cuffRows, t.cuffSts, style.cuffStyle || 'rib2x2'),
      distributedIncreases(t.upperArmSts - t.cuffSts, Math.max(1, t.sleeveRows - t.cuffRows - 2), 'both'),
      underarmBindOff(t.underarmSts, 1)
    ];
    pieces.push(piece({
      id: `sleeve-${side}`, name: `Sleeve (${side})`, castOn: t.cuffSts, segments: segs,
      extra: { dimensions: { upperArmSts: t.upperArmSts, cuffSts: t.cuffSts, sleeveLenCm: t.sleeveLenCm } }
    }));
  }

  // YOKE: join all live sts, 4 lines of 8-st decreases every other row, then neck.
  const joinSts = (t.bustSts - 2 * t.underarmSts) + 2 * (t.upperArmSts - 2 * t.underarmSts);
  const yokeSegs = [
    [{ row: 1, action: 'join', count: joinSts, position: 'distributed', notes: `join body + sleeves: ${joinSts} sts` }],
    distributedDecreases(Math.max(0, joinSts - t.neckSts), t.raglanRows, 'four-lines'),
    neckShaping(t.neckSts + stsFor(6, gauge.stsPer10cm), t.neckSts, rowsFor(style.neckDepthCm || 6, gauge.rowsPer10cm))
  ];
  pieces.push(piece({
    id: 'yoke', name: 'Yoke', castOn: joinSts, segments: yokeSegs,
    extra: { join: ['body', 'sleeve-left', 'sleeve-right'], dimensions: { raglanDecPerLine: t.raglanDecPerLine, neckSts: t.neckSts } }
  }));

  // COLLAR picked up around the neck.
  const collarSts = t.neckSts;
  pieces.push(piece({
    id: 'collar', name: 'Collar', castOn: collarSts,
    segments: [ribRows(rowsFor(style.collarHeightCm || 4, gauge.rowsPer10cm), collarSts, style.collarStyle || 'rib1x1')],
    extra: { pickUp: { from: 'yoke', edge: 'neckline', count: collarSts } }
  }));

  return pieces;
}

/**
 * Top-down raglan: neck band, increase 8 sts per RS row along 4 lines to the underarm, divide
 * for sleeves, work body down, then sleeves down from held sts.
 */
export function topDownRaglan(body, gauge, ease, style = {}) {
  const t = raglanTargets(body, gauge, ease, style);
  const neckStart = Math.max(8, Math.round(t.neckSts * 0.5));
  // Stitches at the divide = full bust + 2 upper arms (minus underarm held for sleeves later).
  const divideSts = t.bustSts + 2 * t.upperArmSts;
  const growRows = Math.max(2, t.raglanRows);
  const pieces = [];

  pieces.push(piece({
    id: 'yoke', name: 'Yoke (top-down)', castOn: neckStart,
    segments: [
      ribRows(rowsFor(style.collarHeightCm || 3, gauge.rowsPer10cm), neckStart, style.collarStyle || 'rib1x1'),
      distributedIncreases(Math.max(0, divideSts - neckStart), growRows, 'four-lines')
    ],
    extra: { join: ['body', 'sleeve-left', 'sleeve-right'], dimensions: { neckStart, divideSts } }
  }));

  // Body: from front/back sts at divide down; cast on underarm sts, work even to hem.
  const bodySts = t.bustSts + 2 * t.underarmSts;
  pieces.push(piece({
    id: 'body', name: 'Body (top-down)', castOn: bodySts,
    segments: [
      knitRows(Math.max(0, t.bodyRowsToArmhole)),
      distributedDecreases(t.bustSts - t.waistSts, Math.round(t.bodyRowsToArmhole * 0.35), 'both'),
      distributedIncreases(t.hipSts - t.waistSts, Math.round(t.bodyRowsToArmhole * 0.35), 'both'),
      ribRows(t.hemRows, t.hipSts, style.hemStyle || 'rib2x2')
    ],
    extra: { dimensions: { bodySts, lengthCm: t.totalLengthCm } }
  }));

  for (const side of ['left', 'right']) {
    const sleeveSts = t.upperArmSts + 2 * t.underarmSts;
    pieces.push(piece({
      id: `sleeve-${side}`, name: `Sleeve (${side})`, castOn: sleeveSts,
      segments: [
        knitRows(Math.max(0, Math.round(t.sleeveRows * 0.6))),
        distributedDecreases(sleeveSts - t.cuffSts, Math.round(t.sleeveRows * 0.4), 'both'),
        ribRows(t.cuffRows, t.cuffSts, style.cuffStyle || 'rib2x2')
      ],
      extra: { pickUp: { from: 'yoke', edge: 'armhole', count: sleeveSts }, dimensions: { sleeveLenCm: t.sleeveLenCm } }
    }));
  }
  return pieces;
}

/**
 * Modified raglan: a flat "saddle" panel sits on each shoulder; the raglan diagonal starts
 * only above the armhole, giving a set-in look with raglan ease of construction.
 */
export function modifiedRaglan(body, gauge, ease, style = {}) {
  const t = raglanTargets(body, gauge, ease, style);
  const saddleWidth = stsFor(style.saddleCm || 5, gauge.stsPer10cm);
  const saddleSts = Math.max(saddleWidth, Math.round(t.neckSts * 0.18));
  const bodyShoulderSts = t.bustSts - 2 * saddleSts;
  const pieces = [];

  pieces.push(piece({
    id: 'body', name: 'Body (modified raglan)', castOn: t.hipSts,
    segments: [
      ribRows(t.hemRows, t.hipSts, style.hemStyle || 'rib2x2'),
      distributedDecreases(t.hipSts - t.waistSts, Math.round(t.bodyRowsToArmhole * 0.4), 'both'),
      distributedIncreases(bodyShoulderSts - t.waistSts, Math.round(t.bodyRowsToArmhole * 0.4), 'both'),
      knitRows(Math.max(0, t.armholeRows - t.bodyRowsToArmhole * 0 < 0 ? 0 : 2)),
      underarmBindOff(t.underarmSts, 1)
    ],
    extra: { seams: [{ with: 'saddle-left' }, { with: 'saddle-right' }], dimensions: { bodyShoulderSts, saddleSts } }
  }));

  for (const side of ['left', 'right']) {
    pieces.push(piece({
      id: `saddle-${side}`, name: `Saddle (${side})`, castOn: saddleSts,
      segments: [
        knitRows(t.armholeRows),
        distributedDecreases(saddleSts - Math.round(saddleSts * 0.5), Math.round(t.raglanRows * 0.5), 'both')
      ],
      extra: { dimensions: { saddleSts } }
    }));
    const sleeveSts = t.upperArmSts + 2 * t.underarmSts;
    pieces.push(piece({
      id: `sleeve-${side}`, name: `Sleeve (${side})`, castOn: sleeveSts,
      segments: [
        knitRows(Math.max(0, t.sleeveRows - t.cuffRows)),
        distributedDecreases(sleeveSts - t.cuffSts, Math.round(t.sleeveRows * 0.4), 'both'),
        ribRows(t.cuffRows, t.cuffSts, style.cuffStyle || 'rib2x2')
      ],
      extra: { pickUp: { from: `saddle-${side}`, edge: 'saddle-edge', count: sleeveSts } }
    }));
  }
  return pieces;
}

/**
 * Saddle shoulder: body worked to the shoulder line, a shoulder strap knit separately across
 * the top, sleeves worked from stitches picked up off the strap and side of the body.
 */
export function saddleShoulder(body, gauge, ease, style = {}) {
  const t = raglanTargets(body, gauge, ease, style);
  const strapSts = Math.max(6, stsFor(style.strapWidthCm || 4, gauge.stsPer10cm));
  const pieces = [];

  pieces.push(piece({
    id: 'body', name: 'Body (saddle shoulder)', castOn: t.hipSts,
    segments: [
      ribRows(t.hemRows, t.hipSts, style.hemStyle || 'rib2x2'),
      distributedDecreases(t.hipSts - t.waistSts, Math.round(t.bodyRowsToArmhole * 0.4), 'both'),
      distributedIncreases(t.bustSts - t.waistSts, Math.round(t.bodyRowsToArmhole * 0.4), 'both'),
      knitRows(t.armholeRows),
      // leave shoulder sts live except the two front/back neck groups
      neckShaping(t.bustSts, t.bustSts - stsFor(style.neckWidthCm || 18, gauge.stsPer10cm), rowsFor(style.neckDepthCm || 8, gauge.rowsPer10cm))
    ],
    extra: { seams: [{ with: 'strap-left' }, { with: 'strap-right' }], dimensions: { neckSts: t.neckSts } }
  }));

  for (const side of ['left', 'right']) {
    pieces.push(piece({
      id: `strap-${side}`, name: `Shoulder strap (${side})`, castOn: strapSts,
      segments: [knitRows(rowsFor(style.crossShoulderCm || (body.shoulderWidth ? body.shoulderWidth / 2 : 20), gauge.rowsPer10cm))],
      extra: { dimensions: { strapSts } }
    }));
    const sleeveSts = t.upperArmSts + strapSts;
    pieces.push(piece({
      id: `sleeve-${side}`, name: `Sleeve (${side})`, castOn: sleeveSts,
      segments: [
        knitRows(Math.max(0, t.sleeveRows - t.cuffRows - t.armholeRows)),
        distributedDecreases(sleeveSts - t.cuffSts, Math.round(t.sleeveRows * 0.4), 'both'),
        ribRows(t.cuffRows, t.cuffSts, style.cuffStyle || 'rib2x2')
      ],
      extra: { pickUp: { from: `strap-${side}`, edge: 'strap+body', count: sleeveSts } }
    }));
  }
  return pieces;
}
