/**
 * KNITCAT V2 — the blending *view* (spec §3.6).
 *
 * `yarn/blending.js` computes what happens when you hold two or three strands through one machine
 * (the combined gauge, the optical marle, the blended behaviour) and what happens when you knit a
 * Fair Isle field on the machine (floats that snag, motif pairs that don't read) — but until now the
 * whole lab had ZERO consumers in the running app. This module is the thin, pure, DOM-free bridge the
 * UI needs, and it lights up two genuinely-missing capabilities:
 *
 *   - {@link summariseHoldForGauge} — "I need 22 sts / 10 cm and I don't own it": the closest
 *     single yarn or held combination, ranked by how far off the target it lands, via
 *     {@link module:yarn/blending.suggestHoldForGauge}.
 *   - {@link summariseFairIsle} — "is this colourwork field safe and legible on the machine": float
 *     warnings (which rows need a tuck to catch a long float) and low-contrast motif pairs, via
 *     {@link module:yarn/blending.fairIslePlan}, read straight off the compiler's own palette + card.
 *
 * It re-derives nothing: every number is one the blending engine already produced, so these views can
 * never disagree with the maths that emitted the pattern.
 *
 * @module yarn/blending-view
 */

import { holdStrands, suggestHoldForGauge, fairIslePlan } from './blending.js';
import { getDefaultDatabase, representativeGauge } from './database.js';

// ── tiny, total helpers (never throw, never touch the DOM) ───────────────────

function cleanNumber(v) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; }
function intOrDefault(v, d) { const n = Math.round(cleanNumber(v) ?? d); return Math.max(1, n); }

/**
 * Coerce almost anything yarn-shaped (a raw strand descriptor, a normalised {@link Yarn}, or a
 * `{ gauge }` report row) into the `{ stsPer10cm, rowsPer10cm, … }` shape the blending engine wants.
 * Returns `null` for anything with no usable stitch gauge, so callers can just filter it out.
 */
export function normaliseStrand(s) {
  if (!s || typeof s !== 'object') return null;
  let sts = cleanNumber(s.stsPer10cm);
  let rows = cleanNumber(s.rowsPer10cm);
  if (sts == null && s.gauge) { sts = cleanNumber(s.gauge.stsPer10cm); rows = cleanNumber(s.gauge.rowsPer10cm); }
  if (sts == null) { const g = representativeGauge(s); sts = cleanNumber(g.stsPer10cm); rows = cleanNumber(g.rowsPer10cm); }
  if (sts == null || sts <= 0) return null;
  const color = s.color || (Array.isArray(s.colors) && s.colors[0] && (s.colors[0].hex || s.colors[0])) || null;
  return {
    name: String(s.name || 'Yarn'),
    brand: String(s.brand || ''),
    stsPer10cm: sts,
    rowsPer10cm: rows != null ? rows : Math.round(sts * 1.35 * 10) / 10,
    weight: s.weight,
    fiber: s.fiber,
    color: typeof color === 'string' ? color : null,
    metersPer100g: cleanNumber(s.metersPer100g != null ? s.metersPer100g : (s.meterage && s.meterage.metersPer100g)) ?? undefined
  };
}

function strandPool(opts) {
  const provided = Array.isArray(opts.pool) ? opts.pool : Array.isArray(opts.yarns) ? opts.yarns : null;
  const source = provided || safeAll();
  return source.map(normaliseStrand).filter(Boolean);
}
function safeAll() { try { return getDefaultDatabase().all(); } catch (_) { return []; } }

/**
 * Rank the ways to reach a target gauge by holding one or more strands together.
 *
 * @param {number} targetStsPer10cm the gauge the pattern wants
 * @param {{pool?:object[], yarns?:object[], max?:number, limit?:number}} [opts] candidate yarns
 *   (defaults to the built-in registry), max strands to hold, and how many plans to return
 * @returns {{ok:true,target:number,poolSize:number,count:number,picks:object[],best:object,headline:string}|null}
 *   `null` when there is no usable target or no yarn with a gauge — so the panel hides the section.
 */
export function summariseHoldForGauge(targetStsPer10cm, opts = {}) {
  const target = cleanNumber(targetStsPer10cm);
  if (target == null || target <= 0) return null;
  const pool = strandPool(opts);
  if (!pool.length) return null;
  const max = intOrDefault(opts.max, 3);
  const limit = intOrDefault(opts.limit, 6);

  let results;
  try { results = suggestHoldForGauge(target, pool, max); } catch (_) { return null; }
  if (!Array.isArray(results) || !results.length) return null;

  const picks = results.slice(0, limit).map((combo) => ({
    names: combo.strands.map((s) => s.name),
    brands: combo.strands.map((s) => s.brand),
    count: combo.strands.length,
    predicted: cleanNumber(combo.predicted) ?? 0,
    error: cleanNumber(combo.error) ?? 0,
    within: (cleanNumber(combo.error) ?? 99) <= 1
  }));

  const bestCombo = results[0];
  let detail = { rowsPer10cm: null, marledColor: null, notes: [] };
  try { detail = holdStrands(bestCombo.strands); } catch (_) { /* keep the light shape */ }
  const best = {
    names: bestCombo.strands.map((s) => s.name),
    count: bestCombo.strands.length,
    single: bestCombo.strands.length === 1,
    predicted: cleanNumber(bestCombo.predicted) ?? 0,
    error: cleanNumber(bestCombo.error) ?? 0,
    within: (cleanNumber(bestCombo.error) ?? 99) <= 1,
    combinedRows: cleanNumber(detail.rowsPer10cm),
    marledColor: detail.marledColor || null,
    notes: Array.isArray(detail.notes) ? detail.notes.slice(0, 3) : []
  };

  const label = best.count === 1 ? best.names[0] : best.names.join(' + ');
  const headline = best.within
    ? `Hold ${label} → ${best.predicted} sts/10cm (within ${best.error})`
    : `Closest: ${label} ≈ ${best.predicted} sts/10cm (${best.error} off)`;

  return { ok: true, target, poolSize: pool.length, count: picks.length, picks, best, headline };
}

