// Zero-dependency unit tests for KNITCAT pure functions.
// Run with:  node --test tests/
// These import browser-free modules only (math / machine profiles).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KnitTopologyNetwork, STITCH_TYPE, Vec3 } from '../js/math/knit-topology.js';
import { calculateCardDimensions, MACHINE_PROFILES } from '../js/machine/profiles.js';

function makePlainGrid(rows = 12, cols = 12) {
  const m = [];
  for (let r = 0; r < rows; r++) m.push(new Array(cols).fill(STITCH_TYPE.KNIT));
  return m;
}

test('topology builds a finite, non-NaN lattice from a stitch matrix', () => {
  const net = new KnitTopologyNetwork(12, 12, 22, 18);
  net.collisionEnabled = false;
  net.buildFromStitchMatrix(makePlainGrid());
  net.stepPhysics(4, 0.016, net.damping);
  for (const n of net.nodes) {
    assert.ok(Number.isFinite(n.pos.x) && Number.isFinite(n.pos.y) && Number.isFinite(n.pos.z),
      'node position must stay finite');
  }
});

test('solver stays stable even when stiffness is over-driven past 1 (tension bug)', () => {
  const net = new KnitTopologyNetwork(12, 12, 22, 18);
  net.collisionEnabled = false;
  net.buildFromStitchMatrix(makePlainGrid());
  // Worst case: a mis-configured caller pushes stiffness to 3 and shrinks rest length.
  for (const c of net.constraints) {
    c.stiffness = 3.0;
    c.restLength = c.baseRestLength * 0.2;
  }
  for (let i = 0; i < 60; i++) net.stepPhysics(4, 0.016, net.damping);
  for (const n of net.nodes) {
    assert.ok(Number.isFinite(n.pos.x), 'x must remain finite');
    assert.ok(Math.abs(n.pos.x) < 1e5 && Math.abs(n.pos.y) < 1e5,
      'positions must remain bounded (no explosion)');
  }
});

test('calculateCardDimensions returns positive real millimetre geometry', () => {
  const profile = MACHINE_PROFILES.brother_standard_24;
  const dims = calculateCardDimensions(profile, 24, profile.columns);
  assert.ok(dims.widthMm > 0 && dims.heightMm > 0, 'card dims must be positive');
});

test('Vec3 math primitives behave as expected', () => {
  const a = new Vec3(1, 2, 3);
  const b = new Vec3(4, 5, 6);
  assert.deepEqual(Vec3.add(a, b), new Vec3(5, 7, 9));
  assert.equal(new Vec3(3, 4, 0).length(), 5);
  const c = Vec3.cross(new Vec3(1, 0, 0), new Vec3(0, 1, 0));
  assert.deepEqual(c, new Vec3(0, 0, 1));
});
