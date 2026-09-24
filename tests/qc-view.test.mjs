// KNITCAT V2 — the QC inspection card battery.
//
// Proves qc-view is a faithful, total, DOM-free presenter over the production QC engine's own
// checklist + score objects, and that the inspection card is fused into the Production panel with
// full command / menu / palette discoverability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { summariseQC, qcToText } from '../js/production/qc-view.js';
import { createChecklist, setCheck, recordMeasurement, evaluateQc, QC_TEMPLATE } from '../js/production/qc.js';
import { projectFromKnitScript, runFullPipeline, DEFAULT_KNITSCRIPT } from '../js/v2/index.js';

/* -- garbage tolerance ----------------------------------------------------- */

test('summariseQC is total: null/garbage/empty checks yields null', () => {
  for (const junk of [null, undefined, 42, 'qc', {}, { checks: [] }, { checks: 'not array' }]) {
    assert.equal(summariseQC(junk), null, `${JSON.stringify(junk)} -> null`);
  }
});

/* -- the fresh checklist groups by canonical category --------------------- */

test('a brand-new checklist yields an "inspected 0/11" pending card, one category per bucket', () => {
  const qc = createChecklist({ title: 'Test cardigan QC' });
  const s = summariseQC(qc);
  assert.ok(s && s.ok);
  assert.equal(s.progress.total, 11);
  assert.equal(s.progress.done, 0);
  assert.equal(s.tone, 'warn', 'pending verdict surfaces as warn, not bad');
  assert.equal(s.score.verdict, 'pending');
  const catIds = s.categories.map((c) => c.id);
  assert.deepEqual(catIds, ['structure', 'fit', 'finish', 'presentation'], 'canonical order preserved');
  assert.equal(s.categories[0].label, 'Structure');
  assert.equal(s.categories[1].label, 'Fit & measurements');
});

test('checks preserve verdict marks ✓ ✗ — ○ and the required flag', () => {
  let qc = createChecklist();
  qc = setCheck(qc, 'gauge', 'pass', 24);
  qc = setCheck(qc, 'seams', 'fail', null, 'pilling on left shoulder');
  qc = setCheck(qc, 'packaging', 'na');
  const s = summariseQC(qc);
  const byKey = {};
  for (const cat of s.categories) for (const c of cat.checks) byKey[c.key] = c;
  assert.equal(byKey.gauge.mark, '✓');
  assert.equal(byKey.seams.mark, '✗');
  assert.equal(byKey.packaging.mark, '—');
  assert.equal(byKey.dropped.mark, '○', 'pending shows hollow circle');
  assert.equal(byKey.seams.note, 'pilling on left shoulder');
  assert.equal(byKey.packaging.required, false, 'packaging is optional in the template');
});

/* -- score & blocking are lifted from the engine, never recomputed -------- */

test('the score block is passed through verbatim (counts, passRate, blocking)', () => {
  let qc = createChecklist();
  // Pass everything except the required 'ends' check, which we fail.
  for (const t of QC_TEMPLATE) {
    if (t.key === 'ends') qc = setCheck(qc, t.key, 'fail', null, 'ends not woven');
    else qc = setCheck(qc, t.key, 'pass');
  }
  const s = summariseQC(qc);
  assert.equal(s.score.failed, 1);
  assert.ok(s.score.blocking.find((b) => b.key === 'ends'), 'the failing required check is blocking');
  assert.equal(s.score.verdict, 'rejected', 'blocking after all inspected → rejected');
  assert.equal(s.tone, 'bad');
});

/* -- measurement readings ------------------------------------------------- */

test('a measurement check with target/tolerance/actual renders as "96 cm vs 96 ±2 cm · within"', () => {
  let qc = createChecklist({ targets: { chest: 96 } });
  qc = recordMeasurement(qc, 'measurements', 96);
  const s = summariseQC(qc);
  const m = s.categories.flatMap((c) => c.checks).find((c) => c.key === 'measurements');
  assert.match(m.reading, /96 cm vs 96 ±2 cm/);
  assert.match(m.reading, /within/);
  assert.equal(m.verdict, 'pass');
});

test('an off-target measurement surfaces the exact offset and marks the check as fail', () => {
  let qc = createChecklist({ targets: { chest: 96 } });
  qc = recordMeasurement(qc, 'measurements', 99.5);
  const s = summariseQC(qc);
  const m = s.categories.flatMap((c) => c.checks).find((c) => c.key === 'measurements');
  assert.match(m.reading, /99\.5 cm vs 96 ±2 cm/);
  assert.match(m.reading, /off by 3\.5/);
  assert.equal(m.verdict, 'fail');
});

test('a measurement with a target but no actual reads "target 96 cm ±2 cm" (nothing decided)', () => {
  const qc = createChecklist({ targets: { chest: 96 } });
  const s = summariseQC(qc);
  const m = s.categories.flatMap((c) => c.checks).find((c) => c.key === 'measurements');
  assert.match(m.reading, /^target 96 cm ±2 cm$/);
  assert.equal(m.verdict, 'pending');
});

