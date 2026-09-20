/**
 * KNITCAT - Pattern library, EDGES / SHAPING / GENERATIVE families.
 *
 * Two very different ideas share this file because both are "charts built by a rule
 * rather than a repeat":
 *
 *   EDGES are placed, not tiled — the decorative rows at the start and end of a piece
 *   (a picot cast-on, a ruffled bind-off, a scalloped hem). They live at the bottom of
 *   the card (row 0 = the cast-on edge, per the shared chart convention) and the field
 *   above is left plain so you can drop them straight onto a project.
 *
 *   SHAPING is the row-by-row narrowing/widening that turns a rectangle into a garment:
 *   saddle shoulders, raglan armholes, necklines, waist gores. These are drafted as
 *   decreases running up an edge, in lace mode so each decrease is a real transfer.
 *
 *   GENERATIVE charts come from mathematics — cellular automata, number theory,
 *   tilings, noise — and are the most honest thing in the library to ship as pure code
 *   because they ARE pure code. Everything here is deterministic given a seed, so the
 *   same preset redraws identically every time (see `makeRandom`).
 */

import { STITCH_TYPE as S } from '../math/knit-topology.js';
import {
  preset,
  blankLace,
  blankDirect,
  makeRandom,
  holeRow
} from './preset-recipe-helpers.js';

const X = 1;
const _ = 0;

/** A generate() tiling a boolean rule over a direct-mode card. */
function directRule(fn) {
  return (rows, cols) => {
    const matrix = new Array(rows);
    for (let r = 0; r < rows; r++) {
      matrix[r] = new Array(cols);
      for (let c = 0; c < cols; c++) matrix[r][c] = fn(r, c) ? X : _;
    }
    return matrix;
  };
}

// ─── generative: maths, all deterministic ────────────────────────────────────

/** Elementary cellular automaton: seed a row, evolve with `rule` (e.g. 90, 110, 30). */
function automaton(ruleNumber, { cols: width = 0, seedRow = null } = {}) {
  return (rows, cols) => {
    const matrix = blankDirect(rows, cols);
    const w = width || cols;
    // Bottom row (row 0) is the seed: a single centre cell unless given.
    const seed = seedRow ? [...seedRow] : new Array(w).fill(0).map((_, i) => (i === Math.floor(w / 2) ? 1 : 0));
    matrix[0] = seed.concat(new Array(Math.max(0, cols - w)).fill(0));
    const bits = n => [(n >> 2) & 1, (n >> 1) & 1, n & 1];
    const [b4, b2, b1] = bits(ruleNumber);
    const table = { '111': b4, '110': b2, '101': b1, '100': (ruleNumber >> 3) & 1, '011': (ruleNumber >> 4) & 1, '010': (ruleNumber >> 5) & 1, '001': (ruleNumber >> 6) & 1, '000': (ruleNumber >> 7) & 1 };
    for (let r = 1; r < rows; r++) {
      const prev = matrix[r - 1];
      const next = new Array(cols);
      for (let c = 0; c < cols; c++) {
        const l = prev[(c - 1 + cols) % cols];
        const m = prev[c];
        const rr = prev[(c + 1) % cols];
        next[c] = table[`${l}${m}${rr}`] || 0;
      }
      matrix[r] = next;
    }
    return matrix;
  };
}

/** Pascal's triangle mod k — a Sierpiński gasket for k = 2. */
function pascalMod(k) {
  return (rows, cols) => {
    const matrix = blankDirect(rows, cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= Math.min(r, cols - 1); c++) {
        // Multiplicative binomial computed with modular-safe float division (fine for
        // a card this small), punched when it is not divisible by k.
        let binom = 1;
        for (let i = 0; i < c; i++) binom = (binom * (r - i)) / (i + 1);
        matrix[r][c] = Math.round(binom) % k === 0 ? _ : X;
      }
    }
    return matrix;
  };
}

/** Value-noise field thresholded into a fabric. */
function valueNoise(seed, scale, threshold) {
  return (rows, cols) => {
    const rand = makeRandom(seed);
    const gw = Math.ceil(cols / scale) + 2;
    const gh = Math.ceil(rows / scale) + 2;
    const grid = [];
    for (let y = 0; y < gh; y++) {
      grid[y] = [];
      for (let x = 0; x < gw; x++) grid[y][x] = rand();
    }
    const smooth = t => t * t * (3 - 2 * t);
    const sample = (x, y) => {
      const gx = x / scale;
      const gy = y / scale;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = smooth(gx - x0);
      const ty = smooth(gy - y0);
      const a = grid[y0][x0];
      const b = grid[y0][x0 + 1];
      const c = grid[y0 + 1][x0];
      const d = grid[y0 + 1][x0 + 1];
      return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    };
    return directRule((r, c) => sample(c, r) > threshold)(rows, cols);
  };
}

