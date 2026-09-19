/**
 * KnitCAD — self-contained "extras" layer (personalization + UX polish).
 *
 * Design rules (this file must never break the core app):
 *   • It only ADDS DOM (header buttons, modals, overlays) — it never mutates
 *     existing nodes' behaviour beyond appending children.
 *   • Every public entry point is wrapped by the caller in runGuarded(), and is
 *     itself defensive: missing elements are no-ops, never throws.
 *   • No imports from the app; talks to the world via localStorage + DOM + a tiny
 *     optional notifier passed in init.
 *
 * Features:
 *   Part 3: settings modal (localStorage), About modal, rotating greeting,
 *           days-together counter, personal accent colour + photo, easter egg.
 *   Part 5: Escape closes modals, focus trap, optional soft "export" chime,
 *           optional hearts-on-mousemove.
 */

const SETTINGS_KEY = 'knitcad.settings.v1';
const DEFAULTS = {
  yourName: 'Alex',
  hisName: 'Benji',
  anniversary: '',
  message: 'ily',
  quote: 'i built this for my CUTE SEXY PRETTY GORGEOUS BOYFRIEND',
  accent: '#fb7185',
  theme: 'dark',
  photo: '',
  heartsOnMove: false,
  soundOnExport: false,
  greetSeen: false
};

// Alex = Sagittarius (♐). Benji = Gemini (♊). Fire + Air: a great match.
const ZODIAC = {
  yours:  { sign: 'Sagittarius', glyph: '\uD83C\uDF90', dates: 'Nov 22 \u2013 Dec 21', element: 'Fire' },
  his:    { sign: 'Gemini',      glyph: '\u264A',       dates: 'May 21 \u2013 Jun 20',  element: 'Air' }
};

let settings = { ...DEFAULTS };
let notifier = null;
let activeModal = null;
const listeners = [];

function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  listeners.push({ target, type, handler, opts });
}

function load() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) settings = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    settings = { ...DEFAULTS };
  }
}

