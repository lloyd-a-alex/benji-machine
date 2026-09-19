// Chart surgery and selection sets: the arithmetic behind the editor's tools.
//
// These are the operations that eat a pattern if they are wrong — insert a row in
// the middle of a lace repeat, mirror a transfer the wrong way, smear a selection
// on an arrow-key nudge — so they are asserted here rather than clicked around in
// a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellKey, parseCellKey, clipKeys, rectKeys, rectFromKeys, normalizeRect, clampRect, rectSize,
  expandKeys, contractKeys, invertKeys, featherKeys, keysUnion, keysSubtract, keysIntersect,
  floodRegion, selectByValue, selectWhere, toggleKeys, wholeGridKeys,
  pointInPolygon, polygonKeys, lineCells, rectOutlineCells, ellipseCells, bezierCells, splineCells,
  regionsFromKeys, alignOffsets, distributeOffsets, snapValue, moveKeysBy, maxMove, cellsToKeys
} from '../js/edit/select-ops.js';
import {
  makeMatrix, matrixInfo, setCell, setCells, getCell, parseCellAddress, formatCellAddress,
  insertRows, deleteRows, insertColumns, deleteColumns, reverseRow, reverseColumn,
  swapRows, swapColumns, moveRow, moveColumn, copyRow, copyColumn, pasteRow, interleaveRows,
  transformMatrix, mirrorValue, flipRegion, invertRegion, invertCells,
  paintCells, eraseCells, moveContent, makeMotif, transformMotif, stampMotif, pasteCells,
  softenRegion, smudgePath, convertRegion, resampleMatrix, regaugeMatrix, stitchesForWidth
} from '../js/edit/chart-ops.js';
import {
  isDirectMode, blankValue, isPunched, convertCellBetweenModes, convertMatrixBetweenModes,
  convertRegionBetweenModes, describeCellValue
} from '../js/edit/modes.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';

const grid = (rows, cols, fill = 0) => Array.from({ length: rows }, () => new Array(cols).fill(fill));

// ─── selection keys ──────────────────────────────────────────────────────────

test('cell keys round-trip and clip to the card', () => {
  assert.equal(cellKey(4, 12), '4,12');
  assert.deepEqual(parseCellKey('4,12'), { r: 4, c: 12 });
  const keys = new Set(['0,0', '1,1', '2,2', '-1,0', '0,9']);
  assert.deepEqual([...clipKeys(keys, 2, 2)], ['0,0', '1,1']);
  assert.deepEqual([...cellsToKeys([{ r: 1, c: 2 }, [3, 4]])], ['1,2', '3,4']);
});

test('a marquee survives either drag direction', () => {
  assert.deepEqual(normalizeRect({ r1: 5, c1: 3, r2: 1, c2: 9 }), { r1: 1, r2: 5, c1: 3, c2: 9 });
  assert.deepEqual(clampRect({ r1: -4, c1: 2, r2: 99, c2: 4 }, 10, 6), { r1: 0, r2: 9, c1: 2, c2: 4 });
  assert.equal(clampRect({ r1: 20, c1: 2, r2: 30, c2: 4 }, 10, 6), null, 'off the card entirely');
  assert.equal(rectSize(clampRect({ r1: 0, c1: 0, r2: 2, c2: 3 }, 9, 9)).cells, 12);
  assert.equal(rectKeys({ r1: 0, c1: 0, r2: 1, c2: 1 }).size, 4);
  assert.deepEqual(rectFromKeys(new Set(['2,5', '0,1'])), { r1: 0, r2: 2, c1: 1, c2: 5 });
  assert.equal(rectFromKeys(new Set()), null);
});

test('expand adds one ring, contract strips one, invert completes them', () => {
  const middle = rectKeys({ r1: 2, c1: 2, r2: 3, c2: 3 });
  // A 4-way grow reaches the four edge neighbours of each cell, so the corners of
  // the enclosing 4×4 stay out — that is the whole difference between "expand" and
  // "grow the bounding box", and it is why the connectivity is a parameter.
  assert.equal(expandKeys(middle, { rows: 10, cols: 10 }).size, 12);
  assert.equal(expandKeys(middle, { rows: 10, cols: 10, connectivity: 8 }).size, 16);
  assert.equal(expandKeys(middle, { rows: 10, cols: 10, passes: 2 }).size, 24, 'two 4-way passes are a Manhattan disc of radius 2');
  assert.deepEqual(
    [...expandKeys(rectKeys({ r1: 0, c1: 0, r2: 1, c2: 1 }), { rows: 2, cols: 2 })].sort(),
    ['0,0', '0,1', '1,0', '1,1'],
    'the card edge stops the ring'
  );
  assert.deepEqual([...contractKeys(middle, { rows: 10, cols: 10 })], [], 'a 2×2 has no interior');
  const block = rectKeys({ r1: 0, c1: 0, r2: 2, c2: 2 });
  assert.deepEqual([...contractKeys(block, { rows: 5, cols: 5 })], ['1,1']);
  const inverted = invertKeys(block, { rows: 3, cols: 3 });
  assert.equal(inverted.size, 0);
  assert.deepEqual([...keysIntersect(block, inverted)], [], 'a selection and its inversion never touch');
  assert.equal(keysUnion(block, inverted).size, 9);
  assert.equal(keysSubtract(block, inverted).size, 9);
});

