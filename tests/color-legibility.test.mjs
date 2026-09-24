// KNITCAT — colour-legibility tests (pure, DOM-free).
// Run with:  node --test "tests/*.test.mjs"
//
// The compiler used to judge palette contrast twice over (the verify pass and the appearance
// optimiser) and in BOTH cases against every palette pair whether or not those colours ever touch
// on the card — so two similar shades that never meet were flagged as if the motif were broken.
// These lock the unified, adjacency-aware analysis: `adjacentColorPairs` decides which yarns meet,
// `analyzeColorLegibility` is the single contrast + colour-blindness implementation, and the two
// compiler passes now agree because they share it. Fixing a false alarm must never cost a true one.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { adjacentColorPairs, colorPairKey } from '../js/core/chart-analysis.js';
import { analyzeColorLegibility, CONTRAST_FLOOR, CVD_THRESHOLD } from '../js/core/color-legibility.js';
import { verifyColor } from '../js/compiler/verify/color.js';
import { appearancePass } from '../js/compiler/optimise/appearance-pass.js';

// Black, white, dark grey: black↔dark grey is below the 3:1 floor, but nothing else is.
const BLACK = { index: 0, hex: '#000000', yarn: 'Black' };
const WHITE = { index: 1, hex: '#ffffff', yarn: 'White' };
const GREY = { index: 2, hex: '#333333', yarn: 'DarkGrey' };
// Navy vs crimson pass luminance yet collapse under protanopia — a pure colour-blindness catch.
const NAVY = { index: 0, hex: '#000040', yarn: 'Navy' };
const CRIMSON = { index: 1, hex: '#c00040', yarn: 'Crimson' };

// ─── adjacentColorPairs: which colours actually touch ─────────────────────────

test('adjacentColorPairs finds edge-neighbour colour pairs, horizontal and vertical', () => {
  const { pairs, keys } = adjacentColorPairs([[0, 1, 2]], 'fair_isle');
  // One row: 0 touches 1, 1 touches 2 — 0 and 2 never meet.
  assert.deepEqual(pairs, [[0, 1], [1, 2]]);
  assert.equal(keys.has(colorPairKey(0, 2)), false);
  assert.equal(keys.has(colorPairKey(1, 2)), true);

  // A vertical neighbour adds a pair; identical neighbours add nothing.
  const both = adjacentColorPairs([[0], [1]], 'fair_isle');
  assert.deepEqual(both.pairs, [[0, 1]]);
  assert.deepEqual(adjacentColorPairs([[1], [1]], 'fair_isle').pairs, [], 'same colour touching itself is not a pair');
});

test('adjacentColorPairs folds lace to ground/worked and dedupes repeated pairs', () => {
  // A jacquard tile where 0↔1 meet along several edges must report the unordered pair once.
  const { pairs } = adjacentColorPairs([[0, 1], [1, 0]], 'fair_isle');
  assert.deepEqual(pairs, [[0, 1]]);
});

test('adjacentColorPairs is total on malformed charts', () => {
  for (const bad of [null, undefined, [], [null], [[]], 'x', 7, [[0, 1], null, [2]]]) {
    assert.doesNotThrow(() => adjacentColorPairs(bad, 'fair_isle'));
  }
});

// ─── analyzeColorLegibility: one implementation, adjacency-aware ──────────────

test('all-pairs audit flags a low-contrast pair; adjacency clears it when the two never touch', () => {
  const colors = [BLACK, WHITE, GREY];
  const all = analyzeColorLegibility(colors);
  assert.equal(all.adjacency, false);
  assert.equal(all.verdict, 'fail');
  assert.deepEqual(all.low.map((l) => l.labels).flat().sort(), ['Black', 'DarkGrey']);

  // Card row [black, white, grey]: black touches white touches grey, black never touches grey.
  const adj = adjacentColorPairs([[0, 1, 2]], 'fair_isle');
  const narrowed = analyzeColorLegibility(colors, { adjacency: adj });
  assert.equal(narrowed.adjacency, true);
  assert.equal(narrowed.pairsChecked, 2, 'only the two touching pairs are judged');
  assert.equal(narrowed.low.length, 0, 'the non-adjacent black/grey match is no longer an alarm');
  assert.equal(narrowed.verdict, 'pass');
});

