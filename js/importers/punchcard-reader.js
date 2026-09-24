/**
 * KNITCAT — reverse a physical punchcard from a photograph.
 *
 * This is the import counterpart to the CNC / laser *exporters*: those turn a 0/1
 * card into drill holes, this turns a picture of a holey strip of cardstock back
 * into a 0/1 card. A knitter with a shoebox of punched Brother cards can point a
 * phone camera at one, and this module reads the pattern.
 *
 * The pipeline is deliberately built only from arithmetic that a browser photo can
 * survive — a hand-held snapshot is tilted, unevenly lit, and speckled:
 *
 *   1. luminance   — BT.709 grayscale (the same weighting `image-processor.js` uses)
 *   2. threshold    — Otsu's method picks the light/dark split from the histogram,
 *                     so the reader copes with a dim kitchen photo as happily as a
 *                     bright scanner bed
 *   3. binarise     — a mask of candidate hole pixels (holes are light on dark card,
 *                     or dark on light card — `punchedIsLight` picks which)
 *   4. label         — connected-component labelling (BFS, 8-connected) finds every
 *                     blob of hole pixels and its centroid
 *   5. filter        — blobs are rejected for size and for being wire-thin or grossly
 *                     non-square, which kills dust specks and torn edges
 *   6. quantise      — the surviving centres become `{x, y}` hole points and are laid
 *                     onto a lattice by `grid-quantize.holesToMatrix` (the exact same
 *                     routine the DXF and G-code readers use)
 *
 * Nothing here touches the DOM. The caller feeds an `ImageData`-like object
 * (`{ width, height, data: Uint8ClampedArray }`) — which in the browser comes from a
 * canvas, and in `node --test` comes from a hand-built array. That keeps the whole
 * thing unit-testable without a camera.
 *
 * @module importers/punchcard-reader
 */

import { holesToMatrix, estimatePitch } from './grid-quantize.js';
import { logger } from '../core/logging.js';

/** Photo-reading pipeline seam: surface the geometric rejections a user would otherwise never see. */
const log = logger('importers/punchcard-reader');

/** Guardrails so a pathological photo cannot allocate a continent. */
export const MAX_IMAGE_PIXELS = 16 * 1000 * 1000; // 16 MP

/**
 * Convert RGBA pixels to a single Float32 luminance plane using ITU-R BT.709.
 * @param {{width:number, height:number, data:ArrayLike<number>|Uint8ClampedArray}} image
 * @returns {Float32Array} one 0–255 value per pixel
 */
export function luminance(image) {
  const { width, height, data } = image;
  const n = width * height;
  if (n > MAX_IMAGE_PIXELS) {
    throw new RangeError(`A ${width}\u00d7${height} photo is larger than KNITCAT can read from an image.`);
  }
  const out = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    // Alpha is honoured: a transparent pixel is treated as background-white so PNG
    // exports of a card (transparent between holes) still binarise sensibly.
    const a = data[p + 3];
    if (a === 0) {
      out[i] = 255;
      continue;
    }
    out[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  return out;
}

/**
 * Build a 256-bin histogram of an 8-bit intensity plane.
 * @param {Float32Array|ArrayLike<number>} values
 * @param {number} [max=255]
 * @returns {Int32Array}
 */
export function histogram(values, max = 255) {
  const bins = new Int32Array(max + 1);
  for (let i = 0; i < values.length; i++) {
    let v = Math.round(values[i]);
    if (v < 0) v = 0;
    else if (v > max) v = max;
    bins[v]++;
  }
  return bins;
}

/**
 * Otsu's threshold: the split point that maximises the between-class variance of a
 * bimodal histogram. For a photo of a card the two modes are "card" and "hole", so
 * this lands right between them without the user fiddling with a brightness slider.
 * @param {Int32Array|ArrayLike<number>} hist 256-bin histogram
 * @returns {number} threshold in 0..255 (a value <= threshold is the "dark" class)
 */
export function otsuFromHistogram(hist) {
  const total = hist.length ? Array.from(hist).reduce((s, c) => s + c, 0) : 0;
  if (!total) return 127;
  let sum = 0;
  for (let t = 0; t < hist.length; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let threshold = 127;
  for (let t = 0; t < hist.length; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Threshold the whole image in one pass, computing Otsu internally.
 * @param {Float32Array} lum
 * @returns {number} the chosen threshold
 */
export function otsuThreshold(lum) {
  return otsuFromHistogram(histogram(lum));
}

/**
 * Produce a binary mask of "hole" pixels.
 * @param {Float32Array} lum luminance plane
 * @param {number} threshold 0..255
 * @param {{punchedIsLight?:boolean}} [opts] punchedIsLight (default true): holes are
 *   brighter than the card (dark cardstock, light background showing through). When
 *   false, holes are the darker pixels (a light card photographed on a dark bed).
 * @returns {{ mask: Uint8Array }} mask holds 1 for hole pixels, 0 otherwise
 */
export function binarize(lum, threshold, { punchedIsLight = true } = {}) {
  const mask = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) {
    const isHole = punchedIsLight ? lum[i] > threshold : lum[i] <= threshold;
    mask[i] = isHole ? 1 : 0;
  }
  return { mask };
}

// 8-connected neighbour offsets (including diagonals).
const NEIGHBOURS_8 = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1]
];
const NEIGHBOURS_4 = [[0, -1], [-1, 0], [1, 0], [0, 1]];

/**
 * Connected-component labelling over a binary mask with a BFS front. Uses a moving
 * head index instead of `queue.shift()` so the walk is O(pixels), not O(pixels^2) —
 * the same fix that keeps `floodRegion` fast.
 * @param {Uint8Array} mask 1 == foreground
 * @param {number} width
 * @param {number} height
 * @param {{connectivity?:4|8}} [opts]
 * @returns {{ labels: Int32Array, count:number }} labels holds 0 for background and
 *   a 1-based id for foreground pixels; count is the number of components.
 */
export function labelComponents(mask, width, height, { connectivity = 8 } = {}) {
  const labels = new Int32Array(width * height);
  const neighbours = connectivity === 4 ? NEIGHBOURS_4 : NEIGHBOURS_8;
  let count = 0;
  const stack = new Int32Array(width * height); // reuse one buffer as an explicit stack
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1 || labels[start] !== 0) continue;
    count++;
    let top = 0;
    stack[top++] = start;
    labels[start] = count;
    while (top > 0) {
      const idx = stack[--top];
      const cy = (idx / width) | 0;
      const cx = idx - cy * width;
      for (const [dx, dy] of neighbours) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (mask[nIdx] === 1 && labels[nIdx] === 0) {
          labels[nIdx] = count;
          stack[top++] = nIdx;
        }
      }
    }
  }
  return { labels, count };
}

