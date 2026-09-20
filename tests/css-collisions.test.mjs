// CSS collision guarantees — "nothing is silently fighting."
//
// A stylesheet grows by accretion: someone adds `#right-sidebar { width: … }`
// at the bottom of the file, twenty media-query tiers already set it elsewhere,
// and suddenly two rules in the SAME scope fight over the SAME property and the
// one that happens to come last wins. Nothing throws; the layout just looks
// wrong "especially on the sidebar, no joke." These tests parse the real
// stylesheet (and the inline `<style>` in index.html) with a brace-aware,
// comment-aware, string-aware scanner that tracks the `@media`/`@supports`
// scope each rule lives in, then assert that no two rules collide.
//
// The scope tracking is the whole point: a responsive override inside
// `@media (max-width: 900px)` is NOT a collision with the base rule — they are
// different scopes and the cascade between them is intentional. Only rules that
// share a selector AND a scope AND a property, yet disagree on the value, are a
// genuine silent fight. That is what every check below hunts, exhaustively:
//
//   • duplicate element ids in the markup (two rules/JS can grab the wrong one);
//   • a property declared twice inside a single block (one is dead);
//   • the same selector+scope+property redefined to a different value across
//     blocks (the classic "later rule wins" collision);
//   • two `!important` rules on the same selector+scope+property (an
//     unresolvable source-order tie — a specificity arms race);
//   • the same `:root` design token defined twice with different values;
//   • `@keyframes` / `@font-face` name collisions (last definition wins).
//
// Run just this file:  node --test "tests/css-collisions.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = path.join(ROOT, 'index.html');
const CSS_PATH = path.join(ROOT, 'css', 'styles.css');

const html = await readFile(HTML_PATH, 'utf8');
const stylesCss = await readFile(CSS_PATH, 'utf8');

// ─── tiny helpers ───────────────────────────────────────────────────────────

/** Collapse every run of whitespace to a single space and trim. */
const collapse = s => s.replace(/\s+/g, ' ').trim();
/** A whitespace-free canonical form (used for media conditions). */
const stripWs = s => s.replace(/\s+/g, '');
/** CSS element/selector matching is ASCII case-insensitive for our purposes. */
const normSelector = s => collapse(s).toLowerCase();
/** Split on top-level commas only (never inside `:is(a, b)` / `url(..)`). */
function splitSelectorList(sel) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map(normSelector).filter(Boolean);
}

// ─── the CSS scanner ─────────────────────────────────────────────────────────
//
// Emits one record per qualified declaration block:
//   { selector, scope, decls:[{prop, value, important}], line, blockId }
// plus at-rule side channels we care about (keyframes / font-face names).