test('feathering dithers the new ring instead of faking transparency', () => {
  const core = rectKeys({ r1: 2, c1: 2, r2: 4, c2: 4 });
  const once = featherKeys(core, { rows: 8, cols: 8 });
  assert.equal(once.added.size > 0, true);
  assert.equal(once.added.size < expandKeys(core, { rows: 8, cols: 8 }).size - core.size, true, 'fewer than a full ring');
  for (const key of once.added) {
    const { r, c } = parseCellKey(key);
    assert.equal((r + c) % 2, 0, `${key} must sit on the fixed parity so a repaint cannot crackle`);
  }
  const again = featherKeys(core, { rows: 8, cols: 8 });
  assert.deepEqual([...again.keys], [...once.keys], 'deterministic');
});

test('the wand picks a region, and refuses to pick the whole card by accident', () => {
  const matrix = [
    [1, 1, 0, 0],
    [1, 1, 0, 1],
    [0, 0, 0, 1]
  ];
  assert.equal(floodRegion(matrix, 0, 0).size, 4);
  assert.equal(floodRegion(matrix, 1, 3).size, 2, 'the isolated column of ones');
  const eightWay = floodRegion(matrix, 1, 3, { connectivity: 8 });
  assert.equal(eightWay.keys.has('0,2'), false, 'a diagonal blank still separates them');
  assert.equal(floodRegion(matrix, 1, 2, { match: 'punched', blank: 0 }).size, 6, 'a blank seed collects the blank region');
  const punched = floodRegion(matrix, 0, 0, { match: 'punched', blank: 0 });
  assert.equal(punched.size, 4);
  const capped = floodRegion(matrix, 0, 0, { limit: 2 });
  assert.equal(capped.capped, true);
  assert.equal(capped.size, 0, 'a capped selection must not be applied at all');
  assert.equal(capped.attempted, 3, 'but the warning can still say how big it was getting');
  assert.equal(floodRegion(matrix, 0, 0, { limit: 0 }).size, 0, 'a limit of zero is not "the seed only"');
  assert.equal(floodRegion(matrix, 9, 9).size, 0, 'off the card');

  const lace = [
    [STITCH_TYPE.KNIT, STITCH_TYPE.EYELET],
    [STITCH_TYPE.TRANSFER_LEFT, STITCH_TYPE.EYELET]
  ];
  assert.equal(selectByValue(lace, STITCH_TYPE.EYELET).size, 2);
  assert.equal(selectWhere(lace, v => v !== STITCH_TYPE.KNIT).size, 3);
  assert.equal(selectWhere(lace, v => v !== STITCH_TYPE.KNIT, { within: new Set(['0,1']) }).size, 1);
  const start = rectKeys({ r1: 0, c1: 0, r2: 1, c2: 1 });
  assert.deepEqual([...toggleKeys(start, new Set(['0,1'])).keys], ['0,0', '1,0', '1,1'], 'shift-click something already selected and it leaves');
  assert.equal(toggleKeys(start, new Set(['0,1'])).mode, 'removed');
  assert.equal(toggleKeys(start, new Set(['2,2'])).mode, 'added');
  const half = toggleKeys(start, new Set(['0,1', '2,2']));
  assert.deepEqual([...half.keys], ['0,0', '1,0', '1,1', '2,2'], 'a half-overlapping toggle is a symmetric difference, not a subtraction');
  assert.deepEqual([half.added, half.removed], [1, 1]);
  assert.equal(toggleKeys(start, new Set(['9,9']), { rows: 4, cols: 4 }).added, 0, 'off the card');
});

test('a lasso selects by cell centre', () => {
  assert.equal(pointInPolygon(1, 1, [[0, 0], [4, 0], [4, 4], [0, 4]]), true);
  assert.equal(pointInPolygon(5, 1, [[0, 0], [4, 0], [4, 4], [0, 4]]), false);
  const square = [{ r: 0, c: 0 }, { r: 0, c: 6 }, { r: 6, c: 6 }, { r: 6, c: 0 }];
  const inside = polygonKeys(square, { rows: 10, cols: 10 });
  assert.ok(inside.has(cellKey(3, 3)));
  assert.equal(inside.has(cellKey(9, 9)), false, 'the box is bounded by the lasso, not the card');
  assert.equal(polygonKeys([{ r: 0, c: 0 }, { r: 1, c: 1 }], { rows: 5, cols: 5 }).size, 0, 'two points are not a polygon');
});

