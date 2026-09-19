// Zero-dependency tests for the shared toolpath ordering (js/math/tsp-path.js)
// and for the tractor-feed ordering bug in the G-code exporter.
// Run with:  node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  optimizeToolpath,
  orderColumnSweep,
  pathLengthMm
} from '../js/math/tsp-path.js';
import { CncGcodeExporter } from '../js/exporters/cnc-gcode.js';
import { MACHINE_PROFILES } from '../js/machine/profiles.js';

/** Deterministic pseudo-random point cloud so failures are reproducible. */
function scatter(count, seed = 7) {
  let state = seed >>> 0;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: rand() * 200,
    y: rand() * 300
  }));
}

test('optimizeToolpath never lengthens the path', () => {
  const pts = scatter(120);
  const before = pathLengthMm(pts);
  const after = pathLengthMm(optimizeToolpath(pts));
  assert.ok(after <= before + 1e-6, `expected shortening, got ${before} -> ${after}`);
});

test('optimizeToolpath returns the same points, without mutating the input', () => {
  const pts = scatter(40);
  const snapshot = pts.slice();
  const ordered = optimizeToolpath(pts);

  assert.equal(ordered.length, pts.length);
  assert.deepEqual(pts, snapshot, 'input array must be left alone');
  assert.equal(new Set(ordered).size, pts.length, 'no point lost or duplicated');
  // Every returned element must be one of the original objects, not a clone.
  for (const p of ordered) assert.ok(snapshot.includes(p));
});

test('a tiny degenerate input is returned as-is rather than throwing', () => {
  for (const size of [0, 1, 2]) {
    const pts = scatter(size);
    assert.deepEqual(optimizeToolpath(pts), pts);
  }
});

test('the tour starts at the point nearest machine home', () => {
  const pts = [
    { x: 180, y: 220 },
    { x: 4, y: 3 },
    { x: 90, y: 90 },
    { x: 120, y: 10 }
  ];
  const ordered = optimizeToolpath(pts);
  assert.equal(ordered[0], pts[1], 'nearest-neighbour must seed from (0,0)');
});

test('pathLengthMm measures from home and matches a hand computation', () => {
  const pts = [{ x: 3, y: 4 }, { x: 3, y: 9 }];
  // (0,0)->(3,4) is 5, then a 5mm vertical hop.
  assert.ok(Math.abs(pathLengthMm(pts) - 10) < 1e-9);
  assert.ok(Math.abs(pathLengthMm([], { x: 1, y: 1}) - 0) < 1e-9);
});

test('orderColumnSweep keeps each column monotone and chains the passes', () => {
  const pts = [];
  for (const x of [10, 20]) {
    for (let i = 0; i < 5; i++) pts.push({ x, y: i * 10 });
  }
  const swept = orderColumnSweep(pts);
  assert.equal(swept.length, pts.length);

  const firstColumn = swept.slice(0, 5);
  const secondColumn = swept.slice(5);
  assert.ok(firstColumn.every(p => p.x === 10));
  assert.ok(secondColumn.every(p => p.x === 20));
  for (let i = 1; i < 5; i++) {
    assert.ok(firstColumn[i].y > firstColumn[i - 1].y, 'first pass ascends');
    assert.ok(secondColumn[i].y < secondColumn[i - 1].y, 'second pass descends');
  }
  // The alternating direction means no long return rapid across the bed.
  assert.equal(firstColumn[4].y, secondColumn[0].y);
});

test('sprocket holes stay out of the TSP tour and lead the program', () => {
  const profile = MACHINE_PROFILES.brother_standard_24;
  const rows = 10;
  const cardMatrix = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: 24 }, (_, c) => (r + c) % 3 === 0)
  );
  const exporter = new CncGcodeExporter({ machineType: 'solenoid', cutCardOutline: false });
  const gcode = exporter.generateGCode(profile, cardMatrix);

  const kinds = [...gcode.matchAll(/; Hole \d+\/\d+ \((\w+)\)/g)].map(m => m[1]);
  assert.ok(kinds.length > 0, 'expected annotated holes in the program');

  const firstPattern = kinds.indexOf('pattern_hole');
  const lastSprocket = kinds.lastIndexOf('sprocket');
  assert.ok(lastSprocket < firstPattern, 'every sprocket must precede the pattern');

  // Sprockets must be monotone column sweeps, never a scrambled tour order.
  const sprockets = [...gcode.matchAll(/; Hole \d+\/\d+ \(sprocket\)\nG00 X(-?[\d.]+) Y(-?[\d.]+)/g)]
    .map(m => ({ x: parseFloat(m[1]), y: parseFloat(m[2]) }));
  assert.ok(sprockets.length >= 4, 'expected a run of feed holes');
  assert.equal(sprockets.length % 2, 0, 'both edges get the same count');

  const columns = [];
  for (const p of sprockets) {
    const last = columns[columns.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.005) last.points.push(p);
    else columns.push({ x: p.x, points: [p] });
  }
  assert.equal(columns.length, 2, 'one contiguous pass per bed edge');
  for (const [index, col] of columns.entries()) {
    const ascending = index % 2 === 0;
    for (let i = 1; i < col.points.length; i++) {
      const dy = col.points[i].y - col.points[i - 1].y;
      assert.ok(ascending ? dy > 0 : dy < 0, 'each pass must stay strictly monotone');
    }
  }
});

test('the exported program reports a rapid distance the ordering can beat', () => {
  const profile = MACHINE_PROFILES.brother_standard_24;
  const cardMatrix = Array.from({ length: 12 }, (_, r) =>
    Array.from({ length: 24 }, (_, c) => (r * 7 + c * 11) % 5 === 0)
  );
  const readTraverse = gcode => {
    const m = gcode.match(/; Rapid traverse: ([\d.]+)mm/);
    return m ? parseFloat(m[1]) : NaN;
  };
  const optimized = readTraverse(
    new CncGcodeExporter({ machineType: 'solenoid', optimizePath: true }).generateGCode(profile, cardMatrix)
  );
  const unoptimized = readTraverse(
    new CncGcodeExporter({ machineType: 'solenoid', optimizePath: false }).generateGCode(profile, cardMatrix)
  );
  assert.ok(Number.isFinite(optimized) && Number.isFinite(unoptimized));
  assert.ok(optimized < unoptimized, `optimiser made it worse: ${unoptimized} -> ${optimized}`);
});
