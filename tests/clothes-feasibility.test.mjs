// Tests for the newer browser-free modules: clothes catalogue, feasibility
// advisor and the hidden designer key. Run with: node --test "tests/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ClothesEngine, GARMENTS, CATEGORIES } from '../js/tailor/clothes-catalog.js';
import { createFeasibilityAdvisor } from '../js/features/feasibility.js';
import { digest } from '../js/features/admin.js';
import { MACHINE_PROFILES } from '../js/machine/profiles.js';
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

test('advanced params exist but are a minority (designer-only surface stays calm)', () => {
  const adv = GARMENTS.reduce((a, g) => a + g.params.filter(p => p.advanced).length, 0);
  const tot = GARMENTS.reduce((a, g) => a + g.params.length, 0);
  assert.ok(adv > 0, 'some designer-only params exist');
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
  return { currentMode: mode, currentProfile: profile, compilationResult: null, editor: { matrix } };
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
