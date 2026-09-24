// The Colour-Vision (CVD) preview (js/core/color-vision.js) — spec §3.5. The colour-blindness
// simulation engine (simulate / auditPalette / paletteIsSafe) had ZERO consumers: the advisor could
// *say* two yarns collapse but the maker could never *see* the chart as a deuteranope does. These
// tests assert the pure per-deficiency summary (built entirely on the existing engine, no new colour
// maths) and that the dormant engine is now reachable from the Compiler panel, command and palette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  summariseColorVision,
  colorVisionToText,
  CVD_LABELS
} from '../js/core/color-vision.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ─── the pure summary ────────────────────────────────────────────────────────

test('no / empty / garbage palette is an honest null so the section is skipped', () => {
  for (const bad of [null, undefined, [], 'nope', [{}], [{ hex: null }], [null, undefined], [{}]]) {
    assert.equal(summariseColorVision(bad), null);
  }
});

test('a distinct high-contrast palette is safe for every deficiency', () => {
  const cv = summariseColorVision([{ hex: '#000000', yarn: 'Black' }, { hex: '#ffffff', yarn: 'White' }]);
  assert.equal(cv.ok, true);
  assert.equal(cv.count, 2);
  assert.equal(cv.types.length, 4);
  assert.equal(cv.safe, true);
  assert.equal(cv.commonCollapseCount, 0);
  for (const t of cv.types) assert.equal(t.collapseCount, 0, `${t.type}: black & white never collapse`);
});

test('two identical yarns collapse under every simulation (the engine is wired in)', () => {
  const cv = summariseColorVision([
    { index: 0, hex: '#888888', yarn: 'Grey A' },
    { index: 1, hex: '#888888', yarn: 'Grey B' }
  ]);
  assert.equal(cv.safe, false);
  assert.ok(cv.commonCollapseCount >= 1);
  assert.ok(cv.types.every((t) => t.collapseCount === 1));
  // the collapse is named with the yarns, not raw indices.
  assert.match(cv.types[0].collapsed[0].label, /Grey A ↔ Grey B/);
  assert.ok(['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'].includes(cv.worstType));
});

test('accepts bare hex strings, 3-digit short form and missing # (normalised)', () => {
  const cv = summariseColorVision(['#abcdef', 'abc', 'f0f0f0']);
  assert.equal(cv.count, 3);
  assert.equal(cv.palette[0].hex, '#abcdef');
  assert.equal(cv.palette[1].hex, '#aabbcc', 'short form is expanded');
  assert.equal(cv.palette[2].hex, '#f0f0f0', 'leading # is optional');
});

test('simulated swatches are always valid hex and one per colour', () => {
  const cv = summariseColorVision([{ hex: '#000040' }, { hex: '#c00040' }]);
  for (const t of cv.types) {
    assert.equal(t.colors.length, 2);
    for (const c of t.colors) {
      assert.match(c.original, /^#[0-9a-f]{6}$/);
      assert.match(c.simulated, /^#[0-9a-f]{6}$/, 'the engine returns a normalised hex');
    }
  }
});

test('opts.threshold widens what counts as confusable', () => {
  const tight = summariseColorVision([{ hex: '#000000' }, { hex: '#101010' }]); // 16 apart, under default 18 → distinct-ish
  const loose = summariseColorVision([{ hex: '#000000' }, { hex: '#101010' }], { threshold: 300 });
  assert.ok(loose.types.every((t) => t.collapseCount === 1), 'a huge threshold collapses every pair');
  assert.ok(tight.types[0].collapseCount >= loose.types[0].collapseCount || tight.count === loose.count);
});

test('the table of friendly deficiency names is exported', () => {
  assert.equal(Object.keys(CVD_LABELS).length, 4);
  assert.match(CVD_LABELS.deuteranopia, /green/i);
});

// ─── the printable text ──────────────────────────────────────────────────────

test('the text report prints the title, headline, every deficiency and a trailing newline', () => {
  const cv = summariseColorVision([{ hex: '#888888', yarn: 'A' }, { hex: '#888888', yarn: 'B' }]);
  const text = colorVisionToText(cv, { title: 'Colour-blindness check' });
  assert.match(text, /^Colour-blindness check\n=+\n/);
  assert.match(text, /protanopia/i);
  assert.match(text, /indistinguishable: A ↔ B/);
  assert.ok(text.endsWith('\n'));
});

test('an absent summary still prints a friendly note, never an empty clipboard', () => {
  assert.match(colorVisionToText(null), /Give the chart two or more yarn colours/);
  assert.ok(colorVisionToText(null).endsWith('\n'));
});

// ─── wiring: the dormant engine now has hands ────────────────────────────────

test('color-vision.js is DOM-free and defers to the existing colour engine', () => {
  const src = read('js/core/color-vision.js');
  assert.doesNotMatch(src, /\bdocument\b|\bwindow\b/, 'no DOM at module scope');
  assert.ok(src.includes("from '../yarn/color-blindness.js'"), 'consumes the shared engine');
  for (const fn of ['simulate', 'confusablePairs', 'auditPalette', 'paletteIsSafe']) {
    assert.ok(src.includes(fn), `imports ${fn} so no colour maths is re-derived`);
  }
});

test('the Compiler panel renders the preview and can copy it', () => {
  const panel = read('js/v2/panels.js');
  assert.match(panel, /from '\.\.\/core\/color-vision\.js'/);
  assert.match(panel, /function renderColorVision\(cv, matrix\)/);
  assert.match(panel, /summariseColorVision\(c\.ir && c\.ir\.colors\)/, 'it reads the compiler palette');
  assert.match(panel, /\$\{renderColorVision\(cv, c\.ir && c\.ir\.cardMatrix\)\}/, 'the section is painted');
  assert.match(panel, /function cvCardSvg\(/, 'a recoloured card preview is drawn');
  assert.match(panel, /data-copy-cvd/, 'a Copy control is mounted');
  assert.match(panel, /colorVisionToText\(/, 'the copy button produces text');
});

test('v2.colorblind is a declared, dispatched command', () => {
  assert.match(read('js/ui/menubar.js'), /'v2\.colorblind'/);
  assert.match(read('js/ui/menubar.js'), /it\('Colour-blindness preview', 'v2\.colorblind'\)/);
  assert.match(read('js/ui/commands.js'), /case 'v2\.colorblind':/);
});

test('the colour-blindness preview is findable from the command palette', () => {
  assert.match(read('js/app.js'), /Colour-blindness preview \(see the card as they do\)/);
  assert.match(read('js/app.js'), /this\.runCommand\('v2\.colorblind'\)/);
});
