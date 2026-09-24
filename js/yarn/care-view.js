/**
 * KNITCAT V2 — the garment-care read.
 *
 * The Yarn Lab already calls `careLabel` and the report shows a single terse "Care" line,
 * but the underlying `careInstructions` engine returns a full structured regimen (wash method
 * + temperature, bleach, drying, tumble, iron setting, dry-clean flag, ISO 3758 symbols and a
 * prose paragraph) that no panel ever rendered. This is that missing read — a pure presenter
 * that calls the existing engine, normalises the result for the UI, and never re-derives
 * any care logic itself. DOM-free and total: bad input yields null, never a throw.
 *
 * @module yarn/care-view
 */

import { careInstructions } from './care.js';

/**
 * Build a UI-friendly care summary from a fibre composition and (optionally) a
 * pre-computed behaviour object (from `behaviourFor`). Delegates to the existing
 * care engine; never duplicates its logic.
 *
 * @param {Array|object|string|null} fiber the yarn's fibre list (from a normalized Yarn).
 * @param {object} [behaviour] blended behaviour scores ({drape, stretch, felting, recovery, …}).
 * @returns {{ok:true, wash:string, washTempC:number, dry:string, tumble:boolean, iron:string,
 *   bleach:boolean, dryClean:boolean, symbols:string[], text:string, tone:string, headline:string}|null}
 */
export function summariseCare(fiber, behaviour) {
  if (!fiber) return null;
  const t = typeof fiber;
  if (t !== 'string' && t !== 'object') return null; // reject numbers, booleans, symbols
  if (typeof fiber === 'string' && !fiber.trim()) return null;
  if (Array.isArray(fiber) && fiber.length === 0) return null;
  if (typeof fiber === 'object' && !Array.isArray(fiber) && Object.keys(fiber).length === 0) return null;

  let care;
  try {
    care = careInstructions(fiber, behaviour);
  } catch (_) {
    return null;
  }
  if (!care || typeof care !== 'object' || !care.wash) return null;

  // Tone reflects how demanding the care is:
  // - dry cleanable → 'info' (there is a simple alternative)
  // - hand wash → 'warn' (requires attention)
  // - machine washable → 'ok'
  const isHand = /hand/i.test(care.wash);
  const tone = care.dryClean ? 'info' : isHand ? 'warn' : 'ok';
  const headline = care.text || `Wash ${care.wash} at ${care.washTempC}°C`;

  return {
    ok: true,
    wash: care.wash,
    washTempC: care.washTempC,
    dry: care.dry,
    tumble: !!care.tumble,
    iron: care.iron || 'none',
    bleach: care.bleach !== false,
    dryClean: !!care.dryClean,
    symbols: Array.isArray(care.symbols) ? care.symbols.slice(0, 8) : [],
    text: care.text || '',
    tone,
    headline
  };
}

/**
 * Render a {@link summariseCare} summary as a plain-text care card, ready to paste into
 * a pattern or tech pack. Total: null → a short prompt, never a throw.
 *
 * @param {object|null} summary the result from {@link summariseCare}.
 * @param {object} [opts] @param {string} [opts.title='Garment care'] the heading.
 * @returns {string} always ends in a newline.
 */
export function careToText(summary, opts = {}) {
  const title = (opts && opts.title) || 'Garment care';
  if (!summary || !summary.ok) return 'Declare a yarn with a fibre composition to generate care instructions.\n';
  const lines = [];
  lines.push(title);
  lines.push('='.repeat(title.length));
  lines.push(summary.text);
  lines.push('');
  lines.push(`Wash: ${summary.wash} (${summary.washTempC}°C)`);
  lines.push(`Bleach: ${summary.bleach ? 'yes' : 'no'}`);
  lines.push(`Dry: ${summary.dry}`);
  lines.push(`Tumble: ${summary.tumble ? 'low' : 'do not tumble dry'}`);
  lines.push(`Iron: ${summary.iron === 'none' ? 'do not iron' : summary.iron}`);
  lines.push(`Dry clean: ${summary.dryClean ? 'okay' : 'not needed'}`);
  if (summary.symbols.length) lines.push(`Symbols: ${summary.symbols.join(' ')}`);
  return lines.join('\n') + '\n';
}
