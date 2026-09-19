// Sharing: the link, the clipboard, the channels, the branded image, the print
// frame, and the File System Access bridge. Everything here is the DOM-free half,
// driven with fakes, so `node --test` can prove the policy without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSharePayload, incomingShareDocument, applyIncomingShare, shareChannels,
  copyText, cardLayout, drawBrandedCard, qrSheetHtml
} from '../js/features/share.js';
import {
  detectSupport, ensurePermission, readHandleFile, writeHandleFile, createFileBridge,
  HANDLE_KEY, KCARD_TYPES
} from '../js/features/fs-access.js';
import { printHtml, buildPrintDocument, PAPER } from '../js/ui/printing.js';
import { readProject } from '../js/project/kcard.js';
import { createMemoryDriver } from '../js/project/storage.js';

const BASE = 'https://example.test/benji-machine/index.html';
const snapshot = (over = {}) => ({
  mode: 'fair_isle',
  profileId: 'brother_standard_24',
  rows: 2,
  cols: 4,
  stitchMatrix: [[1, 0, 1, 0], [0, 1, 0, 1]],
  name: 'Benji sampler',
  ...over
});

// ─── the link ────────────────────────────────────────────────────────────────

test('a share payload is a fragment link, and says how big it is', () => {
  const payload = createSharePayload(snapshot(), { base: BASE });
  assert.equal(payload.ok, true, payload.error);
  assert.match(payload.url, /^https:\/\/example\.test\/benji-machine\/index\.html#p=/);
  assert.ok(payload.chars > 0 && payload.bytes > 0);
  assert.equal(payload.tooLong, false);
  assert.equal(payload.limit, 1800);
});

test('an empty card is refused before a link is promised', () => {
  const payload = createSharePayload({ mode: 'lace', stitchMatrix: [] }, { base: BASE });
  assert.equal(payload.ok, false);
  assert.match(payload.error, /no chart/i);
});

test('a card past the practical limit is flagged, not silently truncated', () => {
  const big = Array.from({ length: 400 }, (_, r) => new Array(200).fill(r % 2));
  const payload = createSharePayload(snapshot({ mode: 'fair_isle', stitchMatrix: big, rows: 400, cols: 200 }), { base: BASE });
  assert.equal(payload.ok, true);
  assert.equal(payload.tooLong, true, `${payload.chars} characters should not fit a chat app`);
  assert.ok(payload.chars > payload.limit);
});

test('a received link becomes a document the real validator accepts', () => {
  const payload = createSharePayload(snapshot(), { base: BASE });
  const doc = incomingShareDocument({
    mode: 'fair_isle', profileId: 'brother_standard_24', rows: 2, cols: 4,
    stitchMatrix: [[1, 0, 1, 0], [0, 1, 0, 1]], codecVersion: 1
  });
  const read = readProject(doc);
  assert.equal(read.ok, true, JSON.stringify(read.errors || read.error));
  assert.deepEqual(read.project.stitchMatrix, [[1, 0, 1, 0], [0, 1, 0, 1]]);
  assert.equal(read.project.mode, 'fair_isle');
  assert.equal(read.project.meta.sharedVia, 'link');
  assert.ok(payload.url.includes('#p='), 'and the link that produced it is still a link');
});

test('applyIncomingShare loads, reports, and cleans up only on success', () => {
  const good = createSharePayload(snapshot(), { base: BASE }).url;
  const calls = [];
  const result = applyIncomingShare({
    href: good,
    load: (doc, label) => { calls.push({ label, doc }); return true; },
    clean: () => calls.push({ cleaned: true })
  });
  assert.equal(result.found, true);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].label, 'a shared link');
  assert.deepEqual(calls[0].doc.stitchMatrix, [[1, 0, 1, 0], [0, 1, 0, 1]]);
  assert.deepEqual(calls[1], { cleaned: true });

  const failures = [];
  assert.equal(applyIncomingShare({ href: BASE, load: () => true }).found, false, 'no payload at all');
  const bad = applyIncomingShare({
    href: `${BASE}#p=not-base64-at-all-!!!`,
    load: (doc) => { failures.push(doc); return true; },
    clean: () => failures.push('cleaned')
  });
  assert.equal(bad.found, true);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /not valid|impossible|truncated|newer|older/i);
  assert.deepEqual(failures, [], 'a bad link must not load anything or scrub the address bar');
});

