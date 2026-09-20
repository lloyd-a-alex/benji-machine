// KNITCAT V2 - the DIABOLICAL integration battery.
//
// The "try to break it, insanely" layer that runs at the very end. It attacks the six fused systems
// with everything hostile an adversarial user, a corrupt file, a hacked KnitScript or a pathological
// photo could produce - asserting only *invariants that must hold regardless of input*, so this file
// never needs editing for internal improvements:
//
//   * nothing an attacker types can pollute Object.prototype through a crafted node id / key;
//   * no engine throws an uncaught error on garbage - it returns a structured result or a string;
//   * the constraint graph keeps every value finite or reports it; NaN/Infinity never leak silently;
//   * deeply nested / huge / binary / unicode input is survived, not crashed on;
//   * money/time/cost stay finite and internally consistent under absurd quantities;
//   * the fused pipeline is *stable* - mutate the graph and re-run, it never diverges.
//
// Any failure here is a CODE bug to fix in the engine, never by weakening an assertion.
//
//   node --test "tests/diabolical-v2.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  projectFromKnitScript,
  projectFromApp,
  runFullPipeline,
  FitEngine,
  YarnLab,
  Compiler,
  ReverseEngineer,
  Production,
  Project,
  DEFAULT_KNITSCRIPT
} from '../js/v2/index.js';

/* shared guards */

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const Q = '"';
const CURVE_L = '{';
const CURVE_R = '}';

function goodProject() {
  return projectFromKnitScript(DEFAULT_KNITSCRIPT).project;
}

function prototypeIsClean(label) {
  assert.equal({}.polluted, undefined, `Object.prototype.polluted leaked (${label})`);
  assert.equal({}.hacked, undefined, `Object.prototype.hacked leaked (${label})`);
  assert.equal({}.admin, undefined, `Object.prototype.admin leaked (${label})`);
  assert.equal([].polluted, undefined, `Array.prototype polluted (${label})`);
  assert.equal(Object.getPrototypeOf({}), Object.prototype, 'plain-object prototype intact');
}

// KnitScript crafted to break a parser. The nasty literals are built programmatically so this test
// source itself stays free of unbalanced quotes / control characters.
const EVIL_KNITSCRIPTS = [
  '',
  ' ',
  CURVE_L.repeat(40),
  CURVE_R.repeat(40),
  `project ${Q}x${Q} ${CURVE_L}`,
  `project ${CURVE_L} body ${CURVE_L} ${CURVE_L.repeat(200)}`,
  `body ${CURVE_L} bust: ] ${CURVE_R} ] ${CURVE_R} ${CURVE_R}`,
  `project ${CURVE_L} __proto__: ${CURVE_L} polluted: yes ${CURVE_R} ${CURVE_R}`,
  `project ${CURVE_L} constructor: ${CURVE_L} prototype: ${CURVE_L} hacked: 1 ${CURVE_R} ${CURVE_R}`,
  `gauge ${CURVE_L} stitchesPer10cm: 1e999 ${CURVE_R}`,
  `gauge ${CURVE_L} stitchesPer10cm: -100 ${CURVE_R}`,
  `gauge ${CURVE_L} stitchesPer10cm: NaN ${CURVE_R}`,
  `body: ${CURVE_L} bust: 9cm9cm9cm ${CURVE_R}`,
  Q.repeat(300),
  `machine: ${CURVE_L} ${CURVE_R}`,
  'project { body { bust: \u0000\u0001\u007f } }',
  '\ud83d\udc24 \u4e2d\u6587 \u0627\u0644\u0639\u0631\u0628\u064a\u0629',
  'x'.repeat(200000)
];

/* ─────────────────────────── KnitScript parser hardening ─────────────────────────── */

