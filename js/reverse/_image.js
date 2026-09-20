/**
 * KNITCAT V2 — Reverse Engineer: shared image primitives (spec §5).
 *
 * Every stage of the reverse pipeline (intake, fabric detection, stitch counting, pattern
 * recognition, silhouette extraction) needs the same handful of *pure* image operations, and none
 * of them may touch the DOM — the whole system has to run headless under Node so the test battery
 * can feed it synthetic `ImageData` (`{data: Uint8ClampedArray RGBA, width, height}`) and assert on
 * the maths. This module is that shared foundation. It deliberately re-implements a small, fast,
 * allocation-light set of kernels rather than depending on the browser canvas:
 *
 *   - pixel access + grayscale/luminance (Rec. 709, matching the colour engine)
 *   - separable box / Gaussian blur, Sobel gradient + gradient direction
 *   - a Hann window and 2-D down-sampling (for the FFT stitch counter)
 *   - k-means colour clustering (dominant-colour extraction, done in RGB for speed)
 *   - Ramer–Douglas–Peucker polygon simplification (for the silhouette)
 *   - a radix-2 iterative Cooley–Tukey FFT and a 2-D magnitude spectrum
 *
 * The FFT lives here because both the stitch counter (periodicity) and the texture-energy /
 * orientation analysis (fabric direction) want it. DOM-free, pure, deterministic given a seed.
 *
 * @module reverse/_image
 */

/** Clamp helper used everywhere. */
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Rec. 709 luma of an already-decoded pixel, in 0..255. */
export function luma(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

/**
 * Convert an RGBA `ImageData` into a Float32 luminance plane (0..255).
 * Accepts either a real `{data,width,height}` or a plain `{data:number[]}` object.
 * @param {{data:ArrayLike<number>, width:number, height:number}} image
 * @returns {Float32Array}
 */
export function toLuminance(image) {
  const { data, width, height } = image;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = luma(data[p] || 0, data[p + 1] || 0, data[p + 2] || 0);
  }
  return out;
}

/**
 * Read an RGBA pixel as `[r,g,b,a]` (values 0..255).
 * @param {{data:ArrayLike<number>}} image @param {number} x @param {number} y
 */
export function pixel(image, x, y) {
  const p = (y * image.width + x) * 4;
  const d = image.data;
  return [d[p] || 0, d[p + 1] || 0, d[p + 2] || 0, d[p + 3] || 0];
}

/**
 * Separable box blur on a single Float32 plane. Returns a new plane.
 * @param {Float32Array} src @param {number} width @param {number} height @param {number} radius
 */
export function boxBlur(src, width, height, radius) {
  const r = Math.max(1, Math.floor(radius));
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const span = r * 2 + 1;
  for (let y = 0; y < height; y++) {
    let acc = 0;
    const row = y * width;
    for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, width - 1)];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = acc / span;
      acc -= src[row + clamp(x - r, 0, width - 1)];
      acc += src[row + clamp(x + r + 1, 0, width - 1)];
    }
  }
  for (let x = 0; x < width; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y++) {
      dst[y * width + x] = acc / span;
      acc -= tmp[clamp(y - r, 0, height - 1) * width + x];
      acc += tmp[clamp(y + r + 1, 0, height - 1) * width + x];
    }
  }
  return dst;
}

/**
 * Sobel gradient magnitude + direction on a luminance plane.
 * @returns {{magnitude:Float32Array, angle:Float32Array}}
 */
export function sobel(src, width, height) {
  const magnitude = new Float32Array(width * height);
  const angle = new Float32Array(width * height);
  const at = (x, y) => src[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const i = y * width + x;
      magnitude[i] = Math.hypot(gx, gy);
      angle[i] = Math.atan2(gy, gx);
    }
  }
  return { magnitude, angle };
}

/** A Hann (raised-cosine) window of length n, used to taper the FFT input and tame edge leakage. */
export function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1 || 1)));
  return w;
}

/**
 * Down-sample a plane to the largest power-of-two square that fits, averaging boxes. The FFT
 * wants a power-of-two side length, and averaging preserves the periodicity we are measuring.
 * @returns {{plane:Float32Array, size:number, scale:number}}
 */
export function toPowerOfTwoSquare(src, width, height) {
  const size = prevPow2(Math.min(width, height));
  const sx = width / size;
  const sy = height / size;
  const plane = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const srcX = Math.floor(x * sx);
      const srcY = Math.floor(y * sy);
      plane[y * size + x] = src[srcY * width + srcX] || 0;
    }
  }
  return { plane, size, scale: sx };
}

/**
 * Otsu's threshold on a Float32 plane (256-bin histogram over the min/max range). Shared by the
 * fabric detector and the silhouette mask builder.
 * @param {Float32Array|ArrayLike<number>} plane @returns {number} the threshold value
 */