test('the geometry tools produce one-cell-wide paths', () => {
  assert.ok(lineCells(0, 0, 4, 4).has('4,4'));
  assert.ok(lineCells(0, 0, 4, 4).has('0,0'));
  assert.equal(lineCells(0, 0, 4, 4).size, 5, 'a clean diagonal has no duplicates');
  assert.equal(lineCells(2, 2, 2, 2).size, 1);
  const outline = rectOutlineCells({ r1: 0, c1: 0, r2: 2, c2: 2 });
  assert.equal(outline.size, 8);
  assert.equal(outline.has('1,1'), false, 'an outline must not fill');
  const ring = ellipseCells(0, 0, 0, 4);
  assert.equal(ring.has('0,2'), false, 'the middle of a flat ellipse is not its edge');
  assert.equal(ellipseCells(0, 0, 0, 4, { filled: true }).has('0,2'), true);
  const disc = ellipseCells(0, 0, 4, 4, { filled: true });
  assert.ok(disc.size >= 12 && disc.size <= 25, `${disc.size} cells is a plausible disc`);
  assert.ok(disc.has('2,2') && !disc.has('0,0'), 'full in the middle, empty in the corners');
});

test('curves reach their endpoints and pass through their points', () => {
  const curve = bezierCells({ r: 0, c: 0 }, { r: 0, c: 5 }, { r: 10, c: 5 }, { r: 10, c: 10 });
  assert.ok(curve.has('0,0') && curve.has('10,10'), 'both ends');
  for (const key of curve) {
    const { r, c } = parseCellKey(key);
    assert.ok(Number.isInteger(r) && Number.isInteger(c), `${key} must be a whole cell`);
  }
  const spline = splineCells([{ r: 0, c: 0 }, { r: 5, c: 5 }, { r: 10, c: 0 }]);
  for (const point of ['0,0', '5,5', '10,0']) assert.ok(spline.has(point), `${point} was skipped`);
  assert.equal(splineCells([{ r: 1, c: 2 }]).size, 1, 'a single click is a single cell');
});

test('regions, alignment and distribution do the arithmetic a CAD user expects', () => {
  const keys = keysUnion(rectKeys({ r1: 0, c1: 0, r2: 1, c2: 1 }), rectKeys({ r1: 5, c1: 6, r2: 6, c2: 7 }));
  const regions = regionsFromKeys(keys);
  assert.equal(regions.length, 2);
  assert.equal(regions[0].bounds.c1, 0);
  assert.equal(regions[1].bounds.r1, 5);
  assert.equal(regionsFromKeys(new Set()).length, 0);

  const boxes = [
    { r1: 0, r2: 2, c1: 0, c2: 1 },
    { r1: 4, r2: 5, c1: 4, c2: 9 },
    { r1: 8, r2: 8, c1: 2, c2: 2 }
  ];
  assert.deepEqual(alignOffsets(boxes, 'min-col'), [{ dr: 0, dc: 0 }, { dr: 0, dc: -4 }, { dr: 0, dc: -2 }]);
  assert.deepEqual(alignOffsets(boxes, 'max-col'), [{ dr: 0, dc: 8 }, { dr: 0, dc: 0 }, { dr: 0, dc: 7 }]);
  assert.deepEqual(alignOffsets(boxes, 'min-row'), [{ dr: 0, dc: 0 }, { dr: -4, dc: 0 }, { dr: -8, dc: 0 }]);
  const centred = alignOffsets(boxes, 'centre-col');
  assert.equal(centred[0].dc, 4, 'the overall span is 0..9, so the centre line is 4.5');
  assert.deepEqual(alignOffsets([boxes[0]], 'min-col'), [{ dr: 0, dc: 0 }], 'one region cannot align');
  assert.deepEqual(alignOffsets(boxes, 'nonsense'), [{ dr: 0, dc: 0 }, { dr: 0, dc: 0 }, { dr: 0, dc: 0 }]);

  const spaced = [
    { r1: 0, r2: 0, c1: 0, c2: 1 },
    { r1: 0, r2: 0, c1: 4, c2: 4 },
    { r1: 0, r2: 0, c1: 10, c2: 11 }
  ];
  const moved = distributeOffsets(spaced, 'h');
  assert.deepEqual([moved[0].dc, moved[2].dc], [0, 0], 'the outer ones hold still');
  const second = spaced[1].c1 + moved[1].dc;
  const secondEnd = second + (spaced[1].c2 - spaced[1].c1);
  const gapA = second - spaced[0].c2 - 1;
  const gapB = spaced[2].c1 - secondEnd - 1;
  assert.ok(Math.abs(gapA - gapB) <= 1, `gaps ${gapA} and ${gapB} should be even`);
  assert.equal(gapA + gapB, 7, 'all the free space went into the two gaps');
  assert.equal(distributeOffsets(spaced.slice(0, 2), 'h').every(d => !d.dr && !d.dc), true);

  assert.deepEqual(snapValue(4.2, [4, 5], { threshold: 0.5 }), { value: 4, snapped: true, guide: 4 });
  assert.equal(snapValue(4.9, [4], { threshold: 0.5 }).snapped, false);
  assert.equal(snapValue(0.2, [{ at: 0 }, { at: 1 }], { threshold: 0.5 }).guide, 0);
});

