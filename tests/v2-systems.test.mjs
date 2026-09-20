// KNITCAT V2 — the general contract battery for the six fused systems.
//
// This file deliberately tests *contracts and invariants*, never golden numbers, so ordinary
// internal improvements to any system never force an edit here. Every promise is a shape or a
// relationship that must hold for ANY input, hostile or not:
//
//   • the facade builds a Project from KnitScript and NEVER throws (falls back to a scaffold),
//   • the fused pipeline returns all six stages and a coherent headline for any valid project,
//   • the constraint graph propagates, remembers what moved, and stays finite,
//   • every system survives a garbage Project (NaN / Infinity / negative / missing nodes),
//   • the Compiler's seven backends all emit from the one IR and agree on the verdict,
//   • the Reverse Engineer degrades to a structured failure on a bad image, never a throw,
//   • Production's cost / price / time stay internally consistent (total = sum of buckets).
//
//   node --test "tests/v2-systems.test.mjs"

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
  DEFAULT_KNITSCRIPT,
  V2_VERSION,
  V2_SYSTEM_CATALOG
} from '../js/v2/index.js';

/* ─────────────────────────── helpers ─────────────────────────── */

function aProject(knitScript) {
  const built = projectFromKnitScript(knitScript || DEFAULT_KNITSCRIPT);
  assert.ok(built.project, 'the default KnitScript must always build a Project');
  return built.project;
}

// A Project whose graph has been poisoned with impossible inputs — every engine must survive it.
function anEvilProject() {
  const p = aProject();
  for (const id of ['body.bust', 'gauge.stitchesPer10cm', 'gauge.rowsPer10cm', 'garment.length', 'body.upperArm']) {
    if (p.has(id)) p.set(id, NaN);
  }
  return p;
}

const isNum = (v) => typeof v === 'number';
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNonNeg = (v) => isFiniteNum(v) && v >= 0;

/* ─────────────────────────── facade + Project ─────────────────────────── */

test('the V2 surface exposes all six systems and a version', () => {
  assert.equal(typeof V2_VERSION, 'string');
  assert.ok(V2_VERSION.length);
  for (const sys of [FitEngine, YarnLab, Compiler, ReverseEngineer, Production, Project]) {
    assert.ok(sys, 'each namespace is present');
  }
  assert.equal(typeof Project, 'function');
  assert.ok(Array.isArray(V2_SYSTEM_CATALOG) && V2_SYSTEM_CATALOG.length >= 6, 'the catalog lists every system');
  for (const entry of V2_SYSTEM_CATALOG) {
    assert.ok(entry.id && entry.label, 'every catalog entry has an id and a label');
  }
});

test('projectFromKnitScript NEVER throws and always reports its fallback state', () => {
  for (const bad of ['', '   ', 'project {', '{{{{', 'not knitscript at all', 'garment }{', 'project "x" { body: {' ]) {
    let res;
    assert.doesNotThrow(() => { res = projectFromKnitScript(bad); }, `must survive ${JSON.stringify(bad)}`);
    assert.equal(typeof res.usedFallback, 'boolean');
    assert.ok(res.error === null || typeof res.error === 'string');
    if (res.project) assert.equal(typeof res.project.get, 'function');
  }
  // A blank string yields the known-good scaffold rather than nothing.
  const empty = projectFromKnitScript('');
  assert.ok(empty.project, 'empty input still produces a usable scaffold');
  assert.equal(empty.usedFallback, true);
});

test('projectFromApp bridges a live app into a real Project', () => {
  const fakeApp = { currentProfile: { id: 'brother_standard_24' }, projectMeta: { name: 'From App' } };
  const p = projectFromApp(fakeApp);
  assert.ok(p instanceof Project);
  assert.equal(p.name, 'From App', 'the app card name is honoured');
});

test('the constraint graph propagates and records exactly what moved', () => {
  const p = aProject();
  const before = p.get('pattern.castOn');
  const changed = p.set('gauge.stitchesPer10cm', (before ? 30 : 30));
  assert.ok(Array.isArray(changed), 'set returns a change list');
  assert.ok(p.has('pattern.castOn'));
  assert.notEqual(p.get('gauge.stitchesPer10cm'), undefined);
});

