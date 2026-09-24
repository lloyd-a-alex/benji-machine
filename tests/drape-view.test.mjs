// KNITCAT V2 — the drape read battery.
//
// Proves drape-view is a faithful, total, DOM-free presenter over the `fit.drape` result that
// DrapeSimulator already returns. Numbers are checked against the simulator's own documented
// shape (score 0..1, average ease in cm, per-panel heatmap of signed ease, tight spots where
// ease < 0). Wiring assertions guard the command / menu / palette surface so the feature stays
// discoverable.
//
//   node --test "tests/drape-view.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { summariseDrape, drapeToText, drapeVerdict } from '../js/fit/drape-view.js';
import { projectFromKnitScript, FitEngine, DEFAULT_KNITSCRIPT } from '../js/v2/index.js';

/* ─────────────────────────── garbage tolerance ─────────────────────────── */

test('summariseDrape is total: bad or empty input yields null', () => {
  for (const junk of [null, undefined, 42, 'str', [], {}, { panels: [] }, { panels: null }]) {
    assert.equal(summariseDrape(junk), null, `${JSON.stringify(junk)} must yield null`);
  }
});

/* ─────────────────────────── verdict buckets ─────────────────────────── */

test('drapeVerdict buckets the score the way the spec labels them', () => {
  assert.equal(drapeVerdict(0.85).label, 'Fluid');
  assert.equal(drapeVerdict(0.7).label, 'Fluid');
  assert.equal(drapeVerdict(0.65).label, 'Balanced');
  assert.equal(drapeVerdict(0.4).label, 'Balanced');
  assert.equal(drapeVerdict(0.3).label, 'Stiff');
  assert.equal(drapeVerdict(0.15).label, 'Boardy');
  assert.equal(drapeVerdict(null).label, 'Unknown');
  assert.equal(drapeVerdict(NaN).label, 'Unknown');
});

/* ─────────────────────────── the balanced summary ─────────────────────────── */

test('a fluid/balanced draft with no tight spots reports ok tone', () => {
  const s = summariseDrape({
    drapeScore: 0.65,
    averageEase: 4.2,
    panels: [{ id: 'front', heatmap: [0.5, 1.2, 3.4] }],
    tightSpots: []
  });
  assert.ok(s && s.ok);
  assert.equal(s.score, 0.65);
  assert.equal(s.verdict, 'Balanced');
  assert.equal(s.tone, 'ok');
  assert.equal(s.averageEase, 4.2);
  assert.equal(s.panelCount, 1);
  assert.equal(s.panels[0].rows, 3);
  assert.equal(s.panels[0].min, 0.5);
  assert.equal(s.panels[0].max, 3.4);
  assert.equal(s.panels[0].mean, 1.7); // (0.5+1.2+3.4)/3
  assert.equal(s.tightSpotCount, 0);
  assert.match(s.headline, /Balanced/);
  assert.match(s.headline, /no tight spots/);
});

/* ─────────────────────────── tone escalation with tight spots ─────────────────────────── */

test('a boardy score with tight rows escalates tone & lists pinches, tightest first', () => {
  const s = summariseDrape({
    drapeScore: 0.15,
    averageEase: 2.0,
    panels: [{ id: 'back', heatmap: [0.5, -0.3, 1.2] }],
    tightSpots: [
      { panel: 'back', row: 5, easeCm: -0.4 },
      { panel: 'back', row: 9, easeCm: -1.2 },
      { panel: 'back', row: 3, easeCm: 0.2 } // positive ease → not tight, must be filtered out
    ]
  });
  assert.ok(s && s.ok);
  assert.equal(s.tone, 'bad', 'score under 0.3 is bad');
  assert.equal(s.verdict, 'Boardy');
  assert.equal(s.tightSpotCount, 2, 'only the negative-ease rows count as tight');
  assert.deepEqual(s.tightSpots.map((t) => t.easeCm), [-1.2, -0.4], 'sorted tightest first');
  assert.match(s.headline, /2 tight spots/);
});

test('a mid score with a single tight row is warn, not bad', () => {
  const s = summariseDrape({
    drapeScore: 0.5,
    averageEase: 3,
    panels: [{ id: 'x', heatmap: [-0.1, 0.5] }],
    tightSpots: [{ panel: 'x', row: 0, easeCm: -0.1 }]
  });
  assert.equal(s.tone, 'warn', 'any tight row cancels the ok verdict');
  assert.equal(s.tightSpotCount, 1);
});

/* ─────────────────────────── heat-map edge cases ─────────────────────────── */

test('a heatmap with junk values is cleaned to finite numbers before stats', () => {
  const s = summariseDrape({
    panels: [{ id: 'p', heatmap: ['a', null, undefined, NaN, 0.3, '', 2, {}] }]
  });
  assert.equal(s.panels[0].rows, 2);
  assert.equal(s.panels[0].min, 0.3);
  assert.equal(s.panels[0].max, 2);
  assert.equal(s.panels[0].mean, 1.15);
});

test('an empty heatmap still lists the panel, with nulls rather than a throw', () => {
  const s = summariseDrape({ drapeScore: 0.6, panels: [{ id: 'flat', heatmap: [] }], tightSpots: [] });
  assert.equal(s.panels[0].rows, 0);
  assert.equal(s.panels[0].mean, null);
  assert.equal(s.panels[0].min, null);
});

