// Storage, autosave, crash recovery, versions and the backup archive.
//
// The scary property of this layer is that it is invisible until the exact
// moment it matters: a dead battery, a crash, a quota error. All of it is plain
// JavaScript with an injectable driver and an injectable clock, so "did we lose
// Benji's card?" is answered here rather than in a browser at 1am.
//
// Run with: node --test "tests/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryDriver, createLocalDriver, openDriver, STORES
} from '../js/project/storage.js';
import {
  createDataService, diffMatrices, describeDiff, toProjectDocument,
  AUTOSAVE_KEY, SESSION_KEY, MAX_SNAPSHOTS, MAX_RECENTS, BACKUP_FORMAT, EXCLUDED_KEYS
} from '../js/project/backups.js';
import { readProject } from '../js/project/kcard.js';
import { relativeTime } from '../js/features/data-panel.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fakeLocalStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    _map: map
  };
}

function fakeTimers() {
  let pending = [];
  let clock = 0;
  return {
    setTimeout(fn, ms) {
      const id = pending.length + 1;
      pending.push({ id, at: clock + ms, fn });
      return id;
    },
    clearTimeout(id) { pending = pending.filter(t => t.id !== id); },
    advance(ms) {
      clock += ms;
      const due = pending.filter(t => t.at <= clock).sort((a, b) => a.at - b.at);
      pending = pending.filter(t => t.at > clock);
      for (const timer of due) timer.fn();
      return due.length;
    },
    get queued() { return pending.length; }
  };
}

const CARD = [
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1]
];

function docOf(matrix, extra = {}) {
  return toProjectDocument({
    profileId: 'brother_standard_24',
    mode: 'fair_isle',
    stitchMatrix: matrix,
    rows: matrix.length,
    cols: matrix[0].length,
    ...extra
  });
}

function makeService(options = {}) {
  const local = options.local ?? fakeLocalStorage();
  const timers = options.timers ?? fakeTimers();
  const notices = [];
  const notifier = {
    success: (m, o) => notices.push({ type: 'success', m, o }),
    warn: (m, o) => notices.push({ type: 'warn', m, o }),
    error: (m, o) => notices.push({ type: 'error', m, o }),
    info: (m, o) => notices.push({ type: 'info', m, o })
  };
  const service = createDataService({
    driver: options.driver ?? createMemoryDriver(),
    snapshot: options.snapshot ?? (() => ({
      profileId: 'brother_standard_24',
      mode: 'fair_isle',
      stitchMatrix: options.matrix ?? CARD,
      rows: (options.matrix ?? CARD).length,
      cols: (options.matrix ?? CARD)[0].length,
      name: options.name
    })),
    local,
    timers,
    notifier,
    now: options.now ?? (() => 1_700_000_000_000),
    debounceMs: options.debounceMs ?? 1500
  });
  return { service, local, timers, notices };
}

// ─── drivers ──────────────────────────────────────────────────────────────────

test('the memory driver behaves like a key-value store', async () => {
  const driver = createMemoryDriver();
  assert.equal(driver.kind, 'memory');
  assert.equal(await driver.get(STORES.KV, 'nope'), null);
  await driver.put(STORES.KV, { value: 7 }, 'lucky');
  assert.deepEqual(await driver.get(STORES.KV, 'lucky'), { value: 7 });
  assert.equal(await driver.count(STORES.KV), 1);
  assert.equal((await driver.getAll(STORES.KV)).length, 1);
  await driver.delete(STORES.KV, 'lucky');
  assert.equal(await driver.count(STORES.KV), 0);
  await driver.put(STORES.KV, { value: 1 }, 'a');
  await driver.clear(STORES.KV);
  assert.equal(await driver.count(STORES.KV), 0);
});

test('an unknown store or an empty key is refused, not ignored', async () => {
  const driver = createMemoryDriver();
  await assert.rejects(() => driver.get('secrets', 'x'), /Unknown KNITCAT store/);
  await assert.rejects(() => driver.put(STORES.KV, 1, ''), /needs a key/);
});

test('stored values are snapshots, not live references', async () => {
  // The whole point of autosave is that it records a moment. If the memory driver
  // kept the caller's array, later edits would silently rewrite history.
  const driver = createMemoryDriver();
  const matrix = [[1, 0]];
  await driver.put(STORES.AUTOSAVE, { stitchMatrix: matrix }, AUTOSAVE_KEY);
  matrix[0][0] = 0;
  matrix.push([1, 1]);
  const back = await driver.get(STORES.AUTOSAVE, AUTOSAVE_KEY);
  assert.deepEqual(back.stitchMatrix, [[1, 0]]);
});

