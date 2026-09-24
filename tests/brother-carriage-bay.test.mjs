// Regression battery for the physical carriage bay modelled in
// js/machine/brother-selector.js — the single-carriage constraint and the lace
// setup that locks the bed to the Lace carriage. These are hardware facts, not
// UI preferences: a punchcard bed is one channel, only one carriage rides it and
// hauls the belt that indexes the card, and a machine rigged for lace cannot seat
// a knit or garter carriage. The 3D kinematics visualizer draws exactly this state,
// so if the mechanism ever lets two carriages coexist (or lets a knit carriage
// sneak onto a lace-locked bed) the simulator would render an impossible machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BrotherSelectorMechanism } from '../js/machine/brother-selector.js';

const fresh = () => new BrotherSelectorMechanism(40, 24, 8);

test('a bed seats exactly one carriage and ejects the previous one', () => {
  const sim = fresh();
  assert.equal(sim.mountedCarriage, 'lace', 'boots on the Lace carriage');

  const mountedKnit = sim.mountCarriage('knit');
  assert.equal(mountedKnit.ok, true);
  assert.equal(mountedKnit.mounted, 'knit');
  assert.equal(mountedKnit.ejected, 'lace', 'mounting a carriage displaces the one that was there');
  assert.equal(sim.mountedCarriage, 'knit', 'only ever one carriage remains seated');
});

test('mounting the carriage already on the bed is a no-op, not a phantom eject', () => {
  const sim = fresh();
  const again = sim.mountCarriage('lace');
  assert.equal(again.ok, true);
  assert.equal(again.ejected, null, 'no other carriage was pushed off');
  assert.equal(again.mounted, 'lace');
});

test('an unknown carriage cannot be seated at all', () => {
  const sim = fresh();
  const bad = sim.mountCarriage('ribber');
  assert.equal(bad.ok, false);
  assert.equal(bad.blocked, true);
  assert.equal(sim.mountedCarriage, 'lace', 'the bed is left untouched');
});

test('a lace-rigged machine locks the bed to the Lace carriage', () => {
  const sim = fresh();
  sim.setLaceMode(true);
  assert.equal(sim.laceMode, true);
  assert.equal(sim.mountedCarriage, 'lace');

  const blocked = sim.canMountCarriage('knit');
  assert.equal(blocked.ok, false, 'a knit carriage may not be connected while rigged for lace');
  assert.match(blocked.reason, /lace/i);

  const attempt = sim.mountCarriage('knit');
  assert.equal(attempt.blocked, true);
  assert.equal(attempt.mounted, 'lace', 'the refusal leaves Lace on the bed');
  assert.equal(sim.mountedCarriage, 'lace', 'the lock held');
});

test('engaging lace mode ejects a knit carriage already riding the bed', () => {
  const sim = fresh();
  sim.mountCarriage('knit');
  const result = sim.setLaceMode(true);
  assert.equal(result.mounted, 'lace');
  assert.equal(result.ejected, 'knit', 'taking up the lace rig forcibly seats the Lace carriage');
  assert.equal(sim.mountedCarriage, 'lace');
});

test('a lace carriage raises selected needles to holding; a knit carriage to the working cam', () => {
  const sim = fresh();
  const punched = new Array(24).fill(false);
  punched[3] = true; // a hole on track 3 → the needles on that track get selected

  sim.setLaceMode(true);
  sim.setPunchcardRow(punched);
  assert.ok(
    sim.needleStates.some(state => state === 'E_POS'),
    'lace carriage drives punched needles all the way out to holding position'
  );
  assert.ok(!sim.needleStates.includes('D_POS'), 'lace rig does not leave needles merely in the working cam');

  // Off lace, a knit carriage only lifts the same needles into the working channel.
  sim.setLaceMode(false);
  sim.mountCarriage('knit', { force: true });
  sim.setPunchcardRow(punched);
  assert.ok(sim.needleStates.includes('D_POS'), 'knit carriage raises punched needles to the working cam');
  assert.ok(!sim.needleStates.includes('E_POS'), 'a knit carriage never puts needles into lace holding');
});

test('telemetry exposes the carriage bay so the UI can never claim two carriages', () => {
  const sim = fresh();
  sim.setLaceMode(true);
  const tele = sim.getMechanismTelemetry();
  assert.ok(tele.carriage, 'telemetry carries the bay snapshot');
  assert.equal(tele.carriage.mounted, 'lace');
  assert.equal(tele.carriage.laceMode, true);
  assert.equal(tele.carriage.beltDriven, true, 'the mounted carriage is what drives the card reader');
  assert.deepEqual(tele.carriage.parked, ['knit', 'garter'], 'everything but the seated carriage is parked off-machine');
});

test('holding (E_POS) needles are counted as working, not pulled down', () => {
  const sim = fresh();
  const punched = new Array(24).fill(false);
  punched[0] = true; punched[1] = true;
  sim.setLaceMode(true);
  sim.setPunchcardRow(punched);
  const tele = sim.getMechanismTelemetry();
  const holdingCount = sim.needleStates.filter(s => s === 'E_POS').length;
  assert.ok(holdingCount > 0);
  assert.equal(
    tele.totalWorkingNeedles,
    holdingCount + sim.needleStates.filter(s => s === 'D_POS').length,
    'selected count folds in needles raised to holding'
  );
  assert.equal(
    tele.totalWorkingNeedles + tele.totalPulledDown,
    sim.totalNeedles,
    'every needle is either working or pulled down — none are lost from the readout'
  );
});
