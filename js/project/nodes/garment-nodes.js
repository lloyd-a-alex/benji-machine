/**
 * KNITCAT V2 — garment / ease nodes.
 *
 * The design intent, as numbers. This pack turns the `garment:` section and the chosen
 * ease preference into the *finished measurements* of the piece — circumference and length
 * in centimetres, then those in stitches and rows via the gauge nodes — plus the derived
 * anchors the shaping scheduler needs (where the armhole starts, how deep the raglan is,
 * how many body rows there are). It is the middle of the graph: it reads body + gauge +
 * ease and produces exactly the quantities a pattern generator consumes.
 *
 * Because these are nodes rather than a function call from a button, changing the ease
 * preference or the garment length re-derives finished width → cast-on → feasibility,
 * which is the fusion the whole architecture exists to provide.
 *
 * @module project/nodes/garment-nodes
 */

import { toCm } from '../units.js';

/** Extra room (cm of circumference) each ease word adds at the chest. */
export const EASE_BY_PREFERENCE = Object.freeze({
  fitted: 2.5, 'slim': 4, standard: 6, relaxed: 8, oversized: 15
});

/** Proportional ease at other points relative to the chest ease. */
const EASE_SHAPE = Object.freeze({ waist: 0.7, hip: 0.6, arm: 1.2 });

/**
 * Define ease.* and garment.* derived nodes.
 * @param {import('../constraint-graph.js').ConstraintGraph} graph
 * @param {{spec:object}} ctx
 */
export function defineGarmentNodes(graph, ctx) {
  const s = (ctx.spec && ctx.spec.sections) || {};
  const g = s.garment || {};
  const pref = String((s.body && s.body.easePreference) || g.easePreference || 'standard').toLowerCase();
  const explicitChest = toCm(g.ease, 0);
  const baseEase = explicitChest > 0 ? explicitChest : (EASE_BY_PREFERENCE[pref] ?? EASE_BY_PREFERENCE.standard);

  // Ease is an input the knitter can nudge directly.
  graph.define('ease.chest', [], null, baseEase, { isInput: true });
  graph.define('ease.waist', ['ease.chest'], (i) => i['ease.chest'] * EASE_SHAPE.waist);
  graph.define('ease.hip', ['ease.chest'], (i) => i['ease.chest'] * EASE_SHAPE.hip);
  graph.define('ease.arm', ['ease.chest'], (i) => i['ease.chest'] * EASE_SHAPE.arm);

  // Finished circumference = body + ease. Reads body + ease, feeds pattern.
  graph.define('garment.finishedBust', ['body.bust', 'ease.chest'], (i) => i['body.bust'] + i['ease.chest']);
  graph.define('garment.finishedWaist', ['body.waist', 'ease.waist'], (i) => i['body.waist'] + i['ease.waist']);
  graph.define('garment.finishedHip', ['body.hip', 'ease.hip'], (i) => i['body.hip'] + i['ease.hip']);
  graph.define('garment.finishedUpperArm', ['body.upperArm', 'ease.arm'], (i) => i['body.upperArm'] + i['ease.arm']);
  graph.define('garment.finishedNeck', ['body.neck'], (i) => i['body.neck'] * 0.85);

  // Lengths (cm) — the KnitScript wins, else the body's own total length.
  const lengthCm = toCm(g.length, 0) || toCm((s.body || {}).totalLength, 62);
  const sleeveCm = toCm(g.sleeveLength, 0) || toCm((s.body || {}).sleeveLength, 48);
  graph.define('garment.length', [], null, lengthCm, { isInput: true });
  graph.define('garment.sleeveLength', [], null, sleeveCm, { isInput: true });
  const armholeDepth = toCm((g.armhole && g.armhole.depth) || {}, 0) || toCm((s.body || {}).armholeDepth, 22);
  graph.define('garment.armholeDepth', [], null, armholeDepth, { isInput: true });

  // Convert to rows using the gauge — this is where gauge propagates into geometry.
  graph.define('garment.bodyRows', ['garment.length', 'gauge.rowsPerCm'], (i) => Math.round(i['garment.length'] * i['gauge.rowsPerCm']));
  graph.define('garment.sleeveRows', ['garment.sleeveLength', 'gauge.rowsPerCm'], (i) => Math.round(i['garment.sleeveLength'] * i['gauge.rowsPerCm']));
  graph.define('garment.armholeRows', ['garment.armholeDepth', 'gauge.rowsPerCm'], (i) => Math.round(i['garment.armholeDepth'] * i['gauge.rowsPerCm']));
  graph.define('garment.construction', [], null, String(g.kind || g.construction || 'raglanSweater'), { isInput: true });
}
