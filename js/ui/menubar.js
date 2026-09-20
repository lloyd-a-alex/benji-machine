/**
 * KNITCAT — the top application menu bar.
 *
 * A zero-dependency web app can still feel like a real desktop program, and the
 * fastest way to that feeling is a proper File / Edit / View … bar down the top.
 * This adds one, sitting above the engineering header, giving every deep tool a
 * discoverable home (the command palette stays the power-user route, but now there
 * is also a map you can read with your eyes).
 *
 * Design notes:
 *   - The menu *content* is the pure {@link buildMenus} — plain data listing each
 *     dropdown's items and the action id it triggers — asserted in
 *     `tests/menubar.test.mjs`. The DOM layer just renders it.
 *   - Every item funnels through ONE `deps.onSelect(id)` — the same dispatcher the
 *     right-click menu uses — so a command is implemented exactly once and the two
 *     surfaces can never drift.
 *   - Far left is a "‹ Projects Dashboard" back button (the top of the audit's
 *     "where am I / how do I get out" list); far right is a close (✕) that folds
 *     the bar away to reclaim vertical space, with a small ☰ tab to bring it back.
 *
 * Importing this module has no DOM side effects.
 *
 * @module ui/menubar
 */

const BAR_ID = 'kx-menubar';
const STYLE_ID = 'kx-menubar-style';
const HIDE_KEY = 'knitcat.menubar.hidden.v1';

/**
 * Every action id the menu bar can emit. The app implements this vocabulary in a
 * single `runCommand(id)` shared with the context menu; this set lets the tests
 * prove the menu only ever references actions that actually exist.
 */
export const MENUBAR_ACTIONS = new Set([
  'file.new', 'file.open', 'file.save', 'file.saveAs', 'file.export', 'file.close',
  'file.backup', 'file.restore', 'file.prefs',
  'edit.undo', 'edit.redo', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate',
  'edit.selectAll', 'edit.invert', 'edit.clear', 'edit.clipshelf',
  'view.fit', 'view.resetPanels', 'view.console', 'view.inspector', 'view.theme',
  'view.status', 'view.structure', 'view.systems',
  'project.dashboard', 'project.snapshot', 'project.rename', 'project.recent',
  'design.presets', 'design.math', 'design.image', 'design.knitalong', 'design.legend',
  'design.heritage',
  'machine.feasibility', 'machine.universe', 'machine.fitAll', 'machine.pick',
  'help.about', 'help.guide', 'help.eyelets', 'help.shortcuts', 'help.search', 'help.love'
]);

/**
 * The full menu model. Pure: pass optional flags (a live selection, undo available)
 * and it returns the menus with a couple of items disabled accordingly.
 * @param {object} [flags]
 * @param {boolean} [flags.canUndo]
 * @param {boolean} [flags.canRedo]
 * @param {boolean} [flags.hasSelection]
 * @returns {Array<{id:string,title:string,items:Array}>}
 */
