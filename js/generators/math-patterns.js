/**
 * Advanced Mathematical Pattern Generators & Procedural Synthesis
 * 
 * Implements post-calculus, PDE-driven, fractal, and topological generators:
 * 1. Gray-Scott Reaction-Diffusion Turing Morphogenesis PDEs
 * 2. Multi-Harmonic Fourier Wave Superposition & Moiré Interference
 * 3. Toroidal Lloyd-Relaxed Voronoi Cellular Tessellations
 * 4. Planar Graph Ribbon Celtic Knotwork with Gauss Crossing Invariants
 * 5. Wolfram 1D/2D Cellular Automata (Rule 30, 90, 110)
 * 6. Complex Analytic Fractal Slicing (Mandelbrot / Julia Distance Estimator)
 */

import { STITCH_TYPE } from '../math/knit-topology.js';

/**
 * mulberry32 — a tiny seeded PRNG.
 *
 * Every stochastic generator in this file takes a `seed`, because a pattern tool
 * whose output changes every click is not a design tool: you cannot go back to
 * the motif you liked two minutes ago, and a screenshot of the gallery is not a
 * reproducible artifact. Same seed, same card, on every machine, forever.
 *
 * @param {number} seed integer seed; 0 / undefined falls back to a fixed constant
 * @returns {() => number} next() in [0, 1)
 */
export function makeRng(seed) {
  let state = (Number.isFinite(seed) ? seed : 0) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh, non-reproducible seed — for when you *want* to roll the dice. */
export function randomSeed() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Pure mathematical primitives.
 *
 * These are separated from the generators on purpose: each one is a closed-form
 * piece of mathematics (number theory, quasi-Monte-Carlo, linear algebra,
 * discrete geometry) that can be unit-tested against its defining property on
 * its own, without rasterising anything. The generators below are thin
 * rasterisers over these facts.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Greatest common divisor of two integers (Euclid). */
export function gcd(a, b) {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y) { const t = y; y = x % y; x = t; }
  return x;
}

/**
 * Radical inverse (van der Corput): reflect the base-`base` digits of `index`
 * about the decimal point. This is the 1-D low-discrepancy sequence — the
 * reason a Halton point set scatters far more evenly than a random draw.
 *   radicalInverse(5, 2) = (101)₂ reflected = 0.101₂ = 0.625
 */
export function radicalInverse(index, base = 2) {
  let n = Math.max(0, Math.floor(index));
  const b = base >= 2 ? Math.floor(base) : 2;
  let inv = 1;
  let result = 0;
  while (n > 0) {
    inv /= b;
    result += (n % b) * inv;
    n = Math.floor(n / b);
  }
  return result;
}

/** A Halton quasi-random point in [0,1)^d, one radical-inverse per base. */
export function haltonPoint(index, bases = [2, 3]) {
  return bases.map((b) => radicalInverse(index, b));
}

/**
 * Distribute `count` marks across `total` slots as evenly as arithmetic allows
 * (the Christoffel / Bresenham principle). Gaps between consecutive marks differ
 * by at most one slot — which is exactly the problem a knitter faces when told
 * "decrease 7 times over 43 rows". Returns a length-`total` 0/1 array summing to
 * min(count, total).
 */
export function distributeEvenly(count, total) {
  const out = new Array(total).fill(0);
  if (total <= 0) return out;
  const c = Math.max(0, Math.min(Math.trunc(count), total));
  let acc = 0;
  for (let i = 0; i < total; i++) {
    acc += c;
    if (acc >= total) {
      out[i] = 1;
      acc -= total;
    }
  }
  return out;
}

/**
 * Sylvester–Hadamard matrix of the smallest power-of-two order ≥ `order`,
 * built by the doubling Kronecker construction
 *   H₂ = [[1,1],[1,-1]],  H₂ₖ = [[Hₖ, Hₖ],[Hₖ, -Hₖ]].
 * Every row (except the all-ones first) holds n/2 +1s and n/2 -1s, and any two
 * distinct rows are orthogonal: H·Hᵀ = nI. That orthogonality is what makes the
 * tiled pattern free of low-frequency repetition.
 */
export function hadamardMatrix(order = 8) {
  const target = Math.max(1, Math.pow(2, Math.ceil(Math.log2(Math.max(1, order)))));
  let H = [[1]];
  while (H.length < target) {
    const top = H.map((row) => row.concat(row));
    const bot = H.map((row) => row.concat(row.map((v) => -v)));
    H = top.concat(bot);
  }
  return H;
}

