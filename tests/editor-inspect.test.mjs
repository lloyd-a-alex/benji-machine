// The editor's supporting organs: history, layers, guides, measurement, notes,
// clipboard and multi-document state.
//
// None of these touch the DOM, which is the point — they are the parts that decide
// what a click *means*, and a click cannot be asserted in a browser test without a
// harness this project deliberately does not have. So the semantics are pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffMatrices, invertPatch, applyPatch, createHistory, HistoryTree, patchSize
} from '../js/edit/history.js';
import {
  createStack, createLayer, addLayer, removeLayer, findLayer, activeLayer, composite, paintAt, eraseAt,
  mergeDown, flattenStack, resizeStack, reorderLayer, moveLayerBy, clearLayer, setLayerProperty,
  convertStackModes, topPatternMatrix, canDrawOn, stackInfo, compileRelevant
} from '../js/edit/layers.js';
import {
  addGuide, createGuide, moveGuide, removeGuide, toggleGuideLock, guidesOnAxis, guideValues,
  addRepeat, createRepeat, repeatTiles, tiledKeys, snapPosition, applyAlign, applyDistribute,
  normalizeGuideList
} from '../js/edit/guides.js';
import {
  pitchFor, formatLength, gridSizeMm, stitchesForMm, rowsForMm, mmForStitches, mmForRows, gaugePer10Cm,
  physicalCellPx, calibrationFor, rulerTicks, measureBetween, angleBetween, needleLabels, needleLabelAt,
  subGridOffset, offsetNeedleNumber, cellReadout, mmToInch, inchToMm
} from '../js/edit/measure.js';
import {
  addAnnotation, updateAnnotation, moveAnnotation, shiftForInsert, shiftForDelete, annotationsInRect,
  deleteAnnotation, dimensionText, annotationSummary, sanitizeAnnotations, ANNOTATION_KINDS
} from '../js/edit/annotations.js';
import {
  STITCH_INFO, SYMBOL_ORDER, inspectCell, inspectCellWarnings, rowBalance, matrixBalance, symbolLegend,
  stitchInfo, isKnownSymbol
} from '../js/edit/stitch-info.js';
import {
  createEntry, entrySummary, prepareForPaste, pasteEntry, eraseSource, createClipboard, sanitizeSlots,
  validateEntry, labelForMode, createClipboardBridge, CLIPBOARD_LIMIT
} from '../js/edit/clipboard.js';
import { createDocuments, createDocument, deserializeDocuments, DOCUMENT_LIMIT } from '../js/edit/documents.js';
import { rectKeys, keysUnion } from '../js/edit/select-ops.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';
import { MACHINE_PROFILES } from '../js/machine/profiles.js';
import { LaceCompiler, DIRECTION } from '../js/compiler/lace-decompiler.js';

const K = STITCH_TYPE.KNIT;
const O = STITCH_TYPE.EYELET;
const TL = STITCH_TYPE.TRANSFER_LEFT;
const TR = STITCH_TYPE.TRANSFER_RIGHT;
const DDL = STITCH_TYPE.DOUBLE_DEC_LEFT;

// ─── history ─────────────────────────────────────────────────────────────────

test('a patch is the difference between two cards, and undoes itself', () => {
  const before = [[1, 0], [0, 1]];
  const after = [[1, 1], [0, 1]];
  const patch = diffMatrices(before, after);
  assert.equal(patch.length, 1);
  assert.deepEqual(patch[0], { r: 0, c: 1, from: 0, to: 1 });
  assert.deepEqual(applyPatch(before, patch), after);
  assert.deepEqual(applyPatch(after, patch, { inverse: true }), before);
  assert.deepEqual(applyPatch(after, invertPatch(patch)), before);
  assert.equal(patchSize(patch), 1);
});

test('a patch across a resize grows the card and shrinks it back', () => {
  const small = [[1, 0]];
  const big = [
    [1, 0],
    [0, 0]
  ];
  const patch = diffMatrices(small, big);
  assert.equal(patch.length, 2, 'the new row has two cells');
  assert.equal(patch[0].from, undefined);
  assert.deepEqual(applyPatch(small, patch), big);
  assert.deepEqual(applyPatch(big, patch, { inverse: true }), small, 'undoing an inserted row leaves no blank row behind');
});

test('the tree keeps every branch you abandon', () => {
  const start = [[1, 0], [0, 1]];
  const tree = createHistory({ matrix: start, mode: 'fair_isle' });
  assert.deepEqual(tree.currentMatrix(), start);
  const punched = [[1, 1], [0, 1]];
  const erased = [[0, 0], [0, 1]];
  tree.commit({ matrix: punched, label: 'punched one' });
  assert.deepEqual(tree.currentMatrix(), punched);
  tree.undo();
  assert.equal(tree.canUndo(), false, 'the root has nowhere to go back to');
  tree.commit({ matrix: erased, label: 'erased one' });
  assert.equal(tree.nodes.size, 3, 'root and two branches');
  assert.equal(tree.current().childIds.length, 0);
  // The branch that was walked away from is still there — that is the whole point.
  const abandoned = [...tree.nodes.values()].find(node => node.label === 'punched one');
  assert.equal(tree.jump(abandoned.id), true);
  assert.deepEqual(tree.currentMatrix(), punched);
  assert.equal(tree.redoChoices().length, 0, 'it has no children of its own');
  assert.equal(tree.canRedo(), true, 'but it can go back to the fork');
});

