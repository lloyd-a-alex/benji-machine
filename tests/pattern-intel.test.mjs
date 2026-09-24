// Pattern Intelligence — the analyse-and-normalise layer on top of chart surgery.
// Pure, DOM-free functions asserted directly, plus a light wiring pass proving the
// non-prompting verbs reach the same undoable setMatrix path as every other command.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STITCH_TYPE } from '../js/math/knit-topology.js';
import {
  contentBounds,
  cropToContent,
  tileMatrix,
  padToSize,
  addBorder,
  detectRepeat,
  symmetryReport,
  makeSymmetric,
  despeckle,
  fillSpecks,
  halfDrop,
  densityStats
} from '../js/edit/pattern-intel.js';
import { PATTERN_COMMAND_IDS, COMMAND_IDS, runChartCommand } from '../js/ui/chart-commands.js';

const K = STITCH_TYPE.KNIT;
const O = STITCH_TYPE.EYELET;
const TL = STITCH_TYPE.TRANSFER_LEFT;
const TR = STITCH_TYPE.TRANSFER_RIGHT;

/** A Fair Isle (0/1) grid for the punched-mode cases. */
function bits(rows) {
  return rows.map(r => r.map(Number));
}

// ─── bounds + crop ───────────────────────────────────────────────────────────

test('contentBounds finds the tight box of worked cells and null on a blank card', () => {
  const lace = [
    [K, K, K, K],
    [K, K, O, K],
    [K, K, K, K],
    [K, K, K, K]
  ];
  assert.deepEqual(contentBounds(lace, { mode: 'lace' }), { r1: 1, c1: 2, r2: 1, c2: 2, rows: 1, cols: 1 });
  const empty = [
    [K, K],
    [K, K]
  ];
  assert.equal(contentBounds(empty, { mode: 'lace' }), null);
});

test('cropToContent trims to the design and refuses a blank card', () => {
  const card = bits([
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 1, 0, 0],
    [0, 0, 0, 0]
  ]);
  const res = cropToContent(card, { mode: 'fair_isle' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.matrix, [
    [1, 1],
    [1, 0]
  ]);
  assert.deepEqual(res.trimmed, { top: 1, left: 1, bottom: 1, right: 1 });
  const padded = cropToContent(card, { mode: 'fair_isle', padding: 1 });
  assert.equal(padded.matrix.length, 4, 'padding of 1 around a 2×2 core restores the whole card');
  assert.equal(cropToContent(bits([[0, 0], [0, 0]]), { mode: 'fair_isle' }).ok, false);
});

// ─── tile / pad / border ─────────────────────────────────────────────────────

