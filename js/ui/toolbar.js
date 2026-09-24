/**
 * KNITCAT — left tool palette controller (accessible submenus).
 *
 * The palette in index.html is a stack of `.tool-submenu` sections (Draw, Shapes,
 * Transform, History, View). Each section header is a real <button> carrying
 * `aria-expanded`, and its body holds the icon tool buttons. This module only
 * controls which sections are open — every button keeps its own id / [data-tool],
 * so the canvas-editor wiring is completely untouched.
 *
 * Design goals, in priority order:
 *   1. Never hide a tool the user is using. When any `.tool-btn` becomes `.active`
 *      (a click, a keyboard shortcut, or `app.setTool`), its section auto-opens.
 *   2. Remember the open/closed layout between sessions (localStorage).
 *   3. Work on touch, mouse and keyboard with no button overload: sections collapse
 *      to a compact labelled rail; only what you need is expanded.
 *
 * Fully contained: called through runGuarded() at boot, so a failure here can never
 * take the editor down — the buttons just stay all-open (the CSS default).
 */

import { logger } from '../core/logging.js';

const log = logger('ui/toolbar');

const STORE_KEY = 'knitcad.toolbar.open.v1';

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    log.warn('the saved toolbar layout was corrupt — falling back to the default open state', { error: err?.message });
    return null;
  }
}

function writeStore(map) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch (err) {
    /* private mode / quota — the layout simply won't persist, which is fine */
    log.debug('the toolbar layout could not be persisted (private mode or quota)', { error: err?.message });
  }
}

/**
 * Wire up the palette. Idempotent: calling it twice returns the same controller.
 * @param {{ storage?: boolean }} [opts]
 * @returns {{ refresh: () => void, openSubmenu: (name:string)=>void, collapseAll: ()=>void } | null}
 */
export function initToolbar(opts = {}) {
  const aside = document.getElementById('left-toolbar');
  if (!aside) return null;
  if (aside.__knitcatToolbar) return aside.__knitcatToolbar;

  const sections = Array.from(aside.querySelectorAll('.tool-submenu'));
  if (!sections.length) return null;
  const useStore = opts.storage !== false;
  const store = (useStore && readStore()) || {};

  const headerOf = sec => sec.querySelector('.tool-submenu-btn');

  function setOpen(sec, open, persist = true) {
    const btn = headerOf(sec);
    if (!btn) return;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    sec.classList.toggle('is-open', open);
    if (persist && useStore) {
      store[sec.dataset.submenu || sec.dataset.name] = open;
      writeStore(store);
    }
  }

  const isOpen = sec => headerOf(sec)?.getAttribute('aria-expanded') === 'true';

  // Apply persisted layout (falling back to the aria-expanded set in the HTML).
  sections.forEach(sec => {
    const key = sec.dataset.submenu || sec.dataset.name;
    if (Object.prototype.hasOwnProperty.call(store, key)) setOpen(sec, !!store[key], false);
    else setOpen(sec, isOpen(sec), false);
  });

  // Click a header → toggle. Native <button> already handles Enter/Space.
  sections.forEach(sec => {
    const btn = headerOf(sec);
    if (btn) btn.addEventListener('click', () => setOpen(sec, !isOpen(sec)));
  });

  function sectionForTool(node) {
    return node ? node.closest('.tool-submenu') : null;
  }

  /** Open the section that owns a given tool id/name, if any. */
  function openSubmenu(name) {
    const sec = sections.find(s => (s.dataset.submenu || s.dataset.name) === name);
    if (sec) setOpen(sec, true);
    return !!sec;
  }

  function collapseAll() {
    sections.forEach(s => setOpen(s, false));
  }

  // Keep the active tool visible: whatever makes a .tool-btn.active also opens its
  // section. A MutationObserver catches clicks, shortcuts and programmatic
  // setTool() alike, with no coupling to the callers.
  function syncActive() {
    const active = aside.querySelector('.tool-btn.active');
    const sec = sectionForTool(active);
    if (sec && !isOpen(sec)) setOpen(sec, true);
  }

  const observer =
    typeof MutationObserver !== 'undefined'
      ? new MutationObserver(muts => {
          for (const m of muts) {
            if (m.type === 'attributes' && m.attributeName === 'class') {
              const el = m.target;
              if (el.classList && el.classList.contains('active')) {
                const sec = sectionForTool(el);
                if (sec && !isOpen(sec)) setOpen(sec, true);
              }
            }
          }
        })
      : null;
  if (observer) {
    sections.forEach(sec => {
      sec.querySelectorAll('.tool-btn').forEach(b => observer.observe(b, { attributes: true, attributeFilter: ['class'] }));
    });
  }

  syncActive();

  const controller = { refresh: syncActive, openSubmenu, collapseAll };
  aside.__knitcatToolbar = controller;
  return controller;
}
