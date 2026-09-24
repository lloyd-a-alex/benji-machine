// The Yarn Substitution view (js/yarn/substitution-view.js) — spec §3.4 / §11.4. The substitution
// engine (yarn/substitution.js) has always ranked the closest swaps for a yarn and produced the
// concrete pattern edits, but NOTHING in the running app consumed it — the Yarn Lab hinted at
// "substitution" and showed none of it. These tests assert the pure view/summary and that the dormant
// engine is now actually reachable from the Yarn panel, command and palette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  summariseSubstitution,
  bestSubstitutesFor,
  substitutionToText,
  RECOMMENDATION_TONE
} from '../js/yarn/substitution-view.js';
import { normalizeYarn } from '../js/yarn/database.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// Canonicalised yarns (so the engine's meterage/gauge fields are all present, as in the real panel).
const norm = (y) => normalizeYarn(y);
const ORIGINAL = norm({
  id: 'orig', brand: 'House', name: 'Main DK', weight: 'dk',
  gaugeRange: { stitches: [20, 20], rows: [28, 28] }, needleRange: { min: 4, max: 4.5 },
  meterage: { value: 125, unit: 'm', per: 50 }, fiber: [{ name: 'wool', percentage: 100 }],
  colors: [{ name: 'Oat', hex: '#d8c3a0' }]
});
const PERFECT = norm({
  id: 'perf', brand: 'Nearby', name: 'Perfect Swap', weight: 'dk',
  gaugeRange: { stitches: [20, 20], rows: [28, 28] }, needleRange: { min: 4, max: 4.5 },
  meterage: { value: 125, unit: 'm', per: 50 }, fiber: [{ name: 'wool', percentage: 100 }],
  colors: [{ name: 'Ecru', hex: '#e0d5bf' }]
});
const BAD = norm({
  id: 'bad', brand: 'Off', name: 'Bulky Wrong', weight: 'bulky',
  gaugeRange: { stitches: [12, 12], rows: [16, 16] }, needleRange: { min: 8, max: 10 },
  meterage: { value: 80, unit: 'm', per: 50 }, fiber: [{ name: 'cotton', percentage: 100 }],
  colors: [{ name: 'Ink', hex: '#101820' }]
});
const POOL = [BAD, PERFECT, norm({ id: 'orig', name: 'Self Duplicate' })];

// ─── the pure summary ────────────────────────────────────────────────────────

test('no usable original or no candidate left is an honest null so the section is skipped', () => {
  assert.equal(summariseSubstitution(null, POOL), null);
  assert.equal(summariseSubstitution(undefined, POOL), null);
  assert.equal(summariseSubstitution({}, []), null, 'empty candidate pool');
  assert.equal(summariseSubstitution(ORIGINAL, [null, 'nope', 42]), null, 'garbage-only pool');
});

test('the original yarn itself is never offered back as a substitute', () => {
  const s = summariseSubstitution(ORIGINAL, POOL);
  assert.ok(s, 'summary built');
  assert.ok(!s.picks.some((p) => p.id === 'orig'), 'a candidate sharing the original id is excluded');
  assert.equal(s.count, 2, 'only the two genuine alternatives survive');
});

test('candidates are ranked best-first by the substitution engine, never re-derived here', () => {
  const s = summariseSubstitution(ORIGINAL, POOL);
  assert.equal(s.best.name, 'Perfect Swap', 'the on-gauge wool ranks first');
  assert.equal(s.picks[0].recommendation, 'excellent');
  assert.equal(s.picks[0].tone, 'ok');
  assert.equal(s.picks[0].gaugeStitches, 0, 'a perfect gauge match shows no drift');
  assert.equal(s.picks[1].name, 'Bulky Wrong', 'the wrong-weight cotton sinks to the bottom');
  assert.equal(s.picks[1].recommendation, 'poor');
  assert.equal(s.picks[1].tone, 'bad');
  assert.ok(s.picks[1].gaugeStitches < 0, 'a looser substitute reports a negative gauge delta');
  assert.match(s.headline, /Closest swap: Nearby Perfect Swap/);
});

