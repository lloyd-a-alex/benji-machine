// The Pareto optimiser's trade-off view (js/compiler/optimise/summary.js) and the surface it
// feeds (the KNITCAT V2 Compiler dock + the Ctrl+K palette).
//
// The optimiser had always computed the frontier; this is the read-only layer that shows it and
// lets the knitter *choose* what to optimise for. The maths is deliberately NOT re-implemented in
// the assertions below — priorities are checked against `weightedPick` itself so the view can
// never drift from the engine it is presenting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { summariseOptimisation, normalisePriority, PRIORITY_OPTIONS } from '../js/compiler/optimise/summary.js';
import { weightedPick } from '../js/compiler/optimise/pareto.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// Three candidate orderings, each best on exactly one axis and worse on the other two — so the
// frontier is all three and the trade-off is unmistakable. Cost is minimised on every axis.
function fixture(chosen) {
  const A = { objective: 'time', time: 8, yarn: 120, appearance: 120, changes: ['[time] merged 2 passes'] };
  const B = { objective: 'yarn', time: 120, yarn: 8, appearance: 140, changes: ['[yarn] grouped colour'] };
  const C = { objective: 'appearance', time: 140, yarn: 140, appearance: 8, changes: ['[appearance] matched repeat'] };
  const candidates = [A, B, C];
  return {
    candidates,
    frontier: candidates,
    chosen: chosen === 'C' ? C : chosen === 'B' ? B : A,
    changes: ['merged 2 passes', 'grouped colour', 'matched repeat', '', 42],
    metrics: { time: 8, yarn: 120, appearance: 120 },
  };
}

test('no optimisation to describe yields no view (so the panel renders nothing)', () => {
  assert.equal(summariseOptimisation(null), null);
  assert.equal(summariseOptimisation(undefined), null);
  assert.equal(summariseOptimisation({}), null);
  assert.equal(summariseOptimisation({ candidates: [] }), null);
  assert.equal(summariseOptimisation({ candidates: [{ error: 'boom' }, null] }), null);
});

test('it is total: a candidate with garbage costs is read as zero, never thrown', () => {
  const s = summariseOptimisation({ candidates: [{ objective: 'weird', time: 'x', yarn: null }] });
  assert.ok(s);
  assert.equal(s.totals.time, 0);
  assert.equal(s.totals.yarn, 0);
});

test('the balanced option is the yardstick, so it reports a zero trade-off against itself', () => {
  const s = summariseOptimisation(fixture());
  const balanced = s.options.find((o) => o.priority === 'balanced');
  assert.ok(balanced);
  assert.deepEqual(balanced.delta, { time: 0, yarn: 0, appearance: 0 });
  assert.match(balanced.blurb, /^same time · same yarn · same joins$/);
});

test('least-yarn genuinely trades time for yarn, and vice versa', () => {
  const s = summariseOptimisation(fixture());
  const yarn = s.options.find((o) => o.priority === 'yarn');
  const appearance = s.options.find((o) => o.priority === 'appearance');
  // The least-yarn ordering cuts yarn below the balanced baseline but costs more time.
  assert.ok(yarn.yarn < s.totals.yarn, 'yarn option uses less yarn than baseline');
  assert.ok(yarn.delta.yarn < 0 && yarn.delta.time > 0, 'less yarn, more time');
  // The best-looking ordering cuts joins but costs time.
  assert.ok(appearance.appearance < s.totals.appearance, 'appearance option is tidier');
  assert.ok(appearance.delta.appearance < 0 && appearance.delta.time > 0, 'tidier, slower');
});

test('the options mirror the engine exactly — isChosen tracks weightedPick, not a guess', () => {
  const opt = fixture();
  const s = summariseOptimisation(opt);
  for (const o of PRIORITY_OPTIONS) {
    const expected = weightedPick(opt.candidates, o.priority);
    const row = s.options.find((r) => r.priority === o.priority);
    // Compare by value: weightedPick returns a copy, so the compiler's `chosen` is never the same
    // reference as a candidate — matching must be on objective + the three costs, not identity.
    const matchesChosen = expected.objective === opt.chosen.objective
      && expected.time === opt.chosen.time && expected.yarn === opt.chosen.yarn && expected.appearance === opt.chosen.appearance;
    assert.equal(row.isChosen, matchesChosen, `isChosen for ${o.priority}`);
  }
  // Fixture defaults chosen = the time candidate, which balanced & fast both select → chosen is
  // reported as the first matching priority (balanced) so the header stays stable.
  assert.equal(s.chosenPriority, 'balanced');
});