function parseCss(css) {
  const rules = [];
  const atNames = [];      // { kind:'keyframes'|'font-face', name }
  const frames = [];       // active nesting frames
  let buf = '';
  let line = 1;
  let paren = 0;
  let blockSeq = 0;
  let inStr = null;        // the quote char we are inside, or null

  const currentScope = () =>
    frames.filter(f => f.type === 'group').map(f => f.scope).join(' && ');
  // A block is only a real style rule if no ancestor at-rule opted out (we push a
  // `skip` frame for @keyframes / @font-face). Their interiors (`from {}`, `0% {}`)
  // carry step selectors that would otherwise collide across unrelated animations.
  const insideSkip = () => frames.some(f => f.type === 'skip');

  const flushDecl = frame => {
    const text = buf;
    buf = '';
    if (!frame || text.trim() === '') return;
    const colon = text.indexOf(':');
    if (colon < 0) return;                       // not a declaration (guard)
    let prop = text.slice(0, colon).trim().toLowerCase();
    let value = text.slice(colon + 1);
    if (!prop || prop.startsWith('@')) return;
    let important = false;
    const imp = /!\s*important\s*$/i.exec(value);
    if (imp) { important = true; value = value.slice(0, imp.index); }
    frame.decls.push({ prop, value: collapse(value), important });
  };

  for (let i = 0; i < css.length; i++) {
    const c = css[i];

    // Strings: consume verbatim so ; { } inside quotes are inert.
    if (inStr) {
      if (c === '\\') { buf += c + (css[i + 1] || ''); i++; continue; }
      if (c === inStr) inStr = null;
      buf += c;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; buf += c; continue; }

    // Comments: skip wholesale, keeping the line counter honest.
    if (c === '/' && css[i + 1] === '*') {
      i += 2;
      while (i < css.length && !(css[i] === '*' && css[i + 1] === '/')) {
        if (css[i] === '\n') line++;
        i++;
      }
      i++; // consume the '/' of '*/'
      continue;
    }

    if (c === '\n') { line++; buf += ' '; continue; }
    if (c === '(') { paren++; buf += c; continue; }
    if (c === ')') { paren = Math.max(0, paren - 1); buf += c; continue; }

    if (c === '{') {
      const prelude = collapse(buf);
      buf = ''; paren = 0;
      const at = /^@([\w-]+)([\s\S]*)$/.exec(prelude);
      if (at) {
        const kind = at[1].toLowerCase();
        const rest = collapse(at[2] || '');
        if (kind === 'media') frames.push({ type: 'group', scope: `@media ${stripWs(rest)}` });
        else if (kind === 'supports' || kind === 'layer' || kind === 'container')
          frames.push({ type: 'group', scope: `@${kind} ${stripWs(rest)}` });
        else {
          frames.push({ type: 'skip' });
          if (kind === 'keyframes' || kind === '-webkit-keyframes' || kind === '-moz-keyframes') {
            atNames.push({ kind: 'keyframes', name: normSelector(rest), line });
          } else if (kind === 'font-face') {
            atNames.push({ kind: 'font-face', name: prelude, line });
          }
        }
      } else {
        frames.push({ type: 'rule', selector: prelude, scope: currentScope(), decls: [], line, blockId: blockSeq++, record: !insideSkip() });
      }
      continue;
    }

    if (c === '}') {
      const f = frames[frames.length - 1];
      if (f && f.type === 'rule' && f.record) {
        flushDecl(f);
        rules.push({ selector: f.selector, scope: f.scope, decls: f.decls, line: f.line, blockId: f.blockId });
      } else {
        buf = '';
      }
      frames.pop();
      continue;
    }

    if (c === ';' && paren === 0) {
      const f = frames[frames.length - 1];
      if (f && f.type === 'rule') flushDecl(f);
      else buf = '';
      continue;
    }

    buf += c;
  }
  return { rules, atNames };
}

// A per-source bundle: parse the sheet, then index every
// (selector, scope, property) it touches. Collisions are computed WITHIN a
// source only — an inline `<style>` intentionally overriding the linked sheet
// is normal authoring, not a fight between two rules of equal footing.
function indexSource(label, css) {
  const { rules, atNames } = parseCss(css);
  // key = selector \x01 scope \x01 property  -> list of touching entries
  const byProp = new Map();
  const loc = r => `${label}:${r.line}`;

  for (const rule of rules) {
    const sels = splitSelectorList(rule.selector);
    for (const sel of sels) {
      for (const d of rule.decls) {
        const key = `${sel}\u0001${rule.scope}\u0001${d.prop}`;
        if (!byProp.has(key)) byProp.set(key, []);
        byProp.get(key).push({ sel, scope: rule.scope, prop: d.prop, value: d.value, important: d.important, blockId: rule.blockId, where: loc(rule) });
      }
      // remember how many blocks share this selector+scope
      const selKey = `${sel}\u0001${rule.scope}`;
      if (!byProp.has('@@BLOCKS@@' + selKey)) byProp.set('@@BLOCKS@@' + selKey, new Set());
      byProp.get('@@BLOCKS@@' + selKey).add(rule.blockId);
    }
  }
  return { label, rules, atNames, byProp };
}

const sources = [
  indexSource('styles.css', stylesCss),
  ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m, i) => indexSource(`index.html<style#${i + 1}>`, m[1])),
];

const isBlockMarker = key => key.startsWith('@@BLOCKS@@');
const describeEntry = e => `${e.prop}:${e.value}${e.important ? ' !important' : ''} @ ${e.where}${e.scope ? ` [${e.scope}]` : ''}`;

// ─── the registry of INTENTIONAL overrides ──────────────────────────────────
//
// "Nothing is silently fighting" does not mean "nothing ever overrides" — a
// theme layer and progressive-enhancement fallbacks are legitimate, deliberate
// uses of the cascade. It means every such override is DECLARED, not discovered
// by accident. So any same-scope override has to appear here with a reason;
// anything NOT listed that the scanner flags is a genuine, undeclared fight and
// fails the build. This is the whole point: it turns the messy pile of
// "everything is colliding" into a curated, justified set — and catches the next
// accidental duplicate a future edit introduces the moment it lands.
//
// Base (non-media) rules use an empty scope, matching the scanner's key format.
const ovKey = (sel, scope, prop) => `${collapse(sel).toLowerCase()}\u0001${scope}\u0001${prop.toLowerCase()}`;

