/**
 * KNITCAT - Pattern library, LACE family.
 *
 * Named lace traditions a knitter will recognise from a book, drawn from the published
 * machine-lace vocabulary: the Shetland har-leeg family, the Victorian cathedral
 * grounds, and the Priscilla/Budworth-era commercial edgings.
 *
 * Every recipe here is *stitch balanced* by construction: holes are laid with
 * `holeRow`/`addHole`, which always place a yarn-over and its paired decrease as one
 * indivisible atom, so the number of loops cast on equals the number taken out of work
 * on every single row. `tests/preset-library.test.mjs` re-measures this and refuses to
 * ship a card that would jam the fixed needle bed. That is also why you will not find a
 * lone yarn-over anywhere in this file — on a straight bed an unpaired yarn-over is an
 * increase into a needle that already has a loop, which is a jam, not a hole.
 *
 * (Brimage / "slate" lace, which crosses loops with no holes at all, is deliberately NOT
 * here: on one bed a crossing is a transfer-and-return that a single-cell chart cannot
 * express, so it lives in the double-bed family where the loop can genuinely go out and
 * back.)
 *
 * Conventions:
 *   - `holeRow(row, width, [[offset, 'R'|'L'], …])` tiles balanced holes every `width`
 *     needles; `'R'` leans the hole right (eyelet left of its decrease), `'L'` the other
 *     way. This is the yarn-over + knit-two-together of hand lace, in one call.
 *   - `passesPerLaceRow: 4` is the Brother single-bed lace-carriage cost (select,
 *     transfer, complete, park-left return) from `js/machine/carriage-passes.js`; the
 *     vertical repeat is quoted in card rows so the drift check can run against it.
 */

import {
  blankLace,
  preset,
  holeRow
} from './preset-recipe-helpers.js';

/**
 * Build a generate() from a table of worked rows. `plan` maps a row phase (within
 * `height`) to a `holeRow` pattern; unlisted phases are plain. Optional `extra(row)`
 * lets a recipe add a centred double decrease on the spine of a motif (which removes
 * two loops, so it must be paired with two eyelets already on that row — used only in
 * recipes that are verified balanced).
 */
function lacedRows(width, height, plan, extra) {
  return (rows, cols) => {
    const matrix = blankLace(rows, cols);
    for (let r = 0; r < rows; r++) {
      const phase = ((r % height) + height) % height;
      if (plan[phase]) holeRow(matrix[r], width, plan[phase]);
      if (extra) extra(matrix[r], phase);
    }
    return matrix;
  };
}

