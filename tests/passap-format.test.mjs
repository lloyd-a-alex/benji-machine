// Tests for the Passap / double-bed pattern format and its reader — the reversible
// two-bed (Front/Back) representation that closes the gap the README flagged: Passap
// cards were previously only ever modelled single-bed. Run with:
//   node --test "tests/passap-format.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBedRows, generatePassapPattern, passapPatternToMatrix, passapSummary, parseBits
} from '../js/exporters/formats-passap.js';
import { looksLikePassapText, readPassapText } from '../js/importers/passap-import.js';
import { readAnyProject } from '../js/importers/reader-registry.js';

// A small colour chart, row 0 = bottom. truthy = colour B (back bed).
const CHART = [
  [0, 1, 0, 1],
  [1, 1, 0, 0],
  [0, 0, 1, 1]
];

test('every needle punches exactly one bed (front = colour A, back = colour B)', () => {
  const { rows } = buildBedRows(CHART);
  for (const r of rows) {
    for (let c = 0; c < r.front.length; c++) {
      assert.notEqual(r.front[c], r.back[c], `needle ${c} punched on one bed only`);
      assert.ok(r.front[c] === 0 || r.front[c] === 1);
    }
  }
});

test('back bed reproduces the source colour-B cells exactly', () => {
  const { rows } = buildBedRows(CHART);
  // rows are emitted top-first, so row[0].index === 2 (top of the chart).
  const topRow = rows[0];
  assert.equal(topRow.index, 2);
  assert.deepEqual(topRow.back, CHART[2].map(v => (v ? 1 : 0)));
  assert.deepEqual(topRow.front, CHART[2].map(v => (v ? 0 : 1)));
});

test('generatePassapPattern → passapPatternToMatrix round-trips the chart exactly', () => {
  const text = generatePassapPattern(CHART, { title: 'Benji' });
  assert.match(text, /\*PASSAP_E6000_PATTERN/);
  assert.match(text, /BEDS=2/);
  assert.match(text, /WIDTH=4/);
  assert.match(text, /HEIGHT=3/);
  const back = passapPatternToMatrix(text);
  assert.equal(back.ok, true);
  assert.deepEqual(back.matrix, CHART.map(r => r.map(v => (v ? 1 : 0))));
});

test('a mirrored back bed still round-trips (mirror flag recorded in the header)', () => {
  const text = generatePassapPattern(CHART, { mirrorBack: true });
  assert.match(text, /MIRROR_R=yes/);
  const back = passapPatternToMatrix(text);
  assert.equal(back.ok, true, 'mirrored card reads back without error');
  assert.deepEqual(back.matrix, CHART.map(r => r.map(v => (v ? 1 : 0))), 'un-mirrored to the source chart');
});

test('ragged and empty matrices are handled without throwing', () => {
  const ragged = [[1], [0, 1, 1], []];
  const text = generatePassapPattern(ragged);
  const back = passapPatternToMatrix(text);
  assert.equal(back.ok, true);
  assert.equal(back.matrix.length, 3, 'row count preserved');
  assert.ok(back.matrix.every(r => r.length === 3), 'rows padded to the widest needle count');
  // Fully empty is a legal degenerate card, not a crash.
  assert.doesNotThrow(() => generatePassapPattern([]));
});

test('passapSummary counts beds, extents and punches', () => {
  const s = passapSummary(CHART);
  assert.equal(s.beds, 2);
  assert.equal(s.width, 4);
  assert.equal(s.height, 3);
  assert.equal(s.frontPunches + s.backPunches, 12, 'every needle punches once per row');
  const colourB = CHART.flat().filter(Boolean).length;
  assert.equal(s.backPunches, colourB, 'back punches equal the colour-B cells');
});

test('parseBits ignores stray characters and maps 1/0 to true/false', () => {
  assert.deepEqual(parseBits('01 1_0'), [false, true, true, false]);
  assert.deepEqual(parseBits(''), []);
  assert.deepEqual(parseBits(null), []);
});

test('the reader sniff only matches Passap text', () => {
  assert.equal(looksLikePassapText(generatePassapPattern(CHART)), true);
  assert.equal(looksLikePassapText('not a card at all'), false);
  assert.equal(looksLikePassapText(null), false);
});

test('readPassapText returns a fair_isle matrix in the registry shape', () => {
  const out = readPassapText(generatePassapPattern(CHART));
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'fair_isle');
  assert.ok(Array.isArray(out.warnings));
  assert.deepEqual(out.matrix, CHART.map(r => r.map(v => (v ? 1 : 0))));
});

test('readAnyProject recognises a Passap file end to end', () => {
  const text = generatePassapPattern(CHART);
  const res = readAnyProject(text, { name: 'double-bed.kcard' });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.readerId, 'passap');
  assert.equal(res.project.mode, 'fair_isle');
  assert.deepEqual(res.project.stitchMatrix, CHART.map(r => r.map(v => (v ? 1 : 0))));
  assert.equal(res.project.name, 'double-bed.kcard');
});

test('a hand-edited card punching both beds is flagged, not silently trusted', () => {
  // Corrupt: make an F row identical to its R row (both beds punched on a needle).
  const good = generatePassapPattern([[0, 1]]);
  const bad = good.replace(/F 10/, 'F 01');
  const back = passapPatternToMatrix(bad);
  assert.equal(back.ok, true, 'still parseable');
  assert.ok(back.warnings.some(w => /both beds|neither/.test(w)), 'the impossible needle is warned about');
});
