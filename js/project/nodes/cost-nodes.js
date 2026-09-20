/**
 * KNITCAT V2 — cost, time and production nodes.
 *
 * The bottom of the graph, where everything the knitter is really asking converges: what
 * will this cost, how long will it take, and (if they sell) what should they charge. These
 * nodes read the totals produced upstream — yarn cost, stitch counts, row counts, a chosen
 * labour rate — and recompute automatically, so swapping a yarn or nudging the ease updates
 * the price tag without anyone re-doing a spreadsheet. This is also the seam where the
 * Production System plugs in: `cost.suggestedPrice` and `time.totalHours` are the same
 * values the manufacturing backend and the batch planner quote from.
 *
 * @module project/nodes/cost-nodes
 */

import { toNumber } from '../units.js';

/** Default machine throughput, in stitches worked per minute (a comfortable mid-gauge). */
export const DEFAULT_STITCHES_PER_MINUTE = 130;
/** Default hourly labour rate (the app's home currency units — a number, not a symbol). */
export const DEFAULT_LABOUR_RATE = 12;
/** Default retail markup over cost for a maker who sells their work. */
export const DEFAULT_MARKUP = 2.4;

/**
 * Define cost.* and time.* nodes.
 * @param {import('../constraint-graph.js').ConstraintGraph} graph
 * @param {{spec:object}} ctx
 */
export function defineCostNodes(graph, ctx) {
  const s = (ctx.spec && ctx.spec.sections) || {};
  const budget = s.budget || {};
  const rate = toNumber(budget.labourRate, DEFAULT_LABOUR_RATE);
  const spm = toNumber(budget.stitchesPerMinute, DEFAULT_STITCHES_PER_MINUTE);
  const markup = toNumber(budget.markup, DEFAULT_MARKUP);

  graph.define('cost.labourRate', [], null, rate, { isInput: true });
  graph.define('cost.stitchesPerMinute', [], null, spm, { isInput: true });
  graph.define('cost.markup', [], null, markup, { isInput: true });
  graph.define('cost.materials', [], null, toNumber(budget.materials, 0), { isInput: true });
  graph.define('cost.overhead', [], null, toNumber(budget.overhead, 0), { isInput: true });

  // Yarn cost = the sum of every per-yarn cost node the yarn pack declared.
  const yarnCostIds = Object.keys((s.yarn || {})).map(n => `yarn.${n}.cost`);
  graph.define('cost.yarn', yarnCostIds.length ? yarnCostIds : [],
    (i) => yarnCostIds.reduce((sum, id) => sum + (Number(i[id]) || 0), 0));

  // Time: a rough all-in stitch count over machine throughput, plus finishing hours.
  graph.define('time.totalStitches', ['pattern.castOn', 'garment.bodyRows', 'garment.sleeveRows', 'pattern.upperArmStitches'],
    (i) => Math.round(i['pattern.castOn'] * i['garment.bodyRows'] + 2 * i['pattern.upperArmStitches'] * i['garment.sleeveRows'] * 0.6));
  graph.define('time.knitHours', ['time.totalStitches', 'cost.stitchesPerMinute'],
    (i) => round2(i['time.totalStitches'] / (i['cost.stitchesPerMinute'] * 60)));
  graph.define('time.finishingHours', [], null, 2.5, { isInput: true });
  graph.define('time.totalHours', ['time.knitHours', 'time.finishingHours'],
    (i) => round2(i['time.knitHours'] + i['time.finishingHours']));

  graph.define('cost.labour', ['time.totalHours', 'cost.labourRate'],
    (i) => round2(i['time.totalHours'] * i['cost.labourRate']));
  graph.define('cost.total', ['cost.yarn', 'cost.labour', 'cost.materials', 'cost.overhead'],
    (i) => round2(i['cost.yarn'] + i['cost.labour'] + i['cost.materials'] + i['cost.overhead']));
  graph.define('cost.suggestedPrice', ['cost.total', 'cost.markup'],
    (i) => round2(i['cost.total'] * i['cost.markup']));
  graph.define('cost.profit', ['cost.suggestedPrice', 'cost.total'],
    (i) => round2(i['cost.suggestedPrice'] - i['cost.total']));
  graph.define('cost.profitMargin', ['cost.profit', 'cost.suggestedPrice'],
    (i) => (i['cost.suggestedPrice'] > 0 ? round2(i['cost.profit'] / i['cost.suggestedPrice'] * 100) : 0));
}

function round2(n) { return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
