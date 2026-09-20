/**
 * KNITCAT - Pattern library, COLORWORK family.
 *
 * Two-colour stranded patterns written as the character charts you see in a Fair Isle
 * or Nordic knitting book: `X` is the contrast colour (a punched needle, yarn B) and
 * `.` is the main colour (unpunched, yarn A). The charts are authored bottom-up in the
 * same orientation as the card, tiled seamlessly across the bed.
 *
 * Colourwork has no loop-count rule (every needle knits every row; only the feeder
 * changes), so unlike the lace family these recipes are free-form. What *does* matter
 * and what the descriptions keep an eye on is float length — how many needles a strand
 * of unused colour drifts across the back — which `js/features/feasibility.js` measures
 * and the compiler warns about past the machine's catch-weight limit. The classic
 * traditions here (Fair Isle, Selbu, kilim) all stay inside a honest 5-to-7-stitch
 * float because that is how they were actually woven.
 *
 * Repeat sizes are quoted so the tiling is seamless edge to edge; a motif whose repeat
 * does not divide the bed width would leave a half-motif at the selvedge.
 */

import { preset, blankDirect, stamp, fromChart } from './preset-recipe-helpers.js';

const X = 1;
const _ = 0;

/** Turn an ASCII chart (`X`/`.` rows, bottom line = first chart row) into a 0/1 grid. */
function chart(lines) {
  return fromChart(lines, { X: 1 }, { ground: 0 });
}

/** A generate() that tiles a fixed motif seamlessly over the requested card. */
function tiled(motif) {
  return (rows, cols) => {
    const matrix = blankDirect(rows, cols);
    stamp(matrix, motif, { skip: undefined });
    return matrix;
  };
}

/** A generate() from an ASCII chart, tiled. */
function tiledChart(lines) {
  return tiled(chart(lines));
}

/** Build an n-pointed star chart of a given radius, used by several Nordic motifs. */
function starChart(size, arms) {
  const grid = [];
  const c = (size - 1) / 2;
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = r - c;
      const dist = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const rose = Math.abs(Math.cos((arms / 2) * ang));
      const radius = c * (0.34 + 0.66 * rose);
      row.push(dist <= radius ? X : _);
    }
    grid.push(row);
  }
  return grid;
}

/** A diamond lattice of a given cell, punched on the crossings. */
function diamondLattice(cell) {
  return (rows, cols) => {
    const matrix = blankDirect(rows, cols);
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const dx = ((col % cell) + cell) % cell;
        const dy = ((r % cell) + cell) % cell;
        const d = Math.abs(dx - cell / 2) + Math.abs(dy - cell / 2);
        matrix[r][col] = Math.abs(d - cell / 2) < 1 ? X : _;
      }
    }
    return matrix;
  };
}

/** Two interleaved zig-zag bands (the peebeg / Halcro family). */
function zigzagBands(cell, thickness) {
  return (rows, cols) => {
    const matrix = blankDirect(rows, cols);
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const tri = Math.abs(((col / cell + r / cell) % 2) - 1);
        matrix[r][col] = tri * cell < thickness ? X : _;
      }
    }
    return matrix;
  };
}

