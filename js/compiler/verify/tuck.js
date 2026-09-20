/**
 * KNITCAT V2 — tuck verification (spec §4.5 "are there any tuck columns over the limit?").
 *
 * A tuck needle holds several unused loops stacked in the latch; past a few rows in the SAME
 * column it spills and drops. Where the IR (or an added tuck plan from the float fixer) stacks
 * tucks in a column longer than the machine safely can, this flags the exact column and run and
 * tells the knitter to split it with a knit row. DOM-free.
 *
 * @module compiler/verify/tuck
 */
import { makeResult } from './_result.js';

/** Rows a single needle can tuck before it risks dropping (conservative). */
const MAX_TUCK_STACK = 6;

export function verifyTuck(ir, project, options = {}) {
  const limit = Number(options.maxTuck) || MAX_TUCK_STACK;
  const columns = tuckColumns(ir);
  const offenders = columns.filter(c => c.run > limit);
  if (offenders.length) {
    const worst = offenders.reduce((a, b) => (b.run > a.run ? b : a));
    return makeResult('tuck', 'fail', `Tuck column ${worst.col} runs ${worst.run} rows (max ${limit}).`, `Knit that needle at row ${worst.start + limit} to clear the stack.`, { offenders });
  }
  if (!columns.length) return makeResult('tuck', 'pass', 'No tuck columns to verify.', '');
  return makeResult('tuck', 'pass', `Longest tuck stack ${Math.max(...columns.map(c => c.run))} rows — safe.`, '');
}

/** Detect, per column, the longest consecutive tuck run from the card matrix or tuck ops. */
function tuckColumns(ir) {
  const out = [];
  const plan = ir.schedule && ir.schedule.tuckPlan;
  if (Array.isArray(plan)) {
    for (const col of plan) if (col && col.run != null) out.push({ col: col.col, run: col.run, start: col.start || 1 });
    return out;
  }
  const matrix = ir.cardMatrix;
  if (!matrix || !matrix.length) return out;
  const cols = Math.max(...matrix.map(r => r.length));
  for (let c = 0; c < cols; c++) {
    let run = 0, best = 0, start = 1, cur = 0;
    for (let r = 0; r < matrix.length; r++) {
      const val = (matrix[r] || [])[c];
      // Treat a "carried"/index-blank cell as a tuck candidate.
      const tuck = val === null || val === undefined;
      if (tuck) { if (run === 0) cur = r + 1; run++; if (run > best) { best = run; start = cur; } }
      else run = 0;
    }
    if (best > 1) out.push({ col: c + 1, run: best, start });
  }
  return out;
}
