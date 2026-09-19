/**
 * Regression tests for the Benji love popup "i love u" button.
 *
 * History: the overlay is rendered *visible* in index.html, while the only code
 * that wired its close button lived in KnitApp._showLovePopup() — which is
 * skipped once localStorage says the letter was already read. Result: a
 * full-screen overlay with a dead button and no way out on every visit after
 * the first. The dismiss wiring therefore now lives in a boot-independent
 * inline script, and these tests run that real script against a stub DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function popupScript() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const markAt = html.indexOf('id="benji-love-popup"');
  assert.ok(markAt > -1, 'love popup markup must exist in index.html');
  const scriptTag = html.indexOf('<script>', markAt);
  assert.ok(scriptTag > -1, 'love popup must ship its own inline controller script');
  const bodyStart = html.indexOf('>', scriptTag) + 1;
  const bodyEnd = html.indexOf('</script>', bodyStart);
  return html.slice(bodyStart, bodyEnd);
}

function makeElement(id) {
  const classes = new Set();
  return {
    id,
    style: {},
    attrs: {},
    handlers: {},
    innerHTML: '',
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c)
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    closest(sel) { return sel === `#${this.id}` ? this : null; },
    fire(type, event = {}) {
      for (const fn of this.handlers[type] || []) fn(event);
    }
  };
}

/** Boots the real inline controller with just enough browser to run in. */
function boot({ seen = false } = {}) {
  const popup = makeElement('benji-love-popup');
  const btn = makeElement('love-popup-close');
  const rain = makeElement('love-hearts-rain');
  const store = new Map(seen ? [['knitcad.lovePopupSeen', '1']] : []);
  const doc = {
    getElementById: id => ({ 'benji-love-popup': popup, 'love-popup-close': btn, 'love-hearts-rain': rain })[id] || null,
    addEventListener(type, fn) { (this._h ||= {}), ((this._h[type] ||= []).push(fn)); },
    fire(type, event = {}) { for (const fn of (this._h || {})[type] || []) fn(event); }
  };
  const win = {};
  const sandbox = {
    window: win,
    document: doc,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v))
    },
    setTimeout: (fn, ms) => { sandbox._timers.push({ fn, ms }); return sandbox._timers.length; },
    _timers: []
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(popupScript(), sandbox);
  const flush = () => sandbox._timers.splice(0).forEach(t => t.fn());
  return { popup, btn, doc, win, store, flush, sandbox };
}

const evt = () => ({ preventDefault() {}, stopPropagation() {} });

test('the popup is rendered visible by default, so the controller is what gates it', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const markup = html.slice(html.indexOf('<div id="benji-love-popup"'), html.indexOf('love-popup-content'));
  assert.match(markup, /class="benji-love-popup"/, 'no hardcoded hidden class in markup');
});

test('first visit: the letter shows and the button is wired', () => {
  const { popup, btn } = boot();
  assert.equal(popup.classList.contains('hidden'), false, 'popup stays open on first visit');
  assert.ok(btn.handlers.click?.length, 'the i love u button must have a click handler');
});

test('tapping the i love u button closes the letter and remembers it', async () => {
  const { popup, btn, store, flush } = boot();
  btn.fire('click', evt());
  assert.equal(popup.classList.contains('hidden'), true, 'button press must hide the overlay');
  assert.equal(store.get('knitcad.lovePopupSeen'), '1', 'dismissing marks the letter as read');
  flush();
  assert.equal(popup.style.display, 'none', 'it also leaves the layout so the app is clickable');
});

test('backdrop tap and Escape both dismiss; tapping the card does not', () => {
  const { popup, doc } = boot();
  // A tap on the card itself must not close it.
  popup.fire('click', { target: { closest: () => null, classList: { contains: () => false } }, ...evt() });
  assert.equal(popup.classList.contains('hidden'), false, 'tapping the card keeps it open');
  popup.fire('click', { target: popup, ...evt() });
  assert.equal(popup.classList.contains('hidden'), true, 'tapping the backdrop closes it');

  const second = boot();
  second.doc.fire('keydown', { key: 'Escape', ...evt() });
  assert.equal(second.popup.classList.contains('hidden'), true, 'Escape closes it');
});

test('returning visit: a read letter never traps the visitor again', () => {
  const { popup, btn } = boot({ seen: true });
  assert.equal(popup.classList.contains('hidden'), true, 'already-read letter starts hidden');
  assert.equal(popup.style.display, 'none', 'and is out of the layout from the first paint');
  assert.ok(btn.handlers.click?.length, 'the button stays wired so it can be re-opened safely');
});

test('the exposed controller can re-open and close it again (command palette)', () => {
  const { popup, win } = boot({ seen: true });
  assert.equal(typeof win.knitcatLovePopup?.show, 'function', 'app layer reuses one source of truth');
  win.knitcatLovePopup.show();
  assert.equal(popup.classList.contains('hidden'), false, 'show() re-opens the letter');
  assert.equal(popup.style.display, 'flex', 'show() overrides the inline hide');
  assert.equal(win.knitcatLovePopup.isOpen(), true);
  assert.equal(win.knitcatLovePopup.hide(), true, 'hide() reports it actually closed');
  assert.equal(win.knitcatLovePopup.hide(), false, 'a second close is a no-op, not a fight');
});
