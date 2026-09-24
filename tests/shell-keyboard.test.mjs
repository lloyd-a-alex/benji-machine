// The unified shell's keyboard interaction.
//
// Two kinds of guarantee live here, matching how the rest of the suite is
// written:
//   • behaviour of the reusable primitives in js/ui/keyboard-nav.js — the pure
//     index maths directly, and the DOM glue against a ~40-line element stub
//     (the repo has no DOM library and no dependency on one), so roving tabindex
//     and menu focus movement are actually exercised, not just asserted to exist;
//   • static contracts over chrome.js + index.html that the shell really wires
//     those primitives and ships valid ARIA (mirrors accessibility.test.mjs).
//
// Run just this file:  node --test tests/shell-keyboard.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  nextRovingIndex,
  syncRovingSelection,
  attachRovingTablist,
  attachMenuNavigation,
} from '../js/ui/keyboard-nav.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeSrc = await readFile(path.join(ROOT, 'js', 'ui', 'chrome.js'), 'utf8');
const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');

// ─── a tiny DOM stub (the helpers only ever touch these members) ──────────────
function stubTab(name) {
  return {
    name, tabIndex: -1, attrs: {}, focusCount: 0,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    focus() { this.focusCount++; },
  };
}
function stubContainer(items) {
  return {
    items, handlers: {},
    querySelectorAll() { return this.items; },
    addEventListener(type, h) { (this.handlers[type] || (this.handlers[type] = [])).push(h); },
    removeEventListener(type, h) { this.handlers[type] = (this.handlers[type] || []).filter(x => x !== h); },
    keydown(e) { (this.handlers.keydown || []).forEach(h => h(e)); },
  };
}
const ev = (key, target) => ({ key, target, prevented: false, preventDefault() { this.prevented = true; } });

// ─── pure index maths ─────────────────────────────────────────────────────────
test('nextRovingIndex walks and wraps in both orientations', () => {
  assert.equal(nextRovingIndex(4, 0, 'ArrowRight'), 1);
  assert.equal(nextRovingIndex(4, 1, 'ArrowLeft'), 0);
  assert.equal(nextRovingIndex(4, 3, 'ArrowRight'), 0, 'wraps past the end');
  assert.equal(nextRovingIndex(4, 0, 'ArrowLeft'), 3, 'wraps before the start');
  assert.equal(nextRovingIndex(4, 1, 'ArrowDown'), 2, 'vertical alias');
  assert.equal(nextRovingIndex(4, 1, 'ArrowUp'), 0, 'vertical alias');
});

test('nextRovingIndex jumps to the ends and ignores foreign keys', () => {
  assert.equal(nextRovingIndex(5, 3, 'Home'), 0);
  assert.equal(nextRovingIndex(5, 3, 'End'), 4);
  assert.equal(nextRovingIndex(5, 3, 'a'), null, 'a printable key is not navigation');
  assert.equal(nextRovingIndex(5, 3, 'Enter'), null);
});

test('nextRovingIndex is total on nonsense input', () => {
  assert.equal(nextRovingIndex(0, 0, 'ArrowRight'), null, 'no items');
  assert.equal(nextRovingIndex(3, 99, 'ArrowRight'), 1, 'out-of-range current clamps to 0 first');
  assert.equal(nextRovingIndex(undefined, null, 'End'), null);
});

test('syncRovingSelection keeps exactly one tab in the tab order and selected', () => {
  const tabs = [stubTab('a'), stubTab('b'), stubTab('c')];
  syncRovingSelection(tabs, 1);
  assert.deepEqual(tabs.map(t => t.tabIndex), [-1, 0, -1]);
  assert.deepEqual(tabs.map(t => t.attrs['aria-selected']), ['false', 'true', 'false']);
});