// ─── the channels ────────────────────────────────────────────────────────────

test('the channels are real mailto/sms URLs and copyable text', () => {
  const list = shareChannels({ url: 'https://ex.test/#p=AbC', title: 'Feather & Fan', note: '24 rows' });
  const byId = Object.fromEntries(list.map(c => [c.id, c]));
  assert.match(byId.email.href, /^mailto:\?subject=Feather%20%26%20Fan%20%E2%80%94%20KNITCAT/);
  assert.match(byId.email.href, /body=24%20rows/);
  assert.match(byId.sms.href, /^sms:\?&body=/);
  assert.match(byId.sms.href, /https%3A%2F%2Fex\.test/);
  assert.equal(byId.copy.copy, 'https://ex.test/#p=AbC');
  assert.match(byId.chat.copy, /Drawn in KNITCAT/);
  assert.equal(byId.qr.action, 'qr');
  for (const channel of list) assert.ok(channel.label.length > 1);
  assert.deepEqual(shareChannels({}), [], 'no link, no channels');
});

test('copying falls back to a textarea when the clipboard API is blocked', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const calls = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async () => { calls.push('api'); } } }
  });
  assert.deepEqual(await copyText('hello'), { ok: true, method: 'clipboard-api' });
  assert.deepEqual(calls, ['api']);

  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  const fakeDoc = {
    createElement: () => ({
      style: {}, setAttribute() {}, remove() {}, select() {}, setSelectionRange() {}, value: ''
    }),
    body: { appendChild() {} },
    execCommand: () => true
  };
  const fallen = await copyText('hello', { doc: fakeDoc });
  assert.equal(fallen.ok, true, 'execCommand path');
  assert.equal(fallen.method, 'execCommand');

  const refused = await copyText('hello', { doc: { ...fakeDoc, execCommand: () => false } });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /copy it by hand/i);

  const nowhere = await copyText('hello', { doc: null });
  assert.equal(nowhere.ok, false);
  assert.match(nowhere.error, /will not hand data to the clipboard/i);
  if (original) Object.defineProperty(globalThis, 'navigator', original);
  else delete globalThis.navigator;
});

// ─── the branded card image ──────────────────────────────────────────────────

test('the card layout always fits the canvas, even for absurd charts', () => {
  for (const dims of [{ rows: 2, cols: 4 }, { rows: 400, cols: 2000 }, { rows: 0, cols: 0 }, { rows: 1, cols: 1 }]) {
    const layout = cardLayout({ ...dims, qr: { size: 21 } });
    assert.ok(layout.cell > 0, `${dims.rows}×${dims.cols} still has visible cells`);
    assert.ok(layout.cell <= 28, 'a single-stitch card is not drawn the size of a bed');
    assert.ok(layout.chart.x + layout.chart.w <= layout.width - layout.padding + 1, 'chart inside the canvas');
    assert.ok(layout.chart.y + layout.chart.h <= layout.height - layout.padding + 1, 'chart above the caption');
    assert.ok(layout.qr.x + layout.qr.size <= layout.width - layout.padding + 1, 'QR inside the canvas');
    assert.ok(layout.qr.y >= 0 && layout.qr.y + layout.qr.size <= layout.height);
  }
  assert.equal(cardLayout({ rows: 10, cols: 10 }).qr, null, 'no QR asked for, no QR drawn');
  // A narrow canvas with a QR would leave no room at all; it must not go negative.
  const cramped = cardLayout({ width: 300, height: 200, rows: 4, cols: 4, qr: { size: 21 } });
  assert.ok(cramped.cell > 0 && cramped.chart.w > 0, JSON.stringify(cramped));
});

