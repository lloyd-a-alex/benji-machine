/**
 * KNITCAT — shared UI kit.
 *
 * One design language for the floating docks, HUDs and modals the feature modules
 * mount. Before this, `clip-shelf`, `structure-panel` and `stitch-inspector` each
 * re-injected their own copy of the same surface (the same blur, border, radius,
 * shadow, font, uppercase section labels, action buttons, list rows, chips and
 * close button) with slightly different magic numbers, which is exactly what made
 * the app read as patchwork rather than a product. They now share the primitives
 * below, so every dock looks and behaves like its neighbours and there is a single
 * place to restyle a surface.
 *
 * The stylesheet is injected lazily by {@link ensureKitStyles}, never at import
 * time, so importing this module in Node (the module-graph contract) has no DOM
 * side effects. Colours come from the `:root` design tokens in css/styles.css.
 *
 * @module ui/kit
 */

import { logger } from '../core/logging.js';

const log = logger('ui/kit');

const STYLE_ID = 'kx-kit-style';
let injected = false;

/** Escape a value for safe interpolation into an innerHTML template. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

/**
 * Inject the shared kit stylesheet exactly once. Idempotent and never throws into
 * boot — a module that cannot style itself should still function.
 */
export function ensureKitStyles() {
  if (injected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) { injected = true; return; }
  try {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = KIT_CSS;
    document.head.appendChild(style);
    injected = true;
  } catch (err) {
    injected = true; // unstyled but functional beats throwing into boot
    log.debug('the shared UI kit stylesheet failed to inject — docks stay unstyled but functional', { error: err?.message });
  }
}

/**
 * Build the standard floating-dock shell (header bar + scroll body + optional foot)
 * with the shared chrome, so a caller only supplies its own body content.
 *
 * The close button carries both `data-act="close"` and `data-close`, so a caller
 * can wire either convention.
 *
 * @param {object} opts
 * @param {string} opts.id               Element id for the panel.
 * @param {string} opts.title             Header text.
 * @param {string} [opts.glyph]           Emoji/symbol shown before the title.
 * @param {string} [opts.pos='br']        Dock corner: 'br' | 'tr' | 'bl' | 'tl'.
 * @param {boolean} [opts.stat=true]      Include the right-aligned `[data-count]` slot.
 * @param {string} [opts.actionsHtml]     Buttons to place before the close button.
 * @param {string} [opts.footHtml]        Footer markup (omit for no footer).
 * @param {string} [opts.className='']    Extra classes for panel-specific layout.
 * @param {string} [opts.ariaLabel]       Accessible name (defaults to title).
 * @returns {{ panel: HTMLElement, body: HTMLElement, close: HTMLElement }}
 */
export function buildPanel(opts = {}) {
  const {
    id, title = '', glyph = '', pos = 'br', stat = true,
    actionsHtml = '', footHtml = '', className = '', ariaLabel
  } = opts;
  ensureKitStyles();
  const panel = document.createElement('section');
  if (id) panel.id = id;
  panel.className = ['kx-panel', `kx-panel--${pos}`, className].filter(Boolean).join(' ');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', ariaLabel || title.replace(/[^\w\s-]/g, '').trim() || 'panel');
  panel.hidden = true;
  panel.innerHTML = `
    <header class="kx-panel__bar">
      <div class="kx-panel__title">${glyph ? `<span class="kx-panel__glyph" aria-hidden="true">${glyph}</span>` : ''}${esc(title)}</div>
      ${stat ? '<div class="kx-panel__stat" data-count></div>' : ''}
      <div class="kx-panel__actions">${actionsHtml}
        <button type="button" class="kx-btn kx-btn--ghost kx-panel__close" data-act="close" data-close title="Close" aria-label="Close ${esc(title)}">&#x2715;</button>
      </div>
    </header>
    <div class="kx-panel__body"></div>
    ${footHtml ? `<footer class="kx-panel__foot">${footHtml}</footer>` : ''}`;
  return {
    panel,
    body: panel.querySelector('.kx-panel__body'),
    close: panel.querySelector('.kx-panel__close')
  };
}

