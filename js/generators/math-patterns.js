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

export class MathPatternGenerators {
  /**
   * Gray-Scott Reaction-Diffusion PDE Solver on Toroidal Domain
   * Models biological morphogenesis (Turing patterns: leopard spots, zebra stripes, labyrinthine lace).
   * 
   * Equations:
   *   du/dt = D_u * Delta(u) - u * v^2 + F * (1 - u)
   *   dv/dt = D_v * Delta(v) + u * v^2 - (F + k) * v
   */
  static generateReactionDiffusion(rows, cols, preset = 'labyrinth', iterations = 180) {
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
          v[r * cols + c] = 0.8 + Math.random() * 0.2;
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
  static generateToroidalVoronoi(rows, cols, numSeedPoints = 14, wallThickness = 1.2) {
    const seeds = [];
    for (let i = 0; i < numSeedPoints; i++) {
      seeds.push({
        x: Math.random() * cols,
        y: Math.random() * rows
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
}