function fakeCanvas() {
  const log = { fills: 0, arcs: 0, texts: [], rects: [], gradients: 0 };
  const ctx = {
    fillStyle: '', font: '', textAlign: 'left', textBaseline: 'alphabetic',
    save() {}, restore() {},
    fillRect(...args) { log.rects.push(args); log.fills++; },
    beginPath() {}, arc() { log.arcs++; }, fill() {},
    fillText(text) { log.texts.push(text); },
    createLinearGradient() {
      log.gradients++;
      return { addColorStop() {} };
    }
  };
  return { ctx, log };
}

test('the branded card paints every punched cell and the text a human wants', () => {
  const { ctx, log } = fakeCanvas();
  const layout = drawBrandedCard(ctx, {
    snapshot: snapshot(),
    title: 'Benji sampler',
    caption: '2 rows × 4 needles · Fair Isle',
    qr: null
  });
  assert.equal(log.arcs, 4, 'four punched cells in the sampler');
  assert.ok(log.rects.length >= 3, 'background, gradient wash, chart plate');
  assert.ok(log.texts.includes('Benji sampler'));
  assert.ok(log.texts.some(t => t.includes('Fair Isle')));
  assert.ok(log.texts.some(t => /KNITCAT/.test(t)));
  assert.equal(layout.cell, Math.min(layout.chart.w / 4, layout.chart.h / 2, 28));

  // A lace card marks non-knit cells rather than truthy ones.
  const lace = fakeCanvas();
  drawBrandedCard(lace.ctx, {
    snapshot: { mode: 'lace', stitchMatrix: [['K', 'O', 'TL', 'K'], ['K', 'K', 'K', 'K']] },
    isLace: true, rows: 2, cols: 4
  });
  assert.equal(lace.log.arcs, 2, 'one yarnover and one transfer, not the plain knits');

  // And it must survive a context without gradients (older canvas stubs).
  const bare = { fillStyle: '', font: '', textAlign: '', textBaseline: '', save() {}, restore() {}, fillRect() {}, beginPath() {}, arc() { bare.arcs = (bare.arcs || 0) + 1; }, fill() {}, fillText() {} };
  assert.doesNotThrow(() => drawBrandedCard(bare, { snapshot: snapshot() }));
});

test('the QR sheet escapes the link and reads like instructions, not a log', () => {
  const html = qrSheetHtml({ svg: '<svg></svg>', url: 'https://ex.test/#p=a<b>&c', title: 'X & Y' });
  assert.match(html, /Scan to open this card/);
  assert.match(html, /&lt;b&gt;/, 'the URL is escaped like any other text');
  assert.equal(html.includes('a<b>'), false);
  assert.match(html, /X &amp; Y/);
});

// ─── printing ────────────────────────────────────────────────────────────────

test('a print document is self-contained and names its page size', () => {
  const html = buildPrintDocument({ title: 'Gauge <card>', body: '<h1>hi</h1>', page: 'A5 portrait' });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<title>Gauge &lt;card&gt;<\/title>/);
  assert.match(html, /@page \{ size: A5 portrait; \}/);
  assert.match(html, /@media print/, 'so the browser does not print the CAD theme');
  assert.equal(html.includes('<script'), false, 'no scripts in a print frame');
  assert.match(buildPrintDocument({ page: 'nonsense' }), /size: A4;/);
  assert.match(buildPrintDocument({ page: '80mm 297mm' }), /size: 80mm 297mm;/);
  assert.deepEqual(PAPER.A4.px300, [2480, 3508]);
});

