/**
 * KNITCAT V2 — shared garment-drafting helpers.
 *
 * Every construction template is the same shape of computation: turn body measurements +
 * ease + gauge into a set of stitch/row targets, then lay those targets out as an explicit
 * row-by-row schedule for each piece. This module holds the primitives all twelve templates
 * reuse so they stay consistent and DRY — the conversions (cm↔sts↔rows), the row builders
 * (rib, distributed increases/decreases, neck shaping, armhole bind-offs), and a normalised
 * {@link PatternPiece} factory the compiler consumes.
 *
 * A {@link PatternPiece} is the unit of output for every template:
 *   { id, name, castOn, rows: ShapingRow[], finalStitches, seams, pickUp, join, dimensions }
 *
 * DOM-free; pure integer arithmetic.
 *
 * @module fit/templates/_helpers
 */

import { taperSchedule, knitEven, bindOff, joinSegments } from '../shaping-scheduler.js';
import { shortRowSchedule } from '../short-rows.js';

/** Stitches across a circumference (cm) at a gauge (sts per 10cm). */
export function stsFor(cm, stsPer10cm) {
  return Math.max(0, Math.round(((cm || 0) * (stsPer10cm || 0)) / 10));
}
/** Rows for a length (cm) at a row gauge (rows per 10cm). */
export function rowsFor(cm, rowsPer10cm) {
  return Math.max(0, Math.round(((cm || 0) * (rowsPer10cm || 0)) / 10));
}
/** Round a stitch count to the nearest multiple of `m` (keeps rib/repeat edges clean). */
export function toMultiple(n, m) {
  const mult = Math.max(1, m || 1);
  return Math.max(mult, Math.round(n / mult) * mult);
}

/**
 * A run of rib rows at the given stitch count — the elastic band of a hem/cuff.
 * @param {number} rows @param {number} stitches @param {string} [style='rib2x2']
 * @returns {import('../shaping-scheduler.js').ShapingRow[]}
 */
export function ribRows(rows, stitches, style = 'rib2x2') {
  const out = [];
  for (let r = 1; r <= Math.max(0, rows); r++) out.push({ row: r, action: 'knit', count: 0, position: 'both', notes: `${style} over ${stitches}` });
  return out;
}

/**
 * Work even (plain stockinette) for `rows`. @param {number} rows @returns {import('../shaping-scheduler.js').ShapingRow[]}
 */
export function knitRows(rows) {
  return knitEven(rows);
}

/**
 * Decrease `total` stitches distributed across `rows` at `position` (returns explicit rows).
 * @param {number} total @param {number} rows @param {import('../shaping-scheduler.js').ShapingRow['position']} [position='both']
 */
export function distributedDecreases(total, rows, position = 'both') {
  if (total <= 0) return knitRows(rows);
  const perEvent = position === 'four-lines' ? 8 : position === 'both' ? 2 : 1;
  return taperSchedule(total, 0, rows, { perEvent, position, label: 'dec' }).rows;
}

/** Increase `total` stitches distributed across `rows`. */
export function distributedIncreases(total, rows, position = 'both') {
  if (total <= 0) return knitRows(rows);
  const perEvent = position === 'both' ? 2 : 1;
  return taperSchedule(0, total, rows, { perEvent, position, label: 'inc' }).rows;
}

/**
 * Bind off `each` stitches at both ends (e.g. the underarm of a body or sleeve).
 * @param {number} each @param {number} [liveRows=1]
 */
export function underarmBindOff(each, liveRows = 1) {
  const bo = bindOff(each * 2, 'both');
  return bo.concat(knitEven(Math.max(0, liveRows - 1)));
}

/**
 * Neck shaping: from `fromSts` down to a `toSts` remaining, in `rows`, removing stitches in
 * a decreasing series at the centre (crew/V) — the classic "bind off X, then dec Y at neck
 * edge every other row" recipe.
 * @param {number} fromSts @param {number} toSts @param {number} rows
 * @returns {import('../shaping-scheduler.js').ShapingRow[]}
 */