test('a different compiler choice is reflected in chosenPriority', () => {
  assert.equal(summariseOptimisation(fixture('C')).chosenPriority, 'appearance');
  assert.equal(summariseOptimisation(fixture('B')).chosenPriority, 'yarn');
});

test('the frontier and the scatter points both carry every non-dominated candidate', () => {
  const s = summariseOptimisation(fixture());
  assert.equal(s.frontier.length, 3);
  assert.deepEqual(s.frontier.map((f) => f.objective).sort(), ['appearance', 'time', 'yarn']);
  assert.equal(s.axes.length, 3);
  // Normalised to [0..1]: the cheapest-on-an-axis candidate sits at 0, the dearest at 1.
  for (const p of s.axes) {
    for (const axis of ['time', 'yarn', 'appearance']) {
      assert.ok(p[axis] >= 0 && p[axis] <= 1, `${axis} normalised into range`);
    }
    assert.equal(p.onFrontier, true, 'all three are non-dominated here');
  }
});

test('change notes are cleaned to the strings the optimiser actually wrote', () => {
  const s = summariseOptimisation(fixture());
  assert.deepEqual(s.changeNotes, ['merged 2 passes', 'grouped colour', 'matched repeat']);
});

test('the summary is deterministic across calls', () => {
  const a = summariseOptimisation(fixture());
  const b = summariseOptimisation(fixture());
  assert.deepEqual(a, b);
});

test('normalisePriority folds the aliases the weights already honour', () => {
  assert.equal(normalisePriority('time'), 'fast');
  assert.equal(normalisePriority('cheap'), 'yarn');
  assert.equal(normalisePriority('economy'), 'yarn');
  assert.equal(normalisePriority('pretty'), 'appearance');
  assert.equal(normalisePriority('balanced'), 'balanced');
  assert.equal(normalisePriority('nonsense'), 'balanced');
  assert.equal(normalisePriority(undefined), 'balanced');
  const weights = { time: 2, yarn: 1, appearance: 9 };
  assert.equal(normalisePriority(weights), weights, 'a custom weight object passes straight through');
});

// ─── wiring: the dormant engine now has a face ──────────────────────────────

test('the V2 Compiler dock imports and renders the optimiser trade-off', () => {
  const panels = read('js/v2/panels.js');
  assert.match(panels, /from '\.\.\/compiler\/optimise\/summary\.js'/, 'summary must be wired into the panel');
  assert.match(panels, /summariseOptimisation\(c\.optimisation\)/);
  assert.match(panels, /data-priority/, 'the priority buttons are rendered');
  assert.match(panels, /setOptimisePriority/, 'clicking a priority drives the controller');
  assert.match(panels, /renderParetoScatter/, 'the frontier is plotted, not just tallied');
});

test('the controller feeds the chosen priority into the fused pipeline', () => {
  const panels = read('js/v2/panels.js');
  assert.match(panels, /runFullPipeline\(built\.project,\s*\{\s*priority:\s*state\.priority\s*\}\s*\)/);
  assert.match(panels, /setOptimisePriority\(priority\)\s*\{\s*state\.priority\s*=\s*normalisePriority\(priority\);\s*refresh\(\)/);
});

test('the optimiser is findable from the command palette', () => {
  const app = read('js/app.js');
  assert.match(app, /Optimise passes — fewest \(fastest\)/);
  assert.match(app, /Optimise passes — least yarn/);
  assert.match(app, /Optimise passes — best looking/);
  assert.match(app, /setOptimisePriority\?\.\(p\)/, 'palette entries drive the same controller knob');
});

test('summary.js is reachable in the module graph (imported by the panel, not dead source)', () => {
  // The graph test forbids an un-imported module; this pins the specific edge that keeps the
  // optimiser view alive rather than quietly orphaned like the frontier maths was before.
  assert.match(read('js/v2/panels.js'), /import \{ summariseOptimisation[^)]*\} from '\.\.\/compiler\/optimise\/summary\.js'/);
});
