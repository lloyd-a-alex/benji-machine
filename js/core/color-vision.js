/**
 * KNITCAT — colour-vision (CVD) preview, made legible (spec §3.5).
 *
 * `yarn/color-blindness.js` has carried the full Viénot–Brettel–Mollon simulation engine —
 * {@link module:yarn/color-blindness.simulate simulate}, {@link module:yarn/color-blindness.auditPalette
 * auditPalette}, {@link module:yarn/color-blindness.paletteIsSafe paletteIsSafe} — since it was written,
 * and none of it had a single consumer. The colour-legibility advisor borrows only `confusablePairs` to
 * *say* two yarns collapse; the maker could never actually *see* their chart the way a deuteranope does.
 * For colourwork that is the whole ball game — a fifth of knitters will one day pick a palette that, on
 * the machine, reads as one colour.
 *
 * This module is that engine's hand. It turns the compiler's palette (`ir.colors`) into a per-deficiency
 * view — every yarn shown as its wearer sees it, plus the exact pairs that collapse into one another —
 * and a printable text sheet. It re-adds **no colour maths**: it defers entirely to
 * {@link module:yarn/color-blindness}, so this view can never disagree with what the advisor already
 * judged. DOM-free, deterministic and total (never throws, tolerates garbage): safe to unit-test directly
 * and safe to import for its pure helpers anywhere.
 *
 * @module core/color-vision
 */

import {
  simulate,
  confusablePairs,
  auditPalette,
  paletteIsSafe,
  CVD_TYPES
} from '../yarn/color-blindness.js';

/** Friendly, plain-language names for each simulated deficiency, keyed by the engine's type ids. */
export const CVD_LABELS = Object.freeze({
  protanopia: 'No reds — protanopia',
  deuteranopia: 'No greens — deuteranopia',
  tritanopia: 'No blues — tritanopia',
  achromatopsia: 'No colour — achromatopsia'
});

/** The two deficiencies that make up ~99% of colour-vision deficiency, used for the headline note. */
const COMMON_TYPES = ['protanopia', 'deuteranopia'];

/** Normalise '#abc' / 'abc' / '#aabbcc' to a lower-case '#aabbcc', or null when it is not a hex. */
function normaliseHex(value) {
  if (typeof value !== 'string') return null;
  let h = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return '#' + h.toLowerCase();
}

/** A display name for a palette entry: its yarn name, else its hex, else "Colour N". */
function entryName(entry) {
  return entry.yarn || entry.hex || `Colour ${entry.index}`;
}

/**
 * Coerce a palette (array of `{index?,hex,yarn?}` objects or bare hex strings, in any shape) into a
 * clean, index-preserving list. Entries with no usable hex are dropped.
 */
function normalisePalette(colors) {
  const list = Array.isArray(colors) ? colors : [];
  const out = [];
  list.forEach((c, i) => {
    const hex = normaliseHex(typeof c === 'string' ? c : c && c.hex);
    if (!hex) return;
    const raw = (c && typeof c === 'object') ? c : {};
    const index = Number.isFinite(Number(raw.index)) ? Number(raw.index) : i;
    const yarn = typeof raw.yarn === 'string' ? raw.yarn : (typeof raw.name === 'string' ? raw.name : '');
    out.push({ index, hex, yarn });
  });
  return out;
}

/**
 * Summarise how a palette reads under every simulated colour-vision deficiency.
 *
 * @param {Array<{index?:number, hex:string, yarn?:string}|string>} colors the compiler palette
 *   (`ir.colors`, shape `{index, hex, yarn}`) or a plain array of hex strings
 * @param {{threshold?:number}} [opts] `threshold` is the RGB-distance under which two colours are
 *   called confusable (defaults to the engine's own 18)
 * @returns {null | {
 *   ok:true, safe:boolean, count:number, palette:Array,
 *   types: Array<{ type:string, label:string, colors:Array, collapsed:Array, collapseCount:number }>,
 *   worstType:string|null, commonCollapseCount:number, headline:string
 * }} a display-ready view, or `null` when there are no usable colours (so the caller skips the
 *   section rather than showing an empty one).
 */
export function summariseColorVision(colors, opts = {}) {
  const palette = normalisePalette(colors);
  if (!palette.length) return null;

  const hexes = palette.map((p) => p.hex);
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : undefined;
  const audit = auditPalette(hexes);

  let maxCollapses = -1;
  let worstType = null;
  let commonCollapseCount = 0;

  const types = CVD_TYPES.map((type) => {
    const entry = audit[type] || { simulated: hexes.map((h) => simulate(h, type)), confusions: [] };
    const simColors = palette.map((p, i) => ({
      index: p.index,
      yarn: p.yarn,
      original: p.hex,
      simulated: entry.simulated[i] != null ? entry.simulated[i] : simulate(p.hex, type)
    }));
    const confusions = threshold === undefined
      ? entry.confusions
      : confusablePairs(hexes, type, threshold);
    const collapsed = confusions.map(({ a, b, distance }) => ({
      a: palette[a],
      b: palette[b],
      distance,
      label: `${entryName(palette[a])} ↔ ${entryName(palette[b])}`
    }));
    if (collapsed.length > maxCollapses) { maxCollapses = collapsed.length; worstType = collapsed.length ? type : worstType; }
    if (COMMON_TYPES.includes(type)) commonCollapseCount += collapsed.length;
    return {
      type,
      label: CVD_LABELS[type] || type,
      colors: simColors,
      collapsed,
      collapseCount: collapsed.length
    };
  });

  const safe = paletteIsSafe(hexes);
  const headline = safe
    ? 'Every colour stays distinct for all four simulations.'
    : commonCollapseCount
      ? `${commonCollapseCount} pair${commonCollapseCount > 1 ? 's' : ''} collapse for red/green colour-blindness — the common kind.`
      : `Colours only collapse under ${CVD_LABELS[worstType] || 'rare deficiencies'}.`;

  return { ok: true, safe, count: palette.length, palette, types, worstType, commonCollapseCount, headline };
}

/**
 * Render the CVD view as plain, printable text — the accessibility note a maker can paste into a
 * pattern or tech pack, mirroring {@link module:machine/pass-sheet passSheetToText}.
 *
 * @param {object|null} summary the result of {@link summariseColorVision}
 * @param {{ title?:string }} [opts]
 * @returns {string} a trailing-newline-terminated block; a friendly note when there is nothing to show.
 */
export function colorVisionToText(summary, opts = {}) {
  const title = opts.title || 'Colour-blindness check';
  if (!summary || !Array.isArray(summary.types)) {
    return `${title}\n${'='.repeat(title.length)}\n\nGive the chart two or more yarn colours and KNITCAT will show how each reads for colour-blind knitters.\n`;
  }
  const out = [title, '='.repeat(title.length), '', summary.headline, ''];
  for (const t of summary.types) {
    out.push(`${t.label}:`);
    out.push(`  ${t.colors.map((c) => `${entryName(c)} ${c.original} → ${c.simulated}`).join(', ')}`);
    if (t.collapseCount) {
      out.push(`  ⚠ indistinguishable: ${t.collapsed.map((p) => p.label).join('; ')}`);
    } else {
      out.push('  all colours stay distinct');
    }
    out.push('');
  }
  return out.join('\n');
}
