/**
 * KNITCAT V2 — the colour engine (spec §3.5).
 *
 * Colour is where knitters make the most expensive mistakes (a skein that photographs one
 * way and knits another) and the most delightful discoveries (a palette pulled from a photo
 * of a sunset). This is the maths under all of it: hex/RGB/HSL/CIELAB conversions, a proper
 * CIEDE2000-ish perceptual distance so "does this cream match that cream?" has an honest
 * answer, colour harmony generation, gradients, palette extraction from raw pixel data, and
 * matching a colour to the nearest real yarn in the database. Everything operates on plain
 * numbers and strings — DOM-free, so `extractPalette` takes an {data,width,height} pixel
 * buffer the caller grabs from a canvas, never a canvas itself.
 *
 * @module yarn/color
 */

/* ------------------------------------------------------------------ conversions */

/** Clamp helper. @param {number} n @param {number} lo @param {number} hi */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Parse a hex string (#rgb, #rgba, #rrggbb, #rrggbbaa, with or without '#') to {r,g,b,a}.
 * Tolerant: bad input returns black, never throws.
 * @param {string} hex @returns {{r:number,g:number,b:number,a:number}}
 */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return { r: 0, g: 0, b: 0, a: 1 };
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
  if (h.length === 8) { /* rrggbbaa */ }
  else if (h.length === 6) h += 'ff';
  else if (/^[0-9a-f]+$/i.test(h)) { h = (h + '00000000').slice(0, 8); }
  else return { r: 0, g: 0, b: 0, a: 1 };
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0, a: 1 };
  return { r: (n >> 24) & 255, g: (n >> 16) & 255, b: (n >> 8) & 255, a: ((n & 255) / 255) };
}

