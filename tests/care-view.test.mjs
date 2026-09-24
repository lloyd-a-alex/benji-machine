// KNITCAT V2 -- the garment-care read battery.
//
// Proves care-view is a faithful, total, DOM-free consumer of the careInstructions engine
// and that the structured wash/dry/iron/symbol regimen is surfaced in the Yarn panel with
// full command/menu/palette discoverability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { summariseCare, careToText } from '../js/yarn/care-view.js';
import { projectFromKnitScript, runFullPipeline, DEFAULT_KNITSCRIPT } from '../js/v2/index.js';

/* -- garbage tolerance -- */

test('summariseCare is total: null/garbage yields null', () => {
  for (const junk of [null, undefined, 42, '', '   ', [], {}]) {
    assert.equal(summariseCare(junk), null, `${JSON.stringify(junk)} -> null`);
  }
});

/* -- animal fibre (wool) -- */

test('plain wool -> hand wash cool 20 C, dry flat, no iron, no tumble', () => {
  const s = summariseCare([{ name: 'wool', percent: 100 }]);
  assert.ok(s && s.ok);
  assert.equal(s.wash, 'hand wash cool');
  assert.equal(s.washTempC, 20);
  assert.equal(s.dry, 'dry flat');
  assert.equal(s.iron, 'none');
  assert.equal(s.tumble, false);
  assert.equal(s.bleach, false, 'engine always says bleach=false');
  assert.equal(s.tone, 'warn', 'hand wash = warn');
  assert.ok(s.symbols.length >= 4, 'standard symbol set emitted');
  assert.match(s.text, /Hand wash cool at 20/);
});

/* -- plant fibre (cotton) -- */

test('cotton -> machine wash 40 C, tumble-low-or-line, iron low, tone ok', () => {
  const s = summariseCare([{ name: 'cotton', percent: 100 }]);
  assert.ok(s && s.ok);
  assert.equal(s.wash, 'machine wash');
  assert.equal(s.washTempC, 40);
  assert.equal(s.dry, 'dry flat', 'recovery 0.2 < 0.6 → dry flat');
  assert.equal(s.iron, 'low');
  assert.equal(s.tone, 'ok', 'machine wash -> ok');
});

/* -- superwash merino -- */

test('superwash -> machine gentle 30 C, dry flat (animal recovery)', () => {
  const s = summariseCare([{ name: 'superwash', percent: 50 }, { name: 'merino', percent: 50 }]);
  assert.ok(s && s.ok);
  assert.equal(s.wash, 'machine wash gentle');
  assert.equal(s.washTempC, 30);
  assert.equal(s.dry, 'dry flat', 'animal -> dry flat');
  assert.match(s.headline, /Machine wash gentle/);
});

/* -- dry-clean override via behaviour -- */

test('high-felting high-drape behaviour makes it dry-cleanable (tone info)', () => {
  const s = summariseCare([{ name: 'wool', percent: 100 }], { felting: 0.8, drape: 0.85 });
  assert.ok(s && s.ok);
  assert.equal(s.dryClean, true);
  assert.equal(s.tone, 'info', 'not hand -> info when dryClean');
  assert.match(s.text, /Dry cleanable/);
});

/* -- the printable card -- */

test('careToText renders a structured card, ends in a newline', () => {
  const s = summariseCare([{ name: 'wool', percent: 100 }]);
  const text = careToText(s);
  assert.match(text, /^Garment care\n=+/);
  assert.match(text, /Wash: hand wash cool \(20/);
  assert.match(text, /Bleach: no/);
  assert.match(text, /Dry: dry flat/);
  assert.match(text, /Iron: do not iron/);
  assert.match(text, /Symbols: /);
  assert.ok(text.endsWith('\n'));
});

test('careToText(null) yields a helpful prompt', () => {
  assert.equal(careToText(null), 'Declare a yarn with a fibre composition to generate care instructions.\n');
});

/* -- the real pipeline (contract) -- */

test('the real yarn report produces a care summary via the default pipeline', () => {
  const project = projectFromKnitScript(DEFAULT_KNITSCRIPT).project;
  const report = runFullPipeline(project);
  const primary = report.yarn && report.yarn.yarns && report.yarn.yarns[0];
  assert.ok(primary && primary.yarn, 'default KnitScript declares at least one yarn');
  const s = summariseCare(report.yarn.behavior && report.yarn.behavior.fibers, report.yarn.behavior);
  assert.ok(s && s.ok, 'the live yarn fiber composition produces care instructions');
  assert.match(s.wash, /wash/i);
  assert.ok(s.washTempC >= 20 && s.washTempC <= 40);
});

/* -- DOM-free + module contract -- */

test('care-view is DOM-free and imports the care engine', () => {
  const src = readFileSync(new URL('../js/yarn/care-view.js', import.meta.url), 'utf8');
  assert.ok(!/\b(document|window|navigator|localStorage)\b/.test(src), 'no DOM access');
  assert.match(src, /import\s*\{[^}]*careInstructions[^}]*\}\s*from\s*'\.\/care\.js'/, 'imports the care engine');
});

/* -- wiring / discoverability -- */

test('garment care is fused into the V2 Yarn panel', () => {
  const panels = readFileSync(new URL('../js/v2/panels.js', import.meta.url), 'utf8');
  assert.match(panels, /from '\.\.\/yarn\/care-view\.js'/, 'panels imports the view');
  assert.match(panels, /const care = summariseCare\(y\.behavior && y\.behavior\.fibers/);
  assert.match(panels, /\$\{renderCare\(care\)\}/, 'rendered in yarn(state)');
  assert.match(panels, /data-copy-care/, 'copy button present');
});

test('v2.care is declared, dispatched, menued and paletted', () => {
  const commands = readFileSync(new URL('../js/ui/commands.js', import.meta.url), 'utf8');
  assert.match(commands, /case 'v2\.care':/);
  assert.match(commands, /app\.v2 && app\.v2\.open\('yarn'\)/);

  const menubar = readFileSync(new URL('../js/ui/menubar.js', import.meta.url), 'utf8');
  assert.match(menubar, /'v2\.care'/);
  assert.match(menubar, /Garment care/);

  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /runCommand\('v2\.care'\)/);
});