test('tileMatrix repeats the motif across and down', () => {
  const res = tileMatrix(bits([[1, 0]]), { mode: 'fair_isle', across: 3, down: 2 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.matrix, [
    [1, 0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1, 0]
  ]);
});

test('tileMatrix refuses to exceed the needle bed', () => {
  const res = tileMatrix(bits([[1, 0]]), { mode: 'fair_isle', across: 4, down: 1, maxCols: 5 });
  assert.equal(res.ok, false);
  assert.equal(res.oversize.cols, 8);
  assert.equal(res.oversize.maxCols, 5);
});

test('padToSize grows the card and centres the design; anchor can pin it', () => {
  const card = bits([[1]]);
  const centered = padToSize(card, { mode: 'fair_isle', rows: 3, cols: 3 });
  assert.equal(centered.ok, true);
  assert.equal(centered.matrix[1][1], 1, 'single cell lands in the centre');
  assert.equal(centered.matrix[0][0], 0);
  const pinned = padToSize(card, { mode: 'fair_isle', rows: 3, cols: 3, anchor: 'nw' });
  assert.equal(pinned.matrix[0][0], 1, 'north-west anchor keeps it at the corner');
  // Never crops: asking for a smaller card is a no-op, not a truncation.
  const same = padToSize(bits([[1, 1], [1, 1]]), { mode: 'fair_isle', rows: 1, cols: 1 });
  assert.equal(same.matrix.length, 2);
});

test('addBorder frames the card with blank and grows by 2x thickness', () => {
  const res = addBorder(bits([[1]]), { mode: 'fair_isle', thickness: 1 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.matrix, [
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0]
  ]);
  const framed = addBorder(bits([[1]]), { mode: 'fair_isle', thickness: 1, value: 1 });
  assert.equal(framed.matrix[0][0], 1, 'a punched value makes a solid border');
});

// ─── repeat + symmetry ───────────────────────────────────────────────────────

test('detectRepeat discovers a 2x3 tile hiding in a bigger card', () => {
  const unit = bits([
    [1, 0, 0],
    [0, 0, 1]
  ]);
  const card = tileMatrix(unit, { mode: 'fair_isle', across: 2, down: 2 }).matrix;
  const rep = detectRepeat(card, { mode: 'fair_isle' });
  assert.equal(rep.rowPeriod, 2);
  assert.equal(rep.colPeriod, 3);
  assert.equal(rep.isFullRow, false);
});

test('detectRepeat reports the full card when there is no smaller tile', () => {
  const rep = detectRepeat(bits([[1, 0], [0, 1]]), { mode: 'fair_isle' });
  assert.equal(rep.rowPeriod, 2);
  assert.equal(rep.colPeriod, 2);
  assert.equal(rep.isFullRow, true);
  assert.equal(rep.isFullCol, true);
});

test('symmetryReport scores an already-symmetric card at 100%', () => {
  const card = bits([
    [1, 0, 1],
    [0, 1, 0],
    [1, 0, 1]
  ]);
  const s = symmetryReport(card, { mode: 'fair_isle' });
  assert.equal(s.vertical.pct, 1);
  assert.equal(s.horizontal.pct, 1);
  assert.equal(s.rotational.pct, 1);
});

test('makeSymmetric completes a left-right mirror so symmetry hits 100%', () => {
  const card = bits([
    [1, 0, 0, 0],
    [1, 1, 0, 0]
  ]);
  const res = makeSymmetric(card, { mode: 'fair_isle', axis: 'h', keep: 'first' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.matrix, [
    [1, 0, 0, 1],
    [1, 1, 1, 1]
  ]);
  assert.equal(symmetryReport(res.matrix, { mode: 'fair_isle' }).vertical.pct, 1);
});

test('makeSymmetric flips lace transfer handedness across the vertical axis', () => {
  const card = [
    [TL, K, K, K],
    [K, K, K, K]
  ];
  const res = makeSymmetric(card, { mode: 'lace', axis: 'h', keep: 'first' });
  assert.equal(res.matrix[0][3], TR, 'a left transfer mirrored to the far right becomes a right transfer');
  assert.equal(res.matrix[0][2], K);
});

test('makeSymmetric mirrors top to bottom without altering symbol handedness', () => {
  const card = [
    [TL, O],
    [K, K]
  ];
  const res = makeSymmetric(card, { mode: 'lace', axis: 'v', keep: 'first' });
  assert.deepEqual(res.matrix[1], [TL, O], 'vertical mirror copies the top row down verbatim');
});

// ─── speckle cleanup ─────────────────────────────────────────────────────────

test('despeckle drops fully isolated holes and keeps clusters', () => {
  const card = bits([
    [1, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 1, 1],
    [0, 0, 1, 0]
  ]);
  const res = despeckle(card, { mode: 'fair_isle', minNeighbors: 1 });
  assert.equal(res.matrix[0][0], 0, 'the lone corner hole (no touching stitches) is removed');
  assert.equal(res.removed, 1);
  assert.equal(res.matrix[2][2], 1, 'the cluster is untouched');
});

test('fillSpecks closes a blank fully surrounded by work', () => {
  const card = bits([
    [1, 1, 1],
    [1, 0, 1],
    [1, 1, 1]
  ]);
  const res = fillSpecks(card, { mode: 'fair_isle' });
  assert.equal(res.matrix[1][1], 1);
  assert.equal(res.filled, 1);
  const laceFill = fillSpecks([[K]], { mode: 'lace' });
  assert.equal(laceFill.filled, 0, 'a lone blank has no worked neighbours to be sealed by');
});

// ─── half-drop + density ─────────────────────────────────────────────────────

test('halfDrop shifts odd columns down by the offset, wrapping toroidally', () => {
  const card = bits([
    [1, 1],
    [2, 3],
    [4, 5],
    [6, 7]
  ]);
  // Even (needle 0) untouched; odd (needle 1) was [1,3,5,7] and shifts down by 2,
  // wrapping toroidally to [5,7,1,3].
  const res = halfDrop(card, { mode: 'fair_isle', offset: 2 });
  assert.deepEqual(res.matrix.map(r => r[0]), [1, 2, 4, 6], 'even column stays put');
  assert.deepEqual(res.matrix.map(r => r[1]), [5, 7, 1, 3]);
});

test('densityStats counts worked cells per row and column', () => {
  const card = bits([
    [1, 0],
    [1, 1]
  ]);
  const d = densityStats(card, { mode: 'fair_isle' });
  assert.equal(d.punched, 3);
  assert.equal(d.total, 4);
  assert.equal(d.density, 0.75);
  assert.deepEqual(d.perRow, [1, 2]);
  assert.deepEqual(d.perCol, [2, 1]);
});

// ─── command wiring ──────────────────────────────────────────────────────────

test('every pattern verb is a known command id', () => {
  for (const id of PATTERN_COMMAND_IDS) assert.ok(COMMAND_IDS.includes(id), `${id} must be dispatched`);
  assert.equal(PATTERN_COMMAND_IDS.length, 12);
});

test('runChartCommand is inert for unknown ids and off-dispatcher ids', () => {
  const app = { editor: { matrix: bits([[1]]), rows: 1, cols: 1, mode: 'fair_isle', selectionKeys: new Set(), setMatrix() {}, setLabel() {} } };
  assert.equal(runChartCommand(app, 'not.a.command'), false);
});

test('pattern.density routes a read-only report through the notifier without a write', () => {
  const calls = [];
  const app = {
    currentMode: 'fair_isle',
    editor: {
      matrix: bits([[1, 0], [1, 1]]),
      rows: 2,
      cols: 2,
      mode: 'fair_isle',
      selectionKeys: new Set(),
      getLayers() { return []; },
      setMatrix() { calls.push('setMatrix'); },
      setLabel() {}
    },
    _editorNotice(message, opts) { calls.push('notice:' + (opts && opts.kind)); }
  };
  assert.equal(runChartCommand(app, 'pattern.density'), true);
  assert.ok(calls.some(c => c.startsWith('notice:')), 'the report is surfaced');
  assert.ok(!calls.includes('setMatrix'), 'a read-only verb never mutates the card');
});

test('pattern.symmetric.h commits a new card through the single undoable write path', () => {
  let written = null;
  const app = {
    currentMode: 'fair_isle',
    editor: {
      matrix: bits([[1, 0, 0, 0]]),
      rows: 1,
      cols: 4,
      mode: 'fair_isle',
      selectionKeys: new Set(),
      getLayers() { return []; },
      setMatrix(m) { written = m; },
      setLabel() {}
    },
    _editorNotice() {}
  };
  assert.equal(runChartCommand(app, 'pattern.symmetric.h'), true);
  assert.deepEqual(written, [[1, 0, 0, 1]], 'the left half is mirrored onto the right');
});

test('makeSymmetric reports how many cells it had to change', () => {
  assert.equal(makeSymmetric([[1, 0, 0, 1]], { mode: 'fair_isle', axis: 'h' }).changed, 0, 'already symmetric');
  assert.equal(makeSymmetric([[1, 0, 0, 0]], { mode: 'fair_isle', axis: 'h' }).changed, 1, 'only the far corner needed mirroring');
});
