// KNITCAT — Lace Intelligence (pair the lone eyelets).
//
// The pure fix-ups live in `js/edit/lace-intel.js`; the commands (`lace.unpaired`,
// `lace.pair`, `lace.balance` → the Lace menu and Ctrl+K) only prompt and report and
// commit through the one undoable `setMatrix` path. So the arithmetic — including the
// safety properties a knitter would be furious to lose (never overwrite a worked
// needle, never collide two pairings, never drop a lone eyelet silently) — is asserted
// exhaustively here, then the wiring is asserted so the verbs can never be
// correct-but-invisible again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEyeletPaid, findUnpairedEyelets, pairEyelets } from '../js/edit/lace-intel.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';
import { laceBalance, chartBalance } from '../js/presets/preset-recipe-helpers.js';
import {
  LACE_COMMAND_IDS,
  COMMAND_IDS,
  runChartCommand,
  chartPaletteActions
} from '../js/ui/chart-commands.js';
import { buildMenus, MENUBAR_ACTIONS } from '../js/ui/menubar.js';

const K = STITCH_TYPE.KNIT;
const P = STITCH_TYPE.PURL;
const O = STITCH_TYPE.EYELET;
const TL = STITCH_TYPE.TRANSFER_LEFT;
const TR = STITCH_TYPE.TRANSFER_RIGHT;
const TUCK = STITCH_TYPE.TUCK;

// ─── isEyeletPaid — the single shared definition of "paired" ──────────────────

test('an eyelet is paid by a transfer leaning into it on either side', () => {
  assert.equal(isEyeletPaid([TL, O, K], 1), true, 'a TL on the left pays it');
  assert.equal(isEyeletPaid([K, O, TR], 1), true, 'a TR on the right pays it');
  assert.equal(isEyeletPaid([K, O, K], 1), false, 'plain neighbours leave it lone');
});

// ─── findUnpairedEyelets — the read-only survey ───────────────────────────────

test('findUnpairedEyelets tallies paired and lone eyelets separately', () => {
  const matrix = [
    [TL, O, K], // paid (left)
    [K, O, K], // lone
    [K, O, TR] // paid (right)
  ];
  const r = findUnpairedEyelets(matrix, { mode: 'lace' });
  assert.equal(r.eyelets, 3);
  assert.equal(r.paid, 2);
  assert.equal(r.count, 1);
  assert.deepEqual(r.cells, [[1, 1]], 'the lone one is row 1, needle 1 (0-based)');
});

test('findUnpairedEyelets is a no-op tally for a non-lace card', () => {
  const r = findUnpairedEyelets([[1, 1], [1, 1]], { mode: 'fair_isle' });
  assert.equal(r.lace, false);
  assert.equal(r.eyelets, 0);
});

// ─── pairEyelets — the write verb, and its safety ─────────────────────────────

test('pairEyelets leans the decrease right by default and balances the row', () => {
  const matrix = [[K, O, K]];
  const r = pairEyelets(matrix, { mode: 'lace' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.matrix, [[K, O, TR]]);
  assert.equal(r.paired, 1);
  assert.equal(laceBalance(r.matrix[0]), 0, 'eyelet +1, transfer -1 → the row keeps its count');
});

test('pairEyelets never mutates the input matrix', () => {
  const matrix = [[K, O, K]];
  const snapshot = matrix.map(row => [...row]);
  pairEyelets(matrix, { mode: 'lace' });
  assert.deepEqual(matrix, snapshot);
});

test('pairEyelets never overwrites a worked needle, so it reports a skip instead', () => {
  // Both neighbours are worked non-plain symbols that do NOT pay the eyelet.
  const matrix = [[TUCK, O, TUCK]];
  const r = pairEyelets(matrix, { mode: 'lace' });
  assert.equal(r.paired, 0);
  assert.equal(r.skipped, 1, 'nowhere legal to put the decrease — surfaced, not silent');
  assert.deepEqual(r.matrix, matrix, 'the card is returned untouched');
});

test('two eyelets never collide on one needle (per-row claim)', () => {
  // eyelet 0 takes needle 1; eyelet 2 finds needle 1 gone and needle 3 off-card.
  const matrix = [[O, K, O]];
  const r = pairEyelets(matrix, { mode: 'lace' });
  assert.equal(r.paired, 1);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.matrix, [[O, TR, O]]);
});

test('already-paired eyelets are counted, never touched', () => {
  const matrix = [[TL, O, K]];
  const r = pairEyelets(matrix, { mode: 'lace' });
  assert.equal(r.paired, 0);
  assert.equal(r.alreadyPaired, 1);
  assert.deepEqual(r.matrix, matrix);
});

test('a forced left lean mirrors the right, and falls back only when blocked', () => {
  const leftForced = pairEyelets([[K, O, K]], { mode: 'lace', direction: 'left' });
  assert.deepEqual(leftForced.matrix, [[TL, O, K]]);
  // Forced right at the right edge has nowhere right to go, so it uses the left.
  const edge = pairEyelets([[K, O]], { mode: 'lace', direction: 'right' });
  assert.deepEqual(edge.matrix, [[TL, O]]);
  assert.equal(edge.paired, 1);
});

