/**
 * KNITCAT V2 — short-row scheduling.
 *
 * Short rows are how a flat machine bed bends fabric into a body: they add length where a
 * shoulder slopes, push a bust apex out of a straight tube, raise the back neck above the
 * front, and shape a heel. A short-row section is a repeating "work N stitches, wrap and
 * turn, work back M more, wrap and turn" that progressively covers more of the width. This
 * module emits those partial rows explicitly, as {@link ShapingRow} events tagged
 * `action:'short-row'`, so both the written backend and the machine backend can render them.
 *
 * Three shapes are supported, chosen by `method`:
 *   - 'shoulder'  the classic wedge — turn points march across half the width (each shoulder).
 *   - 'bust-dart' a partial wedge worked from the side seam in and back out.
 *   - 'neck'      a centre-focused fan: leave the middle, wrap progressively outward, so the
 *                 outer shoulders knit taller than the centre back (a scooped back neck).
 *
 * Everything is integer arithmetic on rows and stitches; DOM-free.
 *
 * @module fit/short-rows
 */

/**
 * @typedef {object} ShortRowOptions
 * @property {'shoulder'|'bust-dart'|'neck'|'heel'} [method='shoulder']
 * @property {number} totalStitches stitches live across the row
 * @property {number} extraRows     how many rows of extra length the wedge adds
 * @property {number} [turnCount]   number of wrap-and-turn points (defaults from extraRows)
 * @property {'left'|'right'|'both'|'centre'} [anchor] which edge grows taller
 * @property {boolean} [twoColor]   emit a yarn-change marker per turn (machine slip-stitch SR)
 */

/**
 * Compute how many wrap-and-turn points a short-row wedge needs. More turns spread the same
 * extra length over gentler steps (smoother slope, fewer visible gaps); fewer turns are
 * quicker but steeper. We target roughly one turn every 2 rows of added length, clamped to a
 * practical 2..12, and never more turns than would leave a single stitch unworked.
 * @param {number} extraRows @param {number} totalStitches @returns {number}
 */
export function suggestTurnCount(extraRows, totalStitches) {
  const byRows = Math.max(2, Math.round(extraRows / 2));
  const byWidth = Math.max(2, Math.floor(totalStitches / 8));
  return Math.max(2, Math.min(12, Math.min(byRows, byWidth)));
}

/**
 * Build an explicit short-row schedule. Returns rows numbered from 1 with the running stitch
 * context so downstream code can render "wrap & turn, work 12 sts, W&T, ...".
 *
 * For a `shoulder` wedge worked on one shoulder: the turn points start `extraRows` worth of
 * stitches from the neck edge and march toward the outer edge, each turn adding `step`
 * stitches to the worked length. For `neck`, turns start at the centre and work outward.
 *
 * @param {ShortRowOptions} opts
 * @returns {{rows:import('./shaping-scheduler.js').ShapingRow[], turns:number, extraRows:number}}
 */
