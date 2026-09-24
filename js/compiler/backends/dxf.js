/**
 * KNITCAT V2 — the DXF backend (spec §4.6.5).
 *
 * A DXF (Drawing Exchange Format) is what you hand to a laser cutter, a CNC router or a drafting
 * program — the punchcard geometry as neutral vector CAD rather than a browser-only SVG. The
 * codebase already owns a correct AutoCAD R12 writer (`CadDxfExporter`); this backend is the thin,
 * honest bridge from the compiler IR to it: reduce the IR to a boolean card, resolve the physical
 * machine profile, and call the exporter. It adds the card dimensions and a human-readable summary
 * so the UI can tell the maker "this is a 140 × 320 mm strip, 24 sts × 60 rows" before they load
 * it into a cutter. Pure `(ir, options) => {dxf, meta}`. DOM-free.
 *
 * @module compiler/backends/dxf
 */

import { CadDxfExporter } from '../../exporters/cad-dxf.js';
import { calculateCardDimensions } from '../../machine/profiles.js';
import { punchMatrix, resolveProfile } from './_card.js';
import { logger } from '../../core/logging.js';

const log = logger('compiler/backends/dxf');

/**
 * Compile an IR into an AutoCAD R12 DXF punchcard.
 * @param {object} ir @param {{columns?:number, rows?:number, includeSprockets?:boolean}} [options]
 * @returns {{dxf:string, meta:object}}
 */
export function dxfBackend(ir, options = {}) {
  const profile = resolveProfile((ir && ir.machine) || 'brother_standard_24');
  const card = punchMatrix(ir, { ...options, columns: options.columns || profile.columns });
  const dims = calculateCardDimensions(profile, card.rows, card.columns);
  let dxf = '';
  const errors = [];
  try {
    dxf = CadDxfExporter.generateDxf(profile, card.matrix, { includeSprockets: options.includeSprockets !== false });
  } catch (e) { log.logError('DXF generation failed', e, { context: { profile: profile.name } }); errors.push(`dxf: ${e && e.message ? e.message : e}`); }
  const meta = {
    machine: profile.name, columns: card.columns, rows: card.rows, source: card.source,
    widthMm: round1(dims.widthMm), heightMm: round1(dims.heightMm),
    gridWidthMm: round1(dims.gridWidthMm), gridHeightMm: round1(dims.gridHeightMm),
    holes: card.matrix.reduce((n, r) => n + r.filter(Boolean).length, 0),
    truncated: card.truncated, notes: card.notes.slice(), errors
  };
  return { dxf, meta };
}

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
