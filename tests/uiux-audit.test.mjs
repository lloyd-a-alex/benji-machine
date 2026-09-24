// KNITCAT — UI/UX audit regression battery.
//
// Every assertion locks in a specific fix from the exhaustive, knitter-centric
// UI/UX audit, so a future edit that quietly re-introduces a defect fails the
// build the moment it lands. The defects pinned here (from the perspective of an
// experienced knitter who values clarity, efficiency and workflow logic):
//
//   • the "tacky" loud solid-cyan active tile on the Design/Verify/Simulate rail;
//   • icon-only rail buttons with no accessible name (Settings used to be silent);
//   • the machine name clipped to "Brother Stanc" by a too-narrow setup rail;
//   • a duplicate "Machine" caption stacked above the picker's own label;
//   • the "Patterns" edge tab floating mid-canvas while the drawer was open;
//   • the drawer having no header / close affordance of its own;
//   • the command bar clipping the essential "All actions" button;
//   • a "▾" on the surface chip promising a dropdown that only ever cycles;
//   • text-only Design Health action buttons;
//   • the status bar showing "Studio | Studio" (two controls, one job);
//   • the redundant 52px empty Projects footer eating the workspace;
//   • decorative glyphs leaking into the assistive-tech reading order.
//
// These are static contracts over index.html + the shell modules, mirroring the
// house style of shell-keyboard.test.mjs / accessibility.test.mjs.
//
// Run just this file:  node --test "tests/uiux-audit.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
const chrome = await readFile(path.join(ROOT, 'js', 'ui', 'chrome.js'), 'utf8');
const taskbar = await readFile(path.join(ROOT, 'js', 'ui', 'taskbar.js'), 'utf8');
const hub = await readFile(path.join(ROOT, 'js', 'features', 'project-hub.js'), 'utf8');

// The unified shell ships one inline stylesheet; scope every CSS probe to it so a
// same-named selector in css/styles.css can never satisfy an assertion by accident.
const cssMatch = /<style id="kx-shell-css">([\s\S]*?)<\/style>/.exec(html);
assert.ok(cssMatch, 'the kx-shell-css block must exist in index.html');
const shellCss = cssMatch[1];

/** Escape a literal CSS selector for safe use inside a RegExp. */
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The declaration body of the FIRST rule whose selector is exactly `sel`. */
function ruleBody(sel) {
  const m = new RegExp(`${esc(sel)}\\s*\\{([^}]*)\\}`).exec(shellCss);
  return m ? m[1] : '';
}

// ─── the surface rail (the "tacky" complaint) ─────────────────────────────────

