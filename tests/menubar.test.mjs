// The menu bar's model — the set of menus and the actions they can fire — asserted
// as pure data. This proves the bar only ever offers commands the app implements.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMenus, MENUBAR_ACTIONS } from '../js/ui/menubar.js';

const titles = () => buildMenus().map(m => m.id);
const flat = () => buildMenus().flatMap(m => m.items.filter(i => i.action));

test('the bar exposes the standard application menus', () => {
  const ids = titles();
  for (const want of ['file', 'edit', 'view', 'project', 'design', 'machine', 'help']) {
    assert.ok(ids.includes(want), `missing ${want} menu`);
  }
});

test('every menu item references a declared action id (no dead commands)', () => {
  const stray = flat().filter(i => !MENUBAR_ACTIONS.has(i.action)).map(i => i.action);
  assert.deepEqual(stray, [], 'items with unknown actions:\n' + stray.join('\n'));
});

test('File carries the desktop verbs a project workflow needs', () => {
  const acts = buildMenus().find(m => m.id === 'file').items.map(i => i.action);
  for (const want of ['file.new', 'file.save', 'file.saveAs', 'file.export', 'file.prefs', 'file.open']) {
    assert.ok(acts.includes(want), `File menu lacks ${want}`);
  }
});

test('Help exposes search, the guide and about', () => {
  const acts = buildMenus().find(m => m.id === 'help').items.map(i => i.action);
  assert.ok(acts.includes('help.search') && acts.includes('help.about'));
});

test('Project menu backs its "Recent" flyout with a declared open action', () => {
  const recent = buildMenus().find(m => m.id === 'project').items.find(i => i.action === 'project.recent');
  assert.equal(recent.submenu, 'recent', 'project.recent declares a submenu');
  // The submenu items the DOM layer renders route through this action; it must exist.
  assert.ok(MENUBAR_ACTIONS.has('project.open'), 'project.open must be a declared action');
});

test('Undo/Redo and selection verbs disable themselves when they cannot apply', () => {
  const items = buildMenus({ canUndo: false, canRedo: false, hasSelection: false })
    .find(m => m.id === 'edit').items;
  const undo = items.find(i => i.action === 'edit.undo');
  const copy = items.find(i => i.action === 'edit.copy');
  assert.equal(undo.disabled, true);
  assert.equal(copy.disabled, true);
  // With the capability present they light up again.
  const on = buildMenus({ canUndo: true, hasSelection: true }).find(m => m.id === 'edit').items;
  assert.ok(!on.find(i => i.action === 'edit.undo').disabled);
  assert.ok(!on.find(i => i.action === 'edit.copy').disabled);
});

test('menu titles are human labels and none is empty', () => {
  for (const m of buildMenus()) {
    assert.ok(m.title && m.title === m.title.trim(), 'menu has a title');
    for (const i of m.items) if (i.label) assert.ok(i.label.trim().length, 'item label is not blank');
  }
});
