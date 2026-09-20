/**
 * KNITCAT — Diagnostics core.
 *
 * A single, app-wide observability layer. The philosophy is deliberately
 * centralised: rather than sprinkling `try/catch` through all 50+ modules (which
 * is impossible to make exhaustive and easy to get wrong), this module installs ONE
 * capture net that nothing slips past, and gives every other module a shared,
 * structured vocabulary for logging, guarding, asserting and timing. Because it
 * funnels `console.*` into the same ring buffer, warnings and errors raised
 * anywhere in the codebase are recorded without a single line being edited.
 *
 * Design constraints (all enforced by tests):
 *   - Importing this module has ZERO side effects. It never touches `window`,
 *     `document` or `console` until `createDiagnostics().installGlobal()` is called.
 *     That keeps the whole graph importable under `node --test` (no DOM).
 *   - It must never throw out of a logging call, and must never recurse into
 *     itself while reporting a failure (a broken reporter cannot be allowed to
 *     take down the app it is watching).
 *   - Bounded memory: the ring buffer keeps the last N records; timestamps and
 *     counters are the only unbounded growth (and they are numbers).
 *
 * @module core/diagnostics
 */

/**
 * Severity levels, ordered. A record's `level` is always one of these strings.
 * @readonly
 * @enum {string}
 */
export const LEVELS = Object.freeze({
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal'
});

/** Numeric rank per level, so callers can filter "at least as bad as X". @type {Record<string, number>} */
const LEVEL_RANK = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

/**
 * The error taxonomy. Every captured error is tagged with exactly one category so
 * a flood can be triaged at a glance and exporters/UI can colour-code by cause.
 * @readonly
 * @enum {string}
 */
export const CATEGORIES = Object.freeze({
  VALIDATION: 'validation',
  COMPILER: 'compiler',
  DOM: 'dom',
  CANVAS: 'canvas',
  STORAGE: 'storage',
  NETWORK: 'network',
  IMPORT: 'import',
  EXPORT: 'export',
  RESOURCE: 'resource',
  PROMISE: 'promise',
  UNKNOWN: 'unknown'
});

/** Stable, greppable error-code prefixes keyed by category. @type {Record<string, string>} */
const CATEGORY_CODE = {
  [CATEGORIES.VALIDATION]: 'KV',
  [CATEGORIES.COMPILER]: 'KC',
  [CATEGORIES.DOM]: 'KD',
  [CATEGORIES.CANVAS]: 'KN',
  [CATEGORIES.STORAGE]: 'KS',
  [CATEGORIES.NETWORK]: 'KW',
  [CATEGORIES.IMPORT]: 'KI',
  [CATEGORIES.EXPORT]: 'KE',
  [CATEGORIES.RESOURCE]: 'KR',
  [CATEGORIES.PROMISE]: 'KP',
  [CATEGORIES.UNKNOWN]: 'KU'
};

/**
 * The native console methods, captured once at module load before any funnel can
 * replace them. Every record mirrors through these, so diagnostic output always
 * reaches the real console even while `console.warn/error` are hooked to funnel in.
 * @type {Record<string, ((...a:any[])=>void)|undefined>}
 */
const NATIVE_CONSOLE = (typeof console !== 'undefined')
  ? { log: console.log && console.log.bind(console), info: console.info && console.info.bind(console), warn: console.warn && console.warn.bind(console), error: console.error && console.error.bind(console) }
  : {};

/**
 * The typed error this layer understands end-to-end. It carries a machine-readable
 * `code` (e.g. `KV-011`), a human `message`, a `category` and structured `meta`
 * (the field/value/expected that tripped it, plus any context). It never loses the
 * original `cause`, so a wrapped failure is still fully diagnosable.
 */
export class DiagError extends Error {
  /**
   * @param {object} spec
   * @param {string} spec.code          Stable code like `KV-004`.
   * @param {string} spec.message       Human-readable explanation.
   * @param {string} [spec.category]    One of {@link CATEGORIES}.
   * @param {object}  [spec.meta]       Structured context (field, got, expected…).
   * @param {Error}   [spec.cause]      The original error this wraps.
   */
  constructor({ code, message, category = CATEGORIES.UNKNOWN, meta = {}, cause = undefined }) {
    super(message);
    this.name = 'DiagError';
    this.code = code;
    this.category = category;
    this.meta = meta;
    if (cause !== undefined) this.cause = cause;
    if (Error.captureStackTrace) Error.captureStackTrace(this, DiagError);
  }