test('the active surface is marked by an accent bar + faint fill, not a loud solid block', () => {
  const active = ruleBody('.sr-btn.is-active');
  assert.ok(active, 'the active-surface rule exists');
  assert.match(active, /color-mix\(/, 'the fill must be translucent, not a solid accent');
  assert.ok(!/#04101e/.test(active), 'no dark-on-solid text (the filled tile that read as toy-like)');
  assert.match(shellCss, /\.sr-btn::before\s*\{/, 'a ::before accent bar carries the "you are here" cue');
});

test('every surface-rail button carries an accessible name and a visible text label', () => {
  const btns = [...html.matchAll(/<button\b[^>]*class="[^"]*\bsr-btn\b[^"]*"[^>]*>/g)].map(m => m[0]);
  assert.ok(btns.length >= 7, `expected the full rail (4 surfaces + 3 utilities), found ${btns.length}`);
  const unnamed = btns.filter(b => !/aria-label="[^"]+"/.test(b));
  assert.deepEqual(unnamed, [], 'rail buttons without an aria-label:\n' + unnamed.join('\n'));
  // None may be icon-only: every rail button shows a text label (Settings used to be silent).
  const labels = (html.match(/class="sr-label"/g) || []).length;
  assert.equal(labels, btns.length, 'every rail button should show a text label');
});

// ─── the machine selector / setup rail ────────────────────────────────────────

test('the setup rail is wide enough that a long machine name is not clipped', () => {
  const m = /#setup-rail\s*\{[^}]*width:\s*(\d+)px/.exec(shellCss);
  assert.ok(m, 'the base #setup-rail width is declared');
  assert.ok(Number(m[1]) >= 150, `setup rail should be >=150px so "Brother Standard Gauge" fits, is ${m[1]}px`);
});

test('the machine picker has a single caption (no duplicate "Machine" heading)', () => {
  assert.ok(!shellCss.includes('kx-setup-cap'), 'the redundant caption style is gone from the sheet');
  assert.ok(!chrome.includes('kx-setup-cap'), 'chrome.js no longer injects a duplicate caption above the label');
});

// ─── the pattern shelf / drawer ───────────────────────────────────────────────

test('the Patterns edge tab hides when the drawer opens and never floats over the canvas', () => {
  const open = ruleBody('body.kx-shelf-open #kx-shelf-handle');
  assert.ok(open, 'the open-state rule exists');
  assert.match(open, /opacity:\s*0/, 'the tab fades away once the drawer is up');
  assert.match(open, /pointer-events:\s*none/, 'and stops intercepting clicks over the chart');
  assert.ok(!/bottom:\s*calc\(min\(52%/.test(shellCss), 'the old rule that pushed the tab into the canvas is gone');
});

test('the pattern drawer carries its own header with a close affordance', () => {
  assert.match(shellCss, /\.ps-head\s*\{/, 'a drawer header row is styled');
  assert.match(shellCss, /\.ps-close\s*\{/, 'the header close button is styled');
  assert.ok(chrome.includes('shelf.append(head, bar, shelfStripEl)'), 'the header is mounted as the first row');
  assert.ok(chrome.includes("closeBtn.className = 'ps-close'"), 'a close button is built');
  assert.match(chrome, /closeBtn\.addEventListener\('click', \(\) => closeShelf\(\)\)/, 'the close button dismisses the drawer');
});

test('opening the drawer resets the chip scroll so the first families are visible', () => {
  assert.match(chrome, /bar\.scrollLeft = 0/, 'the filter row scrolls back to the start on open');
});

test('the drawer search field is wide enough to show its placeholder', () => {
  const m = /\.ps-search\s*\{[^}]*min-width:\s*(\d+)px/.exec(shellCss);
  assert.ok(m, 'the search field declares a min-width');
  assert.ok(Number(m[1]) >= 120, `search should be >=120px so "Search motifs" is not cut to "Search moti", is ${m[1]}px`);
});

// ─── the command bar ──────────────────────────────────────────────────────────

test('the command bar never clips the essential "All actions" button', () => {
  const bar = ruleBody('#command-bar');
  assert.ok(bar, 'the base #command-bar rule exists');
  assert.ok(!/overflow:\s*hidden/.test(bar), 'no overflow:hidden that would silently hide the last action');
});

test('the surface chip signals cycling (⇄), not a dropdown that never opens', () => {
  const after = ruleBody('.cb-surface-name::after');
  assert.ok(after, 'the chip affordance pseudo-element exists');
  assert.match(after, /\\21C4/, 'uses the ⇄ cycle glyph');
  assert.ok(!/\\25BE/.test(after), 'not the ▾ dropdown caret');
});

test('decorative command-bar glyphs are hidden from assistive tech', () => {
  assert.match(html, /id="cb-act-glyph" aria-hidden="true"/, 'the primary CTA glyph is decorative');
  assert.match(html, /id="cb-surface-glyph" aria-hidden="true"/, 'the surface chip glyph is decorative');
});

// ─── the Design Health inspector ──────────────────────────────────────────────

test('the Design Health action buttons carry icons, not bare text', () => {
  const advisor = /id="btn-health-advisor"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  const universe = /id="btn-health-universe"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  assert.ok(advisor && /kx-act-glyph/.test(advisor[1]), '"Full advisor" has a leading glyph');
  assert.ok(universe && /kx-act-glyph/.test(universe[1]), '"Machine universe" has a leading glyph');
});

// ─── the status bar ────────────────────────────────────────────────────────────

test('the status bar shows a single merged Studio control, never "Studio | Studio"', () => {
  assert.ok(hub.includes('link.appendChild(resume)'), 'the resume line lives INSIDE the studio link');
  assert.ok(!/right\.insertBefore\(resume/.test(hub), 'the resume span is not a separate sibling node');
  assert.ok(hub.includes("'\\u25a4 Studio'"), 'the idle state reads "▤ Studio"');
});

test('the decorative status line yields space before the machine telemetry', () => {
  assert.match(html, /class="status-love"/, 'the love line is classed so it can shrink');
  assert.match(shellCss, /\.status-right>\.status-love\s*\{[^}]*text-overflow:\s*ellipsis/, 'it ellipsises when space is tight');
});

// ─── the project taskbar footer ───────────────────────────────────────────────

test('the empty Projects dock hides itself instead of eating 52px of workspace', () => {
  assert.match(taskbar, /if \(!items\.length\) \{ bar\.innerHTML = ''; bar\.hidden = true;/, 'an empty library collapses the bar');
  assert.ok(!taskbar.includes('No saved projects yet'), 'the redundant empty-state message is gone');
  assert.ok(!taskbar.includes('kx-tb-empty'), 'and its orphaned style rule was removed too');
});