export function neckShaping(fromSts, toSts, rows) {
  const total = Math.max(0, fromSts - toSts);
  const out = [];
  let row = 0;
  let remaining = total;
  // A chunky bind-off at centre front, then a gentle 1-2 st every-other-row taper.
  const centre = Math.round(total * 0.4);
  if (centre > 0) {
    row++;
    out.push({ row, action: 'bind-off', count: centre, position: 'centre', notes: `bind off ${centre} at centre neck` });
    remaining -= centre;
  }
  const eoRows = Math.max(1, Math.floor(rows / 2));
  let event = 0;
  while (remaining > 0 && event < eoRows) {
    const take = Math.min(remaining, Math.max(1, Math.ceil(remaining / (eoRows - event))));
    row++;
    out.push({ row, action: 'decrease', count: take, position: 'centre', notes: `dec ${take} at neck edge` });
    remaining -= take;
    row++; // a plain row between neck-edge decreases
    out.push({ row, action: 'knit', count: 0, position: 'both', notes: '' });
    event++;
  }
  return out;
}

/**
 * Assemble a normalised piece from segments (rib + body + shaping), tracking the running
 * stitch count and final stitches honestly.
 * @param {object} def
 * @param {string} def.id @param {string} def.name @param {number} def.castOn
 * @param {Array} def.segments ShapingRow[] or {rows} schedules, in order
 * @param {object} [def.extra] seams / pickUp / join / dimensions metadata
 * @returns {object} PatternPiece
 */
export function piece(def = {}) {
  const joined = joinSegments(def.segments || [], def.castOn || 0);
  return Object.assign(
    {
      id: def.id,
      name: def.name,
      castOn: def.castOn || 0,
      rows: joined.rows,
      totalRows: joined.totalRows,
      finalStitches: joined.finalStitches,
      seams: def.extra && def.extra.seams ? def.extra.seams : [],
      pickUp: def.extra && def.extra.pickUp ? def.extra.pickUp : null,
      join: def.extra && def.extra.join ? def.extra.join : null
    },
    def.extra && def.extra.dimensions ? { dimensions: def.extra.dimensions } : {}
  );
}

/**
 * The derived stitch/row targets a raglan family garment needs, computed once and shared by
 * bottom-up/top-down/modified/saddle templates so they never disagree.
 * @param {object} body @param {object} gauge {stsPer10cm,rowsPer10cm} @param {object} ease
 * @param {object} style { armholeDepthCm, lengthCm, sleeveLengthCm, neckWidthCm, hemStyle, cuffStyle }
 */
export function raglanTargets(body, gauge, ease, style = {}) {
  const spc = (gauge.stsPer10cm || 22) / 10;
  const rpc = (gauge.rowsPer10cm || 30) / 10;
  const bustSts = stsFor((body.bust || 90) + (ease.bust || ease.chest || 6), gauge.stsPer10cm || 22);
  const hipSts = stsFor((body.hip || body.bust || 90) + (ease.hip || 4), gauge.stsPer10cm || 22);
  const waistSts = stsFor((body.waist || body.bust || 90) + (ease.waist || 4), gauge.stsPer10cm || 22);
  const cuffSts = toMultiple(stsFor((body.wrist || 18) * 1.1, gauge.stsPer10cm || 22), 2);
  const upperArmSts = stsFor((body.upperArm || 30) + (ease.arm || 6), gauge.stsPer10cm || 22);
  const underarmSts = Math.round(bustSts * 0.08);
  const neckSts = stsFor((body.neck || 40) * 0.85, gauge.stsPer10cm || 22);
  const bodyLenCm = style.lengthCm || 62;
  const armholeDepthCm = style.armholeDepthCm || 22;
  const sleeveLenCm = style.sleeveLengthCm || 48;
  return {
    spc, rpc, bustSts, hipSts, waistSts, cuffSts, upperArmSts, underarmSts, neckSts,
    hemRows: rowsFor(style.hemHeightCm || 5, gauge.rowsPer10cm || 30),
    cuffRows: rowsFor(style.cuffHeightCm || 6, gauge.rowsPer10cm || 30),
    bodyRowsToArmhole: rowsFor(bodyLenCm - armholeDepthCm, gauge.rowsPer10cm || 30),
    armholeRows: rowsFor(armholeDepthCm, gauge.rowsPer10cm || 30),
    sleeveRows: rowsFor(sleeveLenCm, gauge.rowsPer10cm || 30),
    raglanRows: rowsFor(armholeDepthCm, gauge.rowsPer10cm || 30),
    raglanDecPerLine: Math.round((bustSts + 2 * upperArmSts - neckSts) / 8),
    totalLengthCm: bodyLenCm, armholeDepthCm, sleeveLenCm
  };
}

export { taperSchedule, shortRowSchedule, joinSegments };
