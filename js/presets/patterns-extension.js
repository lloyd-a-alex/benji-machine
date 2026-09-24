/**
 * KNITCAT — Pattern library, extended traditions slate.
 *
 * The library is generative and taxonomy-classified (see `preset-catalog.js` for the
 * family/group menus and `preset-recipe-helpers.js` for the shared authoring toolkit).
 * This file adds a broad slate of further named traditions a knitter looks up by name:
 * more Shetland and Victorian lace, the Nordic/Baltic and Fair-Isle colorwork colourways,
 * the slip/tuck/rib textures that build fabric without extra colours, the reversible
 * double-bed structures, and a family of mathematical (cellular-automata / number-theory
 * / tiling) generative cards.
 *
 * Correctness is inherited, not hand-checked: every lace recipe is laid with `holeRow`,
 * which emits a yarn-over and its paired decrease as one indivisible, net-zero atom, so
 * each worked row is stitch-balanced by construction and `tests/preset-library.test.mjs`
 * re-measures that across the whole library. Direct-mode (colorwork / texture / DB /
 * generative) recipes emit only 0 / 1. Seeded generative recipes are deterministic.
 *
 * @module presets/patterns-extension
 */

import {
  preset, blankLace, blankDirect, holeRow, makeRandom
} from './preset-recipe-helpers.js';

const round = Math.round;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Build a balanced-lace generator from a table of hole-row phases. */
function lace(width, height, plan) {
  return (rows, cols) => {
    const matrix = blankLace(rows, cols);
    for (let r = 0; r < rows; r++) {
      const phase = ((r % height) + height) % height;
      if (plan[phase]) holeRow(matrix[r], width, plan[phase]);
    }
    return matrix;
  };
}

/** Fill a direct chart with `fn(row, col) -> 0|1`, evaluated on the whole bed. */
function direct(fn) {
  return (rows, cols) => {
    const matrix = blankDirect(rows, cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) matrix[r][c] = fn(r, c) ? 1 : 0;
    }
    return matrix;
  };
}

/** An elementary cellular automaton seeded from a single centre pixel, on a wrap ring. */
function automaton(rule) {
  return (rows, cols) => {
    const matrix = blankDirect(rows, cols);
    const apply = (l, c, rr) => (((rule >> ((l << 2) | (c << 1) | rr)) & 1));
    const seed = Math.floor(cols / 2);
    matrix[0][seed] = 1;
    for (let r = 1; r < rows; r++) {
      const prev = matrix[r - 1];
      for (let c = 0; c < cols; c++) {
        const l = prev[(c - 1 + cols) % cols];
        const mid = prev[c];
        const rr = prev[(c + 1) % cols];
        matrix[r][c] = apply(l, mid, rr);
      }
    }
    return matrix;
  };
}