// Cross-block, same selector + same scope, different value (test 3).
const INTENTIONAL_OVERRIDES = new Map();
const allowOverride = (sel, prop, reason, scope = '') =>
  INTENTIONAL_OVERRIDES.set(ovKey(sel, scope, prop), { reason, hits: 0 });

// The signature-polish layer at the foot of the sheet re-themes a few base
// controls on purpose (later rule wins is the mechanism, not a mistake).
allowOverride('.brand-title', 'color', 'gradient text: solid base color, then transparent + background-clip:text when supported');
allowOverride('.btn-action.btn-primary', 'background', 'signature-polish re-theme (later rule wins by design)');
allowOverride('.btn-action.btn-primary', 'border-color', 'signature-polish re-theme');
allowOverride('.btn-action.btn-primary', 'color', 'signature-polish re-theme');
allowOverride('.btn-action', 'transition', 'unified springy transition applied to all button families at once');
allowOverride('.toolbar-btn', 'transition', 'unified springy transition');
allowOverride('.tool-btn', 'transition', 'unified springy transition');
// Documented, deliberate exception in the sheet itself.
allowOverride('#panel-punchcard .canvas-wrapper', 'overflow', '1:1 ribbon is drawn taller than its box on purpose — must scroll');
// Tailor sidebar runs tighter than generic panel chrome (deliberate visual density).
allowOverride('.tanktop-section-title', 'letter-spacing', 'dense tailor sidebar opts under the shared .sidebar-title value');
allowOverride('.tanktop-section-title', 'margin-bottom', 'dense tailor sidebar opts under the shared .sidebar-title value');

// A property stacked twice inside ONE block for progressive enhancement (test 2):
// browsers drop the declarations they cannot parse, so the first supported wins.
const FALLBACK_STACKS = new Map([
  [ovKey('#app-container', '', 'height'), { reason: 'vh -> dvh -> var(--kx-vh) viewport-height fallback chain', hits: 0 }],
]);

// ─── 1. markup: every id is unique ────────────────────────────────────────────

test('no element id is duplicated in index.html', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const seen = new Map();
  for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1);
  assert.deepEqual(dupes, [], `duplicate id(s): ${dupes.map(([id, n]) => `${id} (×${n})`).join(', ')}`);
});

// ─── 2. no property declared twice inside a single block ─────────────────────

test('no declaration block repeats a property (a shadowed dead value)', () => {
  const found = [];
  for (const src of sources) {
    for (const rule of src.rules) {
      const byProp = new Map();
      for (const d of rule.decls) {
        if (!byProp.has(d.prop)) byProp.set(d.prop, []);
        byProp.get(d.prop).push(d);
      }
      for (const [prop, list] of byProp) {
        if (list.length > 1) {
          const stackKey = `${normSelector(rule.selector)}\u0001\u0001${prop}`;
          if (FALLBACK_STACKS.has(stackKey)) { FALLBACK_STACKS.get(stackKey).hits++; continue; }
          found.push(`${src.label}:${rule.line} ${normSelector(rule.selector)} { ${prop} ×${list.length} → ${list.map(d => d.value).join(' | ')} }`);
        }
      }
    }
  }
  assert.deepEqual(found, [], 'properties redeclared inside one block:\n' + found.join('\n'));
});

// ─── 3. no selector+scope+property redefined to a different value ────────────

test('no rule silently overrides the same selector+scope+property with a different value', () => {
  const conflicts = [];
  for (const src of sources) {
    for (const [key, entries] of src.byProp) {
      if (isBlockMarker(key) || !Array.isArray(entries)) continue;
      // Within a single block the repeat is the fallback-stack case (check 2 owns
      // it). Cross-block overrides are what this check is about.
      if (new Set(entries.map(e => e.blockId)).size <= 1) continue;
      // "Distinct effective value" is the collision signal; identical rewrites
      // are redundant but harmless to pixels, so they are not a fight.
      const signatures = new Set(entries.map(e => `${e.value}\u0000${e.important}`));
      if (signatures.size > 1) {
        if (INTENTIONAL_OVERRIDES.has(key)) { INTENTIONAL_OVERRIDES.get(key).hits++; continue; }
        conflicts.push(`${src.label} ${entries[0].sel} [${entries[0].scope || 'base'}] ${entries[0].prop}\n    ${entries.map(describeEntry).join('\n    ')}`);
      }
    }
  }
  assert.deepEqual(conflicts, [], 'undeclared same-scope value collisions:\n' + conflicts.join('\n  '));
});

