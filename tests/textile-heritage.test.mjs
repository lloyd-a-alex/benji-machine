// Textile heritage data + the weaving half of the Machine Universe.
// Run with:  node --test "tests/*.test.mjs"
//
// Two contracts hold these modules up:
//   1. the heritage data is well-formed (every era id real, every name present, the
//      designer/weaver crossover actually overlapping, no duplicate names within a list);
//   2. the universe exposes a *weave* report that agrees with the knowledge base and stays
//      quarantined from the knitting fleet analysis (a bare app object must still answer).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TEXTILE_ERAS,
  DESIGNERS,
  WEAVERS,
  TOOLS,
  FUNDAMENTALS,
  REGIONAL_TRADITIONS,
  byEra,
  designersInEra,
  crossoverPeople,
  heritageSummary
} from '../js/weave/textile-heritage.js';
import { createMachineUniverse } from '../js/features/machine-universe.js';
import { structureIds } from '../js/weave/weave-knowledge.js';

const ERA_IDS = new Set(TEXTILE_ERAS.map(e => e.id));

test('every heritage person names a real era and a real person', () => {
  assert.ok(DESIGNERS.length >= 30, `expected a substantial designer list, got ${DESIGNERS.length}`);
  for (const p of [...DESIGNERS, ...WEAVERS]) {
    assert.ok(p.name && p.name.length > 1, 'person with no name');
    assert.ok(ERA_IDS.has(p.era), `${p.name} cites unknown era ${p.era}`);
  }
});

test('no duplicate names within a single heritage list', () => {
  for (const [label, list] of [['designers', DESIGNERS], ['weavers', WEAVERS], ['tools', TOOLS]]) {
    const names = list.map(x => x.name.trim());
    assert.equal(new Set(names).size, names.length, `${label} has a duplicate name`);
  }
});

test('byEra walks the timeline oldest-first and drops empty buckets', () => {
  const buckets = byEra(DESIGNERS);
  const order = TEXTILE_ERAS.map(e => e.id);
  const idx = buckets.map(b => order.indexOf(b.era.id));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), 'eras out of chronological order');
  assert.ok(buckets.every(b => b.people.length > 0), 'an empty era bucket leaked through');
});

test('designersInEra and crossover agree with the raw data', () => {
  assert.equal(designersInEra('18th').length, 2, 'the 18th-century pair');
  const cross = new Set(crossoverPeople());
  // Liebes, Mairet and Dietz appear as both designers and weavers.
  for (const name of ['Dorothy Liebes', 'Ethel Mairet', 'Ada Dietz']) {
    assert.ok(cross.has(name), `${name} should be a designer/weaver crossover`);
  }
});

test('heritageSummary counts every reference list', () => {
  const s = heritageSummary();
  assert.equal(s.designers, DESIGNERS.length);
  assert.equal(s.weavers, WEAVERS.length);
  assert.equal(s.tools, TOOLS.length);
  assert.equal(s.fundamentals, FUNDAMENTALS.length);
  assert.equal(s.traditions, REGIONAL_TRADITIONS.length);
  assert.ok(s.centuries >= 4, 'the designers should span several eras');
});

test('the universe reports the weave coverage without needing a booted app', () => {
  const universe = createMachineUniverse({ editor: {} });
  const report = universe.weaveReport();
  assert.equal(report.structures.length, structureIds().length, 'every structure should be reported');
  assert.ok(report.blurb.includes('woven structures'), 'the report should describe itself');
  // A figured structure routes to a Jacquard; a plain one to a hand loom.
  const damask = report.structures.find(s => s.id === 'damask');
  const plain = report.structures.find(s => s.id === 'plain_weave');
  assert.match(damask.shaftsLabel, /Jacquard/);
  assert.ok(/hand/i.test(plain.simplestLoom), `plain should draft on a hand-class loom, got ${plain.simplestLoom}`);
  // The coverage cell is authoritative and consistent with the structure's loom list.
  assert.equal(report.coverage.jacquard.damask, true);
  assert.equal(report.coverage.warp_weighted.damask, false);
});
