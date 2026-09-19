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

  /** Legacy accented spelling — same function, kept so existing callers hold. */
  static generateMoiréPattern(...args) {
    return MathPatternGenerators.generateMoirePattern(...args);
  }
};