test('the localStorage driver namespaces by store and round-trips JSON', async () => {
  const local = fakeLocalStorage();
  const driver = createLocalDriver(local);
  await driver.put(STORES.RECENTS, { name: 'a.kcard' }, 'a.kcard');
  await driver.put(STORES.KV, { value: 3 }, 'x');
  assert.equal(local._map.get('knitcat.idb.recents:a.kcard'), '{"name":"a.kcard"}');
  assert.deepEqual(await driver.get(STORES.RECENTS, 'a.kcard'), { name: 'a.kcard' });
  assert.equal((await driver.getAll(STORES.RECENTS)).length, 1, 'one store does not leak into another');
  assert.equal(await driver.count(STORES.KV), 1);
  assert.ok((await driver.estimate()).usage > 0);
  await driver.clear(STORES.RECENTS);
  assert.equal(await driver.count(STORES.RECENTS), 0);
  assert.equal(await driver.count(STORES.KV), 1, 'clear() is per store');
});

test('openDriver falls through to what actually works', async () => {
  const local = fakeLocalStorage();
  const blocked = { open: () => { throw new Error('SecurityError: private mode'); } };
  const { driver, warning } = await openDriver({ indexedDB: blocked, storage: local, logger: { debug() {} } });
  assert.equal(driver.kind, 'local');
  assert.equal(warning, 'indexeddb-unavailable');

  const lastResort = await openDriver({ indexedDB: blocked, storage: null, logger: { debug() {} } });
  assert.equal(lastResort.driver.kind, 'memory');
  assert.equal(lastResort.warning, 'memory-only');

  const noIdbAtAll = await openDriver({ indexedDB: undefined, storage: local, logger: { debug() {} } });
  assert.equal(noIdbAtAll.driver.kind, 'local');
});

// ─── diffing ──────────────────────────────────────────────────────────────────

test('the diff counts changes, additions and removals separately', () => {
  const before = [[1, 0, 0], [0, 0, 0]];
  const after = [[0, 1, 0], [0, 0, 0]];
  const diff = diffMatrices(before, after);
  assert.equal(diff.changed, 2);
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.equal(diff.identical, false);
  assert.deepEqual(diff.perRow, [{ row: 1, changed: 2 }]);
  assert.equal(diff.sizeChanged, false);
});

test('identical charts diff to nothing, and falsey cells count as blank', () => {
  assert.equal(diffMatrices([[0, 1]], [[0, 1]]).identical, true);
  assert.equal(diffMatrices([[0, 1]], [[false, 1]]).identical, true, 'false is an empty cell');
  assert.equal(diffMatrices([[undefined]], [['']]).identical, true);
});

test('a shrunk card is reported as a size change, not silence', () => {
  const diff = diffMatrices([[1, 1, 1], [1, 1, 1], [1, 1, 1]], [[1, 1, 1]]);
  assert.equal(diff.sizeChanged, true);
  assert.equal(diff.removed, 6);
  assert.equal(diff.rows, 3);
  assert.match(describeDiff(diff), /6 cells different/);
  assert.match(describeDiff(diff), /resized to 3×3/);
  assert.equal(describeDiff(diffMatrices([[1]], [[1]])), 'identical to what is on screen');
});

// ─── autosave + recovery ──────────────────────────────────────────────────────

test('a project document is what autosave stores, and it re-reads as one', async () => {
  const { service } = makeService();
  const saved = await service.saveNow('test');
  assert.equal(saved.kind, 'KNITCAT_PROJECT');
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.autosave.reason, 'test');
  const reread = readProject(saved);
  assert.equal(reread.ok, true, reread.error);
  assert.deepEqual(reread.project.stitchMatrix, CARD);
});

test('debounced saves collapse a burst of edits into one write', async () => {
  const timers = fakeTimers();
  const { service } = makeService({ timers });
  service.schedule('edit');
  service.schedule('edit');
  service.schedule('edit');
  assert.equal(timers.queued, 1, 'a burst must not queue three writes');
  assert.equal(await service.loadAutosave(), null);
  timers.advance(1600);
  assert.ok(await service.loadAutosave());
});

test('a refused write is reported once and shown in the status', async () => {
  const driver = createMemoryDriver();
  driver.put = async () => { throw new Error('QuotaExceededError'); };
  const { service, notices } = makeService({ driver });
  await service.saveNow('edit');
  const status = service.status();
  assert.equal(status.failing, true);
  assert.match(status.lastError, /QuotaExceeded/);
  assert.equal(notices[0].type, 'warn');
  assert.match(notices[0].o.details, /Save Project/);
});

test('an empty chart is never autosaved over a good one', async () => {
  const { service } = makeService({ snapshot: () => ({ stitchMatrix: [], rows: 0, cols: 0 }) });
  assert.equal(await service.saveNow('edit'), null);
  assert.equal(await service.loadAutosave(), null);
});

