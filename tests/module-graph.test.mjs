// The module graph and the page's own references.
//
// Two failure classes this project cannot discover by clicking around:
//
//   1. an import specifier that points at a file which is not there (it parses
//      fine, `node --check` is happy, and the whole app dies at runtime with a
//      404 in the console — the one error a static site has no server to catch);
//   2. a module that touches `window`/`document` while it is being imported,
//      which makes it impossible to test and fragile in the browser.
//
// So: every relative specifier is resolved against the filesystem, and every
// module is actually imported under Node. `js/app.js` is the only exclusion,
// because booting the application is precisely what it exists to do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS = path.join(ROOT, 'js');
/** Booting the application is what js/app.js exists to do; it needs a DOM. */
const NOT_IMPORTABLE = new Set(['app.js']);

// Static imports (single- or multi-line), bare side-effect imports, and dynamic
// import() calls. The `m` flag anchors each alternative to the start of a line,
// and the run up to `from` is allowed to wrap, because a named-import list is
// normally split across lines: refusing to cross one would hide those edges (and
// the broken specifiers behind them) from every assertion below.
const IMPORT_RE =
  /^\s*(?:import|export)[\s\S]*?from\s+['"](\.[^'"]+)['"]|^\s*import\s+['"](\.[^'"]+)['"]|\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/gm;

/** Every .js file under a directory, as slash-separated paths relative to js/. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(path.join(JS, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

const FILES = walk('').sort();
const jsPath = rel => path.join(JS, ...rel.split('/'));

function relativeSpecifiers(source) {
  const out = [];
  IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = IMPORT_RE.exec(source))) out.push(match[1] || match[2] || match[3]);
  return out;
}

test('the walk really finds the source tree', () => {
  assert.ok(FILES.length > 30, `expected the whole js/ tree, found ${FILES.length} files`);
  assert.ok(FILES.includes('project/url-state.js'));
  assert.ok(FILES.includes('exporters/qr-code.js'));
  assert.ok(FILES.includes('app.js'));
  assert.ok(FILES.every(f => !f.includes('\\') && !f.startsWith('/')), 'paths are relative and slash-separated');
});

test('every relative import points at a file that exists', () => {
  const missing = [];
  for (const rel of FILES) {
    const source = readFileSync(jsPath(rel), 'utf8');
    for (const specifier of relativeSpecifiers(source)) {
      const target = path.resolve(path.dirname(jsPath(rel)), specifier);
      if (!existsSync(target)) missing.push(`js/${rel} → ${specifier}`);
    }
  }
  assert.deepEqual(missing, [], 'unresolvable import specifiers:\n' + missing.join('\n'));
});

test('no import specifier carries a query string or an extension typo', () => {
  const odd = [];
  for (const rel of FILES) {
    const source = readFileSync(jsPath(rel), 'utf8');
    for (const specifier of relativeSpecifiers(source)) {
      if (!specifier.endsWith('.js')) odd.push(`${rel}: ${specifier}`);
      // The build step stamps index.html only; a stamped module specifier would
      // make every import a cache-key change and defeat the bundling of the graph.
      if (specifier.includes('?v=')) odd.push(`${rel}: ${specifier}`);
    }
  }
  assert.deepEqual(odd, [], 'modules must import bare relative paths:\n' + odd.join('\n'));
});

test('a module that is imported nowhere is reported, not silently shipped', () => {
  // Dead source is a maintenance trap: it still gets edited, tested and reviewed
  // while nobody can be running it. Listed here so it is a decision, not drift.
  const imported = new Set();
  for (const rel of FILES) {
    const from = path.dirname(jsPath(rel));
    for (const specifier of relativeSpecifiers(readFileSync(jsPath(rel), 'utf8'))) {
      imported.add(path.relative(JS, path.resolve(from, specifier)).split(path.sep).join('/'));
    }
  }
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const orphans = FILES.filter(rel => {
    if (rel === 'app.js') return false;
    if (imported.has(rel)) return false;
    return !html.includes(rel); // loaded directly by the page is fine too
  });
  assert.deepEqual(orphans, [], 'modules nothing imports:\n' + orphans.join('\n'));
});

test('every module can be imported without a browser', async () => {
  const failures = [];
  for (const rel of FILES) {
    if (NOT_IMPORTABLE.has(rel)) continue;
    try {
      await import('file://' + jsPath(rel).replace(/\\/g, '/'));
    } catch (err) {
      failures.push(`${rel}: ${err.message.split('\n')[0]}`);
    }
  }
  assert.deepEqual(failures, [], 'a module that needs a DOM at import time cannot be tested:\n' + failures.join('\n'));
});

test('the page only references assets that are really there', async () => {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const refs = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) refs.add(match[1]);
  const broken = [];
  for (const ref of refs) {
    if (/^(https?:|mailto:|sms:|tel:|#|data:|web\+|javascript:)/i.test(ref)) continue;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean || clean === '/') continue;
    // A project page on GitHub Pages lives under /<repo>/, so anything absolute
    // to the host root would 404 there; the app is written root-relative-free.
    if (clean.startsWith('/')) {
      broken.push(`${ref} (absolute path breaks under a project subpath)`);
      continue;
    }
    if (!existsSync(path.join(ROOT, clean))) broken.push(ref);
  }
  assert.deepEqual(broken, [], 'dead links in index.html:\n' + broken.join('\n'));
});

test('the versioned assets keep the build placeholder the CI step stamps', async () => {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
  const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.length >= 1, 'the page loads at least one script');
  assert.ok(sheets.length >= 1, 'the page loads its stylesheet');
  for (const src of scripts) assert.match(src, /\?v=__BUILD__$/, `cache-bust js/app.js: ${src}`);
  for (const href of sheets) assert.match(href, /\?v=__BUILD__$/, `cache-bust stylesheets: ${href}`);
});

test('the manifest registers the handlers the app actually implements', async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.share_target.method, 'GET', 'a static host cannot accept a POST share');
  assert.deepEqual(Object.keys(manifest.share_target.params).sort(), ['text', 'title', 'url']);
  assert.equal(manifest.file_handlers[0].accept['application/json'][0], '.kcard');
  assert.equal(manifest.protocol_handlers[0].protocol, 'web+knitcat');
  // Every URL the manifest opens must be understood by _handleLaunchIntent.
  const handled = ['tab', 'open', 'import', 'mode', 'title', 'text', 'url', 'source'];
  const urls = [
    manifest.start_url,
    ...manifest.shortcuts.map(s => s.url),
    ...manifest.file_handlers.map(h => h.action),
    ...manifest.protocol_handlers.map(h => h.url)
  ];
  const stray = [];
  for (const url of urls) {
    const query = url.split('?')[1] || '';
    for (const key of new URLSearchParams(query).keys()) {
      if (!handled.includes(key)) stray.push(`${url} → ${key}`);
    }
  }
  assert.deepEqual(stray, [], 'manifest intents the app would ignore:\n' + stray.join('\n'));
});