export function buildMenus(flags = {}) {
  const sep = () => ({ sep: true });
  const sec = label => ({ section: label });
  const it = (label, action, extra = {}) => Object.assign({ label, action }, extra);
  const dis = b => (b ? {} : { disabled: true });

  return [
    {
      id: 'file', title: 'File',
      items: [
        it('New project', 'file.new', { shortcut: 'Ctrl N' }),
        it('Open Project Dashboard…', 'file.open', { shortcut: 'Ctrl ⇧ R' }),
        sep(),
        it('Save / snapshot into project', 'file.save', { shortcut: 'Ctrl S' }),
        it('Save Project file (.kcard)…', 'file.saveAs'),
        it('Export / CNC (DXF · G-code · PDF)…', 'file.export'),
        sep(),
        it('Back up everything (.kbak)…', 'file.backup'),
        it('Restore from backup…', 'file.restore'),
        it('Close project', 'file.close'),
        sep(),
        it('Preferences…', 'file.prefs')
      ]
    },
    {
      id: 'edit', title: 'Edit',
      items: [
        it('Undo', 'edit.undo', Object.assign({ shortcut: 'Ctrl Z' }, dis(flags.canUndo))),
        it('Redo', 'edit.redo', Object.assign({ shortcut: 'Ctrl Y' }, dis(flags.canRedo))),
        sep(),
        it('Cut', 'edit.cut', { shortcut: 'Ctrl X', ...dis(flags.hasSelection) }),
        it('Copy', 'edit.copy', { shortcut: 'Ctrl C', ...dis(flags.hasSelection) }),
        it('Paste', 'edit.paste', { shortcut: 'Ctrl V' }),
        it('Duplicate selection', 'edit.duplicate', { shortcut: 'Ctrl D', ...dis(flags.hasSelection) }),
        it('Clip shelf…', 'edit.clipshelf'),
        sep(),
        it('Select all', 'edit.selectAll'),
        it('Invert card', 'edit.invert'),
        it('Clear canvas', 'edit.clear', { danger: true })
      ]
    },
    {
      id: 'view', title: 'View',
      items: [
        it('Fit card to view', 'view.fit'),
        it('Recentre all panels', 'view.resetPanels'),
        sep(),
        it('Stitch inspector', 'view.inspector'),
        it('Card structure & analysis', 'view.structure'),
        it('Toggle console', 'view.console', { shortcut: 'Ctrl `' }),
        it('Systems status', 'view.systems'),
        sep(),
        it('Toggle light / dark theme', 'view.theme'),
        it('Status bar', 'view.status')
      ]
    },
    {
      id: 'project', title: 'Project',
      items: [
        it('Projects Dashboard (Studio)', 'project.dashboard', { shortcut: 'Ctrl ⇧ R' }),
        it('Snapshot current chart', 'project.snapshot'),
        it('Rename project…', 'project.rename'),
        it('Recent projects ▸', 'project.recent', { submenu: 'recent' })
      ]
    },
    {
      id: 'design', title: 'Design',
      items: [
        it('Preset library…', 'design.presets'),
        it('Math Studio…', 'design.math'),
        it('Image Dither…', 'design.image'),
        sep(),
        it('Knit-Along companion', 'design.knitalong'),
        it('Stitch-symbol legend', 'design.legend'),
        it('Textile heritage', 'design.heritage')
      ]
    },
    {
      id: 'machine', title: 'Machine',
      items: [
        it('Check machine feasibility', 'machine.feasibility'),
        it('Compare across all machines', 'machine.universe'),
        it('Make this card fit every machine', 'machine.fitAll'),
        sep(),
        it('Change machine profile…', 'machine.pick')
      ]
    },
    {
      id: 'help', title: 'Help',
      items: [
        it('Search commands…', 'help.search', { shortcut: 'Ctrl K' }),
        it('Lace carriage guide', 'help.guide'),
        it('Eyelets vs transfers explained', 'help.eyelets'),
        it('Keyboard shortcuts', 'help.shortcuts'),
        sep(),
        it('About KNITCAT', 'help.about'),
        it('Show the love letter ♥', 'help.love')
      ]
    }
  ];
}

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#kx-menubar{display:flex;align-items:center;gap:2px;flex-wrap:wrap;position:relative;z-index:60;
  min-height:34px;padding:0 8px;background:linear-gradient(180deg,var(--bg-surface-elevated),var(--bg-surface));
  border-bottom:1px solid var(--border-subtle);font:12px/1 var(--font-ui,system-ui,sans-serif);color:var(--text-primary)}
#kx-menubar[hidden]{display:none}
.kx-mb-dash{display:inline-flex;align-items:center;gap:6px;margin-right:8px;padding:6px 10px;border-radius:8px;
  border:1px solid var(--border-subtle);background:var(--bg-main);color:var(--text-primary);cursor:pointer;font-weight:600;
  white-space:nowrap;transition:border-color .15s,background .15s}
.kx-mb-dash:hover{border-color:var(--accent-cyan);background:color-mix(in srgb,var(--accent-cyan) 12%,transparent)}
.kx-mb-menu{position:relative}
.kx-mb-title{padding:7px 11px;border:0;background:transparent;color:var(--text-secondary);cursor:pointer;font:inherit;
  font-weight:600;border-radius:7px;letter-spacing:.01em}
