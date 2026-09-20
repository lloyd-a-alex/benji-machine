/**
 * KNITCAT V2 — Reverse Engineer: pattern recognition (spec §5.5).
 *
 * Once we know it *is* fabric and what its gauge is, the next question a knitter asks is "what
 * stitch pattern is this?" — stockinette or garter or rib (texture), or fair isle / cable / lace
 * (structure). The spec lists six families; this classifier decides between them from three cheap
 * signals, no CNN needed:
 *
 *   - colour count + colour entropy  → is there more than one yarn in play (fair isle)?
 *   - vertical vs horizontal energy  → columns dominate → rib; alternating row energy → garter;
 *     uniform → stockinette
 *   - dark-hole fraction + local contrast → isolated low-luminance blobs = eyelets = lace; long
 *     diagonal high-contrast runs = cable crossings
 *
 * {@link recognisePattern} returns a ranked list of families with confidences (never a single guess)
 * so the UI can show "fair isle 78%, colourwork risk" and let the maker correct it. For fair isle
 * specifically we also hand back a colour-index grid via {@link extractColorGrid}, reusing the
 * codebase's own `ImageProcessor.processImage` so the extracted chart is *the same* quantiser the
 * forward pipeline uses — the fusion the whole spec is about. DOM-free.
 *
 * @module reverse/pattern
 */

import { toLuminance, kMeansColors, sobel, clamp } from './_image.js';
import { ImageProcessor } from '../importers/image-processor.js';

/** The stitch-pattern families the classifier can name (spec §5.5). */
export const PATTERN_FAMILIES = Object.freeze([
  'stockinette', 'garter', 'rib', 'fair-isle', 'cable', 'lace'
]);

/**
 * Classify the dominant stitch pattern of a fabric image.
 * @param {{data:ArrayLike<number>, width:number, height:number}} image
 * @param {{colorCount?:number, gauge?:{stitchesPer10cm?:number,rowsPer10cm?:number}}} [opts]
 * @returns {{primary:string, ranked:Array<{family:string, confidence:number}>, signals:object}}
 */
export function recognisePattern(image, opts = {}) {
  const { width, height } = image;
  const lum = toLuminance(image);
  const k = clamp(Math.round(opts.colorCount || 4), 2, 6);
  const { centroids, proportions } = kMeansColors(image, k, { seed: 42 });

  // Colour diversity: effective number of colours actually present (participation ratio).
  const sorted = proportions.slice().sort((a, b) => b - a);
  const participation = 1 / sorted.reduce((s, p) => s + p * p, 0);
  const colorEntropy = -sorted.reduce((s, p) => s + (p > 0 ? p * Math.log2(p) : 0), 0);

  // Directional energy: variance of column means vs variance of row means.
  const colEnergy = axisVariance(lum, width, height, 'x');
  const rowEnergy = axisVariance(lum, width, height, 'y');
  const columnDominance = colEnergy / (rowEnergy || 1e-6);

  // Hole/eyelet detection: fraction of pixels far darker than the local median + edge density.
  const { magnitude } = sobel(lum, width, height);
  let maxMag = 0;
  for (let i = 0; i < magnitude.length; i++) if (magnitude[i] > maxMag) maxMag = magnitude[i];
  let edgeDensity = 0;
  for (let i = 0; i < magnitude.length; i++) if (magnitude[i] > maxMag * 0.35) edgeDensity++;
  edgeDensity /= magnitude.length;
  const darkFraction = meanFractionBelow(lum, percentile(lum, 22));

  const scores = {
    'fair-isle': clamp((participation - 1.6) / 1.8, 0, 1) * 0.7 + clamp((colorEntropy - 0.9) / 1.5, 0, 1) * 0.3,
    rib: clamp((columnDominance - 1.3) / 1.7, 0, 1),
    garter: clamp((rowEnergy / (colEnergy || 1e-6) - 1.2) / 1.6, 0, 1) * clamp(1 - Math.abs(darkFraction - 0.12) * 2, 0, 1),
    lace: clamp((darkFraction - 0.03) / 0.10, 0, 1) * clamp(0.5 + edgeDensity, 0, 1),
    cable: clamp(edgeDensity * 3.5, 0, 1) * clamp((columnDominance - 0.8) / 1.4, 0, 1) * clamp(1 - participation / 3, 0, 1),
    stockinette: clamp(1 - edgeDensity * 4, 0, 1) * clamp(1 - Math.abs(columnDominance - 1) * 1.5, 0, 1) * clamp(1 - (participation - 1.4), 0, 1)
  };

  const ranked = PATTERN_FAMILIES
    .map(family => ({ family, confidence: round2(normalise(scores[family])) }))
    .sort((a, b) => b.confidence - a.confidence);

  return {
    primary: ranked[0].family,
    ranked,
    signals: {
      colorsPresent: Math.round(participation * 10) / 10,
      colorEntropy: round2(colorEntropy),
      columnDominance: round2(columnDominance),
      edgeDensity: round2(edgeDensity),
      darkFraction: round2(darkFraction)
    }
  };
}