// ─── 3b. the registry stays honest ───────────────────────────────────────────
//
// A justification that no longer matches anything is a lie waiting to mislead the
// next reader ("I thought this override was intentional!"). Force it to be pruned.
test('every declared override still refers to a real collision (no stale excuses)', () => {
  const stale = [];
  for (const [key, meta] of INTENTIONAL_OVERRIDES) if (!meta.hits) stale.push(`  ${key.replace(/\u0001/g, ' | ')} — ${meta.reason}`);
  for (const [key, meta] of FALLBACK_STACKS) if (!meta.hits) stale.push(`  ${key.replace(/\u0001/g, ' | ')} — ${meta.reason} (fallback stack)`);
  assert.deepEqual(stale, [], 'declared-but-unused overrides (remove them, the CSS no longer collides here):\n' + stale.join('\n'));
});

// ─── 4. no !important arms race ──────────────────────────────────────────────

test('no two !important rules tie on the same selector+scope+property', () => {
  const ties = [];
  for (const src of sources) {
    for (const [key, entries] of src.byProp) {
      if (isBlockMarker(key) || !Array.isArray(entries)) continue;
      const important = entries.filter(e => e.important);
      if (important.length >= 2) {
        const vals = new Set(important.map(e => e.value));
        if (vals.size >= 2) {
          ties.push(`${src.label} ${important[0].sel} [${important[0].scope || 'base'}] ${important[0].prop}\n    ${important.map(describeEntry).join('\n    ')}`);
        }
      }
    }
  }
  assert.deepEqual(ties, [], 'unresolvable !important ties:\n' + ties.join('\n  '));
});

// ─── 5. :root design tokens are each defined once ────────────────────────────

test(':root custom properties are never defined twice with a different value', () => {
  const dupes = [];
  for (const src of sources) {
    const byToken = new Map();
    for (const rule of src.rules) {
      if (normSelector(rule.selector) !== ':root') continue;
      for (const d of rule.decls) {
        if (!d.prop.startsWith('--')) continue;
        if (!byToken.has(d.prop)) byToken.set(d.prop, []);
        byToken.get(d.prop).push({ value: d.value, where: `${src.label}:${rule.line}` });
      }
    }
    for (const [token, list] of byToken) {
      if (new Set(list.map(x => x.value)).size > 1) {
        dupes.push(`${token} → ${list.map(x => `${x.value} (${x.where})`).join(' | ')}`);
      }
    }
  }
  assert.deepEqual(dupes, [], 'conflicting :root tokens:\n' + dupes.join('\n'));
});

// ─── 6. no duplicate @keyframes / @font-face identity ────────────────────────

test('@keyframes names are unique (no last-definition-wins surprise)', () => {
  const dupes = [];
  for (const src of sources) {
    const names = src.atNames.filter(a => a.kind === 'keyframes');
    const byName = new Map();
    for (const n of names) byName.set(n.name, (byName.get(n.name) || 0) + 1);
    for (const [name, count] of byName) if (count > 1) dupes.push(`${src.label} @keyframes ${name} (×${count})`);
  }
  assert.deepEqual(dupes, [], 'duplicate @keyframes:\n' + dupes.join('\n'));
});

// ─── 7. sanity: the parser really saw the stylesheet ─────────────────────────

test('the CSS parser ingests the whole sheet (guards the checks above from silently no-oping)', () => {
  const sheet = sources.find(s => s.label === 'styles.css');
  assert.ok(sheet.rules.length > 200, `expected a few hundred rule blocks, saw ${sheet.rules.length}`);
  // The responsive sidebar widths are the exact false-positive trap; confirm the
  // scope tracking keeps them as DISTINCT rules rather than merging them.
  const sidebar = sheet.rules.filter(r => splitSelectorList(r.selector).includes('#right-sidebar'));
  assert.ok(sidebar.length >= 5, `expected the multi-tier #right-sidebar rules, saw ${sidebar.length}`);
  const scopes = new Set(sidebar.map(r => r.scope));
  assert.ok(scopes.size >= 5, `#right-sidebar tiers should live in distinct media scopes, saw ${[...scopes]}`);
});
