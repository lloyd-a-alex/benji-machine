// Punchcard-thumbnail maths — the mask reduction and the fit-to-box sizing that
// both the taskbar and the Studio render with. Asserted without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { punchMask, fitThumb, previewMatrix } from '../js/ui/thumbnail.js';

test('punchMask marks punched cells and normalises ragged rows to a rectangle', () => {
  const mask = punchMask([
    [1, 0, 'K'],
    ['EMPTY', 'O'],
    null
  ]);
  assert.equal(mask.length, 3, 'one row per input row, even null');
  assert.equal(mask[0].length, 3, 'width = widest row');
  assert.deepEqual(mask[0], [true, false, true]);
  assert.deepEqual(mask[1], [false, true, false], 'short row padded to width');
  assert.deepEqual(mask[2], [false, false, false], 'null row is all blank');
});

test('punchMask treats 0 / false / empty string / null / "EMPTY" as blank', () => {
  assert.deepEqual(punchMask([[0, false, '', null, 'EMPTY', 'TL']]), [[false, false, false, false, false, true]]);
});

test('punchMask is empty-safe', () => {
  assert.deepEqual(punchMask(undefined), []);
  assert.deepEqual(punchMask([]), []);
});

test('fitThumb picks the biggest whole-pixel cell that fits the box', () => {
  const f = fitThumb(10, 40, 120, 0);
  assert.equal(f.cell, 3, '120/40 = 3 wide, 120/10 = 12 tall → limited by width');
  assert.equal(f.width, 120);
  assert.equal(f.height, 30);
});

test('a card wider than the box falls back to a fractional cell and still fits', () => {
  const tiny = fitThumb(200, 300, 40, 2);
  assert.ok(tiny.cell > 0, 'cell never collapses to zero');
  assert.ok(tiny.width <= 40 && tiny.height <= 40, 'letterboxed within the square');
});

test('fitThumb prefers whole pixels when they fit', () => {
  const f = fitThumb(6, 8, 120, 2);
  assert.equal(f.cell, Math.floor(f.cell), 'whole-pixel cell when the box is roomy');
});

test('fitThumb handles an empty card without dividing by zero', () => {
  const f = fitThumb(0, 0, 64);
  assert.equal(f.cell, 1);
  assert.ok(Number.isFinite(f.width) && Number.isFinite(f.height));
});

test('previewMatrix prefers the live chart, then any chart with cells, else nothing', () => {
  const cells = [[1, 0], [0, 1]];
  assert.deepEqual(previewMatrix({ charts: [{ id: 'a', cells: [[9]] }, { id: 'live', cells }] }), cells);
  assert.deepEqual(previewMatrix({ charts: [{ id: 'a', cells }] }), cells);
  assert.deepEqual(previewMatrix(undefined), []);
  assert.deepEqual(previewMatrix({ charts: [{ id: 'live', cells: [] }] }), []);
});
