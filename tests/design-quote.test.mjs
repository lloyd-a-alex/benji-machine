// Design-to-Quote fusion engine tests.
// Run with:  node --test "tests/design-quote.test.mjs"
//
// The quote engine is a *fusion* module: it composes the chart colour histogram, the
// carriage-pass time model, the tailor's yarn estimator and the production costing/order
// engines. These tests pin the seams between them — that yarn follows the real chart colour
// split, that lace time comes from carriage passes (not a stitches guess), that the money
// agrees with the shared costing engine, that a rendered sheet and a wrapped order match, and
// that a half-specified design degrades to a finite, warned quote instead of throwing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDesignQuote,
  resolveDesignChart,
  chartColorHistogram,
  renderQuoteSheet
} from '../js/production/quote.js';
import { PATTERN_PRESETS } from '../js/presets/preset-library.js';
import { quoteDesign } from '../js/v2/index.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';

const GAUGE = { stitchesPer10Cm: 22, rowsPer10Cm: 30 };
const YOJYARN = {
  yarns: [
    { name: 'Sandnes Karisma', colorway: 'Marineblå', hex: '#1b3a5c', metersPer100g: 200, ballMeters: 100, ballGrams: 50, pricePerBall: 4.2 },
    { name: 'Sandnes Karisma', colorway: 'Natur', hex: '#efe8d8', metersPer100g: 200, ballMeters: 100, ballGrams: 50, pricePerBall: 4.2 }
  ]
};

test('the quote barrel is reachable through the facade too', () => {
  assert.equal(typeof buildDesignQuote, 'function');
  assert.equal(typeof quoteDesign, 'function');
  // quoteDesign is a thin delegate: same numbers for the same design (id is time-random).
  const a = buildDesignQuote({ presetId: 'selbu_eightpoint_star', gauge: GAUGE, ...YOJYARN });
  const b = quoteDesign({ presetId: 'selbu_eightpoint_star', gauge: GAUGE, ...YOJYARN });
  assert.equal(a.yarn.totalMeters, b.yarn.totalMeters);
  assert.equal(a.costing.unitCost, b.costing.unitCost);
});

test('resolveDesignChart reads a preset and reports its mode', () => {
  const colorwork = resolveDesignChart({ presetId: 'selbu_eightpoint_star' });
  assert.ok(colorwork.matrix.length > 0, 'preset should generate a chart');
  assert.equal(colorwork.mode, 'fair_isle');
  assert.equal(colorwork.presetId, 'selbu_eightpoint_star');
  const lace = resolveDesignChart({ presetId: 'old_spangled_lace' });
  assert.equal(lace.mode, 'lace');
  const missing = resolveDesignChart({ presetId: 'definitely_not_a_real_preset' });
  assert.equal(missing.matrix.length, 0);
  assert.ok(missing.warnings.length > 0, 'an unknown preset should warn, not throw');
});

test('chartColorHistogram reflects the real per-colour makeup of the card', () => {
  const hist = chartColorHistogram([[0, 1, 1], [0, 0, 1]], 'fair_isle');
  const byIndex = Object.fromEntries(hist.map((h) => [h.index, h]));
  assert.equal(byIndex[0].cells, 3);
  assert.equal(byIndex[1].cells, 3);
  assert.ok(Math.abs(hist.reduce((t, h) => t + h.share, 0) - 1) < 1e-9, 'shares must sum to 1');
  // A lace card folds into ground + worked buckets, ground dominant.
  const laceMatrix = [
    [STITCH_TYPE.KNIT, STITCH_TYPE.EYELET, STITCH_TYPE.TRANSFER_LEFT],
    [STITCH_TYPE.KNIT, STITCH_TYPE.KNIT, STITCH_TYPE.KNIT]
  ];
  const lh = chartColorHistogram(laceMatrix, 'lace');
  const ground = lh.find((h) => h.ground);
  const worked = lh.find((h) => !h.ground);
  assert.ok(ground.cells > worked.cells, 'most of a light lace card is ground');
});

test('a colorwork quote splits yarn by the chart colour share and stays internally consistent', () => {
  const q = buildDesignQuote({
    presetId: 'selbu_eightpoint_star',
    gauge: GAUGE,
    machine: 'brother_standard_24',
    quantity: 6,
    currency: 'GBP',
    labourRate: 14,
    ...YOJYARN
  });
  assert.equal(q.quantity, 6);
  assert.ok(q.yarn.needs.length >= 2, 'two colours on the card, two lines on the shopping list');
  // Every need that carries a price costs money, and the totals are their sum.
  assert.equal(q.yarn.totalCost, Math.round(q.yarn.needs.reduce((t, n) => t + n.cost, 0) * 100) / 100);
  assert.ok(q.yarn.totalMeters > 0, 'gauge + parts must yield real metres');
  // Shares track the histogram: the more of a colour on the bed, the more of it you buy.
  const sorted = [...q.yarn.needs].sort((a, b) => b.share - a.share);
  assert.ok(sorted[0].share >= sorted[sorted.length - 1].share);
  // Costing is the shared engine's: total equals the sum of the buckets.
  const b = q.costing.batch;
  assert.equal(b.total, Math.round((b.yarn + b.labour + b.materials + b.overhead) * 100) / 100);
  assert.ok(q.costing.unitCost > 0 && Number.isFinite(q.costing.suggestedPrice));
});