/**
 * A small labelled uppercase section header used inside a dock body.
 * @param {string} label
 * @param {string} [sub] Faint trailing hint (kept normal-case).
 */
export function sectionHeading(label, sub = '') {
  return `<h3 class="kx-panel__h3">${esc(label)}${sub ? ` <span class="kx-panel__sub">${esc(sub)}</span>` : ''}</h3>`;
}

/** The one stylesheet every dock shares. Token-driven so all surfaces agree. */
const KIT_CSS = `
.kx-panel{position:fixed;z-index:9000;display:flex;flex-direction:column;
  background:var(--panel-bg);backdrop-filter:blur(var(--panel-blur));-webkit-backdrop-filter:blur(var(--panel-blur));
  color:var(--panel-text);border:1px solid var(--panel-border);border-radius:var(--radius-xl);
  box-shadow:var(--shadow-float);font:13px/1.5 var(--font-ui);overflow:hidden;max-width:calc(100vw - 24px)}
.kx-panel--br{right:14px;bottom:14px}
.kx-panel--tr{right:14px;top:132px}
.kx-panel--bl{left:14px;bottom:14px}
.kx-panel--tl{left:14px;top:132px}
.kx-panel__bar{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--panel-hairline);
  background:var(--panel-bar-bg);position:sticky;top:0;z-index:1}
.kx-panel__title{font-weight:700;font-size:13px;display:flex;align-items:center;gap:7px;white-space:nowrap}
.kx-panel__glyph{opacity:.9}
.kx-panel__stat{margin-left:auto;font-size:11px;color:var(--panel-faint);white-space:nowrap;font-variant-numeric:tabular-nums}
.kx-panel__actions{display:flex;align-items:center;gap:6px}
.kx-panel__body{overflow-y:auto;padding:6px 12px}
.kx-panel__foot{padding:7px 12px;border-top:1px solid var(--panel-hairline);font-size:10.5px;color:var(--panel-faint)}
.kx-panel__h3{margin:9px 2px 5px;font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--panel-muted);
  font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:6px}
.kx-panel__sub{text-transform:none;letter-spacing:0;color:var(--panel-faint);font-weight:400}
/* The generic component names below (.kx-btn/.kx-row/.kx-chip/.kx-tag/...) are
   deliberately scoped to our own surfaces. The legacy romance modals in
   js/features/extras.js define their own global .kx-btn/.kx-row/.kx-chip with a
   different (magenta) theme; pinning ours to :is(.kx-panel,.kx-hud) gives them
   higher specificity so a dock always wins on its own elements, whatever order the
   two stylesheets are injected in — and stops our rules leaking onto the modals. */
:is(.kx-panel,.kx-hud) .kx-btn{background:var(--btn-bg);border:1px solid var(--btn-border);color:var(--btn-text);border-radius:8px;
  padding:4px 10px;font:inherit;font-size:11.5px;cursor:pointer;transition:background .15s,border-color .15s,transform .1s}
:is(.kx-panel,.kx-hud) .kx-btn:hover{background:var(--btn-bg-hover);border-color:var(--accent)}
:is(.kx-panel,.kx-hud) .kx-btn:active{transform:scale(.96)}
:is(.kx-panel,.kx-hud) .kx-btn--primary{background:var(--accent);border-color:var(--accent);color:#08101f;font-weight:600}
:is(.kx-panel,.kx-hud) .kx-btn--primary:hover{filter:brightness(1.08)}
:is(.kx-panel,.kx-hud) .kx-btn--ghost{background:transparent;border-color:transparent;color:var(--panel-muted)}
:is(.kx-panel,.kx-hud) .kx-btn--ghost:hover{background:var(--btn-bg);color:var(--panel-text)}
:is(.kx-panel,.kx-hud) .kx-btn--danger{color:#fca5b0;border-color:rgba(244,63,94,.4)}
.kx-panel__close{padding:2px 6px;font-size:14px;line-height:1}
:is(.kx-panel,.kx-hud) .kx-iconbtn{width:26px;height:26px;border-radius:7px;border:1px solid var(--btn-border);background:var(--btn-bg);
  color:var(--btn-text);cursor:pointer;font-size:12px;line-height:1;display:inline-flex;align-items:center;justify-content:center;
  transition:transform .1s,border-color .15s}
:is(.kx-panel,.kx-hud) .kx-iconbtn:hover{transform:translateY(-1px);border-color:var(--accent)}
:is(.kx-panel,.kx-hud) .kx-iconbtn--paste{color:#8ff0b3;border-color:#265a3a}
:is(.kx-panel,.kx-hud) .kx-iconbtn--save{color:#f5d68a;border-color:#5a4a26}
:is(.kx-panel,.kx-hud) .kx-iconbtn--delete{color:#f0a6b0;border-color:#5a2630}
:is(.kx-panel,.kx-hud) .kx-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
:is(.kx-panel,.kx-hud) .kx-row{display:flex;align-items:center;gap:8px;background:rgba(2,6,23,.4);border:1px solid var(--panel-hairline);
  border-radius:10px;padding:7px 9px}
:is(.kx-panel,.kx-hud) .kx-row__info{min-width:0;flex:1 1 auto;display:flex;flex-direction:column}
:is(.kx-panel,.kx-hud) .kx-row__name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
:is(.kx-panel,.kx-hud) .kx-row__meta{font-size:11px;color:var(--panel-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
:is(.kx-panel,.kx-hud) .kx-row__actions{display:flex;gap:4px;flex:0 0 auto}
:is(.kx-panel,.kx-hud) .kx-empty{color:var(--panel-faint);font-size:12px;padding:6px 4px;font-style:italic}
:is(.kx-panel,.kx-hud) .kx-chip{background:var(--btn-bg);border:1px solid var(--btn-border);color:var(--btn-text);border-radius:6px;padding:1px 7px;font-size:11px}
:is(.kx-panel,.kx-hud) .kx-chip--up{color:#8ff0b3;border-color:#265a3a}
:is(.kx-panel,.kx-hud) .kx-chip--down{color:#ffb3b8;border-color:#5a262b}
:is(.kx-panel,.kx-hud) .kx-tag{font-size:10px;text-transform:uppercase;letter-spacing:.5px;padding:1px 7px;border-radius:20px;border:1px solid var(--btn-border);color:var(--panel-muted)}
:is(.kx-panel,.kx-hud) .kx-tag--on{color:#0d1017;background:var(--accent-emerald);border-color:var(--accent-emerald)}
:is(.kx-panel,.kx-hud) .kx-tag--off{color:#0d1017;background:#64748b;border-color:#64748b}
:is(.kx-panel,.kx-hud) .kx-input{width:64px;background:var(--bg-inset);border:1px solid var(--btn-border);color:var(--panel-text);border-radius:6px;padding:3px 6px;font:inherit;font-size:12px}
:is(.kx-panel,.kx-hud) .kx-input:focus-visible{outline:none;border-color:var(--accent)}
:is(.kx-panel,.kx-hud) .kx-numlist{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
:is(.kx-panel,.kx-hud) .kx-numlist label{display:flex;flex-direction:column;font-size:10px;color:var(--panel-muted);gap:2px}
.kx-hud{position:fixed;left:12px;bottom:12px;z-index:9000;max-width:320px;pointer-events:none;
  background:var(--panel-bg);backdrop-filter:blur(var(--panel-blur));-webkit-backdrop-filter:blur(var(--panel-blur));
  color:var(--panel-text);border:1px solid var(--panel-border);border-radius:var(--radius-lg);padding:10px 12px;
  font:12.5px/1.45 var(--font-ui);box-shadow:var(--shadow-float)}
.kx-hud__pos{color:var(--accent);font-weight:600;letter-spacing:.2px;font-variant-numeric:tabular-nums}
.kx-hud__name{font-size:14px;font-weight:700;margin-bottom:3px}
.kx-hud__does{color:var(--panel-muted);margin-bottom:7px}
.kx-hud__row{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px}
@media (max-width:640px){ .kx-panel--br,.kx-panel--bl{right:8px;left:8px;width:auto!important} }
`;