export function shortRowSchedule(opts = {}) {
  const method = opts.method || 'shoulder';
  const total = Math.max(1, Math.trunc(opts.totalStitches) || 1);
  const extraRows = Math.max(0, Math.trunc(opts.extraRows));
  const anchor = opts.anchor || (method === 'neck' ? 'both' : 'right');
  const turns = Math.max(0, opts.turnCount != null ? Math.trunc(opts.turnCount) : (extraRows ? suggestTurnCount(extraRows, total) : 0));
  const rows = [];
  if (extraRows <= 0 || turns <= 0) {
    rows.push({ row: 1, action: 'knit', count: 0, position: 'both', notes: '' });
    return { rows, turns: 0, extraRows: 0 };
  }

  // Stitches added to the worked length at each successive turn.
  const step = Math.max(1, Math.floor(total / (turns + 1)));
  let rowNumber = 0;
  let live = total;

  const pushSR = (worked, side, label) => {
    rowNumber++;
    rows.push({
      row: rowNumber,
      action: 'short-row',
      count: worked,
      position: side,
      notes: `${label}: work ${worked} sts, wrap & turn`
    });
  };

  if (method === 'neck') {
    // Centre-back scoop: leave the middle unworked first, then widen toward the shoulders.
    let held = Math.max(2, Math.floor(step / 2));
    for (let t = 0; t < turns; t++) {
      const worked = Math.max(1, total - held);
      pushSR(worked, t % 2 === 0 ? 'right' : 'left', 'back neck');
      held = Math.max(1, Math.floor(held / 2));
    }
  } else if (method === 'bust-dart') {
    // A dart: turn points climb from the side seam to the apex, then mirror back out.
    for (let t = 0; t < turns; t++) pushSR(total - (turns - t) * step, anchor, 'bust dart');
    for (let t = turns - 1; t >= 0; t--) {
      rowNumber++;
      rows.push({ row: rowNumber, action: 'knit', count: 0, position: anchor, notes: 'return past dart, wraps hidden' });
    }
  } else if (method === 'heel') {
    const half = Math.floor(total / 2);
    const centre = total - 2 * half || 1;
    pushSR(half + centre, 'right', 'heel turn');
    rowNumber++;
    rows.push({ row: rowNumber, action: 'knit', count: 0, position: 'left', notes: 'work back over centre' });
  } else {
    // 'shoulder' wedge.
    for (let t = 1; t <= turns; t++) pushSR(t * step, anchor, 'shoulder');
  }

  // A final full-width row joins everything.
  rowNumber++;
  rows.push({ row: rowNumber, action: 'knit', count: 0, position: 'both', notes: `join — work full ${live} sts over wrapped sts` });
  return { rows, turns, extraRows };
}

/**
 * German / wrapless short rows expressed as machine partial knitting: a run of `hiddenRows`
 * worked only over a sub-section of needles. Returns the stitch span live on each row — the
 * shape the machine backend needs to set the knit-carriage range for a partial-knitting pass.
 * @param {{totalStitches:number, extraRows:number, turns?:number, anchor?:string}} opts
 * @returns {Array<{row:number, fromNeedle:number, toNeedle:number}>}
 */
export function partialKnittingSpans(opts = {}) {
  const total = Math.max(1, Math.trunc(opts.totalStitches) || 1);
  const extraRows = Math.max(0, Math.trunc(opts.extraRows));
  const turns = opts.turns != null ? Math.trunc(opts.turns) : suggestTurnCount(extraRows, total);
  const anchor = opts.anchor || 'right';
  const spans = [];
  if (extraRows === 0) return [{ row: 1, fromNeedle: 0, toNeedle: total - 1 }];
  const step = Math.max(1, Math.floor(total / (turns + 1)));
  let row = 0;
  for (let pass = 0; pass < extraRows; pass++) {
    // Progressive wedge: live span grows every other row.
    const phase = Math.min(turns, Math.floor((pass / Math.max(1, extraRows / turns)) + 1e-9));
    const worked = Math.min(total, (phase + 1) * step);
    row++;
    if (anchor === 'left') spans.push({ row, fromNeedle: 0, toNeedle: worked - 1 });
    else if (anchor === 'both') spans.push({ row, fromNeedle: Math.floor((total - worked) / 2), toNeedle: Math.ceil((total + worked) / 2) - 1 });
    else spans.push({ row, fromNeedle: total - worked, toNeedle: total - 1 });
  }
  return spans;
}

/**
 * Estimate the vertical length a shoulder wedge adds, in rows, given how steep a slope the
 * knitter wants (rows of extra fabric per cm of rise) — a helper templates use to turn a
 * shoulder-slope angle (deg) into an `extraRows` count.
 * @param {number} slopeDegrees @param {number} shoulderWidthCm @param {number} rowsPerCm
 * @returns {number}
 */
export function rowsForShoulderSlope(slopeDegrees, shoulderWidthCm, rowsPerCm) {
  const rise = Math.tan((slopeDegrees * Math.PI) / 180) * shoulderWidthCm;
  return Math.max(0, Math.round(rise * (rowsPerCm || 0)));
}
