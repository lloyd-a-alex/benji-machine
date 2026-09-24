/**
 * KNITCAT - Pattern library, MATH STUDIO family.
 *
 * The Math Studio (`js/generators/math-patterns.js`) has long been the app's most
 * powerful generator engine — reaction-diffusion, toroidal Voronoi, Penrose tilings,
 * L-systems, Julia/Mandelbrot slices, Halton scatter, Christoffel words, the logistic
 * bifurcation — but every one of those was reachable only behind its own bespoke UI
 * button in `js/app.js`. The preset browser, the compiler, the taxonomy search and the
 * whole "click a thumbnail, get a card" flow could not see any of them, so the library
 * re-implemented a handful of similar ideas by hand (`patterns-generative-edges.js`)
 * while the canonical, heavily-documented maths sat unused by the preset pipeline.
 *
 * This file is the bridge: it wraps each `MathPatternGenerators` method as a
 * guard-compliant `generative` preset, so the Studio's full repertoire becomes
 * first-class, browsable, searchable, compiler-ready recipes — no duplication, one
 * source of truth for the mathematics.
 *
 * Contracts honoured here (see `tests/preset-library.test.mjs`):
 *   - direct mode (`fair_isle`), so a cell is exactly 0 or 1;
 *   - a fixed integer rows×cols rectangle that also sizes correctly at the 40-needle
 *     test width;
 *   - NON-EMPTY at every width (`ensureInk` is the safety net — a fully-blank card is
 *     never a useful preset, so a single centre mark is punched as a last resort);
 *   - determinism: the three stochastic generators bake a `seed` and forward the
 *     caller's seed, so the same preset always redraws identically;
 *   - a real `family`/`group` pair drawn from `preset-catalog.js` so `classify` is clean.
 */

import { MathPatternGenerators } from '../generators/math-patterns.js';
import { preset } from './preset-recipe-helpers.js';

const X = 1;

/**
 * Guarantee a 0/1 matrix carries at least one punch.
 *
 * Every generator below is non-empty by construction for the sizes we ship, but the
 * library-wide guard test refuses to accept a blank card, and a chaotic automaton
 * (Game of Life) can, for an unlucky soup, converge to extinction on a small torus.
 * Rather than hand-tune each parameter and leave a latent regression, we punch a single
 * centre needle when — and only when — the produced chart is otherwise empty. This is
 * deterministic and invisible on every real generator output.
 *
 * @param {number[][]} matrix rectangular rows×cols of 0/1 (mutated in place)
 * @param {number} rows
 * @param {number} cols
 * @returns {number[][]} the same matrix, guaranteed to contain at least one 1
 */
function ensureInk(matrix, rows, cols) {
  for (const row of matrix) {
    for (const cell of row) if (cell === X) return matrix;
  }
  const r = Math.min(rows - 1, Math.floor(rows / 2));
  const c = Math.min(cols - 1, Math.floor(cols / 2));
  if (matrix[r]) matrix[r][c] = X;
  return matrix;
}

/**
 * Adapt one `MathPatternGenerators` static into a preset `generate(rows, cols, seed)`.
 *
 * `make` receives the resolved bed size, the effective seed (falling back to the baked
 * default), and must return a rectangular 0/1 matrix; `ensureInk` closes the
 * non-empty invariant. Seeded generators read `seed`; deterministic ones ignore it.
 *
 * @param {(rows:number, cols:number, seed:number)=>number[][]} make
 * @param {number} bakedSeed default seed forwarded when the caller passes none
 */
function mathGenerate(make, bakedSeed = 0) {
  return (rows, cols, seed = bakedSeed) => ensureInk(make(rows, cols, seed >>> 0), rows, cols);
}

/**
 * The complete Math Studio preset family. Twenty recipes spanning every `generative`
 * group (automata, fractals, number, tiling, noise, optical), each a thin, honest
 * wrapper over the canonical mathematics rather than a second implementation of it.
 */
