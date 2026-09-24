/**
 * KNITCAT V2 — yarn + material nodes.
 *
 * Turns the physical yarn (meterage, weight, price, how many balls you own) and the
 * garment's fabric area into the numbers a knitter actually worries about: how many
 * metres of yarn the piece will eat, how many balls that is, whether the stash covers it,
 * and what it costs. A swatch-less estimate uses a per-weight coverage factor — a genuine
 * heuristic, clearly labelled — while a real gauge tightens it. These nodes sit beside the
 * body/gauge/pattern packs so a yarn swap ripples into yardage, cost and ball count.
 *
 * @module project/nodes/yarn-nodes
 */

import { toCm, toNumber, ceilToMultiple } from '../units.js';
import { logger } from '../../core/logging.js';

const log = logger('project/nodes/yarn-nodes');

/** Centimetres of yarn consumed per square centimetre of fabric, by weight. */
export const YARN_PER_CM2 = Object.freeze({
  lace: 1.3, 'light-fingering': 1.5, fingering: 1.7, baby: 1.9, sport: 2.0,
  dk: 2.2, lightworsted: 2.4, worsted: 2.7, aran: 3.0, bulky: 3.6,
  'super-bulky': 4.3, chunky: 3.9, jumbo: 5.2
});
const DEFAULT_COVERAGE = 2.2;

/** Meters and grams in one ball, from a KnitScript `meterage` pair (`100m/50g`). */
export function ballSize(yarn) {
  const m = yarn && yarn.meterage;
  if (!m || typeof m !== 'object') return { meters: 0, grams: 0 };
  const leftUnit = m.left && m.left.unit;
  const leftVal = m.left && m.left.value;
  let meters = 0;
  if (typeof leftVal === 'number') {
    if (leftUnit === 'yd' || leftUnit === 'yds') meters = leftVal * 0.9144;
    else if (leftUnit === 'cm') meters = leftVal / 100;
    else meters = leftVal; // 'm' or unitless (meters is the convention)
  }
  const grams = (m.right && m.right.value) || (m.right && typeof m.right === 'number') || 0;
  return { meters, grams };
}

/** Owned balls from a `quantity: 8 balls` value. */
function ownedBalls(yarn) { return Math.max(0, Math.round(toNumber(yarn && yarn.quantity, 0))); }
function pricePerBall(yarn) {
  const p = yarn && (yarn.price != null ? yarn.price : (yarn.cost && yarn.cost.perBall));
  const v = toNumber(p, 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Define yarn area/yardage/cost nodes for every named yarn plus totals.
 * @param {import('../constraint-graph.js').ConstraintGraph} graph
 * @param {{spec:object}} ctx
 */
export function defineYarnNodes(graph, ctx) {
  const s = (ctx.spec && ctx.spec.sections) || {};
  const yarns = s.yarn || {};
  const names = Object.keys(yarns);

  // Fabric area (cm²): a body tube plus two sleeve tubes, all as flat rectangles.
  graph.define('yarn.fabricAreaCm2',
    ['garment.finishedBust', 'garment.length', 'garment.finishedUpperArm', 'garment.sleeveLength'],
    (i) => i['garment.finishedBust'] * i['garment.length'] + 2 * (i['garment.finishedUpperArm'] * 0.9) * i['garment.sleeveLength']);

  const coverage = coverageFor(yarns, s);
  graph.define('yarn.coverageFactor', [], null, coverage, { isInput: true });
  graph.define('yarn.totalMeters', ['yarn.fabricAreaCm2', 'yarn.coverageFactor'],
    (i) => i['yarn.fabricAreaCm2'] * i['yarn.coverageFactor'] / 100);

  // Per-yarn share of the total, balls needed vs. owned, and a small wastage buffer.
  const share = names.length ? 1 / names.length : 1;
  for (const [idx, name] of names.entries()) {
    const y = yarns[name] || {};
    const size = ballSize(y);
    const isLast = idx === names.length - 1;
    graph.define(`yarn.${name}.meters`, ['yarn.totalMeters'],
      (i, ctxRef) => i['yarn.totalMeters'] * ((ctxRef.specShares && ctxRef.specShares[name]) || share));
    const metersPerBall = size.meters > 0 ? size.meters : 100;
    graph.define(`yarn.${name}.ballsNeeded`, [`yarn.${name}.meters`],
      (i) => Math.ceil((i[`yarn.${name}.meters`] * 1.05) / metersPerBall));
    graph.define(`yarn.${name}.owned`, [], null, ownedBalls(y), { isInput: true });
    graph.define(`yarn.${name}.shortfall`, [`yarn.${name}.ballsNeeded`, `yarn.${name}.owned`],
      (i) => Math.max(0, i[`yarn.${name}.ballsNeeded`] - i[`yarn.${name}.owned`]));
    graph.define(`yarn.${name}.cost`, [`yarn.${name}.ballsNeeded`],
      (i) => i[`yarn.${name}.ballsNeeded`] * pricePerBall(y));
  }
  void toCm; void ceilToMultiple;
}

/** Coverage factor: a weighted blend, dominated by the first yarn's weight. */
function coverageFor(yarns, s) {
  const list = Object.values(yarns || {});
  for (const y of list) {
    const w = String((y && y.weight) || '').toLowerCase();
    if (YARN_PER_CM2[w]) return YARN_PER_CM2[w];
  }
  void s;
  // No yarn carried a weight we know, so yardage is estimated from a generic dk
  // coverage. Say so: a wrong ball count traces straight back to this fallback.
  log.debug('no known yarn weight — estimating yardage with the default coverage factor');
  return DEFAULT_COVERAGE;
}
