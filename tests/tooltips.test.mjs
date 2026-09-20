// The tooltip layer's pure geometry + text selection — the two parts that decide
// where the bubble lands and what it says. Asserted without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeTip, tipTextFor } from '../js/ui/tooltips.js';

const VP = { vw: 1000, vh: 800 };
const TIP = { w: 200, h: 40 };

test('placeTip centres the tip above its owner when there is room', () => {
  const owner = { left: 500, top: 400, width: 60, height: 30 };
  const at = placeTip(owner, TIP, VP);
  assert.equal(at.placement, 'top');
  // centred: owner centre 530 minus half tip (100) = 430
  assert.equal(at.x, 430);
  // above: 400 - 40 (h) - 8 (gap) = 352
  assert.equal(at.y, 352);
});

test('placeTip flips below when the tip would clip the top edge', () => {
  const owner = { left: 500, top: 20, width: 60, height: 30 };
  const at = placeTip(owner, TIP, VP);
  assert.equal(at.placement, 'bottom');
  // below: 20 + 30 + 8 = 58
  assert.equal(at.y, 58);
});

test('placeTip clamps horizontally so the tip never spills off-screen', () => {
  const nearLeft = placeTip({ left: 10, top: 400, width: 40, height: 30 }, TIP, VP);
  assert.ok(nearLeft.x >= 8, 'kept off the left edge');
  const nearRight = placeTip({ left: 980, top: 400, width: 40, height: 30 }, TIP, VP);
  assert.ok(nearRight.x + TIP.w <= 1000 - 8 + 1, 'kept off the right edge');
});

test('placeTip is safe with empty or partial inputs', () => {
  assert.doesNotThrow(() => placeTip(null, null, null));
  const at = placeTip(undefined, undefined, undefined);
  assert.ok(Number.isFinite(at.x) && Number.isFinite(at.y));
});

// A tiny element stand-in: tipTextFor only reads attributes.
const el = attrs => ({ getAttribute: k => (k in attrs ? attrs[k] : null) });

test('tipTextFor prefers data-ktip and ignores a raw title when a tip exists', () => {
  assert.equal(tipTextFor(el({ 'data-ktip': '  Custom  ', title: 'Native' })), 'Custom');
});

test('tipTextFor falls back to title, and treats blanks as no tooltip', () => {
  assert.equal(tipTextFor(el({ title: 'Native only' })), 'Native only');
  assert.equal(tipTextFor(el({ 'data-ktip': '   ' })), null);
  assert.equal(tipTextFor(el({ title: '' })), null);
  assert.equal(tipTextFor(el({})), null);
  assert.equal(tipTextFor(null), null);
});