test('printHtml uses the injected sink, and reports a refused frame', () => {
  const seen = [];
  const ok = printHtml({ title: 't', body: '<p>x</p>', open: html => { seen.push(html); return true; } });
  assert.equal(ok.ok, true);
  assert.equal(ok.method, 'iframe');
  assert.equal(seen.length, 1);
  const failed = printHtml({ title: 't', body: '<p>x</p>', open: () => false });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /would not open a print frame/);
  const threw = printHtml({ title: 't', body: '', open: () => { throw new Error('boom'); } });
  assert.equal(threw.ok, false);
  assert.equal(threw.error, 'boom');
});

// ─── File System Access ──────────────────────────────────────────────────────

function fakeHandle(name = 'card.kcard', { permission = 'granted', writable = true } = {}) {
  const written = [];
  return {
    name,
    kind: 'file',
    written,
    queryPermission: async () => permission,
    requestPermission: async () => permission,
    getFile: async () => ({ name, text: async () => '{"format":"KNITCAT_PROJECT_V2"}' }),
    createWritable: async () => {
      if (!writable) throw Object.assign(new Error('nope'), { name: 'NotAllowedError' });
      return {
        write: async chunk => written.push(chunk.data),
        close: async () => written.push('closed'),
        abort: async () => written.push('aborted')
      };
    }
  };
}

test('support detection never invents an API the browser does not have', () => {
  assert.deepEqual(detectSupport({}), { save: false, open: false, canRemember: false });
  const withSave = detectSupport({ showSaveFilePicker: async () => {} });
  assert.equal(withSave.save, true);
  assert.equal(withSave.open, false);
});

test('permission handling covers all four browser answers', async () => {
  assert.equal(await ensurePermission(null), 'unknown');
  assert.equal(await ensurePermission({}), 'unknown', 'no query API means "just try it"');
  assert.equal(await ensurePermission(fakeHandle('a', { permission: 'granted' })), 'granted');
  assert.equal(await ensurePermission(fakeHandle('a', { permission: 'denied' })), 'denied');
  const throwing = {
    queryPermission: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); }
  };
  assert.equal(await ensurePermission(throwing), 'denied');
});

test('reading and writing a handle report what went wrong, in words', async () => {
  const read = await readHandleFile(fakeHandle('feather.kcard'));
  assert.equal(read.ok, true);
  assert.equal(read.name, 'feather.kcard');
  assert.match((await readHandleFile(null)).error, /not a file/);

  const written = await writeHandleFile(fakeHandle('a.kcard'), '{}');
  assert.equal(written.ok, true);
  const denied = await writeHandleFile(fakeHandle('a.kcard', { writable: false }), '{}');
  assert.equal(denied.ok, false);
  assert.equal(denied.permission, true, 'so the caller can rebind instead of failing');
});

/** A driver that reports itself as IndexedDB, which is the only one that can hold a handle. */
function handleDriver() {
  const inner = createMemoryDriver();
  return { ...inner, kind: 'indexeddb', puts: [] };
}