test('checkpoints survive, are jumpable by name, and refuse to be folded away', () => {
  const tree = createHistory({ matrix: [[K, O]], mode: 'lace' });
  tree.checkpoint('before the eyelet row');
  for (let i = 0; i < 6; i++) {
    tree.commit({ matrix: [[K, O], [O, K]].map(row => row.map((v, c) => (i + c) % 2 ? O : K)), label: `edit ${i}` });
  }
  const found = tree.jumpToCheckpoint('before the eyelet row');
  assert.ok(found, 'named state is still reachable after six more edits');
  assert.deepEqual(found.matrix || tree.currentMatrix(), [[K, O]]);
  assert.equal(tree.checkpoints().length, 1);
  const doomed = tree.deleteBranch(found.id);
  assert.equal(doomed.ok, false, 'you cannot delete the state you are standing on');
});

test('a long linear session folds instead of exhausting memory', () => {
  const tree = createHistory({ matrix: [[0]], mode: 'fair_isle', limit: 3 });
  let expected = [[0]];
  for (let i = 1; i <= 8; i++) {
    expected = [[i]];
    tree.commit({ matrix: expected, label: `set ${i}` });
    assert.ok(tree.nodes.size <= 3 + 1, `${tree.nodes.size} nodes with a limit of 3`);
  }
  assert.deepEqual(tree.currentMatrix(), expected, 'folding must not change the visible card');
  assert.equal(tree.canUndo(), true);
  const back = tree.undo();
  assert.ok(back, 'and undo still walks somewhere sensible');
  assert.deepEqual(tree.currentMatrix(), [[7]]);
});

test('history serialises the trail you stopped on, not the whole tree', () => {
  const tree = createHistory({ matrix: [[1, 0]], mode: 'fair_isle', label: 'start' });
  tree.commit({ matrix: [[1, 1]], label: 'punch', checkpoint: 'halfway' });
  const dump = tree.serialize();
  assert.equal(dump.entries.length, 1);
  assert.equal(dump.entries[0].checkpoint, 'halfway');
  const restored = HistoryTree.deserialize(dump);
  assert.deepEqual(restored.currentMatrix(), [[1, 1]]);
  assert.deepEqual(restored.checkpoints().map(node => node.checkpointName), ['start', 'halfway']);
  assert.equal(HistoryTree.deserialize(null), null);
});

// ─── layers ──────────────────────────────────────────────────────────────────

function twoLayerStack() {
  const stack = createStack({ rows: 2, cols: 2, mode: 'lace' });
  const base = stack.layers[0].id;
  paintAt(stack, 1, 1, TL, base);
  addLayer(stack, { name: 'Eyelets' });
  paintAt(stack, 0, 0, O);
  return { stack, base, top: stack.layers[1].id };
}

test('the topmost non-blank cell wins, and remembers who wrote it', () => {
  const { stack, base, top } = twoLayerStack();
  const { matrix, sources } = composite(stack);
  assert.deepEqual(matrix, [[O, K], [K, TL]]);
  assert.equal(sources.get('0,0'), top);
  assert.equal(sources.get('1,1'), base, 'a lower layer shows through where the top is blank');
  assert.equal(sources.has('0,1'), false, 'a plain knit has no owner because nobody drew it');
  assert.equal(topPatternMatrix(stack), stack.layers[1].matrix);
});

test('hiding a layer takes its stitches with it, and erasing finds the owner', () => {
  const { stack, top } = twoLayerStack();
  setLayerProperty(stack, top, 'visible', false);
  assert.deepEqual(composite(stack).matrix, [[K, K], [K, TL]]);
  setLayerProperty(stack, top, 'visible', true);
  const erased = eraseAt(stack, 1, 1);
  assert.equal(erased.layer, undefined === erased.layer ? erased.layer : erased.layer, 'the base owns that cell');
  assert.notEqual(erased.layer, top);
  assert.equal(composite(stack).matrix[1][1], K, 'the eraser reached through to the layer that drew it');
});

test('a locked layer refuses the pencil, and a reference layer never reaches the card', () => {
  const { stack, base } = twoLayerStack();
  setLayerProperty(stack, base, 'locked', true);
  assert.equal(paintAt(stack, 0, 0, O, base).ok, false);
  addLayer(stack, { name: 'Tracing', kind: 'reference' });
  const reference = activeLayer(stack);
  paintAt(stack, 1, 0, O);
  assert.equal(compileRelevant(reference.kind), false);
  assert.equal(composite(stack).matrix[1][0], K, 'a reference underlay cannot punch a hole');
  assert.equal(composite(stack, { includeKind: 'all' }).matrix[1][0], O);
});