test('within restricts pairing to the eyelets inside the selection', () => {
  const matrix = [[O, K, O, K]];
  const only = new Set(['0,0']); // just the first eyelet
  const r = pairEyelets(matrix, { mode: 'lace', within: only });
  assert.equal(r.paired, 1);
  assert.deepEqual(r.matrix, [[O, TR, O, K]], 'the second eyelet was left alone');
});

test('a selection that excludes every eyelet commits nothing', () => {
  const matrix = [[K, O, K]];
  const r = pairEyelets(matrix, { mode: 'lace', within: new Set(['0,0']) });
  assert.equal(r.paired, 0);
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.matrix, matrix);
});

test('pairing a whole lone-eyelet card balances every affected row', () => {
  const matrix = [
    [K, O, K, K],
    [K, K, O, K],
    [TL, O, K, K] // already paired — should be left correct
  ];
  const before = chartBalance(matrix);
  const r = pairEyelets(matrix, { mode: 'lace' });
  const after = chartBalance(r.matrix);
  assert.ok(before > 0, 'the drawn chart was net-positive (lone eyelets)');
  assert.equal(after, 0, 'pairing brings the whole card to a stitch-balanced chart');
  assert.equal(r.paired, 2);
  assert.equal(r.alreadyPaired, 1);
});

test('pairEyelets refuses to run on a non-lace chart', () => {
  const r = pairEyelets([[1, 0], [0, 1]], { mode: 'tuck' });
  assert.equal(r.ok, false);
  assert.match(r.error, /lace/i);
});

// ─── the wiring: correct must also mean reachable ────────────────────────────

test('the lace verbs are dispatched command ids', () => {
  for (const id of ['lace.unpaired', 'lace.pair', 'lace.balance']) {
    assert.ok(LACE_COMMAND_IDS.includes(id));
    assert.ok(COMMAND_IDS.includes(id), `${id} is on the dispatcher`);
  }
});

test('the Lace menu lists all three verbs and every one is a declared action', () => {
  const menu = buildMenus().find(m => m.id === 'lace');
  assert.ok(menu, 'there is a Lace menu');
  const acts = menu.items.filter(i => i.action).map(i => i.action);
  assert.deepEqual(acts, ['lace.unpaired', 'lace.pair', 'lace.balance']);
  for (const a of acts) assert.ok(MENUBAR_ACTIONS.has(a), `${a} must be declared`);
});

test('Ctrl+K surfaces the lace verbs under the Lace group', () => {
  const actions = chartPaletteActions({ runCommand() {} });
  const lace = actions.filter(a => a.group === 'Lace');
  assert.equal(lace.length, 3);
  assert.ok(lace.every(a => /lace/i.test(a.keywords)), 'each is findable by the word "lace"');
});

function fakeLaceApp(mode, matrix) {
  const state = { wrote: false, highlighted: null, notice: null };
  const app = {
    editor: {
      mode,
      matrix,
      rows: matrix.length,
      cols: matrix[0] ? matrix[0].length : 0,
      selectionKeys: new Set(),
      getLayers() { return []; },
      setMatrix() { state.wrote = true; },
      setLabel() {},
      render() {},
      setHighlight(cells) { state.highlighted = cells; }
    },
    _editorNotice(message, opts) { state.notice = { message, kind: opts && opts.kind }; }
  };
  return { app, state };
}

test('lace.unpaired highlights the offenders without writing the card', () => {
  const { app, state } = fakeLaceApp('lace', [[K, O, K]]);
  assert.equal(runChartCommand(app, 'lace.unpaired'), true);
  assert.equal(state.wrote, false, 'a survey must never mutate');
  assert.deepEqual(state.highlighted, [[0, 1]]);
});

test('lace.balance reports without writing', () => {
  const { app, state } = fakeLaceApp('lace', [[K, O, K]]);
  assert.equal(runChartCommand(app, 'lace.balance'), true);
  assert.equal(state.wrote, false);
  assert.match(state.notice.message, /changes by \+1/);
});

test('lace.pair dispatches but commits nothing without a dialog submission (no DOM)', () => {
  const { app, state } = fakeLaceApp('lace', [[K, O, K]]);
  assert.equal(runChartCommand(app, 'lace.pair'), true);
  assert.equal(state.wrote, false, 'openFormDialog is inert with no document, so no write happens');
});

test('the lace verbs refuse politely on a non-lace card', () => {
  for (const id of ['lace.unpaired', 'lace.balance']) {
    const { app, state } = fakeLaceApp('fair_isle', [[1, 0], [0, 1]]);
    assert.equal(runChartCommand(app, id), true);
    assert.equal(state.wrote, false);
    assert.equal(state.notice.kind, 'warn', `${id} warns it is lace-only`);
  }
});