.kx-mb-title:hover,.kx-mb-menu.open .kx-mb-title{background:color-mix(in srgb,var(--accent-cyan) 14%,transparent);color:var(--text-primary)}
.kx-mb-dropdown{position:absolute;top:calc(100% + 3px);left:0;min-width:236px;padding:6px;z-index:12000;
  background:var(--bg-surface,#0f1830);border:1px solid var(--border-subtle,#24406e);border-radius:12px;
  box-shadow:0 22px 55px -12px rgba(0,0,0,.75);display:none}
.kx-mb-menu.open .kx-mb-dropdown{display:block;animation:kxMbIn .1s ease}
.kx-mb-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:0;
  color:inherit;font:inherit;padding:8px 9px;border-radius:8px;cursor:pointer}
.kx-mb-item:hover:not([disabled]){background:color-mix(in srgb,var(--accent-cyan) 18%,transparent)}
.kx-mb-item[disabled]{opacity:.4;cursor:default}
.kx-mb-item--danger{color:#fca5b0}
.kx-mb-item .kx-mb-label{flex:1 1 auto;min-width:0}
.kx-mb-item .kx-mb-key{font:10px var(--font-mono,ui-monospace,monospace);color:var(--text-muted);flex:0 0 auto}
.kx-mb-sep{height:1px;margin:5px 6px;background:var(--border-subtle)}
.kx-mb-foot{display:flex;align-items:center;gap:8px;margin-left:auto}
.kx-mb-name{font-size:11px;color:var(--text-muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kx-mb-close{width:26px;height:26px;border-radius:7px;border:1px solid var(--border-subtle);background:var(--bg-main);
  color:var(--text-secondary);cursor:pointer;font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
.kx-mb-close:hover{color:#fca5b0;border-color:var(--accent-rose)}
.kx-mb-reopen{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:60;display:none;
  border:1px solid var(--border-subtle);border-top:0;border-radius:0 0 8px 8px;background:var(--bg-surface);
  color:var(--text-secondary);cursor:pointer;padding:2px 12px;font-size:11px}
#kx-menubar[data-hidden="1"] + .kx-mb-reopen,body.kx-mb-collapsed .kx-mb-reopen{display:block}
@keyframes kxMbIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media (pointer:coarse){.kx-mb-title{min-height:34px}.kx-mb-item{min-height:40px}}
@media (forced-colors:active){#kx-menubar,.kx-mb-dropdown{border-color:CanvasText}}
`;
  document.head.appendChild(style);
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/**
 * Mount the menu bar. Idempotent.
 * @param {object} deps
 * @param {(id:string)=>void} deps.onSelect   run a menu action id
 * @param {() => Array} [deps.getRecent]      recent project labels for the submenu
 * @param {() => object} [deps.flags]         {canUndo,canRedo,hasSelection}
 * @param {() => string} [deps.cardName]      current card name for the right cluster
 * @returns {object|null}
 */
export function createMenuBar(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function') return null;
  const onSelect = deps.onSelect || (() => {});
  injectStyles();

  let bar = doc.getElementById(BAR_ID);
  if (!bar) {
    bar = doc.createElement('div');
    bar.id = BAR_ID;
    bar.setAttribute('role', 'menubar');
    bar.setAttribute('aria-label', 'Application menu');
    const host = doc.getElementById('app-container');
    if (host && host.firstChild) host.insertBefore(bar, host.firstChild);
    else if (host) host.appendChild(bar);
    else doc.body.insertBefore(bar, doc.body.firstChild);
  }

  // A reopen tab for when the bar is folded away.
  let reopen = doc.querySelector('.kx-mb-reopen');
  if (!reopen) {
    reopen = doc.createElement('button');
    reopen.type = 'button';
    reopen.className = 'kx-mb-reopen';
    reopen.textContent = '☰ Menu';
    reopen.setAttribute('data-no-drag', '');
    doc.body.appendChild(reopen);
  }

  render();
  wireGlobal();
  return { render, refresh: render, show, hide, toggle: () => (bar.hidden ? show() : hide()) };

  function render() {
    const menus = buildMenus(typeof deps.flags === 'function' ? deps.flags() : {});
    bar.innerHTML = '';
    const dash = doc.createElement('button');
    dash.type = 'button';
    dash.className = 'kx-mb-dash';
    dash.setAttribute('data-no-drag', '');
    dash.setAttribute('data-ktip', 'Leave the editor and go back to your projects');
    dash.innerHTML = `<span aria-hidden="true">\u2039</span> Projects Dashboard`;
    dash.addEventListener('click', () => onSelect('project.dashboard'));
    bar.appendChild(dash);

    for (const menu of menus) {
      const wrap = doc.createElement('div');
      wrap.className = 'kx-mb-menu';
      wrap.setAttribute('role', 'none');
      const title = doc.createElement('button');
      title.type = 'button';
      title.className = 'kx-mb-title';
      title.setAttribute('role', 'menuitem');
      title.setAttribute('aria-haspopup', 'true');
      title.setAttribute('data-no-drag', '');
      title.textContent = menu.title;
      wrap.appendChild(title);

      const dd = doc.createElement('div');
      dd.className = 'kx-mb-dropdown';
      dd.setAttribute('role', 'menu');
      for (const item of menu.items) {
        if (item.sep) { const s = doc.createElement('div'); s.className = 'kx-mb-sep'; dd.appendChild(s); continue; }
        if (item.section) { const h = doc.createElement('div'); h.className = 'kx-mb-sep'; dd.appendChild(h); }
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'kx-mb-item' + (item.danger ? ' kx-mb-item--danger' : '');
        b.setAttribute('role', 'menuitem');
        if (item.disabled) b.disabled = true;
        const label = item.action === 'project.recent' && typeof deps.getRecent === 'function'
          ? `${item.label.replace(' ▸', '')} (${(deps.getRecent() || []).length})` : item.label;
        b.innerHTML = `<span class="kx-mb-label">${esc(label)}</span>${item.shortcut ? `<span class="kx-mb-key">${esc(item.shortcut)}</span>` : ''}`;
        b.addEventListener('click', () => { closeAll(); onSelect(item.action); });
        dd.appendChild(b);
      }
      wrap.appendChild(dd);

      title.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = wrap.classList.contains('open');
        closeAll();
        if (!wasOpen) wrap.classList.add('open');
      });
      bar.appendChild(wrap);
    }

    const foot = doc.createElement('div');
    foot.className = 'kx-mb-foot';
    const name = doc.createElement('span');
    name.className = 'kx-mb-name';
    name.textContent = (typeof deps.cardName === 'function' ? deps.cardName() : '') || '';
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'kx-mb-close';
    close.setAttribute('data-no-drag', '');
    close.setAttribute('data-ktip', 'Hide the menu bar (☰ at the top brings it back)');
    close.setAttribute('aria-label', 'Hide menu bar');
    close.innerHTML = '&#x2715;';
    close.addEventListener('click', hide);
    foot.append(name, close);
    bar.appendChild(foot);
  }

  function closeAll() { bar.querySelectorAll('.kx-mb-menu.open').forEach(m => m.classList.remove('open')); }
  function hide() { bar.hidden = true; try { localStorage.setItem(HIDE_KEY, '1'); } catch (_) {} doc.body.classList.add('kx-mb-collapsed'); }
  function show() { bar.hidden = false; reopen.style.display = 'none'; try { localStorage.setItem(HIDE_KEY, '0'); } catch (_) {} doc.body.classList.remove('kx-mb-collapsed'); }

  function wireGlobal() {
    if (bar.__kxWired) return;
    bar.__kxWired = true;
    reopen.addEventListener('click', show);
    doc.addEventListener('pointerdown', e => { if (!bar.contains(e.target)) closeAll(); }, true);
    doc.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
    try { if (localStorage.getItem(HIDE_KEY) === '1') hide(); } catch (_) { /* default shown */ }
  }
}
