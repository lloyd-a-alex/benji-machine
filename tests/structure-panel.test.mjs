// The Card Structure panel's analysis core.
//
// The panel itself is DOM (asserted by boot guards elsewhere), but every number it
// shows comes from the pure `analyzeCard`, which is where the real risk lives: a
// wrong "does it tile?" or a wrong physical size would send a knitter to the machine
// with bad arithmetic. So the analysis is pinned here against the same subsystems it
// claims to integrate — documents, layers, guides and measure — with no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCard } from '../js/ui/structure-panel.js';
import { fillWithRepeat } from '../js/ui/structure-panel.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';
import { MACHINE_PROFILES } from '../js/machine/profiles.js';

const K = STITCH_TYPE.KNIT;
const O = STITCH_TYPE.EYELET;
const TL = STITCH_TYPE.TRANSFER_LEFT;
const brother = MACHINE_PROFILES.brother_standard_24;

test('an empty card is described as empty without throwing', () => {
  const r = analyzeCard({ matrix: [], mode: 'lace', profile: brother });
  assert.equal(r.rows, 0);
  assert.equal(r.cols, 0);
  assert.equal(r.worked, 0);
  assert.equal(r.fit.ok, false, 'no repeat is set, so there is nothing to tile');
});

test('the worked count is what the layer composite actually reads back', () => {
  // Two punched marks (an eyelet and a transfer) out of four cells in a lace card.
  const matrix = [[K, O], [TL, K]];
  const r = analyzeCard({ matrix, mode: 'lace', profile: brother, name: 'Swatch' });
  assert.equal(r.rows, 2);
  assert.equal(r.cols, 2);
  assert.equal(r.worked, 2, 'blank (KNIT) cells are not counted; eyelet and transfer are');
  assert.equal(r.layers.worked, 2, 'the layers pipeline agrees with the headline count');
  assert.equal(r.document.name, 'Swatch');
  assert.equal(r.document.mode, 'lace');
});

// ─── Repeat fill: the editor activation of the guides/repeat engine ───────────

test('fillWithRepeat is a no-op clone when the repeat is empty or invalid', () => {
  const card = [[1, 0], [0, 1]];
  assert.deepEqual(fillWithRepeat(card, 0, 0), card);
  assert.deepEqual(fillWithRepeat(card, -3, 5), card);
  assert.deepEqual(fillWithRepeat([], 2, 2), []);
  // returns a copy, never the same references
  const out = fillWithRepeat(card, 2, 2);
  out[0][0] = 9;
  assert.equal(card[0][0], 1, 'input matrix is untouched');
});

test('fillWithRepeat tiles the top-left block across the whole card', () => {
  // A 2×2 motif with a 4×4 canvas → repeats every 2 rows and 2 needles.
  const card = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];
  assert.deepEqual(fillWithRepeat(card, 2, 2), [
    [1, 0, 1, 0],
    [0, 1, 0, 1],
    [1, 0, 1, 0],
    [0, 1, 0, 1]
  ]);
});

test('fillWithRepeat clamps a repeat larger than the card', () => {
  const card = [[1, 0], [0, 1]];
  // a 9×9 "repeat" on a 2×2 card is just the whole card tiled by itself → unchanged
  assert.deepEqual(fillWithRepeat(card, 9, 9), card);
});

test('fillWithRepeat copies real values (punched/blank) in any mode', () => {
  const card = [
    [7, 0, 5],
    [0, 3, 0]
  ];
  // repeat 2×2 → columns tile [7,0,7] / [0,3,0]... wait cols=3, rc=2 → c%2
  const out = fillWithRepeat(card, 2, 2);
  assert.deepEqual(out[0], [7, 0, 7]);
  assert.deepEqual(out[1], [0, 3, 0]);
});

test('physical size follows the profile pitch', () => {
  const matrix = Array.from({ length: 10 }, () => new Array(24).fill(0));
  const r = analyzeCard({ matrix, mode: 'fair_isle', profile: brother });
  assert.equal(r.size.widthMm, 24 * 4.5, 'needles × pitchX');
  assert.ok(Math.abs(r.size.heightMm - 10 * 5.08) < 1e-9, 'rows × pitchY');
  assert.equal(r.size.widthLabel, '108.0 mm');
});

test('a repeat that divides the card tiles exactly', () => {
  const matrix = Array.from({ length: 8 }, () => new Array(24).fill(0));
  const r = analyzeCard({ matrix, mode: 'fair_isle', profile: brother, repeat: { rows: 4, cols: 6 } });
  assert.equal(r.fit.ok, true);
  assert.equal(r.fit.across, 4);
  assert.equal(r.fit.down, 2);
  assert.equal(r.fit.coversWholeCard, true);
  assert.match(r.fit.summary, /exact fit/);
});

test('a repeat that leaves a sliver says so out loud', () => {
  const matrix = Array.from({ length: 10 }, () => new Array(20).fill(0));
  const r = analyzeCard({ matrix, mode: 'fair_isle', profile: brother, repeat: { rows: 3, cols: 6 } });
  assert.equal(r.fit.across, 3, '20 / 6 = 3 whole tiles across');
  assert.equal(r.fit.down, 3, '10 / 3 = 3 whole tiles down');
  assert.equal(r.fit.coversWholeCard, false);
  assert.match(r.fit.summary, /left over/);
});

test('a malformed repeat is refused, not guessed at', () => {
  const matrix = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const r = analyzeCard({ matrix, mode: 'lace', profile: brother, repeat: { rows: 0, cols: 4 } });
  assert.equal(r.fit.ok, false);
  assert.equal(r.repeat, null);
});
