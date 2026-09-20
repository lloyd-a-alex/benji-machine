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

import { escHtml } from './text.js';
// The Chart/Select vocabulary lives in one place (js/ui/chart-commands.js). Importing
// the id tables here means the two new menus can never advertise an action the
// dispatcher does not answer, and the "no dead commands" test stays honest as the
// command set grows — there is no second list to keep in step.
import { CHART_COMMAND_IDS, SELECT_COMMAND_IDS } from './chart-commands.js';

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
  'project.dashboard', 'project.snapshot', 'project.rename', 'project.recent', 'project.open',
  'design.presets', 'design.math', 'design.image', 'design.knitalong', 'design.legend',
  'design.heritage',
  // KNITCAT V2 — the six fused systems, mounted as runtime `.kv2-` docks.
  'v2.project', 'v2.knitscript', 'v2.fit', 'v2.yarn', 'v2.compiler', 'v2.compile',
  'v2.reverse', 'v2.production', 'v2.launcher', 'v2.closeAll',
  'machine.feasibility', 'machine.universe', 'machine.fitAll', 'machine.pick',
  'help.about', 'help.guide', 'help.eyelets', 'help.shortcuts', 'help.search', 'help.love',
  // Every chart-row/column/transform/region/matrix verb and every selection verb.
  ...CHART_COMMAND_IDS,
  ...SELECT_COMMAND_IDS
]);