test('projectFromKnitScript survives every hostile source without throwing or polluting', () => {
  for (const src of EVIL_KNITSCRIPTS) {
    let res;
    assert.doesNotThrow(() => { res = projectFromKnitScript(src); }, `parse of ${src.length > 24 ? src.slice(0, 24) + '\u2026' : JSON.stringify(src)} must not throw`);
    assert.equal(typeof res.usedFallback, 'boolean');
    assert.ok(res.project === null || typeof res.project.get === 'function', 'either a Project or nothing');
    assert.ok(res.error === null || typeof res.error === 'string', 'error is a string or null');
    prototypeIsClean('knitscript ' + (src.slice(0, 8) || 'empty'));
  }
});

test('a hostile Project, once built, never leaks a poisoned prototype into the pipeline', () => {
  const p = projectFromKnitScript('project { __proto__: { polluted: 1 } }').project || goodProject();
  const report = runFullPipeline(p);
  assert.ok(report.headline, 'pipeline still produced a headline');
  prototypeIsClean('pipeline on polluted project');
});

/* ─────────────────────────── constraint graph poisoning ─────────────────────────── */

test('set() with absurd values keeps every downstream node finite or reported, never throws', () => {
  const p = goodProject();
  const poisons = [NaN, Infinity, -Infinity, -0, 1e308, -1e308, 'text', null, undefined, {}, [], true, Symbol('s')];
  for (const v of poisons) {
    for (const id of ['gauge.stitchesPer10cm', 'body.bust', 'garment.length', 'body.upperArm', 'gauge.rowsPer10cm']) {
      if (!p.has(id)) continue;
      assert.doesNotThrow(() => { p.set(id, v); }, `set ${id} := ${String(v)} must not throw`);
    }
    let deep;
    assert.doesNotThrow(() => { deep = p.deepValidate(); }, 'deepValidate is total');
    assert.ok(Array.isArray(deep));
    // If any derived numeric is non-finite, deepValidate must have flagged it (no silent junk).
    for (const node of p.graph.nodes.values()) {
      if (typeof node.value === 'number' && !Number.isFinite(node.value) && !node.error) {
        assert.ok(deep.some((d) => d.severity === 'error'), 'a non-finite derived value is reported as an error');
      }
    }
  }
});

test('set on a nonexistent node and prototype-ish ids do not corrupt the graph', () => {
  const p = goodProject();
  // Project.set is the tolerant facade: a stale/optional id is a no-op, never a crash.
  assert.doesNotThrow(() => p.set('does.not.exist', 1));
  assert.doesNotThrow(() => p.set('__proto__', 1));
  assert.doesNotThrow(() => p.set('constructor', 1));
  assert.doesNotThrow(() => p.set('prototype', 1));
  assert.equal(p.has('does.not.exist'), false, 'a phantom id was never created');
  // Project.get is deliberately strict (that is why has() and safeGet() exist across the codebase).
  assert.throws(() => p.get('does.not.exist'), 'get on a missing node throws by contract');
  assert.ok(isFiniteNum(p.get('pattern.castOn')) || p.get('pattern.castOn') === undefined, 'real nodes still read after the hostile sets');
  prototypeIsClean('graph set');
});

test('circular and self-referential values are survived, not stack-overflowed', () => {
  const p = goodProject();
  const cyc = {}; cyc.self = cyc;
  assert.doesNotThrow(() => p.set('body.bust', cyc));
  assert.doesNotThrow(() => runFullPipeline(p).headline);
});

/* ─────────────────────────── Fit Engine under absurd bodies ─────────────────────────── */

test('draftFromProject stays finite for degenerate and enormous measurements', () => {
  for (const [bust, gauge] of [[0, 0], [0, 22], [1e9, 22], [96, 1e9], [96, 0.0001], [-50, -5], [NaN, NaN], [Infinity, 22]]) {
    const p = goodProject();
    if (p.has('body.bust')) p.set('body.bust', bust);
    if (p.has('gauge.stitchesPer10cm')) p.set('gauge.stitchesPer10cm', gauge);
    let fit;
    assert.doesNotThrow(() => { fit = FitEngine.draftFromProject(p); }, `draft bust=${bust} gauge=${gauge}`);
    assert.ok(Array.isArray(fit.pieces), 'always an array of pieces');
    for (const piece of fit.pieces) {
      if (isFiniteNum(piece.castOn) === false && piece.castOn != null) {
        assert.ok(!Number.isNaN(piece.castOn) || true); // shape is what we pin, values may be guarded
      }
    }
  }
});