/**
 * Measure every labelled component: area, bounding box, and centroid.
 * @param {Int32Array} labels
 * @param {number} count
 * @param {number} width
 * @returns {Array<{id:number,area:number,cx:number,cy:number,minX:number,maxX:number,minY:number,maxY:number,fill:number,aspect:number}>}
 */
export function componentStats(labels, count, width) {
  const stats = [];
  for (let id = 1; id <= count; id++) {
    stats.push({ id, area: 0, sx: 0, sy: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  }
  for (let idx = 0; idx < labels.length; idx++) {
    const id = labels[idx];
    if (id === 0) continue;
    const s = stats[id - 1];
    const y = (idx / width) | 0;
    const x = idx - y * width;
    s.area++;
    s.sx += x;
    s.sy += y;
    if (x < s.minX) s.minX = x;
    if (x > s.maxX) s.maxX = x;
    if (y < s.minY) s.minY = y;
    if (y > s.maxY) s.maxY = y;
  }
  return stats.map(s => {
    const w = s.maxX - s.minX + 1;
    const h = s.maxY - s.minY + 1;
    const bbox = w * h;
    return {
      id: s.id,
      area: s.area,
      cx: s.sx / s.area,
      cy: s.sy / s.area,
      minX: s.minX,
      maxX: s.maxX,
      minY: s.minY,
      maxY: s.maxY,
      width: w,
      height: h,
      // fill = how much of the bounding box the blob occupies; a punched round hole
      // fills ~0.78 of its box, a dust fleck or a torn sliver fills far less.
      fill: bbox ? s.area / bbox : 0,
      aspect: h ? w / h : 0
    };
  });
}

/**
 * Keep only the blobs that look like punched holes: an area inside [minArea,maxArea],
 * a reasonably square bounding box, and enough fill to be a solid disc rather than a
 * ring of noise or a hairline scratch.
 * @param {ReturnType<typeof componentStats>} stats
 * @param {{minArea?:number, maxArea?:number, minFill?:number, aspectTolerance?:number}} [opts]
 * @returns {Array<{x:number, y:number, area:number}>} hole centres in pixel coordinates
 */
export function filterBlobs(stats, { minArea = 4, maxArea = Infinity, minFill = 0.4, aspectTolerance = 2.6 } = {}) {
  const holes = [];
  for (const s of stats) {
    if (s.area < minArea || s.area > maxArea) continue;
    if (s.fill < minFill) continue;
    const ratio = s.aspect > 1 ? s.aspect : 1 / (s.aspect || 1);
    if (ratio > aspectTolerance) continue;
    holes.push({ x: s.cx, y: s.cy, area: s.area });
  }
  return holes;
}

/**
 * Full read of a punchcard photo into a 0/1 matrix.
 *
 * @param {{width:number, height:number, data:ArrayLike<number>|Uint8ClampedArray}} image
 *   an ImageData-like object
 * @param {object} [opts]
 * @param {boolean} [opts.punchedIsLight=true] holes brighter than card (see binarize)
 * @param {number} [opts.minBlobPx=4] smallest hole area, in pixels
 * @param {number} [opts.maxBlobPx] largest hole area (guards against a huge blown-out
 *   background counting as one giant hole); defaults to a generous fraction of the frame
 * @param {number} [opts.pitchX] column spacing in pixels; estimated from the blobs when omitted
 * @param {number} [opts.pitchY] row spacing in pixels; estimated when omitted
 * @param {number} [opts.maxCells] cell ceiling handed to `holesToMatrix`
 * @param {number} [opts.connectivity=8]
 * @returns {{ok:boolean, matrix?:number[][], rows?:number, cols?:number, holes?:Array, threshold?:number, estimatedPitch?:boolean, warnings?:string[], error?:string}}
 */
export function analyzePunchcard(image, opts = {}) {
  const {
    punchedIsLight = true,
    minBlobPx = 4,
    maxBlobPx,
    pitchX,
    pitchY,
    maxCells,
    connectivity = 8,
    minFill = 0.4,
    aspectTolerance = 2.6
  } = opts;

  const width = image?.width | 0;
  const height = image?.height | 0;
  if (!width || !height || !image?.data) {
    log.warn('analyzePunchcard given a non-image', { width: image?.width, height: image?.height, hasData: !!image?.data });
    return { ok: false, error: 'That does not look like an image KNITCAT can read.', warnings: [] };
  }

  let lum;
  try {
    lum = luminance(image);
  } catch (err) {
    log.logError('luminance conversion failed', err, { context: { width, height } });
    return { ok: false, error: err?.message || String(err), warnings: [] };
  }

  const threshold = otsuThreshold(lum);
  const { mask } = binarize(lum, threshold, { punchedIsLight });
  const { labels, count } = labelComponents(mask, width, height, { connectivity });
  const stats = componentStats(labels, count, width);

  // By default cap the blob size at a fraction of the frame: a real punched hole is a
  // small disc, so anything approaching the whole image is the background bleeding
  // through (e.g. a light card on a dark bed with punchedIsLight left at its default).
  const capPx = maxBlobPx ?? Math.max(minBlobPx * 4, Math.round(width * height * 0.02));
  const holes = filterBlobs(stats, { minArea: minBlobPx, maxArea: capPx, minFill, aspectTolerance });

  const warnings = [];
  if (!holes.length) {
    log.warn('no punched holes found in photo', { width, height, threshold, blobs: count });
    return {
      ok: false,
      error: 'No punched holes were found in this photo. Try better lighting, or flip the "holes are lighter" option.',
      warnings,
      threshold,
      holes: []
    };
  }

  // Report when the geometry looks off — a lone dominant blob almost always means the
  // whole background was classified as a hole.
  const bigBlob = stats.some(s => s.area > width * height * 0.5);
  if (bigBlob && holes.length < 3) {
    warnings.push('Most of the frame was one region; the light/dark reading may be inverted.');
    log.warn('photo likely inverted — one region dominated the frame', { holes: holes.length, threshold });
  }

  let estimatedPitch = false;
  let px = Number.isFinite(pitchX) && pitchX > 0 ? pitchX : 0;
  let py = Number.isFinite(pitchY) && pitchY > 0 ? pitchY : 0;
  if (!px || !py) {
    estimatedPitch = true;
    px = px || estimatePitch(holes.map(h => h.x));
    py = py || estimatePitch(holes.map(h => h.y));
    if (estimatedPitch) warnings.push('Hole spacing was estimated from the photo; nudge the pitch if the grid looks skewed.');
  }

  const quant = holesToMatrix(holes, { pitchX: px, pitchY: py, maxCells });
  if (!quant.ok) {
    log.warn('hole quantisation rejected the photo', { holes: holes.length, error: quant.error });
    return { ok: false, error: quant.error, warnings: [...(quant.warnings || []), ...warnings], holes, threshold };
  }
  if (warnings.length) log.info('punchcard read with advisories', { rows: quant.rows, cols: quant.cols, warnings });
  return {
    ok: true,
    matrix: quant.matrix,
    rows: quant.rows,
    cols: quant.cols,
    holes,
    threshold,
    pitchX: px,
    pitchY: py,
    estimatedPitch,
    warnings: [...(quant.warnings || []), ...warnings]
  };
}
