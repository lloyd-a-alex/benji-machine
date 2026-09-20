/**
 * KNITCAT V2 — Reverse Engineer: photo intake (spec §5.2 "intake", §5.3 pre-steps).
 *
 * Before any analysis can happen the photo has to be *made honest*: a sweater photographed at an
 * angle is not the same as one shot square, and a knit shot under a warm lamp has a colour cast
 * that would fool the colour extractor. This stage does the three cheap classical-CV corrections
 * the spec asks for, all pure functions over a plain `ImageData` object (no canvas, no DOM):
 *
 *   1. {@link whiteBalance} — a grey-world cast removal so downstream colour clustering sees the
 *      real yarn colours, not the room's bulbs.
 *   2. {@link perspectiveCorrect} — a bilinear-invert homography given four source corners, so a
 *      shot taken at an angle is squared up before we count stitches along its axes.
 *   3. {@link calibrateScale} — turn a reference object (a coin, an A4 edge, a ruler) the user
 *      measured in pixels into a single `cmPerPixel` value that every size/gauge read-out uses.
 *
 * Everything returns a fresh `{data,width,height}` ImageData-shaped object; inputs are never
 * mutated. The whole module is deterministic so the test battery can feed a known pattern through
 * it and get a known answer.
 *
 * @module reverse/intake
 */

import { clamp, luma } from './_image.js';

/**
 * @typedef {{data:Uint8ClampedArray|ArrayLike<number>, width:number, height:number}} ImageDataLike
 */

/**
 * Grey-world white balance: scale each channel so its mean matches the overall mean luma. A knitted
 * swatch is mostly one yarn colour, so a strong cast visibly skews the histogram this corrects.
 * @param {ImageDataLike} image @param {{strength?:number}} [opts] 0..1 blend toward neutral
 * @returns {ImageDataLike} a new white-balanced image
 */
export function whiteBalance(image, opts = {}) {
  const { data, width, height } = image;
  const strength = clamp(opts.strength == null ? 1 : opts.strength, 0, 1);
  const n = width * height;
  let sr = 0, sg = 0, sb = 0;
  for (let p = 0; p < data.length; p += 4) { sr += data[p]; sg += data[p + 1]; sb += data[p + 2]; }
  sr /= n; sg /= n; sb /= n;
  const gray = (sr + sg + sb) / 3;
  const scaleR = lerp(1, gray / (sr || 1), strength);
  const scaleG = lerp(1, gray / (sg || 1), strength);
  const scaleB = lerp(1, gray / (sb || 1), strength);
  const out = new Uint8ClampedArray(data.length);
  for (let p = 0; p < data.length; p += 4) {
    out[p] = clamp(data[p] * scaleR, 0, 255);
    out[p + 1] = clamp(data[p + 1] * scaleG, 0, 255);
    out[p + 2] = clamp(data[p + 2] * scaleB, 0, 255);
    out[p + 3] = data[p + 3];
  }
  return { data: out, width, height };
}

/**
 * Perspective-correct an image given its four source corners (top-left, top-right, bottom-right,
 * bottom-left) in the input image, remapped to a rectangle of `outWidth × outHeight`. Uses the
 * inverse homography + bilinear sampling. This is the "make the sweater square" step.
 * @param {ImageDataLike} image
 * @param {Array<{x:number,y:number}>} srcCorners four corners in input space
 * @param {{outWidth?:number, outHeight?:number}} [size]
 * @returns {ImageDataLike}
 */
export function perspectiveCorrect(image, srcCorners, size = {}) {
  const { data, width, height } = image;
  const c = normaliseCorners(srcCorners);
  const outWidth = Math.max(2, Math.round(size.outWidth || width));
  const outHeight = Math.max(2, Math.round(size.outHeight || height));
  const dst = [
    { x: 0, y: 0 }, { x: outWidth, y: 0 },
    { x: outWidth, y: outHeight }, { x: 0, y: outHeight }
  ];
  const H = computeHomography(dst, c); // maps output → input
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      const w = H[6] * ox + H[7] * oy + H[8];
      const sx = (H[0] * ox + H[1] * oy + H[2]) / (w || 1);
      const sy = (H[3] * ox + H[4] * oy + H[5]) / (w || 1);
      const o = (oy * outWidth + ox) * 4;
      sampleBilinear(data, width, height, sx, sy, out, o);
    }
  }
  return { data: out, width: outWidth, height: outHeight };
}

/**
 * Crop a rectangle out of an image (integer, clamped to bounds).
 * @param {ImageDataLike} image @param {{x:number,y:number,width:number,height:number}} rect
 * @returns {ImageDataLike}
 */
