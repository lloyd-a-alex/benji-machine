/**
 * KNITCAT — Clip Shelf.
 *
 * One clipboard slot is not enough for a knitter, and `js/edit/clipboard.js` already
 * knows why: a chart is assembled from a *vocabulary* of motifs — this eyelet cross,
 * that rib corner, the border used on eleven shawls — and losing the last copy the
 * moment you copy another one means redrawing it. The engine for remembering them
 * (history, named slots that survive a reload, cross-window broadcast) exists and is
 * fully tested; it simply had no hands reaching it from the editor.
 *
 * This module is those hands. It is a *thin, additive* UI over `clipboard.js`:
 *
 *   - it captures a copy the instant the app's own Copy/Cut succeeds;
 *   - it pastes by driving the editor's EXISTING working paste path
 *     (`editor.clipboard = {rows, cols, cells}` then `editor.pasteClipboard()`), so no
 *     new paste arithmetic is introduced and the shelf can never disagree with the
 *     canvas;
 *   - it keeps named slots in `localStorage` through `clipboard.js` (which owns the
 *     storage key and its sanitising), so a reload brings the vocabulary back.
 *
 * Rules it lives by (mirroring {@link module:ui/console-panel} and
 * {@link module:ui/stitch-inspector}):
 *   - Importable with no DOM: every DOM touch happens inside {@link createClipShelf}
 *     or later, so the module-graph contract holds and the logic stays testable.
 *   - Never throws into boot: failures are contained and reported to diagnostics.
 *   - Non-spammy: capture de-duplicates back-to-back identical copies (Ctrl+C twice
 *     should not bury the history), and the panel only renders when opened.
 *
 * @module ui/clip-shelf
 */

import { createClipboard, entrySummary, labelForMode } from '../edit/clipboard.js';
import { getDiagnostics } from '../core/diagnostics.js';

const STYLE_ID = 'kx-clipshelf-style';
const PANEL_ID = 'kx-clipshelf';
const BUTTON_ID = 'kx-clipshelf-btn';

/**
 * Mount the Clip Shelf. Idempotent per document: a second call reuses the nodes.
 *
 * @param {object} deps
 * @param {() => any} deps.getEditor        Live CanvasEditor (has .clipboard and .pasteClipboard()).
 * @param {() => string} deps.getMode       Current pattern mode id (labels + entry mode).
 * @param {() => any} [deps.getProfile]     Current machine profile (records profileId on capture).
 * @param {{info?:Function, success?:Function, warn?:Function, error?:Function}} [deps.notifications]
 * @returns {{toggle:Function, open:Function, close:Function, isOpen:Function, capture:Function,
 *            pasteMostRecent:Function, render:Function, store:Object, destroy:Function, button:HTMLElement}}
 */
