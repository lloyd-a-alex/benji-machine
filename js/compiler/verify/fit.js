/**
 * KNITCAT V2 — fit verification (spec §4.5 "Fit: does the garment fit the body with the given
 * ease?"). Reads the finished-measurement nodes off the Project (or the IR metadata) and checks
 * every key circumference and length against a wearable band, producing per-point verdicts and a
 * concrete fix (add/remove ease, adjust length) rather than a bare fail. DOM-free.
 *
 * @module compiler/verify/fit
 */
import { makeResult } from './_result.js';

/** Circumference points and how they map to IR/graph values, with a tolerance band in cm. */
const POINTS = [
  { id: 'bust', label: 'Bust', value: ir => num(ir.metadata.finishedBust), min: -2, max: 22 },
  { id: 'length', label: 'Body length', value: ir => num(ir.metadata.finishedLength), min: -4, max: 12 }
];

export function verifyFit(ir, project) {
  const get = id => (project && project.get ? project.get(id) : undefined);
  const issues = [];
  for (const p of POINTS) {
    const v = p.value(ir);
    if (!v) continue;
    const body = p.id === 'bust' ? num(get('body.bust')) : num(get('garment.length'));
    if (!body) continue;
    const ease = v - body;
    if (ease < p.min) issues.push(`${p.label}: ${round1(ease)}cm ease is tighter than ${p.min}cm — it will be skin-tight`);
    else if (ease > p.max) issues.push(`${p.label}: ${round1(ease)}cm ease is looser than ${p.max}cm — it will look tent-like`);
  }
  const finished = num(ir.metadata.finishedBust);
  if (!finished && !(project && project.get && project.get('garment.finishedBust'))) {
    return makeResult('fit', 'warn', 'No finished bust measurement to verify against the body.', 'Set body measurements and re-derive.');
  }
  if (issues.length) {
    return makeResult('fit', 'fail', `Fit out of band: ${issues.join('; ')}`, 'Adjust ease (ease.chest) or garment.length and recompile.', { issues });
  }
  return makeResult('fit', 'pass', `Garment fits the body within the ease bands (${POINTS.map(p => p.label).join(', ')}).`, '', { checked: POINTS.length });
}

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
