/**
 * KNITCAT — command palette ("do what I typed").
 *
 * Press  Ctrl/⌘+K  or  /  (or click the ⌘ Search button) and type ANY relevant
 * word or phrase — "beanie", "shirt", "punchcard", "fair isle", "export svg",
 * the name of a preset, a machine — and it jumps straight there. Zero menus to
 * hunt through (Hick's Law: fewer visible choices, one fast search).
 *
 * Commands come from three places, all read live from the DOM so it can never
 * drift out of sync with the app:
 *   • viewport tabs, pattern modes and editor tools (buttons clicked)
 *   • machine profiles (the <select> is driven)
 *   • an action list handed in by the app via getActions()
 *
 * Fully contained: if anything throws it just won't open; the app is unaffected.
 */

import { logger } from '../core/logging.js';

const log = logger('features/command-palette');

// Synonyms so ordinary knitting words find the right destination.
const SYNONYMS_TAB = {
  editor: 'pattern cad editor draw grid design stitch paint canvas',
  schedule: 'schedule carriage pass decompile plan sequence passes',
  yarn: 'yarn 3d fabric simulation swatch drape feel physical',
  punchcard: 'punchcard card ribbon holes punch fair isle jacquard',
  cnc: 'cnc toolpath gcode laser mill router',
  // The beanie and tank-top tabs were folded into Clothes long ago, so a top-level
  // `tanktop`/`beanie` key here pointed at a tab that no longer exists and could
  // never be matched by the tab-walk. Their words now ride on `clothes`, so typing
  // "beanie" still lands on the Clothes tab — just via a tab that is actually there.
  clothes: 'clothes clothing catalog wardrobe garment sweater jumper cardigan scarf cowl socks mittens shawl hat every beanie tanktop shirt top camisole vest singlet sleeveless tailor garment cap bob watch',
  brother: 'brother kinematics mechanism machine simulator selector kh-830'
};
const SYNONYMS_MODE = {
  lace: 'lace openwork eyelet lacy',
  fair_isle: 'fair isle fairisle jacquard stranded colourwork colorwork two colour',
  tuck: 'tuck texture puff bump',
  slip: 'slip float mosaic skip'
};

let opened = false;
let els = null;      // { backdrop, input, list }
let results = [];    // filtered command array
let sel = 0;
let allCommands = [];

const RECENT_KEY = 'knitcad.cmdRecent.v1';
const RECENT_MAX = 8;

function readRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : []; 
  } catch (err) {
    log.debug('the saved command recents were corrupt — starting with none', { error: err?.message });
    return [];
  }
}

// Push a just-run command to the front of the recents list (deduped, capped).
function pushRecent(label) {
  try {
    const list = readRecent().filter(l => l !== label);
    list.unshift(label);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch (_) {
    /* storage off — recents simply won't persist */
  }
}

function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// Fuzzy subsequence: are the query's characters present in order? Rewards runs
// that start on word boundaries and adjacent matches, so "expdf" -> "Export PDF".
function fuzzy(text, q) {
  if (!q) return 1;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    while (ti < text.length) {
      const c = text[ti];
      if (c === ch) { found = ti; break; }
      ti++;
    }
    if (found < 0) return 0;
    const boundary = found === 0 || /[\s\/\-_.]/.test(text[found - 1]);
    score += 1 + (boundary ? 3 : 0) + (found === ti - streak ? streak : 0);
    streak = found === ti ? streak + 1 : 1;
    ti++;
  }
  return score;
}

// Score a command against a query; higher is better, 0 = no match.
function score(cmd, q) {
  if (!q) return 1;
  const label = norm(cmd.label);
  const hay = norm(label + ' ' + (cmd.keywords || ''));
  // 1) every whitespace token must at least fuzzy-match the haystack
  const tokens = q.split(' ').filter(Boolean);
  let total = 0;
  for (const t of tokens) {
    if (label.includes(t)) total += label.startsWith(t) ? 12 : 6;       // exact substring, strong
    else if (hay.includes(t)) total += 4;                                // in keywords
    else {
      const f = fuzzy(hay, t);
      if (!f) return 0;                                                  // token simply absent
      total += f;
    }
  }
  // whole-phrase bonus so a full phrase beats scattered letters
  if (hay.includes(q)) total += 8;
  return total;
}