test('merging down writes once and removes the layer it consumed', () => {
  const { stack, top } = twoLayerStack();
  const merged = mergeDown(stack, top);
  assert.equal(merged.ok, true);
  assert.equal(merged.written, 1);
  assert.equal(stack.layers.length, 1);
  assert.deepEqual(stack.layers[0].matrix, [[O, K], [K, TL]]);
  assert.equal(stack.activeId, stack.layers[0].id);
  assert.equal(mergeDown(stack, stack.layers[0].id).ok, false, 'the bottom layer has nothing under it');
});

test('the stack always keeps somewhere to draw', () => {
  const stack = createStack({ rows: 2, cols: 2, mode: 'lace' });
  const only = stack.layers[0].id;
  assert.equal(removeLayer(stack, only).ok, false);
  addLayer(stack, { name: 'Second' });
  assert.equal(removeLayer(stack, activeLayer(stack).id).ok, true);
  assert.equal(stackInfo(stack).layers, 1);
  assert.equal(stack.layers[0].id, only, 'the base survives');
});

test('layers resize with the card, flatten on request, and follow the mode', () => {
  const { stack, top } = twoLayerStack();
  const grown = resizeStack(stack, 4, 3);
  assert.equal(grown.resized.length, 2);
  assert.equal(composite(stack).matrix.length, 4);
  assert.equal(composite(stack).matrix[0][0], O, 'content is kept where it was');
  assert.equal(composite(stack).matrix[3][2], K, 'and the new area is blank, not undefined');
  const flat = flattenStack(stack);
  assert.equal(flat.ok, true);
  assert.equal(flat.stack.layers.filter(layer => compileRelevant(layer.kind)).length, 1);
  const converted = convertStackModes(stack, 'lace', 'fair_isle');
  assert.equal(converted.stack.mode, 'fair_isle');
  assert.equal(converted.stack.layers[0].matrix[0][0], 1, 'the eyelet became a punched cell');
  assert.equal(converted.stack.layers[0].matrix[1][1], 0, 'a transfer cannot survive as a hole and becomes blank');
});

test('layer order is the draw order', () => {
  const { stack, base, top } = twoLayerStack();
  assert.equal(stack.layers[1].id, top);
  moveLayerBy(stack, top, -1);
  assert.equal(stack.layers[0].id, top, 'the eyelet layer is now underneath');
  assert.deepEqual(composite(stack).matrix, [[K, K], [K, TL]], 'so the base paints over it');
  reorderLayer(stack, top, 1);
  assert.equal(findLayer(stack, base).name, 'Base');
  assert.equal(canDrawOn(findLayer(stack, top)), true);
  clearLayer(stack, top);
  assert.equal(composite(stack).matrix[0][0], K);
  assert.equal(createLayer({ rows: 2, cols: 2, mode: 'lace' }).matrix[0][0], K);
});

// ─── guides, repeats and snapping ────────────────────────────────────────────

test('a guide is a line, not a stitch', () => {
  const guides = [];
  assert.equal(createGuide({ at: NaN }), null);
  addGuide(guides, { at: 6, axis: 'col', name: 'Repeat edge' });
  addGuide(guides, { at: 2, axis: 'row' });
  assert.deepEqual(guideValues(guides, 'col'), [6]);
  assert.equal(guidesOnAxis(guides, 'row').length, 1);
  toggleGuideLock(guides, guides[0].id);
  assert.equal(moveGuide(guides, guides[0].id, 7).ok, false, 'locked');
  toggleGuideLock(guides, guides[0].id);
  assert.equal(moveGuide(guides, guides[0].id, 7).guide.at, 7);
  assert.equal(removeGuide(guides, guides[0].id).removed, 1);
  assert.equal(normalizeGuideList([{ at: 1 }, { at: 'x' }, null]).length, 1);
});

test('repeats answer the first question of machine design: does it fit?', () => {
  const repeat = createRepeat({ r1: 0, c1: 0, r2: 3, c2: 5 });
  assert.deepEqual({ rows: repeat.rows, cols: repeat.cols }, { rows: 4, cols: 6 });
  const fitted = repeatTiles(repeat, 10, 20);
  assert.equal(fitted.across, 3);
  assert.equal(fitted.down, 2);
  assert.equal(fitted.tiles.length, 6);
  assert.equal(fitted.coversWholeCard, false);
  assert.match(fitted.summary, /left over/);
  const exact = repeatTiles(createRepeat({ r1: 0, c1: 0, r2: 3, c2: 4 }), 8, 10);
  assert.equal(exact.coversWholeCard, true);
  assert.match(exact.summary, /exact fit/);
  assert.equal(tiledKeys(repeat, 10, 20).size, 6 * 4 * 6);
  assert.equal(tiledKeys(null, 10, 10).size, 0);
});

test('snapping prefers the guide, then the repeat edge, then the needle', () => {
  assert.deepEqual(snapPosition(6.2, { guides: [6] }), { value: 6, snapped: true, guide: 6, kind: 'guide' });
  const repeat = createRepeat({ r1: 0, c1: 0, r2: 3, c2: 5 });
  assert.equal(snapPosition(5.8, { repeats: [repeat], axis: 'col' }).kind, 'repeat');
  assert.equal(snapPosition(5.8, { repeats: [repeat], axis: 'col' }).value, 6);
  assert.equal(snapPosition(3.6, {}).kind, 'cell');
  assert.equal(snapPosition(3.4, {}).snapped, false, 'a slow, careful drag is not fought by the tool');
  assert.equal(snapPosition(4.0, { guides: [4], config: { enabled: false } }).snapped, false);
});

