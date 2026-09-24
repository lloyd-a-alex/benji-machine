/**
 * KNITCAT — per-module logging facade.
 *
 * The observability *engine* lives in {@link module:core/diagnostics}: a bounded ring
 * buffer, an error taxonomy, a global capture net and a `console.*` funnel. This
 * module is only the ergonomic door every other file walks through to reach it, so a
 * module can say:
 *
 *     import { logger } from '../core/logging.js';
 *     const log = logger('importer/csv');
 *     ...
 *     if (!rows.length) { log.warn('empty CSV — nothing to import'); return null; }
 *     try { parse(text) } catch (err) { log.logError('parse', err); return null; }
 *
 * Why a facade rather than calling `getDiagnostics().child(name)` everywhere:
 *   • the child is memoised per name, so a module that imports it at load and a
 *     feature that grabs it lazily share ONE logger (and one `[name]` prefix);
 *   • the child only exposes the six level methods — this adds scoped `logError`,
 *     `guard`, `check`, `assert` and `time` that already carry the module name as
 *     context, which is the vocabulary the rest of the app hand-rolled ad hoc.
 *
 * Zero side effects at import (diagnostics itself is side-effect-free until its
 * capture net is installed by app boot), so the whole graph stays importable under
 * `node --test` with no DOM. Never throws: a broken logger must not take down the
 * code it is watching, so the accessor degrades to a no-op surface on any failure.
 *
 * @module core/logging
 */

import { getDiagnostics } from './diagnostics.js';

/** Memoised scoped loggers, keyed by their module name. @type {Map<string, Object>} */
const CACHE = new Map();

/** A do-nothing logger with the same shape as a real one, for pathological cases. */
function nullLogger(name) {
  const noop = () => undefined;
  return {
    name,
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    logError: noop, check: () => true, assert: () => true,
    guard: (_label, fn) => (typeof fn === 'function' ? fn() : undefined),
    time: (_label, fn) => (typeof fn === 'function' ? fn() : undefined),
    child: (sub) => nullLogger(`${name}/${sub}`),
  };
}

/**
 * Build a scoped logger for a module. Pass a stable, greppable, slash-separated
 * name that mirrors the file's location (e.g. `logger('ui/canvas-editor')`). The
 * same name always returns the same instance, so log lines cluster cleanly in the
 * console panel and the exported diagnostics dump.
 *
 * @param {string} name module scope, e.g. 'compiler/lace-decompiler'
 * @returns {{
 *   name: string,
 *   trace: (m:string,d?:any)=>void, debug: (m:string,d?:any)=>void, info: (m:string,d?:any)=>void,
 *   warn: (m:string,d?:any)=>void, error: (m:string,d?:any)=>void, fatal: (m:string,d?:any)=>void,
 *   logError: (label:string, err:unknown, opts?:object)=>object,
 *   guard: <T>(label:string, fn:()=>T, opts?:object)=>T|undefined,
 *   check: (cond:boolean, message:string, opts?:object)=>boolean,
 *   assert: (cond:boolean, message:string, opts?:object)=>boolean,
 *   time: <T>(label:string, fn:()=>T)=>T,
 *   child: (sub:string)=>Object
 * }}
 */
export function logger(name) {
  const key = String(name || 'app');
  const hit = CACHE.get(key);
  if (hit) return hit;
  let built;
  try {
    built = build(key);
  } catch (_) {
    // Diagnostics is unreachable (extreme bootstrap ordering); keep the caller safe.
    built = nullLogger(key);
  }
  CACHE.set(key, built);
  return built;
}

/**
 * Compose one scoped logger over the shared diagnostics instance.
 * @param {string} name
 */
function build(name) {
  const diag = getDiagnostics();
  const child = diag.child(name);
  return {
    name,
    trace: child.trace,
    debug: child.debug,
    info: child.info,
    warn: child.warn,
    error: child.error,
    fatal: child.fatal,
    /** Record a caught error with its category/code preserved, prefixed by the module. */
    logError(label, err, opts = {}) {
      return diag.logError(`${name} · ${label}`, err, opts);
    },
    /** Contain a risky boundary: run fn, log any throw, return the fallback. */
    guard(label, fn, opts = {}) {
      return diag.guard(`${name} · ${label}`, fn, opts);
    },
    /** Report a broken soft-invariant as a warning without throwing. Returns the condition. */
    check(cond, message, opts = {}) {
      return diag.check(cond, `${name}: ${message}`, opts);
    },
    /** Report a broken hard-invariant as an error AND throw a typed DiagError. */
    assert(cond, message, opts = {}) {
      return diag.assert(cond, `${name}: ${message}`, opts);
    },
    /** Time fn and fold it into the slow-op log, namespaced to this module. */
    time(label, fn) {
      return diag.time(`${name}·${label}`, fn);
    },
    /** A nested scope, e.g. logger('ui').child('canvas').  */
    child(sub) {
      return logger(`${name}/${sub}`);
    },
  };
}

// Re-export the engine's vocabulary so a module needs a single import for logging:
// `import { logger, CATEGORIES, DiagError } from '../core/logging.js'`.
export {
  getDiagnostics,
  createDiagnostics,
  installDiagnostics,
  LEVELS,
  CATEGORIES,
  DiagError,
  serializeError,
  classifyError,
} from './diagnostics.js';
