/**
 * KNITCAT V2 — yoke and drop-shoulder constructions.
 *
 *   - {@link circularYoke}   the Nordic/Loppy shape: body knit to the underarm, sleeves knit
 *                            to the underarm, all joined on one circular needle, then the
 *                            yoke worked upward in the round with colourwork and a series of
 *                            decrease stages (the "fair isle yoke"). No shoulder seams.
 *   - {@link dropShoulder}   the easy boxy one: body to a straight underarm, sleeves straight,
 *                            a rectangular shoulder yoke joins them — no cap, no raglan line.
 *
 * Circular-yoke decrease stages are laid out so the stitch count falls in tiers (bust→upper
 * arm→neck) rather than one long taper, which is how real yokes are written. DOM-free.
 *
 * @module fit/templates/yoke
 */

import {
  piece, ribRows, knitRows, distributedDecreases, distributedIncreases,
  underarmBindOff, stsFor, rowsFor, toMultiple
} from './_helpers.js';

/** Circular (fair-isle) yoke sweater. */
export function circularYoke(body, gauge, ease, style = {}) {
  const spc = gauge.stsPer10cm || 22;
  const rpc = gauge.rowsPer10cm || 30;
  const bustSts = stsFor((body.bust || 90) + (ease.bust || ease.chest || 6), spc);
  const hipSts = stsFor((body.hip || body.bust || 90) + (ease.hip || 4), spc);
  const upperArmSts = stsFor((body.upperArm || 30) + (ease.arm || 6), spc);
  const cuffSts = toMultiple(stsFor((body.wrist || 18) * 1.1, spc), 2);
  const underarmSts = Math.round(bustSts * 0.08);
  const neckSts = stsFor((body.neck || 40) * 0.9, spc);
  const bodyRows = rowsFor((style.lengthCm || 62) - (style.armholeDepthCm || 18), rpc);
  const sleeveRows = rowsFor((style.sleeveLengthCm || 46), rpc);
  const yokeRows = rowsFor(style.armholeDepthCm || 18, rpc);
  const stages = Math.max(2, style.yokeStages || 3);
  const pieces = [];

  pieces.push(piece({
    id: 'body', name: 'Body', castOn: hipSts,
    segments: [
      ribRows(rowsFor(style.hemHeightCm || 5, rpc), hipSts, style.hemStyle || 'rib2x2'),
      distributedIncreases(bustSts - hipSts, Math.round(bodyRows * 0.5), 'both'),
      knitRows(Math.max(0, bodyRows - Math.round(bodyRows * 0.5))),
      underarmBindOff(underarmSts, 1)
    ],
    extra: { join: ['sleeve-left', 'sleeve-right', 'yoke'], dimensions: { bustSts } }
  }));

  for (const side of ['left', 'right']) {
    pieces.push(piece({
      id: `sleeve-${side}`, name: `Sleeve (${side})`, castOn: cuffSts,
      segments: [
        ribRows(rowsFor(style.cuffHeightCm || 5, rpc), cuffSts, style.cuffStyle || 'rib2x2'),
        distributedIncreases(upperArmSts - cuffSts, Math.max(1, sleeveRows - 6), 'both'),
        underarmBindOff(underarmSts, 1)
      ],
      extra: { join: ['body'] }
    }));
  }

  // The yoke itself: join all live sts, decrease in tiers, colourwork band, then neck.
  const joinSts = (bustSts - 2 * underarmSts) + 2 * (upperArmSts - 2 * underarmSts);
  const segs = [[{ row: 1, action: 'join', count: joinSts, position: 'distributed', notes: `join ${joinSts} sts for yoke` }]];
  let live = joinSts;
  const perStage = Math.ceil((joinSts - neckSts) / stages);
  for (let s = 0; s < stages; s++) {
    const to = Math.max(neckSts, live - perStage);
    const rows = Math.max(4, Math.round(yokeRows / stages));
    segs.push(distributedDecreases(live - to, rows, 'distributed'));
    if (style.colorwork !== false) segs.push([{ row: 1, action: 'yarn-change', count: 0, position: 'distributed', notes: `colourwork chart band (stage ${s + 1}/${stages})` }].concat(knitRows(Math.max(1, (style.chartRows || 8) - 1))));
    live = to;
  }
  pieces.push(piece({
    id: 'yoke', name: 'Yoke', castOn: joinSts, segments: segs,
    extra: { dimensions: { stages, neckSts, yokeRows } }
  }));

  return pieces;
}

/** Drop-shoulder sweater: boxy body and straight sleeves joined by a shoulder yoke. */
export function dropShoulder(body, gauge, ease, style = {}) {
  const spc = gauge.stsPer10cm || 22;
  const rpc = gauge.rowsPer10cm || 30;
  // Drop shoulder adds ease across the top of the arm — the seam sits past the shoulder point.
  const bustSts = stsFor((body.bust || 90) + (ease.bust || ease.chest || 6) + (style.dropCm || 8), spc);
  const hipSts = stsFor((body.hip || body.bust || 90) + (ease.hip || 4), spc);
  const cuffSts = toMultiple(stsFor((body.wrist || 18) * 1.15, spc), 2);
  const sleeveTopSts = stsFor((body.upperArm || 30) + (ease.arm || 6) + (style.dropCm || 8) * 2, spc);
  const bodyRows = rowsFor(style.lengthCm || 60, rpc);
  const sleeveRows = rowsFor((style.sleeveLengthCm || 46) + (style.dropCm || 8), rpc);
  const neckSts = stsFor((body.neck || 40) * 0.85, spc);
  const shoulderSts = stsFor((body.shoulderWidth || 42) / 2 + (style.dropCm || 8), spc);
  const pieces = [];

  const half = Math.round(bustSts / 2);
  for (const face of ['front', 'back']) {
    const segs = [
      ribRows(rowsFor(style.hemHeightCm || 5, rpc), Math.round(hipSts / 2), style.hemStyle || 'rib2x2'),
      distributedIncreases(half - Math.round(hipSts / 2), Math.round(bodyRows * 0.3), 'both'),
      knitRows(Math.max(0, bodyRows - rowsFor(style.hemHeightCm || 5, rpc) - Math.round(bodyRows * 0.3))),
      // shoulder: bind off; back neck leaves a gap
      ...((face === 'back')
        ? [{ row: 1, action: 'bind-off', count: shoulderSts, position: 'left' }, { row: 1, action: 'bind-off', count: shoulderSts, position: 'right' }]
        : [{ row: 1, action: 'bind-off', count: half, position: 'both', notes: 'bind off front shoulders + neck in one' }])
    ];
    pieces.push(piece({ id: face, name: face === 'front' ? 'Front' : 'Back', castOn: Math.round(hipSts / 2), segments: segs, extra: { dimensions: { neckSts, shoulderSts } } }));
  }

  for (const side of ['left', 'right']) {
    pieces.push(piece({
      id: `sleeve-${side}`, name: `Sleeve (${side})`, castOn: cuffSts,
      segments: [
        ribRows(rowsFor(style.cuffHeightCm || 5, rpc), cuffSts, style.cuffStyle || 'rib2x2'),
        distributedIncreases(sleeveTopSts - cuffSts, Math.max(1, sleeveRows - 6), 'both'),
        knitRows(4)
      ],
      extra: { seams: [{ with: 'front', edge: 'underarm-to-shoulder' }], dimensions: { sleeveTopSts } }
    }));
  }
  return pieces;
}
