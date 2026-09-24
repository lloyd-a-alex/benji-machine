/**
 * KNITCAT — the unified shell orchestrator.
 *
 * One module owns the entire shell so the app reads as a single workspace with
 * one fused navigation bar instead of five parallel navigation systems:
 *
 *   command bar   identity + machine/mode setup + one primary action + overflow
 *   view toolbar  every workspace view as ONE scrollable bar of flat buttons at the
 *                 top: Chart · Punchcard · CNC · Yarn · Schedule · Kinematics ·
 *                 Clothes · Project · Fit · Yarn Lab · Compiler · Reverse · Production
 *   context bar   the real tools for the current view (moved in, never cloned-in-place)
 *   inspector     the right column, tabbed Health · Spec · Layers · Notes
 *
 * Design rule: this module NEVER deletes or re-creates load-bearing DOM. It
 * RE-PARENTS the existing nodes (moving an element preserves its id and every
 * listener already bound by app.js), so the rest of the codebase and the test
 * suite keep working untouched. It reaches the app only through:
 *   • .click() on the hidden proxy tab buttons (#tab-btn-*) and real buttons
 *   • the shared command dispatcher via deps.runCommand(id, ctx)
 *   • reading app.projectMeta for the inline project name
 *
 * The whole shell is gated behind `body.kx-shell`, which is only added once this
 * module has mounted successfully. If anything throws, the legacy header / tool
 * rail / tab strip / menubar simply stay visible — graceful degradation, never a
 * blank canvas.
 *
 * DOM-free at import (only constants and the factory below).
 *
 * @module ui/chrome
 */

import { PATTERN_PRESETS } from '../presets/preset-library.js';
import { FAMILY_BY_ID } from '../presets/preset-catalog.js';
import { loadFavourites, saveFavourites } from '../presets/presets-browser.js';
import { attachRovingTablist, attachMenuNavigation, syncRovingSelection } from './keyboard-nav.js';
import { logger } from '../core/logging.js';

const log = logger('ui/chrome');

// The view toolbar is FLAT: every workspace view is one button in a single
// scrollable bar (no surface→sub-view nesting). A view is either a real hidden
// tab-panel proxy (`proxy` = a .tab-btn app.js already switches panels for) or a
// fused V2 dock opened through the command dispatcher (`command`). `ctx` names the
// real toolbar moved into the context bar for that view; `cta` is its one primary
// action; `hint` is the context-bar label for views with no dedicated toolbar.
const VIEWS = [
  { id: 'editor', glyph: '✎', label: 'Chart', proxy: '#tab-btn-editor',
    ctx: '#panel-editor .canvas-subbar', cta: { glyph: '✓', text: 'Check', action: 'machine.feasibility' } },
  { id: 'punchcard', glyph: '▦', label: 'Punchcard', proxy: '#tab-btn-punchcard',
    ctx: '#panel-punchcard .punchcard-toolbar', cta: { glyph: '⤓', text: 'Export', action: 'file.export' } },
  { id: 'cnc', glyph: '⌁', label: 'CNC Toolpath', proxy: '#tab-btn-cnc',
    ctx: '#panel-cnc .cnc-toolbar', cta: { glyph: '▶', text: 'Run', sel: '#btn-cnc-play' } },
  { id: 'yarn', glyph: '◎', label: 'Yarn Sim', proxy: '#tab-btn-yarn',
    ctx: '#panel-yarn .yarn-toolbar', cta: { glyph: '↻', text: 'Relax', sel: '#btn-yarn-relax' } },
  { id: 'schedule', glyph: '≣', label: 'Schedule', proxy: '#tab-btn-schedule',
    ctx: '#panel-schedule .schedule-toolbar', cta: { glyph: '⤓', text: 'Export CSV', sel: '#btn-schedule-export' } },
  { id: 'brother', glyph: '⊘', label: 'Kinematics', proxy: '#tab-btn-brother',
    ctx: '#panel-brother .brother-toolbar', cta: { glyph: '▶', text: 'Play', sel: '#btn-brother-play' } },
  { id: 'clothes', glyph: '✂', label: 'Clothes', proxy: '#tab-btn-clothes',
    hint: 'Garment planner — everything is in the panel below →',
    cta: { glyph: '✎', text: 'To Editor', sel: '#btn-clothes-editor' } },
  { id: 'project', glyph: '¶', label: 'Project', command: 'v2.project', hint: 'Studio system — opens as a dock' },
  { id: 'fit', glyph: '⊿', label: 'Fit', command: 'v2.fit', hint: 'Studio system — opens as a dock' },
  { id: 'yarnlab', glyph: '◉', label: 'Yarn Lab', command: 'v2.yarn', hint: 'Studio system — opens as a dock' },
  { id: 'compiler', glyph: '⚙', label: 'Compiler', command: 'v2.compiler', hint: 'Studio system — opens as a dock' },
  { id: 'reverse', glyph: '⇄', label: 'Reverse', command: 'v2.reverse', hint: 'Studio system — opens as a dock' },
  { id: 'production', glyph: '⏣', label: 'Production', command: 'v2.production', hint: 'Studio system — opens as a dock' }
];
const VIEW_BY_ID = Object.fromEntries(VIEWS.map(v => [v.id, v]));

