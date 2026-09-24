// Tests for the drafted garment engines and their fusion into the catalogue.
// These cover the row-by-row shaping engines (Sweater / Sock / Mitten) that now
// drive the generic 'body' / 'sock' / 'hand' structures, plus the shared shaping
// scheduler they are built on, and the ClothesEngine integration. Run with:
//   node --test "tests/drafted-garments.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SweaterEngine, SockEngine, MittenEngine, describeSchedule, draftGarment
} from '../js/tailor/drafted-engines.js';
import { ClothesEngine, GARMENTS } from '../js/tailor/clothes-catalog.js';
import { buildFashioning } from '../js/tailor/machine-steps.js';

const byId = id => GARMENTS.find(g => g.id === id);
const GAUGE = { stitchesPer10Cm: 24, rowsPer10Cm: 32 };

/** Walk a joined schedule piece and assert the live stitch count is honest. */
function assertScheduleHonest(piece, label) {
  assert.ok(Array.isArray(piece.rows) && piece.rows.length > 0, `${label}: has rows`);
  assert.ok(piece.castOn > 0, `${label}: positive cast-on`);
  let live = piece.castOn;
  for (const r of piece.rows) {
    if (r.action === 'increase') live += r.count;
    else if (r.action === 'decrease' || r.action === 'bind-off') live -= r.count;
    assert.ok(live >= 0, `${label}: live sts never negative at row ${r.row} (${live})`);
    assert.equal(r._after, live, `${label}: row ${r.row} _after tracks live sts`);
  }
  assert.equal(piece.finalStitches, live, `${label}: finalStitches matches the walk`);
  assert.equal(piece.totalRows, piece.rows.length, `${label}: totalRows matches rows`);
}

// ─── Every engine is defensive and never throws ──────────────────────────────

test('drafted engines never throw on garbage input', () => {
  const junk = [
    {}, { chest: NaN, length: 'x', sleeve: undefined }, { hand: Infinity, rib: -5 },
    { calf: 'a', leg: NaN, foot: 0 }
  ];
  for (const params of junk) {
    for (const Engine of [SweaterEngine, SockEngine, MittenEngine]) {
      const m = new Engine().compute(params, { stitchesPer10Cm: 'x', rowsPer10Cm: NaN });
      assert.ok(Number.isFinite(m.parts[0].castOn) && m.parts[0].castOn > 0, `${Engine.name} finite cast-on`);
      assert.ok(Number.isFinite(m.parts[0].rows) && m.parts[0].rows > 0, `${Engine.name} finite rows`);
      assert.ok(m.instructions.length >= 4, `${Engine.name} has an instruction list`);
      assert.ok(m.instructions.every(i => Number.isFinite(i.step) && i.title && i.text));
    }
  }
});

test('draftGarment returns null for structures handled elsewhere and never throws', () => {
  assert.equal(draftGarment({ structure: 'hat' }, {}, GAUGE), null);
  assert.equal(draftGarment({ structure: 'tank' }, {}, GAUGE), null);
  assert.equal(draftGarment(null), null);
  assert.ok(draftGarment({ structure: 'body' }, {}, GAUGE));
});

// ─── Sweater / body engine ───────────────────────────────────────────────────

test('sweater cast-on is even, positive and scales monotonically with chest', () => {
  const eng = new SweaterEngine();
  let prev = 0;
  for (const chest of [80, 92, 100, 112, 130]) {
    const m = eng.compute({ chest }, GAUGE);
    const castOn = m.metrics.ribSts;
    assert.equal(castOn % 2, 0, 'rib cast-on is even');
    assert.ok(castOn > prev, `cast-on grows with chest (${prev} → ${castOn})`);
    prev = castOn;
  }
  assert.ok(eng.compute({ chest: 100 }, GAUGE).metrics.bustSts > prev * 0.001);
});

test('sweater schedule is honest and a sleeved garment gets a sleeve piece', () => {
  const m = new SweaterEngine().compute({ chest: 100, sleeve: 45, waist: -4 }, GAUGE);
  assert.equal(m.schedule.length, 2, 'body + sleeve');
  assertScheduleHonest(m.schedule[0], 'sweater body');
  assertScheduleHonest(m.schedule[1], 'sweater sleeve');
  assert.ok(m.parts[1] && /Sleeve/.test(m.parts[1].name), 'sleeve part present');
  const bodyEvents = describeSchedule(m.schedule[0]);
  assert.ok(bodyEvents.some(e => e.action === 'increase'), 'bust increases present');
  assert.ok(bodyEvents.some(e => e.action === 'decrease'), 'waist/armhole decreases present');
});

test('sleeveless body garment omits the sleeve piece', () => {
  const m = new SweaterEngine().compute({ chest: 92, sleeve: 0 }, GAUGE);
  assert.equal(m.schedule.length, 1, 'body only');
  assert.equal(m.parts.length, 1, 'one part');
  assert.match(m.instructions[3].text, /strap|neckband|Sleeveless/i, 'straps step for sleeveless');
});

// ─── Sock engine ─────────────────────────────────────────────────────────────

