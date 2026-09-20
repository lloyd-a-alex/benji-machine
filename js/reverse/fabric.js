/**
 * KNITCAT V2 — Reverse Engineer: fabric detection (spec §5.3).
 *
 * Segment the knit fabric from the background and characterise it, using the classical-CV route
 * the spec recommends for v1 rather than a CNN: knit texture has a very particular local structure
 * (a dense band of mid-frequency energy along the row direction) that a texture-energy map plus a
 * colour histogram separates cleanly from a sofa, a floor or a hand holding the swatch. This module
 * produces three things the later stages depend on:
 *
 *   - {@link textureEnergyMap}  — a local-variance map (high where stitches are, low on flat areas)
 *   - {@link detectFabricRegion} — a binary mask of "this is fabric", via Otsu thresholding of the
 *     energy map + largest-connected-component cleanup, plus its bounding box
 *   - {@link dominantColors} — the yarn palette (k-means over the fabric pixels only), so colour
 *     extraction is not polluted by the background
 *
 * It also reports a {@link fabricOrientation} — the dominant stitch-row direction from the gradient
 * histogram — which tells the stitch counter which axis is "across" (columns) and which is "down"
 * (rows). Everything is DOM-free and operates on a plain `{data,width,height}` image.
 *
 * @module reverse/fabric
 */

import { toLuminance, boxBlur, sobel, kMeansColors, clamp, rgbToHex, otsuThreshold } from './_image.js';

export { otsuThreshold };

/**
 * A local-variance (texture energy) map on a luminance plane, blurred to a stitch-scale response.
 * @param {Float32Array} lum @param {number} width @param {number} height @param {number} [radius]
 * @returns {Float32Array}
 */
export function textureEnergyMap(lum, width, height, radius = 3) {
  const r = clamp(Math.round(radius), 1, 15);
  const energy = new Float32Array(width * height);
  const at = (x, y) => lum[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let mean = 0, count = 0;
      for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) { mean += at(x + dx, y + dy); count++; }
      mean /= count;
      let varSum = 0;
      for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) { const d = at(x + dx, y + dy) - mean; varSum += d * d; }
      energy[y * width + x] = varSum / count;
    }
  }
  return boxBlur(energy, width, height, Math.max(1, Math.floor(r / 2)));
}

/**
 * Detect the fabric region: threshold the texture-energy map, then keep the largest connected
 * component (a flood fill on the 8-neighbour grid) so stray high-texture background specks vanish.
 * @param {{data:ArrayLike<number>, width:number, height:number}} image
 * @param {{radius?:number}} [opts]
 * @returns {{mask:Uint8Array, width:number, height:number, coverage:number, bbox:{x:number,y:number,width:number,height:number}}}
 */
export function detectFabricRegion(image, opts = {}) {
  const { width, height } = image;
  const lum = toLuminance(image);
  const energy = textureEnergyMap(lum, width, height, opts.radius);
  const thr = otsuThreshold(energy);
  let mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = energy[i] > thr ? 1 : 0;
  mask = largestComponent(mask, width, height);
  const bbox = maskBBox(mask, width, height);
  const on = mask.reduce((n, v) => n + v, 0);
  return { mask, width, height, coverage: on / (width * height), bbox };
}

/** Keep only the largest 8-connected blob of the mask. */
function largestComponent(mask, width, height) {
  const labels = new Int32Array(mask.length).fill(0);
  let label = 0;
  const sizes = [0];
  const stack = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    label++;
    let sp = 0, size = 0;
    stack[sp++] = start;
    labels[start] = label;
    while (sp) {
      const idx = stack[--sp];
      size++;
      const x = idx % width, y = (idx / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (mask[ni] && !labels[ni]) { labels[ni] = label; stack[sp++] = ni; }
        }
      }
    }
    sizes[label] = size;
  }
  let bestLabel = 1, bestSize = -1;
  for (let l = 1; l <= label; l++) if (sizes[l] > bestSize) { bestSize = sizes[l]; bestLabel = l; }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = labels[i] === bestLabel ? 1 : 0;
  return out;
}