function gatherCommands(getActions) {
  const cmds = [];
  document.querySelectorAll('.tab-btn[data-tab]').forEach(b => {
    const tab = b.dataset.tab;
    cmds.push({ label: 'Go to: ' + norm(b.textContent).replace(/^\w/, c => c.toUpperCase()), group: 'Tabs', keywords: SYNONYMS_TAB[tab] || '', run: () => b.click() });
  });
  document.querySelectorAll('.mode-btn[data-mode]').forEach(b => {
    const m = b.dataset.mode;
    cmds.push({ label: 'Mode: ' + norm(b.textContent), group: 'Modes', keywords: 'mode ' + (SYNONYMS_MODE[m] || ''), run: () => b.click() });
  });
  const selEl = document.getElementById('profile-select');
  if (selEl) Array.from(selEl.options).forEach(o => {
    cmds.push({ label: 'Machine: ' + o.textContent, group: 'Machine', keywords: 'machine profile ' + o.textContent, run: () => { selEl.value = o.value; selEl.dispatchEvent(new Event('change', { bubbles: true })); } });
  });
  try { (getActions ? getActions() : []).forEach(a => cmds.push(a)); } catch (err) { log.warn('the app-supplied command list could not be gathered — the palette is missing those actions', { error: err?.message }); }
  return cmds;
}

