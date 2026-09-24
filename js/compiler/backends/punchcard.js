/**
 * KNITCAT V2 — the punchcard backend (spec §4.6.4).
 *
 * The punchcard is the reason half these machine knitters bought a KH-830, and it is the output
 * most likely to be quietly wrong in a naive re-write: get the reading offset wrong by seven rows
 * and every garment comes out seven rows out of register. This backend delegates the *physical*
 * geometry to the
 * battle-tested exporters already in the codebase (`VectorSvgExporter` for a laser-/plotter-ready
 * SVG with real pitch and sprockets, `FormatsExporter` for a human ASCII card you punch by eye)
 * and only owns the reduction from IR → boolean card (see {@link module:compiler/backends/_card}).
 *
 * It emits three synchronised views of the same card so nothing can disagree:
 *   - `svg`     : cut-ready vector (one continuous strip, machine-accurate)
 *   - `ascii`   : a printable text card with row numbers and sprocket marks
 *   - `meta`    : the physical read-out — columns, rows, reading offset, repeat, join line
 *
 * Pure `(ir, options) => {svg, ascii, meta}`. DOM-free.
 *
 * @module compiler/backends/punchcard
 */

import { VectorSvgExporter } from '../../exporters/vector-svg.js';
import { FormatsExporter } from '../../exporters/formats-dak.js';
import { punchMatrix, resolveProfile } from './_card.js';
import { logger } from '../../core/logging.js';

const log = logger('compiler/backends/punchcard');

/**
 * Compile an IR into punchcard outputs.
 * @param {object} ir @param {{columns?:number, rows?:number, repeat?:number}} [options]
 * @returns {{svg:string, ascii:string, meta:object}}
 */
export function punchcardBackend(ir, options = {}) {
  const profile = resolveProfile((ir && ir.machine) || 'brother_standard_24');
  const card = punchMatrix(ir, { ...options, columns: options.columns || profile.columns });
  const readingOffset = (profile.carriageRules && profile.carriageRules.cardReadingOffsetRows) || 0;
  // A missing card-reading offset silently defaults to 0; on a machine that wants a
  // seven-row lead-in that mis-registers the whole card, so note the assumption.
  if (!profile.carriageRules || profile.carriageRules.cardReadingOffsetRows == null) {
    log.debug('profile defines no cardReadingOffsetRows — assuming 0-row lead-in', { profile: profile.name || profile.id });
  }

  let svg = '';
  let ascii = '';
  const errors = [];
  try {
    svg = VectorSvgExporter.generateLaserSvg(profile, card.matrix, { includeSprockets: true, includeText: true });
  } catch (e) { log.logError('punchcard SVG generation failed', e, { context: { profile: profile.name } }); errors.push(`svg: ${e && e.message ? e.message : e}`); }
  try {
    ascii = FormatsExporter.generateAsciiCard(profile, card.matrix);
  } catch (e) { log.logError('punchcard ASCII generation failed', e, { context: { profile: profile.name } }); errors.push(`ascii: ${e && e.message ? e.message : e}`); }

  const holes = card.matrix.reduce((n, row) => n + row.filter(Boolean).length, 0);
  const meta = {
    machine: profile.name,
    machineId: profile.id,
    columns: card.columns,
    rows: card.rows,
    source: card.source,
    truncated: card.truncated,
    readingOffsetRows: readingOffset,
    repeatStitches: card.columns,
    repeatRows: card.rows,
    punchedHoles: holes,
    joinLine: 'match the arrowed seam; the pattern repeat closes on the last column',
    notes: card.notes.slice(),
    errors
  };
  return { svg, ascii, meta };
}