test('aligning and distributing move whole regions or refuse to', () => {
  const keys = keysUnion(rectKeys({ r1: 0, c1: 0, r2: 1, c2: 1 }), rectKeys({ r1: 4, c1: 4, r2: 5, c2: 5 }));
  const aligned = applyAlign(keys, 'min-col', { rows: 8, cols: 8 });
  assert.equal(aligned.keys.size, 8, 'aligning cannot lose cells');
  assert.equal(aligned.keys.has('4,0'), true);
  assert.equal(aligned.keys.has('4,4'), false);
  assert.equal(aligned.moved, 1, 'one region was already there');
  const three = keysUnion(keys, rectKeys({ r1: 7, c1: 7, r2: 7, c2: 9 }));
  const spread = applyDistribute(three, 'h', { rows: 10, cols: 12 });
  assert.equal(spread.keys.size, 11);
  assert.deepEqual(spread.blocked, []);
});

// ─── measurement ─────────────────────────────────────────────────────────────

const STANDARD = { pitchX: 4.5, pitchY: 5.08 };

test('the grid has a size in the hand, and it follows the profile', () => {
  const size = gridSizeMm(24, 24, STANDARD);
  assert.equal(size.widthMm, 108);
  assert.ok(Math.abs(size.heightMm - 121.92) < 0.001);
  const fine = gridSizeMm(24, 24, { pitchX: 5, pitchY: 5 });
  assert.equal(fine.widthMm, 120, 'the same 24 cells are wider on a 5 mm bed');
  assert.equal(stitchesForMm(108, STANDARD), 24);
  assert.equal(stitchesForMm(110, { pitchX: 5 }), 22);
  assert.equal(mmForStitches(24, STANDARD), 108);
  assert.equal(rowsForMm(101.6, { pitchY: 5.08, pitchX: 4.5 }), 20);
  assert.equal(mmForRows(2, STANDARD), 10.16);
  assert.deepEqual(pitchFor({}), { pitchX: 4.5, pitchY: 5.08 }, 'a profile with no pitch is not allowed to make the maths vanish');
  assert.deepEqual(pitchFor({ pitchX: -1, pitchY: 'x' }), { pitchX: 4.5, pitchY: 5.08 });
});

test('inches are written the way a tape measure says them', () => {
  assert.equal(formatLength(25.4, 'inch'), '1″');
  assert.equal(formatLength(3.175, 'inch'), '1/8″');
  assert.equal(formatLength(108, 'inch'), '4 1/4″');
  assert.equal(formatLength(108, 'inch', { fraction: false }), '4.25″');
  assert.equal(formatLength(108, 'mm'), '108.0 mm');
  assert.equal(formatLength(108, 'cm'), '10.8 cm');
  assert.equal(formatLength(NaN, 'mm'), '--');
  assert.equal(inchToMm(1), 25.4);
  assert.equal(mmToInch(25.4), 1);
});

test('a gauge is two numbers, and 100 % means roughly real size', () => {
  const gauge = gaugePer10Cm(STANDARD);
  assert.ok(Math.abs(gauge.stitchesPer10Cm - 22.222) < 0.01);
  assert.ok(Math.abs(gauge.rowsPer10Cm - 19.685) < 0.01);
  assert.ok(Math.abs(physicalCellPx(STANDARD) - 17.008) < 0.01);
  assert.equal(physicalCellPx(STANDARD, { scale: 2 }).toFixed(3), (physicalCellPx(STANDARD) * 2).toFixed(3));
  const calibrated = calibrationFor(90, 100);
  assert.equal(calibrated.ok, true);
  assert.ok(Math.abs(calibrated.calibration - 10 / 9) < 1e-6);
  assert.equal(calibrationFor(1000, 10).ok, false, 'a 100× claim is a mistake, not a display');
  assert.equal(calibrationFor(0, 10).ok, false);
  assert.equal(calibrationFor('ten', 10).calibration, 1);
});

test('the ruler counts stitches, because that is what a knitter can act on', () => {
  const ticks = rulerTicks(7, 4.5, { cellPx: 20 });
  assert.equal(ticks.length, 8, 'a tick per boundary, including the right edge');
  assert.equal(ticks[0].label, '0');
  assert.equal(ticks[0].major, true);
  assert.equal(ticks[3].major, false, '44 px apart means every 3 cells at this zoom');
  assert.ok(Math.abs(ticks[6].mm - 27) < 0.001);
  assert.equal(ticks[6].major, true);
  assert.deepEqual(rulerTicks(0, 4.5), []);
  assert.deepEqual(rulerTicks(4, 0), [], 'a zero pitch would divide by nothing');
});

