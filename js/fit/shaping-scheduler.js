/**
 * KNITCAT V2 — the shaping scheduler (the arithmetic heart of the Fit Engine).
 *
 * Every garment is, at bottom, a series of stitch counts that change across rows: cast on
 * at the hip, decrease to the waist, increase to the bust, hold, shape the armhole, take
 * raglan lines off. This module turns "start at A stitches, end at B stitches, over N rows,
 * shaping `perEvent` stitches at a time" into an explicit, row-by-row schedule of
 * {@link ShapingRow} events — the exact "dec 2sts at both ends every 6th row 4 more times"
 * a knitter follows, generated rather than hand-written. It reuses the battle-tested
 * {@link module:generators/math-patterns.distributeEvenly} so shaping lands as evenly as
 * possible across the available rows (never two events bunched where one would do).
 *
 * Everything here is pure arithmetic on integers: no DOM, no yarn, no machine. Templates
 * call these builders; the compiler renders them.
 *
 * @module fit/shaping-scheduler
 */

import { distributeEvenly } from '../generators/math-patterns.js';

/**
 * @typedef {object} ShapingRow
 * @property {number} row  1-based row within the segment
 * @property {'knit'|'decrease'|'increase'|'bind-off'|'cast-on'|'short-row'|'join'|'yarn-change'} action
 * @property {number} count  stitches affected
 * @property {'left'|'right'|'both'|'centre'|'four-lines'|'distributed'} position
 * @property {string} notes
 */

/**
 * Distribute `count` identical events across `total` rows as evenly as possible, returning
 * a per-row array of event counts (usually 0 or 1, but >1 when there are more events than
 * rows — the scheduler never silently drops shaping). @param {number} count @param {total} total
 * @returns {number[]}
 */
export function eventSpread(count, total) {
  const n = Math.max(0, Math.trunc(total));
  const c = Math.max(0, Math.trunc(count));
  if (n === 0) return [];
  const flags = distributeEvenly(c, n); // 0/1 length-n
  // If c > n, distributeEvenly caps at n; make up the remainder as extra events.
  const out = flags.slice();
  let extra = c - n;
  if (extra > 0) for (let i = 0; extra > 0; i = (i + 1) % n) { out[i] += 1; extra--; }
  return out;
}

/**
 * Build a taper: change from `startSts` to `endSts` across `rows` rows, taking/adding
 * `perEvent` stitches per shaping event at `position`. Emits a ShapingSchedule.
 * @param {number} startSts @param {number} endSts @param {number} rows
 * @param {{perEvent?:number, position?:ShapingRow['position'], label?:string}} [opts]
 * @returns {{rows:ShapingRow[], totalRows:number, castOn:number, finalStitches:number}}
 */
export function taperSchedule(startSts, endSts, rows, opts = {}) {
  const perEvent = Math.max(1, Math.trunc(opts.perEvent || 2));
  const position = opts.position || 'both';
  const label = opts.label || 'shape';
  const totalRows = Math.max(0, Math.trunc(rows));
  const delta = Math.trunc(endSts) - Math.trunc(startSts);
  const action = delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'knit';
  const events = Math.ceil(Math.abs(delta) / perEvent);

  const schedule = [];
  if (events === 0 || totalRows === 0) {
    for (let r = 1; r <= totalRows; r++) schedule.push({ row: r, action: 'knit', count: 0, position, notes: '' });
    return { rows: schedule, totalRows, castOn: startSts, finalStitches: endSts };
  }
  const spread = eventSpread(events, totalRows);
  let remaining = delta;
  for (let i = 0; i < totalRows; i++) {
    const e = spread[i];
    if (e > 0) {
      const thisCount = Math.min(e * perEvent, Math.abs(remaining));
      remaining -= action === 'increase' ? thisCount : -thisCount;
      schedule.push({ row: i + 1, action, count: thisCount, position, notes: `${label} ${action} ${thisCount}` });
    } else {
      schedule.push({ row: i + 1, action: 'knit', count: 0, position, notes: '' });
    }
  }
  return { rows: schedule, totalRows, castOn: Math.trunc(startSts), finalStitches: Math.trunc(endSts) };
}

/**
 * Work even (no shaping) for `rows`. @param {number} rows @returns {ShapingRow[]}
 */
export function knitEven(rows) {
  const out = [];
  for (let r = 1; r <= Math.max(0, Math.trunc(rows)); r++) out.push({ row: r, action: 'knit', count: 0, position: 'both', notes: '' });
  return out;
}

/**
 * Bind off `count` stitches at `position` on the first row of a segment.
 * @param {number} count @param {ShapingRow['position']} [position] @returns {ShapingRow[]}
 */
export function bindOff(count, position = 'both') {
  return [{ row: 1, action: 'bind-off', count: Math.trunc(count), position, notes: `bind off ${count}` }];
}

/**
 * Concatenate multiple taper/even segments into one continuous schedule, renumbering rows
 * and tracking the running stitch count so `finalStitches` is honest.
 * @param {Array<{rows:ShapingRow[]}|ShapingRow[]>} segments
 * @param {number} castOn
 * @returns {{rows:ShapingRow[], totalRows:number, castOn:number, finalStitches:number}}
 */
export function joinSegments(segments, castOn) {
  const rows = [];
  let rowNumber = 0;
  let stitches = Math.trunc(castOn);
  for (const seg of segments) {
    const list = Array.isArray(seg) ? seg : seg.rows;
    for (const r of list || []) {
      rowNumber++;
      let live = stitches;
      if (r.action === 'increase') live += r.count;
      else if (r.action === 'decrease' || r.action === 'bind-off') live -= r.count;
      rows.push(Object.assign({}, r, { row: rowNumber, _after: live }));
      stitches = live;
    }
  }
  return { rows, totalRows: rowNumber, castOn: Math.trunc(castOn), finalStitches: stitches };
}
