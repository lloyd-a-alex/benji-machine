/**
 * KNITCAT V2 — Reverse Engineer: stitch counting via the Fourier route (spec §5.4, §11.5).
 *
 * The single hardest step in "copy this sweater from a photo": given a picture of knit fabric, how
 * many stitches per centimetre is it? Knit is *periodic* — a row of V-shapes repeats at a fixed
 * pitch, and stacked rows repeat vertically — so its 2-D Fourier transform has bright peaks off the
 * DC corner whose spatial frequency *is* the stitch spacing. This implements "Approach 1: Fourier"
 * the spec recommends for v1, exactly to the §11.5 shape, plus a self-contained autocorrelation
 * fallback for images too small or too noisy for a clean spectral peak.
 *
 * The maths (Hann window → 2-D FFT → centred power spectrum → off-DC peak pick → frequency to
 * spacing → spacing × cmPerPixel → gauge) lives in {@link countStitches}; {@link countStitchesAuto}
 * is the spatial-domain cross-check. Both return a *confidence* so the UI can honestly say "I am
 * not sure — tell me your reference scale" rather than fabricating a number. DOM-free; the FFT and
 * window come from `./_image.js`.
 *
 * @module reverse/stitch-count
 */

import { toLuminance, hannWindow, toPowerOfTwoSquare, fft2dMagnitude, clamp } from './_image.js';

/**
 * Count stitches from a fabric image via a 2-D FFT.
 * @param {{data:ArrayLike<number>, width:number, height:number}} image
 * @param {{cmPerPixel?:number, orientationDeg?:number, minStsPer10cm?:number, maxStsPer10cm?:number}} [options]
 * @returns {{gauge:{stitchesPer10cm:number,rowsPer10cm:number}, spacing:{x:number,y:number}, confidence:number, method:string, peak:{fx:number,fy:number}, note:string}}
 */
export function countStitches(image, options = {}) {
  const { width, height } = image;
  const cmPerPixel = Number(options.cmPerPixel) || 0;
  const minSts = Number(options.minStsPer10cm) || 4;
  const maxSts = Number(options.maxStsPer10cm) || 60;

  const lum = toLuminance(image);
  const { plane, size } = toPowerOfTwoSquare(lum, width, height);
  if (size < 16) return fallback(image, options, 'image too small for a reliable FFT');

  // Taper with a separable Hann window to suppress the edge step that otherwise floods the spectrum.
  const w = hannWindow(size);
  const windowed = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) windowed[y * size + x] = plane[y * size + x] * w[x] * w[y];
  }

  const { magnitude } = fft2dMagnitude(windowed, size);
  const center = size >> 1;
  const peak = findSpectralPeak(magnitude, size, center, minSts, maxSts, cmPerPixel, size / (width || 1));

  if (!peak || peak.power <= 0) return fallback(image, options, 'no dominant periodicity found');

  // Frequency index (distance from the centred DC) → cycles across the analysed square → px/stitch.
  const cyclesX = Math.max(1, peak.fx);
  const cyclesY = Math.max(1, peak.fy);
  // Undo the down-sampling: `size` samples represent `width`/`height` original px.
  const pxPerSampleX = width / size;
  const pxPerSampleY = height / size;
  const spacingX = (size / cyclesX) * pxPerSampleX;
  const spacingY = (size / cyclesY) * pxPerSampleY;

  const cpp = cmPerPixel || 0.1;
  const stsPer10cm = clamp(10 / (spacingX * cpp), 0, 200);
  const rowsPer10cm = clamp(10 / (spacingY * cpp), 0, 260);
  const ratio = rowsPer10cm / (stsPer10cm || 1);
  const confidence = clamp(peak.sharpness * (ratio > 0.7 && ratio < 2.8 ? 1 : 0.5), 0, 1);

  const note = cmPerPixel
    ? `Peak at ${cyclesX}×${cyclesY} cycles → ${round2(spacingX)}×${round2(spacingY)} px/stitch → ${round1(stsPer10cm)}×${round1(rowsPer10cm)} / 10 cm.`
    : 'Gauge in stitches-per-image-width; supply a reference object (cmPerPixel) to convert to cm.';

  return {
    gauge: { stitchesPer10cm: round1(stsPer10cm), rowsPer10cm: round1(rowsPer10cm) },
    spacing: { x: round2(spacingX), y: round2(spacingY) },
    confidence: round2(confidence),
    method: 'fourier',
    peak: { fx: cyclesX, fy: cyclesY },
    note
  };
}

/**
 * Pick the strongest off-DC spectral peak within the plausible stitch-frequency band. Skips the DC
 * blob (a radius around the centre) and the very lowest frequencies (whole-image gradients).
 * @returns {{fx:number, fy:number, power:number, sharpness:number}|null}
 */
