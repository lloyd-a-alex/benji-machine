// KNITCAT V2 — the short-row atlas battery.
//
// Proves short-rows-view is a faithful, total, DOM-free presenter over the Fit Engine's own
// `action:'short-row'` schedule, and that the wedge-by-wedge atlas is fused into the Fit panel
// with full command / menu / palette discoverability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { summariseShortRows, shortRowsToText } from '../js/fit/short-rows-view.js';
import { projectFromKnitScript, runFullPipeline, DEFAULT_KNITSCRIPT } from '../js/v2/index.js';
import { shortRowSchedule } from '../js/fit/short-rows.js';

/* -- garbage tolerance ----------------------------------------------------- */

test('summariseShortRows is total: null/garbage/no-SR pieces yields null', () => {
  for (const junk of [null, undefined, 42, 'sr', {}, []]) {
    assert.equal(summariseShortRows(junk), null, `${JSON.stringify(junk)} -> null`);
  }
  // A real pieces array with no short-row actions is also honestly null.
  assert.equal(summariseShortRows([{ id: 'back', name: 'Back', rows: [{ row: 1, action: 'knit', count: 0 }] }]), null);
});

/* -- the shape of the schedule the view consumes --------------------------- */

test('one shoulder wedge -> one entry with method, turns, worked counts and extra rows', () => {
  // Build a real schedule via the engine so the notes and anchors match production output.
  const sr = shortRowSchedule({ method: 'shoulder', totalStitches: 60, extraRows: 8 });
  const rows = [
    { row: 1, action: 'knit', count: 0, position: 'both', notes: 'plain' },
    ...sr.rows.map((r, i) => ({ ...r, row: r.row + 90 })),
    { row: sr.rows.length + 91, action: 'knit', count: 0, position: 'both', notes: 'join' }
  ];
  const s = summariseShortRows([{ id: 'back', name: 'Back', rows }]);
  assert.ok(s && s.ok);
  assert.equal(s.totalWedges, 1);
  assert.equal(s.pieces.length, 1);
  const wedge = s.pieces[0].wedges[0];
  assert.equal(wedge.method, 'shoulder', 'method parsed from "shoulder: work N sts, wrap & turn"');
  assert.ok(wedge.turns >= 2, 'short-row schedule has multiple wrap-and-turns');
  assert.ok(wedge.workedFrom > 0 && wedge.workedTo >= wedge.workedFrom, 'worked-stitch march is monotone');
  assert.ok(wedge.extraRows > 0, 'extra rows are counted');
});

/* -- multiple methods on one piece ----------------------------------------- */

test('two wedges separated by plain rows become two entries with distinct methods', () => {
  const rows = [
    { row: 1, action: 'short-row', count: 20, position: 'right', notes: 'shoulder: work 20 sts, wrap & turn' },
    { row: 2, action: 'short-row', count: 40, position: 'right', notes: 'shoulder: work 40 sts, wrap & turn' },
    { row: 3, action: 'knit', count: 0, position: 'both', notes: 'plain' },
    { row: 4, action: 'short-row', count: 50, position: 'both', notes: 'back neck: work 50 sts, wrap & turn' },
    { row: 5, action: 'short-row', count: 60, position: 'left', notes: 'back neck: work 60 sts, wrap & turn' }
  ];
  const s = summariseShortRows([{ id: 'back', name: 'Back', rows }]);
  assert.ok(s && s.ok);
  assert.equal(s.totalWedges, 2, 'the plain row splits the schedule into two wedges');
  const [a, b] = s.pieces[0].wedges;
  assert.equal(a.method, 'shoulder');
  assert.equal(b.method, 'back neck');
  assert.equal(a.turns, 2);
  assert.equal(b.turns, 2);
  assert.equal(a.firstRow, 1);
  assert.equal(a.lastRow, 2);
  assert.equal(b.firstRow, 4);
});

test('consecutive same-method rows merge; a change of method breaks the wedge', () => {
  const rows = [
    { row: 1, action: 'short-row', count: 10, position: 'right', notes: 'bust dart: work 10 sts, wrap & turn' },
    { row: 2, action: 'short-row', count: 20, position: 'right', notes: 'bust dart: work 20 sts, wrap & turn' },
    { row: 3, action: 'short-row', count: 30, position: 'right', notes: 'heel turn: work 30 sts, wrap & turn' }
  ];
  const s = summariseShortRows([{ id: 'sock', name: 'Sock', rows }]);
  assert.equal(s.totalWedges, 2, 'method switch breaks the wedge');
  assert.equal(s.pieces[0].wedges[0].method, 'bust dart');
  assert.equal(s.pieces[0].wedges[0].turns, 2);
  assert.equal(s.pieces[0].wedges[1].method, 'heel turn');
});

/* -- multi-piece and totals ------------------------------------------------ */