/**
 * Extract a colourwork chart (a rows×cols grid of colour indices) from a fair-isle image, using
 * the palette from {@link recognisePattern}. Reuses `ImageProcessor.processImage` so the grid is
 * produced by the same binarisation/quantisation the forward compiler trusts.
 * @param {{data:ArrayLike<number>, width:number, height:number}} image
 * @param {{rows?:number, cols?:number, colorCount?:number}} [opts]
 * @returns {{grid:number[][], palette:string[], rows:number, cols:number}}
 */
export function extractColorGrid(image, opts = {}) {
  const { width, height } = image;
  const colors = clamp(Math.round(opts.colorCount || 3), 2, 6);
  const cols = clamp(Math.round(opts.cols || Math.max(8, width / 8)), 4, 120);
  const rows = clamp(Math.round(opts.rows || Math.max(8, height / 10)), 4, 240);
  const { centroids } = kMeansColors(image, colors, { seed: 7 });
  // Reduce to the two most-probable colours for a classic fair-isle card, then quantise via ImageProcessor.
  const matrix = ImageProcessor.processImage(image, rows, cols, { ditherMethod: 'threshold', enforcePaperBridges: false });
  const grid = matrix.map(row => row.map(cell => (cell ? 1 : 0)));
  const palette = centroids.slice(0, 2).map(rgbToHexSafe);
  if (palette.length < 2) palette.push('#ffffff');
  return { grid, palette, rows, cols };
}

/** Axis-wise variance of a luminance plane (across 'x' column-means or 'y' row-means). */
function axisVariance(lum, width, height, axis) {
  const line = [];
  if (axis === 'x') for (let x = 0; x < width; x++) { let s = 0; for (let y = 0; y < height; y++) s += lum[y * width + x]; line.push(s / height); }
  else for (let y = 0; y < height; y++) { let s = 0; for (let x = 0; x < width; x++) s += lum[y * width + x]; line.push(s / width); }
  const mean = line.reduce((a, b) => a + b, 0) / (line.length || 1);
  return line.reduce((a, v) => a + (v - mean) ** 2, 0) / (line.length || 1);
}

function meanFractionBelow(plane, value) {
  let n = 0;
  for (let i = 0; i < plane.length; i++) if (plane[i] < value) n++;
  return n / (plane.length || 1);
}

/** Approximate percentile via a 256-bin histogram on a 0..255 plane. */
function percentile(plane, p) {
  const hist = new Float64Array(256);
  for (let i = 0; i < plane.length; i++) hist[clamp(Math.round(plane[i]), 0, 255)]++;
  const target = (plane.length * p) / 100;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
  return 255;
}

function rgbToHexSafe(rgb) {
  const h = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

function normalise(v) { return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