  /**
   * Serialise to a plain object safe for JSON (used by the ring buffer, toasts and
   * the diagnostic export). Walks the `cause` chain to a bounded depth.
   * @returns {{name:string,message:string,code:string,category:string,meta:Object,stack?:string,cause?:Object}}
   */
  toJSON() {
    const out = {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      meta: this.meta
    };
    if (this.stack) out.stack = this.stack;
    if (this.cause instanceof DiagError) out.cause = this.cause.toJSON();
    else if (this.cause instanceof Error) out.cause = { name: this.cause.name, message: this.cause.message };
    return out;
  }
}

/**
 * Best-effort serialisation of an arbitrary thrown value into a plain object — used
 * so the buffer and the console funnel can hold something structured even when the
 * thing thrown is a string, `null`, a `DiagError`, or an exotic object with a
 * non-writable `message`.
 *
 * @param {unknown} err             Whatever was thrown or rejected.
 * @returns {{message:string,name:string,code:string|null,category:string,stack:string|null,meta:Object}}
 */
export function serializeError(err) {
  if (err instanceof DiagError) {
    const j = err.toJSON();
    return { message: j.message, name: j.name, code: j.code, category: j.category, stack: j.stack || null, meta: j.meta || {} };
  }
  if (err instanceof Error) {
    return {
      message: err.message || String(err),
      name: err.name || 'Error',
      // An error may carry its own code (Node fs, DOMException); honour it.
      code: typeof err.code === 'string' ? err.code : null,
      category: classifyError(err),
      stack: err.stack || null,
      meta: typeof err.code !== 'undefined' ? { nativeCode: err.code } : {}
    };
  }
  return { message: safeString(err), name: 'Thrown', code: null, category: CATEGORIES.UNKNOWN, stack: null, meta: {} };
}

/**
 * Classify an error into a {@link CATEGORIES} bucket from its message, name and
 * native code. Heuristic but comprehensive: it checks the whole `cause` chain so a
 * validation failure buried under a wrapper still categorises correctly.
 *
 * @param {unknown} err              The error to classify.
 * @returns {string} One of {@link CATEGORIES}.
 */
export function classifyError(err) {
  const seen = new Set();
  let cur = err;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    if (cur.category && Object.values(CATEGORIES).includes(cur.category)) return cur.category;
    const hay = `${cur.name || ''} ${cur.message || ''} ${cur.code || ''}`.toLowerCase();
    if (/validation|invalid|out of range|expected|must be|schema|not a |type error/.test(hay)) return CATEGORIES.VALIDATION;
    if (/decompil|compil|carriage|transfer|eyelet|schedule|rack|stitch/.test(hay)) return CATEGORIES.COMPILER;
    if (/canvas|context2d|webgl|getImageData|createLinearGradient|roundRect|path2d/.test(hay)) return CATEGORIES.CANVAS;
    if (/indexeddb|idb|quota|storage|localStorage|transaction/.test(hay)) return CATEGORIES.STORAGE;
    if (/fetch|network|xmlhttp|timeout|econn|enotfound|cors/.test(hay)) return CATEGORIES.NETWORK;
    if (/import|decode|parse|json\.parse|dither|image|fileReader/.test(hay)) return CATEGORIES.IMPORT;
    if (/export|gcode|dxf|svg|blob|download|serialize/.test(hay)) return CATEGORIES.EXPORT;
    if (/cannot read|is not defined|is not a function|undefined|null has|not attached|domexception/.test(hay)) return CATEGORIES.DOM;
    if (/failed to load|resource|script|stylesheet|404/.test(hay)) return CATEGORIES.RESOURCE;
    cur = cur.cause;
  }
  return CATEGORIES.UNKNOWN;
}

/** @param {unknown} v @returns {string} A printable string that never throws. */
function safeString(v) {
  try {
    if (typeof v === 'string') return v;
    if (v == null) return String(v);
    return JSON.stringify(v);
  } catch (_) {
    try { return String(v); } catch (__) { return '[unstringifiable]'; }
  }
}

