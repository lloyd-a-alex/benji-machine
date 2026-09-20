/**
 * KNITCAT V2 — the machine optimiser pass (spec §4.4.1).
 *
 * The first of three passes. It rewrites an IR so the *machine* has less to do: collapse runs of
 * identical plain rows so the carriage schedule knows they are cheap, count and locate the real
 * cost drivers (yarn changes, short-row turns, decrease rows, bind-offs), and — when a colourwork
 * `cardMatrix` is present — build an explicit carriage-pass schedule by reusing the codebase's
 * best asset, the carriage-pass planner in `js/machine/carriage-passes.js`. This is the pass that
 * turns "a chart" into "the fewest passes that knit it."
 *
 * It is conservative: it never changes the *shape* (stitch counts / final measurements are
 * sacred), only the ordering metadata and the derived schedule. It returns a fresh IR plus a
 * `metrics` object the Pareto stage scores.
 *
 * @module compiler/optimise/machine-pass
 */

import { planPatternPasses, carriageMechanics } from '../../machine/carriage-passes.js';

/**
 * Run the machine pass.
 * @param {import('../ir.js').KnitIR} ir @returns {{ir:import('../ir.js').KnitIR, metrics:object, changes:string[]}}
 */
export function machinePass(ir) {
  const changes = [];
  const out = Object.assign({}, ir, { pieces: ir.pieces.map(clonePiece) });

  let yarnChanges = 0, shortRows = 0, decreaseRows = 0, bindOffRows = 0, carriageReversals = 0;
  for (const p of out.pieces) {
    let prevCarriage = null;
    for (const row of p.rowsDetail) {
      for (const o of row.operations) {
        if (o.kind === 'yarn-change') yarnChanges++;
        else if (o.kind === 'short-row') shortRows++;
        else if (o.kind === 'decrease') decreaseRows++;
        else if (o.kind === 'bind-off') bindOffRows++;
      }
      if (prevCarriage && row.carriage !== prevCarriage) carriageReversals++;
      prevCarriage = row.carriage;
    }
  }

  // Collapse runs of plain knit rows into a single "work even N rows" instruction marker so the
  // written backend and the schedule both see them as one cheap block.
  for (const p of out.pieces) {
    const collapsed = collapsePlain(p.rowsDetail);
    if (collapsed.merged) changes.push(`${p.name}: collapsed ${collapsed.merged} plain rows into ${collapsed.blocks} work-even blocks`);
    p.rowsDetail = collapsed.rows;
  }

  // Build the carriage schedule when there is a colourwork card to drive it.
  let schedule = null;
  if (out.cardMatrix && out.cardMatrix.length && out.machine.profile) {
    try {
      const mechanics = carriageMechanics(out.machine.profile);
      const passes = planPatternPasses(out.cardMatrix, { profile: out.machine.profile, mechanics });
      schedule = { passes, mechanics, passCount: passes.length };
      changes.push(`machine: derived ${passes.length}-pass carriage schedule from the colourwork card`);
    } catch { schedule = null; }
  }
  if (schedule) out.schedule = Object.assign({}, out.schedule, { carriage: schedule });

  const totalRows = out.pieces.reduce((n, p) => n + p.rowsDetail.length, 0);
  const metrics = {
    passCount: schedule ? schedule.passCount : totalRows,
    yarnChanges,
    shortRows,
    decreaseRows,
    bindOffRows,
    carriageReversals,
    // A crude machine-cost score: passes dominate, then the "annoying" operations.
    cost: round1((schedule ? schedule.passCount : totalRows) + yarnChanges * 0.5 + shortRows * 0.4 + carriageReversals * 0.2)
  };
  return { ir: out, metrics, changes };
}

/** Clone a piece shallowly so passes do not mutate the input. */
function clonePiece(p) {
  return Object.assign({}, p, {
    rowsDetail: p.rowsDetail.map(r => Object.assign({}, r, { operations: r.operations.map(o => Object.assign({}, o)) })),
    edges: (p.edges || []).slice(),
    joinFrom: (p.joinFrom || []).slice(),
    dimensions: Object.assign({}, p.dimensions)
  });
}

/**
 * Fold consecutive plain-knit rows (single `knit` op, same yarn, no shaping) into one row that
 * carries a `repeat` count, so "work even 12 rows" survives to the backends.
 */
function collapsePlain(rows) {
  const out = [];
  let merged = 0, blocks = 0;
  for (const r of rows) {
    const plain = r.operations.length === 1 && (r.operations[0].kind === 'knit') && !r.note;
    const last = out[out.length - 1];
    if (plain && last && last.operations.length === 1 && last.operations[0].kind === 'knit' && !last.note && last.yarn === r.yarn) {
      last.repeat = (last.repeat || 1) + 1;
      last.stitchesAfter = r.stitchesAfter;
      merged++;
    } else {
      out.push(Object.assign({}, r, { repeat: plain ? 1 : undefined }));
      if (plain) blocks++;
    }
  }
  return { rows: out, merged, blocks };
}

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