test('a selection slides but never off the edge in silence', () => {
  const keys = rectKeys({ r1: 0, c1: 0, r2: 0, c2: 2 });
  assert.deepEqual([...moveKeysBy(keys, 2, 1)], ['2,1', '2,2', '2,3']);
  assert.equal(maxMove(keys, { rows: 3, cols: 3 }, 0, 1), 0, 'needle 3 is already on the last needle');
  assert.equal(maxMove(keys, { rows: 3, cols: 10 }, 0, 1), 7);
  assert.equal(maxMove(wholeGridKeys(4, 4), { rows: 4, cols: 4 }, 1, 0), 0);
});

// ─── chart surgery ───────────────────────────────────────────────────────────

test('a fresh card is blank in the right alphabet for its mode', () => {
  assert.equal(blankValue('lace'), STITCH_TYPE.KNIT);
  assert.equal(blankValue('fair_isle'), 0);
  const lace = makeMatrix(2, 3, { mode: 'lace' });
  assert.deepEqual(lace, [['K', 'K', 'K'], ['K', 'K', 'K']]);
  assert.deepEqual(matrixInfo(['abc', 'ab']), { rows: 2, cols: 3, ragged: 1 });
  assert.equal(matrixInfo([]).cols, 0);
});

test('typing a cell address accepts the ways people write them', () => {
  const want = { ok: true, r: 3, c: 11, row: 4, col: 12 };
  for (const text of ['4,12', 'row 4, col 12', 'needle 12, row 4', 'r4c12', 'Row 4 Needle 12']) {
    assert.deepEqual(parseCellAddress(text), want, text);
  }
  assert.deepEqual(parseCellAddress('col 3 row 5'), { ok: true, r: 4, c: 2, row: 5, col: 3 });
  assert.equal(parseCellAddress('4').ok, false);
  assert.equal(parseCellAddress('row four col twelve').ok, false);
  assert.equal(parseCellAddress('').ok, false);
  assert.equal(parseCellAddress('0,5').ok, false, 'counting from zero is a silent off-by-one');
  assert.deepEqual(formatCellAddress(3, 11), { label: 'row 4 · needle 12', r1: 4, c1: 12 });
});

test('one cell changes, nothing else does, and history is not corrupted', () => {
  const before = grid(3, 3, 0);
  const written = setCell(before, 1, 1, 1);
  assert.equal(written.ok, true);
  assert.equal(before[1][1], 0, 'the caller’s matrix is never mutated');
  assert.equal(written.matrix[1][1], 1);
  assert.equal(setCell(before, 9, 0, 1).ok, false);
  assert.equal(setCell(before, -1, 0, 1).ok, false);
  assert.equal(getCell(before, 5, 0), undefined);
  const many = setCells(before, [{ r: 0, c: 0, value: 1 }, { r: 9, c: 9, value: 1 }]);
  assert.equal(many.changed, 1);
  assert.deepEqual(many.skipped, ['9,9']);
});

test('inserting and deleting rows and columns keeps the card rectangular', () => {
  const base = [
    [1, 2, 3],
    [4, 5, 6]
  ];
  const rows = insertRows(base, 1, 2, { mode: 'fair_isle' });
  assert.deepEqual(rows.matrix, [[1, 2, 3], [0, 0, 0], [0, 0, 0], [4, 5, 6]]);
  assert.deepEqual(rows.inserted, [1, 2]);
  assert.deepEqual(deleteRows(rows.matrix, 1, 1).matrix, [[1, 2, 3], [0, 0, 0], [4, 5, 6]]);
  const cols = insertColumns(base, 0, 1, { mode: 'lace' });
  assert.deepEqual(cols.matrix, [['K', 1, 2, 3], ['K', 4, 5, 6]]);
  assert.deepEqual(deleteColumns(cols.matrix, 0, 1).matrix, base, 'deleting the inserted column is the identity');
  assert.deepEqual(deleteColumns(cols.matrix, 2, 1).matrix, [['K', 1, 3], ['K', 4, 6]]);
  assert.deepEqual(insertRows(base, 99, 1, { mode: 'fair_isle' }).matrix[2], [0, 0, 0], 'clamped to the bottom');
  const capped = insertRows(base, 0, 50, { mode: 'fair_isle', maxRows: 20 });
  assert.equal(capped.ok, false);
  assert.deepEqual(capped.oversize, { rows: 52, cols: 3, maxRows: 20, maxCols: Infinity });
});