/**
 * Test a colourwork field for machine hazards and legibility, using the compiler's own palette and
 * card grid (the same `ir.colors` / `ir.cardMatrix` the colour-vision preview reads).
 *
 * @param {string[]} palette hexes, indexed the same way as `grid`
 * @param {number[][]} grid a rows×cols matrix of palette indices
 * @param {{maxFloat?:number}} [opts] the longest float you will tolerate before recommending a tuck
 * @returns {{ok:true,safe:boolean,longFloatCount:number,tuckRows:number[],floats:object[],contrast:object[],colorsUsed:number,paletteLen:number,headline:string}|null}
 *   `null` when there is no grid or no palette to test.
 */
export function summariseFairIsle(palette, grid, opts = {}) {
  const hexes = Array.isArray(palette) ? palette.filter((h) => typeof h === 'string' && h) : [];
  const matrix = Array.isArray(grid) ? grid.filter((r) => Array.isArray(r) && r.length) : [];
  if (!hexes.length || !matrix.length) return null;
  const maxFloat = intOrDefault(opts.maxFloat, 5);

  let plan;
  try { plan = fairIslePlan(hexes, matrix, maxFloat); } catch (_) { return null; }
  const floatWarnings = Array.isArray(plan.floatWarnings) ? plan.floatWarnings : [];
  const contrastIssues = Array.isArray(plan.contrastIssues) ? plan.contrastIssues : [];
  const tuckRows = Array.isArray(plan.suggestedTuckRows) ? plan.suggestedTuckRows.slice() : [];
  const floats = floatWarnings.slice(0, 12).map((f) => ({ row: f.row, col: f.col, length: f.length }));
  const contrast = contrastIssues.slice(0, 8).map((ci) => ({
    a: ci.colors && ci.colors[0], b: ci.colors && ci.colors[1], note: ci.note || ''
  }));
  const used = new Set();
  for (const r of matrix) for (const v of r) used.add(v);
  const safe = !floatWarnings.length && !contrastIssues.length;
  const headline = safe
    ? 'Floats short, contrast good — machine-safe'
    : `${floatWarnings.length} long float${floatWarnings.length === 1 ? '' : 's'} · ${contrastIssues.length} low-contrast pair${contrastIssues.length === 1 ? '' : 's'}`;

  return { ok: true, safe, longFloatCount: floatWarnings.length, tuckRows, floats, contrast, colorsUsed: used.size, paletteLen: hexes.length, headline };
}

/**
 * The plain-text hold-to-gauge plan. Total: a null summary returns a helpful prompt.
 * @param {object|null} summary @param {{title?:string}} [opts] @returns {string} trailing newline
 */
export function holdPlanToText(summary, opts = {}) {
  const title = opts.title || 'Hold strands to hit gauge';
  if (!summary || !summary.ok || !Array.isArray(summary.picks) || !summary.picks.length) {
    return 'Give a target gauge (stitches per 10 cm) and KNITCAT will suggest which strands to hold together.\n';
  }
  const lines = [title, '='.repeat(title.length), ''];
  lines.push(`Target: ${summary.target} sts / 10 cm · searched ${summary.poolSize} yarns`, '');
  for (const p of summary.picks) {
    lines.push(`  ${p.names.join(' + ')}  →  ${p.predicted} sts/10cm  (${p.error} off)${p.within ? ' ✓' : ''}`);
  }
  lines.push('');
  if (summary.best.marledColor) lines.push(`Marled colour of the best plan: ${summary.best.marledColor}`);
  for (const n of summary.best.notes) lines.push(`  · ${n}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * The plain-text Fair Isle safety report. Total: a null summary returns a helpful prompt.
 * @param {object|null} summary @param {{title?:string}} [opts] @returns {string} trailing newline
 */
export function fairIsleToText(summary, opts = {}) {
  const title = opts.title || 'Fair Isle check';
  if (!summary || !summary.ok) {
    return 'Compile a colourwork chart and KNITCAT will check its floats and contrast for the machine.\n';
  }
  const lines = [title, '='.repeat(title.length), '', summary.headline, ''];
  if (summary.floats.length) {
    lines.push('Long floats (snag risk — tuck or weave these):');
    for (const f of summary.floats) lines.push(`  row ${f.row}, col ${f.col}: ${f.length} st float`);
  }
  if (summary.tuckRows.length) lines.push(`Suggested tuck rows: ${summary.tuckRows.join(', ')}`);
  if (summary.contrast.length) {
    lines.push('', 'Low-contrast motif pairs (may not read):');
    for (const c of summary.contrast) lines.push(`  ${c.a} vs ${c.b}: ${c.note}`);
  }
  lines.push('');
  return lines.join('\n');
}