test('sock cast-on is a clean multiple of four with a halved heel', () => {
  const m = new SockEngine().compute({ calf: 24, leg: 20, foot: 25, rib: 5 }, GAUGE);
  assert.equal(m.metrics.sts % 4, 0, 'cast-on divisible by 4 (heel + toe quarters)');
  assert.equal(m.metrics.heelSts, m.metrics.sts / 2, 'heel flap is half the live sts');
  assert.ok(m.metrics.toeSts >= 8 && m.metrics.toeSts < m.metrics.sts, 'toe tapers smaller than leg');
  assert.equal(m.instructions.length, 6, 'cuff, leg, flap, turn, gusset, foot, toe → 6 steps');
  assert.ok(/Kitchener|graft/i.test(m.instructions[5].text), 'toe is grafted');
  assertScheduleHonest(m.schedule[1], 'sock foot');
});

test('sock heel turn is a real short-row wedge', () => {
  const m = new SockEngine().compute({ calf: 24 }, GAUGE);
  assert.ok(m.metrics.heelTurn.turns >= 2, 'heel turn uses at least 2 wrapped turns');
  assert.ok(Array.isArray(m.metrics.heelTurn.rows) && m.metrics.heelTurn.rows.length >= 1);
});

// ─── Mitten / hand engine ──────────────────────────────────────────────────

test('mitten thumb gusset increases exactly the thumb stitch count', () => {
  const m = new MittenEngine().compute({ hand: 22, length: 24, rib: 6 }, GAUGE);
  const incEvents = describeSchedule(m.schedule[0]).filter(e => e.action === 'increase');
  assert.ok(incEvents.length > 0, 'gusset adds stitches');
  const added = incEvents.reduce((a, e) => a + e.count, 0);
  assert.equal(added, m.metrics.thumbSts, 'gusset increases sum to the thumb wedge');
  assertScheduleHonest(m.schedule[0], 'mitten gusset');
  assertScheduleHonest(m.schedule[2], 'mitten thumb');
  assert.match(m.instructions[2].text, /waste yarn|hold/i, 'thumb held on waste yarn');
});

test('mitten thumb is about a quarter of the hand circumference', () => {
  const m = new MittenEngine().compute({ hand: 22 }, GAUGE);
  const ratio = m.metrics.thumbSts / m.metrics.sts;
  assert.ok(ratio > 0.18 && ratio < 0.36, `thumb ratio ${ratio.toFixed(2)} is sane`);
});

// ─── Catalogue integration ───────────────────────────────────────────────────

test('body / sock / mitten catalogue plans now carry a drafted schedule', () => {
  const eng = new ClothesEngine();
  for (const id of ['sweater', 'cardigan', 'socks', 'mittens', 'babysweater', 'booties', 'fingerless']) {
    const plan = eng.compute(byId(id), {}, GAUGE);
    assert.ok(plan.drafted && plan.schedule, `${id} drafted`);
    assert.ok(Array.isArray(plan.schedule) && plan.schedule.length >= 1, `${id} has schedule pieces`);
    for (const pc of plan.schedule) assertScheduleHonest(pc, `${id}/${pc.id}`);
    assert.ok(plan.parts[0].castOn > 0 && plan.parts[0].rows > 0, `${id} parts intact`);
    assert.ok(plan.geometry && plan.geometry.outlineMm.length >= 3, `${id} geometry intact`);
  }
});

test('fashioning quotes the exact drafted rows for a sweater', () => {
  const eng = new ClothesEngine();
  const plan = eng.compute(byId('sweater'), {}, GAUGE);
  const steps = buildFashioning(plan, { pitchX: 4.5, bedLengthMm: 900, columns: 24 });
  assert.ok(steps.length >= 5, 'base + drafted detail');
  assert.ok(steps.some(s => /exact rows/i.test(s.title)), 'drafted exact-rows step present');
  assert.ok(steps.some(s => /R\d+ (decrease|increase|bind-off)/.test(s.text)), 'literal rows named');
  assert.ok(steps.some(s => /Needles L\d/.test(s.text)), 'needle positions still present');
});

test('drafting does not disturb the per-10cm gauge basis the catalogue reports', () => {
  const plan = new ClothesEngine().compute(byId('sweater'), {}, GAUGE);
  assert.equal(plan.gauge.stitchesPer10Cm, 24);
  assert.equal(plan.gauge.rowsPer10Cm, 32);
});

// ─── describeSchedule ────────────────────────────────────────────────────────

test('describeSchedule drops plain knit rows and reports running stitch counts', () => {
  const m = new SweaterEngine().compute({ chest: 100, sleeve: 45 }, GAUGE);
  const events = describeSchedule(m.schedule[0]);
  assert.ok(events.every(e => e.action !== 'knit'), 'no plain rows');
  assert.ok(events.every(e => Number.isFinite(e.stsAfter)), 'each event carries a stitch count');
  assert.equal(describeSchedule(null).length, 0);
  assert.equal(describeSchedule({ rows: [] }).length, 0);
});
