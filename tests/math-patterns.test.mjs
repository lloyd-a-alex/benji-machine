// The mathematical pattern subsystem is a body of real mathematics — number
// theory, quasi-Monte-Carlo, linear algebra, discrete geometry, chaos — that has
// to be *correct*, not just pretty. So this file tests the primitives against
// their defining properties (a Hadamard matrix must be orthogonal; a Christoffel
// word must be maximally even; van der Corput must invert the digits) and every
// generator for shape, binary domain, determinism and a structural invariant.
// These are all pure and DOM-free, so they run head-to-head under `node --test`.
//
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gcd, radicalInverse, haltonPoint, distributeEvenly, hadamardMatrix,
  superformulaRadius, MathPatternGenerators as G
} from '../js/generators/math-patterns.js';

// ── helpers ──────────────────────────────────────────────────────────────────
const binary = (m) => m.every((row) => row.every((v) => v === 0 || v === 1));
const shapeOk = (m, rows, cols) => m.length === rows && m.every((row) => row.length === cols);
const ones = (m) => m.reduce((s, row) => s + row.reduce((a, v) => a + v, 0), 0);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function gapSpread(row) {
  const idx = [];
  row.forEach((v, i) => { if (v) idx.push(i); });
  const gaps = [];
  for (let i = 1; i < idx.length; i++) gaps.push(idx[i] - idx[i - 1]);
  return gaps.length ? Math.max(...gaps) - Math.min(...gaps) : 0;
}

/* ── pure primitives: prove the mathematics, not the picture ─────────────────── */
test('gcd is Euclid and handles zeros / negatives', () => {
  assert.equal(gcd(12, 18), 6);
  assert.equal(gcd(48, 36), 12);
  assert.equal(gcd(7, 13), 1);
  assert.equal(gcd(0, 5), 5);
  assert.equal(gcd(-8, 12), 4);
});

test('radicalInverse reflects base-b digits (van der Corput)', () => {
  assert.equal(radicalInverse(0, 2), 0);
  assert.equal(radicalInverse(1, 2), 0.5);
  assert.equal(radicalInverse(2, 2), 0.25);
  assert.equal(radicalInverse(3, 2), 0.75);
  assert.equal(radicalInverse(5, 2), 0.625); // (101)₂ → 0.101₂
  assert.ok(Math.abs(radicalInverse(1, 3) - 1 / 3) < 1e-12);
  assert.ok(Math.abs(radicalInverse(3, 3) - 1 / 9) < 1e-12);
  for (let i = 0; i <= 200; i++) {
    const v = radicalInverse(i, 2);
    assert.ok(v >= 0 && v < 1, `radicalInverse(${i},2)=${v} out of [0,1)`);
  }
});

test('haltonPoint is one radical-inverse per base', () => {
  const p = haltonPoint(1, [2, 3]);
  assert.deepEqual(p, [0.5, 1 / 3]);
  const q = haltonPoint(5, [2, 3, 5]);
  assert.equal(q.length, 3);
  q.forEach((v) => assert.ok(v >= 0 && v < 1));
});

test('distributeEvenly hits the exact count and is maximally even (Christoffel)', () => {
  const marks = distributeEvenly(7, 43); // "decrease 7 times over 43 rows"
  assert.equal(marks.length, 43);
  assert.equal(marks.reduce((a, v) => a + v, 0), 7);
  assert.ok(gapSpread(marks) <= 1, 'Christoffel words never gap by more than one');
  // exact division → perfectly regular spacing
  assert.deepEqual(distributeEvenly(4, 8), [0, 1, 0, 1, 0, 1, 0, 1]);
  // clamps and edges
  assert.equal(distributeEvenly(50, 10).reduce((a, v) => a + v, 0), 10);
  assert.deepEqual(distributeEvenly(0, 5), [0, 0, 0, 0, 0]);
});

