// The Machine Universe answers a question the feasibility advisor never did:
// not *will it knit* but *how big is the thing that comes off the machine*. The
// stitches are fixed; only the pitch changes between gauges, so the same card is
// a different physical object on every bed. These are pure over measure.gridSizeMm
// and profiles' derived bed capacity, so they can never disagree with the editor
// rulers or the needle-capacity math.
//
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMachineUniverse } from '../js/features/machine-universe.js';
import { MACHINE_PROFILES } from '../js/machine/profiles.js';

// A plain 24-stitch × 60-row card. physicalFootprint needs no advisor, only an
// editor matrix, so a bare object is a complete host here.
const card = (rows, cols) => Array.from({ length: rows }, () => Array(cols).fill(0));
const universe = (rows, cols) => createMachineUniverse({ editor: { matrix: card(rows, cols) } });
const byId = (f, id) => f.machines.find((m) => m.profileId === id);

test('physicalFootprint reports the current card size on every machine', () => {
  const f = universe(60, 24).physicalFootprint();
  assert.equal(f.rows, 60);
  assert.equal(f.cols, 24);
  assert.equal(f.machines.length, Object.keys(MACHINE_PROFILES).length, 'one row per machine profile');
  // 24 stitches: 4.5mm → 108mm on standard gauge, 5mm maxi → 120mm, 9mm → 216mm on Chunky.
  assert.equal(byId(f, 'brother_standard_24').widthMm, 108);
  assert.equal(byId(f, 'brother_maxi_60').widthMm, 120);
  assert.equal(byId(f, 'brother_bulky_24').widthMm, 216);
  assert.equal(f.minWidthMm, 108);
  assert.equal(f.maxWidthMm, 216);
});

test('the fleet spread is measured, not asserted', () => {
  const f = universe(60, 24).physicalFootprint();
  assert.equal(f.spreadRatio, 2, 'Chunky is exactly twice standard gauge here');
  assert.ok(f.machines.every((m) => m.widthMm >= f.minWidthMm && m.widthMm <= f.maxWidthMm));
});

test('a design wider than a bed is flagged as not fitting', () => {
  const f = universe(10, 150).physicalFootprint();
  // Chunky's 9mm bed holds 100 needles; 150 stitches overflow it though the
  // 4.5mm standard bed (200 needles) still takes them.
  assert.equal(byId(f, 'brother_bulky_24').fitsBed, false);
  assert.equal(byId(f, 'brother_standard_24').fitsBed, true);
});

test('the spread headline names both extremes in centimetres', () => {
  const line = universe(60, 24).physicalSpreadLine();
  assert.match(line, /10\.8 cm/);
  assert.match(line, /21\.6 cm/);
  assert.match(line, /2\.0× bigger/, 'quantifies the difference');
});

test('an empty card is handled without dividing by zero', () => {
  const f = createMachineUniverse({ editor: { matrix: [] } }).physicalFootprint();
  assert.equal(f.cols, 0);
  assert.equal(f.spreadRatio, 1);
  assert.equal(universe(0, 0).physicalSpreadLine(), '', 'no headline before there is a card');
});
