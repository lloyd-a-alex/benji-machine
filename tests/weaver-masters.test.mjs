// The Masters of cloth layer: real people, real importable patterns, original bios.
// Run with:  node --test tests/weaver-masters.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PATTERN_PRESETS } from '../js/presets/preset-library.js';
import { DESIGNERS, WEAVERS } from '../js/weave/textile-heritage.js';
import {
  MASTERS,
  masterByName,
  masterPatterns,
  listMasters,
  mastersIntegrity,
  mastersSummary
} from '../js/weave/weaver-masters.js';

const presetIds = new Set(PATTERN_PRESETS.map(p => p.id));
const heritageNames = new Set([...DESIGNERS.map(d => d.name), ...WEAVERS.map(w => w.name)]);

test('the gallery is substantial and every name already lives in the heritage index', () => {
  assert.ok(MASTERS.length >= 15, `expected many masters, got ${MASTERS.length}`);
  for (const m of MASTERS) assert.ok(heritageNames.has(m.name), `${m.name} is not a heritage person`);
  assert.equal(new Set(MASTERS.map(m => m.name)).size, MASTERS.length, 'duplicate master');
});

test('every master has an original biography, a role and years', () => {
  for (const m of MASTERS) {
    assert.ok(['weaver', 'designer'].includes(m.role), `${m.name} has a bad role`);
    assert.ok(m.years && m.years.length > 2, `${m.name} has no years`);
    assert.ok(m.movement, `${m.name} has no movement`);
    assert.ok(m.backstory && m.backstory.length > 80, `${m.name} backstory is too thin`);
    assert.ok(/[.!?]$/.test(m.backstory.trim()), `${m.name} backstory must be a complete sentence`);
    assert.ok(m.backstory.includes(','), `${m.name} backstory should be real prose with clauses`);
  }
});

test('no master advertises a pattern the software cannot generate', () => {
  for (const m of MASTERS) {
    assert.ok(m.patterns.length >= 3, `${m.name} should have several signature patterns`);
    for (const id of m.patterns) assert.ok(presetIds.has(id), `${m.name} cites unknown preset ${id}`);
  }
});

test('mastersIntegrity reports a clean dataset', () => {
  const i = mastersIntegrity();
  assert.deepEqual(i.unknownNames, [], 'unknown heritage names');
  assert.deepEqual(i.unknownPatterns, [], 'unknown preset references');
  assert.deepEqual(i.emptyMasters, [], 'master with no resolvable patterns');
});

test('masterPatterns resolves to real catalog entries and drops nothing for valid ids', () => {
  const albers = masterPatterns('Anni Albers');
  assert.ok(albers.length >= 3);
  for (const p of albers) {
    assert.ok(presetIds.has(p.presetId), 'resolved a non-preset');
    assert.ok(p.name && p.category && p.mode, 'resolved entry missing metadata');
  }
  assert.deepEqual(masterPatterns('Nobody Here'), [], 'unknown master resolves to nothing');
});

test('listMasters filters by role and search query', () => {
  assert.ok(listMasters({ role: 'weaver' }).every(m => m.role === 'weaver'));
  assert.ok(listMasters({ role: 'designer' }).length > 0);
  const hits = listMasters({ query: 'bauhaus' });
  assert.ok(hits.some(m => m.name === 'Anni Albers'), 'Bauhaus query should surface Albers');
  assert.deepEqual(listMasters({ query: 'zzqxx' }), [], 'nonsense query is empty');
});

test('mastersSummary counts people and the distinct importable patterns', () => {
  const s = mastersSummary();
  assert.equal(s.masters, MASTERS.length);
  assert.equal(s.weavers + s.designers, MASTERS.length);
  const distinct = new Set(MASTERS.flatMap(m => m.patterns));
  assert.equal(s.distinctPatterns, distinct.size);
  assert.ok(s.distinctPatterns >= 20, 'the shelf should span a lot of the catalogue');
});

test('masterByName round-trips', () => {
  assert.equal(masterByName('William Morris').movement, 'Arts & Crafts');
  assert.equal(masterByName('Someone Else'), undefined);
});
