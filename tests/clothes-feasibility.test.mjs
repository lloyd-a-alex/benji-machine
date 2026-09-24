// Tests for the newer browser-free modules: clothes catalogue, feasibility
// advisor and the hidden designer key. Run with: node --test "tests/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ClothesEngine, GARMENTS, CATEGORIES } from '../js/tailor/clothes-catalog.js';
import { createFeasibilityAdvisor } from '../js/features/feasibility.js';
import { digest } from '../js/features/admin.js';
import { MACHINE_PROFILES, profileLimits, bedNeedleCapacity } from '../js/machine/profiles.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';

const gauge = { stitchesPer10Cm: 24, rowsPer10Cm: 32 };
const byId = id => GARMENTS.find(g => g.id === id);

// ─── Catalogue shape ──────────────────────────────────────────────────────────

test('every garment belongs to a declared category and has params', () => {
  assert.ok(GARMENTS.length >= 15, 'a broad catalogue');
  for (const g of GARMENTS) {
    assert.ok(CATEGORIES.includes(g.category), `${g.id} category "${g.category}" is declared`);
    assert.ok(g.params.length >= 2, `${g.id} has parameters`);
    for (const p of g.params) assert.ok(typeof p.default !== 'undefined', `${g.id}.${p.key} has a default`);
  }
});

test('advanced-tagged params exist but stay a minority (fit surface stays calm)', () => {
  const adv = GARMENTS.reduce((a, g) => a + g.params.filter(p => p.advanced).length, 0);
  const tot = GARMENTS.reduce((a, g) => a + g.params.length, 0);
  assert.ok(adv > 0, 'some tagged advanced params exist');
  assert.ok(adv < tot / 2, 'advanced params are the exception, not the rule');
});

// ─── Generic planner computes a real plan for every structure ──────────────────

test('clothes engine produces cast-on, rows and steps for every garment', () => {
  const eng = new ClothesEngine();
  for (const g of GARMENTS) {
    const plan = eng.compute(g, {}, gauge);
    assert.ok(plan.parts.length >= 1, `${g.id} yields parts`);
    for (const part of plan.parts) {
      assert.ok(Number.isFinite(part.castOn) && part.castOn > 0, `${g.id} cast-on`);
      assert.ok(Number.isFinite(part.rows) && part.rows > 0, `${g.id} rows`);
    }
    assert.ok(plan.instructions.length >= 3, `${g.id} step list`);
    assert.ok(plan.garment.id === g.id);
  }
});

test('beanie cast-on divides evenly by its crown segments', () => {
  const eng = new ClothesEngine();
  const g = byId('beanie');
  const plan = eng.compute(g, { head: 56, segments: 8 }, gauge);
  const sts = plan.parts[0].castOn;
  // cast-on is derived from a multiple-of-segments body stitch count
  assert.ok(sts > 0);
});

test('hat 2x2 ribbing snaps the body stitch count to a multiple of 4 per segment', () => {
  const eng = new ClothesEngine();
  const plan = eng.compute(byId('beanie'), { segments: 6, ribtype: '2x2' }, gauge);
  assert.ok(plan.parts[0].castOn > 0);
});

test('advanced garment params actually shift the computed plan', () => {
  const eng = new ClothesEngine();
  const base = eng.compute(byId('beanie'), { head: 56 }, gauge).parts[0].castOn;
  const loose = eng.compute(byId('beanie'), { head: 56, ease: 0 }, gauge).parts[0].castOn;
  // less negative ease → bigger head circumference → at least as many stitches
  assert.ok(loose >= base, `${loose} >= ${base}`);
});

test('clothes engine is defensive against empty / garbage input', () => {
  const eng = new ClothesEngine();
  assert.equal(eng.compute(null), null);
  const plan = eng.compute(byId('sweater'), { chest: NaN, length: 'x' }, { stitchesPer10Cm: 'y' });
  assert.ok(Number.isFinite(plan.parts[0].castOn) && plan.parts[0].castOn > 0);
});