test('reversing a row mirrors the leans; reversing a column must not', () => {
  const lace = [
    [STITCH_TYPE.TRANSFER_LEFT, STITCH_TYPE.EYELET, STITCH_TYPE.KNIT],
    [STITCH_TYPE.EYELET, STITCH_TYPE.EYELET, STITCH_TYPE.EYELET]
  ];
  // Exactly what `flipHorizontal` does to one row: needle 0 takes the mirrored
  // value that was on the last needle, because the loop still has to reach the
  // same neighbour once the needles are read the other way round.
  const row = reverseRow(lace, 0, { mode: 'lace' });
  assert.deepEqual(row.matrix[0], [STITCH_TYPE.KNIT, STITCH_TYPE.EYELET, STITCH_TYPE.TRANSFER_RIGHT]);
  const column = reverseColumn(lace, 0, { mode: 'lace' });
  assert.equal(column.matrix[0][0], STITCH_TYPE.EYELET);
  assert.equal(column.matrix[1][0], STITCH_TYPE.TRANSFER_LEFT, 'a transfer still leaves the same neighbouring needle');
  assert.equal(reverseRow(lace, 9).ok, false);
  assert.equal(reverseColumn(lace, 9).ok, false);
});

test('rows and columns can be swapped and slid past each other', () => {
  const base = [[1, 2], [3, 4], [5, 6]];
  assert.deepEqual(swapRows(base, 0, 2).matrix, [[5, 6], [3, 4], [1, 2]]);
  assert.deepEqual(swapColumns(base, 0, 1).matrix, [[2, 1], [4, 3], [6, 5]]);
  assert.equal(swapRows(base, 1, 1).swapped, false);
  assert.equal(swapRows(base, 0, 9).ok, false);
  assert.deepEqual(moveRow(base, 0, 2).matrix, [[3, 4], [5, 6], [1, 2]]);
  assert.deepEqual(moveColumn(base, 1, 0).matrix, [[2, 1], [4, 3], [6, 5]]);
});

test('a row can be copied and put back over or beside its neighbour', () => {
  const base = [[1, 2, 3], [4, 5, 6]];
  const captured = copyRow(base, 1);
  assert.deepEqual(captured.cells, [4, 5, 6]);
  assert.deepEqual(pasteRow(base, 0, captured.cells, { mode: 'fair_isle' }).matrix, [[4, 5, 6], [4, 5, 6]]);
  const inserted = pasteRow(base, 1, captured.cells, { op: 'insert', mode: 'fair_isle' });
  assert.deepEqual(inserted.matrix, [[1, 2, 3], [4, 5, 6], [4, 5, 6]]);
  assert.equal(pasteRow(base, 0, [9, 9, 9, 9, 9], { mode: 'fair_isle' }).trimmed, true, 'wider than the bed is a warning');
  assert.deepEqual(copyColumn(base, 1).cells, [2, 5]);
});

test('interleave weaves an overlay repeat into a plain body', () => {
  const base = grid(4, 3, 0);
  const overlay = [[1, 0, 1]];
  const woven = interleaveRows(base, overlay, { every: 2, mode: 'fair_isle' });
  assert.deepEqual(woven.inserted, [2, 5]);
  assert.equal(woven.matrix.length, 6);
  assert.deepEqual(woven.matrix[2], [1, 0, 1]);
  assert.deepEqual(woven.matrix[5], [1, 0, 1]);
  assert.equal(interleaveRows(base, [], { mode: 'fair_isle' }).ok, false);
  const twoRow = interleaveRows(base, [[1, 1, 1], [0, 1, 0]], { every: 1, mode: 'fair_isle' });
  assert.deepEqual(twoRow.matrix[3], [0, 1, 0], 'the overlay cycles like a real repeat');
});

test('whole-card transforms mirror the directional glyphs exactly when the needles move', () => {
  const lace = [
    [STITCH_TYPE.TRANSFER_LEFT, STITCH_TYPE.KNIT, STITCH_TYPE.DOUBLE_DEC_LEFT],
    [STITCH_TYPE.EYELET, STITCH_TYPE.CENTER_DEC, STITCH_TYPE.TRANSFER_RIGHT]
  ];
  const flat = transformMatrix(lace, 'flipH', { mode: 'lace' });
  // Needle 0 inherits the mirrored value that was on the last needle.
  assert.deepEqual(flat.matrix[0], [STITCH_TYPE.DOUBLE_DEC_RIGHT, STITCH_TYPE.KNIT, STITCH_TYPE.TRANSFER_RIGHT]);
  assert.equal(flat.matrix[1][0], STITCH_TYPE.TRANSFER_LEFT, 'rightmost needle becomes leftmost, keeping its lean');
  const updown = transformMatrix(lace, 'flipV', { mode: 'lace' });
  assert.deepEqual(updown.matrix[0], lace[1], 'rows swap');
  assert.equal(updown.matrix[0][2], STITCH_TYPE.TRANSFER_RIGHT, 'and no lean changes: needles did not move');
  assert.equal(mirrorValue(STITCH_TYPE.DOUBLE_DEC_LEFT, 'flipV'), STITCH_TYPE.DOUBLE_DEC_LEFT, 'a vertical turn over swaps no needles');
  assert.equal(mirrorValue(STITCH_TYPE.TRANSFER_DOUBLE_L, 'flipH'), STITCH_TYPE.TRANSFER_DOUBLE_R);
  assert.deepEqual(transformMatrix(transformMatrix(lace, 'flipH', { mode: 'lace' }).matrix, 'flipH', { mode: 'lace' }).matrix, lace, 'two mirror flips are the identity');
  const turned = transformMatrix(lace, 'rot180', { mode: 'lace' });
  const composed = transformMatrix(updown.matrix, 'flipH', { mode: 'lace' });
  assert.deepEqual(turned.matrix, composed.matrix, 'rot180 is exactly flip then mirror');
  assert.equal(turned.matrix[0][0], STITCH_TYPE.TRANSFER_LEFT, 'the bottom-right transfer arrives top-left, mirrored');
});