// The overflow menu is the one consolidated menu that replaces the ten-item bar.
// Every id below already exists in the command dispatcher.
const OVERFLOW_SECTIONS = [
  { label: 'Project', items: [
    { action: 'file.new', glyph: '✚', label: 'New project' },
    { action: 'file.open', glyph: '◫', label: 'Open dashboard' },
    { action: 'file.saveAs', glyph: '⤓', label: 'Save .kcard' },
    { action: 'file.export', glyph: '⇪', label: 'Export / CNC' },
    { action: 'file.backup', glyph: '⊕', label: 'Back up everything' },
    { action: 'file.restore', glyph: '⊖', label: 'Restore backup' },
    { action: 'file.prefs', glyph: '⚙', label: 'Preferences' }
  ] },
  { label: 'Start a pattern', items: [
    { action: 'design.presets', glyph: '★', label: 'Preset library' },
    { action: 'design.math', glyph: '∞', label: 'Math Studio' },
    { action: 'design.image', glyph: '▦', label: 'Image dither' },
    { action: 'design.punchcard-photo', glyph: '☰', label: 'Reverse a punched card' }
  ] },
  { label: 'Tools', items: [
    { action: 'edit.clipshelf', glyph: '⧉', label: 'Clip shelf' },
    { action: 'design.knitalong', glyph: '❖', label: 'Knit-along companion' },
    { action: 'design.legend', glyph: 'Ⓛ', label: 'Symbol legend' },
    { action: 'view.structure', glyph: '▤', label: 'Card structure' },
    { action: 'design.heritage', glyph: '◈', label: 'Textile heritage' },
    { action: 'view.inspector', glyph: 'ⓘ', label: 'Stitch inspector' }
  ] },
  { label: 'View', items: [
    { action: 'view.fit', glyph: '⤢', label: 'Fit card to view' },
    { action: 'view.resetPanels', glyph: '◱', label: 'Recentre panels' },
    { action: 'view.theme', glyph: '☾', label: 'Toggle theme' },
    { action: 'view.console', glyph: '>_', label: 'Console' },
    { action: 'view.systems', glyph: '⚙', label: 'Systems status' }
  ] },
  { label: 'Machine', items: [
    { action: 'machine.feasibility', glyph: '✓', label: 'Check feasibility' },
    { action: 'machine.universe', glyph: '✧', label: 'Machine universe' },
    { action: 'machine.fitAll', glyph: '⤾', label: 'Fit every machine' },
    { action: 'machine.pick', glyph: '⌘', label: 'Change machine' }
  ] },
  { label: 'Studio V2', items: [
    { action: 'v2.project', glyph: '¶', label: 'Project · KnitScript' },
    { action: 'v2.fit', glyph: '⊿', label: 'Fit Engine' },
    { action: 'v2.yarn', glyph: '◉', label: 'Yarn Lab' },
    { action: 'v2.compiler', glyph: '⚙', label: 'Compiler V2' },
    { action: 'v2.reverse', glyph: '⇄', label: 'Reverse Engineer' },
    { action: 'v2.production', glyph: '⏣', label: 'Production' }
  ] },
  { label: 'Help', items: [
    { action: 'help.search', glyph: '⌘', label: 'Search commands' },
    { action: 'help.guide', glyph: '❋', label: 'Lace carriage guide' },
    { action: 'help.shortcuts', glyph: '⌨', label: 'Keyboard shortcuts' },
    { action: 'help.about', glyph: '♥', label: 'About KNITCAT' }
  ] }
];

const VIEW_ORDER = VIEWS.map(v => v.id);

/**
 * Mount the shell. Always safe to call; returns a controller whose reflect* hooks
 * app.js may call, or a null-ish no-op controller if the shell markup is absent.
 * @param {object} deps
 * @param {() => object} deps.getApp live KnitApp accessor
 * @param {(id:string, ctx?:object) => void} deps.runCommand
 * @param {(msg:string, opts?:object) => void} [deps.notify]
 */