/** Truchet tiling: quarter-arc tiles chosen by a seeded coin, forming mazes. */
function truchet(seed, tile) {
  return (rows, cols) => {
    const rand = makeRandom(seed);
    const matrix = blankDirect(rows, cols);
    const choices = [];
    for (let ty = 0; ty < Math.ceil(rows / tile); ty++) {
      choices[ty] = [];
      for (let tx = 0; tx < Math.ceil(cols / tile); tx++) choices[ty][tx] = rand() > 0.5;
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tx = Math.floor(c / tile);
        const ty = Math.floor(r / tile);
        const lx = (c % tile) / tile;
        const ly = (r % tile) / tile;
        const flipped = choices[ty][tx];
        const d1 = Math.hypot(lx, ly);
        const d2 = Math.hypot(1 - lx, 1 - ly);
        const arc = flipped ? Math.abs(d1 - 0.5) : Math.abs(d2 - 0.5);
        matrix[r][c] = arc < 0.09 ? X : _;
      }
    }
    return matrix;
  };
}

/** Modular multiplication table (a "times-table circle" rasterised). */
function modularTable(mod, mult) {
  return (rows, cols) => {
    const matrix = blankDirect(rows, cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) matrix[r][c] = (r * c) % mod === 0 ? X : _;
    }
    return matrix;
  };
}

function primeField(mod) {
  const isPrime = n => {
    if (n < 2) return false;
    for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
    return true;
  };
  return (rows, cols) => {
    const matrix = blankDirect(rows, cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) matrix[r][c] = isPrime(r * cols + c + 2) && (r * cols + c) % mod < mod / 2 ? X : _;
    }
    return matrix;
  };
}

/** Ulam-style diagonal: plot primes on a spiral. */
function ulamSpiral() {
  return (rows, cols) => {
    const matrix = blankDirect(rows, cols);
    const isPrime = n => {
      if (n < 2) return false;
      for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
      return true;
    };
    let x = Math.floor(cols / 2);
    let y = Math.floor(rows / 2);
    let dx = 0;
    let dy = -1;
    for (let n = 1; n <= rows * cols; n++) {
      if (x >= 0 && x < cols && y >= 0 && y < rows && isPrime(n)) matrix[y][x] = X;
      if (x === y || (x < 0 && x === -y) || (x > 0 && x === 1 - y)) {
        const t = dx;
        dx = -dy;
        dy = t;
      }
      x += dx;
      y += dy;
    }
    return matrix;
  };
}

// ─── edges: placed bands along the cast-on (row 0) ───────────────────────────

/** Lay a lace edging band across the bottom `band` rows; leave the field plain. */
function laceEdge(band, perRow) {
  return (rows, cols) => {
    const matrix = blankLace(rows, cols);
    for (let r = 0; r < Math.min(band, rows); r++) {
      if (perRow[r]) holeRow(matrix[r], perRow[r].width, perRow[r].holes);
    }
    return matrix;
  };
}

// ─── shaping: a slant of decreases up one or both selvedges ──────────────────

/** Decrease at both selvedges, stepping inward `rate` rows at a time — a raglan/gore. */
function edgeSlant({ inward = true, every = 2, width = 12 } = {}) {
  return (rows, cols) => {
    const matrix = blankLace(rows, cols);
    for (let r = 0; r < rows; r++) {
      if (r % every) continue;
      // A decrease needs a matching increase to stay balanced; here the increase is
      // an eyelet one needle in, so the seam line is a real, knittable decrease.
      holeRow(matrix[r], width, inward ? [[1, 'R'], [width - 1, 'L']] : [[0, 'R'], [width, 'L']]);
    }
    return matrix;
  };
}

