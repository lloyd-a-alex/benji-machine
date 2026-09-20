// Accessibility guarantees that live in the markup.
//
// These are the a11y properties the audit flagged as silently absent, and the
// kind that regress without anyone noticing because nothing "breaks" when you
// click around. So they are pinned here as static assertions over index.html:
//   • a keyboard "skip to content" link that really points somewhere focusable;
//   • every icon-only tool button carries an accessible name;
//   • every canvas is either described (role="img" + aria-label) or explicitly
//     decorative (aria-hidden), so a screen reader is never handed silence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');

function openingTags(re) {
  return [...html.matchAll(re)].map(m => m[0]);
}

test('there is a skip link and its target is focusable', () => {
  const link = openingTags(/<a\b[^>]*class="[^"]*\bskip-link\b[^"]*"[^>]*>/g);
  assert.equal(link.length, 1, 'exactly one skip link');
  const href = link[0].match(/href="#([^"]+)"/);
  assert.ok(href, 'the skip link points at an in-page id');
  const targetId = href[1];
  const target = openingTags(new RegExp(`<(?:main|div|section)[^>]*id="${targetId}"[^>]*>`, 'g'));
  assert.equal(target.length, 1, `skip target #${targetId} exists`);
  // A skipped-to landmark must be focusable or the browser just anchors silently.
  assert.match(target[0], /tabindex="-1"/, 'the skip target can take focus');
});

test('every icon-only tool button has an accessible name', () => {
  const buttons = openingTags(/<button\b[^>]*class="[^"]*\btool-btn\b[^"]*"[^>]*>/g);
  assert.ok(buttons.length >= 8, `expected the full tool palette, found ${buttons.length}`);
  const unnamed = buttons.filter(b => !/aria-label="[^"]+"/.test(b));
  assert.deepEqual(unnamed, [], 'tool buttons without aria-label:\n' + unnamed.join('\n'));
});

test('every canvas is named or marked decorative', () => {
  const canvases = openingTags(/<canvas\b[^>]*>/g);
  // Floor guards against accidentally wiping the canvas set. It was 9 until the
  // three tailor tabs (tank top / beanie / clothes) merged into the single Clothes
  // tab, which retired two dedicated canvases - hence 7. The real guarantee is the
  // loop below: every remaining canvas carries an accessible name.
  assert.ok(canvases.length >= 7, `found ${canvases.length} canvases`);
  const silent = canvases.filter(
    c => !/aria-label="[^"]+"/.test(c) && !/aria-hidden="true"/.test(c)
  );
  assert.deepEqual(silent, [], 'canvases with no accessible name:\n' + silent.join('\n'));
});

test('labelled canvases expose them as images', () => {
  // An aria-label on a canvas is only announced with a role; catch a label that
  // was added without its role.
  const canvases = openingTags(/<canvas\b[^>]*>/g);
  const mislabelled = canvases.filter(
    c => /aria-label="[^"]+"/.test(c) && !/role="img"/.test(c)
  );
  assert.deepEqual(mislabelled, [], 'aria-labelled canvases missing role="img":\n' + mislabelled.join('\n'));
});

test('the workspace tab bar is a complete, keyboard-navigable tablist', () => {
  // The primary view-switcher used to be bare buttons that only reacted to a
  // mouse. It is now a real ARIA tablist wired for arrows/Home/End with a roving
  // tabindex. Pin the markup contract statically (the same convention as the
  // rest of this file): roles present, each tab bound to its panel and vice
  // versa, and exactly one tab selected.
  const bar = openingTags(/<nav\b[^>]*class="[^"]*\btab-bar\b[^"]*"[^>]*>/g);
  assert.equal(bar.length, 1, 'exactly one tab bar');
  assert.match(bar[0], /role="tablist"/, 'the tab bar is a tablist');
  assert.match(bar[0], /aria-label="[^"]+"/, 'the tablist is named');

  const tabs = openingTags(/<button\b[^>]*class="[^"]*\btab-btn\b[^"]*"[^>]*>/g);
  assert.equal(tabs.length, 7, `expected 7 workspace tabs, found ${tabs.length}`);
  const panelIds = new Set([...html.matchAll(/<div\b[^>]*class="[^"]*\btab-panel\b[^"]*"[^>]*>/g)]
    .map(m => (m[0].match(/id="([^"]+)"/) || [])[1]).filter(Boolean));

  const selected = tabs.filter(t => /aria-selected="true"/.test(t));
  assert.equal(selected.length, 1, 'exactly one tab is selected');

  const badTabs = [];
  for (const t of tabs) {
    const id = (t.match(/id="([^"]+)"/) || [])[1];
    const controls = (t.match(/aria-controls="([^"]+)"/) || [])[1];
    if (!/role="tab"/.test(t)) badTabs.push(`no role=tab: ${t}`);
    if (!id) badTabs.push(`no id: ${t}`);
    if (!controls || !panelIds.has(controls)) badTabs.push(`aria-controls not a panel: ${controls}`);
    if (!/aria-selected="(true|false)"/.test(t)) badTabs.push(`no aria-selected: ${t}`);
    if (!/tabindex="(-1|0)"/.test(t)) badTabs.push(`no roving tabindex: ${t}`);
  }
  assert.deepEqual(badTabs, [], 'malformed tabs:\n' + badTabs.join('\n'));

  const panels = openingTags(/<div\b[^>]*class="[^"]*\btab-panel\b[^"]*"[^>]*>/g);
  const tabIds = new Set(tabs.map(t => (t.match(/id="([^"]+)"/) || [])[1]));
  const badPanels = panels.filter(p => {
    const label = (p.match(/aria-labelledby="([^"]+)"/) || [])[1];
    return !/role="tabpanel"/.test(p) || !label || !tabIds.has(label);
  });
  assert.deepEqual(badPanels, [], 'panels not labelled back to a tab:\n' + badPanels.join('\n'));
});
