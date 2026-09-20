/**
 * KNITCAT — the in-app Console.
 *
 * A real console, not a `console.log` dump. It is a thin, self-contained UI over the
 * diagnostics core ({@link module:core/diagnostics}): it subscribes to the live
 * record stream and renders a filterable, searchable, de-duplicated log with a boot
 * timeline and a "Systems" view that proves every subsystem is actually alive.
 *
 * Why in-app: the browser devtools console on a knitting CAD is a firehose of
 * third-party noise (autoplay warnings, manifest enctype notices …). This panel shows
 * only what KNITCAT knows about itself — clean, structured, and genuinely useful —
 * and it is available to someone who has never opened devtools.
 *
 * Rules it lives by:
 *   - Importable with no DOM (module-graph contract): every DOM touch happens inside
 *     `createConsolePanel()` or later. Top-level scope declares only constants.
 *   - Never throws: if any render step fails it is contained, so a broken console can
 *     never take down the app it is watching.
 *   - Non-spammy by construction: duplicates already collapse in the core; here rows
 *     show an ×N badge and per-level filtering keeps the default view calm.
 *
 * @module ui/console-panel
 */

import { LEVELS } from '../core/diagnostics.js';

/** Level display order (dimmest → most urgent) and their accent colours. */
const LEVEL_ORDER = [LEVELS.TRACE, LEVELS.DEBUG, LEVELS.INFO, LEVELS.WARN, LEVELS.ERROR, LEVELS.FATAL];
const LEVEL_COLOR = {
  trace: '#8a8f98', debug: '#6ea8fe', info: '#57c785', warn: '#f0b429', error: '#f2555a', fatal: '#ff3860'
};
/** Level ranks considered "interesting" for the default filter and the badge dot. */
const ATTENTION = new Set([LEVELS.WARN, LEVELS.ERROR, LEVELS.FATAL]);

const STYLE_ID = 'kx-console-style';
const OPEN_KEYS = [
  // Ctrl/Cmd + backtick — the classic "toggle console" chord, unlikely to collide.
  (e) => (e.ctrlKey || e.metaKey) && (e.key === '`' || e.key === '~')
];

/**
 * Boot the console UI. Idempotent: calling it twice returns the same handle.
 *
 * @param {object} deps
 * @param {import('../core/diagnostics.js').Diagnostics} deps.diagnostics  The core to read.
 * @param {{info?:Function, success?:Function}} [deps.notifications]       Optional toast sink for copy/export.
 * @returns {{toggle:Function, open:Function, close:Function, isOpen:Function, destroy:Function, button:HTMLElement}}
 */
