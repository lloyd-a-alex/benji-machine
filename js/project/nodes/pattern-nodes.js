/**
 * KNITCAT V2 — pattern + machine nodes.
 *
 * The stitch-level consequences: turn finished measurements and gauge into the actual
 * cast-on counts and shaping landmarks a pattern needs, and hold the machine's physical
 * limits (how many needles the bed has, how wide it is) as inputs so the same graph can
 * answer "does this even fit on the machine?". These are the nodes the fusion narrative
 * is about — change the yarn → gauge → `pattern.castOn` moves → the bed-fit verdict flips
 * — with no button to press in between.
 *
 * @module project/nodes/pattern-nodes
 */

import { toCm, roundToMultiple } from '../units.js';

/**
 * Define machine.* input nodes and pattern.* derived nodes.
 * @param {import('../constraint-graph.js').ConstraintGraph} graph
 * @param {{spec:object, machine?:object}} ctx
 */
export function definePatternNodes(graph, ctx) {
  const s = (ctx.spec && ctx.spec.sections) || {};
  const m = s.machine || {};
  const g = s.garment || {};

  // Machine bed capacity: prefer a resolved profile passed in on ctx, else a standard
  // KH-830-style single bed. The KnitScript machine.gauge is the needle pitch (mm).
  const prof = ctx.machine && ctx.machine.profile ? ctx.machine.profile : null;
  const bedStitches = prof && prof.needleCount ? prof.needleCount : toNumberValue(m.bedStitches, 200);
  const bedWidthCm = prof && prof.bedWidth ? toCm(prof.bedWidth, 60) : toNumberValue(m.bedWidthCm, 60);
  const gaugeMm = toCm(m.gauge, 0) ? toCm(m.gauge, 0) * (m.gauge && m.gauge.unit === 'cm' ? 1 : 10) : (prof ? toNumberValue(profileGaugeMm(prof), 4.5) : 4.5);

  graph.define('machine.bedStitches', [], null, bedStitches, { isInput: true });
  graph.define('machine.bedWidthCm', [], null, bedWidthCm, { isInput: true });
  graph.define('machine.gaugeMm', [], null, gaugeMm, { isInput: true });
  graph.define('machine.id', [], null, String(m.id || (prof && prof.id) || 'standard'), { isInput: true });

  // Cast-on from finished bust circumference, rounded up to a multiple of 4 (rib-safe).
  graph.define('pattern.castOn', ['garment.finishedBust', 'gauge.stsPerCm'],
    (i) => roundToMultiple(i['garment.finishedBust'] * i['gauge.stsPerCm'], 4));
  graph.define('pattern.hipCastOn', ['garment.finishedHip', 'gauge.stsPerCm'],
    (i) => roundToMultiple(i['garment.finishedHip'] * i['gauge.stsPerCm'], 4));
  graph.define('pattern.waistStitches', ['garment.finishedWaist', 'gauge.stsPerCm'],
    (i) => roundToMultiple(i['garment.finishedWaist'] * i['gauge.stsPerCm'], 4));
  graph.define('pattern.cuffCastOn', ['body.wrist', 'gauge.stsPerCm'],
    (i) => roundToMultiple(i['body.wrist'] * 1.1 * i['gauge.stsPerCm'], 2));
  graph.define('pattern.upperArmStitches', ['garment.finishedUpperArm', 'gauge.stsPerCm'],
    (i) => roundToMultiple(i['garment.finishedUpperArm'] * i['gauge.stsPerCm'], 2));
  graph.define('pattern.neckStitches', ['garment.finishedNeck', 'gauge.stsPerCm'],
    (i) => roundToMultiple(i['garment.finishedNeck'] * i['gauge.stsPerCm'], 4));
  // A raglan takes 8 stitches off per full decrease round (4 lines × 2).
  graph.define('pattern.raglanRounds', ['pattern.castOn', 'pattern.neckStitches'],
    (i) => Math.max(0, Math.round((i['pattern.castOn'] - i['pattern.neckStitches']) / 8)));

  // Does the widest bit fit on one bed? A cheap, always-current feasibility flag.
  graph.define('pattern.widestStitches', ['pattern.castOn', 'pattern.hipCastOn', 'pattern.upperArmStitches'],
    (i) => Math.max(i['pattern.castOn'], i['pattern.hipCastOn'], i['pattern.upperArmStitches'] * 2));
  graph.define('feasibility.fitToBed', ['pattern.widestStitches', 'machine.bedStitches'],
    (i) => i['pattern.widestStitches'] <= i['machine.bedStitches']);
  void g;
}

function toNumberValue(v, fallback) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v && typeof v === 'object' && typeof v.value === 'number') return v.value;
  return fallback;
}

function profileGaugeMm(prof) {
  const mm = prof.gaugeMm || prof.gauge || (prof.pitch && prof.pitch.mm);
  return typeof mm === 'number' ? mm : 4.5;
}
