// The right-click menu's content logic — which actions appear for which context —
// asserted as pure data (no browser). The DOM layer only decides the "kind" and
// renders whatever menuFor returns, so pinning this pins the behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuFor, classify, CONTEXT_ACTIONS } from '../js/ui/context-menu.js';

const ids = items => items.filter(i => i.id).map(i => i.id);

test('a punched needle offers to blank it; a blank needle offers to punch it', () => {
  assert.ok(ids(menuFor('cell', { punched: true })).includes('cell.toggle'));
  const punchedItems = menuFor('cell', { punched: true });
  const toggle = punchedItems.find(i => i.id === 'cell.toggle');
  assert.match(toggle.label, /Blank/i);
  const blankToggle = menuFor('cell', { punched: false }).find(i => i.id === 'cell.toggle');
  assert.match(blankToggle.label, /Punch/i);
});

test('the cell menu exposes the "explain/highlight this symbol" affordances', () => {
  const got = ids(menuFor('cell'));
  assert.ok(got.includes('sym.highlight'));
  assert.ok(got.includes('sym.explain'));
});

test('paste is disabled without a clipboard and enabled with one', () => {
  const off = menuFor('cell', { hasClipboard: false }).find(i => i.id === 'edit.paste');
  assert.equal(off.disabled, true);
  const on = menuFor('cell', { hasClipboard: true }).find(i => i.id === 'edit.paste');
  assert.equal(!!on.disabled, false);
});

test('a live selection promotes clipboard + transform verbs that a bare cell hides', () => {
  const sel = ids(menuFor('selection'));
  assert.ok(sel.includes('edit.duplicate'));
  assert.ok(sel.includes('edit.rotateCW'));
  assert.ok(sel.includes('edit.flipH'));
  // A single cell context should not offer whole-selection transforms.
  assert.ok(!ids(menuFor('cell')).includes('edit.duplicate'));
});

test('project, panel, mode and link contexts each carry their own verbs', () => {
  assert.ok(ids(menuFor('project')).includes('proj.open'));
  assert.ok(ids(menuFor('panel')).includes('win.close'));
  const mode = menuFor('mode', { mode: 'tuck' }).find(i => i.id === 'mode.set');
  assert.match(mode.label, /Tuck/);
  assert.ok(ids(menuFor('link')).includes('link.copy'));
});

test('every referenced action id is declared in the CONTEXT_ACTIONS contract', () => {
  const kinds = ['cell', 'selection', 'canvas', 'panel', 'mode', 'tool', 'project', 'link', 'image', 'text', 'default'];
  const stray = [];
  for (const k of kinds) for (const it of menuFor(k, {})) if (it.id && !CONTEXT_ACTIONS.has(it.id)) stray.push(`${k}:${it.id}`);
  assert.deepEqual(stray, [], 'menu offered undeclared actions:\n' + stray.join('\n'));
});

test('menuFor never throws on an unknown kind and returns the default verbs', () => {
  const got = ids(menuFor('made-up-kind'));
  assert.ok(got.includes('app.studio'));
  assert.ok(got.includes('app.search'));
});

// ── classify: the "what did I right-click?" decision (regression: the selection
// menu was dead because it probed a selectionActive() method the editor lacks).

const canvasTarget = () => ({ tagName: 'CANVAS', closest: sel => (sel === 'canvas' ? { tag: 'canvas' } : null) });

test('classify flags a canvas right-click as a selection only via getSelectionBounds', () => {
  const ed = { getSelectionBounds: () => ({ r1: 0, c1: 0, r2: 3, c2: 3 }), hoverCell: { r: 0, c: 0 }, matrix: [[0]] };
  const out = classify(canvasTarget(), { getEditor: () => ed });
  assert.equal(out.kind, 'selection');
  assert.ok(ids(menuFor(out.kind, out.flags)).includes('edit.duplicate'), 'the selection verbs really appear');
});

test('a bare hover (no selection bounds) classifies as a single cell', () => {
  const ed = { getSelectionBounds: () => null, hoverCell: { r: 0, c: 0 }, matrix: [[0]] };
  const out = classify(canvasTarget(), { getEditor: () => ed });
  assert.equal(out.kind, 'cell');
  assert.equal(out.flags.punched, false);
});

test('classify survives an editor that is missing entirely', () => {
  const out = classify(canvasTarget(), { getEditor: () => null });
  assert.equal(out.kind, 'cell');
  assert.equal(out.flags.hasClipboard, false);
});