/**
 * The full menu model. Pure: pass optional flags (a live selection, undo available)
 * and it returns the menus with a couple of items disabled accordingly.
 * @param {object} [flags]
 * @param {boolean} [flags.canUndo]
 * @param {boolean} [flags.canRedo]
 * @param {boolean} [flags.hasSelection]
 * @param {boolean} [flags.hasCell]   a cell is under the cursor (context path)
 * @param {boolean} [flags.snap]      guide snapping is on
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
      id: 'chart', title: 'Chart',
      items: [
        sec('Rows'),
        it('Insert row above', 'chart.row.insertAbove', { disabled: !flags.hasSelection }),
        it('Insert row below', 'chart.row.insertBelow', { disabled: !flags.hasSelection }),
        it('Duplicate row', 'chart.row.duplicate', { disabled: !flags.hasSelection }),
        it('Delete row', 'chart.row.delete', { disabled: !flags.hasSelection, danger: true }),
        it('Move row up', 'chart.row.moveUp', { disabled: !flags.hasSelection }),
        it('Move row down', 'chart.row.moveDown', { disabled: !flags.hasSelection }),
        it('Reverse row', 'chart.row.reverse', { disabled: !flags.hasSelection }),
        it('Swap row up', 'chart.row.swapUp', { disabled: !flags.hasSelection }),
        it('Swap row down', 'chart.row.swapDown', { disabled: !flags.hasSelection }),
        sep(),
        sec('Needle columns'),
        it('Insert column left', 'chart.col.insertLeft', { disabled: !flags.hasSelection }),
        it('Insert column right', 'chart.col.insertRight', { disabled: !flags.hasSelection }),
        it('Duplicate column', 'chart.col.duplicate', { disabled: !flags.hasSelection }),
        it('Delete column', 'chart.col.delete', { disabled: !flags.hasSelection, danger: true }),
        it('Move column left', 'chart.col.moveLeft', { disabled: !flags.hasSelection }),
        it('Move column right', 'chart.col.moveRight', { disabled: !flags.hasSelection }),
        it('Reverse column', 'chart.col.reverse', { disabled: !flags.hasSelection }),
        sep(),
        sec('Whole card'),
        it('Rotate 90\u00b0 clockwise', 'chart.transform.rot90cw'),
        it('Rotate 90\u00b0 counter-clockwise', 'chart.transform.rot90ccw'),
        it('Rotate 180\u00b0', 'chart.transform.rot180'),
        it('Transpose (mirror on diagonal)', 'chart.transform.transpose'),
        it('Anti-transpose', 'chart.transform.antitranspose'),
        sep(),
        sec('Selected region'),
        it('Flip region horizontal', 'chart.region.flipH', { disabled: !flags.hasSelection }),
        it('Flip region vertical', 'chart.region.flipV', { disabled: !flags.hasSelection }),
        it('Invert region', 'chart.region.invert', { disabled: !flags.hasSelection }),
        it('Convert region \u2192 Lace', 'chart.region.convert.lace'),
        it('Convert region \u2192 Fair Isle', 'chart.region.convert.fair_isle'),
        it('Convert region \u2192 Tuck', 'chart.region.convert.tuck'),
        it('Convert region \u2192 Slip', 'chart.region.convert.slip'),
        sep(),
        sec('Resize & remix'),
        it('Resample card (fit new size)\u2026', 'chart.matrix.resample'),
        it('Re-gauge to another machine\u2026', 'chart.matrix.regauge'),
        it('Interleave rows\u2026', 'chart.matrix.interleave'),
        it('Soften region (stagger floats)', 'chart.soften', { disabled: !flags.hasSelection }),
        it('Smudge last stroke', 'chart.smudge'),
        sep(),
        it('Jump to cell\u2026', 'chart.jumpTo', { shortcut: 'Ctrl G' }),
        it('Card statistics', 'chart.info')
      ]
    },
    {
      id: 'select', title: 'Select',
      items: [
        it('All', 'select.all', { shortcut: 'Ctrl A' }),
        it('None', 'select.none', { shortcut: 'Esc' }),
        it('Inverse', 'select.invert'),
        it('Punched cells', 'select.punched'),
        it('Same value as here', 'select.cellValue', { disabled: !flags.hasCell }),
        sep(),
        it('Expand', 'select.expand'),
        it('Contract', 'select.contract'),
        it('Feather edge', 'select.feather'),
        it('Grow (whole-card same-value)', 'select.grow'),
        it('Shrink', 'select.shrink'),
        sep(),
        sec('Align blobs'),
        it('Left', 'select.align.left', { disabled: !flags.hasSelection }),
        it('Right', 'select.align.right', { disabled: !flags.hasSelection }),
        it('Top', 'select.align.top', { disabled: !flags.hasSelection }),
        it('Bottom', 'select.align.bottom', { disabled: !flags.hasSelection }),
        it('Centre horizontally', 'select.align.centreH', { disabled: !flags.hasSelection }),
        it('Centre vertically', 'select.align.centreV', { disabled: !flags.hasSelection }),
        sep(),
        it('Distribute horizontally', 'select.distribute.h', { disabled: !flags.hasSelection }),
        it('Distribute vertically', 'select.distribute.v', { disabled: !flags.hasSelection }),
        sep(),
        sec('Nudge content'),
        it('Up', 'select.move.up', { disabled: !flags.hasSelection }),
        it('Down', 'select.move.down', { disabled: !flags.hasSelection }),
        it('Left', 'select.move.left', { disabled: !flags.hasSelection }),
        it('Right', 'select.move.right', { disabled: !flags.hasSelection }),
        sep(),
        sec('Selection tools'),
        it('Magic wand', 'select.wand'),
        it('Lasso', 'select.lasso'),
        it('B\u00e9zier path', 'select.bezier'),
        it('Spline path', 'select.spline'),
        it(flags.snap ? 'Snapping: on' : 'Snapping: off', 'select.snap')
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
      id: 'studio', title: 'Studio V2',
      items: [
        sec('The six fused systems'),
        it('Project · KnitScript', 'v2.project'),
        it('Fit Engine', 'v2.fit'),
        it('Yarn Lab', 'v2.yarn'),
        it('Compiler V2 (all outputs)', 'v2.compiler'),
        it('Reverse Engineer (photo → pattern)', 'v2.reverse'),
        it('Production (cost · batch · orders)', 'v2.production'),
        sep(),
        it('Toggle the V2 launcher', 'v2.launcher'),
        it('Close all V2 docks', 'v2.closeAll', { danger: true })
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
.kx-mb-subhost{position:relative}
.kx-mb-fly{position:absolute;top:-6px;left:calc(100% + 2px);min-width:184px;max-height:320px;overflow:auto;padding:6px;display:none;
  background:var(--bg-surface,#0f1830);border:1px solid var(--border-subtle);border-radius:12px;
  box-shadow:0 22px 55px -12px rgba(0,0,0,.75);z-index:12100}
.kx-mb-subhost:hover .kx-mb-fly,.kx-mb-subhost:focus-within .kx-mb-fly{display:block}
.kx-mb-fly-item{display:block;width:100%;text-align:left;background:transparent;border:0;color:inherit;font:inherit;
  padding:7px 9px;border-radius:8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kx-mb-fly-item:hover{background:color-mix(in srgb,var(--accent-cyan) 18%,transparent)}
.kx-mb-fly-empty{padding:7px 9px;font-size:11px;color:var(--text-muted);font-style:italic}
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

function esc(s) { return escHtml(s); }

/**
 * Which side should a menu dropdown hang from, so it never runs off the right edge?
 * A dropdown authored at the anchor's left is flipped to the right when the left
 * placement would overflow. Pure and DOM-free so the geometry is testable.
 * @param {{left:number,width:number}} anchor  the menu title's rect
 * @param {{w:number}} box  the dropdown's width
 * @param {{vw:number,edge?:number}} vp  viewport width + edge keep-out
 * @returns {{left:string,right:string}} CSS values for the dropdown
 */
