/**
 * Persistence drivers for KNITCAT.
 *
 * Why a driver layer at all: the app used to keep everything in localStorage,
 * which caps out around 5 MB per origin and is a synchronous, string-only API.
 * A 240-row × 200-needle card is 48 000 cells; JSON for that is roughly 100-200 KB,
 * so a handful of versions plus a stash and a scrapbook is comfortably over the
 * quota. IndexedDB is asynchronous, structured (it stores the matrix arrays
 * without a JSON round trip) and gets a much larger budget from the browser.
 *
 * But IndexedDB genuinely fails: Safari private tabs reject the open, some
 * enterprise policies block it outright, and older WebKit has quirks. So every
 * call site is written against one small async interface and gets the best thing
 * actually available, in this order:
 *
 *   1. IndexedDB          — real deal, structured clone, big quota
 *   2. localStorage       — namespaced JSON, works almost everywhere
 *   3. in-memory          — the session still behaves normally, saves just
 *                           do not survive a reload (and the UI says so)
 *
 * No dependency, no build step, and every driver is injectable so the tests can
 * run the whole storage policy without a browser.
 */

export const DB_NAME = 'knitcat';
export const DB_VERSION = 1;

/** Object stores. Each is a plain key-value store; `keyPath` keeps them independent. */
export const STORES = Object.freeze({
  AUTOSAVE: 'autosave',
  SNAPSHOTS: 'snapshots',
  RECENTS: 'recents',
  PROJECTS: 'projects',
  KV: 'kv'
});

const STORE_LIST = Object.values(STORES);

function assertKey(store, key) {
  if (!STORE_LIST.includes(store)) {
    throw new Error(`Unknown KNITCAT store "${store}"`);
  }
  if (key === undefined || key === null || key === '') {
    throw new Error(`Store "${store}" needs a key`);
  }
}

/**
 * The last-resort driver. Everything keeps working for the session; nothing
 * survives a reload, which the UI reports honestly rather than pretending.
 */
export function createMemoryDriver() {
  const maps = new Map(STORE_LIST.map(name => [name, new Map()]));
  return {
    kind: 'memory',
    async get(store, key) {
      assertKey(store, key);
      const value = maps.get(store)?.get(key);
      return value === undefined ? null : clone(value);
    },
    async put(store, value, key) {
      assertKey(store, key);
      maps.get(store).set(key, clone(value));
      return true;
    },
    async delete(store, key) {
      assertKey(store, key);
      return maps.get(store)?.delete(key) ?? false;
    },
    async getAll(store) {
      assertKey(store, '*');
      return [...(maps.get(store)?.values() ?? [])].map(clone);
    },
    async count(store) {
      assertKey(store, '*');
      return maps.get(store)?.size ?? 0;
    },
    async clear(store) {
      assertKey(store, '*');
      maps.get(store)?.clear();
      return true;
    },
    async estimate() {
      return { kind: 'memory', usage: 0, quota: 0 };
    },
    async close() {}
  };
}

/**
 * localStorage driver. Values are JSON-encoded; structuredClone is used first so
 * a matrix survives without a stringify when the value is already plain data.
 * Quota errors are thrown, and the policy layer decides what to say.
 */
export function createLocalDriver(storage = globalThis.localStorage, prefix = 'knitcat.idb.') {
  if (!storage) throw new Error('no localStorage');
  const keyOf = (store, key) => `${prefix}${store}:${key}`;
  const namesIn = store => {
    const out = [];
    for (let i = 0; i < storage.length; i++) {
      const raw = storage.key(i);
      if (raw && raw.startsWith(`${prefix}${store}:`)) out.push(raw.slice(prefix.length + store.length + 1));
    }
    return out;
  };
  const read = raw => {
    try { return JSON.parse(raw); } catch (_) { return null; }
  };

  return {
    kind: 'local',
    async get(store, key) {
      assertKey(store, key);
      const raw = storage.getItem(keyOf(store, key));
      return raw === null ? null : read(raw);
    },
    async put(store, value, key) {
      assertKey(store, key);
      storage.setItem(keyOf(store, key), JSON.stringify(value));
      return true;
    },
    async delete(store, key) {
      assertKey(store, key);
      storage.removeItem(keyOf(store, key));
      return true;
    },
    async getAll(store) {
      assertKey(store, '*');
      return namesIn(store).map(name => read(storage.getItem(keyOf(store, name)))).filter(v => v !== null);
    },
    async count(store) {
      assertKey(store, '*');
      return namesIn(store).length;
    },
    async clear(store) {
      assertKey(store, '*');
      for (const name of namesIn(store)) storage.removeItem(keyOf(store, name));
      return true;
    },
    async estimate() {
      let usage = 0;
      for (let i = 0; i < storage.length; i++) {
        const raw = storage.key(i);
        usage += (raw?.length ?? 0) + (storage.getItem(raw)?.length ?? 0);
      }
      // ~2 bytes per UTF-16 code unit is what browsers actually charge.
      return { kind: 'local', usage: usage * 2, quota: 5 * 1024 * 1024 };
    },
    async close() {}
  };
}