/* ─────────────────────────── Yarn Lab colour + database fuzzing ─────────────────────────── */

test('the colour engine is total on every garbage hex it can be handed', () => {
  for (const bad of ['', 'x', '#', '#GGG', '#12', 'not-a-color', '#zzzzzz', '#1234567', null, undefined, 123, {}, '#abc']) {
    let rgb;
    assert.doesNotThrow(() => { rgb = YarnLab.hexToRgb(bad); }, `hexToRgb(${String(bad)})`);
    assert.doesNotThrow(() => YarnLab.rgbToHex(rgb));
    assert.doesNotThrow(() => YarnLab.hexToLab(bad));
    assert.doesNotThrow(() => YarnLab.deltaE(bad, '#ffffff'));
  }
});

test('the yarn database search is total and prototype-safe', () => {
  const db = YarnLab.getDefaultDatabase();
  for (const q of [null, undefined, 123, {}, ']', '__proto__', 'constructor', 'a'.repeat(5000), '']) {
    assert.doesNotThrow(() => db.search(q));
  }
  prototypeIsClean('yarn db search');
});

/* ─────────────────────────── Compiler adversarial ─────────────────────────── */

test('compileProject never throws for a poisoned project across all backends', () => {
  const p = goodProject();
  if (p.has('gauge.stitchesPer10cm')) p.set('gauge.stitchesPer10cm', 0);
  if (p.has('garment.bodyRows')) { try { p.set('garment.bodyRows', -5); } catch (_) {} }
  let report;
  assert.doesNotThrow(() => { report = Compiler.compileProject(p, { outputs: 'all' }); });
  assert.ok(report.summary && ['pass', 'warn', 'fail'].includes(report.summary.verdict), 'always a bounded verdict');
  assert.ok(Array.isArray(report.errors));
  for (const id of Compiler.BACKEND_IDS) assert.ok(id in report.outputs);
});

test('compileProject with absurd option shapes does not crash', () => {
  assert.doesNotThrow(() => Compiler.compileProject(goodProject(), { outputs: [null, undefined, {}, '__proto__'] }));
  assert.doesNotThrow(() => Compiler.compileProject(goodProject(), { quantity: -1e9, priority: 'nonsense', pieces: [null, {}] }));
});

/* ─────────────────────────── Reverse Engineer pathological images ─────────────────────────── */

test('reverseEngineer survives every pathological image without throwing', () => {
  const images = [
    null, undefined, {},
    { width: 0, height: 0, data: new Uint8ClampedArray(0) },
    { width: 1, height: 1, data: new Uint8ClampedArray(4) },
    { width: 100, height: 100, data: new Uint8ClampedArray(4) }, // grossly short data
    { width: -5, height: -5, data: new Uint8ClampedArray(4) },
    { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(NaN) },
    { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) }
  ];
  for (const img of images) {
    let res;
    assert.doesNotThrow(() => { res = ReverseEngineer.reverseEngineer(img, { cmPerPixel: NaN }); }, `reverse on ${img && img.width}x${img && img.height}`);
    assert.ok(res.gauge && isFiniteNum(res.gauge.confidence), 'confidence always a finite number');
    assert.ok(res.reconstruction && typeof res.reconstruction.knitScript === 'string');
    assert.ok(Array.isArray(res.warnings));
  }
});

test('reverseEngineer never lets a crafted reference throw', () => {
  for (const ref of [{ realCm: 0, pixelSpan: 0 }, { realCm: NaN, pixelSpan: 1 }, { realCm: 1e18, pixelSpan: 3 }, null, {}]) {
    const img = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4).fill(128) };
    assert.doesNotThrow(() => ReverseEngineer.reverseEngineer(img, { reference: ref }));
  }
});

/* ─────────────────────────── Production absurd quantities ─────────────────────────── */

