/**
 * KNITCAT — context-aware right-click menus.
 *
 * A desktop CAD user expects the right button to be a conversation, not a browser
 * menu that knows nothing about knitting. This module installs one delegated
 * `contextmenu` handler that looks at *exactly* what is under the cursor — a needle
 * cell, a live selection, a tool button, a mode, a floating panel, a saved-project
 * card, a link, or selected text — and offers an exhaustive, situation-specific list
 * of actions. The canvas' own default menu is suppressed; everything routes through
 * here so right-clicking any of the ~200 controls always says something useful.
 *
 * The menu *content* is produced by the pure {@link menuFor} (given a context kind
 * and a few live flags it returns a list of action descriptors), which is asserted
 * in `tests/context-menu.test.mjs` without a browser. {@link initContextMenu} is the
 * thin DOM layer that classifies the target, renders the list and hands each chosen
 * `id` back to the app through `deps.onAction(id, ctx)` — so the module never has to
 * know how to punch a cell or open the Studio; it just asks for the action by name.
 *
 * Importing this module has no DOM side effects.
 *
 * @module ui/context-menu
 */

const MENU_ID = 'kx-ctxmenu';
const STYLE_ID = 'kx-ctxmenu-style';

// The full action vocabulary. Every entry the menus reference must appear here so
// `menuFor` output is verifiable and the app's dispatch has a contract to honour.
export const CONTEXT_ACTIONS = new Set([
  'cell.toggle', 'cell.punch', 'cell.blank', 'cell.copy', 'cell.fillRow', 'cell.fillCol',
  'sym.highlight', 'sym.explain',
  'edit.undo', 'edit.redo', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate',
  'edit.clearSelection', 'edit.delete', 'edit.selectAll', 'edit.invert', 'edit.fill',
  'edit.flipH', 'edit.flipV', 'edit.rotateCW', 'edit.rotateCCW',
  'clip.capture', 'clip.pasteMost',
  'view.resetPanels', 'view.console', 'view.fit',
  'win.close', 'win.dragReset', 'win.bringForward',
  'proj.open', 'proj.snapshot', 'proj.rename', 'proj.delete',
  'mode.set',
  'tool.set',
  'app.studio', 'app.newProject', 'app.save', 'app.export', 'app.feasibility',
  'app.universe', 'app.presets', 'app.math', 'app.image', 'app.settings', 'app.theme',
  'app.knitAlong', 'app.symbolLegend', 'app.structure', 'app.inspector', 'app.clipshelf',
  'app.search', 'app.clear',
  'link.copy', 'link.open', 'text.copy'
]);

/**
 * Build the list of items for a context. Pure — no DOM, no live values beyond the
 * `flags` you hand it — so it can be tested exhaustively.
 *
 * @param {string} kind  'cell'|'selection'|'canvas'|'panel'|'mode'|'tool'|'project'|'link'|'image'|'text'|'default'
 * @param {object} [flags]
 * @param {boolean} [flags.punched]      the cell under the cursor is punched
 * @param {boolean} [flags.hasClipboard] something is on the clipboard
 * @param {boolean} [flags.hasSelection] a marquee selection is live
 * @param {string}  [flags.mode]         the mode of a mode button ('lace'|'tuck'|…)
 * @param {string}  [flags.tool]         the tool id of a tool button
 * @param {string}  [flags.href]         the href of a link
 * @returns {Array<{id?:string,label?:string,section?:string,danger?:boolean,sep?:boolean,disabled?:boolean}>}
 */