/**
 * IndexedDB driver. Opens lazily, and rejects if the database cannot be created
 * (private mode, blocked by policy) so `openDriver()` can fall straight through
 * to localStorage instead of failing the feature that called it.
 */
export async function openIdbDriver({
  indexedDB: idb = globalThis.indexedDB,
  name = DB_NAME,
  version = DB_VERSION
} = {}) {
  if (!idb || typeof idb.open !== 'function') throw new Error('no indexedDB');

  const db = await new Promise((resolve, reject) => {
    let request;
    try {
      request = idb.open(name, version);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of STORE_LIST) {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open rejected'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });

  const tx = (store, mode) => db.transaction(store, mode).objectStore(store);
  const run = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`IndexedDB request failed: ${request.error}`));
  });

  return {
    kind: 'indexeddb',
    async get(store, key) {
      assertKey(store, key);
      const value = await run(tx(store, 'readonly').get(key));
      return value === undefined ? null : value;
    },
    async put(store, value, key) {
      assertKey(store, key);
      await run(tx(store, 'readwrite').put(clone(value), key));
      return true;
    },
    async delete(store, key) {
      assertKey(store, key);
      await run(tx(store, 'readwrite').delete(key));
      return true;
    },
    async getAll(store) {
      assertKey(store, '*');
      return (await run(tx(store, 'readonly').getAll())) ?? [];
    },
    async count(store) {
      assertKey(store, '*');
      return (await run(tx(store, 'readonly').count())) ?? 0;
    },
    async clear(store) {
      assertKey(store, '*');
      await run(tx(store, 'readwrite').clear());
      return true;
    },
    async estimate() {
      const storage = typeof navigator !== 'undefined' ? navigator.storage : null;
      const est = storage?.estimate ? await storage.estimate() : null;
      if (!est) return { kind: 'indexeddb', usage: 0, quota: 0 };
      return { kind: 'indexeddb', usage: est.usage ?? 0, quota: est.quota ?? 0 };
    },
    async persist() {
      const storage = typeof navigator !== 'undefined' ? navigator.storage : null;
      return storage?.persist ? storage.persist() : false;
    },
    async close() {
      try { db.close(); } catch (_) { /* already gone */ }
    }
  };
}

/**
 * Pick the best driver that actually works. Never throws: a storage layer that
 * cannot report an error is worse than one that runs in memory.
 */
export async function openDriver(options = {}) {
  const { allowIndexedDb = true, allowLocal = true, logger = console } = options;
  if (allowIndexedDb) {
    try {
      return { driver: await openIdbDriver(options), warning: null };
    } catch (err) {
      logger?.debug?.('[KNITCAT] IndexedDB unavailable, falling back:', err?.message || err);
    }
  }
  if (allowLocal) {
    try {
      return { driver: createLocalDriver(options.storage), warning: 'indexeddb-unavailable' };
    } catch (err) {
      logger?.debug?.('[KNITCAT] localStorage unavailable too:', err?.message || err);
    }
  }
  return { driver: createMemoryDriver(), warning: 'memory-only' };
}

/**
 * Clone before writing. IndexedDB structured-clones on put and localStorage
 * JSON-encodes, but the memory driver keeps the *same array reference*, so
 * without this an autosave would silently track later edits and stop being a
 * record of the moment it was taken.
 */
function clone(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(value));
}
