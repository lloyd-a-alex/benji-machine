/**
 * KNITCAT V2 — colourwork colour verification (spec §4.5 "do the colours have enough contrast?").
 *
 * Two failure modes this catches before a knitter wastes a sweater: colours so close the motif
 * simply does not read (a WCAG-style luminance ratio under ~3:1), and colours that *seem* distinct
 * to the designer but collapse for a colour-blind wearer or under the specific CVD simulation. It
 * reuses the colour engine and the CVD audit rather than re-deriving anything. DOM-free.
 *
 * @module compiler/verify/color
 */
import { makeResult } from './_result.js';
import { checkContrast } from '../../yarn/color.js';
import { auditPalette, CVD_TYPES } from '../../yarn/color-blindness.js';

export function verifyColor(ir) {
  const colors = (ir.colors || []).filter(c => c && c.hex);
  if (colors.length < 2) return makeResult('color', 'pass', 'Single-colour — no colourwork contrast to check.', '');

  const low = [];
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const c = checkContrast(colors[i].hex, colors[j].hex);
      if (!c.pass) low.push({ pair: [colors[i].yarn || colors[i].hex, colors[j].yarn || colors[j].hex], ratio: c.ratio });
    }
  }
  const audit = auditPalette(colors.map(c => c.hex));
  const confusableTypes = CVD_TYPES.filter(t => audit[t] && audit[t].confusions && audit[t].confusions.length);

  if (low.length) {
    return makeResult('color', 'fail', `${low.length} colour pair(s) below 3:1 contrast — the motif will not read.`, `Darken/lighten one of: ${low.map(p => p.pair.join(' / ')).join('; ')}.`, { low, cvd: confusableTypes });
  }
  if (confusableTypes.length) {
    return makeResult('color', 'warn', `Colours pass luminance but are confusable under ${confusableTypes.join(', ')}.`, 'Add a value (light/dark) difference so the pattern survives colour-blindness.', { cvd: confusableTypes });
  }
  return makeResult('color', 'pass', `All ${colors.length} colours contrast and read under colour-blindness simulation.`, '', { count: colors.length });
}