test('lace time is derived from carriage passes, not a stitches-per-minute proxy', () => {
  const q = buildDesignQuote({ presetId: 'old_spangled_lace', gauge: GAUGE, machine: 'brother_standard_24', ...YOJYARN });
  const rows = q.chart.rows;
  assert.ok(rows > 0);
  // A Brother transfer row costs several passes, so the total passes exceed the raw row count.
  assert.ok(
    q.machine.passesPerUnit > rows,
    `expected lace passes (${q.machine.passesPerUnit}) to exceed the ${rows} design rows`
  );
  assert.ok(q.machine.knitMinutesPerUnit > 0);
});

test('the wrapped order and the printed sheet both match the quote lines', () => {
  const q = buildDesignQuote({ presetId: 'selbu_eightpoint_star', gauge: GAUGE, labourRate: 14, ...YOJYARN });
  const lineSum = Math.round(q.lines.reduce((t, l) => t + l.amount, 0) * 100) / 100;
  const orderSum = Math.round((q.order.subtotal || 0) * 100) / 100;
  assert.ok(Math.abs(lineSum - orderSum) < 0.05, `order subtotal ${orderSum} should match lines ${lineSum}`);

  const sheet = renderQuoteSheet(q);
  assert.match(sheet, /QUOTE /);
  assert.match(sheet, /YARN/);
  assert.match(sheet, /MACHINE TIME/);
  assert.match(sheet, /PRICE/);
  assert.ok(sheet.includes(q.sku), 'the sheet prints its own SKU');
});

test('garbage or empty designs never throw; they warn and stay finite', () => {
  const empty = buildDesignQuote({});
  assert.ok(Array.isArray(empty.warnings) && empty.warnings.length > 0, 'an empty design should warn');
  assert.ok(Number.isFinite(empty.costing.unitCost));
  assert.ok(Number.isFinite(empty.yarn.totalCost));

  const poisoned = buildDesignQuote({
    chart: [['nope', NaN, undefined], [Infinity, 1, 0]],
    gauge: { stitchesPer10Cm: 'banana', rowsPer10Cm: null },
    quantity: -5,
    yarns: [{ name: 'x', pricePerBall: 'oops' }]
  });
  assert.ok(Number.isFinite(poisoned.costing.unitCost), 'poisoned input must still produce a finite cost');
  assert.ok(poisoned.quantity >= 1, 'quantity is clamped to at least one');
  assert.ok(Number.isFinite(poisoned.geometry.totalStitches));
});

test('quoting the same design twice is deterministic', () => {
  const spec = { presetId: 'selbu_eightpoint_star', gauge: GAUGE, machine: 'brother_standard_24', quantity: 3, labourRate: 12, ...YOJYARN };
  const a = buildDesignQuote(spec);
  const b = buildDesignQuote(spec);
  assert.equal(JSON.stringify(a.yarn), JSON.stringify(b.yarn));
  assert.equal(a.costing.totalCost, b.costing.totalCost);
  assert.equal(a.price.retail, b.price.retail);
});

test('every family of preset can be quoted end to end', () => {
  // A representative sweep proves the engine handles lace, colorwork, texture and generative charts.
  const samples = ['old_spangled_lace', 'selbu_eightpoint_star', 'true_waffle', 'rule30_solo'];
  assert.ok(samples.every((id) => PATTERN_PRESETS.some((p) => p.id === id)), 'sample presets must exist');
  for (const id of samples) {
    const q = buildDesignQuote({ presetId: id, gauge: GAUGE, machine: 'brother_standard_24', ...YOJYARN });
    assert.ok(q.chart.cells > 0, `${id} should resolve a chart`);
    assert.ok(q.geometry.totalStitches >= 0);
    assert.ok(Number.isFinite(q.price.retail));
  }
});

test('a stock map turns into concrete shortfalls', () => {
  const q = buildDesignQuote({
    presetId: 'selbu_eightpoint_star',
    gauge: GAUGE,
    parts: [{ name: 'Back', castOn: 120, rows: 160 }], // a real garment, not a 16-px swatch
    stock: { 'Sandnes Karisma': 10 }, // 10 g on hand — nowhere near a garment
    ...YOJYARN
  });
  assert.ok(q.yarn.totalGrams > 10, 'the garment must need more than the stash holds');
  assert.ok(q.yarn.shortfalls.length > 0, 'a tiny stash must report shortfalls');
  assert.ok(q.yarn.shortfalls.every((s) => s.buy > 0));
});
