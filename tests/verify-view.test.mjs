// KNITCAT V2 — the verification action list battery.
//
// Proves verify-view is a faithful, total, DOM-free presenter over the compiler's `CheckResult`
// array, and that every `fix` string the engine wrote (hidden by the flat verification table) is
// preserved verbatim and surfaced in the Compiler panel with full command / menu / palette
// discoverability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { summariseVerification, verificationToText } from '../js/compiler/verify-view.js';
import { makeResult, pass, warn, fail } from '../js/compiler/verify/_result.js';
import { projectFromKnitScript, runFullPipeline, DEFAULT_KNITSCRIPT } from '../js/v2/index.js';

/* -- garbage tolerance ----------------------------------------------------- */

test('summariseVerification is total: null/garbage yields null', () => {
  for (const junk of [null, undefined, 42, 'verify', {}, 'array-not']) {
    assert.equal(summariseVerification(junk), null, `${JSON.stringify(junk)} -> null`);
  }
});

test('summariseVerification on an empty array yields an "all clear" info summary', () => {
  const s = summariseVerification([]);
  assert.ok(s && s.ok, 'empty is a real (successful) summary, not null');
  assert.equal(s.tone, 'info');
  assert.equal(s.headline, 'nothing to check');
  assert.deepEqual(s.counts, { passed: 0, warnings: 0, failures: 0, errors: 0 });
  assert.deepEqual(s.blocking, []);
  assert.deepEqual(s.warnings, []);
  assert.deepEqual(s.passed, []);
});

test('malformed entries are silently dropped (unknown verdicts do not crash the bucket sort)', () => {
  const s = summariseVerification([
    { id: 'fit', verdict: 'pass', message: 'ok' },
    { id: 'broken', verdict: 'not-a-verdict' },
    null,
    undefined,
    'junk',
    42
  ]);
  assert.ok(s && s.ok);
  assert.equal(s.counts.passed, 1);
  assert.equal(s.counts.warnings + s.counts.failures + s.counts.errors, 0);
});

/* -- the four buckets, split correctly ------------------------------------ */

test('pass / warn / fail / error route to passed / warnings / blocking / blocking+errors', () => {
  const results = [
    pass('gauge', 'swatch matches'),
    warn('float', 'float of 9 sts', 'Catch every 5 stitches.'),
    fail('ease', 'too tight', 'Increase ease.chest toward 8 cm.'),
    makeResult('machine', 'error', 'Check threw', 'Fix the IR upstream.')
  ];
  const s = summariseVerification(results);
  assert.equal(s.counts.passed, 1);
  assert.equal(s.counts.warnings, 1);
  assert.equal(s.counts.failures, 1);
  assert.equal(s.counts.errors, 1);
  assert.equal(s.blocking.length, 2, 'both fail and error are blocking');
  assert.deepEqual(s.blocking.map((b) => b.id), ['ease', 'machine'], 'sorted by id');
  assert.equal(s.warnings[0].id, 'float');
  assert.equal(s.passed[0].id, 'gauge');
});

test('every fix string survives verbatim — the whole point of the view', () => {
  const FIX_FLOAT = 'Add a tuck stitch or catch the float every 5.';
  const FIX_YARN = 'Buy the shortfall or shrink the size by one.';
  const results = [
    warn('float', 'float too long', FIX_FLOAT),
    fail('yarn', 'short by 3 balls', FIX_YARN)
  ];
  const s = summariseVerification(results);
  assert.equal(s.warnings[0].fix, FIX_FLOAT);
  assert.equal(s.blocking[0].fix, FIX_YARN);
});

test('buckets sort by id so the panel output is deterministic across runs', () => {
  const results = [
    warn('yarn', 'y', 'fy'),
    warn('color', 'c', 'fc'),
    warn('tuck', 't', 'ft'),
    warn('ease', 'e', 'fe')
  ];
  const s = summariseVerification(results);
  assert.deepEqual(s.warnings.map((w) => w.id), ['color', 'ease', 'tuck', 'yarn']);
});

/* -- tone rules ------------------------------------------------------------ */

test('tone: any failure or error → bad', () => {
  assert.equal(summariseVerification([fail('fit', 'x', 'fix')]).tone, 'bad');
  assert.equal(summariseVerification([makeResult('x', 'error', 'boom', 'fix')]).tone, 'bad');
});

test('tone: warnings only → warn (not bad)', () => {
  assert.equal(summariseVerification([warn('float', 'm', 'f')]).tone, 'warn');
});

test('tone: everything passed → ok', () => {
  assert.equal(summariseVerification([pass('fit', 'fits'), pass('gauge', 'on gauge')]).tone, 'ok');
});

/* -- human labels for the canonical ids ----------------------------------- */