test('a quarter turn is allowed and honestly labelled', () => {
  const square = [[1, 2], [3, 4]];
  const cw = transformMatrix(square, 'rot90cw');
  assert.deepEqual(cw.matrix, [[3, 1], [4, 2]]);
  const ccw = transformMatrix(square, 'rot90ccw');
  assert.deepEqual(ccw.matrix, [[2, 4], [1, 3]]);
  assert.deepEqual(transformMatrix(ccw.matrix, 'rot90cw').matrix, square, 'cw after ccw is home');
  const lace = transformMatrix([[STITCH_TYPE.TRANSFER_LEFT, STITCH_TYPE.KNIT]], 'rot90cw', { mode: 'lace' });
  assert.equal(lace.warnings.length, 1);
  assert.match(lace.warnings[0], /sideways/i);
});

test('transpose swaps needles and rows and mirrors the lean', () => {
  const base = [
    [1, 2, 3],
    [4, 5, 6]
  ];
  const spun = transformMatrix(base, 'transpose');
  assert.deepEqual(spun.matrix, [[1, 4], [2, 5], [3, 6]]);
  assert.deepEqual(transformMatrix(spun.matrix, 'transpose').matrix, base, 'a transpose is its own inverse');
  const anti = transformMatrix(base, 'antitranspose');
  assert.deepEqual(anti.matrix, [[6, 3], [5, 2], [4, 1]]);
  const lace = transformMatrix([[STITCH_TYPE.TRANSFER_LEFT, STITCH_TYPE.KNIT]], 'transpose', { mode: 'lace' });
  assert.equal(lace.matrix[0][0], STITCH_TYPE.TRANSFER_RIGHT, 'a diagonal reflection turns \\ into /');
});

test('a region flips inside the marquee and stays put outside it', () => {
  const base = [
    [1, 2, 9],
    [3, 4, 9]
  ];
  const flipped = flipRegion(base, { r1: 0, c1: 0, r2: 1, c2: 1 }, 'h', { mode: 'fair_isle' });
  assert.deepEqual(flipped.matrix, [[2, 1, 9], [4, 3, 9]]);
  assert.deepEqual(flipRegion(base, { r1: 0, c1: 0, r2: 1, c2: 1 }, 'v', { mode: 'fair_isle' }).matrix, [[3, 4, 9], [1, 2, 9]]);
  assert.equal(flipRegion(base, null, 'h').ok, false);
  const clipped = flipRegion(base, { r1: 0, c1: 0, r2: 9, c2: 9 }, 'h', { mode: 'fair_isle' });
  assert.deepEqual(clipped.matrix, [[9, 2, 1], [9, 4, 3]], 'a marquee bigger than the card is the whole card, so the guard column crosses over too');
});

test('invert works on the punchcard reading, not on JavaScript truthiness', () => {
  const lace = [
    [STITCH_TYPE.KNIT, STITCH_TYPE.EYELET],
    [STITCH_TYPE.TRANSFER_LEFT, STITCH_TYPE.PURL]
  ];
  const inverted = invertRegion(lace, null, { mode: 'lace' });
  assert.deepEqual(inverted.matrix, [[STITCH_TYPE.EYELET, STITCH_TYPE.KNIT], [STITCH_TYPE.KNIT, STITCH_TYPE.EYELET]]);
  assert.deepEqual(invertRegion(inverted.matrix, null, { mode: 'lace' }).matrix, [
    [STITCH_TYPE.KNIT, STITCH_TYPE.EYELET],
    [STITCH_TYPE.EYELET, STITCH_TYPE.KNIT]
  ], 'twice is not the identity for lace — the transfer collapsed to an eyelet, which is why the label says punched↔plain');
  const numeric = grid(2, 2, 1);
  assert.deepEqual(invertCells(numeric, new Set(['0,0']), { mode: 'fair_isle' }).matrix, [[0, 1], [1, 1]]);
  assert.equal(invertRegion(grid(2, 2, 0), { r1: 0, c1: 0, r2: 0, c2: 1 }, { mode: 'fair_isle' }).changed, 2);
});

test('painting reports what it had to skip', () => {
  const base = grid(3, 3, 0);
  const painted = paintCells(base, new Set(['0,0', '1,1', '9,9']), 1);
  assert.equal(painted.changed, 2);
  assert.equal(painted.skipped, 1);
  const gradient = paintCells(base, rectKeys({ r1: 0, c1: 0, r2: 1, c2: 1 }), (r, c) => r + c);
  assert.equal(gradient.matrix[1][1], 2);
  assert.equal(eraseCells(painted.matrix, new Set(['0,0']), { mode: 'fair_isle' }).matrix[0][0], 0);
  const onlyHoles = paintCells(gradient.matrix, rectKeys({ r1: 0, c1: 0, r2: 1, c2: 1 }), 5, { only: v => v === 0 });
  assert.equal(onlyHoles.changed, 1, 'only the untouched cells take the new value');
});

