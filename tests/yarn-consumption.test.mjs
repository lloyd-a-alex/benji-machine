// KNITCAT — chart-aware yarn consumption tests (pure, DOM-free).
// Run with:  node --test "tests/yarn-consumption.test.mjs"
//
// The production quote used to buy yarn strictly by how much of each colour you can *see*. That
// quietly under-quotes stranded colourwork, where a contrast colour is carried behind every float
// even in cells it never shows. These lock the yarn-path model: floats inflate total demand and
// re-weight toward the carried colour, while monochrome, lace, slip and tuck stay on the flat model
// (no phantom second colour), and the whole thing is total on garbage input.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeYarnConsumption,
  colorCellCounts,
  LOOP_WEIGHT,
  FLOAT_WEIGHT
} from '../js/core/yarn-consumption.js';
import { buildDesignQuote } from '../js/production/quote.js';
import { STITCH_TYPE as S } from '../js/math/knit-topology.js';

const GAUGE = { stitchesPer10Cm: 22, rowsPer10Cm: 30 };
const oneBall = (extra = {}) => ({ name: 'Y', metersPer100g: 200, ballMeters: 100, ballGrams: 50, pricePerBall: 4.2, ...extra });

test('a carried colour is weighted far above its visible share', () => {
  // 18 blanks, 2 contrast stitches: the contrast reads as 10% of the pixels.
  const M = [[0, 0, 0, 0, 0, 0, 0, 1, 0, 0], [0, 0, 0, 1, 0, 0, 0, 0, 0, 0]];
  const a = analyzeYarnConsumption(M, 'fair_isle');
  assert.equal(a.colors, 2);
  assert.ok(a.densityFactor > 1, 'stranded work uses more yarn than a flat area estimate');
  const contrast = a.shares.get(1);
  assert.ok(contrast > 2 / 20, 'the carried colour is bought at more than its 10% pixel share');
  assert.ok(contrast < 0.5, 'but still less than the dominant ground it floats behind');
  // Ground + contrast shares must sum to 1.
  assert.ok(Math.abs(a.shares.get(0) + contrast - 1) < 1e-9);
});

test('density factor equals 1 + (colours-1)·float for a stranded field', () => {
  const M = [[0, 1], [1, 0]]; // perfectly balanced 2-colour
  const a = analyzeYarnConsumption(M, 'fair_isle');
  assert.ok(Math.abs(a.densityFactor - (LOOP_WEIGHT + FLOAT_WEIGHT)) < 1e-9);
  const three = analyzeYarnConsumption([[0, 1, 2], [1, 2, 0]], 'fair_isle');
  assert.equal(three.colors, 3);
  assert.ok(Math.abs(three.densityFactor - (LOOP_WEIGHT + 2 * FLOAT_WEIGHT)) < 1e-9);
});

test('monochrome and non-stranded modes keep a flat density factor of 1', () => {
  assert.equal(analyzeYarnConsumption([[1, 1], [1, 1]], 'fair_isle').densityFactor, 1, 'single colour floats nothing');
  assert.equal(analyzeYarnConsumption([[0, 1], [1, 0]], 'slip').densityFactor, 1);
  assert.equal(analyzeYarnConsumption([[0, 1], [1, 0]], 'tuck').densityFactor, 1);
  const lace = analyzeYarnConsumption([[S.KNIT, S.EYELET], [S.KNIT, S.KNIT]], 'lace');
  assert.equal(lace.densityFactor, 1, 'lace openness comes from blocking, not absent yarn');
});

test('non-stranded shares fall back to the plain visible-cell split', () => {
  const M = [[S.KNIT, S.EYELET], [S.KNIT, S.KNIT]]; // 1 worked of 4
  const a = analyzeYarnConsumption(M, 'lace');
  assert.ok(Math.abs(a.shares.get(1) - 0.25) < 1e-9);
  assert.ok(Math.abs(a.shares.get(0) - 0.75) < 1e-9);
});

test('colorCellCounts folds lace to ground/worked and keeps direct indices', () => {
  const { counts: lace, cells } = colorCellCounts([[S.KNIT, S.EYELET], [S.TRANSFER_LEFT, S.PURL]], 'lace');
  assert.equal(cells, 4);
  assert.equal(lace.get(0), 2, 'two plain knits/purls');
  assert.equal(lace.get(1), 2, 'eyelet + transfer are worked');
  const jac = colorCellCounts([[0, 2, 2, 5]], 'fair_isle');
  assert.deepEqual([...jac.counts.entries()].sort(), [[0, 1], [2, 2], [5, 1]], 'palette indices preserved');
});

test('analyzeYarnConsumption is total — garbage returns a neutral model, never throws', () => {
  for (const junk of [null, undefined, [], [null, undefined], [[1], []], 'nope', 42]) {
    const a = analyzeYarnConsumption(junk, 'fair_isle');
    assert.ok(Number.isFinite(a.densityFactor) && a.densityFactor >= 1, `density on ${JSON.stringify(junk)}`);
    let sum = 0;
    for (const v of a.shares.values()) sum += v;
    assert.ok(a.shares.size === 0 || Math.abs(sum - 1) < 1e-9, 'shares sum to 1 or are empty');
  }
});

test('a two-yarn fair-isle quote buys more yarn than the same chart on one yarn', () => {
  const preset = { presetId: 'selbu_eightpoint_star', gauge: GAUGE, machine: 'brother_standard_24' };
  const two = buildDesignQuote({ ...preset, yarns: [oneBall(), oneBall({ colorway: 'B' })] });
  const one = buildDesignQuote({ ...preset, yarns: [oneBall()] });
  assert.ok(two.yarn.totalMeters > one.yarn.totalMeters, 'the carried float colour is real yarn');
  assert.ok(Math.abs(two.yarn.totalMeters - two.yarn.needs.reduce((t, n) => t + n.meters, 0)) < 0.5, 'per-colour metres still sum to the total');
  assert.ok(two.yarn.needs.every(n => n.meters >= 0));
});
