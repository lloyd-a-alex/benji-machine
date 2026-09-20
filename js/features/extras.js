/**
 * KNITCAT — self-contained "extras" layer (personalization + UX polish).
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

// Historic `knitcad.` prefix is deliberate: it holds the anniversary, names, photo
// and theme, so renaming the key would wipe someone's saved love.
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
// Set by buildMobileChrome(): closes the panel drawer, reporting whether it did.
let drawerCloser = () => false;

function closeDrawer() { return drawerCloser(); }

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
  // The picked accent now genuinely drives the UI (no more placebo): every
  // component reads var(--accent-cyan)/var(--accent-rose), so re-pointing those
  // at --brand-accent makes the whole surface respond — unless it's the default
  // romantic pink, in which case we keep the calm cyan CAD accent for legibility.
  const warm = /^#f[0-9ab]/i.test(settings.accent) || /^#e[0-9ab]/i.test(settings.accent) || /^#b[0-9e-f]/i.test(settings.accent) || /^#9[0-9a-f]/i.test(settings.accent);
  root.style.setProperty('--accent-cyan', (settings.accent && settings.accent !== '#fb7185' && !warm) ? settings.accent : '#f472b6');
  root.style.setProperty('--accent-rose', settings.accent || '#f43f5e');
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
  if (document.getElementById('knitcat-extras-style')) return;
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
  /* ── contextual chrome: editor-only affordances hide off the CAD tab ── */
  body[data-tab]:not([data-tab="editor"]) #left-toolbar,
  body[data-tab]:not([data-tab="editor"]) .canvas-subbar{display:none}
  body:not([data-tab]) #left-toolbar{display:flex}
  /* ── (knit/fit parameters are no longer designer-gated — always visible) ── */
  .kx-admin-only{display:none}
  body.kx-admin-on .kx-admin-only{display:inline-flex}
  /* ── clothes catalogue nav: chunked categories, hover-reveal ── */
  .clothes-nav{display:flex;flex-direction:column;gap:2px;max-height:min(46vh,420px);overflow:auto;margin-top:8px}
  .clothes-cat-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted,#64748b);margin:10px 0 3px;padding-left:4px}
  .clothes-item{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:transparent;border:1px solid transparent;
    color:var(--text-secondary,#cbd5e1);padding:7px 9px;border-radius:8px;cursor:pointer;font-size:12px;transition:background .12s,border-color .12s,transform .08s}
  .clothes-item:hover{background:rgba(56,189,248,.1);border-color:var(--border-subtle,#1e293b);transform:translateX(2px)}
  .clothes-item.active{background:rgba(244,114,182,.16);border-color:var(--accent-cyan,#f472b6);color:#fff}
  .clothes-item-icon{font-size:15px;width:18px;text-align:center}
  .clothes-blurb{font-size:10px;color:#64748b;line-height:1.5;margin:0 0 10px}
  .clothes-params{display:flex;flex-direction:column}
  /* ── feasibility advisor modal ── */
  .kx-feas{width:min(680px,94vw);max-height:86vh;overflow:auto;background:#0f1a2e;border:1px solid #24406e;border-radius:16px;
    box-shadow:0 30px 70px rgba(0,0,0,.6);color:#e2e8f0;padding:22px;align-self:flex-start;margin-top:10vh}
  .kx-feas-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .kx-feas-top h2{margin:0;font-size:20px}
  .kx-feas-badge{font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px;border:1px solid}
  .kx-feas-badge.kx-feas-feasible{color:#34d399;border-color:#34d399;background:rgba(52,211,153,.12)}
  .kx-feas-badge.kx-feas-needs-attention{color:#fbbf24;border-color:#fbbf24;background:rgba(251,191,36,.12)}
  .kx-feas-badge.kx-feas-not-feasible{color:#f43f5e;border-color:#f43f5e;background:rgba(244,63,94,.12)}
  .kx-feas-sub{font-size:12px;opacity:.6;margin:6px 0 16px}
  .kx-feas-list{display:flex;flex-direction:column;gap:10px}
  .kx-feas-card{background:#0c1526;border:1px solid #1e2f4d;border-left-width:3px;border-radius:11px;padding:12px 14px}
  .kx-feas-card.kx-feas-ok{border-left-color:#34d399}
  .kx-feas-card.kx-feas-info{border-left-color:#38bdf8}
  .kx-feas-card.kx-feas-warn{border-left-color:#fbbf24}
  .kx-feas-card.kx-feas-error{border-left-color:#f43f5e}
  .kx-feas-head{display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:4px}
  .kx-feas-dot{width:8px;height:8px;border-radius:50%;background:currentColor;opacity:.7}
  .kx-feas-prob{font-size:12.5px;line-height:1.5;color:#cbd5e1}
  .kx-feas-phil{font-size:11px;font-style:italic;color:#64748b;margin-top:6px}
  .kx-feas-fix{margin-top:10px;background:rgba(56,189,248,.14);border:1px solid #2f5fa0;color:#bae6fd;border-radius:8px;
    padding:6px 12px;font-size:12px;cursor:pointer;transition:background .12s}
  .kx-feas-fix:hover{background:rgba(56,189,248,.28)}
  .kx-feas-foot{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}
  /* ── machine intelligence: score, tabs, chips, universe matrix ── */
  .kx-feas-topright{display:flex;align-items:center;gap:12px}
  .kx-feas-tabs{display:flex;gap:4px;margin:14px 0 4px;border-bottom:1px solid #24406e}
  .kx-feas-tab{background:transparent;border:0;border-bottom:2px solid transparent;color:#94a3b8;
    padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
  .kx-feas-tab:hover{color:#e2e8f0}
  .kx-feas-tab.active{color:#bae6fd;border-bottom-color:#38bdf8}
  .kx-feas-body{padding-top:8px}
  .kx-score{position:relative;display:inline-block;width:120px;height:14px;border-radius:999px;
    background:#0c1526;border:1px solid #24406e;overflow:hidden;vertical-align:middle}
  .kx-score-fill{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#0ea5e9,#34d399);transition:width .25s ease}
  .kx-score>span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    font-size:10px;font-weight:700;color:#e2e8f0;font-family:var(--font-mono,monospace)}
  .kx-feas-narr{background:#0c1526;border:1px solid #1e2f4d;border-left:3px solid #38bdf8;border-radius:10px;
    padding:10px 13px;font-size:13px;line-height:1.6;color:#cbd5e1;margin:0 0 12px}
  .kx-feas-narr-label,.kx-unv-spec .kx-feas-narr-label{font-size:9px;font-weight:700;text-transform:uppercase;
    letter-spacing:.08em;color:#64748b;margin-bottom:4px}
  .kx-feas-narr-label{margin-bottom:4px}
  .kx-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
  .kx-chip{font-size:11px;color:#bae6fd;background:rgba(56,189,248,.1);border:1px solid #2f5fa0;
    border-radius:999px;padding:2px 9px;white-space:nowrap}
  .kx-feas-cat{margin-left:8px;font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;
    border:1px solid #1e2f4d;border-radius:6px;padding:1px 6px}
  .kx-unv-counts{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  .kx-unv-count{font-size:12px;font-weight:700;padding:4px 11px;border-radius:999px;border:1px solid}
  .kx-unv-ok{color:#34d399;border-color:#34d399;background:rgba(52,211,153,.12)}
  .kx-unv-warn{color:#fbbf24;border-color:#fbbf24;background:rgba(251,191,36,.12)}
  .kx-unv-bad{color:#f43f5e;border-color:#f43f5e;background:rgba(244,63,94,.12)}
  .kx-unv-spec{margin:0 0 12px;padding-bottom:12px;border-bottom:1px solid #1e2f4d}
  .kx-unv-list{display:flex;flex-direction:column;gap:8px}
  .kx-unv-row{display:flex;align-items:center;gap:12px;background:#0c1526;border:1px solid #1e2f4d;
    border-left-width:3px;border-radius:10px;padding:10px 12px}
  .kx-unv-row.kx-unv-feasible{border-left-color:#34d399}
  .kx-unv-row.kx-unv-needs-attention{border-left-color:#fbbf24}
  .kx-unv-row.kx-unv-not-feasible{border-left-color:#f43f5e}
  .kx-unv-main{flex:1 1 auto;min-width:0}
  .kx-unv-name{font-size:13px;font-weight:600;color:#e2e8f0;overflow-wrap:anywhere}
  .kx-unv-sub{font-size:11px;color:#64748b;overflow-wrap:anywhere;margin-top:2px}
  .kx-unv-acts{flex:0 0 auto;display:flex;align-items:center;gap:6px}
  .kx-unv-cur{font-size:11px;color:#64748b;font-style:italic;padding:0 4px}
  .kx-unv-foot{margin-top:14px}
  .kx-mini{border:1px solid #24406e;background:transparent;color:#94a3b8;border-radius:7px;padding:6px 10px;
    font-size:12px;cursor:pointer;font-family:inherit;flex:0 0 auto}
  .kx-mini:hover{color:#e2e8f0;border-color:#38bdf8;background:rgba(56,189,248,.12)}
  /* ── right-sidebar design-health panel ── */
  #kx-health-panel .kx-health-score b{font-size:22px;color:#e2e8f0;font-family:var(--font-mono,monospace)}
  #kx-health-panel .kx-health-score i{font-size:11px;color:#64748b;font-style:normal}
  .kx-health-ring{height:8px;border-radius:999px;background:#0c1526;border:1px solid #1e2f4d;overflow:hidden;margin:6px 0 8px}
  .kx-health-ring-fill{height:100%;width:100%;background:linear-gradient(90deg,#0ea5e9,#34d399);transition:width .3s ease,background .3s}
  .kx-health-ring-fill[data-sev="needs-attention"]{background:linear-gradient(90deg,#f59e0b,#fbbf24)}
  .kx-health-ring-fill[data-sev="not-feasible"]{background:linear-gradient(90deg,#be123c,#f43f5e)}
  .kx-health-meta{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11px;color:#94a3b8;margin-bottom:10px}
  .kx-health-label{font-weight:700;color:#e2e8f0}
  .kx-health-break{color:#64748b}
  .kx-health-fit{margin-left:auto;color:#7dd3fc;white-space:nowrap}
  .kx-health-acts{display:flex;gap:8px}
  .kx-health-acts .btn-action{flex:1 1 auto;justify-content:center}
  /* ── additive light theme (only active under html[data-theme="light"]) ── */
  html[data-theme="light"]{--bg-main:#eef2f7;--bg-surface:#ffffff;--bg-surface-elevated:#f1f5f9;--bg-panel:#f8fafc;
    --border-subtle:#dbe3ee;--text-primary:#0f172a;--text-secondary:#475569;--text-muted:#94a3b8}
  html[data-theme="light"] body{background:#eef2f7;color:#0f172a}
  html[data-theme="light"] header#main-header,html[data-theme="light"] #left-toolbar,
  html[data-theme="light"] #right-sidebar,html[data-theme="light"] .tab-bar,
  html[data-theme="light"] .sidebar-panel,html[data-theme="light"] .tanktop-sidebar{background:#fff;color:#0f172a}
  html[data-theme="light"] #viewport-workspace,html[data-theme="light"] .tab-content{background:#f8fafc}
  html[data-theme="light"] .brand-title,html[data-theme="light"] .tool-group-title{color:#0f172a}
  html[data-theme="light"] .tab-btn,html[data-theme="light"] .tool-btn,html[data-theme="light"] .btn-action{color:#334155}
  html[data-theme="light"] .btn-action{background:#fff;border-color:#dbe3ee}
  html[data-theme="light"] .canvas-subbar{background:rgba(255,255,255,.9);border-color:#dbe3ee}
  html[data-theme="light"] .num-input,html[data-theme="light"] .select-control{background:#fff;border-color:#dbe3ee;color:#0f172a}
  html[data-theme="light"] .instruction-step-card{background:#f8fafc;border-color:#dbe3ee}
  html[data-theme="light"] .instruction-step-text{color:#0f172a}
  html[data-theme="light"] .kx-modal{background:#fff;border-color:#fbcfe8;color:#1e293b}
  html[data-theme="light"] .kx-modal h2{color:#be185d}
  html[data-theme="light"] .kx-row input,html[data-theme="light"] .kx-row textarea{background:#fff;border-color:#e2e8f0;color:#0f172a}
  html[data-theme="light"] .kx-btn{color:#1e293b;border-color:#f9a8d4}
  html[data-theme="light"] .clothes-item{color:#334155}
  html[data-theme="light"] .clothes-item.active{color:#0f172a}
  .kx-egg{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:1350;
    background:linear-gradient(135deg,#7c3aed,#be185d);color:#fff;padding:10px 18px;border-radius:999px;
    font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;transition:opacity .3s,transform .3s;pointer-events:none}
  .kx-egg.show{opacity:1;transform:translateX(-50%) translateY(-6px)}
  /* ── responsive: these are overlays, so this layer owns their mobile shape ── */
  @media (pointer:coarse){
    .kx-hbtn{width:40px;height:40px;font-size:17px}
    .kx-row input,.kx-row textarea{font-size:16px;min-height:44px}   /* stops iOS zoom-to-focus */
    .kx-check{font-size:15px}
    .kx-menu-btn{min-height:44px}
  }
  @media (max-width:640px){
    .kx-backdrop{padding:0;align-items:stretch;justify-content:stretch}
    .kx-modal{width:100%;max-width:100%;max-height:none;border-radius:0;border:0;padding:18px 16px
      calc(24px + env(safe-area-inset-bottom))}
    .kx-modal h2{font-size:18px}
    .kx-actions{flex-wrap:wrap;margin-top:14px}
    .kx-btn{flex:1 1 44%;min-height:46px}
    .kx-feas{width:100%;max-width:100%;max-height:none;margin:0;align-self:stretch;border-radius:0;border:0;
      padding:16px 14px calc(22px + env(safe-area-inset-bottom))}
    .kx-feas-top{flex-wrap:wrap;align-items:flex-start}
    .kx-feas-top h2{font-size:17px}
    .kx-feas-fix{min-height:44px;width:100%}
    .kx-feas-foot{flex-wrap:wrap}
    .clothes-nav{max-height:min(38dvh,300px)}
    /* The Studio dropdown becomes a bottom sheet: never clipped by a screen edge. */
    .kx-menu-drop{position:fixed;left:8px;right:8px;top:auto;bottom:calc(8px + env(safe-area-inset-bottom));
      min-width:0;padding:8px}
    .kx-menu-item{min-height:48px}
    .kx-letter{padding:22px 16px calc(22px + env(safe-area-inset-bottom))}
    .kx-letter .inner{max-width:100%}
    .kx-egg{bottom:calc(18px + env(safe-area-inset-bottom));font-size:13px;padding:9px 14px;max-width:88vw}
  }
  @media (max-height:560px){
    .kx-modal{padding:14px}
    .kx-letter h1{font-size:clamp(22px,6vh,34px);margin-bottom:10px}
    .kx-letter p{font-size:clamp(13px,2.6vh,17px);line-height:1.55}
  }
  @media (hover:none){
    .kx-hbtn:hover{transform:none}
    .clothes-item:hover{transform:none}
    .kx-menu-item:active,.kx-btn:active{filter:brightness(1.2)}
  }
  `;
  const el = document.createElement('style');
  el.id = 'knitcat-extras-style';
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

  const aboutBtn = mkBtn('♥', 'About KNITCAT', () => openAbout());
  const gearBtn = mkBtn('⚙', 'Settings', () => openSettings());
  gearBtn.classList.add('kx-admin-only'); // only the designer can see the gear
  const themeBtn = mkBtn('☾', 'Switch to light', () => toggleTheme());
  themeBtn.id = 'kx-theme';
  brand.appendChild(aboutBtn);
  brand.appendChild(themeBtn);
  brand.appendChild(gearBtn);

  updateAdminChrome();
  window.addEventListener('knit:admin', updateAdminChrome);
  refreshGreeting();
}

/**
 * The gear (where the anniversary / photo / message live) stays invisible until
 * the hidden designer key unlocks — so the gift's surface is just a clean tool.
 */
function updateAdminChrome() {
  const admin = !!window.__knitAdmin;
  document.querySelectorAll('.kx-admin-only').forEach(el => {
    el.style.display = admin ? '' : 'none';
  });
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
      <h2>About KNITCAT ${ZODIAC.yours.glyph}\u2192${ZODIAC.his.glyph}</h2>
      <p>I built this for my CUTE SEXY PRETTY GORGEOUS BOYFRIEND.</p>
      <p>It's a real knitting-machine CAD/CAM studio \u2014 draw a punchcard pattern and the lace decompiler
      schedules the eyelets and directional yarn transfers into carriage passes a single-bed Brother KH-830 can
      actually run, simulate the yarn in 3D, work out a beanie or a tank top to fit, and export DXF, G-code, SVG or
      1:1 printable cards.</p>
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
    } else if (buf.endsWith('beanie')) { egg('a beanie in \u2665 look in the Tailor tab'); buf = ''; }
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
  // Route through the shared sound bus (sound.js owns the single AudioContext and
  // the master 🔊/🔇 mute) so we never build a second oscillator stack / double-chime.
  if (!settings.soundOnExport) return;
  try { window.dispatchEvent(new CustomEvent('knit:fx', { detail: 'success' })); } catch (_) { /* ignore */ }
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
    if (closeDrawer()) return; // an open panel drawer always wins
    const letter = document.querySelector('.kx-letter');
    if (letter) { letter.remove(); return; }
    closeModal();
  });
}

/* ── narrow-screen chrome: the diagnostics sidebar becomes a drawer ──────── */

/** True when the layout is in its drawer tier (kept in sync with styles.css). */
function isDrawerMode() {
  try { return window.matchMedia('(max-width: 900px)').matches; } catch (_) { return false; }
}

/**
 * Phones have no room for a 320px diagnostics column, so the sidebar slides in
 * over the canvas when asked. Only ever adds a button — if the header or the
 * sidebar is missing, this does nothing at all.
 */
function buildMobileChrome() {
  const actions = document.querySelector('.header-actions');
  const sidebar = document.getElementById('right-sidebar');
  if (!actions || !sidebar || document.getElementById('kx-panels-btn')) return;

  const backdrop = document.createElement('div');
  backdrop.id = 'kx-drawer-backdrop';
  document.body.appendChild(backdrop);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'kx-panels-btn';
  btn.className = 'btn-action kx-panels-btn';
  btn.title = 'Machine diagnostics, gauge & quick exports';
  btn.setAttribute('aria-label', 'Toggle machine panel');
  btn.setAttribute('aria-controls', 'right-sidebar');
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2"><rect x="3" y="3" width="12" height="18" rx="2"/><path d="M15 9h6M15 15h6"/></svg>Panel';
  actions.insertBefore(btn, actions.firstChild);

  const paint = () => {
    const open = document.body.classList.contains('kx-drawer-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const setOpen = open => {
    document.body.classList.toggle('kx-drawer-open', open);
    paint();
  };
  drawerCloser = () => {
    if (!document.body.classList.contains('kx-drawer-open')) return false;
    setOpen(false);
    return true;
  };

  on(btn, 'click', e => {
    e.stopPropagation();
    setOpen(!document.body.classList.contains('kx-drawer-open'));
  });
  on(backdrop, 'click', () => setOpen(false));
  // Leaving the drawer tier (rotate, resize, un-split) must never trap it open.
  on(window, 'resize', () => { if (!isDrawerMode()) setOpen(false); });
  on(window, 'orientationchange', () => { if (!isDrawerMode()) setOpen(false); });
  // Let the main app dismiss the drawer when the user moves to another tab.
  window.knitcatMobile = { closeDrawer: () => drawerCloser(), isDrawerMode };
  paint();
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
  try { buildMobileChrome(); } catch (_) { /* header keeps no drawer affordance */ }
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
