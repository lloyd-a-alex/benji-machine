// Extended-traditions preset slate tests.
// Run with:  node --test "tests/preset-extension.test.mjs"
//
// `patterns-extension.js` widens the library with further named lace / colorwork /
// texture / double-bed / generative traditions. The whole-library guard
// (`preset-library.test.mjs`) already re-validates every preset once it is wired into
// `PATTERN_PRESETS`; this file pins the slate itself so a regression is blamed on the
// extension rather than on the master index — the count grows, no id collides with the
// rest of the library, every family door it claims to open is actually opened, and each
// recipe independently satisfies the chart invariants at an off-default bed width.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTENDED_PRESETS,
  EXTENDED_LACE_PRESETS,
  EXTENDED_COLORWORK_PRESETS,
  EXTENDED_TEXTURE_PRESETS,
  EXTENDED_DOUBLEBED_PRESETS,
  EXTENDED_GENERATIVE_PRESETS
} from '../js/presets/patterns-extension.js';
import { PATTERN_PRESETS } from '../js/presets/preset-library.js';
import { classify, GROUP_KEYS } from '../js/presets/preset-catalog.js';
import { laceBalance } from '../js/presets/preset-recipe-helpers.js';
import { isKnownMode } from '../js/edit/modes.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';

const LACE_BLANKS = [STITCH_TYPE.KNIT, STITCH_TYPE.EMPTY, STITCH_TYPE.PURL, undefined, null];

function isActive(mode, value) {
  return mode === 'lace' ? !LACE_BLANKS.includes(value) : value === 1;
}

test('the extended slate is a large, correctly-partitioned collection', () => {
  assert.ok(EXTENDED_PRESETS.length >= 30, `expected a broad slate, got ${EXTENDED_PRESETS.length}`);
  const recomposed = [
    ...EXTENDED_LACE_PRESETS,
    ...EXTENDED_COLORWORK_PRESETS,
    ...EXTENDED_TEXTURE_PRESETS,
    ...EXTENDED_DOUBLEBED_PRESETS,
    ...EXTENDED_GENERATIVE_PRESETS
  ];
  assert.equal(recomposed.length, EXTENDED_PRESETS.length, 'flat array lost or duplicated a preset');
  assert.deepEqual(recomposed.map(p => p.id), EXTENDED_PRESETS.map(p => p.id), 'slate order drifted');
});

test('every family the slate advertises actually gets opened', () => {
  const families = new Set(EXTENDED_PRESETS.map(p => classify(p).family));
  for (const want of ['lace', 'colorwork', 'texture', 'double-bed', 'generative']) {
    assert.ok(families.has(want), `extended slate is missing the ${want} family`);
  }
});

test('extended ids are internally unique and never collide with the master library', () => {
  const slateIds = EXTENDED_PRESETS.map(p => p.id);
  assert.equal(new Set(slateIds).size, slateIds.length, 'duplicate id inside the extended slate');
  // Every extended preset must appear exactly once in the assembled library, proving it
  // was wired in and that it did not silently replace an older recipe of the same id.
  const libraryIds = PATTERN_PRESETS.map(p => p.id);
  for (const id of slateIds) {
    assert.equal(libraryIds.filter(x => x === id).length, 1, `${id} not wired into the library exactly once`);
  }
});

test('every extended preset carries loadable, classifiable metadata', () => {
  for (const p of EXTENDED_PRESETS) {
    assert.ok(p.name && p.name.length > 1, `preset ${p.id} has no name`);
    assert.ok(p.description && p.description.length > 10, `preset ${p.id} has no real description`);
    assert.ok(isKnownMode(p.mode), `preset ${p.id} has unknown mode ${p.mode}`);
    assert.equal(typeof p.generate, 'function', `preset ${p.id} generate is not a function`);
    assert.ok(Number.isInteger(p.rows) && p.rows > 0, `preset ${p.id} rows`);
    assert.ok(Number.isInteger(p.cols) && p.cols > 0, `preset ${p.id} cols`);
    const c = classify(p);
    assert.deepEqual(c.problems, [], `preset ${p.id} misclassified: ${c.problems.join('; ')}`);
    assert.ok(GROUP_KEYS.includes(`${c.family}/${c.group}`), `preset ${p.id} bad group`);
  }
});

test('every extended generate() draws a rectangular, in-alphabet, non-empty card', () => {
  const cols = 42; // deliberately not the declared default, to prove it sizes to the bed
  for (const p of EXTENDED_PRESETS) {
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

test('every extended lace recipe is stitch-balanced on every row', () => {
  assert.ok(EXTENDED_LACE_PRESETS.length >= 10, 'the lace extension should be a substantial family');
  for (const p of EXTENDED_LACE_PRESETS) {
    const matrix = p.generate(p.rows, 36);
    matrix.forEach((row, r) => {
      assert.equal(laceBalance(row), 0, `${p.id} row ${r} changes the loop count by ${laceBalance(row)}`);
    });
  }
});

test('seeded extended recipes redraw identically (deterministic)', () => {
  const seeded = EXTENDED_PRESETS.filter(p => typeof p.seed !== 'undefined');
  assert.ok(seeded.length > 0, 'generative extension recipes should carry a seed');
  for (const p of seeded) {
    const a = JSON.stringify(p.generate(p.rows, p.cols, p.seed));
    const b = JSON.stringify(p.generate(p.rows, p.cols, p.seed));
    assert.equal(a, b, `${p.id} is not deterministic for a given seed`);
  }
});