test('the bridge remembers the bound file only when the store can hold it', async () => {
  const driver = handleDriver();
  const puts = [];
  const wrapped = {
    ...driver,
    put: async (store, value, key) => { puts.push({ store, key }); return driver.put(store, value, key); },
    get: async (store, key) => driver.get(store, key),
    delete: async (store, key) => driver.delete(store, key)
  };
  let nextHandle = fakeHandle('benji.kcard');
  const scope = {
    showSaveFilePicker: async options => { scope.saveOptions = options; return nextHandle; },
    showOpenFilePicker: async options => { scope.openOptions = options; return [nextHandle]; }
  };
  const bridge = createFileBridge({ driver: wrapped, scope });
  assert.equal(bridge.supports.canRemember, true);

  const saved = await bridge.save('{"a":1}', { suggestedName: 'benji.kcard' });
  assert.equal(saved.ok, true);
  assert.equal(saved.mode, 'picker', 'first save asks where');
  assert.equal(scope.saveOptions.suggestedName, 'benji.kcard');
  assert.deepEqual(scope.saveOptions.types, KCARD_TYPES);
  assert.equal(bridge.boundName, 'benji.kcard');
  assert.ok(puts.some(p => p.key === HANDLE_KEY), 'and the handle is filed away');

  const again = await bridge.save('{"a":2}');
  assert.equal(again.mode, 'bound-file', 'second save does not ask twice');
  assert.equal(bridge.bound, true);

  // A fresh page, same IndexedDB: the handle comes back and the name is known.
  const second = createFileBridge({ driver: wrapped, scope });
  const info = await second.restore();
  assert.equal(info.bound, true);
  assert.equal(info.name, 'benji.kcard');
  assert.equal((await second.save('{"a":3}')).mode, 'bound-file');

  // Opening a file rebinds Save to it, like any desktop editor.
  nextHandle = fakeHandle('opened.kcard');
  const opened = await bridge.open();
  assert.equal(opened.ok, true);
  assert.equal(opened.name, 'opened.kcard');
  assert.equal(bridge.boundName, 'opened.kcard');

  await bridge.unbind();
  assert.equal(bridge.bound, false);
  assert.equal(bridge.boundName, null);
});

test('without the API the bridge downloads, and with nothing at all it says so', async () => {
  const downloads = [];
  const noApi = createFileBridge({ driver: null, scope: {}, download: (text, name) => downloads.push([text, name]) });
  assert.equal(noApi.supports.save, false);
  const viaDownload = await noApi.save('hello', { suggestedName: 'x.kcard' });
  assert.deepEqual(viaDownload, { ok: true, mode: 'download', name: 'x.kcard' });
  assert.deepEqual(downloads, [['hello', 'x.kcard']]);

  const stranded = createFileBridge({ scope: {} });
  const stuck = await stranded.save('hello', { suggestedName: 'x.kcard' });
  assert.equal(stuck.ok, false);
  assert.match(stuck.error, /cannot write files/);
  assert.equal((await stranded.open()).unsupported, true);
});

test('a revoked permission falls back rather than losing the card', async () => {
  const denied = fakeHandle('gone.kcard', { permission: 'denied' });
  let pickerCalls = 0;
  const downloads = [];
  const bridge = createFileBridge({
    driver: handleDriver(),
    scope: { showSaveFilePicker: async () => (pickerCalls++ === 0 ? denied : null) },
    download: (text, name) => downloads.push(name)
  });
  await bridge.pickSaveFile({ suggestedName: 'gone.kcard' });
  assert.equal(bridge.boundName, 'gone.kcard');

  const result = await bridge.save('{"b":1}', { suggestedName: 'card.kcard', allowPicker: false });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.mode, 'download', 'the card still leaves the browser');
  assert.deepEqual(downloads, ['card.kcard']);
  assert.equal(bridge.bound, false, 'a file KNITCAT may not write is not kept as "the" file');
});

test('a picker that gives up cancels cleanly', async () => {
  let pickerCalls = 0;
  const denied = fakeHandle('gone.kcard', { permission: 'denied' });
  const bridge = createFileBridge({
    driver: handleDriver(),
    scope: { showSaveFilePicker: async () => (pickerCalls++ === 0 ? denied : null) }
  });
  await bridge.pickSaveFile({ suggestedName: 'gone.kcard' });
  const result = await bridge.save('{"b":1}', { suggestedName: 'card.kcard' });
  assert.equal(result.ok, true, 'a cancelled save lost nothing');
  assert.equal(result.mode, 'cancelled');
});

test('a cancelled dialog is not an error', async () => {
  const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
  const bridge = createFileBridge({
    driver: null,
    scope: { showSaveFilePicker: async () => { throw abort; }, showOpenFilePicker: async () => { throw abort; } }
  });
  assert.equal((await bridge.pickSaveFile()).cancelled, true);
  assert.equal((await bridge.open()).cancelled, true);
});