test('hadamardMatrix is orthogonal (H·Hᵀ = nI) of power-of-two order', () => {
  const H = hadamardMatrix(8);
  const n = H.length;
  assert.equal(n, 8);
  assert.ok(Number.isInteger(Math.log2(n)) && n >= 8);
  // rows are mutually orthogonal
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dot = H[i].reduce((s, v, k) => s + v * H[j][k], 0);
      assert.equal(dot, i === j ? n : 0, `row ${i}·${j} should be ${i === j ? n : 0}`);
    }
  }
  // every row except the all-ones first is perfectly balanced
  assert.ok(H[0].every((v) => v === 1));
  for (let i = 1; i < n; i++) {
    const plus = H[i].filter((v) => v === 1).length;
    assert.equal(plus, n / 2);
  }
  // rounds fractional requests up to the next power of two
  assert.equal(hadamardMatrix(6).length, 8);
  assert.deepEqual(hadamardMatrix(1), [[1]]);
});

test('superformulaRadius stays finite and positive across the angle', () => {
  const p = { m: 7, n1: 0.25, n2: 1.7, n3: 1.7 };
  let sawPositive = false;
  for (let s = 0; s < 360; s++) {
    const r = superformulaRadius((s * Math.PI) / 180, p);
    assert.ok(Number.isFinite(r) && r >= 0, `non-finite radius at ${s}°`);
    if (r > 0) sawPositive = true;
  }
  assert.ok(sawPositive);
});

/* ── generators: shape + binary + determinism + a structural invariant ────────── */
const GENERATORS = [
  ['generateGameOfLife', (r, c) => G.generateGameOfLife(r, c, 7, 20)],
  ['generateHadamardTiling', (r, c) => G.generateHadamardTiling(r, c, 8)],
  ['generateHaltonScatter', (r, c) => G.generateHaltonScatter(r, c, 50)],
  ['generateChristoffelWeave', (r, c) => G.generateChristoffelWeave(r, c, 8)],
  ['generateSuperformula', (r, c) => G.generateSuperformula(r, c)],
  ['generateRoseCurves', (r, c) => G.generateRoseCurves(r, c)],
  ['generateModularMultiplication', (r, c) => G.generateModularMultiplication(r, c, 60, 2)],
  ['generateLogisticBifurcation', (r, c) => G.generateLogisticBifurcation(r, c)]
];

for (const [name, make] of GENERATORS) {
  test(`${name} returns a well-formed, non-empty binary card`, () => {
    const m = make(36, 28);
    assert.ok(shapeOk(m, 36, 28), `${name} wrong shape`);
    assert.ok(binary(m), `${name} left the binary domain`);
    assert.ok(ones(m) > 0, `${name} produced a blank card`);
  });
  test(`${name} is deterministic (identical args → identical card)`, () => {
    assert.ok(same(make(24, 24), make(24, 24)), `${name} is not reproducible`);
  });
}

test('Game of Life actually evolves the soup (toroidal B3/S23)', () => {
  const start = G.generateGameOfLife(24, 24, 3, 1, 0.5);
  const evolved = G.generateGameOfLife(24, 24, 3, 40, 0.5);
  assert.ok(!same(start, evolved), 'evolution did not change the grid');
});

test('Hadamard tiling at exact order reproduces the balanced binary matrix', () => {
  const m = G.generateHadamardTiling(8, 8, 8);
  // rows 1..7 map two +1s / two -1s per pair → exactly order/2 ones each
  for (let r = 1; r < 8; r++) {
    assert.equal(m[r].reduce((a, v) => a + v, 0), 4, `Hadamard row ${r} not balanced`);
  }
});

test('Halton scatter fills evenly: ~pointCount distinct marks, no clumping', () => {
  const count = 50;
  const m = G.generateHaltonScatter(24, 24, count);
  const placed = ones(m);
  assert.ok(placed >= 40 && placed <= count, `expected ~${count} well-spread marks, got ${placed}`);
});

test('Christoffel weave: every row carries exactly its balanced mark count', () => {
  const rows = 20, cols = 24, repeat = 8;
  const m = G.generateChristoffelWeave(rows, cols, repeat);
  for (let r = 0; r < rows; r++) {
    assert.equal(m[r].reduce((a, v) => a + v, 0), (r % repeat) + 1, `row ${r} count off`);
    assert.ok(gapSpread(m[r]) <= 1, `row ${r} is not maximally even`);
  }
});

test('logistic bifurcation at a sub-period-doubling rate collapses to one point per column', () => {
  // r = 2.5 (below the first period-doubling) has a single attracting fixed
  // point, so after the transient each of the 64 columns marks exactly one row.
  const m = G.generateLogisticBifurcation(40, 64, 2.5, 2.5);
  assert.equal(ones(m), 64);
});