export const GENERATIVE_PRESETS = [
  preset({
    id: 'rule90_sierpinski',
    name: 'Rule 90 (Sierpiński Gasket)',
    family: 'generative',
    group: 'automata',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['cellular-automata', 'sierpinski', 'fractal', 'rule90'],
    description:
      'Elementary rule 90 — the simplest automaton that draws a fractal: from one seed cell it evolves the Sierpiński triangle, which is exactly the self-similar gasket Pascal mod 2 makes.',
    generate: automaton(90)
  }),
  preset({
    id: 'rule30_chaos',
    name: 'Rule 30 (Chaotic)',
    family: 'generative',
    group: 'automata',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['cellular-automata', 'rule30', 'chaos', 'wolfram'],
    description:
      'Wolfram\u2019s rule 30, the automaton that convinced everyone a single line of code could make true randomness: aperiodic, left-edge chaotic, endlessly knitworthy.',
    generate: automaton(30)
  }),
  preset({
    id: 'rule110_tiles',
    name: 'Rule 110 (Gliders)',
    family: 'generative',
    group: 'automata',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['cellular-automata', 'rule110', 'glider', 'turing'],
    description:
      'Rule 110 — the automaton proven Turing-complete — knits up as regular columns colonised by gliders, little spaceships trailing across the background.',
    generate: automaton(110)
  }),
  preset({
    id: 'pascal_mod3',
    name: 'Pascal mod 3 Gasket',
    family: 'generative',
    group: 'number',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['pascal', 'number-theory', 'fractal', 'mod3'],
    description:
      'Pascal\u2019s triangle read mod 3: the gasket branches into three-fold self-similarity, a cleaner and spikier cousin of the mod-2 Sierpiński.',
    generate: pascalMod(3)
  }),
  preset({
    id: 'fibonacci_stairs',
    name: 'Fibonacci Stair Field',
    family: 'generative',
    group: 'number',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['fibonacci', 'golden', 'number-theory', 'stripe'],
    description:
      'Bands whose widths follow the Fibonacci sequence, so the golden ratio sets the rhythm of the stripes — the irrational spacing that never quite repeats.',
    generate: directRule((r, c) => {
      const fib = [1, 1, 2, 3, 5, 8, 13];
      const pos = (c + r) % 21;
      let acc = 0;
      for (const f of fib) {
        acc += f;
        if (pos < acc) return Math.log2(f) % 1 < 0.5;
      }
      return false;
    })
  }),
  preset({
    id: 'modular_multiplication',
    name: 'Modular Times-Table',
    family: 'generative',
    group: 'number',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['modular', 'number-theory', 'grid', 'syllabus'],
    description:
      'A multiplication table modulo a prime: the zeros fall into the Petrie-polynomial parabolas that make modular grids look like woven sound waves.',
    generate: modularTable(11, 1)
  }),
  preset({
    id: 'prime_spiral',
    name: 'Ulam Prime Spiral',
    family: 'generative',
    group: 'number',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['primes', 'ulam', 'number-theory', 'spiral'],
    description:
      'The Ulam spiral: natural numbers laid out in a square spiral with the primes punched, and out of the noise the famous accidental diagonals appear.',
    generate: ulamSpiral()
  }),
  preset({
    id: 'sieve_field',
    name: 'Prime Sieve Field',
    family: 'generative',
    group: 'number',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['primes', 'sieve', 'number-theory'],
    description:
      'A sieve of Eratosthenes drawn as texture — composites left plain and primes punched, so the growing gaps between primes read as an accelerating dotted grid.',
    generate: primeField(4)
  }),
  preset({
    id: 'truchet_maze',
    name: 'Truchet Maze',
    family: 'generative',
    group: 'tiling',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['truchet', 'maze', 'tiling', 'random'],
    description:
      'Sebastian Truchet\u2019s 1704 idea: one tile, randomly rotated, and the floor becomes an endless maze of interlocking arcs — aperiodic with no aperiodic monotile needed.',
    seed: 1234,
    generate: truchet(1234, 4)
  }),
  preset({
    id: 'value_noise_field',
    name: 'Value-Noise Marble',
    family: 'generative',
    group: 'noise',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['noise', 'marble', 'organic', 'gradient'],
    description:
      'Smoothed value noise thresholded into a fabric: soft cell-like blooms that read like marble or a topographic map, the organic field you get when float memory is short.',
    seed: 42,
    generate: valueNoise(42, 6, 0.5)
  }),
  preset({
    id: 'moiré_interference',
    name: 'Moiré Interference',
    family: 'generative',
    group: 'optical',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['moiré', 'optical', 'interference', 'op-art'],
    description:
      'Two gratings, one vertical and one diagonal, add until they interfere into a third phantom pattern the eye invents — moiré, the accident that becomes the design.',
    generate: directRule((r, c) => ((c % 3 === 0) + ((c + r) % 5 === 0)) % 2 === 1)
  }),
  preset({
    id: 'dragon_curve',
    name: 'Heighway Dragon (Raster)',
    family: 'generative',
    group: 'fractals',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['fractal', 'dragon', 'lsystem', 'curve'],
    description:
      'The Heighway dragon curve walked onto the card: a paper-folding fractal whose turning path tiles the plane without ever crossing itself.',
    generate: (rows, cols) => {
      const matrix = blankDirect(rows, cols);
      let x = Math.floor(cols / 2);
      let y = Math.floor(rows / 2);
      const dirs = [[1, 0], [0, -1], [-1, 0], [0, 1]];
      let d = 0;
      let turn = 1;
      matrix[y][x] = X;
      for (let step = 1; step < rows * cols; step++) {
        // fold(i): the direction of the turn at step i is the highest set bit parity.
        let n = step;
        while ((n & 1) === 0) n >>= 1;
        turn = (n & 2) ? 1 : -1;
        d = (d + (turn > 0 ? 1 : -1) + 4) % 4;
        x += dirs[d][0];
        y += dirs[d][1];
        if (x < 0 || x >= cols || y < 0 || y >= rows) break;
        matrix[y][x] = X;
      }
      return matrix;
    }
  })
];