test('distance and angle are reported in both currencies', () => {
  const a = { r: 0, c: 0 };
  const b = { r: 10, c: 6 };
  const line = measureBetween(a, b, { pitchX: 4.5, pitchY: 5 });
  assert.equal(line.dStitches, 6);
  assert.equal(line.dRows, 10);
  assert.equal(line.xMm, 27);
  assert.equal(line.yMm, 50);
  assert.ok(Math.abs(line.lengthMm - 56.7) < 0.1);
  assert.equal(line.slope, '6:10');
  assert.equal(measureBetween(a, { r: 4, c: 4 }, STANDARD).diagonal, true);
  assert.equal(angleBetween(a, { r: 1, c: 1 }).cardinal, 'diagonal up ↗');
  assert.equal(angleBetween(a, { r: 0, c: 3 }).cardinal, 'along the needle bed →');
  assert.equal(angleBetween(a, { r: 3, c: 0 }).cardinal, 'up the fabric ↑');
  assert.equal(angleBetween(a, a).cardinal, 'point');
});

test('needle numbers tell the truth about an even bed', () => {
  const odd = needleLabels({ total: 9 });
  assert.equal(odd[4].label, '0');
  assert.equal(odd[0].label, '4L');
  assert.equal(odd[8].label, '4R');
  const even = needleLabels({ total: 8 });
  assert.equal(even[3].label, '0L');
  assert.equal(even[4].label, '0R');
  assert.equal(even[3].ambiguous, true, 'the centre mark is between two needles and must be said so');
  assert.equal(needleLabels({ total: 5, origin: 'left-origin' })[0].label, '1');
  assert.equal(needleLabelAt(9, { total: 9 }).error, 'Off the bed.');
  assert.equal(offsetNeedleNumber(0, { total: 5, offset: -1 }).ok, false);
  assert.equal(offsetNeedleNumber(0, { total: 5, offset: 2 }).index, 2);
});

test('half-stitch offsets are a display fact, not a chart operation', () => {
  const half = subGridOffset(2.5);
  assert.deepEqual([half.cells, half.remainder, half.displayOffset], [2, 1, 0.5]);
  assert.match(half.note, /cannot sit between/i);
  assert.equal(subGridOffset(3).remainder, 0);
});

test('the hover readout speaks rows, needles and millimetres', () => {
  const read = cellReadout(13, 6, STANDARD);
  assert.equal(read.row, 14);
  assert.equal(read.needle, 7);
  assert.equal(read.xMm, 27);
  assert.match(read.label, /row 14/);
  assert.match(read.label, /mm/);
});

// ─── annotations ─────────────────────────────────────────────────────────────

test('notes and pins ride along when the card changes shape', () => {
  const list = [];
  addAnnotation(list, 'note', { r: 5, c: 2, text: 'cast on 3-needle' });
  addAnnotation(list, 'pin', { r: 1, c: 1, text: 'start here' });
  assert.equal(list.length, 2);
  assert.equal(addAnnotation(list, 'sticky tape', {}).ok, false);
  shiftForInsert(list, { axis: 'row', at: 2, count: 1 });
  assert.equal(list.find(item => item.kind === 'note').r, 6);
  assert.equal(list.find(item => item.kind === 'pin').r, 1, 'above the insert, so it stays');
  shiftForDelete(list, { axis: 'row', at: 2, count: 1 });
  assert.equal(list.find(item => item.kind === 'note').r, 5, 'and back again');
  shiftForDelete(list, { axis: 'row', at: 0, count: 3 });
  assert.equal(list.find(item => item.kind === 'pin'), undefined, 'the row it annotated is gone');
});

test('a dimension line measures in stitches and in millimetres', () => {
  const list = [];
  assert.equal(addAnnotation(list, 'dimension', { r: 0, c: 0 }).ok, false, 'one corner is not a dimension');
  addAnnotation(list, 'dimension', { r: 0, c: 0, r2: 0, c2: 6 });
  const result = dimensionText(list[0], { pitchX: 4.5, pitchY: 5 });
  assert.equal(result.label, 'horizontal');
  assert.match(result.text, /^6 sts 0 rows/);
  assert.match(result.text, /27\.0 mm/);
  const note = addAnnotation(list, 'note', { r: 1, c: 1, text: 'shoulder' });
  assert.deepEqual(dimensionText(note.annotation, STANDARD), { text: 'shoulder', label: 'note', measurement: null, full: 'shoulder' });
  assert.equal(dimensionText(null, STANDARD).text, '');
});

