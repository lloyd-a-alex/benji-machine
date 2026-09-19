/**
 * The cell inspector's vocabulary: what a symbol means in words.
 *
 * Hovering a needle and being told `TL` is only useful to somebody who already reads
 * Japanese machine-chart notation. Every entry here answers the four questions a
 * knitter actually has about a cell — what happens, which carriage does it, which way
 * must the carriage travel, and what has to be true elsewhere in the row for it to
 * work — in the same order, so the inspector can be read at a glance.
 *
 * The direction claims are not opinions: they match what the compiler emits in
 * `js/compiler/lace-decompiler.js`, where a `TRANSFER_LEFT` becomes an operation of
 * `DIRECTION.RIGHT_TO_LEFT` and a Brother row is scheduled one travel direction per
 * pass. If the compiler and this table ever disagree, the compiler is the machine and
 * this file is the bug — which is why the wording is explicit enough to diff by eye,
 * and why `tests/editor-inspect.test.mjs` asserts the pairing.
 */

import { STITCH_TYPE } from '../math/knit-topology.js';
import { blankValue, isLaceMode, isPunched } from './modes.js';

/**
 * `carriage`: 'knit' (the main carriage), 'lace' (LC-2 / LC-580 style), 'either'.
 * `travel`:    the direction the carriage must move for the operation to happen.
 * `stitchDelta`: change in live stitches, counted over the two rows an operation
 *              takes to complete. A transfer stacks its loop on a neighbour and the
 *              pair are knitted together next row, so it is −1; an eyelet refills a
 *              needle, so it is +1; a double decrease empties two. That convention is
 *              what makes `rowBalance` read the way a knitter expects: an eyelet and
 *              a transfer sum to zero.
 * `pairsWith`:  symbols that balance it — the thing that makes a chart knittable.
 */
