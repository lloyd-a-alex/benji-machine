/**
 * KNITCAT — G-code punchcard reader.
 *
 * The reverse of `CncGcodeExporter`. Every hole the exporter punches is announced by
 * a `; Hole n/m (type)` comment immediately followed by a rapid `G00 X.. Y..` to that
 * hole's centre — before the laser arc, the solenoid `M64`, or the drill plunge that
 * follows. Reading the *first* coordinate after each `; Hole` marker recovers the true
 * centre for every machine type at once, without having to understand the cutting
 * cycle in between.
 *
 * For foreign G-code with no such comments, we fall back to collecting every `G00`
 * move that carries both an X and a Y, dropping the home / retract / perimeter points
 * (which sit on an axis at zero or trace the card outline). It is a heuristic, and the
 * warning says so.
 *
 * @module importers/gcode-import
 */

import { holesToMatrix } from './grid-quantize.js';

const MOVE_RE = /G0?[0]\b[^]*?X(-?[\d.]+)[^]*?Y(-?[\d.]+)/i;

export function looksLikeGcodeCard(text) {
  return /;\s*KNITTING MACHINE PUNCHCARD CNC PROGRAM/.test(String(text || ''));
}

/**
 * @param {string} text
 * @param {{profile?:object}} [opts]
 * @returns {{ok:boolean, matrix?:number[][], mode?:string, warnings?:string[], error?:string}}
 */
export function readGcodeCard(text, { profile } = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const warnings = [];
  const holes = [];

  // Preferred path: the exporter's own per-hole comment pins the centre exactly.
  // The comment carries the hole *type* (`(pattern_hole)` / `(sprocket)`); the tractor
  // sprocket strip is fixturing, not pattern, so — exactly like the DXF reader dropping
  // the CUT_SPROCKETS layer — sprocket moves are skipped and never reach the grid.
  let pendingCentre = false;
  let pendingSprocket = false;
  let usedComments = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^;\s*Hole\b/i.test(t)) { pendingCentre = true; pendingSprocket = /\(\s*sprocket\s*\)/i.test(t); continue; }
    if (!pendingCentre) continue;
    const m = MOVE_RE.exec(t);
    if (m) {
      usedComments = true;
      pendingCentre = false;
      if (pendingSprocket) { pendingSprocket = false; continue; }
      holes.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
    } else if (/^G0?\b/i.test(t)) {
      pendingCentre = false; // a non-moving comment block; abandon this marker
    }
  }

  // Fallback path for G-code with no hole comments.
  if (!usedComments) {
    warnings.push('No KNITCAT hole markers were found; reading every rapid move instead (a best guess).');
    const seen = new Set();
    for (const line of lines) {
      const t = line.trim();
      if (!/^G0?[0]\b/i.test(t)) continue;
      const m = MOVE_RE.exec(t);
      if (!m) continue;
      const x = parseFloat(m[1]);
      const y = parseFloat(m[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x === 0 || y === 0) continue; // home, retract and the card outline live on a zero axis
      const key = `${x.toFixed(2)},${y.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      holes.push({ x, y });
    }
  }

  if (!holes.length) return { ok: false, error: 'No punch moves could be read from this G-code.' };
  const result = holesToMatrix(holes, { pitchX: profile?.pitchX, pitchY: profile?.pitchY });
  if (!result.ok) return result;
  return { ok: true, matrix: result.matrix, mode: 'fair_isle', warnings: [...warnings, ...(result.warnings || [])] };
}