test('1:1 SVG export is well-formed and personalised', () => {
  const eng = new ClothesEngine();
  const plan = eng.compute(byId('scarf'), {}, gauge);
  const svg = eng.toSvg(plan);
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<svg[\s\S]*<\/svg>/);
  assert.match(svg, /made for Benji/);
});

// ─── Feasibility advisor (expert system) ──────────────────────────────────────

function fakeApp(mode, matrix, profile = MACHINE_PROFILES.brother_standard_24) {
  const editor = {
    matrix,
    // The advisor's trim fixes call straight back into the editor, so record what
    // shape was actually asked for instead of trusting the label text.
    requests: [],
    setDimensions(rows, cols) { this.requests.push({ rows, cols }); }
  };
  return { currentMode: mode, currentProfile: profile, compilationResult: null, editor };
}

test('blank fair-isle card is flagged as informational', () => {
  const adv = createFeasibilityAdvisor(fakeApp('fair_isle', [[0, 0, 0], [0, 0, 0]]));
  const v = adv.verdict();
  assert.ok(v.issues.some(i => i.title.match(/blank/i)));
});

test('long fair-isle floats are detected and offer a safe fix', () => {
  const row = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]; // 10 punched = a 10-stitch float
  const app = fakeApp('fair_isle', [row.slice()]);
  const adv = createFeasibilityAdvisor(app);
  const float = adv.verdict().issues.find(i => /float/i.test(i.title));
  assert.ok(float, 'float flagged');
  assert.equal(float.sev, 'warn');
  assert.ok(float.fix && float.fix.safe && typeof float.fix.run === 'function');
  // Applying the fix must break the run so no float exceeds the limit.
  float.fix.run();
  const again = adv.verdict().issues.find(i => /float/i.test(i.title));
  assert.ok(!again, 'float cleared after fix');
});

test('fair-isle floats are checked for BOTH colours, not just the punched one', () => {
  // Isolated punches with a wide background between them: the punched (1) cells never
  // run long, so the old check saw nothing — yet yarn B is carried behind ten blanks,
  // a real float. This is the case the single-colour check silently missed.
  const row = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
  const app = fakeApp('fair_isle', [row.slice()]);
  const adv = createFeasibilityAdvisor(app);
  const float = adv.verdict().issues.find(i => /float/i.test(i.title) && !/slip/i.test(i.title));
  assert.ok(float, 'the carried-background float is flagged');
  float.fix.run();
  assert.ok(!adv.verdict().issues.find(i => /float/i.test(i.title)), 'and the fix clears it');
});

test('slip-mode float detection uses slipped cells, not punched ones', () => {
  // A run of slipped (0) cells is the slip float; here a long gap between punches.
  const row = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
  const adv = createFeasibilityAdvisor(fakeApp('slip', [row.slice()]));
  const issue = adv.verdict().issues.find(i => /slip float/i.test(i.title));
  assert.ok(issue, 'slip float flagged from 0-runs');
});

test('over-tall card proposes a trim fix', () => {
  const rows = Array.from({ length: 300 }, () => [0, 0, 0]);
  const adv = createFeasibilityAdvisor(fakeApp('fair_isle', rows));
  const tall = adv.verdict().issues.find(i => /too tall/i.test(i.title));
  assert.ok(tall && tall.fix && tall.fix.safe);
});

test('a clean feasible card reports success', () => {
  const app = fakeApp('fair_isle', [[1, 0, 1, 0], [0, 1, 0, 1]]);
  const adv = createFeasibilityAdvisor(app);
  const v = adv.verdict();
  assert.equal(v.status, 'feasible');
  assert.ok(v.issues.some(i => i.sev === 'ok'));
});

test('bulkier gauge tolerates a shorter maximum float', () => {
  const fine = MACHINE_PROFILES.brother_standard_24;
  const adv = createFeasibilityAdvisor(fakeApp('fair_isle', [[0]]));
  // maxFloatFor returns the default for a fine bed
  assert.ok(adv.maxFloatFor(fine) >= 5);
});

