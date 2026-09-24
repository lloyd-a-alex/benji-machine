// KNITCAT — chart-analysis core tests (pure, DOM-free).
// Run with:  node --test "tests/*.test.mjs"
//
// These lock the low-level run/density/float maths that the feasibility advisor and the
// pattern browser's machine-fit badges now share. The point of extracting them is that the
// two consumers can never disagree about what a "long float" is, so the exact per-mode
// semantics and the limit-gating behaviour are pinned here directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  horizontalRuns,
  verticalRuns,
  punchedDensity,
  longestFloat,
  isActiveCell,
  colorCellCounts,
  analyzeChart
} from '../js/core/chart-analysis.js';
import { STITCH_TYPE as S } from '../js/math/knit-topology.js';

const LIMITS = { maxNeedles: 200, maxRows: 240, maxFloatNeedles: 9, maxTuckLoops: 6 };

test('horizontalRuns finds the longest run of a value and gates on the limit', () => {
  const M = [[1, 1, 0, 1, 1, 1]];
  const all = horizontalRuns(M, 1, 0);
  assert.equal(all.worst, 3, 'longest punched run should be 3');
  assert.deepEqual([...all.rows], [0]);
  assert.equal(all.cells.length, 5, 'both runs (>0) collected: 2 + 3');

  const gated = horizontalRuns(M, 1, 2);
  assert.equal(gated.worst, 3);
  assert.equal(gated.cells.length, 3, 'only the run longer than 2 is kept');

  const none = horizontalRuns(M, 1, 3);
  assert.equal(none.worst, 0, 'nothing exceeds a limit of 3');
  assert.equal(none.cells.length, 0);
});

test('verticalRuns traces held columns (the tuck failure mode)', () => {
  const M = [[0], [0], [1], [0]];
  const r = verticalRuns(M, 0, 0);
  assert.equal(r.worst, 2, 'two blank rows stack in column 0');
  assert.deepEqual([...r.columns], [0]);
});

test('punchedDensity counts active cells for direct and lace modes', () => {
  assert.equal(punchedDensity([[1, 0], [1, 1]], 'fair_isle').ratio, 0.75);
  const lace = [[S.KNIT, S.EYELET], S.TRANSFER_LEFT ? [S.TRANSFER_LEFT, S.KNIT] : []];
  const d = punchedDensity([[S.KNIT, S.EYELET], [S.TRANSFER_LEFT, S.KNIT]], 'lace');
  assert.equal(d.active, 2, 'eyelet and transfer are active; two knits are not');
  assert.equal(d.total, 4);
  void lace;
});

test('isActiveCell understands the lace alphabet vs direct 0/1', () => {
  assert.equal(isActiveCell('fair_isle', 1), true);
  assert.equal(isActiveCell('fair_isle', 0), false);
  assert.equal(isActiveCell('lace', S.EYELET), true);
  assert.equal(isActiveCell('lace', S.KNIT), false);
  assert.equal(isActiveCell('lace', S.EMPTY), false);
  assert.equal(isActiveCell('lace', undefined), false);
});

test('longestFloat applies the correct semantics per mode', () => {
  // A 24-wide row of all blanks: fair_isle sees a 24 float (colour B carried), slip too.
  const blankRow = [new Array(24).fill(0)];
  assert.equal(longestFloat(blankRow, 'fair_isle'), 24);
  assert.equal(longestFloat(blankRow, 'slip'), 24);
  // Tuck measures the VERTICAL hold, not the horizontal run.
  const tallTuck = [[0], [0], [0], [1]];
  assert.equal(longestFloat(tallTuck, 'tuck'), 3);
  // Lace has no floats.
  assert.equal(longestFloat([[S.EYELET, S.KNIT]], 'lace'), 0);
});

test('analyzeChart flags long floats on fair isle and returns a status', () => {
  const longFloat = [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]]; // 12 > 9
  const res = analyzeChart(longFloat, { mode: 'fair_isle', limits: LIMITS });
  assert.equal(res.status, 'needs-attention');
  assert.equal(res.metrics.longestFloat, 12);
  assert.ok(res.findings.some((f) => f.code === 'long-floats'));
});

