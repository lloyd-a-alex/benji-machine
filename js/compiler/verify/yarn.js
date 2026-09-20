/**
 * KNITCAT V2 — yarn sufficiency verification (spec §4.5 "is there enough yarn?").
 *
 * Reads the graph's per-yarn `ballsNeeded` vs `owned` (or a project's `shortfall` node) and says,
 * plainly, "you need 3 more Karisma in Marineblå." If no yarn is attached at all it warns rather
 * than passes — a pattern with no yarn is not a shippable project. DOM-free; the numbers come from
 * the same nodes the Yarn Lab and the cost calculator use, so this can never disagree with them.
 *
 * @module compiler/verify/yarn
 */
import { makeResult } from './_result.js';

export function verifyYarn(ir, project) {
  const get = id => (project && project.get ? project.get(id) : undefined);
  const totalMeters = num(get('yarn.totalMeters'));
  if (!project || !get('yarn.totalMeters')) {
    return makeResult('yarn', 'warn', 'No yarn is assigned to this project.', 'Add a yarn (from the stash or database) so yardage and cost can be checked.');
  }
  const spec = (project.spec && project.spec.sections && project.spec.sections.yarn) || {};
  const names = Object.keys(spec);
  const shortfalls = [];
  for (const name of names) {
    const short = num(get(`yarn.${name}.shortfall`));
    if (short > 0) shortfalls.push({ name, buy: Math.ceil(short) });
  }
  if (shortfalls.length) {
    return makeResult('yarn', 'warn', `Not enough yarn: ${shortfalls.map(s => `${s.buy} more ball(s) of ${s.name}`).join('; ')}.`, 'Buy the shortfall or shrink the size before casting on.', { totalMeters: round1(totalMeters), shortfalls });
  }
  if (totalMeters <= 0) {
    return makeResult('yarn', 'warn', 'Computed yardage is zero — check the fabric-area nodes.', 'Set body measurements and gauge so area resolves.', { totalMeters });
  }
  return makeResult('yarn', 'pass', `Stash covers the ${round1(totalMeters)} m this pattern needs.`, '', { totalMeters: round1(totalMeters), yarns: names.length });
}

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