export function createChrome(deps = {}) {
  const noop = {
    setView() {}, openInspector() {}, closeInspector() {},
    setInspTab() {}, reflectMode() {}, reflectHealth() {}, getState: () => ({})
  };
  if (typeof document === 'undefined') return noop;
  const commandBar = document.getElementById('command-bar');
  if (!commandBar) return noop; // shell not present — leave legacy chrome visible

  const getApp = deps.getApp || (() => ({}));
  const runCommand = deps.runCommand || (() => {});

  const state = { view: 'editor', inspTab: 'health' };
  let shelf = null;
  let shelfHandle = null;
  let shelfOpen = false;   // drawer slid up? (distinct from being on the Design surface)

  const $ = id => document.getElementById(id);
  const els = {
    chip: $('cb-surface-chip'), chipGlyph: $('cb-surface-glyph'), chipName: $('cb-surface-name'),
    projectName: $('cb-project-name'), savedTick: $('cb-project-saved'),
    machineHost: $('cb-machine-host'), setupRail: $('setup-rail'), modesHost: $('cb-modes'), healthSlot: $('cb-health-slot'),
    machineSpec: $('cb-machine-spec'), machineSettings: $('btn-cb-machine-settings'),
    ctxInner: $('ctx-inner'), ctxPark: $('ctx-park'),
    rail: $('surface-rail'), subtabs: $('subtab-strip'),
    sidebar: $('right-sidebar'), inspTabs: $('insp-tabs'),
    layersHost: $('insp-layers-host'), notesHost: $('insp-notes-host'),
    primary: $('cb-act-primary'), primaryGlyph: $('cb-act-glyph'), primaryText: $('cb-act-text'),
    command: $('cb-act-command'), patterns: $('cb-act-patterns'), overflowBtn: $('cb-act-overflow'), overflowMenu: $('cb-overflow-menu'),
    studio: $('sr-studio'), console: $('sr-console'), settings: $('sr-settings'),
    healthDot: $('cb-health-dot'), healthScore: $('cb-health-score')
  };
  if (!els.rail || !els.subtabs || !els.ctxInner || !els.sidebar) return noop;

  // ── re-parent the load-bearing setup controls into the shell ────────────────
  // Moving preserves id + app.js listeners. The machine picker is a settings
  // control, so it belongs in the command bar right beside the project title
  // (#cb-machine-host), where it is one glance away — not off in a separate rail
  // or a redundant sidebar panel. The left setup-rail is only a fallback if the
  // command-bar host is absent. Done before kx-shell so the legacy header is only
  // hidden once these have a new home.
  function adoptSetup() {
    const profilePicker = document.querySelector('#main-header .profile-picker');
    const machineHome = els.machineHost || els.setupRail;
    if (profilePicker && machineHome) {
      // The picker already carries its own "Machine:" label, so no extra caption is
      // stacked above it (that read as a duplicate heading in the left rail).
      machineHome.appendChild(profilePicker);
    }
    const modeSel = document.querySelector('#main-header .mode-selector');
    if (modeSel && els.modesHost) els.modesHost.appendChild(modeSel);
    const feas = $('btn-feasibility');
    if (feas && els.healthSlot) els.healthSlot.appendChild(feas);
  }

  // ── merge navigation into ONE flat horizontal view toolbar at the top ────────
  // Every view is a single top-level button (no surface→sub-view nesting), so the
  // whole thing reads as one scrollable "pick a view" bar at the top of the stage.
  // Moving the rail node preserves its ids and every listener app.js already bound.
  function adoptNav() {
    const viewport = document.getElementById('viewport-workspace');
    if (!viewport || !els.rail) return;
    viewport.insertBefore(els.rail, viewport.firstChild);
  }

  // ── context bar: move the real toolbar for the active subview ───────────────
  const slotEls = new Map();
  function stashSources() {
    for (const v of VIEWS) {
      if (!v.ctx) continue;
      const node = document.querySelector(v.ctx);
      if (node) { slotEls.set(v.id, node); els.ctxPark.appendChild(node); }
    }
  }
  let shownReal = null;
  function buildContextBar() {
    const def = VIEW_BY_ID[state.view];
    if (shownReal && shownReal.parentElement === els.ctxInner) els.ctxPark.appendChild(shownReal);
    shownReal = null;
    els.ctxInner.innerHTML = '';
    // The pattern generators live right in the Chart toolbar now — presets, math,
    // image dither and card-photo are one click away instead of buried in the
    // overflow, which is the entire point of the fused shell.
    if (state.view === 'editor') els.ctxInner.appendChild(buildPatternLaunchers());
    const node = def && def.ctx ? slotEls.get(state.view) : null;
    if (node) { els.ctxInner.appendChild(node); shownReal = node; }
    if (state.view === 'editor') els.ctxInner.appendChild(buildToolClones());
    if (state.view === 'editor') els.ctxInner.appendChild(buildViewControls());
    if (!node && def && def.hint) {
      const hint = document.createElement('span');
      hint.className = 'ctx-label';
      hint.textContent = def.hint;
      els.ctxInner.appendChild(hint);
    }
  }

  // The tool palette lives in the (now hidden) left rail. Mirror its real buttons
  // as id-stripped clones that forward clicks, so app.js stays the single source of
  // truth for tool state while the rail itself is off-screen.
  function buildToolClones() {
    const group = document.createElement('div');
    group.className = 'ctx-group ctx-tools';
    document.querySelectorAll('#left-toolbar .tool-btn').forEach(btn => {
      const clone = btn.cloneNode(true);
      clone.removeAttribute('id');
      clone.classList.add('ctx-tool');
      clone.classList.toggle('active', btn.classList.contains('active'));
      clone.setAttribute('aria-hidden', 'false');
      clone.addEventListener('click', e => { e.preventDefault(); btn.click(); syncToolActive(); });
      group.appendChild(clone);
    });
    return group;
  }

  // View cluster — a real editor always has zoom & fit at the thumb. `zoom` is a
  // purely view property (pan/px-per-cell), so nudging it never touches the matrix
  // or the undo history and needs no command id.
  function zoomBy(factor) {
    const ed = getApp() && getApp().editor;
    if (!ed || !ed.zoom) return;
    const old = ed.zoom;
    const next = Math.max(4, Math.min(90, old * factor));
    const rect = ed.canvas && ed.canvas.getBoundingClientRect();
    if (rect && rect.width) {
      const cx = rect.width / 2, cy = rect.height / 2;
      ed.panX = cx - (cx - ed.panX) * (next / old);
      ed.panY = cy - (cy - ed.panY) * (next / old);
    }
    ed.zoom = next;
    if (typeof ed.render === 'function') ed.render();
  }

  function buildViewControls() {
    const group = document.createElement('div');
    group.className = 'ctx-group ctx-view';
    const label = document.createElement('span');
    label.className = 'ctx-label';
    label.textContent = 'View';
    group.appendChild(label);
    const mk = (glyph, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ctx-view-btn';
      b.title = title;
      b.setAttribute('aria-label', title);
      const g = document.createElement('span');
      g.setAttribute('aria-hidden', 'true');
      g.textContent = glyph;
      b.appendChild(g);
      b.addEventListener('click', fn);
      return b;
    };
    group.append(
      mk('−', 'Zoom out', () => zoomBy(1 / 1.25)),
      mk('⌖', 'Fit pattern to view', () => {
        const ed = getApp() && getApp().editor;
        if (ed && typeof ed.fitToView === 'function') { ed.fitToView(); if (typeof ed.render === 'function') ed.render(); }
      }),
      mk('+', 'Zoom in', () => zoomBy(1.25))
    );
    return group;
  }

  // "Start from" — the four ways to seed a fresh card, surfaced as a labelled
  // chip group at the head of the Design context bar. Each forwards to a command
  // id that already exists in js/ui/commands.js, so no behaviour is duplicated.
  const PATTERN_LAUNCHERS = [
    { action: 'design.presets', glyph: '★', label: 'Presets', title: 'Browse authentic historical & algorithmic patterns' },
    { action: 'design.math', glyph: '∞', label: 'Math', title: 'Generate patterns via reaction-diffusion, waves or cellular automata' },
    { action: 'design.image', glyph: '▦', label: 'Image', title: 'Import an image and dither it onto the card' },
    { action: 'design.punchcard-photo', glyph: '☰', label: 'Card photo', title: 'Read a physical punched card from a photo' }
  ];
  function buildPatternLaunchers() {
    const group = document.createElement('div');
    group.className = 'ctx-group ctx-patterns';
    const label = document.createElement('span');
    label.className = 'ctx-label ctx-patterns-label';
    label.textContent = 'Start from';
    group.appendChild(label);
    PATTERN_LAUNCHERS.forEach(p => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ctx-pattern-btn';
      b.title = p.title;
      const g = document.createElement('span');
      g.className = 'ctx-pattern-glyph';
      g.setAttribute('aria-hidden', 'true');
      g.textContent = p.glyph;
      const t = document.createElement('span');
      t.className = 'ctx-pattern-text';
      t.textContent = p.label;
      b.append(g, t);
      b.addEventListener('click', () => runCommand(p.action));
      group.appendChild(b);
    });
    return group;
  }

  function syncToolActive() {
    const clones = els.ctxInner.querySelectorAll('.ctx-tools .ctx-tool');
    const reals = document.querySelectorAll('#left-toolbar .tool-btn');
    clones.forEach((c, i) => {
      const real = reals[i];
      if (real) c.classList.toggle('active', real.classList.contains('active'));
    });
  }

  // ── primary CTA ──────────────────────────────────────────────────────────────
  function updatePrimaryCTA() {
    const cta = (VIEW_BY_ID[state.view] || VIEWS[0]).cta || VIEWS[0].cta;
    if (els.primaryGlyph) els.primaryGlyph.textContent = cta.glyph;
    if (els.primaryText) els.primaryText.textContent = cta.text;
    els.primary && (els.primary.dataset.cta = JSON.stringify({ action: cta.action, sel: cta.sel }));
  }
  function firePrimaryCTA() {
    let def = {};
    try { def = JSON.parse(els.primary.dataset.cta || '{}'); } catch (err) { log.warn('the primary action carried a malformed command descriptor', { cta: els.primary?.dataset?.cta, error: err?.message }); def = {}; }
    if (def.action) runCommand(def.action);
    else if (def.sel) { const b = document.querySelector(def.sel); if (b) b.click(); }
  }

  // ── sub-tabs (flat views) ──────────────────────────────────────────────────────
  function setView(id) {
    const def = VIEW_BY_ID[id];
    if (!def) return;
    state.view = id;
    els.rail.querySelectorAll('.sr-btn[data-view]').forEach(b => {
      const on = b.dataset.view === id;
      b.classList.toggle('is-active', on);
      // aria-current marks the active view for assistive tech, not just the
      // coloured fill (which a colour-blind or low-vision user can't rely on).
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (els.chipGlyph) els.chipGlyph.textContent = def.glyph;
    if (els.chipName) els.chipName.textContent = def.label;
    activateView(def);
    buildContextBar();
    updatePrimaryCTA();
    // The pattern shelf belongs to the Chart view only, and it starts closed (a
    // bottom pop-out, not an always-open strip). Leaving Chart always closes it.
    setShelfSurface(id === 'editor');
  }

  function activateView(def) {
    // A Studio view is a fused V2 dock (runs a command); every other view is a
    // real hidden tab-panel proxy that app.js already switches panels for.
    if (def.command) { runCommand(def.command); return; }
    if (def.proxy) { const btn = document.querySelector(def.proxy); if (btn) btn.click(); }
  }

  // ── inspector (right sidebar becomes tabbed Health · Spec · Layers · Notes) ──
  function setInspTab(tab) {
    state.inspTab = tab;
    els.sidebar.dataset.insp = tab;
    if (els.inspTabs) {
      const tabs = Array.from(els.inspTabs.querySelectorAll('.insp-tab'));
      let activeIndex = 0;
      tabs.forEach((b, i) => {
        const on = b.dataset.insp === tab;
        if (on) activeIndex = i;
        b.classList.toggle('is-active', on);
      });
      // These are real role="tab"s, so they must carry aria-selected + a roving
      // tabindex — otherwise a screen reader announces four tabs with no selection.
      syncRovingSelection(tabs, activeIndex);
    }
    if (tab === 'layers') renderLayers();
    else if (tab === 'notes') renderNotes();
  }
  function openInspector(tab) {
    els.sidebar.hidden = false;
    if (tab) setInspTab(tab);
  }

  function emptyState(title, hint) {
    const box = document.createElement('div');
    box.className = 'insp-empty';
    const t = document.createElement('p');
    t.className = 'insp-empty-title';
    t.textContent = title;
    const h = document.createElement('p');
    h.className = 'insp-empty-hint';
    h.textContent = hint;
    box.append(t, h);
    return box;
  }

  // The Layers tab reads the live stack straight off the editor, so it can never
  // disagree with the canvas. Clicking a row promotes it through the editor's own
  // setActiveLayer (which commits history + re-renders), then we repaint.
  function renderLayers() {
    const host = els.layersHost;
    if (!host) return;
    const editor = getApp().editor;
    host.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'insp-h';
    host.appendChild(head);
    if (!editor || typeof editor.getLayers !== 'function') {
      head.textContent = 'Layers';
      host.appendChild(emptyState('No card open yet.', 'Layers appear once you start a pattern.'));
      return;
    }
    const layers = editor.getLayers();
    head.textContent = `Layers · ${layers.length}`;
    layers.slice().reverse().forEach(l => {
      const row = document.createElement('div');
      row.className = 'layer-row' + (l.active ? ' is-active' : '');
      const vis = document.createElement('button');
      vis.type = 'button';
      vis.className = 'layer-vis';
      vis.textContent = l.visible ? '◉' : '○';
      vis.title = l.visible ? 'Hide layer' : 'Show layer';
      vis.setAttribute('aria-label', vis.title);
      vis.addEventListener('click', () => {
        if (typeof editor.toggleLayerVisibleById === 'function') { editor.toggleLayerVisibleById(l.id); renderLayers(); }
      });
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'layer-name';
      name.textContent = l.name;
      name.title = 'Make this the active layer';
      name.addEventListener('click', () => {
        if (typeof editor.setActiveLayer === 'function') { editor.setActiveLayer(l.id); renderLayers(); }
      });
      const kind = document.createElement('span');
      kind.className = 'layer-kind';
      kind.textContent = l.kind;
      const lock = document.createElement('button');
      lock.type = 'button';
      lock.className = 'layer-lock';
      lock.textContent = l.locked ? '🔒' : '🔓';
      lock.title = l.locked ? 'Unlock layer' : 'Lock layer';
      lock.setAttribute('aria-label', lock.title);
      lock.addEventListener('click', () => {
        if (typeof editor.setLayerLockedById === 'function') { editor.setLayerLockedById(l.id, !l.locked); renderLayers(); }
      });
      row.append(vis, name, kind, lock);
      host.appendChild(row);
    });
  }

  // The Notes tab lists every annotation for the knitter, read from the live
  // editor.annotations list — text is set via textContent so user notes are safe.
  function renderNotes() {
    const host = els.notesHost;
    if (!host) return;
    const editor = getApp().editor;
    const list = editor && Array.isArray(editor.annotations) ? editor.annotations : [];
    host.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'insp-h';
    head.textContent = `Annotations · ${list.length}`;
    host.appendChild(head);
    if (!list.length) {
      host.appendChild(emptyState('No notes yet.', 'Use the Annotate tool (N) to pin a note for the knitter. Notes never reach the punchcard.'));
      return;
    }
    list.forEach(a => {
      const card = document.createElement('div');
      card.className = 'note-card';
      const kind = document.createElement('span');
      kind.className = 'note-kind';
      kind.textContent = a.kind || 'note';
      const text = document.createElement('span');
      text.className = 'note-text';
      text.textContent = a.text || '(empty note)';
      const pos = document.createElement('span');
      pos.className = 'note-pos';
      pos.textContent = `r${(a.r || 0) + 1}·c${(a.c || 0) + 1}`;
      card.append(kind, text, pos);
      host.appendChild(card);
    });
  }

  // ── pattern shelf — a live, contextual dock of preset thumbnails ──────────
  // The whole point of the fused shell: the pattern library is not buried behind
  // a menu, it is a dock at the foot of the Design stage. Each card renders a real
  // thumbnail through the app's own renderPresetThumb and loads via loadPreset.
  const SHELF_FAMILIES = ['all', 'favs', 'lace', 'colorwork', 'texture', 'double-bed', 'weave', 'generative', 'edges', 'shaping'];
  let shelfFamily = 'all';
  let shelfQuery = '';
  let shelfStripEl = null;
  let shelfCountEl = null;
  let shelfFavs = new Set();

  function buildPatternShelf() {
    if (shelf) return shelf;
    // Dock inside the Design editor panel (a flex column): the canvas-wrapper
    // flexes and the shelf sits at the foot. The legacy tab-panels are
    // position:absolute, so mounting on #viewport-workspace would be covered.
    const stage = document.getElementById('panel-editor');
    if (!stage) return null;
    shelf = document.createElement('div');
    shelf.id = 'kx-pattern-shelf';
    shelf.hidden = true;
    shelf.setAttribute('aria-label', 'Pattern library shelf');

    // A self-describing header row: title + live count + a close affordance, so the
    // open drawer stands on its own (the edge tab hides itself once the drawer is up).
    const head = document.createElement('div');
    head.className = 'ps-head';
    const title = document.createElement('span');
    title.className = 'ps-title';
    title.textContent = '✦ Pattern library';
    head.appendChild(title);
    shelfCountEl = document.createElement('span');
    shelfCountEl.className = 'ps-count';
    head.appendChild(shelfCountEl);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ps-close';
    closeBtn.setAttribute('aria-label', 'Close pattern library');
    closeBtn.title = 'Close (Esc)';
    closeBtn.innerHTML = '<span aria-hidden="true">\u00d7</span>';
    closeBtn.addEventListener('click', () => closeShelf());
    head.appendChild(closeBtn);

    const bar = document.createElement('div');
    bar.className = 'ps-bar';

    const chips = document.createElement('div');
    chips.className = 'ps-chips';
    chips.setAttribute('role', 'tablist');
    chips.setAttribute('aria-label', 'Filter patterns by family');
    // Selecting a family is one function both the click handler and the roving
    // keyboard tablist call, so mouse and keyboard can never diverge.
    const selectFamily = fam => {
      shelfFamily = fam;
      const list = Array.from(chips.querySelectorAll('.ps-chip'));
      let activeIndex = 0;
      list.forEach((c, i) => {
        const on = c.dataset.fam === fam;
        if (on) activeIndex = i;
        c.classList.toggle('is-on', on);
      });
      syncRovingSelection(list, activeIndex);
      renderShelfCards();
    };

    SHELF_FAMILIES.forEach(fam => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ps-chip' + (fam === shelfFamily ? ' is-on' : '');
      chip.dataset.fam = fam;
      chip.setAttribute('role', 'tab');
      chip.tabIndex = fam === shelfFamily ? 0 : -1;
      chip.setAttribute('aria-selected', fam === shelfFamily ? 'true' : 'false');
      chip.textContent = fam === 'all' ? 'All' : fam === 'favs' ? '★ Favourites' : (FAMILY_BY_ID[fam] ? FAMILY_BY_ID[fam].name : fam);
      chip.addEventListener('click', () => selectFamily(fam));
      chips.appendChild(chip);
    });
    attachRovingTablist(chips, { selector: '.ps-chip', onActivate: (i, tab) => selectFamily(tab.dataset.fam) });
    bar.appendChild(chips);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'ps-search';
    search.placeholder = 'Search motifs\u2026';
    search.setAttribute('aria-label', 'Search patterns by name');
    search.addEventListener('input', () => { shelfQuery = search.value.trim().toLowerCase(); renderShelfCards(); });
    bar.appendChild(search);

    // (the live count now lives in the header row above)

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'ps-more';
    more.textContent = 'Open full library \u2192';
    more.addEventListener('click', () => runCommand('design.presets'));
    bar.appendChild(more);

    shelfStripEl = document.createElement('div');
    shelfStripEl.className = 'ps-strip';
    shelfStripEl.setAttribute('role', 'list');
    shelf.append(head, bar, shelfStripEl);
    stage.appendChild(shelf);
    // A single small tab riding the bottom edge is the only affordance when the
    // drawer is shut — the whole point is that it costs nothing until summoned.
    shelfHandle = document.createElement('button');
    shelfHandle.type = 'button';
    shelfHandle.id = 'kx-shelf-handle';
    shelfHandle.setAttribute('aria-controls', 'kx-pattern-shelf');
    shelfHandle.setAttribute('aria-expanded', 'false');
    shelfHandle.setAttribute('aria-label', 'Open pattern library');
    shelfHandle.title = 'Show or hide the pattern library';
    shelfHandle.innerHTML = '<span class="kx-shelf-glyph" aria-hidden="true">\u25B2</span><span>Patterns</span>';
    shelfHandle.addEventListener('click', () => toggleShelf());
    stage.appendChild(shelfHandle);
    try { shelfFavs = loadFavourites(); } catch (err) { log.warn('the favourites shelf could not be read — starting empty', { error: err?.message }); shelfFavs = new Set(); }
    renderShelfCards();
    return shelf;
  }

  function shelfMatches(preset) {
    if (shelfFamily === 'favs') {
      if (!shelfFavs.has(preset.id)) return false;
    } else if (shelfFamily !== 'all' && preset.family !== shelfFamily) {
      return false;
    }
    if (shelfQuery) {
      const hay = `${preset.name || ''} ${preset.id || ''}`.toLowerCase();
      if (!hay.includes(shelfQuery)) return false;
    }
    return true;
  }

  // Render the filtered, capped set of thumbnails. Rebuilt on every filter/search
  // keystroke, so it stays cheap: a family slice is at most a few dozen cards and
  // each thumb is a 132×96 canvas drawn once.
  function renderShelfCards() {
    if (!shelfStripEl) return;
    const app = getApp();
    shelfStripEl.replaceChildren();
    const matches = PATTERN_PRESETS.filter(shelfMatches);
    const shown = matches.slice(0, 60);
    if (shelfCountEl) shelfCountEl.textContent = matches.length > shown.length ? `${shown.length} / ${matches.length}` : `${matches.length}`;
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'ps-empty';
      empty.textContent = shelfFamily === 'favs'
        ? 'No favourites yet — tap the ☆ on any motif to keep it here.'
        : 'No motifs match — try another family or clear the search.';
      shelfStripEl.appendChild(empty);
      return;
    }
    shown.forEach(preset => {
      const card = document.createElement('div');
      card.className = 'ps-card';
      card.setAttribute('role', 'listitem');
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'ps-pick';
      pick.title = preset.name || preset.id;
      const canvas = document.createElement('canvas');
      canvas.className = 'ps-thumb';
      canvas.width = 132;
      canvas.height = 96;
      const label = document.createElement('span');
      label.className = 'ps-card-name';
      label.textContent = preset.name || preset.id;
      pick.append(canvas, label);
      pick.addEventListener('click', () => {
        if (app && typeof app.loadPreset === 'function') {
          app.loadPreset(preset.id);
          card.classList.add('is-picked');
          setTimeout(() => card.classList.remove('is-picked'), 480);
        }
      });
      const fav = document.createElement('button');
      fav.type = 'button';
      fav.className = 'ps-fav' + (shelfFavs.has(preset.id) ? ' is-on' : '');
      fav.textContent = shelfFavs.has(preset.id) ? '★' : '☆';
      fav.title = shelfFavs.has(preset.id) ? 'Remove from favourites' : 'Add to favourites';
      fav.setAttribute('aria-label', fav.title);
      fav.setAttribute('aria-pressed', shelfFavs.has(preset.id) ? 'true' : 'false');
      fav.addEventListener('click', () => toggleFav(preset, fav));
      card.append(fav, pick);
      shelfStripEl.appendChild(card);
      if (app && typeof app.renderPresetThumb === 'function') {
        try { app.renderPresetThumb(canvas, preset); } catch (err) { log.warn(`preset thumbnail "${preset.id}" failed to render`, { preset: preset.id, error: err?.message }); }
      }
    });
  }

  // Toggle a motif's favourite, persist it through the browser's own store, and
  // refresh the star. In the Favourites view an un-star drops the card live.
  function toggleFav(preset, favBtn) {
    if (shelfFavs.has(preset.id)) shelfFavs.delete(preset.id); else shelfFavs.add(preset.id);
    saveFavourites(shelfFavs);
    const on = shelfFavs.has(preset.id);
    if (favBtn) {
      favBtn.textContent = on ? '★' : '☆';
      favBtn.classList.toggle('is-on', on);
      favBtn.title = on ? 'Remove from favourites' : 'Add to favourites';
      favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (shelfFamily === 'favs' && !on) renderShelfCards();
  }

  // ── the shelf is a pop-out drawer: presence on Design is separate from open ──
  /** Show/hide the drawer chrome for the active surface (Design owns it). */
  function setShelfSurface(on) {
    if (!on) { closeShelf(); if (shelf) shelf.hidden = true; if (shelfHandle) shelfHandle.hidden = true; return; }
    if (!shelf) buildPatternShelf();
    if (shelf) shelf.hidden = false;
    if (shelfHandle) shelfHandle.hidden = false;
  }
  /** Slide the drawer up over the stage. */
  function openShelf() {
    if (!shelf) buildPatternShelf();
    shelf.hidden = false;
    shelf.classList.add('is-open');
    // Bring the first family chips back into view: the bar is horizontally
    // scrollable, and a stale scroll position hid "All" / "Favourites" last time.
    const bar = shelf.querySelector('.ps-bar');
    if (bar) bar.scrollLeft = 0;
    if (shelfHandle) shelfHandle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('kx-shelf-open');
    shelfOpen = true;
  }
  /** Drop the drawer back below the bottom edge. */
  function closeShelf() {
    if (shelf) shelf.classList.remove('is-open');
    if (shelfHandle) shelfHandle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('kx-shelf-open');
    shelfOpen = false;
  }
  function toggleShelf() { if (shelfOpen) closeShelf(); else openShelf(); }

  // ── overflow menu ────────────────────────────────────────────────────────────
  function buildOverflow() {
    if (!els.overflowMenu) return;
    els.overflowMenu.innerHTML = OVERFLOW_SECTIONS.map(sec => `
      <div class="cb-menu-section">${sec.label}</div>
      ${sec.items.map(it => `
        <button type="button" class="cb-menu-item" data-action="${it.action}" role="menuitem" tabindex="-1">
          <span class="cb-mi-glyph" aria-hidden="true">${it.glyph}</span>
          <span class="cb-mi-label">${it.label}</span>
        </button>`).join('')}`).join('');
    els.overflowMenu.querySelectorAll('.cb-menu-item').forEach(b =>
      b.addEventListener('click', () => { closeOverflow({ restoreFocus: false }); runCommand(b.dataset.action); }));
    // Up/Down/Home/End walk the items; focus (not activation) is all they do,
    // so arrowing through the menu never fires a command by accident.
    attachMenuNavigation(els.overflowMenu, { itemSelector: '.cb-menu-item' });
  }
  function openOverflow() {
    if (!els.overflowMenu || !els.overflowBtn) return;
    const r = els.overflowBtn.getBoundingClientRect();
    els.overflowMenu.hidden = false;
    els.overflowMenu.style.top = (r.bottom + 8) + 'px';
    els.overflowMenu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    els.overflowBtn.setAttribute('aria-expanded', 'true');
    // Land the keyboard user straight on the first action.
    const first = els.overflowMenu.querySelector('.cb-menu-item');
    if (first && typeof first.focus === 'function') first.focus();
  }
  function closeOverflow(opts = {}) {
    if (!els.overflowMenu || els.overflowMenu.hidden) return;
    els.overflowMenu.hidden = true;
    if (els.overflowBtn) {
      els.overflowBtn.setAttribute('aria-expanded', 'false');
      // A dismissed menu returns focus to its trigger unless the close came from
      // picking an item (which moves focus to whatever the command opens).
      if (opts.restoreFocus !== false && typeof els.overflowBtn.focus === 'function') els.overflowBtn.focus();
    }
  }

  // ── live health: reflect the sidebar score into the command-bar dot without ──
  // ── reaching into app internals (a MutationObserver keeps us decoupled) ──────
  function observeHealth() {
    const scoreEl = $('kx-health-score');
    if (!scoreEl || !els.healthScore) return;
    const paint = () => {
      const n = parseInt(scoreEl.textContent, 10);
      const score = Number.isFinite(n) ? n : 100;
      els.healthScore.textContent = String(score);
      if (els.healthDot) els.healthDot.dataset.sev = score >= 90 ? 'ok' : score >= 60 ? 'warn' : 'error';
    };
    paint();
    try {
      new MutationObserver(paint).observe(scoreEl, { childList: true, characterData: true, subtree: true });
    } catch (err) { log.debug('health-score MutationObserver is unsupported — only a single paint ran', { error: err?.message }); }
  }

  // ── wiring ───────────────────────────────────────────────────────────────────
  function wire() {
    els.rail.querySelectorAll('.sr-btn[data-view]').forEach(b =>
      b.addEventListener('click', () => setView(b.dataset.view)));
    // The sub-tab strip is retired in the flat model (it stays empty), but the
    // container is permanent, so we keep it a wired tablist for any future use.
    attachRovingTablist(els.subtabs, { selector: '.subtab', onActivate: () => {} });
    if (els.inspTabs) attachRovingTablist(els.inspTabs, { selector: '.insp-tab', onActivate: (i, tab) => openInspector(tab.dataset.insp) });
    // Every view is a flat .sr-btn[data-view] switched by the handler above — there
    // is no surface→sub-view nesting and no bespoke listener for any one of them.
    // Console and Settings stay utilities: they run a command, they are not views.
    if (els.console) els.console.addEventListener('click', () => runCommand('view.console'));
    if (els.settings) els.settings.addEventListener('click', () => runCommand('file.prefs'));
    if (els.command) els.command.addEventListener('click', () => runCommand('help.search'));
    // Machine settings now sit in the command bar: the gear opens the profile
    // editor so gauge/pitch/carriage rules are editable without a separate panel.
    if (els.machineSettings) els.machineSettings.addEventListener('click', () => runCommand('machine.settings'));
    if (els.patterns) els.patterns.addEventListener('click', () => {
      // The Patterns action summons the same bottom drawer the edge handle does,
      // regardless of which surface is currently up.
      if (state.view !== 'editor') setView('editor');
      toggleShelf();
    });
    if (els.primary) els.primary.addEventListener('click', firePrimaryCTA);
    if (els.chip) els.chip.addEventListener('click', () => {
      const i = VIEW_ORDER.indexOf(state.view);
      setView(VIEW_ORDER[(i + 1) % VIEW_ORDER.length]);
    });
    if (els.overflowBtn) els.overflowBtn.addEventListener('click', e => {
      e.stopPropagation();
      els.overflowMenu.hidden ? openOverflow() : closeOverflow();
    });
    if (els.inspTabs) els.inspTabs.querySelectorAll('.insp-tab').forEach(b =>
      b.addEventListener('click', () => openInspector(b.dataset.insp)));

    document.addEventListener('click', e => {
      if (els.overflowMenu && !els.overflowMenu.hidden
        && !els.overflowMenu.contains(e.target) && !(els.overflowBtn && els.overflowBtn.contains(e.target))) closeOverflow();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeOverflow(); if (shelfOpen) closeShelf(); }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= VIEWS.length) setView(VIEWS[n - 1].id);
    });
    window.addEventListener('resize', closeOverflow);
    document.addEventListener('knitcat:tool', () => {
      syncToolActive();
      if (state.inspTab === 'layers') renderLayers();
    });

    if (els.projectName) {
      els.projectName.addEventListener('change', () => {
        const name = els.projectName.value.trim();
        const app = getApp();
        if (app && app.projectMeta) app.projectMeta.name = name || null;
        if (name) { try { document.title = `${name} — KNITCAT`; } catch (_) { /* noop */ } }
        if (els.savedTick) {
          els.savedTick.hidden = false;
          setTimeout(() => { els.savedTick.hidden = true; }, 1400);
        }
      });
      const app = getApp();
      if (app && app.projectMeta && app.projectMeta.name) els.projectName.value = app.projectMeta.name;
    }
  }

  // ── bring it up ───────────────────────────────────────────────────────────────
  adoptSetup();
  adoptNav();
  stashSources();
  buildOverflow();
  wire();
  observeHealth();
  setView('editor');
  setInspTab('health');
  // Only after a full mount do we hide the legacy chrome. This is the one switch
  // that turns the overhaul on; a throw above it leaves the app as it was.
  document.body.classList.add('kx-shell');

  return {
    setView, openInspector, closeInspector() {}, setInspTab,
    getState: () => ({ ...state }),
    reflectMode: () => { buildContextBar(); syncToolActive(); updatePrimaryCTA(); },
    reflectHealth: verdict => {
      if (!els.healthScore) return;
      const score = verdict && Number.isFinite(verdict.score) ? verdict.score : 100;
      els.healthScore.textContent = String(score);
      if (els.healthDot) els.healthDot.dataset.sev = verdict && verdict.status === 'not-feasible' ? 'error'
        : verdict && verdict.status === 'needs-attention' ? 'warn' : 'ok';
    }
  };
}
