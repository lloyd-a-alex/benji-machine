// KNITCAT V2 — the finishing & pick-up read battery.
//
// Proves the presenter is a faithful, total, DOM-free consumer of the finishing plan the Fit
// Engine already computes (`fit.finishing`) and of the previously-dark `pickupPlanForEdges`
// engine, and that the whole surface is wired for discovery. Numbers are asserted against the
// pick-up engine's own documented formula so the read can never silently drift from the maths.
//
//   node --test "tests/finishing-view.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { summariseFinishing, finishingToText } from '../js/fit/finishing-view.js';
import { projectFromKnitScript, FitEngine, DEFAULT_KNITSCRIPT } from '../js/v2/index.js';

/* ─────────────────────────── fixtures ─────────────────────────── */

// A draft carrying an explicit finishing plan (bands + seaming) but no gauge, so the summary is
// driven purely by the items the engine produced.
function draftWithFinishing() {
  return {
    construction: 'raglanSweater',
    finishing: {
      items: [
        { kind: 'hem', label: 'Hem', style: 'rib2x2', stitches: 120, rows: 12, instructions: ['Set the ribber: *K2, P2; rep from *.', 'Work 12 rows of rib2x2 over 120 sts.'] },
        { kind: 'neckband', shape: 'crew', stitches: 96, rows: 8, instructions: ['pick up 96 sts evenly around crew neck'] }
      ],
      seaming: ['Weave in all ends on the wrong side before seaming.', 'Sew the neckband/bands last, easing to fit.']
    }
  };
}

// A draft with only a gauge + body (no finishing object): the pick-up engine must still be fed
// and produce edge counts. Gauge 20 sts / 28 rows per 10 cm; body armhole 22, back length 60, neck 50.
// pickUpCount per-row for a knit edge = (20/28)*0.75 = 15/28 sts/row.
//   armhole  : round(22cm→62 rows × 2 × 15/28) = round(124 × 15/28) = 66
//   side seam: round(60cm→168 rows × 15/28)     = 90
//   neckline : round((50 − 1) × 2 sts/cm)         = 98
function draftGaugeOnly(extra = {}) {
  return {
    construction: 'raglanSweater',
    gauge: { stsPer10cm: 20, rowsPer10cm: 28 },
    body: { armholeDepth: 22, backLength: 60, neck: 50 },
    ...extra
  };
}

/* ─────────────────────────── garbage tolerance ─────────────────────────── */

test('summariseFinishing is total: garbage or empty drafts yield null', () => {
  for (const junk of [null, undefined, 42, 'str', [], {}]) {
    assert.equal(summariseFinishing(junk), null, `${JSON.stringify(junk)} must yield null`);
  }
  // A gauge/body-less draft with no finishing has nothing to show.
  assert.equal(summariseFinishing({ construction: 'raglanSweater' }), null);
});

/* ─────────────────────────── bands (already-computed finishing) ─────────────────────────── */

test('it surfaces the finishing bands the engine computed, with labels and steps', () => {
  const s = summariseFinishing(draftWithFinishing());
  assert.ok(s && s.ok, 'a draft with bands produces a summary');
  assert.equal(s.itemCount, 2);
  assert.equal(s.items[0].label, 'Hem');
  assert.equal(s.items[0].style, 'rib2x2');
  assert.equal(s.items[0].stitches, 120);
  assert.equal(s.items[0].rows, 12);
  assert.ok(s.items[0].instructions.length === 2, 'row-by-row steps are carried through');
  // No explicit label → derived from kind, humanised.
  assert.equal(s.items[1].label, 'Neckband');
  assert.deepEqual(s.seaming.length, 2);
  assert.match(s.headline, /2 bands/);
});

test('it drops non-string instruction noise and caps the item list', () => {
  const draft = {
    finishing: {
      items: Array.from({ length: 12 }, (_, i) => ({ kind: 'hem', label: 'Hem ' + i, stitches: 100 + i, instructions: ['good', '', null, 42, '  '] })),
      seaming: ['ok', '', null]
    }
  };
  const s = summariseFinishing(draft);
  assert.equal(s.items.length, 8, 'items are capped at 8');
  assert.deepEqual(s.items[0].instructions, ['good'], 'only real, non-blank steps survive');
  assert.deepEqual(s.seaming, ['ok'], 'seaming is cleaned too');
});

/* ─────────────────────────── pick-up engine (the dark function) ─────────────────────────── */

test('it feeds pickupPlanForEdges real dimensions and reports exact counts', () => {
  const s = summariseFinishing(draftGaugeOnly());
  assert.ok(s && s.ok, 'a gauge + body draft is enough to produce a plan');
  assert.equal(s.itemCount, 0, 'no bands were computed here');
  const byEdge = Object.fromEntries(s.pickUp.map((p) => [p.key, p.count]));
  assert.equal(byEdge.armhole, 66, 'armhole pick-up matches the knit-edge formula');
  assert.equal(byEdge.sideSeam, 90, 'side-seam pick-up matches the knit-edge formula');
  assert.equal(byEdge.neckline, 98, 'neckline pick-up matches the neckline formula');
  assert.ok(!('frontBand' in byEdge), 'a pullover gets no front band');
  assert.equal(s.pickUp.find((p) => p.key === 'neckline').edge, 'Neckline');
});