let _codeSeq = 0;
/** @returns {string} a fresh stable-ish code for category (used by assert/guard). */
function nextCode(category) {
  const prefix = CATEGORY_CODE[category] || CATEGORY_CODE[CATEGORIES.UNKNOWN];
  return `${prefix}-${String(++_codeSeq % 100000).padStart(3, '0')}`;
}

/**
 * Create a diagnostics instance. All app code should talk to the memoised default
 * returned by {@link getDiagnostics}; this factory exists so tests can spin up an
 * isolated instance with its own clock and buffer.
 *
 * @param {object}   [options]
 * @param {number}   [options.capacity=500]   Records kept in the ring buffer.
 * @param {string}   [options.minLevel='debug'] Minimum level to keep AND print.
 * @param {boolean}  [options.quiet=false]     Suppress console output (for tests).
 * @param {Function} [options.now]             Clock, defaults to Date.now.
 * @returns {Diagnostics}
 */
export function createDiagnostics(options = {}) {
  const capacity = Number.isFinite(options.capacity) ? Math.max(1, options.capacity | 0) : 500;
  const minLevel = LEVEL_RANK[options.minLevel] != null ? options.minLevel : LEVELS.DEBUG;
  const quiet = Boolean(options.quiet);
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const t0 = now();

  /** @type {Array<Object>} bounded ring buffer, oldest first */
  const records = [];
  /** @type {Set<Function>} */
  const subscribers = new Set();
  /** running counters by level and category (cheap, unbounded numbers only) */
  const counters = { level: {}, category: {}, total: 0 };
  /** a slow-op log: label -> {count, totalMs, maxMs} */
  const timings = new Map();
  /** base context merged into every record (e.g. {module:'compiler'}) */
  let baseContext = {};

  let consoleHooked = false;
  const originalConsole = {};

  /**
   * Should a record at `level` be kept/printed?
   * @param {string} level
   * @returns {boolean}
   */
  function enabled(level) {
    return (LEVEL_RANK[level] || 0) >= (LEVEL_RANK[minLevel] || 0);
  }

  /**
   * Emit one structured record: buffer it, update counters, notify subscribers and
   * mirror to the console. Never throws, even if a subscriber is broken.
   *
   * @param {string} level     One of {@link LEVELS}.
   * @param {string} message   Human-readable message.
   * @param {object} [extra]   { data, context, error, category, code }
   * @returns {Object} the stored record.
   */
  function log(level, message, extra = {}) {
    const msg = safeString(message);
    const category = extra.category || (extra.error ? serializeError(extra.error).category : null);
    const code = extra.code || (extra.error ? serializeError(extra.error).code : null);

    // ── Anti-spam: collapse a run of identical consecutive records into one.
    // A rAF loop, a repeated autoplay warning or a chatty subsystem should read as
    // "message ×N (last 3s ago)", never as N pages of noise. Only *consecutive*
    // matches aggregate, so interleaved output is never wrongly merged.
    const last = records[records.length - 1];
    if (last && last.level === level && last.message === msg && last.category === category && last.code === code) {
      last.count = (last.count || 1) + 1;
      last.lastTs = now();
      last.lastMs = now() - t0;
      if (extra.data !== undefined) last.data = extra.data; // keep the freshest payload
      counters.total++;
      counters.level[level] = (counters.level[level] || 0) + 1;
      notify(last, { updated: true });
      return last; // do NOT mirror a duplicate to the console — that is the spam
    }

    const record = {
      seq: counters.total + 1,
      t: now(),
      ms: now() - t0,
      level,
      message: msg,
      category,
      code,
      count: 1,
      lastTs: now(),
      lastMs: now() - t0,
      data: 'data' in extra ? extra.data : undefined,
      context: Object.assign({}, baseContext, extra.context || {}),
      error: extra.error ? serializeError(extra.error) : undefined
    };
    counters.total++;
    counters.level[level] = (counters.level[level] || 0) + 1;
    if (record.category) counters.category[record.category] = (counters.category[record.category] || 0) + 1;

    records.push(record);
    if (records.length > capacity) records.splice(0, records.length - capacity);

    if (!quiet && enabled(level)) {
      // Mirror to the *native* console methods captured at module load, never the
      // (possibly hooked) live `console`, so our own output cannot re-enter the
      // funnel below and double-record or loop.
      const fn = level === LEVELS.FATAL || level === LEVELS.ERROR ? 'error'
        : level === LEVELS.WARN ? 'warn' : 'log';
      const native = NATIVE_CONSOLE[fn] || NATIVE_CONSOLE.log;
      if (native) {
        try {
          const args = [`[KNITCAT][${level}]`, record.message];
          const tail = record.error ? (record.error.stack || record.error.message) : (record.data != null ? record.data : null);
          if (tail != null) args.push(tail); // never print a trailing `undefined`
          native(...args);
        } catch (_) { /* console may be missing/muted */ }
      }
    }

    notify(record, { fresh: true });
    return record;
  }

  /**
   * Fan a record out to subscribers, swallowing any subscriber that misbehaves.
   * @param {Object} record
   * @param {{updated?:boolean, fresh?:boolean}} meta
   */
  function notify(record, meta) {
    for (const cb of subscribers) {
      try { cb(record, meta); } catch (_) { /* one bad subscriber must not stop others */ }
    }
  }

  /** The diagnostics object handed to the rest of the app. @typedef Object Diagnostics */
  const api = {
    LEVELS,
    CATEGORIES,
    DiagError,

    /**
     * @param {Object} ctx Merged into every subsequent record (e.g. {sessionId}).
     * @returns {Diagnostics} this, for chaining.
     */
    context(ctx) { baseContext = Object.assign({}, baseContext, ctx || {}); return api; },

    /** @returns {Diagnostics} a logger that prefixes every message with `[name]`. */
    child(name) {
      const wrap = (lvl) => (msg, data) => log(lvl, `[${name}] ${msg}`, { data, context: { source: name } });
      return {
        name,
        trace: wrap(LEVELS.TRACE), debug: wrap(LEVELS.DEBUG), info: wrap(LEVELS.INFO),
        warn: wrap(LEVELS.WARN), error: wrap(LEVELS.ERROR), fatal: wrap(LEVELS.FATAL)
      };
    },

    /** @param {string} m @param {*} [d] */ trace: (m, d) => log(LEVELS.TRACE, m, { data: d }),
    /** @param {string} m @param {*} [d] */ debug: (m, d) => log(LEVELS.DEBUG, m, { data: d }),
    /** @param {string} m @param {*} [d] */ info: (m, d) => log(LEVELS.INFO, m, { data: d }),
    /** @param {string} m @param {*} [d] */ warn: (m, d) => log(LEVELS.WARN, m, { data: d }),
    /** @param {string} m @param {*} [d] */ error: (m, d) => log(LEVELS.ERROR, m, { data: d, error: d instanceof Error ? d : undefined }),
    /** @param {string} m @param {*} [d] */ fatal: (m, d) => log(LEVELS.FATAL, m, { data: d, error: d instanceof Error ? d : undefined }),

    /**
     * Log a caught error with its category/code preserved.
     * @param {string} label   Where it was caught.
     * @param {unknown} err    The thrown value.
     * @param {object} [extra] {level, context, data}
     * @returns {Object} the record.
     */
    logError(label, err, extra = {}) {
      const s = serializeError(err);
      return log(extra.level || LEVELS.ERROR, `${label}: ${s.message}`, {
        error: err, category: s.category, code: s.code, context: extra.context, data: extra.data
      });
    },

    /**
     * Assert an invariant. When it fails, record an error AND throw a typed
     * DiagError so programming mistakes surface loudly in every environment.
     * @param {boolean} condition
     * @param {string} message
     * @param {object} [opts] {category, meta, code}
     * @throws {DiagError}
     */
    assert(condition, message, opts = {}) {
      if (condition) return true;
      const category = opts.category || CATEGORIES.UNKNOWN;
      const err = new DiagError({ code: opts.code || nextCode(category), message: message || 'assertion failed', category, meta: opts.meta || {} });
      log(LEVELS.ERROR, `ASSERT: ${message}`, { error: err, category, code: err.code, context: opts.context });
      throw err;
    },

    /**
     * Like {@link assert} but records-only — never throws. Use in code paths where
     * a broken invariant must be reported but the app should keep running.
     * @param {boolean} condition
     * @param {string} message
     * @param {object} [opts]
     * @returns {boolean} the condition.
     */
    check(condition, message, opts = {}) {
      if (condition) return true;
      const category = opts.category || CATEGORIES.UNKNOWN;
      log(opts.level || LEVELS.WARN, `CHECK: ${message}`, { category, code: opts.code || nextCode(category), context: opts.context, data: opts.meta });
      return false;
    },

    /**
     * Run `fn` inside exhaustive error containment. Any throw (or rejected promise
     * when `fn` is async) is classified, logged and turned into either a fallback or
     * a rethrow, per options. This is the single guard used across the whole app.
     *
     * @template T
     * @param {string} label   Human name for the block.
     * @param {() => (T|Promise<T>)} fn
     * @param {object} [opts]
     * @param {T}      [opts.fallback]        Value returned on error (sync path).
     * @param {boolean}[opts.rethrow=false]   Rethrow after logging.
     * @param {string} [opts.level='error']   Level to log at.
     * @param {Object} [opts.context]         Extra context for the record.
     * @returns {T|Promise<T>} fn's result, or the fallback/undefined on failure.
     */
    guard(label, fn, opts = {}) {
      try {
        const out = fn();
        if (out && typeof out.then === 'function') {
          return out.catch(err => {
            const s = serializeError(err);
            log(opts.level || LEVELS.ERROR, `guard(async) "${label}": ${s.message}`, { error: err, category: s.category, code: s.code, context: opts.context });
            if (opts.rethrow) throw err;
            return opts.fallback;
          });
        }
        return out;
      } catch (err) {
        const s = serializeError(err);
        log(opts.level || LEVELS.ERROR, `guard "${label}": ${s.message}`, { error: err, category: s.category, code: s.code, context: opts.context });
        if (opts.rethrow) throw err;
        return opts.fallback;
      }
    },

    /**
     * Time `fn`, record the duration to the slow-op log, and return its result.
     * @template T
     * @param {string} label
     * @param {() => T} fn
     * @returns {T}
     */
    time(label, fn) {
      const start = now();
      try {
        return fn();
      } finally {
        const dur = now() - start;
        const rec = timings.get(label) || { count: 0, totalMs: 0, maxMs: 0 };
        rec.count++; rec.totalMs += dur; rec.maxMs = Math.max(rec.maxMs, dur);
        timings.set(label, rec);
        if (dur > 200) log(LEVELS.WARN, `slow op "${label}" took ${dur}ms`, { category: CATEGORIES.UNKNOWN, context: { label, dur } });
      }
    },

    /**
     * @param {Function} cb Called with every record. Return value ignored.
     * @returns {() => void} an unsubscribe function.
     */
    subscribe(cb) {
      if (typeof cb !== 'function') return () => {};
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    /**
     * @returns {Array<Object>} a copy of the ring buffer (oldest→newest).
     */
    records() { return records.slice(); },

    /**
     * A compact health snapshot: totals, per-level and per-category counts, and the
     * slowest operations. Cheap enough to call on a timer or from a toast.
     * @returns {{total:number, uptimeMs:number, byLevel:Object, byCategory:Object, slowest:Array<Object>}}
     */
    snapshot() {
      const slowest = [...timings.entries()]
        .map(([label, r]) => ({ label, count: r.count, avgMs: Math.round(r.totalMs / r.count), maxMs: r.maxMs }))
        .sort((a, b) => b.maxMs - a.maxMs)
        .slice(0, 10);
      return {
        total: counters.total,
        uptimeMs: now() - t0,
        byLevel: Object.assign({}, counters.level),
        byCategory: Object.assign({}, counters.category),
        slowest
      };
    },

    /**
     * Serialise the whole session (snapshot + records) to a JSON string for the
     * "export diagnostics" affordance.
     * @returns {string}
     */
    exportJSON() {
      try {
        return JSON.stringify({ snapshot: api.snapshot(), records }, null, 2);
      } catch (_) {
        return JSON.stringify({ snapshot: api.snapshot(), records: records.map(r => ({ seq: r.seq, level: r.level, message: r.message })) });
      }
    },

    /** Clear the buffer and counters (keeps subscribers + console hook). */
    reset() { records.length = 0; counters.level = {}; counters.category = {}; counters.total = 0; timings.clear(); },

    /**
     * Install the app-wide capture net. Idempotent and fully self-protecting.
     * @param {object} [opts]
     * @param {boolean} [opts.console=true]    Funnel console.warn/error into the buffer.
     * @param {boolean} [opts.errors=true]     window 'error' + 'unhandledrejection'.
     * @param {boolean} [opts.resources=true]  Capturing-phase resource load errors.
     * @param {(record:Object)=>void} [opts.onError] Bridge to a toast/notifier.
     * @param {object}  [opts.globals]         Target for window.KNITCAT_DIAG (test seam).
     * @returns {Diagnostics} this.
     */
    installGlobal(opts = {}) {
      const w = (opts.globals && opts.globals.window) || (typeof window !== 'undefined' ? window : null);
      if (!w) return api; // headless: nothing to install, never throw

      if (opts.errors !== false) {
        w.addEventListener('error', ev => {
          // Resource errors fire 'error' on elements; handle separately below.
          if (ev && ev.target && ev.target !== w && (ev.target.tagName || ev.target.src || ev.target.href)) {
            if (opts.resources !== false) {
              const el = ev.target;
              const src = el.src || el.href || '(unknown)';
              log(LEVELS.ERROR, `resource failed to load: ${shortSrc(src)}`, {
                category: CATEGORIES.RESOURCE, code: nextCode(CATEGORIES.RESOURCE), context: { tagName: el.tagName, src }
              });
            }
            return;
          }
          const message = ev && ev.message ? ev.message : 'Uncaught error';
          const where = ev && ev.filename ? `${shortSrc(ev.filename)}:${ev.lineno || 0}:${ev.colno || 0}` : '';
          const errObj = ev && ev.error ? ev.error : new Error(message);
          const rec = log(LEVELS.FATAL, `uncaught: ${message}${where ? ` @ ${where}` : ''}`, {
            error: errObj, category: CATEGORIES.DOM, context: { where, filename: ev && ev.filename }
          });
          if (opts.onError) safeCb(opts.onError, rec);
        }, true); // capture phase so resource errors are seen too

        w.addEventListener('unhandledrejection', ev => {
          const reason = ev && ev.reason;
          const s = serializeError(reason);
          const rec = log(LEVELS.FATAL, `unhandled rejection: ${s.message}`, {
            error: reason, category: CATEGORIES.PROMISE, code: s.code || nextCode(CATEGORIES.PROMISE), context: { kind: 'rejection' }
          });
          if (opts.onError) safeCb(opts.onError, rec);
        });
      }

      if (opts.console !== false && !consoleHooked && typeof console !== 'undefined') {
        // Funnel every existing `console.warn/error/info/debug` call anywhere in the
        // codebase into the ring buffer. Because log() mirrors to NATIVE_CONSOLE (not
        // the hooked method), this cannot recurse or double-record.
        for (const m of ['warn', 'error', 'info', 'debug']) {
          originalConsole[m] = console[m] ? console[m].bind(console) : () => {};
          console[m] = (...args) => {
            const lvl = m === 'error' ? LEVELS.ERROR : m;
            log(lvl, args.map(safeString).join(' '), { data: args.length > 1 ? args.slice(1) : undefined, context: { viaConsole: true } });
          };
        }
        consoleHooked = true;
      }

      try { w.KNITCAT_DIAG = api; } catch (_) { /* read-only window in some sandboxes */ }
      return api;
    }
  };

  return api;
}

/** @param {Function} cb @param {...*} args Run a callback, swallowing any throw. */
function safeCb(cb, ...args) { try { cb(...args); } catch (_) { /* bridge must never throw */ } }

/** @param {string} s Trim a URL down to its last path segment for readable logs. */
function shortSrc(s) {
  try { return String(s).split('/').pop(); } catch (_) { return String(s); }
}

/** Process-wide memoised default instance. @type {Diagnostics|null} */
let DEFAULT = null;

/**
 * The shared diagnostics instance every module should use. Lazily created, and
 * side-effect-free until someone calls a method or {@link installDiagnostics}.
 * @param {object} [options] forwarded to {@link createDiagnostics} on first call.
 * @returns {Diagnostics}
 */
export function getDiagnostics(options) {
  if (!DEFAULT) DEFAULT = createDiagnostics(options);
  return DEFAULT;
}

/**
 * Convenience: grab the default instance and install the global capture net in one
 * step. Called once from app boot.
 * @param {object} [installOpts] see {@link Diagnostics.installGlobal}.
 * @returns {Diagnostics}
 */
export function installDiagnostics(installOpts) {
  return getDiagnostics().installGlobal(installOpts);
}
