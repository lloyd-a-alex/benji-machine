// The Explainable Derivation Trail (js/compiler/derive-summary.js) — spec §4.7. `derive` has always
// recorded *why* every headline number is what it is (`ir.decisions`: formula + substituted
// arithmetic + inputs + downstream effects) but the trail had ZERO consumers, so the compiler's most
// trust-building output went unseen. These tests assert the pure summary and that the dormant trail
// is now actually reachable from the Compiler panel, command and palette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  summariseDerivations,
  derivationToText,
  derivationLabel,
  DERIVATION_LABELS
} from '../js/compiler/derive-summary.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// A decision trail shaped exactly like derive.js emits it.
const castOn = {
  node: 'pattern.castOn',
  value: 212,
  formula: 'round(garment.finishedBust × gauge.stitchesPerCm) → round to multiple of 4',
  substitute: 'round(96 × 2.2) = 211 → 212',
  inputs: { 'garment.finishedBust': 96, 'gauge.stsPerCm': 2.2, 'body.bust': 88, 'ease.chest': 8 },
  affects: ['garment.bodyRows', 'pattern.bindOff']
};
const bodyRows = {
  node: 'garment.bodyRows',
  value: 180,
  formula: 'round(garment.length × gauge.rowsPerCm)',
  substitute: 'round(58 × 3)',
  inputs: { 'garment.length': 58 }
};

// ─── the pure summary ────────────────────────────────────────────────────────

test('no IR / empty / garbage decisions is an honest null so the section is skipped', () => {
  for (const bad of [null, undefined, {}, { decisions: null }, { decisions: [] }, { decisions: 'nope' }]) {
    assert.equal(summariseDerivations(bad), null);
  }
});

test('a well-formed trail becomes display-ready rows with friendly labels', () => {
  const s = summariseDerivations({ decisions: [castOn, bodyRows] });
  assert.equal(s.ok, true);
  assert.equal(s.count, 2);
  assert.equal(s.rows.length, 2);

  const first = s.rows[0];
  assert.equal(first.node, 'pattern.castOn');
  assert.equal(first.label, 'Cast on');
  assert.equal(first.value, 212);
  assert.equal(first.substitute, 'round(96 × 2.2) = 211 → 212');

  const inputLabels = first.inputs.map((i) => i.label);
  assert.ok(inputLabels.includes('Finished bust'), 'inputs are labelled');
  const bust = first.inputs.find((i) => i.node === 'garment.finishedBust');
  assert.equal(bust.value, 96);

  // affects node ids are turned into readable labels too.
  assert.ok(first.affects.includes('Body rows'), 'downstream nodes are labelled');
});

test('labels come from the table, and unknown ids are humanised from their leaf', () => {
  assert.equal(derivationLabel('pattern.castOn'), 'Cast on');
  assert.equal(derivationLabel('ease.chest'), 'Chest ease');
  assert.equal(derivationLabel('garment.totalLength'), 'Total Length', 'unknown leaf is humanised');
  assert.equal(derivationLabel(''), '', 'empty id yields no crash');
  assert.ok(DERIVATION_LABELS['garment.bodyRows'], 'the table is exported and populated');
});

test('non-finite numbers become null (an honest em-dash, never NaN)', () => {
  const s = summariseDerivations({ decisions: [{ node: 'pattern.castOn', value: NaN, inputs: { 'gauge.stsPerCm': Infinity } }] });
  assert.equal(s.rows[0].value, null);
  assert.equal(s.rows[0].inputs[0].value, null);
});

test('malformed decisions are dropped, not surfaced as blanks', () => {
  const s = summariseDerivations({ decisions: [castOn, null, 'nope', { noNode: true }, 42] });
  assert.equal(s.count, 1, 'only the one valid decision survives');
  assert.equal(s.rows[0].node, 'pattern.castOn');
});

// ─── the printable text ──────────────────────────────────────────────────────

test('the text sheet prints the title, every number and a trailing newline', () => {
  const s = summariseDerivations({ decisions: [castOn, bodyRows] });
  const text = derivationToText(s, { title: 'Why these numbers' });
  assert.match(text, /^Why these numbers\n=+\n/);
  assert.match(text, /Cast on = 212/);
  assert.match(text, /worked:\s+round\(96 × 2\.2\) = 211 → 212/);
  assert.match(text, /inputs:\s+Finished bust = 96/);
  assert.match(text, /affects:\s+Body rows/);
  assert.match(text, /Body rows = 180/);
  assert.ok(text.endsWith('\n'));
});

test('an absent summary still prints a friendly note, never an empty clipboard', () => {
  assert.match(derivationToText(null), /No derivation trail/);
  assert.ok(derivationToText({ rows: [] }).endsWith('\n'));
});

// ─── wiring: the dormant trail now has hands ─────────────────────────────────

test('derive-summary.js is DOM-free (importable under Node, no window/document)', () => {
  const src = read('js/compiler/derive-summary.js');
  assert.doesNotMatch(src, /\bdocument\b/, 'no DOM at module scope');
  assert.doesNotMatch(src, /\bwindow\b/);
});

test('the Compiler panel renders the trail and can copy it', () => {
  const panel = read('js/v2/panels.js');
  assert.match(panel, /from '\.\.\/compiler\/derive-summary\.js'/);
  assert.match(panel, /function renderDerivations\(d\)/);
  assert.match(panel, /summariseDerivations\(c\.ir\)/, 'it reads the IR the pipeline produced');
  assert.match(panel, /\$\{renderDerivations\(deriv\)\}/, 'the section is painted into the panel');
  assert.match(panel, /data-copy-derive/, 'a Copy control is mounted');
  assert.match(panel, /derivationToText\(/, 'the copy button produces printable text');
});

test('v2.derivation is a declared, dispatched command', () => {
  assert.match(read('js/ui/menubar.js'), /'v2\.derivation'/);
  assert.match(read('js/ui/menubar.js'), /it\('Why these numbers \(derivation\)', 'v2\.derivation'\)/);
  assert.match(read('js/ui/commands.js'), /case 'v2\.derivation':/);
});

test('the derivation trail is findable from the command palette', () => {
  assert.match(read('js/app.js'), /Why these numbers \(how the counts were derived\)/);
  assert.match(read('js/app.js'), /this\.runCommand\('v2\.derivation'\)/);
});
