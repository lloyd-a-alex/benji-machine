/**
 * KNITCAT — Passap / double-bed pattern formats (browser-free, pure).
 *
 * KNITCAT has always scheduled SINGLE-bed machines: a punchcard hole picks a needle
 * on one bed. But a Passap Duo / E6000 (and any single-bed machine run as a double
 * bed) knits across TWO opposed needle beds — Front (F) and Back (R) — and two-colour
 * stranded work is carried as "this stitch is on the front bed with colour A, that
 * stitch is on the back bed with colour B". The README has been candid that this
 * machine's transfer plan was modelled as single-bed; this module is the piece that
 * was genuinely missing: a real, reversible two-bed *pattern* representation.
 *
 * Given the app's ordinary boolean colour matrix (truthy = colour B / the second
 * colour), the classic double-bed mapping is:
 *     front-bed punch (F) = colour A (matrix cell falsy)
 *     back-bed punch  (R) = colour B (matrix cell truthy)
 * so every needle is punched on exactly one bed — which is precisely how a Passap
 * E-print / piqué card is laid out. Both beds can be mirrored independently because
 * the Passap reads the back bed in the opposite direction to the front; the flags are
 * carried in the header so the reader can undo them and reproduce the source chart
 * byte-for-byte (the round-trip contract `importers/passap-import.js` relies on).
 *
 * The text format is deliberately line-oriented and human-readable, matching the
 * `[DESIGNAKNIT_STITCH_PATTERN]` / `AYAB_FORMAT_V1` house style: a magic tag, a small
 * `KEY=value` header, then one `F <bits>` and one `R <bits>` line per card row, written
 * TOP row first so it prints the way you read a card.
 *
 * Nothing here touches the DOM and no function throws on bad input.
 *
 * @module exporters/formats-passap
 */

import { logger } from '../core/logging.js';

const log = logger('exporters/formats-passap');

const round = Math.round;
const bool = v => (Array.isArray(v) ? v.some(bool) : !!v && v !== 0 && v !== '0');

/** A matrix cell punched on the front bed (colour A) — the inverse of the back bed. */
const frontPunch = cell => !bool(cell);
/** A matrix cell punched on the back bed (colour B). */
const backPunch = cell => bool(cell);

/** Reverse a bit row for a mirrored bed; returns a fresh array. */
function mirrorRow(bits, mirror) {
  return mirror ? bits.slice().reverse() : bits.slice();
}

/** Turn a punch list into a `0`/`1` bit string, one char per needle. */
function toBits(punchList) {
  return punchList.map(p => (p ? '1' : '0')).join('');
}

/**
 * Expand a `0`/`1` bit string back into booleans (used by the reader, exported for
 * tests). Non-bit characters are ignored so stray whitespace never corrupts a card.
 */
export function parseBits(line) {
  return String(line || '').split('').filter(ch => ch === '0' || ch === '1').map(ch => ch === '1');
}

/**
 * Build the two-bed structure for a colour matrix.
 *
 * @param {Array<Array<*>>} cardMatrix rows bottom-first (editor order), cells truthy = colour B
 * @param {object} [opts] { mirrorFront?:boolean, mirrorBack?:boolean }
 * @returns {{width:number, height:number, rows:Array<{index:number, front:number[], back:number[]}>}}
 */
export function buildBedRows(cardMatrix, opts = {}) {
  const matrix = Array.isArray(cardMatrix) ? cardMatrix : [];
  const height = matrix.length;
  const width = matrix.reduce((m, r) => Math.max(m, (r || []).length), 0);
  const mirrorFront = !!opts.mirrorFront;
  const mirrorBack = !!opts.mirrorBack;
  const rows = [];
  // Emit TOP row first (index height-1 … 0) so the printed card reads correctly.
  for (let r = height - 1; r >= 0; r--) {
    const src = matrix[r] || [];
    const front = new Array(width).fill(0);
    const back = new Array(width).fill(0);
    for (let c = 0; c < width; c++) {
      const cell = src[c];
      front[c] = frontPunch(cell) ? 1 : 0;
      back[c] = backPunch(cell) ? 1 : 0;
    }
    rows.push({
      index: r,
      front: mirrorRow(front, mirrorFront),
      back: mirrorRow(back, mirrorBack)
    });
  }
  return { width, height, rows };
}

/**
 * Generate the Passap E6000 two-bed pattern text.
 *
 * @param {Array<Array<*>>} cardMatrix
 * @param {object} [opts] { mirrorFront, mirrorBack, title }
 * @returns {string}
 */