test('moving a selection cannot smear it or push it off the bed quietly', () => {
  const base = [[1, 0, 0, 0]];
  const keys = wholeGridKeys(1, 4);
  const moved = moveContent(base, keys, 0, 1, { mode: 'fair_isle' });
  assert.deepEqual(moved.matrix, [[0, 1, 0, 0]]);
  assert.equal(moved.blocked, 1);
  const wrapped = moveContent(base, keys, 0, 1, { mode: 'fair_isle', wrap: true });
  assert.deepEqual(wrapped.matrix, [[0, 1, 0, 0]]);
  assert.equal(wrapped.blocked, 0);
  const backwards = moveContent(wrapped.matrix, wholeGridKeys(1, 4), 0, -1, { mode: 'fair_isle', wrap: true });
  assert.deepEqual(backwards.matrix, [[1, 0, 0, 0]], 'and back again');
  const half = moveContent(base, new Set(['0,0']), 0, 1, { mode: 'fair_isle' });
  assert.deepEqual(half.matrix, [[0, 1, 0, 0]], 'a single cell move leaves its origin blank');
});

test('motifs survive capture, transform and stamping', () => {
  const base = [
    [1, 0, 0],
    [1, 1, 0]
  ];
  const motif = makeMotif(base, { r1: 0, c1: 0, r2: 1, c2: 1 }, { mode: 'fair_isle', name: 'corner' });
  assert.deepEqual(motif.cells, [[1, 0], [1, 1]]);
  assert.equal(motif.punched, 3);
  assert.deepEqual(transformMotif(motif, { rotate: 90 }).cells, [[1, 1], [1, 0]]);
  assert.deepEqual(transformMotif(motif, { flipH: true }).cells, [[0, 1], [1, 1]]);
  assert.deepEqual(transformMotif(motif, { flipV: true }).cells, [[1, 1], [1, 0]]);
  assert.deepEqual(transformMotif(motif, { rotate: 360 }).cells, motif.cells);

  const canvas = [
    [0, 1, 0],
    [0, 0, 0]
  ];
  const masked = stampMotif(canvas, motif, { r: 0, c: 0, mode: 'fair_isle', masked: true });
  assert.deepEqual(masked.matrix, [[1, 1, 0], [1, 1, 0]]);
  assert.equal(masked.placed, 3, 'the three punched cells were written; the motif’s blank left the background hole alone');
  const replaced = stampMotif(canvas, motif, { r: 0, c: 0, mode: 'fair_isle', masked: false });
  assert.deepEqual(replaced.matrix, [[1, 0, 0], [1, 1, 0]]);
  const off = stampMotif(canvas, motif, { r: 1, c: 1, mode: 'fair_isle' });
  assert.equal(off.clipped, 2, 'the motif\'s second row falls off the bottom of the card');
  assert.equal(pasteCells(canvas, [[7]], { r: 0, c: 0, mode: 'fair_isle' }).ok, true);
});

test('a Fair Isle block stamped into lace becomes real lace primitives', () => {
  const canvas = makeMatrix(2, 2, { mode: 'lace' });
  const motif = { mode: 'fair_isle', cells: [[1, 0], [1, 1]] };
  const result = stampMotif(canvas, motif, { r: 0, c: 0, mode: 'lace', masked: true });
  assert.equal(result.converted, 4, 'every cell had to change alphabet');
  assert.equal(result.matrix[0][0], STITCH_TYPE.EYELET);
  assert.equal(result.matrix[0][1], STITCH_TYPE.KNIT, 'masked: the unpunched cell leaves the plain knit alone');
  assert.equal(result.placed, 3);
});

test('softening is a majority vote, not a smear', () => {
  const canvas = grid(5, 5, 1).map((row, r) => row.map((v, c) => (r === 2 && c === 2 ? 0 : v)));
  const healed = softenRegion(canvas, { r1: 0, c1: 0, r2: 4, c2: 4 }, { mode: 'fair_isle' });
  assert.equal(healed.matrix[2][2], 1, 'a stray blank inside a solid block closes');
  const lone = grid(5, 5, 0);
  lone[2][2] = 1;
  const erased = softenRegion(lone, { r1: 0, c1: 0, r2: 4, c2: 4 }, { mode: 'fair_isle' });
  assert.equal(erased.matrix[2][2], 0, 'and a lone hole-filler in a blank field goes');
  const lace = [
    [STITCH_TYPE.EYELET, STITCH_TYPE.EYELET, STITCH_TYPE.KNIT],
    [STITCH_TYPE.EYELET, STITCH_TYPE.KNIT, STITCH_TYPE.KNIT],
    [STITCH_TYPE.EYELET, STITCH_TYPE.TRANSFER_LEFT, STITCH_TYPE.KNIT]
  ];
  const voted = softenRegion(lace, { r1: 1, c1: 1, r2: 1, c2: 1 }, { mode: 'lace' });
  assert.equal(voted.matrix[1][1], STITCH_TYPE.EYELET, 'five worked to four plain, and the eyelet is the commonest mark');
});

