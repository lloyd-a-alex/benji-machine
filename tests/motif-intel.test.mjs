// Motif & Shape Intelligence — the shape vocabulary layered on top of Pattern
// Intelligence. Pure functions are asserted directly; a light wiring pass proves the
// non-prompting verbs reach the shared undoable setMatrix path / notifier.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STITCH_TYPE } from '../js/math/knit-topology.js';
import {
  connectedComponents,
  motifSummary,
  dilateContent,
  erodeContent,
  outlineContent,
  fillEnclosedHoles,
  classifySymmetry,
  kaleidoscope
} from '../js/edit/motif-intel.js';
import { MOTIF_COMMAND_IDS, COMMAND_IDS, runChartCommand } from '../js/ui/chart-commands.js';

const K = STITCH_TYPE.KNIT;
const TL = STITCH_TYPE.TRANSFER_LEFT;
const TR = STITCH_TYPE.TRANSFER_RIGHT;

function bits(rows) {
  return rows.map(r => r.map(Number));
}

// ─── connected components ────────────────────────────────────────────────────

test('connectedComponents labels two separate figures with 8-connectivity', () => {
  const card = bits([
    [1, 1, 0, 0],
    [1, 1, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 1]
  ]);
  const cc = connectedComponents(card, { mode: 'fair_isle', connectivity: 8 });
  assert.equal(cc.count, 2);
  const areas = cc.regions.map(r => r.area).sort((a, b) => a - b);
  assert.deepEqual(areas, [1, 4]);
  const big = cc.regions.find(r => r.area === 4);
  assert.deepEqual([big.r1, big.c1, big.r2, big.c2], [0, 0, 1, 1]);
  assert.equal(cc.labels[0][0], big.label);
  assert.equal(cc.labels[2][2], 0, 'blank cells carry no label');
});

test('connectivity 4 splits diagonally-touching cells that 8 joins', () => {
  const card = bits([
    [1, 0],
    [0, 1]
  ]);
  assert.equal(connectedComponents(card, { mode: 'fair_isle', connectivity: 8 }).count, 1);
  assert.equal(connectedComponents(card, { mode: 'fair_isle', connectivity: 4 }).count, 2);
});

test('motifSummary counts figures, isolated stitches and the largest bounds', () => {
  const card = bits([
    [1, 1, 0, 0],
    [1, 1, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 1]
  ]);
  const s = motifSummary(card, { mode: 'fair_isle' });
  assert.equal(s.count, 2);
  assert.equal(s.total, 5);
  assert.equal(s.isolated, 1);
  assert.deepEqual([s.largest.rows, s.largest.cols], [2, 2]);
  assert.equal(motifSummary(bits([[0, 0]]), { mode: 'fair_isle' }).count, 0);
});

test('motifSummary returns the isolated-stitch coordinates to spotlight', () => {
  const s = motifSummary(bits([[1, 0, 1], [0, 0, 0], [1, 0, 1]]), { mode: 'fair_isle', connectivity: 8 });
  assert.equal(s.isolated, 4);
  assert.equal(s.isolatedCells.length, 4);
  assert.ok(s.isolatedCells.some(([r, c]) => r === 0 && c === 0));
});

// ─── morphology ──────────────────────────────────────────────────────────────

test('dilateContent grows a single stitch into a 3x3 block', () => {
  const res = dilateContent(bits([[0, 0, 0], [0, 1, 0], [0, 0, 0]]), { mode: 'fair_isle' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.matrix, [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1]
  ]);
  assert.equal(res.added, 8);
});

test('erodeContent strips the outer ring of a full block (zero-padded edge)', () => {
  const res = erodeContent(bits([[1, 1, 1], [1, 1, 1], [1, 1, 1]]), { mode: 'fair_isle' });
  assert.deepEqual(res.matrix, [
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0]
  ]);
  assert.equal(res.removed, 8);
});

test('outlineContent keeps the ring and blanks the interior', () => {
  const res = outlineContent(bits([[1, 1, 1], [1, 1, 1], [1, 1, 1]]), { mode: 'fair_isle', thickness: 1 });
  assert.deepEqual(res.matrix, [
    [1, 1, 1],
    [1, 0, 1],
    [1, 1, 1]
  ]);
  assert.equal(res.kept, 8);
});

test('dilate then outline of a lone stitch round-trips to a ring', () => {
  const grown = dilateContent(bits([[0, 0, 0], [0, 1, 0], [0, 0, 0]]), { mode: 'fair_isle' }).matrix;
  const ring = outlineContent(grown, { mode: 'fair_isle', thickness: 1 }).matrix;
  assert.deepEqual(ring, [
    [1, 1, 1],
    [1, 0, 1],
    [1, 1, 1]
  ]);
});

// ─── hole filling ────────────────────────────────────────────────────────────

test('fillEnclosedHoles punches a sealed centre closed', () => {
  const res = fillEnclosedHoles(bits([[1, 1, 1], [1, 0, 1], [1, 1, 1]]), { mode: 'fair_isle' });
  assert.deepEqual(res.matrix, [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1]
  ]);
  assert.equal(res.filled, 1);
});