export const EDGES_PRESETS = [
  preset({
    id: 'picot_caston',
    name: 'Picot Cast-On Edge',
    family: 'edges',
    group: 'cast-on',
    bed: 'single-bed',
    rows: 8,
    cols: 24,
    mode: 'lace',
    tags: ['picot', 'cast-on', 'edge', 'scallop'],
    description:
      'A picot edge worked from the cast-on: a tiny bump of eyelet-and-decrease every few needles along the bottom rows, the scalloped finish for a baby blanket or a collar.',
    generate: laceEdge(3, {
      0: { width: 3, holes: [[0, 'R'], [1, 'L']] }
    })
  }),
  preset({
    id: 'ruffled_caston',
    name: 'Ruffled Cast-On',
    family: 'edges',
    group: 'cast-on',
    bed: 'single-bed',
    rows: 8,
    cols: 24,
    mode: 'lace',
    tags: ['ruffle', 'cast-on', 'edge'],
    description:
      'A gathered cast-on: one row of tight paired decreases right at the base makes the fabric ruffle outward from the edge like a lettuce hem.',
    generate: laceEdge(2, {
      0: { width: 2, holes: [[0, 'R']] }
    })
  }),
  preset({
    id: 'scalloped_bindoff',
    name: 'Scalloped Bind-Off',
    family: 'edges',
    group: 'bind-off',
    bed: 'single-bed',
    rows: 8,
    cols: 24,
    mode: 'lace',
    tags: ['scallop', 'bind-off', 'edge'],
    description:
      'A scalloped top edge: each scallop is a fan of decreases meeting at a point, worked along the bind-off rows so the finished hem waves.',
    generate: (rows, cols) => {
      const matrix = blankLace(rows, cols);
      const top = rows - 1;
      for (let r = Math.max(0, top - 4); r <= top; r++) {
        const inset = top - r;
        holeRow(matrix[r], 10, inset % 2 === 0 ? [[2 + inset, 'R'], [7 - inset, 'L']] : [[3, 'R'], [6, 'L']]);
      }
      return matrix;
    }
  }),
  preset({
    id: 'cable_caston_edge',
    name: 'Cable-Twist Cast-On (Two-Face)',
    family: 'edges',
    group: 'cast-on',
    bed: 'double-bed',
    rows: 6,
    cols: 24,
    mode: 'fair_isle',
    tags: ['cable', 'cast-on', 'edge', 'double-bed'],
    description:
      'A cable-twist cast-on: the tubular twisted edge that starts a cable band cleanly, drafted for the double bed where front and back needles can alternate.',
    generate: directRule((r, c) => (c % 4 < 2) === (r % 2 === 0))
  }),
  preset({
    id: 'buttonhole_band',
    name: 'Buttonhole Placket',
    family: 'edges',
    group: 'selvedges',
    bed: 'single-bed',
    rows: 24,
    cols: 12,
    mode: 'lace',
    tags: ['buttonhole', 'placket', 'selvedge', 'functional'],
    description:
      'A working buttonhole band: bound-off eyelet slots spaced up the placket, each a bar of transfers with the hole where the button sits.',
    generate: (rows, cols) => {
      const matrix = blankLace(rows, cols);
      for (let r = 0; r < rows; r++) {
        if (r % 8 < 3) holeRow(matrix[r], 8, [[2, 'R'], [5, 'L']]);
      }
      return matrix;
    }
  }),
  preset({
    id: 'applied_icord_edge',
    name: 'Applied I-Cord Edge (Two-Face)',
    family: 'edges',
    group: 'bind-off',
    bed: 'double-bed',
    rows: 6,
    cols: 24,
    mode: 'fair_isle',
    tags: ['i-cord', 'bind-off', 'edge', 'double-bed'],
    description:
      'An applied i-cord bind-off: a rounded tube drawn along the finish edge so the hem is soft and slightly rolled, the double-bed edging that never curls.',
    generate: directRule((r, c) => (r + Math.floor(c / 2)) % 3 !== 0)
  })
];

