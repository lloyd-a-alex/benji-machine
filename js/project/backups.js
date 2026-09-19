/**
 * The data policy on top of a storage driver: autosave, crash recovery, recent
 * files, named versions, and a whole-life backup archive.
 *
 * Everything here is deliberately driver-agnostic and clock-injectable, so the
 * exact behaviour of "did the browser die mid-project?" is testable without a
 * browser, and the storage layer can be IndexedDB, localStorage or memory
 * without a single call site changing.
 *
 * The recovery logic is the part that matters most, and it is built on one
 * deliberately boring trick: the session flag is written *before* any work is
 * done and cleared only on a clean unload. If the flag is still standing at
 * boot, the previous visit did not end cleanly — that is a crash, and the
 * autosave on disk is the thing we offer back. No heuristics about timing, no
 * "was it modified recently" guesswork.
 */

import { buildProjectDocument, KCARD_MAX_CELLS } from './kcard.js';
import { STORES } from './storage.js';

export const AUTOSAVE_KEY = 'current';
export const LAST_BACKUP_KEY = 'lastBackupAt';
/** Historic `knitcad.` prefix on purpose — renaming would wipe saved state. */
export const SESSION_KEY = 'knitcad.session.v1';
export const MAX_SNAPSHOTS = 30;
export const MAX_RECENTS = 12;
export const BACKUP_FORMAT = 'KNITCAT_BACKUP_V1';

/**
 * Storage this app owns. Historic `knitcad.` keys are included on purpose — they
 * hold the theme, the anniversary, the sound preference and the designer key, and
 * a backup that quietly skipped them would not be a backup.
 */
export const OWNED_KEY_PREFIXES = ['knitcad.', 'knitcat.'];

/** Runtime bookkeeping, not user data: a restored session flag would be a lie. */
export const EXCLUDED_KEYS = [SESSION_KEY, LAST_BACKUP_KEY];

/** Debounce for edits: long enough to batch a drag-painted row, short enough to feel free. */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

/**
 * Cell-by-cell comparison of two charts. Used by the version diff viewer, by the
 * recovery banner (so it can say "38 cells changed" instead of "restore?"), and
 * by anything else that needs to know whether two charts really differ.
 *
 * Missing rows/columns count as blanks, because a 24-row card saved from a
 * 30-row project genuinely lost six rows.
 */
export function diffMatrices(a = [], b = []) {
  const rows = Math.max(a.length, b.length);
  let cols = 0;
  for (const row of a) cols = Math.max(cols, Array.isArray(row) ? row.length : 0);
  for (const row of b) cols = Math.max(cols, Array.isArray(row) ? row.length : 0);

  let changed = 0;
  let added = 0;
  let removed = 0;
  const perRow = [];
  for (let r = 0; r < rows; r++) {
    const ra = a[r] || [];
    const rb = b[r] || [];
    let rowDiff = 0;
    for (let c = 0; c < cols; c++) {
      const va = norm(ra[c]);
      const vb = norm(rb[c]);
      if (va === vb) continue;
      changed++;
      rowDiff++;
      if (isBlank(va) && !isBlank(vb)) added++;
      else if (!isBlank(va) && isBlank(vb)) removed++;
    }
    if (rowDiff) perRow.push({ row: r + 1, changed: rowDiff });
  }
  return {
    changed,
    added,
    removed,
    rows,
    cols,
    perRow,
    identical: changed === 0,
    sizeChanged: a.length !== b.length || widthOf(a) !== widthOf(b)
  };
}

function widthOf(matrix) {
  let cols = 0;
  for (const row of matrix) cols = Math.max(cols, Array.isArray(row) ? row.length : 0);
  return cols;
}

/** `0`, `false`, `''`, null and undefined are all "an empty cell" here. */
function norm(value) {
  if (value === false || value === null || value === undefined || value === '') return 0;
  return value;
}
function isBlank(value) {
  return norm(value) === 0;
}