test('a null score falls back gracefully to Unknown / n/a', () => {
  const s = summariseDrape({ panels: [{ id: 'p', heatmap: [0.5] }] });
  assert.equal(s.score, null);
  assert.equal(s.verdict, 'Unknown');
  assert.match(s.headline, /n\/a/);
  assert.equal(s.averageEase, null);
});

/* ─────────────────────────── the printable sheet ─────────────────────────── */

test('drapeToText emits a titled sheet with panels, tight spots, and always ends in a newline', () => {
  const s = summariseDrape({
    drapeScore: 0.2,
    averageEase: 1.8,
    panels: [{ id: 'sleeve', heatmap: [-0.6, 0.3, 1.5] }],
    tightSpots: [{ panel: 'sleeve', row: 12, easeCm: -0.4 }]
  });
  const text = drapeToText(s);
  assert.match(text, /^Drape report\n=+/);
  assert.match(text, /Boardy/);
  assert.match(text, /Per-panel ease heatmap[\s\S]*sleeve · 3 row\(s\) · mean 0\.4 · min -0\.6 · max 1\.5/);
  assert.match(text, /Tight spots \(where the garment will pinch\)\n  sleeve row 12: -0\.4 cm/);
  assert.ok(text.endsWith('\n'));
});

test('drapeToText tells you when the fabric clears the body everywhere', () => {
  const clean = summariseDrape({ drapeScore: 0.8, averageEase: 5, panels: [{ id: 'a', heatmap: [1, 2] }], tightSpots: [] });
  const text = drapeToText(clean, { title: 'My drape sheet' });
  assert.match(text, /^My drape sheet\n=+/);
  assert.match(text, /No tight spots — the fabric clears the body everywhere\./);
  assert.ok(text.endsWith('\n'));
});

test('drapeToText(null) is a helpful prompt, never a crash', () => {
  assert.equal(drapeToText(null), 'Simulate a garment in the Fit panel to see how the fabric will hang.\n');
});

/* ─────────────────────────── the real Fit draft (contract) ─────────────────────────── */

test('it reads the real draftFromProject drape result end-to-end', () => {
  const project = projectFromKnitScript(DEFAULT_KNITSCRIPT).project;
  const fit = FitEngine.draftFromProject(project);
  const s = summariseDrape(fit.drape);
  assert.ok(s && s.ok, 'the live draft produces a drape summary');
  assert.ok(s.score != null && s.score >= 0 && s.score <= 1, `drapeScore must lie in 0..1, got ${s.score}`);
  assert.ok(s.panelCount >= 1, 'at least one panel came back');
  assert.ok(s.panels.every((p) => typeof p.id === 'string' && Number.isFinite(p.rows)));
  assert.ok(['Fluid', 'Balanced', 'Stiff', 'Boardy'].includes(s.verdict));
  assert.ok(['ok', 'warn', 'bad'].includes(s.tone));
});

/* ─────────────────────────── DOM-free + module contract ─────────────────────────── */

test('drape-view is DOM-free and never re-runs the physics', () => {
  const src = readFileSync(new URL('../js/fit/drape-view.js', import.meta.url), 'utf8');
  assert.ok(!/\b(document|window|navigator|localStorage)\b/.test(src), 'must not touch the DOM');
  assert.ok(!/new\s+DrapeSimulator/.test(src), 'must NOT re-simulate — that would double the work');
  assert.ok(!/from '\.\/(mesh|drape)\.js'/.test(src), 'has no engine dependencies, only labels the summary');
});

/* ─────────────────────────── wiring / discoverability ─────────────────────────── */

test('the drape read is fused into the V2 Fit panel', () => {
  const panels = readFileSync(new URL('../js/v2/panels.js', import.meta.url), 'utf8');
  assert.match(panels, /from '\.\.\/fit\/drape-view\.js'/, 'panels imports the view module');
  assert.match(panels, /const dr = summariseDrape\(fit\.drape\);/, 'fit(state) computes the summary');
  assert.match(panels, /\$\{renderDrape\(dr\)\}/, 'fit(state) renders the section');
  assert.match(panels, /data-copy-drape/, 'a copy button is present');
  assert.match(panels, /drapeToText\(summariseDrape\(fit && fit\.drape\)\)/, 'the copy handler emits the sheet');
});

test('v2.drape is declared, dispatched, menued and paletted', () => {
  const commands = readFileSync(new URL('../js/ui/commands.js', import.meta.url), 'utf8');
  assert.match(commands, /case 'v2\.drape':/, 'runCommand handles v2.drape');
  assert.match(commands, /app\.v2 && app\.v2\.open\('fit'\);[\s\S]*Drape simulation/, 'the command opens the Fit dock and points at the section');

  const menubar = readFileSync(new URL('../js/ui/menubar.js', import.meta.url), 'utf8');
  assert.match(menubar, /'v2\.drape'/, 'the action id is declared in MENUBAR_ACTIONS');
  assert.match(menubar, /it\('Drape simulation \(how it hangs\)', 'v2\.drape'\)/, 'a menu item points at it');

  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /runCommand\('v2\.drape'\)/, 'the Ctrl+K palette can launch it');
});
