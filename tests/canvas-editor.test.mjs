// Regression tests for the Fair Isle / punchcard fix and selection ops.
// Run with:  node --test "tests/*.test.mjs"
// CanvasEditor / LaceCompiler import only browser-free code at module load,
// so their static / pure methods can be exercised in Node without a DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CanvasEditor } from '../js/ui/canvas-editor.js';
import { LaceCompiler } from '../js/compiler/lace-decompiler.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';

const fakeProfile = { carriageRules: { type: 'brother_separated', minPlainRowsAfterLace: 2 } };

test('lace -> fair isle conversion turns plain-knit background into unpunched 0 (punchcard bug)', () => {
  // A fresh lace chart is mostly 'K' with a couple of eyelet marks.
  const lace = [
    [STITCH_TYPE.KNIT, STITCH_TYPE.EYELET, STITCH_TYPE.KNIT],
    [STITCH_TYPE.TRANSFER_LEFT, STITCH_TYPE.KNIT, STITCH_TYPE.KNIT]
  ];
  const converted = CanvasEditor.convertMatrixBetweenModes('lace', 'fair_isle', lace);
  // 'K' background must become 0 (NOT punched), marks become 1 (punched).
  assert.equal(converted[0][0], 0);
  assert.equal(converted[0][1], 1);
  assert.equal(converted[1][0], 1);
  assert.equal(converted[1][2], 0);
});

test('fair isle drawing compiles to a punchcard that matches what was drawn', () => {
  const compiler = new LaceCompiler(fakeProfile);
  // Background 0, one drawn contrast cell = 1.
  const fairIsle = [[0, 1, 0, 0]];
  const res = compiler.compileDirectPattern(fairIsle, 'fair_isle');
  assert.deepEqual(res.cardMatrix[0], [false, true, false, false]);
});

test('a converted grid never becomes an all-punched card from leftover K cells', () => {
  const compiler = new LaceCompiler(fakeProfile);
  const lace = [new Array(8).fill(STITCH_TYPE.KNIT)];
  const converted = CanvasEditor.convertMatrixBetweenModes('lace', 'fair_isle', lace);
  const res = compiler.compileDirectPattern(converted, 'fair_isle');
  const punched = res.cardMatrix[0].filter(Boolean).length;
  assert.equal(punched, 0, 'blank lace chart should produce zero holes in fair isle');
});

test('fair isle -> lace round trip yields valid stitch strings', () => {
  const fairIsle = [[0, 1, 1, 0]];
  const backToLace = CanvasEditor.convertMatrixBetweenModes('fair_isle', 'lace', fairIsle);
  assert.equal(backToLace[0][0], STITCH_TYPE.KNIT);
  assert.equal(backToLace[0][1], STITCH_TYPE.EYELET);
});