export const MATH_STUDIO_PRESETS = [
  // ─── automata ────────────────────────────────────────────────────────────────
  preset({
    id: 'game_of_life_ruins',
    name: 'Game of Life Ruins',
    family: 'generative',
    group: 'automata',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    seed: 7,
    tags: ['cellular-automata', 'conway', 'turing', 'toroidal', 'generative'],
    description:
      "Conway's B3/S23 automaton run on a torus from a random soup until it settles into gliders, oscillators and still-lifes — the ruins of a computation frozen into fabric, seamless across the repeat.",
    generate: mathGenerate((rows, cols, seed) => MathPatternGenerators.generateGameOfLife(rows, cols, seed, 14, 0.32), 7)
  }),

  // ─── fractals ────────────────────────────────────────────────────────────────
  preset({
    id: 'mandelbrot_slice',
    name: 'Mandelbrot Escape Slice',
    family: 'generative',
    group: 'fractals',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['fractal', 'mandelbrot', 'escape-time', 'complex'],
    description:
      'A slice of the Mandelbrot plane where every cell escaping on an odd iterate is punched, so the cardioid and its bulbs emerge as a shimmering moiré of period-doubling filaments.',
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateFractalSlice(rows, cols, 'mandelbrot', 40))
  }),
  preset({
    id: 'julia_dendrite',
    name: 'Julia Dendrite',
    family: 'generative',
    group: 'fractals',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['fractal', 'julia', 'dendrite', 'complex'],
    description:
      "The Julia set at the classic dendrite parameter c = −0.7 + 0.27i: instead of a filled blob it is a filigree of infinitely branching lightning, and the escape-time parity renders it as a lacy two-colour snowdrift.",
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateFractalSlice(rows, cols, 'julia', 40))
  }),
  preset({
    id: 'celtic_knotwork',
    name: 'Celtic Knotwork',
    family: 'generative',
    group: 'fractals',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['celtic', 'knot', 'interlace', 'ribbon'],
    description:
      'Two diagonal ribbon tracks on a periodic lattice with alternating over/under crossings carved out, so the card reads as a genuine braided Celtic panel — continuous cord that passes over and under itself.',
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateCelticKnot(rows, cols, 6))
  }),
  preset({
    id: 'lsystem_branches',
    name: 'L-System Thicket',
    family: 'generative',
    group: 'fractals',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['lsystem', 'fractal', 'branching', 'botanical'],
    description:
      'A Lindenmayer rewrite (F → FF+[+F−F−F]−[−F+F+F]) interpreted by a turtle graphics walk: from a single trunk the string self-splits into a branching thicket, the same grammar that models ferns and trees.',
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateLSystem(rows, cols, 'F', { F: 'FF+[+F-F-F]-[-F+F+F]' }, 3, 25))
  }),
  preset({
    id: 'superformula_bloom',
    name: 'Superformula Bloom',
    family: 'generative',
    group: 'fractals',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['superformula', 'gielis', 'organic', 'flower'],
    description:
      "Johan Gielis' superformula in polar form — one equation whose exponents slide the outline from circle to star to flower — drawn as a constant-width band so a single yarn traces the whole bloom.",
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateSuperformula(rows, cols, { m: 7, n1: 0.25, n2: 1.7, n3: 1.7 }))
  }),
  preset({
    id: 'rose_curve_petals',
    name: 'Rhodonea Rose',
    family: 'generative',
    group: 'fractals',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['rose', 'rhodonea', 'petal', 'polar'],
    description:
      'The rhodonea curve r = cos(kθ) with k = 5: five petals closed and rational, drawn as a band so the flower fills the bed with true polar symmetry rather than a stamped motif.',
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateRoseCurves(rows, cols, 5, 1, 1.4))
  }),

  // ─── number ──────────────────────────────────────────────────────────────────
  preset({
    id: 'string_art_cardioid',
    name: 'String-Art Cardioid',
    family: 'generative',
    group: 'number',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['modular', 'cardioid', 'string-art', 'number-theory'],
    description:
      'The times-table cardioid: sixty points on a circle, each i chorded to 2i mod 60, and the naive multiplication table blooms into the heart-shaped envelope that a real piece of string art famously draws.',
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateModularMultiplication(rows, cols, 60, 2))
  }),
  preset({
    id: 'string_art_nephroid',
    name: 'String-Art Nephroid',
    family: 'generative',
    group: 'number',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['modular', 'nephroid', 'string-art', 'number-theory'],
    description:
      'The same modular chord construction at factor 3: the cardioid kidney-turns into a two-cusped nephroid, proof that one line of arithmetic and a nail-board can out-design a chart author.',
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateModularMultiplication(rows, cols, 60, 3))
  }),
  preset({
    id: 'logistic_bifurcation_map',
    name: 'Logistic Bifurcation',
    family: 'generative',
    group: 'number',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['chaos', 'logistic-map', 'bifurcation', 'dynamics'],
    description:
      "The logistic map's route into chaos plotted one column per growth rate: a clean arc splits to two, then four, then the period-doubling cascade tears into the Feigenbaum fog — deterministic unpredictability you can knit.",
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateLogisticBifurcation(rows, cols, 2.6, 4.0, 200))
  }),
  preset({
    id: 'phyllotaxis_sunflower',
    name: 'Phyllotaxis Seed Head',
    family: 'generative',
    group: 'number',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['phyllotaxis', 'golden-angle', 'fibonacci', 'spiral'],
    description:
      'Seeds laid at successive multiples of the golden angle and scaled by √i: the sunflower head, where the irrational 137.5° spacing forces two counter-rotating spiral families straight out of pure number theory.',
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generatePhyllotaxis(rows, cols, 140, 0.55))
  }),

  // ─── tiling ──────────────────────────────────────────────────────────────────
  preset({
    id: 'voronoi_cells',
    name: 'Toroidal Voronoi Cells',
    family: 'generative',
    group: 'tiling',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    seed: 2024,
    tags: ['voronoi', 'tessellation', 'lloyd', 'toroidal', 'cells'],
    description:
      'Random seed points relaxed by two Lloyd iterations on a wrapping torus, then every cell boundary punched: a seamless stained-glass mesh with no edge seams, because opposite borders are the same needles.',
    generate: mathGenerate((rows, cols, seed) => MathPatternGenerators.generateToroidalVoronoi(rows, cols, 14, 1.2, seed), 2024)
  }),
  preset({
    id: 'penrose_quasicrystal',
    name: 'Penrose Quasicrystal',
    family: 'generative',
    group: 'tiling',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['penrose', 'quasiperiodic', 'fivefold', 'tiling'],
    description:
      "A five-fold projection of de Bruijn's pentagrid: the sinusoidal interference of golden-ratio directions yields an aperiodic quasicrystal — ordered forever, repeating never, with clean five-fold rotational symmetry.",
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generatePenroseTiling(rows, cols, 8))
  }),
  preset({
    id: 'hadamard_shimmer',
    name: 'Hadamard Shimmer',
    family: 'generative',
    group: 'tiling',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['hadamard', 'walsh', 'orthogonal', 'tiling'],
    description:
      "The Sylvester–Hadamard matrix's ±1 entries tiled across the bed: because distinct rows are orthogonal there is no low-frequency block to band up, so the checker-of-checkers reads as a flat, non-repeating shimmer rather than a plaid.",
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateHadamardTiling(rows, cols, 8))
  }),
  preset({
    id: 'halton_stars',
    name: 'Halton Low-Discrepancy Scatter',
    family: 'generative',
    group: 'tiling',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['halton', 'quasirandom', 'low-discrepancy', 'scatter'],
    description:
      "The Halton sequence in bases 2 and 3 mapped onto the card: a quasirandom sprinkle that fills the field evenly with no clumps and no gaps — the deterministic way to scatter confetti so 'random' never accidentally bunches.",
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateHaltonScatter(rows, cols, 70))
  }),
  preset({
    id: 'christoffel_interlace',
    name: 'Christoffel Interlace',
    family: 'generative',
    group: 'tiling',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['christoffel', 'bresenham', 'balanced-word', 'interlace'],
    description:
      'Each row places its stitches by the balanced Christoffel word for a rising slope (the same "decrease evenly" maths a knitter uses), then rotates to interlace with its neighbours, so no two marks bunch and stress never concentrates in one wale.',
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateChristoffelWeave(rows, cols, 8))
  }),

  // ─── noise ───────────────────────────────────────────────────────────────────
  preset({
    id: 'reaction_diffusion_labyrinth',
    name: 'Reaction-Diffusion Labyrinth',
    family: 'generative',
    group: 'noise',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    seed: 1337,
    tags: ['turing', 'reaction-diffusion', 'gray-scott', 'morphogenesis', 'labyrinth'],
    description:
      "Gray–Scott morphogenesis solved on a wrapping bed: two chemicals diffuse and react until Turing's instability carves a winding labyrinth — the same equations that paint a zebra, run to a wriggling maze.",
    generate: mathGenerate((rows, cols, seed) => MathPatternGenerators.generateReactionDiffusion(rows, cols, 'labyrinth', 150, seed), 1337)
  }),
  preset({
    id: 'reaction_diffusion_spots',
    name: 'Reaction-Diffusion Leopard',
    family: 'generative',
    group: 'noise',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    seed: 99,
    tags: ['turing', 'reaction-diffusion', 'gray-scott', 'spots', 'animal'],
    description:
      'The Gray–Scott solver nudged into its spotted regime: isolated blooms of the activator survive wherever the inhibitor diffused away, so the field settles into leopard rosettes — animal-marking mathematics, knitworthy.',
    generate: mathGenerate((rows, cols, seed) => MathPatternGenerators.generateReactionDiffusion(rows, cols, 'spots', 150, seed), 99)
  }),
  preset({
    id: 'perlin_blender',
    name: 'Perlin Octave Blender',
    family: 'generative',
    group: 'noise',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['perlin', 'fbm', 'noise', 'organic', 'fractal-sum'],
    description:
      'Fractal Brownian motion: four octaves of gradient noise summed with falling amplitude and doubling frequency, then thresholded at the midpoint — smoke, cloud and marbled organic texture from a single blend.',
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generatePerlinNoise(rows, cols, 4, 0.55, 0.09))
  }),

  // ─── optical ─────────────────────────────────────────────────────────────────
  preset({
    id: 'wave_interference',
    name: 'Fourier Wave Interference',
    family: 'generative',
    group: 'optical',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['fourier', 'interference', 'harmonics', 'optical', 'moire'],
    description:
      'A superposition of harmonic cosines with anisotropic dispersion: add five vibrating modes whose amplitudes fall as 1/n and the beats between them interference into a standing-wave field that argues with the eye.',
    generate: mathGenerate((rows, cols) => MathPatternGenerators.generateWaveInterference(rows, cols, 5, 1.0))
  })
];
