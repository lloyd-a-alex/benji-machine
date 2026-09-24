// The Carriage Pass Sheet (js/machine/pass-sheet.js) — the plain-English, at-the-machine
// narration that the planner in `machine/carriage-passes.js` could always compute (`describePasses`
// + `planPatternPasses`) but which had zero consumers. These tests assert the pure composition and
// that the dormant narration is now actually reachable from the UI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPassSheet, passSheetToText } from '../js/machine/pass-sheet.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const K = STITCH_TYPE.KNIT;
const O = STITCH_TYPE.EYELET;
const TL = STITCH_TYPE.TRANSFER_LEFT;

const plainRow = (n = 5) => Array.from({ length: n }, () => K);
const laceRow = () => [K, K, TL, O, K]; // a transfer at index 2, its eyelet paid at index 3

// ─── the pure summary ────────────────────────────────────────────────────────

test('an empty or garbage chart is an honest empty sheet, never a throw', () => {
  for (const bad of [null, undefined, 'nope', {}, []]) {
    const s = buildPassSheet(bad);
    assert.equal(s.ok, true);
    assert.equal(s.totalPasses, 0);
    assert.deepEqual(s.lines, []);
  }
});

test('a purely plain card knits as exactly one pass per row', () => {
  const s = buildPassSheet([plainRow(), plainRow(), plainRow()]);
  assert.equal(s.laceRows, 0);
  assert.equal(s.plainRows, 3);
  assert.equal(s.totalPasses, 3);
  assert.equal(s.knitPasses, 3);
  assert.deepEqual(s.passesPerLaceRow, []);
});

test('a lace row costs several carriage passes and is tallied as lace', () => {
  const s = buildPassSheet([plainRow(), laceRow(), plainRow()]);
  assert.equal(s.laceRows, 1);
  assert.equal(s.plainRows, 2);
  assert.ok(s.totalPasses > 3, 'the lace row must add more than its single plain-equivalent');
  assert.ok(s.lacePasses >= 1, 'non-knit passes are counted');
  assert.equal(s.rows.find((r) => r.kind === 'lace').transfers >= 1, true);
});

test('one narration line per pass, each reading "Pass N: …"', () => {
  const s = buildPassSheet([plainRow(), laceRow()]);
  assert.equal(s.lines.length, s.totalPasses);
  s.lines.forEach((line, i) => {
    assert.equal(typeof line, 'string');
    assert.match(line, new RegExp(`^Pass ${i + 1}:`), 'lines are numbered in order');
  });
});

test('carriage start/end follows the chosen park side', () => {
  const left = buildPassSheet([plainRow()], { startSide: 'left' });
  assert.equal(left.startSide, 'LEFT');
  assert.equal(left.endsOn, 'RIGHT', 'one left-to-right knit pass parks on the right');
  const right = buildPassSheet([plainRow()], { startSide: 'RIGHT' });
  assert.equal(right.startSide, 'RIGHT');
  assert.equal(right.endsOn, 'LEFT', 'a right-start pass travels leftwards');
});

test('a direct-mode 0/1 card simply knits — no phantom lace', () => {
  const s = buildPassSheet([[0, 1, 0], [1, 0, 0]], { mode: 'fair_isle' });
  assert.equal(s.laceRows, 0);
  assert.equal(s.totalPasses, 2);
  assert.equal(s.mode, 'fair_isle');
});

test('warnings and assumptions are always clean string arrays', () => {
  const s = buildPassSheet([laceRow(), plainRow()]);
  assert.ok(Array.isArray(s.warnings));
  assert.ok(Array.isArray(s.assumptions));
  for (const w of [...s.warnings, ...s.assumptions]) assert.equal(typeof w, 'string');
});

// ─── the printable text ──────────────────────────────────────────────────────

test('the text sheet carries the header, every pass and a trailing newline', () => {
  const s = buildPassSheet([plainRow(), laceRow()], { profile: { name: 'Brother Standard' } });
  const text = passSheetToText(s, { title: 'Pass Sheet', profileLabel: 'Brother KH-910' });
  assert.match(text, /^Pass Sheet\n=+\n/);
  assert.match(text, /Machine: Brother KH-910/);
  assert.match(text, /Start left · End /);
  for (const line of s.lines) assert.ok(text.includes(line), 'every pass line is printed');
  assert.ok(text.endsWith('\n'));
});

test('a failed or absent sheet still prints a useful note', () => {
  assert.match(passSheetToText(null), /No pass sheet/);
  assert.match(passSheetToText({ ok: false, error: 'planner choked' }), /planner choked/);
});

// ─── wiring: the dormant narration now has hands ─────────────────────────────

test('pass-sheet.js is a real consumer of the previously-orphan narration', () => {
  const src = read('js/machine/pass-sheet.js');
  assert.match(src, /import \{ planPatternPasses, describePasses, SIDE \} from '\.\/carriage-passes\.js'/);
  assert.match(src, /describePasses\(plan\)/, 'the plain-English narration is actually called');
});

test('the Card Structure panel renders the sheet and can copy it', () => {
  const panel = read('js/ui/structure-panel.js');
  assert.match(panel, /from '\.\.\/machine\/pass-sheet\.js'/);
  assert.match(panel, /function renderPasses\(ed\)/);
  assert.match(panel, /renderPasses\(ed\);/, 'it is painted on every render');
  assert.match(panel, /passSheetToText\(/, 'the copy button produces printable text');
  assert.match(panel, /data-pass-copy/, 'a Copy control is mounted');
});

test('machine.passes is a declared, dispatched command', () => {
  assert.match(read('js/ui/menubar.js'), /'machine\.passes'/);
  assert.match(read('js/ui/menubar.js'), /it\('Carriage pass sheet…', 'machine\.passes'\)/);
  assert.match(read('js/ui/commands.js'), /case 'machine\.passes':/);
});

test('the pass sheet is findable from the command palette', () => {
  assert.match(read('js/app.js'), /Carriage pass sheet \(how to knit it at the machine\)/);
});
