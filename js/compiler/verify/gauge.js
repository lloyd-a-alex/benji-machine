/**
 * KNITCAT V2 — gauge verification (spec §4.5 "does the yarn produce the gauge the pattern
 * assumes?"). Compares the IR's gauge to the yarn's own gauge range (via the Project graph) and
 * warns when the pattern was drafted at a gauge the chosen yarn cannot hold. DOM-free.
 *
 * @module compiler/verify/gauge
 */
import { makeResult } from './_result.js';

export function verifyGauge(ir, project) {
  const sts = num(ir.gauge.stsPer10cm);
  const rows = num(ir.gauge.rowsPer10cm);
  if (!sts || !rows) {
    return makeResult('gauge', 'warn', 'Gauge is not set — measurements are provisional.', 'Knit a swatch and set gauge.stitchesPer10cm / rowsPer10cm.');
  }
  if (sts < 6 || sts > 60) {
    return makeResult('gauge', 'fail', `Gauge ${sts} sts/10cm is outside any knittable range.`, 'Check the swatch — a machine gauge is 1.5–12 sts/cm.', { sts, rows });
  }
  // Stitch:row ratio sanity — real stockinette is ~1.2–1.8 rows per stitch.
  const ratio = rows / sts;
  if (ratio < 0.8 || ratio > 2.6) {
    return makeResult('gauge', 'warn', `Row:stitch ratio ${round2(ratio)} is unusual — lengths may drift.`, 'Re-swatch measuring both stitch and row gauge.', { sts, rows, ratio: round2(ratio) });
  }
  // Cross-check the yarn's advertised range if a project is attached.
  const yarnSts = (project && project.get && (!project.has || project.has('yarn.gaugeStitches'))) ? project.get('yarn.gaugeStitches') : null;
  if (Array.isArray(yarnSts) && yarnSts.length === 2) {
    if (sts < yarnSts[0] - 3 || sts > yarnSts[1] + 3) {
      return makeResult('gauge', 'warn', `Pattern gauge ${sts} is outside the yarn's ${yarnSts[0]}–${yarnSts[1]} sts/10cm.`, 'Change needle size or yarn; re-swatch.', { sts, yarnSts });
    }
  }
  return makeResult('gauge', 'pass', `Gauge ${sts} × ${rows} / 10 cm is consistent.`, '', { sts, rows });
}

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
