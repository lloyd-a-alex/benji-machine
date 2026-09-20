/**
 * KNITCAT V2 — body measurement nodes.
 *
 * Declares the source-of-truth input nodes for a body: the raw circumferences, lengths
 * and widths, all normalised to centimetres so downstream arithmetic never juggles units.
 * These are the roots of the constraint graph — nothing computes them, the knitter (or a
 * standard-size chart, or a photo import) sets them, and everything from finished
 * garment width to cast-on count is downstream of them.
 *
 * Every measurement degrades to a sane adult default when absent rather than NaN, so a
 * half-filled KnitScript still propagates a full, if approximate, model. That is the
 * whole point of the graph: a missing value is *visible* (the default is documented
 * here) instead of silently poisoning a dependent formula.
 *
 * @module project/nodes/body-nodes
 */

import { toCm } from '../units.js';

/** Canonical adult defaults (cm) used only when a measurement is truly absent. */
export const BODY_DEFAULTS = Object.freeze({
  bust: 96, underbust: 82, waist: 82, highHip: 92, hip: 100,
  thigh: 56, knee: 38, calf: 36, ankle: 22,
  backLength: 46, frontLength: 44, totalLength: 62, armholeDepth: 22,
  sleeveLength: 48, sleeveCapHeight: 12, neckToShoulder: 8,
  shoulderWidth: 42, crossBack: 36, crossFront: 34, upperArm: 32, wrist: 18, neck: 38,
  shoulderSlope: 12, neckSlope: 45, bustApex: 26
});

const CIRC = ['bust', 'underbust', 'waist', 'highHip', 'hip', 'thigh', 'knee', 'calf', 'ankle', 'upperArm', 'wrist', 'neck', 'shoulderWidth', 'crossBack', 'crossFront'];
const LENGTHS = ['backLength', 'frontLength', 'totalLength', 'armholeDepth', 'sleeveLength', 'sleeveCapHeight', 'neckToShoulder'];
const ANGLES = ['shoulderSlope', 'neckSlope', 'bustApex'];

/**
 * Define every `body.*` node on the graph.
 * @param {import('../constraint-graph.js').ConstraintGraph} graph
 * @param {{spec:{sections:object}}} ctx
 */
export function defineBodyNodes(graph, ctx) {
  const body = (ctx.spec && ctx.spec.sections && ctx.spec.sections.body) || {};
  const valueOf = (key, table) => toCm(body[key], table[key] ?? 0);

  for (const key of CIRC) graph.define(`body.${key}`, [], null, valueOf(key, BODY_DEFAULTS), { isInput: true });
  for (const key of LENGTHS) graph.define(`body.${key}`, [], null, valueOf(key, BODY_DEFAULTS), { isInput: true });
  for (const key of ANGLES) graph.define(`body.${key}`, [], null, toCm(body[key], BODY_DEFAULTS[key] ?? 0), { isInput: true });

  // A couple of cheap derived anchors the shaping maths likes to have.
  const ids = [
    ['body.chest', ['body.bust']],
    ['body.armholeStart', ['body.backLength', 'body.armholeDepth']],
    ['body.waistFromHem', ['body.backLength']]
  ];
  for (const [id, inputs] of ids) {
    graph.define(id, inputs, (i) => {
      if (id === 'body.chest') return i['body.bust'];
      if (id === 'body.armholeStart') return Math.max(0, i['body.backLength'] - i['body.armholeDepth'] * 0.5);
      return i['body.backLength'] * 0.62; // waist sits ~62% down the back from the hem
    });
  }
}

/** The full list of body input node ids, for the UI to render a form. */
export const BODY_INPUT_KEYS = [...CIRC, ...LENGTHS, ...ANGLES];
