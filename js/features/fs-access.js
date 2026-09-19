/**
 * File System Access — real Save/Open dialogs, and the memory of the file.
 *
 * The download-attribute trick works everywhere, but it cannot save over the file
 * you already opened: every save becomes `card (1).kcard`, `card (2).kcard`, and
 * the knitter loses track of which one is current. Where the browser offers the
 * File System Access API (Chromium desktop, and Samsung Internet) KNITCAT uses it:
 * one dialog, then a *handle* which is kept in IndexedDB so the next save can go
 * to the same file with one click and no dialog at all.
 *
 * Everything degrades: no API means the ordinary download path, no IndexedDB means
 * the handle is only remembered for this tab, and a revoked permission means the
 * picker is shown again rather than the save failing.
 *
 * The DOM-free parts are exported so `node --test` can drive the whole policy with
 * a fake picker — the interesting failures here are permission states, not pixels.
 */

import { STORES } from '../project/storage.js';

const STORE_KV = STORES.KV;

export const HANDLE_KEY = 'fsa.file-handle';
export const OPEN_HANDLE_KEY = 'fsa.open-handle';

/** Which of the three capabilities this browser actually has. */
export function detectSupport(scope = globalThis) {
  const win = scope || {};
  return {
    save: typeof win.showSaveFilePicker === 'function',
    open: typeof win.showOpenFilePicker === 'function',
    // A handle is only worth keeping somewhere that can store a live object.
    canRemember: false
  };
}

/** The picker's file-type filter for a KNITCAT card. */
export const KCARD_TYPES = [
  {
    description: 'KNITCAT card',
    accept: { 'application/json': ['.kcard', '.json'] }
  }
];

/**
 * Ask a handle for permission, in the order browsers implement it.
 * `unknown` means "this browser has no query API" — callers should simply attempt
 * the write, which is what the spec's own examples end up doing.
 * @returns {Promise<'granted'|'denied'|'prompt'|'unknown'>}
 */
export async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle || typeof handle !== 'object') return 'unknown';
  try {
    if (typeof handle.queryPermission !== 'function') return 'unknown';
    const queried = await handle.queryPermission({ mode });
    if (queried === 'granted') return 'granted';
    if (typeof handle.requestPermission !== 'function') return queried || 'unknown';
    const asked = await handle.requestPermission({ mode });
    return asked || 'unknown';
  } catch (err) {
    if (err?.name === 'NotAllowedError') return 'denied';
    return 'unknown';
  }
}

/** Turn any picked handle into text, with the errors a knitter can act on. */
export async function readHandleFile(handle) {
  if (!handle || typeof handle.getFile !== 'function') {
    return { ok: false, error: 'That is not a file KNITCAT can read.' };
  }
  try {
    const file = await handle.getFile();
    if (!file) return { ok: false, error: 'The file was empty or had moved.' };
    return { ok: true, name: file.name || 'card.kcard', text: await file.text() };
  } catch (err) {
    // AbortError is what a cancelled dialog looks like on some platforms.
    if (err?.name === 'AbortError' || err?.name === 'NotFoundError') {
      return { ok: false, cancelled: true, error: 'Nothing was picked.' };
    }
    return { ok: false, error: err?.message || 'The file could not be read.' };
  }
}

/** Write text through a save handle. Returns the same result shape as readHandleFile. */
export async function writeHandleFile(handle, text) {
  if (!handle || typeof handle.createWritable !== 'function') {
    return { ok: false, error: 'That file handle cannot be written to.' };
  }
  let writable = null;
  try {
    writable = await handle.createWritable({ keepExistingData: false });
    await writable.write({ type: 'write', start: 0, data: new Blob([text], { type: 'application/json' }) });
    await writable.close();
    writable = null;
    return { ok: true, name: handle.name || 'card.kcard' };
  } catch (err) {
    if (writable?.abort) {
      try { await writable.abort(); } catch (_) { /* already gone */ }
    }
    if (err?.name === 'NotAllowedError') {
      return { ok: false, permission: true, error: 'The browser would not let KNITCAT write to that file.' };
    }
    if (err?.name === 'AbortError') return { ok: false, cancelled: true, error: 'Save cancelled.' };
    return { ok: false, error: err?.message || 'The file could not be written.' };
  }
}

/**
 * The bridge used by the app. `driver` is the KNITCAT storage driver (for the
 * persisted handle) and `scope` is `window`, injected for tests.
 *
 * @param {object} options
 * @param {{get: Function, put: Function, delete: Function, kind: string}} [options.driver]
 * @param {object} [options.scope]             window-like object with the pickers
 * @param {(text: string, filename: string) => void} [options.download] fallback writer
 */