test('an open-front construction adds a front-band pick-up', () => {
  const s = summariseFinishing(draftGaugeOnly({ construction: 'cardiganSweater' }));
  const keys = s.pickUp.map((p) => p.key);
  assert.ok(keys.includes('frontBand'), 'a cardigan plans a front band');
  assert.equal(s.pickUp.find((p) => p.key === 'frontBand').count, 90);
});

test('pick-up is skipped when the gauge is missing or impossible', () => {
  const noGauge = summariseFinishing({ body: { neck: 50, armholeDepth: 22, backLength: 60 } });
  assert.equal(noGauge, null, 'no gauge and no bands → nothing to show');
  const badGauge = summariseFinishing({ gauge: { stsPer10cm: 0, rowsPer10cm: NaN }, body: { neck: 50 } });
  assert.equal(badGauge, null, 'a zero/NaN gauge must not produce pick-up');
});

/* ─────────────────────────── the real Fit draft (contract) ─────────────────────────── */

test('it reads the real draftFromProject finishing shape end-to-end', () => {
  const project = projectFromKnitScript(DEFAULT_KNITSCRIPT).project;
  const fit = FitEngine.draftFromProject(project);
  const s = summariseFinishing(fit);
  assert.ok(s && s.ok, 'the live draft yields a finishing summary');
  assert.ok(s.itemCount >= 1, 'the default garment has at least one band');
  assert.ok(s.items.some((it) => /Hem|Cuff|Neck/i.test(it.label)), 'recognisable band labels appear');
  assert.ok(s.items.every((it) => Array.isArray(it.instructions)), 'every band carries step instructions');
  assert.ok(Array.isArray(s.pickUp));
});

/* ─────────────────────────── the printable sheet ─────────────────────────── */

test('finishingToText renders a titled sheet and always ends in a newline', () => {
  const bandSheet = finishingToText(summariseFinishing(draftWithFinishing()));
  assert.match(bandSheet, /^Finishing & pick-up\n=+/);
  assert.match(bandSheet, /Hem — 120 sts · 12 rows · Rib2x2/);
  assert.match(bandSheet, /Work 12 rows of rib2x2/);
  assert.match(bandSheet, /Seaming & blocking\n  1\. Weave in/);
  assert.ok(bandSheet.endsWith('\n'));

  const pickSheet = finishingToText(summariseFinishing(draftGaugeOnly()));
  assert.match(pickSheet, /Pick-up counts\n  each armhole — pick up 66 sts/);
  assert.ok(pickSheet.endsWith('\n'));

  assert.equal(finishingToText(null), 'Draft a garment in the Fit panel to plan its finishing.\n');
});

test('finishingToText honours a custom title', () => {
  const text = finishingToText(summariseFinishing(draftWithFinishing()), { title: 'My tech pack' });
  assert.match(text, /^My tech pack\n=+/);
});

/* ─────────────────────────── DOM-free + module contract ─────────────────────────── */

test('finishing-view is DOM-free and consumes the dark pick-up engine', () => {
  const src = readFileSync(new URL('../js/fit/finishing-view.js', import.meta.url), 'utf8');
  assert.ok(!/\b(document|window|navigator|localStorage)\b/.test(src), 'must not touch the DOM');
  assert.match(src, /import\s*\{[^}]*pickupPlanForEdges[^}]*\}\s*from\s*'\.\/pick-up\.js'/, 'imports the pick-up engine');
  assert.match(src, /from '\.\.\/project\/project-model\.js'/, 'reuses cmToRows rather than reinventing it');
});

/* ─────────────────────────── wiring / discoverability ─────────────────────────── */

test('the finishing read is fused into the V2 Fit panel', () => {
  const panels = readFileSync(new URL('../js/v2/panels.js', import.meta.url), 'utf8');
  assert.match(panels, /from '\.\.\/fit\/finishing-view\.js'/, 'panels imports the view module');
  assert.match(panels, /const fin = summariseFinishing\(fit\);/, 'fit(state) computes the summary');
  assert.match(panels, /\$\{renderFinishing\(fin\)\}/, 'fit(state) renders the section');
  assert.match(panels, /data-copy-fin/, 'a copy button is present');
  assert.match(panels, /finishingToText\(summariseFinishing\(fit\)\)/, 'the copy handler emits the sheet');
});

test('v2.finishing is declared, dispatched, menued and paletted', () => {
  const commands = readFileSync(new URL('../js/ui/commands.js', import.meta.url), 'utf8');
  assert.match(commands, /case 'v2\.finishing':/, 'runCommand handles v2.finishing');
  assert.match(commands, /app\.v2 && app\.v2\.open\('fit'\)/, 'the command opens the Fit dock');

  const menubar = readFileSync(new URL('../js/ui/menubar.js', import.meta.url), 'utf8');
  assert.match(menubar, /'v2\.finishing'/, "the action id is declared in MENUBAR_ACTIONS");
  assert.match(menubar, /it\('Finish this garment \(bands & pick-up\)', 'v2\.finishing'\)/, 'a menu item points at it');

  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /runCommand\('v2\.finishing'\)/, 'the Ctrl+K palette can launch it');
});