/** One-line, human diff for a toast or a banner. */
export function describeDiff(diff) {
  if (diff.identical) return 'identical to what is on screen';
  const parts = [`${diff.changed} cell${diff.changed === 1 ? '' : 's'} different`];
  if (diff.added || diff.removed) parts.push(`${diff.added} punched, ${diff.removed} cleared`);
  if (diff.sizeChanged) parts.push(`resized to ${diff.rows}×${diff.cols}`);
  return parts.join(' · ');
}

/**
 * Turn a live editor snapshot into a project document. Same envelope as a saved
 * .kcard, which means an autosave or a version can be restored through the exact
 * code path as a file from disk — one format, one validator, no second parser.
 */
export function toProjectDocument(snapshot, extra = {}) {
  return buildProjectDocument({
    profileId: snapshot.profileId ?? null,
    mode: snapshot.mode ?? null,
    name: snapshot.name ?? null,
    notes: snapshot.notes ?? null,
    rows: snapshot.rows ?? (Array.isArray(snapshot.stitchMatrix) ? snapshot.stitchMatrix.length : 0),
    cols: snapshot.cols ?? widthOf(snapshot.stitchMatrix || []),
    stitchMatrix: snapshot.stitchMatrix,
    meta: snapshot.meta ? { ...snapshot.meta } : undefined,
    ...extra
  });
}

/**
 * @param {object} options
 * @param {object} options.driver        storage driver (see storage.js)
 * @param {() => object} options.snapshot  returns the current editor state
 * @param {Storage} [options.local]      for the session flag + settings archive
 * @param {(doc: object) => void} [options.onRestore]
 * @param {string[]} [options.keyPrefixes]  localStorage prefixes owned by KNITCAT
 * @param {object} [options.notifier]
 * @param {() => number} [options.now]
 * @param {object} [options.timers]      { setTimeout, clearTimeout } for tests
 */