export const STITCH_INFO = {
  [STITCH_TYPE.KNIT]: {
    name: 'Knit',
    chart: 'blank / no symbol',
    carriage: 'knit',
    travel: 'either',
    stitchDelta: 0,
    does: 'The needle knits an ordinary loop. This is what an empty cell on a punchcard already means.',
    note: 'A plain knit row needs no punchcard holes at all — the card is only there to say where something else happens.',
    pairsWith: []
  },
  [STITCH_TYPE.PURL]: {
    name: 'Purl',
    chart: 'dot / ·',
    carriage: 'either',
    travel: 'either',
    stitchDelta: 0,
    does: 'The reverse-side loop: the bump you see on the wrong side of stocking stitch.',
    note: 'The lace carriage cannot make this. On a domestic machine it is done by hand, or by knitting the row from the other side — which is why it is rare on a machine chart.',
    pairsWith: [],
    manual: true
  },
  [STITCH_TYPE.EYELET]: {
    name: 'Eyelet / yarn over',
    chart: 'circle ○',
    carriage: 'lace',
    travel: 'either',
    stitchDelta: +1,
    does: 'Lays a new strand of yarn over an empty needle, making the hole.',
    note: 'A machine feeds no yarn out of thin air: the needle has to be empty first, so an eyelet is always paid for by a transfer. The compiler pays it automatically when the chart does not say otherwise.',
    pairsWith: [STITCH_TYPE.TRANSFER_LEFT, STITCH_TYPE.TRANSFER_RIGHT],
    needsVacatedNeedle: true
  },
  [STITCH_TYPE.TRANSFER_LEFT]: {
    name: 'Transfer left',
    chart: 'slanted line \\ (L)',
    carriage: 'lace',
    travel: 'right-to-left',
    stitchDelta: -1,
    does: 'Moves the loop off this needle onto the needle to its left.',
    note: 'Only happens on a pass travelling right-to-left, and it leaves this needle empty — which is half of an eyelet.',
    pairsWith: [STITCH_TYPE.EYELET],
    clearsNeedle: true
  },
  [STITCH_TYPE.TRANSFER_RIGHT]: {
    name: 'Transfer right',
    chart: 'slanted line / (R)',
    carriage: 'lace',
    travel: 'left-to-right',
    stitchDelta: -1,
    does: 'Moves the loop off this needle onto the needle to its right.',
    note: 'Only happens on a pass travelling left-to-right, and it leaves this needle empty.',
    pairsWith: [STITCH_TYPE.EYELET],
    clearsNeedle: true
  },
  [STITCH_TYPE.TRANSFER_DOUBLE_L]: {
    name: 'Transfer two needles left',
    chart: 'double line \\ with bar',
    carriage: 'lace',
    travel: 'right-to-left',
    stitchDelta: -1,
    does: 'Moves the loop two needles to the left, over the needle between them.',
    note: 'The needle it jumps over must not be carrying a loop that has nowhere to go, or the two strands twist round each other. A two-needle jump is also where a dropped stitch stops being trivial to pick up.',
    pairsWith: [STITCH_TYPE.EYELET],
    clearsNeedle: true,
    spans: 2
  },
  [STITCH_TYPE.TRANSFER_DOUBLE_R]: {
    name: 'Transfer two needles right',
    chart: 'double line / with bar',
    carriage: 'lace',
    travel: 'left-to-right',
    stitchDelta: -1,
    does: 'Moves the loop two needles to the right, over the needle between them.',
    note: 'Same as its mirror: check what the jumped needle is doing before knitting it.',
    pairsWith: [STITCH_TYPE.EYELET],
    clearsNeedle: true,
    spans: 2
  },
  [STITCH_TYPE.DOUBLE_DEC_LEFT]: {
    name: 'Double decrease, left leaning',
    chart: 'left-pointing V over three needles',
    carriage: 'lace',
    travel: 'right-to-left',
    stitchDelta: -2,
    does: 'Three loops become one, with the left stitch on top.',
    note: 'The compiler schedules it as two transfers into the centre needle, which is why it needs two passes and why the loops either side have to be free to move.',
    pairsWith: [STITCH_TYPE.EYELET, STITCH_TYPE.EYELET],
    needsEmptying: 2
  },
  [STITCH_TYPE.DOUBLE_DEC_RIGHT]: {
    name: 'Double decrease, right leaning',
    chart: 'right-pointing V over three needles',
    carriage: 'lace',
    travel: 'left-to-right',
    stitchDelta: -2,
    does: 'Three loops become one, with the right stitch on top.',
    note: 'Mirror of the left-leaning one; the same two-transfer schedule applies.',
    pairsWith: [STITCH_TYPE.EYELET, STITCH_TYPE.EYELET],
    needsEmptying: 2
  },
  [STITCH_TYPE.CENTER_DEC]: {
    name: 'Double decrease, centred',
    chart: 'symmetrical V',
    carriage: 'lace',
    travel: 'both directions',
    stitchDelta: -2,
    does: 'Three loops become one with the middle stitch on top.',
    note: 'The only decrease here that does not lean, so it survives a flip or a quarter turn unchanged — which makes it the safe choice on a chart that will be mirrored.',
    pairsWith: [STITCH_TYPE.EYELET, STITCH_TYPE.EYELET],
    needsEmptying: 2,
    leanFree: true
  },
  [STITCH_TYPE.TUCK]: {
    name: 'Tuck',
    chart: 'filled square / U with a bar',
    carriage: 'knit',
    travel: 'either',
    stitchDelta: 0,
    does: 'The needle holds its old loop and takes a new strand as well, stacking yarn behind the stitch.',
    note: 'Every held row adds another strand to that one hook, and the bulk is what pulls the fabric in. The machine profile caps how many a needle can carry before it lifts out of the cam channel.',
    pairsWith: [],
    limitKey: 'maxTuckLoops'
  },
  [STITCH_TYPE.SLIP]: {
    name: 'Slip',
    chart: 'filled square / blank with a dot',
    carriage: 'knit',
    travel: 'either',
    stitchDelta: 0,
    does: 'The needle is skipped, so the yarn floats behind it to the next needle in work.',
    note: 'This is the stranded-colour primitive. The float has to be short enough not to catch on fingers, and the profile sets that length.',
    pairsWith: [],
    limitKey: 'maxFloatNeedles'
  },
  [STITCH_TYPE.EMPTY]: {
    name: 'Empty needle',
    chart: 'dash / nothing at all',
    carriage: 'either',
    travel: 'either',
    stitchDelta: 0,
    does: 'No loop on this needle. It still knits nothing, and a carriage pass over it still takes time.',
    note: 'Widely used as the destination for a transfer-to-empty, and the reason a lacy fabric narrows as it is worked.',
    pairsWith: []
  }
};