export function createConsolePanel(deps) {
  const diag = deps && deps.diagnostics;
  const notifier = (deps && deps.notifications) || null;
  if (!diag) throw new Error('console-panel: a diagnostics instance is required');

  // ── live state ──────────────────────────────────────────────────────────────
  const activeLevels = new Set([LEVELS.INFO, LEVELS.WARN, LEVELS.ERROR, LEVELS.FATAL]);
  let query = '';
  let autoscroll = true;
  let view = 'log'; // 'log' | 'systems'
  let dirty = false;
  let rafId = 0;
  const MAX_ROWS = 600;

  // ── inject styles once ──────────────────────────────────────────────────────
  injectStyles();

  // ── floating toggle button ──────────────────────────────────────────────────
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'kx-console-btn';
  button.className = 'kx-hbtn';
  button.title = 'Console (Ctrl+`)';
  button.setAttribute('aria-label', 'Toggle the KNITCAT console');
  button.innerHTML = '<span class="kx-console-btn-label">&gt;_</span><span class="kx-console-dot" hidden></span>';

  // ── the panel ────────────────────────────────────────────────────────────────
  const panel = document.createElement('section');
  panel.id = 'kx-console';
  panel.setAttribute('role', 'log');
  panel.setAttribute('aria-live', 'polite');
  panel.hidden = true;
  panel.innerHTML = `
    <header class="kxc-bar">
      <div class="kxc-title"><span class="kxc-glyph">&gt;_</span> KNITCAT Console</div>
      <div class="kxc-tabs" role="tablist">
        <button class="kxc-tab is-active" data-view="log" role="tab">Log</button>
        <button class="kxc-tab" data-view="systems" role="tab">Systems</button>
      </div>
      <div class="kxc-stats" data-stats></div>
      <div class="kxc-actions">
        <label class="kxc-auto"><input type="checkbox" data-auto checked> Follow</label>
        <button class="kxc-act" data-act="copy" title="Copy the visible log">Copy</button>
        <button class="kxc-act" data-act="export" title="Download the full session as JSON">Export</button>
        <button class="kxc-act" data-act="clear" title="Clear the buffer">Clear</button>
        <button class="kxc-act kxc-close" data-act="close" title="Close (Ctrl+\`)" aria-label="Close console">✕</button>
      </div>
    </header>
    <div class="kxc-filter">
      <div class="kxc-levels" data-levels></div>
      <input class="kxc-search" type="search" data-search placeholder="filter messages… (type, #category, e.g. #compiler)">
      <span class="kxc-match" data-match></span>
    </div>
    <div class="kxc-body">
      <div class="kxc-log" data-log></div>
      <div class="kxc-systems" data-systems hidden></div>
    </div>
    <footer class="kxc-foot"><span data-foot-env></span></footer>
  `;

  // Put the toggle beside the other header controls (sound, theme, about); fall
  // back to the body if the header has not rendered yet.
  const host = (document.querySelector('.brand-section')) || document.body;
  host.appendChild(button);
  document.body.appendChild(panel);

  const el = {
    log: panel.querySelector('[data-log]'),
    systems: panel.querySelector('[data-systems]'),
    stats: panel.querySelector('[data-stats]'),
    levels: panel.querySelector('[data-levels]'),
    search: panel.querySelector('[data-search]'),
    match: panel.querySelector('[data-match]'),
    auto: panel.querySelector('[data-auto]'),
    footEnv: panel.querySelector('[data-foot-env]')
  };

  // ── level filter chips ───────────────────────────────────────────────────────
  for (const lvl of LEVEL_ORDER) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'kxc-lvl' + (activeLevels.has(lvl) ? ' is-on' : '');
    chip.style.setProperty('--kxc-lvl', LEVEL_COLOR[lvl]);
    chip.dataset.level = lvl;
    chip.textContent = lvl;
    chip.setAttribute('aria-pressed', String(activeLevels.has(lvl)));
    el.levels.appendChild(chip);
  }

  // ── helpers ───────────────────────────────────────────────────────────────────
  const rel = (ms) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s`);

  function markDirty() {
    if (dirty || panel.hidden) return;
    dirty = true;
    rafId = requestAnimationFrame(() => { dirty = false; render(); });
  }

  function matches(r) {
    if (!activeLevels.has(r.level)) return false;
    if (!query) return true;
    if (query[0] === '#') return (r.category || '') === query.slice(1).toLowerCase();
    return `${r.message} ${r.category || ''} ${r.code || ''}`.toLowerCase().includes(query);
  }

  /**
   * Render one record row. All dynamic text is set via textContent — nothing a log
   * line contains is ever parsed as HTML.
   */
  function row(r) {
    const line = document.createElement('div');
    line.className = 'kxc-row';
    line.dataset.level = r.level;

    const t = document.createElement('span'); t.className = 'kxc-t'; t.textContent = rel(r.ms);
    const lv = document.createElement('span'); lv.className = 'kxc-lv'; lv.textContent = r.level[0].toUpperCase(); lv.style.color = LEVEL_COLOR[r.level];
    line.append(t, lv);

    if (r.category) {
      const cat = document.createElement('span'); cat.className = 'kxc-cat'; cat.textContent = r.category;
      line.appendChild(cat);
    }
    const msg = document.createElement('span'); msg.className = 'kxc-msg'; msg.textContent = r.message;
    line.appendChild(msg);

    if (r.count > 1) {
      const dup = document.createElement('span'); dup.className = 'kxc-dup'; dup.title = `${r.count} identical messages, last ${rel((r.lastMs ?? r.ms))}`;
      dup.textContent = `×${r.count}`;
      line.appendChild(dup);
    }
    const payload = r.error ? (r.error.stack || r.error.message) : (r.data != null ? safeJson(r.data) : null);
    if (payload) {
      const det = document.createElement('details'); det.className = 'kxc-det';
      const sm = document.createElement('summary'); sm.textContent = '{ }'; det.appendChild(sm);
      const pre = document.createElement('pre'); pre.textContent = payload; det.appendChild(pre);
      line.appendChild(det);
    }
    return line;
  }

  function render() {
    try {
      if (view === 'systems') { renderSystems(); renderStats(); return; }
      const recs = diag.records();
      const shown = [];
      for (let i = recs.length - 1; i >= 0 && shown.length < MAX_ROWS; i--) {
        if (matches(recs[i])) shown.push(recs[i]);
      }
      shown.reverse();
      const frag = document.createDocumentFragment();
      for (const r of shown) frag.appendChild(row(r));
      el.log.replaceChildren(frag);
      el.match.textContent = query ? `${shown.length} of ${recs.length}` : '';
      renderStats();
      if (autoscroll) el.log.scrollTop = el.log.scrollHeight;
    } catch (err) {
      // A console that throws must be obvious but harmless.
      el.log.textContent = '';
      const bad = document.createElement('div'); bad.className = 'kxc-row'; bad.dataset.level = LEVELS.ERROR;
      bad.textContent = 'console render failed: ' + ((err && err.message) || err);
      el.log.appendChild(bad);
    }
  }

  function renderStats() {
    const s = diag.snapshot();
    const errs = (s.byLevel[LEVELS.ERROR] || 0) + (s.byLevel[LEVELS.FATAL] || 0);
    const warns = s.byLevel[LEVELS.WARN] || 0;
    el.stats.textContent = `${s.total} msg · ${errs} err · ${warns} warn · ${rel(s.uptimeMs)} up`;
    const dot = button.querySelector('.kx-console-dot');
    if (dot) {
      const urgent = errs > 0 ? 'error' : (warns > 0 ? 'warn' : '');
      dot.dataset.sev = urgent || 'idle';
      dot.hidden = !urgent;
    }
  }

  function renderSystems() {
    const recs = diag.records();
    // Derive per-subsystem status from boot/announce + guarded failures.
    const subs = new Map();
    for (const r of recs) {
      const name = r.context && r.context.subsystem;
      if (!name) continue;
      const cur = subs.get(name) || { up: false, failed: false, ms: null, tries: 0 };
      cur.tries++;
      if (r.context.ok === true) { cur.up = true; cur.ms = r.context.ms; }
      if (r.context.failed === true) { cur.failed = true; }
      subs.set(name, cur);
    }
    const s = diag.snapshot();
    const env = collectEnvironment();

    const card = (label, fn) => { const c = document.createElement('div'); c.className = 'kxc-card'; const h = document.createElement('h4'); h.textContent = label; c.appendChild(h); fn(c); return c; };

    el.systems.textContent = '';
    el.systems.appendChild(card('Environment', (c) => {
      const dl = document.createElement('dl');
      for (const [k, v] of Object.entries(env)) {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        dl.append(dt, dd);
      }
      c.appendChild(dl);
    }));

    el.systems.appendChild(card('Subsystems', (c) => {
      if (!subs.size) { const p = document.createElement('p'); p.className = 'kxc-muted'; p.textContent = 'No subsystems have reported yet.'; c.appendChild(p); }
      const ul = document.createElement('ul'); ul.className = 'kxc-subs';
      for (const [name, st] of subs) {
        const li = document.createElement('li');
        const state = st.failed && !st.up ? 'down' : (st.up ? 'up' : 'pending');
        li.dataset.state = state;
        const dot = document.createElement('span'); dot.className = 'kxc-sdot';
        const nm = document.createElement('span'); nm.className = 'kxc-sname'; nm.textContent = name;
        li.append(dot, nm);
        if (st.ms != null) { const ms = document.createElement('span'); ms.className = 'kxc-sms'; ms.textContent = `${st.ms}ms`; li.appendChild(ms); }
        if (st.failed) { const f = document.createElement('span'); f.className = 'kxc-sflag'; f.textContent = 'recovered after a failure'; li.appendChild(f); }
        ul.appendChild(li);
      }
      c.appendChild(ul);
    }));

    el.systems.appendChild(card('Signals by category', (c) => {
      const keys = Object.keys(s.byCategory);
      if (!keys.length) { const p = document.createElement('p'); p.className = 'kxc-muted'; p.textContent = 'No categorized events recorded.'; c.appendChild(p); }
      const dl = document.createElement('dl');
      for (const k of keys.sort((a, b) => s.byCategory[b] - s.byCategory[a])) {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = s.byCategory[k];
        dl.append(dt, dd);
      }
      c.appendChild(dl);
    }));

    el.systems.appendChild(card('Slowest operations', (c) => {
      if (!s.slowest.length) { const p = document.createElement('p'); p.className = 'kxc-muted'; p.textContent = 'Nothing has been timed yet.'; c.appendChild(p); }
      const ul = document.createElement('ul'); ul.className = 'kxc-slow';
      for (const o of s.slowest) {
        const li = document.createElement('li');
        li.textContent = `${o.label} — avg ${o.avgMs}ms, max ${o.maxMs}ms (${o.count}×)`;
        ul.appendChild(li);
      }
      c.appendChild(ul);
    }));
  }

  // ── wiring ────────────────────────────────────────────────────────────────────
  const onRecord = () => markDirty();
  const unsub = diag.subscribe(onRecord);

  button.addEventListener('click', () => toggle());
  panel.querySelector('.kxc-close').addEventListener('click', () => close());
  panel.querySelectorAll('.kxc-tab').forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));
  el.auto.addEventListener('change', () => { autoscroll = el.auto.checked; });
  el.search.addEventListener('input', () => { query = el.search.value.trim().toLowerCase(); markDirty(); });
  el.levels.addEventListener('click', (e) => {
    const chip = e.target.closest('.kxc-lvl'); if (!chip) return;
    const lvl = chip.dataset.level;
    if (activeLevels.has(lvl)) activeLevels.delete(lvl); else activeLevels.add(lvl);
    chip.classList.toggle('is-on', activeLevels.has(lvl));
    chip.setAttribute('aria-pressed', String(activeLevels.has(lvl)));
    markDirty();
  });
  // Pause following when the user scrolls up; resume at the bottom.
  el.log.addEventListener('scroll', () => {
    const atBottom = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 24;
    if (!atBottom && autoscroll) { autoscroll = false; el.auto.checked = false; }
  });
  panel.querySelector('[data-act="clear"]').addEventListener('click', () => { diag.reset(); render(); });
  panel.querySelector('[data-act="export"]').addEventListener('click', exportJson);
  panel.querySelector('[data-act="copy"]').addEventListener('click', copyVisible);

  const onKey = (e) => { if (OPEN_KEYS.some(fn => fn(e))) { e.preventDefault(); toggle(); } };
  document.addEventListener('keydown', onKey);

  el.footEnv.textContent = 'Ctrl+` to open · filters remember your last view';

  // ── public surface ──────────────────────────────────────────────────────────────
  function isOpen() { return !panel.hidden; }
  function open() {
    if (isOpen()) return;
    panel.hidden = false;
    requestAnimationFrame(() => { render(); el.log.scrollTop = el.log.scrollHeight; });
  }
  function close() { panel.hidden = true; if (rafId) cancelAnimationFrame(rafId); dirty = false; }
  function toggle() { isOpen() ? close() : open(); }
  function setView(v) {
    view = v;
    panel.querySelectorAll('.kxc-tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === v));
    el.log.hidden = v !== 'log';
    el.systems.hidden = v !== 'systems';
    render();
  }
  function exportJson() {
    const json = diag.exportJSON();
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'knitcat-console.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      copyText(json);
      notifier && notifier.success && notifier.success('Console session exported and copied.');
    } catch (_) { copyText(json); }
  }
  function copyVisible() {
    const recs = diag.records().filter(matches);
    const text = recs.map(r => `[${r.level}] ${r.message}${r.count > 1 ? ` ×${r.count}` : ''}`).join('\n');
    copyText(text);
    notifier && notifier.info && notifier.info(`${recs.length} line(s) copied.`);
  }
  function destroy() {
    unsub();
    document.removeEventListener('keydown', onKey);
    button.remove(); panel.remove();
    const st = document.getElementById(STYLE_ID); if (st) st.remove();
  }

  // A first, quiet breadcrumb so the panel is never blank when opened.
  diag.info('Console ready', { subsystem: 'console', ok: true });
  renderStats();

  return { toggle, open, close, isOpen, destroy, button, setView };
}