function save() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) {
    /* storage may be unavailable (private mode) — degrade quietly */
  }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyTheme() {
  const root = document.documentElement;
  root.style.setProperty('--brand-accent', settings.accent);
  // Additive light mode: only applied when the user opts in, and scoped to a
  // data-attribute so the core dark CAD canvas is never affected by default.
  if (settings.theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  const tb = document.getElementById('kx-theme');
  if (tb) { tb.textContent = settings.theme === 'light' ? '☀' : '☾'; tb.title = settings.theme === 'light' ? 'Switch to dark' : 'Switch to light'; }
}

function daysTogether() {
  if (!settings.anniversary) return null;
  const start = new Date(settings.anniversary + 'T00:00:00');
  if (isNaN(start.getTime())) return null;
  const days = Math.floor((Date.now() - start.getTime()) / 86400000);
  return days >= 0 ? days : null;
}

/* ── styles (injected once, scoped under our own classes) ─────────────── */
function injectStyles() {
  if (document.getElementById('knitcad-extras-style')) return;
  const css = `
  .kx-greet{font-size:11px;color:var(--brand-accent,#fb7185);margin-left:8px;opacity:.85;font-style:italic}
  .kx-days{font-size:11px;color:var(--text-secondary,#cbd5e1);margin-left:6px}
  .kx-hbtn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;margin-left:6px;
    border:1px solid var(--brand-accent,#fb7185);border-radius:8px;background:transparent;color:var(--brand-accent,#fb7185);
    cursor:pointer;font-size:15px;line-height:1;transition:background .15s,transform .1s}
  .kx-hbtn:hover{background:rgba(251,113,133,.15);transform:translateY(-1px)}
  .kx-avatar{width:26px;height:26px;border-radius:50%;object-fit:cover;margin-left:8px;border:1px solid var(--brand-accent,#fb7185)}
  .kx-backdrop{position:fixed;inset:0;background:rgba(10,4,16,.72);backdrop-filter:blur(3px);z-index:1200;
    display:flex;align-items:center;justify-content:center;padding:20px}
  .kx-modal{width:min(560px,94vw);max-height:88vh;overflow:auto;background:#1a0b22;border:1px solid #701a75;
    border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.5);color:#fff1f2;padding:22px}
  .kx-modal h2{margin:0 0 6px;font-size:20px;color:var(--brand-accent,#fb7185)}
  .kx-modal .kx-sub{margin:0 0 16px;font-size:12px;opacity:.7}
  .kx-row{margin-bottom:12px}
  .kx-row label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.7;margin-bottom:4px}
  .kx-row input,.kx-row textarea{width:100%;box-sizing:border-box;background:#22082e;border:1px solid #4a1d5e;
    border-radius:8px;color:#fff;padding:8px 10px;font-size:13px;font-family:inherit}
  .kx-row textarea{resize:vertical;min-height:56px}
  .kx-row input[type=color]{height:38px;padding:2px}
  .kx-check{display:flex;align-items:center;gap:8px;font-size:13px}
  .kx-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}
  .kx-btn{border:1px solid #701a75;background:transparent;color:#fff1f2;border-radius:9px;padding:8px 14px;
    cursor:pointer;font-size:13px}
  .kx-btn.kx-primary{background:linear-gradient(135deg,#be185d,#9d174d);border-color:var(--brand-accent,#fb7185)}
  .kx-about p{line-height:1.6;font-size:14px}
  .kx-about .sig{margin-top:18px;font-style:italic;color:var(--brand-accent,#fb7185)}
  .kx-letter{position:fixed;inset:0;z-index:1300;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(circle at 50% 30%,#3b0764,#14041a 70%);color:#fff1f2;text-align:center;padding:24px}
  .kx-letter .inner{max-width:620px}
  .kx-letter h1{font-size:clamp(28px,6vw,52px);color:var(--brand-accent,#fb7185);margin:0 0 18px}
  .kx-letter p{font-size:clamp(15px,2.4vw,20px);line-height:1.7;white-space:pre-wrap}
  .kx-heart{position:fixed;z-index:1400;pointer-events:none;font-size:16px;will-change:transform,opacity;
    animation:kx-fall 1.1s ease-out forwards}
  @keyframes kx-fall{from{transform:translateY(0) scale(1);opacity:1}to{transform:translateY(40px) scale(1.4);opacity:0}}
  .kx-menu{position:relative;display:inline-flex}
  .kx-menu-btn{white-space:nowrap}
  .kx-menu-drop{display:none;position:absolute;top:calc(100% + 6px);left:0;min-width:170px;background:#12203b;
    border:1px solid #24406e;border-radius:10px;padding:6px;z-index:1500;box-shadow:0 12px 30px rgba(0,0,0,.5)}
  .kx-menu-drop.open{display:flex;flex-direction:column;gap:4px}
  .kx-menu-item{text-align:left;background:transparent;border:0;color:#e2e8f0;padding:8px 10px;border-radius:8px;
    cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px}
  .kx-menu-item:hover{background:rgba(56,189,248,.14)}
  /* ── additive light theme (only active under html[data-theme="light"]) ── */
  html[data-theme="light"] body{filter:brightness(1.12) contrast(0.96)}
  html[data-theme="light"] .app-header,html[data-theme="light"] .panel,
  html[data-theme="light"] .sidebar,html[data-theme="light"] .toolbar{background:#f1f5f9;color:#0f172a}
  html[data-theme="light"] .panel-title,html[data-theme="light"] .toolbar-label{color:#0f172a}
  html[data-theme="light"] .kx-modal{background:#fff;border-color:#fbcfe8;color:#1e293b}
  html[data-theme="light"] .kx-modal h2{color:#be185d}
  html[data-theme="light"] .kx-row input,html[data-theme="light"] .kx-row textarea{background:#fff;border-color:#e2e8f0;color:#0f172a}
  html[data-theme="light"] .kx-btn{color:#1e293b;border-color:#f9a8d4}
  .kx-egg{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:1350;
    background:linear-gradient(135deg,#7c3aed,#be185d);color:#fff;padding:10px 18px;border-radius:999px;
    font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;transition:opacity .3s,transform .3s;pointer-events:none}
  .kx-egg.show{opacity:1;transform:translateX(-50%) translateY(-6px)}
  `;
  const el = document.createElement('style');
  el.id = 'knitcad-extras-style';
  el.textContent = css;
  document.head.appendChild(el);
}

/* ── header controls + greeting ───────────────────────────────────────── */
function buildHeaderUI() {
  const brand = document.querySelector('.brand-section');
  if (!brand || brand.querySelector('.kx-hbtn')) return;

  const greet = document.createElement('span');
  greet.className = 'kx-greet';
  greet.id = 'kx-greet';
  brand.appendChild(greet);

  const days = document.createElement('span');
  days.className = 'kx-days';
  days.id = 'kx-days';
  brand.appendChild(days);

  const avatar = document.createElement('img');
  avatar.className = 'kx-avatar';
  avatar.id = 'kx-avatar';
  avatar.style.display = 'none';
  avatar.alt = '';
  brand.appendChild(avatar);

  const aboutBtn = mkBtn('♥', 'About KnitCAD', () => openAbout());
  const gearBtn = mkBtn('⚙', 'Settings', () => openSettings());
  const themeBtn = mkBtn('☾', 'Switch to light', () => toggleTheme());
  themeBtn.id = 'kx-theme';
  brand.appendChild(aboutBtn);
  brand.appendChild(themeBtn);
  brand.appendChild(gearBtn);

  refreshGreeting();
}

function toggleTheme() {
  settings.theme = settings.theme === 'light' ? 'dark' : 'light';
  save();
  applyTheme();
}

/**
 * Combine the header's "studio" action buttons (Presets / Math Studio /
 * Image Dither) into a single "Studio" dropdown so the top bar stops feeling
 * like button spam. The original buttons are KEPT in the DOM (only hidden), so
 * every existing handler still fires when a menu item dispatches a click. If this
 * ever fails, the guard leaves the original buttons visible - nothing is lost.
 */
function buildStudioMenu() {
  const actions = document.querySelector('.header-actions');
  if (!actions || actions.querySelector('.kx-menu')) return;
  const ids = ['btn-open-presets', 'btn-open-math', 'btn-open-image'];
  const targets = ids.map(id => document.getElementById(id)).filter(Boolean);
  if (targets.length < 2) return; // nothing worth grouping

  const wrap = document.createElement('div');
  wrap.className = 'kx-menu';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-action kx-menu-btn';
  btn.textContent = 'Studio \u25be';
  const drop = document.createElement('div');
  drop.className = 'kx-menu-drop';

  targets.forEach(t => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'kx-menu-item';
    const svg = t.querySelector('svg');
    if (svg) {
      const clone = svg.cloneNode(true);
      clone.setAttribute('width', '14'); clone.setAttribute('height', '14');
      item.appendChild(clone);
    }
    item.appendChild(document.createTextNode((t.textContent || '').trim()));
    on(item, 'click', () => { drop.classList.remove('open'); t.click(); });
    drop.appendChild(item);
  });

  wrap.appendChild(btn);
  wrap.appendChild(drop);
  on(btn, 'click', e => { e.stopPropagation(); drop.classList.toggle('open'); });
  on(document, 'click', () => drop.classList.remove('open'));

  actions.insertBefore(wrap, actions.firstChild);
  targets.forEach(t => { t.style.display = 'none'; });
}

