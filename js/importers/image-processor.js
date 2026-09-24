/**
 * Image Processing, Advanced Dithering & Structural Bridge Integrity Filter
 * 
 * Prepares bitmap imagery for punchcard and CNC punching:
 * 1. Grayscale luminance conversion (ITU-R BT.709 standard)
 * 2. Contrast, gamma, and histogram equalization
 * 3. Floyd-Steinberg, Atkinson, and Bayer ordered dithering
 * 4. Structural Paper Bridge Protection Filter:
 *    Ensures punchcard cardstock does not tear by maintaining minimum paper bridges
 *    between adjacent holes.
 */

import { logger } from '../core/logging.js';

/** Bitmap→punchcard pipeline seam: flag degenerate inputs and unexpected throws. */
const log = logger('importers/image-processor');

export class ImageProcessor {
  /**
   * Processes raw ImageData from Canvas to punchcard binary matrix
   */
  static processImage(imageData, targetRows, targetCols, options = {}) {
    const {
      ditherMethod = 'atkinson', // 'atkinson', 'floyd_steinberg', 'bayer', 'threshold'
      contrast = 1.0,            // 0.2 to 3.0
      brightness = 0.0,          // -1.0 to 1.0
      gamma = 1.0,               // 0.2 to 3.0
      invert = false,
      enforcePaperBridges = true // Prevent card tear-out
    } = options;

    const srcW = imageData?.width;
    const srcH = imageData?.height;
    const data = imageData?.data;

    if (!imageData || !data || !(srcW > 0) || !(srcH > 0) || !(targetRows > 0) || !(targetCols > 0)) {
      log.warn('processImage given an empty image or zero target grid', {
        hasData: !!data, srcW, srcH, targetRows, targetCols,
      });
      return [];
    }

    // 1. Bilinear downsampling to targetCols x targetRows
    const luminanceGrid = new Float32Array(targetRows * targetCols);

    for (let r = 0; r < targetRows; r++) {
      const srcY = (r / targetRows) * srcH;
      const y0 = Math.floor(srcY);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const dy = srcY - y0;

      for (let c = 0; c < targetCols; c++) {
        const srcX = (c / targetCols) * srcW;
        const x0 = Math.floor(srcX);
        const x1 = Math.min(srcW - 1, x0 + 1);
        const dx = srcX - x0;

        // Sample 4 pixels
        const idx00 = (y0 * srcW + x0) * 4;
        const idx10 = (y0 * srcW + x1) * 4;
        const idx01 = (y1 * srcW + x0) * 4;
        const idx11 = (y1 * srcW + x1) * 4;

        // BT.709 Grayscale conversion
        const lum00 = 0.2126 * data[idx00] + 0.7152 * data[idx00 + 1] + 0.0722 * data[idx00 + 2];
        const lum10 = 0.2126 * data[idx10] + 0.7152 * data[idx10 + 1] + 0.0722 * data[idx10 + 2];
        const lum01 = 0.2126 * data[idx01] + 0.7152 * data[idx01 + 1] + 0.0722 * data[idx01 + 2];
        const lum11 = 0.2126 * data[idx11] + 0.7152 * data[idx11 + 1] + 0.0722 * data[idx11 + 2];

        // Bilinear interpolation
        const lumTop = lum00 * (1 - dx) + lum10 * dx;
        const lumBot = lum01 * (1 - dx) + lum11 * dx;
        let lum = (lumTop * (1 - dy) + lumBot * dy) / 255.0;

        // Apply contrast & brightness adjustment
        lum = (lum - 0.5) * contrast + 0.5 + brightness;
        lum = Math.max(0, Math.min(1, lum));

        // Apply gamma
        lum = Math.pow(lum, 1.0 / gamma);

        if (invert) {
          lum = 1.0 - lum;
        }

        luminanceGrid[r * targetCols + c] = lum;
      }
    }

    // 2. Dithering
    let binary = [];
    if (ditherMethod === 'atkinson') {
      binary = this.ditherAtkinson(luminanceGrid, targetRows, targetCols);
    } else if (ditherMethod === 'floyd_steinberg') {
      binary = this.ditherFloydSteinberg(luminanceGrid, targetRows, targetCols);
    } else if (ditherMethod === 'bayer') {
      binary = this.ditherBayer8x8(luminanceGrid, targetRows, targetCols);
    } else {
      binary = this.ditherThreshold(luminanceGrid, targetRows, targetCols);
    }

    // 3. Structural Paper Bridge Protection Filter
    if (enforcePaperBridges) {
      binary = this.applyPaperBridgeProtection(binary, targetRows, targetCols);
    }

    return binary;
  }