export const LACE_PRESETS = [
  preset({
    id: 'herringbone_harleeg_lace',
    name: 'Herringbone Har-Leeg (Herringbone Lace)',
    family: 'lace',
    group: 'shetland',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [12, 8],
    tags: ['shetland', 'har-leeg', 'chevron', 'classic'],
    description:
      'The Shetland herringbone stocking-top pattern: two mirrored runs of yarn-over-and-decrease lean into each other and break apart again, forming the zig-zag rib.',
    generate: lacedRows(12, 8, {
      0: [[1, 'L'], [8, 'R']],
      2: [[2, 'L'], [7, 'R']],
      4: [[3, 'L'], [6, 'R']],
      6: [[4, 'L'], [5, 'R']]
    })
  }),

  preset({
    id: 'rangaly_lace',
    name: 'Rangaly Ground Lace',
    family: 'lace',
    group: 'shetland',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [8, 8],
    tags: ['shetland', 'ground', 'diagonal'],
    description:
      'An all-over Shetland ground: single eyelet-and-transfer pairs marching diagonally in narrow columns, the standard filler for hap shawls.',
    generate: lacedRows(8, 8, {
      0: [[1, 'R'], [5, 'L']],
      2: [[2, 'R'], [6, 'L']],
      4: [[3, 'R'], [7, 'L']],
      6: [[4, 'R'], [0, 'L']]
    })
  }),

  preset({
    id: 'cats_crown_lace',
    name: "Cat's Crown Lace",
    family: 'lace',
    group: 'shetland',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [16, 16],
    tags: ['shetland', 'crown', 'zigzag', 'hap'],
    description:
      "The Shetland cat's-crown diamond: four diagonal runs of paired decreases meet at points above and below, drawn from the hap-shawl repertoire.",
    generate: lacedRows(16, 16, {
      0: [[3, 'R'], [10, 'L']],
      2: [[4, 'R'], [9, 'L']],
      4: [[5, 'R'], [8, 'L']],
      6: [[6, 'R'], [7, 'L']],
      10: [[6, 'L'], [9, 'R']],
      12: [[4, 'L'], [11, 'R']],
      14: [[2, 'L'], [13, 'R']]
    })
  }),

  preset({
    id: 'pickle_lace',
    name: 'Pickle (Prickle) Lace',
    family: 'lace',
    group: 'shetland',
    bed: 'single-bed',
    rows: 32,
    cols: 24,
    mode: 'lace',
    repeat: [16, 16],
    tags: ['shetland', 'diamond', 'hap'],
    description:
      'The little prickle-diamond of the Shetland hap: a lozenge of eyelets outlined by two opposing diagonal runs, repeated on the point.',
    generate: lacedRows(16, 16, {
      0: [[7, 'R']],
      2: [[6, 'R'], [9, 'L']],
      4: [[5, 'R'], [10, 'L']],
      6: [[4, 'R'], [11, 'L']],
      8: [[7, 'L']],
      10: [[8, 'R'], [5, 'L']],
      12: [[10, 'R'], [3, 'L']],
      14: [[12, 'R'], [1, 'L']]
    })
  }),

  preset({
    id: 'cross_bars_lace',
    name: 'Crossed Bars Ground',
    family: 'lace',
    group: 'shetland',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [8, 8],
    tags: ['ground', 'bars', 'openwork'],
    description:
      'A utilitarian Shetland ground: short diagonal bars cross into Xs and leave the field dotted, the pattern knitted behind the lace border rather than being the border.',
    generate: lacedRows(8, 8, {
      0: [[1, 'R'], [5, 'R']],
      2: [[2, 'L'], [6, 'L']],
      4: [[1, 'R'], [5, 'R']],
      6: [[0, 'L'], [4, 'L']]
    })
  }),

  preset({
    id: 'half_flying_bird_lace',
    name: 'Half Flying Bird Lace',
    family: 'lace',
    group: 'shetland',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [12, 12],
    tags: ['shetland', 'bird', 'flight', 'classic'],
    description:
      'The flying-bird flight of the Shetland tradition, halved to fit one repeat: each bird is a V of eyelets with the wings drawn inward by two decreases.',
    generate: lacedRows(12, 12, {
      0: [[1, 'R'], [9, 'L']],
      2: [[2, 'R'], [8, 'L']],
      4: [[3, 'R'], [7, 'L']],
      6: [[5, 'R'], [6, 'L']],
      8: [[2, 'L'], [9, 'R']],
      10: [[1, 'L'], [10, 'R']]
    })
  }),

  preset({
    id: 'old_shale_shawl_border_lace',
    name: 'Old Shale Shawl Border',
    family: 'lace',
    group: 'shetland',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [12, 16],
    tags: ['shetland', 'fan', 'border', 'rim'],
    description:
      'The waved border of the RIP shawl: a fan of decreases gathering to a peak, an eyelet band, then decreases spreading back to the valley.',
    generate: lacedRows(12, 16, {
      0: [[1, 'R'], [9, 'L']],
      2: [[2, 'R'], [8, 'L']],
      4: [[3, 'R'], [7, 'L']],
      8: [[4, 'L'], [6, 'R']],
      10: [[2, 'L'], [8, 'R']],
      12: [[0, 'L'], [10, 'R']]
    })
  }),

  preset({
    id: 'cathedral_window_lace',
    name: 'Cathedral Window Lace',
    family: 'lace',
    group: 'cathedral',
    bed: 'single-bed',
    rows: 32,
    cols: 24,
    mode: 'lace',
    repeat: [12, 16],
    tags: ['gothic', 'arch', 'victorian', 'window'],
    description:
      'The Victorian cathedral arch: a pointed window outlined by slanting decrease runs, with an eyelet mesh filling the light.',
    generate: lacedRows(12, 16, {
      0: [[2, 'R'], [8, 'L']],
      2: [[3, 'R'], [7, 'L']],
      4: [[4, 'R'], [6, 'L']],
      6: [[5, 'R']],
      10: [[2, 'L'], [9, 'R']],
      12: [[1, 'L'], [10, 'R']],
      14: [[0, 'L'], [11, 'R']]
    })
  }),

  preset({
    id: 'faggot_net_lace',
    name: 'Faggot Net Ground',
    family: 'lace',
    group: 'cathedral',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [4, 4],
    tags: ['net', 'ground', 'victorian', 'openwork'],
    description:
      'The plain faggot net of the Priscilla era — an every-row lattice of tiny holes, the ground cloth of Victorian baby wrappers.',
    generate: lacedRows(4, 4, {
      0: [[0, 'R'], [2, 'R']],
      2: [[1, 'L'], [3, 'L']]
    })
  }),

  preset({
    id: 'cheyne_ruffle_lace',
    name: 'Cheyne Ruffle Lace',
    family: 'lace',
    group: 'cathedral',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [8, 8],
    tags: ['ruffle', 'fluting', 'victorian', 'trimmings'],
    description:
      'The fluting that made Victorian ruffles: a decrease pair pulls the fabric into a reed, an eyelet pair releases it into the wave.',
    generate: lacedRows(8, 8, {
      0: [[1, 'R'], [5, 'L']],
      4: [[2, 'L'], [6, 'R']]
    })
  }),

  preset({
    id: 'old_french_fan_lace',
    name: 'Old French Fan Lace',
    family: 'lace',
    group: 'continental',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [12, 12],
    tags: ['french', 'fan', 'eyelet-band'],
    description:
      "The 'Old French' fan of the machine-lace books: a pleated fan of eyelets gathered at the stem, worked as two rows of holes either side of a plain rib.",
    generate: lacedRows(12, 12, {
      0: [[2, 'R'], [8, 'L']],
      2: [[3, 'R'], [7, 'L']],
      4: [[4, 'R'], [6, 'L']],
      8: [[5, 'L'], [6, 'R']]
    })
  }),

  preset({
    id: 'italian_ruche_lace',
    name: 'Italian Ruche Pleat Lace',
    family: 'lace',
    group: 'continental',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [8, 6],
    tags: ['italian', 'pleat', 'ruche', 'trimmings'],
    description:
      'A machine-knitted pleat: dense decrease columns and eyelet columns alternate so the fabric collapses into standing knife pleats when blocked.',
    generate: lacedRows(8, 6, {
      0: [[1, 'R'], [5, 'L']],
      2: [[0, 'L'], [4, 'R']],
      4: [[2, 'R'], [6, 'L']]
    })
  }),

  preset({
    id: 'cluny_lace',
    name: 'Cluny Lace Ground',
    family: 'lace',
    group: 'continental',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [8, 8],
    tags: ['cluny', 'irish', 'ground', 'cross'],
    description:
      'The Cluny cross-ground adapted for the carriage: four-armed crosses of eyelets joined by short bars of transferred stitches.',
    generate: lacedRows(8, 8, {
      0: [[3, 'R'], [4, 'L']],
      2: [[1, 'R'], [6, 'L']],
      4: [[2, 'L'], [5, 'R']],
      6: [[0, 'R'], [7, 'L']]
    })
  }),

  preset({
    id: 'beehive_mesh_lace',
    name: 'Beehive Mesh Lace',
    family: 'lace',
    group: 'british',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [8, 8],
    tags: ['beehive', 'mesh', 'british', 'kossu'],
    description:
      'The domed hive of the British mesh tradition: eyelet ribs that bell outward and close at the crown, worked entirely with balanced pairs.',
    generate: lacedRows(8, 8, {
      0: [[1, 'R'], [5, 'L']],
      2: [[0, 'R'], [6, 'L']],
      4: [[2, 'R'], [4, 'L']],
      6: [[1, 'L'], [5, 'R']]
    })
  }),

  preset({
    id: 'beeswing_lace',
    name: "Bee's Wing Mesh Lace",
    family: 'lace',
    group: 'british',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [6, 6],
    tags: ['beeswing', 'mesh', 'british'],
    description:
      'A wing of eyelets slanting down from each spine, the mesh that gives the British name its buzz; light, even and endlessly repeatable.',
    generate: lacedRows(6, 6, {
      0: [[1, 'R'], [4, 'L']],
      2: [[2, 'R'], [5, 'L']],
      4: [[0, 'L'], [3, 'R']]
    })
  }),

  preset({
    id: 'honeycomb_knit_lace',
    name: 'Honeycomb Knitted Lace',
    family: 'lace',
    group: 'british',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [8, 8],
    tags: ['honeycomb', 'cell', 'british', 'mesh'],
    description:
      'The knitted honeycomb: cells of eyelets with a solid wall between, the wall shifted half a cell every other worked round.',
    generate: lacedRows(8, 8, {
      0: [[0, 'R'], [2, 'R'], [4, 'R'], [6, 'R']],
      2: [[1, 'L'], [3, 'L'], [5, 'L'], [7, 'L']],
      4: [[0, 'R'], [2, 'R'], [4, 'R'], [6, 'R']],
      6: [[1, 'L'], [3, 'L'], [5, 'L'], [7, 'L']]
    })
  }),

  preset({
    id: 'faroe_lace',
    name: 'Faroes Lace',
    family: 'lace',
    group: 'british',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [10, 8],
    tags: ['faeroe', 'scandinavian', 'mesh', 'ladder'],
    description:
      'The ladder-and-net of the Faroes: an open rung every ten needles with a paired decrease at each side, so the fabric gathers into vertical eyes.',
    generate: lacedRows(10, 8, {
      0: [[2, 'R'], [6, 'L']],
      2: [[4, 'R'], [5, 'L']],
      4: [[1, 'R'], [7, 'L']],
      6: [[3, 'L'], [6, 'R']]
    })
  }),

  preset({
    id: 'moster_mitten_lace',
    name: 'M\u00f8ster Mitten Lace',
    family: 'lace',
    group: 'british',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [8, 12],
    tags: ['norwegian', 'm\u00f8ster', 'mitten', 'star'],
    description:
      'The star lattice of the M\u00f8ster mitten, translated into lace: radiating eyelet spokes with a decrease at every junction.',
    generate: lacedRows(8, 12, {
      0: [[1, 'R'], [5, 'L']],
      2: [[2, 'R'], [6, 'L']],
      4: [[3, 'R'], [7, 'L']],
      6: [[1, 'L'], [5, 'R']],
      8: [[2, 'L'], [6, 'R']],
      10: [[3, 'L'], [7, 'R']]
    })
  }),

  preset({
    id: 'fir_tree_lace',
    name: 'Fir Tree Lace',
    family: 'lace',
    group: 'botanical',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [12, 12],
    tags: ['scandinavian', 'tree', 'chevron', 'botanical'],
    description:
      'The Norwegian fir: a stack of chevrons, each one a pair of eyelet rows leaning at each other, widening as the tree grows.',
    generate: lacedRows(12, 12, {
      0: [[5, 'L'], [6, 'R']],
      2: [[4, 'L'], [7, 'R']],
      4: [[3, 'L'], [8, 'R']],
      6: [[2, 'L'], [9, 'R']],
      8: [[1, 'L'], [10, 'R']],
      10: [[0, 'L'], [11, 'R']]
    })
  }),

  preset({
    id: 'trumpet_vine_lace',
    name: 'Trumpet Vine Lace',
    family: 'lace',
    group: 'botanical',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [10, 12],
    tags: ['vine', 'floral', 'priscilla', 'botanical'],
    description:
      'The trumpet-vine trim of the classic machine-lace manuals: a flared mouth of eyelets narrowing to a stem, worked in columns that lean alternately.',
    generate: lacedRows(10, 12, {
      0: [[4, 'R'], [5, 'L']],
      2: [[3, 'R'], [6, 'L']],
      4: [[2, 'R'], [7, 'L']],
      6: [[1, 'R'], [8, 'L']],
      8: [[3, 'L'], [6, 'R']],
      10: [[1, 'L'], [8, 'R']]
    })
  }),

  preset({
    id: 'ivy_chain_lace',
    name: 'Ivy Chain Lace',
    family: 'lace',
    group: 'botanical',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [12, 16],
    tags: ['ivy', 'chain', 'border', 'botanical'],
    description:
      'A running chain of leaves linked by eyelet loops: each leaf is a lens of two mirrored diagonals, the chain drifting half a repeat as it climbs.',
    generate: lacedRows(12, 16, {
      0: [[2, 'R'], [8, 'L']],
      2: [[3, 'R'], [7, 'L']],
      4: [[4, 'R'], [6, 'L']],
      6: [[5, 'R'], [6, 'L']],
      8: [[3, 'L'], [8, 'R']],
      10: [[1, 'L'], [10, 'R']],
      12: [[2, 'R'], [9, 'L']],
      14: [[4, 'L'], [7, 'R']]
    })
  }),

  preset({
    id: 'fern_frond_lace',
    name: 'Fern Frond Lace',
    family: 'lace',
    group: 'botanical',
    bed: 'single-bed',
    rows: 32,
    cols: 24,
    mode: 'lace',
    repeat: [12, 16],
    tags: ['fern', 'frond', 'botanical', 'flight'],
    description:
      'A central stem with pinnae branching off it in pairs, each frond leaf drawn out by a short slant of holes.',
    generate: lacedRows(12, 16, {
      0: [[1, 'R'], [9, 'L']],
      2: [[2, 'R'], [8, 'L']],
      4: [[3, 'R'], [7, 'L']],
      6: [[5, 'R'], [6, 'L']],
      8: [[1, 'L'], [9, 'R']],
      10: [[2, 'L'], [8, 'R']],
      12: [[3, 'L'], [7, 'R']],
      14: [[5, 'L'], [6, 'R']]
    })
  }),

  preset({
    id: 'leaf_lace',
    name: 'Plain Leaf Lace',
    family: 'lace',
    group: 'botanical',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [10, 12],
    tags: ['leaf', 'pointed', 'botanical'],
    description:
      'The simplest readable leaf: an eyelet outline that closes to a point at the tip and opens again at the stalk, with a solid midrib.',
    generate: lacedRows(10, 12, {
      0: [[4, 'R'], [5, 'L']],
      2: [[3, 'R'], [6, 'L']],
      4: [[2, 'R'], [7, 'L']],
      6: [[1, 'R'], [8, 'L']],
      8: [[3, 'L'], [6, 'R']],
      10: [[1, 'L'], [8, 'R']]
    })
  }),

  preset({
    id: 'zigzag_chevron_lace',
    name: 'Chevron Zig-Zag Lace',
    family: 'lace',
    group: 'botanical',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [8, 8],
    tags: ['chevron', 'zigzag', 'wave'],
    description:
      'A hard-edged zig-zag of holes, the pattern every machine-lace book uses to teach direction changes without racking.',
    generate: lacedRows(8, 8, {
      0: [[1, 'L'], [4, 'R']],
      2: [[2, 'L'], [5, 'R']],
      4: [[3, 'L'], [6, 'R']],
      6: [[0, 'R'], [3, 'L']]
    })
  }),

  preset({
    id: 'diamond_yoke_lace',
    name: 'Diamond Yoke Lace',
    family: 'lace',
    group: 'botanical',
    bed: 'single-bed',
    rows: 32,
    cols: 24,
    mode: 'lace',
    repeat: [12, 16],
    tags: ['diamond', 'yoke', 'icelandic', 'mesh'],
    description:
      'The lace answer to the lopi yoke: nested diamonds outlined in holes, with a solid spine to hang the shoulders on.',
    generate: lacedRows(12, 16, {
      0: [[5, 'R'], [6, 'L']],
      2: [[4, 'R'], [7, 'L']],
      4: [[3, 'R'], [8, 'L']],
      6: [[2, 'R'], [9, 'L']],
      8: [[5, 'L'], [6, 'R']],
      10: [[4, 'L'], [7, 'R']],
      12: [[3, 'L'], [8, 'R']],
      14: [[2, 'L'], [9, 'R']]
    })
  }),

  preset({
    id: 'gauffered_ruffle_lace',
    name: 'Gauffered Ruffle Lace',
    family: 'lace',
    group: 'continental',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [8, 6],
    tags: ['ruffle', 'gauffer', 'pleat', 'french'],
    description:
      'Pleats that will not fold flat: a row of tight paired holes against a row of eyelet slack, the machine version of the French gauffering iron.',
    generate: lacedRows(8, 6, {
      0: [[1, 'R'], [5, 'R']],
      3: [[0, 'L'], [4, 'L']]
    })
  }),

  preset({
    id: 'drop_stitch_mesh_lace',
    name: 'Drop-Stitch Gauze Mesh',
    family: 'lace',
    group: 'mesh',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [6, 6],
    tags: ['gauze', 'mesh', 'open', 'summer'],
    description:
      'The summer gauze: vertical ladders of holes in every sixth column, held by a wall of plain needles so the fabric still has a grain.',
    generate: lacedRows(6, 6, {
      0: [[0, 'R']],
      2: [[2, 'L']],
      4: [[4, 'R']]
    })
  }),

  preset({
    id: 'fishnet_diamond_lace',
    name: 'Fishnet Diamond Lace',
    family: 'lace',
    group: 'mesh',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [8, 8],
    tags: ['fishnet', 'diamond', 'open', 'net'],
    description:
      'The diamond fishnet of nets and summer scarves: two diagonal hole runs crossing at the midrib, opening widest at the middle of the cell.',
    generate: lacedRows(8, 8, {
      0: [[1, 'R'], [5, 'R']],
      2: [[2, 'R'], [6, 'R']],
      4: [[3, 'L'], [7, 'L']],
      6: [[0, 'L'], [4, 'L']]
    })
  }),

  preset({
    id: 'simple_eyelet_ruffle_lace',
    name: 'Simple Eyelet Ruffle',
    family: 'lace',
    group: 'beginner',
    bed: 'single-bed',
    rows: 16,
    cols: 24,
    mode: 'lace',
    repeat: [4, 4],
    tags: ['beginner', 'ruffle', 'two-row'],
    description:
      'The two-row lesson: one row of hole pairs, three rows of plain, and the hem flutes itself. Everything a beginner needs to see that the carriage really did move loops.',
    generate: lacedRows(4, 4, {
      0: [[0, 'R'], [2, 'R']]
    })
  }),

  preset({
    id: 'garter_band_lace',
    name: 'Garter Eyelet Band Lace',
    family: 'lace',
    group: 'beginner',
    bed: 'single-bed',
    rows: 16,
    cols: 24,
    mode: 'lace',
    repeat: [6, 8],
    tags: ['beginner', 'band', 'hem', 'two-row'],
    description:
      'A beginner band with a single horizontal eye of holes every eight rows — wide enough to read as a design line, narrow enough to knit without counting.',
    generate: lacedRows(6, 8, {
      3: [[0, 'R'], [3, 'L']]
    })
  }),

  preset({
    id: 'scalloped_rim_lace',
    name: 'Scalloped Picot Rim',
    family: 'lace',
    group: 'beginner',
    bed: 'single-bed',
    rows: 16,
    cols: 24,
    mode: 'lace',
    repeat: [8, 8],
    tags: ['scallop', 'rim', 'edging', 'beginner'],
    description:
      'The scalloped edge of a baby blanket: a rounded arc of hole pairs around a solid shell, worked from the bottom row upward so the wave sits on the cast-on edge.',
    generate: lacedRows(8, 8, {
      0: [[3, 'R']],
      2: [[1, 'R'], [5, 'L']],
      4: [[0, 'R'], [6, 'L']]
    })
  }),

  preset({
    id: 'french_lace_fan_band',
    name: 'French Lace Fan Band (Eyelet Fanner)',
    family: 'lace',
    group: 'continental',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [12, 8],
    tags: ['french', 'eyelet-fan', 'band', 'ruffling'],
    description:
      "The 'French lace' of the eyelet-fanner era: a dense band of tiny holes that draws up into a standing frill, set against solid columns so the ruffle breaks into scallops.",
    generate: lacedRows(12, 8, {
      0: [[0, 'R'], [2, 'R'], [4, 'R'], [6, 'R'], [8, 'R']],
      4: [[1, 'L'], [3, 'L'], [5, 'L'], [7, 'L'], [9, 'L']]
    })
  }),

  preset({
    id: 'spokes_radiant_lace',
    name: 'Radiant Spoke Lace',
    family: 'lace',
    group: 'cathedral',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [12, 12],
    tags: ['spoke', 'radiating', 'wheel', 'geometric'],
    description:
      'A wheel of spokes: hole pairs running outward from a solid hub, the eyelet geometry used for shawl centres and window panels.',
    generate: lacedRows(12, 12, {
      0: [[5, 'L'], [6, 'R']],
      2: [[4, 'L'], [7, 'R']],
      4: [[3, 'L'], [8, 'R']],
      6: [[2, 'L'], [9, 'R']],
      8: [[1, 'L'], [10, 'R']],
      10: [[0, 'L'], [11, 'R']]
    })
  }),

  preset({
    id: 'trellis_lattice_lace',
    name: 'Trellis Lattice Lace',
    family: 'lace',
    group: 'mesh',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [8, 8],
    tags: ['trellis', 'lattice', 'garden', 'diagonal'],
    description:
      'Crossing diagonal bars of holes with solid crossings, the lattice that reads as a garden trellis once blocked flat.',
    generate: lacedRows(8, 8, {
      0: [[1, 'R'], [5, 'L']],
      2: [[2, 'R'], [6, 'L']],
      4: [[3, 'R'], [7, 'L']],
      6: [[0, 'L'], [4, 'R']]
    })
  }),

  preset({
    id: 'wave_pebble_lace',
    name: 'Wave & Pebble Lace',
    family: 'lace',
    group: 'botanical',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [16, 12],
    tags: ['wave', 'pebble', 'organic', 'sea'],
    description:
      'A long wave with scattered single eyes under it — the sea-and-shingle ground that was a staple of 1950s home-machine manuals.',
    generate: lacedRows(16, 12, {
      0: [[2, 'R'], [8, 'R'], [13, 'L']],
      2: [[4, 'R'], [10, 'L']],
      4: [[1, 'L'], [6, 'R'], [12, 'L']],
      7: [[5, 'R']],
      9: [[11, 'R']]
    })
  }),

  preset({
    id: 'hearts_flight_lace',
    name: 'Flight of Hearts Lace',
    family: 'lace',
    group: 'romance',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    repeat: [12, 12],
    tags: ['heart', 'romance', 'gift', 'eyelet'],
    description:
      'A grid of small hearts punched in eyelets, each lobe a pair of holes and each point a decrease — the love-token lace for a cuff or a hem.',
    generate: lacedRows(12, 12, {
      0: [[1, 'R'], [4, 'L'], [7, 'R'], [10, 'L']],
      2: [[0, 'R'], [5, 'L'], [6, 'R'], [11, 'L']],
      4: [[2, 'L'], [9, 'R']],
      6: [[4, 'L'], [7, 'R']],
      8: [[5, 'L'], [6, 'R']]
    })
  })
];
