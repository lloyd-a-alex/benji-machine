/**
 * KNITCAT V2 — the derivation trail, made legible (spec §4.7 "explainable derivations").
 *
 * {@link module:compiler/derive derive} already computes a `decisions` array and hangs it on the
 * IR: for every headline number (cast-on, body rows) it records the *formula*, the *substituted*
 * arithmetic, the *inputs* it read and the downstream nodes it *affects*. That trail is the honest
 * answer to "why 212 stitches?" — but until now nothing showed it, so the compiler's most
 * trust-building output went unseen. This module is its hand: it turns `ir.decisions` into
 * display-ready rows and a printable text sheet, adding **no new maths** — every number is the one
 * derive already recorded, so this view can never disagree with what was actually computed.
 *
 * DOM-free, deterministic and total (never throws, tolerates garbage): safe to unit-test directly
 * under `node --test` and safe to import for its pure helpers anywhere in the app.
 *
 * @module compiler/derive-summary
 */

/**
 * Friendly titles for the value-node ids derive writes into its trail. Unknown ids fall back to a
 * humanised form of the leaf (`pattern.castOn` → "Cast on"), so a new decision always reads well
 * even before someone adds it here.
 */
export const DERIVATION_LABELS = Object.freeze({
  'pattern.castOn': 'Cast on',
  'garment.bodyRows': 'Body rows',
  'garment.finishedBust': 'Finished bust',
  'garment.length': 'Garment length',
  'gauge.stitchesPer10cm': 'Stitches / 10 cm',
  'gauge.rowsPer10cm': 'Rows / 10 cm',
  'gauge.stitchesPerCm': 'Stitches / cm',
  'gauge.stsPerCm': 'Stitches / cm',
  'body.bust': 'Bust measurement',
  'ease.chest': 'Chest ease'
});

/** Turn a dotted node id into a title-cased leaf label ("garment.body_rows" → "Body rows"). */
function humanize(node) {
  const leaf = String(node || '').split('.').pop() || String(node || '');
  return leaf
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\p{L}/u, (c) => c.toUpperCase())
    .trim();
}

/** A friendly label for a value-node id, from the table above or humanised from its leaf. */
export function derivationLabel(node) {
  const id = String(node || '');
  return DERIVATION_LABELS[id] || humanize(id) || id;
}

/** A finite number or null (so the UI can render an honest em-dash rather than NaN). */
function finiteOrNull(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Shape one raw decision into a display row, defensively. Returns null for anything that is not an
 * object carrying a string `node`, so a malformed trail never surfaces a blank or a crash.
 */
function toRow(d) {
  if (!d || typeof d !== 'object' || typeof d.node !== 'string' || !d.node) return null;
  const inputs = d.inputs && typeof d.inputs === 'object'
    ? Object.entries(d.inputs)
        .map(([node, value]) => ({ node, label: derivationLabel(node), value: finiteOrNull(value) }))
    : [];
  const affects = Array.isArray(d.affects)
    ? d.affects.map((a) => (typeof a === 'string' ? derivationLabel(a) : String(a || ''))).filter(Boolean)
    : [];
  return {
    node: d.node,
    label: derivationLabel(d.node),
    value: finiteOrNull(d.value),
    formula: typeof d.formula === 'string' ? d.formula : '',
    substitute: typeof d.substitute === 'string' ? d.substitute : '',
    inputs,
    affects
  };
}

/**
 * Summarise the explainable-derivation trail carried on an IR.
 *
 * @param {{ decisions?: Array<{ node:string, value?:number, formula?:string, substitute?:string,
 *   inputs?:object, affects?:string[] }>|null }} [ir] the compiled IR (post-optimise is fine — the
 *   passes preserve `decisions` by reference)
 * @returns {null | { ok:true, count:number, rows: Array<object> }} a display-ready summary, or
 *   `null` when there is nothing meaningful to explain (no IR, no/empty/garbage `decisions`) so the
 *   caller can skip the section rather than show an empty one.
 */
export function summariseDerivations(ir) {
  const decisions = ir && Array.isArray(ir.decisions) ? ir.decisions : null;
  if (!decisions || !decisions.length) return null;
  let rows = [];
  try {
    rows = decisions.map(toRow).filter(Boolean);
  } catch (_) {
    // A summary is advisory: if an exotic decision shape slips through, prefer showing nothing
    // over a broken panel. The compiler itself has already run.
    return null;
  }
  if (!rows.length) return null;
  return { ok: true, count: rows.length, rows };
}

/**
 * Render the trail as plain, printable text — the sheet a maker can paste into notes or a tech
 * pack, mirroring {@link module:machine/pass-sheet passSheetToText}. Every row reads like the
 * derivation it describes: the label, the resolved number, the rule, the substituted arithmetic,
 * the inputs it consumed and what it feeds downstream.
 *
 * @param {object|null} summary the result of {@link summariseDerivations}
 * @param {{ title?:string }} [opts]
 * @returns {string} a trailing-newline-terminated text block; a friendly note when there is nothing
 *   to show, so the copy button never yields an empty clipboard.
 */
export function derivationToText(summary, opts = {}) {
  const title = opts.title || 'Why these numbers';
  const rows = summary && Array.isArray(summary.rows) ? summary.rows : [];
  if (!rows.length) {
    return `${title}\n${'='.repeat(title.length)}\n\nNo derivation trail yet — compile a project and KNITCAT will show how each headline number was worked out.\n`;
  }
  const out = [title, '='.repeat(title.length), ''];
  for (const r of rows) {
    const value = r.value == null ? '?' : r.value;
    out.push(`${r.label} = ${value}`);
    if (r.formula) out.push(`  rule:      ${r.formula}`);
    if (r.substitute) out.push(`  worked:    ${r.substitute}`);
    if (r.inputs && r.inputs.length) {
      out.push(`  inputs:    ${r.inputs.map((i) => `${i.label}${i.value == null ? '' : ' = ' + i.value}`).join(', ')}`);
    }
    if (r.affects && r.affects.length) {
      out.push(`  affects:   ${r.affects.join(', ')}`);
    }
    out.push('');
  }
  return out.join('\n');
}
