/**
 * KNITCAT — the reader registry: one door for every importable text file.
 *
 * Until now the app could only open its own `.kcard` JSON. A knitter with a shoebox
 * of DesignaKnit exports, an AYAB bitstream, a spreadsheet of cells, a laser cutter's
 * DXF, or a CNC router's G-code had nothing. This module mirrors the exporter side
 * (`formats-dak.js`, `cad-dxf.js`, `cnc-gcode.js`): every reader is the exact inverse
 * of a writer that already exists, so the round trip — export a card, import it back —
 * reproduces the chart.
 *
 * `readAnyProject(text, { profile })` is the single call the app makes. It picks the
 * first reader whose `match` recognises the text and returns a shape identical to
 * `readProject`'s — `{ ok, project, warnings, error }` — so `loadProjectText` keeps
 * working untouched. The `.kcard` path still defers wholesale to `kcard.js`, which
 * remains the one trust boundary for KNITCAT's own files.
 *
 * DOM-free at import.
 *
 * @module importers/reader-registry
 */

import { readProject } from '../project/kcard.js';
import { logger } from '../core/logging.js';
import { readDakText, looksLikeDakText } from './dak-import.js';
import { readAyabText, looksLikeAyabText } from './ayab-import.js';
import { readPassapText, looksLikePassapText } from './passap-import.js';
import { readKnitMateText, looksLikeKnitMate } from './knitmate-import.js';
import { readCsvMatrix, looksLikeCsvMatrix } from './csv-import.js';
import { readDxfCard, looksLikeDxfCard } from './dxf-import.js';
import { readGcodeCard, looksLikeGcodeCard } from './gcode-import.js';

/** Central import seam: every reader dispatch and outcome is logged here. */
const log = logger('importers/reader-registry');

/**
 * A matrix-only reader's `{ ok, matrix, mode, warnings }` becomes a KNITCAT project
 * document. The chart is the whole story for these formats; the editor adopts it under
 * the mode the reader inferred so the glyphs mean the right thing.
 */
function matrixToResult(readerId, out, name) {
  if (!out || out.ok === false) {
    const error = out?.error || `The ${readerId} reader could not parse this file.`;
    log.warn(`${readerId} reader rejected the file`, { error, name: name || null });
    return { ok: false, readerId, error, warnings: out?.warnings || [] };
  }
  if (out.warnings?.length) log.info(`${readerId} reader recovered with warnings`, { warnings: out.warnings, name: name || null });
  return {
    ok: true,
    readerId,
    warnings: out.warnings || [],
    project: {
      name: name || null,
      mode: out.mode || 'fair_isle',
      stitchMatrix: out.matrix
    }
  };
}

/**
 * The ordered roster. First match wins, so the most specific signatures come first
 * and the generic JSON object catch-all comes last. `projectNative` readers already
 * return the `readProject` shape and are passed straight through.
 */
export const READERS = [
  { id: 'kcard', match: text => /^\s*\{/.test(String(text || '')), read: text => readProject(text), native: true },
  { id: 'dak', match: looksLikeDakText, read: text => readDakText(text) },
  { id: 'ayab', match: looksLikeAyabText, read: text => readAyabText(text) },
  { id: 'passap', match: looksLikePassapText, read: text => readPassapText(text) },
  { id: 'knitmate', match: looksLikeKnitMate, read: text => readKnitMateText(text) },
  { id: 'csv', match: looksLikeCsvMatrix, read: text => readCsvMatrix(text) },
  { id: 'dxf', match: looksLikeDxfCard, read: (text, ctx) => readDxfCard(text, ctx) },
  { id: 'gcode', match: looksLikeGcodeCard, read: (text, ctx) => readGcodeCard(text, ctx) }
];

/**
 * Recognise the format and read it. `opts.name` labels the resulting project (usually
 * the source filename); `opts.profile` supplies needle pitch for the geometric
 * readers (DXF / G-code) when the file itself does not carry a usable grid.
 *
 * @param {string} text
 * @param {{profile?:object, name?:string}} [opts]
 * @returns {{ok:boolean, project?:object, warnings:string[], error?:string, readerId?:string}}
 */
export function readAnyProject(text, { profile, name } = {}) {
  const body = String(text || '');
  log.debug('attempting to read a file', { bytes: body.length, name: name || null });
  for (const reader of READERS) {
    let matched = false;
    try {
      matched = reader.match(body);
    } catch (err) {
      // a match() must never be able to abort the whole import — but it should not be silent
      log.logError(`${reader.id} match() threw — skipping reader`, err, { context: { name: name || null } });
      matched = false;
    }
    if (!matched) continue;
    log.info(`${reader.id} reader matched the file`, { name: name || null });
    try {
      const out = reader.read(body, { profile, name });
      if (reader.native) {
        if (out && out.ok === false) log.warn(`${reader.id} reader returned ok:false`, { error: out.error, name: name || null });
        return { ...out, readerId: reader.id };
      }
      return matrixToResult(reader.id, out, name);
    } catch (err) {
      log.logError(`${reader.id} reader threw during read`, err, { context: { name: name || null } });
      return { ok: false, readerId: reader.id, warnings: [], error: `The ${reader.id} reader failed: ${err?.message || err}` };
    }
  }
  log.warn('no reader recognised the file', { bytes: body.length, name: name || null });
  return {
    ok: false,
    warnings: [],
    error: 'This is not a file KNITCAT knows how to read. It opens .kcard projects, DesignaKnit (.txt), AYAB, Passap double-bed, KnitMate two-bed, CSV, DXF and KNITCAT G-code.'
  };
}