export function generatePassapPattern(cardMatrix, opts = {}) {
  const { width, height, rows } = buildBedRows(cardMatrix, opts);
  if (!width || !height) log.warn('generated a Passap pattern from an empty chart — the export carries only a header', { width, height });
  const lines = [];
  lines.push('*PASSAP_E6000_PATTERN');
  lines.push(`TITLE=${(opts.title || 'KNITCAT').replace(/[\r\n=]/g, ' ').trim()}`);
  lines.push('BEDS=2');
  lines.push(`WIDTH=${width}`);
  lines.push(`HEIGHT=${height}`);
  lines.push(`MIRROR_F=${opts.mirrorFront ? 'yes' : 'no'}`);
  lines.push(`MIRROR_R=${opts.mirrorBack ? 'yes' : 'no'}`);
  lines.push('COLOR_MAP=double-bed');
  for (const row of rows) {
    lines.push(`F ${toBits(row.front)}`);
    lines.push(`R ${toBits(row.back)}`);
  }
  lines.push('*END');
  return lines.join('\n');
}

/**
 * Convert a Passap pattern back to a single-bed colour matrix (cell truthy = colour B).
 * Kept here so the reader and any in-app preview share one implementation — the fusion
 * point that stops the write and read mappings drifting apart.
 *
 * @param {string} text the pattern produced by {@link generatePassapPattern}
 * @returns {{ok:boolean, matrix?:Array<Array<number>>, warnings?:string[], error?:string}}
 */
export function passapPatternToMatrix(text) {
  const raw = String(text || '').split(/\r?\n/);
  if (!raw.some(l => l.trim() === '*PASSAP_E6000_PATTERN')) {
    return { ok: false, error: 'Not a Passap E6000 pattern (missing the *PASSAP_E6000_PATTERN tag).' };
  }
  const header = {};
  for (const line of raw) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) header[m[1]] = m[2].trim();
  }
  const width = parseInt(header.WIDTH, 10);
  const mirrorFront = header.MIRROR_F === 'yes';
  const mirrorBack = header.MIRROR_R === 'yes';
  const warnings = [];

  // Collect the interleaved F/R lines; the R (back) bed carries colour B, which is the
  // whole story for a two-colour chart, so the matrix is rebuilt from the back bed.
  const backRowsTopFirst = [];
  let pendingBack = null;
  for (const line of raw) {
    const t = line.trim();
    if (t.startsWith('R ')) pendingBack = t.slice(2);
    else if (t.startsWith('F ')) {
      if (pendingBack !== null) { backRowsTopFirst.push(pendingBack); pendingBack = null; }
    }
  }
  if (pendingBack !== null) backRowsTopFirst.push(pendingBack);
  if (!backRowsTopFirst.length) return { ok: false, error: 'The Passap pattern held no R (back-bed) rows.' };

  const bottomFirst = backRowsTopFirst.slice().reverse();
  const matrix = bottomFirst.map(bits => {
    let back = parseBits(bits);
    if (mirrorBack) back = back.slice().reverse();
    return back.map(b => (b ? 1 : 0));
  });
  const maxW = matrix.reduce((m, r) => Math.max(m, r.length), 0);
  if (Number.isFinite(width) && width !== maxW) {
    warnings.push(`Header declares ${width} needles but the data is ${maxW} wide. Believed the data.`);
  }
  for (const row of matrix) while (row.length < maxW) row.push(0);

  // Sanity-check the front bed really is the complement so a hand-edited card is flagged.
  const fLines = raw.filter(l => l.trim().startsWith('F ')).map(l => parseBits(l.slice(2)));
  let mismatches = 0;
  for (let i = 0; i < Math.min(fLines.length, matrix.length); i++) {
    const front = mirrorFront ? fLines[i].slice().reverse() : fLines[i];
    const backRow = matrix[matrix.length - 1 - i];
    for (let c = 0; c < front.length; c++) {
      // A valid needle punches exactly one bed: front boolean must differ from back bit.
      if (front[c] === !!backRow[c]) mismatches++; // both punched or both blank on a needle
    }
  }
  if (mismatches > 0) {
    warnings.push(`${mismatches} needle(s) are punched on both beds or neither — a real Passap card punches exactly one bed per needle.`);
  }
  return { ok: true, matrix, warnings };
}

/**
 * A compact statistics summary the export toast / docs can show.
 * @param {Array<Array<*>>} cardMatrix
 * @param {object} [opts]
 */
export function passapSummary(cardMatrix, opts = {}) {
  const { width, height, rows } = buildBedRows(cardMatrix, opts);
  let frontPunches = 0;
  let backPunches = 0;
  for (const r of rows) {
    frontPunches += r.front.reduce((a, b) => a + b, 0);
    backPunches += r.back.reduce((a, b) => a + b, 0);
  }
  return {
    beds: 2, width, height,
    rows: round(height),
    frontPunches, backPunches, totalPunches: frontPunches + backPunches
  };
}
