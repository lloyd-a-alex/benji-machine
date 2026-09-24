/**
 * KNITCAT V2 — the substitution *view* (spec §3.4 / §11.4).
 *
 * `yarn/substitution.js` computes a full {@link SubstitutionReport} for a pair of yarns and can rank
 * a whole set of candidates, but until now nothing in the running app ever asked it to — the Yarn Lab
 * hinted at "substitution" in its catalog blurb and showed none of it. This module is the thin, pure,
 * DOM-free bridge the UI needs. It feeds the project's current yarn and the pattern's gauge to
 * {@link rankSubstitutes}, trims the rich report down to the handful of figures a knitter actually
 * reads — how far off the gauge is, how the yardage and weight shift, what the fibre does, the closest
 * colourway, and (the part that saves a project) the concrete edits to make — and prints a plain-text
 * version for a tech pack.
 *
 * It re-derives *nothing*: every number is the one the substitution engine already produced, so this
 * view can never disagree with the engine that emitted the pattern.
 *
 * @module yarn/substitution-view
 */

import { rankSubstitutes } from './substitution.js';
import { getDefaultDatabase } from './database.js';

/** The substitution grade → a chip tone the panels understand. */
export const RECOMMENDATION_TONE = Object.freeze({
  excellent: 'ok', good: 'ok', acceptable: 'warn', poor: 'bad'
});

// ── tiny, total helpers (never throw, never touch the DOM) ───────────────────

function cleanNumber(v) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; }
function intOrDefault(v, d) { const n = Math.round(cleanNumber(v) ?? d); return Math.max(1, n); }
/** Signed 1-dp string for the text sheet ("+3.0" / "-8" / "0"). */
function signed(n) {
  const v = cleanNumber(n);
  if (v == null || v === 0) return v === 0 ? '0' : '—';
  return (v > 0 ? '+' : '') + (Math.round(v * 10) / 10);
}
/** Coerce the many shapes a substitution `from`/`to` arrives in into a compact label. */
function endpoint(v) {
  if (v == null) return '—';
  if (typeof v === 'object') {
    if (v.mm != null) return `${v.mm}mm`;
    if (v.min != null) return v.max != null && v.max !== v.min ? `${v.min}–${v.max}mm` : `${v.min}mm`;
    return JSON.stringify(v);
  }
  return String(v);
}

/**
 * Map the pattern-gauge object whatever the caller has (the compiler uses `stitchesPer10cm`, the
 * yarn report uses `stsPer10cm`) onto the key names `substitute()` expects, preserving the optional
 * cast-on / row-count / metre figures that unlock the concrete adjustments.
 */
function normaliseGauge(pg) {
  const src = pg && typeof pg === 'object' ? pg : {};
  const out = {};
  const sts = cleanNumber(src.stitchesPer10cm != null ? src.stitchesPer10cm : src.stsPer10cm);
  const rows = cleanNumber(src.rowsPer10cm);
  if (sts != null) out.stitchesPer10cm = sts;
  if (rows != null) out.rowsPer10cm = rows;
  if (src.castOn != null) out.castOn = src.castOn;
  if (src.totalRows != null) out.totalRows = src.totalRows;
  if (src.meters != null) out.meters = src.meters;
  return out;
}

/** Turn one `{ yarn, report, score }` entry from `rankSubstitutes` into a display row. */
function pickFromEntry(entry, rank) {
  const r = entry.report;
  const y = (r && r.substitute) || entry.yarn || {};
  const f = (r && r.fiberDelta) || { added: [], removed: [] };
  return {
    rank,
    id: y.id != null ? y.id : null,
    name: String(y.name || 'Untitled yarn'),
    brand: String(y.brand || 'Unknown'),
    weight: String(y.weight || 'unknown'),
    recommendation: (r && r.recommendation) || 'acceptable',
    tone: RECOMMENDATION_TONE[(r && r.recommendation)] || '',
    score: cleanNumber(entry.score) ?? 0,
    gaugeStitches: r ? r.gaugeDelta.stitches : null,
    gaugeRows: r ? r.gaugeDelta.rows : null,
    yardagePercent: r ? r.yardageDelta.percent : null,
    weightPercent: r ? r.weightDelta.percent : null,
    fiberAdded: Array.isArray(f.added) ? f.added.slice() : [],
    fiberRemoved: Array.isArray(f.removed) ? f.removed.slice() : [],
    colorDeltaE: r && r.colorMatch ? r.colorMatch.deltaE : null,
    colorName: r && r.colorMatch ? r.colorMatch.name : null,
    adjustments: r && Array.isArray(r.adjustments)
      ? r.adjustments.map((a) => ({ kind: a.kind, from: a.from, to: a.to, note: a.note || '' }))
      : [],
    warnings: r && Array.isArray(r.warnings) ? r.warnings.slice(0, 4) : []
  };
}