function render(q) {
  const query = norm(q);
  if (query) {
    // Search mode: a single ranked list; each row still carries its group tag.
    results = allCommands
      .map(c => ({ c, s: score(c, query) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || a.c.label.localeCompare(b.c.label))
      .slice(0, 60)
      .map(x => x.c);
    paint(false);
    return;
  }
  // Browse mode (empty query): recently used first, then everything grouped under
  // section headers, so the palette is a readable map of the app, not a wall.
  const byLabel = new Map();
  allCommands.forEach(c => { if (!byLabel.has(c.label)) byLabel.set(c.label, c); });
  const recents = readRecent().map(l => byLabel.get(l)).filter(Boolean);
  const recentSet = new Set(recents.map(c => c.label));
  const rest = allCommands
    .filter(c => !recentSet.has(c.label))
    .slice()
    .sort((a, b) => String(a.group || '').localeCompare(String(b.group || '')) || a.label.localeCompare(b.label));
  results = [...recents, ...rest];
  paint(true, new Set(recents.map(c => c.label)));
}

// Build the list markup. `withHeaders` inserts a non-selectable section row each
// time the group changes; selection indices still map 1:1 onto `results`.
function paint(withHeaders, recentSet) {
  sel = 0;
  let lastGroup = null;
  const rows = results.map((c, i) => {
    let head = '';
    if (withHeaders) {
      const g = recentSet && recentSet.has(c.label) ? 'Recent' : (c.group || '');
      if (g !== lastGroup) {
        lastGroup = g;
        head = `<div class="kx-cmd-grouphd" role="presentation">${esc(g)}</div>`;
      }
    }
    return head + `<div class="kx-cmd-item${i === 0 ? ' sel' : ''}" data-i="${i}" role="option" aria-selected="${i === 0}">`
      + `<span class="kx-cmd-label">${esc(c.label)}</span>`
      + `<span class="kx-cmd-group">${esc((withHeaders && recentSet && recentSet.has(c.label)) ? '' : (c.group || ''))}</span></div>`;
  });
  els.list.innerHTML = rows.join('') || '<div class="kx-cmd-empty">Nothing matches — try another word</div>';
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function moveSel(d) {
  const items = els.list.querySelectorAll('.kx-cmd-item');
  if (!items.length) return;
  items[sel] && items[sel].classList.remove('sel');
  sel = (sel + d + items.length) % items.length;
  items[sel].classList.add('sel');
  items[sel].scrollIntoView({ block: 'nearest' });
}

function runSel() {
  const cmd = results[sel];
  close();
  if (cmd && typeof cmd.run === 'function') {
    try { pushRecent(cmd.label); } catch (_) { /* ignore */ }
    try { cmd.run(); } catch (err) { log.logError(`command palette action "${cmd.label}" threw`, err); }
  }
}

function open(prefill = '') {
  if (opened) return;
  ensureStyles();
  opened = true;
  const backdrop = document.createElement('div');
  backdrop.className = 'kx-cmd-backdrop';
  backdrop.innerHTML = `<div class="kx-cmd" role="dialog" aria-modal="true" aria-label="Search commands">
    <input class="kx-cmd-input" type="text" placeholder="Search anything — a tool, preset, machine, export…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="kx-cmd-list" aria-autocomplete="list">
    <div class="kx-cmd-list" id="kx-cmd-list" role="listbox" aria-label="Commands"></div>
    <div class="kx-cmd-foot"><span>↑↓ move</span><span>↵ run</span><span>esc close</span><span class="kx-cmd-hint">Type to fuzzy-search the whole app</span></div>
  </div>`;
  document.body.appendChild(backdrop);
  const input = backdrop.querySelector('.kx-cmd-input');
  const list = backdrop.querySelector('.kx-cmd-list');
  els = { backdrop, input, list };
  if (prefill) input.value = prefill;
  // Gather commands fresh each open (the DOM may have changed) and populate the
  // list BEFORE the first render — otherwise allCommands is still the initial []
  // and every keystroke filters an empty array, so "nothing happens".
  allCommands = gatherCommands(_getActions);
  render(input.value);
  setTimeout(() => input.focus(), 0);

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runSel(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  list.addEventListener('click', e => {
    const it = e.target.closest('.kx-cmd-item');
    if (it) { sel = parseInt(it.dataset.i, 10); runSel(); }
  });
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
}

function close() {
  if (!opened) return;
  opened = false;
  if (els && els.backdrop) els.backdrop.remove();
  els = null;
  results = [];
}

let _getActions = null;
function refresh() { if (opened && _getActions) { allCommands = gatherCommands(_getActions); render(els.input.value); } }

function ensureStyles() {
  if (document.getElementById('kx-cmd-style')) return;
  const css = `
  .kx-cmd-backdrop{position:fixed;inset:0;z-index:1600;background:rgba(5,8,16,.55);backdrop-filter:blur(2px);
    display:flex;align-items:flex-start;justify-content:center;padding-top:14vh}
  .kx-cmd{width:min(620px,94vw);background:#0f1a2e;border:1px solid #24406e;border-radius:14px;overflow:hidden;
    box-shadow:0 30px 70px rgba(0,0,0,.6);color:#e2e8f0;font-family:inherit}
  .kx-cmd-input{width:100%;box-sizing:border-box;background:transparent;border:0;outline:none;color:#fff;
    font-size:18px;padding:16px 18px;border-bottom:1px solid #1c2f4d}
  .kx-cmd-list{max-height:52vh;overflow:auto;padding:6px}
  .kx-cmd-grouphd{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
    color:#7dd3fc;opacity:.7;padding:10px 12px 4px;position:sticky;top:0;background:linear-gradient(#0f1a2e,#0f1a2e)}
  .kx-cmd-item{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:9px 12px;border-radius:9px;cursor:pointer}
  .kx-cmd-item.sel,.kx-cmd-item:hover{background:rgba(56,189,248,.16)}
  .kx-cmd-label{font-size:14px}
  .kx-cmd-group{font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.5}
  .kx-cmd-empty{padding:16px;text-align:center;opacity:.6;font-size:13px}
  .kx-cmd-foot{display:flex;gap:16px;justify-content:flex-end;padding:8px 14px;border-top:1px solid #1c2f4d;font-size:11px;opacity:.5}
  .kx-search-btn{white-space:nowrap}
  /* ── responsive: on a phone the palette is a full-screen finder, not a card ── */
  @media (pointer:coarse){
    .kx-cmd-backdrop{padding-top:0;align-items:stretch}
    .kx-cmd-item{min-height:48px}
  }
  @media (max-width:640px){
    .kx-cmd-backdrop{padding:0;justify-content:stretch}
    .kx-cmd{width:100%;max-width:100%;height:100%;display:flex;flex-direction:column;border:0;border-radius:0}
    .kx-cmd-input{font-size:16px;padding:14px calc(14px + env(safe-area-inset-right)) 14px
      calc(14px + env(safe-area-inset-left))}
    .kx-cmd-input{padding-top:calc(14px + env(safe-area-inset-top))}
    .kx-cmd-list{flex:1 1 auto;max-height:none;padding-bottom:calc(10px + env(safe-area-inset-bottom))}
    .kx-cmd-label{overflow-wrap:anywhere}
    .kx-cmd-foot{padding-bottom:calc(8px + env(safe-area-inset-bottom))}
  }
  `;
  const el = document.createElement('style');
  el.id = 'kx-cmd-style';
  el.textContent = css;
  document.head.appendChild(el);
}

function injectTrigger() {
  const actions = document.querySelector('.header-actions');
  if (!actions || actions.querySelector('#kx-search-btn')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn-action kx-search-btn';
  b.id = 'kx-search-btn';
  b.title = 'Search / jump to anything (Ctrl or ⌘ + K)';
  // Show the real keycap for the platform (⌘K on Apple, Ctrl K elsewhere) so the
  // shortcut is discoverable, not a cryptic glyph.
  const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
  b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>'
    + '<span>Search</span><kbd class="kx-kbd" aria-hidden="true">' + (isMac ? '\u2318K' : 'Ctrl K') + '</kbd>';
  b.addEventListener('click', () => open());
  actions.insertBefore(b, actions.firstChild);
}

/**
 * @param {{ getActions?: () => Array }} ctx  getActions returns extra commands
 *   (presets, garments, settings, exports…). Called each time the palette opens.
 */
export function initCommandPalette(ctx = {}) {
  _getActions = ctx.getActions || null;
  injectTrigger();
  window.addEventListener('keydown', e => {
    const inField = e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); opened ? close() : open(); return; }
    if (!opened && !inField && e.key === '/') { e.preventDefault(); open(); }
  });
  return { open, close, refresh, isOpen: () => opened };
}
