/**
 * KNITCAT V2 — the Reverse Engineer (spec §5).
 *
 * "Copy this sweater from a photo." This barrel fuses the six analysis stages into one call and
 * re-exports every primitive so the UI and tests can reach in at whatever granularity they need:
 *
 *   photo ─▶ intake (white-balance, square-up, scale) ─▶ fabric detection (region, colours, orientation)
 *        ─▶ stitch counting (2-D FFT → gauge) ─▶ pattern recognition ─▶ silhouette ─▶ construction
 *        ─▶ reconstruct ─▶ KnitScript ─▶ (the whole forward pipeline)
 *
 * {@link reverseEngineer} runs the lot and returns a single structured report — the estimates,
 * their confidences, the extracted chart, the reconstructed `.knit` text, and any warnings — so the
 * caller can render the "what I think this is, and how sure I am" panel and the "load this into a
 * project" button together. It is entirely DOM-free and deterministic: feed it the same
 * `{data,width,height}` twice and you get the same answer, which is what lets the test battery pin
 * a synthetic knit swatch to a known gauge. `analysis.project` optionally round-trips the
 * reconstructed KnitScript back through `Project.fromKnitScript` to prove the loop closes.
 *
 * @module reverse
 */

export { clamp, toLuminance, luma, sobel, hannWindow, fft2dMagnitude, kMeansColors, simplifyPolygon, rgbToHex } from './_image.js';
export { whiteBalance, perspectiveCorrect, crop, rotateQuarter, calibrateScale, meanLuma } from './intake.js';
export { textureEnergyMap, otsuThreshold, detectFabricRegion, dominantColors, fabricOrientation } from './fabric.js';
export { countStitches, countStitchesAuto } from './stitch-count.js';
export { recognisePattern, extractColorGrid, PATTERN_FAMILIES } from './pattern.js';
export { extractSilhouette } from './silhouette.js';
export { inferConstruction, inferFromSilhouette, CONSTRUCTIONS } from './construct.js';
export { reconstruct, estimateMeasurements } from './reconstruct.js';

import { calibrateScale, whiteBalance } from './intake.js';
import { detectFabricRegion, dominantColors } from './fabric.js';
import { countStitches } from './stitch-count.js';
import { recognisePattern, extractColorGrid } from './pattern.js';
import { extractSilhouette } from './silhouette.js';
import { inferFromSilhouette } from './construct.js';
import { reconstruct } from './reconstruct.js';
import { Project } from '../project/project.js';
import { logger } from '../core/logging.js';

const log = logger('reverse');

/**
 * Run the whole reverse pipeline on one image.
 * @param {{data:ArrayLike<number>, width:number, height:number}} image raw photo pixels
 * @param {{
 *   reference?:{realCm:number, pixelSpan:number}, cmPerPixel?:number,
 *   colorCount?:number, whiteBalance?:boolean, name?:string, machine?:string, buildProject?:boolean
 * }} [options]
 * @returns {{scale:object, fabric:object, colors:Array, gauge:object, pattern:object, chart:object, silhouette:object, construction:object, reconstruction:object, warnings:string[], confidence:number, project:object|null}}
 */
