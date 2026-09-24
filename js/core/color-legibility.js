/**
 * KNITCAT — colour-legibility analysis (pure, DOM-free, testable).
 *
 * A stranded or jacquard chart only *reads* if neighbouring colours are distinguishable — both by
 * value (a luminance contrast a machine gauge can show) and to a colour-blind wearer. The compiler
 * already checked this, but in two places at once (`compiler/verify/color.js` and the appearance
 * optimiser), each re-deriving the same all-pairs loop, and crucially checking **every** palette
 * pair whether or not those two yarns ever touch on the card. Two similar shades that never sit
 * next to each other are not a defect — a three-colour motif with a non-adjacent near-match is
 * perfectly readable, and the old check raised a false alarm.
 *
 * This module is the ONE implementation, and it is **adjacency-aware**: when handed the touching
 * colour pairs from `core/chart-analysis.js#adjacentColorPairs` it judges only those; without them
 * it falls back to the conservative all-pairs audit, so any caller can adopt it safely.
 *
 * It reuses the existing primitives rather than re-deriving colour science:
 *   • value contrast   → `yarn/color.js#checkContrast` (WCAG luminance ratio, ≥ 3:1 reads)
 *   • colour-blindness → `yarn/color-blindness.js#confusablePairs` (Viénot dichromat simulation)
 *
 * `analyzeColorLegibility` never throws and never mutates: feed it a malformed palette and you get
 * a neutral `{ verdict: 'pass', low: [], confusable: [] }` back — a legibility check must never be
 * the thing that breaks a compile.
 *
 * @module core/color-legibility
 */

import { checkContrast } from '../yarn/color.js';
import { confusablePairs, CVD_TYPES } from '../yarn/color-blindness.js';
import { logger } from './logging.js';

const log = logger('core/color-legibility');

/** Minimum WCAG contrast ratio for two *neighbouring* colours to read as distinct. */
export const CONTRAST_FLOOR = 3;
/** Simulated-RGB distance under which a colour-blind wearer cannot separate two shades. */
export const CVD_THRESHOLD = 18;

/** A colour entry normalised to `{ index, hex, label }`, or null when it carries no usable hex. */
function normalizeSwatch(color, position) {
  if (!color || typeof color !== 'object') return null;
  const hex = typeof color.hex === 'string' ? color.hex : null;
  if (!hex) return null;
  const index = Number.isFinite(color.index) ? color.index : position;
  const label = color.yarn || color.name || hex;
  return { index, hex, label };
}

/** Coerce an `adjacency` argument into a Set of `a|b` keys plus an ordered pair list. */
function adjacencyKeys(adjacency) {
  if (!adjacency) return null;
  const keys = adjacency instanceof Set
    ? adjacency
    : (Array.isArray(adjacency) ? adjacency : adjacency.keys instanceof Set ? adjacency.keys : null);
  const pairs = Array.isArray(adjacency)
    ? adjacency
    : (adjacency && Array.isArray(adjacency.pairs) ? adjacency.pairs : null);
  const out = new Set();
  if (keys) for (const k of keys) out.add(String(k));
  if (pairs) for (const [a, b] of pairs) out.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  return out;
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Judge a palette's legibility. `colors` is an array of `{ index?, hex, yarn? }` (the compiler's
 * `ir.colors` shape). `adjacency` is the touching-index pairs from `adjacentColorPairs()` — pass
 * `{ pairs }`, a bare `[[a, b], …]`, or a `Set` of `"a|b"` keys; omit it for the all-pairs audit.
 *
 * @param {Array<{index?:number, hex:string, yarn?:string}>} colors
 * @param {{adjacency?: {pairs:Array<[number,number]>, keys:Set<string>} | Array<[number,number]> | Set<string>, contrastFloor?:number, cvdThreshold?:number}} [opts]
 * @returns {{swatches:Array, adjacency:boolean, pairsChecked:number, low:Array, confusable:Array, confusableTypes:string[], verdict:('pass'|'warn'|'fail'), passes:boolean}}
 */
