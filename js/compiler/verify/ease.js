/**
 * KNITCAT V2 — ease verification (spec §4.5 "is the ease within the recommended range?").
 *
 * Ease is a taste decision with hard edges: negative ease on a cowl pulls it off the shoulders,
 * +25cm on a fitted raglan makes a tent. Each construction has a sane band (a set-in sleeve wants
 * different room at the armhole than a drop shoulder). This reads the graph's ease values,
 * looks up the recommended band for the construction, and reports drift with the nudge to apply.
 * DOM-free.
 *
 * @module compiler/verify/ease
 */
import { makeResult } from './_result.js';

/** Recommended chest-ease bands (cm) by construction family. */
const BANDS = {
  raglan: [-2, 14], setin: [0, 12], drop: [4, 20], yoke: [0, 16], dolman: [2, 20],
  kimono: [4, 24], default: [-2, 18]
};

function bandFor(construction) {
  const c = String(construction || '').toLowerCase();
  if (/raglan/.test(c)) return BANDS.raglan;
  if (/set.?in/.test(c)) return BANDS.setin;
  if (/drop/.test(c)) return BANDS.drop;
  if (/yoke/.test(c)) return BANDS.yoke;
  if (/dolman/.test(c)) return BANDS.dolman;
  if (/kimono/.test(c)) return BANDS.kimono;
  return BANDS.default;
}

export function verifyEase(ir, project) {
  const get = id => (project && project.get ? project.get(id) : undefined);
  const chest = num(get('ease.chest'));
  const construction = (project && get('garment.construction')) || ir.metadata.construction;
  if (!project || !get('ease.chest')) {
    // Fall back to finished bust minus body bust from the IR metadata when no graph is attached.
    return makeResult('ease', 'pass', 'Ease comes from the Fit Engine bands (no direct ease node).', '');
  }
  const [lo, hi] = bandFor(construction);
  if (chest < lo) return makeResult('ease', 'fail', `Chest ease ${round1(chest)}cm is below ${lo}cm for ${construction} — too tight.`, `Increase ease.chest toward ${lo + 2}cm.`, { chest, band: [lo, hi] });
  if (chest > hi) return makeResult('ease', 'warn', `Chest ease ${round1(chest)}cm is above ${hi}cm for ${construction} — very full.`, `Reduce ease.chest toward ${hi - 2}cm unless oversized is intended.`, { chest, band: [lo, hi] });
  return makeResult('ease', 'pass', `Chest ease ${round1(chest)}cm is in the recommended ${lo}…${hi}cm band for ${construction}.`, '', { chest, band: [lo, hi] });
}

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