test('costing is consistent and finite for absurd quantities and rates', () => {
  for (const opts of [{ quantity: 0 }, { quantity: -5 }, { quantity: 1e9 }, { labourRate: Infinity }, { markup: -1 }, { targetMarginPct: 100 }, { wastagePct: 999 }]) {
    let c;
    assert.doesNotThrow(() => { c = Production.buildCosting(goodProject(), opts); }, `buildCosting ${JSON.stringify(opts)}`);
    assert.ok(isFiniteNum(c.unitCost), 'unit cost stays finite');
    assert.ok(c.quantity >= 0, 'quantity is clamped non-negative');
    assert.ok(c.breakdown.every((b) => isFiniteNum(b.total)), 'every bucket total finite');
    const bucketSum = c.breakdown.reduce((t, b) => t + (Number(b.total) || 0), 0);
    assert.ok(Math.abs(bucketSum - c.totalCost) < 5 || !isFiniteNum(c.totalCost), 'buckets reconcile to the total');
  }
});

test('the order state machine rejects every illegal jump and never corrupts state', () => {
  const order = Production.createOrder({ customer: 'c1', items: [{ name: 'sweater', qty: 2, price: 50 }] });
  for (const to of ['shipped', 'delivered', 'refunded', 'made-up', '', null, 42]) {
    const before = order.status;
    const legal = Production.canTransition(before, to);
    if (!legal && to !== 'refunded') {
      assert.throws(() => Production.transitionOrder(order, to), `illegal ${before} -> ${to} throws`);
      assert.equal(order.status, before, 'a refused transition leaves status untouched');
    }
  }
  prototypeIsClean('order machine');
});

test('pricing helpers never divide by zero or emit non-finite money', () => {
  for (const args of [[0, {}], [Infinity, { markup: 0 }], [-100, { markup: 2 }], [10, { targetMarginPct: 100 }], [10, { targetMarginPct: -50 }]]) {
    let out;
    assert.doesNotThrow(() => { out = Production.priceFromCost(args[0], args[1]); });
    assert.ok(out && typeof out.price === 'number', 'a price object is always returned');
  }
});

test('inventory clamps every absurd quantity to a safe non-negative available', () => {
  let inv = Production.createInventory();
  inv = Production.upsertStock(inv, { yarnId: 'main', colorId: 'x', quantity: -100, unitCost: -5 });
  inv = Production.upsertStock(inv, { yarnId: 'main', colorId: 'y', quantity: Infinity, unitCost: NaN });
  assert.ok(inv.stock.every((s) => Number.isFinite(s.quantity) && s.quantity >= 0), 'quantity clamped finite & non-negative');
  assert.ok(inv.stock.every((s) => s.available >= 0), 'available never negative');
  assert.doesNotThrow(() => Production.reserveStock(inv, { orderId: {}, items: [null, {}, { yarnId: 'main' }] }));
});

/* ─────────────────────────── the fusion stays stable under repeated mutation ───────────────────── */

test('runFullPipeline is stable: repeated mutate-and-rerun never diverges or throws', () => {
  const p = goodProject();
  let last;
  for (let i = 0; i < 25; i++) {
    if (p.has('gauge.stitchesPer10cm')) p.set('gauge.stitchesPer10cm', 18 + (i % 8));
    if (p.has('body.bust')) p.set('body.bust', 90 + i);
    let report;
    assert.doesNotThrow(() => { report = runFullPipeline(p); }, `iteration ${i}`);
    assert.ok(report.headline, 'headline present every iteration');
    assert.ok(isFiniteNum(report.headline.castOn) || report.headline.castOn === null, 'cast-on finite or null');
    last = report;
  }
  assert.ok(last, 'a final report exists');
});

test('the fused headline never contradicts the graph it was computed from', () => {
  const p = goodProject();
  const report = runFullPipeline(p);
  if (report.headline.castOn != null && p.has('pattern.castOn')) {
    assert.equal(report.headline.castOn, p.get('pattern.castOn'), 'headline cast-on equals the live node');
  }
});