/* ── module-private utilities (all DOM use is inside these, called after boot) ── */

/** Copy text to the clipboard, tolerating an absent/denied API. @param {string} text */
function copyText(text) {
  try {
    const nav = globalThis.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) { nav.clipboard.writeText(text).catch(() => {}); return; }
  } catch (_) { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  } catch (_) { /* nothing more we can safely do */ }
}

/** JSON.stringify with an unthrowing fallback. @param {*} v @returns {string} */
function safeJson(v) { try { return JSON.stringify(v, null, 1); } catch (_) { return String(v); } }

/**
 * Snapshot the runtime environment for the Systems view. Every read is guarded, so
 * an exotic or privacy-restricted browser yields gaps rather than a throw.
 * @returns {Object<string,string>} label → value
 */
function collectEnvironment() {
  const out = {};
  const ua = globalThis.navigator && navigator.userAgent ? navigator.userAgent : '';
  out.browser = (() => {
    const m = /(?:(Firefox|Edg|OPR|Chrome|Safari)\/([\d.]+))/g; let last = null; let x;
    while ((x = m.exec(ua))) last = x;
    return last ? `${last[1] === 'OPR' ? 'Opera' : last[1]} ${last[2].split('.')[0]}` : 'unknown';
  })();
  try { out.platform = navigator.platform || (navigator.userAgentData && navigator.userAgentData.platform) || '—'; } catch (_) { out.platform = '—'; }
  try {
    const langs = (navigator.languages && navigator.languages[0]) || navigator.language;
    if (langs) out.language = langs;
  } catch (_) { /* ignore */ }
  try { out.dpr = String(globalThis.devicePixelRatio || 1); } catch (_) { /* ignore */ }
  try { out.viewport = `${globalThis.innerWidth}×${globalThis.innerHeight}`; } catch (_) { /* ignore */ }
  try { out.connection = (navigator.connection && navigator.connection.effectiveType) || '—'; } catch (_) { /* ignore */ }
  try { out.memory = navigator.deviceMemory ? `${navigator.deviceMemory} GB` : '—'; } catch (_) { out.memory = '—'; }
  try { out.online = String(globalThis.navigator ? navigator.onLine : true); } catch (_) { out.online = '—'; }
  try { out.storage = (() => { try { localStorage.setItem('__kx', '1'); localStorage.removeItem('__kx'); return 'available'; } catch (_) { return 'blocked'; } })(); } catch (_) { out.storage = '—'; }
  try { out.canvas = (() => { const c = document.createElement('canvas'); return c.getContext && c.getContext('2d') ? '2d ready' : 'no 2d'; })(); } catch (_) { out.canvas = '—'; }
  try { out.worker = (globalThis.Worker ? 'yes' : 'no') + (globalThis.SharedArrayBuffer ? ' +SAB' : ''); } catch (_) { /* ignore */ }
  try { out.secure = globalThis.location ? location.protocol : '—'; } catch (_) { /* ignore */ }
  return out;
}