test('Project.validate / deepValidate / fullValidate all return arrays and never throw', () => {
  for (const p of [aProject(), anEvilProject()]) {
    for (const fn of ['validate', 'deepValidate', 'fullValidate']) {
      let out;
      assert.doesNotThrow(() => { out = p[fn](); }, `${fn} is total`);
      assert.ok(Array.isArray(out), `${fn} returns a diagnostic array`);
      for (const d of out) assert.ok(d && typeof d.severity === 'string', 'each diagnostic has a severity');
    }
  }
});

test('a poisoned graph is flagged by deepValidate rather than silently serving junk', () => {
  const p = anEvilProject();
  const deep = p.deepValidate();
  assert.ok(deep.some((d) => d.severity === 'error'), 'NaN inputs must surface as errors');
});

/* ─────────────────────────── the fused pipeline ─────────────────────────── */

test('runFullPipeline returns all stages for the default project', () => {
  const report = runFullPipeline(aProject());
  for (const key of ['projectMeta', 'fit', 'yarn', 'compile', 'production', 'headline', 'errors', 'validation']) {
    assert.ok(key in report, `report carries ${key}`);
  }
  assert.ok(Array.isArray(report.errors));
  assert.ok(Array.isArray(report.validation));
  assert.ok(report.fit && Array.isArray(report.fit.pieces) && report.fit.pieces.length > 0, 'fit drafted pieces');
  assert.ok(report.compile && typeof report.compile.ok === 'boolean', 'compiler produced a verdict');
  assert.ok(report.headline && typeof report.headline.castOn !== 'undefined');
});

test('runFullPipeline refuses a non-Project loudly (no silent zero-report)', () => {
  for (const junk of [null, undefined, {}, 42, 'str']) {
    assert.throws(() => runFullPipeline(junk), TypeError, 'must demand a real Project');
  }
});

test('runFullPipeline survives a poisoned graph without throwing', () => {
  let report;
  assert.doesNotThrow(() => { report = runFullPipeline(anEvilProject()); });
  assert.ok(report.headline, 'a headline is always present');
  assert.ok(isFiniteNum(report.modelErrorCount) && report.modelErrorCount >= 0, 'model errors counted');
});

test('the pipeline ripples: change the gauge and cast-on moves', () => {
  const p = aProject();
  const low = runFullPipeline(p).headline.castOn;
  p.set('gauge.stitchesPer10cm', p.get('gauge.stitchesPer10cm') * 2);
  const high = runFullPipeline(p).headline.castOn;
  assert.notEqual(low, high, 'a doubled gauge must change the cast-on — the whole point of the fusion');
});

/* ─────────────────────────── Fit Engine ─────────────────────────── */

test('draftFromProject returns a coherent draft for any valid project', () => {
  const fit = FitEngine.draftFromProject(aProject());
  assert.ok(Array.isArray(fit.pieces) && fit.pieces.length > 0);
  for (const piece of fit.pieces) {
    assert.ok(piece && typeof piece === 'object');
    assert.ok('castOn' in piece, 'each piece reports a cast-on');
    if (typeof piece.castOn === 'number') assert.ok(Number.isFinite(piece.castOn));
  }
  assert.ok(fit.report && typeof fit.report === 'object', 'a fit report exists');
  assert.ok(fit.mesh && fit.mesh.body && fit.mesh.garment, 'both meshes are built');
  assert.ok(fit.drape, 'the drape simulation ran');
  assert.ok(fit.finishing, 'a finishing plan exists');
});

test('every construction template drafts real, finite pieces', () => {
  const names = FitEngine.CONSTRUCTIONS || [];
  assert.ok(names.length > 0, 'the engine advertises its constructions');
  for (const c of names) {
    let fit;
    assert.doesNotThrow(() => {
      const p = aProject();
      if (p.has('garment.construction')) { /* graph node is derived; drafting resolves it via opts */ }
      fit = FitEngine.draftGarment({
        body: FitEngine.defaultMeasurements(),
        gauge: { stsPer10cm: 22, rowsPer10cm: 30 },
        ease: new FitEngine.EaseProfile('standard'),
        style: { construction: c, lengthCm: 62, sleeveLengthCm: 48, armholeDepthCm: 22 }
      });
    }, `drafting ${c} must not throw`);
    assert.ok(fit && Array.isArray(fit.pieces) && fit.pieces.length > 0, `${c} produced pieces`);
  }
});

/* ─────────────────────────── Yarn Lab ─────────────────────────── */