export function createDataService(options = {}) {
  const {
    driver,
    snapshot = () => ({}),
    local = typeof localStorage !== 'undefined' ? localStorage : null,
    notifier = null,
    now = () => Date.now(),
    timers = typeof window !== 'undefined' ? window : globalThis,
    debounceMs = AUTOSAVE_DEBOUNCE_MS,
    keyPrefixes = OWNED_KEY_PREFIXES,
    onListener = null
  } = options;

  const state = {
    ready: false,
    lastSavedAt: 0,
    saving: false,
    failing: false,
    crashed: false,
    pending: null,
    timer: null,
    lastError: null,
    kind: driver?.kind || 'memory'
  };

  const readLocal = key => {
    try { return local ? local.getItem(key) : null; } catch (_) { return null; }
  };
  const writeLocal = (key, value) => {
    try { if (local) local.setItem(key, value); } catch (_) { /* private mode */ }
  };

  const emit = () => { if (onListener) onListener(publicApi.status()); };

  // ── session flag ───────────────────────────────────────────────────────────
  function beginSession() {
    writeLocal(SESSION_KEY, JSON.stringify({ state: 'running', startedAt: new Date(now()).toISOString() }));
  }
  function endSession(reason) {
    writeLocal(SESSION_KEY, JSON.stringify({ state: 'closed', reason, endedAt: new Date(now()).toISOString() }));
  }
  function sessionWasOpen() {
    const raw = readLocal(SESSION_KEY);
    if (!raw) return false;
    try { return JSON.parse(raw)?.state === 'running'; } catch (_) { return true; }
  }

  // ── autosave ───────────────────────────────────────────────────────────────
  async function writeAutosave(doc) {
    await driver.put(STORES.AUTOSAVE, doc, AUTOSAVE_KEY);
    state.lastSavedAt = now();
    state.failing = false;
    emit();
    return doc;
  }

  async function saveNow(reason = 'manual') {
    const doc = toProjectDocument(snapshot(), { autosave: { reason, at: new Date(now()).toISOString() } });
    if (!Array.isArray(doc.stitchMatrix) || doc.stitchMatrix.length === 0) return null;
    if (doc.rows * doc.cols > KCARD_MAX_CELLS) return null;
    state.saving = true;
    emit();
    try {
      await writeAutosave(doc);
      return doc;
    } catch (err) {
      // A quota error is a real, reportable failure — the user believes their
      // work is safe, and it is not. Say so once rather than silently retrying.
      state.failing = true;
      state.lastError = err?.message || String(err);
      notifier?.warn?.('Autosave could not write to disk.', {
        details: `${state.lastError} — your work is still on screen; use Save Project to keep a copy.`,
        duration: 9000
      });
      emit();
      return null;
    } finally {
      state.saving = false;
      emit();
    }
  }

  function schedule(reason = 'edit') {
    if (state.timer != null && timers.clearTimeout) timers.clearTimeout(state.timer);
    state.pending = reason;
    state.timer = timers.setTimeout(() => {
      state.timer = null;
      const why = state.pending;
      state.pending = null;
      saveNow(why);
    }, debounceMs);
    return true;
  }

  /** Flush on unload. `pagehide` gives no guarantee the promise resolves, so the
   *  debounce timer is cancelled and one write is attempted immediately. Returns
   *  the write so `close()` can await it instead of racing the browser. */
  function flush() {
    if (state.timer != null) {
      if (timers.clearTimeout) timers.clearTimeout(state.timer);
      state.timer = null;
      return saveNow('unload');
    }
    return Promise.resolve(null);
  }

  async function loadAutosave() {
    return (await driver.get(STORES.AUTOSAVE, AUTOSAVE_KEY)) || null;
  }

  async function clearAutosave() {
    await driver.delete(STORES.AUTOSAVE, AUTOSAVE_KEY);
    state.lastSavedAt = 0;
    emit();
  }

  /**
   * Decide what to do at boot. Returns the document worth offering back, or null.
   * A clean close with an autosave is not an accident to undo — the app simply
   * reopens where it left off, quietly, so only a crash produces the banner.
   */
  async function recover() {
    const saved = await loadAutosave();
    const crashed = sessionWasOpen();
    state.crashed = crashed;
    if (!saved) return { action: 'none', saved, crashed };
    if (crashed) return { action: 'ask', saved, crashed };
    return { action: 'resume', saved, crashed };
  }

  // ── versions (snapshots) ───────────────────────────────────────────────────
  /**
   * Keep any snapshot- or document-shaped thing as a named version. Used by the
   * checkpoint button, and by the link-import path, which must not let the card
   * you were working on vanish behind the one you just opened.
   */
  async function keepVersion(source, label = 'Checkpoint') {
    const doc = toProjectDocument(source, {
      label,
      kind: 'version',
      ...(source?.timestamp ? { timestamp: source.timestamp } : {})
    });
    const id = `v${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await driver.put(STORES.SNAPSHOTS, { id, at: new Date(now()).toISOString(), document: doc }, id);
    await trimSnapshots();
    emit();
    return id;
  }

  async function takeSnapshot(label = 'Checkpoint') {
    return keepVersion(snapshot(), label);
  }

  async function trimSnapshots() {
    const all = await listSnapshots();
    if (all.length <= MAX_SNAPSHOTS) return 0;
    const drop = all.slice(0, all.length - MAX_SNAPSHOTS);
    for (const entry of drop) await driver.delete(STORES.SNAPSHOTS, entry.id);
    return drop.length;
  }

  async function listSnapshots() {
    const all = await driver.getAll(STORES.SNAPSHOTS);
    return all
      .filter(entry => entry && entry.id)
      .sort((x, y) => String(x.at).localeCompare(String(y.at)));
  }

  async function deleteSnapshot(id) {
    await driver.delete(STORES.SNAPSHOTS, id);
    emit();
  }

  async function snapshotDocument(id) {
    const entry = await driver.get(STORES.SNAPSHOTS, id);
    return entry?.document || null;
  }

  /** Compare a stored version against another version or the live editor. */
  async function diffSnapshot(id, other) {
    const doc = await snapshotDocument(id);
    const right = other === undefined ? toProjectDocument(snapshot()) : other;
    return {
      left: doc,
      right,
      diff: diffMatrices(doc?.stitchMatrix || [], right?.stitchMatrix || [])
    };
  }

  // ── recent files ───────────────────────────────────────────────────────────
  /**
   * The list is names + a full copy of the chart, not just filenames: there is no
   * filesystem to re-open from. A static site cannot remember a path it was never
   * given, so "recent" means "the last cards you opened, still here".
   */
  async function rememberRecent(entry) {
    const name = String(entry.name || 'untitled.kcard');
    const id = name.toLowerCase();
    const existing = await driver.get(STORES.RECENTS, id);
    await driver.put(STORES.RECENTS, {
      id,
      name,
      firstOpenedAt: existing?.firstOpenedAt || entry.firstOpenedAt || new Date(now()).toISOString(),
      openedAt: new Date(now()).toISOString(),
      mode: entry.mode ?? null,
      profileId: entry.profileId ?? null,
      rows: entry.rows ?? 0,
      cols: entry.cols ?? 0,
      document: entry.document || null
    }, id);
    const all = await listRecents();
    if (all.length > MAX_RECENTS) {
      for (const drop of all.slice(0, all.length - MAX_RECENTS)) await driver.delete(STORES.RECENTS, drop.id);
    }
    emit();
    return true;
  }

  async function listRecents() {
    const all = await driver.getAll(STORES.RECENTS);
    return all
      .filter(entry => entry && entry.id)
      .sort((x, y) => String(x.openedAt).localeCompare(String(y.openedAt)));
  }

  async function forgetRecent(id) {
    await driver.delete(STORES.RECENTS, id);
    emit();
  }

  // ── named projects ─────────────────────────────────────────────────────────
  async function saveNamed(name, doc) {
    const id = String(name).toLowerCase().trim();
    await driver.put(STORES.PROJECTS, { id, name, at: new Date(now()).toISOString(), document: doc }, id);
    emit();
    return id;
  }
  async function listNamed() {
    const all = await driver.getAll(STORES.PROJECTS);
    return all.filter(entry => entry && entry.id)
      .sort((x, y) => String(x.at).localeCompare(String(y.at)));
  }
  async function loadNamed(id) {
    const entry = await driver.get(STORES.PROJECTS, id);
    return entry?.document || null;
  }
  async function deleteNamed(id) {
    await driver.delete(STORES.PROJECTS, id);
    emit();
  }

  // ── generic key/value (stash, progress, notes, favourites) ─────────────────
  async function setKv(key, value) {
    await driver.put(STORES.KV, { key, value, at: new Date(now()).toISOString() }, String(key));
    return value;
  }
  async function getKv(key, fallback = null) {
    const entry = await driver.get(STORES.KV, String(key));
    return entry && 'value' in entry ? entry.value : fallback;
  }
  async function listKv(prefix = '') {
    const all = await driver.getAll(STORES.KV);
    return all.filter(entry => entry && String(entry.key).startsWith(prefix));
  }
  async function deleteKv(key) {
    await driver.delete(STORES.KV, String(key));
  }

  // ── backup / restore / export-all ──────────────────────────────────────────
  /**
   * One JSON file holding everything KNITCAT knows about you. This doubles as the
   * GDPR "export all my data" download and the single-file backup, because they
   * should be the same artefact: a split between "your data" and "your backup" is
   * where data gets lost.
   */
  async function buildArchive() {
    const settings = {};
    // The injected `local`, not the global: the caller decides which storage this
    // browser session actually has, and tests can run the whole archive without a DOM.
    if (local) {
      // Collected by KNITCAT's own key prefixes rather than a hand-written list,
      // which is the kind of allow-list that quietly stops covering a feature the
      // week it is added. Anything not ours is never touched.
      for (let i = 0; i < (local.length ?? 0); i++) {
        const key = local.key(i);
        if (!key) continue;
        if (!keyPrefixes.some(prefix => key.startsWith(prefix))) continue;
        if (EXCLUDED_KEYS.includes(key)) continue;
        const raw = readLocal(key);
        if (raw !== null) settings[key] = raw;
      }
    }
    return {
      format: BACKUP_FORMAT,
      app: 'KNITCAT',
      createdAt: new Date(now()).toISOString(),
      driver: state.kind,
      counts: {
        autosave: 1,
        snapshots: await driver.count(STORES.SNAPSHOTS),
        recents: await driver.count(STORES.RECENTS),
        projects: await driver.count(STORES.PROJECTS),
        kv: await driver.count(STORES.KV)
      },
      autosave: await loadAutosave(),
      snapshots: await driver.getAll(STORES.SNAPSHOTS),
      recents: await driver.getAll(STORES.RECENTS),
      projects: await driver.getAll(STORES.PROJECTS),
      kv: await driver.getAll(STORES.KV),
      settings
    };
  }

  /**
   * Restore an archive. Adds rather than replaces by default: wiping someone's
   * current work in the act of "restoring a backup" is the worst possible failure
   * mode for a backup feature.
   */
  async function restoreArchive(raw, { replace = false } = {}) {
    let archive = raw;
    if (typeof archive === 'string') {
      try { archive = JSON.parse(archive); } catch (err) {
        return { ok: false, error: `Not a KNITCAT backup: ${err.message}` };
      }
    }
    if (!archive || archive.format !== BACKUP_FORMAT) {
      return { ok: false, error: 'No KNITCAT_BACKUP_V1 marker — this is not a KNITCAT backup file.' };
    }
    if (replace) {
      for (const store of [STORES.SNAPSHOTS, STORES.RECENTS, STORES.PROJECTS, STORES.KV]) {
        await driver.clear(store);
      }
    }
    const written = { snapshots: 0, recents: 0, projects: 0, kv: 0, autosave: false, settings: 0 };
    if (archive.autosave) {
      await driver.put(STORES.AUTOSAVE, archive.autosave, AUTOSAVE_KEY);
      written.autosave = true;
      state.lastSavedAt = now();
    }
    for (const entry of archive.snapshots || []) {
      if (entry?.id) { await driver.put(STORES.SNAPSHOTS, entry, entry.id); written.snapshots++; }
    }
    for (const entry of archive.recents || []) {
      if (entry?.id) { await driver.put(STORES.RECENTS, entry, entry.id); written.recents++; }
    }
    for (const entry of archive.projects || []) {
      if (entry?.id) { await driver.put(STORES.PROJECTS, entry, entry.id); written.projects++; }
    }
    for (const entry of archive.kv || []) {
      if (entry?.key) { await driver.put(STORES.KV, entry, String(entry.key)); written.kv++; }
    }
    for (const [key, value] of Object.entries(archive.settings || {})) {
      writeLocal(key, value);
      written.settings++;
    }
    writeLocal(LAST_BACKUP_KEY, new Date(now()).toISOString());
    emit();
    return { ok: true, written, createdAt: archive.createdAt };
  }

  async function estimate() {
    const est = await driver.estimate();
    return { ...est, kind: state.kind };
  }

  function status() {
    return {
      kind: state.kind,
      ready: state.ready,
      saving: state.saving,
      failing: state.failing,
      crashed: state.crashed,
      lastSavedAt: state.lastSavedAt,
      lastError: state.lastError || null
    };
  }

  const publicApi = {
    driver,
    status,
    beginSession,
    endSession,
    saveNow,
    schedule,
    flush,
    loadAutosave,
    clearAutosave,
    recover,
    keepVersion,
    takeSnapshot,
    listSnapshots,
    deleteSnapshot,
    snapshotDocument,
    diffSnapshot,
    rememberRecent,
    listRecents,
    forgetRecent,
    saveNamed,
    listNamed,
    loadNamed,
    deleteNamed,
    setKv,
    getKv,
    listKv,
    deleteKv,
    buildArchive,
    restoreArchive,
    estimate,
    markReady() { state.ready = true; emit(); },
    async close(reason = 'unload') {
      await flush();
      endSession(reason);
      if (driver.close) await driver.close();
    }
  };

  return publicApi;
}