test('a crashed session asks; a clean one simply resumes', async () => {
  // Two page loads on one device: the driver and the localStorage both persist.
  const local = fakeLocalStorage();
  const driver = createMemoryDriver();
  const first = makeService({ local, driver });
  await first.service.saveNow('edit');
  first.service.beginSession();
  // No clean close: the flag is still "running".
  const reopened = makeService({ local, driver, matrix: [[1, 0, 0], [0, 0, 0]] });
  const verdict = await reopened.service.recover();
  assert.equal(verdict.action, 'ask');
  assert.equal(verdict.crashed, true);
  assert.deepEqual(verdict.saved.stitchMatrix, CARD);

  const cleanLocal = fakeLocalStorage();
  const cleanDriver = createMemoryDriver();
  const a = makeService({ local: cleanLocal, driver: cleanDriver });
  await a.service.saveNow('edit');
  a.service.beginSession();
  a.service.endSession('beforeunload');
  assert.equal(JSON.parse(cleanLocal.getItem(SESSION_KEY)).state, 'closed');
  const b = makeService({ local: cleanLocal, driver: cleanDriver });
  assert.equal((await b.service.recover()).action, 'resume');

  const fresh = makeService();
  assert.equal((await fresh.service.recover()).action, 'none');
});

test('a corrupt session flag counts as a crash, not as no data', async () => {
  const local = fakeLocalStorage({ [SESSION_KEY]: 'not json at all' });
  const driver = createMemoryDriver();
  const { service } = makeService({ local, driver });
  await service.saveNow('edit');
  const other = makeService({ local, driver });
  assert.equal((await other.service.recover()).action, 'ask');
});

test('closing flushes a pending write and clears the flag', async () => {
  const local = fakeLocalStorage();
  const timers = fakeTimers();
  const { service } = makeService({ local, timers });
  service.beginSession();
  service.schedule('edit');
  assert.equal(await service.loadAutosave(), null);
  await service.close('pagehide');
  assert.equal(timers.queued, 0, 'the timer is cancelled, not left dangling');
  assert.ok(await service.loadAutosave());
  assert.equal(JSON.parse(local.getItem(SESSION_KEY)).state, 'closed');
});

// ─── versions ─────────────────────────────────────────────────────────────────

test('versions accumulate, and only the newest 30 survive', async () => {
  let clock = 1_700_000_000_000;
  const { service } = makeService({ now: () => clock });
  for (let i = 0; i < MAX_SNAPSHOTS + 6; i++) {
    clock += 1000; // distinct times, or the trim order is a coin flip
    await service.takeSnapshot(`v${i}`);
  }
  const list = await service.listSnapshots();
  assert.equal(list.length, MAX_SNAPSHOTS);
  assert.equal(list[list.length - 1].document.label, `v${MAX_SNAPSHOTS + 5}`);
  assert.equal(list[0].document.label, `v6`, 'the oldest rolled off');

  const { diff } = await service.diffSnapshot(list[0].id);
  assert.equal(diff.identical, true, 'same chart against itself');
  assert.deepEqual((await service.snapshotDocument(list[0].id)).stitchMatrix, CARD);
  await service.deleteSnapshot(list[0].id);
  assert.equal((await service.listSnapshots()).length, MAX_SNAPSHOTS - 1);
});

// ─── recents, named projects, kv ──────────────────────────────────────────────

test('recents dedupe by name, keep the first opening, and cap the list', async () => {
  const { service } = makeService();
  for (let i = 0; i < MAX_RECENTS + 4; i++) {
    await service.rememberRecent({ name: `card-${String(i).padStart(2, '0')}.kcard`, document: docOf(CARD), rows: 3, cols: 3 });
  }
  let list = await service.listRecents();
  assert.equal(list.length, MAX_RECENTS);
  const first = await service.rememberRecent({ name: 'card-11.KCARD', document: docOf(CARD) });
  assert.equal(first, true);
  list = await service.listRecents();
  const names = list.map(e => e.name);
  assert.equal(new Set(names).size, MAX_RECENTS, 'case-insensitive dedupe, not extra entries');
  await service.forgetRecent('card-11.kcard');
  assert.equal((await service.listRecents()).length, MAX_RECENTS - 1);
});

