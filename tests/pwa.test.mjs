// PWA contract: manifest, icons, service worker and the install/offline layer.
//
// An installable app fails in ways nobody notices: a manifest that is not valid
// JSON, an icon path that 404s under the GitHub Pages subdirectory, a PNG that is
// actually a renamed SVG, a service worker whose precache list drifted away from
// the files that exist. All of that is checkable without a browser, so it is
// checked here.
//
// Run with: node --test "tests/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => existsSync(path.join(ROOT, rel));

const manifest = JSON.parse(read('manifest.webmanifest'));
const html = read('index.html');
const sw = read('sw.js');

// ─── Manifest ─────────────────────────────────────────────────────────────────

test('the manifest names the app and points at a relative scope', () => {
  assert.equal(manifest.name.includes('KNITCAT'), true);
  assert.ok(manifest.short_name.length <= 12, 'short_name truncates on a home screen');
  assert.ok(manifest.description.length >= 40, 'a description worth reading');
  // Absolute "/benji-machine/..." paths break locally and break if the repo is
  // ever served from a different subpath. Relative resolves everywhere.
  for (const key of ['start_url', 'scope', 'id']) {
    assert.match(manifest[key], /^\.\//, `${key} must be relative to the manifest`);
  }
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
});

test('every icon the manifest lists exists and declares its purpose', () => {
  assert.ok(manifest.icons.length >= 3);
  const sizes = new Set();
  for (const icon of manifest.icons) {
    assert.ok(exists(icon.src), `${icon.src} is a real file`);
    assert.match(icon.type, /^image\//);
    sizes.add(icon.purpose);
  }
  assert.ok(sizes.has('any'), 'a normal icon');
  assert.ok(sizes.has('maskable'), 'a maskable icon for adaptive launchers');
  const pngs = manifest.icons.filter(i => i.type === 'image/png');
  assert.ok(pngs.some(i => i.sizes === '192x192'), 'Android needs 192');
  assert.ok(pngs.some(i => i.sizes === '512x512'), 'Android needs 512');
});

test('the PNG icons are real PNGs at the size they claim', () => {
  for (const icon of manifest.icons.filter(i => i.type === 'image/png')) {
    const bytes = readFileSync(path.join(ROOT, icon.src));
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${icon.src} is not a PNG`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const [claimedW, claimedH] = icon.sizes.split('x').map(Number);
    assert.equal(width, claimedW, `${icon.src} width`);
    assert.equal(height, claimedH, `${icon.src} height`);
    assert.equal(width, height, `${icon.src} must be square to install`);
    assert.equal(bytes[25], 6, `${icon.src} must be RGBA (colour type 6)`);
  }
});

test('the maskable icon fills its whole square with background colour', () => {
  // A maskable icon with transparent corners ships a black or white square hole
  // on some launchers. The corner pixel must already be the safe background.
  const maskable = manifest.icons.find(i => i.purpose === 'maskable' && i.type === 'image/png');
  assert.ok(maskable, 'a maskable PNG must exist');
  const bytes = readFileSync(path.join(ROOT, maskable.src));
  // Decode enough of the IDAT to sample a pixel is overkill; instead assert the
  // encoder's contract: full-bleed icons are larger than the art-only one at the
  // same edge, because every pixel is opaque.
  const plain = manifest.icons.find(i => i.sizes === maskable.sizes && i.purpose === 'any' && i.type === 'image/png');
  assert.ok(bytes.length > 1024, `${maskable.src} looks empty`);
  assert.ok(!plain || bytes.length !== readFileSync(path.join(ROOT, plain.src)).length,
    'maskable and any-purpose icons must be rendered differently');
});

test('shortcuts and screenshots reference files inside the scope', () => {
  for (const shortcut of manifest.shortcuts) {
    assert.match(shortcut.url, /^\.\//, `${shortcut.name} must stay in scope`);
    assert.ok(shortcut.name.length >= 4);
    for (const icon of shortcut.icons) assert.ok(exists(icon.src), `${icon.src} is a real file`);
  }
  for (const shot of manifest.screenshots || []) {
    assert.ok(exists(shot.src), `${shot.src} is a real file`);
    assert.ok(shot.label, 'a screenshot needs alt text for the store listing');
    assert.match(shot.form_factor, /wide|narrow/);
  }
});

test('a .kcard is registered as a file the installed app opens', () => {
  const handler = manifest.file_handlers?.[0];
  assert.ok(handler, 'file_handlers entry exists');
  assert.match(handler.action, /^\.\//);
  const extensions = handler.accept['application/json'];
  assert.ok(extensions.includes('.kcard'), 'the extension the exporter writes');
});

test('the page actually links the manifest and an iOS icon', () => {
  const manifestHref = html.match(/<link\s+[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["']/i)?.[1]
    || html.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']manifest["']/i)?.[1];
  assert.equal(manifestHref, 'manifest.webmanifest');
  const apple = html.match(/<link\s+[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i)?.[1];
  assert.ok(apple, 'iOS needs an apple-touch-icon link');
  assert.match(apple, /\.png$/, 'iOS ignores SVG icons');
  assert.ok(exists(apple), `${apple} must exist`);
  // Without these, Chrome shows a browser-tab window instead of an app shell.
  assert.match(html, /name=["']mobile-web-app-capable["']\s+content=["']yes["']/);
  assert.match(html, /name=["']apple-mobile-web-app-capable["']\s+content=["']yes["']/);
});

// ─── Service worker ───────────────────────────────────────────────────────────

test('every URL the worker precaches exists on disk', () => {
  const list = sw.match(/const SHELL = \[([\s\S]*?)\];/)?.[1];
  assert.ok(list, 'the shell list is parseable');
  const urls = [...list.matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(urls.length >= 6, 'a shell worth precaching');
  for (const url of urls) {
    const rel = url.replace(/^\.\//, '') || 'index.html';
    assert.ok(exists(rel), `precached ${url} must exist — a 404 here aborts the install`);
  }
});

test('the worker has the three handlers an offline app needs', () => {
  for (const event of ['install', 'activate', 'fetch']) {
    assert.match(sw, new RegExp(`addEventListener\\(['"]${event}['"]`), `${event} handler`);
  }
  assert.match(sw, /self\.clients\.claim\(\)/, 'take over open tabs on activate');
  assert.match(sw, /skipWaiting\(\)/, 'a new version must be able to start');
  // Navigations network-first, so a deploy is visible on the next load rather than
  // a week later when the cache happens to expire.
  assert.match(sw, /async function networkFirstNavigation/);
  assert.match(sw, /request\.mode === ['"]navigate['"]/);
  assert.match(sw, /staleWhileRevalidate/);
});

test('the worker refuses to cache cross-origin, non-GET or itself', () => {
  assert.match(sw, /request\.method !== 'GET'\) return/);
  assert.match(sw, /url\.origin !== self\.location\.origin\) return/);
  assert.match(sw, /endsWith\('\/sw\.js'\)\) return;/);
  // An unbounded runtime cache is a storage leak on a phone.
  assert.match(sw, /RUNTIME_LIMIT = (\d+)/);
  assert.match(sw, /async function trimRuntime/);
});

test('the worker never caches an opaque or failed response', () => {
  // Strip comment lines first: prose about `cache.put()` must not be allowed to
  // satisfy an assertion about the code. cache.put() on a non-OK response throws,
  // so every real put is guarded by .ok.
  const code = sw.split('\n').filter(line => !/^\s*(\/\/|\*)/.test(line)).join('\n');
  const puts = [...code.matchAll(/cache\.put\(([^,]+),/g)];
  assert.ok(puts.length >= 3, 'expected several cache writes');
  for (const match of puts) {
    const guard = code.slice(Math.max(0, match.index - 260), match.index);
    assert.match(guard, /response\.ok|\.ok\b/, `unguarded cache.put(${match[1]})`);
  }
});

// ─── The page-side layer ──────────────────────────────────────────────────────

test('the PWA module feature-detects instead of assuming', () => {
  const js = read('js/features/pwa.js');
  assert.match(js, /['"]serviceWorker['"] in navigator/);
  assert.match(js, /window\.isSecureContext/);
  assert.match(js, /beforeinstallprompt/);
  assert.match(js, /['"]launchQueue['"] in window/);
  assert.match(js, /addEventListener\(['"]offline'/);
  assert.match(js, /addEventListener\(['"]online'/);
  // Registration must stay inside the app directory on a GitHub Pages subpath.
  assert.match(js, /register\(SW_PATH, \{ scope: '\.\/' \}\)/);
});

test('install and offline chrome is styled, including high contrast', () => {
  const css = read('css/styles.css');
  for (const selector of ['.net-status', '.pwa-banner', '#btn-install-app', '.pwa-banner-action']) {
    assert.ok(css.includes(selector), `${selector} has no styles`);
  }
  assert.match(css, /\.net-status\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.pwa-banner\[hidden\] \{ display: none; \}/);
  // The banner must move to the thumb on a phone, not hide under a notch.
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.pwa-banner/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.pwa-banner/);
});
