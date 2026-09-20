// Taskbar's pure preview helpers — which chart to show and what to say about it.
// Asserted without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartForPreview, previewMeta, MAX_TASKS } from '../js/ui/taskbar.js';

test('chartForPreview prefers the live chart, then any chart with cells', () => {
  const cells = [[1, 0], [0, 1]];
  assert.deepEqual(chartForPreview({ charts: [{ id: 'a', cells: [[9]] }, { id: 'live', cells }] }), cells);
  assert.deepEqual(chartForPreview({ charts: [{ id: 'a', cells }] }), cells);
});

test('chartForPreview is empty-safe', () => {
  assert.deepEqual(chartForPreview(undefined), []);
  assert.deepEqual(chartForPreview({ charts: [] }), []);
  assert.deepEqual(chartForPreview({ charts: [{ id: 'live', cells: [] }] }), []);
});

test('previewMeta composes machine, counts, progress and a last-edited line', () => {
  const project = { name: 'Benji Sweater', updatedAt: '2026-03-01T00:00:00Z' };
  const summary = { machine: 'Brother KH-830', chartCount: 2, garmentCount: 1, pieceCount: 3, completion: 40 };
  const meta = previewMeta(project, summary);
  assert.equal(meta.title, 'Benji Sweater');
  assert.ok(meta.lines.includes('Brother KH-830'));
  assert.ok(meta.lines.some(l => /2 charts/.test(l) && /1 garment/.test(l)));
  assert.ok(meta.lines.includes('40% knit'));
  assert.ok(meta.lines.some(l => /^Edited /.test(l)));
});

test('previewMeta degrades gracefully with no summary and no timestamp', () => {
  const meta = previewMeta({ name: 'X' }, null);
  assert.equal(meta.title, 'X');
  assert.deepEqual(meta.lines, []);
  assert.equal(previewMeta(null, null).title, 'Untitled project');
});

test('the bar caps how many projects it renders so it can never bloat', () => {
  assert.ok(Number.isFinite(MAX_TASKS) && MAX_TASKS > 0 && MAX_TASKS <= 40);
});