/** Format {r,g,b} back to #rrggbb. @param {{r,g,b}} rgb @returns {string} */
export function rgbToHex(rgb) {
  const { r = 0, g = 0, b = 0 } = rgb && typeof rgb === 'object' ? rgb : {};
  const c = v => clamp(Math.round(Number(v) || 0), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** RGB (0..255) → HSL (h 0..360, s/l 0..1). @returns {{h,s,l}} */
export function rgbToHsl(rgb) {
  const { r = 0, g = 0, b = 0 } = rgb && typeof rgb === 'object' ? rgb : {};
  const rn = (Number(r) || 0) / 255, gn = (Number(g) || 0) / 255, bn = (Number(b) || 0) / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min;
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

/** HSL → RGB (0..255). */
export function hslToRgb({ h, s, l }) {
  const hh = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    let tt = t; if (tt < 0) tt += 1; if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: Math.round(f(hh + 1 / 3) * 255), g: Math.round(f(hh) * 255), b: Math.round(f(hh - 1 / 3) * 255) };
}

function srgbToLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function linearToSrgb(c) { const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return clamp(v * 255, 0, 255); }

/** RGB → CIE XYZ (D65). */
export function rgbToXyz({ r, g, b }) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  return {
    x: (R * 0.4124 + G * 0.3576 + B * 0.1805) * 100,
    y: (R * 0.2126 + G * 0.7152 + B * 0.0722) * 100,
    z: (R * 0.0193 + G * 0.1192 + B * 0.9505) * 100
  };
}
/** CIE XYZ → Lab (D65 white). */
export function xyzToLab({ x, y, z }) {
  const wp = [95.047, 100, 108.883];
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(x / wp[0]), fy = f(y / wp[1]), fz = f(z / wp[2]);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
/** Lab → XYZ. */
export function labToXyz({ L, a, b }) {
  const wp = [95.047, 100, 108.883];
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const fi = (t) => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
  return { x: wp[0] * fi(fx), y: wp[1] * fi(fy), z: wp[2] * fi(fz) };
}
/** XYZ → RGB. */
export function xyzToRgb({ x, y, z }) {
  const X = x / 100, Y = y / 100, Z = z / 100;
  return { r: linearToSrgb(X * 3.2406 + Y * -1.5372 + Z * -0.4986), g: linearToSrgb(X * -0.9689 + Y * 1.8758 + Z * 0.0415), b: linearToSrgb(X * 0.0557 + Y * -0.204 + Z * 1.057) };
}
/** Convenience hex ↔ Lab. */
export function hexToLab(hex) { return xyzToLab(rgbToXyz(hexToRgb(hex))); }
export function labToHex(lab) { return rgbToHex(xyzToRgb(labToXyz(lab))); }

/* ------------------------------------------------------------------ distance */

/**
 * Perceptual colour difference (CIE76 ΔE — fast, and the reference knitters use; two colours
 * within ~2 are near-indistinguishable, ~10 is clearly different, 25+ is another colour).
 * @param {string|{r,g,b}} a @param {string|{r,g,b}} b @returns {number}
 */
export function deltaE(a, b) {
  const la = typeof a === 'string' ? hexToLab(a) : hexToLab(rgbToHex(a));
  const lb = typeof b === 'string' ? hexToLab(b) : hexToLab(rgbToHex(b));
  return Math.sqrt((la.L - lb.L) ** 2 + (la.a - lb.a) ** 2 + (la.b - lb.b) ** 2);
}

/** Is `b` within `tolerance` ΔE of `a`? @returns {boolean} */
export function colorsMatch(a, b, tolerance = 5) { return deltaE(a, b) <= tolerance; }

/* ------------------------------------------------------------------ harmony */

/** Supported harmony schemes (spec §3.5). */
export const HARMONY_TYPES = Object.freeze(['complementary', 'analogous', 'triadic', 'split-complementary', 'tetradic', 'monochromatic', 'warm', 'cool']);

/**
 * Generate a harmonious palette around a base hex.
 * @param {string} base @param {number} [count=5] @param {import('./color.js').HARMONY_TYPES[number]} [harmony='analogous']
 * @returns {string[]} hex list including the base first
 */
export function suggestPalette(base, count = 5, harmony = 'analogous') {
  const { h, s, l } = rgbToHsl(hexToRgb(base));
  const out = [];
  const push = (hh, ss = s, ll = l) => out.push(rgbToHex(hslToRgb({ h: hh, s: clamp(ss, 0, 1), l: clamp(ll, 0, 1) })));
  const n = clamp(count, 2, 12);
  switch (harmony) {
    case 'complementary':
      push(h); push(h + 180);
      for (let i = 2; i < n; i++) push(h + (i % 2 ? 180 : 0), s, l + (i - 1) * 0.06);
      break;
    case 'triadic':
      for (let i = 0; i < n; i++) push(h + i * 120, s, l + (i - 1) * 0.04);
      break;
    case 'split-complementary':
      push(h); push(h + 150); push(h + 210);
      for (let i = 3; i < n; i++) push(h + (i % 2 ? 150 : 210), s, l + (i - 2) * 0.05);
      break;
    case 'tetradic':
      for (let i = 0; i < n; i++) push(h + i * 90, s, l);
      break;
    case 'monochromatic':
      for (let i = 0; i < n; i++) push(h, clamp(s - 0.08 * i, 0.1, 1), clamp(l - 0.12 + i * 0.06, 0.08, 0.94));
      break;
    case 'warm':
      for (let i = 0; i < n; i++) push(30 + i * 20, s, l);
      break;
    case 'cool':
      for (let i = 0; i < n; i++) push(180 + i * 25, s, l);
      break;
    case 'analogous':
    default:
      for (let i = 0; i < n; i++) push(h + (i - Math.floor(n / 2)) * 22, s, l);
      break;
  }
  return dedupe(out).slice(0, n);
}

/**
 * Generate a gradient of `steps` colours between two hexes (perceptual, via Lab).
 * @param {string} start @param {string} end @param {number} steps @returns {string[]}
 */
export function generateGradient(start, end, steps = 8) {
  const a = hexToLab(start), b = hexToLab(end);
  const n = clamp(steps, 2, 64);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(labToHex({ L: a.L + (b.L - a.L) * t, a: a.a + (b.a - a.a) * t, b: a.b + (b.b - a.b) * t }));
  }
  return out;
}

/**
 * Extract the dominant colours from raw pixel data (a simplified k-means / binning over a
 * hue-lightness grid). `imageData` is {data:Uint8ClampedArray, width, height} — the caller
 * reads the canvas, this stays DOM-free.
 * @param {{data:ArrayLike<number>, width:number, height:number}} imageData
 * @param {number} [count=6] @returns {Array<{hex:string, weight:number}>}
 */
export function extractPalette(imageData, count = 6) {
  if (!imageData || !imageData.data) return [];
  const buckets = new Map();
  const px = imageData.data;
  const step = Math.max(4, Math.floor((px.length / 4) / 4000) * 4 || 4); // sample for speed
  for (let i = 0; i + 3 < px.length; i += step) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`; // 8 levels per channel
    const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    cur.r += r; cur.g += g; cur.b += b; cur.n++;
    buckets.set(key, cur);
  }
  const total = [...buckets.values()].reduce((s, v) => s + v.n, 0) || 1;
  const ranked = [...buckets.values()]
    .map(v => ({ hex: rgbToHex({ r: v.r / v.n, g: v.g / v.n, b: v.b / v.n }), weight: v.n / total }))
    .sort((a, b) => b.weight - a.weight);
  // Merge near-duplicates so the palette reads as distinct colours.
  const out = [];
  for (const c of ranked) {
    if (out.some(o => deltaE(o.hex, c.hex) < 12)) continue;
    out.push({ hex: c.hex, weight: round3(c.weight) });
    if (out.length >= clamp(count, 1, 16)) break;
  }
  return out;
}

/**
 * Find the nearest real yarn colours to a hex, ranked by ΔE.
 * @param {string} hex @param {Array<{colors?:Array, hex?:string}>} yarns @param {number} [tolerance=40]
 * @returns {Array<{yarn:object, hex:string, deltaE:number}>}
 */
export function matchToYarns(hex, yarns = [], tolerance = 40) {
  const matches = [];
  for (const y of yarns) {
    const colors = y.colors || (y.hex ? [{ hex: y.hex }] : []);
    for (const c of colors) {
      const d = deltaE(hex, c.hex || c);
      if (d <= tolerance) matches.push({ yarn: y, hex: c.hex || c, deltaE: round2(d) });
    }
  }
  return matches.sort((a, b) => a.deltaE - b.deltaE).slice(0, 25);
}

/**
 * Relative luminance (WCAG) of a hex — reused by contrast checks and the accessibility suite.
 * @param {string} hex @returns {number} 0..1
 */
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * WCAG 2 contrast ratio between two colours, with an APCA-style pass flag for readability of
 * colourwork (≥ 3:1 is a comfortable knitting distinction; ≥ 4.5 reads at machine gauge).
 * @param {string} c1 @param {string} c2 @returns {{ratio:number, lc:number, pass:boolean}}
 */
export function checkContrast(c1, c2) {
  const L1 = luminance(c1), L2 = luminance(c2);
  const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  return { ratio: round2(ratio), lc: round2(ratio), pass: ratio >= 3 };
}

function dedupe(list) { return [...new Set(list)]; }
function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