export function analyzeColorLegibility(colors, { adjacency = null, contrastFloor = CONTRAST_FLOOR, cvdThreshold = CVD_THRESHOLD } = {}) {
  const empty = { swatches: [], adjacency: Boolean(adjacency), pairsChecked: 0, low: [], confusable: [], confusableTypes: [], verdict: 'pass', passes: true };
  if (!Array.isArray(colors)) { log.debug('analyzeColorLegibility got a non-array palette — nothing to judge', { type: typeof colors }); return empty; }

  const swatches = colors.map(normalizeSwatch).filter(Boolean);
  // Entries without a usable hex are dropped, quietly shrinking the audit. If the
  // caller handed us colours but we could only read some, that is a data fault worth
  // surfacing — a "passing" verdict over a half-empty palette is misleading.
  if (colors.length && swatches.length < colors.length) {
    log.warn('some palette entries carried no usable hex and were skipped in the legibility audit', { provided: colors.length, usable: swatches.length });
  }
  if (swatches.length < 2) return { ...empty, swatches };

  // Map palette index → swatch so adjacency (expressed in chart indices) resolves to colours.
  const byIndex = new Map();
  for (const s of swatches) byIndex.set(s.index, s);

  const adj = adjacencyKeys(adjacency);
  // Build the concrete list of colour pairs to judge. Adjacency narrows it to touching yarns; the
  // fallback (no usable adjacency) is the conservative every-pair audit.
  let checked;
  if (adj && adj.size) {
    checked = [];
    for (const key of adj) {
      const [a, b] = key.split('|').map(Number);
      const sa = byIndex.get(a), sb = byIndex.get(b);
      if (sa && sb && sa.index !== sb.index) checked.push([sa, sb]);
    }
  } else {
    checked = [];
    for (let i = 0; i < swatches.length; i++) {
      for (let j = i + 1; j < swatches.length; j++) checked.push([swatches[i], swatches[j]]);
    }
  }

  // ── value contrast ─────────────────────────────────────────────────────────
  const low = [];
  for (const [sa, sb] of checked) {
    const { ratio } = checkContrast(sa.hex, sb.hex);
    if (!(ratio >= contrastFloor)) {
      low.push({ a: sa.index, b: sb.index, ratio, labels: [sa.label, sb.label], label: `${sa.label} / ${sb.label}` });
    }
  }

  // ── colour-blind confusability, restricted to the judged pairs ─────────────
  const involvedHexes = [];
  const hexToIndexes = new Map();
  for (const [sa, sb] of checked) {
    for (const s of [sa, sb]) {
      if (!hexToIndexes.has(s.hex)) { hexToIndexes.set(s.hex, []); involvedHexes.push(s.hex); }
      const list = hexToIndexes.get(s.hex);
      if (!list.includes(s.index)) list.push(s.index);
    }
  }
  const judgedKeys = new Set(checked.map(([sa, sb]) => pairKey(sa.index, sb.index)));
  const confusable = [];
  const confusableTypes = [];
  for (const type of CVD_TYPES) {
    let hasForType = false;
    for (const pos of confusablePairs(involvedHexes, type, cvdThreshold)) {
      const ai = hexToIndexes.get(involvedHexes[pos.a]);
      const bi = hexToIndexes.get(involvedHexes[pos.b]);
      // A confusion only matters if those two colours actually meet on the card (or we audited all).
      const pairsOf = (xa, xb) => {
        for (const ia of xa) for (const ib of xb) {
          if (ia !== ib && judgedKeys.has(pairKey(ia, ib))) return true;
        }
        return false;
      };
      if (pairsOf(ai, bi)) {
        hasForType = true;
        confusable.push({ type, a: ai[0], b: bi[0], distance: pos.distance, label: `${involvedHexes[pos.a]} / ${involvedHexes[pos.b]}` });
      }
    }
    if (hasForType && !confusableTypes.includes(type)) confusableTypes.push(type);
  }

  const verdict = low.length ? 'fail' : confusableTypes.length ? 'warn' : 'pass';
  return {
    swatches,
    adjacency: Boolean(adj && adj.size),
    pairsChecked: checked.length,
    low,
    confusable,
    confusableTypes,
    verdict,
    passes: verdict === 'pass'
  };
}