test('fillEnclosedHoles leaves edge-connected background alone', () => {
  // The blank column is open to the top edge, so it is background, not a hole.
  const res = fillEnclosedHoles(bits([[1, 0, 1], [1, 0, 1], [1, 1, 1]]), { mode: 'fair_isle' });
  assert.equal(res.filled, 0);
  assert.equal(res.matrix[0][1], 0);
  assert.equal(res.matrix[1][1], 0);
});

// ─── symmetry classification + kaleidoscope ──────────────────────────────────

test('classifySymmetry names a fully mirrored card and an asymmetric one', () => {
  const sym = classifySymmetry(bits([[1, 0, 1], [0, 1, 0], [1, 0, 1]]), { mode: 'fair_isle' });
  assert.equal(sym.vertical, true);
  assert.equal(sym.horizontal, true);
  assert.equal(sym.rotational, true);
  assert.equal(sym.name, 'fully mirrored');
  assert.equal(classifySymmetry(bits([[1, 0], [0, 0]]), { mode: 'fair_isle' }).name, 'asymmetric');
});

test('kaleidoscope reflects a corner into a symmetric four-quadrant field', () => {
  const res = kaleidoscope(bits([[1]]), { mode: 'fair_isle' });
  assert.deepEqual(res.matrix, [
    [1, 1],
    [1, 1]
  ]);
});

test('kaleidoscope re-hands lace transfers across the mirrored axis', () => {
  const res = kaleidoscope([[TL, K]], { mode: 'lace' });
  assert.deepEqual(res.matrix[0], [TL, K, K, TR], 'a left transfer mirrors to a right transfer on the far side');
});

test('kaleidoscope refuses to exceed the needle bed', () => {
  const res = kaleidoscope(bits([[1]]), { mode: 'fair_isle', maxCols: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.oversize.cols, 2);
});

// ─── command wiring ──────────────────────────────────────────────────────────

test('every shape verb is a known command id', () => {
  for (const id of MOTIF_COMMAND_IDS) assert.ok(COMMAND_IDS.includes(id), `${id} must be dispatched`);
  assert.equal(MOTIF_COMMAND_IDS.length, 7);
});

function fakeApp(mode, matrix, { onWrite } = {}) {
  return {
    currentMode: mode,
    editor: {
      matrix,
      rows: matrix.length,
      cols: matrix[0].length,
      mode,
      selectionKeys: new Set(),
      getLayers() { return []; },
      setMatrix(m) { if (onWrite) onWrite(m); },
      setLabel() {}
    },
    _editorNotice(message, opts) {
      (fakeApp.last = { message, kind: opts && opts.kind });
    }
  };
}

test('motif.summary reports the figures without mutating the card', () => {
  let wrote = false;
  const app = fakeApp('fair_isle', bits([[1, 0], [0, 0]]), { onWrite: () => (wrote = true) });
  assert.equal(runChartCommand(app, 'motif.summary'), true);
  assert.ok(fakeApp.last && /motif/.test(fakeApp.last.message));
  assert.equal(wrote, false);
});

test('motif.fillHoles commits the closed card through the undoable write path', () => {
  let written = null;
  const app = fakeApp('fair_isle', bits([[1, 1, 1], [1, 0, 1], [1, 1, 1]]), { onWrite: m => (written = m) });
  assert.equal(runChartCommand(app, 'motif.fillHoles'), true);
  assert.deepEqual(written, [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1]
  ]);
});

test('motif.symmetry routes a classification report', () => {
  const app = fakeApp('fair_isle', bits([[1, 0, 1], [0, 1, 0], [1, 0, 1]]));
  assert.equal(runChartCommand(app, 'motif.symmetry'), true);
  assert.ok(fakeApp.last && /mirrored|symmetric|asymmetric/.test(fakeApp.last.message));
});

test('shape verbs report their precise impact in the toast', () => {
  globalThis.window = { prompt: () => '1' };
  try {
    const app = fakeApp('fair_isle', bits([[0, 0, 0], [0, 1, 0], [0, 0, 0]]));
    assert.equal(runChartCommand(app, 'motif.dilate'), true);
    assert.equal(fakeApp.last.kind, 'success');
    assert.match(fakeApp.last.message, /8 stitch/, 'the added-cell count reaches the knitter');
  } finally {
    delete globalThis.window;
  }
});

test('a write that would blank the card escalates to a warn with an undo hint', () => {
  globalThis.window = { prompt: () => '1' };
  try {
    let written = null;
    const app = fakeApp('fair_isle', bits([[1]]), { onWrite: m => (written = m) });
    assert.equal(runChartCommand(app, 'motif.erode'), true);
    assert.deepEqual(written, [[0]], 'the empty result is still committed so undo restores it');
    assert.equal(fakeApp.last.kind, 'warn');
    assert.match(fakeApp.last.message, /emptied the card/);
  } finally {
    delete globalThis.window;
  }
});
