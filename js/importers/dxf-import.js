/**
 * KNITCAT — DXF punchcard reader.
 *
 * The reverse of `CadDxfExporter`: a plain ASCII DXF whose `ENTITIES` section carries
 * `CIRCLE` entities on the `CUT_HOLES` layer, one per punched hole, positioned in
 * millimetres. Every DXF is a stream of group-code / value line pairs (an even line is
 * a numeric code, the line after it is that code's value), so the parser walks pairs
 * and only cares about three codes inside a `CIRCLE`: `8` (layer), `10` (centre X) and
 * `20` (centre Y). Sprocket, outline and text entities live on other layers and are
 * ignored, which is what makes the CUT_HOLES filter the whole import.
 *
 * @module importers/dxf-import
 */

import { holesToMatrix } from './grid-quantize.js';

export function looksLikeDxfCard(text) {
  const s = String(text || '');
  return /^\s*0\s*\n?\s*SECTION/m.test(s.replace(/\r/g, '')) && /CUT_HOLES/.test(s);
}

/**
 * @param {string} text
 * @param {{profile?:object}} [opts]
 * @returns {{ok:boolean, matrix?:number[][], mode?:string, warnings?:string[], error?:string}}
 */
export function readDxfCard(text, { profile } = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const holes = [];
  let inEntities = false;
  let pendingSection = false; // saw `0 SECTION`; the next `2 <name>` says which one
  let entity = null; // { layer, x, y } while reading one entity's tag/value pairs
  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = lines[i].trim();
    const value = lines[i + 1].trim();
    if (code === '0') {
      // A new element begins. Flush the entity we were building.
      if (entity) flushHole(entity, holes);
      entity = null;
      if (value === 'SECTION') { pendingSection = true; inEntities = false; continue; }
      if (value === 'ENDSEC') { inEntities = false; pendingSection = false; continue; }
      // A CIRCLE inside the ENTITIES section is a candidate punched hole; every other
      // entity (LINE, TEXT, …) resets us to "not reading".
      if (inEntities && value === 'CIRCLE') entity = { layer: '', x: NaN, y: NaN };
      continue;
    }
    // DXF R12 names a section with a `2 <name>` pair that *follows* `0 SECTION`, so the
    // switch into ENTITIES happens here — not on the `0` line. (Looking for `0 ENTITIES`
    // would never match a conforming file, ours included.)
    if (pendingSection && code === '2') {
      inEntities = value === 'ENTITIES';
      pendingSection = false;
      continue;
    }
    if (!entity) continue;
    if (code === '8') entity.layer = value;
    else if (code === '10') entity.x = parseFloat(value);
    else if (code === '20') entity.y = parseFloat(value);
  }
  if (entity) flushHole(entity, holes);

  if (!holes.length) return { ok: false, error: 'No CUT_HOLES circles were found in this DXF.' };
  const result = holesToMatrix(holes, { pitchX: profile?.pitchX, pitchY: profile?.pitchY });
  if (!result.ok) return result;
  return { ok: true, matrix: result.matrix, mode: 'fair_isle', warnings: result.warnings || [] };
}

/** Keep only pattern holes — sprockets and outline marks share the section, not the layer. */
function flushHole(entity, holes) {
  if (entity && entity.layer === 'CUT_HOLES' && Number.isFinite(entity.x) && Number.isFinite(entity.y)) {
    holes.push({ x: entity.x, y: entity.y });
  }
}