let stylesInjected = false;
/** Inject the panel stylesheet once. Purely additive; never throws into boot. */
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) { stylesInjected = true; return; }
  const css = `
  #kx-console-btn{position:relative;display:inline-flex;align-items:center;gap:4px;font:inherit;cursor:pointer}
  #kx-console-btn .kx-console-btn-label{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700}
  #kx-console-btn .kx-console-dot{width:8px;height:8px;border-radius:50%;background:#57c785;box-shadow:0 0 0 2px rgba(0,0,0,.15)}
  #kx-console-btn .kx-console-dot[data-sev="warn"]{background:#f0b429}
  #kx-console-btn .kx-console-dot[data-sev="error"]{background:#ff3860;animation:kxc-pulse 1.1s infinite}
  @keyframes kxc-pulse{0%,100%{opacity:1}50%{opacity:.35}}
  #kx-console{position:fixed;left:0;right:0;bottom:0;height:min(52vh,560px);z-index:9999;display:flex;flex-direction:column;
    background:#0d1017;color:#e7ecf3;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    border-top:1px solid #2b3242;box-shadow:0 -18px 50px rgba(0,0,0,.45)}
  #kx-console .kxc-bar{display:flex;align-items:center;gap:12px;padding:6px 10px;border-bottom:1px solid #232a39;background:#111621}
  #kx-console .kxc-title{font-weight:700;letter-spacing:.3px;white-space:nowrap}
  #kx-console .kxc-glyph{color:#57c785;margin-right:6px}
  #kx-console .kxc-tabs{display:flex;gap:2px;background:#0b0f16;border:1px solid #232a39;border-radius:8px;padding:2px}
  #kx-console .kxc-tab{border:0;background:transparent;color:#95a0b3;padding:3px 10px;border-radius:6px;cursor:pointer;font:inherit}
  #kx-console .kxc-tab.is-active{background:#20293b;color:#e7ecf3}
  #kx-console .kxc-stats{margin-left:auto;color:#8a93a6;white-space:nowrap;font-size:11.5px}
  #kx-console .kxc-actions{display:flex;align-items:center;gap:6px}
  #kx-console .kxc-act{border:1px solid #2b3242;background:#151b28;color:#cdd6e5;border-radius:6px;padding:3px 8px;cursor:pointer;font:inherit}
  #kx-console .kxc-act:hover{background:#1d2534}
  #kx-console .kxc-close{min-width:26px;text-align:center}
  #kx-console .kxc-auto{display:flex;align-items:center;gap:4px;color:#95a0b3;font-size:11.5px;white-space:nowrap}
  #kx-console .kxc-filter{display:flex;align-items:center;gap:10px;padding:6px 10px;border-bottom:1px solid #1a2130;background:#0f1420}
  #kx-console .kxc-levels{display:flex;gap:4px;flex-wrap:wrap}
  #kx-console .kxc-lvl{--kxc-lvl:#888;border:1px solid #2b3242;background:#111725;border-radius:20px;padding:1px 9px;font-size:11px;cursor:pointer;text-transform:uppercase;letter-spacing:.4px;color:#7c879b}
  #kx-console .kxc-lvl.is-on{color:#0d1017;background:var(--kxc-lvl);border-color:var(--kxc-lvl)}
  #kx-console .kxc-search{flex:1;min-width:120px;background:#0b0f16;border:1px solid #232a39;border-radius:6px;color:#e7ecf3;padding:3px 8px;font:inherit}
  #kx-console .kxc-match{color:#8a93a6;font-size:11.5px;white-space:nowrap}
  #kx-console .kxc-body{position:relative;flex:1;min-height:0}
  #kx-console .kxc-log,#kx-console .kxc-systems{position:absolute;inset:0;overflow:auto;padding:4px 0}
  #kx-console .kxc-row{display:flex;align-items:flex-start;gap:8px;padding:2px 10px;border-left:3px solid transparent;white-space:pre-wrap;word-break:break-word}
  #kx-console .kxc-row:hover{background:#131a27}
  #kx-console .kxc-row[data-level="trace"]{color:#79828f}
  #kx-console .kxc-row[data-level="debug"]{color:#95a6c9}
  #kx-console .kxc-row[data-level="warn"]{border-left-color:#f0b429}
  #kx-console .kxc-row[data-level="error"]{border-left-color:#f2555a;background:#1a1316}
  #kx-console .kxc-row[data-level="fatal"]{border-left-color:#ff3860;background:#20131a;font-weight:600}
  #kx-console .kxc-t{color:#5b6577;flex:0 0 auto;font-variant-numeric:tabular-nums}
  #kx-console .kxc-lv{flex:0 0 12px;font-weight:700}
  #kx-console .kxc-cat{flex:0 0 auto;background:#182032;border:1px solid #26314a;color:#8fb0ff;border-radius:5px;padding:0 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px}
  #kx-console .kxc-msg{flex:1 1 auto;min-width:0}
  #kx-console .kxc-dup{flex:0 0 auto;background:#3a2d12;color:#f0b429;border-radius:10px;padding:0 7px;font-size:11px;font-weight:700}
  #kx-console .kxc-det{flex-basis:100%;margin:2px 0 2px 20px}
  #kx-console .kxc-det summary{cursor:pointer;color:#5b6577;list-style:none}
  #kx-console .kxc-det pre{margin:4px 0 0;padding:6px 8px;background:#0b0f16;border:1px solid #1a2130;border-radius:6px;white-space:pre-wrap;word-break:break-word;color:#aeb9cc;max-height:240px;overflow:auto}
  #kx-console .kxc-systems{padding:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;align-content:start}
  #kx-console .kxc-card{background:#111725;border:1px solid #232a39;border-radius:10px;padding:10px 12px}
  #kx-console .kxc-card h4{margin:0 0 8px;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#8fb0ff}
  #kx-console .kxc-card dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:0}
  #kx-console .kxc-card dt{color:#7c879b}
  #kx-console .kxc-card dd{margin:0;color:#e7ecf3;text-align:right;word-break:break-word}
  #kx-console .kxc-subs,#kx-console .kxc-slow{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
  #kx-console .kxc-subs li{display:flex;align-items:center;gap:8px}
  #kx-console .kxc-sdot{width:8px;height:8px;border-radius:50%;background:#6b7688}
  #kx-console .kxc-subs li[data-state="up"] .kxc-sdot{background:#57c785}
  #kx-console .kxc-subs li[data-state="down"] .kxc-sdot{background:#ff3860}
  #kx-console .kxc-subs li[data-state="pending"] .kxc-sdot{background:#f0b429}
  #kx-console .kxc-sname{flex:1 1 auto}
  #kx-console .kxc-sms{color:#8a93a6;font-size:11px}
  #kx-console .kxc-sflag{color:#f0b429;font-size:10.5px}
  #kx-console .kxc-muted{color:#7c879b;margin:0}
  #kx-console .kxc-foot{padding:4px 10px;border-top:1px solid #1a2130;color:#5b6577;font-size:11px;background:#0b0f16}
  @media (prefers-color-scheme: light){ #kx-console{box-shadow:0 -18px 50px rgba(0,0,0,.25)} }
  `;
  try {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
    stylesInjected = true;
  } catch (_) { stylesInjected = true; /* if injection fails, the panel still works unstyled */ }
}