test('analyzeChart catches cards wider or taller than the bed as blockers', () => {
  const wide = [new Array(210).fill(1)];
  const r1 = analyzeChart(wide, { mode: 'fair_isle', limits: LIMITS });
  assert.equal(r1.status, 'not-feasible');
  assert.ok(r1.findings.some((f) => f.code === 'too-wide'));

  const tall = Array.from({ length: 250 }, () => [1, 0, 1, 0]);
  const r2 = analyzeChart(tall, { mode: 'fair_isle', limits: LIMITS });
  assert.equal(r2.status, 'not-feasible');
  assert.ok(r2.findings.some((f) => f.code === 'too-tall'));
});

test('analyzeChart reports tuck bulk and over-punching as warnings', () => {
  // A column held for 8 rows > maxTuckLoops 6.
  const tucky = Array.from({ length: 8 }, () => [0, 1]);
  const r = analyzeChart(tucky, { mode: 'tuck', limits: LIMITS });
  assert.ok(r.findings.some((f) => f.code === 'long-tucks'));

  const dense = [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 0]];
  const rd = analyzeChart(dense, { mode: 'fair_isle', limits: LIMITS });
  assert.ok(rd.findings.some((f) => f.code === 'over-punched'), 'density over 0.92 should warn');
});

test('a clean short-float checkerboard is feasible', () => {
  const M = [[1, 0, 1, 0], [0, 1, 0, 1], [1, 0, 1, 0], [0, 1, 0, 1]];
  const r = analyzeChart(M, { mode: 'fair_isle', limits: LIMITS });
  assert.equal(r.status, 'feasible');
  assert.equal(r.findings.length, 0);
  assert.equal(r.metrics.longestFloat, 1);
});

test('analyzeChart is total — never throws on malformed charts', () => {
  const junk = [null, undefined, [], [[1, 1], null], [[1], [0, 0, 0]], 'nope', 42];
  for (const m of junk) {
    const r = analyzeChart(m, { mode: 'fair_isle', limits: LIMITS });
    assert.ok(['feasible', 'needs-attention', 'not-feasible', 'unknown'].includes(r.status));
    assert.ok(Number.isFinite(r.metrics.longestFloat));
  }
});

// ─── colour count vs the machine's yarn feeders ────────────────────────────

test('colorCellCounts keeps numeric palette indices and folds lace to two buckets', () => {
  // Direct (fair_isle) modes count every distinct yarn index the chart actually uses.
  const jacquard = colorCellCounts([[0, 1, 2, 3, 5]], 'fair_isle');
  assert.equal(jacquard.colors, 5);
  assert.equal(jacquard.cells, 5);
  assert.equal(jacquard.counts.get(2), 1);
  // Lace collapses to ground (0) vs worked (1), never a colour-per-symbol count.
  const lace = colorCellCounts([[S.KNIT, S.EYELET], [S.TRANSFER_LEFT, S.PURL]], 'lace');
  assert.equal(lace.colors, 2, 'plain knit/purl fold to ground, eyelet/transfer to worked');
});

test('a chart needing more colours than the bed has feeders is a blocker', () => {
  const jacquard = [[0, 1, 2, 3]]; // four distinct yarns
  const twoFeeders = analyzeChart(jacquard, { mode: 'fair_isle', limits: { ...LIMITS, maxColors: 2 } });
  assert.equal(twoFeeders.status, 'not-feasible');
  assert.equal(twoFeeders.metrics.colors, 4);
  assert.equal(twoFeeders.metrics.maxColors, 2);
  assert.ok(twoFeeders.findings.some((f) => f.code === 'too-many-colours' && f.sev === 'error'));

  // The same card on an electronic six-feeder machine clears the blocker entirely.
  const sixFeeders = analyzeChart(jacquard, { mode: 'fair_isle', limits: { ...LIMITS, maxColors: 6 } });
  assert.ok(!sixFeeders.findings.some((f) => f.code === 'too-many-colours'), 'within the feeder count is fine');
});

test('an absent maxColors limit means "no colour gate" (Infinity, never a false error)', () => {
  // LIMITS omits maxColors on purpose — older callers that do not pass it must not
  // suddenly fail every multi-colour chart.
  const many = [[0, 1, 2, 3, 4, 5, 6, 7]];
  const r = analyzeChart(many, { mode: 'fair_isle', limits: LIMITS });
  assert.equal(r.metrics.maxColors, Infinity);
  assert.ok(!r.findings.some((f) => f.code === 'too-many-colours'));
});