export const SHAPING_PRESETS = [
  preset({
    id: 'raglan_armhole',
    name: 'Raglan Armhole Slant',
    family: 'shaping',
    group: 'raglan',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    tags: ['raglan', 'armhole', 'shaping', 'decrease'],
    description:
      'A raglan armhole: paired decreases stepping inward up both selvedges on the classic (reduce every other row) schedule, drafting the diagonal from sleeve to neck.',
    generate: edgeSlant({ every: 2, width: 12 })
  }),
  preset({
    id: 'saddle_shoulder',
    name: 'Saddle Shoulder Steps',
    family: 'shaping',
    group: 'saddle',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    tags: ['saddle', 'shoulder', 'shetland', 'shaping'],
    description:
      'The Shetland saddle shoulder: the fabric is shaped in stepped blocks rather than a smooth slant, so the shoulder line sits flat with a rigid, architectural edge.',
    generate: (rows, cols) => {
      const matrix = blankLace(rows, cols);
      for (let r = 0; r < rows; r++) {
        const band = Math.floor(r / 4);
        if (r % 4 === 0) holeRow(matrix[r], 12 - band, [[0, 'R'], [11 - band, 'L']]);
      }
      return matrix;
    }
  }),
  preset({
    id: 'v_neck_decreases',
    name: 'V-Neck Decrease Lines',
    family: 'shaping',
    group: 'necklines',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    tags: ['v-neck', 'neckline', 'shaping', 'decrease'],
    description:
      'A V-neck: two decrease lines converging to a point at the top, mirrored so the collar opens in a clean \u201cV\u201d worked entirely into the fabric.',
    generate: (rows, cols) => {
      const matrix = blankLace(rows, cols);
      for (let r = 0; r < rows; r++) {
        const inset = Math.floor((r / rows) * (cols / 2 - 2));
        // Left line leans right into the centre, right line leans left.
        matrix[r][1 + inset] = S.EYELET;
        matrix[r][2 + inset] = S.TRANSFER_RIGHT;
        matrix[r][cols - 2 - inset] = S.TRANSFER_LEFT;
        matrix[r][cols - 3 - inset] = S.EYELET;
      }
      return matrix;
    }
  }),
  preset({
    id: 'waist_gore',
    name: 'Waist Suppression (Short Gores)',
    family: 'shaping',
    group: 'silhouettes',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'lace',
    tags: ['waist', 'gore', 'silhouette', 'shaping'],
    description:
      'A nipped waist: decreases run inward for the first half of the piece and increase symmetrically out of it, so the sides draw in and flare back — an A-line body.',
    generate: (rows, cols) => {
      const matrix = blankLace(rows, cols);
      for (let r = 0; r < rows; r++) {
        if (r % 3) continue;
        const half = rows / 2;
        const phase = r < half ? r : rows - r;
        const inset = Math.floor(phase / 3);
        holeRow(matrix[r], cols - 2 * inset, [[0, 'R'], [cols - 2 * inset - 1, 'L']]);
      }
      return matrix;
    }
  }),
  preset({
    id: 'heel_turn',
    name: 'Sock Heel Turn (DB Short Rows)',
    family: 'shaping',
    group: 'silhouettes',
    bed: 'double-bed',
    rows: 16,
    cols: 24,
    mode: 'fair_isle',
    tags: ['heel', 'short-rows', 'sock', 'double-bed'],
    description:
      'A heel turn drafted for the double bed\u2019s partial knitting: the classic German short-row wedge where the pass area shrinks by one needle at each end of the row.',
    generate: directRule((r, c) => {
      const width = 12 - Math.floor(r / 2);
      const centre = 12;
      return Math.abs(c - centre) <= width;
    })
  }),
  preset({
    id: 'mitred_corner',
    name: 'Mitred Corner Band',
    family: 'shaping',
    group: 'silhouettes',
    bed: 'single-bed',
    rows: 16,
    cols: 24,
    mode: 'lace',
    tags: ['mitre', 'corner', 'border', 'shaping'],
    description:
      'A mitred corner: a single column of paired decreases turning the band 90 degrees, so an edging can run around a square corner without gathering.',
    generate: (rows, cols) => {
      const matrix = blankLace(rows, cols);
      const corner = Math.floor(rows / 2);
      for (let r = 0; r < rows; r++) {
        const inset = Math.abs(r - corner);
        holeRow(matrix[r], 12, [[inset % 12, 'R']]);
      }
      return matrix;
    }
  })
];
