/**
 * KNITCAT V2 — shared punch-card helpers for the card-family backends.
 *
 * The punchcard, DXF and G-code backends all need the same thing: a *boolean* needle matrix
 * (rows × columns, `true` = punch a hole / needle in working position) sized to the physical
 * width of the machine's card (Brother/Silverreed are 24 stitches, some are 40). The IR stores
 * either a colourwork `cardMatrix` (rows × colour indices) or nothing at all (a textured or
 * written-only pattern). This module bridges the two representations honestly:
 *
 *   - If the IR carries a colour matrix we reduce it to a single-colour card by treating the
 *     *background* colour (index 0) as "no hole" and every other colour as "hole". That is the
 *     standard reduction a knitter makes when they only have one carriage position to sense.
 *   - If the IR has no matrix we synthesise a card from the row operations: rib rows punch an
 *     alternating column, tuck rows punch their held needles, plain knit rows leave the card
 *     blank, and a decrease-only body just gets a blank knit card (nothing to sense).
 *
 * Every backend then reads `profile.columns` (24/40) and `profile.maxRows` from the machine
 * profile and clamps/truncates to fit a real card, and reports how it did so — a card that would
 * print 200 columns on a 24-stitch bed is a caller bug we surface, never silently emit.
 *
 * DOM-free, pure. @module compiler/backends/_card
 */

import { MACHINE_PROFILES } from '../../machine/profiles.js';

/** The default punch width when a machine id has no matching physical profile. */
const FALLBACK_COLUMNS = 24;

/**
 * Resolve the physical machine profile object for an IR (or a bare machine id string), falling
 * back to the Brother standard 24 profile so card backends always have real geometry to work from.
 * @param {object|string} machineOrId
 * @returns {object} a profile-like object with at least { columns, name, pitchX, pitchY }
 */
export function resolveProfile(machineOrId) {
  if (machineOrId && typeof machineOrId === 'object' && machineOrId.profile && machineOrId.profile.columns) {
    return machineOrId.profile;
  }
  const id = typeof machineOrId === 'string' ? machineOrId : (machineOrId && machineOrId.id) || 'brother_standard_24';
  return MACHINE_PROFILES[id] || MACHINE_PROFILES.brother_standard_24 || syntheticProfile(id);
}

/** A minimal but valid profile for a custom/unknown machine id, so the geometry code never divides by zero. */
function syntheticProfile(id) {
  return {
    id: id || 'custom', name: (id || 'custom').toString().replace(/_/g, ' ').toUpperCase(),
    columns: FALLBACK_COLUMNS, defaultRows: 60, minRows: 12, maxRows: 240,
    pitchX: 4.5, pitchY: 5.08, holeDiameter: 3.2, sprocketDiameter: 3.5, sprocketPitchY: 5.08,
    marginSide: 6.0, sprocketToFirstHole: 7.5, marginTopBottom: 15.0, cardWidth: 140.0,
    carriageRules: { cardReadingOffsetRows: 7 }
  };
}

/**
 * Build a boolean punch matrix (`true` = hole punched at row r, column c) sized to the machine
 * card width. Reads the IR colour matrix when present, otherwise synthesises from operations.
 * @param {object} ir @param {object} [opts]
 * @param {number} [opts.columns] force a width (defaults to the profile columns)
 * @param {number} [opts.rows] force a height (defaults to the tallest piece or the colour matrix)
 * @param {number} [opts.repeat] tile the colour repeat vertically this many times
 * @returns {{matrix:boolean[][], columns:number, rows:number, source:string, truncated:boolean, notes:string[]}}
 */
export function punchMatrix(ir, opts = {}) {
  const profile = resolveProfile((ir && ir.machine) || 'brother_standard_24');
  const notes = [];
  const columns = clampInt(opts.columns || profile.columns || FALLBACK_COLUMNS, 1, 256);
  let truncated = false;

  const colourMatrix = ir && Array.isArray(ir.cardMatrix) && ir.cardMatrix.length ? ir.cardMatrix : null;
  let matrix;
  let source;

  if (colourMatrix) {
    source = 'colourwork';
    // Reduce colours → hole/no-hole: index 0 (background) is a blank, anything else is a punch.
    matrix = colourMatrix.map(row => {
      const line = new Array(columns).fill(false);
      const width = Math.min(columns, row.length);
      if (row.length > columns) truncated = true;
      for (let c = 0; c < width; c++) line[c] = (Number(row[c]) || 0) !== 0;
      // Tile a short repeat horizontally to fill a wide card the way a punched card repeats.
      if (width && width < columns) {
        for (let c = width; c < columns; c++) line[c] = line[c % width];
      }
      return line;
    });
  } else {
    source = 'operations';
    matrix = synthesiseFromOperations(ir, columns, notes);
  }

  // Vertical tiling so a small chart covers a full card, then row clamp to the card's max.
  const repeat = clampInt(opts.repeat || 1, 1, 24);
  if (repeat > 1 && matrix.length) {
    const base = matrix.slice();
    const want = base.length * repeat;
    matrix = Array.from({ length: want }, (_, r) => base[r % base.length].slice());
  }

  const desiredRows = clampInt(opts.rows || matrix.length || profile.defaultRows || 60, 1, 512);
  if (matrix.length < desiredRows) {
    const base = matrix.length ? matrix : [new Array(columns).fill(false)];
    while (matrix.length < desiredRows) matrix.push(base[matrix.length % base.length].slice());
  }
  const maxRows = profile.maxRows || 240;
  if (matrix.length > maxRows) { matrix = matrix.slice(0, maxRows); truncated = true; notes.push(`card truncated to machine max ${maxRows} rows`); }
  if (truncated) notes.push(`matrix clamped to ${columns}-stitch card width`);

  return { matrix, columns, rows: matrix.length, source, truncated, notes, profile };
}

/**
 * Synthesise a card from IR row operations when there is no colour matrix.
 * Rib → alternating punch; tuck → punch the held needles; everything else → blank knit row.
 */
function synthesiseFromOperations(ir, columns, notes) {
  const pieces = (ir && ir.pieces) || [];
  const rows = [];
  const piece = pieces[0];
  const detail = piece ? piece.rowsDetail || [] : [];
  if (!detail.length) {
    notes.push('no colourwork matrix and no rows to derive a card from — emitting a blank knit card');
    return [new Array(columns).fill(false)];
  }
  for (const row of detail) {
    const line = new Array(columns).fill(false);
    const ops = row.operations || [];
    let punched = false;
    for (const o of ops) {
      if (o.kind === 'rib') { for (let c = 0; c < columns; c++) if (c % 2 === 1) line[c] = true; punched = true; }
      else if (o.kind === 'tuck') {
        const held = clampInt(Number(o.count) || Math.ceil(columns / 4), 1, columns);
        const step = Math.max(1, Math.floor(columns / held));
        for (let n = 0; n < held; n++) line[(n * step) % columns] = true;
        punched = true;
      } else if (o.kind === 'miss') {
        const missed = clampInt(Number(o.count) || 1, 1, columns);
        for (let n = 0; n < missed; n++) line[(n * 2) % columns] = true;
        punched = true;
      }
    }
    if (!punched && ops.some(o => o.kind === 'purl')) {
      // A purl row on a punchcard machine is signalled by punching the whole row.
      line.fill(true);
    }
    rows.push(line);
  }
  return rows;
}

function clampInt(v, lo, hi) { const n = Math.round(Number(v)); if (!Number.isFinite(n)) return lo; return Math.max(lo, Math.min(hi, n)); }
