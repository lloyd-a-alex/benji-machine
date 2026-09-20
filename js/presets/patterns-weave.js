/**
 * KNITCAT - Pattern library, WEAVE STRUCTURES family.
 *
 * A woven draft is a rectangular grid of "warp up / warp down", and a punchcard is a
 * rectangular grid of "punched / blank". They are the same object, so this family does
 * no clever translation: it lifts the interlacement draft straight out of
 * `js/weave/weave-knowledge.js` (single source of truth) and hands it to the Fair Isle
 * card engine as a 0/1 chart. `1` (warp up) is a punched needle; `0` (weft up) is blank.
 *
 * Why ship woven structures in a *knitting* CAD? Because the geometry is portable even
 * when the machine is not: a twill diagonal, a satin scatter or a waffle piqué reads as
 * a colourwork motif, a slip-stitch ground or a textured block, and knowing the shaft
 * count and loom class a structure comes from is real craft information the browser and
 * the Design Health panel can show. Each description names the harnesses and the
 * simplest loom that would weave it, straight from the knowledge base.
 *
 * Nothing here touches the DOM at import; `generate` is pure and deterministic.
 */

import { preset } from './preset-recipe-helpers.js';
import { WEAVE_STRUCTURES, structureReport, simplestLoomFor } from '../weave/weave-knowledge.js';

/**
 * Build one preset from a weave structure: the structure's own draft, annotated with
 * the dressing (shafts / loom) the knowledge base records for it.
 * @param {import('../weave/weave-knowledge.js').WeaveStructure} s
 * @returns {object} a library preset
 */
function weavePreset(s) {
  const report = structureReport(s.id);
  const simplest = simplestLoomFor(s.id);
  const loomNote = simplest ? simplest.loom.name : 'a speciality loom';
  const repeatW = s.repeat && s.repeat[0] ? s.repeat[0] : 8;
  const repeatH = s.repeat && s.repeat[1] ? s.repeat[1] : 8;
  return preset({
    id: s.id,
    name: s.name,
    family: 'weave',
    group: s.group,
    bed: 'single-bed',
    rows: Math.max(20, repeatH),
    cols: Math.max(24, repeatW),
    mode: 'fair_isle',
    repeat: [repeatW, repeatH],
    structureId: s.id,
    shafts: s.shafts,
    control: s.control,
    face: s.face,
    tags: ['weave', s.group, s.control, s.face, 'draft'],
    description: `${s.blurb} Drafted on ${report.shaftsLabel.toLowerCase()}; the simplest loom that weaves it is ${loomNote}.`,
    generate: (rows, cols) => s.draft(rows, cols)
  });
}

/** Every structure KNITCAT knows, exposed as a selectable pattern. */
export const WEAVE_PRESETS = Object.values(WEAVE_STRUCTURES).map(weavePreset);
