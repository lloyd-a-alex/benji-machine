// The Blending Lab view (js/yarn/blending-view.js) — spec §3.6. `yarn/blending.js` computes held-
// strand gauge prediction, gauge-matching hold suggestions and Fair Isle float/contrast safety, but
// the whole lab had ZERO consumers in the running app. These tests assert the pure view (hold-to-gauge
// + Fair Isle check + text sheets + strand normalisation) and that the dormant engines are now
// actually reachable from the Yarn and Compiler panels, commands and palette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normaliseStrand,
  summariseHoldForGauge,
  summariseFairIsle,
  holdPlanToText,
  fairIsleToText
} from '../js/yarn/blending-view.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// A tiny controllable pool (raw descriptors — the view normalises them itself).
const POOL = [
  { name: 'Lace', brand: 'A', stsPer10cm: 32, color: '#f5f0e6' },
  { name: 'Sock', brand: 'B', stsPer10cm: 27, color: '#aa1122' },
  { name: 'DK', brand: 'C', stsPer10cm: 21, color: '#334455' }
];

// ─── strand normalisation ────────────────────────────────────────────────────

test('normaliseStrand accepts many yarn shapes and drops unusable ones', () => {
  const fromSts = normaliseStrand({ name: 'DK', stsPer10cm: 22 });
  assert.equal(fromSts.stsPer10cm, 22);
  assert.equal(fromSts.rowsPer10cm, 29.7, 'a missing row gauge falls back to a sensible ratio');
  assert.equal(normaliseStrand({ gauge: { stsPer10cm: 20, rowsPer10cm: 28 } }).stsPer10cm, 20, 'reads a report { gauge } row');
  assert.equal(normaliseStrand({ name: 'Bad', stsPer10cm: 0 }), null, 'no positive stitch gauge is dropped');
  assert.equal(normaliseStrand(null), null);
  assert.equal(normaliseStrand('nope'), null);
});

// ─── the hold-to-gauge view ──────────────────────────────────────────────────

test('a hold plan with no target or an empty pool is an honest null', () => {
  assert.equal(summariseHoldForGauge(null, { pool: POOL }), null);
  assert.equal(summariseHoldForGauge(NaN, { pool: POOL }), null);
  assert.equal(summariseHoldForGauge(20, { pool: [] }), null);
});

test('an exact-match single yarn is preferred over inventing a hold', () => {
  const s = summariseHoldForGauge(20, { pool: [{ name: 'DK', stsPer10cm: 20 }] });
  assert.equal(s.best.count, 1);
  assert.equal(s.best.single, true);
  assert.equal(s.best.within, true);
  assert.equal(s.best.predicted, 20);
  assert.match(s.headline, /Hold DK → 20 sts\/10cm/);
});

test('when no single yarn reaches the target, the view recommends holding strands', () => {
  const s = summariseHoldForGauge(16.5, { pool: POOL });
  assert.equal(s.best.count, 2, 'the answer is a held combination, not one strand');
  assert.equal(s.best.within, true, 'the hold lands within a stitch of the target');
  assert.ok(s.best.predicted < 21, 'holding lowers the gauge below the finest single yarn');
  // ranked best-first: error only grows down the list.
  const errs = s.picks.map((p) => p.error);
  assert.deepEqual(errs, [...errs].sort((a, b) => a - b), 'plans are sorted by closeness');
});

