/**
 * KNITCAT — shared keyboard interaction for the shell's composite widgets.
 *
 * The unified shell (js/ui/chrome.js) owns three `role="tablist"` strips — the
 * sub-tab strip, the inspector tabs and the pattern-shelf family chips — plus a
 * `role="menu"` overflow. Every one of them is a roving-tabindex widget: Tab
 * enters the group once (only the active item is in the tab order) and then the
 * arrow keys walk it, with Home/End jumping to the ends. That exact pattern was
 * previously hand-rolled inline in app.js (legacy tab bar), presets-browser.js
 * and menubar.js. This module is the single canonical home for it so the shell
 * can't drift into doing it three slightly-different ways.
 *
 * Two layers, deliberately:
 *   • pure index maths (nextRovingIndex) — DOM-free, exhaustively unit-testable;
 *   • thin DOM glue (attachRovingTablist / attachMenuNavigation) that reads the
 *     focused element off the event target, so it never touches a global
 *     `document` and stays safe to import on the server / under a test stub.
 *
 * DOM-free at import. @module ui/keyboard-nav
 */

// The keys a roving widget owns. Anything else falls through to the browser.
const ROVING_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

/**
 * Given the number of items, the current index and a key press, return the index
 * that should take focus — or null when the key is not a navigation key. Horizontal
 * tablists use Left/Right; vertical menus use Up/Down; both also accept the other
 * axis so a widget works whichever way it is laid out. Movement wraps (the tab
 * convention) and Home/End jump to the ends.
 * @param {number} count number of items (> 0)
 * @param {number} current index of the focused item (may be out of range; clamped)
 * @param {string} key the KeyboardEvent.key
 * @returns {number|null} the next index, or null if the key is not handled
 */
export function nextRovingIndex(count, current, key) {
  if (!ROVING_KEYS.has(key)) return null;
  const n = Number.isFinite(count) ? Math.trunc(count) : 0;
  if (n <= 0) return null;
  const i = Number.isInteger(current) && current >= 0 && current < n ? current : 0;
  const wrap = (x) => (x + n) % n;
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': return wrap(i + 1);
    case 'ArrowLeft': case 'ArrowUp': return wrap(i - 1);
    case 'Home': return 0;
    case 'End': return n - 1;
    default: return null;
  }
}

/**
 * Bring one item's tab order + selection in line with a roving tablist: the
 * active item is tabbable (tabIndex 0) and `aria-selected="true"`; every other
 * item drops out of the tab order (tabIndex -1) and `aria-selected="false"`.
 * Tolerates elements missing any of those members (never throws).
 * @param {Array<{setAttribute:Function}>} tabs
 * @param {number} activeIndex
 */
export function syncRovingSelection(tabs, activeIndex) {
  if (!Array.isArray(tabs)) return;
  tabs.forEach((tab, i) => {
    if (!tab || typeof tab.setAttribute !== 'function') return;
    const on = i === activeIndex;
    try { tab.tabIndex = on ? 0 : -1; } catch (_) { /* frozen node: attributes still matter */ }
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

// Resolve the item list either from an explicit array or by querying the live
// container. Querying live means a container whose children are re-rendered
// (the sub-tab strip rebuilds on every surface change) keeps working with a
// listener that was attached only once.
function readTabs(container, tabs, selector) {
  if (Array.isArray(tabs) && tabs.length) return tabs;
  if (typeof tabs === 'function') return tabs();
  if (container && typeof container.querySelectorAll === 'function') {
    return Array.prototype.slice.call(container.querySelectorAll(selector));
  }
  return [];
}

/**
 * Make a `role="tablist"` container fully keyboard-operable: arrow keys / Home /
 * End move the active tab (focusing it and running onActivate), and the tab
 * order stays roving. `onActivate` is the single source of truth for what
 * "select this tab" means, so callers never re-implement the movement maths.
 * @param {Element} container the element to receive the delegated keydown
 * @param {object} [opts]
 * @param {Array|Function} [opts.tabs] live list, array, or getter (else query selector)
 * @param {string} [opts.selector='[role="tab"]'] used when no tabs are supplied
 * @param {(index:number, tab:Element)=>void} [opts.onActivate] called on keyboard select
 * @returns {() => void} a detach function
 */
export function attachRovingTablist(container, opts = {}) {
  const { tabs = null, selector = '[role="tab"]', onActivate } = opts;
  if (!container || typeof container.addEventListener !== 'function') return () => {};

  const handler = (e) => {
    if (!ROVING_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const list = readTabs(container, tabs, selector);
    const idx = list.indexOf(e.target);
    if (idx < 0) return;                       // focus was not on an item
    const next = nextRovingIndex(list.length, idx, e.key);
    if (next == null || next === idx) return;
    e.preventDefault();
    const target = list[next];
    syncRovingSelection(list, next);
    if (typeof target.focus === 'function') target.focus();
    if (typeof onActivate === 'function') onActivate(next, target);
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

/**
 * Vertical arrow navigation for a `role="menu"` popup: Up/Down move focus between
 * items, Home/End jump to the ends. Unlike a tablist a menu does not wrap and does
 * not activate on focus (arrowing past an item must not fire its command), so this
 * only moves focus. Escape/Enter/Tab are left to the caller.
 * @param {Element} menu the menu element (receives the delegated keydown)
 * @param {object} [opts]
 * @param {string} [opts.itemSelector='[role="menuitem"]']
 * @returns {() => void} a detach function
 */
export function attachMenuNavigation(menu, opts = {}) {
  const { itemSelector = '[role="menuitem"]' } = opts;
  if (!menu || typeof menu.addEventListener !== 'function') return () => {};

  const items = () => readTabs(menu, null, itemSelector);
  const handler = (e) => {
    const k = e.key;
    if (k !== 'ArrowDown' && k !== 'ArrowUp' && k !== 'Home' && k !== 'End') return;
    const list = items();
    if (!list.length) return;
    const idx = list.indexOf(e.target);
    let next;
    if (k === 'Home') next = 0;
    else if (k === 'End') next = list.length - 1;
    else if (k === 'ArrowDown') next = Math.min(list.length - 1, idx + 1);
    else next = Math.max(0, idx <= 0 ? 0 : idx - 1);
    e.preventDefault();
    const target = list[next];
    if (target && typeof target.focus === 'function') target.focus();
  };
  menu.addEventListener('keydown', handler);
  return () => menu.removeEventListener('keydown', handler);
}