export function otsuThreshold(plane) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < plane.length; i++) { if (plane[i] < min) min = plane[i]; if (plane[i] > max) max = plane[i]; }
  if (max - min < 1e-9) return min;
  const bins = 256;
  const hist = new Float64Array(bins);
  const scale = (bins - 1) / (max - min);
  for (let i = 0; i < plane.length; i++) hist[Math.round((plane[i] - min) * scale)]++;
  const total = plane.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, bestT = 0, bestVar = -1;
  for (let t = 0; t < bins; t++) {
    wB += hist[t]; if (wB === 0) continue;
    const wF = total - wB; if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; bestT = t; }
  }
  return min + bestT / scale;
}

/** Largest power of two ≤ n (min 8). */
export function prevPow2(n) { let p = 8; while (p * 2 <= n) p *= 2; return p; }

/**
 * In-place iterative radix-2 Cooley–Tukey FFT on interleaved re/im arrays of length `n` (power of two).
 * @param {Float32Array|Array<number>} re @param {Float32Array|Array<number>} im @param {number} n
 */
export function fft1d(re, im, n) {
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi;
        const vi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr; cwr = nwr;
      }
    }
  }
}

/**
 * 2-D FFT of a real `size × size` plane (size a power of two), returning a magnitude spectrum
 * with the DC term shifted to the centre for easy peak-picking.
 * @param {Float32Array} plane @param {number} size
 * @returns {{magnitude:Float64Array, size:number}}
 */
export function fft2dMagnitude(plane, size) {
  const re = new Float64Array(size * size);
  const im = new Float64Array(size * size);
  for (let i = 0; i < plane.length; i++) re[i] = plane[i];
  // Transform rows.
  const rowR = new Float64Array(size);
  const rowI = new Float64Array(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) { rowR[x] = re[y * size + x]; rowI[x] = im[y * size + x]; }
    fft1d(rowR, rowI, size);
    for (let x = 0; x < size; x++) { re[y * size + x] = rowR[x]; im[y * size + x] = rowI[x]; }
  }
  // Transform columns.
  const colR = new Float64Array(size);
  const colI = new Float64Array(size);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) { colR[y] = re[y * size + x]; colI[y] = im[y * size + x]; }
    fft1d(colR, colI, size);
    for (let y = 0; y < size; y++) { re[y * size + x] = colR[y]; im[y * size + x] = colI[y]; }
  }
  // Magnitude, centred (quadrant swap).
  const mag = new Float64Array(size * size);
  const half = size >> 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cy = (y + half) % size, cx = (x + half) % size;
      mag[y * size + x] = Math.hypot(re[cy * size + cx], im[cy * size + cx]);
    }
  }
  return { magnitude: mag, size };
}

/**
 * k-means colour clustering over the RGBA pixels (RGB space, seeded, capped iterations).
 * @param {{data:ArrayLike<number>, width:number, height:number}} image
 * @param {number} k @param {{iterations?:number, seed?:number}} [opts]
 * @returns {{centroids:Array<[number,number,number]>, counts:number[], assignments:Int32Array, proportions:number[]}}
 */
export function kMeansColors(image, k = 4, opts = {}) {
  const { data, width, height } = image;
  const iterations = opts.iterations || 12;
  const rand = mulberry32(opts.seed || 1234567);
  const n = width * height;
  const kk = clamp(k, 1, 12);
  // Seed centroids by random pixel picks.
  const centroids = [];
  for (let c = 0; c < kk; c++) {
    const p = Math.floor(rand() * n) * 4;
    centroids.push([data[p] || 0, data[p + 1] || 0, data[p + 2] || 0]);
  }
  const assignments = new Int32Array(n);
  for (let it = 0; it < iterations; it++) {
    const sums = Array.from({ length: kk }, () => [0, 0, 0, 0]);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const d = (r - centroids[c][0]) ** 2 + (g - centroids[c][1]) ** 2 + (b - centroids[c][2]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      assignments[i] = best;
      const s = sums[best]; s[0] += r; s[1] += g; s[2] += b; s[3]++;
    }
    for (let c = 0; c < kk; c++) {
      const s = sums[c];
      if (s[3] > 0) centroids[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    }
  }
  const counts = new Array(kk).fill(0);
  for (let i = 0; i < n; i++) counts[assignments[i]]++;
  const proportions = counts.map(c => c / n);
  return { centroids, counts, assignments, proportions };
}

/**
 * Ramer–Douglas–Peucker polyline simplification.
 * @param {Array<{x:number,y:number}>} points @param {number} epsilon in pixels
 * @returns {Array<{x:number,y:number}>}
 */
export function simplifyPolygon(points, epsilon = 2) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = -1, index = -1;
    const a = points[first], b = points[last];
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i], a, b);
      if (d > maxD) { maxD = d; index = i; }
    }
    if (maxD > epsilon && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function perpendicularDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/** Deterministic 32-bit PRNG so clustering/analysis are reproducible in tests. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Encode an RGB triple as a `#rrggbb` hex string. */
export function rgbToHex([r, g, b]) {
  const h = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