test('known ids map to human labels; unknown ids get Title-Cased as a fallback', () => {
  const s = summariseVerification([
    pass('gauge', 'ok'),
    pass('color', 'ok'),
    pass('fit', 'ok'),
    pass('tuck', 'ok'),
    pass('some-unknown_check', 'ok')
  ]);
  const byId = Object.fromEntries(s.passed.map((p) => [p.id, p.label]));
  assert.equal(byId.gauge, 'Gauge & swatch');
  assert.equal(byId.color, 'Colourwork contrast');
  assert.equal(byId.fit, 'Fit & wearability');
  assert.equal(byId.tuck, 'Tuck stack depth');
  // Unknown: hyphens/underscores become spaces, first letter capitalised.
  assert.equal(byId['some-unknown_check'], 'Some unknown check');
});

/* -- plain-text rendering ------------------------------------------------- */

test('verificationToText emits a printable action list with fix: lines under each blocking entry', () => {
  const s = summariseVerification([
    fail('yarn', 'short by 2 balls', 'Buy 2 more merino balls.'),
    warn('float', 'floats reach 9', 'Catch every 5.'),
    pass('gauge', 'swatch matches')
  ]);
  const text = verificationToText(s);
  assert.match(text, /Verification report/);
  assert.match(text, /BLOCKING — fix before casting on/);
  assert.match(text, /✗ Yarn & stash coverage \(yarn\)/);
  assert.match(text, /fix: Buy 2 more merino balls\./);
  assert.match(text, /WARNINGS — read before you commit/);
  assert.match(text, /⚠ Float length \(Fair Isle\) \(float\)/);
  assert.match(text, /fix: Catch every 5\./);
  assert.match(text, /PASSED\n\s+✓ Gauge & swatch — swatch matches/);
  assert.ok(text.endsWith('\n'));
});

test('verificationToText is total: null yields a helpful prompt, never throws', () => {
  const text = verificationToText(null);
  assert.match(text, /Run the compiler/);
  assert.ok(text.endsWith('\n'));
});

/* -- integration with the real compiler ----------------------------------- */

test('the default KnitScript pipeline yields a non-empty verification the view can consume', () => {
  const project = projectFromKnitScript(DEFAULT_KNITSCRIPT).project;
  const report = runFullPipeline(project);
  const verification = report && report.compile && report.compile.verification;
  assert.ok(Array.isArray(verification), 'compiler produced a verification array');
  assert.ok(verification.length >= 4, 'at least the four canonical default checks ran');
  const s = summariseVerification(verification);
  assert.ok(s && s.ok);
  // Every canonical id maps to exactly one bucket.
  const totalBucketed = s.blocking.length + s.warnings.length + s.passed.length;
  assert.equal(totalBucketed, verification.length, 'nothing dropped');
  // Headline mentions counts.
  assert.match(s.headline, /passed|to fix|warning|error|nothing to check/);
});

/* -- module contract (DOM-free) and fusion -------------------------------- */

test('verify-view has no DOM access and no imports (module-graph gate stays green)', () => {
  const src = readFileSync(new URL('../js/compiler/verify-view.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bdocument\b/, 'must be DOM-free for tests/headless');
  assert.doesNotMatch(src, /\bwindow\b/);
  assert.doesNotMatch(src, /^\s*import\s+/, 'must import nothing (pure presenter)');
});

test('panels.js fuses renderVerify into compiler(state) and wires the copy binder', () => {
  const panels = readFileSync(new URL('../js/v2/panels.js', import.meta.url), 'utf8');
  assert.match(panels, /import \{ summariseVerification, verificationToText \} from '\.\.\/compiler\/verify-view\.js'/);
  assert.match(panels, /const vsum = summariseVerification\(c\.verification\)/);
  assert.match(panels, /\$\{renderVerify\(vsum\)\}/);
  assert.match(panels, /data-copy-verify/);
  assert.match(panels, /verificationToText\(summariseVerification\(c && c\.verification\)\)/);
});

test('v2.verify is wired into commands, MENUBAR_ACTIONS, the Studio V2 menu, and the Ctrl+K palette', () => {
  const commands = readFileSync(new URL('../js/ui/commands.js', import.meta.url), 'utf8');
  assert.match(commands, /case 'v2\.verify':/);

  const menubar = readFileSync(new URL('../js/ui/menubar.js', import.meta.url), 'utf8');
  assert.match(menubar, /'v2\.verify'/, "declared in MENUBAR_ACTIONS");
  assert.match(menubar, /it\('What to fix \(verification actions\)', 'v2\.verify'\)/);

  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /runCommand\('v2\.verify'\)/, 'Ctrl+K palette act routes to v2.verify');
});