/** Seamless periodic value noise: a smooth 2-D field thresholded to a hard card. */
function noiseCells(freqX, freqY, phase, threshold) {
  return (rows, cols) => {
    const matrix = blankDirect(rows, cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v =
          Math.sin((c / cols) * Math.PI * 2 * freqX + phase) +
          Math.sin((r / rows) * Math.PI * 2 * freqY + phase * 0.5) +
          Math.sin(((c + r) / (cols + rows)) * Math.PI * 2 * (freqX + freqY));
        matrix[r][c] = v > threshold ? 1 : 0;
      }
    }
    return matrix;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LACE — further Shetland, Victorian and mesh traditions (all stitch-balanced).
// ─────────────────────────────────────────────────────────────────────────────

export const EXTENDED_LACE_PRESETS = [
  preset({
    id: 'beehive_lace', name: 'Beehive Lace', family: 'lace', group: 'british', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'lace', repeat: [8, 8], tags: ['beehive', 'honeycomb', 'shetland'],
    description: 'Rising columns of paired decreases close over an open mesh to dome the classic hexagonal beehive cell.',
    generate: lace(8, 8, { 0: [[1, 'R'], [5, 'L']], 2: [[2, 'R'], [4, 'L']], 4: [[3, 'L'], [3, 'R']], 6: [[2, 'L'], [4, 'R']] })
  }),
  preset({
    id: 'old_spangled_lace', name: 'Old Spangled Lace', family: 'lace', group: 'shetland', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'lace', repeat: [12, 12], tags: ['shetland', 'spangle', 'hap', 'classic'],
    description: 'The Shetland \"spangle\": single eyelets sown between leaning decrease ribs, the sparkle ground of a hap-shawl border.',
    generate: lace(12, 12, { 0: [[2, 'R'], [8, 'L']], 3: [[4, 'R'], [6, 'L']], 6: [[4, 'L'], [6, 'R']], 9: [[2, 'L'], [8, 'R']] })
  }),
  preset({
    id: 'cabbage_lace', name: 'Cabbage & pars / Sheep\u2019s Brain', family: 'lace', group: 'british', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'lace', repeat: [12, 12], tags: ['cabbage', 'moster', 'moss', 'raised'],
    description: 'The M\u00f8ster / Scandinavian raised leaf ground: dense crossed eyelets cluster into a cabbage-textured boss.',
    generate: lace(12, 12, { 0: [[2, 'R'], [8, 'L']], 2: [[3, 'R'], [7, 'L']], 4: [[4, 'R'], [6, 'L']], 8: [[5, 'L'], [5, 'R']] })
  }),
  preset({
    id: 'faroes_lace', name: 'Faeroe Lace', family: 'lace', group: 'british', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'lace', repeat: [8, 8], tags: ['faeroe', 'tree', 'classic'],
    description: 'The old Faeroe tree-of-life ground: a narrow paired-crease column flanked by two upright eyelet lanes.',
    generate: lace(8, 8, { 0: [[1, 'R'], [6, 'L']], 2: [[2, 'R'], [5, 'L']], 4: [[3, 'R'], [4, 'L']] })
  }),
  preset({
    id: 'raspberry_point_lace', name: 'Raspberry Point', family: 'lace', group: 'botanical', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'lace', repeat: [8, 16], tags: ['raspberry', 'point', 'bobble', 'faggot'],
    description: 'Victorian faggot ground: the berry pips ride at the crossing of four converging eyelet seams.',
    generate: lace(8, 8, { 0: [[2, 'R'], [6, 'L']], 4: [[2, 'L'], [6, 'R']] })
  }),
  preset({
    id: 'open_faggot_lace', name: 'Open Faggot Netting', family: 'lace', group: 'cathedral', bed: 'single-bed',
    rows: 12, cols: 12, mode: 'lace', repeat: [6, 6], tags: ['faggot', 'net', 'victorian', 'seam'],
    description: 'The decorative joining seam itself — a lean of eyelets and decreases along every faggot.',
    generate: lace(6, 6, { 0: [[1, 'R'], [4, 'L']], 3: [[2, 'R'], [3, 'L']] })
  }),
  preset({
    id: 'cluny_cross_lace', name: 'Cluny Cross Ground', family: 'lace', group: 'continental', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'lace', repeat: [8, 8], tags: ['cluny', 'cross', 'bobbin', 'irish'],
    description: 'The Cluny lace eyelet braid: crossing decreases weave an X lattice over a light gu\u00e9re grounds.',
    generate: lace(8, 8, { 0: [[1, 'R'], [5, 'L']], 2: [[3, 'L'], [3, 'R']], 4: [[1, 'L'], [5, 'R']], 6: [[3, 'R'], [3, 'L']] })
  }),
  preset({
    id: 'snakes_lace', name: 'Snakes / Twisted Tube Lace', family: 'lace', group: 'mesh', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'lace', repeat: [6, 8], tags: ['snake', 'twist', 'tube', 'mesh'],
    description: 'A twisting ladder of half-helix decreases makes the writhing "snake" column popular on 1950s cardigans.',
    generate: lace(6, 6, { 0: [[1, 'R'], [3, 'L']], 2: [[2, 'R'], [4, 'L']], 4: [[1, 'L'], [3, 'R']] })
  }),
  preset({
    id: 'gauze_honeycomb_lace', name: 'Gauze Honeycomb', family: 'lace', group: 'mesh', bed: 'single-bed',
    rows: 20, cols: 20, mode: 'lace', repeat: [10, 10], tags: ['gauze', 'honeycomb', 'openwork', 'drop'],
    description: 'An open drop-stitch mesh with hexagonal closes, the lightest ground on the bed — mostly hole.',
    generate: lace(10, 10, { 0: [[1, 'R'], [6, 'L'], [8, 'R']], 4: [[3, 'L'], [4, 'R'], [8, 'L']] })
  }),
  preset({
    id: 'prairie_sunset_lace', name: 'Prairie Points', family: 'lace', group: 'cathedral', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'lace', repeat: [8, 8], tags: ['prairie', 'point', 'triangle', 'edging'],
    description: 'A row-to-row slant gathers the hem into the sawtooth of prairie points worked in the round.',
    generate: lace(8, 8, { 0: [[1, 'R'], [2, 'R'], [5, 'L'], [6, 'L']], 4: [[3, 'L'], [4, 'R']] })
  }),
  preset({
    id: 'fern_branch_lace', name: 'Fern Branch Lace', family: 'lace', group: 'botanical', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'lace', repeat: [12, 12], tags: ['fern', 'frond', 'botanical', 'branch'],
    description: 'Paired eyelet fronds lean off a central rib and arch back, repeating the unfurling of a fern.',
    generate: lace(12, 12, { 0: [[2, 'R'], [10, 'L']], 2: [[3, 'R'], [9, 'L']], 4: [[4, 'R'], [8, 'L']], 6: [[5, 'R'], [7, 'L']] })
  }),
  preset({
    id: 'scallop_shell_lace', name: 'Scallop Shell Lace', family: 'lace', group: 'botanical', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'lace', repeat: [12, 8], tags: ['scallop', 'shell', 'fan', 'edging'],
    description: 'The fan of ribs radiating from a single point: increases bloom outward across the shell of the edging.',
    generate: lace(12, 8, { 0: [[2, 'L'], [6, 'R'], [6, 'L'], [10, 'R']], 4: [[4, 'L'], [8, 'L']] })
  }),
  preset({
    id: 'chevron_ridge_lace', name: 'Chevron Ridge Lace', family: 'lace', group: 'botanical', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'lace', repeat: [8, 8], tags: ['chevron', 'zigzag', 'ridge'],
    description: 'A crisp zig-zag of alternating lean rows breaks the fabric into horizontal chevrons.',
    generate: lace(8, 8, { 0: [[1, 'R'], [2, 'R'], [5, 'L'], [6, 'L']], 4: [[1, 'L'], [2, 'L'], [5, 'R'], [6, 'R']] })
  }),
  preset({
    id: 'love_knot_lace', name: 'Love Knot Lace', family: 'lace', group: 'romance', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'lace', repeat: [12, 12], tags: ['knot', 'heart', 'gift', 'cable'],
    description: 'Crossing decreases interlace into a chain of false-knots — the garter-stitch "love maze" of gift lace.',
    generate: lace(12, 12, { 0: [[3, 'R'], [8, 'L']], 3: [[5, 'L'], [6, 'R']], 6: [[3, 'L'], [8, 'R']], 9: [[5, 'R'], [6, 'L']] })
  })
];

// ─────────────────────────────────────────────────────────────────────────────
// COLORWORK — further Nordic, Fair Isle and global stranded motifs (0/1 only).
// ─────────────────────────────────────────────────────────────────────────────

export const EXTENDED_COLORWORK_PRESETS = [
  preset({
    id: 'selbu_eightpoint_star', name: 'Selbu Eight-Point Star', family: 'colorwork', group: 'nordic', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'fair_isle', repeat: [8, 8], tags: ['selbu', 'star', 'nordic', 'norwegian'],
    description: 'The eight-pointed Selbumsdi from Norway\u2019s Telemark, on a two-colour ground with a diamond of stars.',
    generate: direct((r, c) => {
      const x = c % 8, y = r % 8;
      const d = Math.abs(x - 3.5) + Math.abs(y - 3.5);
      return (x === y || x + y === 7 || d < 2.4);
    })
  }),
  preset({
    id: 'ostrogs_star', name: 'Ostro\u017ce Eight-Point Star', family: 'colorwork', group: 'nordic', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'fair_isle', repeat: [8, 8], tags: ['latvia', 'ostrogs', 'star', 'baltic'],
    description: 'A Latvian/Baltic star with radiating arms and a solid heart centre, the Ostro\u017ce siumklu star.',
    generate: direct((r, c) => {
      const x = c % 8, y = r % 8;
      const ring = Math.max(Math.abs(x - 3.5), Math.abs(y - 3.5));
      return x === 3 || x === 4 || y === 3 || y === 4 || Math.abs(x - y) < 1.5 || Math.abs(x + y - 7) < 1.5 || (x === 0 && y === 0) || (x === 7 && y === 7) || (x === 7 && y === 0) || (x === 0 && y === 7);
    })
  }),
  preset({
    id: 'garden_paradise', name: 'Garden of Paradise', family: 'colorwork', group: 'celtic', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'fair_isle', repeat: [16, 12], tags: ['fair-isle', 'tree', 'holly', 'celtic'],
    description: 'The Fair Isle "Tree of Life" border: alternating leaf and eyelet diamonds linked along a stem.',
    generate: direct((r, c) => {
      const x = c % 8, y = r % 12;
      return (Math.abs(x - y % 8) === 0 || Math.abs(7 - x - (y % 8)) === 0) || (x === 0 && y % 6 === 0);
    })
  }),
  preset({
    id: 'reindeer_peebeg', name: 'Pebeg Reindeer Band', family: 'colorwork', group: 'celtic', bed: 'single-bed',
    rows: 12, cols: 24, mode: 'fair_isle', repeat: [8, 10], tags: ['fair-isle', 'peebeg', 'reindeer', 'bird'],
    description: 'The Pebeg "moor" and reindeer bird motif, stepped and hooked, running as a Fair Isle yoke band.',
    generate: direct((r, c) => {
      const x = c % 8, y = r % 10;
      if (y === 0 || y === 9) return x % 4 === 0 || x % 4 === 1;
      return x === 2 || x === 5 || (y === 4 && x < 6);
    })
  }),
  preset({
    id: 'kilim_diamond_band', name: 'Kilim Diamond Band', family: 'colorwork', group: 'global', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'fair_isle', repeat: [8, 12], tags: ['kilim', 'anatolian', 'stepped', 'rug'],
    description: 'Anatolian carpet geometry: nested stepped diamonds in a tall-crested band borrowed from a kilim.',
    generate: direct((r, c) => {
      const x = c % 8, y = r % 12;
      const dy = y % 12;
      return Math.abs(x - 3.5) + Math.abs(((dy % 6) - 2.5)) < 3 || (dy === 0);
    })
  }),
  preset({
    id: 'latvian_fishbone', name: 'Latvian Fishbone', family: 'colorwork', group: 'global', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'fair_isle', repeat: [6, 8], tags: ['latvia', 'fishbone', 'weave', 'baltic'],
    description: 'The Latvian woven-band "fish" zig-zag — mirrored chevrons stacked to read as a spine and ribs.',
    generate: direct((r, c) => {
      const x = c % 6, y = r % 8;
      return (x === y % 6) || (x === (6 - (y % 6)) % 6);
    })
  }),
  preset({
    id: 'ocean_wave', name: 'Ocean Wave', family: 'colorwork', group: 'geometric', bed: 'single-bed',
    rows: 16, cols: 24, mode: 'fair_isle', repeat: [12, 6], tags: ['wave', 'seamill', 'breakwater', 'geometric'],
    description: 'The Shetland Seamill / breakwater: a rolling two-colour swell that repeats on a 12-stitch, 6-row wave.',
    generate: direct((r, c) => {
      const x = c % 12, y = r % 6;
      return y === (x < 6 ? x : 12 - x);
    })
  }),
  preset({
    id: 'mosaic_stripe', name: 'Mosaic Diagonal', family: 'colorwork', group: 'novelty', bed: 'single-bed',
    rows: 16, cols: 16, mode: 'fair_isle', repeat: [8, 8], tags: ['mosaic', 'slip-stitch', 'diagonal', 'optical'],
    description: 'A two-colour mosaic slipped so one colour climbs a diagonal while the other holds the ground.',
    generate: direct((r, c) => ((c + Math.floor(r / 2)) % 8 < 4))
  }),
  preset({
    id: 'rose_garland', name: 'Rose Garland Border', family: 'colorwork', group: 'picture', bed: 'single-bed',
    rows: 16, cols: 24, mode: 'fair_isle', repeat: [12, 10], tags: ['rose', 'garland', 'english', 'border'],
    description: 'A running border of English roses: a pip bloom every 12 stitches joined by a leafed stem.',
    generate: direct((r, c) => {
      const x = c % 12, y = r % 10;
      const bloom = Math.max(Math.abs(x - 5), Math.abs(y - 3)) <= 2 && (x + y) % 3 !== 0;
      return bloom || (y === 8 && x % 6 < 3);
    })
  }),
  preset({
    id: 'argyle_lattice', name: 'Argyle Lattice', family: 'colorwork', group: 'geometric', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'fair_isle', repeat: [8, 8], tags: ['argyle', 'lisle', 'diamond', 'scottish'],
    description: 'The cut-diamond argyle lattice with its over-check of brocade lines running corner to corner.',
    generate: direct((r, c) => {
      const x = c % 8, y = r % 8;
      return (x + y) % 8 === 0 || Math.abs(x - y) === 0 || (x === y) || (7 - x === y);
    })
  })
];

// ─────────────────────────────────────────────────────────────────────────────
// TEXTURE / STRUCTURE — fabric made by the carriage (slip, tuck, rib) without colour.
// ─────────────────────────────────────────────────────────────────────────────

export const EXTENDED_TEXTURE_PRESETS = [
  preset({
    id: 'true_waffle', name: 'True Waffle (Cellular Slip)', family: 'texture', group: 'slip', bed: 'single-bed',
    rows: 12, cols: 12, mode: 'slip', repeat: [6, 6], tags: ['waffle', 'grid', 'slip', 'thermal'],
    description: 'A slip-stitch waffle: skipped needles float the yarn behind into a sunken square grid.',
    generate: direct((r, c) => (c % 6 !== 0 && r % 6 !== 0) ? 0 : 1)
  }),
  preset({
    id: 'basket_weave_slip', name: 'Basket Weave', family: 'texture', group: 'slip', bed: 'single-bed',
    rows: 8, cols: 8, mode: 'slip', repeat: [4, 4], tags: ['basket', 'weave', 'slip', 'checker'],
    description: 'Warp-over-warp blocks alternate to fake the plaited surface of a woven basket.',
    generate: direct((r, c) => {
      const bx = Math.floor((c % 4) / 2), by = Math.floor((r % 4) / 2);
      return (bx + by) % 2 === 0 ? 1 : 0;
    })
  }),
  preset({
    id: 'dogtooth_stitch', name: 'Dogtooth', family: 'texture', group: 'stitches', bed: 'single-bed',
    rows: 8, cols: 8, mode: 'tuck', repeat: [4, 4], tags: ['dogtooth', 'milan', 'tuck', 'texture'],
    description: 'The Milanese dogtooth: little four-needle teeth punched into a tuck-stitch check.',
    generate: direct((r, c) => ((c % 4 < 2) === (r % 4 < 2)) ? 1 : 0)
  }),
  preset({
    id: 'moss_stitch', name: 'Moss / Granite Stitch', family: 'texture', group: 'stitches', bed: 'single-bed',
    rows: 4, cols: 8, mode: 'tuck', repeat: [2, 2], tags: ['moss', 'granite', 'linen', 'texture'],
    description: 'The linen/moss checker — every other needle tucked on every other row for a flat, nubbly face.',
    generate: direct((r, c) => (r + c) % 2 === 0 ? 1 : 0)
  }),
  preset({
    id: 'pique_wire', name: 'Wired Piqu\u00e9 Cord', family: 'texture', group: 'pique', bed: 'single-bed',
    rows: 8, cols: 8, mode: 'slip', repeat: [4, 4], tags: ['pique', 'wire', 'cord', 'double-plate'],
    description: 'Raised cords meant to hide a wire inside: the slip-stitch piqu\u00e9 grid that belting and mail-bags are woven from.',
    generate: direct((r, c) => (c % 4 === 0 || (r % 4 === 0 && c % 4 === 2)) ? 1 : 0)
  }),
  preset({
    id: 'potato_chip', name: 'Potato-Chip (Rippled Slip)', family: 'texture', group: 'slip', bed: 'single-bed',
    rows: 8, cols: 8, mode: 'slip', repeat: [4, 4], tags: ['potato-chip', 'ripple', 'slip', 'puff'],
    description: 'Little puffed four-stitch "chips" ripple up where the slipped floats gather the fabric.',
    generate: direct((r, c) => (r % 4 === c % 4 || r % 4 === (4 - c % 4) % 4) ? 1 : 0)
  })
];

// ─────────────────────────────────────────────────────────────────────────────
// DOUBLE BED — structures that need (or shine on) a second, opposed needle bed.
// ─────────────────────────────────────────────────────────────────────────────

export const EXTENDED_DOUBLEBED_PRESETS = [
  preset({
    id: 'fishermans_rib', name: 'Fisherman\u2019s Rib', family: 'double-bed', group: 'transfers', bed: 'double-bed',
    rows: 8, cols: 8, mode: 'fair_isle', repeat: [2, 2], tags: ['fisherman', 'rib', 'brioche', 'double-bed'],
    description: 'The two-bed 1x1 rib (with a stitch holder, "English rib") that gives the deep, spongy fisherman\u2019s column.',
    generate: direct((r, c) => (r + c) % 2 === 0 ? 1 : 0)
  }),
  preset({
    id: 'db_cable_braid', name: 'Cross-Bed Cable Braid', family: 'double-bed', group: 'cables', bed: 'double-bed',
    rows: 12, cols: 12, mode: 'fair_isle', repeat: [6, 6], tags: ['cable', 'braid', 'transfer', 'double-bed'],
    description: 'Loops travel bed-to-bed in alternating pairs to rope a cable without a needle tool.',
    generate: direct((r, c) => {
      const x = c % 6, y = r % 6;
      return x === y || x === (5 - y);
    })
  }),
  preset({
    id: 'rack_hole', name: 'Rack-Back Hole', family: 'double-bed', group: 'holes', bed: 'double-bed',
    rows: 6, cols: 12, mode: 'fair_isle', repeat: [6, 4], tags: ['racking', 'hole', 'piercing', 'double-bed'],
    description: 'Transfer out at rack 0, transfer back at rack \u00b11 — the two-row punched hole unique to racking.',
    generate: direct((r, c) => (r % 4 === 1 && c % 6 < 3) || (r % 4 === 3 && c % 6 >= 3) ? 1 : 0)
  }),
  preset({
    id: 'reversible_garter_db', name: 'Reversible Garter (Two-Face)', family: 'double-bed', group: 'reversible', bed: 'double-bed',
    rows: 8, cols: 8, mode: 'fair_isle', repeat: [4, 4], tags: ['reversible', 'garter', 'two-face', 'double-bed'],
    description: 'A double-knit that reads the same, colour-reversed, from either face of the cloth.',
    generate: direct((r, c) => ((c % 4 < 2) === (r % 4 < 2)) ? 1 : 0)
  }),
  preset({
    id: 'db_tubular_cord', name: 'Tubular I-Cord', family: 'double-bed', group: 'tubular', bed: 'double-bed',
    rows: 8, cols: 6, mode: 'fair_isle', repeat: [6, 4], tags: ['tubular', 'i-cord', 'drawcord', 'double-bed'],
    description: 'A closed tube knitted across both beds at once — the hidden drawcord and rolled edging of tubular work.',
    generate: direct((r, c) => (c === 0 || c === 5) ? 1 : 0)
  })
];

// ─────────────────────────────────────────────────────────────────────────────
// GENERATIVE — charts made by a rule (automata, number theory, tiling, noise).
// ─────────────────────────────────────────────────────────────────────────────

export const EXTENDED_GENERATIVE_PRESETS = [
  preset({
    id: 'rule30_solo', name: 'Rule 30 (Elementary CA)', family: 'generative', group: 'automata', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'fair_isle', seed: 1, tags: ['wolfram', 'automaton', 'chaotic', 'rule30'],
    description: 'Stephen Wolfram\u2019s Rule 30 grown from a single live cell on a ring — a chaotic, left-leanin\u2019 texture.',
    generate: automaton(30)
  }),
  preset({
    id: 'rule22_crystal', name: 'Rule 22 (Crystals)', family: 'generative', group: 'automata', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'fair_isle', seed: 1, tags: ['wolfram', 'automaton', 'crystal', 'rule22'],
    description: 'Rule 22 grows faceted, lattice-like crystals from a lone seed cell \u2014 ordered where Rule 30 is chaotic.',
    generate: automaton(22)
  }),
  preset({
    id: 'rule110_solo', name: 'Rule 110 (Turing)', family: 'generative', group: 'automata', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'fair_isle', seed: 1, tags: ['rule110', 'automaton', 'turing', 'gliders'],
    description: 'The computationally universal Rule 110 — gliders and background crystals from one seed pixel.',
    generate: automaton(110)
  }),
  preset({
    id: 'ulam_spiral_primes', name: 'Ulam Spiral Primes', family: 'generative', group: 'number', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'fair_isle', seed: 1, tags: ['ulam', 'prime', 'number', 'spiral'],
    description: 'Numbers spiralled out from the centre and only the primes punched — the Ulam diagonal mystery, on a card.',
    generate: direct((r, c) => {
      const x = c - 12, y = 12 - r;
      const ring = Math.max(Math.abs(x), Math.abs(y));
      let n = (2 * ring + 1) * (2 * ring + 1);
      if (y === -ring) n -= 2 * ring - (x + ring);
      else if (x === ring) n -= 2 * ring + (y + ring);
      else if (y === ring) n -= 2 * ring + (ring - x);
      else n -= 2 * ring + (ring - y);
      return isPrime(n) ? 1 : 0;
    })
  }),
  preset({
    id: 'times_table_mod7', name: 'Modular Times Table (7)', family: 'generative', group: 'number', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'fair_isle', seed: 1, tags: ['modular', 'times-table', 'number', 'lattice'],
    description: 'The multiplication table reduced modulo seven: a hard-edged lattice of resonant low points and empty high points.',
    generate: direct((r, c) => (((r + 1) * (c + 1)) % 7) < 3 ? 1 : 0)
  }),
  preset({
    id: 'truchet_tiles', name: 'Truchet Weave', family: 'generative', group: 'tiling', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'fair_isle', seed: 7, tags: ['truchet', 'tiles', 'arcs', 'maze'],
    description: 'A seeded field of quarter-arc tiles that join into a wandering maze across the whole card.',
    generate: (rows, cols) => {
      const rand = makeRandom(7);
      const matrix = blankDirect(rows, cols);
      for (let r = 0; r < rows; r += 2) {
        for (let c = 0; c < cols; c += 2) {
          const flip = rand() > 0.5;
          if (flip) { matrix[r][c] = 1; matrix[r + 1] && (matrix[r + 1][c + 1] = 1); }
          else { matrix[r][c + 1] = 1; matrix[r + 1] && (matrix[r + 1][c] = 1); }
        }
      }
      return matrix;
    }
  }),
  preset({
    id: 'topograph_bands', name: 'Topograph Contours', family: 'generative', group: 'noise', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'fair_isle', seed: 2, tags: ['contour', 'topograph', 'bands', 'interference'],
    description: 'Contour bands from a beating two-frequency field \u2014 a topographic map of an imaginary island, punched to a card.',
    generate: noiseCells(3, 2, 1.1, 0.2)
  }),
  preset({
    id: 'moire_rings', name: 'Moir\u00e9 Interference', family: 'generative', group: 'optical', bed: 'single-bed',
    rows: 24, cols: 24, mode: 'fair_isle', seed: 1, tags: ['moire', 'interference', 'optical', 'rings'],
    description: 'Two overlapping radial grids beat against each other into shimmering moir\u00e9 rings.',
    generate: direct((r, c) => {
      const x = c - 12, y = r - 12;
      const rad = Math.hypot(x, y);
      return (Math.sin(rad * 1.4) > 0) === (Math.sin(rad * 1.0 + 0.5) > 0) ? 1 : 0;
    })
  })
];

// Small number-theory helpers kept private to this file.

/** Primality by trial division (the ranges here are tiny). */
function isPrime(n) {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
  return true;
}

/** C(n, k) mod m via the multiplicative recurrence, staying in small integers. */
function binomMod(n, k, m) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  c = round(c);
  return ((c % m) + m) % m;
}

/** Every extended slate in one flat array, for the master index to concatenate. */
export const EXTENDED_PRESETS = [
  ...EXTENDED_LACE_PRESETS,
  ...EXTENDED_COLORWORK_PRESETS,
  ...EXTENDED_TEXTURE_PRESETS,
  ...EXTENDED_DOUBLEBED_PRESETS,
  ...EXTENDED_GENERATIVE_PRESETS
];

export { clamp };