test('a genuinely adjacent low-contrast pair is still caught (no false negatives)', () => {
  const adj = adjacentColorPairs([[0, 2]], 'fair_isle'); // black beside grey
  const r = analyzeColorLegibility([BLACK, WHITE, GREY], { adjacency: adj });
  assert.equal(r.verdict, 'fail');
  assert.equal(r.low.length, 1);
  assert.equal(r.low[0].ratio < CONTRAST_FLOOR, true);
});

test('a luminance-passing but colour-blind-confusable pair warns', () => {
  const r = analyzeColorLegibility([NAVY, CRIMSON], { adjacency: { pairs: [[0, 1]] } });
  assert.equal(r.low.length, 0, 'value contrast is fine');
  assert.ok(r.confusableTypes.includes('protanopia'), 'but a protanope cannot separate them');
  assert.equal(r.verdict, 'warn');
});

test('non-adjacent colour-blind confusability is suppressed too', () => {
  // Navy and crimson only meet each other on a card that never puts them side by side.
  const r = analyzeColorLegibility([NAVY, CRIMSON], { adjacency: { pairs: [] } });
  // An empty adjacency set falls back to the all-pairs audit (nothing to narrow by).
  assert.equal(r.adjacency, false);
  assert.ok(r.confusableTypes.length >= 1);
});

test('single-colour and empty palettes pass trivially and never throw', () => {
  assert.equal(analyzeColorLegibility([BLACK]).verdict, 'pass');
  assert.equal(analyzeColorLegibility([]).verdict, 'pass');
  assert.equal(analyzeColorLegibility(null).verdict, 'pass');
  for (const junk of [undefined, [{}], [{ hex: null }], [{ index: 0 }], 'nope', 42, [BLACK, null]]) {
    assert.doesNotThrow(() => analyzeColorLegibility(junk));
  }
});

test('exports are the documented tuning constants', () => {
  assert.equal(CONTRAST_FLOOR, 3);
  assert.ok(Number.isFinite(CVD_THRESHOLD) && CVD_THRESHOLD > 0);
});

// ─── the two compiler passes agree because they share one analysis ───────────

test('verifyColor and the appearance optimiser reach the same adjacency-aware verdict', () => {
  const colors = [BLACK, WHITE, GREY];
  const touching = [[0, 2]]; // black beside grey → a real defect

  const v = verifyColor({ colors, cardMatrix: touching });
  const ap = appearancePass({ colors, cardMatrix: touching, pieces: [] });
  assert.equal(v.verdict, 'fail', 'the verifier flags the touching near-match');
  assert.deepEqual(ap.ir.appearance.contrastIssues.map((c) => c.pair).flat().sort(), ['Black', 'DarkGrey']);

  // The same palette where the two never touch is clean for BOTH — the false alarm is gone.
  const v2 = verifyColor({ colors, cardMatrix: [[0, 1, 2]] });
  const ap2 = appearancePass({ colors, cardMatrix: [[0, 1, 2]], pieces: [] });
  assert.equal(v2.verdict, 'pass');
  assert.equal(ap2.ir.appearance.contrastIssues.length, 0);
});

test('verifyColor keeps its pass/warn/fail contract and reports adjacency', () => {
  const single = verifyColor({ colors: [BLACK], cardMatrix: [[0]] });
  assert.equal(single.id, 'color');
  assert.equal(single.verdict, 'pass');
  assert.ok(['pass', 'warn', 'fail'].includes(verifyColor({ colors: [NAVY, CRIMSON], cardMatrix: [[0, 1]] }).verdict));
  assert.equal(verifyColor({ colors: [BLACK, WHITE, GREY], cardMatrix: [[0, 2]] }).adjacency, true);
  // No matrix at all → conservative all-pairs fallback, so a defect without a card still reads.
  assert.equal(verifyColor({ colors: [BLACK, WHITE, GREY] }).verdict, 'fail');
});