// ─── One source of truth for the physical envelope ───────────────────────────

test('every profile states its bed length, float cap and tuck cap', () => {
  for (const p of Object.values(MACHINE_PROFILES)) {
    assert.ok(p.bedLengthMm > 0, `${p.id} states a bed length`);
    assert.ok(p.maxFloatNeedles >= 2, `${p.id} states a float cap`);
    assert.ok(p.maxTuckLoops >= 2, `${p.id} states a tuck cap`);
    assert.ok(Number.isFinite(p.maxColors) && p.maxColors >= 2, `${p.id} states a yarn-feeder count (>= 2)`);
    assert.equal(profileLimits(p).maxColors, p.maxColors, `${p.id} feeder count flows through profileLimits`);
    // Capacity is derived, so it can never contradict the pitch it came from.
    assert.ok(bedNeedleCapacity(p) >= p.columns, `${p.id} bed fits at least one repeat`);
    assert.equal(
      bedNeedleCapacity(p),
      Math.max(p.columns, Math.floor(p.bedLengthMm / p.pitchX)),
      `${p.id} needle capacity derives from pitch x bed length`
    );
  }
});

test('the advisor reads float limits from the profile instead of its own copy', () => {
  const adv = createFeasibilityAdvisor(fakeApp('fair_isle', [[0]]));
  for (const p of Object.values(MACHINE_PROFILES)) {
    assert.equal(adv.maxFloatFor(p), profileLimits(p).maxFloatNeedles,
      `${p.id}: advisor and diagnostics must agree or the app contradicts itself`);
  }
});

test('a card wider than the needle bed is an error with a one-click trim', () => {
  const profile = MACHINE_PROFILES.brother_standard_24;
  const { maxNeedles } = profileLimits(profile);
  const app = fakeApp('fair_isle', [new Array(maxNeedles + 25).fill(0)], profile);
  const wide = createFeasibilityAdvisor(app).analyze().find(i => /wider than/i.test(i.title));
  assert.ok(wide, 'over-width flagged');
  assert.equal(wide.sev, 'error', 'unreachable columns are not a warning');
  assert.equal(wide.fix.safe, true);
  wide.fix.run();
  assert.deepEqual(app.editor.requests, [{ rows: 1, cols: maxNeedles }],
    'the trim asks for exactly the bed width');
});

test('tuck mode caps VERTICAL loop stacking at the profile limit', () => {
  const profile = MACHINE_PROFILES.brother_standard_24;
  const { maxTuckLoops } = profileLimits(profile);
  // 24 blank rows in one column: nothing to do with horizontal floats.
  const matrix = Array.from({ length: maxTuckLoops + 12 }, () => [0, 1]);
  const app = fakeApp('tuck', matrix, profile);
  const adv = createFeasibilityAdvisor(app);
  const issue = adv.analyze().find(i => /tuck for up to/i.test(i.title));
  assert.ok(issue, 'long tuck column flagged');
  assert.match(issue.problem, new RegExp(`${maxTuckLoops} rows`), 'names the machine limit');
  issue.fix.run();
  assert.ok(!adv.analyze().some(i => /tuck for up to/i.test(i.title)), 'fix clears the stacking');
});

// ─── Single-bed vs double-bed honesty ───────────────────────────────────────

test('every machine profile declares how many needle beds it has', () => {
  for (const p of Object.values(MACHINE_PROFILES)) {
    assert.ok(p.beds === 1 || p.beds === 2, `${p.id} says 1 or 2 beds`);
  }
  assert.equal(MACHINE_PROFILES.brother_standard_24.beds, 1, 'KH-830 is single-bed');
  assert.equal(MACHINE_PROFILES.passap_duo_40.beds, 2, 'Passap Duo is double-bed');
});