export function stitchInfo(value) {
  return STITCH_INFO[value] || null;
}

export function isKnownSymbol(value) {
  return Boolean(stitchInfo(value));
}

/** Every known symbol, in chart-reading order rather than object order. */
export const SYMBOL_ORDER = [
  STITCH_TYPE.KNIT,
  STITCH_TYPE.PURL,
  STITCH_TYPE.EYELET,
  STITCH_TYPE.TRANSFER_LEFT,
  STITCH_TYPE.TRANSFER_RIGHT,
  STITCH_TYPE.TRANSFER_DOUBLE_L,
  STITCH_TYPE.TRANSFER_DOUBLE_R,
  STITCH_TYPE.DOUBLE_DEC_LEFT,
  STITCH_TYPE.DOUBLE_DEC_RIGHT,
  STITCH_TYPE.CENTER_DEC,
  STITCH_TYPE.TUCK,
  STITCH_TYPE.SLIP,
  STITCH_TYPE.EMPTY
];

/**
 * The whole balance of a row, as a number.
 *
 * A row that does not sum to zero is not wrong — it is shaping — but a *repeat* that
 * does not sum to zero cannot be tiled vertically without the fabric running off the
 * bed. That difference is the whole reason this is worth showing while you draw.
 *
 * `accountForImplicitTransfers` includes the −1 the compiler will add for every
 * eyelet that has no transfer beside it. Without it, an all-eyelet row reads as a
 * pure increase, which is true of the chart and false of the fabric.
 */
export function rowBalance(row, { accountForImplicitTransfers = false } = {}) {
  let delta = 0;
  const counts = new Map();
  const cells = row || [];
  for (let c = 0; c < cells.length; c++) {
    const value = cells[c];
    const info = stitchInfo(value);
    if (info) delta += info.stitchDelta;
    counts.set(value, (counts.get(value) || 0) + 1);
    if (!accountForImplicitTransfers || value !== STITCH_TYPE.EYELET) continue;
    const paid = cells[c - 1] === STITCH_TYPE.TRANSFER_LEFT || cells[c + 1] === STITCH_TYPE.TRANSFER_RIGHT;
    if (!paid) delta -= 1;
  }
  return { delta, counts, balanced: delta === 0 };
}

export function matrixBalance(matrix, options = {}) {
  const rows = (matrix || []).map(row => rowBalance(row, options));
  const total = rows.reduce((sum, row) => sum + row.delta, 0);
  return { rows, total, balanced: total === 0, unbalancedRows: rows.filter(row => !row.balanced).length };
}

/**
 * The inspector panel's payload for one cell.
 *
 * Built here rather than in the UI so the same object can be spoken by the
 * screen-reader live region, printed in the row-by-row schedule, and asserted in a
 * test — three consumers that must never disagree about what `TL` means.
 */
