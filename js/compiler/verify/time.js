/**
 * KNITCAT V2 — time verification (spec §4.5 "is the estimated time reasonable?").
 *
 * Sanity on the clock: recompute a plausible machine-hour figure from the IR (rows, carriage
 * passes, and the fiddly operations that cost real time — short rows, yarn changes, bind-offs) at
 * a stated stitches-per-minute, then compare it to the graph's `time.totalHours` if one exists. A
 * pattern "estimated" at 0.2 hours for a sweater, or 200 hours for a hat, is a bug — and this says
 * so with the number to fix it. DOM-free.
 *
 * @module compiler/verify/time
 */
import { makeResult } from './_result.js';

/** Stitches a machine knitter actually completes per minute, all-in (a generous average). */
const DEFAULT_STPM = 130;

export function verifyTime(ir, project, options = {}) {
  const get = id => (project && project.get ? project.get(id) : undefined);
  const stpm = Number(options.stitchesPerMinute) || DEFAULT_STPM;
  const stats = timeStats(ir);
  // Passes dominate; add a per-operation penalty for the fiddly bits.
  const rawMinutes = stats.passes * (stats.avgWidth / stpm) * 60 / 60 + stats.shortRows * 1.5 + stats.yarnChanges * 0.75 + stats.bindOffs * 1.2;
  const estimated = round2(rawMinutes / 60);
  const claimed = num(get('time.totalHours'));

  if (!stats.pieces) return makeResult('time', 'warn', 'No pieces to estimate time from.', 'Re-derive the IR from the Fit Engine.');
  if (estimated < 0.1) return makeResult('time', 'fail', `Estimated build time ${estimated}h is implausibly low.`, 'Check the row/pass counts — likely a gauge/row bug.', { estimated, stats });
  if (estimated > 200) return makeResult('time', 'warn', `Estimated build time ${estimated}h is enormous for one garment.`, 'Confirm this is a big/batched piece, or re-check pass counts.', { estimated });
  if (claimed && Math.abs(claimed - estimated) / estimated > 0.6) {
    return makeResult('time', 'warn', `Graph says ${round1(claimed)}h but the IR implies ~${estimated}h (±60%).`, `Reconcile time.totalHours with ~${estimated}h.`, { claimed, estimated });
  }
  return makeResult('time', 'pass', `Estimated build time ${estimated}h — reasonable for ${stats.pieces} piece(s).`, '', { estimated, stats });
}

function timeStats(ir) {
  let passes = 0, shortRows = 0, yarnChanges = 0, bindOffs = 0, widthSum = 0, widthN = 0;
  for (const p of (ir.pieces || [])) {
    for (const r of p.rowsDetail) {
      passes += (r.repeat || 1);
      widthSum += r.stitchesBefore; widthN++;
      for (const o of r.operations) {
        if (o.kind === 'short-row') shortRows++;
        else if (o.kind === 'yarn-change') yarnChanges++;
        else if (o.kind === 'bind-off') bindOffs++;
      }
    }
  }
  return { passes, shortRows, yarnChanges, bindOffs, avgWidth: widthN ? widthSum / widthN : 0, pieces: (ir.pieces || []).length };
}

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