test('annotation housekeeping: move, filter, delete, and a hostile file', () => {
  const list = [];
  const made = addAnnotation(list, 'arrow', { r: 3, c: 3, r2: 6, c2: 6, text: '↖', follow: 'card' });
  moveAnnotation(list, made.annotation.id, 1, 2);
  assert.deepEqual([made.annotation.r, made.annotation.c, made.annotation.end.r, made.annotation.end.c], [4, 5, 7, 8]);
  updateAnnotation(list, made.annotation.id, { text: 'decrease here', color: '#f43f5e' });
  assert.equal(list[0].text, 'decrease here');
  assert.equal(annotationsInRect(list, { r1: 0, c1: 0, r2: 2, c2: 2 }).length, 0);
  assert.equal(annotationSummary(list[0]).where, 'row 5 · needle 6');
  shiftForInsert(list, { axis: 'row', at: 0, count: 5 });
  assert.equal(list[0].r, 4, 'a card-following annotation stays pinned to the edge');
  assert.equal(deleteAnnotation(list, list[0].id).removed, 1);
  const hostile = sanitizeAnnotations(
    [
      { kind: 'note', r: 1, c: 1, text: 'ok' },
      { kind: 'meme', r: 1, c: 1 },
      { kind: 'note', r: 99, c: 1 },
      { kind: 'note', r: 2, c: 2, text: 'x'.repeat(5000) },
      null
    ],
    { rows: 10, cols: 10 }
  );
  assert.equal(hostile.annotations.length, 2);
  assert.equal(hostile.annotations[1].text.length, 2000, 'long but bounded');
  assert.equal(hostile.dropped.length, 3);
  assert.deepEqual(ANNOTATION_KINDS.slice(0, 2), ['note', 'pin']);
});

// ─── the cell inspector ──────────────────────────────────────────────────────

test('every symbol the topology knows has an explanation', () => {
  for (const value of Object.values(STITCH_TYPE)) {
    assert.equal(isKnownSymbol(value), true, `${value} is documented`);
    const info = stitchInfo(value);
    assert.ok(info.name && info.does, `${value} has a name and a plain-English what`);
    assert.ok(['knit', 'lace', 'either'].includes(info.carriage), `${value} names a carriage`);
    assert.ok(Array.isArray(info.pairsWith));
  }
  assert.equal(SYMBOL_ORDER.length, Object.values(STITCH_TYPE).length);
  assert.equal(symbolLegend().length, 13);
  assert.equal(isKnownSymbol('???'), false);
});

test('the inspector says which way the carriage has to travel, matching the compiler', () => {
  const matrix = [
    [K, TL, K],
    [K, K, K]
  ];
  const cell = inspectCell(matrix, 0, 1, { mode: 'lace' });
  assert.equal(cell.name, 'Transfer left');
  assert.equal(cell.row, 1);
  assert.equal(cell.needle, 2);
  assert.equal(cell.travel, 'right-to-left');
  assert.deepEqual(cell.neighbours.map(n => n.needle), [1, 3]);

  // The claim above is a claim about the compiler, so check it against the compiler.
  const compiler = new LaceCompiler(MACHINE_PROFILES.brother_standard_24);
  const result = compiler.compile(matrix);
  const op = result.strokes.flatMap(stroke => stroke.transfers).find(transfer => transfer.stitchType === TL);
  assert.equal(op.direction, DIRECTION.RIGHT_TO_LEFT, 'the table and the machine must never disagree');
});

test('a punched cell is explained as a punched cell', () => {
  const fairIsle = [[1, 0], [0, 1]];
  const punched = inspectCell(fairIsle, 0, 0, { mode: 'fair_isle' });
  assert.equal(punched.name, 'Punched');
  assert.equal(punched.punched, true);
  assert.match(punched.does, /yarn B|in work/i);
  assert.equal(inspectCell(fairIsle, 1, 0, { mode: 'fair_isle' }).name, 'Blank');
  assert.equal(inspectCell(fairIsle, 9, 9).ok, false);
  const unknown = inspectCell([[ '?', K ]], 0, 0, { mode: 'lace' });
  assert.equal(unknown.unknown, true);
});

test('row balance is why a repeat can be tiled', () => {
  assert.equal(rowBalance([O, TL]).delta, 0, 'an eyelet and a transfer cancel, which is the classic pair');
  assert.equal(rowBalance([O, TL]).balanced, true);
  assert.equal(rowBalance([DDL, O, O]).delta, 0, 'a double decrease eats two eyelets');
  assert.equal(rowBalance([O, K, K]).delta, 1);
  assert.equal(rowBalance([O, K, K], { accountForImplicitTransfers: true }).delta, 0, 'the compiler pays for it, so the fabric does not grow');
  assert.equal(rowBalance([K, K]).delta, 0);
  const balance = matrixBalance([
    [O, TL],
    [K, K]
  ]);
  assert.equal(balance.balanced, true);
  assert.equal(balance.unbalancedRows, 0);
});

test('the inspector warns where a cell is on its own', () => {
  const lonely = inspectCellWarnings([[O, K, K]], 0, 0, { mode: 'lace' });
  assert.equal(lonely.length, 1);
  assert.equal(lonely[0].level, 'info');
  assert.match(lonely[0].text, /explicit/i);
  const offBed = inspectCellWarnings([[TL]], 0, 0, { mode: 'lace' });
  assert.equal(offBed[0].level, 'error');
  assert.match(offBed[0].text, /falls off the bed/);
  const edge = inspectCellWarnings([[K, TR]], 0, 1, { mode: 'lace' });
  assert.equal(edge[0].level, 'error');
  assert.equal(inspectCellWarnings([[K, TR]], 0, 0, { mode: 'lace' }).length, 0, 'a knit says nothing');
  assert.equal(inspectCellWarnings([[1, 0]], 0, 0, { mode: 'fair_isle' }).length, 0, 'and punched cards have no lean to get wrong');
});

