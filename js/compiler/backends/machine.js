/**
 * KNITCAT V2 — the machine backend (spec §4.6.3).
 *
 * Machine-specific instructions: the carriage schedule, per-row carriage + setting, punchcard-row
 * mapping and needle positions — the thing you read *at the machine*. It consumes the carriage
 * schedule the machine optimiser attached (from the codebase's own carriage-pass planner) and,
 * failing that, derives a plain pass list from the IR rows. DOM-free; returns a text sheet.
 *
 * @module compiler/backends/machine
 */

/** @param {object} ir @returns {string} a machine instruction sheet */
export function machineBackend(ir) {
  const L = [];
  const mach = ir.machine || {};
  L.push(`MACHINE INSTRUCTIONS — ${ir.metadata && ir.metadata.name ? ir.metadata.name : 'pattern'}`);
  L.push(`Machine: ${mach.id || 'standard'}   Bed: ${mach.bedStitches || '?'} needles   Pitch: ${mach.gaugeMm || '?'}mm   Carriage: ${mach.carriage || 'knit'}`);
  L.push(`Gauge: ${num(ir.gauge.stsPer10cm)} sts x ${num(ir.gauge.rowsPer10cm)} rows / 10cm`);
  L.push('');

  const sched = ir.schedule && ir.schedule.carriage;
  if (sched && Array.isArray(sched.passes) && sched.passes.length) {
    L.push(`CARRIAGE SCHEDULE — ${sched.passCount || sched.passes.length} passes`);
    L.push('pass  side    carriage  needles  note');
    sched.passes.slice(0, 200).forEach((p, i) => {
      L.push(`${String(i + 1).padStart(4)}  ${String(p.side || (i % 2 ? 'R' : 'L')).padEnd(6)} ${String(p.carriage || p.type || 'knit').padEnd(9)} ${String(p.needles != null ? p.needles : (p.width || '')).padEnd(8)} ${p.note || p.purpose || ''}`);
    });
    L.push('');
  }

  for (const piece of ir.pieces || []) {
    L.push(`PIECE: ${piece.name || piece.id}  (cast on ${piece.stitches}, ${piece.rows} rows)`);
    const settings = summariseSettings(piece);
    for (const s of settings) L.push(`  rows ${s.rows}: carriage ${s.carriage}, setting ${s.setting}${s.yarn && s.yarn !== 'main' ? `, yarn ${s.yarn}` : ''} — ${s.note}`);
    L.push('');
  }
  L.push('Set the tension dial to taste after a test row; knit two test rows before committing to the cast-on.');
  return L.join('\n');
}

/** Group consecutive rows sharing the same carriage/setting into ranges for the sheet. */
function summariseSettings(piece) {
  const out = [];
  let cur = null;
  let idx = 0;
  for (const row of piece.rowsDetail || []) {
    idx++;
    const op = (row.operations || [])[0] || {};
    const setting = settingFor(op.kind);
    const key = `${row.carriage}|${setting}|${row.yarn}`;
    if (cur && cur.key === key) { cur.end = idx; cur.count += (row.repeat || 1); continue; }
    cur = { key, carriage: row.carriage, setting, yarn: row.yarn, start: idx, end: idx, count: row.repeat || 1, note: op.kind === 'knit' ? 'plain knit' : op.kind };
    out.push(cur);
  }
  return out.map(s => ({ rows: s.start === s.end ? `${s.start}` : `${s.start}-${s.end}`, carriage: s.carriage, setting: s.setting, yarn: s.yarn, note: s.note }));
}

function settingFor(kind) {
  switch (kind) {
    case 'short-row': return 'row-position lever';
    case 'bind-off': return 'knit, then bind off';
    case 'decrease': return 'knit + hand transfer';
    case 'increase': return 'knit + hand make-one';
    case 'rib': return 'ribber / KC II';
    case 'transfer': return 'lace carriage';
    default: return 'KC II stockinette';
  }
}
function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
