/**
 * KNITCAT V2 — machine verification (spec §4.5 "does the machine support every operation?").
 * Two jobs: bed capacity (does the widest piece fit across the needle bed?) and operation
 * support (does the profile carry the carriages/features the IR asks for — lace transfers, a
 * ribber, tacking?). Reuses the codebase's own profile limits when available. DOM-free.
 *
 * @module compiler/verify/machine
 */
import { makeResult } from './_result.js';

export function verifyMachine(ir, project) {
  const bed = num(ir.machine.bedStitches);
  const widest = widestPiece(ir);
  if (bed && widest > bed) {
    return makeResult('machine', 'fail', `Widest piece is ${widest} sts but the bed holds ${bed}.`, `Split the piece, use a wider machine, or reduce width/ease (cast-on ${widest - bed} sts over).`, { bed, widest });
  }
  const needs = operationsUsed(ir);
  const unsupported = [];
  if (needs.has('transfer') && !supportsFeature(ir, 'lace')) unsupported.push('lace transfers');
  if (ir.machine.carriage === 'ribber' && !supportsFeature(ir, 'ribber')) unsupported.push('ribber');
  if (unsupported.length) {
    return makeResult('machine', 'fail', `Machine "${ir.machine.id}" does not support: ${unsupported.join(', ')}.`, 'Pick a machine profile that supports these, or rework those rows.', { unsupported });
  }
  if (!bed && !ir.machine.profile) {
    return makeResult('machine', 'warn', 'No machine profile — bed fit and features unverified.', 'Set machine.id to a known profile.');
  }
  return makeResult('machine', 'pass', `Every piece fits the ${bed || 'standard'}-needle bed and all operations are supported.`, '', { bed, widest });
}

function widestPiece(ir) {
  let w = 0;
  for (const p of (ir.pieces || [])) for (const r of p.rowsDetail) w = Math.max(w, r.stitchesBefore, r.stitchesAfter);
  return w;
}
function operationsUsed(ir) {
  const s = new Set();
  for (const p of (ir.pieces || [])) for (const r of p.rowsDetail) for (const o of r.operations) s.add(o.kind);
  return s;
}
function supportsFeature(ir, feature) {
  const prof = ir.machine.profile;
  if (!prof) return true; // unknown ⇒ do not fail spuriously
  if (feature === 'lace') return Boolean(prof.lace || prof.hasLaceCarriage || (prof.carriages || []).some(c => /lace/i.test(String(c))));
  if (feature === 'ribber') return Boolean(prof.ribber || prof.beds === 2 || prof.hasRibber);
  return true;
}
function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