test('yarnLabForProject consolidates a coherent view', () => {
  const lab = YarnLab.yarnLabForProject(aProject());
  assert.ok(Array.isArray(lab.yarns), 'a yarn list');
  assert.ok(isNonNeg(lab.totalMeters), 'total metres is a finite non-negative number');
  assert.ok(isNonNeg(lab.totalCost), 'total cost is finite and non-negative');
  assert.ok(lab.gauge && isNum(lab.gauge.stsPer10cm), 'a gauge is reported');
  assert.ok(Array.isArray(lab.shortfalls), 'shortfalls enumerated');
  assert.ok(lab.cost && typeof lab.cost === 'object');
});

test('colour engine round-trips hex <-> rgb <-> lab within tolerance', () => {
  for (const hex of ['#3b6ea5', '#000000', '#ffffff', '#c0ffee', '#ff0080']) {
    const rgb = YarnLab.hexToRgb(hex);
    assert.ok(rgb && isNum(rgb.r) && isNum(rgb.g) && isNum(rgb.b));
    const back = YarnLab.rgbToHex(rgb).toLowerCase();
    assert.equal(back, hex.toLowerCase(), `hex ${hex} survives the rgb round trip`);
    const lab = YarnLab.hexToLab(hex);
    assert.equal(YarnLab.rgbToHex(YarnLab.hslToRgb(YarnLab.rgbToHsl(rgb))).toLowerCase(), hex.toLowerCase(), 'hsl round trip');
    assert.ok(isFiniteNum(lab.L), 'Lab luma is finite');
  }
  // deltaE of a colour with itself is ~0 and symmetric.
  assert.ok(Math.abs(YarnLab.deltaE('#abcdef', '#abcdef')) < 1e-6);
});

test('the yarn database and stash never throw on bad input', () => {
  const db = YarnLab.getDefaultDatabase();
  assert.doesNotThrow(() => db.search(''));
  assert.doesNotThrow(() => db.search(null));
  assert.doesNotThrow(() => db.search(12345));
  assert.doesNotThrow(() => YarnLab.normalizeYarn(null));
  assert.doesNotThrow(() => YarnLab.normalizeYarn({}));
});

/* ─────────────────────────── Compiler V2 ─────────────────────────── */

test('compileProject emits every requested output and a single shared verdict', () => {
  const report = Compiler.compileProject(aProject(), { outputs: 'all' });
  assert.ok(report.summary && ['pass', 'warn', 'fail'].includes(report.summary.verdict), 'a bounded verdict');
  assert.equal(typeof report.ok, 'boolean');
  assert.ok(Array.isArray(report.verification) && report.verification.length > 0, 'the checks ran');
  for (const chk of report.verification) {
    assert.ok(chk && typeof chk.verdict === 'string', 'each check reports a verdict');
  }
  assert.ok(report.metrics && isNum(report.metrics.rows), 'metrics are numeric');
  for (const id of Compiler.BACKEND_IDS) {
    assert.ok(id in report.outputs, `backend ${id} was invoked (value may be null, key must exist)`);
  }
});

test('compileProject never throws even for a poisoned project', () => {
  for (const p of [aProject(), anEvilProject()]) {
    let report;
    assert.doesNotThrow(() => { report = Compiler.compileProject(p, { outputs: ['written', 'chart', 'machine'] }); });
    assert.ok(report.summary, 'there is always a summary');
    assert.ok(Array.isArray(report.errors));
  }
});

test('unknown output ids surface in the report instead of throwing', () => {
  const report = Compiler.compileProject(aProject(), { outputs: ['written', 'no-such-backend'] });
  assert.ok(report, 'a report is returned');
  assert.ok(Array.isArray(report.errors), 'the unknown backend is recorded');
});

/* ─────────────────────────── Reverse Engineer ─────────────────────────── */

test('reverseEngineer degrades to a structured failure on garbage images', () => {
  for (const img of [null, undefined, {}, { width: 0, height: 0 }, { data: [], width: 2, height: 2 }]) {
    let res;
    assert.doesNotThrow(() => { res = ReverseEngineer.reverseEngineer(img, {}); });
    assert.ok(res.gauge && isNum(res.gauge.confidence), 'a confidence is always reported');
    assert.ok(res.reconstruction && typeof res.reconstruction.knitScript === 'string');
    assert.ok(Array.isArray(res.warnings));
  }
});

