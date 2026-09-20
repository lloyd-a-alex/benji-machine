// The stitch-symbol legend's pure maths: counting a symbol across the card and
// collecting its cells, which is exactly what powers "click a symbol → light up
// every needle doing it." Asserted without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSymbols, cellsOfValue } from '../js/features/symbol-legend.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';

const EYELET = STITCH_TYPE.EYELET;
const TL = STITCH_TYPE.TRANSFER_LEFT;

test('countSymbols tallies every value across a card', () => {
  const card = [
    [EYELET, 0, TL],
    [0, EYELET, EYELET],
    [TL, TL, 0]
  ];
  const counts = countSymbols(card);
  assert.equal(counts.get(EYELET), 3);
  assert.equal(counts.get(TL), 3);
  assert.equal(counts.get(0), 3);
});

test('countSymbols is empty-safe and skips ragged rows', () => {
  assert.equal(countSymbols([]).size, 0);
  assert.equal(countSymbols(undefined).size, 0);
  const counts = countSymbols([[EYELET], null, [], [EYELET, EYELET]]);
  assert.equal(counts.get(EYELET), 3);
});

test('cellsOfValue returns every [row, col] carrying the symbol', () => {
  const card = [
    [EYELET, 0, TL],
    [0, EYELET, EYELET]
  ];
  assert.deepEqual(cellsOfValue(card, EYELET), [[0, 0], [1, 1], [1, 2]]);
  assert.deepEqual(cellsOfValue(card, TL), [[0, 2]]);
  assert.deepEqual(cellsOfValue(card, 999), [], 'absent symbol → no cells');
});

test('cellsOfValue is empty-safe and skips non-array rows', () => {
  assert.deepEqual(cellsOfValue(undefined, EYELET), []);
  assert.deepEqual(cellsOfValue([null, [EYELET], []], EYELET), [[1, 0]]);
});