export function menuFor(kind, flags = {}) {
  const sep = () => ({ sep: true });
  const sec = label => ({ section: label });

  switch (kind) {
    case 'cell':
      return [
        { id: 'cell.toggle', label: flags.punched ? 'Blank this needle' : 'Punch this needle' },
        { id: 'cell.punch', label: 'Punch', disabled: flags.punched },
        { id: 'cell.blank', label: 'Clear', disabled: !flags.punched },
        sep(),
        { id: 'cell.fillRow', label: 'Fill the whole row' },
        { id: 'cell.fillCol', label: 'Fill the whole column' },
        sec('This symbol'),
        { id: 'sym.highlight', label: 'Highlight every needle like this' },
        { id: 'sym.explain', label: 'Explain this stitch symbol' },
        sec('Clipboard'),
        { id: 'edit.copy', label: 'Copy selection' },
        { id: 'edit.paste', label: 'Paste here', disabled: !flags.hasClipboard },
        { id: 'clip.capture', label: 'Capture to clip shelf' }
      ];
    case 'selection':
      return [
        { id: 'edit.cut', label: 'Cut' },
        { id: 'edit.copy', label: 'Copy' },
        { id: 'edit.duplicate', label: 'Duplicate in place' },
        { id: 'clip.capture', label: 'Capture to clip shelf' },
        sep(),
        { id: 'edit.fill', label: 'Flood the selection' },
        { id: 'edit.clearSelection', label: 'Clear the selection' },
        { id: 'edit.delete', label: 'Delete selection' },
        sep(),
        { id: 'edit.rotateCW', label: 'Rotate ⟳' },
        { id: 'edit.rotateCCW', label: 'Rotate ⟲' },
        { id: 'edit.flipH', label: 'Flip horizontal' },
        { id: 'edit.flipV', label: 'Flip vertical' },
        sec('The whole card'),
        { id: 'sym.highlight', label: 'Highlight every symbol here' },
        { id: 'edit.selectAll', label: 'Select all' },
        { id: 'edit.invert', label: 'Invert card (punch ⇄ blank)' }
      ];
    case 'canvas':
      return [
        { id: 'edit.paste', label: 'Paste here', disabled: !flags.hasClipboard },
        { id: 'edit.selectAll', label: 'Select all' },
        { id: 'edit.invert', label: 'Invert card' },
        sep(),
        { id: 'view.resetPanels', label: 'Recentre all panels' },
        { id: 'app.search', label: 'Search commands…' },
        sec('This card'),
        { id: 'app.feasibility', label: 'Check machine feasibility' },
        { id: 'app.knitAlong', label: 'Walk me through it (Knit-Along)' },
        { id: 'app.clear', label: 'Clear the canvas', danger: true }
      ];
    case 'panel':
      return [
        { id: 'win.bringForward', label: 'Bring to front' },
        { id: 'win.dragReset', label: 'Snap back to its corner' },
        { id: 'view.resetPanels', label: 'Recentre every panel' },
        sep(),
        { id: 'win.close', label: 'Close this panel', danger: true }
      ];
    case 'mode':
      return [
        { id: 'mode.set', label: `Switch to ${labelMode(flags.mode)} mode` },
        { id: 'app.feasibility', label: 'Check this pattern' }
      ];
    case 'tool':
      return [
        { id: 'tool.set', label: `Use the ${flags.tool || 'this'} tool` },
        { id: 'app.search', label: 'Find another tool…' }
      ];
    case 'project':
      return [
        { id: 'proj.open', label: 'Open project' },
        { id: 'proj.snapshot', label: 'Snapshot the canvas into it' },
        { id: 'proj.rename', label: 'Rename…' },
        sep(),
        { id: 'proj.delete', label: 'Delete project', danger: true }
      ];
    case 'link':
      return [
        { id: 'link.open', label: 'Open link' },
        { id: 'link.copy', label: 'Copy link address' }
      ];
    case 'image':
      return [{ id: 'app.image', label: 'Dither this image into a card' }];
    case 'text':
      return [{ id: 'text.copy', label: 'Copy' }];
    default:
      return [
        { id: 'app.newProject', label: 'New project' },
        { id: 'app.studio', label: 'Open the Projects Dashboard' },
        { id: 'app.save', label: 'Save / snapshot' },
        { id: 'app.export', label: 'Export / CNC' },
        sep(),
        { id: 'app.search', label: 'Search commands…' },
        { id: 'app.feasibility', label: 'Check machine feasibility' },
        { id: 'app.settings', label: 'Preferences…' },
        { id: 'view.console', label: 'Toggle console' }
      ];
  }
}