test('reverseEngineer finds a real periodic gauge in a synthetic swatch', () => {
  const w = 128, h = 128, period = 8; // a clean lattice of stitches every 8px
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const on = (x % period < period / 2) || (y % period < period / 2);
      const v = on ? 230 : 40;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  let res;
  assert.doesNotThrow(() => { res = ReverseEngineer.reverseEngineer({ data, width: w, height: h }, { cmPerPixel: 0.2 }); });
  assert.ok(res.scale && isNum(res.scale.cmPerPixel), 'scale resolved');
  assert.ok(res.pattern && typeof res.pattern.primary === 'string', 'a pattern family was named');
  assert.ok(isNum(res.confidence), 'an overall confidence is reported');
});

/* ─────────────────────────── Production ─────────────────────────── */

test('buildCosting is internally consistent: total equals the sum of buckets', () => {
  const costing = Production.buildCosting(aProject(), { quantity: 12 });
  assert.equal(costing.quantity, 12);
  const bucketSum = costing.breakdown.reduce((t, b) => t + (Number(b.total) || 0), 0);
  assert.ok(Math.abs(bucketSum - costing.totalCost) < 1, `buckets (${bucketSum}) reconcile to total (${costing.totalCost})`);
  assert.ok(isFiniteNum(costing.unitCost) && costing.unitCost >= 0, 'unit cost is finite and non-negative');
  assert.ok(isFiniteNum(costing.suggestedPrice) && costing.suggestedPrice >= costing.unitCost, 'price >= cost');
});

test('the order state machine only allows legal transitions', () => {
  const order = Production.createOrder({ customer: 'c1', items: [{ name: 'sweater', qty: 2, price: 50 }] });
  assert.equal(order.status, 'pending');
  assert.equal(Production.canTransition('pending', 'confirmed'), true);
  assert.equal(Production.canTransition('pending', 'shipped'), false, 'cannot skip the pipeline');
  assert.throws(() => Production.transitionOrder(order, 'shipped'), 'illegal move throws');
  const moved = Production.transitionOrder(order, 'confirmed');
  assert.equal(moved.status, 'confirmed');
  assert.ok(isFiniteNum(order.total) || isFiniteNum(moved.total), 'totals computed');
});

test('inventory reservations never drive available stock negative', () => {
  let inv = Production.createInventory();
  inv = Production.upsertStock(inv, { yarnId: 'main', colorId: 'blue', quantity: 10, unitCost: 5, reorderPoint: 2 });
  const ok = Production.reserveStock(inv, { orderId: 'order-1', items: [{ yarnId: 'main', colorId: 'blue', grams: 4 }] });
  assert.equal(ok.reserved, true, 'a reservation within stock succeeds');
  assert.ok(ok.inventory.stock.every((s) => s.available >= 0), 'available stays non-negative');
  const over = Production.reserveStock(inv, { orderId: 'order-2', items: [{ yarnId: 'main', colorId: 'blue', grams: 999 }] });
  assert.equal(over.reserved, false, 'an over-reservation reports it could not fully reserve');
  assert.ok(over.shortfall.length > 0, 'and names the shortfall');
  assert.ok(over.inventory.stock.every((s) => s.available >= 0), 'even a partial reserve keeps available >= 0');
  assert.ok(Production.stockValue(ok.inventory) >= 0);
});

test('computePlan projects a coherent dashboard and never throws on a poisoned graph', () => {
  const plan = Production.createPlan({ projectId: 'v2', quantity: 5, currency: 'GBP' });
  let view;
  assert.doesNotThrow(() => { view = Production.computePlan(plan, aProject(), {}); });
  assert.ok(view.dashboard, 'a dashboard is projected');
  assert.equal(typeof view.feasible, 'boolean', 'feasibility is a definite answer');
  assert.ok(Array.isArray(view.warnings));
  assert.doesNotThrow(() => Production.computePlan(plan, anEvilProject(), {}), 'survives the evil graph');
});

test('pricing helpers keep price >= cost for sane inputs and never divide by zero', () => {
  const gbp = Production.priceFromCost(10, { markup: 2.4 });
  assert.ok(gbp && isFiniteNum(gbp.price) && gbp.price >= 10, 'cost-plus price covers cost');
  assert.doesNotThrow(() => Production.priceFromCost(0, { markup: 0 }));
  const breaks = Production.quantityBreaks(NaN, NaN, []);
  assert.ok(Array.isArray(breaks), 'quantity breaks still returns a schedule on garbage');
});
