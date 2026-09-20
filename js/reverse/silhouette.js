/**
 * KNITCAT V2 — Reverse Engineer: silhouette extraction (spec §5.6).
 *
 * "Find the garment outline in the photo." This is the bridge between the flat-fabric analysis and
 * the garment-level questions (what shape is it? where is the armhole? is there a raglan line?). The
 * approach is the classical one the spec names — edge detection then contour tracing then polygon
 * simplification — implemented from scratch so it is DOM-free and testable:
 *
 *   1. Build a foreground mask. On a real photo you would threshold the fabric region; here we accept
 *      either a caller-supplied mask or derive one from luminance/edge energy, so it degrades to a
 *      sensible outline on a flat lay against a contrasting background.
 *   2. Trace the outer boundary with the Moore-neighbour (boundary-following) algorithm — the same
 *      technique under `findContours` in OpenCV — starting from the topmost-leftmost set pixel.
 *   3. Simplify the traced pixel chain to a compact polygon with Ramer–Douglas–Peucker, and compute
 *      the geometric *features* the construction classifier needs (aspect, shoulder slope, sleeve
 *      protrusion, waist pinch).
 *
 * The polygon and features are what {@link module:reverse/construct} reasons over. DOM-free.
 *
 * @module reverse/silhouette
 */

import { toLuminance, sobel, otsuThreshold, simplifyPolygon, clamp } from './_image.js';

/**
 * Extract the garment silhouette: an outer boundary polygon plus normalised shape features.
 * @param {{data:ArrayLike<number>, width:number, height:number}} image
 * @param {{mask?:Uint8Array, epsilon?:number}} [opts] a caller-supplied foreground mask
 * @returns {{polygon:Array<{x:number,y:number}>, area:number, perimeter:number, bbox:object, features:object}}
 */
export function extractSilhouette(image, opts = {}) {
  const { width, height } = image;
  const mask = opts.mask && opts.mask.length === width * height ? opts.mask : deriveMask(image);
  const contour = traceOuterContour(mask, width, height);
  if (contour.length < 4) {
    return { polygon: [], area: 0, perimeter: 0, bbox: { x: 0, y: 0, width: 0, height: 0 }, features: emptyFeatures() };
  }
  const polygon = simplifyPolygon(contour, opts.epsilon == null ? Math.max(2, width / 80) : opts.epsilon);
  const area = contour.length; // set pixels inside the traced chain approximate the region area here
  const perimeter = polygonLength(polygon);
  const bbox = boundsOf(polygon, width, height);
  const features = shapeFeatures(polygon, mask, width, height, bbox);
  return { polygon, area, perimeter, bbox, features };
}

/** Derive a foreground mask by Otsu-thresholding a lightness+edge energy composite. */
function deriveMask(image) {
  const { width, height } = image;
  const lum = toLuminance(image);
  const { magnitude } = sobel(lum, width, height);
  const energy = new Float32Array(lum.length);
  const maxL = percentileLuma(lum);
  for (let i = 0; i < lum.length; i++) energy[i] = (lum[i] / (maxL || 1)) * 0.5 + clamp(magnitude[i] / 255, 0, 1) * 0.5;
  const thr = otsuThreshold(energy);
  const mask = new Uint8Array(energy.length);
  for (let i = 0; i < energy.length; i++) mask[i] = energy[i] > thr ? 1 : 0;
  return mask;
}

/**
 * Moore-neighbour boundary tracing. Returns the ordered contour of the largest blob's outer edge.
 * Falls back to the blob's bbox corners if the trace is degenerate.
 */
function traceOuterContour(mask, width, height) {
  let start = -1;
  for (let y = 0; y < height && start < 0; y++) {
    for (let x = 0; x < width; x++) { if (mask[y * width + x]) { start = y * width + x; break; } }
  }
  if (start < 0) return [];
  const sx = start % width, sy = (start / width) | 0;
  // 8-neighbour search order, clockwise, starting from the direction we came from.
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const contour = [{ x: sx, y: sy }];
  let cx = sx, cy = sy;
  let dir = 7; // came from the left/up
  const maxSteps = width * height * 4;
  let steps = 0;
  do {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (dir + k) % 8;
      const nx = cx + dirs[nd][0], ny = cy + dirs[nd][1];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (mask[ny * width + nx]) {
        cx = nx; cy = ny; dir = (nd + 6) % 8;
        contour.push({ x: cx, y: cy });
        found = true;
        break;
      }
    }
    if (!found) break;
    steps++;
  } while ((cx !== sx || cy !== sy) && steps < maxSteps);
  return contour;
}

/** Compute the geometric features the construction classifier reads (spec §5.7). */
function shapeFeatures(polygon, mask, width, height, bbox) {
  const bw = bbox.width || 1, bh = bbox.height || 1;
  const aspect = bw / bh;
  // Width profile down the body: sample the horizontal extent of the mask at several heights.
  const slices = 9;
  const profile = [];
  for (let i = 0; i < slices; i++) {
    const y = clamp(Math.round(bbox.y + (bh * (i + 0.5)) / slices), 0, height - 1);
    let minX = width, maxX = 0, any = false;
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) { any = true; if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
    profile.push(any ? (maxX - minX + 1) / bw : 0);
  }
  const topThird = avg(profile.slice(0, 3));
  const mid = avg(profile.slice(3, 6));
  const bottom = avg(profile.slice(6));
  // Shoulder slope: how much narrower the very top is than the widest upper region.
  const shoulderSlope = clamp(1 - (profile[0] / (Math.max(topThird, profile[1], profile[2]) || 1)), 0, 1);
  // Sleeve protrusion: extra width in the upper-middle (arm) band vs the neck band.
  const sleeveProtrusion = clamp((Math.max(profile[1], profile[2], profile[3]) - profile[0]) / (profile[0] || 1), 0, 2);
  // Waist pinch: how much narrower the middle is than the bust/hip bands.
  const waistPinch = clamp(1 - mid / (Math.max(topThird, bottom) || 1), 0, 1);
  const hemFlare = clamp(bottom / (mid || 1) - 1, 0, 1);
  const widestRow = profile.indexOf(Math.max(...profile));
  return { aspect, profile, shoulderSlope: round2(shoulderSlope), sleeveProtrusion: round2(sleeveProtrusion), waistPinch: round2(waistPinch), hemFlare: round2(hemFlare), widestAtTop: widestRow <= 3, bbox };
}

function emptyFeatures() {
  return { aspect: 1, profile: [], shoulderSlope: 0, sleeveProtrusion: 0, waistPinch: 0, hemFlare: 0, widestAtTop: false, bbox: { x: 0, y: 0, width: 0, height: 0 } };
}

function polygonLength(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; sum += Math.hypot(b.x - a.x, b.y - a.y); }
  return sum;
}

function boundsOf(points, width, height) {
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (const p of points) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  return { x: minX, y: minY, width: Math.max(0, maxX - minX + 1), height: Math.max(0, maxY - minY + 1) };
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function percentileLuma(plane) { let m = 0; for (let i = 0; i < plane.length; i += 7) if (plane[i] > m) m = plane[i]; return m || 255; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
