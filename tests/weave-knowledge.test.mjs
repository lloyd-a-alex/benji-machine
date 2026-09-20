// Weave & loom knowledge invariants.
// Run with:  node --test "tests/*.test.mjs"
//
// The weave family feeds real craft data into the pattern library, so the things that
// must never silently break are: (1) every structure's draft is a clean rectangular
// 0/1 interlacement grid (the punchcard contract), (2) the shaft arithmetic matches the
// weaving canon (plain = 2, twill = 4, satin = 5, the Jacquard group is figure-controlled),
// and (3) the loom coverage answer — "can this machine weave this cloth?" — is consistent
// with that shaft count, so the browser, the Design Health panel and the universe matrix
// all read the same verdict.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WEAVE_STRUCTURES,
  LOOM_TYPES,
  structureIds,
  loomIds,
  loomCanWeave,
  loomsForStructure,
  structuresForLoom,
  simplestLoomFor,
  coverageMatrix,
  structureReport
} from '../js/weave/weave-knowledge.js';

const STRUCTURES = Object.values(WEAVE_STRUCTURES);

test('every structure drafts a rectangular, binary, non-empty grid', () => {
  assert.ok(STRUCTURES.length >= 18, `expected a broad weave set, got ${STRUCTURES.length}`);
  for (const s of STRUCTURES) {
    const grid = s.draft(24, 40);
    assert.equal(grid.length, 24, `${s.id} row count`);
    for (const row of grid) {
      assert.equal(row.length, 40, `${s.id} ragged row`);
      for (const cell of row) {
        assert.ok(cell === 0 || cell === 1, `${s.id} non-binary cell ${cell}`);
      }
    }
    assert.ok(grid.some(row => row.some(cell => cell === 1)), `${s.id} drafted an empty cloth`);
  }
});

test('shaft counts match the weaving canon', () => {
  assert.equal(WEAVE_STRUCTURES.plain_weave.shafts, 2, 'plain weave is a two-shaft cloth');
  assert.equal(WEAVE_STRUCTURES.twill_2_2.shafts, 4, 'balanced twill needs four shafts');
  assert.equal(WEAVE_STRUCTURES.satin_5h.shafts, 5, 'five-harness satin');
  assert.equal(WEAVE_STRUCTURES.pique.control, 'dobby', 'piqué is a dobby structure');
  assert.equal(WEAVE_STRUCTURES.damask.control, 'jacquard', 'damask is a figured (Jacquard) cloth');
});

test('plain weave is a strict checkerboard and twill runs on a diagonal', () => {
  const plain = WEAVE_STRUCTURES.plain_weave.draft(4, 4);
  assert.equal(plain[0][0], 1);
  assert.equal(plain[0][1], 0);
  assert.equal(plain[1][0], 0);
  assert.equal(plain[1][1], 1);
  const twill = WEAVE_STRUCTURES.twill_2_2.draft(4, 8);
  // A 2/2 twill: the riser pattern shifts one end to the side on every row.
  assert.deepEqual(twill[0], [1, 1, 0, 0, 1, 1, 0, 0]);
  assert.deepEqual(twill[1], [0, 1, 1, 0, 0, 1, 1, 0]);
});

test('loom coverage respects shaft counts and Jacquard heads', () => {
  // A four-shaft hand loom takes plain and twill but not five-end satin or a figure.
  assert.equal(loomCanWeave(LOOM_TYPES.warp_weighted, WEAVE_STRUCTURES.plain_weave), true);
  assert.equal(loomCanWeave(LOOM_TYPES.warp_weighted, WEAVE_STRUCTURES.satin_5h), false);
  assert.equal(loomCanWeave(LOOM_TYPES.warp_weighted, WEAVE_STRUCTURES.damask), false);
  // A dobby head reaches piqué (12 shafts) but cannot draw a Jacquard figure.
  assert.equal(loomCanWeave(LOOM_TYPES.dobby, WEAVE_STRUCTURES.pique), true);
  assert.equal(loomCanWeave(LOOM_TYPES.dobby, WEAVE_STRUCTURES.jacquard_figure), false);
  // A real Jacquard weaves everything; an air-jet with a Jacquard head does too.
  assert.equal(loomCanWeave(LOOM_TYPES.jacquard, WEAVE_STRUCTURES.damask), true);
  assert.equal(loomCanWeave(LOOM_TYPES.air_jet, WEAVE_STRUCTURES.damask), true);
});

test('the simplest loom for a structure is the least capable one that fits', () => {
  assert.equal(simplestLoomFor('plain_weave').loomId, 'hand_shaft');
  assert.equal(simplestLoomFor('satin_5h').loom.drive, 'hand', 'five shafts still fit a hand loom');
  assert.equal(simplestLoomFor('pile').loomId, 'dobby', 'sixteen shafts are a dobby job');
  assert.equal(simplestLoomFor('damask').loom.drive, 'jacquard', 'a figure needs a Jacquard head');
});

test('the coverage matrix is complete and a Jacquard row is entirely weavable', () => {
  const m = coverageMatrix();
  assert.equal(m.structures.length, STRUCTURES.length);
  assert.equal(m.looms.length, loomIds().length);
  for (const s of structureIds()) {
    assert.ok(m.cells.jacquard[s] === true, `jacquard cannot reach ${s}`);
  }
  // Back-queries agree with the matrix.
  assert.deepEqual(new Set(loomsForStructure('plain_weave')), new Set(m.looms.filter(l => m.cells[l].plain_weave)));
  assert.ok(structuresForLoom('warp_weighted').includes('twill_2_2'));
  assert.ok(!structuresForLoom('warp_weighted').includes('satin_5h'));
});

test('structureReport names shafts or figure and lists fitting looms', () => {
  const plain = structureReport('plain_weave');
  assert.equal(plain.shaftsLabel, '2 shafts');
  assert.ok(plain.looms.some(l => l.id === 'hand_shaft'));
  const damask = structureReport('damask');
  assert.match(damask.shaftsLabel, /Jacquard/);
  assert.ok(damask.looms.every(l => l.id === 'jacquard' || l.id === 'rapier' || l.id === 'air_jet' || l.id === 'projectile'));
  assert.equal(structureReport('does_not_exist'), null);
});
