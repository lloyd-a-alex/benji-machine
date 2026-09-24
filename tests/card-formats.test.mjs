// Tests for the machine card-format family and its new compiler backends.
//
// Two things are covered: (1) the KnitMate two-bed punch-map format and its reader — the
// four-state double-bed dialect that closes the gap Passap's one-bed-per-needle encoding
// cannot express; and (2) the six card backends (ayab/csv/dak/binary/passap/knitmate) that
// are now first-class compiler outputs, so a card can be emitted from one IR and read back
// through the same door the file importers use. The contract is round-trip fidelity:
//   read(compile(ir)) === the boolean punch card of ir.
// Run with:  node --test "tests/card-formats.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KNITMATE_CHARS, knitMatePunchForCell, parseKnitMateRow, buildKnitMateBeds,
  generateKnitMatePattern, knitMatePatternToMatrix, knitMateSummary
} from '../js/exporters/formats-knitmate.js';
import { looksLikeKnitMate, readKnitMateText } from '../js/importers/knitmate-import.js';
import { readAnyProject } from '../js/importers/reader-registry.js';
import { FormatsExporter } from '../js/exporters/formats-dak.js';
import { runBackends, BACKENDS, BACKEND_IDS, CARD_BACKENDS } from '../js/compiler/backends/index.js';

// A small colour chart, row 0 = bottom. truthy = colour B (back bed).
const CHART = [
  [0, 1, 0, 1],
  [1, 1, 0, 0],
  [0, 0, 1, 1]
];
const EXPECT01 = CHART.map(r => r.map(v => (v ? 1 : 0)));

/* ─────────────────────────── KnitMate format ─────────────────────────── */

test('a colour cell maps to exactly one bed (F = colour A, B = colour B)', () => {
  assert.equal(knitMatePunchForCell(0), 'F');
  assert.equal(knitMatePunchForCell(1), 'B');
  assert.equal(knitMatePunchForCell('x'), 'B');
  const { rows } = buildKnitMateBeds(CHART);
  for (const r of rows) {
    for (let c = 0; c < r.front.length; c++) {
      // Binary chart: front and back are exact complements, never both, never neither.
      assert.notEqual(r.front[c], r.back[c], `needle ${c} punched on one bed only`);
    }
  }
});

test('beds are emitted top-first so the card reads like a printed card', () => {
  const { rows } = buildKnitMateBeds(CHART);
  assert.equal(rows[0].index, CHART.length - 1, 'first line is the top row');
  assert.equal(rows[0].chars, 'FFBB', 'top source row [0,0,1,1] → F F B B (front for colour A, back for colour B)');
});

test('generate → parse round-trips the chart exactly', () => {
  const text = generateKnitMatePattern(CHART, { title: 'Benji' });
  assert.match(text, /\*KNITMATE_CARD_V1/);
  assert.match(text, /BEDS=2/);
  assert.match(text, /WIDTH=4/);
  assert.match(text, /HEIGHT=3/);
  const back = knitMatePatternToMatrix(text);
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(back.matrix, EXPECT01);
});

test('a mirror-fed card still round-trips (flag carried in the header)', () => {
  const text = generateKnitMatePattern(CHART, { mirror: true });
  assert.match(text, /MIRROR=yes/);
  const back = knitMatePatternToMatrix(text);
  assert.equal(back.ok, true);
  assert.deepEqual(back.matrix, EXPECT01, 'un-mirrored back to the source chart');
});

test('the four states a Passap card cannot carry (both / dropped) survive and warn', () => {
  // Inject an "X" (both beds) and a "_" (dropped) needle that the binary chart can't express.
  const text = generateKnitMatePattern(CHART, {
    bothAt: (r, c) => r === 1 && c === 0,
    noneAt: (r, c) => r === 0 && c === 2
  });
  assert.match(text, /X/);
  assert.match(text, /_/);
  const back = knitMatePatternToMatrix(text);
  assert.equal(back.ok, true);
  assert.ok(back.warnings.some(w => /four-state/.test(w)), 'flattening is disclosed, never silent');
  // both (X) → colour B (1); dropped (_) → colour A (0).
  assert.equal(back.matrix[1][0], 1, 'X flattened to back/colour B');
  assert.equal(back.matrix[0][2], 0, '_ flattened to front/colour A');
});

test('ragged, empty and unknown-character cards never throw', () => {
  const ragged = [[1], [0, 1, 1], []];
  const back = knitMatePatternToMatrix(generateKnitMatePattern(ragged));
  assert.equal(back.ok, true);
  assert.equal(back.matrix.length, 3);
  assert.ok(back.matrix.every(r => r.length === 3), 'padded to the widest needle count');
  assert.doesNotThrow(() => generateKnitMatePattern([]));
  assert.equal(knitMatePatternToMatrix('nonsense').ok, false, 'a foreign file is rejected, not guessed');
  const parsed = parseKnitMateRow('FB!X_  ');
  assert.deepEqual(parsed.chars, ['F', 'B', 'X', '_']);
  assert.equal(parsed.unknown, 1, 'the stray "!" is counted, not silently dropped');
});