  /**
   * Atkinson Dithering: High clarity algorithm ideal for 1-bit mechanical punchcards
   */
  static ditherAtkinson(lumGrid, rows, cols) {
    const buffer = new Float32Array(lumGrid);
    const result = [];

    for (let r = 0; r < rows; r++) {
      result[r] = [];
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const oldVal = buffer[idx];
        const newVal = (oldVal > 0.5) ? 1.0 : 0.0;
        const err = (oldVal - newVal) / 8.0;

        result[r][c] = newVal === 1.0 ? 1 : 0;

        // Distribute 1/8 error to 6 neighbors
        if (c + 1 < cols) buffer[r * cols + (c + 1)] += err;
        if (c + 2 < cols) buffer[r * cols + (c + 2)] += err;
        if (r + 1 < rows) {
          if (c - 1 >= 0) buffer[(r + 1) * cols + (c - 1)] += err;
          buffer[(r + 1) * cols + c] += err;
          if (c + 1 < cols) buffer[(r + 1) * cols + (c + 1)] += err;
        }
        if (r + 2 < rows) {
          buffer[(r + 2) * cols + c] += err;
        }
      }
    }
    return result;
  }

  /**
   * Floyd-Steinberg Dithering
   */
  static ditherFloydSteinberg(lumGrid, rows, cols) {
    const buffer = new Float32Array(lumGrid);
    const result = [];

    for (let r = 0; r < rows; r++) {
      result[r] = [];
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const oldVal = buffer[idx];
        const newVal = (oldVal > 0.5) ? 1.0 : 0.0;
        const err = oldVal - newVal;

        result[r][c] = newVal === 1.0 ? 1 : 0;

        if (c + 1 < cols) buffer[r * cols + (c + 1)] += err * (7 / 16);
        if (r + 1 < rows) {
          if (c - 1 >= 0) buffer[(r + 1) * cols + (c - 1)] += err * (3 / 16);
          buffer[(r + 1) * cols + c] += err * (5 / 16);
          if (c + 1 < cols) buffer[(r + 1) * cols + (c + 1)] += err * (1 / 16);
        }
      }
    }
    return result;
  }

  /**
   * 8x8 Ordered Bayer Dithering
   */
  static ditherBayer8x8(lumGrid, rows, cols) {
    const bayer8 = [
       0, 32,  8, 40,  2, 34, 10, 42,
      48, 16, 56, 24, 50, 18, 58, 26,
      12, 44,  4, 36, 14, 46,  6, 38,
      60, 28, 52, 20, 62, 30, 54, 22,
       3, 35, 11, 43,  1, 33,  9, 41,
      51, 19, 59, 27, 49, 17, 57, 25,
      15, 47,  7, 39, 13, 45,  5, 37,
      63, 31, 55, 23, 61, 29, 53, 21
    ];

    const result = [];
    for (let r = 0; r < rows; r++) {
      result[r] = [];
      for (let c = 0; c < cols; c++) {
        const threshold = (bayer8[(r % 8) * 8 + (c % 8)] + 0.5) / 64.0;
        result[r][c] = (lumGrid[r * cols + c] > threshold) ? 1 : 0;
      }
    }
    return result;
  }

  static ditherThreshold(lumGrid, rows, cols) {
    const result = [];
    for (let r = 0; r < rows; r++) {
      result[r] = [];
      for (let c = 0; c < cols; c++) {
        result[r][c] = (lumGrid[r * cols + c] > 0.5) ? 1 : 0;
      }
    }
    return result;
  }

  /**
   * Paper Bridge Integrity Protection Filter:
   * Prevents full 2x2 or 3x3 solid blocks of punched holes that would cause
   * mechanical paper cardstock punchcards to tear or jam the reading drum.
   */
  static applyPaperBridgeProtection(matrix, rows, cols) {
    const protectedMatrix = matrix.map(row => [...row]);

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        // Check 2x2 solid punch cluster
        if (
          protectedMatrix[r][c] === 1 &&
          protectedMatrix[r + 1][c] === 1 &&
          protectedMatrix[r][c + 1] === 1 &&
          protectedMatrix[r + 1][c + 1] === 1
        ) {
          // Break the continuous hole with a protective checkerboard bridge
          protectedMatrix[r + 1][c + 1] = 0;
        }
      }
    }

    return protectedMatrix;
  }
}