export function placeMenu(anchor, box, vp) {
  const vw = (vp && vp.vw) || 1024;
  const edge = (vp && vp.edge != null) ? vp.edge : 12;
  const w = (box && box.w) || 0;
  const ax = anchor && Number.isFinite(anchor.left) ? anchor.left : 0;
  const leftAligned = ax + w <= vw - edge;
  return { left: leftAligned ? '0' : 'auto', right: leftAligned ? 'auto' : '0' };
}

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

  let menuEls = [];
  let openIndex = -1;

  render();
  wireGlobal();
  return { render, refresh: render, show, hide, toggle: () => (bar.hidden ? show() : hide()) };

  function render() {
    const menus = buildMenus(typeof deps.flags === 'function' ? deps.flags() : {});
    bar.innerHTML = '';
    menuEls = [];
    const dash = doc.createElement('button');
    dash.type = 'button';
    dash.className = 'kx-mb-dash';
    dash.setAttribute('data-no-drag', '');
    dash.setAttribute('data-ktip', 'Leave the editor and go back to your projects');
    dash.innerHTML = `<span aria-hidden="true">\u2039</span> Projects Dashboard`;
    dash.addEventListener('click', () => onSelect('project.dashboard'));
    bar.appendChild(dash);

    menus.forEach((menu, mi) => {
      const wrap = doc.createElement('div');
      wrap.className = 'kx-mb-menu';
      wrap.setAttribute('role', 'none');
      const title = doc.createElement('button');
      title.type = 'button';
      title.className = 'kx-mb-title';
      title.setAttribute('role', 'menuitem');
      title.setAttribute('aria-haspopup', 'true');
      title.setAttribute('aria-expanded', 'false');
      title.setAttribute('data-no-drag', '');
      title.textContent = menu.title;
      wrap.appendChild(title);

      const dd = doc.createElement('div');
      dd.className = 'kx-mb-dropdown';
      dd.setAttribute('role', 'menu');
      for (const item of menu.items) {
        if (item.sep) { const s = doc.createElement('div'); s.className = 'kx-mb-sep'; dd.appendChild(s); continue; }
        if (item.section) { const h = doc.createElement('div'); h.className = 'kx-mb-sep'; dd.appendChild(h); }
        if (item.submenu === 'recent') {
          const recent = typeof deps.getRecent === 'function' ? (deps.getRecent() || []) : [];
          const host = doc.createElement('div');
          host.className = 'kx-mb-subhost';
          const parent = doc.createElement('button');
          parent.type = 'button';
          parent.className = 'kx-mb-item';
          parent.setAttribute('role', 'menuitem');
          parent.setAttribute('aria-haspopup', 'true');
          parent.setAttribute('aria-expanded', 'false');
          parent.innerHTML = `<span class="kx-mb-label">${esc(item.label.replace(' \u25B8', ''))} (${recent.length})</span><span class="kx-mb-key" aria-hidden="true">\u25B8</span>`;
          parent.addEventListener('click', () => { closeAll(); onSelect('project.recent'); });
          const openSub = () => parent.setAttribute('aria-expanded', 'true');
          const closeSub = () => parent.setAttribute('aria-expanded', 'false');
          parent.addEventListener('mouseenter', openSub);
          parent.addEventListener('focus', openSub);
          parent.addEventListener('blur', closeSub);
          host.appendChild(parent);
          const fly = doc.createElement('div');
          fly.className = 'kx-mb-fly';
          fly.setAttribute('role', 'menu');
          if (!recent.length) {
            const empty = doc.createElement('div');
            empty.className = 'kx-mb-fly-empty';
            empty.textContent = 'No recent projects yet';
            fly.appendChild(empty);
          }
          for (const r of recent) {
            const rb = doc.createElement('button');
            rb.type = 'button';
            rb.className = 'kx-mb-fly-item';
            rb.setAttribute('role', 'menuitem');
            rb.textContent = r.name || 'Untitled project';
            rb.addEventListener('click', ev => { ev.stopPropagation(); closeAll(); onSelect('project.open', { id: r.id }); });
            fly.appendChild(rb);
          }
          host.appendChild(fly);
          dd.appendChild(host);
          continue;
        }
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'kx-mb-item' + (item.danger ? ' kx-mb-item--danger' : '');
        b.setAttribute('role', 'menuitem');
        if (item.disabled) b.disabled = true;
        b.innerHTML = `<span class="kx-mb-label">${esc(item.label)}</span>${item.shortcut ? `<span class="kx-mb-key">${esc(item.shortcut)}</span>` : ''}`;
        b.addEventListener('click', () => { closeAll(); onSelect(item.action); });
        dd.appendChild(b);
      }
      wrap.appendChild(dd);

      title.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = wrap.classList.contains('open');
        closeAll();
        if (!wasOpen) openMenu(mi, false);
      });
      menuEls.push({ wrap, title, dd });
      bar.appendChild(wrap);
    });

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

  /** Enabled, focusable controls inside one open dropdown (items + recent flyout). */
  function menuItems(wrap) {
    return Array.from(wrap.querySelectorAll('.kx-mb-dropdown .kx-mb-item:not([disabled]), .kx-mb-dropdown .kx-mb-fly-item'));
  }
  function openMenu(mi, focusFirst) {
    closeAll();
    const m = menuEls[mi];
    if (!m) return;
    m.wrap.classList.add('open');
    m.title.setAttribute('aria-expanded', 'true');
    positionDropdown(m.dd);
    openIndex = mi;
    if (focusFirst) { const first = menuItems(m.wrap)[0]; if (first) first.focus(); }
  }
  function positionDropdown(dd) {
    const vw = (typeof window !== 'undefined' ? window.innerWidth : 1024);
    const at = placeMenu(dd.getBoundingClientRect(), { w: dd.offsetWidth || 236 }, { vw, edge: 12 });
    dd.style.left = at.left;
    dd.style.right = at.right;
  }
  function focusTitle(i) {
    const m = menuEls[i];
    if (!m) return;
    closeAll();
    m.title.focus();
  }
  function onBarKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key;
    const active = doc.activeElement;
    const tIdx = menuEls.findIndex(m => m.title === active);
    if (tIdx >= 0) {
      if (key === 'ArrowDown' || key === 'Enter' || key === ' ') { e.preventDefault(); openMenu(tIdx, true); }
      else if (key === 'ArrowRight') { e.preventDefault(); focusTitle((tIdx + 1) % menuEls.length); }
      else if (key === 'ArrowLeft') { e.preventDefault(); focusTitle((tIdx - 1 + menuEls.length) % menuEls.length); }
      return;
    }
    const m = menuEls[openIndex];
    if (m && m.wrap.contains(active)) {
      const items = menuItems(m.wrap);
      const i = items.indexOf(active);
      if (key === 'ArrowDown') { e.preventDefault(); (items[(i + 1) % items.length] || items[0]).focus(); }
      else if (key === 'ArrowUp') { e.preventDefault(); (items[(i - 1 + items.length) % items.length] || items[0]).focus(); }
      else if (key === 'Home') { e.preventDefault(); items[0] && items[0].focus(); }
      else if (key === 'End') { e.preventDefault(); items[items.length - 1] && items[items.length - 1].focus(); }
      else if (key === 'ArrowRight') { e.preventDefault(); const n = (openIndex + 1) % menuEls.length; openMenu(n, false); menuEls[n].title.focus(); }
      else if (key === 'ArrowLeft') { e.preventDefault(); const p = (openIndex - 1 + menuEls.length) % menuEls.length; openMenu(p, false); menuEls[p].title.focus(); }
      else if (key === 'Escape') { e.preventDefault(); const t = openIndex; closeAll(); if (menuEls[t]) menuEls[t].title.focus(); }
      return;
    }
    if (key === 'ArrowDown' && bar.contains(active)) { e.preventDefault(); openMenu(0, true); }
  }

  function closeAll() {
    bar.querySelectorAll('.kx-mb-menu.open').forEach(m => m.classList.remove('open'));
    menuEls.forEach(m => m.title.setAttribute('aria-expanded', 'false'));
    openIndex = -1;
  }
  function hide() { bar.hidden = true; try { localStorage.setItem(HIDE_KEY, '1'); } catch (_) {} doc.body.classList.add('kx-mb-collapsed'); }
  function show() { bar.hidden = false; reopen.style.display = 'none'; try { localStorage.setItem(HIDE_KEY, '0'); } catch (_) {} doc.body.classList.remove('kx-mb-collapsed'); }

  function wireGlobal() {
    if (bar.__kxWired) return;
    bar.__kxWired = true;
    reopen.addEventListener('click', show);
    bar.addEventListener('keydown', onBarKey);
    doc.addEventListener('pointerdown', e => { if (!bar.contains(e.target)) closeAll(); }, true);
    doc.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
    try { if (localStorage.getItem(HIDE_KEY) === '1') hide(); } catch (_) { /* default shown */ }
  }
}
