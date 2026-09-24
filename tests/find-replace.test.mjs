// KNITCAT — Find & Replace a symbol.
//
// The behaviour that matters lives in the DOM-free `replaceValue` op (js/edit/
// chart-ops.js); the command surface (js/ui/chart-commands.js → the Chart menu and
// Ctrl+K) only prompts and reports, and commits through the one undoable
// `setMatrix` path like every other chart verb. So the arithmetic is asserted
// exhaustively here, and the wiring is asserted so the feature can never again be
// correct-but-invisible — the exact mistake this app keeps having to undo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceValue } from '../js/edit/chart-ops.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';
import {
  CHART_COMMAND_IDS,
  COMMAND_IDS,
  runChartCommand,
  chartPaletteActions
} from '../js/ui/chart-commands.js';
import { buildMenus, MENUBAR_ACTIONS } from '../js/ui/menubar.js';

const K = STITCH_TYPE.KNIT;
const O = STITCH_TYPE.EYELET;
const TL = STITCH_TYPE.TRANSFER_LEFT;
const TR = STITCH_TYPE.TRANSFER_RIGHT;
const T2L = STITCH_TYPE.TRANSFER_DOUBLE_L;

// ─── the pure op ─────────────────────────────────────────────────────────────

test('replaceValue swaps every matching cell across the whole card', () => {
  const card = [
    [K, TL, O],
    [TL, K, TR]
  ];
  const r = replaceValue(card, TL, TR, { mode: 'lace' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.matrix, [
    [K, TR, O],
    [TR, K, TR]
  ]);
  assert.equal(r.matched, 2, 'two cells held TL');
  assert.equal(r.changed, 2, 'both moved to TR');
});

test('replaceValue never mutates the input matrix (undo stores by value)', () => {
  const card = [[TL, K], [K, TL]];
  const snapshot = card.map(row => [...row]);
  replaceValue(card, TL, TR, { mode: 'lace' });
  assert.deepEqual(card, snapshot, 'the original card is byte-for-byte untouched');
});

test('matching is strict equality, so TL never collides with T2L', () => {
  const card = [[TL, T2L, TR]];
  const r = replaceValue(card, TL, TR, { mode: 'lace' });
  assert.deepEqual(r.matrix, [[TR, T2L, TR]]);
  assert.equal(r.matched, 1, 'only the exact TL matched, not the double transfer');
});

test('a no-match find reports matched 0 honestly, not as a silent success', () => {
  const card = [[K, O], [O, K]];
  const r = replaceValue(card, TL, TR, { mode: 'lace' });
  assert.equal(r.ok, true);
  assert.equal(r.matched, 0);
  assert.equal(r.changed, 0);
  assert.deepEqual(r.matrix, card, 'the card is returned unchanged');
});

test('find and replace being the same symbol is refused', () => {
  const r = replaceValue([[TL]], TL, TL, { mode: 'lace' });
  assert.equal(r.ok, false);
  assert.match(r.error, /same symbol/i);
});

test('within restricts the edit to a selection of cell keys', () => {
  const card = [
    [TL, TL],
    [TL, TL]
  ];
  const within = new Set(['0,0', '1,1']); // the diagonal only
  const r = replaceValue(card, TL, TR, { mode: 'lace', within });
  assert.deepEqual(r.matrix, [
    [TR, TL],
    [TL, TR]
  ]);
  assert.equal(r.matched, 2);
  assert.equal(r.changed, 2);
});

test('direct (colourwork) cards replace the numeric punched/blank values', () => {
  const card = [
    [1, 0, 1],
    [0, 1, 0]
  ];
  const r = replaceValue(card, 1, 0, { mode: 'fair_isle' });
  assert.deepEqual(r.matrix, [
    [0, 0, 0],
    [0, 0, 0]
  ]);
  assert.equal(r.matched, 3);
});

test('the changed count tracks only cells that actually moved', () => {
  // Replacing blank 0 with punched 1 on a card already partly punched.
  const card = [[1, 0], [0, 0]];
  const r = replaceValue(card, 0, 1, { mode: 'tuck' });
  assert.equal(r.matched, 3);
  assert.equal(r.changed, 3);
  assert.deepEqual(r.matrix, [[1, 1], [1, 1]]);
});

// ─── the wiring: correct must also mean reachable ────────────────────────────

test('chart.replace is a dispatched command id', () => {
  assert.ok(CHART_COMMAND_IDS.includes('chart.replace'));
  assert.ok(COMMAND_IDS.includes('chart.replace'));
});

test('the Chart menu offers Find & replace and it maps to a declared action', () => {
  const chart = buildMenus().find(m => m.id === 'chart');
  assert.ok(chart.items.some(i => i.action === 'chart.replace'), 'Chart menu lacks the item');
  assert.ok(MENUBAR_ACTIONS.has('chart.replace'), 'the action must be declared, not a dead id');
});

test('Ctrl+K surfaces Find & replace under the Chart group', () => {
  const actions = chartPaletteActions({ runCommand() {} });
  const entry = actions.find(a => /replace/i.test(a.label));
  assert.ok(entry, 'the palette should list a replace verb');
  assert.equal(entry.group, 'Chart');
  assert.match(entry.keywords, /replace/);
});

test('runChartCommand dispatches chart.replace without touching the card when there is no DOM', () => {
  // openFormDialog is inert without a document, so the command must return true
  // (it owned the id) and commit nothing.
  let wrote = false;
  const app = {
    editor: {
      mode: 'lace',
      matrix: [[TL, K], [K, TR]],
      rows: 2,
      cols: 2,
      selectionKeys: new Set(),
      getLayers() { return []; },
      setMatrix() { wrote = true; },
      setLabel() {},
      render() {}
    },
    _editorNotice() {}
  };
  assert.equal(runChartCommand(app, 'chart.replace'), true);
  assert.equal(wrote, false, 'no dialog submission means no write');
});