function mkBtn(icon, title, handler) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'kx-hbtn';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.textContent = icon;
  on(b, 'click', handler);
  return b;
}

const GREETINGS = [
  () => 'ily ♥',
  () => `ily, ${settings.hisName} \u2665`,
  () => 'i built this for my CUTE SEXY PRETTY GORGEOUS BOYFRIEND',
  () => '\u2610\u2192\u264A i love you',   // ♐→♊ Sagittarius to Gemini
  () => { const d = daysTogether(); return d != null ? `${d} days and counting \u2665` : 'you + me \u2665'; }
];
let greetIdx = 0;

function dayPart() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

function refreshGreeting() {
  const g = document.getElementById('kx-greet');
  if (g) g.textContent = GREETINGS[greetIdx % GREETINGS.length]();
  const d = document.getElementById('kx-days');
  if (d) { const n = daysTogether(); d.textContent = n != null ? `· ${n} days ♥` : ''; }
}

function startGreetingRotation() {
  setInterval(() => { greetIdx++; refreshGreeting(); }, 9000);
}

/* ── generic modal with focus trap + escape ───────────────────────────── */
function openModal(html, { labelledBy } = {}) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'kx-backdrop';
  backdrop.innerHTML = `<div class="kx-modal" role="dialog" aria-modal="true"${labelledBy ? ` aria-labelledby="${labelledBy}"` : ''}>${html}</div>`;
  document.body.appendChild(backdrop);
  activeModal = backdrop;

  on(backdrop, 'mousedown', e => { if (e.target === backdrop) closeModal(); });

  const modal = backdrop.querySelector('.kx-modal');
  const focusables = modal.querySelectorAll('button,input,textarea,select,[tabindex]:not([tabindex="-1"])');
  (focusables[0] || modal).focus();

  on(modal, 'keydown', e => {
    if (e.key !== 'Tab' || focusables.length === 0) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  return modal;
}

function closeModal() {
  if (activeModal) { activeModal.remove(); activeModal = null; }
}

/* ── settings modal ───────────────────────────────────────────────────── */
function openSettings() {
  const s = settings;
  const modal = openModal(`
    <h2 id="kx-set-title">Settings ♥</h2>
    <p class="kx-sub">Make it yours. Saved privately in this browser.</p>
    <div class="kx-row"><label>Your name</label><input id="f-your" value="${esc(s.yourName)}" maxlength="40"></div>
    <div class="kx-row"><label>His name</label><input id="f-his" value="${esc(s.hisName)}" maxlength="40"></div>
    <div class="kx-row"><label>Anniversary date</label><input id="f-anni" type="date" value="${esc(s.anniversary)}"></div>
    <div class="kx-row"><label>Love message</label><textarea id="f-msg" maxlength="240">${esc(s.message)}</textarea></div>
    <div class="kx-row"><label>Personal quote / in-joke</label><input id="f-quote" value="${esc(s.quote)}" maxlength="120"></div>
    <div class="kx-row"><label>Accent colour</label><input id="f-accent" type="color" value="${esc(s.accent)}"></div>
    <div class="kx-row"><label>His photo</label><input id="f-photo" type="file" accept="image/*"></div>
    <div class="kx-row kx-check"><input id="f-hearts" type="checkbox" ${s.heartsOnMove ? 'checked' : ''}><label for="f-hearts" style="margin:0">Show hearts when moving the mouse</label></div>
    <div class="kx-row kx-check"><input id="f-sound" type="checkbox" ${s.soundOnExport ? 'checked' : ''}><label for="f-sound" style="margin:0">Soft chime when something succeeds</label></div>
    <div class="kx-actions">
      <button class="kx-btn" id="kx-cancel" type="button">Cancel</button>
      <button class="kx-btn" id="kx-reset" type="button">Reset</button>
      <button class="kx-btn kx-primary" id="kx-save" type="button">Save</button>
    </div>
  `, { labelledBy: 'kx-set-title' });

  on(modal.querySelector('#kx-cancel'), 'click', closeModal);
  on(modal.querySelector('#kx-reset'), 'click', () => {
    settings = { ...DEFAULTS }; save(); applyTheme(); refreshGreeting(); updateAvatar(); closeModal();
    if (notifier) notifier.info('Settings reset.');
  });
  on(modal.querySelector('#kx-save'), 'click', () => {
    settings.yourName = val(modal, '#f-your');
    settings.hisName = val(modal, '#f-his') || 'Benji';
    settings.anniversary = val(modal, '#f-anni');
    settings.message = val(modal, '#f-msg');
    settings.quote = val(modal, '#f-quote');
    settings.accent = val(modal, '#f-accent') || DEFAULTS.accent;
    settings.heartsOnMove = modal.querySelector('#f-hearts').checked;
    settings.soundOnExport = modal.querySelector('#f-sound').checked;
    save(); applyTheme(); refreshGreeting();
    closeModal();
    if (notifier) notifier.success(`Saved — made for ${settings.hisName} ♥`);
  });

  const photoInput = modal.querySelector('#f-photo');
  on(photoInput, 'change', () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // Downscale to keep localStorage small.
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const scale = Math.min(1, 180 / img.width);
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        settings.photo = c.toDataURL('image/jpeg', 0.8);
        save(); updateAvatar();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function val(scope, sel) { const el = scope.querySelector(sel); return el ? el.value.trim() : ''; }

function updateAvatar() {
  const a = document.getElementById('kx-avatar');
  if (!a) return;
  if (settings.photo) { a.src = settings.photo; a.style.display = ''; }
  else { a.style.display = 'none'; a.removeAttribute('src'); }
}

/* ── about modal (the narrative) ──────────────────────────────────────── */
function openAbout() {
  const from = settings.yourName ? `\u2014 ${esc(settings.yourName)} ${ZODIAC.yours.glyph}` : '\u2014 with all my heart';
  const anni = settings.anniversary ? `<br><em>${esc(settings.anniversary)}</em>` : '';
  const modal = openModal(`
    <div class="kx-about">
      <h2>About KnitCAD ${ZODIAC.yours.glyph}\u2192${ZODIAC.his.glyph}</h2>
      <p>I built this for my CUTE SEXY PRETTY GORGEOUS BOYFRIEND.</p>
      <p>It's a real knitting-machine CAD tool \u2014 design punchcard patterns, simulate a Brother KH-830,
      decompile lace into carriage passes, and export to DXF, G-code, SVG or 1:1 printables.
      <p class="sig">${from}${anni}</p>
      <div class="kx-actions"><button class="kx-btn kx-primary" id="kx-about-ok" type="button">Close</button></div>
    </div>
  `);
  const ok = modal.querySelector('#kx-about-ok');
  if (ok) on(ok, 'click', closeModal);
}

/* ── easter egg: B-E-N-J-I ────────────────────────────────────────────── */
const KONAMI = ['arrowup','arrowup','arrowdown','arrowdown','arrowleft','arrowright','arrowleft','arrowright','b','a'];
function installEasterEgg() {
  let buf = '';
  let seq = [];
  let lastLetterClick = 0, letterClicks = 0;
  on(document, 'keydown', e => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const key = (e.key || '').toLowerCase();
    if (['arrowup','arrowdown','arrowleft','arrowright'].includes(key) || key === 'b' || key === 'a') {
      seq.push(key); if (seq.length > KONAMI.length) seq.shift();
      if (seq.join('') === KONAMI.join('')) { heartsBurst(); egg('↑↑↓↓←→←→ B A \u2014 cheat code activated \u2665'); seq = []; }
    }
    if (!/^[a-z]$/.test(key)) return;
    buf = (buf + key).slice(-10);
    if (buf.endsWith('benji') || buf.endsWith('ily') || buf.endsWith('iloveyou')) { showLoveLetter(); buf = ''; }
    else if (buf.endsWith('alex')) { egg(`hey ${ZODIAC.yours.sign} ${ZODIAC.yours.glyph} \u2014 this whole app is for him \u2665`); buf = ''; }
    else if (buf.endsWith('sagittarius') || buf.endsWith('gemini')) {
      egg(`${ZODIAC.yours.glyph} ${ZODIAC.yours.sign} (${ZODIAC.yours.element}) + ${ZODIAC.his.glyph} ${ZODIAC.his.sign} (${ZODIAC.his.element}) = fire & air. you two just work \u2665`); buf = '';
    } else if (buf.endsWith('beanie')) { egg('a beanie? coming right up \u2665 look in the Tailor tab'); buf = ''; }
  });
  const brand = document.querySelector('.brand-section');
  if (brand) on(brand, 'click', e => {
    const btn = e.target.closest('.kx-hbtn');
    if (!btn || btn.id === 'kx-theme' || btn.title === 'Settings') return;
    const now = Date.now();
    letterClicks = (now - lastLetterClick < 500) ? letterClicks + 1 : 1;
    lastLetterClick = now;
    if (letterClicks >= 5) { showLoveLetter(); letterClicks = 0; }
  });
}

function egg(msg) {
  let pill = document.querySelector('.kx-egg');
  if (!pill) { pill = document.createElement('div'); pill.className = 'kx-egg'; document.body.appendChild(pill); }
  pill.textContent = msg;
  pill.classList.add('show');
  clearTimeout(pill._t);
  pill._t = setTimeout(() => pill.classList.remove('show'), 3200);
}

function heartsBurst() {
  const glyphs = ['\uD83D\uDC97', '\uD83D\uDC96', '\uD83D\uDC95', '\u2665'];
  for (let i = 0; i < 26; i++) {
    const h = document.createElement('span');
    h.className = 'kx-heart';
    h.textContent = glyphs[i % glyphs.length];
    h.style.left = (10 + Math.random() * 80) + 'vw';
    h.style.top = (20 + Math.random() * 60) + 'vh';
    h.style.animationDelay = (i * 30) + 'ms';
    document.body.appendChild(h);
    setTimeout(() => h.remove(), 1500 + i * 30);
  }
}

function showLoveLetter() {
  const wrap = document.createElement('div');
  wrap.className = 'kx-letter';
  wrap.innerHTML = `<div class="inner">
    <h1>ily, ${esc(settings.hisName)} ${ZODIAC.his.glyph}</h1>
    <p>i built this for my CUTE SEXY PRETTY GORGEOUS BOYFRIEND.

${esc(settings.message || 'ily')} \u2014 ${esc(settings.yourName || 'me')} ${ZODIAC.yours.glyph}</p>
    <div class="kx-actions" style="justify-content:center;margin-top:26px">
      <button class="kx-btn kx-primary" type="button" id="kx-letter-ok">close \u2665</button>
    </div></div>`;
  document.body.appendChild(wrap);
  on(wrap.querySelector('#kx-letter-ok'), 'click', () => wrap.remove());
  on(wrap, 'mousedown', e => { if (e.target === wrap) wrap.remove(); });
}

/* ── optional niceties: hearts + export chime ─────────────────────────── */
function installHeartsOnMove() {
  let last = 0;
  on(document, 'mousemove', e => {
    if (!settings.heartsOnMove) return;
    const now = Date.now();
    if (now - last < 220) return;
    last = now;
    const h = document.createElement('span');
    h.className = 'kx-heart';
    h.textContent = ['💗', '💖', '💕', '♥'][Math.floor(Math.random() * 4)];
    h.style.left = e.clientX + 'px';
    h.style.top = e.clientY + 'px';
    document.body.appendChild(h);
    setTimeout(() => h.remove(), 1100);
  });
}

let audioCtx = null;
function chime() {
  if (!settings.soundOnExport) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.08 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.35);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.4);
    });
  } catch (_) { /* audio not available */ }
}

