/**
 * KNITCAT V2 — colourwork colour verification (spec §4.5 "do the colours have enough contrast?").
 *
 * Two failure modes stop a colourwork design before a knitter wastes a sweater: colours so close in
 * value the motif simply does not read, and colours that *seem* distinct to the designer but
 * collapse under a colour-blind simulation. This is a thin verifier over the shared analysis in
 * `core/color-legibility.js` — the one implementation, also driving the appearance optimiser, so
 * the two compiler passes can never disagree about a palette. It is **adjacency-aware**: when the IR
 * carries the card matrix it judges only colour pairs that actually touch on the chart, so two
 * similar shades that never meet no longer raise a false alarm; without a matrix it falls back to
 * the conservative all-pairs audit. Reuses the colour engine and CVD model rather than re-deriving
 * anything. DOM-free.
 *
 * @module compiler/verify/color
 */
import { makeResult } from './_result.js';
import { analyzeColorLegibility } from '../../core/color-legibility.js';
import { adjacentColorPairs } from '../../core/chart-analysis.js';

export function verifyColor(ir) {
  const colors = (ir.colors || []).filter(c => c && c.hex);
  if (colors.length < 2) return makeResult('color', 'pass', 'Single-colour — no colourwork contrast to check.', '');

  // Prefer the card's real adjacency so non-touching near-matches are not flagged as defects.
  const matrix = Array.isArray(ir.cardMatrix) && Array.isArray(ir.cardMatrix[0]) ? ir.cardMatrix : null;
  const adjacency = matrix ? adjacentColorPairs(matrix, 'fair_isle') : null;
  const result = analyzeColorLegibility(colors, { adjacency });

  const extra = { low: result.low, cvd: result.confusableTypes, adjacency: result.adjacency, pairsChecked: result.pairsChecked };

  if (result.low.length) {
    return makeResult('color', 'fail',
      `${result.low.length} neighbouring colour pair(s) below 3:1 contrast — the motif will not read.`,
      `Darken/lighten one of: ${result.low.map(p => p.label).join('; ')}.`, extra);
  }
  if (result.confusableTypes.length) {
    return makeResult('color', 'warn',
      `Colours pass luminance but are confusable under ${result.confusableTypes.join(', ')}.`,
      'Add a value (light/dark) difference so the pattern survives colour-blindness.', extra);
  }
  return makeResult('color', 'pass',
    `All ${colors.length} colours contrast and read under colour-blindness simulation.`, '',
    Object.assign({ count: colors.length }, extra));
}