export function crop(image, rect) {
  const { data, width, height } = image;
  const x0 = clamp(Math.round(rect.x || 0), 0, width);
  const y0 = clamp(Math.round(rect.y || 0), 0, height);
  const w = clamp(Math.round(rect.width || width), 1, width - x0);
  const h = clamp(Math.round(rect.height || height), 1, height - y0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * width + (x0 + x)) * 4;
      const o = (y * w + x) * 4;
      out[o] = data[s]; out[o + 1] = data[s + 1]; out[o + 2] = data[s + 2]; out[o + 3] = data[s + 3];
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Derive a physical scale from a reference object the user annotated: they know the object is
 * `realCm` centimetres wide and it spans `pixelSpan` pixels. Returns cm-per-pixel plus a sanity
 * guard (a knit macro is ~0.05–2 mm/px; a full garment ~1–10 mm/px).
 * @param {{realCm:number, pixelSpan:number}} reference
 * @returns {{cmPerPixel:number, mmPerPixel:number, plausible:boolean, note:string}}
 */
export function calibrateScale(reference) {
  const realCm = Number(reference && reference.realCm) || 0;
  const pixelSpan = Number(reference && reference.pixelSpan) || 0;
  if (realCm <= 0 || pixelSpan <= 0) {
    return { cmPerPixel: 0.1, mmPerPixel: 1, plausible: false, note: 'No valid reference; assuming 0.1 cm/px — confirm scale before trusting gauge.' };
  }
  const cmPerPixel = realCm / pixelSpan;
  const mmPerPixel = cmPerPixel * 10;
  const plausible = mmPerPixel >= 0.02 && mmPerPixel <= 20;
  return { cmPerPixel, mmPerPixel, plausible, note: plausible ? `${realCm} cm over ${pixelSpan} px = ${round3(mmPerPixel)} mm/px.` : 'Reference gives an implausible scale — re-measure the reference object.' };
}

/**
 * Rotate an image by 90° increments (for EXIF orientation fixes). `q` is quarter-turns clockwise.
 * @param {ImageDataLike} image @param {number} q
 * @returns {ImageDataLike}
 */
export function rotateQuarter(image, q) {
  const { data, width, height } = image;
  const turns = ((q % 4) + 4) % 4;
  if (turns === 0) return { data: Uint8ClampedArray.from(data), width, height };
  const outW = turns % 2 ? height : width;
  const outH = turns % 2 ? width : height;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nx, ny;
      if (turns === 1) { nx = height - 1 - y; ny = x; }
      else if (turns === 2) { nx = width - 1 - x; ny = height - 1 - y; }
      else { nx = y; ny = width - 1 - x; }
      const s = (y * width + x) * 4, o = (ny * outW + nx) * 4;
      out[o] = data[s]; out[o + 1] = data[s + 1]; out[o + 2] = data[s + 2]; out[o + 3] = data[s + 3];
    }
  }
  return { data: out, width: outW, height: outH };
}

/** Compute an 8-free 3×3 homography mapping `src` quad → `dst` quad (row-major, 9 entries). */
function computeHomography(src, dst) {
  // Build the 8×8 linear system for h1..h8 (h9 = 1).
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x: X, y: Y } = dst[i];
    const { x: u, y: v } = src[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
  }
  const h = solveLinear(A, b);
  if (!h) return [1, 0, 0, 0, 1, 0, 0, 0, 1]; // degenerate → identity
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Solve A·x = b by Gaussian elimination with partial pivoting (8×8 max here). */
function solveLinear(A, bVec) {
  const n = bVec.length;
  const M = A.map((row, i) => row.concat(bVec[i]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-9) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Bilinear sample a source pixel into the output buffer at `o`. */
function sampleBilinear(data, width, height, sx, sy, out, o) {
  if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1) { out[o + 3] = 0; return; }
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = sx - x0, fy = sy - y0;
  for (let ch = 0; ch < 4; ch++) {
    const tl = data[(y0 * width + x0) * 4 + ch], tr = data[(y0 * width + x1) * 4 + ch];
    const bl = data[(y1 * width + x0) * 4 + ch], br = data[(y1 * width + x1) * 4 + ch];
    out[o + ch] = clamp(lerp(lerp(tl, tr, fx), lerp(bl, br, fx), fy), 0, 255);
  }
}

/** Re-order arbitrary four supplied corners into TL,TR,BR,BL by centroid angle. */
function normaliseCorners(corners) {
  const list = (corners || []).slice(0, 4).map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
  while (list.length < 4) list.push({ x: 0, y: 0 });
  const cx = list.reduce((s, p) => s + p.x, 0) / 4;
  const cy = list.reduce((s, p) => s + p.y, 0) / 4;
  const withAngle = list.map(p => ({ ...p, a: Math.atan2(p.y - cy, p.x - cx) }));
  // TL is topmost-leftmost, BR bottommost-rightmost; TR/BL by y.
  const sorted = withAngle.slice().sort((p, q) => p.x - q.x);
  const left = sorted.slice(0, 2).sort((p, q) => p.y - q.y);
  const right = sorted.slice(2).sort((p, q) => p.y - q.y);
  return [{ x: left[0].x, y: left[0].y }, { x: right[0].x, y: right[0].y }, { x: right[1].x, y: right[1].y }, { x: left[1].x, y: left[1].y }];
}

function lerp(a, b, t) { return a + (b - a) * t; }
function round3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

/** Convenience: the luma of the whole image mean, handy for an exposure warning in the UI. */
export function meanLuma(image) {
  const { data, width, height } = image;
  const n = width * height;
  let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) sum += luma(data[p], data[p + 1], data[p + 2]);
  return sum / (n || 1);
}
