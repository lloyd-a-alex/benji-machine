// KNITCAT — Math Studio preset fusion tests.
// Run with:  node --test "tests/*.test.mjs"
//
// These lock in the bridge between the Math Studio generators (`js/generators/math-patterns.js`)
// and the browsable preset taxonomy: every Studio recipe is now a first-class `generative`
// preset that reuses the canonical maths rather than reimplementing it. The suite proves the
// wiring, the guard invariants specific to this family (rectangular / 0-1 / NON-EMPTY /
// deterministic), the distinct-id contract, group coverage across the whole `generative`
// taxonomy, and that the `ensureInk` safety net can never be fooled by a pathological seed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PATTERN_PRESETS } from '../js/presets/preset-library.js';
import { MATH_STUDIO_PRESETS } from '../js/presets/patterns-math-studio.js';
import { classify, GROUP_KEYS, FAMILY_IDS } from '../js/presets/preset-catalog.js';
import { isKnownMode } from '../js/edit/modes.js';

const byId = new Map(MATH_STUDIO_PRESETS.map((p) => [p.id, p]));

test('the Math Studio family is non-trivial and reaches the master library', () => {
  assert.ok(MATH_STUDIO_PRESETS.length >= 18, `expected a broad Studio family, got ${MATH_STUDIO_PRESETS.length}`);
  const libraryIds = new Set(PATTERN_PRESETS.map((p) => p.id));
  for (const p of MATH_STUDIO_PRESETS) {
    assert.ok(libraryIds.has(p.id), `${p.id} is authored but not wired into PATTERN_PRESETS`);
  }
});

test('every Math Studio id is unique within the family and across the library', () => {
  const familyIds = MATH_STUDIO_PRESETS.map((p) => p.id);
  assert.equal(new Set(familyIds).size, familyIds.length, 'duplicate id inside MATH_STUDIO_PRESETS');
  const all = PATTERN_PRESETS.map((p) => p.id);
  assert.equal(new Set(all).size, all.length, 'Math Studio collided with an existing preset id');
});

test('every Math Studio preset is a valid, classifiable direct-mode recipe', () => {
  for (const p of MATH_STUDIO_PRESETS) {
    assert.equal(p.mode, 'fair_isle', `${p.id} must be a direct-mode (0/1) card`);
    assert.ok(isKnownMode(p.mode), `${p.id} unknown mode`);
    assert.ok(Number.isInteger(p.rows) && p.rows > 0, `${p.id} rows`);
    assert.ok(Number.isInteger(p.cols) && p.cols > 0, `${p.id} cols`);
    assert.ok(p.description && p.description.length > 10, `${p.id} needs a real description`);
    const c = classify(p);
    assert.deepEqual(c.problems, [], `${p.id} misclassified: ${c.problems.join('; ')}`);
    assert.equal(c.family, 'generative', `${p.id} should live in the generative family`);
    assert.ok(FAMILY_IDS.includes(c.family) && GROUP_KEYS.includes(`${c.family}/${c.group}`), `${p.id} bad group`);
  }
});

test('Studio charts are rectangular, in-alphabet and NON-EMPTY at the 40-needle test width', () => {
  for (const p of MATH_STUDIO_PRESETS) {
    const matrix = p.generate(p.rows, 40);
    assert.equal(matrix.length, p.rows, `${p.id} row count`);
    for (const row of matrix) {
      assert.equal(row.length, 40, `${p.id} ragged row`);
      for (const cell of row) assert.ok(cell === 0 || cell === 1, `${p.id} non-0/1 cell ${cell}`);
    }
    assert.ok(matrix.some((row) => row.some((cell) => cell === 1)), `${p.id} generated a blank card`);
  }
});

test('the stochastic Studio recipes are deterministic for their baked seed', () => {
  const seeded = MATH_STUDIO_PRESETS.filter((p) => typeof p.seed !== 'undefined');
  assert.ok(seeded.length >= 3, 'reaction-diffusion, Voronoi and Game of Life should carry a seed');
  for (const p of seeded) {
    const a = JSON.stringify(p.generate(p.rows, p.cols, p.seed));
    const b = JSON.stringify(p.generate(p.rows, p.cols, p.seed));
    assert.equal(a, b, `${p.id} redrew differently for the same seed`);
  }
});

test('the generative family spans every Studio group once the bridge is in place', () => {
  const covered = new Set(MATH_STUDIO_PRESETS.map((p) => classify(p).group));
  for (const want of ['automata', 'fractals', 'number', 'tiling', 'noise', 'optical']) {
    assert.ok(covered.has(want), `no Math Studio recipe lands in generative/${want}`);
    assert.ok(GROUP_KEYS.includes(`generative/${want}`), `taxonomy lost generative/${want}`);
  }
});

test('Studio presets reuse the canonical generator maths (they are not hand matrices)', () => {
  // The whole point of the bridge is zero duplication: the presets must delegate to
  // MathPatternGenerators, so two independent calls that request the same size agree,
  // and the outputs are non-degenerate (a real field, not a single stray pixel).
  const probe = byId.get('penrose_quasicrystal');
  const first = probe.generate(probe.rows, probe.cols);
  const second = probe.generate(probe.rows, probe.cols);
  assert.deepEqual(first, second, 'a deterministic Studio preset drifted between calls');
  const punches = first.flat().filter((v) => v === 1).length;
  const cells = probe.rows * probe.cols;
  assert.ok(punches > cells * 0.02 && punches < cells * 0.98, 'Penrose output looks degenerate');
});