test('summary counts every needle state', () => {
  const s = knitMateSummary(CHART);
  assert.equal(s.beds, 2);
  assert.equal(s.width, 4);
  assert.equal(s.height, 3);
  assert.equal(s.frontPunches + s.backPunches, 12, 'binary chart punches every needle once');
  assert.equal(s.backPunches, CHART.flat().filter(Boolean).length, 'back punches equal colour-B cells');
  assert.equal(s.bothPunches, 0);
  assert.equal(s.blankNeedles, 0);
});

test('the reader sniff only matches KnitMate, and the registry reads it end to end', () => {
  const text = generateKnitMatePattern(CHART);
  assert.equal(looksLikeKnitMate(text), true);
  assert.equal(looksLikeKnitMate(generatePassapLike('')), false, 'a Passap card is not KnitMate');
  assert.equal(looksLikeKnitMate(null), false);
  const out = readKnitMateText(text);
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'fair_isle');
  const res = readAnyProject(text, { name: 'two-bed.kcard' });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.readerId, 'knitmate');
  assert.deepEqual(res.project.stitchMatrix, EXPECT01);
  assert.equal(res.project.name, 'two-bed.kcard');
});

function generatePassapLike(x) {
  return '*PASSAP_E6000_PATTERN\nWIDTH=1\nHEIGHT=1\nF 1\nR 0\n*END';
}

/* ─────────────────────────── compiler card backends ─────────────────────────── */

test('the six card formats are now first-class compiler backends', () => {
  for (const id of ['ayab', 'csv', 'dak', 'binary', 'passap', 'knitmate']) {
    assert.ok(id in BACKENDS, `${id} is registered in BACKENDS`);
    assert.ok(BACKEND_IDS.includes(id), `${id} is listed in BACKEND_IDS`);
    assert.equal(BACKENDS[id].kind, 'object');
  }
  assert.deepEqual(Object.keys(CARD_BACKENDS).sort(), ['ayab', 'binary', 'csv', 'dak', 'knitmate', 'passap']);
});

test('runBackends emits all six from one IR with the right signatures', () => {
  const ir = { machine: 'brother_standard_24', cardMatrix: CHART };
  const { results, errors } = runBackends(ir, ['ayab', 'csv', 'dak', 'binary', 'passap', 'knitmate'], { columns: 4 });
  assert.deepEqual(Object.keys(errors), [], 'no backend threw');
  assert.match(results.ayab.text, /^AYAB_FORMAT_V1/);
  assert.match(results.csv.text, /^Row,Col_1/);
  assert.match(results.dak.text, /\[DESIGNAKNIT_STITCH_PATTERN\]/);
  assert.match(results.passap.text, /\*PASSAP_E6000_PATTERN/);
  assert.match(results.knitmate.text, /\*KNITMATE_CARD_V1/);
  assert.equal(results.binary.meta.bytesPerRow, 1);
  assert.equal(results.binary.byteLength, 3, '3 rows × 1 byte');
  assert.ok(/^[A-Za-z0-9+/=]+$/.test(results.binary.base64), 'base64 is well-formed');
  for (const id of ['ayab', 'csv', 'dak', 'passap', 'knitmate']) {
    assert.equal(results[id].meta.columns, 4, `${id} honoured the 4-needle card width`);
  }
});

test('each text card round-trips back through the shared reader door', () => {
  const ir = { machine: 'brother_standard_24', cardMatrix: CHART };
  const { results } = runBackends(ir, ['ayab', 'csv', 'passap', 'knitmate'], { columns: 4 });
  for (const id of ['ayab', 'csv', 'passap', 'knitmate']) {
    const res = readAnyProject(results[id].text);
    assert.equal(res.ok, true, `${id} re-imports: ${res.error}`);
    assert.deepEqual(res.project.stitchMatrix, EXPECT01, `${id} reproduces the card exactly`);
  }
});

test('the DAK backend carries real colour indices, not just a flattened punch', () => {
  const ir = { machine: 'brother_standard_24', cardMatrix: [[0, 2, 1], [3, 0, 2]] };
  const { results } = runBackends(ir, ['dak'], { columns: 3 });
  assert.equal(results.dak.meta.colours.join(','), '0,1,2,3', 'palette indices survive');
  const res = readAnyProject(results.dak.text);
  assert.equal(res.ok, true);
  assert.deepEqual(res.project.stitchMatrix, [[0, 2, 1], [3, 0, 2]]);
});

test('card backends are total: a poisoned IR degrades instead of throwing', () => {
  const evil = [null, undefined, {}, { cardMatrix: 'not-a-matrix' }, { pieces: [null, {}] }];
  for (const ir of evil) {
    let out;
    assert.doesNotThrow(() => { out = runBackends(ir, Object.keys(CARD_BACKENDS), {}); });
    for (const id of Object.keys(CARD_BACKENDS)) {
      assert.ok(id in out.results, `${id} always produces a keyed result`);
      const r = out.results[id];
      assert.equal(typeof r.text, 'string');
      assert.ok(r.meta && typeof r.meta === 'object');
    }
  }
});

test('binary backend agrees with the standalone exporter byte-for-byte', () => {
  const ir = { machine: 'brother_standard_24', cardMatrix: CHART };
  const { results } = runBackends(ir, ['binary'], { columns: 4 });
  const direct = FormatsExporter.generateBinaryBitstream(CHART.map(r => r.map(v => !!v)));
  assert.equal(results.binary.byteLength, direct.length);
});
