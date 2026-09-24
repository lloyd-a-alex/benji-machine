/**
 * APCA — Accessible Perceptual Contrast Algorithm (W3 release, rev 0.1.9).
 *
 * WCAG 3.0 replaces the flat WCAG 2.x contrast *ratio* with APCA, which models
 * the human contrast perception asymmetry: light text on a dark background is
 * genuinely harder to read than dark text on light at the same naive ratio, and
 * 2.x never noticed. APCA returns a signed *Lc* (Lightness Contrast) value whose
 * sign encodes polarity (positive = dark-on-light, negative = light-on-dark) and
 * whose magnitude is the perceptual difference.
 *
 * This is a faithful, dependency-free port of the constants and control flow in
 * `apca-w3@0.1.9` (SAPC APCA, Beta 0.1.9 W3, © Andrew Somers, W3 license) — the
 * reference implementation the WCAG 3 colour guidance is written against. The
 * numbers are not invented or approximated: they are the shipped algorithm, so a
 * score computed here is the score the W3 tool would give the same two colours.
 *
 * Nothing here touches the DOM; it is pure maths over colour triples, so the
 * editor, the audit test, and (if wanted) a live contrast readout all share one
 * source of truth and can never disagree.
 */

import { logger } from './logging.js';

const log = logger('core/apca');

/** The APCA 0.1.9-W3 working constants, verbatim from the reference source. */
const C = {
  mainTRC: 2.4, // the tone-response curve APCA uses (a straight power, not the sRGB piecewise curve)
  sRco: 0.2126729,
  sGco: 0.7151522,
  sBco: 0.072175,
  normBG: 0.56, // "black-on-white" (dark text, light bg) background exponent
  normTXT: 0.57, // "black-on-white" text exponent
  revTXT: 0.62, // "white-on-black" (light text, dark bg) text exponent
  revBG: 0.65, // "white-on-black" background exponent
  blkThrs: 0.022, // soft black clamp threshold
  blkClmp: 1.414, // soft black clamp exponent
  scaleBoW: 1.14,
  scaleWoB: 1.14,
  loBoWoffset: 0.027,
  loWoBoffset: 0.027,
  deltaYmin: 0.0005, // below this Y difference the pair is treated as identical
  loClip: 0.1, // low-contrast clip floor
  maxInput: 1.1 // Y values are expected in 0..1; above this is out of range
};

/**
 * Parse a CSS hex colour (`#rgb` / `#rrggbb`, with or without `#`) into an
 * sRGB 0–255 triple. Anything unparseable returns `null` rather than throwing,
 * so a bad token surfaces as "skip this pair" in an audit, never a crash.
 *
 * @param {string} hex
 * @returns {number[]|null} `[r, g, b]` 0–255, or null
 */
