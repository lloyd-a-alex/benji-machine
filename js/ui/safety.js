/**
 * KNITCAT safety layer — the app-facing wrapper over the diagnostics core.
 *
 * Everything here degrades gracefully: if a guarded block throws, it is recorded by
 * {@link module:core/diagnostics}, a friendly toast is shown (if a notifier is
 * available) and a fallback is returned instead of bringing the whole application
 * down. Importing this module has zero side effects until its functions are
 * explicitly called, so it stays importable in a headless (no-DOM) test runner.
 *
 * @module ui/safety
 */

import { getDiagnostics, serializeError, LEVELS } from '../core/diagnostics.js';

/**
 * Install the global error boundary: uncaught exceptions, unhandled rejections and
 * resource-load failures all funnel into the diagnostics ring buffer and surface as
 * a single, calm toast rather than silently freezing the UI. Backed by
 * {@link module:core/diagnostics}'s capture net, so anything logged through
 * `console.warn/error` anywhere in the app is recorded too.
 *
 * @param {{error?:function, warn?:function}} notifier NotificationCenter-like object.
 * @returns {Object} the diagnostics instance (also exposed as `window.KNITCAT_DIAG`).
 */
export function installGlobalErrorBoundary(notifier) {
  const diag = getDiagnostics();
  let lastShown = 0;

  // Bridge high-severity records (from the capture net) to a calm toast, coalescing
  // bursts so a rAF loop that throws every frame spams only once / 4s.
  const show = (record) => {
    try {
      const now = Date.now();
      if (now - lastShown < 4000) return;
      lastShown = now;
      if (notifier && typeof notifier.error === 'function') {
        // The headline stays calm and says the important part: nothing is lost.
        // The raw exception belongs in `details` (and the console), not in front
        // of someone who just wants to keep designing.
        notifier.error('Something went wrong in the background — your card is safe.', {
          details: [record.message, record.error && (record.error.code || record.error.stack)].filter(Boolean),
          duration: 8000
        });
      }
    } catch (_) {
      /* never let error reporting itself throw */
    }
  };

  return diag.installGlobal({ onError: show });
}

/**
 * Guarded execution: run `fn`, and on error classify + record it, toast, and return
 * `fallback`. Use this around non-critical, additive features so they can never
 * break the app. Delegates containment to {@link module:core/diagnostics}.
 *
 * @template T
 * @param {string} label          Human name for the guarded block.
 * @param {() => T} fn            The code to run.
 * @param {object}  [options]
 * @param {{warn?:function}} [options.notifier]  NotificationCenter-like toast sink.
 * @param {T}       [options.fallback]  Value returned if `fn` throws.
 * @param {boolean} [options.rethrow]   Re-throw after logging (default false).
 * @param {boolean} [options.announce]  Also log a one-line success with timing
 *   (used for the boot timeline so each subsystem visibly reports that it came up).
 * @returns {T|undefined} `fn`'s result, or `fallback` on failure.
 */
export function runGuarded(label, fn, options = {}) {
  const { notifier = null, fallback = undefined, rethrow = false, announce = false } = options;
  const diag = getDiagnostics();
  const t0 = nowMs();
  try {
    const out = fn();
    if (announce) {
      const ms = Math.round(nowMs() - t0);
      diag.info(`${label} \u2713`, { subsystem: label, ms, ok: true });
    }
    return out;
  } catch (err) {
    const s = serializeError(err);
    diag.logError(`Guarded block "${label}"`, err, { level: LEVELS.ERROR, context: { subsystem: label, failed: true } });
    if (notifier && typeof notifier.warn === 'function') {
      notifier.warn(`${label} could not run.`, { details: [s.code || s.message] });
    }
    if (rethrow) throw err;
    return fallback;
  }
}

/** A monotonic-ish millisecond clock that never throws (perf if present). @returns {number} */
function nowMs() {
  try { if (typeof performance !== 'undefined' && performance.now) return performance.now(); } catch (_) { /* ignore */ }
  return Date.now();
}

/**
 * Wrap a callable (e.g. a tab render function) so runtime errors are contained and
 * recorded instead of propagating to the caller's frame.
 *
 * @param {string} label   Name used in the guard/log line.
 * @param {Function} fn    The function to wrap.
 * @param {{warn?:function}} [notifier] Optional toast sink for the failure.
 * @returns {Function} a same-arity wrapper returning `undefined` on failure.
 */
export function guardMethod(label, fn, notifier) {
  return function wrapped(...args) {
    return runGuarded(label, () => fn.apply(this, args), { notifier });
  };
}

/**
 * Polyfill CanvasRenderingContext2D.roundRect for older Safari (< 16.4).
 * Idempotent; safe to call before any canvas work. Returns true if installed now.
 */
export function installRoundRectPolyfill() {
  if (typeof CanvasRenderingContext2D === 'undefined') return false;
  if (typeof CanvasRenderingContext2D.prototype.roundRect === 'function') return false;

  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
    let r = Array.isArray(radii) ? radii.slice(0, 4) : [radii, radii, radii, radii];
    r = r.map(v => (typeof v === 'number' && !Number.isNaN(v) ? Math.max(0, v) : 0));
    while (r.length < 4) r.push(0);
    const [tl, tr, br, bl] = r;
    // Clamp radii so they can never exceed half the shorter side, which would
    // otherwise make arcTo() carve self-intersecting corners.
    const max = Math.min(w, h) / 2;
    const s = v => Math.min(Math.abs(v), max);
    const [a, b, c, d] = [s(tl), s(tr), s(br), s(bl)];
    this.beginPath();
    this.moveTo(x + a, y);
    this.lineTo(x + w - b, y);
    if (b) this.arcTo(x + w, y, x + w, y + b, b);
    this.lineTo(x + w, y + h - c);
    if (c) this.arcTo(x + w, y + h, x + w - c, y + h, c);
    this.lineTo(x + d, y + h);
    if (d) this.arcTo(x, y + h, x, y + h - d, d);
    this.lineTo(x, y + a);
    if (a) this.arcTo(x, y, x + a, y, a);
    this.closePath();
    return this;
  };
  return true;
}
