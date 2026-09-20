/**
 * KNITCAT — the command dispatcher.
 *
 * The menu bar and the right-click context menu are two surfaces over ONE shared
 * vocabulary of action ids. This module is the single place every one of those ids
 * is implemented, so the two can never drift. It lives here (rather than inline in
 * the 4k-line app controller) so the dispatcher is small, readable and importable
 * for testing; it reaches the running app only through the object handed to it.
 *
 * DOM-free at import — every browser touch happens inside {@link runCommand}, which
 * the app calls with itself as the first argument.
 *
 * @module ui/commands
 */

import { STITCH_TYPE } from '../math/knit-topology.js';
import { cellsOfValue } from '../features/symbol-legend.js';
import { getDiagnostics } from '../core/diagnostics.js';
import { bringForward } from './draggable.js';

// Commands that can add, rename, reorder (touch) or open a project, so the menu
// bar's "Recent projects" flyout is refreshed only when the library may have moved.
const RECENT_CHANGING = new Set([
  'file.new', 'file.open', 'file.save', 'project.snapshot', 'project.recent', 'project.open',
  'project.rename', 'project.dashboard', 'app.newProject', 'app.save', 'app.studio',
  'proj.snapshot', 'proj.open', 'proj.rename', 'proj.delete'
]);

/**
 * Run one command id.
 * @param {object} app  the live KnitApp (carries the editor, projects, panels…)
 * @param {string} id   an id from the MENU/CONTEXT action vocabulary
 * @param {object} [ctx] { anchor, kind, flags, cell, payload } from a caller
 */