export function parseHexColor(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Linearise one sRGB channel to APCA's working space and fold it into a single
 * relative-luminance-like Y with the APCA coefficients.
 *
 * @param {number[]} rgb `[r, g, b]` 0–255
 * @returns {number} Y in 0..1 (may slightly exceed 1 for out-of-range input)
 */
export function sRGBtoY(rgb) {
  const lin = (v) => Math.pow(v / 255, C.mainTRC);
  return C.sRco * lin(rgb[0]) + C.sGco * lin(rgb[1]) + C.sBco * lin(rgb[2]);
}

/**
 * Core forward contrast: given text and background Y values, return signed Lc.
 *
 * @param {number} txtY relative luminance of the text/foreground colour
 * @param {number} bgY relative luminance of the background colour
 * @returns {number} signed Lightness Contrast (`< 0` = light-on-dark)
 */
export function apcaContrastY(txtY, bgY) {
  if ([txtY, bgY].some(Number.isNaN)) {
    // A NaN luminance means a caller fed a colour that never parsed — a real bug,
    // not an out-of-range value — so surface it before returning the neutral 0.
    log.warn('apcaContrastY received a NaN luminance — a colour could not be parsed', { txtY, bgY });
    return 0;
  }
  if (Math.min(txtY, bgY) < 0 || Math.max(txtY, bgY) > C.maxInput) {
    return 0;
  }
  // Soft black clamp: near-black values are nudged up to avoid a false zero.
  const t = txtY > C.blkThrs ? txtY : txtY + Math.pow(C.blkThrs - txtY, C.blkClmp);
  const o = bgY > C.blkThrs ? bgY : bgY + Math.pow(C.blkThrs - bgY, C.blkClmp);
  if (Math.abs(o - t) < C.deltaYmin) return 0;

  let output = 0;
  if (o > t) {
    // Dark text on a lighter background ("Black-on-White").
    output = (Math.pow(o, C.normBG) - Math.pow(t, C.normTXT)) * C.scaleBoW;
    output = output < C.loClip ? 0 : output - C.loBoWoffset;
  } else {
    // Light text on a darker background ("White-on-Black") — the dark-theme case.
    output = (Math.pow(o, C.revBG) - Math.pow(t, C.revTXT)) * C.scaleWoB;
    output = output > -C.loClip ? 0 : output + C.loWoBoffset;
  }
  return output * 100;
}

/**
 * Convenience: signed Lc for two colours given as hex strings or 0–255 triples.
 *
 * @param {string|number[]} text foreground (text) colour
 * @param {string|number[]} background background colour
 * @returns {number} signed Lc; `0` if either colour cannot be parsed
 */
export function apcaLc(text, background) {
  const t = Array.isArray(text) ? text : parseHexColor(text);
  const b = Array.isArray(background) ? background : parseHexColor(background);
  if (!t || !b) { log.debug('apcaLc could not parse a colour, returning neutral contrast', { text, background }); return 0; }
  return apcaContrastY(sRGBtoY(t), sRGBtoY(b));
}

/**
 * WCAG-3-aligned Lc minimums. The published WCAG 3 draft leaves the exact numbers
 * as "values to be determined" and delegates to a "minimum contrast test" driven
 * by APCA, so these adopt the APCA reference guidance the draft is built on:
 * body text is held to Lc 75 (its comfortable target) with a hard floor of 60,
 * larger/short text may drop to 45, and non-text UI to 30. APCA is stricter for
 * light-on-dark, so the absolute magnitude is the thing measured.
 */
export const WCAG3_LC = {
  body: 75, // preferred for running/body text at normal sizes
  textMinimum: 60, // hard floor for readable text (small labels, secondary text)
  largeText: 45, // larger or short-lived text
  nonText: 30 // icons, borders, focus rings, state indicators
};

/**
 * Serialise a 0–255 triple back to a `#rrggbb` string, clamped to gamut.
 *
 * @param {number[]} rgb
 * @returns {string}
 */
export function rgbToHex(rgb) {
  return '#' + [0, 1, 2]
    .map((i) => Math.max(0, Math.min(255, Math.round(rgb[i] ?? 0))).toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Nudge a colour just far enough from its background to clear a target Lc,
 * moving the foreground AWAY from the background in luminance so the hue is
 * preserved as long as possible (a saturated pink stays pink, only lighter).
 *
 * This is what makes WCAG 3 land softly on a themed UI: rather than forbid a
 * user's chosen accent, it keeps the accent and lifts it to legibility. The
 * search steps a blend toward white (for light-on-dark) or black (for
 * dark-on-light) in fixed increments and returns the first hex that passes, so
 * the result is deterministic and testable. If the natural direction is already
 * saturated (a near-black pick on a dark surface cannot get any darker), it
 * flips to the opposite extreme rather than giving up and returning an
 * unreadable colour — so the only outcomes are "unchanged" or "legible".
 *
 * @param {string|number[]} color foreground colour
 * @param {string|number[]} background background colour
 * @param {number} [targetLc] minimum absolute Lc to reach (default the text floor)
 * @returns {string} a `#rrggbb` that meets the target (falls back to white/black)
 */
export function ensureContrast(color, background, targetLc = WCAG3_LC.textMinimum) {
  const c = Array.isArray(color) ? color : parseHexColor(color);
  const b = Array.isArray(background) ? background : parseHexColor(background);
  if (!c) return typeof color === 'string' ? color : rgbToHex(color || [0, 0, 0]);
  if (!b) return rgbToHex(c);
  const bgY = sRGBtoY(b);
  if (Math.abs(apcaContrastY(sRGBtoY(c), bgY)) >= targetLc) return rgbToHex(c);
  // Push toward whichever extreme widens the gap, keeping the colour recognisable.
  const away = sRGBtoY(c) > bgY ? 255 : 0;
  const toward = away === 255 ? 0 : 255;
  // The away-from-background move preserves hue and is normally the smaller
  // change; only when it cannot reach the floor (already at that extreme) do we
  // cross over to the opposite end, guaranteeing a legible result.
  return (
    seekContrast(c, bgY, away, targetLc) ??
    seekContrast(c, bgY, toward, targetLc) ??
    (away === 255 ? '#ffffff' : '#000000')
  );
}

/**
 * Blend `c` toward an extreme (`255` white or `0` black) in fixed steps until the
 * contrast against a background luminance clears `targetLc`.
 *
 * @param {number[]} c foreground triple 0–255
 * @param {number} bgY background luminance
 * @param {number} dest 255 to lighten, 0 to darken
 * @param {number} targetLc minimum absolute Lc to reach
 * @returns {string|null} the first passing `#rrggbb`, or null if this direction
 *   saturates before clearing the floor
 */
function seekContrast(c, bgY, dest, targetLc) {
  for (let f = 0.02; f <= 1.0001; f += 0.02) {
    const cand = c.map((v) => v + (dest - v) * f);
    if (Math.abs(apcaContrastY(sRGBtoY(cand), bgY)) >= targetLc) return rgbToHex(cand);
  }
  return null;
}

/**
 * Grade a signed Lc against the role it plays.
 *
 * @param {number} lc signed Lc from {@link apcaLc}
 * @param {'body'|'text'|'largeText'|'nonText'} role how the colour is used
 * @returns {{ abs: number, required: number, pass: boolean }}
 */
export function gradeContrast(lc, role = 'text') {
  const abs = Math.abs(lc);
  const required = role === 'body'
    ? WCAG3_LC.body
    : role === 'largeText'
      ? WCAG3_LC.largeText
      : role === 'nonText'
        ? WCAG3_LC.nonText
        : WCAG3_LC.textMinimum;
  return { abs, required, pass: abs >= required };
}