export function createClipShelf(deps = {}) {
  const getEditor = deps.getEditor || (() => null);
  const getMode = deps.getMode || (() => 'lace');
  const getProfile = deps.getProfile || (() => null);
  const notifier = deps.notifications || null;
  const diag = getDiagnostics().child('clips');

  injectStyles();

  // ── the engine (clipboard.js owns storage, history and slot sanitising) ──────
  const store = createClipboard({ storage: safeStorage() });

  // ── toggle button (header, beside the other tools) ───────────────────────────
  let button = document.getElementById(BUTTON_ID);
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = 'kx-hbtn';
    button.title = 'Clip shelf';
    button.setAttribute('aria-label', 'Open the clip shelf (copy history and named slots)');
    button.innerHTML = '<span class="kx-clip-btn-label" aria-hidden="true">\uD83D\uDCCB</span><span class="kx-clip-badge" data-badge hidden></span>';
    (document.querySelector('.brand-section') || document.body).appendChild(button);
  }

  // ── the drawer ───────────────────────────────────────────────────────────────
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'kx-clip';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Clip shelf');
    panel.hidden = true;
    panel.innerHTML = `
      <header class="kxc-bar">
        <div class="kxc-title"><span class="kxc-glyph" aria-hidden="true">\uD83D\uDCCB</span> Clip Shelf</div>
        <div class="kxc-stat" data-count></div>
        <div class="kxc-actions">
          <button class="kxc-act" data-act="copy-last" title="Copy the current selection into the shelf now">Capture</button>
          <button class="kxc-act" data-act="clear" title="Clear the copy history">Clear history</button>
          <button class="kxc-act kxc-close" data-act="close" title="Close" aria-label="Close clip shelf">\u2715</button>
        </div>
      </header>
      <div class="kxc-body">
        <section class="kxc-group">
          <h3 class="kxc-h3">Recent copies <span class="kxc-sub" data-hist-n></span></h3>
          <ul class="kxc-list" data-history></ul>
        </section>
        <section class="kxc-group">
          <h3 class="kxc-h3">Named slots <span class="kxc-sub">saved across reloads</span></h3>
          <ul class="kxc-list" data-slots></ul>
        </section>
      </div>
      <footer class="kxc-foot">
        <span>Paste uses the editor's own paste \u2014 it lands at your selection or hover.</span>
      </footer>`;
    document.body.appendChild(panel);
  }

  const el = {
    count: panel.querySelector('[data-count]'),
    history: panel.querySelector('[data-history]'),
    slots: panel.querySelector('[data-slots]'),
    histN: panel.querySelector('[data-hist-n]'),
    badge: button.querySelector('[data-badge]')
  };

  let isOpen = false;
  let lastSig = null; // de-dupe back-to-back identical captures

  // ── capture ──────────────────────────────────────────────────────────────────
  /**
   * Freeze the editor's current clipboard into the shelf history.
   *
   * Called right after the app's own Copy/Cut succeeds. No-op when the editor
   * clipboard is empty or byte-identical to the previous capture (so holding Ctrl+C
   * over the same marquee does not flood the shelf).
   * @returns {object|null} the created entry, or null when nothing was captured.
   */
  function capture() {
    try {
      const ed = getEditor();
      const clip = ed && ed.clipboard;
      if (!clip || !Array.isArray(clip.cells) || !clip.cells.length) return null;
      const sig = `${clip.rows}x${clip.cols}:${flatHash(clip.cells)}`;
      if (sig === lastSig) return null;
      const profile = getProfile();
      const entry = store.copy(clip.cells, {
        mode: getMode(),
        profileId: profile && (profile.id || profile.name) ? (profile.id || profile.name) : null,
        source: 'copy'
      });
      lastSig = sig;
      const sum = entrySummary(entry);
      diag.info(`Captured ${sum.short} (${entry.punched} punched, ${labelForMode(entry.mode)})`);
      updateBadge();
      if (isOpen) render();
      return entry;
    } catch (err) {
      diag.logError('Clip capture', err, { level: 'warn' });
      return null;
    }
  }

  // ── paste (drives the editor's existing, working paste path) ──────────────────
  /**
   * Land an entry on the card by handing it to the editor unchanged.
   *
   * The shelf never reimplements paste: it sets `editor.clipboard` to a fresh copy of
   * the entry's cells and calls `editor.pasteClipboard()`, exactly as a Ctrl+V would.
   * @param {object} entry A clipboard entry (from history or a slot).
   * @returns {boolean} whether the editor accepted the paste.
   */
  function paste(entry) {
    try {
      const ed = getEditor();
      if (!ed || typeof ed.pasteClipboard !== 'function') return false;
      if (!entry || !Array.isArray(entry.cells) || !entry.cells.length) {
        notifier?.warn?.('That clip is empty.');
        return false;
      }
      // Deep-copy so the shelf's stored entry is never aliased by the live matrix.
      const cells = entry.cells.map((row) => [...row]);
      ed.clipboard = { rows: cells.length, cols: cells[0].length, cells };
      const ok = ed.pasteClipboard();
      if (ok) {
        diag.info(`Pasted "${entry.name || entrySummary(entry).short}"`);
        notifier?.success?.(`Pasted ${entry.name || entrySummary(entry).label || 'clip'}.`);
      } else {
        notifier?.warn?.('Nothing to paste there.');
      }
      return Boolean(ok);
    } catch (err) {
      diag.logError('Clip paste', err);
      notifier?.error?.('Paste failed.');
      return false;
    }
  }

  /** Paste the most recent captured copy (the "paste previous" gesture). */
  function pasteMostRecent() {
    const entry = store.at(0) || store.slotNames().map((n) => store.loadSlot(n))[0] || null;
    return entry ? paste(entry) : (notifier?.info?.('The shelf is empty \u2014 copy something first.'), false);
  }

  /** Save the newest history entry into a named, persisted slot. */
  function saveSlot(name) {
    try {
      const entry = store.at(0);
      if (!entry) { notifier?.warn?.('Copy something before naming a slot.'); return false; }
      const res = store.saveSlot(name, entry);
      if (res.ok) {
        diag.info(`Saved slot "${res.name}" (${res.slots} total)`);
        notifier?.success?.(`Saved clip as "${res.name}".`);
        if (isOpen) render();
        return true;
      }
      notifier?.warn?.(res.error || 'Could not save that slot.');
      return false;
    } catch (err) {
      diag.logError('Clip slot save', err);
      return false;
    }
  }

  /** Prompt (inline, no modal library) then save the newest copy to a named slot. */
  function promptSaveSlot() {
    const entry = store.at(0);
    if (!entry) { notifier?.warn?.('Copy something before naming a slot.'); return; }
    const name = windowSafe('prompt')?.(`Name this clip (${entry.rows}\u00D7${entry.cols}):`, entry.name || '');
    if (name != null && String(name).trim()) saveSlot(String(name).trim());
  }

  // ── render ─────────────────────────────────────────────────────────────────────
  function render() {
    renderHistory();
    renderSlots();
    el.count.textContent = `${store.entries.length} in history · ${store.slotNames().length} slots`;
  }

  function renderHistory() {
    el.history.textContent = '';
    el.histN.textContent = store.entries.length ? `(${store.entries.length})` : '';
    if (!store.entries.length) {
      el.history.appendChild(emptyRow('No copies yet. Select a motif and press Ctrl+C.'));
      return;
    }
    store.entries.slice(0, 24).forEach((entry, i) => {
      el.history.appendChild(clipRow(entry, i === 0 ? 'most recent' : '', { save: true, remove: true }));
    });
  }

  function renderSlots() {
    el.slots.textContent = '';
    const names = store.slotNames();
    if (!names.length) {
      el.slots.appendChild(emptyRow('Named clips survive a reload. Capture one, then \u2605 it.'));
      return;
    }
    for (const name of names) el.slots.appendChild(clipRow(store.loadSlot(name), name, { save: false, remove: true, isSlot: true, slotName: name }));
  }

  function clipRow(entry, kicker, opts) {
    const sum = entrySummary(entry);
    const li = document.createElement('li');
    li.className = 'kxc-item';
    const info = document.createElement('div');
    info.className = 'kxc-item-info';
    const title = document.createElement('span');
    title.className = 'kxc-item-name';
    title.textContent = entry.name || sum.short || 'clip';
    info.appendChild(title);
    const meta = document.createElement('span');
    meta.className = 'kxc-item-meta';
    meta.textContent = [
      `${entry.rows}\u00D7${entry.cols}`,
      `${entry.punched} punched`,
      labelForMode(entry.mode),
      kicker
    ].filter(Boolean).join(' · ');
    info.appendChild(meta);
    li.appendChild(info);

    const btns = document.createElement('div');
    btns.className = 'kxc-item-actions';
    btns.appendChild(actionBtn('paste', 'Paste onto the card', '\u25B6', () => paste(entry)));
    if (opts && opts.save) btns.appendChild(actionBtn('save', 'Save to a named slot', '\u2605', () => saveNamed(entry)));
    if (opts && opts.remove) {
      if (opts.isSlot) btns.appendChild(actionBtn('delete', 'Delete this slot', '\uD83D\uDDD1', () => { store.deleteSlot(opts.slotName); render(); }));
      else btns.appendChild(actionBtn('delete', 'Remove from history', '\u2715', () => { store.remove(entry.id); render(); }));
    }
    li.appendChild(btns);
    return li;
  }

  /** Save a specific history entry to a named slot (name via prompt). */
  function saveNamed(entry) {
    const name = windowSafe('prompt')?.(`Name this clip (${entry.rows}\u00D7${entry.cols}):`, entry.name || '');
    if (name != null && String(name).trim()) {
      const res = store.saveSlot(String(name).trim(), entry);
      if (res.ok) { notifier?.success?.(`Saved "${res.name}".`); render(); }
      else notifier?.warn?.(res.error || 'Could not save.');
    }
  }

  function emptyRow(text) {
    const li = document.createElement('li');
    li.className = 'kxc-empty';
    li.textContent = text;
    return li;
  }

  function actionBtn(kind, title, glyph, handler) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `kxc-ib kxc-ib--${kind}`;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.textContent = glyph;
    b.addEventListener('click', () => runQuiet(handler));
    return b;
  }

  // ── open / close ────────────────────────────────────────────────────────────────
  function open() {
    isOpen = true;
    panel.hidden = false;
    button.classList.add('is-on');
    render();
  }
  function close() {
    isOpen = false;
    panel.hidden = true;
    button.classList.remove('is-on');
  }
  function toggle() { isOpen ? close() : open(); }

  function updateBadge() {
    const n = store.entries.length;
    if (el.badge) {
      el.badge.hidden = isOpen || n === 0;
      el.badge.textContent = n > 99 ? '99+' : String(n);
    }
  }

  // ── wiring ──────────────────────────────────────────────────────────────────────
  button.addEventListener('click', () => runQuiet(toggle));
  panel.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    runQuiet(() => {
      const kind = act.dataset.act;
      if (kind === 'close') close();
      else if (kind === 'copy-last') capture();
      else if (kind === 'clear') { store.clear(); lastSig = null; render(); updateBadge(); }
    });
  });

  updateBadge();
  diag.info(`Shelf ready (${store.entries.length} history, ${store.slotNames().length} slots)`);

  return { toggle, open, close, capture, paste, pasteMostRecent, saveSlot, promptSaveSlot, render, isOpen: () => isOpen, store, button,
    destroy() { panel.remove(); button.remove(); } };
}