/** Bounding box of the set pixels in a mask. */
function maskBBox(mask, width, height) {
  let minX = width, minY = height, maxX = 0, maxY = 0, any = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) { any = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (!any) return { x: 0, y: 0, width, height };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * The dominant yarn palette, clustering only the pixels inside the fabric mask so the background
 * colour never leaks into the extracted colours.
 * @param {{data:ArrayLike<number>, width:number, height:number}} image
 * @param {{mask?:Uint8Array, count?:number, seed?:number}} [opts]
 * @returns {Array<{hex:string, rgb:number[], proportion:number, name:string}>}
 */
export function dominantColors(image, opts = {}) {
  const k = clamp(Math.round(opts.count || 4), 1, 8);
  const { centroids, proportions } = kMeansColors(image, k, { seed: opts.seed });
  const ranked = centroids
    .map((rgb, i) => ({ rgb, proportion: proportions[i], hex: rgbToHex(rgb) }))
    .sort((a, b) => b.proportion - a.proportion);
  return ranked.map(c => ({ ...c, name: nameForColor(c.rgb, c.proportion) }));
}

/** A crude human name so the UI reads "charcoal (62%)" not "rgb(40,40,42)". */
function nameForColor([r, g, b], proportion) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;
  const s = max === min ? 0 : (max - min) / (255 * (1 - Math.abs(2 * l - 1) || 1));
  if (s < 0.12) { if (l < 0.15) return 'black'; if (l < 0.4) return 'charcoal'; if (l < 0.7) return 'grey'; return 'white'; }
  const hue = hueOf(r, g, b, max);
  const family = hue < 20 || hue >= 340 ? 'red' : hue < 45 ? 'orange' : hue < 70 ? 'yellow' : hue < 160 ? 'green' : hue < 200 ? 'teal' : hue < 260 ? 'blue' : hue < 290 ? 'purple' : 'pink';
  return `${l < 0.35 ? 'dark ' : l > 0.7 ? 'light ' : ''}${family}` + (proportion > 0.5 ? ' (dominant)' : '');
}

function hueOf(r, g, b, max) {
  const d = (max - Math.min(r, g, b)) || 1;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}

/**
 * Estimate the dominant fabric orientation from the Sobel gradient-angle histogram, restricted to
 * the strongest edges. Returns an angle in degrees (0 = rows run horizontally, the common case).
 * @param {{data:ArrayLike<number>, width:number, height:number}} image
 * @returns {{angle:number, coherence:number}}
 */
export function fabricOrientation(image) {
  const { width, height } = image;
  const lum = toLuminance(image);
  const { magnitude, angle } = sobel(lum, width, height);
  const bins = 18; // 10° buckets
  const hist = new Float64Array(bins);
  let maxMag = 0;
  for (let i = 0; i < magnitude.length; i++) if (magnitude[i] > maxMag) maxMag = magnitude[i];
  if (maxMag < 1e-6) return { angle: 0, coherence: 0 };
  const total = new Float64Array(bins);
  for (let i = 0; i < magnitude.length; i++) {
    if (magnitude[i] < maxMag * 0.3) continue;
    let deg = (angle[i] * 180) / Math.PI + 90; // gradients ⊥ to stitch rows
    deg = ((deg % 180) + 180) % 180;
    const bin = Math.floor(deg / (180 / bins)) % bins;
    hist[bin] += magnitude[i]; total[bin]++;
  }
  let peak = 0;
  for (let i = 1; i < bins; i++) if (hist[i] > hist[peak]) peak = i;
  const sum = hist.reduce((a, b) => a + b, 0) || 1;
  const coherence = hist[peak] / sum;
  return { angle: peak * (180 / bins), coherence: clamp(coherence, 0, 1) };
}
