// The Knit-Along companion's pure maths. The panel half is DOM; the plan half is
// not, so we can assert the exact thing the companion shows Benji — one step per
// card row, correct direction/carriage/needle-count, transfers, the pattern-row
// mapping, and only the advisor warnings that live on that row — without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRowPlan, rowHighlightCells } from '../js/features/knit-along.js';

const stroke = (cardRowIndex, carriageType, direction, transfers = 0) => ({
  cardRowIndex, carriageType, direction,
  transfers: Array.from({ length: transfers }, (_, i) => ({ sourceCol: i, targetCol: i + 1 }))
});

test('an empty schedule yields an empty plan (never throws)', () => {
  assert.deepEqual(buildRowPlan({}), []);
  assert.deepEqual(buildRowPlan({ strokes: null, cardMatrix: undefined }), []);
});

test('one step per card row, reading punches and carriage from the compiler output', () => {
  const cardMatrix = [
    [true, false, true, false], // row 0: 2 holes
    [false, false, false, false], // row 1: 0 holes
    [true, true, true, true] // row 2: 4 holes
  ];
  const strokes = [
    stroke(0, 'LACE', 'L_TO_R', 1),
    stroke(2, 'KNIT', 'R_TO_L')
  ];
  const plan = buildRowPlan({ strokes, cardMatrix });
  assert.equal(plan.length, 3, 'one step per card row');
  assert.equal(plan[0].punched, 2);
  assert.equal(plan[0].width, 4);
  assert.equal(plan[0].directionLabel, '\u2192');
  assert.match(plan[0].typeLabel, /Transfer/);
  assert.equal(plan[0].transferCount, 1);
  assert.equal(plan[1].punched, 0);
  assert.equal(plan[1].directionLabel, '\u2014', 'no stroke → no direction');
  assert.equal(plan[2].directionLabel, '\u2190');
  assert.match(plan[2].typeLabel, /Knit/);
  assert.equal(plan[2].label, 'Row 3');
});

test('a row read by both carriages lists both and sums transfers', () => {
  const strokes = [stroke(1, 'LACE', 'L_TO_R', 3), stroke(1, 'KNIT', 'R_TO_L', 2)];
  const plan = buildRowPlan({ strokes, cardMatrix: [[], [], []] });
  const row2 = plan[1];
  assert.equal(row2.transferCount, 5, 'transfers across both passes');
  assert.match(row2.typeLabel, /Transfer/);
  assert.match(row2.typeLabel, /Knit/);
  assert.equal(row2.directionLabel, '\u2192 \u2190', 'both directions shown');
});

test('pattern rows map from card rows via rowMapping, deduped', () => {
  const rowMapping = [
    { patternRow: 5, cardStartRow: 0, cardEndRow: 2 },
    { patternRow: 6, cardStartRow: 3, cardEndRow: 4 }
  ];
  const plan = buildRowPlan({ strokes: [], cardMatrix: new Array(3).fill([true, false]), rowMapping });
  assert.deepEqual(plan[1].patternRows, [5]);
  assert.deepEqual(plan[2].patternRows, [5]);
});

test('only advisor warnings whose cells fall on this row are surfaced', () => {
  const cardMatrix = new Array(3).fill([false, false]);
  const rowMapping = [{ patternRow: 1, cardStartRow: 1, cardEndRow: 1 }];
  const issues = [
    { title: 'Long float', sev: 'warn', cells: [[1, 0], [1, 1]], where: 'rows 2' },
    { title: 'Off this row', sev: 'error', cells: [[7, 3]], where: 'rows 8' },
    { title: 'No cells', sev: 'warn' }
  ];
  const plan = buildRowPlan({ cardMatrix, rowMapping, issues });
  assert.equal(plan[1].warnings.length, 1);
  assert.equal(plan[1].warnings[0].title, 'Long float');
  assert.equal(plan[0].warnings.length, 0);
  assert.equal(plan[2].warnings.length, 0);
});

test('a stray stroke beyond the punchcard length still gets a step (never dropped)', () => {
  const plan = buildRowPlan({ strokes: [stroke(4, 'KNIT', 'L_TO_R')], cardMatrix: [[true]] });
  assert.equal(plan.length, 5, 'padded to cover the highest card row');
  assert.equal(plan[4].punched, 0, 'no punch data for the phantom row');
  assert.equal(plan[4].typeLabel, 'Knit (K)');
});

test('rowHighlightCells spans every pattern row across the width', () => {
  const step = { patternRows: [0, 2] };
  const cells = rowHighlightCells(step, 3);
  assert.equal(cells.length, 6);
  assert.deepEqual(cells[0], [0, 0]);
  assert.deepEqual(cells[3], [2, 0]);
  assert.deepEqual(rowHighlightCells({ patternRows: [] }, 3), [], 'no rows → no cells');
  assert.deepEqual(rowHighlightCells(step, 0), [], 'no width → no cells');
});
