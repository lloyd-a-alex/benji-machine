/**
 * KNITCAT V2 — the appearance optimiser pass (spec §4.4.3).
 *
 * The third pass looks only at how the finished garment will *read*. Its heuristics:
 *   - match colourwork repeats across pieces so a yoke motif does not land a half-repeat off on
 *     one sleeve (flag the pieces whose cast-on is not a multiple of the repeat width),
 *   - recommend seam placement away from the centre of a visible panel,
 *   - flag low-contrast colourwork pairs (reusing the colour engine's WCAG check) so the knitter
 *     picks colours that actually show the motif at machine gauge.
 *
 * It annotates the IR (`appearance` notes on pieces and a top-level `appearance` block) and
 * scores an appearance "cost" (0 = nothing to improve). Shape-preserving, DOM-free.
 *
 * @module compiler/optimise/appearance-pass
 */

import { analyzeColorLegibility } from '../../core/color-legibility.js';
import { adjacentColorPairs } from '../../core/chart-analysis.js';

/**
 * Run the appearance pass.
 * @param {import('../ir.js').KnitIR} ir @returns {{ir:import('../ir.js').KnitIR, metrics:object, changes:string[]}}
 */
export function appearancePass(ir) {
  const changes = [];
  const out = Object.assign({}, ir, { pieces: ir.pieces.map(p => Object.assign({}, p, { appearance: {} })) });
  const repeat = repeatWidth(ir);
  let issues = 0;

  // 1. Repeat alignment across pieces.
  if (repeat > 1) {
    for (const p of out.pieces) {
      const rem = p.stitches % repeat;
      if (rem !== 0) {
        p.appearance.repeatOffset = rem;
        p.appearance.repeatNote = `cast-on off the ${repeat}-st repeat by ${rem} — motif will not align across the seam`;
        issues++;
      }
    }
    if (issues) changes.push(`appearance: ${issues} piece(s) do not align to the ${repeat}-st colourwork repeat`);
  }

  // 2. Contrast of the colourwork palette — the SAME adjacency-aware analysis the verifier uses
  //    (core/color-legibility.js), so the optimiser and the verify pass can never disagree about
  //    one palette. Only colours that actually touch on the card are judged, so a non-adjacent
  //    near-match is no longer a false alarm.
  const matrix = Array.isArray(ir.cardMatrix) && Array.isArray(ir.cardMatrix[0]) ? ir.cardMatrix : null;
  const legibility = analyzeColorLegibility(ir.colors || [], { adjacency: matrix ? adjacentColorPairs(matrix, 'fair_isle') : null });
  const contrastIssues = legibility.low.map((p) => ({ pair: p.labels, ratio: p.ratio }));
  issues += contrastIssues.length;
  if (contrastIssues.length) changes.push(`appearance: ${contrastIssues.length} neighbouring colour pair(s) below 3:1 contrast — the motif may not read`);

  // 3. Seam placement note (heuristic: put side seams a third in from centre back).
  for (const p of out.pieces) if (/body/i.test(p.id) && p.stitches > 0) p.appearance.seamNote = 'place side seams ~1/3 in from centre-back for a flattering front';

  out.appearance = { repeat, repeatIssues: issues - contrastIssues.length, contrastIssues, score: issues };
  const metrics = { issues, contrastIssues: contrastIssues.length, repeatIssues: issues - contrastIssues.length, cost: round1(issues * 1.5) };
  return { ir: out, metrics, changes };
}

/** The colourwork repeat width, from the card matrix period or the chart spec, else 0. */
function repeatWidth(ir) {
  const cm = ir.cardMatrix;
  if (Array.isArray(cm) && cm.length && Array.isArray(cm[0])) {
    const row = cm[0];
    for (let w = 1; w <= row.length; w++) {
      if (row.length % w) continue;
      let ok = true;
      for (let c = w; c < row.length; c++) if (row[c] !== row[c - w]) { ok = false; break; }
      if (ok) return w;
    }
    return row.length;
  }
  return 0;
}

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
