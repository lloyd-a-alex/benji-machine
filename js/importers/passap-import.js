/**
 * KNITCAT — Passap / double-bed pattern reader.
 *
 * The exact inverse of `exporters/formats-passap.js`. All of the real parsing lives in
 * the exporter module (`passapPatternToMatrix`) so the write mapping and the read
 * mapping can never drift apart — export a card, import it back, get the chart you
 * drew. This file only supplies the registry's `match` sniff and re-exports the reader
 * in the `{ ok, matrix, mode, warnings }` shape `reader-registry` expects.
 *
 * @module importers/passap-import
 */

import { passapPatternToMatrix } from '../exporters/formats-passap.js';

/** Recognise a Passap E6000 two-bed pattern by its magic tag. */
export function looksLikePassapText(text) {
  return /\*PASSAP_E6000_PATTERN/.test(String(text || ''));
}

/**
 * @param {string} text
 * @returns {{ok:boolean, matrix?:Array<Array<number>>, mode?:string, warnings?:string[], error?:string}}
 */
export function readPassapText(text) {
  const out = passapPatternToMatrix(text);
  if (!out.ok) return out;
  return { ok: true, matrix: out.matrix, mode: 'fair_isle', warnings: out.warnings || [] };
}