export function inspectCell(matrix, r, c, { mode = 'lace', profile = null, sourceLayerName = null } = {}) {
  const row = matrix[r];
  if (!row || c < 0 || c >= row.length) {
    return { ok: false, error: `Nothing at row ${r + 1}, needle ${c + 1} — that is off the card.`, r, c };
  }
  const value = row[c];
  const base = {
    ok: true,
    r,
    c,
    row: r + 1,
    needle: c + 1,
    value,
    fromLayer: sourceLayerName,
    punched: isPunched(mode, value),
    blank: value === blankValue(mode)
  };
  if (!isLaceMode(mode)) {
    return {
      ...base,
      name: base.punched ? 'Punched' : 'Blank',
      chart: base.punched ? 'hole' : 'no hole',
      does: base.punched
        ? `This needle is in work on the pass that reads this row — colour B, or the held needle in a tuck/slip pattern.`
        : `This needle is not selected on this pass, so it keeps whatever it already had.`,
      carriage: 'knit',
      travel: 'either',
      stitchDelta: 0,
      neighbours: neighbourSummary(matrix, r, c, mode)
    };
  }
  const info = stitchInfo(value);
  if (!info) {
    return { ...base, name: 'Unknown symbol', does: `Nothing in the vocabulary matches "${value}". Check the file was not hand-edited.`, unknown: true, neighbours: [] };
  }
  return {
    ...base,
    ...info,
    limit: info.limitKey && profile ? profile[info.limitKey] : null,
    neighbours: neighbourSummary(matrix, r, c, mode)
  };
}

/** What sits either side, because a transfer's meaning is its neighbours. */
export function neighbourSummary(matrix, r, c, mode = 'lace') {
  const out = [];
  const row = matrix[r] || [];
  for (const [offset, label] of [[-1, 'left'], [1, 'right']]) {
    const index = c + offset;
    const value = row[index];
    if (value === undefined) {
      out.push({ label, edge: true, text: `${label} is the edge of the card` });
      continue;
    }
    const info = stitchInfo(value);
    out.push({
      label,
      needle: index + 1,
      value,
      name: info ? info.name : String(value),
      punched: isPunched(mode, value)
    });
  }
  return out;
}

/**
 * A warning a knitter can act on, or `null`.
 *
 * Only the checks that are local to one cell — anything needing the whole row is the
 * compiler's job and the inspector must not compete with it. An unpaired eyelet is
 * the classic: legal on the card, silently self-paying at the machine, and worth
 * saying out loud before row 40.
 */
export function inspectCellWarnings(matrix, r, c, { mode = 'lace' } = {}) {
  if (!isLaceMode(mode)) return [];
  const value = matrix[r] ? matrix[r][c] : undefined;
  const info = stitchInfo(value);
  const warnings = [];
  if (!info) return warnings;
  const row = matrix[r] || [];
  if (value === STITCH_TYPE.EYELET) {
    const paid = row[c - 1] === STITCH_TYPE.TRANSFER_LEFT || row[c + 1] === STITCH_TYPE.TRANSFER_RIGHT;
    if (!paid) {
      warnings.push({
        level: 'info',
        text: 'This eyelet has no transfer next to it, so the compiler will vacate this needle on an automatic transfer. Explicit is better: put the transfer in the chart.'
      });
    }
  }
  if (value === STITCH_TYPE.TRANSFER_LEFT && c === 0) {
    warnings.push({ level: 'error', text: 'Nothing to the left: this transfer falls off the bed and the stitch is lost.' });
  }
  if (value === STITCH_TYPE.TRANSFER_RIGHT && c === row.length - 1) {
    warnings.push({ level: 'error', text: 'Nothing to the right: this transfer falls off the bed and the stitch is lost.' });
  }
  if (info.needsEmptying) {
    const neighbours = [row[c - 1], row[c + 1]];
    if (!neighbours.includes(STITCH_TYPE.TRANSFER_LEFT) && !neighbours.includes(STITCH_TYPE.TRANSFER_RIGHT)) {
      warnings.push({
        level: 'info',
        text: `A ${info.name.toLowerCase()} is two transfers in disguise; the loops either side have to be free to move onto this needle.`
      });
    }
  }
  return warnings;
}

/** Legend rows for the printed chart and the help tab. */
export function symbolLegend() {
  return SYMBOL_ORDER.map(value => {
    const info = STITCH_INFO[value];
    return { value, ...info, travelLabel: info.travel === 'either' ? 'either pass' : info.travel };
  });
}