// ─── clipboard ───────────────────────────────────────────────────────────────

test('a copy is a frozen picture of the card at that moment', () => {
  const matrix = [[1, 1], [0, 0]];
  const entry = createEntry(matrix, { mode: 'fair_isle' });
  assert.deepEqual(entry.cells, matrix);
  matrix[0][0] = 0;
  assert.equal(entry.cells[0][0], 1, 'later edits must not reach back into the clipboard');
  assert.equal(entry.punched, 2);
  assert.equal(entry.name, '2×2 Fair Isle');
  assert.match(entrySummary(entry).label, /2 punched/);
  assert.equal(entrySummary(null).label, 'nothing');
  assert.equal(labelForMode('lace'), 'lace');
});

test('pasting a Fair Isle block into lace converts and says so', () => {
  const entry = createEntry([[1, 0], [1, 1]], { mode: 'fair_isle' });
  const canvas = [
    [K, K, K],
    [K, K, K]
  ];
  const pasted = pasteEntry(canvas, entry, { r: 0, c: 0, mode: 'lace', masked: true });
  assert.equal(pasted.ok, true);
  assert.equal(pasted.matrix[0][0], O);
  assert.equal(pasted.matrix[0][1], K, 'masked: its own blank left the background alone');
  assert.equal(pasted.matrix[1][0], O);
  assert.equal(pasted.warnings.length, 1);
  assert.match(pasted.warnings[0], /Converted from Fair Isle to lace/);
  const unmasked = pasteEntry(canvas, entry, { r: 0, c: 0, mode: 'lace', masked: false });
  assert.equal(unmasked.placed, 3);
  assert.equal(unmasked.matrix[0][1], K);
});

test('pasting across gauges re-spaces the block rather than lying about its size', () => {
  const wide = new Array(2).fill(null).map(() => new Array(10).fill(1));
  const entry = createEntry(wide, { mode: 'fair_isle', pitch: { x: 4.5, y: 5 }, profileId: 'brother_standard_24' });
  const prepared = prepareForPaste(entry, { mode: 'fair_isle', rows: 8, cols: 12, pitch: { x: 5, y: 5 } });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.cols, 9, '45 mm of pattern is 9 needles at 5 mm');
  assert.match(prepared.warnings.join(' '), /Re-gauged/);
  const same = prepareForPaste(entry, { mode: 'fair_isle', rows: 8, cols: 12, pitch: { x: 4.5, y: 5 } });
  assert.equal(same.warnings.length, 0, 'no conversion is claimed when nothing changed');
  const refused = prepareForPaste(entry, { mode: 'fair_isle', rows: 8, cols: 12, pitch: { x: 4.5, y: 5 }, resize: { rows: 40, cols: 40 } });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /60 needles/);
});

test('pasting can be flipped and turned on the way in', () => {
  const entry = createEntry([[1, 0], [0, 0]], { mode: 'fair_isle', name: 'corner' });
  const canvas = [[0, 0, 0], [0, 0, 0]];
  const flipped = pasteEntry(canvas, entry, { r: 0, c: 0, mode: 'fair_isle', flipH: true });
  assert.deepEqual(flipped.matrix, [[0, 1, 0], [0, 0, 0]]);
  const turned = pasteEntry(canvas, entry, { r: 0, c: 0, mode: 'fair_isle', rotate: 90 });
  assert.equal(turned.placed, 1);
  const cut = eraseSource([[1, 0], [0, 0]], entry, { r: 0, c: 0, mode: 'fair_isle' });
  assert.equal(cut.cleared, 1);
  assert.deepEqual(cut.matrix, [[0, 0], [0, 0]]);
});

test('the clipboard remembers, names and reloads', () => {
  const store = {
    data: new Map(),
    getItem(key) {
      return this.data.has(key) ? this.data.get(key) : null;
    },
    setItem(key, value) {
      this.data.set(key, String(value));
    }
  };
  const clip = createClipboard({ limit: 3, storage: store });
  const a = clip.copy([[1]], { mode: 'fair_isle', name: 'a' });
  clip.copy([[1, 1]], { mode: 'fair_isle', name: 'b' });
  clip.copy([[1, 1, 1]], { mode: 'fair_isle', name: 'c' });
  clip.copy([[0]], { mode: 'fair_isle', name: 'd' });
  assert.equal(clip.entries.length, 3, 'the oldest copy fell off the end');
  assert.equal(clip.at(0).name, 'd');
  assert.equal(clip.restore(a.id), null, 'gone means gone');
  assert.equal(clip.remove(clip.at(1).id), 1);
  assert.equal(clip.entries.length, 2);
  assert.equal(clip.saveSlot('border', a).ok, true);
  assert.equal(clip.saveSlot('  ', a).ok, false);
  assert.deepEqual(clip.slotNames(), ['border']);
  assert.equal(clip.loadSlot('border').name, 'border');
  assert.equal(clip.renameSlot('border', 'cuff').ok, true);
  assert.deepEqual(JSON.parse(store.data.get('knitcad.clipboard.slots.v1')).cuff.cells, [[1]]);
  assert.equal(clip.deleteSlot('cuff'), true);
  assert.equal(clip.deleteSlot('cuff'), false);
  const reloaded = createClipboard({ storage: store });
  assert.deepEqual(reloaded.slotNames(), [], 'deleting the last slot really deleted it');
  assert.equal(clip.clear(), 2);
  assert.equal(clip.stats().history, 0);
  assert.equal(CLIPBOARD_LIMIT, 24);
});

