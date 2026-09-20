/**
 * KNITCAT V2 — colour-vision simulation (spec §3.5).
 *
 * Roughly 1 in 12 men and 1 in 200 women have some colour-vision deficiency; colourwork
 * charts are the worst place to discover your two greys are the same colour. This simulates
 * protanopia (missing L cones / red), deuteranopia (missing M cones / green) and tritanopia
 * (missing S cones / blue) using the Viénot–Brettel–Mollon dichromat transforms, so the UI
 * can show "here is your chart as a deuteranope sees it" and flag any two colours in a
 * palette that collapse into one another. DOM-free — operates on hex strings.
 *
 * @module yarn/color-blindness
 */

import { hexToRgb, rgbToHex } from './color.js';

/** The three simulated deficiency types. */
export const CVD_TYPES = Object.freeze(['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']);

// Viénot/Brettel/Mollon RGB-space dichromat matrices (linear-ish LMS approximation applied in
// sRGB, which is the accepted trade-off for real-time UI simulation and matches common tools).
const MATRICES = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.782951, 0.102546],
    [-0.003882, -0.090180, 1.094062]
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.011820, 0.042940, 0.968881]
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.303900]
  ],
  achromatopsia: [
    [0.299, 0.587, 0.114],
    [0.299, 0.587, 0.114],
    [0.299, 0.587, 0.114]
  ]
};

function mulberry(m, r, g, b) {
  return {
    r: clamp255(m[0][0] * r + m[0][1] * g + m[0][2] * b),
    g: clamp255(m[1][0] * r + m[1][1] * g + m[1][2] * b),
    b: clamp255(m[2][0] * r + m[2][1] * g + m[2][2] * b)
  };
}

/**
 * Simulate how a hex looks to someone with the given deficiency. Unknown type returns input.
 * @param {string} hex @param {'protanopia'|'deuteranopia'|'tritanopia'|'achromatopsia'} type
 * @returns {string} hex
 */
export function simulate(hex, type = 'deuteranopia') {
  const m = MATRICES[type];
  if (!m) return hex;
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(mulberry(m, r, g, b));
}

/**
 * Given a list of hexes, report which pairs become confusable under a deficiency (ΔE-ish in
 * RGB < threshold). Used to warn "colours 2 and 5 are indistinguishable in a deuteranope's
 * chart." @param {string[]} hexes @param {string} type @param {number} [threshold=18]
 * @returns {Array<{a:number,b:number,distance:number}>}
 */
export function confusablePairs(hexes = [], type = 'deuteranopia', threshold = 18) {
  const sim = hexes.map(h => { const { r, g, b } = hexToRgb(simulate(h, type)); return { r, g, b }; });
  const out = [];
  for (let i = 0; i < sim.length; i++) {
    for (let j = i + 1; j < sim.length; j++) {
      const d = Math.sqrt((sim[i].r - sim[j].r) ** 2 + (sim[i].g - sim[j].g) ** 2 + (sim[i].b - sim[j].b) ** 2) / 1.732;
      if (d < threshold) out.push({ a: i, b: j, distance: Math.round(d) });
    }
  }
  return out;
}

/**
 * A full accessibility read on a palette: for every deficiency, the simulated swatches and the
 * worst (most-confusable) pair. @param {string[]} hexes @returns {Record<string,object>}
 */
export function auditPalette(hexes = []) {
  const out = {};
  for (const type of CVD_TYPES) {
    out[type] = { simulated: hexes.map(h => simulate(h, type)), confusions: confusablePairs(hexes, type) };
  }
  return out;
}

/** A machine-readable summary flag: is this palette safe for all deficiencies? */
export function paletteIsSafe(hexes = []) {
  const audit = auditPalette(hexes);
  return CVD_TYPES.every(t => audit[t].confusions.length === 0);
}

function clamp255(n) { return Math.max(0, Math.min(255, Math.round(n))); }