// ─── roving tablist glue ──────────────────────────────────────────────────────
test('attachRovingTablist moves focus + activation with the arrows, not a click', () => {
  const tabs = [stubTab('0'), stubTab('1'), stubTab('2')];
  tabs[0].tabIndex = 0;
  const box = stubContainer(tabs);
  const activated = [];
  attachRovingTablist(box, { selector: '[role="tab"]', onActivate: (i, t) => activated.push([i, t.name]) });

  const e = ev('ArrowRight', tabs[0]);
  box.keydown(e);
  assert.equal(e.prevented, true, 'a handled nav key is prevented');
  assert.equal(tabs[1].focusCount, 1, 'focus moved to the next tab');
  assert.deepEqual(activated, [[1, '1']], 'onActivate got the new index + tab');
  assert.deepEqual(tabs.map(t => t.tabIndex), [-1, 0, -1], 'tab order followed focus');
});

test('attachRovingTablist leaves unrelated keys and modifiers alone', () => {
  const tabs = [stubTab('0'), stubTab('1')];
  const box = stubContainer(tabs);
  let fired = 0;
  attachRovingTablist(box, { onActivate: () => fired++ });
  box.keydown(ev('Tab', tabs[0]));
  const ctrl = ev('ArrowRight', tabs[0]); ctrl.ctrlKey = true;
  box.keydown(ctrl);
  box.keydown(ev('ArrowRight', {})); // focus not on an item
  assert.equal(fired, 0, 'no activation for Tab / modified / off-item keys');
});

// ─── menu navigation glue ─────────────────────────────────────────────────────
test('attachMenuNavigation only moves focus (never activates) and does not wrap', () => {
  const items = [stubTab('i0'), stubTab('i1'), stubTab('i2')];
  const menu = stubContainer(items);
  attachMenuNavigation(menu, { itemSelector: '.cb-menu-item' });
  menu.keydown(ev('ArrowDown', items[1]));
  assert.equal(items[2].focusCount, 1);
  menu.keydown(ev('ArrowDown', items[2]));
  assert.equal(items[2].focusCount, 2, 'clamps at the last item instead of wrapping');
  menu.keydown(ev('Home', items[2]));
  assert.equal(items[0].focusCount, 1);
  menu.keydown(ev('End', items[0]));
  assert.equal(items[2].focusCount, 3);
});

// ─── the shell really wires the primitives ────────────────────────────────────
test('chrome.js routes the shell tablists + overflow menu through keyboard-nav', () => {
  assert.match(chromeSrc, /import[^\n]*from '\.\/keyboard-nav\.js'/, 'must import the shared module');
  assert.ok(chromeSrc.includes('attachRovingTablist(els.subtabs'), 'sub-tab strip is a keyboard tablist');
  assert.ok(chromeSrc.includes('attachRovingTablist(els.inspTabs'), 'inspector tabs are a keyboard tablist');
  assert.ok(chromeSrc.includes('attachRovingTablist(chips'), 'shelf family chips are a keyboard tablist');
  assert.ok(chromeSrc.includes('attachMenuNavigation(els.overflowMenu'), 'overflow menu is arrow-navigable');
  assert.ok(chromeSrc.includes('syncRovingSelection'), 'selection + roving tabindex sync in one place');
  assert.match(chromeSrc, /closeOverflow\(\{ restoreFocus: false \}\)/, 'picking an item must not yank focus back');
});

test('opening the overflow menu focuses its first item', () => {
  const open = chromeSrc.slice(chromeSrc.indexOf('function openOverflow'), chromeSrc.indexOf('function closeOverflow'));
  assert.match(open, /querySelector\('\.cb-menu-item'\)[\s\S]*\.focus\(\)/, 'focus lands on the first action');
});

test('the static inspector tabs ship valid ARIA before any JS runs', () => {
  const tabs = [...html.matchAll(/<button[^>]*class="[^"]*\binsp-tab\b[^"]*"[^>]*>/g)].map(m => m[0]);
  assert.equal(tabs.length, 4, 'four inspector tabs');
  const selected = tabs.filter(t => /aria-selected="true"/.test(t));
  assert.equal(selected.length, 1, 'exactly one tab starts selected');
  for (const t of tabs) {
    assert.match(t, /role="tab"/, 'every tab has its role');
    assert.match(t, /aria-selected="(true|false)"/, 'every tab declares selection');
    assert.match(t, /tabindex="(-1|0)"/, 'every tab is in the roving order');
  }
});