/**
 * Rank `candidates` as substitutes for `original` and shape the result for the UI.
 *
 * @param {object} original the project's yarn (raw or normalised); anything with a name/gauge
 * @param {object[]} candidates pool to choose swaps from (the caller supplies the registry list)
 * @param {object} [patternGauge] `{ stitchesPer10cm|stsPer10cm, rowsPer10cm, castOn?, totalRows?, meters? }`
 * @param {{limit?:number}} [opts]
 * @returns {{ok:true,count:number,original:object,patternGauge:object,picks:object[],best:object,headline:string}|null}
 *   `null` when there is no usable original or no candidate left after excluding the original — so the
 *   panel can hide the section entirely rather than show an empty table.
 */
export function summariseSubstitution(original, candidates, patternGauge = {}, opts = {}) {
  if (!original || typeof original !== 'object') return null;
  const limit = intOrDefault(opts.limit, 5);
  const pool = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && typeof c === 'object')
    .filter((c) => !original.id || c.id !== original.id);
  if (!pool.length) return null;

  let ranked;
  try { ranked = rankSubstitutes(original, pool, normaliseGauge(patternGauge), limit); } catch (_) { return null; }
  if (!Array.isArray(ranked) || !ranked.length) return null;

  const picks = ranked.map((e, i) => pickFromEntry(e, i + 1));
  const origYarn = (ranked[0].report && ranked[0].report.original) || original;
  const best = picks[0];
  return {
    ok: true,
    count: picks.length,
    original: {
      id: origYarn.id != null ? origYarn.id : null,
      name: String(origYarn.name || 'the project yarn'),
      brand: String(origYarn.brand || 'Unknown'),
      weight: String(origYarn.weight || 'unknown')
    },
    patternGauge: {
      stsPer10cm: cleanNumber(normaliseGauge(patternGauge).stitchesPer10cm),
      rowsPer10cm: cleanNumber(normaliseGauge(patternGauge).rowsPer10cm)
    },
    picks,
    best,
    headline: `Closest swap: ${best.brand} ${best.name} — ${best.recommendation}`
  };
}

/**
 * Convenience for the panels: rank against the built-in yarn registry when no candidate pool is
 * supplied, so a caller only needs the project's yarn + gauge. Falls back to an empty summary
 * (→ `null`) if the registry cannot be read.
 *
 * @param {object} original @param {object} [patternGauge] @param {{candidates?:object[],limit?:number}} [opts]
 */
export function bestSubstitutesFor(original, patternGauge = {}, opts = {}) {
  let candidates = Array.isArray(opts.candidates) ? opts.candidates : [];
  if (!candidates.length) {
    try { candidates = getDefaultDatabase().all(); } catch (_) { candidates = []; }
  }
  return summariseSubstitution(original, candidates, patternGauge, opts);
}

/**
 * The plain-text substitution report — the same figures the panel shows, ready to paste into notes or
 * a tech pack. Total: a null summary returns a helpful prompt instead of throwing.
 *
 * @param {object|null} summary from {@link summariseSubstitution} / {@link bestSubstitutesFor}
 * @param {{title?:string}} [opts]
 * @returns {string} ends with a trailing newline
 */
export function substitutionToText(summary, opts = {}) {
  const title = opts.title || 'Yarn substitutions';
  if (!summary || !summary.ok || !Array.isArray(summary.picks) || !summary.picks.length) {
    return 'Add a yarn with a stated gauge to the project and KNITCAT will rank the closest swaps from the library.\n';
  }
  const lines = [title, '='.repeat(title.length), ''];
  const g = summary.patternGauge && summary.patternGauge.stsPer10cm != null ? ` (${summary.patternGauge.stsPer10cm} sts/10cm)` : '';
  lines.push(`Substituting: ${summary.original.brand} ${summary.original.name} — ${summary.original.weight}${g}`, '');
  for (const p of summary.picks) {
    lines.push(`${p.rank}. ${p.brand} ${p.name} (${p.weight}) — ${p.recommendation}`);
    lines.push(`   gauge ${signed(p.gaugeStitches)} sts/10cm · yardage ${signed(p.yardagePercent)}% · weight ${signed(p.weightPercent)}%`);
    const fibre = [];
    if (p.fiberAdded.length) fibre.push(`adds ${p.fiberAdded.join(', ')}`);
    if (p.fiberRemoved.length) fibre.push(`drops ${p.fiberRemoved.join(', ')}`);
    if (fibre.length) lines.push(`   fibre: ${fibre.join('; ')}`);
    if (p.colorDeltaE != null) lines.push(`   closest colourway: ${p.colorName} (ΔE ${p.colorDeltaE})`);
    for (const a of p.adjustments) lines.push(`   → ${a.kind}: ${endpoint(a.from)} → ${endpoint(a.to)}${a.note ? `  (${a.note})` : ''}`);
    for (const w of p.warnings) lines.push(`   ! ${w}`);
    lines.push('');
  }
  return lines.join('\n');
}