function findSpectralPeak(magnitude, size, center, minSts, maxSts, cmPerPixel, pxPerSample) {
  const dcRadius = 2;
  let best = null;
  let totalPower = 0;
  const lowFreq = 3; // ignore everything nearer the centre than this
  for (let y = dcRadius; y < size - dcRadius; y++) {
    for (let x = dcRadius; x < size - dcRadius; x++) {
      const cx = x - center, cy = y - center;
      const radius = Math.hypot(cx, cy);
      if (radius < lowFreq || radius > size / 2) continue;
      // Only consider frequencies that map to a plausible stitch count.
      if (cmPerPixel > 0) {
        const spacingPx = size / radius / (pxPerSample || 1);
        const sts = 10 / (spacingPx * cmPerPixel);
        if (sts < minSts * 0.6 || sts > maxSts * 1.6) continue;
      }
      const power = magnitude[y * size + x];
      totalPower += power;
      if (!best || power > best.power) best = { x, y, cx, cy, radius, power };
    }
  }
  if (!best) return null;
  // Sharpness = how much the peak towers over the mean spectrum energy in-band.
  const mean = totalPower / Math.max(1, (size - 2 * dcRadius) * (size - 2 * dcRadius));
  const sharpness = clamp((best.power / (mean || 1) - 1) / 9, 0.05, 1);
  return { fx: Math.abs(best.cx) || 1, fy: Math.abs(best.cy) || 1, power: best.power, sharpness };
}

/**
 * Autocorrelation fallback: measure the horizontal and vertical repetition period directly in the
 * spatial domain. Robust to a missing scale and to windowing artefacts, so it also serves as the
 * cross-check the spec suggests ("approach 1 plus a sanity check").
 * @param {{data:ArrayLike<number>, width:number, height:number}} image
 * @param {{cmPerPixel?:number, minLag?:number, maxLag?:number}} [options]
 */
export function countStitchesAuto(image, options = {}) {
  const { width, height } = image;
  const lum = toLuminance(image);
  const cmPerPixel = Number(options.cmPerPixel) || 0;
  const x = repeatPeriod(lum, width, height, 'x', options.minLag || 3, options.maxLag || Math.min(80, width >> 1));
  const y = repeatPeriod(lum, width, height, 'y', options.minLag || 3, options.maxLag || Math.min(120, height >> 1));
  const cpp = cmPerPixel || 0.1;
  const stsPer10cm = x.period ? clamp(10 / (x.period * cpp), 0, 200) : 0;
  const rowsPer10cm = y.period ? clamp(10 / (y.period * cpp), 0, 260) : 0;
  const confidence = clamp(Math.min(x.strength, y.strength), 0, 1);
  return {
    gauge: { stitchesPer10cm: round1(stsPer10cm), rowsPer10cm: round1(rowsPer10cm) },
    spacing: { x: round2(x.period || 0), y: round2(y.period || 0) },
    confidence: round2(confidence),
    method: 'autocorrelation',
    peak: { fx: x.period || 0, fy: y.period || 0 },
    note: `Self-similarity peaks at ${x.period || '?'} px horizontally, ${y.period || '?'} px vertically.`
  };
}

/** The strongest repeating lag along one axis via normalised autocorrelation of column/row means. */
function repeatPeriod(lum, width, height, axis, minLag, maxLag) {
  const line = [];
  if (axis === 'x') {
    for (let x = 0; x < width; x++) { let s = 0; for (let y = 0; y < height; y++) s += lum[y * width + x]; line.push(s / height); }
  } else {
    for (let y = 0; y < height; y++) { let s = 0; for (let x = 0; x < width; x++) s += lum[y * width + x]; line.push(s / width); }
  }
  const n = line.length;
  const mean = line.reduce((a, b) => a + b, 0) / (n || 1);
  let denom = 0;
  for (let i = 0; i < n; i++) denom += (line[i] - mean) ** 2;
  if (denom < 1e-9) return { period: 0, strength: 0 };
  let best = { period: 0, strength: -Infinity };
  const hi = Math.min(maxLag, n - 1);
  for (let lag = Math.max(1, minLag); lag <= hi; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += (line[i] - mean) * (line[i + lag] - mean);
    const norm = acc / (denom * (1 - lag / n));
    if (norm > best.strength) best = { period: lag, strength: norm };
  }
  return { period: best.period, strength: clamp(best.strength, 0, 1) };
}

function fallback(image, options, reason) {
  const auto = countStitchesAuto(image, options);
  auto.note = `FFT: ${reason}. Autocorrelation fallback: ${auto.note}`;
  auto.confidence = round2(auto.confidence * 0.7);
  return auto;
}

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