test('named projects and key/value notes share the same store contract', async () => {
  const { service } = makeService();
  await service.saveNamed('Benji Scarf', docOf(CARD));
  const named = await service.listNamed();
  assert.equal(named[0].name, 'Benji Scarf');
  assert.deepEqual((await service.loadNamed('benji scarf')).stitchMatrix, CARD);
  await service.deleteNamed('benji scarf');
  assert.equal((await service.listNamed()).length, 0);

  await service.setKv('stash', [{ weight: 'fingering' }]);
  assert.deepEqual(await service.getKv('stash'), [{ weight: 'fingering' }]);
  assert.equal(await service.getKv('missing', 'fallback'), 'fallback');
  await service.setKv('progress', { row: 12 });
  assert.equal((await service.listKv('prog')).length, 1);
  await service.deleteKv('progress');
  assert.equal(await service.getKv('progress'), null);
});

// ─── backup archive ───────────────────────────────────────────────────────────

test('the backup archive holds everything and restores onto another device', async () => {
  const local = fakeLocalStorage({
    'knitcad.settings.v1': '{"theme":"light"}',
    'knitcat.stash.v1': '[]',
    'some-other-script': 'not ours'
  });
  const { service } = makeService({ local });
  await service.saveNow('edit');
  await service.takeSnapshot('Before the sleeve');
  await service.rememberRecent({ name: 'a.kcard', document: docOf(CARD) });
  await service.setKv('notes', 'cast on loosely');

  const archive = await service.buildArchive();
  assert.equal(archive.format, BACKUP_FORMAT);
  assert.equal(archive.counts.snapshots, 1);
  assert.equal(archive.counts.recents, 1);
  assert.equal(archive.counts.kv, 1);
  assert.deepEqual(archive.settings['knitcad.settings.v1'], '{"theme":"light"}');
  // Prefix-owned keys are collected automatically, so a feature added next month
  // is backed up on the day it ships; anything that is not ours is left alone.
  assert.deepEqual(archive.settings['knitcat.stash.v1'], '[]');
  assert.equal('some-other-script' in archive.settings, false);
  assert.equal(EXCLUDED_KEYS.includes(SESSION_KEY), true, 'the live session flag is not user data');
  assert.equal(SESSION_KEY in archive.settings, false);
  assert.ok(JSON.stringify(archive).includes('Before the sleeve'));

  // New browser, same file.
  const freshLocal = fakeLocalStorage();
  const fresh = makeService({ local: freshLocal });
  const result = await fresh.service.restoreArchive(JSON.stringify(archive));
  assert.equal(result.ok, true);
  assert.deepEqual(result.written, { snapshots: 1, recents: 1, projects: 0, kv: 1, autosave: true, settings: 2 });
  assert.deepEqual((await fresh.service.loadAutosave()).stitchMatrix, CARD);
  assert.equal((await fresh.service.listSnapshots())[0].document.label, 'Before the sleeve');
  assert.equal(await fresh.service.getKv('notes'), 'cast on loosely');
  assert.equal(freshLocal.getItem('knitcad.settings.v1'), '{"theme":"light"}');
  assert.equal(freshLocal.getItem('knitcat.stash.v1'), '[]');
  assert.equal(freshLocal.getItem('some-other-script'), null);
});

test('a restore adds to what is there, and only replace=true clears it', async () => {
  const { service } = makeService();
  await service.takeSnapshot('Mine');
  const elsewhere = makeService();
  await elsewhere.service.takeSnapshot('Theirs');
  const archive = await elsewhere.service.buildArchive();
  const merged = await service.restoreArchive(archive);
  assert.equal(merged.written.snapshots, 1);
  assert.equal((await service.listSnapshots()).length, 2);
  await service.restoreArchive(archive, { replace: true });
  const after = await service.listSnapshots();
  assert.equal(after.length, 1);
  assert.equal(after[0].document.label, 'Theirs');
});

test('anything that is not a KNITCAT backup is refused', async () => {
  const { service } = makeService();
  assert.match((await service.restoreArchive('{"format":"something_else"}')).error, /KNITCAT_BACKUP_V1/);
  assert.match((await service.restoreArchive('{oops')).error, /Not a KNITCAT backup/);
  assert.equal((await service.restoreArchive(null)).ok, false);
});

// ─── small pure helpers ───────────────────────────────────────────────────────

test('relative time reads like a person, not a timestamp', () => {
  const now = Date.parse('2026-03-05T12:00:00Z');
  assert.equal(relativeTime(null, now), 'never');
  assert.equal(relativeTime('2026-03-05T11:59:30Z', now), 'just now');
  assert.equal(relativeTime('2026-03-05T11:45:00Z', now), '15 min ago');
  assert.equal(relativeTime('2026-03-05T07:00:00Z', now), '5 h ago');
  assert.equal(relativeTime('2026-03-04T12:00:00Z', now), 'yesterday');
  assert.match(relativeTime('2025-11-02T12:00:00Z', now), /2025/);
  assert.equal(relativeTime('gibberish', now), 'unknown');
});