test('smudging drags the content along the stroke', () => {
  const base = [[1, 0, 0, 0]];
  const result = smudgePath(base, ['0,0', '0,1', '0,2']);
  assert.deepEqual(result.matrix, [[1, 1, 0, 0]]);
  assert.equal(result.moved, 2);
  assert.equal(smudgePath(base, ['0,0']).ok, false, 'one point is a click, not a drag');
  const backwards = smudgePath(base, ['0,0', '0,1', '0,0']);
  assert.deepEqual(backwards.matrix, [[0, 1, 0, 0]], 'dragging back over the origin pulls the value with it');
});

test('selection conversion leaves the rest of the card alone', () => {
  const mixed = [
    [1, 1, STITCH_TYPE.KNIT],
    [0, 1, STITCH_TYPE.EYELET]
  ];
  const toLace = convertRegion(mixed, { r1: 0, c1: 0, r2: 1, c2: 1 }, { from: 'fair_isle', to: 'lace' });
  assert.deepEqual(toLace.matrix[0], [STITCH_TYPE.EYELET, STITCH_TYPE.EYELET, STITCH_TYPE.KNIT]);
  assert.equal(toLace.matrix[1][0], STITCH_TYPE.KNIT);
  assert.equal(toLace.changed, 4);
  const unchanged = convertRegion(mixed, { r1: 0, c1: 0, r2: 0, c2: 0 }, { from: 'lace', to: 'lace' });
  assert.deepEqual(unchanged.matrix, mixed);
});

test('mode conversion is alphabet-correct in both directions', () => {
  assert.equal(convertCellBetweenModes('lace', 'fair_isle', STITCH_TYPE.TRANSFER_LEFT), 1);
  assert.equal(convertCellBetweenModes('lace', 'fair_isle', STITCH_TYPE.KNIT), 0);
  assert.equal(convertCellBetweenModes('fair_isle', 'lace', 1), STITCH_TYPE.EYELET);
  assert.equal(convertCellBetweenModes('fair_isle', 'lace', 0), STITCH_TYPE.KNIT);
  assert.equal(convertCellBetweenModes('fair_isle', 'tuck', 1), 1, 'direct to direct keeps the bit');
  assert.equal(isDirectMode('slip'), true);
  assert.equal(isPunched('lace', STITCH_TYPE.PURL), false);
  assert.deepEqual(convertMatrixBetweenModes('lace', 'tuck', [['K', 'O']]), [[0, 1]]);
  assert.match(describeCellValue('fair_isle', 1), /punched/);
  assert.match(describeCellValue('lace', 'O'), /worked/);
  const region = convertRegionBetweenModes(
    [[STITCH_TYPE.KNIT, STITCH_TYPE.EYELET], [STITCH_TYPE.KNIT, STITCH_TYPE.EYELET]],
    { r1: 0, c1: 0, r2: 1, c2: 0 },
    'lace',
    'fair_isle'
  );
  assert.deepEqual(region.matrix, [
    [0, STITCH_TYPE.EYELET],
    [0, STITCH_TYPE.EYELET]
  ], 'outside the marquee the lace symbols are kept');
  assert.equal(region.changed, 2);
});

test('a design can be resampled or retiled onto another bed', () => {
  const base = [
    [1, 0],
    [0, 1]
  ];
  assert.deepEqual(resampleMatrix(base, { rows: 2, cols: 4, method: 'repeat' }).matrix, [[1, 0, 1, 0], [0, 1, 0, 1]]);
  const grown = resampleMatrix(base, { rows: 4, cols: 4 });
  assert.equal(grown.matrix.length, 4);
  assert.equal(grown.matrix[3][3], 1, 'nearest sampling keeps the corners');
  assert.equal(resampleMatrix([], { rows: 2, cols: 2 }).ok, false);

  const regauged = regaugeMatrix(grid(20, 24, 1), { fromPitchX: 4.5, fromPitchY: 5.08, toPitchX: 5, toPitchY: 5 });
  assert.equal(regauged.cols, 22, '24 × 4.5 mm is 108 mm, which is 22 needles at 5 mm');
  assert.equal(regauged.widthMm, 108);
  assert.equal(regauged.matrix[0].length, 22);
  assert.ok(regauged.warnings.length >= 1, 'and it says so');
  assert.equal(regaugeMatrix(base, { fromPitchX: 4.5 }).ok, false, 'no target pitch, no guess');
  assert.equal(regaugeMatrix(base, { fromPitchX: 0, toPitchX: 5 }).ok, false);
  assert.equal(stitchesForWidth(90, 4.5), 20);
  assert.equal(stitchesForWidth(90, 0), null);
});
