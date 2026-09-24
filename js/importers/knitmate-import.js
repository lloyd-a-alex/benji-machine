/**
 * KNITCAT — KnitMate two-bed punch-map reader.
 *
 * The exact inverse of `exporters/formats-knitmate.js`. All of the real parsing lives in
 * the exporter module (`knitMatePatternToMatrix`) so the write mapping and the read
 * mapping can never drift apart — export a card, import it back, get the chart you drew.
 * This file only supplies the registry's `match` sniff and re-exports the reader in the
 * `{ ok, matrix, mode, warnings }` shape `reader-registry` expects.
 *
 * @module importers/knitmate-import
 */

import { knitMatePatternToMatrix } from '../exporters/formats-knitmate.js';

/** Recognise a KnitMate two-bed card by its magic tag. */
export function looksLikeKnitMate(text) {
  return /^\s*\*KNITMATE_CARD_V1\b/.test(String(text || ''));
}

/**
 * @param {string} text
 * @returns {{ok:boolean, matrix?:Array<Array<number>>, mode?:string, warnings?:string[], error?:string}}
 */
export function readKnitMateText(text) {
  const out = knitMatePatternToMatrix(text);
  if (!out.ok) return out;
  return { ok: true, matrix: out.matrix, mode: 'fair_isle', warnings: out.warnings || [] };
}
