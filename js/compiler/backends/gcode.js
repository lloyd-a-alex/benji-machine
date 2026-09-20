/**
 * KNITCAT V2 — the G-code backend (spec §4.6.6).
 *
 * For the members who own a CNC punch, laser or solenoid card-maker: real machine toolpaths, not
 * a picture. `CncGcodeExporter` already produces optimised (2-opt TSP ordered) G-code from a
 * machine profile and a boolean card; this backend wires the IR to it and exposes the run stats a
 * shop-floor operator cares about — rapid vs plunge distance, hole count, an estimated cycle time
 * and the safe-Z / plunge-Z the job runs at — so nobody has to open the file in a simulator to
 * know roughly how long the card will take to punch. Pure `(ir, options) => {gcode, meta}`. DOM-free.
 *
 * @module compiler/backends/gcode
 */

import { CncGcodeExporter } from '../../exporters/cnc-gcode.js';
import { punchMatrix, resolveProfile } from './_card.js';

/**
 * Compile an IR into CNC/laser G-code.
 * @param {object} ir
 * @param {{machineType?:('laser'|'solenoid'|'cnc_drill'), columns?:number, rows?:number, feedRapid?:number}} [options]
 * @returns {{gcode:string, meta:object}}
 */
export function gcodeBackend(ir, options = {}) {
  const profile = resolveProfile((ir && ir.machine) || 'brother_standard_24');
  const card = punchMatrix(ir, { ...options, columns: options.columns || profile.columns });
  const exporter = new CncGcodeExporter({
    machineType: options.machineType || 'cnc_drill',
    feedRapid: options.feedRapid || 3000,
    optimizePath: options.optimizePath !== false
  });

  let gcode = '';
  const errors = [];
  try {
    gcode = exporter.generateGCode(profile, card.matrix);
  } catch (e) { errors.push(`gcode: ${e && e.message ? e.message : e}`); }

  // Rough cycle-time model: one plunge per hole at the feed, plus a rapid move between holes.
  const holes = card.matrix.reduce((n, r) => n + r.filter(Boolean).length, 0);
  const rapidMm = holes * Math.max(profile.pitchX || 4.5, profile.pitchY || 5.08);
  const feed = options.feedRapid || 3000; // mm/min
  const plungeSec = 0.6; // per hole, dwell + retract
  const estSeconds = Math.round((rapidMm / feed) * 60 + holes * plungeSec);

  const meta = {
    machine: profile.name, machineType: options.machineType || 'cnc_drill',
    columns: card.columns, rows: card.rows, holes,
    rapidDistanceMm: round1(rapidMm), estimatedSeconds: estSeconds,
    estimatedMinutes: round1(estSeconds / 60), truncated: card.truncated,
    notes: card.notes.slice(), errors
  };
  return { gcode, meta };
}

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