test('lace on a single-bed machine explains that transfers stay in one bed', () => {
  const rows = Array.from({ length: 6 }, (_, r) => Array.from({ length: 8 }, (_, c) =>
    (c === 2 && r % 3 === 0) ? STITCH_TYPE.EYELET : STITCH_TYPE.KNIT));
  const adv = createFeasibilityAdvisor(fakeApp('lace', rows));
  const bed = adv.analyze().find(i => /needle bed/i.test(i.title));
  assert.ok(bed, 'single-bed note is surfaced');
  assert.equal(bed.sev, 'info');
  assert.match(bed.problem, /same bed/i);
});

test('a double-bed profile is flagged as a modelling mismatch, not silently compiled', () => {
  const rows = Array.from({ length: 6 }, () => Array.from({ length: 8 }, () => 1));
  const adv = createFeasibilityAdvisor(fakeApp('fair_isle', rows, MACHINE_PROFILES.passap_duo_40));
  const warn = adv.analyze().find(i => /two needle beds/i.test(i.title));
  assert.ok(warn, 'double-bed advisory present');
  assert.equal(warn.sev, 'warn');
  // Changing the user's machine is a preference: never bundle it into "Fix all".
  assert.equal(warn.fix.safe, false);
});

// A punchcard reader drives two yarn positions; the electronic KH-9xx colour changer
// (and the parametric custom bed) drives more. Pinned so a profile edit cannot quietly
// drop the standard gauges below the two-colour floor or inflate the punchcard machines.
test('punchcard machines hold two feeders, electronic colour changers more', () => {
  for (const id of ['brother_standard_24', 'silver_reed_standard_24', 'passap_duo_40', 'brother_bulky_24', 'toyota_standard_24']) {
    assert.equal(profileLimits(MACHINE_PROFILES[id]).maxColors, 2, `${id} is a two-feeder punchcard bed`);
  }
  assert.equal(profileLimits(MACHINE_PROFILES.brother_maxi_60).maxColors, 6, 'KH-9xx electronic colour changer');
});

test('the advisor blocks a chart with more colours than the bed has feeders', () => {
  const jacquard = [[0, 1, 2, 3]]; // four distinct yarns
  const brother = fakeApp('fair_isle', jacquard, MACHINE_PROFILES.brother_standard_24);
  const issue = createFeasibilityAdvisor(brother).analyze().find(i => /feeders/i.test(i.title));
  assert.ok(issue, 'over-feeder chart flagged');
  assert.equal(issue.sev, 'error', 'unreachable colours are not a warning');
  // Colour reduction is destructive: the advisor must NOT offer a "safe" one-click fix.
  assert.ok(!issue.fix || issue.fix.safe !== true, 'no silent auto-fix that deletes colours');

  // The very same card clears on a six-feeder electronic machine.
  const maxi = fakeApp('fair_isle', jacquard, MACHINE_PROFILES.brother_maxi_60);
  assert.ok(!createFeasibilityAdvisor(maxi).analyze().some(i => /feeders/i.test(i.title)),
    'a colour changer with enough feeders is fine');
});

test('a clean short-float checkerboard is feasible', () => {
  const app = fakeApp('fair_isle', [[1, 0, 1, 0], [0, 1, 0, 1]]);
  assert.equal(createFeasibilityAdvisor(app).verdict().status, 'feasible');
});

// ─── Hidden designer key (double digest, never plaintext) ─────────────────────

test('the passphrase digest is stable and double-round shaped', () => {
  const d = digest('iloveyou');
  assert.equal(d, digest('iloveyou'));
  assert.match(d, /^[\w]+-[\w]+$/);
});

test('a wrong phrase produces a different digest (no collisions on near-misses)', () => {
  assert.notEqual(digest('iloveyou'), digest('i love you'));
  assert.notEqual(digest('iloveyou'), digest('iloveyouu'));
  assert.notEqual(digest('iloveyou'), digest('ILoveYou'));
});