test('boolean checks carry no reading (they only ever get ✓ / ✗ / — / ○)', () => {
  const qc = createChecklist();
  const s = summariseQC(qc);
  const dropped = s.categories.flatMap((c) => c.checks).find((c) => c.key === 'dropped');
  assert.equal(dropped.type, 'boolean');
  assert.equal(dropped.reading, null);
});

/* -- unknown categories sort after the canonical four -------------------- */

test('unknown categories appear after the canonical four, sorted alphabetically', () => {
  const qc = {
    title: 'custom',
    checks: [
      { key: 'a', label: 'A', category: 'zzz-custom', verdict: 'pass', required: true },
      { key: 'b', label: 'B', category: 'aaa-custom', verdict: 'pass', required: true },
      { key: 'gauge', label: 'g', category: 'structure', verdict: 'pass', required: true }
    ],
    score: { passed: 3, failed: 0, na: 0, pending: 0, passRate: 100, verdict: 'approved', blocking: [] }
  };
  const s = summariseQC(qc);
  assert.deepEqual(s.categories.map((c) => c.id), ['structure', 'aaa-custom', 'zzz-custom']);
  assert.equal(s.categories[1].label, 'Aaa Custom', 'unknown labels get Title-Cased');
});

/* -- plain-text rendering ------------------------------------------------- */

test('qcToText emits a printable card: header, blocking, per-category rows, pass-rate footer', () => {
  let qc = createChecklist({ title: 'Cardigan #1 QC', inspector: 'BM', targets: { chest: 96 } });
  qc = setCheck(qc, 'gauge', 'pass', 24);
  qc = recordMeasurement(qc, 'measurements', 100);
  qc = setCheck(qc, 'dropped', 'pass');
  const s = summariseQC(qc);
  const text = qcToText(s);
  assert.match(text, /Cardigan #1 QC/);
  assert.match(text, /=+/, 'underline rule under the title');
  assert.match(text, /BLOCKING — fix before shipping/);
  assert.match(text, /✗ Measurements within tolerance \(measurements\)/);
  assert.match(text, /-- Structure /);
  assert.match(text, /✓ \* Gauge correct/);
  assert.match(text, /100 cm vs 96 ±2 cm · off by 4/);
  assert.match(text, /pass rate \d+% · verdict/);
  assert.ok(text.endsWith('\n'));
});

test('qcToText is total: null yields a helpful prompt, never throws', () => {
  const text = qcToText(null);
  assert.match(text, /Inspect a piece/);
  assert.ok(text.endsWith('\n'));
});

/* -- integration with the real production plan ---------------------------- */

test('the default KnitScript pipeline yields a computePlan with a QC checklist the view can consume', () => {
  const project = projectFromKnitScript(DEFAULT_KNITSCRIPT).project;
  const report = runFullPipeline(project);
  const prod = report && report.production;
  assert.ok(prod && prod.qc && Array.isArray(prod.qc.checks), 'computePlan returned a qc checklist');
  assert.equal(prod.qc.checks.length, 11, 'all eleven canonical QC checks seeded');
  const s = summariseQC(prod.qc);
  assert.ok(s && s.ok);
  assert.equal(s.progress.total, 11);
  // A fresh pipeline has an untouched checklist — pending verdict, warn tone.
  assert.equal(s.score.verdict, 'pending');
  assert.equal(s.tone, 'warn');
});

/* -- module contract (DOM-free) and fusion -------------------------------- */

test('qc-view has no DOM access (module-graph gate stays green)', () => {
  const src = readFileSync(new URL('../js/production/qc-view.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bdocument\b/, 'must be DOM-free for tests/headless');
  assert.doesNotMatch(src, /\bwindow\b/);
});

test('panels.js fuses renderQC into production(state) and wires the copy binder', () => {
  const panels = readFileSync(new URL('../js/v2/panels.js', import.meta.url), 'utf8');
  assert.match(panels, /import \{ summariseQC, qcToText \} from '\.\.\/production\/qc-view\.js'/);
  assert.match(panels, /const qcs = summariseQC\(prod && prod\.qc\)/);
  assert.match(panels, /\$\{renderQC\(qcs\)\}/);
  assert.match(panels, /data-copy-qc/);
  assert.match(panels, /qcToText\(summariseQC\(prod && prod\.qc\)\)/);
});

test('v2.qc is wired into commands, MENUBAR_ACTIONS, the Studio V2 menu, and the Ctrl+K palette', () => {
  const commands = readFileSync(new URL('../js/ui/commands.js', import.meta.url), 'utf8');
  assert.match(commands, /case 'v2\.qc':/);

  const menubar = readFileSync(new URL('../js/ui/menubar.js', import.meta.url), 'utf8');
  assert.match(menubar, /'v2\.qc'/, 'declared in MENUBAR_ACTIONS');
  assert.match(menubar, /it\('QC inspection card \(before you ship\)', 'v2\.qc'\)/);

  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /runCommand\('v2\.qc'\)/, 'Ctrl+K palette act routes to v2.qc');
});