test('a held two-colour marle reports the optical blend colour', () => {
  const s = summariseHoldForGauge(16.5, { pool: POOL });
  assert.equal(typeof s.best.marledColor, 'string');
  assert.match(s.best.marledColor, /^#[0-9a-f]{6}$/i);
});

// ─── the Fair Isle check ─────────────────────────────────────────────────────

test('a fair-isle read with no palette or no grid is an honest null', () => {
  assert.equal(summariseFairIsle([], [[0, 1]]), null);
  assert.equal(summariseFairIsle(['#111'], []), null);
  assert.equal(summariseFairIsle(['#111'], [[], []]), null, 'grid of empty rows has nothing to test');
});

test('a long float is flagged with the row to tuck', () => {
  // six identical cells in a row is a 5-stitch float once maxFloat is 3.
  const s = summariseFairIsle(['#111111', '#eeeeee'], [[0, 0, 0, 0, 0, 0]], { maxFloat: 3 });
  assert.equal(s.safe, false);
  assert.ok(s.longFloatCount >= 1, 'at least one float exceeds the limit');
  assert.ok(s.tuckRows.includes(1), 'row 1 is recommended for a tuck to catch the float');
  assert.match(s.headline, /long float/);
});

test('a short-float, high-contrast field is machine-safe', () => {
  const s = summariseFairIsle(['#000000', '#ffffff'], [[0, 1, 0, 1, 0, 1], [1, 0, 1, 0, 1, 0]]);
  assert.equal(s.safe, true, 'alternating floats are short and black/white read');
  assert.equal(s.longFloatCount, 0);
  assert.match(s.headline, /machine-safe/);
});

// ─── the printable text sheets ───────────────────────────────────────────────

test('the hold plan prints a header, every option and a trailing newline', () => {
  const s = summariseHoldForGauge(16.5, { pool: POOL });
  const text = holdPlanToText(s);
  assert.match(text, /^Hold strands to hit gauge\n=+\n/);
  assert.match(text, /Target: 16\.5 sts \/ 10 cm/);
  assert.match(text, /→\s+\d+(\.\d+)? sts\/10cm/, 'each plan shows its predicted gauge');
  assert.ok(text.endsWith('\n'));
});

test('the Fair Isle report prints the verdict and a trailing newline', () => {
  const s = summariseFairIsle(['#111111', '#eeeeee'], [[0, 0, 0, 0, 0, 0]], { maxFloat: 3 });
  const text = fairIsleToText(s);
  assert.match(text, /^Fair Isle check\n=+\n/);
  assert.match(text, /Long floats/);
  assert.ok(text.endsWith('\n'));
});

test('absent summaries print a friendly prompt, never an empty clipboard', () => {
  assert.match(holdPlanToText(null), /target gauge/i);
  assert.match(fairIsleToText(null), /Compile a colourwork/);
});

// ─── wiring: the dormant blending lab now has hands ──────────────────────────

test('blending-view.js is DOM-free and is the engine\'s first real consumer', () => {
  const src = read('js/yarn/blending-view.js');
  assert.doesNotMatch(src, /\bdocument\b/, 'no DOM at module scope');
  assert.doesNotMatch(src, /\bwindow\b/);
  assert.match(src, /from '\.\/blending\.js'/, 'it feeds the blending engine');
  assert.match(src, /suggestHoldForGauge/);
  assert.match(src, /fairIslePlan/);
  assert.match(src, /holdStrands/);
});

test('the Yarn and Compiler panels render the two new sections and copy them', () => {
  const panel = read('js/v2/panels.js');
  assert.match(panel, /from '\.\.\/yarn\/blending-view\.js'/);
  assert.match(panel, /function renderHold\(h\)/);
  assert.match(panel, /function renderFairIsle\(fi\)/);
  assert.match(panel, /summariseHoldForGauge\(y\.gauge/, 'the Yarn panel reads the pipeline gauge');
  assert.match(panel, /summariseFairIsle\(/, 'the Compiler panel reads the compiled card');
  assert.match(panel, /\$\{renderHold\(hold\)\}/, 'the hold section is painted');
  assert.match(panel, /\$\{renderFairIsle\(fi\)\}/, 'the Fair Isle section is painted');
  assert.match(panel, /data-copy-hold/, 'a Copy-hold control is mounted');
  assert.match(panel, /data-copy-fi/, 'a Copy-FairIsle control is mounted');
});

test('v2.blend and v2.fairisle are declared, dispatched commands with menu items', () => {
  const mb = read('js/ui/menubar.js');
  assert.match(mb, /'v2\.blend'/);
  assert.match(mb, /'v2\.fairisle'/);
  assert.match(mb, /it\('Hold strands to hit gauge', 'v2\.blend'\)/);
  assert.match(mb, /it\('Fair Isle check \(floats & contrast\)', 'v2\.fairisle'\)/);
  const cmd = read('js/ui/commands.js');
  assert.match(cmd, /case 'v2\.blend':/);
  assert.match(cmd, /case 'v2\.fairisle':/);
});

test('both blending reads are findable from the command palette', () => {
  const app = read('js/app.js');
  assert.match(app, /Hold strands to hit a gauge you/);
  assert.match(app, /this\.runCommand\('v2\.blend'\)/);
  assert.match(app, /Fair Isle check \(floats & contrast safety\)/);
  assert.match(app, /this\.runCommand\('v2\.fairisle'\)/);
});