export const COLORWORK_PRESETS = [
  preset({
    id: 'great_star_fair_isle',
    name: 'Great Star of Fair Isle (True Lover\u2019s Knot)',
    family: 'colorwork',
    group: 'celtic',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [12, 12],
    tags: ['fair-isle', 'star', 'celtic', 'classic'],
    description:
      'The Great Star, one of the most reproduced Fair Isle motifs: an eight-point star radiating from a cross, worked on a clean 12-stitch repeat so the float never runs long.',
    generate: tiled(starChart(12, 8))
  }),

  preset({
    id: 'peebeg_fair_isle',
    name: 'Peebeg Cross (Shetland Herringbone)',
    family: 'colorwork',
    group: 'celtic',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [8, 8],
    tags: ['fair-isle', 'cross', 'herringbone', 'shetland'],
    description:
      'The peebeg cross-and-herringbone band: small St Andrew\u2019s crosses set on a slanted ground, the border motif of a hundred Shetland ganseys.',
    generate: tiledChart([
      'X..X..X.',
      '.X.X.X..',
      '..X..X..',
      'X.XX.XX.',
      '.XX..XX.',
      'X..XX..X',
      '.X.X.X..',
      '..X..X.X'
    ])
  }),

  preset({
    id: 'old_sign_of_hamu',
    name: 'Sign of the Hamu (Cross Square)',
    family: 'colorwork',
    group: 'celtic',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [9, 9],
    tags: ['fair-isle', 'cross', 'hamu', 'shetland'],
    description:
      'The cross-in-a-square, "sign of the Hamu" from the classic charts: a bold armoured cross on an 9-stitch grid, banding a yoke or a hat.',
    generate: tiledChart([
      'XX.....XX',
      'XX.....XX',
      'XX.....XX',
      '.........',
      'XXXXXXXXX',
      '.........',
      'XX.....XX',
      'XX.....XX',
      'XX.....XX'
    ])
  }),

  preset({
    id: 'mhs_cross_fair_isle',
    name: 'M\u2019H-S Cross Band',
    family: 'colorwork',
    group: 'celtic',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [12, 8],
    tags: ['fair-isle', 'cross', 'border', 'shetland'],
    description:
      'The M\u2019H-S cross — an X and a vertical bar sharing a spine — running as a repeating yoke band, the signature border of a Fair Isle jumper.',
    generate: tiledChart([
      'X..X..X..X..',
      '.X.X.X.X.X..',
      '..XXX...XX..',
      '....X..X....',
      '..XXX...XX..',
      '.X.X.X.X.X..',
      'X..X..X..X..',
      '............'
    ])
  }),

  preset({
    id: 'selbu_star',
    name: 'Selbu Star (Norwegian Eight-Point)',
    family: 'colorwork',
    group: 'nordic',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [16, 16],
    tags: ['nordic', 'norwegian', 'star', 'selbu'],
    description:
      'The Selbu eight-pointed star from the Selurose traditions: an armoured rose-star set on a diamond lattice, the emblem of Norwegian middle-age folk knitting.',
    generate: tiled(starChart(16, 8))
  }),

  preset({
    id: 'setesdal_rosette',
    name: 'Setesdal Rose (Rosett)',
    family: 'colorwork',
    group: 'nordic',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [12, 12],
    tags: ['nordic', 'norwegian', 'rosette', 'setesdal'],
    description:
      'A Setesdal rosette: a hollow diamond rose with a single eye at its centre, the ten-point star of the Setesdalsbunad simplified for a 12-stitch card.',
    generate: tiledChart([
      '......X.....',
      '.....XXX....',
      '....X.X.X...',
      '...X..X..X..',
      '..X...X...X.',
      '.XX..XXX..XX',
      '.XX..XXX..XX',
      '..X...X...X.',
      '...X..X..X..',
      '....X.X.X...',
      '.....XXX....',
      '......X.....'
    ])
  }),

  preset({
    id: 'marius_wreath',
    name: 'Marius Wreath Border',
    family: 'colorwork',
    group: 'nordic',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [8, 8],
    tags: ['nordic', 'marius', 'border', 'norwegian'],
    description:
      'The Marius sweater star-and-wreath border reduced to its geometry: interlocking hour-glasses of contrast on the body colour, the pattern that made a Norwegian national icon.',
    generate: tiledChart([
      'XX....XX',
      'XX....XX',
      '.X....X.',
      '..XXXX..',
      '..XXXX..',
      '.X....X.',
      'XX....XX',
      'XX....XX'
    ])
  }),

  preset({
    id: 'latvian_star',
    name: 'Latvian Star (Jokumele)',
    family: 'colorwork',
    group: 'nordic',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [9, 9],
    tags: ['baltic', 'latvian', 'star', 'jokumele'],
    description:
      'The Latvian star/Jokumele: a running ribbon of interlocking four-point stars, the Baltic folk band that reads as a woven sash.',
    generate: tiledChart([
      '....X....',
      '...XXX...',
      '.XX.X.XX.',
      'XXX.X.XXX',
      '..X...X..',
      'XXX.X.XXX',
      '.XX.X.XX.',
      '...XXX...',
      '....X....'
    ])
  }),

  preset({
    id: 'kolin_orthogonal',
    name: 'Kolin (Estonian Four-Arm Flower)',
    family: 'colorwork',
    group: 'nordic',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [12, 12],
    tags: ['baltic', 'estonian', 'kolin', 'flower'],
    description:
      'The Estonian Kolin flower: four arms around an empty cross, a woven-band motif with a remarkably short float for its boldness.',
    generate: tiledChart([
      '....XXXX....',
      '....XXXX....',
      'XX..XXXX..XX',
      'XX..XXXX..XX',
      'XXXXXXXXXXXX',
      '............',
      '............',
      'XXXXXXXXXXXX',
      'XX..XXXX..XX',
      'XX..XXXX..XX',
      '....XXXX....',
      '....XXXX....'
    ])
  }),

  preset({
    id: 'mosaic_gannocs',
    name: 'Celtic Mosaic Gauntlet',
    family: 'colorwork',
    group: 'celtic',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [8, 8],
    tags: ['celtic', 'mosaic', 'gauntlet', 'ireland'],
    description:
      'The Irish mosaic stitch reduced to two colours: an interlocking brick of offset squares, the gauntlet pattern from Aran knitting charts.',
    generate: tiledChart([
      'XXXX....',
      'XXXX....',
      '....XXXX',
      '....XXXX',
      'XXXX....',
      'XXXX....',
      '....XXXX',
      '....XXXX'
    ])
  }),

  preset({
    id: 'bukovina_birds',
    name: 'Bukovina Bird Band',
    family: 'colorwork',
    group: 'global',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [12, 12],
    tags: ['ukrainian', 'bukovina', 'bird', 'ethnic'],
    description:
      'A Bukovina bird-and-tree band: stylised roosters facing a central tree, the Carpathian folk motif that appears on Ukrainian and Romanian vests.',
    generate: tiledChart([
      '....XX....',
      '...X..X...',
      'XX.X..X.XX',
      '.X.X..X.X.',
      '..XXXXXX..',
      '....XX....',
      '...X..X...',
      'XXXX..XXXX',
      '..XX..XX..',
      '....XX....',
      '...X..X...',
      '..X....X..'
    ])
  }),

  preset({
    id: 'serbian_kolna',
    name: 'Serbian Kilim Diamond',
    family: 'colorwork',
    group: 'global',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [11, 11],
    tags: ['balkan', 'serbian', 'kilim', 'diamond'],
    description:
      'A Balkan kilim diamond with hooked corners: the stepped lozenge of Serbian and Macedonian wool, punched so the contrast reads as warp-faced weave.',
    generate: tiledChart([
      '.....X.....',
      '....XXX....',
      '...X...X...',
      '..X..X..X..',
      '.X..XXX..X.',
      'X.XX.X.XX.X',
      '.X..XXX..X.',
      '..X..X..X..',
      '...X...X...',
      '....XXX....',
      '.....X.....'
    ])
  }),

  preset({
    id: 'persian_boteh',
    name: 'Persian Boteh (Paisley) Field',
    family: 'colorwork',
    group: 'global',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [12, 12],
    tags: ['persian', 'boteh', 'paisley', 'oriental'],
    description:
      'The boteh — the curved cedar-cone that became the paisley — as a stranded field: an angled teardrop filled with a seed, scattered on the point.',
    generate: tiledChart([
      '....XXXX..',
      '...X...XX.',
      '..X..X..XX',
      '..X..X..XX',
      '...X...XX.',
      '....XXXX..',
      '.....XX...',
      '....XX....',
      '...XX.....',
      '...X......',
      '..........',
      '..........']
    )
  }),

  preset({
    id: 'navajo_step',
    name: 'Navajo Stepped Diamond',
    family: 'colorwork',
    group: 'global',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [12, 12],
    tags: ['navajo', 'southwest', 'stepped', 'textile'],
    description:
      'A Navajo stepped diamond from the classic two-bar geometric weaving: right-angle stair steps rather than a smooth diagonal, which keeps every float at a single stitch.',
    generate: tiledChart([
      '....XXXX....',
      '...XX..XX...',
      '..XX....XX..',
      '.XX..XX..XX.',
      'XX..XXXX..XX',
      'XX..XXXX..XX',
      '.XX..XX..XX.',
      '..XX....XX..',
      '...XX..XX...',
      '....XXXX....',
      '............',
      '............'
    ])
  }),

  preset({
    id: 'sami_gaka',
    name: 'S\u00e1mi Gaka Band',
    family: 'colorwork',
    group: 'global',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [8, 6],
    tags: ['sami', 'lapland', 'band', 'gaka'],
    description:
      'A S\u00e1mi gaka-ornament band: the zig-zag sun-cross edging from Sámi textile work, arranged as a narrow repeating border for a cuff or hat.',
    generate: tiledChart([
      'X.X.X.X.',
      '.XXXXXX.',
      '..XXXX..',
      '...XX...',
      '..XXXX..',
      '.XXXXXX.'
    ])
  }),

  preset({
    id: 'moroccan_lattice',
    name: 'Moroccan Lattice (Trefoil)',
    family: 'colorwork',
    group: 'global',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [8, 8],
    tags: ['moroccan', 'berber', 'lattice', 'geometric'],
    description:
      'A Moroccan/Amazigh lattice: the interlocking trefoil grid of Taznakht rugs, punched as an all-over geometric with balanced four-stitch floats.',
    generate: tiledChart([
      'XX..XX..',
      'XX..XX..',
      '........',
      '..XXXX..',
      'XX..XX..',
      'XX..XX..',
      '........',
      '..XXXX..'
    ])
  }),

  preset({
    id: 'andean_chakana',
    name: 'Andean Chakana (Inca Cross)',
    family: 'colorwork',
    group: 'global',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [12, 12],
    tags: ['andean', 'inca', 'chakana', 'textile'],
    description:
      'The chakana — the stepped Southern Cross of Andean weaving — with its three-block arms and central eye, the motif that carries the whole cosmology of Quechua textiles.',
    generate: tiledChart([
      '....XXXX....',
      '....XXXX....',
      'XXXXXXXXXXXX',
      'XXX.XX.XXXXX',
      'XXXXXXXXXXXX',
      '....XXXX....',
      '....XXXX....',
      'XXXXXXXXXXXX',
      'XXXXXXXXXXXX',
      'XXX.XX.XXXXX',
      'XXXXXXXXXXXX',
      '....XXXX....'
    ])
  }),

  preset({
    id: 'optical_checker',
    name: 'Optical Checkerboard',
    family: 'colorwork',
    group: 'geometric',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [8, 8],
    tags: ['optical', 'checker', 'geometric', 'mod'],
    description:
      'A Mod-era optical checker: blocks that grow and shrink across the repeat so the flat grid seems to bulge, all from a hard 8-stitch tile.',
    generate: tiledChart([
      'XXXX....',
      'XXXX....',
      'XXXX....',
      '........',
      '....XXXX',
      '....XXXX',
      '....XXXX',
      '........'
    ])
  }),

  preset({
    id: 'staircase_optical',
    name: 'Staircase Moiré',
    family: 'colorwork',
    group: 'geometric',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [12, 12],
    tags: ['optical', 'moiré', 'staircase', 'escher'],
    description:
      'An Escher-ish staircase that seems to climb forever: nested right-angle steps whose edges interfere into a shimmer, a favourite of the op-art jumpers of the sixties.',
    generate: (rows, cols) => {
      const matrix = blankDirect(rows, cols);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const step = Math.floor(c / 3) - Math.floor(r / 3);
          matrix[r][c] = ((step % 4) + 4) % 4 < 2 ? X : _;
        }
      }
      return matrix;
    }
  }),

  preset({
    id: 'chevron_truchet',
    name: 'Chevron Truchet',
    family: 'colorwork',
    group: 'geometric',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [4, 4],
    tags: ['truchet', 'chevron', 'geometric', 'random'],
    description:
      'A Truchet tiling of quarter-arcs that resolve into wandering chevrons: the same four-cell block rotated by a deterministic key so the paths never dead-end.',
    generate: (rows, cols) => {
      const matrix = blankDirect(rows, cols);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const bx = Math.floor(c / 2) % 2;
          const by = Math.floor(r / 2) % 2;
          const lx = c % 2;
          const ly = r % 2;
          const flip = (bx ^ by) === 0;
          const on = flip ? lx === ly : lx !== ly;
          matrix[r][c] = on ? X : _;
        }
      }
      return matrix;
    }
  }),

  preset({
    id: 'greek_meander',
    name: 'Greek Meander (Key Pattern)',
    family: 'colorwork',
    group: 'borders',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [8, 8],
    tags: ['greek', 'meander', 'border', 'classical'],
    description:
      'The Greek key / meander band from classical ornament: an interlocking square spiral that runs as a self-contained edging, one of the oldest borders in the craft.',
    generate: tiledChart([
      'XXXXXXXX',
      'X......X',
      'X.XXXX.X',
      'X.X..X.X',
      'X.X.XX.X',
      'X.X....X',
      'X.XXXXXX',
      'X.......'
    ])
  }),

  preset({
    id: 'running_dog_border',
    name: 'Running Dog Border',
    family: 'colorwork',
    group: 'borders',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [8, 4],
    tags: ['border', 'running-dog', 'geometric', 'hem'],
    description:
      'The running-dog border — alternating dashes that appear to trot along a hem: the tidiest two-row band in the colourwork book, perfect for cuffs.',
    generate: tiledChart([
      'XXXX....',
      'XXXX....',
      '....XXXX',
      '....XXXX'
    ])
  }),

  preset({
    id: 'heart_border_fair_isle',
    name: 'Heart Border (Kochegi)',
    family: 'colorwork',
    group: 'romance',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [8, 8],
    tags: ['heart', 'romance', 'border', 'gift'],
    description:
      'A running heart border for a Valentine\u2019s cuff or a love-token mitten: a 6-wide heart on an 8 repeat so it ties seamlessly all the way round.',
    generate: tiledChart([
          '........',
      '.XX.XX..',
      'XXXXXXXX',
      'XXXXXXXX',
      '.XXXXXX.',
      '..XXXX..',
      '...XX...',
      '........'
    ])
  }),

  preset({
    id: 'snowflake_border',
    name: 'Snowflake Border',
    family: 'colorwork',
    group: 'borders',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [12, 12],
    tags: ['snowflake', 'nordic', 'border', 'christmas'],
    description:
      'A six-arm snowflake border, the December staple of Nordic yokes: each flake is a crossed plus with barbed arms, on a 12-stitch repeat that lines up perfectly shoulder to shoulder.',
    generate: tiled(starChart(12, 6))
  }),

  preset({
    id: 'illusion_weave',
    name: 'Illusion Knit (Graduated Checker)',
    family: 'colorwork',
    group: 'novelty',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [24, 24],
    tags: ['illusion', 'gradient', 'novelty', 'modern'],
    description:
      'Illusion knit in two colours: the density of the punch ramps across the card so a hard checkerboard melts into a soft gradient — the modern slip-heavy colourwork effect, approximated honestly on the machine.',
    generate: (rows, cols) => {
      const matrix = blankDirect(rows, cols);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const density = (c / (cols - 1) + 1 - r / (rows - 1)) / 2;
          const checker = ((Math.floor(c / 1) + Math.floor(r / 1)) % 2) === 0;
          matrix[r][c] = checker && density < 0.8 ? X : !checker && density > 0.8 ? X : _;
        }
      }
      return matrix;
    }
  }),

  preset({
    id: 'marl_effect',
    name: 'Marl (Heather) Effect',
    family: 'colorwork',
    group: 'novelty',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [4, 4],
    tags: ['marl', 'heather', 'novelty', 'texture'],
    description:
      'A two-colour marl: a deterministic speckle that reads as heathered yarn from a distance, the effect real marl gets from two plies of different shades.',
    seed: 7,
    generate: (rows, cols) => {
      const matrix = blankDirect(rows, cols);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // A fixed pseudo-random that never repeats visibly at bed width.
          const h = (c * 73856093) ^ (r * 19349663);
          matrix[r][c] = (h & 3) === 0 ? X : _;
        }
      }
      return matrix;
    }
  }),

  preset({
    id: 'rose_window_fair_isle',
    name: 'Rose Window Medallion',
    family: 'colorwork',
    group: 'picture',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [24, 24],
    tags: ['rose', 'medallion', 'picture', 'gothic'],
    description:
      'A single-rose medallion: a radiating petal wheel for the back of a pullover, built from an eight-fold rose curve so it stays crisp at 24 needles.',
    generate: (rows, cols) => {
      const matrix = blankDirect(rows, cols);
      const cx = cols / 2;
      const cy = rows / 2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const dx = c - cx;
          const dy = r - cy;
          const dist = Math.hypot(dx, dy);
          const ang = Math.atan2(dy, dx);
          const petal = Math.abs(Math.sin(4 * ang));
          const rim = dist > 3 && dist < 4 + 7 * petal;
          const ring = Math.abs(dist - 10) < 1;
          matrix[r][c] = rim || ring ? X : _;
        }
      }
      return matrix;
    }
  }),

  preset({
    id: 'bear_cub_picture',
    name: 'Bear Cub Motif',
    family: 'colorwork',
    group: 'picture',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [15, 15],
    tags: ['bear', 'picture', 'children', 'nordic'],
    description:
      'A bear-cub picture motif in the Scandinavian children\u2019s-sweater tradition: a blocky seated bear that sits as a single centre-panel figure.',
    generate: (rows, cols) => {
      const bear = chart([
        '..XX.....XX..',
        '..XXX...XXX..',
        '.XXXXXXXXXXX.',
        '.XX.XXXXX.XX.',
        '.XXXXXXXXXXX.',
        '..XXX.X.XXX..',
        '...XXXXXX....',
        '..XXXXXXXXX..',
        '.XXXXXXXXXXX.',
        '.XXX.X.X.XXX.',
        '.XX..X.X..XX.',
        '..X..X.X..X..',
        '.....XXX.....',
        '.....XXX.....',
        '.....XXX.....'
      ]);
      const matrix = blankDirect(rows, cols);
      stamp(matrix, bear, { rowOffset: Math.max(0, rows - 15), colOffset: Math.floor((cols - 15) / 2), tile: false });
      return matrix;
    }
  }),

  preset({
    id: 'huckaback_weave',
    name: 'Huckaback (Twill Diamond Weave)',
    family: 'colorwork',
    group: 'geometric',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [8, 8],
    tags: ['huckaback', 'twill', 'weave', 'linen'],
    description:
      'Huckaback — the woven linen diamond translated to the carriage: floating ridges that cross into a raised lozenge, an 8-stitch tile straight from a tea-towel draft.',
    generate: tiledChart([
      'X..X..X.',
      '..XX..XX',
      '.X..X..X',
      'XX..XX..',
      'X..X..X.',
      '..XX..XX',
      '.X..X..X',
      'XX..XX..'
    ])
  }),

  preset({
    id: 'ocean_wave_fair_isle',
    name: 'Ocean Wave Border',
    family: 'colorwork',
    group: 'borders',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [16, 8],
    tags: ['wave', 'ocean', 'border', 'hawaii'],
    description:
      'A rolling ocean-wave border: nested crests that curl along the hem, the classic surf-band of a Hawaiian-style summer knit.',
    generate: tiledChart([
      '....XXXX....XXXX',
      '..XX....XX..XX..',
      '.X......X.X.....',
      '.X......X.X.....',
      '..XX....XX..XX..',
      '....XXXX....XXXX',
      '............XXXX',
      'XX....XXXX....X.'
    ])
  }),

  preset({
    id: 'celtic_diamond_field',
    name: 'Celtic Diamond Field',
    family: 'colorwork',
    group: 'celtic',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [8, 8],
    tags: ['celtic', 'diamond', 'irish', 'field'],
    description:
      'An all-over field of outlined diamonds, the Irish-wool background that fills the space between the big motifs on an Aran fisherman\u2019s pullover.',
    generate: diamondLattice(8)
  }),

  preset({
    id: 'halcro_zigzag',
    name: 'Halcro Zig-Zag',
    family: 'colorwork',
    group: 'celtic',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    repeat: [8, 8],
    tags: ['shetland', 'halcro', 'zigzag', 'border'],
    description:
      'The Halcro zig-zag, one of the most-loved Fair Isle bands: continuous crests drawn as triangular waves, thick enough to read across a whole yoke.',
    generate: zigzagBands(8, 3)
  })
];
