// Pattern-library correctness tests.
// Run with:  node --test "tests/*.test.mjs"
//
// The library is now ~150 generative patterns in a two-tier taxonomy, so the tests are
// invariants that hold for EVERY recipe rather than 150 hand-written expectations: the
// chart must be rectangular and full-width, a lace card must be stitch-balanced (a fixed
// needle bed cannot gain or lose loops), a direct-mode card must be only 0/1 and non-empty,
// every id unique, every family/group resolvable, and the double-bed rack constraint the
// boyfriend's video described must actually hold in the planner the presets lean on.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PATTERN_PRESETS, CLASSIC_PRESETS } from '../js/presets/preset-library.js';
import { LACE_PRESETS } from '../js/presets/patterns-lace.js';
import { classify, buildTaxonomy, FAMILY_IDS, GROUP_KEYS } from '../js/presets/preset-catalog.js';
import { laceBalance } from '../js/presets/preset-recipe-helpers.js';
import { rackRuleHolds } from '../js/presets/patterns-texture-dbed.js';
import { isKnownMode } from '../js/edit/modes.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';

const LACE_BLANKS = [STITCH_TYPE.KNIT, STITCH_TYPE.EMPTY, STITCH_TYPE.PURL, undefined, null];

function isActive(mode, value) {
  return mode === 'lace' ? !LACE_BLANKS.includes(value) : value === 1;
}

test('the library is exhaustive and every id is unique', () => {
  assert.ok(PATTERN_PRESETS.length >= 140, `expected a big library, got ${PATTERN_PRESETS.length}`);
  assert.ok(CLASSIC_PRESETS.length >= 29, 'the original classics must still ship');
  const ids = PATTERN_PRESETS.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate preset id');
});

test('every preset carries loadable metadata', () => {
  for (const p of PATTERN_PRESETS) {
    assert.ok(p.name && p.name.length > 1, `preset ${p.id} has no name`);
    assert.ok(p.description && p.description.length > 10, `preset ${p.id} has no real description`);
    assert.ok(isKnownMode(p.mode), `preset ${p.id} has unknown mode ${p.mode}`);
    assert.equal(typeof p.generate, 'function', `preset ${p.id} generate is not a function`);
    assert.ok(Number.isInteger(p.rows) && p.rows > 0, `preset ${p.id} rows`);
    assert.ok(Number.isInteger(p.cols) && p.cols > 0, `preset ${p.id} cols`);
  }
});

test('every preset classifies into a real family and group', () => {
  for (const p of PATTERN_PRESETS) {
    const c = classify(p);
    assert.deepEqual(c.problems, [], `preset ${p.id} misclassified: ${c.problems.join('; ')}`);
    assert.ok(FAMILY_IDS.includes(c.family), `preset ${p.id} bad family`);
    assert.ok(GROUP_KEYS.includes(`${c.family}/${c.group}`), `preset ${p.id} bad group`);
  }
});

test('generate() draws a rectangular, in-alphabet, non-empty chart at the bed width', () => {
  for (const p of PATTERN_PRESETS) {
    const cols = 40; // deliberately not the declared default width, to prove it sizes
    const matrix = p.generate(p.rows, cols);
    assert.equal(matrix.length, p.rows, `${p.id} row count`);
    for (const row of matrix) {
      assert.equal(row.length, cols, `${p.id} produced a ragged row`);
      for (const cell of row) {
        if (p.mode === 'lace') {
          assert.ok(Object.values(STITCH_TYPE).includes(cell), `${p.id} non-symbol ${cell} in a lace chart`);
        } else {
          assert.ok(cell === 0 || cell === 1, `${p.id} non-0/1 value ${cell} in a direct chart`);
        }
      }
    }
    assert.ok(matrix.some(row => row.some(cell => isActive(p.mode, cell))), `${p.id} generated an empty card`);
  }
});

test('every new lace recipe is stitch-balanced on every row (fixed bed cannot drift)', () => {
  // The recipes authored after the carriage-physics model must never change the loop
  // count; the 29 original classics predate that model and are grandfathered (they are
  // still checked rectangular and in-alphabet above).
  assert.ok(LACE_PRESETS.length >= 30, `expected a large lace family, got ${LACE_PRESETS.length}`);
  for (const p of LACE_PRESETS) {
    const matrix = p.generate(p.rows, 36);
    matrix.forEach((row, r) => {
      assert.equal(laceBalance(row), 0, `${p.id} row ${r} changes the loop count by ${laceBalance(row)}`);
    });
  }
});

test('the same preset always redraws identically (deterministic)', () => {
  const seeded = PATTERN_PRESETS.filter(p => typeof p.seed !== 'undefined');
  assert.ok(seeded.length > 0, 'at least the generative presets should carry a seed');
  for (const p of seeded) {
    const a = JSON.stringify(p.generate(p.rows, p.cols, p.seed));
    const b = JSON.stringify(p.generate(p.rows, p.cols, p.seed));
    assert.equal(a, b, `${p.id} is not deterministic for a given seed`);
  }
});

test('buildTaxonomy accounts for every preset exactly once', () => {
  const withClass = PATTERN_PRESETS.map(p => ({ ...p, __classification: classify(p) }));
  const taxonomy = buildTaxonomy(withClass);
  const total = taxonomy.reduce((sum, family) => sum + family.count, 0);
  assert.equal(total, PATTERN_PRESETS.length, 'taxonomy lost or duplicated a preset');
  const familyIds = taxonomy.map(f => f.id);
  // At least the big families should be present.
  for (const want of ['lace', 'colorwork', 'texture', 'generative']) {
    assert.ok(familyIds.includes(want), `taxonomy is missing family ${want}`);
  }
});

test('the double-bed rack rule from the video holds in the planner the presets use', () => {
  const { sameRowSameRack, sameRowMixedRack, centerPile } = rackRuleHolds();
  assert.equal(sameRowSameRack, true, 'same-rack transfers should share a row');
  assert.equal(sameRowMixedRack, true, 'mixed-rack transfers should be rejected onto one row');
  assert.equal(centerPile, true, 'two transfers into one needle should pile three loops');
});
