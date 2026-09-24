// KNITCAT — preset machine-fit fusion tests.
// Run with:  node --test "tests/*.test.mjs"
//
// The pattern browser now badges every preset with whether it actually knits on the selected
// machine, using the shared chart analysis and the advisor's own scoring rubric. These prove
// the bridge is content-aware (not a constant), total (no preset can crash the grid), honest
// across the machine registry, and deterministic (so a badge never flickers between renders).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PATTERN_PRESETS } from '../js/presets/preset-library.js';
import { fitPreset, fitChart, universalFit, clearFitCache } from '../js/presets/preset-feasibility.js';
import { MACHINE_PROFILES } from '../js/machine/profiles.js';

const STATUSES = ['feasible', 'needs-attention', 'not-feasible', 'unknown'];
const byId = id => PATTERN_PRESETS.find(p => p.id === id);

test('fitChart separates a long-float card from a clean checkerboard', () => {
  const longFloat = [new Array(20).fill(1)]; // 20 > the Brother 9-needle bridge
  assert.equal(fitChart(longFloat, { mode: 'fair_isle', profile: 'brother_standard_24' }).status, 'needs-attention');
  const checker = [[1, 0, 1, 0], [0, 1, 0, 1], [1, 0, 1, 0], [0, 1, 0, 1]];
  assert.equal(fitChart(checker, { mode: 'fair_isle', profile: 'brother_standard_24' }).status, 'feasible');
});

test('the browser fit is content-aware, not a constant', () => {
  const tidy = fitPreset(byId('houndstooth_jacquard'), 'brother_standard_24');
  const wild = fitPreset(byId('reaction_diffusion_labyrinth'), 'brother_standard_24');
  assert.equal(tidy.status, 'feasible', 'a balanced 2-colour repeat should be clean');
  assert.equal(wild.status, 'needs-attention', 'a morphogen field has floats a punchcard cannot bridge');
  assert.ok(wild.metrics.longestFloat > tidy.metrics.longestFloat, 'the labyrinth must carry longer floats');
});

test('every preset evaluates to a well-formed fit on the default and bulky beds', () => {
  clearFitCache();
  for (const profileId of ['brother_standard_24', 'brother_bulky_24']) {
    for (const preset of PATTERN_PRESETS) {
      const fit = fitPreset(preset, profileId);
      assert.ok(STATUSES.includes(fit.status), `${preset.id} gave status ${fit.status}`);
      assert.ok(Number.isInteger(fit.score) && fit.score >= 0 && fit.score <= 100, `${preset.id} score ${fit.score}`);
      assert.equal(typeof fit.fitsBed, 'boolean', `${preset.id} fitsBed`);
      assert.ok(Array.isArray(fit.reasons), `${preset.id} reasons`);
      assert.ok(Number.isFinite(fit.metrics.longestFloat), `${preset.id} longestFloat`);
    }
  }
});

test('the advisor rubric and the browser agree: same card, same score', () => {
  // Reuse the shared scoring: a fair-isle card drawn directly and drawn via a preset must
  // score identically, which is the whole point of extracting chart-analysis + scoreIssues.
  const preset = byId('penrose_quasicrystal');
  const viaPreset = fitPreset(preset, 'silver_reed_standard_24');
  const viaChart = fitChart(preset.generate(preset.rows, preset.cols), { mode: preset.mode, profile: 'silver_reed_standard_24' });
  assert.equal(viaPreset.score, viaChart.score);
  assert.equal(viaPreset.status, viaChart.status);
});

test('a card wider than the bed is reported as a blocker, not a float note', () => {
  const preset = byId('nordic_star_jacquard');
  const huge = fitPreset(preset, 'brother_standard_24', { width: 210 });
  assert.equal(huge.status, 'not-feasible');
  assert.equal(huge.fitsBed, false);
  assert.ok(huge.reasons.some(r => /wider/i.test(r)), 'expected a width blocker in the reasons');
});

test('universalFit marks float-heavy designs non-portable and short-float ones portable', () => {
  const wild = universalFit(byId('reaction_diffusion_labyrinth'));
  assert.equal(wild.portable, false, 'a 24-run float cannot knit on the 5-needle bulky bridge');
  // A float-free checkerboard clears even the tightest (bulky) bed, so it is portable everywhere.
  const checker = universalFit(byId('plain_weave'));
  assert.equal(checker.portable, true, 'a 1-st-repeat weave should clear every bed');
  assert.equal(checker.status, 'feasible');
  // Houndstooth's diagonal carries a genuine 6-st float — too long for the 5-needle bulky bed,
  // so honest portability says no even though it fits the standard machines.
  const houndstooth = universalFit(byId('houndstooth_jacquard'));
  assert.equal(houndstooth.portable, false, 'a 6-st float legitimately fails the bulky bridge');
});

test('fits are deterministic and cache-stable across repeated renders', () => {
  const preset = byId('voronoi_cells');
  const a = fitPreset(preset, 'brother_standard_24');
  const b = fitPreset(preset, 'brother_standard_24');
  assert.deepEqual(a, b, 'same preset + profile redrew differently');
});

test('an unknown machine id degrades gracefully instead of throwing', () => {
  const fit = fitPreset(byId('rule30_chaos'), 'totally-not-a-machine');
  assert.ok(STATUSES.includes(fit.status), 'fell back to a default profile and produced a real fit');
});

test('every machine profile in the registry produces a valid fit for a fixed preset', () => {
  const preset = byId('moiré_interference') || byId('argyle_diamond');
  for (const id of Object.keys(MACHINE_PROFILES)) {
    const fit = fitPreset(preset, id);
    assert.ok(STATUSES.includes(fit.status), `${id} → ${fit.status}`);
  }
});

test('the browser colour gate agrees with the advisor: too many colours blocks a punchcard only', () => {
  const jacquard = [[0, 1, 2, 3]]; // four distinct yarns — more than any punchcard feeder
  assert.equal(fitChart(jacquard, { mode: 'fair_isle', profile: 'brother_standard_24' }).status, 'not-feasible');
  assert.equal(fitChart(jacquard, { mode: 'fair_isle', profile: 'brother_maxi_60' }).status, 'feasible');
  // universalFit folds the strictest (two-feeder) envelope in, so a 4-colour card is never portable.
  const jac = [[0, 1, 2, 3]];
  const preset = { id: 'probe_jac', mode: 'fair_isle', rows: 1, cols: 4, generate: () => jac.map(r => r.slice()) };
  assert.equal(universalFit(preset).portable, false, 'more colours than the fleet has feeders is not portable');
});

test('no shipped preset trips the two-feeder colour gate (regression guard)', () => {
  // Every built-in pattern is at most two colours, so enabling the gate must not have
  // retroactively marked any browser badge non-feasible on the default punchcard bed.
  clearFitCache();
  for (const preset of PATTERN_PRESETS) {
    const fit = fitPreset(preset, 'brother_standard_24');
    assert.ok(!fit.reasons.some(r => /colours|feeders/i.test(r)), `${preset.id} unexpectedly exceeds two colours`);
  }
});