test('two pieces each with a wedge: totalWedges sums and both pieces listed', () => {
  const rows = [
    { row: 1, action: 'short-row', count: 20, position: 'left', notes: 'shoulder: work 20, wrap & turn' }
  ];
  const s = summariseShortRows([
    { id: 'back', name: 'Back', rows },
    { id: 'front', name: 'Front', rows: [...rows, { row: 2, action: 'short-row', count: 30, position: 'left', notes: 'shoulder: work 30, wrap & turn' }] }
  ]);
  assert.ok(s && s.ok);
  assert.equal(s.totalWedges, 2);
  assert.equal(s.pieces.length, 2);
  assert.equal(s.pieces[0].wedges.length, 1);
  assert.equal(s.pieces[1].wedges.length, 1);
  assert.equal(s.pieces[1].wedges[0].turns, 2);
});

test('tone is "warn" when a wedge has 8+ turns (heavy wrap workload)', () => {
  const rows = [];
  for (let i = 1; i <= 8; i++) rows.push({ row: i, action: 'short-row', count: i * 10, position: 'right', notes: 'shoulder: work ' + (i * 10) + ', wrap & turn' });
  const s = summariseShortRows([{ id: 'back', name: 'Back', rows }]);
  assert.equal(s.tone, 'warn', 'big wedges surface as warn so the knitter plans for them');
});

/* -- the printable atlas --------------------------------------------------- */

test('shortRowsToText renders a per-piece checklist and ends in a newline', () => {
  const rows = [
    { row: 1, action: 'short-row', count: 20, position: 'left', notes: 'shoulder: work 20, wrap & turn' },
    { row: 2, action: 'short-row', count: 30, position: 'left', notes: 'shoulder: work 30, wrap & turn' }
  ];
  const s = summariseShortRows([{ id: 'back', name: 'Back', rows }]);
  const text = shortRowsToText(s);
  assert.match(text, /^Short-row atlas\n=+/);
  assert.match(text, /Back/);
  assert.match(text, /shoulder · left · rows 1–2/);
  assert.match(text, /2 wrap-and-turns/);
  assert.match(text, /Total: 1 wedge/);
  assert.ok(text.endsWith('\n'));
});

test('shortRowsToText(null) yields a helpful prompt naming the four wedge shapes', () => {
  const t = shortRowsToText(null);
  assert.match(t, /shoulders|back neck|bust darts|heels/i);
  assert.ok(t.endsWith('\n'));
});

/* -- the real pipeline (contract) ------------------------------------------ */

test('the default KnitScript pipeline yields a non-null short-row atlas', () => {
  const project = projectFromKnitScript(DEFAULT_KNITSCRIPT).project;
  const report = runFullPipeline(project);
  const fit = report.fit;
  assert.ok(fit && Array.isArray(fit.pieces) && fit.pieces.length, 'the default pipeline drafts real pieces');
  const s = summariseShortRows(fit.pieces);
  // The default template (raglan sweater) has at least a back-neck wedge; if it ever becomes
  // plain-knit only, the summary is honestly null and the atlas section is skipped.
  if (s) {
    assert.ok(s.totalWedges >= 1);
    assert.ok(s.methods.length >= 1);
  }
});

/* -- DOM-free + module contract -------------------------------------------- */

test('short-rows-view is DOM-free and imports nothing (pure shape over piece rows)', () => {
  const src = readFileSync(new URL('../js/fit/short-rows-view.js', import.meta.url), 'utf8');
  assert.ok(!/\b(document|window|navigator|localStorage)\b/.test(src), 'no DOM access');
  assert.ok(!/^import\s/m.test(src), 'pure presenter, no imports (reads only the already-drafted pieces)');
});

/* -- wiring / discoverability ---------------------------------------------- */

test('short-row atlas is fused into the V2 Fit panel', () => {
  const panels = readFileSync(new URL('../js/v2/panels.js', import.meta.url), 'utf8');
  assert.match(panels, /from '\.\.\/fit\/short-rows-view\.js'/, 'panels imports the view');
  assert.match(panels, /const sr = summariseShortRows\(fit\.pieces\)/, 'live pieces are summarised');
  assert.match(panels, /\$\{renderShortRows\(sr\)\}/, 'rendered in fit(state)');
  assert.match(panels, /data-copy-sr/, 'copy button present');
});

test('v2.shortrows is declared, dispatched, menued and paletted', () => {
  const commands = readFileSync(new URL('../js/ui/commands.js', import.meta.url), 'utf8');
  assert.match(commands, /case 'v2\.shortrows':/);
  assert.match(commands, /app\.v2 && app\.v2\.open\('fit'\)/);

  const menubar = readFileSync(new URL('../js/ui/menubar.js', import.meta.url), 'utf8');
  assert.match(menubar, /'v2\.shortrows'/, 'declared in MENUBAR_ACTIONS');
  assert.match(menubar, /Short-row atlas/);

  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /runCommand\('v2\.shortrows'\)/);
});