/* ── module-private helpers (all DOM/browser access is guarded) ───────────────── */

/** Run a shelf action without ever letting a throw escape into the caller. */
function runQuiet(fn) {
  try { return fn(); } catch (err) { try { getDiagnostics().child('clips').logError('Clip shelf action', err); } catch (_) { /* ignore */ } return null; }
}

/** localStorage can throw on access in some privacy modes; fall back to null. */
function safeStorage() {
  try { return (typeof globalThis !== 'undefined' && globalThis.localStorage) ? globalThis.localStorage : null; } catch (_) { return null; }
}

/** Access a global browser function only when it exists (never at import time). */
function windowSafe(name) {
  return (typeof globalThis !== 'undefined' && typeof globalThis[name] === 'function') ? globalThis[name].bind(globalThis) : null;
}

/** A cheap, order-sensitive content hash of a cell matrix, for de-duping captures. */
function flatHash(cells) {
  let h = 2166136261;
  for (const row of cells) {
    for (const v of row) {
      const s = String(v);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    }
  }
  return (h >>> 0).toString(36);
}

let stylesInjected = false;
/** Inject the shelf stylesheet once. Additive; unstyled-but-working beats throwing. */
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) { stylesInjected = true; return; }
  const css = `
  #kx-clipshelf-btn{position:relative}
  #kx-clipshelf-btn .kx-clip-badge{position:absolute;top:-2px;right:-2px;min-width:16px;height:16px;
    padding:0 3px;border-radius:9px;background:var(--accent,#f7b955);color:#14161d;font-size:10px;
    font-weight:700;line-height:16px;text-align:center;pointer-events:none}
  #kx-clipshelf-btn.is-on{background:rgba(247,185,85,.16)}
  #kx-clipshelf{position:fixed;right:14px;bottom:14px;z-index:9000;width:min(360px,92vw);
    max-height:min(70vh,560px);display:flex;flex-direction:column;
    background:rgba(18,22,31,.96);backdrop-filter:blur(8px);color:#e7ecf3;
    border:1px solid var(--border-subtle,#2b3242);border-radius:14px;overflow:hidden;
    box-shadow:0 18px 48px rgba(0,0,0,.42);
    font:13px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  #kx-clipshelf .kxc-bar{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #262c3a}
  #kx-clipshelf .kxc-title{font-weight:700;display:flex;align-items:center;gap:7px}
  #kx-clipshelf .kxc-glyph{opacity:.85}
  #kx-clipshelf .kxc-stat{margin-left:auto;font-size:11px;color:#8a93a6;white-space:nowrap}
  #kx-clipshelf .kxc-actions{display:flex;gap:6px}
  #kx-clipshelf .kxc-act{background:#182032;border:1px solid #26314a;color:#aebfe0;border-radius:7px;
    padding:3px 9px;font-size:11.5px;cursor:pointer}
  #kx-clipshelf .kxc-act:hover{background:#1e293f}
  #kx-clipshelf .kxc-close{border-color:#3a2630;color:#e7a4ae}
  #kx-clipshelf .kxc-body{overflow-y:auto;padding:6px 10px 4px}
  #kx-clipshelf .kxc-group{margin:8px 0 12px}
  #kx-clipshelf .kxc-h3{margin:4px 2px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#7f8aa1;font-weight:600}
  #kx-clipshelf .kxc-sub{text-transform:none;letter-spacing:0;color:#5f6a80;font-weight:400}
  #kx-clipshelf .kxc-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
  #kx-clipshelf .kxc-item{display:flex;align-items:center;gap:8px;background:#141a28;border:1px solid #222a3b;
    border-radius:10px;padding:7px 9px}
  #kx-clipshelf .kxc-item-info{min-width:0;flex:1 1 auto;display:flex;flex-direction:column}
  #kx-clipshelf .kxc-item-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #kx-clipshelf .kxc-item-meta{font-size:11px;color:#8a93a6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #kx-clipshelf .kxc-item-actions{display:flex;gap:4px;flex:0 0 auto}
  #kx-clipshelf .kxc-ib{width:26px;height:26px;border-radius:7px;border:1px solid #2a3448;background:#182032;
    color:#cdd8ee;cursor:pointer;font-size:12px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
  #kx-clipshelf .kxc-ib:hover{transform:translateY(-1px)}
  #kx-clipshelf .kxc-ib--paste{color:#8ff0b3;border-color:#265a3a}
  #kx-clipshelf .kxc-ib--save{color:#f5d68a;border-color:#5a4a26}
  #kx-clipshelf .kxc-ib--delete{color:#e7a4ae;border-color:#5a2630}
  #kx-clipshelf .kxc-empty{color:#6b7688;font-size:12px;padding:6px 4px;font-style:italic}
  #kx-clipshelf .kxc-foot{padding:7px 12px;border-top:1px solid #262c3a;font-size:10.5px;color:#6b7688}
  @media (max-width:520px){ #kx-clipshelf{right:8px;left:8px;width:auto} }
  `;
  try {
    const style = document.createElement('style');
    style.id = STYLE_ID; style.textContent = css;
    document.head.appendChild(style);
    stylesInjected = true;
  } catch (_) { stylesInjected = true; }
}