function watchSuccessToasts() {
  const container = document.getElementById('toast-container');
  if (!container || typeof MutationObserver === 'undefined') return;
  const obs = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.classList && node.classList.contains('app-toast--success')) chime();
      }
    }
  });
  obs.observe(container, { childList: true });
}

function installEscapeClose() {
  on(document, 'keydown', e => {
    if (e.key !== 'Escape') return;
    const letter = document.querySelector('.kx-letter');
    if (letter) { letter.remove(); return; }
    closeModal();
  });
}

/**
 * Boot the extras layer. Call once, wrapped in a guard, after the DOM exists.
 * @param {{notifier?:object}} ctx
 */
export function initExtras(ctx = {}) {
  notifier = ctx.notifier || null;
  injectStyles();
  load();
  applyTheme();
  buildHeaderUI();
  try { buildStudioMenu(); } catch (_) { /* header keeps its original buttons */ }
  updateAvatar();
  installEscapeClose();
  installEasterEgg();
  installHeartsOnMove();
  watchSuccessToasts();
  startGreetingRotation();
  return {
    refresh: refreshGreeting,
    destroy() {
      for (const { target, type, handler, opts } of listeners) target.removeEventListener(type, handler, opts);
      listeners.length = 0;
      closeModal();
    }
  };
}