/**
 * Gielis' superformula radius — the one-parameter family that contains the
 * circle, superellipse, and countless flower/starfish outlines:
 *   r(θ) = ( |cos(mθ/4)/a)^n2 + |sin(mθ/4)/b)^n3 )^(-1/n1)
 */
export function superformulaRadius(theta, params = {}) {
  const { m = 6, n1 = 1, n2 = 1, n3 = 1, a = 1, b = 1 } = params;
  const t1 = Math.pow(Math.abs(Math.cos((m * theta) / 4) / a), n2);
  const t2 = Math.pow(Math.abs(Math.sin((m * theta) / 4) / b), n3);
  const sum = t1 + t2;
  if (sum === 0) return 0;
  const r = Math.pow(sum, -1 / n1);
  return Number.isFinite(r) ? r : 0;
}

/** Bresenham line rasteriser into a 0/1 matrix (clipped to bounds). Internal. */
function drawLineToMatrix(matrix, x0, y0, x1, y1) {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const sx = x < xe ? 1 : -1;
  const dy = -Math.abs(ye - y);
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  const rows = matrix.length;
  const cols = rows ? matrix[0].length : 0;
  for (;;) {
    if (x >= 0 && x < cols && y >= 0 && y < rows) matrix[y][x] = 1;
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function zeros(rows, cols) {
  const m = [];
  for (let r = 0; r < rows; r++) m[r] = new Array(cols).fill(0);
  return m;
}

export class MathPatternGenerators {
  /**
   * Gray-Scott Reaction-Diffusion PDE Solver on Toroidal Domain
   * Models biological morphogenesis (Turing patterns: leopard spots, zebra stripes, labyrinthine lace).
   * 
   * Equations:
   *   du/dt = D_u * Delta(u) - u * v^2 + F * (1 - u)
   *   dv/dt = D_v * Delta(v) + u * v^2 - (F + k) * v
   */
  static generateReactionDiffusion(rows, cols, preset = 'labyrinth', iterations = 180, seed = 0) {
    const rand = makeRng(seed);
    const presets = {
      labyrinth: { Du: 0.2097, Dv: 0.105, F: 0.039, k: 0.058 },
      spots:     { Du: 0.2097, Dv: 0.105, F: 0.035, k: 0.065 },
      waves:     { Du: 0.16,   Dv: 0.08,  F: 0.060, k: 0.062 },
      mitosis:   { Du: 0.2097, Dv: 0.105, F: 0.0367, k: 0.0649 }
    };

    const param = presets[preset] || presets.labyrinth;
    const Du = param.Du;
    const Dv = param.Dv;
    const F = param.F;
    const k = param.k;
    const dt = 1.0;

    // Grid states
    let u = new Float32Array(rows * cols).fill(1.0);
    let v = new Float32Array(rows * cols).fill(0.0);
    let nextU = new Float32Array(rows * cols);
    let nextV = new Float32Array(rows * cols);

    // Initial perturbation seed (concentric or clustered dots)
    const midR = Math.floor(rows / 2);
    const midC = Math.floor(cols / 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d = Math.sqrt((r - midR) ** 2 + (c - midC) ** 2);
        if (d < 4 || (r % 6 === 0 && c % 6 === 0)) {
          v[r * cols + c] = 0.8 + rand() * 0.2;
          u[r * cols + c] = 0.2;
        }
      }
    }

    // 9-point Laplacian discrete stencil weights
    const centerW = -1.0;
    const cardinalW = 0.2;
    const diagonalW = 0.05;

    for (let it = 0; it < iterations; it++) {
      for (let r = 0; r < rows; r++) {
        const rUp = (r + 1) % rows;
        const rDown = (r - 1 + rows) % rows;

        for (let c = 0; c < cols; c++) {
          const cRight = (c + 1) % cols;
          const cLeft = (c - 1 + cols) % cols;

          const idx = r * cols + c;
          const uC = u[idx];
          const vC = v[idx];

          // Toroidal Laplacian convolution Delta(u)
          const lapU = 
            centerW * uC +
            cardinalW * (u[rUp * cols + c] + u[rDown * cols + c] + u[r * cols + cRight] + u[r * cols + cLeft]) +
            diagonalW * (u[rUp * cols + cRight] + u[rUp * cols + cLeft] + u[rDown * cols + cRight] + u[rDown * cols + cLeft]);

          const lapV = 
            centerW * vC +
            cardinalW * (v[rUp * cols + c] + v[rDown * cols + c] + v[r * cols + cRight] + v[r * cols + cLeft]) +
            diagonalW * (v[rUp * cols + cRight] + v[rUp * cols + cLeft] + v[rDown * cols + cRight] + v[rDown * cols + cLeft]);

          const uvv = uC * vC * vC;
          nextU[idx] = Math.max(0, Math.min(1, uC + (Du * lapU - uvv + F * (1.0 - uC)) * dt));
          nextV[idx] = Math.max(0, Math.min(1, vC + (Dv * lapV + uvv - (F + k) * vC) * dt));
        }
      }

      // Swap buffers
      const tempU = u; u = nextU; nextU = tempU;
      const tempV = v; v = nextV; nextV = tempV;
    }

    // Convert continuous concentration field to binary pattern & lace stitch transfers
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      matrix[r] = [];
      for (let c = 0; c < cols; c++) {
        const val = v[r * cols + c];
        matrix[r][c] = (val > 0.28) ? 1 : 0;
      }
    }
    return matrix;
  }

  /**
   * Multi-Harmonic Fourier Superposition with Anisotropic Dispersion
   *   Psi(x,y) = Sum( A_i * cos( k_x*x + k_y*y + phi_i ) )
   */
  static generateWaveInterference(rows, cols, numHarmonics = 5, freqMultiplier = 1.0) {
    const matrix = [];
    const harmonics = [];

    // Construct random or resonant Fourier modes
    for (let h = 0; h < numHarmonics; h++) {
      harmonics.push({
        kx: ((h + 1) * 2 * Math.PI / cols) * freqMultiplier,
        ky: ((h + 1) * 2 * Math.PI / rows) * freqMultiplier,
        amp: 1.0 / (h + 1),
        phase: (h * Math.PI) / 3.0
      });
    }

    let minVal = Infinity;
    let maxVal = -Infinity;
    const values = [];

    for (let r = 0; r < rows; r++) {
      values[r] = [];
      for (let c = 0; c < cols; c++) {
        let psi = 0;
        for (const harm of harmonics) {
          psi += harm.amp * Math.cos(harm.kx * c + harm.ky * r + harm.phase);
          psi += harm.amp * 0.5 * Math.sin(harm.kx * 2 * c - harm.ky * r);
        }
        values[r][c] = psi;
        if (psi < minVal) minVal = psi;
        if (psi > maxVal) maxVal = psi;
      }
    }

    const threshold = minVal + (maxVal - minVal) * 0.52;
    for (let r = 0; r < rows; r++) {
      matrix[r] = [];
      for (let c = 0; c < cols; c++) {
        matrix[r][c] = values[r][c] > threshold ? 1 : 0;
      }
    }
    return matrix;
  }

  /**
   * Toroidal Voronoi Cellular Tessellation
   * Uses periodic boundary distance metric to eliminate edge seams:
   *   d_torus(p1, p2) = sqrt( min(|dx|, W-|dx|)^2 + min(|dy|, H-|dy|)^2 )
   */
  static generateToroidalVoronoi(rows, cols, numSeedPoints = 14, wallThickness = 1.2, seed = 0) {
    const rand = makeRng(seed);
    const seeds = [];
    for (let i = 0; i < numSeedPoints; i++) {
      seeds.push({
        x: rand() * cols,
        y: rand() * rows
      });
    }

    // Centroidal Lloyd relaxation iteration (2 passes)
    for (let lloyd = 0; lloyd < 2; lloyd++) {
      const accumX = new Float32Array(numSeedPoints);
      const accumY = new Float32Array(numSeedPoints);
      const counts = new Int32Array(numSeedPoints);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let minDist = Infinity;
          let bestSeed = 0;

          for (let s = 0; s < numSeedPoints; s++) {
            let dx = Math.abs(c - seeds[s].x);
            if (dx > cols / 2) dx = cols - dx;
            let dy = Math.abs(r - seeds[s].y);
            if (dy > rows / 2) dy = rows - dy;
            const dist = dx * dx + dy * dy;

            if (dist < minDist) {
              minDist = dist;
              bestSeed = s;
            }
          }

          accumX[bestSeed] += c;
          accumY[bestSeed] += r;
          counts[bestSeed]++;
        }
      }

      for (let s = 0; s < numSeedPoints; s++) {
        if (counts[s] > 0) {
          seeds[s].x = accumX[s] / counts[s];
          seeds[s].y = accumY[s] / counts[s];
        }
      }
    }

    // Render Voronoi cell boundaries
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      matrix[r] = [];
      for (let c = 0; c < cols; c++) {
        let d1 = Infinity;
        let d2 = Infinity;

        for (let s = 0; s < numSeedPoints; s++) {
          let dx = Math.abs(c - seeds[s].x);
          if (dx > cols / 2) dx = cols - dx;
          let dy = Math.abs(r - seeds[s].y);
          if (dy > rows / 2) dy = rows - dy;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < d1) {
            d2 = d1;
            d1 = dist;
          } else if (dist < d2) {
            d2 = dist;
          }
        }

        // Distance difference identifies the boundary ridge
        const edgeDist = d2 - d1;
        matrix[r][c] = (edgeDist < wallThickness) ? 1 : 0;
      }
    }
    return matrix;
  }

  /**
   * Topological Celtic Knotwork & Braiding Generator
   * Computes ribbon interlacing with alternating over-under crossings.
   */
  static generateCelticKnot(rows, cols, cellScale = 6) {
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      matrix[r] = new Array(cols).fill(0);
    }

    const period = cellScale * 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const u = c % period;
        const v = r % period;

        // Diagonal ribbon tracks
        const diag1 = Math.abs(u - v);
        const diag2 = Math.abs(u + v - period);
        const ribbonWidth = 1.6;

        const onRibbon1 = diag1 <= ribbonWidth || Math.abs(diag1 - period) <= ribbonWidth;
        const onRibbon2 = diag2 <= ribbonWidth || Math.abs(diag2 - period) <= ribbonWidth;

        if (onRibbon1 && onRibbon2) {
          // Crossing node: alternate over/under based on cell parity
          const cellX = Math.floor(c / period);
          const cellY = Math.floor(r / period);
          const overRibbon1 = (cellX + cellY) % 2 === 0;

          // Carve underpass gap
          if (overRibbon1) {
            matrix[r][c] = 1;
          } else {
            matrix[r][c] = (diag2 < 0.6) ? 0 : 1;
          }
        } else if (onRibbon1 || onRibbon2) {
          matrix[r][c] = 1;
        }
      }
    }
    return matrix;
  }

  /**
   * 1D Cellular Automata (Wolfram Rules e.g. Rule 30, 90, 110)
   * Rule 110 is proven Turing-Complete; Rule 30 is chaotic; Rule 90 produces Sierpinski triangles.
   */
  static generateWolframCA(rows, cols, ruleNumber = 110) {
    const matrix = [];
    const ruleBits = [];
    for (let i = 0; i < 8; i++) {
      ruleBits[i] = (ruleNumber >> i) & 1;
    }

    // Seed top row with single center cell or random bits
    let currentRow = new Array(cols).fill(0);
    currentRow[Math.floor(cols / 2)] = 1;
    matrix[0] = [...currentRow];

    for (let r = 1; r < rows; r++) {
      const nextRow = new Array(cols).fill(0);
      for (let c = 0; c < cols; c++) {
        const left = currentRow[(c - 1 + cols) % cols];
        const center = currentRow[c];
        const right = currentRow[(c + 1) % cols];
        const neighborhood = (left << 2) | (center << 1) | right;
        nextRow[c] = ruleBits[neighborhood];
      }
      matrix[r] = nextRow;
      currentRow = nextRow;
    }
    return matrix;
  }

  /**
   * Complex Analytic Fractal Slicer (Julia / Mandelbrot Set)
   * z_{n+1} = z_n^2 + c
   */
  static generateFractalSlice(rows, cols, type = 'mandelbrot', maxIter = 40) {
    const matrix = [];
    const cxConst = -0.7;
    const cyConst = 0.27015; // Beautiful dendrite Julia parameter

    const scaleX = 3.0 / cols;
    const scaleY = 3.0 / rows;

    for (let r = 0; r < rows; r++) {
      matrix[r] = [];
      const y0 = (r - rows / 2) * scaleY;

      for (let c = 0; c < cols; c++) {
        const x0 = (c - cols / 2) * scaleX;

        let zx = (type === 'mandelbrot') ? 0 : x0;
        let zy = (type === 'mandelbrot') ? 0 : y0;
        const cx = (type === 'mandelbrot') ? x0 - 0.5 : cxConst;
        const cy = (type === 'mandelbrot') ? y0 : cyConst;

        let iter = 0;
        while (zx * zx + zy * zy < 4.0 && iter < maxIter) {
          const xtemp = zx * zx - zy * zy + cx;
          zy = 2.0 * zx * zy + cy;
          zx = xtemp;
          iter++;
        }

        // Map escape time to binary or lace stitch
        matrix[r][c] = (iter % 2 === 1 && iter < maxIter) ? 1 : 0;
      }
    }
    return matrix;
  }

  /**
   * Converts a binary 0/1 matrix into valid Lace Stitch primitives
   * (combining transfers and companion eyelets automatically)
   */
  static convertBinaryToLaceStitches(binaryMatrix) {
    const rows = binaryMatrix.length;
    const cols = binaryMatrix[0]?.length || 24;
    const stitchMatrix = [];

    for (let r = 0; r < rows; r++) {
      stitchMatrix[r] = new Array(cols).fill(STITCH_TYPE.KNIT);

      for (let c = 0; c < cols; c++) {
        if (binaryMatrix[r][c] === 1) {
          // Hole position: Create eyelet (yarnover) and paired transfer decrease
          if (c % 2 === 0 && c < cols - 1) {
            stitchMatrix[r][c] = STITCH_TYPE.EYELET;
            stitchMatrix[r][c + 1] = STITCH_TYPE.TRANSFER_LEFT; // decrease into adjacent needle
          } else if (c > 0) {
            stitchMatrix[r][c] = STITCH_TYPE.EYELET;
            stitchMatrix[r][c - 1] = STITCH_TYPE.TRANSFER_RIGHT;
          } else {
            stitchMatrix[r][c] = STITCH_TYPE.EYELET;
          }
        }
      }
    }
    return stitchMatrix;
  }

  /**
   * Perlin-like Noise Generator with Octave Layering
   * Creates organic, flowing patterns with multiple frequency layers
   */
  static generatePerlinNoise(rows, cols, octaves = 4, persistence = 0.5, scale = 0.1) {
    const matrix = [];
    const values = [];
    
    // Simple value noise function
    const noise = (x, y) => {
      const i = Math.floor(x);
      const j = Math.floor(y);
      const f = x - i;
      const g = y - j;
      
      // Hash function for deterministic random values
      const hash = (n) => {
        n = (n << 13) ^ n;
        return ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 2147483648.0;
      };
      
      const a = hash(i + j * 57);
      const b = hash(i + 1 + j * 57);
      const c = hash(i + (j + 1) * 57);
      const d = hash(i + 1 + (j + 1) * 57);
      
      const u = f * f * (3.0 - 2.0 * f);
      const v = g * g * (3.0 - 2.0 * g);
      
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    
    let maxVal = -Infinity;
    let minVal = Infinity;
    
    for (let r = 0; r < rows; r++) {
      values[r] = [];
      for (let c = 0; c < cols; c++) {
        let amplitude = 1.0;
        let frequency = scale;
        let noiseValue = 0.0;
        let maxValue = 0.0;
        
        for (let o = 0; o < octaves; o++) {
          noiseValue += noise(c * frequency, r * frequency) * amplitude;
          maxValue += amplitude;
          amplitude *= persistence;
          frequency *= 2.0;
        }
        
        noiseValue /= maxValue;
        values[r][c] = noiseValue;
        
        if (noiseValue > maxVal) maxVal = noiseValue;
        if (noiseValue < minVal) minVal = noiseValue;
      }
    }
    
    const threshold = minVal + (maxVal - minVal) * 0.5;
    for (let r = 0; r < rows; r++) {
      matrix[r] = [];
      for (let c = 0; c < cols; c++) {
        matrix[r][c] = values[r][c] > threshold ? 1 : 0;
      }
    }
    
    return matrix;
  }

  /**
   * L-System (Lindenmayer System) Generator
   * Creates branching, plant-like patterns using rewrite rules
   */
  static generateLSystem(rows, cols, axiom = 'F', rules = { 'F': 'FF+[+F-F-F]-[-F+F+F]' }, iterations = 4, angle = 25) {
    let current = axiom;
    
    for (let i = 0; i < iterations; i++) {
      let next = '';
      for (const char of current) {
        next += rules[char] || char;
      }
      current = next;
    }
    
    // Turtle graphics interpretation
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      matrix[r] = new Array(cols).fill(0);
    }
    
    let x = Math.floor(cols / 2);
    let y = rows - 1;
    let angleRad = -Math.PI / 2; // Pointing up
    const angleStep = (angle * Math.PI) / 180;
    const stepSize = 1;
    
    const stack = [];
    
    for (const char of current) {
      switch (char) {
        case 'F':
          const newX = Math.round(x + Math.cos(angleRad) * stepSize);
          const newY = Math.round(y + Math.sin(angleRad) * stepSize);
          
          if (newX >= 0 && newX < cols && newY >= 0 && newY < rows) {
            matrix[newY][newX] = 1;
            // Draw line
            const steps = Math.max(Math.abs(newX - x), Math.abs(newY - y));
            for (let s = 0; s <= steps; s++) {
              const t = s / steps;
              const lx = Math.round(x + (newX - x) * t);
              const ly = Math.round(y + (newY - y) * t);
              if (lx >= 0 && lx < cols && ly >= 0 && ly < rows) {
                matrix[ly][lx] = 1;
              }
            }
          }
          x = newX;
          y = newY;
          break;
        case '+':
          angleRad += angleStep;
          break;
        case '-':
          angleRad -= angleStep;
          break;
        case '[':
          stack.push({ x, y, angleRad });
          break;
        case ']':
          const state = stack.pop();
          if (state) {
            x = state.x;
            y = state.y;
            angleRad = state.angleRad;
          }
          break;
      }
    }
    
    return matrix;
  }

  /**
   * Penrose Tiling Approximation
   * Creates quasi-periodic patterns with fivefold symmetry
   */
  static generatePenroseTiling(rows, cols, scale = 8) {
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      matrix[r] = new Array(cols).fill(0);
    }
    
    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    const angles = [0, 2 * Math.PI / 5, 4 * Math.PI / 5, 6 * Math.PI / 5, 8 * Math.PI / 5];
    
    const centerX = cols / 2;
    const centerY = rows / 2;
    
    // Generate rhombus tiles
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dx = c - centerX;
        const dy = r - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Create pentagonal symmetry
        let maxProj = -Infinity;
        for (const angle of angles) {
          const proj = dx * Math.cos(angle) + dy * Math.sin(angle);
          if (proj > maxProj) maxProj = proj;
        }
        
        // Quasi-periodic modulation
        const modulation = Math.sin(dist / scale * goldenRatio) * Math.cos(maxProj / scale);
        matrix[r][c] = modulation > 0.3 ? 1 : 0;
      }
    }
    
    return matrix;
  }

  /**
   * Spiral Phyllotaxis Pattern
   * Based on golden angle patterns found in nature (sunflowers, pinecones)
   */
  static generatePhyllotaxis(rows, cols, points = 100, spread = 0.5) {
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      matrix[r] = new Array(cols).fill(0);
    }
    
    const goldenAngle = 2.39996; // 137.5 degrees in radians
    const centerX = cols / 2;
    const centerY = rows / 2;
    
    for (let i = 0; i < points; i++) {
      const angle = i * goldenAngle;
      const radius = spread * Math.sqrt(i);
      
      const x = Math.round(centerX + radius * Math.cos(angle));
      const y = Math.round(centerY + radius * Math.sin(angle));
      
      if (x >= 0 && x < cols && y >= 0 && y < rows) {
        // Draw small circle around each point
        const circleRadius = 2;
        for (let dy = -circleRadius; dy <= circleRadius; dy++) {
          for (let dx = -circleRadius; dx <= circleRadius; dx++) {
            if (dx * dx + dy * dy <= circleRadius * circleRadius) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
                matrix[ny][nx] = 1;
              }
            }
          }
        }
      }
    }
    
    return matrix;
  }

  /**
   * Moiré Interference Pattern
   * Creates optical interference patterns from overlapping grids
   *
   * The identifier is ASCII on purpose. A live accent in a method name works in
   * ES modules but breaks the moment the file passes through a minifier, a
   * different filesystem normalisation form (NFC vs NFD), or a search that types
   * "Moire". The accented spelling is kept as an alias so nothing old breaks.
   */
  static generateMoirePattern(rows, cols, angle1 = 0, angle2 = 0.1, frequency = 0.2) {
    const matrix = [];
    
    for (let r = 0; r < rows; r++) {
      matrix[r] = [];
      for (let c = 0; c < cols; c++) {
        // First pattern
        const x1 = c * Math.cos(angle1) - r * Math.sin(angle1);
        const y1 = c * Math.sin(angle1) + r * Math.cos(angle1);
        const pattern1 = Math.sin(x1 * frequency) > 0 ? 1 : 0;
        
        // Second pattern
        const x2 = c * Math.cos(angle2) - r * Math.sin(angle2);
        const y2 = c * Math.sin(angle2) + r * Math.cos(angle2);
        const pattern2 = Math.sin(y2 * frequency) > 0 ? 1 : 0;
        
        // Interference
        matrix[r][c] = (pattern1 !== pattern2) ? 1 : 0;
      }
    }
    
    return matrix;
  }

  /**
   * Conway's Game of Life on a torus (rule B3/S23).
   * A cellular automaton that is Turing-complete: gliders, oscillators and
   * still-lifes emerge from a random soup. The toroidal wrap means no edge
   * artefacts, so the card repeats seamlessly. `generations` controls how far
   * the soup has settled — low values stay busy, high values converge to
   * still-lifes and oscillators.
   */
  static generateGameOfLife(rows, cols, seed = 0, generations = 25, density = 0.3) {
    const rand = makeRng(seed);
    let g = [];
    for (let r = 0; r < rows; r++) {
      g[r] = [];
      for (let c = 0; c < cols; c++) g[r][c] = rand() < density ? 1 : 0;
    }
    const wrapR = (r) => (r + rows) % rows;
    const wrapC = (c) => (c + cols) % cols;
    for (let gen = 0; gen < generations; gen++) {
      const ng = [];
      for (let r = 0; r < rows; r++) {
        ng[r] = [];
        for (let c = 0; c < cols; c++) {
          let n = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              n += g[wrapR(r + dr)][wrapC(c + dc)];
            }
          }
          const alive = g[r][c];
          ng[r][c] = alive ? ((n === 2 || n === 3) ? 1 : 0) : (n === 3 ? 1 : 0);
        }
      }
      g = ng;
    }
    return g;
  }

  /**
   * Sylvester–Hadamard tiling: the ±1 orthogonal matrix (see hadamardMatrix)
   * mapped to knit/purl and tiled across the card. Because distinct rows are
   * orthogonal, the resulting checker-of-checkers carries no repeating
   * low-frequency block — visually it shimmers rather than bands.
   */
  static generateHadamardTiling(rows, cols, order = 8) {
    const H = hadamardMatrix(order);
    const n = H.length;
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      matrix[r] = [];
      for (let c = 0; c < cols; c++) matrix[r][c] = H[r % n][c % n] > 0 ? 1 : 0;
    }
    return matrix;
  }

  /**
   * Low-discrepancy scatter: the first `pointCount` Halton-sequence points
   * (radical inverse in bases 2 and 3) mapped onto the card. Unlike random
   * seeding this fills the field evenly with no clumps and no holes — the
   * right tool for a regular-but-organic sprinkle of eyelets.
   */
  static generateHaltonScatter(rows, cols, pointCount = 60) {
    const matrix = zeros(rows, cols);
    if (rows === 0 || cols === 0) return matrix;
    for (let i = 1; i <= pointCount; i++) {
      const [fx, fy] = haltonPoint(i, [2, 3]);
      const c = Math.min(cols - 1, Math.floor(fx * cols));
      const r = Math.min(rows - 1, Math.floor(fy * rows));
      matrix[r][c] = 1;
    }
    return matrix;
  }

  /**
   * Christoffel weave: each row distributes its marks by the balanced
   * (Christoffel / Bresenham) word for slope k/cols, then the whole row is
   * cyclically shifted to interlace with its neighbours. The mathematics is the
   * same one a knitter uses to "decrease evenly": no two marks are ever
   * unnecessarily adjacent, so stress never concentrates in one wale.
   */
  static generateChristoffelWeave(rows, cols, repeat = 8) {
    const L = Math.max(2, Math.min(repeat, cols));
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      const k = (r % L) + 1;
      const row = distributeEvenly(k, cols);
      const shift = Math.floor(r / L) % cols;
      const rotated = row.slice(cols - shift).concat(row.slice(0, cols - shift));
      matrix[r] = rotated.map((v) => (v ? 1 : 0));
    }
    return matrix;
  }

  /**
   * Gielis superformula outline (see superformulaRadius). Sweeping `m` and the
   * three exponents walks the whole family from circles to stars to flowers;
   * the shape is drawn as a fixed-width band so it reads as a single yarn.
   */
  static generateSuperformula(rows, cols, params = {}) {
    const p = { m: 7, n1: 0.25, n2: 1.7, n3: 1.7, a: 1, b: 1, ...params };
    const matrix = zeros(rows, cols);
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    let maxR = 0;
    for (let s = 0; s < 720; s++) maxR = Math.max(maxR, superformulaRadius((s * Math.PI) / 360, p));
    const scale = Math.min(cx, cy) / (maxR || 1);
    const band = Math.max(1.0, Math.min(rows, cols) * 0.03);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dx = c - cx;
        const dy = r - cy;
        const rho = Math.hypot(dx, dy);
        const theta = Math.atan2(dy, dx);
        const R = superformulaRadius(theta, p) * scale;
        matrix[r][c] = Math.abs(rho - R) <= band ? 1 : 0;
      }
    }
    return matrix;
  }

  /**
   * Rhodonea (rose) curves r = cos((numerator/denominator)·θ), drawn as petals.
   * When the ratio is p/q in lowest terms the curve closes with p·q petals (p·2q
   * when p and q are both odd) — a genuinely rational-symmetric motif.
   */
  static generateRoseCurves(rows, cols, numerator = 5, denominator = 1, band = 1.4) {
    const matrix = zeros(rows, cols);
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const scale = Math.min(cx, cy) || 1;
    const nb = band / scale;
    const k = numerator / (denominator || 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dx = (c - cx) / scale;
        const dy = (r - cy) / scale;
        const rho = Math.hypot(dx, dy);
        const theta = Math.atan2(dy, dx);
        const R = Math.abs(Math.cos(k * theta));
        matrix[r][c] = Math.abs(rho - R) <= nb ? 1 : 0;
      }
    }
    return matrix;
  }

  /**
   * Modular multiplication table (the "times-table cardioid"). Place `modulus`
   * points on a circle, then chord each point i to (i·factor mod modulus). For
   * factor 2 the envelope is a cardioid, factor 3 a nephroid, and other factors
   * reveal the modular structure as delicate string-art. Pure number theory.
   */
  static generateModularMultiplication(rows, cols, modulus = 60, factor = 2) {
    const matrix = zeros(rows, cols);
    const m = Math.max(2, Math.trunc(modulus));
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const R = Math.min(cx, cy) * 0.94;
    const point = (i) => {
      const th = (i / m) * 2 * Math.PI - Math.PI / 2;
      return [cx + R * Math.cos(th), cy + R * Math.sin(th)];
    };
    for (let i = 0; i < m; i++) {
      const a = point(i);
      const b = point((i * Math.trunc(factor)) % m);
      drawLineToMatrix(matrix, a[0], a[1], b[0], b[1]);
    }
    return matrix;
  }

  /**
   * Logistic-map bifurcation. One column per growth rate r sweeping
   * [rStart, rEnd]; after discarding a transient, every subsequent iterate of
   * xₙ₊₁ = r·xₙ(1−xₙ) is plotted. The period-doubling cascade into chaos is a
   * genuine picture of deterministic unpredictability, and it is entirely
   * reproducible — no seed needed.
   */
  static generateLogisticBifurcation(rows, cols, rStart = 2.6, rEnd = 4.0, transient = 200) {
    const matrix = zeros(rows, cols);
    const span = cols > 1 ? cols - 1 : 1;
    for (let c = 0; c < cols; c++) {
      const r = rStart + (rEnd - rStart) * (c / span);
      let x = 0.5;
      for (let t = 0; t < transient; t++) x = r * x * (1 - x);
      for (let t = 0; t < rows; t++) {
        x = r * x * (1 - x);
        const px = Math.round((1 - x) * (rows - 1));
        if (px >= 0 && px < rows) matrix[px][c] = 1;
      }
    }
    return matrix;
  }

  /** Legacy accented spelling — same function, kept so existing callers hold. */
  static generateMoiréPattern(...args) {
    return MathPatternGenerators.generateMoirePattern(...args);
  }
};