function labelMode(mode) {
  return ({ lace: 'Lace', fair_isle: 'Fair Isle', tuck: 'Tuck', slip: 'Slip' })[mode] || (mode || 'this');
}

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.kx-ctx{position:fixed;z-index:13000;min-width:210px;max-width:320px;padding:6px;
  background:var(--bg-surface,#0f1830);border:1px solid var(--border-subtle,#24406e);border-radius:12px;
  color:var(--text-primary,#e6edf7);font:12.5px/1.4 var(--font-ui,system-ui,sans-serif);
  box-shadow:0 22px 55px -12px rgba(0,0,0,.75),0 0 0 1px color-mix(in srgb,var(--accent-cyan,#38bdf8) 12%,transparent);
  animation:kxCtxIn .1s ease}
.kx-ctx[hidden]{display:none}
.kx-ctx-sep{height:1px;margin:5px 6px;background:var(--border-subtle,#1c2f4d)}
.kx-ctx-sec{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted,#64748b);padding:7px 9px 3px}
.kx-ctx-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:transparent;border:0;
  color:inherit;font:inherit;padding:7px 9px;border-radius:8px;cursor:pointer}
.kx-ctx-item:hover:not([disabled]){background:color-mix(in srgb,var(--accent-cyan,#38bdf8) 18%,transparent)}
.kx-ctx-item[disabled]{opacity:.4;cursor:default}
.kx-ctx-item--danger{color:#fca5b0}
.kx-ctx-item--danger:hover{background:color-mix(in srgb,var(--accent-rose,#f43f5e) 18%,transparent)}
.kx-ctx-item .kx-ctx-glyph{width:16px;text-align:center;opacity:.8;flex:0 0 auto}
.kx-ctx-item .kx-ctx-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kx-ctx-item .kx-ctx-key{font:10px var(--font-mono,ui-monospace,monospace);color:var(--text-muted,#64748b);flex:0 0 auto}
@keyframes kxCtxIn{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.kx-ctx{animation:none}}
@media (forced-colors:active){.kx-ctx{border-color:CanvasText}}
`;
  document.head.appendChild(style);
}

const KEY_HINTS = { 'edit.undo': 'Ctrl Z', 'edit.redo': 'Ctrl Y', 'edit.copy': 'Ctrl C', 'edit.paste': 'Ctrl V', 'edit.cut': 'Ctrl X', 'app.search': 'Ctrl K', 'app.studio': 'Ctrl ⇧ R' };

/**
 * Classify an event target into a context kind + the flags menuFor needs. Kept
 * separate from rendering so the "what did I right-click?" decision is unit-testable
 * against a real DOM in the browser and simple to reason about.
 * @param {Element} target
 * @param {object} getters
 * @returns {{kind:string, flags:object, anchor:Element}}
 */
function classify(target, getters) {
  const near = sel => target.closest && target.closest(sel);
  const ed = getters.getEditor && getters.getEditor();
  const hasSelection = !!(ed && ed.selectionActive && ed.selectionActive());
  const hasClipboard = !!(ed && ed.clipboard && (Array.isArray(ed.clipboard) ? ed.clipboard.length : Object.keys(ed.clipboard).length));
  if (near('.kx-proj,[data-open],[data-project]')) return { kind: 'project', flags: {}, anchor: near('.kx-proj') };
  if (near('.mode-btn')) return { kind: 'mode', flags: { mode: near('.mode-btn').dataset.mode }, anchor: near('.mode-btn') };
  if (near('.tool-btn')) return { kind: 'tool', flags: { tool: near('.tool-btn').dataset.tool || near('.tool-btn').getAttribute('aria-label') }, anchor: near('.tool-btn') };
  if (near('.kx-panel,.kx-studio,.modal-card')) return { kind: 'panel', flags: {}, anchor: near('.kx-panel,.kx-studio,.modal-card') };
  const a = near('a[href]');
  if (a) return { kind: 'link', flags: { href: a.href }, anchor: a };
  const canvas = near('canvas');
  if (canvas) {
    const hc = ed && ed.hoverCell;
    const punched = hc && hc.r >= 0 && ed.matrix && isTruthy(ed.matrix[hc.r][hc.c]);
    return { kind: hasSelection ? 'selection' : 'cell', flags: { punched: !!punched, hasClipboard }, anchor: canvas };
  }
  if (target.tagName === 'IMG') return { kind: 'image', flags: {}, anchor: target };
  if (typeof window !== 'undefined' && window.getSelection && String(window.getSelection()).length) return { kind: 'text', flags: {}, anchor: target };
  if (near('.btn-action,.kx-btn,button')) return { kind: 'default', flags: {}, anchor: near('button') };
  return { kind: 'default', flags: {}, anchor: target };
}

function isTruthy(v) { return v !== 0 && v !== false && v != null && v !== '' && v !== 'EMPTY'; }

/**
 * Mount the right-click menu layer.
 * @param {object} deps
 * @param {(id:string, ctx:object) => void} deps.onAction  run a chosen action id
 * @param {() => any} [deps.getEditor]
 * @returns {{close:Function,destroy:Function}|null}
 */
export function initContextMenu(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function') return null;
  injectStyles();
  const getters = { getEditor: deps.getEditor || (() => null) };
  const onAction = deps.onAction || (() => {});
  let menu = null;
  let lastCtx = null;

  function closeMenu() {
    if (menu) { menu.remove(); menu = null; }
    lastCtx = null;
  }

  function openMenu(x, y, kind, flags, anchor) {
    closeMenu();
    const items = menuFor(kind, flags);
    menu = doc.createElement('div');
    menu.className = 'kx-ctx';
    menu.id = MENU_ID;
    menu.setAttribute('role', 'menu');
    for (const it of items) {
      if (it.sep) { const s = doc.createElement('div'); s.className = 'kx-ctx-sep'; menu.appendChild(s); continue; }
      if (it.section) { const h = doc.createElement('div'); h.className = 'kx-ctx-sec'; h.textContent = it.section; menu.appendChild(h); continue; }
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'kx-ctx-item' + (it.danger ? ' kx-ctx-item--danger' : '');
      b.setAttribute('role', 'menuitem');
      if (it.disabled) b.disabled = true;
      b.innerHTML = `<span class="kx-ctx-glyph" aria-hidden="true">${it.danger ? '\u2711' : '\u00B7'}</span>`
        + `<span class="kx-ctx-label">${escapeHtml(it.label)}</span>`
        + (KEY_HINTS[it.id] ? `<span class="kx-ctx-key">${KEY_HINTS[it.id]}</span>` : '');
      b.addEventListener('click', () => {
        closeMenu();
        try { onAction(it.id, Object.assign({ anchor, kind, flags }, lastCtx || {})); } catch (_) { /* contained */ }
      });
      menu.appendChild(b);
    }
    doc.body.appendChild(menu);
    // Place inside the viewport.
    const r = menu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - r.width - 8);
    const py = Math.min(y, window.innerHeight - r.height - 8);
    menu.style.left = Math.max(6, px) + 'px';
    menu.style.top = Math.max(6, py) + 'px';
    menu.querySelector('.kx-ctx-item:not([disabled])')?.focus({ preventScroll: true });
  }

  function onContext(e) {
    // Let the browser menu work inside text inputs unless it is the canvas.
    const inField = e.target.closest && e.target.closest('input[type=text],input[type=search],textarea');
    const { kind, flags, anchor } = classify(e.target, getters);
    if (inField && kind === 'text') return; // keep native copy in a text field
    e.preventDefault();
    if (kind === 'cell' || kind === 'selection') {
      const ed = getters.getEditor && getters.getEditor();
      const hc = ed && ed.hoverCell;
      lastCtx = { cell: hc && hc.r >= 0 ? { r: hc.r, c: hc.c } : null };
    } else {
      lastCtx = null;
    }
    openMenu(e.clientX, e.clientY, kind, flags, anchor);
    const dismiss = ev => { if (menu && !menu.contains(ev.target)) { cleanup(); } };
    const onKey = ev => { if (ev.key === 'Escape') { cleanup(); } };
    function cleanup() { closeMenu(); doc.removeEventListener('pointerdown', dismiss, true); doc.removeEventListener('keydown', onKey, true); window.removeEventListener('blur', cleanup); }
    doc.addEventListener('pointerdown', dismiss, true);
    doc.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', cleanup);
  }

  doc.addEventListener('contextmenu', onContext);
  return {
    close: closeMenu,
    destroy() { doc.removeEventListener('contextmenu', onContext); closeMenu(); }
  };
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