export function runCommand(app, id, ctx = {}) {
  if (typeof document === 'undefined') return;
  const ed = app.editor;
  const mode = app.currentMode;
  const punch = m => (m === 'lace' ? STITCH_TYPE.EYELET : 1);
  const blank = m => (m === 'lace' ? STITCH_TYPE.KNIT : 0);
  const isBlankCell = (v, m) => v === 0 || v == null || v === '' || v === 'EMPTY' || (m === 'lace' && v === STITCH_TYPE.KNIT);
  const click = sel => { const el = document.querySelector(sel); if (el) { el.click(); return true; } return false; };
  const withMatrix = mut => { if (!ed || !ed.matrix) return; const m = ed.matrix.map(r => r.slice()); mut(m); ed.setMatrix(m); };
  const setCell = (r, c, val) => { if (r == null || c == null) return; withMatrix(m => { if (m[r]) m[r][c] = val; }); };
  const fillRect = (r1, c1, r2, c2, val) => withMatrix(m => { for (let r = r1; r <= r2; r++) if (m[r]) for (let c = c1; c <= c2; c++) m[r][c] = val; });
  // Every command may kick off an async project op; none of them should ever be able
  // to reject into a stray unhandled rejection, so wrap them all in one contained sink.
  const safe = p => Promise.resolve(p).catch(err => getDiagnostics().logError('Command', err, { level: 'warn', context: { command: id } }));
  const refreshTaskbar = () => { if (app.taskbar && app.taskbar.refresh) safe(app.taskbar.refresh()); };
  const doSnapshot = () => safe(
    Promise.resolve(app.projects && app.projects.commit && app.projects.commit())
      .then(p => { app.notifications?.success?.(p ? `Saved \u201c${p.name}\u201d.` : 'Nothing on the canvas to save yet.'); refreshTaskbar(); })
  );

  try {
    switch (id) {
      // ── File / project lifecycle ─────────────────────────────────────────
      case 'file.new': case 'app.newProject':
        safe(Promise.resolve(app.projects && app.projects.createNew && app.projects.createNew())
          .then(p => { if (p) { refreshTaskbar(); app.notifications?.success?.(`Created \u201c${p.name}\u201d.`); } }));
        break;
      case 'file.open': case 'project.dashboard': case 'project.recent': case 'app.studio':
        app.projects && app.projects.open && app.projects.open();
        break;
      case 'file.save': case 'project.snapshot': case 'app.save': case 'proj.snapshot':
        doSnapshot();
        break;
      case 'file.saveAs': app.saveProject(); break;
      case 'file.export': case 'app.export': click('#btn-open-export'); break;
      case 'file.backup': app.dataPanel && app.dataPanel.backupAll && app.dataPanel.backupAll(); break;
      case 'file.restore': document.getElementById('kx-btn-restore')?.click(); break;
      case 'file.prefs': case 'app.settings': app._openSettingsViaExtras(); break;
      case 'file.close':
        if (ed && ed.matrix && ed.matrix.length && (typeof window === 'undefined' || window.confirm?.('Close this project? Unsaved work is kept by autosave and your checkpoints.'))) { ed.clear(); app.recompile(); }
        break;

      // ── Edit ─────────────────────────────────────────────────────────────
      case 'edit.undo': ed && ed.undo(); break;
      case 'edit.redo': ed && ed.redo(); break;
      case 'edit.cut': if (ed && ed.cutSelection()) { app.clipShelf && app.clipShelf.capture && app.clipShelf.capture(); app.notifications?.info?.('Cut selection.'); }
        break;
      case 'edit.copy': if (ed && ed.copySelection()) { app.clipShelf && app.clipShelf.capture && app.clipShelf.capture(); app.notifications?.info?.('Copied selection.'); }
        break;
      case 'edit.paste': if (ed && ed.pasteClipboard()) app.notifications?.info?.('Pasted selection.'); break;
      case 'edit.duplicate': app.duplicateSelection && app.duplicateSelection(); break;
      case 'edit.selectAll': if (ed) { ed.selection = { r1: 0, c1: 0, r2: ed.rows - 1, c2: ed.cols - 1 }; ed.render && ed.render(); }
        break;
      case 'edit.invert': ed && ed.invert(); break;
      case 'edit.clear': case 'app.clear': ed && ed.clear(); break;
      case 'edit.clipshelf': case 'app.clipshelf': app.clipShelf && app.clipShelf.open && app.clipShelf.open(); break;
      case 'edit.clearSelection': case 'edit.delete': ed && ed.deleteSelection(); break;
      case 'edit.fill': { const b = ed && ed.getSelectionBounds && ed.getSelectionBounds(); if (b) fillRect(Math.min(b.r1, b.r2), Math.min(b.c1, b.c2), Math.max(b.r1, b.r2), Math.max(b.c1, b.c2), punch(mode)); }
        break;
      case 'edit.flipH': ed && ed.flipHorizontal(); break;
      case 'edit.flipV': ed && ed.flipVertical(); break;
      case 'edit.rotateCW': ed && ed.rotateSelection('cw'); break;
      case 'edit.rotateCCW': ed && ed.rotateSelection('ccw'); break;
      case 'clip.capture': if (ed && ed.copySelection()) { app.clipShelf && app.clipShelf.capture && app.clipShelf.capture(); } app.clipShelf && app.clipShelf.open && app.clipShelf.open(); break;
      case 'clip.pasteMost': app.clipShelf && app.clipShelf.pasteMostRecent && app.clipShelf.pasteMostRecent(); break;

      // ── View ─────────────────────────────────────────────────────────────
      case 'view.fit': ed && ed.fitToView && ed.fitToView(); break;
      case 'view.resetPanels': app._resetPanelPositions(); break;
      case 'view.console': app.console && app.console.toggle && app.console.toggle(); break;
      case 'view.systems': app.console && app.console.open && app.console.open(); app.console && app.console.setView && app.console.setView('systems'); break;
      case 'view.inspector': case 'app.inspector': app._toggleInspector(); break;
      case 'view.structure': case 'app.structure': app.structurePanel && app.structurePanel.toggle && app.structurePanel.toggle(); break;
      case 'view.theme': case 'app.theme': click('#kx-theme'); break;
      case 'view.status': { const sb = document.getElementById('status-bar'); if (sb) sb.hidden = !sb.hidden; }
        break;

      // ── Project ──────────────────────────────────────────────────────────
      case 'project.rename':
        safe(Promise.resolve(app.projects && app.projects.rename && app.projects.rename(app.projects.activeId && app.projects.activeId())).then(refreshTaskbar));
        break;
      case 'project.open': { const pid = ctx.payload && ctx.payload.id; if (pid && app.projects && app.projects.openProjectById) safe(Promise.resolve(app.projects.openProjectById(pid)).then(() => { app.projects.close && app.projects.close(); refreshTaskbar(); })); }
        break;

      // ── Design ───────────────────────────────────────────────────────────
      case 'design.presets': click('#btn-open-presets'); break;
      case 'design.math': click('#btn-open-math'); break;
      case 'design.image': click('#btn-open-image'); break;
      case 'design.knitalong': case 'app.knitAlong': app.knitAlong && app.knitAlong.toggle && app.knitAlong.toggle(); break;
      case 'design.legend': case 'app.symbolLegend': app.symbolLegend && app.symbolLegend.toggle && app.symbolLegend.toggle(); break;
      case 'design.heritage': app.heritagePanel && app.heritagePanel.toggle && app.heritagePanel.toggle(); break;

      // ── Machine ──────────────────────────────────────────────────────────
      case 'machine.feasibility': case 'app.feasibility': app.openFeasibility(); break;
      case 'machine.universe': case 'app.universe': app.openMachineUniverse(); break;
      case 'machine.fitAll': { const r = app.universe && app.universe.tuneForAll && app.universe.tuneForAll(); app.recompile(); app.notifications?.[r && r.changed ? 'success' : 'info']?.(r && r.changed ? 'Tuned to fit every machine.' : 'Already fits every machine.'); }
        break;
      case 'machine.pick': app.elements.profileSelect && app.elements.profileSelect.focus(); app.elements.profileSelect && app.elements.profileSelect.click(); break;

      // ── Help ─────────────────────────────────────────────────────────────
      case 'help.about': click('.brand-section .kx-hbtn'); break;
      case 'help.guide': app.openModal('lace-guide'); break;
      case 'help.eyelets': document.querySelector('.tab-btn[data-tab="editor"]')?.click(); app.openModal('lace-guide'); break;
      case 'help.shortcuts': app._showShortcutsCard(); break;
      case 'help.search': case 'app.search': app.palette && app.palette.open && app.palette.open(); break;
      case 'help.love': app._showLovePopup(); break;

      // ── Cell / symbol (context menu, needs the hovered cell) ──────────────
      case 'cell.toggle': { const c = ctx.cell; if (c) setCell(c.r, c.c, isBlankCell(ed.matrix[c.r][c.c], mode) ? punch(mode) : blank(mode)); }
        break;
      case 'cell.punch': { const c = ctx.cell; if (c) setCell(c.r, c.c, punch(mode)); }
        break;
      case 'cell.blank': { const c = ctx.cell; if (c) setCell(c.r, c.c, blank(mode)); }
        break;
      case 'cell.fillRow': { const c = ctx.cell; if (c && ed) fillRect(c.r, 0, c.r, ed.cols - 1, punch(mode)); }
        break;
      case 'cell.fillCol': { const c = ctx.cell; if (c && ed) fillRect(0, c.c, ed.rows - 1, c.c, punch(mode)); }
        break;
      case 'sym.highlight': { const c = ctx.cell; if (c && ed && ed.setHighlight) { try { ed.setHighlight(cellsOfValue(ed.matrix, ed.matrix[c.r][c.c]), { label: 'this symbol', color: '#a78bfa', fill: 'rgba(167,139,250,0.30)' }); } catch (_) { /* contained */ } } }
        break;
      case 'sym.explain': app.symbolLegend && app.symbolLegend.open && app.symbolLegend.open(); break;

      // ── Window / panel (context menu on a draggable surface) ──────────────
      case 'win.close': ctx.anchor && ctx.anchor.querySelector && ctx.anchor.querySelector('[data-close], .modal-close')?.click?.(); break;
      case 'win.dragReset':
        if (ctx.anchor) { ctx.anchor.style.transform = ''; delete ctx.anchor.dataset.kxTx; delete ctx.anchor.dataset.kxTy; if (ctx.anchor.id) { try { localStorage.removeItem('knitcat.drag.v1.' + ctx.anchor.id); } catch (_) { /* storage off */ } } }
        break;
      case 'win.bringForward': if (ctx.anchor) { ctx.anchor.style.position = ctx.anchor.style.position || 'relative'; bringForward(ctx.anchor); }
        break;

      // ── Mode / tool (context menu) ───────────────────────────────────────
      case 'mode.set': if (ctx.anchor && ctx.anchor.click) ctx.anchor.click(); else if (ctx.flags && ctx.flags.mode) app.setPatternMode(ctx.flags.mode);
        break;
      case 'tool.set': if (ctx.anchor && ctx.anchor.click) ctx.anchor.click(); break;

      // ── Project card (context menu on a Studio / taskbar card) ────────────
      case 'proj.open': {
        const card = ctx.anchor; const pid = card && (card.dataset.id || card.dataset.project);
        if (card && card.querySelector && card.querySelector('[data-open]')) card.querySelector('[data-open]').click();
        else if (pid && app.projects) safe(Promise.resolve(app.projects.openProjectById(pid)).then(() => { app.projects.close && app.projects.close(); refreshTaskbar(); }));
        break;
      }
      case 'proj.rename': {
        const card = ctx.anchor; const pid = card && (card.dataset.id || card.dataset.project);
        if (card && card.querySelector && card.querySelector('[data-ren]')) card.querySelector('[data-ren]').click();
        else if (pid && app.projects) safe(Promise.resolve(app.projects.rename(pid)).then(refreshTaskbar));
        break;
      }
      case 'proj.delete': {
        const card = ctx.anchor; const pid = card && (card.dataset.id || card.dataset.project);
        if (card && card.querySelector && card.querySelector('[data-del]')) card.querySelector('[data-del]').click();
        else if (pid && app.projects) {
          const ok = typeof window === 'undefined' || typeof window.confirm !== 'function' || window.confirm('Delete this project? Your checkpoints and backup files keep their own copies.');
          if (ok) safe(Promise.resolve(app.projects.remove(pid)).then(refreshTaskbar));
        }
        break;
      }

      // ── Link / text (context menu) ───────────────────────────────────────
      case 'link.open': if (ctx.flags && ctx.flags.href && typeof window !== 'undefined') window.open(ctx.flags.href, '_blank', 'noopener'); break;
      case 'link.copy': if (ctx.flags && ctx.flags.href) { try { navigator.clipboard && navigator.clipboard.writeText(ctx.flags.href); } catch (_) { /* denied */ } }
        break;
      case 'text.copy': { const t = typeof window !== 'undefined' && window.getSelection ? String(window.getSelection()) : ''; if (t) { try { navigator.clipboard && navigator.clipboard.writeText(t); } catch (_) { /* denied */ } } }
        break;

      default: break; // unknown id: harmless
    }
  } catch (err) {
    getDiagnostics().logError('Command', err, { level: 'warn', context: { command: id } });
  }
  // Keep the menu bar's enable/disable state and recent list honest for the next open.
  if (RECENT_CHANGING.has(id)) { try { app._refreshRecentProjects(); } catch (_) { /* contained */ } }
  if (app.menubar && app.menubar.refresh) { try { app.menubar.refresh(); } catch (_) { /* contained */ } }
}
