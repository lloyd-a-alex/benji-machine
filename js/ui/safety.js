/**
 * KnitCAD safety layer — fully self-contained.
 *
 * Everything here degrades gracefully: if a guarded block throws, it logs a
 * friendly toast (if a notifier is available) and returns a fallback instead of
 * bringing the whole application down. Importing this module has zero side
 * effects until its functions are explicitly called.
 */

/**
 * Install a global error boundary: uncaught exceptions + unhandled rejections
 * surface as a toast rather than silently freezing the UI.
 * @param {{error?:function, warn?:function}} notifier NotificationCenter-like object
 */
export function installGlobalErrorBoundary(notifier) {
  let lastShown = 0;
  const report = (message, source) => {
    // Coalesce bursts so a rAF loop that throws every frame spams only once / 4s.
    const now = Date.now();
    if (now - lastShown < 4000) return;
    lastShown = now;
    try {
      if (notifier && typeof notifier.error === 'function') {
        notifier.error('Something went wrong in the background.', {
          details: [String(message), source].filter(Boolean),
          duration: 8000
        });
      }
    } catch (_) {
      /* never let error reporting itself throw */
    }
  };

  window.addEventListener('error', e => {
    const msg = e && e.message ? e.message : 'Unknown error';
    const where = e && e.filename ? `${e.filename.split('/').pop()}:${e.lineno || 0}` : '';
    console.error('[KnitCAD] Uncaught error:', msg, where, e && e.error);
    report(msg, where);
  });

  window.addEventListener('unhandledrejection', e => {
    const reason = e && e.reason ? e.reason : 'Unhandled promise rejection';
    console.error('[KnitCAD] Unhandled rejection:', reason);
    report(reason && reason.message ? reason.message : String(reason));
  });
}

/**
 * Guarded execution: run `fn`, and on error log + toast and return `fallback`.
 * Use this around non-critical, additive features so they can never break the app.
 */
export function runGuarded(label, fn, options = {}) {
  const { notifier = null, fallback = undefined, rethrow = false } = options;
  try {
    return fn();
  } catch (err) {
    console.error(`[KnitCAD] Guarded block "${label}" failed:`, err);
    if (notifier && typeof notifier.warn === 'function') {
      notifier.warn(`${label} could not run.`, { details: [String((err && err.message) || err)] });
    }
    if (rethrow) throw err;
    return fallback;
  }
}

/**
 * Wrap a callable (e.g. a tab render function) so runtime errors are contained.
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
    // Clamp radii so they can exceed half the side length.
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