test('the best pick carries the concrete edits (needle + cast-on + yardage) that save the project', () => {
  const s = summariseSubstitution(ORIGINAL, [PERFECT, BAD], { stitchesPer10cm: 20, rowsPer10cm: 28, castOn: 120, totalRows: 300, meters: 400 });
  const kinds = s.best.adjustments.map((a) => a.kind);
  assert.ok(kinds.includes('needle'), 'a needle recommendation is always offered');
  assert.ok(kinds.includes('cast-on'), 'cast-on scales when the pattern count is supplied');
  assert.ok(kinds.includes('yardage'), 'yardage re-estimates when metres are supplied');
  const castOn = s.best.adjustments.find((a) => a.kind === 'cast-on');
  assert.equal(castOn.to, 120, 'an exact-gauge match leaves cast-on unchanged');
});

test('fibre and colour deltas are surfaced when the engine can compute them', () => {
  const s = summariseSubstitution(ORIGINAL, [BAD]);
  const bad = s.picks[0];
  assert.ok(bad.fiberRemoved.includes('wool'), 'dropping the wool is reported');
  assert.ok(bad.fiberAdded.includes('cotton'), 'adding cotton is reported');
});

test('bestSubstitutesFor ranks against an injected pool without touching the shared registry', () => {
  const s = bestSubstitutesFor(ORIGINAL, {}, { candidates: POOL, limit: 5 });
  assert.equal(s.ok, true);
  assert.equal(s.picks[0].name, 'Perfect Swap');
});

test('the recommendation-tone table is exported and maps every grade', () => {
  assert.equal(RECOMMENDATION_TONE.excellent, 'ok');
  assert.equal(RECOMMENDATION_TONE.good, 'ok');
  assert.equal(RECOMMENDATION_TONE.acceptable, 'warn');
  assert.equal(RECOMMENDATION_TONE.poor, 'bad');
});

// ─── the printable text ──────────────────────────────────────────────────────

test('the text sheet prints the header, the ranked swaps and a trailing newline', () => {
  const s = summariseSubstitution(ORIGINAL, POOL, { stitchesPer10cm: 20, rowsPer10cm: 28, meters: 400 });
  const text = substitutionToText(s);
  assert.match(text, /^Yarn substitutions\n=+\n/);
  assert.match(text, /Substituting: House Main DK — dk/);
  assert.match(text, /1\. Nearby Perfect Swap \(dk\) — excellent/);
  assert.match(text, /→ needle:/, 'a concrete edit line is printed');
  assert.ok(text.endsWith('\n'));
});

test('an absent summary prints a friendly prompt, never an empty clipboard', () => {
  assert.match(substitutionToText(null), /Add a yarn with a stated gauge/);
  assert.ok(substitutionToText({ ok: true, picks: [] }).endsWith('\n'));
});

// ─── wiring: the dormant engine now has hands ────────────────────────────────

test('substitution-view.js is DOM-free and is the engine\'s first real consumer', () => {
  const src = read('js/yarn/substitution-view.js');
  assert.doesNotMatch(src, /\bdocument\b/, 'no DOM at module scope');
  assert.doesNotMatch(src, /\bwindow\b/);
  assert.match(src, /from '\.\/substitution\.js'/, 'it feeds the substitution engine');
  assert.match(src, /rankSubstitutes/, 'it calls rankSubstitutes (previously orphaned)');
});

test('the Yarn Lab panel ranks swaps and can copy the report', () => {
  const panel = read('js/v2/panels.js');
  assert.match(panel, /from '\.\.\/yarn\/substitution-view\.js'/);
  assert.match(panel, /function renderSubstitutes\(s\)/);
  assert.match(panel, /bestSubstitutesFor\(primary\.yarn/, 'it reads the project yarn the pipeline produced');
  assert.match(panel, /\$\{renderSubstitutes\(sub\)\}/, 'the section is painted into the panel');
  assert.match(panel, /data-copy-sub/, 'a Copy control is mounted');
  assert.match(panel, /substitutionToText\(/, 'the copy button produces printable text');
});

test('v2.substitute is a declared, dispatched command with a menu item', () => {
  assert.match(read('js/ui/menubar.js'), /'v2\.substitute'/);
  assert.match(read('js/ui/menubar.js'), /it\('Swap this yarn \(substitutions\)', 'v2\.substitute'\)/);
  assert.match(read('js/ui/commands.js'), /case 'v2\.substitute':/);
});

test('the substitution read is findable from the command palette', () => {
  assert.match(read('js/app.js'), /Swap this yarn \(substitute & see what changes\)/);
  assert.match(read('js/app.js'), /this\.runCommand\('v2\.substitute'\)/);
});