export function reverseEngineer(image, options = {}) {
  const warnings = [];
  if (!image || !image.data || !image.width || !image.height) {
    return hardFailure('No valid image supplied to the Reverse Engineer.');
  }

  // 1. Scale — from a reference object, or an explicit cmPerPixel, else a flagged default.
  const scale = options.cmPerPixel
    ? { cmPerPixel: Number(options.cmPerPixel), plausible: true, note: 'Explicit scale supplied.' }
    : calibrateScale(options.reference);
  if (!scale.plausible) warnings.push(scale.note);

  // 2. Intake — optional white balance so colours read true.
  const working = options.whiteBalance === false ? image : whiteBalance(image);

  // 3. Fabric — region mask, coverage, dominant colours, orientation.
  const fabric = detectFabricRegion(working);
  if (fabric.coverage < 0.05) warnings.push('Very little fabric detected — crop to the garment or improve contrast.');
  const colors = dominantColors(working, { mask: fabric.mask, count: options.colorCount || 4 });

  // 4. Stitch count (Fourier). Use the fabric bbox when it is large enough to hold a clean
  //    spectrum; a tiny crop (or a texture-only swatch that segments poorly) falls back to the
  //    whole image so the FFT always has enough samples to lock onto the stitch periodicity.
  const bbox = fabric.bbox || {};
  const cropImage = (bbox.width >= 48 && bbox.height >= 48) ? cropTo(working, bbox) : working;
  const gauge = countStitches(cropImage, { cmPerPixel: scale.cmPerPixel });
  if (gauge.confidence < 0.4) warnings.push(`Gauge confidence low (${Math.round(gauge.confidence * 100)}%): ${gauge.note}`);

  // 5. Pattern + chart.
  const pattern = recognisePattern(cropImage, { colorCount: options.colorCount || 4 });
  const chart = pattern.primary === 'fair-isle' ? extractColorGrid(cropImage, { colorCount: 2 }) : null;

  // 6. Silhouette + construction (on the full garment, not the macro crop).
  const silhouette = extractSilhouette(working, { mask: fabric.mask });
  const construction = inferFromSilhouette(silhouette, { pattern: pattern.primary });

  // 7. Reconstruct → KnitScript.
  const reconstruction = reconstruct(
    { gauge, colors, pattern, silhouette, construction, chart, cmPerPixel: scale.cmPerPixel },
    { name: options.name, machine: options.machine }
  );
  warnings.push(...reconstruction.warnings);

  const confidence = round2(avg([gauge.confidence, construction.confidence, fabric.coverage < 1 ? fabric.coverage : 1, pattern.ranked[0].confidence]));

  let project = null;
  if (options.buildProject) {
    try {
      project = Project.fromKnitScript(reconstruction.knitScript);
    } catch (e) {
      warnings.push(`Could not build a Project from the reconstruction: ${e && e.message ? e.message : e}`);
    }
  }

  // Mirror every reverse-engineering warning into the log so an unsure reading is
  // never silently swallowed by the report panel.
  for (const w of warnings) log.warn(`reverse-engineer: ${w}`, { confidence });

  return { scale, fabric, colors, gauge, pattern, chart, silhouette, construction, reconstruction, warnings, confidence, project };
}

/** Crop an ImageData-shaped object to a bbox (clamped), for macro analysis. */
function cropTo(image, bbox) {
  const { data, width, height } = image;
  const x0 = clampInt(bbox.x, 0, width - 1);
  const y0 = clampInt(bbox.y, 0, height - 1);
  const w = clampInt(bbox.width || (width - x0), 1, width - x0);
  const h = clampInt(bbox.height || (height - y0), 1, height - y0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * width + (x0 + x)) * 4, o = (y * w + x) * 4;
      out[o] = data[s]; out[o + 1] = data[s + 1]; out[o + 2] = data[s + 2]; out[o + 3] = data[s + 3];
    }
  }
  return { data: out, width: w, height: h };
}

function hardFailure(message) {
  return {
    scale: { cmPerPixel: 0, plausible: false, note: message }, fabric: null, colors: [], gauge: { confidence: 0 },
    pattern: { primary: 'unknown', ranked: [], signals: {} }, chart: null, silhouette: null,
    construction: { construction: 'unknown', confidence: 0, ranked: [] }, reconstruction: { knitScript: '', warnings: [message] },
    warnings: [message], confidence: 0, project: null, error: message
  };
}

function clampInt(v, lo, hi) { const n = Math.round(Number(v)); if (!Number.isFinite(n)) return lo; return Math.max(lo, Math.min(hi, n)); }
function avg(arr) { const a = arr.filter(n => Number.isFinite(n)); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