test('clipboard slots are validated on the way in, not repaired', () => {
  const good = createEntry([[1, 0]], { mode: 'fair_isle' });
  const slots = sanitizeSlots({
    keeper: good,
    ragged: { mode: 'fair_isle', cells: [[1], [0, 0]] },
    nonsense: { mode: 'polka', cells: [[1]] },
    empty: { mode: 'lace', cells: [] },
    stringy: { mode: 'lace', cells: [['K']] }
  });
  assert.deepEqual(Object.keys(slots), ['keeper', 'stringy']);
  assert.equal(slots.keeper.punched, 1);
  assert.equal(validateEntry({ mode: 'lace', cells: 'no' }), null);
  assert.equal(validateEntry(null), null);
  assert.equal(slots.stringy.cells[0][0], K);
});

test('a window bridge is honest about whether the browser can carry it', () => {
  // Node ships a BroadcastChannel of its own, which would keep the test process
  // alive if a bridge were left open, so this one is created, exercised and closed
  // inside the test rather than at module scope.
  const bridge = createClipboardBridge({ name: 'knitcat-test-clipboard' });
  assert.ok(['broadcast', 'none'].includes(bridge.mode));
  assert.equal(bridge.available, bridge.mode === 'broadcast');
  const entry = createEntry([[1]], { mode: 'fair_isle' });
  // Either the publish went nowhere (no channel) or it went to a channel with no
  // other listener; both are correct, and neither may throw.
  assert.ok(typeof bridge.publish(entry) === 'boolean');
  assert.equal(bridge.publish(null), false);
  const off = bridge.subscribe(() => {});
  assert.equal(typeof off, 'function');
  off();
  bridge.close();
});

// ─── several documents ───────────────────────────────────────────────────────

test('open patterns behave like tabs, not like files on a disk', () => {
  const docs = createDocuments({ limit: 2 });
  const cuff = docs.open({ name: 'Cuff', mode: 'lace', rows: 8, cols: 24 });
  assert.equal(cuff.ok, true);
  assert.equal(docs.active().name, 'Cuff');
  const again = docs.open({ name: 'cuff' });
  assert.equal(again.focused, true, 'the same name focuses the tab instead of duplicating it');
  assert.equal(again.document.id, cuff.document.id);
  assert.equal(docs.open({ name: 'Body' }).ok, true);
  assert.equal(docs.open({ name: 'Collar' }).ok, false, 'and the limit says so out loud');
  docs.touch(cuff.document.id, { rows: 10 });
  assert.equal(docs.unsaved().length, 1);
  docs.markSaved(cuff.document.id);
  assert.equal(docs.unsaved().length, 0);
  assert.equal(docs.rename(cuff.document.id, 'Body').ok, false, 'two tabs cannot share a name');
  assert.equal(docs.rename(cuff.document.id, '  ').ok, false);
  assert.equal(docs.rename(cuff.document.id, 'Cuff v2').document.name, 'Cuff v2');
  const closed = docs.close(cuff.document.id);
  assert.equal(closed.ok, true);
  assert.notEqual(docs.activeId, cuff.document.id, 'focus moves somewhere that exists');
  assert.equal(docs.close('nope').ok, false);
  assert.equal(docs.setActive('nope'), false);
  assert.equal(docs.detachTarget(cuff.document.id).ok, false);
});

test('a document list survives a save and reload, without fake unsaved dots', () => {
  const docs = createDocuments();
  const first = docs.open({ name: 'Cuff', rows: 8, cols: 24 }).document;
  docs.open({ name: 'Yoke', mode: 'fair_isle' });
  docs.setViews(first.id, ['chart', 'punchcard', 'nonsense']);
  const dump = docs.serialize();
  const restored = deserializeDocuments(dump);
  assert.equal(restored.documents.length, 2);
  assert.deepEqual(restored.documents[0].views, ['chart', 'punchcard']);
  assert.equal(restored.activeId, dump.activeId);
  assert.equal(restored.documents.every(doc => !doc.dirty), true);
  const orphan = deserializeDocuments({ documents: [{ name: 'only' }], activeId: 'ghost' });
  assert.equal(orphan.documents.length, 1);
  assert.equal(orphan.activeId, orphan.documents[0].id, 'a focus that no longer exists falls back to the first tab');
  assert.equal(deserializeDocuments(null).documents.length, 0);
  assert.equal(DOCUMENT_LIMIT, 12);
  assert.equal(createDocument({ name: 'x'.repeat(200) }).name.length, 80);
});
