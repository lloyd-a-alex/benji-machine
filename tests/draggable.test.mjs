// Draggable's pure viewport clamp — the rule that guarantees a dragged window can
// never be flung out of reach. Asserted without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constrainToViewport } from '../js/ui/draggable.js';

const VP = { vw: 1000, vh: 800 };

test('a box already inside the viewport is left where it is', () => {
  const at = constrainToViewport(200, 200, 300, 200, VP);
  assert.deepEqual(at, { x: 200, y: 200 });
});

test('a box pushed off the right keeps a grabbable sliver on screen', () => {
  const at = constrainToViewport(9999, 200, 300, 200, VP);
  assert.ok(at.x <= VP.vw - 80, 'left edge stays within reach');
  assert.ok(at.x > 0, 'does not overscroll off the left either');
});

test('a box pushed off the top keeps its title bar visible', () => {
  const at = constrainToViewport(200, -9999, 300, 200, VP);
  // top-left is negative enough to hide the box, but at least ~34px must show:
  assert.ok(at.y + 200 > 34, 'the box bottom is below the top edge');
  assert.ok(at.y <= 800 - 34, 'the box top is above the bottom edge');
});

test('constrainToViewport survives a missing viewport', () => {
  const at = constrainToViewport(10, 10, 100, 100, null);
  assert.ok(Number.isFinite(at.x) && Number.isFinite(at.y));
});
