/**
 * KNITCAT — self-contained micro sound layer (WebAudio, zero deps).
 *
 * Philosophy: sound should feel like a machine doing its work, never like a toy.
 * Everything is quiet (<0.14 gain), short (<0.4 s) and uses gentle sine/triangle
 * tones. The signature is the two-tone export chime Alex already likes.
 *
 * It talks to the app ONLY through a tiny custom-event bus so nothing needs to
 * import it:
 *     window.dispatchEvent(new CustomEvent('knit:fx', { detail: 'click' }))
 *
 * Types: click · place · tab · toggle · open · success · warn · error · erase
 * The 🔊/🔇 toggle is injected into the header; the on/off choice is persisted.
 * Audio is created lazily on the first real gesture to satisfy autoplay rules.
 */

// Storage key keeps the historic `knitcad.` prefix: renaming it would reset the
// mute preference for anyone already using the app.
const KEY = 'knitcad.sound.v1';

let enabled = true;
let ctx = null;
let master = null;
// The autoplay policy is absolute: creating OR resuming an AudioContext outside
// a genuine gesture handler logs "The AudioContext was not allowed to start".
// So the context is not even constructed until we have seen a real gesture.
let gestureSeen = false;
// resume() is asynchronous; calling it again while a previous attempt is still
// settling is what made Chrome log the autoplay warning over and over. One in
// flight at a time, ever.
let resumeInFlight = false;

function loadPref() {
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (_) { enabled = true; }
}
function savePref() {
  try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (_) { /* ignore */ }
}

function ensureCtx() {
  if (!gestureSeen || ctx || typeof window === 'undefined') return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  } catch (_) { ctx = null; }
  return ctx;
}

/**
 * Called ONLY from real gesture handlers (pointerdown / keydown / click).
 * Arms the context and performs the silent-play ritual iOS still needs.
 */
function unlock() {
  gestureSeen = true;
  const c = ensureCtx();
  if (!c) return;
  // Only ask for resume while suspended AND when no attempt is already settling, so a
  // burst of key/pointer events cannot each fire a rejected resume (the console spam).
  if (c.state === 'suspended' && !resumeInFlight) {
    resumeInFlight = true;
    const settle = () => { resumeInFlight = false; };
    try { Promise.resolve(c.resume()).then(settle, settle); } catch (_) { settle(); }
    try { c.addEventListener('statechange', settle, { once: true }); } catch (_) { /* older engines */ }
  }
  // The iOS silent-play ritual is harmless while suspended (it just queues), so keep
  // priming on every genuine gesture until the context reports running.
  if (c.state !== 'running') {
    try {
      const buf = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
    } catch (_) { /* older engines: nothing to prime */ }
  }
}

/** Play a single enveloped tone. */
function tone({ f = 440, type = 'sine', dur = 0.12, gain = 0.08, delay = 0, glideTo = null }) {
  const c = ensureCtx();
  // No context yet, or the browser still refuses to run it — stay silent.
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const SFX = {
  // one soft click as a stitch drops onto a needle
  click: () => tone({ f: 2000, type: 'triangle', dur: 0.03, gain: 0.03 }),
  place: () => { tone({ f: 660, dur: 0.05, gain: 0.05 }); tone({ f: 990, dur: 0.06, gain: 0.04, delay: 0.03 }); },
  erase: () => tone({ f: 320, glideTo: 160, type: 'triangle', dur: 0.08, gain: 0.04 }),
  // a tab sliding into place
  tab: () => { tone({ f: 520, dur: 0.05, gain: 0.045 }); tone({ f: 720, dur: 0.07, gain: 0.04, delay: 0.035 }); },
  toggle: () => tone({ f: 440, glideTo: 620, dur: 0.09, gain: 0.04, type: 'triangle' }),
  open: () => tone({ f: 300, glideTo: 500, dur: 0.12, gain: 0.035, type: 'sine' }),
  // the signature success chime Alex likes (two-tone, warm)
  success: () => { tone({ f: 880, dur: 0.16, gain: 0.06 }); tone({ f: 1320, dur: 0.28, gain: 0.055, delay: 0.08 }); },
  warn: () => { tone({ f: 440, dur: 0.1, gain: 0.05 }); tone({ f: 330, dur: 0.14, gain: 0.05, delay: 0.1 }); },
  error: () => tone({ f: 220, glideTo: 140, type: 'sawtooth', dur: 0.2, gain: 0.05 })
};

/** True once the AudioContext exists and is actually running. */
function isReady() {
  try { return !!ctx && ctx.state === 'running'; } catch (_) { return false; }
}

// resume() is asynchronous, so the gesture that armed the context cannot hear
// its own click. We park exactly one sound and release it on 'statechange'.
let pendingUnlock = null;

function play(type) {
  // Startup chimes fire long before any gesture; dropping them is the whole
  // point — touching the AudioContext then is what logged the console error.
  if (!enabled || !gestureSeen) return;
  const fn = SFX[type];
  if (!fn) return;
  try {
    if (isReady()) { fn(); return; }
    const c = ensureCtx();
    if (!c || pendingUnlock) return;
    pendingUnlock = fn;
    c.addEventListener('statechange', () => {
      const queued = pendingUnlock;
      pendingUnlock = null;
      if (c.state === 'running' && typeof queued === 'function') queued();
    }, { once: true });
  } catch (_) { /* audio unavailable — stay silent */ }
}

function injectToggle() {
  const brand = document.querySelector('.brand-section');
  if (!brand || brand.querySelector('#kx-sound')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.id = 'kx-sound';
  b.className = 'kx-hbtn';
  b.title = 'Sound on/off';
  b.setAttribute('aria-label', 'Toggle sound');
  const paint = () => { b.textContent = enabled ? '\uD83D\uDD0A' : '\uD83D\uDD07'; };
  paint();
  b.addEventListener('click', () => {
    enabled = !enabled; savePref(); paint(); unlock();
    if (enabled) play('toggle');
  });
  brand.appendChild(b);
}

/**
 * Boot the sound layer once. Idempotent, fully guarded by the caller.
 * @returns {{ play:Function, setEnabled:Function, isEnabled:Function }}
 */
export function initSound() {
  loadPref();
  injectToggle();
  // Any real interaction arms audio. Not `once` — the first resume() can still
  // be rejected (async), so we keep trying until the context reports running,
  // then detach entirely so we never touch audio (or the console) again.
  const arm = () => {
    if (isReady()) {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
      return;
    }
    unlock();
  };
  window.addEventListener('pointerdown', arm, { passive: true });
  window.addEventListener('keydown', arm);
  window.addEventListener('knit:fx', e => play(e && e.detail));
  // Tiny probe so other code (e.g. the love-popup chime retry) can tell when
  // audio is truly unlocked without importing this module.
  window.knitcatAudio = { isReady };
  return {
    play,
    isReady,
    setEnabled(v) { enabled = !!v; savePref(); const b = document.getElementById('kx-sound'); if (b) b.textContent = enabled ? '\uD83D\uDD0A' : '\uD83D\uDD07'; },
    isEnabled() { return enabled; }
  };
}

/** Fire-and-forget helper for callers that don't hold the module instance. */
export function fx(type) {
  try { window.dispatchEvent(new CustomEvent('knit:fx', { detail: type })); } catch (_) { /* ignore */ }
}
