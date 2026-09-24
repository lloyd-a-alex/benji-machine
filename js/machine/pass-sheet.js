/**
 * KNITCAT — the Carriage Pass Sheet (the "stand at the machine" narration).
 *
 * The planner in {@link module:machine/carriage-passes} had always been able to work out the
 * physical carriage passes a lace card needs — select, transfer, complete, park-and-return — and
 * `describePasses` could read them back in plain English. Both were used only *internally* (the
 * optimiser's timing model and the production quote), so a knitter standing at the machine could
 * never actually see the pass list. This module is that missing hand: it turns a chart plus a
 * machine profile into an at-the-machine pass sheet — a summary of how many passes, which rows are
 * lace versus plain, where the carriage starts and ends, the honest warnings the planner raised —
 * and the numbered lines to follow.
 *
 * DOM-free and total: it never throws, degrades to `ok:false` with a message on a broken input, so
 * it is safe to call on a half-built card and straightforward to assert directly.
 *
 * @module machine/pass-sheet
 */

import { planPatternPasses, describePasses, SIDE } from './carriage-passes.js';

/** Case-insensitive side token → the planner's `SIDE` enum (defaults to a left park). */
function toSide(value) {
  const v = String(value || '').toUpperCase();
  return v === SIDE.RIGHT ? SIDE.RIGHT : SIDE.LEFT;
}

/** Tally the passes by purpose so the header can say "4 select · 4 transfer · …". */
function countByPurpose(passes) {
  const out = {};
  for (const p of passes) {
    const key = (p && p.purpose) || 'other';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

/**
 * Build a pass sheet for a chart.
 *
 * @param {Array<Array<any>>} matrix the working grid — lace-mode stitch symbols bottom-up, or a
 *   0/1 direct-mode card (which simply knits as one plain pass per row).
 * @param {object} [options]
 * @param {string} [options.mode]        pattern mode (informational; the planner reads symbols)
 * @param {object} [options.profile]     machine profile carrying carriage mechanics
 * @param {'LEFT'|'RIGHT'|'left'|'right'} [options.startSide] where the carriage parks to start
 * @param {number} [options.cardRowOffset] first card row index, for stitching sheets together
 * @returns {{
 *   ok: boolean, error?: string,
 *   mode: string, startSide: string, endsOn: string,
 *   patternRows: number, laceRows: number, plainRows: number, cardRows: number,
 *   totalPasses: number, lacePasses: number, knitPasses: number, passesPerLaceRow: number[],
 *   carriages: Record<string, number>,
 *   rows: Array<{row:number, kind:string, passes:number, transfers:number}>,
 *   lines: string[], warnings: string[], assumptions: string[]
 * }}
 */
export function buildPassSheet(matrix, { mode = 'lace', profile = null, startSide = SIDE.LEFT, cardRowOffset = 0 } = {}) {
  const grid = Array.isArray(matrix) ? matrix : [];
  const empty = {
    ok: true, mode, startSide: toSide(startSide), endsOn: toSide(startSide),
    patternRows: grid.length, laceRows: 0, plainRows: 0, cardRows: 0,
    totalPasses: 0, lacePasses: 0, knitPasses: 0, passesPerLaceRow: [],
    carriages: {}, rows: [], lines: [], warnings: [], assumptions: []
  };
  if (!grid.length) return empty;

  let plan;
  try {
    plan = planPatternPasses(grid, { profile: profile || {}, startSide: toSide(startSide), cardRowOffset });
  } catch (err) {
    // The planner is total in practice, but a pass sheet must never be the thing that breaks a panel.
    return { ...empty, ok: false, error: err && err.message ? err.message : String(err) };
  }
  if (!plan || !plan.ok) {
    return { ...empty, ok: false, error: (plan && plan.error) || 'The planner could not read this card.' };
  }

  const passes = Array.isArray(plan.passes) ? plan.passes : [];
  const t = plan.totals || {};
  return {
    ok: true,
    mode,
    startSide: plan.startSide,
    endsOn: plan.endsOn,
    patternRows: t.patternRows != null ? t.patternRows : grid.length,
    laceRows: t.laceRows || 0,
    plainRows: t.plainRows || 0,
    cardRows: plan.cardRows || 0,
    totalPasses: t.passes != null ? t.passes : passes.length,
    lacePasses: t.lacePasses || 0,
    knitPasses: t.knitPasses || 0,
    passesPerLaceRow: Array.isArray(t.passesPerLaceRow) ? t.passesPerLaceRow : [],
    carriages: countByPurpose(passes),
    rows: (plan.rows || []).map((r) => ({
      row: (r.row != null ? r.row : 0) + 1,
      kind: r.kind || 'plain',
      passes: r.passCount != null ? r.passCount : ((r.passes && r.passes.length) || 0),
      transfers: r.transfers || 0
    })),
    lines: describePasses(plan).map((line, i) => line.replace(/^Pass \d+:/, `Pass ${i + 1}:`)),
    warnings: Array.isArray(plan.warnings) ? plan.warnings.filter((w) => typeof w === 'string' && w) : [],
    assumptions: Array.isArray(plan.assumptions) ? plan.assumptions.filter((w) => typeof w === 'string' && w) : []
  };
}

/**
 * Render a pass sheet as a plain-text block for the clipboard, a download or the printer — the
 * "printed pattern notes" the planner's own doc-comment promised. Deterministic and dependency
 * free, so the exact bytes are assertable.
 *
 * @param {ReturnType<typeof buildPassSheet>} sheet
 * @param {{title?:string, profileLabel?:string}} [meta]
 * @returns {string}
 */
export function passSheetToText(sheet, { title = 'Carriage Pass Sheet', profileLabel = '' } = {}) {
  if (!sheet || !sheet.ok) {
    return `${title}\n${'='.repeat(title.length)}\n\nNo pass sheet: ${(sheet && (sheet.error || 'planner failed')) || 'nothing to plan'}.`;
  }
  const head = [];
  head.push(title);
  head.push('='.repeat(title.length));
  if (profileLabel) head.push(`Machine: ${profileLabel}`);
  head.push(`Start ${labelSide(sheet.startSide)} · End ${labelSide(sheet.endsOn)}`);
  head.push(`${sheet.patternRows} pattern row(s) · ${sheet.laceRows} lace, ${sheet.plainRows} plain · ${sheet.totalPasses} carriage pass(es) over ${sheet.cardRows} card row(s)`);
  const lines = [];
  for (const line of sheet.lines || []) lines.push(line);
  const tail = [];
  if (sheet.assumptions && sheet.assumptions.length) {
    tail.push('', 'Assumptions:');
    for (const a of sheet.assumptions) tail.push(`  • ${a}`);
  }
  if (sheet.warnings && sheet.warnings.length) {
    tail.push('', 'Watch out:');
    for (const w of sheet.warnings) tail.push(`  ! ${w}`);
  }
  return [head.join('\n'), '', lines.join('\n'), ...tail].join('\n') + '\n';
}

/** 'LEFT'/'RIGHT' → 'left'/'right' for a human sentence. */
function labelSide(side) {
  return String(side || '').toLowerCase() || 'left';
}