export function createFileBridge(options = {}) {
  const { driver = null, scope = globalThis, download = null, notifier = null } = options;
  const supports = detectSupport(scope);
  const canRemember = Boolean(driver) && driver.kind === 'indexeddb';

  let cachedHandle = null;
  let cachedName = null;

  const store = async (key, value) => {
    if (!canRemember) return false;
    try {
      if (value === null) await driver.delete(STORE_KV, key);
      else await driver.put(STORE_KV, value, key);
      return true;
    } catch (err) {
      notifier?.debug?.('[KNITCAT] could not remember the file:', err?.message || err);
      return false;
    }
  };

  const recall = async key => {
    if (!canRemember) return null;
    try { return await driver.get(STORE_KV, key); } catch (_) { return null; }
  };

  return {
    supports: { ...supports, canRemember },
    /** Name of the file currently bound to Save, if any. */
    get boundName() { return cachedName; },
    get bound() { return Boolean(cachedHandle); },

    /** Load the persisted handle. Called once at boot. */
    async restore() {
      const stored = await recall(HANDLE_KEY);
      if (stored && stored.name) {
        cachedHandle = stored.handle || null;
        cachedName = stored.name;
      }
      return { bound: Boolean(cachedHandle), name: cachedName, remembered: canRemember };
    },

    /** Bind Save to a chosen file (dialog), then write it. */
    async pickSaveFile({ suggestedName = 'card.kcard' } = {}) {
      if (!supports.save) return { ok: false, unsupported: true, error: 'This browser has no Save dialog.' };
      try {
        const handle = await scope.showSaveFilePicker({
          suggestedName,
          excludeAcceptAllOption: false,
          types: KCARD_TYPES
        });
        if (!handle) return { ok: false, cancelled: true, error: 'Save cancelled.' };
        cachedHandle = handle;
        cachedName = handle.name || suggestedName;
        await store(HANDLE_KEY, { handle, name: cachedName, boundAt: new Date().toISOString() });
        return { ok: true, name: cachedName, mode: 'picker' };
      } catch (err) {
        if (err?.name === 'AbortError') return { ok: false, cancelled: true, error: 'Save cancelled.' };
        return { ok: false, error: err?.message || 'The Save dialog failed.' };
      }
    },

    /**
     * Save text. Uses the bound file when there is one and permission still holds,
     * otherwise offers the picker, otherwise falls back to a download.
     * @returns {Promise<{ok: boolean, mode: string, name?: string, error?: string}>}
     */
    async save(text, { suggestedName = 'card.kcard', allowPicker = true } = {}) {
      if (cachedHandle) {
        const permission = await ensurePermission(cachedHandle, 'readwrite');
        if (permission !== 'denied') {
          const written = await writeHandleFile(cachedHandle, text);
          if (written.ok) return { ...written, mode: 'bound-file' };
          if (!written.permission && !written.cancelled) return { ...written, mode: 'bound-file' };
          if (written.cancelled) return { ...written, mode: 'bound-file' };
          // Permission pulled back: forget it and fall through to the picker.
          cachedHandle = null;
          cachedName = null;
          await store(HANDLE_KEY, null);
        } else {
          cachedHandle = null;
          cachedName = null;
          await store(HANDLE_KEY, null);
        }
      }
      if (supports.save && allowPicker) {
        const picked = await this.pickSaveFile({ suggestedName });
        if (picked.cancelled) return { ok: true, mode: 'cancelled' };
        if (picked.ok) {
          const written = await writeHandleFile(cachedHandle, text);
          if (written.ok) return { ok: true, mode: 'picker', name: cachedName };
          // A first write that fails after a successful dialog is a real error.
          return { ...written, mode: 'picker' };
        }
        return { ...picked, mode: 'picker' };
      }
      if (typeof download === 'function') {
        download(text, suggestedName);
        return { ok: true, mode: 'download', name: suggestedName };
      }
      return { ok: false, mode: 'none', error: 'This browser cannot write files, and no download path was given.' };
    },

    /** Unbind Save without touching the file on disk. */
    async unbind() {
      cachedHandle = null;
      cachedName = null;
      await store(HANDLE_KEY, null);
      return true;
    },

    /** Choose a .kcard to open. Falls back to the caller's file input. */
    async open() {
      if (!supports.open) return { ok: false, unsupported: true, error: 'This browser has no Open dialog.' };
      try {
        const picked = await scope.showOpenFilePicker({ multiple: false, types: KCARD_TYPES });
        const handle = Array.isArray(picked) ? picked[0] : null;
        if (!handle) return { ok: false, cancelled: true, error: 'Nothing was picked.' };
        const permission = await ensurePermission(handle, 'read');
        if (permission === 'denied') return { ok: false, error: 'Read permission was refused for that file.' };
        const read = await readHandleFile(handle);
        if (!read.ok) return read;
        await store(OPEN_HANDLE_KEY, { handle, name: read.name, openedAt: new Date().toISOString() });
        // Opening a file rebinds Save, which is what every desktop editor does.
        cachedHandle = handle;
        cachedName = read.name;
        await store(HANDLE_KEY, { handle, name: read.name, boundAt: new Date().toISOString() });
        return { ...read, mode: 'picker' };
      } catch (err) {
        if (err?.name === 'AbortError') return { ok: false, cancelled: true, error: 'Nothing was picked.' };
        return { ok: false, error: err?.message || 'The Open dialog failed.' };
      }
    }
  };
}
