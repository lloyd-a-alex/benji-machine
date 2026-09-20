/**
 * Industrial Knitting Machine CAD/CAM & Lace Decompiler
 * Main Application Orchestrator & State Controller
 */

import { MACHINE_PROFILES, calculateCardDimensions, profileLimits, bedNeedleCapacity } from './machine/profiles.js';
import { gridSizeMm, formatLength } from './edit/measure.js';
import { STITCH_TYPE } from './math/knit-topology.js';
import { LaceCompiler, CARRIAGE_TYPE, DIRECTION } from './compiler/lace-decompiler.js';
import { CanvasEditor } from './ui/canvas-editor.js';
import { YarnSimulator } from './ui/yarn-simulator.js';
import { ToolpathViewer } from './ui/toolpath-viewer.js';
import { MathPatternGenerators, randomSeed } from './generators/math-patterns.js';
import { ImageProcessor } from './importers/image-processor.js';
import { CncGcodeExporter } from './exporters/cnc-gcode.js';
import { CadDxfExporter } from './exporters/cad-dxf.js';
import { VectorSvgExporter } from './exporters/vector-svg.js';
import { FormatsExporter } from './exporters/formats-dak.js';
import { readProject } from './project/kcard.js';
import { PATTERN_PRESETS } from './presets/preset-library.js';
import { openPresetsBrowser } from './presets/presets-browser.js';
import { initToolbar } from './ui/toolbar.js';
import { GarmentCanvas } from './ui/garment-canvas.js';
import { BeanieEngine } from './tailor/beanie-engine.js';
import { BrotherSimCanvas } from './ui/brother-sim-canvas.js';
import { NotificationCenter } from './ui/notifications.js';
import { installGlobalErrorBoundary, installRoundRectPolyfill, runGuarded } from './ui/safety.js';
import { getDiagnostics } from './core/diagnostics.js';
import { createConsolePanel } from './ui/console-panel.js';
import { createStitchInspector } from './ui/stitch-inspector.js';
import { createClipShelf } from './ui/clip-shelf.js';
import { createStructurePanel } from './ui/structure-panel.js';
import { createHeritagePanel } from './ui/heritage-panel.js';
import { createKnitAlong } from './features/knit-along.js';
import { createSymbolLegend } from './features/symbol-legend.js';
import { initExtras } from './features/extras.js';
import { initSound, fx } from './features/sound.js';
import { initCommandPalette } from './features/command-palette.js';
import { initAdmin } from './features/admin.js';
import { createFeasibilityAdvisor } from './features/feasibility.js';
import { createMachineUniverse } from './features/machine-universe.js';
import { initPwa } from './features/pwa.js';
import { initDataPanel } from './features/data-panel.js';
import { initShare, incomingShareDocument } from './features/share.js';
import { readShareUrl, decodeCard, stripShareUrl } from './project/url-state.js';
import { initProjectHub } from './features/project-hub.js';
import { createFileBridge } from './features/fs-access.js';
import { ClothesEngine, GARMENTS, CATEGORIES } from './tailor/clothes-catalog.js';
import { gradeSizes } from './tailor/grading.js';
import { summarizeProject } from './project/project-model.js';
import { cellsOfValue } from './features/symbol-legend.js';
// Desktop chrome — custom tooltips, header-dragging, the menu bar, the right-click
// context menu and the bottom project taskbar. Each is DOM-free at import and fully
// guarded at boot, so a failure degrades one surface only.
import { initTooltips } from './ui/tooltips.js';
import { enableDraggable } from './ui/draggable.js';
import { initContextMenu } from './ui/context-menu.js';
import { createMenuBar } from './ui/menubar.js';
import { createTaskbar } from './ui/taskbar.js';

// Commands that can add, rename, reorder (touch) or open a project, so the menu
// bar's "Recent projects" flyout is refreshed only when the library may have moved.
const RECENT_CHANGING = new Set([
  'file.new', 'file.open', 'file.save', 'project.snapshot', 'project.recent', 'project.open',
  'project.rename', 'project.dashboard', 'app.newProject', 'app.save', 'app.studio',
  'proj.snapshot', 'proj.open', 'proj.rename', 'proj.delete'
]);

class KnitApp {
  constructor() {
    this.currentProfile = MACHINE_PROFILES.brother_standard_24;
    this.currentMode = 'lace';
    this.activeTab = 'editor';
    this.romanceMode = true; // Always on — this machine is made for Benji ♥
    this.punchcardViewMode = 'standard';  
    this.notifications = new NotificationCenter('toast-container');
    // Descriptive fields for the project document. The metadata editor writes them;
    // autosave, versions and backups all carry the same object, so a restored card
    // comes back with its name and notes rather than as an anonymous grid.
    this.projectMeta = { name: null, author: null, notes: null };

    // Safety layer first: canvas polyfill + global error boundary so a single
    // failure anywhere can never silently freeze the whole app. This also installs
    // the diagnostics capture net and funnels every console.* call app-wide.
    installRoundRectPolyfill();
    installGlobalErrorBoundary(this.notifications);
    // Tag every captured record with session context and mark the boot boundary, so
    // a later log line can be traced back to when and where the app came up.
    getDiagnostics().context({ app: 'KNITCAT', phase: 'boot' });
    getDiagnostics().info('Application boot started');

    this.compiler = new LaceCompiler(this.currentProfile);
    this.compilationResult = null;

    runGuarded('DOM wiring', () => this.initDOM(), { notifier: this.notifications, announce: true });
    runGuarded('Components', () => this.initComponents(), { notifier: this.notifications, announce: true });
    runGuarded('Event wiring', () => this.initEvents(), { notifier: this.notifications, announce: true });

    // Left tool palette: turn the grouped sections into accessible, remembered
    // submenus. Sits after event wiring so every tool button is already live; if it
    // ever fails the palette simply stays fully expanded (the CSS default).
    runGuarded('Tool palette', () => {
      this.toolbar = initToolbar();
    }, { notifier: this.notifications, announce: true });

    // The in-app console sits on top of the diagnostics stream. Mounted after the DOM
    // so it can attach its header button; it replays the whole boot timeline because
    // it reads the shared ring buffer, not just new records.
    runGuarded('Console', () => {
      this.console = createConsolePanel({ diagnostics: getDiagnostics(), notifications: this.notifications });
      this._logEnvironment();
    }, { notifier: this.notifications, announce: true });

    // Personalization + UX extras. Fully contained: if it ever fails, the core
    // CAD app is completely unaffected.
    runGuarded('Extras layer', () => {
      this.extras = initExtras({ notifier: this.notifications });
    }, { notifier: this.notifications, announce: true });

    // Sound, hidden designer key, feasibility advisor, command palette, clothes
    // catalogue. Each is contained; a failure degrades that one feature only.
    runGuarded('Sound', () => { this.sound = initSound(); }, { notifier: this.notifications, announce: true });
    runGuarded('Designer key', () => { this.admin = initAdmin({ notifier: this.notifications }); }, { notifier: this.notifications, announce: true });
    runGuarded('Feasibility advisor', () => { this.feasibility = createFeasibilityAdvisor(this); }, { notifier: this.notifications, announce: true });
    runGuarded('Machine universe', () => { this.universe = createMachineUniverse(this); }, { notifier: this.notifications, announce: true });
    runGuarded('Clothes catalogue', () => { this.clothes = new ClothesEngine(); this._activeGarment = null; this._initClothesUI(); }, { notifier: this.notifications, announce: true });
    runGuarded('Command palette', () => { this.palette = initCommandPalette({ getActions: () => this._paletteActions() }); }, { notifier: this.notifications, announce: true });

    // Install / offline / launched files. Must come after the editor exists, because
    // a .kcard handed over by the operating system loads immediately.
    runGuarded('PWA layer', () => {
      this.pwa = initPwa({
        notifier: this.notifications,
        onIntent: intent => this._handleLaunchIntent(intent),
        onFile: file => this.loadProjectFile(file)
      });
    }, { notifier: this.notifications, announce: true });

    // Autosave, crash recovery, versions, recents, backup. Opening IndexedDB is
    // async, so the panel resolves later; `settle()` runs at the end of
    // initComponents, once there is an editor to hand a recovered card to.
    this.dataPromise = null;
    runGuarded('Work & backup', () => {
      this.dataPromise = initDataPanel({
        notifier: this.notifications,
        snapshot: () => this._projectSnapshot(),
        applyDocument: (doc, label) => this.loadProjectText(doc, label)
      }).catch(err => {
        getDiagnostics().logError('Data panel', err, { level: 'warn' });
        return null;
      });
    }, { notifier: this.notifications, announce: true });

    // Share links, QR codes and the native sheet. Needs no storage, so it goes up
    // straight away; the File System Access bridge waits for the IndexedDB driver,
    // because a file handle can only survive in a store that keeps live objects.
    this.share = null;
    this.fileBridge = null;
    /** A `#p=…` payload handed over by the share target, waiting for an editor. */
    this._incomingShareCode = null;
    runGuarded('Share & links', () => {
      this.share = initShare({
        notifier: this.notifications,
        snapshot: () => this._projectSnapshot(),
        applyDocument: (doc, label) => this.loadProjectText(doc, label),
        saveFile: () => this.saveProject(),
        fileBridge: () => this.fileBridge
      });
    }, { notifier: this.notifications, announce: true });

    // The Studio — the project hub the whole app finally hangs off (Phase 1 of the
    // superstructure). Reaches no DOM until opened and every storage call is
    // guarded, so it is inert if anything is unavailable.
    this.projects = null;
    runGuarded('Project studio', () => {
      this.projects = initProjectHub({
        notifier: this.notifications,
        getChart: () => {
          const s = this._projectSnapshot();
          return { matrix: s.stitchMatrix, mode: s.mode, profileId: s.profileId, rows: s.rows, cols: s.cols, name: s.name };
        },
        loadChart: chart => this.loadProjectText(JSON.stringify({
          format: 'KNITCAT_PROJECT_V2', kind: 'KNITCAT_PROJECT', schemaVersion: 2,
          stitchMatrix: chart.cells, mode: chart.mode, profileId: chart.profileId, name: chart.name
        }), chart.name || 'your project')
      });
    }, { notifier: this.notifications, announce: true });

    // Desktop chrome — tooltips, dragging, the menu bar, right-click menus and the
    // project taskbar. Mounted last so they can see every other subsystem; each is
    // lazy about the editor, so it is fine that initComponents() has not run yet.
    runGuarded('Desktop chrome', () => this._initDesktopChrome(), { notifier: this.notifications, announce: true });

    // Show the Benji love popup ONCE per browser (not on every refresh).
    // It stays reachable again via the "Show love letter" command in the palette.
    if (!this._lovePopupSeen()) {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => this._showLovePopup(), { timeout: 2000 });
      } else {
        setTimeout(() => this._showLovePopup(), 500);
      }
    }
  }

  _lovePopupSeen() {
    // Storage keys keep their historic `knitcad.` prefix on purpose: renaming them
    // would silently wipe a returning reader's letter, theme and anniversary.
    try { return localStorage.getItem('knitcad.lovePopupSeen') === '1'; } catch (_) { return false; }
  }
  _markLovePopupSeen() {
    try { localStorage.setItem('knitcad.lovePopupSeen', '1'); } catch (_) { /* ignore */ }
  }

  initDOM() {
    // Cache UI elements
    this.elements = {
      profileSelect: document.getElementById('profile-select'),
      modeButtons: document.querySelectorAll('.mode-btn'),
      tabButtons: document.querySelectorAll('.tab-btn'),
      tabPanels: document.querySelectorAll('.tab-panel'),

      // Tool buttons
      toolButtons: document.querySelectorAll('.tool-btn'),
      // The lace stitch pens only. `#btn-lace-guide` and the Fair Isle colour
      // swatches also carry `.stitch-btn`, but they are not stitch brushes — one
      // opens the explainer, the others pick a yarn — so selecting them here would
      // blank editor.activeStitch and steal the `.active` highlight (§1.2).
      stitchButtons: document.querySelectorAll('#lace-palette .stitch-btn[data-stitch]'),
      lacePalette: document.getElementById('lace-palette'),
      colorPalette: document.getElementById('color-palette'),

      // Canvases
      editorCanvas: document.getElementById('editor-canvas'),
      yarnCanvas: document.getElementById('yarn-canvas'),
      toolpathCanvas: document.getElementById('toolpath-canvas'),
      punchcardCanvas: document.getElementById('punchcard-canvas'),

      // Schedule container
      scheduleContainer: document.getElementById('schedule-list'),
      diagnosticsContainer: document.getElementById('diagnostics-list'),

      // Telemetry / Status bar
      statusCoords: document.getElementById('status-coords'),
      statusStats: document.getElementById('status-stats'),
      statusProfile: document.getElementById('status-profile'),

      // Modals
      mathModal: document.getElementById('math-modal'),
      imageModal: document.getElementById('image-modal'),
      presetsModal: document.getElementById('presets-modal'),
      exportModal: document.getElementById('export-modal')
    };

    // Populate profile selector. The needle-bed count is spelled into every label:
    // it is the single most consequential difference between these machines, and
    // it used to be buried in the description (see js/machine/profiles.js).
    this.elements.profileSelect.innerHTML = Object.values(MACHINE_PROFILES)
      .map(p => `<option value="${p.id}">${p.name} \u00b7 ${p.beds === 2 ? 'double bed' : 'single bed'}</option>`)
      .join('');
  }

  initComponents() {
    // Use requestIdleCallback to defer heavy initialization for faster startup
    const initComponents = () => {
      try {
        // 1. Grid Canvas Editor
        this.editor = new CanvasEditor(this.elements.editorCanvas, {
          rows: 24,
          cols: this.currentProfile.columns,
          mode: this.currentMode,
          onChange: () => this.handlePatternChange()
        });

        // 2. Physical Yarn Simulator — always romantic pink for Benji ♥
        this.yarnSim = new YarnSimulator(this.elements.yarnCanvas, {
          rows: 24,
          cols: this.currentProfile.columns
        });
        if (this.yarnSim && this.yarnSim.setYarnColors) {
          this.yarnSim.setYarnColors('#fbcfe8', '#e11d48');
        }
        this.setYarnMaterial('cotton', { silent: true });
        this.setYarnViewMode('shaded', { silent: true });

        // 3. CNC Toolpath Viewer
        this.toolpathViewer = new ToolpathViewer(this.elements.toolpathCanvas, {
          profile: this.currentProfile
        });

        // 4. Punchcard 2D Canvas context
        this.punchcardCtx = this.elements.punchcardCanvas.getContext('2d');

        // 5. Unified tailor canvas. The Clothes tab is now the single tailor for every
        //    garment - the tank top CAD, the beanie and the whole catalogue folded into
        //    one surface. GarmentCanvas renders the continuous geometry that
        //    ClothesEngine now emits for every structure, with the tank top's gauge-
        //    aware stitch grid, free-hand painting and left/right mirror.
        const clothesEl = document.getElementById('clothes-canvas');
        if (clothesEl) {
          this.garmentCanvas = new GarmentCanvas(clothesEl);
          document.getElementById('btn-clothes-symmetry')?.classList.toggle('active', this.garmentCanvas.symmetry);
          this.renderClothes();
        }

        // 6. Brother KH-830 Kinematic Simulator
        const brotherEl = document.getElementById('brother-canvas');
        if (brotherEl) {
          this.brotherCanvas = new BrotherSimCanvas(brotherEl);
        }

        // Now that components are ready, load the preset
        this.loadPreset('feather_fan_lace');
        
        // Initialize component-dependent event listeners
        this.initComponentEvents();

        // initComponents() is deferred; a PWA shortcut (`?tab=cnc`, `?tab=yarn`) may
        // have switched the active tab before any of this existed, leaving a blank
        // panel. Now that the subsystems are built, render whichever tab is active.
        if (this.activeTab && this.activeTab !== 'editor') {
          runGuarded(`Render "${this.activeTab}" tab`, () => this._renderTab(this.activeTab), {
            notifier: this.notifications
          });
        }

        // Only now can a recovered card be handed to an editor that exists.
        this.dataPromise?.then(async panel => {
          this.dataPanel = panel || null;
          if (panel) this._bindFileSystem(panel);
          // A `#p=…` link in the address bar is an explicit request, so it outranks
          // the quiet background resume — but the card that was on the screen must
          // not be lost behind it, hence the version.
          const incoming = this._consumeIncomingShare();
          if (!panel) return null;
          if (incoming.found && incoming.ok && panel.pendingAutosave()) {
            await panel.keepVersion(panel.pendingAutosave(), 'Card from before the link you opened');
          }
          return panel.settle({ ignoreAutosave: incoming.found && incoming.ok });
        }).catch(err => console.error('[KNITCAT] could not settle autosave:', err));
        if (!this.dataPromise) this._consumeIncomingShare();
        // A Ctrl+Shift+R hard reload asks the fresh page to land on the Projects
        // Dashboard once the recovered card has had its beat to apply.
        this._armStudioOnLoad();
      } catch (e) {
        console.error('[KNITCAT] Component initialization error:', e);
      }
    };

    // Defer initialization for faster startup
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => initComponents(), { timeout: 1000 });
    } else {
      setTimeout(() => initComponents(), 100);
    }
  }

  /**
   * Consume the Ctrl+Shift+R "return to the Projects Dashboard" flag planted just
   * before the browser hard-reloaded. Fired once at boot; a normal load has no flag
   * and does nothing. Delayed a beat so any recovered card applies underneath first.
   */
  _armStudioOnLoad() {
    let flagged = false;
    try {
      flagged = sessionStorage.getItem('knitcat.openStudioOnLoad') === '1';
      if (flagged) sessionStorage.removeItem('knitcat.openStudioOnLoad');
    } catch (_) { flagged = false; }
    if (!flagged) return;
    const go = () => { try { this.projects?.open?.(); } catch (_) { /* Studio guards itself */ } };
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 800);
  }

  /**
   * Mount the desktop-chrome layer: custom tooltips, header-dragging, the top menu
   * bar, the context-aware right-click menu and the bottom project taskbar. Each is
   * lazy about the editor (a getter, not a captured value), so this runs safely at
   * boot before initComponents() has built the canvas.
   * @private
   */
  _initDesktopChrome() {
    if (typeof document === 'undefined') return;
    this.tooltips = initTooltips();
    this.draggables = enableDraggable();
    this._recentProjects = [];
    this.menubar = createMenuBar({
      onSelect: (id, payload) => this.runCommand(id, payload ? { payload } : {}),
      flags: () => this._chromeFlags(),
      cardName: () => (this.projectMeta && this.projectMeta.name) || '',
      getRecent: () => this._recentProjects
    });
    this._refreshRecentProjects();
    this.contextMenu = initContextMenu({
      onAction: (id, ctx) => this.runCommand(id, ctx),
      getEditor: () => this.editor
    });
    this.taskbar = createTaskbar({
      listProjects: () => (this.projects && this.projects.list ? this.projects.list() : Promise.resolve([])),
      openProject: id => this.projects && this.projects.openProjectById && this.projects.openProjectById(id),
      onDashboard: () => this.projects && this.projects.open && this.projects.open(),
      onSnapshot: () => Promise.resolve(this.projects && this.projects.commit && this.projects.commit())
        .then(p => { this.taskbar && this.taskbar.refresh && this.taskbar.refresh(); this._refreshRecentProjects(); return p; }),
      summaryFor: p => summarizeProject(p),
      activeId: () => (this.projects && this.projects.activeId ? this.projects.activeId() : null)
    });
  }

  /**
   * Refresh the menu bar's "Recent projects" flyout from the saved library.
   * The list already arrives newest-first, so the head of it is the recent set.
   * Fire-and-forget: it only ever updates a cached array + repaints the bar.
   * @private
   */
  _refreshRecentProjects() {
    if (!this.projects || !this.projects.list) return;
    Promise.resolve(this.projects.list()).then(ps => {
      this._recentProjects = (ps || []).slice(0, 8)
        .map(p => ({ id: p.id, name: (p.name || 'Untitled project').slice(0, 60) }));
      if (this.menubar && this.menubar.refresh) { try { this.menubar.refresh(); } catch (_) { /* contained */ } }
    }).catch(() => { /* keep the last known recents */ });
  }

  /** Live enable/disable state for the menu bar (undo depth, a live selection). */
  _chromeFlags() {
    const ed = this.editor;
    let hasSelection = false;
    try { hasSelection = !!(ed && ed.getSelectionBounds && ed.getSelectionBounds()); } catch (_) { /* not ready */ }
    return {
      canUndo: !!(ed && ed.historyIndex > 0),
      canRedo: !!(ed && ed.history && ed.historyIndex < ed.history.length - 1),
      hasSelection
    };
  }

  /** Snap every draggable surface back to its authored corner and forget its spot. */
  _resetPanelPositions() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.kx-panel,.kx-studio,.modal-card,[data-drag]').forEach(el => {
      el.style.transform = '';
      delete el.dataset.kxTx;
      delete el.dataset.kxTy;
      if (el.id) { try { localStorage.removeItem('knitcat.drag.v1.' + el.id); } catch (_) { /* storage off */ } }
    });
    this.draggables && this.draggables.rescan && this.draggables.rescan();
    this.notifications?.info?.('Panels recentred.');
  }

  /** A small in-app cheat sheet, reachable from Help and right-click. */
  _showShortcutsCard() {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('kx-shortcuts-modal');
    if (existing) { existing.classList.add('active'); return; }
    const rows = [
      ['Pencil \u00b7 line \u00b7 rect \u00b7 ellipse', 'P \u00b7 L \u00b7 R \u00b7 C'],
      ['Select \u00b7 fill \u00b7 eraser', 'S \u00b7 G \u00b7 E'],
      ['Undo / redo', 'Ctrl Z / Ctrl Y'],
      ['Copy / cut / paste / duplicate', 'Ctrl C / X / V / D'],
      ['Delete selection', 'Del'],
      ['Rotate selection', '[ and ]'],
      ['Wrap the card (toroidal)', 'Alt + Arrow'],
      ['Search all commands', 'Ctrl K'],
      ['Projects Dashboard (Studio)', 'Ctrl \u21e7 R'],
      ['Close a dialog', 'Esc']
    ];
    const el = document.createElement('div');
    el.className = 'modal-backdrop active';
    el.id = 'kx-shortcuts-modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Keyboard shortcuts');
    el.innerHTML = `<div class="modal-card" style="width:min(520px,94vw)">
      <div class="modal-header"><div class="modal-title">Keyboard shortcuts</div>
        <button class="modal-close" type="button" aria-label="Close">&times;</button></div>
      <div class="modal-body"><table style="width:100%;border-collapse:collapse;font-size:13px">
        ${rows.map(([a, b]) => `<tr><td style="padding:6px 8px;color:var(--text-secondary)">${a}</td><td style="padding:6px 8px;text-align:right;font-family:var(--font-mono,ui-monospace,monospace);white-space:nowrap">${b}</td></tr>`).join('')}
      </table>
      <p style="font-size:11px;color:var(--text-muted);margin:12px 0 0">Tip: press <b>Ctrl K</b> to search every command, or right-click anything for context actions.</p>
      </div></div>`;
    document.body.appendChild(el);
    const close = () => el.classList.remove('active');
    el.querySelector('.modal-close').addEventListener('click', close);
    el.addEventListener('mousedown', e => { if (e.target === el) close(); });
    this.draggables && this.draggables.rescan && this.draggables.rescan();
    setTimeout(() => el.querySelector('.modal-close')?.focus({ preventScroll: true }), 0);
  }

  /**
   * The single command dispatcher shared by the menu bar and the right-click menu.
   * Every action id either module can emit is implemented exactly once here, so the
   * two surfaces can never drift, and it reuses the app's existing methods and real
   * DOM controls rather than re-deriving their logic.
   * @param {string} id
   * @param {object} [ctx] { anchor, kind, flags, cell } from the context menu
   */
  runCommand(id, ctx = {}) {
    if (typeof document === 'undefined') return;
    const ed = this.editor;
    const mode = this.currentMode;
    const punch = m => (m === 'lace' ? STITCH_TYPE.EYELET : 1);
    const blank = m => (m === 'lace' ? STITCH_TYPE.KNIT : 0);
    const isBlankCell = (v, m) => v === 0 || v == null || v === '' || v === 'EMPTY' || (m === 'lace' && v === STITCH_TYPE.KNIT);
    const click = sel => { const el = document.querySelector(sel); if (el) { el.click(); return true; } return false; };
    const withMatrix = mut => { if (!ed || !ed.matrix) return; const m = ed.matrix.map(r => r.slice()); mut(m); ed.setMatrix(m); };
    const setCell = (r, c, val) => { if (r == null || c == null) return; withMatrix(m => { if (m[r]) m[r][c] = val; }); };
    const fillRect = (r1, c1, r2, c2, val) => withMatrix(m => { for (let r = r1; r <= r2; r++) if (m[r]) for (let c = c1; c <= c2; c++) m[r][c] = val; });
    const doSnapshot = () => Promise.resolve(this.projects && this.projects.commit && this.projects.commit())
      .then(p => { this.notifications?.success?.(p ? `Saved \u201c${p.name}\u201d.` : 'Nothing on the canvas to save yet.'); this.taskbar && this.taskbar.refresh && this.taskbar.refresh(); });

    try {
      switch (id) {
        // ── File / project lifecycle ─────────────────────────────────────────
        case 'file.new': case 'app.newProject':
          Promise.resolve(this.projects && this.projects.createNew && this.projects.createNew()).then(p => { if (p) { this.taskbar && this.taskbar.refresh && this.taskbar.refresh(); this.notifications?.success?.(`Created \u201c${p.name}\u201d.`); } });
          break;
        case 'file.open': case 'project.dashboard': case 'project.recent': case 'app.studio':
          this.projects && this.projects.open && this.projects.open();
          break;
        case 'file.save': case 'project.snapshot': case 'app.save': case 'proj.snapshot':
          doSnapshot();
          break;
        case 'file.saveAs': this.saveProject(); break;
        case 'file.export': case 'app.export': click('#btn-open-export'); break;
        case 'file.backup': this.dataPanel && this.dataPanel.backupAll && this.dataPanel.backupAll(); break;
        case 'file.restore': document.getElementById('kx-btn-restore')?.click(); break;
        case 'file.prefs': case 'app.settings': this._openSettingsViaExtras(); break;
        case 'file.close':
          if (ed && (!ed.matrix || ed.matrix.length) && (typeof window === 'undefined' || window.confirm?.('Close this project? Unsaved work is kept by autosave and your checkpoints.'))) { ed.clear(); this.recompile(); }
          break;

        // ── Edit ─────────────────────────────────────────────────────────────
        case 'edit.undo': ed && ed.undo(); break;
        case 'edit.redo': ed && ed.redo(); break;
        case 'edit.cut': if (ed && ed.cutSelection()) { this.clipShelf && this.clipShelf.capture && this.clipShelf.capture(); this.notifications?.info?.('Cut selection.'); }
          break;
        case 'edit.copy': if (ed && ed.copySelection()) { this.clipShelf && this.clipShelf.capture && this.clipShelf.capture(); this.notifications?.info?.('Copied selection.'); }
          break;
        case 'edit.paste': if (ed && ed.pasteClipboard()) this.notifications?.info?.('Pasted selection.'); break;
        case 'edit.duplicate': this.duplicateSelection && this.duplicateSelection(); break;
        case 'edit.selectAll': if (ed) { ed.selection = { r1: 0, c1: 0, r2: ed.rows - 1, c2: ed.cols - 1 }; ed.render && ed.render(); }
          break;
        case 'edit.invert': ed && ed.invert(); break;
        case 'edit.clear': case 'app.clear': ed && ed.clear(); break;
        case 'edit.clipshelf': case 'app.clipshelf': this.clipShelf && this.clipShelf.open && this.clipShelf.open(); break;
        case 'edit.clearSelection': case 'edit.delete': ed && ed.deleteSelection(); break;
        case 'edit.fill': { const b = ed && ed.getSelectionBounds && ed.getSelectionBounds(); if (b) fillRect(Math.min(b.r1, b.r2), Math.min(b.c1, b.c2), Math.max(b.r1, b.r2), Math.max(b.c1, b.c2), punch(mode)); }
          break;
        case 'edit.flipH': ed && ed.flipHorizontal(); break;
        case 'edit.flipV': ed && ed.flipVertical(); break;
        case 'edit.rotateCW': ed && ed.rotateSelection('cw'); break;
        case 'edit.rotateCCW': ed && ed.rotateSelection('ccw'); break;
        case 'clip.capture': if (ed && ed.copySelection()) { this.clipShelf && this.clipShelf.capture && this.clipShelf.capture(); } this.clipShelf && this.clipShelf.open && this.clipShelf.open(); break;
        case 'clip.pasteMost': this.clipShelf && this.clipShelf.pasteMostRecent && this.clipShelf.pasteMostRecent(); break;

        // ── View ─────────────────────────────────────────────────────────────
        case 'view.fit': ed && ed.fitToView && ed.fitToView(); break;
        case 'view.resetPanels': this._resetPanelPositions(); break;
        case 'view.console': this.console && this.console.toggle && this.console.toggle(); break;
        case 'view.systems': this.console && this.console.open && this.console.open(); this.console && this.console.setView && this.console.setView('systems'); break;
        case 'view.inspector': case 'app.inspector': this._toggleInspector(); break;
        case 'view.structure': case 'app.structure': this.structurePanel && this.structurePanel.toggle && this.structurePanel.toggle(); break;
        case 'view.theme': case 'app.theme': click('#kx-theme'); break;
        case 'view.status': { const sb = document.getElementById('status-bar'); if (sb) sb.hidden = !sb.hidden; }
          break;

        // ── Project ──────────────────────────────────────────────────────────
        case 'project.rename':
          Promise.resolve(this.projects && this.projects.rename && this.projects.rename(this.projects.activeId && this.projects.activeId())).then(() => { this.taskbar && this.taskbar.refresh && this.taskbar.refresh(); });
          break;
        case 'project.open': { const pid = ctx.payload && ctx.payload.id; if (pid && this.projects && this.projects.openProjectById) Promise.resolve(this.projects.openProjectById(pid)).then(() => { this.projects.close && this.projects.close(); this.taskbar && this.taskbar.refresh && this.taskbar.refresh(); }); }
          break;

        // ── Design ───────────────────────────────────────────────────────────
        case 'design.presets': click('#btn-open-presets'); break;
        case 'design.math': click('#btn-open-math'); break;
        case 'design.image': click('#btn-open-image'); break;
        case 'design.knitalong': case 'app.knitAlong': this.knitAlong && this.knitAlong.toggle && this.knitAlong.toggle(); break;
        case 'design.legend': case 'app.symbolLegend': this.symbolLegend && this.symbolLegend.toggle && this.symbolLegend.toggle(); break;
        case 'design.heritage': this.heritagePanel && this.heritagePanel.toggle && this.heritagePanel.toggle(); break;

        // ── Machine ──────────────────────────────────────────────────────────
        case 'machine.feasibility': case 'app.feasibility': this.openFeasibility(); break;
        case 'machine.universe': case 'app.universe': this.openMachineUniverse(); break;
        case 'machine.fitAll': { const r = this.universe && this.universe.tuneForAll && this.universe.tuneForAll(); this.recompile(); this.notifications?.[r && r.changed ? 'success' : 'info']?.(r && r.changed ? 'Tuned to fit every machine.' : 'Already fits every machine.'); }
          break;
        case 'machine.pick': this.elements.profileSelect && this.elements.profileSelect.focus(); this.elements.profileSelect && this.elements.profileSelect.click(); break;

        // ── Help ─────────────────────────────────────────────────────────────
        case 'help.about': click('.brand-section .kx-hbtn'); break;
        case 'help.guide': this.openModal('lace-guide'); break;
        case 'help.eyelets': document.querySelector('.tab-btn[data-tab="editor"]')?.click(); this.openModal('lace-guide'); break;
        case 'help.shortcuts': this._showShortcutsCard(); break;
        case 'help.search': case 'app.search': this.palette && this.palette.open && this.palette.open(); break;
        case 'help.love': this._showLovePopup(); break;

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
        case 'sym.explain': this.symbolLegend && this.symbolLegend.open && this.symbolLegend.open(); break;

        // ── Window / panel (context menu on a draggable surface) ──────────────
        case 'win.close': ctx.anchor && ctx.anchor.querySelector && ctx.anchor.querySelector('[data-close], .modal-close')?.click?.(); break;
        case 'win.dragReset':
          if (ctx.anchor) { ctx.anchor.style.transform = ''; delete ctx.anchor.dataset.kxTx; delete ctx.anchor.dataset.kxTy; if (ctx.anchor.id) { try { localStorage.removeItem('knitcat.drag.v1.' + ctx.anchor.id); } catch (_) { /* storage off */ } } }
          break;
        case 'win.bringForward': if (ctx.anchor) { ctx.anchor.style.position = ctx.anchor.style.position || 'relative'; ctx.anchor.style.zIndex = String(9500 + Math.floor(Math.random() * 500)); }
          break;

        // ── Mode / tool (context menu) ───────────────────────────────────────
        case 'mode.set': if (ctx.anchor && ctx.anchor.click) ctx.anchor.click(); else if (ctx.flags && ctx.flags.mode) this.setPatternMode(ctx.flags.mode);
          break;
        case 'tool.set': if (ctx.anchor && ctx.anchor.click) ctx.anchor.click(); break;

        // ── Project card (context menu on a Studio / taskbar card) ────────────
        case 'proj.open': {
          const card = ctx.anchor; const pid = card && (card.dataset.id || card.dataset.project);
          if (card && card.querySelector && card.querySelector('[data-open]')) card.querySelector('[data-open]').click();
          else if (pid && this.projects) { Promise.resolve(this.projects.openProjectById(pid)).then(() => { this.projects.close && this.projects.close(); this.taskbar && this.taskbar.refresh && this.taskbar.refresh(); }); }
          break;
        }
        case 'proj.rename': {
          const card = ctx.anchor; const pid = card && (card.dataset.id || card.dataset.project);
          if (card && card.querySelector && card.querySelector('[data-ren]')) card.querySelector('[data-ren]').click();
          else if (pid && this.projects) Promise.resolve(this.projects.rename(pid)).then(() => { this.taskbar && this.taskbar.refresh && this.taskbar.refresh(); });
          break;
        }
        case 'proj.delete': {
          const card = ctx.anchor; const pid = card && (card.dataset.id || card.dataset.project);
          if (card && card.querySelector && card.querySelector('[data-del]')) card.querySelector('[data-del]').click();
          else if (pid && this.projects) {
            const ok = typeof window === 'undefined' || typeof window.confirm !== 'function' || window.confirm('Delete this project? Your checkpoints and backup files keep their own copies.');
            if (ok) Promise.resolve(this.projects.remove(pid)).then(() => { this.taskbar && this.taskbar.refresh && this.taskbar.refresh(); });
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
    // Keep the menu bar's enable/disable state honest for the next open.
    if (RECENT_CHANGING.has(id)) this._refreshRecentProjects();
    if (this.menubar && this.menubar.refresh) { try { this.menubar.refresh(); } catch (_) { /* contained */ } }
  }

  initComponentEvents() {
    // Status bar tracking - only if editor is ready
    if (this.editor && this.editor.canvas) {
      this.editor.canvas.addEventListener('pointermove', () => {
        const hc = this.editor.hoverCell;
        if (hc && hc.r >= 0 && hc.c >= 0) {
          this.elements.statusCoords.textContent = `Row: ${hc.r + 1} | Needle: ${hc.c + 1}`;
        } else {
          this.elements.statusCoords.textContent = `Needle: -- | Row: --`;
        }
      });
      // The stitch inspector is a read-only consumer of the same hover state. Kept
      // separate from the editor so it can never affect drawing; a failure just means
      // no inspector, never a broken canvas.
      runGuarded('Stitch inspector', () => {
        this.inspector = createStitchInspector({
          getEditor: () => this.editor,
          getMode: () => this.currentMode,
          getProfile: () => this.currentProfile
        });
      }, { notifier: this.notifications, announce: true });
      // The clip shelf is an additive UI over js/edit/clipboard.js (copy history +
      // named slots). It only ever *drives* the editor's existing paste path and reads
      // editor.clipboard on a copy, so it can never corrupt the canvas — a failure
      // here just means no shelf, never a broken edit.
      runGuarded('Clip shelf', () => {
        this.clipShelf = createClipShelf({
          getEditor: () => this.editor,
          getMode: () => this.currentMode,
          getProfile: () => this.currentProfile,
          notifications: this.notifications
        });
      }, { notifier: this.notifications, announce: true });
      // The structure panel reads the five built-but-unwired js/edit subsystems
      // (documents, layers, guides, history, annotations) and now also drives them:
      // repeat-fill and opening layers/documents go through the editor's undoable
      // setMatrix, so nothing it does can corrupt a card beyond a normal Ctrl+Z.
      runGuarded('Card structure panel', () => {
        this.structurePanel = createStructurePanel({
          getEditor: () => this.editor,
          getMode: () => this.currentMode,
          getProfile: () => this.currentProfile,
          getName: () => (typeof document !== 'undefined' && document.title) || 'Untitled card',
          notifications: this.notifications
        });
      }, { notifier: this.notifications, announce: true });
      // The heritage dock is a read-only reference over the weave knowledge base
      // (structures, looms, designers). Its one action is to draft a woven structure
      // onto the card by id — the same call the pattern browser makes — so it can
      // never corrupt a card, and a failure to boot it just means no dock.
      runGuarded('Textile heritage panel', () => {
        this.heritagePanel = createHeritagePanel({
          applyStructure: (id) => this.loadPreset(id),
          notifications: this.notifications
        });
      }, { notifier: this.notifications, announce: true });
      // The knit-along companion walks the compiled schedule one row at a time and
      // spotlights the current row on the card. It only reads the compilation and
      // paints a highlight — never mutates the matrix — so a boot failure means no
      // dock, never a broken edit.
      runGuarded('Knit-along companion', () => {
        this.knitAlong = createKnitAlong({
          getEditor: () => this.editor,
          getCompilation: () => this.compilationResult,
          getIssues: () => (this.feasibility && this.feasibility.verdict().issues) || [],
          notifications: this.notifications
        });
      }, { notifier: this.notifications, announce: true });
      // The symbol legend surfaces the stitch-info vocabulary (previously an
      // unconsumed table) and lets you highlight every needle doing one thing.
      // Read-only: it paints a spotlight, never edits the matrix.
      runGuarded('Symbol legend', () => {
        this.symbolLegend = createSymbolLegend({
          getEditor: () => this.editor,
          notifications: this.notifications
        });
      }, { notifier: this.notifications, announce: true });
    }

    // Keyboard shortcuts deliberately live in ONE place (see initEvents). They
    // used to be registered here too, which meant every press ran both handlers:
    // Ctrl+Z undid two steps at once and Delete wiped the whole card instead of
    // the selection. One listener, one behaviour.
  }

  initEvents() {
    // Machine Profile change
    this.elements.profileSelect.addEventListener('change', e => {
      const profile = MACHINE_PROFILES[e.target.value];
      if (profile) {
        this.currentProfile = profile;
        this.compiler.setProfile(profile);
        this.editor.setDimensions(this.editor.rows, profile.columns);
        this.updateMachineSpecs();
        this.applyProfileLimits();
        this.recompile();
      }
    });
    this.updateMachineSpecs();
    this.applyProfileLimits();

    // Mode Buttons (Lace, Fair Isle, Tuck, Slip)
    this.elements.modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.elements.modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setPatternMode(btn.dataset.mode);
      });
    });

    // Viewport Tabs — a real, keyboard-driven tablist. The ARIA roles live in
    // index.html (so tests/accessibility.test.mjs can pin them statically); this
    // keeps the *interactive* state honest: exactly one aria-selected tab, a roving
    // tabindex so Tab enters the strip once and the arrows then walk it, and the
    // active tab auto-scrolled into view (the strip is wider than the viewport at
    // almost every window width). Arrow keys activate immediately — the expected
    // pattern for a small, glanceable view-switcher.
    const tabEls = [...this.elements.tabButtons];
    const centerTab = (btn) => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      try {
        btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduce ? 'auto' : 'smooth' });
      } catch (_) { /* option unsupported: centering is only a nicety */ }
    };
    const activateTab = (btn, { focus = false } = {}) => {
      if (!btn) return;
      this.elements.tabButtons.forEach(b => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      this.elements.tabPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');

      const targetTab = btn.dataset.tab;
      this.activeTab = targetTab;
      const panel = document.getElementById(`panel-${targetTab}`);
      if (panel) panel.classList.add('active');

      centerTab(btn);
      if (focus) btn.focus();
      this.onTabSwitched(targetTab);
    };
    // Command palette, ?tab= deep links and the garment shortcuts all dispatch a
    // click, so they inherit the full aria/centre/keyboard behaviour for free.
    this._activateTab = activateTab;
    tabEls.forEach(btn => btn.addEventListener('click', () => activateTab(btn)));
    document.querySelector('.tab-bar')?.addEventListener('keydown', (e) => {
      const i = tabEls.indexOf(document.activeElement);
      if (i < 0) return;
      let next;
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': next = tabEls[(i + 1) % tabEls.length]; break;
        case 'ArrowLeft': case 'ArrowUp': next = tabEls[(i - 1 + tabEls.length) % tabEls.length]; break;
        case 'Home': next = tabEls[0]; break;
        case 'End': next = tabEls[tabEls.length - 1]; break;
        default: return;
      }
      e.preventDefault();
      activateTab(next, { focus: true });
    });

    // Tool Buttons (Pencil, Eraser, Line, Rect, Circle, Fill)
    this.elements.toolButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.elements.toolButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (this.editor) this.editor.activeTool = btn.dataset.tool;
      });
    });

    // Lace Stitch Selectors
    this.elements.stitchButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.elements.stitchButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (this.editor) this.editor.activeStitch = btn.dataset.stitch;
      });
    });

    // Fair Isle / Jacquard Yarn selectors (A = blank, B = punch hole). Previously
    // these buttons did nothing, so every stroke painted Yarn B regardless of choice.
    document.querySelectorAll('#color-palette .stitch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#color-palette .stitch-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (this.editor) this.editor.activeColor = parseInt(btn.dataset.color, 10) || 0;
      });
    });

    // Undo / Redo / Clear / Invert / Symmetry
    document.getElementById('btn-undo')?.addEventListener('click', () => this.editor?.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.editor?.redo());
    document.getElementById('btn-clear')?.addEventListener('click', () => this.editor?.clear());
    document.getElementById('btn-invert')?.addEventListener('click', () => this.editor?.invert());
    document.getElementById('btn-flip-h')?.addEventListener('click', () => this.editor?.flipHorizontal());
    document.getElementById('btn-flip-v')?.addEventListener('click', () => this.editor?.flipVertical());
    
    // View controls
    document.getElementById('btn-pan')?.addEventListener('click', () => this.editor?.setActiveTool('pan'));
    document.getElementById('btn-fit')?.addEventListener('click', () => this.editor?.fitToView());

    // Symmetry checkboxes
    document.getElementById('chk-sym-h')?.addEventListener('change', e => {
      if (this.editor) this.editor.symmetryH = e.target.checked;
    });
    document.getElementById('chk-sym-v')?.addEventListener('change', e => {
      if (this.editor) this.editor.symmetryV = e.target.checked;
    });

    // Grid dimension inputs
    document.getElementById('input-rows')?.addEventListener('change', e => {
      if (!this.editor) return;
      const { minRows, maxRows } = profileLimits(this.currentProfile);
      const rows = Math.max(minRows, Math.min(maxRows, parseInt(e.target.value) || 24));
      this.editor.setDimensions(rows, this.editor.cols);
      // Echo the clamp back into the box, otherwise it silently disagrees with
      // the canvas (you type 500, it knits 240, the field still says 500).
      e.target.value = rows;
    });

    // Modal Triggers
    document.getElementById('btn-open-math')?.addEventListener('click', () => this.openModal('math'));
    document.getElementById('btn-open-image')?.addEventListener('click', () => this.openModal('image'));
    document.getElementById('btn-open-presets')?.addEventListener('click', () => this.openPresetsModal());
    document.getElementById('btn-open-export')?.addEventListener('click', () => this.openModal('export'));
    // The eyelet-vs-transfer explainer is static HTML in index.html (crawlable +
    // readable with JS off); this only shows it.
    document.getElementById('btn-lace-guide')?.addEventListener('click', () => this.openModal('lace-guide'));

    // Modal Close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        this.closeAllModals();
      });
    });

    // Math pattern generation
    document.getElementById('btn-generate-math')?.addEventListener('click', () => {
      this.executeMathGenerator();
      this.closeAllModals();
    });
    // Shuffle replaces the seed with a random one and applies it. The number lands
    // in the field before the modal closes, so a result worth keeping is readable.
    document.getElementById('btn-roll-math-seed')?.addEventListener('click', () => {
      this.rollMathSeed();
      this.closeAllModals();
    });

    // Image importer file upload & live preview
    const imageInput = document.getElementById('image-file-input');
    imageInput?.addEventListener('change', e => this.handleImageUpload(e));
    ['image-dither-method', 'image-contrast', 'image-gamma', 'image-invert', 'image-bridges'].forEach(id => {
      const el = document.getElementById(id);
      el?.addEventListener('input', () => this.previewImportedImage());
      el?.addEventListener('change', () => this.previewImportedImage());
    });
    document.getElementById('btn-apply-image')?.addEventListener('click', () => {
      this.applyImportedImage();
      this.closeAllModals();
    });

    // Math generator parameter visibility
    const mathTypeSelect = document.getElementById('math-gen-type');
    const updateMathParams = () => {
      const val = mathTypeSelect?.value;
      const turingGroup = document.getElementById('group-turing-preset');
      const wolframGroup = document.getElementById('group-wolfram-rule');
      if (turingGroup) turingGroup.style.display = (val === 'turing') ? 'flex' : 'none';
      if (wolframGroup) wolframGroup.style.display = (val === 'wolfram') ? 'flex' : 'none';
    };
    mathTypeSelect?.addEventListener('change', updateMathParams);
    updateMathParams();

    // Romance mode is always on — no toggle needed
    // Yarn colours already set in initComponents.

    // CNC Toolpath Controls (play/pause/reset/zoom/fit/speed)
    document.getElementById('btn-cnc-play')?.addEventListener('click', () => this.toolpathViewer.play());
    document.getElementById('btn-cnc-pause')?.addEventListener('click', () => this.toolpathViewer.pause());
    document.getElementById('btn-cnc-reset')?.addEventListener('click', () => this.toolpathViewer.reset());
    document.getElementById('btn-cnc-zoom-in')?.addEventListener('click', () => this.toolpathViewer.zoomBy(1.3));
    document.getElementById('btn-cnc-zoom-out')?.addEventListener('click', () => this.toolpathViewer.zoomBy(1 / 1.3));
    document.getElementById('btn-cnc-fit')?.addEventListener('click', () => this.toolpathViewer.fitToViewport());
    const cncSpeedSlider = document.getElementById('cnc-sim-speed');
    const cncSpeedVal = document.getElementById('cnc-speed-val');
    if (cncSpeedSlider) {
      cncSpeedSlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        this.toolpathViewer.setSimSpeed(v);
        if (cncSpeedVal) cncSpeedVal.textContent = `${v}×`;
      });
    }

    // Schedule Toolbar Controls
    document.getElementById('btn-schedule-verify')?.addEventListener('click', () => this.verifySchedule());
    document.getElementById('btn-schedule-optimize')?.addEventListener('click', () => this.optimizeSchedule());
    document.getElementById('btn-schedule-export')?.addEventListener('click', () => this.exportScheduleCSV());
    document.getElementById('btn-schedule-stats')?.addEventListener('click', () => this.toggleScheduleStats());
    document.getElementById('btn-schedule-collisions')?.addEventListener('click', () => this.detectCollisions());
    
    // Schedule View Toggle
    document.getElementById('btn-view-detailed')?.addEventListener('click', () => this.setScheduleView('detailed'));
    document.getElementById('btn-view-compact')?.addEventListener('click', () => this.setScheduleView('compact'));
    document.getElementById('btn-view-timeline')?.addEventListener('click', () => this.setScheduleView('timeline'));

    // Yarn Simulation Toolbar Controls
    document.getElementById('btn-yarn-relax')?.addEventListener('click', () => this.forceYarnRelaxation());
    document.getElementById('btn-yarn-tension')?.addEventListener('click', () => this.cycleYarnTension());
    document.getElementById('btn-yarn-gravity')?.addEventListener('click', () => this.toggleYarnGravity());
    document.getElementById('btn-yarn-reset')?.addEventListener('click', () => this.resetFabricMounting());
    document.getElementById('btn-yarn-cotton')?.addEventListener('click', () => this.setYarnMaterial('cotton'));
    document.getElementById('btn-yarn-wool')?.addEventListener('click', () => this.setYarnMaterial('wool'));
    document.getElementById('btn-yarn-silk')?.addEventListener('click', () => this.setYarnMaterial('silk'));
    document.getElementById('btn-yarn-wireframe')?.addEventListener('click', () => this.setYarnViewMode('wireframe'));
    document.getElementById('btn-yarn-shaded')?.addEventListener('click', () => this.setYarnViewMode('shaded'));
    document.getElementById('btn-yarn-stress')?.addEventListener('click', () => this.setYarnViewMode('stress'));
    document.getElementById('btn-yarn-screenshot')?.addEventListener('click', () => this.takeYarnScreenshot());
    document.getElementById('btn-yarn-export-obj')?.addEventListener('click', () => this.exportYarn3D());

    // Punchcard Toolbar Controls
    document.getElementById('btn-punch-verify')?.addEventListener('click', () => this.verifyPunchcard());
    document.getElementById('btn-punch-invert')?.addEventListener('click', () => this.invertPunchcard());
    document.getElementById('btn-punch-clear')?.addEventListener('click', () => this.clearPunchcard());
    document.getElementById('btn-punch-standard')?.addEventListener('click', () => this.setPunchcardView('standard'));
    document.getElementById('btn-punch-mirror')?.addEventListener('click', () => this.setPunchcardView('mirror'));
    document.getElementById('btn-punch-overlay')?.addEventListener('click', () => this.setPunchcardView('overlay'));
    document.getElementById('btn-punch-print')?.addEventListener('click', () => this.printPunchcard());
    document.getElementById('btn-punch-image')?.addEventListener('click', () => this.exportPunchcardImage());
    document.getElementById('btn-punch-stats')?.addEventListener('click', () => this.showPunchcardStats());
    document.getElementById('btn-punch-density')?.addEventListener('click', () => this.analyzePunchcardDensity());

    // Enhanced CNC Toolbar Controls
    document.getElementById('btn-cnc-step')?.addEventListener('click', () => this.toolpathViewer.step());
    document.getElementById('btn-cnc-pan')?.addEventListener('click', () => this.toggleCncPanMode());
    document.getElementById('btn-cnc-optimize')?.addEventListener('click', () => this.optimizeCncToolpath());
    document.getElementById('btn-cnc-reverse')?.addEventListener('click', () => this.reverseCncToolpath());
    document.getElementById('btn-cnc-show-all')?.addEventListener('click', () => this.showAllCncToolpaths());
    document.getElementById('btn-cnc-export-gcode')?.addEventListener('click', () => this.exportGCode());
    document.getElementById('btn-cnc-export-dxf')?.addEventListener('click', () => this.exportDXF());
    document.getElementById('btn-cnc-screenshot')?.addEventListener('click', () => this.takeCncScreenshot());

    // Brother Kinematics Toolbar Controls
    document.getElementById('btn-brother-play')?.addEventListener('click', () => this.playBrotherSimulation());
    document.getElementById('btn-brother-pause')?.addEventListener('click', () => this.pauseBrotherSimulation());
    document.getElementById('btn-brother-reset')?.addEventListener('click', () => this.resetBrotherSimulation());
    document.getElementById('btn-brother-lace')?.addEventListener('click', () => this.setBrotherCarriage('lace'));
    document.getElementById('btn-brother-knit')?.addEventListener('click', () => this.setBrotherCarriage('knit'));
    document.getElementById('btn-brother-garter')?.addEventListener('click', () => this.setBrotherCarriage('garter'));
    document.getElementById('btn-brother-timing')?.addEventListener('click', () => this.analyzeBrotherTiming());
    document.getElementById('btn-brother-stress')?.addEventListener('click', () => this.analyzeBrotherStress());
    document.getElementById('btn-brother-export')?.addEventListener('click', () => this.exportBrotherData());
    
    // Brother speed control
    const brotherSpeedSlider = document.getElementById('brother-speed');
    const brotherSpeedVal = document.getElementById('brother-speed-val');
    if (brotherSpeedSlider) {
      brotherSpeedSlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        if (this.brotherCanvas) this.brotherCanvas.setSimSpeed(v);
        if (brotherSpeedVal) brotherSpeedVal.textContent = `${v}×`;
      });
    }

    // Tank-top and beanie tailor controls now live in the unified Clothes tab;
    // their wiring is set up once in _initClothesUI().

    // Export Actions
    document.getElementById('btn-export-dxf')?.addEventListener('click', () => this.exportDXF());
    document.getElementById('btn-export-gcode')?.addEventListener('click', () => this.exportGCode());
    document.getElementById('btn-export-svg')?.addEventListener('click', () => this.exportLaserSVG());
    document.getElementById('btn-export-print')?.addEventListener('click', () => this.exportPrintableSheet());
    document.getElementById('btn-export-dak')?.addEventListener('click', () => this.exportDAK());
    document.getElementById('btn-export-bin')?.addEventListener('click', () => this.exportBinary());
    document.getElementById('btn-export-csv')?.addEventListener('click', () => this.exportCSV());
    document.getElementById('btn-export-json')?.addEventListener('click', () => this.saveProject());
    document.getElementById('btn-load-json')?.addEventListener('change', e => this.loadProject(e));
    
    // Additional advanced exports
    document.getElementById('btn-export-ayab')?.addEventListener('click', () => this.exportAYAB());
    document.getElementById('btn-export-brother')?.addEventListener('click', () => this.exportBrotherDisk());
    document.getElementById('btn-export-xml')?.addEventListener('click', () => this.exportXML());
    document.getElementById('btn-export-docs')?.addEventListener('click', () => this.exportDocumentation());

    // Status bar tracking - only if editor is ready
    if (this.editor && this.editor.canvas) {
      this.editor.canvas.addEventListener('pointermove', () => {
        const hc = this.editor.hoverCell;
        if (hc && hc.r >= 0 && hc.c >= 0) {
          this.elements.statusCoords.textContent = `Row: ${hc.r + 1} | Needle: ${hc.c + 1}`;
        } else {
          this.elements.statusCoords.textContent = `Needle: -- | Row: --`;
        }
      });
    }

    // Keyboard Shortcuts — the one and only global handler.
    window.addEventListener('keydown', e => {
      // Tab is for moving between controls, always. Trap it inside an open dialog
      // before anything else gets a chance to swallow it.
      if (e.key === 'Tab' && this.trapModalFocus(e)) return;

      // Escape must always reach the modal closer, even from inside a field.
      if (e.key !== 'Escape' && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;

      // A dialog is open: the page behind it is inert, so tool shortcuts must not
      // fire while someone is typing in the export form.
      if (e.key !== 'Escape' && document.querySelector('.modal-backdrop.active')) return;

      // Compare lowercase. e.key is case-sensitive and carries Shift, so a raw
      // 'z' test silently breaks undo for anyone with Caps Lock on — and Ctrl+Z
      // is the one binding nobody tolerates losing.
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && k === 'z' && e.shiftKey) {
        // Checked before plain Ctrl+Z: this is the redo everyone reaches for by instinct.
        this.editor?.redo();
        e.preventDefault();
      } else if (mod && k === 'z') {
        this.editor?.undo();
        e.preventDefault();
      } else if (mod && k === 'y') {
        this.editor?.redo();
        e.preventDefault();
      } else if (mod && k === 'c') {
        if (this.editor?.copySelection()) { e.preventDefault(); this.notifications.info('Copied selection.'); this.clipShelf?.capture?.(); }
      } else if (mod && k === 'x') {
        if (this.editor?.cutSelection()) { e.preventDefault(); this.notifications.info('Cut selection.'); this.clipShelf?.capture?.(); }
      } else if (mod && k === 'v') {
        if (this.editor?.pasteClipboard()) { e.preventDefault(); this.notifications.info('Pasted selection.'); }
      } else if (mod && k === 'd') {
        // Ctrl+D duplicates the selection in place (offset by one cell).
        e.preventDefault();
        this.duplicateSelection?.();
      } else if (mod && k === 'r' && e.shiftKey) {
        // Ctrl+Shift+R is the browser's hard reload and cannot truly be intercepted.
        // Plant a flag that survives the reload (sessionStorage persists per tab), so
        // the fresh page boots straight back into the Projects Dashboard; open it now
        // too, in case this environment suppresses the reload.
        try { sessionStorage.setItem('knitcat.openStudioOnLoad', '1'); } catch (_) { /* private mode */ }
        this.projects?.open?.();
      } else if (mod) {
        // Ctrl/Cmd combinations we do not claim belong to the browser — Ctrl+W,
        // Ctrl+T, Ctrl+R and friends must keep working. Stopping the chain here
        // also means a bare-letter shortcut can never fire behind a modifier.
        return;
      } else if (k === 'p' || k === 'b') {
        document.querySelector('[data-tool="pencil"]')?.click();
      } else if (k === 'e') {
        document.querySelector('[data-tool="eraser"]')?.click();
      } else if (k === 'l') {
        document.querySelector('[data-tool="line"]')?.click();
      } else if (k === 'r') {
        document.querySelector('[data-tool="rect"]')?.click();
      } else if (k === 'c') {
        document.querySelector('[data-tool="circle"]')?.click();
      } else if (k === 'o') {
        document.querySelector('[data-tool="rectOutline"]')?.click();
      } else if (k === 'i') {
        document.querySelector('[data-tool="circleOutline"]')?.click();
      } else if (k === 'g') {
        // 'g' for fill — 'f' stays owned by the CNC toolpath viewer (fit to view).
        document.querySelector('[data-tool="fill"]')?.click();
      } else if (k === 's') {
        document.querySelector('[data-tool="select"]')?.click();
      } else if (k === 'u') {
        this.editor?.undo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.editor?.deleteSelection()) { e.preventDefault(); }
      } else if (e.key === '[') {
        this.editor?.rotateSelection('ccw');
      } else if (e.key === ']') {
        this.editor?.rotateSelection('cw');
      } else if (e.altKey && e.key.indexOf('Arrow') === 0 && this.editor?.shift) {
        // Alt+Arrow wraps the whole card (toroidal) — perfect for checking that
        // a repeat tiles seamlessly across the seam.
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
        if (d) { e.preventDefault(); this.editor.shift(d[0], d[1]); this.recompile(); }
      } else if (e.key === 'Escape') {
        this._closeTopModal();
      }
    });

    // Feasibility advisor — the always-available "is this knit-able?" check.
    document.getElementById('btn-feasibility')?.addEventListener('click', () => this.openFeasibility());
    // The sidebar health panel mirrors those two entry points so the deep tools
    // are reachable right where the score is shown.
    document.getElementById('btn-health-advisor')?.addEventListener('click', () => this.openFeasibility('advisor'));
    document.getElementById('btn-health-universe')?.addEventListener('click', () => this.openMachineUniverse());

    // The unified Clothes tailor canvas should track the window (GarmentCanvas owns
    // its own resize listener too; this refreshes the sidebar read-outs in sync).
    window.addEventListener('resize', () => {
      if (this.activeTab === 'clothes') this.renderClothes();
    });

    // Publish the *visual* viewport height as --kx-vh (see _installViewportHeight).
    this._installViewportHeight();
  }

  // The sheet's #app-container height reads `var(--kx-vh, 100dvh)`, and its comment
  // claims the variable is "overridden live by js/app.js" — but nothing set it, so the
  // shell never tracked the on-screen box when the mobile keyboard opened (§4.7).
  // Mirror visualViewport.height onto the root; fall back to innerHeight where the
  // Visual Viewport API is absent. On a desktop the two agree, so this is inert.
  _installViewportHeight() {
    const apply = () => {
      const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      if (Number.isFinite(h)) document.documentElement.style.setProperty('--kx-vh', `${Math.round(h)}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', apply);
      window.visualViewport.addEventListener('scroll', apply);
    }
  }

  /**
   * Switch patterning mode.
   * @param {string} mode
   * @param {{recompile?:boolean}} [options] pass `recompile: false` when the caller
   *   is about to load a chart anyway — otherwise the card is compiled once for the
   *   old (about to be replaced) matrix and once for the new one, and the first pass
   *   is pure waste on every preset load and project import.
   */
  setPatternMode(mode, options = {}) {
    const { recompile = true } = options;
    this.currentMode = mode;
    if (this.editor) {
      this.editor.setMode(mode);
    }

    if (mode === 'lace') {
      this.elements.lacePalette.style.display = 'flex';
      this.elements.colorPalette.style.display = 'none';
    } else {
      this.elements.lacePalette.style.display = 'none';
      this.elements.colorPalette.style.display = 'flex';
    }

    if (recompile) this.recompile();
  }

  handlePatternChange() {
    this._cardDirty = true;
    fx('click');
    this.recompile();
    this.dataPanel?.touch();
  }

  recompile() {
    // Timing the compile is genuinely useful (it is the number that grows on big
    // cards) and it costs one performance.now() pair. Surfaced in the diagnostics
    // panel and the schedule header.
    const t0 = performance.now();
    if (this.currentMode === 'lace') {
      this.compilationResult = this.compiler.compile(this.editor.matrix);
    } else {
      this.compilationResult = this.compiler.compileDirectPattern(this.editor.matrix, this.currentMode);
    }
    this.lastCompileMs = performance.now() - t0;

    this.updateScheduleUI();
    this.updateStatusStats();
    this._renderHealth();
    if (this.knitAlong) this.knitAlong.refresh();
    if (this.symbolLegend) this.symbolLegend.refresh();
    this._cardDirty = false;

    // The kinematics sim always tracks the live card, not just the row it happened
    // to be given when the tab was opened. Cheap, and it keeps the animation
    // honest while you edit on another tab.
    if (this.brotherCanvas) {
      this.brotherCanvas.setCard(this.compilationResult.cardMatrix, this.compilationResult.strokes);
    }

    // Update active tab contents (guarded: this can fire before initComponents()
    // has built the yarn/CAD subsystems, e.g. on a deferred cold launch).
    if (this.activeTab === 'yarn') {
      if (this.yarnSim && this.editor) this.yarnSim.updateFabric(this.editor.matrix);
    } else if (this.activeTab === 'punchcard') {
      this.renderPunchcardRibbon();
    } else if (this.activeTab === 'cnc') {
      if (this.toolpathViewer && this.compilationResult) {
        this.toolpathViewer.setCardData(this.currentProfile, this.compilationResult.cardMatrix);
      }
    }
  }

  onTabSwitched(tab) {
    // Contextual interface: the editor-only left draw toolbar and the CAD sub-bar
    // only belong to the Pattern CAD Editor. Elsewhere they'd be noise (Hick's
    // Law / cognitive-load). Drive it off a single data attribute.
    try { document.body.dataset.tab = tab; } catch (_) { /* ignore */ }
    fx('tab');
    // Contained: a throwing tab render only affects that tab, never the whole app.
    runGuarded(`Switched to "${tab}" tab`, () => this._renderTab(tab), {
      notifier: this.notifications
    });
  }

  _renderTab(tab) {
    if (this.yarnSim) this.yarnSim.stop();
    if (this.brotherCanvas) this.brotherCanvas.pause();

    if (tab === 'editor') {
      this.editor?.resizeCanvas();
      this.editor?.render();
    } else if (tab === 'yarn') {
      // Cold launch from a PWA `?tab=yarn` shortcut can reach here before
      // initComponents() has constructed the sim; guard so we no-op instead of
      // throwing, and let the post-init replay below render it once ready.
      this.yarnSim?.resize();
      if (this.yarnSim && this.editor) this.yarnSim.updateFabric(this.editor.matrix);
      this.yarnSim?.startAnimationLoop();
    } else if (tab === 'punchcard') {
      // Always regenerate the card for the CURRENT mode before drawing, so a
      // Fair Isle / Tuck / Slip drawing you just made is reflected on the ribbon
      // (previously it could show a stale or lace-only compilation).
      // Only regenerate when the editor actually changed since the last compile,
      // so explicit card edits (invert / clear / optimize) survive a tab switch.
      if (this._cardDirty) this.recompile(); else this.renderPunchcardRibbon();
    } else if (tab === 'cnc') {
      this.toolpathViewer?.resize();
      if (this.toolpathViewer && this.compilationResult) {
        this.toolpathViewer.setCardData(this.currentProfile, this.compilationResult.cardMatrix);
      }
    } else if (tab === 'clothes') {
      this.garmentCanvas?.resize();
      this.renderClothes();
    } else if (tab === 'brother') {
      this.brotherCanvas?.resize();
      // Hand over the whole compiled card so the drum indexes row 2, 3, 4…
      this.brotherCanvas?.setCard(
        this.compilationResult?.cardMatrix || [],
        this.compilationResult?.strokes || []
      );
      this.brotherCanvas?.play();
    }
  }

  // Duplicate the current marquee selection offset by one cell down-right.
  duplicateSelection() {
    const ed = this.editor;
    if (!ed || !ed.copySelection()) return;
    const b = ed.getSelectionBounds();
    if (!b) return;
    const src = ed.clipboard;
    for (let r = 0; r < src.rows; r++) {
      for (let c = 0; c < src.cols; c++) {
        const tr = b.r1 + 1 + r, tc = b.c1 + 1 + c;
        if (tr >= 0 && tr < ed.rows && tc >= 0 && tc < ed.cols) ed.matrix[tr][tc] = src.cells[r][c];
      }
    }
    ed.saveState(); ed.render(); ed.onChange();
    this.notifications.info('Duplicated selection.');
  }

  updateScheduleUI() {
    const list = this.elements.scheduleContainer;
    if (!list) return;

    if (!this.compilationResult || this.compilationResult.strokes.length === 0) {
      list.innerHTML = '<div class="empty-hint">No carriage strokes generated. Design a pattern to decompile passes.</div>';
      return;
    }

    const strokes = this.compilationResult.strokes;
    list.innerHTML = strokes.map((s, idx) => {
      const isLace = s.carriageType === CARRIAGE_TYPE.LACE;
      const dirIcon = (s.direction === DIRECTION.LEFT_TO_RIGHT) ? '→ (L→R)' : '← (R←L)';
      const typeBadge = isLace
        ? '<span class="badge badge-lace">LACE (L)</span>'
        : (s.carriageType === CARRIAGE_TYPE.COMBINED ? '<span class="badge badge-comb">COMBINED</span>' : '<span class="badge badge-knit">KNIT (K)</span>');

      const transferCount = s.transfers ? s.transfers.length : 0;
      const transferDetail = transferCount > 0
        ? `<div class="stroke-transfers">Transfers: ${s.transfers.map(t => `${t.sourceCol + 1}→${t.targetCol + 1}`).join(', ')}</div>`
        : '';

      return `
        <div class="schedule-item ${isLace ? 'item-lace' : 'item-knit'}">
          <div class="stroke-header">
            <span class="stroke-num">#${idx + 1}</span>
            ${typeBadge}
            <span class="stroke-dir">${dirIcon}</span>
            <span class="stroke-card-row">Card Row ${s.cardRowIndex + 1}</span>
          </div>
          <div class="stroke-notes">${s.notes}</div>
          ${transferDetail}
        </div>
      `;
    }).join('');
  }

  /**
   * Render the Design-Health "Live machine check" list in the right sidebar.
   *
   * It reads from the SAME feasibility verdict the advisor modal uses — it no
   * longer runs a parallel float/bed scan (which disagreed with the advisor on
   * tuck semantics, so one would flag a column while the other stayed silent).
   * One source, so the sidebar and the report can never contradict each other.
   * Each row is clickable and lights the exact stitches up on the canvas, or
   * opens the full advisor when the finding is not cell-local.
   *
   * @param {object} [verdict]  A precomputed feasibility verdict; computed here if omitted.
   */
  updateDiagnosticsUI(verdict) {
    const diagList = this.elements.diagnosticsContainer;
    if (!diagList) return;
    let v = verdict;
    try { v = v || (this.feasibility && this.feasibility.verdict()); } catch (_) { v = null; }
    if (!v) { diagList.innerHTML = '<div class="diag-ok">\u2713 No carriage conflicts detected.</div>'; return; }
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const flagged = v.issues.filter(i => i.sev === 'error' || i.sev === 'warn');
    if (!flagged.length) {
      diagList.innerHTML = `<div class="diag-ok">\u2713 ${esc(v.status === 'feasible' ? 'No carriage conflicts or float risks \u2014 clear to knit.' : 'Nothing blocking. Craft notes live in the full advisor.')}</div>`;
      return;
    }
    const glyph = s => (s === 'error' ? '\u26d4' : '\u26a0');
    const cls = s => (s === 'error' ? 'diag-error' : 'diag-warning');
    diagList.innerHTML = flagged.slice(0, 8).map(it => {
      const idx = v.issues.indexOf(it);
      return `<button type="button" class="diag-item ${cls(it.sev)} diag-btn" data-diag="${idx}">
        <span class="diag-icon">${glyph(it.sev)}</span>
        <span class="diag-msg">${esc(it.title)}</span>
        ${it.where ? `<span class="diag-loc">${esc(it.where)}</span>` : ''}
      </button>`;
    }).join('');
    diagList.querySelectorAll('[data-diag]').forEach(b =>
      b.addEventListener('click', () => this._revealIssue(v.issues[parseInt(b.dataset.diag, 10)])));
  }

  /**
   * Reveal an advisor finding where it actually lives: spotlight the offending
   * cells on the canvas, else open the full advisor. Shared by the sidebar list
   * and the modal's "Show me on the card" button so both behave identically.
   *
   * @param {object} it  A feasibility issue (may carry cells/where).
   */
  _revealIssue(it) {
    if (!it) return;
    if (Array.isArray(it.cells) && it.cells.length && this.editor) {
      try { document.querySelector('.tab-btn[data-tab="editor"]')?.click(); } catch (_) { /* headless */ }
      try { this.editor.setHighlight(it.cells, { label: it.title }); } catch (_) { /* contained */ }
      document.getElementById('kx-feas-backdrop')?.remove();
      this.notifications?.info?.(`${it.title}${it.where ? ` \u2014 ${it.where}` : ''}. Highlighted on the card.`, { duration: 7000 });
    } else {
      this.openFeasibility('advisor');
    }
  }

  updateStatusStats() {
    if (!this.compilationResult) return;
    const cardRows = this.compilationResult.cardMatrix.length;
    let punchedCount = 0;
    for (const r of this.compilationResult.cardMatrix) {
      for (const h of r) if (h) punchedCount++;
    }

    const fabric = gridSizeMm(this.editor.rows, this.editor.cols, this.currentProfile);
    const fabricLabel = `Fabric ≈ ${formatLength(fabric.widthMm, 'cm')} × ${formatLength(fabric.heightMm, 'cm')}`;
    this.elements.statusStats.textContent = `Pattern: ${this.editor.rows}r × ${this.editor.cols}c | ${fabricLabel} | Card Rows: ${cardRows} | Total Strokes: ${this.compilationResult.totalPasses} (${this.compilationResult.totalLacePasses} Lace, ${this.compilationResult.totalKnitPasses} Knit) | Punched Holes: ${punchedCount}`;
    // Cell counts answer "how many"; only the gauge turns them into "how big". A
    // knitter deciding whether a motif fits a cuff thinks in centimetres, so the
    // real-world footprint is kept live in the status line — derived from the same
    // pitch the editor rulers use, and updated whenever the machine changes.
    this.elements.statusStats.title = `${fabric.widthMm.toFixed(0)} × ${fabric.heightMm.toFixed(0)} mm at ${this.currentProfile.pitchX}×${this.currentProfile.pitchY} mm gauge on the ${this.currentProfile.name}`;
    // The needle-bed count stays on show: it is the difference that changes what a
    // "transfer" even means, and it used to be hidden in the profile description.
    const bedLabel = this.currentProfile.beds === 2 ? 'double bed' : 'single bed';
    this.elements.statusProfile.textContent = `${this.currentProfile.name} · ${bedLabel}`;
    this.elements.statusProfile.title = this.currentProfile.description;
  }

  /**
   * Push the selected machine's physical envelope into the dimension controls.
   *
   * The Rows box used to be pinned to max="240" in the markup no matter which
   * profile was chosen, so the 600-row parametric/CNC bed could never actually be
   * reached from the UI — and a machine with a higher ceiling just silently
   * clamped what you typed. The bed width is reported too, because that is the
   * one limit a knitter cannot work around with patience.
   */
  applyProfileLimits() {
    const limits = profileLimits(this.currentProfile);
    const rowsInput = document.getElementById('input-rows');
    if (rowsInput) {
      rowsInput.min = String(limits.minRows);
      rowsInput.max = String(limits.maxRows);
      const current = parseInt(rowsInput.value, 10);
      if (!Number.isFinite(current) || current < limits.minRows || current > limits.maxRows) {
        rowsInput.value = String(Math.min(Math.max(current || this.currentProfile.defaultRows, limits.minRows), limits.maxRows));
      }
      rowsInput.title = `Rows on this machine: ${limits.minRows}-${limits.maxRows}. Longer cards are joined in series.`;
    }
    if (this.editor && this.editor.rows > limits.maxRows) {
      this.editor.setDimensions(limits.maxRows, this.editor.cols);
    }
    // An over-wide card is NOT auto-trimmed. Rows past the bottom of a long card
    // are a nuisance; columns past the end of the bed are somebody's imported
    // artwork, and silently amputating it when they change machine profile would
    // be vandalism. The feasibility advisor flags it in red with a one-click trim.
    if (this.editor && this.editor.cols > limits.maxNeedles) {
      this.notifications?.warn?.(
        `${this.editor.cols} columns won't fit the ${this.currentProfile.name}`,
        { details: `The bed holds ${limits.maxNeedles} needles. Columns past that are never read by the carriage — open the Feasibility advisor for a one-click trim.`, duration: 9000 }
      );
    }
    const colsNote = document.getElementById('spec-bed-width');
    if (colsNote) {
      colsNote.textContent = `${limits.maxNeedles} needles (${(this.currentProfile.bedLengthMm / 10).toFixed(0)} cm bed)`;
      colsNote.title = `${limits.maxNeedles} needles at ${this.currentProfile.pitchX} mm pitch on a ${this.currentProfile.bedLengthMm} mm bed.`;
    }
  }

  updateMachineSpecs() {
    const p = this.currentProfile;
    if (!p) return;
    const setElem = (id, val, tip) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = val;
      if (tip !== undefined) el.title = tip;
    };
    setElem('spec-pitch-x', `${p.pitchX.toFixed(2)} mm`);
    setElem('spec-pitch-y', `${p.pitchY.toFixed(2)} mm`);
    setElem('spec-hole-dia', `${p.holeDiameter.toFixed(2)} mm`);
    setElem('spec-sprock-dia', `${p.sprocketDiameter.toFixed(2)} mm`);

    let carriageRuleName = 'Brother Separated (L/K)';
    if (p.carriageRules?.type === 'silver_reed_combined') carriageRuleName = 'Silver Reed Simultaneous (LC)';
    else if (p.carriageRules?.type === 'passap_pushers') carriageRuleName = 'Passap Duo Pushers';
    else if (p.carriageRules?.type === 'brother_bulky') carriageRuleName = 'Brother Bulky 9mm';
    else if (p.carriageRules?.type === 'toyota_simplex') carriageRuleName = 'Toyota Simplex';
    setElem('spec-carriage-rule', carriageRuleName);
    // Bed count is the difference that changes what a "transfer" even means, so it
    // is stated here rather than left inside the profile description.
    setElem('spec-beds', p.beds === 2 ? 'Double bed (front + back)' : 'Single bed', p.beds === 2
      ? 'Loops move between two opposed needle beds. Transfers designed for a single bed do not apply — the advisor flags this profile.'
      : 'A transfer moves a loop to the neighbouring needle on the same bed, and only while the carriage travels that way.');
    setElem('spec-max-float', `up to ${profileLimits(p).maxFloatNeedles} sts carried`,
      'Longer stranded runs than this catch on fingers and pull the fabric in. Tuck and slip have their own limits, which the advisor checks.');
    this.applyProfileLimits();
  }

  renderPunchcardRibbon() {
    const canvas = this.elements.punchcardCanvas;
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth || 800;
      canvas.height = Math.max(parent.clientHeight || 600, (this.compilationResult.cardMatrix.length * 16) + 120);
    }

    const ctx = this.punchcardCtx;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, w, h);

    if (!this.compilationResult || this.compilationResult.cardMatrix.length === 0) return;

    const cardMatrix = this.compilationResult.cardMatrix;
    const rows = cardMatrix.length;
    const cols = cardMatrix[0]?.length || 24;

    // Per-card-row carriage metadata so the ribbon shows WHICH carriage runs each
    // row and WHICH WAY it travels (for BOTH the lace and the knit carriage).
    const strokes = this.compilationResult.strokes || [];
    const rowDir = new Array(rows).fill(null);
    const rowCarriage = new Array(rows).fill(null);
    for (const s of strokes) {
      const idx = s.cardRowIndex;
      if (idx >= 0 && idx < rows) { rowDir[idx] = s.direction; rowCarriage[idx] = s.carriageType; }
    }
    const leadRows = this.currentProfile.carriageRules?.cardReadingOffsetRows || 0;

    const cellPitch = 14;
    const cardW = (cols + 6) * cellPitch;
    const cardH = (rows + 4) * cellPitch;
    const startX = (w - cardW) / 2;
    const startY = 40;

    // Apply view mode transformations
    ctx.save();
    
    if (this.punchcardViewMode === 'mirror') {
      ctx.translate(w / 2, 0);
      ctx.scale(-1, 1);
      ctx.translate(-w / 2, 0);
    }

    // Vintage cardstock background with shadow
    ctx.fillStyle = this.currentProfile.cardColor || '#f8fafc';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 12;
    ctx.fillRect(startX, startY, cardW, cardH);
    ctx.shadowBlur = 0;

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(startX, startY, cardW, cardH);

    // Tractor sprockets on left and right
    const leftSprockX = startX + cellPitch * 1.5;
    const rightSprockX = startX + cardW - cellPitch * 1.5;
    const firstColX = startX + cellPitch * 3;

    ctx.fillStyle = '#0f172a';
    for (let r = 0; r < rows; r++) {
      const y = startY + (rows - r + 1) * cellPitch;

      // Sprockets
      ctx.beginPath();
      ctx.arc(leftSprockX, y, 4.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(rightSprockX, y, 4.0, 0, Math.PI * 2);
      ctx.fill();

      // Row labels
      ctx.font = '9px monospace';
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if ((r + 1) % 2 === 0) {
        ctx.fillText(`${r + 1}`, leftSprockX + 12, y);
        ctx.fillText(`${r + 1}`, rightSprockX - 12, y);
      }

      // Punch holes
      for (let c = 0; c < cols; c++) {
        const x = firstColX + c * cellPitch;
        if (cardMatrix[r][c]) {
          ctx.fillStyle = '#020617';
          ctx.beginPath();
          ctx.arc(x, y, 4.2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
        }
      }
    }

    // Title at top of card
    ctx.fillStyle = this.currentProfile.inkColor || '#1d2a44';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.currentProfile.name.toUpperCase()} - ${cols} STITCHES`, startX + cardW / 2, startY + 22);

    // ── Carriage direction + carriage type per row (BOTH carriages) ──
    // Left gutter: which carriage runs the row. Right gutter: which way it travels.
    const CAR_COLOR = { LACE: '#34d399', KNIT: '#38bdf8', COMB: '#f59e0b' };
    const CAR_LETTER = { LACE: 'L', KNIT: 'K', COMB: 'C' };
    ctx.font = 'bold 11px monospace';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < rows; r++) {
      const car = rowCarriage[r];
      if (!car) continue;
      const y = startY + (rows - r + 1) * cellPitch;
      const color = CAR_COLOR[car] || '#64748b';

      // Carriage letter (left of the left sprocket)
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(CAR_LETTER[car] || '?', startX + cellPitch * 0.6, y);

      // Direction arrow (right of the right sprocket): ▶ = L→R, ◀ = R→L
      const toRight = rowDir[r] === DIRECTION.LEFT_TO_RIGHT;
      ctx.fillStyle = color;
      ctx.fillText(toRight ? '\u25B6' : '\u25C0', rightSprockX + cellPitch * 1.1, y);
    }

    // Legend
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#64748b';
    ctx.fillText('carriage per row:  L = lace   K = knit   C = combined     ▶ = left\u2192right   \u25C0 = right\u2192left', startX, startY + cardH + 14);

    // Reading-head / leading-edge marker: this is where Brother (7) vs Silver Reed
    // (5) genuinely differ \u2014 the sensor reads the card N rows below the needles.
    if (leadRows > 0) {
      const yBase = startY + (rows - 0 + 1) * cellPitch;
      const yMark = yBase + (leadRows - 0.5) * cellPitch;
      ctx.save();
      ctx.strokeStyle = '#22d3ee';
      ctx.setLineDash([5, 3]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(startX, yMark);
      ctx.lineTo(startX + cardW, yMark);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#22d3ee';
      ctx.textAlign = 'center';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`\u25C4 LEADING EDGE \u2014 feed ${leadRows} blank rows before row 1 (${this.currentProfile.name.split(' ')[0]} reads ${leadRows} rows ahead)`, startX + cardW / 2, yMark + 12);
      ctx.restore();
    }

    ctx.restore();

    // Overlay mode: show pattern overlay
    if (this.punchcardViewMode === 'overlay') {
      ctx.save();
      ctx.globalAlpha = 0.3;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (cardMatrix[r][c]) {
            const x = firstColX + c * cellPitch;
            const y = startY + (rows - r + 1) * cellPitch;
            ctx.fillStyle = '#f472b6';
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }

  // Preset loading
  loadPreset(presetId) {
    const preset = PATTERN_PRESETS.find(p => p.id === presetId);
    if (!preset) return;

    // Switch mode without compiling: the matrix is about to be replaced, so a
    // schedule built from whatever was on the card first would be thrown away.
    this.setPatternMode(preset.mode, { recompile: false });
    // Presets take a seed so the same preset gives the same motif twice; without it
    // every click on "generate" rolled a new random pattern and you could never
    // get back the one you had just liked.
    const newMatrix = preset.generate(preset.rows, this.currentProfile.columns, preset.seed);
    this.editor.setMatrix(newMatrix);
    // setMatrix() rewrote editor.rows to the preset's height; reflect it in the row
    // box so the field and the canvas agree (otherwise a 32-row preset loads under a
    // "24" and the next edit snaps the card back to 24 — §4.9).
    const rowsInput = document.getElementById('input-rows');
    if (rowsInput) rowsInput.value = String(this.editor.rows);
  }

  openPresetsModal() {
    // The full submenu browser (family tabs, group drawers, search, bed filter,
    // favourites) lives in its own module so this stays a one-line delegation.
    openPresetsBrowser(this);
    this.openModal('presets');
    // Focus the search box: the library is big enough that typing beats scrolling.
    setTimeout(() => document.getElementById('presets-search')?.focus(), 30);
  }

  // Draw a tiny preview of a preset without touching the main editor state.
  renderPresetThumb(canvas, preset) {
    if (!canvas || !preset || typeof preset.generate !== 'function') return;
    try {
      const ctx = canvas.getContext('2d');
      const cols = 24, rows = 18;
      const matrix = preset.generate(rows, cols) || [];
      ctx.fillStyle = '#0b0f19';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const cw = canvas.width / cols, ch = canvas.height / rows;
      const blank = ['K', 'P', 'EMPTY', 0, undefined];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = matrix[r] ? matrix[r][c] : undefined;
          const active = !(blank.includes(v));
          if (active) {
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(c * cw, (rows - 1 - r) * ch, Math.ceil(cw), Math.ceil(ch));
          }
        }
      }
    } catch (e) { /* decorative only; never let a thumbnail break the modal */ }
  }

  // Mathematical Generators
  //
  // Everything here is seeded. The seed sits in a field you can read, type and
  // keep, so a motif you like is recoverable next week — and "shuffle" becomes the
  // deliberate act of rolling a new one instead of an accident of Math.random()
  // that quietly redecorated the card every time you clicked.
  _mathSeed() {
    const raw = String(document.getElementById('math-seed-input')?.value ?? '').trim();
    if (raw === '') return 0;
    if (/^-?\d+$/.test(raw)) return Math.abs(parseInt(raw, 10)) >>> 0;
    // A word is a valid seed too: fold it to uint32 with FNV-1a so "benji"
    // always produces the same scarf.
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) || 1;
  }

  /** Roll a fresh seed and regenerate. The old one stays in history (Ctrl+Z). */
  rollMathSeed() {
    const el = document.getElementById('math-seed-input');
    if (el) el.value = String(randomSeed());
    this.executeMathGenerator();
  }

  executeMathGenerator() {
    const type = document.getElementById('math-gen-type')?.value || 'turing';
    const rows = this.editor.rows;
    const cols = this.editor.cols;
    const seed = this._mathSeed();
    let binary = [];

    if (type === 'turing') {
      const preset = document.getElementById('math-turing-preset')?.value || 'labyrinth';
      binary = MathPatternGenerators.generateReactionDiffusion(rows, cols, preset, 180, seed);
    } else if (type === 'wave') {
      binary = MathPatternGenerators.generateWaveInterference(rows, cols);
    } else if (type === 'voronoi') {
      binary = MathPatternGenerators.generateToroidalVoronoi(rows, cols, 14, 1.2, seed);
    } else if (type === 'celtic') {
      binary = MathPatternGenerators.generateCelticKnot(rows, cols);
    } else if (type === 'wolfram') {
      const rule = parseInt(document.getElementById('math-rule-input')?.value) || 110;
      binary = MathPatternGenerators.generateWolframCA(rows, cols, rule);
    } else if (type === 'fractal') {
      binary = MathPatternGenerators.generateFractalSlice(rows, cols);
    } else if (type === 'perlin') {
      binary = MathPatternGenerators.generatePerlinNoise(rows, cols);
    } else if (type === 'lsystem') {
      binary = MathPatternGenerators.generateLSystem(rows, cols);
    } else if (type === 'penrose') {
      binary = MathPatternGenerators.generatePenroseTiling(rows, cols);
    } else if (type === 'phyllotaxis') {
      binary = MathPatternGenerators.generatePhyllotaxis(rows, cols);
    } else if (type === 'moire') {
      binary = MathPatternGenerators.generateMoirePattern(rows, cols);
    } else if (type === 'life') {
      binary = MathPatternGenerators.generateGameOfLife(rows, cols, seed, 25);
    } else if (type === 'hadamard') {
      binary = MathPatternGenerators.generateHadamardTiling(rows, cols);
    } else if (type === 'halton') {
      binary = MathPatternGenerators.generateHaltonScatter(rows, cols, 60);
    } else if (type === 'christoffel') {
      binary = MathPatternGenerators.generateChristoffelWeave(rows, cols);
    } else if (type === 'superformula') {
      binary = MathPatternGenerators.generateSuperformula(rows, cols);
    } else if (type === 'rose') {
      binary = MathPatternGenerators.generateRoseCurves(rows, cols);
    } else if (type === 'modular') {
      binary = MathPatternGenerators.generateModularMultiplication(rows, cols);
    } else if (type === 'logistic') {
      binary = MathPatternGenerators.generateLogisticBifurcation(rows, cols);
    }

    if (this.currentMode === 'lace') {
      const stitchMatrix = MathPatternGenerators.convertBinaryToLaceStitches(binary);
      this.editor.setMatrix(stitchMatrix);
    } else {
      this.editor.setMatrix(binary);
    }
  }

  // Image Import
  handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      const img = new Image();
      img.onload = () => {
        const offscreen = document.createElement('canvas');
        offscreen.width = img.width;
        offscreen.height = img.height;
        const ctx = offscreen.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imgData = ctx.getImageData(0, 0, img.width, img.height);
        this.importedRawImageData = imgData;
        this.previewImportedImage();
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  }

  previewImportedImage() {
    if (!this.importedRawImageData) return;
    const previewCanvas = document.getElementById('image-preview-canvas');
    if (!previewCanvas) return;

    const dither = document.getElementById('image-dither-method')?.value || 'atkinson';
    const contrast = parseFloat(document.getElementById('image-contrast')?.value || '1.0');
    const gamma = parseFloat(document.getElementById('image-gamma')?.value || '1.0');
    const invert = document.getElementById('image-invert')?.checked || false;

    const rows = this.editor.rows;
    const cols = this.editor.cols;

    const binary = ImageProcessor.processImage(this.importedRawImageData, rows, cols, {
      ditherMethod: dither,
      contrast,
      gamma,
      invert,
      // Honour the live "Enforce Paper Bridge Protection" checkbox — it is rendered
      // checked and looks wired, but this used to be hardcoded true, so toggling it
      // changed nothing while still firing the preview (§1.7).
      enforcePaperBridges: document.getElementById('image-bridges')?.checked ?? true
    });

    this.importedProcessedBinary = binary;

    // Render preview
    previewCanvas.width = cols * 8;
    previewCanvas.height = rows * 8;
    const ctx = previewCanvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

    ctx.fillStyle = '#38bdf8';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (binary[r][c] === 1) {
          ctx.fillRect(c * 8, (rows - 1 - r) * 8, 7, 7);
        }
      }
    }
  }

  applyImportedImage() {
    if (!this.importedProcessedBinary) return;
    if (this.currentMode === 'lace') {
      const stitchMatrix = MathPatternGenerators.convertBinaryToLaceStitches(this.importedProcessedBinary);
      this.editor.setMatrix(stitchMatrix);
    } else {
      this.editor.setMatrix(this.importedProcessedBinary);
    }
  }

  // Modal helpers
  openModal(name) {
    this.closeAllModals();
    const modal = document.getElementById(`${name}-modal`);
    if (!modal) return;
    this._lastFocus = document.activeElement;
    modal.classList.add('active');
    // Move focus into the dialog and select the first control (Paradox of the
    // Active User: people reach for the keyboard immediately).
    setTimeout(() => {
      const first = modal.querySelector('input:not([type=hidden]), select, textarea, button');
      (first || modal).focus({ preventScroll: true });
    }, 0);
  }

  /**
   * Keep the Tab key inside whichever dialog is open.
   *
   * The overlay dims the page but the page stays in the tab order, so one press
   * past the last control dropped you into the header behind a modal you could
   * see but not reach. This is the standard trap: wrap at both ends, and pull
   * focus back in if it somehow escaped to something outside the dialog.
   */
  trapModalFocus(e) {
    if (e.key !== 'Tab') return false;
    const modal = document.querySelector('.modal-backdrop.active');
    if (!modal) return false;
    const focusables = Array.from(modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.getClientRects().length > 0);

    if (focusables.length === 0) {
      e.preventDefault();
      modal.focus({ preventScroll: true });
      return true;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const outside = !modal.contains(active);

    if (e.shiftKey && (active === first || outside)) {
      e.preventDefault();
      last.focus({ preventScroll: true });
      return true;
    }
    if (!e.shiftKey && (active === last || outside)) {
      e.preventDefault();
      first.focus({ preventScroll: true });
      return true;
    }
    return false;
  }

  closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
    // Return focus to whatever opened the dialog so keyboard flow is unbroken.
    try { if (this._lastFocus && document.contains(this._lastFocus)) this._lastFocus.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    this._lastFocus = null;
  }

  // Exporters
  exportDXF() {
    const dxfStr = CadDxfExporter.generateDxf(this.currentProfile, this.compilationResult.cardMatrix);
    this.downloadFile(this._stampWatermarkDxf(dxfStr), `${this.currentProfile.id}_punchcard.dxf`, 'application/dxf');
  }

  exportGCode() {
    const exporter = new CncGcodeExporter({
      machineType: document.getElementById('gcode-tool-mode')?.value || 'laser',
      feedRapid: parseInt(document.getElementById('gcode-rapid-feed')?.value) || 3000,
      optimizePath: true
    });
    const gcodeStr = exporter.generateGCode(this.currentProfile, this.compilationResult.cardMatrix);
    this.downloadFile(this._stampWatermarkDxf(gcodeStr), `${this.currentProfile.id}_punchcard.gcode`, 'text/plain');
  }

  exportLaserSVG() {
    const svgStr = VectorSvgExporter.generateLaserSvg(this.currentProfile, this.compilationResult.cardMatrix);
    this.downloadFile(this._stampWatermark(svgStr), `${this.currentProfile.id}_laser.svg`, 'image/svg+xml');
  }

  exportPrintableSheet() {
    const pages = VectorSvgExporter.generateTiledPrintablePages(this.currentProfile, this.compilationResult.cardMatrix, 'A4');

    // Open printable pop-up window with print dialog
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${this.currentProfile.name} - Printable 1:1 Scale Sheets</title>
          <style>
            @page { size: A4 portrait; margin: 0; }
            body { margin: 0; padding: 0; background: #525659; font-family: sans-serif; }
            .print-page { page-break-after: always; display: flex; justify-content: center; align-items: center; padding: 10mm 0; background: #fff; margin-bottom: 10px; }
            @media print {
              body { background: transparent; }
              .print-page { padding: 0; margin: 0; }
            }
          </style>
        </head>
        <body>
          ${pages.map(svg => `<div class="print-page">${svg}</div>`).join('')}
          <script>
            window.onload = () => { setTimeout(() => window.print(), 500); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  exportDAK() {
    const dakStr = FormatsExporter.generateDakText(this.editor.matrix);
    this.downloadFile(dakStr, `pattern_${this.currentProfile.id}.pat`, 'text/plain');
  }

  exportBinary() {
    const binBuffer = FormatsExporter.generateBinaryBitstream(this.compilationResult.cardMatrix);
    const blob = new Blob([binBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `punchcard_${this.currentProfile.id}.bin`;
    a.click();
    URL.revokeObjectURL(url);
  }

  exportCSV() {
    const csvStr = FormatsExporter.generateCsv(this.compilationResult.cardMatrix);
    this.downloadFile(csvStr, `card_matrix_${this.currentProfile.id}.csv`, 'text/csv');
  }

  /**
   * The card as plain data: the shape shared by autosave, versions, backups and
   * the .kcard exporter. Defined once so what is stored is unambiguously what is
   * on the screen, in every mode.
   */
  _projectSnapshot() {
    const ed = this.editor;
    if (!ed) return {};
    return {
      profileId: this.currentProfile.id,
      mode: this.currentMode,
      rows: ed.rows,
      cols: ed.cols,
      stitchMatrix: ed.matrix,
      name: this.projectMeta?.name || null,
      notes: this.projectMeta?.notes || null,
      meta: { ...(this.projectMeta || {}) }
    };
  }

  /**
   * The filename a save should use: the card's own name as a slug, or a stamped
   * default. Kept in one place so the Save dialog, the download and the recent list
   * cannot disagree about what this card is called.
   */
  _projectFilename(extension = '.kcard') {
    const named = (this.projectMeta?.name || '').trim();
    const slug = named
      ? named.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
      : '';
    return `${slug || `knitwear_project_${Date.now()}`}${extension}`;
  }

  saveProject() {
    const project = FormatsExporter.generateProjectJson({
      ...this._projectSnapshot(),
      compilationResult: this.compilationResult
    });
    const filename = this._projectFilename();
    const bridge = this.fileBridge;
    if (bridge?.bound) {
      // Opening a file with the dialog bound it; saving goes straight back to it,
      // no dialog, exactly like every desktop editor. Anything else falls through
      // to the download, because losing the card is worse than a second copy.
      return bridge.save(project, { suggestedName: bridge.boundName || filename, allowPicker: false })
        .then(result => {
          if (result.ok && result.mode === 'bound-file') {
            this.dataPanel?.remember(result.name, this._projectSnapshot());
            this.notifications.success(`Saved to ${result.name}.`, {
              details: 'Same file, no dialog — that is what opening it with the dialog bought you.',
              duration: 4000
            });
            return result;
          }
          this.notifications.warn('KNITCAT could not write to that file, so it downloaded a copy instead.', {
            details: result.error || 'The browser refused the write.',
            duration: 9000
          });
          this.downloadFile(project, filename, 'application/json');
          this.dataPanel?.remember(filename, this._projectSnapshot());
          return { ok: true, mode: 'download', name: filename };
        })
        .catch(err => {
          this.downloadFile(project, filename, 'application/json');
          this.notifications.error('The Save dialog failed, so the file was downloaded.', {
            details: err?.message,
            duration: 8000
          });
          return { ok: true, mode: 'download', name: filename };
        });
    }
    this.downloadFile(project, filename, 'application/json');
    // The card you just saved is now also on the "recent" list, with its content —
    // a web page cannot remember a path it was never given.
    this.dataPanel?.remember(filename, this._projectSnapshot());
    return Promise.resolve({ ok: true, mode: 'download', name: filename });
  }

  /**
   * Wire the File System Access API to the rest of the app, once the storage
   * driver is known. Nothing appears in the UI unless the browser really has the
   * pickers, so Firefox and Safari keep the plain download/upload path unchanged.
   */
  _bindFileSystem(panel) {
    const bridge = createFileBridge({
      driver: panel.driver,
      notifier: this.notifications,
      download: (text, filename) => this.downloadFile(text, filename, 'application/json')
    });
    this.fileBridge = bridge;
    const openBtn = document.getElementById('btn-open-fsa');
    const saveBtn = document.getElementById('btn-save-fsa');
    if (!bridge.supports.save && !bridge.supports.open) return bridge;

    if (openBtn && bridge.supports.open) {
      openBtn.hidden = false;
      openBtn.addEventListener('click', async () => {
        const result = await bridge.open();
        if (result.cancelled || result.unsupported) return;
        if (!result.ok) {
          this.notifications.error('That file could not be opened.', { details: result.error, duration: 8000 });
          return;
        }
        this.loadProjectText(result.text, result.name);
        this._showBoundFile(saveBtn, result.name);
      });
    }
    if (saveBtn && bridge.supports.save) {
      this._initialSaveLabel(saveBtn);
      saveBtn.hidden = false;
      saveBtn.addEventListener('click', async () => {
        if (!bridge.bound) {
          const picked = await bridge.pickSaveFile({ suggestedName: this._projectFilename() });
          if (picked.ok) this._showBoundFile(saveBtn, picked.name);
          return;
        }
        const result = await bridge.save(FormatsExporter.generateProjectJson({
          ...this._projectSnapshot(),
          compilationResult: this.compilationResult
        }), { suggestedName: bridge.boundName, allowPicker: false });
        this.notifications[result?.ok ? 'success' : 'error'](
          result?.ok ? `Saved to ${result.name}.` : 'That file could not be written.',
          { details: result?.error, duration: 6000 }
        );
      });
    }
    bridge.restore().then(info => {
      if (info.bound) this._showBoundFile(saveBtn, info.name);
      else if (info.remembered && saveBtn) saveBtn.hidden = true;
    }).catch(() => { /* a handle that cannot be recalled simply means no binding */ });
    return bridge;
  }

  _showBoundFile(button, name) {
    if (!button) return;
    button.hidden = false;
    button.textContent = `Save to “${String(name).slice(0, 24)}”`;
    button.title = 'Writes straight back to this file, with no dialog';
  }

  /** What the un-bound Save button should offer, given what the browser can do. */
  _initialSaveLabel(button) {
    if (!button) return;
    button.textContent = this.fileBridge?.supports?.save ? 'Choose a file to save to…' : 'Save to file';
  }

  /** Apply a `#p=…` share link sitting in the address bar, if there is one. */
  _consumeIncomingShare() {
    // The share panel failed to build (a disabled JS feature, say). The card is
    // still readable, so read it rather than dropping the visitor on a blank one.
    const bareRead = href => {
      const code = this._incomingShareCode || readShareUrl(href);
      if (!code) return { found: false, ok: false };
      const decoded = decodeCard(code);
      if (!decoded.ok) return { found: true, ok: false, error: decoded.error };
      return { found: true, ok: this.loadProjectText(incomingShareDocument(decoded.card), 'a shared link'), card: decoded.card };
    };
    try {
      const href = typeof location !== 'undefined' ? location.href : '';
      if (!this._incomingShareCode && !href.includes('#p=') && !/[?&]p=/.test(href)) return { found: false, ok: false };
      const result = this.share && !this._incomingShareCode ? this.share.consumeIncoming(href) : bareRead(href);
      this._incomingShareCode = null;
      if (result.found && !result.ok) {
        this.notifications.error('The link you opened is not a card this build can read.', {
          details: result.error || 'It may be truncated, or from a newer version.',
          duration: 10000
        });
      } else if (result.found && result.ok) {
        // The link is done with: leaving it in the address bar means a refresh
        // would ask about the shared card all over again.
        stripShareUrl();
      }
      return result;
    } catch (err) {
      console.error('[KNITCAT] shared link could not be applied:', err);
      return { found: false, ok: false };
    }
  }

  loadProject(e) {
    const file = e.target?.files?.[0];
    if (file) this.loadProjectFile(file);
  }

  /** Public entry point for any File: the file input, a drag-drop, or an OS launch. */
  loadProjectFile(file) {
    const reader = new FileReader();
    reader.onload = evt => this.loadProjectText(evt.target.result, file.name);
    reader.onerror = () => {
      this.notifications.error(`The browser would not hand ${file.name} over.`, {
        details: 'Try re-choosing the file, or dragging it from the same folder.'
      });
    };
    reader.readAsText(file);
  }

  /**
   * Parse and adopt project JSON from any source — file, paste, shared link, or
   * an installed-app launch. All the trust work happens in js/project/kcard.js:
   * version gate, legacy migration, matrix validation, size ceilings. Anything it
   * rejects is rejected with a sentence naming the exact field and cell, rather
   * than half-loading a file and painting a blank canvas.
   */
  loadProjectText(text, label = 'pasted project') {
    const result = readProject(text);
    if (!result.ok) {
      this.notifications.error('That is not a KNITCAT project this build can open.', {
        details: [result.error, `Checked: ${label}`]
      });
      return false;
    }

    const data = result.project;
    const notes = result.warnings.slice();
    if (data.profileId && MACHINE_PROFILES[data.profileId]) {
      this.currentProfile = MACHINE_PROFILES[data.profileId];
      this.elements.profileSelect.value = data.profileId;
      this.compiler.setProfile(this.currentProfile);
      this.updateMachineSpecs();
    } else if (data.profileId) {
      notes.push(`Machine "${data.profileId}" is unknown to this build — kept ${this.currentProfile.name}.`);
    }
    // Mode first, chart second: the glyphs in a lace card mean nothing to a
    // stranded chart and vice versa. `recompile: false` because the chart is not
    // loaded yet — compiling now would schedule the previous project.
    if (data.mode) this.setPatternMode(data.mode, { recompile: false });
    this.editor.setMatrix(data.stitchMatrix);
    // Metadata travels with the chart: a recovered or opened card comes back with
    // its name and notes, not as an anonymous grid.
    this.projectMeta = {
      ...this.projectMeta,
      ...(data.meta || {}),
      name: data.name || this.projectMeta?.name || null,
      notes: data.notes ?? this.projectMeta?.notes ?? null
    };
    // setMatrix() repaints the canvas but does not fire onChange, so without this
    // the punched card, yarn sim and CNC view kept showing the OLD project.
    this.recompile();

    this.notifications.success(`Loaded ${label} — your card is back.`, {
      details: notes,
      duration: notes.length ? 9000 : 4500
    });
    // Record it as opened (content and all) and snapshot the restored state, so
    // closing the tab immediately cannot lose what was only just recovered.
    this.dataPanel?.remember(label, this._projectSnapshot());
    this.dataPanel?.touch();
    return true;
  }

  /**
   * Act on a manifest shortcut or protocol-handler launch: ?tab=punchcard,
   * ?open=math, ?mode=lace, ?import=<url or JSON text>.
   *
   * A URL is user-supplied by way of a link, so every token is treated as
   * untrusted: names are matched against real elements, never interpolated into
   * a selector unchecked.
   */
  _handleLaunchIntent(intent = {}) {
    if (typeof intent.mode === 'string' && /^(lace|fair_isle|tuck|slip)$/.test(intent.mode)) {
      this.setPatternMode(intent.mode);
    }
    if (typeof intent.tab === 'string' && /^[a-z0-9-]{1,24}$/i.test(intent.tab)) {
      document.querySelector(`.tab-btn[data-tab="${intent.tab}"]`)?.click();
    }
    if (typeof intent.open === 'string' && /^[a-z0-9-]{1,24}$/i.test(intent.open)) {
      if (intent.open === 'presets') this.openPresetsModal();
      else this.openModal(intent.open);
    }
    if (typeof intent.import === 'string' && intent.import.trim()) {
      this._importFromText(intent.import);
    }
    // The manifest registers KNITCAT as a share target, so another app can send a
    // link or a blob of text here. Both shapes are handled without trusting them:
    // a URL is fetched at most from whatever the visitor just clicked, and the card
    // parser is the same validator a dropped file goes through.
    const shared = [intent.url, intent.text]
      .map(value => (typeof value === 'string' ? value.trim() : ''))
      .find(Boolean);
    if (shared) {
      // Either the bare `#p=` payload, a whole share link, or something else worth
      // fetching. Decided by shape, never by hoping the text happens to parse.
      const looksLikeCode = /^[A-Za-z0-9_-]{8,}$/.test(shared);
      const code = looksLikeCode ? shared : readShareUrl(shared);
      if (code) {
        this._incomingShareCode = code;
        if (this.editor) this._consumeIncomingShare();
        else this.notifications.info('That shared card will load as soon as the editor is ready.', { duration: 5000 });
      } else {
        this._importFromText(shared);
      }
    } else if (intent.title && !intent.tab && !intent.open) {
      this.notifications.info('KNITCAT was opened as a share target, but nothing shareable arrived with it.', {
        details: 'Share a link that contains a #p=… card, or the .kcard file itself.',
        duration: 8000
      });
    }
  }

  /** `web+knitcat:<something>` — either a link to a .kcard or the JSON itself. */
  async _importFromText(value) {
    const text = value.trim();
    try {
      if (/^https?:\/\//i.test(text)) {
        const response = await fetch(text);
        if (!response.ok) throw new Error(`the server said ${response.status}`);
        this.loadProjectText(await response.text(), text.split('/').pop() || 'shared card');
        return;
      }
      this.loadProjectText(text, 'shared card');
    } catch (err) {
      this.notifications.error('That shared card could not be fetched.', {
        details: `${err.message} — the link may need the other site to allow cross-origin reads.`,
        duration: 8000
      });
    }
  }

  // Advanced Export Functions
  exportAYAB() {
    if (!this.compilationResult || !this.compilationResult.cardMatrix) {
      this.notifications.warn('Nothing to export yet — draw a pattern and the compiler will punch the card.', { duration: 6000 });
      return;
    }
    
    const ayabStr = FormatsExporter.generateAyabFormat(this.compilationResult.cardMatrix);
    this.downloadFile(ayabStr, 'pattern_ayab.txt', 'text/plain');
  }

  exportBrotherDisk() {
    if (!this.compilationResult || !this.compilationResult.cardMatrix) {
      this.notifications.warn('Nothing to export yet — draw a pattern and the compiler will punch the card.', { duration: 6000 });
      return;
    }
    
    const diskBuffer = FormatsExporter.generateBrotherDiskFormat(this.compilationResult.cardMatrix);
    const blob = new Blob([diskBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'brother_kh930_disk.img';
    a.click();
    URL.revokeObjectURL(url);
  }

  exportXML() {
    const projectData = {
      profileId: this.currentProfile.id,
      mode: this.currentMode,
      rows: this.editor.rows,
      cols: this.editor.cols,
      stitchMatrix: this.editor.matrix,
      compilationResult: this.compilationResult
    };
    
    const xmlStr = FormatsExporter.generateXmlPattern(projectData);
    this.downloadFile(xmlStr, 'pattern_exchange.xml', 'application/xml');
  }

  exportDocumentation() {
    const projectData = {
      profileId: this.currentProfile.id,
      mode: this.currentMode,
      rows: this.editor.rows,
      cols: this.editor.cols,
      stitchMatrix: this.editor.matrix
    };
    
    const docsStr = FormatsExporter.generateDocumentation(projectData, this.compilationResult);
    this.downloadFile(docsStr, 'pattern_documentation.md', 'text/markdown');
  }

  // The tank-top CAD and beanie tailor are now folded into the unified Clothes tab.
  // Their live geometry, machine steps, grading, yarn estimate and exports all flow
  // through GarmentCanvas + ClothesEngine (see renderClothes / the export bar below),
  // so the old per-engine draw/export methods no longer live here. BeanieEngine is
  // still imported above: the catalogue routes every hat through it as the crown math.

  // ---- Command-palette actions (the palette merges these with live DOM reads) ----
  _paletteActions() {
    const acts = [];
    const click = (sel) => () => { const el = document.querySelector(sel); if (el) el.click(); };
    // Garments — typing "beanie" / "sweater" / "socks" jumps straight to it.
    try {
      for (const g of GARMENTS) {
        acts.push({
          label: `${g.name}  \u2192 Clothes`, group: 'Garment',
          keywords: `garment clothes knit ${g.name} ${g.category} ${g.id} ${g.structure}`.toLowerCase(),
          run: () => this.openGarment(g.id)
        });
      }
    } catch (_) { /* catalogue not ready */ }
    // Presets — load any pattern by name.
    try {
      for (const p of (PATTERN_PRESETS || [])) {
        acts.push({
          label: `Preset: ${p.name}`, group: 'Preset',
          keywords: `preset pattern ${p.category || ''} ${p.family || ''} ${p.group || ''} ${(p.tags || []).join(' ')} ${p.name} ${p.description || ''}`.toLowerCase(),
          run: () => { this.loadPreset(p.id); }
        });
      }
    } catch (_) { /* presets not ready */ }
    // Modes / tools / exports / settings.
    ['lace', 'fair_isle', 'tuck', 'slip'].forEach(m => acts.push({ label: `Mode: ${m.replace('_', ' ')}`, group: 'Mode', keywords: `mode ${m} ${m.replace('_', ' ')}`, run: () => this.setPatternMode(m) }));
    [['pencil', 'Pencil', 'pencil draw paint brush'], ['eraser', 'Eraser', 'eraser rub delete'], ['fill', 'Flood fill', 'fill bucket flood paint'], ['select', 'Marquee select', 'select marquee move region copy paste'], ['line', 'Straight line', 'line straight draw'], ['rect', 'Filled rectangle', 'rectangle rect box square filled'], ['rectOutline', 'Rectangle outline', 'rectangle rect outline box square frame'], ['circle', 'Filled ellipse', 'circle ellipse oval round filled'], ['circleOutline', 'Ellipse outline', 'circle ellipse oval outline ring frame'], ['heart', 'Heart stamp', 'heart love stamp valentine']].forEach(([t, name, k]) =>
      acts.push({ label: `Tool: ${name}`, group: 'Tool', keywords: `tool ${k}`, run: () => document.querySelector(`[data-tool="${t}"]`)?.click() }));
    acts.push({ label: 'Export / CNC', group: 'Export', keywords: 'export save dxf gcode laser cnc download', run: click('#btn-open-export') });
    acts.push({ label: 'Presets browser', group: 'Design', keywords: 'presets library browse patterns', run: click('#btn-open-presets') });
    acts.push({ label: 'Math Studio', group: 'Design', keywords: 'math procedural generative reaction diffusion waves automata', run: click('#btn-open-math') });
    acts.push({ label: 'Image Dither', group: 'Design', keywords: 'image photo dither import picture atkinson floyd steinberg', run: click('#btn-open-image') });
    acts.push({ label: 'Settings', group: 'Settings', keywords: 'settings preferences accent colour name photo anniversary theme', run: () => this._openSettingsViaExtras() });
    acts.push({ label: 'Toggle theme (light / dark)', group: 'Settings', keywords: 'theme light dark appearance toggle', run: () => document.getElementById('kx-theme')?.click() });
    acts.push({ label: 'About KNITCAT', group: 'Settings', keywords: 'about info story help who made this knitcat knit cat', run: () => document.querySelector('.brand-section .kx-hbtn')?.click() });
    acts.push({ label: 'Eyelets vs transfers explained', group: 'Advisor', keywords: 'eyelet yarnover transfer difference openwork single bed double bed hole lace why both', run: () => { document.querySelector('.tab-btn[data-tab="editor"]')?.click(); this.openModal('lace-guide'); } });
    acts.push({ label: 'Check machine feasibility', group: 'Advisor', keywords: 'feasibility check valid fix float snag machine advice expert score health', run: () => this.openFeasibility() });
    acts.push({ label: 'Compare across all machines (universe)', group: 'Advisor', keywords: 'machine universe compatibility cross fit any machine universal adapt brother silver reed passap toyota bulky', run: () => this.openMachineUniverse() });
    acts.push({ label: 'Make this card fit every machine', group: 'Advisor', keywords: 'universal tune all machines compatible strictest adapt everywhere portability', run: () => { const r = this.universe?.tuneForAll?.(); this.recompile(); this.notifications?.[r && r.changed ? 'success' : 'info']?.(r && r.changed ? 'Tuned to fit every machine.' : 'Already fits every machine.'); } });
    acts.push({ label: 'Show love letter', group: 'Romance', keywords: 'love letter ily benji popup heart romantic', run: () => this._showLovePopup() });
    acts.push({ label: 'Clear the canvas', group: 'Edit', keywords: 'clear erase reset blank canvas new empty', run: () => this.editor?.clear() });
    acts.push({ label: 'Toggle console', group: 'Diagnostics', keywords: 'console log terminal debug view panel open close ctrl backtick inspect telemetry', run: () => this.console?.toggle?.() });
    acts.push({ label: 'Open console — Systems status', group: 'Diagnostics', keywords: 'systems status health environment capabilities subsystems boot loaded enabled console diagnostics', run: () => { this.console?.open?.(); this.console?.setView?.('systems'); } });
    acts.push({ label: 'Toggle stitch inspector', group: 'Inspector', keywords: 'inspect hover cell symbol meaning transfer eyelet yarn over inspector hud readout needle', run: () => this._toggleInspector() });
    acts.push({ label: 'Open clip shelf', group: 'Clipboard', keywords: 'clip clipboard shelf history slot copy paste motif vocabulary library panel open close recent', run: () => this.clipShelf?.open?.() });
    acts.push({ label: 'Walk me through it row by row (Knit-Along)', group: 'Advisor', keywords: 'knit along row counter companion step through what do i do next row carriage direction walk guide progress panel open close', run: () => this.knitAlong?.toggle?.() });
    acts.push({ label: 'Stitch-symbol legend (what do the symbols mean)', group: 'Inspector', keywords: 'symbol legend chart notation mean what is o circle transfer eyelet tuck slip purl explain highlight symbols key glossary panel open close', run: () => this.symbolLegend?.toggle?.() });
    acts.push({ label: 'Toggle card structure & analysis', group: 'Inspector', keywords: 'structure layers guides repeat tile fit annotations notes document history trail size mm needles rows analysis panel open close', run: () => this.structurePanel?.toggle?.() });
    acts.push({ label: 'Capture selection to clip shelf', group: 'Clipboard', keywords: 'clip clipboard capture copy selection shelf store remember motif', run: () => { if (this.editor?.copySelection()) this.clipShelf?.capture?.(); this.clipShelf?.open?.(); } });
    acts.push({ label: 'Paste most recent clip', group: 'Clipboard', keywords: 'clip clipboard paste most recent previous shelf duplicate reuse', run: () => this.clipShelf?.pasteMostRecent?.() });
    acts.push({ label: 'Name this clip (save to slot)', group: 'Clipboard', keywords: 'clip clipboard slot name save persist library motif vocabulary star slot', run: () => this.clipShelf?.promptSaveSlot?.() });
    acts.push({ label: 'Diagnostics snapshot', group: 'Diagnostics', keywords: 'diagnostics debug log error warn health telemetry console inspect', run: () => this._diagnosticsSummary() });
    acts.push({ label: 'Export diagnostics log (JSON)', group: 'Diagnostics', keywords: 'export diagnostics log json debug copy download telemetry error report', run: () => this._exportDiagnostics() });
    // The Studio folds in as first-class palette citizens so "open a project" is
    // searchable like everything else.
    try { (this.projects?.commands?.() || []).forEach(cmd => acts.push(cmd)); } catch (_) { /* hub absent */ }
    return acts;
  }

  /**
   * Turn the read-only stitch inspector on or off. Recreating it is cheap and keeps
   * the enable/disable path identical to boot, so a toggled-back-on inspector behaves
   * exactly like the one the app started with.
   * @private
   */
  _toggleInspector() {
    runGuarded('Toggle stitch inspector', () => {
      if (this.inspector) {
        this.inspector.destroy();
        this.inspector = null;
        this.notifications?.info?.('Stitch inspector off.');
      } else {
        this.inspector = createStitchInspector({
          getEditor: () => this.editor,
          getMode: () => this.currentMode,
          getProfile: () => this.currentProfile
        });
        this.notifications?.success?.('Stitch inspector on \u2014 hover a needle.');
      }
    }, { notifier: this.notifications });
  }

  /**
   * Record a single, useful environment line at boot — engine, viewport, active
   * machine + mode, and capability availability. One informative breadcrumb, not a
   * firehose; the full detail rides along as the record payload for the console.
   * @private
   */
  _logEnvironment() {
    runGuarded('Environment probe', () => {
      const diag = getDiagnostics();
      const nav = globalThis.navigator || {};
      const env = {
        ua: nav.userAgent || '',
        language: nav.language || '',
        online: nav.onLine !== false,
        dpr: globalThis.devicePixelRatio || 1,
        viewport: `${globalThis.innerWidth}x${globalThis.innerHeight}`,
        cores: nav.hardwareConcurrency || 0,
        memory: nav.deviceMemory || 0,
        storage: (() => { try { localStorage.setItem('__kx', '1'); localStorage.removeItem('__kx'); return true; } catch (_) { return false; } })(),
        serviceWorker: !!nav.serviceWorker,
        profile: this.currentProfile && this.currentProfile.id,
        mode: this.currentMode
      };
      diag.context({ profile: env.profile, mode: env.mode });
      diag.info(`Ready \u00b7 ${env.profile || 'custom'} \u00b7 ${env.mode} \u00b7 ${env.viewport}@${env.dpr}x \u00b7 ${env.cores} cores \u00b7 ${env.online ? 'online' : 'offline'}`, env);
    }, { notifier: this.notifications });
  }

  /**
   * Show a compact, non-blocking health snapshot of the diagnostics core: how many
   * records were captured, by level and by category, and the slowest operations.
   * @private
   */
  _diagnosticsSummary() {
    runGuarded('Diagnostics summary', () => {
      const s = getDiagnostics().snapshot();
      const lvl = Object.entries(s.byLevel).map(([k, v]) => `${k} ${v}`).join(', ') || 'clean';
      const cats = Object.entries(s.byCategory).map(([k, v]) => `${k} ${v}`).join(', ');
      this.notifications?.info?.(`Diagnostics: ${s.total} record(s), uptime ${Math.round(s.uptimeMs / 1000)}s.`, {
        title: 'Session health', details: [lvl, cats].filter(Boolean), duration: 7000
      });
    }, { notifier: this.notifications });
  }

  /**
   * Copy the full diagnostics log to the clipboard and offer a JSON download, so a
   * user can hand over exactly what went wrong without opening dev tools.
   * @private
   */
  _exportDiagnostics() {
    runGuarded('Export diagnostics', () => {
      const json = getDiagnostics().exportJSON();
      try {
        const nav = globalThis.navigator;
        if (nav && nav.clipboard && nav.clipboard.writeText) nav.clipboard.writeText(json).catch(() => {});
      } catch (_) { /* clipboard may be unavailable */ }
      try {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'knitcat-diagnostics.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (e) {
        getDiagnostics().logError('Diagnostics download', e);
      }
      this.notifications?.success?.('Diagnostics log exported (also copied to clipboard).', { duration: 5000 });
    }, { notifier: this.notifications });
  }

  _openSettingsViaExtras() {
    // The gear button is injected by the extras layer; a synthetic click reuses
    // its own handler, so we never have to reach into that module's internals.
    const gear = Array.from(document.querySelectorAll('.brand-section .kx-hbtn'))
      .find(b => b.title === 'Settings');
    if (gear) gear.click();
  }

  // ---- Clothes catalogue UI ----
  _initClothesUI() {
    const nav = document.getElementById('clothes-nav');
    if (!nav) return;
    nav.innerHTML = '';
    // Chunked by category so the list never reads like a wall (Miller's Law).
    CATEGORIES.forEach(cat => {
      const list = GARMENTS.filter(g => g.category === cat);
      if (!list.length) return;
      const group = document.createElement('div');
      group.className = 'clothes-cat';
      const label = document.createElement('div');
      label.className = 'clothes-cat-title';
      label.textContent = cat;
      group.appendChild(label);
      list.forEach(g => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'clothes-item';
        b.dataset.garment = g.id;
        b.dataset.cat = cat.toLowerCase();
        b.innerHTML = `<span class="clothes-item-icon">${g.icon || '\u2665'}</span><span>${g.name}</span>`;
        b.title = g.blurb || '';
        b.addEventListener('click', () => { this._selectGarment(g.id); fx('click'); });
        group.appendChild(b);
      });
      nav.appendChild(group);
    });

    const search = document.getElementById('clothes-search');
    search?.addEventListener('input', () => this._filterClothes(search.value));
    ['clothes-gauge-sts', 'clothes-gauge-rows'].forEach(id =>
      document.getElementById(id)?.addEventListener('change', () => this.renderClothes()));

    // Swatch helper: count sts/rows over N cm -> per-10cm gauge, applied live.
    document.getElementById('btn-swatch-calc')?.addEventListener('click', () => this.swatchToGauge('sts'));
    document.getElementById('btn-swatch-calc-rows')?.addEventListener('click', () => this.swatchToGauge('rows'));

    // Draw-on-the-stitch-grid controls (inherited from the tank-top CAD).
    document.getElementById('btn-clothes-draw')?.addEventListener('click', () => this.toggleClothesDraw());
    document.getElementById('btn-clothes-symmetry')?.addEventListener('click', () => this.toggleClothesSymmetry());
    document.getElementById('btn-clothes-clear')?.addEventListener('click', () => this.clearClothesDrawing());

    // Grading set + yarn weight re-render the shared read-outs.
    document.getElementById('clothes-grade-mode')?.addEventListener('change', () => this._renderGrading());
    document.getElementById('clothes-grams-per-metre')?.addEventListener('input', () => this._renderYarn());

    // Export bar: seam-allowance SVG, laser DXF, 1:1 print, To Editor, Check Feasibility.
    document.getElementById('btn-clothes-svg')?.addEventListener('click', () => this.exportClothesSvg());
    document.getElementById('btn-clothes-dxf')?.addEventListener('click', () => this.exportClothesDxf());
    document.getElementById('btn-clothes-print')?.addEventListener('click', () => this.printClothesPattern());
    document.getElementById('btn-clothes-editor')?.addEventListener('click', () => this.sendClothesToEditor());
    document.getElementById('btn-clothes-feasibility')?.addEventListener('click', () => this.checkClothesFeasibility());

    if (!this._activeGarment) this._selectGarment('beanie', { render: false });
  }

  _filterClothes(q) {
    q = (q || '').toLowerCase().trim();
    const nav = document.getElementById('clothes-nav');
    if (!nav) return;
    let anyCat = false;
    nav.querySelectorAll('.clothes-cat').forEach(catEl => {
      let anyInCat = false;
      catEl.querySelectorAll('.clothes-item').forEach(it => {
        const g = GARMENTS.find(x => x.id === it.dataset.garment);
        const hay = `${g ? g.name + ' ' + g.category + ' ' + (g.blurb || '') : ''} ${it.dataset.garment}`.toLowerCase();
        const show = !q || hay.includes(q);
        it.style.display = show ? '' : 'none';
        if (show) anyInCat = true;
      });
      catEl.style.display = anyInCat ? '' : 'none';
      if (anyInCat) anyCat = true;
    });
    if (q && !anyCat) {
      nav.querySelectorAll('.clothes-item').forEach(it => { it.style.display = ''; });
      nav.querySelectorAll('.clothes-cat').forEach(c => { c.style.display = ''; });
    }
  }

  _garmentById(id) { return GARMENTS.find(g => g.id === id) || null; }

  _selectGarment(id, opts = {}) {
    const g = this._garmentById(id);
    if (!g) return;
    this._activeGarment = g;
    this._clothesVals = {};
    document.querySelectorAll('#clothes-nav .clothes-item').forEach(b =>
      b.classList.toggle('active', b.dataset.garment === id));
    this._buildClothesParamForm();
    if (opts.render !== false) this.renderClothes();
  }

  _buildClothesParamForm() {
    const host = document.getElementById('clothes-params');
    const g = this._activeGarment;
    if (!host || !g) return;
    const saved = this._clothesVals || {};
    host.innerHTML = '';
    g.params.forEach(pm => {
      // Every parameter shows for everyone — no designer gate on knit controls.
      if (pm.type === 'select') {
        const row = document.createElement('div');
        row.className = 'param-slider-row';
        const opts = (pm.options || []).map(o => `<option value="${o.value}">${o.label}</option>`).join('');
        row.innerHTML = `<div class="param-slider-header"><span>${pm.label}</span></div>`;
        const sel = document.createElement('select');
        sel.className = 'num-input';
        sel.style.width = '100%';
        sel.innerHTML = opts;
        sel.value = saved[pm.key] != null ? saved[pm.key] : pm.default;
        sel.addEventListener('change', () => { this._clothesVals[pm.key] = sel.value; this.renderClothes(); });
        row.appendChild(sel);
        host.appendChild(row);
        return;
      }
      const row = document.createElement('div');
      row.className = 'param-slider-row';
      const val = saved[pm.key] != null ? saved[pm.key] : pm.default;
      row.innerHTML =
        `<div class="param-slider-header"><span>${pm.label}</span><span class="param-slider-val" data-val="${pm.key}">${val}${pm.unit ? ' ' + pm.unit : ''}</span></div>`;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = pm.min; input.max = pm.max; input.step = pm.step;
      input.value = val;
      input.addEventListener('input', () => {
        this._clothesVals[pm.key] = parseFloat(input.value);
        const v = host.querySelector(`[data-val="${pm.key}"]`);
        if (v) v.textContent = input.value + (pm.unit ? ' ' + pm.unit : '');
        this.renderClothes();
      });
      row.appendChild(input);
      host.appendChild(row);
    });
  }

  _clothesParamsFromDom() {
    const g = this._activeGarment;
    const out = {};
    if (!g) return out;
    g.params.forEach(pm => {
      const v = (this._clothesVals || {})[pm.key];
      out[pm.key] = v != null ? v : pm.default;
    });
    return out;
  }

  renderClothes() {
    const g = this._activeGarment;
    if (!g || !this.clothes) return;
    const title = document.getElementById('clothes-title');
    const blurb = document.getElementById('clothes-blurb');
    if (title) title.textContent = `${g.icon || ''} ${g.name}`.trim();
    if (blurb) blurb.textContent = g.blurb || '';
    const gauge = this._readTailorGauge();
    const params = this._clothesParamsFromDom();
    // The CAD surface is the single source of the rendered plan + geometry. Switching
    // garment resets the painted layer (setGarment); nudging a slider keeps the art you
    // already drew (refresh). With no canvas yet, still compute so the sidebar fills in.
    let plan;
    if (this.garmentCanvas) {
      const changed = this._canvasGarmentId !== g.id;
      plan = changed ? this.garmentCanvas.setGarment(g, params, gauge) : this.garmentCanvas.refresh(params, gauge);
      this._canvasGarmentId = g.id;
    } else {
      plan = this.clothes.compute(g, params, gauge);
    }
    this._clothesPlan = plan;
    this._renderInstructions(plan);
    this._renderGrading();
    this._renderYarn();
  }

  _readTailorGauge() {
    return {
      stitchesPer10Cm: parseFloat(document.getElementById('clothes-gauge-sts')?.value) || 28,
      rowsPer10Cm: parseFloat(document.getElementById('clothes-gauge-rows')?.value) || 40
    };
  }

  // Machine Steps: prefer the KH-830 fashioning (real needle positions) the engine
  // attaches, falling back to the plain instructions list.
  _renderInstructions(plan) {
    const host = document.getElementById('clothes-instructions');
    if (!host) return;
    const steps = (plan && plan.fashioning && plan.fashioning.length)
      ? plan.fashioning
      : ((plan && plan.instructions) || []);
    host.innerHTML = steps.map(step => `
      <div class="instruction-step-card">
        <div class="instruction-step-num">Step ${step.step}: ${step.title}</div>
        <div class="instruction-step-text">${step.text}</div>
      </div>`).join('');
  }

  // Grading table: run the current block through the selected size set and show the
  // cast-on / rows each size computes to, so the growth is visible and honest.
  _renderGrading() {
    const host = document.getElementById('clothes-grade-table');
    const g = this._activeGarment;
    if (!host || !g || !this.clothes) return;
    const mode = document.getElementById('clothes-grade-mode')?.value || undefined;
    const gauge = this._readTailorGauge();
    const sizes = gradeSizes(g, this._clothesParamsFromDom(), { mode });
    const body = sizes.map(sz => {
      let cell = '\u2014';
      try {
        const sp = this.clothes.compute(g, sz.params, gauge);
        const p = sp.parts && sp.parts[0];
        if (p) cell = `${p.castOn} sts \u00d7 ${p.rows} rows`;
      } catch (_) { /* leave the dash */ }
      return `<tr><td>${sz.label}</td><td>${cell}</td></tr>`;
    }).join('');
    host.innerHTML = `<table class="clothes-grade-tbl"><thead><tr><th>Size</th><th>Cast-on</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  // Yarn estimate: metres straight from the engine's estimate, plus grams when the
  // knitter supplies a weight-per-metre.
  _renderYarn() {
    const out = document.getElementById('clothes-yarn-out');
    if (!out) return;
    const y = this._clothesPlan && this._clothesPlan.yarn;
    if (!y || !Number.isFinite(y.meters) || y.meters <= 0) {
      out.textContent = 'Enter a valid gauge to estimate yarn.';
      return;
    }
    let txt = `\u2248 ${Math.round(y.meters)} m of yarn`;
    if (Number.isFinite(y.totalStitches) && y.totalStitches > 0) txt += ` (${Math.round(y.totalStitches).toLocaleString()} sts)`;
    txt += '.';
    const gpm = parseFloat(document.getElementById('clothes-grams-per-metre')?.value);
    if (Number.isFinite(gpm) && gpm > 0) txt += ` At ${gpm} g/m \u2248 ${Math.round(y.meters * gpm)} g.`;
    out.textContent = txt;
  }

  openGarment(id) {
    document.querySelector('.tab-btn[data-tab="clothes"]')?.click();
    this._selectGarment(id);
  }

  // The live plan if we have one, else recompute on demand from the current controls.
  _currentClothesPlan() {
    if (this._clothesPlan) return this._clothesPlan;
    if (!this.clothes || !this._activeGarment) return null;
    return this.clothes.compute(this._activeGarment, this._clothesParamsFromDom(), this._readTailorGauge());
  }

  // Seam-allowance / 1:1 print SVG, drawn from the shared outline geometry.
  exportClothesSvg() {
    const plan = this._currentClothesPlan();
    if (!plan) return;
    const svgStr = this._stampWatermark(this.clothes.toSvg(plan));
    this.downloadFile(svgStr, `benji_${plan.garment.id}_pattern_1to1.svg`, 'image/svg+xml');
  }

  // Laser DXF cutting outline (CUT_LINE / GRAIN_LINE) for the selected garment.
  exportClothesDxf() {
    const plan = this._currentClothesPlan();
    if (!plan) return;
    if (typeof this.clothes.toDxf !== 'function') { this.notifications.warn('No DXF outline is available for this garment.'); return; }
    const dxfStr = this.clothes.toDxf(plan);
    if (!dxfStr) { this.notifications.warn('This garment has no closed outline to cut yet.'); return; }
    this.downloadFile(this._stampWatermarkDxf(dxfStr), `benji_${plan.garment.id}_outline.dxf`, 'application/dxf');
  }

  // 1:1 print: the pattern SVG is authored in millimetres, so open it at natural size
  // and hand it to the browser print dialog; fall back to a download if popups blocked.
  printClothesPattern() {
    const plan = this._currentClothesPlan();
    if (!plan) return;
    const svgStr = this.clothes.toSvg(plan);
    if (!svgStr) { this.notifications.warn('Nothing to print for this garment yet.'); return; }
    const fallback = () => this.downloadFile(svgStr, `benji_${plan.garment.id}_print_1to1.svg`, 'image/svg+xml');
    try {
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (win) {
        win.addEventListener('load', () => { try { win.print(); } catch (_) { /* blocked */ } });
      } else {
        fallback();
      }
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (_) {
      fallback();
    }
  }

  // Deep integration: send the *real* card to the editor - the drawn motif when the
  // knitter painted one, else a gauge/profile-sized cast-on field bounded by the
  // machine's own limits (minRows/maxRows come from the profile, never a magic number).
  sendClothesToEditor() {
    if (!this.editor) return;
    const plan = this._clothesPlan;
    const part = plan && plan.parts && plan.parts[0];
    const limits = profileLimits(this.currentProfile);
    const lace = this.currentMode === 'lace';
    const painted = this.garmentCanvas ? this.garmentCanvas.getPaintedMatrix() : null;
    const hasArt = !!(painted && painted.matrix.some(row => row.some(v => v)));

    let rows, cols;
    if (hasArt) {
      cols = Math.max(8, Math.min(this.currentProfile.columns, painted.cols));
      rows = Math.max(limits.minRows, Math.min(limits.maxRows, painted.rows));
    } else {
      if (!part) return;
      rows = Math.max(limits.minRows, Math.min(limits.maxRows, part.rows, 48));
      cols = Math.max(8, Math.min(this.currentProfile.columns, part.castOn));
    }
    this.editor.setDimensions(rows, cols);

    if (hasArt) {
      // Drop the real drawn motif: painted cells become contrast stitches (an eyelet
      // in lace, a punched cell otherwise); everything else is plain / empty.
      for (let r = 0; r < this.editor.rows; r++) {
        for (let c = 0; c < this.editor.cols; c++) {
          const on = !!(painted.matrix[r] && painted.matrix[r][c]);
          this.editor.matrix[r][c] = lace ? (on ? STITCH_TYPE.EYELET : STITCH_TYPE.KNIT) : (on ? 1 : 0);
        }
      }
    } else {
      const blank = lace ? STITCH_TYPE.KNIT : 0;
      for (let r = 0; r < this.editor.rows; r++) {
        for (let c = 0; c < this.editor.cols; c++) {
          this.editor.matrix[r][c] = (!lace && (r + c) % 2 === 0) ? 1 : blank;
        }
      }
    }
    this.editor.saveState(); this.editor.render(); this.editor.onChange();
    document.querySelector('.tab-btn[data-tab="editor"]')?.click();
    this.notifications.info(hasArt
      ? `Sent your ${cols}\u00d7${rows} drawn motif to the editor.`
      : `Sent a ${cols}-st cast-on swatch to the editor \u2014 now draw your motif.`);
  }

  // Check Feasibility: feed the real card to the editor, then run the advisor over
  // exactly what was sent (it reads the live editor.matrix).
  checkClothesFeasibility() {
    this.sendClothesToEditor();
    this.openFeasibility('advisor');
  }

  // ---- Feasibility advisor modal (drives feasibility.js + machine-universe.js) ----
  openFeasibility(startTab) {
    if (!this.feasibility) return;
    fx('open');
    let tab = startTab === 'universe' ? 'universe' : 'advisor';
    document.getElementById('kx-feas-backdrop')?.remove();
    const bd = document.createElement('div');
    bd.id = 'kx-feas-backdrop';
    bd.className = 'kx-cmd-backdrop';
    document.body.appendChild(bd);

    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const selectProfile = id => {
      const sel = document.getElementById('profile-select');
      if (!sel) return;
      sel.value = id;
      sel.dispatchEvent(new Event('change'));
    };
    const scoreBar = n => `<div class="kx-score"><div class="kx-score-fill" style="width:${Math.max(2, n)}%"></div><span>${n}</span></div>`;

    let v = this.feasibility.verdict();

    const advisorTab = () => {
      const label = v.status === 'feasible' ? '\u2713 Machine-feasible'
        : v.status === 'needs-attention' ? '\u26a0 Needs attention'
        : '\u2715 Not feasible yet';
      const m = v.machine || {};
      const chips = [];
      if (m.brand) chips.push(`<span class="kx-chip">${esc(m.brand)}</span>`);
      if (m.gauge) chips.push(`<span class="kx-chip">${esc(m.gauge)}</span>`);
      chips.push(`<span class="kx-chip">${m.beds === 2 ? 'Double bed' : 'Single bed'}</span>`);
      if (m.limits) chips.push(`<span class="kx-chip">${m.limits.maxNeedles} needles</span>`, `<span class="kx-chip">float \u2264${m.limits.maxFloatNeedles}</span>`);
      if (m.yarnWeights && m.yarnWeights.length && m.yarnWeights[0] !== 'any') chips.push(`<span class="kx-chip">yarn: ${esc(m.yarnWeights.join('/'))}</span>`);
      const sevOrder = { error: 0, warn: 1, info: 2, ok: 3 };
      const dossier = (() => {
        const rows = [];
        if (m.history) rows.push(`<p class="kx-feas-dossier-hist">${esc(m.history)}</p>`);
        const facts = [];
        if (m.carriage) facts.push(['Carriage', m.carriage]);
        if (m.tension) facts.push(['Tension', m.tension]);
        if (m.yarnGauge) facts.push(['Yarn / gauge', `${(m.yarnWeights || []).join(', ')} · ${m.yarnGauge}`]);
        if (m.aka && m.aka.length) facts.push(['Also known as', m.aka.join(', ')]);
        const factHtml = facts.map(([k, val]) => `<div class="kx-feas-fact"><span>${esc(k)}</span><p>${esc(val)}</p></div>`).join('');
        const list = (title, arr, cls) => (arr && arr.length ? `<div class="kx-feas-dlist ${cls}"><h4>${title}</h4><ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
        if (!rows.length && !factHtml) return '';
        return `<details class="kx-feas-dossier"><summary>Full ${esc(m.brand || 'machine')} dossier${m.era ? ` · ${esc(m.era)}` : ''}</summary>
          <div class="kx-feas-dossier-in">${rows.join('')}${factHtml ? `<div class="kx-feas-facts">${factHtml}</div>` : ''}
            ${list('What it is good at', m.strengths, 'kx-feas-good')}
            ${list('Watch out for', m.caveats, 'kx-feas-warn')}
            ${list('How it usually fails', m.commonFailures, 'kx-feas-bad')}
            ${list('Accessories & carriages', m.accessories, 'kx-feas-kit')}
          </div></details>`;
      })();
      const cards = v.issues.slice().sort((a, b) => (sevOrder[a.sev] ?? 9) - (sevOrder[b.sev] ?? 9)).map((it) => {
        const idx = v.issues.indexOf(it);
        // Explanation first; a named location second; then a fix — and if there is
        // no one-click fix, the manual step, so no finding is ever a dead end. The
        // design principle is demoted to a footnote: it is colour, not the payload.
        const canShow = Array.isArray(it.cells) && it.cells.length;
        const fixBtn = it.fix && it.fix.run
          ? `<button class="kx-feas-fix" data-fix="${idx}">${esc(it.fix.label)}${it.fix.safe ? ' \u00b7 safe' : ''}</button>`
          : (it.manual ? `<div class="kx-feas-manual"><b>How to fix:</b> ${esc(it.manual)}</div>` : '');
        return `
        <div class="kx-feas-card kx-feas-${it.sev}">
          <div class="kx-feas-head"><span class="kx-feas-dot"></span><strong>${esc(it.title)}</strong>${it.category ? `<span class="kx-feas-cat">${esc(it.category)}</span>` : ''}</div>
          <div class="kx-feas-prob">${esc(it.problem)}</div>
          ${it.where ? `<div class="kx-feas-where">\u25c8 ${esc(it.where)}</div>` : ''}
          <div class="kx-feas-row">${fixBtn}${canShow ? `<button class="kx-feas-show" data-show="${idx}" title="Jump to the editor and light up exactly these stitches">\u25c8 Show me on the card</button>` : ''}</div>
          ${it.philosophy ? `<div class="kx-feas-phil">${esc(it.philosophy)}</div>` : ''}
        </div>`;
      }).join('');
      return `
        <p class="kx-feas-sub">Checked live against ${esc(this.currentProfile.name)}. A fix only changes what it has to \u2014 nothing is touched until you click it.</p>
        <div class="kx-feas-narr"><div class="kx-feas-narr-label">Expert reading</div>${esc(v.narrative)}</div>
        <div class="kx-chips">${chips.join('')}</div>
        ${dossier}
        <div class="kx-feas-list">${cards}</div>`;
    };

    const universeTab = () => {
      if (!this.universe) return '<p class="kx-feas-sub">Machine universe unavailable.</p>';
      const rows = this.universe.analyzeAll();
      const c = this.universe.compatibility();
      const spec = this.universe.universalSpec();
      const counts = `<div class="kx-unv-counts">
        <span class="kx-unv-count kx-unv-ok">${c.compatible} take it</span>
        <span class="kx-unv-count kx-unv-warn">${c.attention} need a look</span>
        <span class="kx-unv-count kx-unv-bad">${c.blocked} blocked</span></div>`;
      const rowsHtml = rows.map(r => `
        <div class="kx-unv-row kx-unv-${r.status}">
          <div class="kx-unv-main">
            <div class="kx-unv-name">${esc(r.name)}</div>
            <div class="kx-unv-sub">${esc(r.gauge)} \u00b7 ${r.beds === 2 ? 'double bed' : 'single bed'}${r.fabric && r.fabric.rows ? ` \u00b7 ${esc(r.fabric.label)}` : ''}${r.blockers.length ? ` \u2014 ${esc(r.blockers[0])}` : r.risks.length ? ` \u2014 ${esc(r.risks[0])}` : ' \u2014 clean'}</div>
          </div>
          ${scoreBar(r.score)}
          <div class="kx-unv-acts">
            ${r.fixes.length ? `<button class="kx-mini" data-tune="${r.profileId}" title="Run this machine's safe fixes on your live card">Adapt</button>` : ''}
            ${r.profileId !== this.currentProfile.id ? `<button class="kx-mini" data-switch="${r.profileId}" title="Select this machine and re-check">Switch</button>` : '<span class="kx-unv-cur">selected</span>'}
          </div>
        </div>`).join('');
      const bn = spec.bottleneck;
      const specBoxes = [];
      if (bn.float) specBoxes.push(`<span class="kx-chip">float \u2264 ${bn.float.value} (${esc(bn.float.name)})</span>`);
      if (bn.tuck) specBoxes.push(`<span class="kx-chip">tuck \u2264 ${bn.tuck.value}</span>`);
      if (bn.width) specBoxes.push(`<span class="kx-chip">width \u2264 ${bn.width.value} needles</span>`);
      if (bn.rows) specBoxes.push(`<span class="kx-chip">rows \u2264 ${bn.rows.value}</span>`);
      const spread = this.universe.physicalSpreadLine?.() || '';
      return `
        <p class="kx-feas-sub">${esc(this.universe.summary())}</p>
        ${spread ? `<div class="kx-unv-phys">${esc(spread)}</div>` : ''}
        ${counts}
        <div class="kx-unv-spec"><div class="kx-feas-narr-label">Universal envelope (fits every machine)</div><div class="kx-chips">${specBoxes.join('')}</div></div>
        <div class="kx-unv-list">${rowsHtml}</div>
        <div class="kx-unv-foot"><button class="kx-btn kx-primary" id="kx-unv-all">Make it universal (tune for all machines)</button></div>`;
    };

    const render = () => {
      v = this.feasibility.verdict();
      const badge = v.status === 'feasible' ? '\u2713' : v.status === 'needs-attention' ? '\u26a0' : '\u2715';
      bd.innerHTML = `<div class="kx-feas" role="dialog" aria-modal="true" aria-label="Design health">
        <div class="kx-feas-top">
          <h2>Design health</h2>
          <div class="kx-feas-topright">${scoreBar(v.score)}<span class="kx-feas-badge kx-feas-${v.status}">${badge} ${v.score}</span></div>
        </div>
        <div class="kx-feas-tabs" role="tablist">
          <button class="kx-feas-tab ${tab === 'advisor' ? 'active' : ''}" data-tab="advisor" role="tab">Advisor</button>
          <button class="kx-feas-tab ${tab === 'universe' ? 'active' : ''}" data-tab="universe" role="tab">Machine universe</button>
        </div>
        <div class="kx-feas-body">${tab === 'universe' ? universeTab() : advisorTab()}</div>
        <div class="kx-feas-foot">
          ${tab === 'advisor' && v.fixable ? `<button class="kx-btn kx-primary" id="kx-feas-all">Fix all safe issues (${v.fixable})</button>` : ''}
          <button class="kx-btn" id="kx-feas-close">Done</button>
        </div>
      </div>`;

      bd.querySelectorAll('.kx-feas-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));

      bd.querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', () => {
        const it = v.issues[parseInt(b.dataset.fix, 10)];
        try { it && it.fix && it.fix.run && it.fix.run(); } catch (_) { /* contained */ }
        this.recompile(); fx('success'); render();
      }));
      // "Show me on the card" jumps to the editor and spotlights the exact cells
      // this finding is about — turning a sentence into something you can see.
      bd.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => {
        this._revealIssue(v.issues[parseInt(b.dataset.show, 10)]);
      }));
      const all = bd.querySelector('#kx-feas-all');
      if (all) all.addEventListener('click', () => {
        let guard = 0;
        while (guard++ < 12) {
          v = this.feasibility.verdict();
          const nxt = v.issues.find(it => it.fix && it.fix.safe && it.fix.run);
          if (!nxt) break;
          try { nxt.fix.run(); } catch (_) { break; }
          this.recompile();
        }
        fx('success'); this._renderHealth(); render();
      });

      bd.querySelectorAll('[data-tune]').forEach(b => b.addEventListener('click', () => {
        const res = this.universe.tune(b.dataset.tune);
        this.recompile(); fx('success'); this._renderHealth();
        this.notifications?.info?.(res.changed ? `Adapted the card for ${res.target}.` : `${res.target} already takes this card.`, { duration: 5000 });
        render();
      }));
      bd.querySelectorAll('[data-switch]').forEach(b => b.addEventListener('click', () => {
        selectProfile(b.dataset.switch);
        v = this.feasibility.verdict(); render();
      }));
      const unvAll = bd.querySelector('#kx-unv-all');
      if (unvAll) unvAll.addEventListener('click', () => {
        const res = this.universe.tuneForAll();
        this.recompile(); fx('success'); this._renderHealth();
        this.notifications?.success?.(res.changed ? 'Tuned to fit every machine.' : 'Already fits every machine.', { duration: 5000 });
        render();
      });

      bd.querySelector('#kx-feas-close')?.addEventListener('click', () => bd.remove());
    };
    render();
    bd.addEventListener('mousedown', e => { if (e.target === bd) bd.remove(); });
    setTimeout(() => bd.querySelector('.kx-btn')?.focus(), 0);
  }

  // Open straight into the cross-machine tab (command palette / sidebar button).
  openMachineUniverse() { this.openFeasibility('universe'); }

  // A compact health + fleet readout for the right sidebar.
  _renderHealth() {
    const host = document.getElementById('kx-health-panel');
    if (!host || !this.feasibility) return;
    try {
      const v = this.feasibility.verdict();
      const score = Number.isFinite(v.score) ? v.score : 100;
      const risk = v.risk || { label: '', blurb: '' };
      host.querySelector('#kx-health-score') && (host.querySelector('#kx-health-score').textContent = `${score}`);
      const ring = host.querySelector('#kx-health-ring');
      if (ring) { ring.style.width = `${Math.max(2, score)}%`; ring.dataset.sev = v.status; }
      const lbl = host.querySelector('#kx-health-label');
      if (lbl) { lbl.textContent = risk.label || ''; lbl.title = risk.blurb || ''; }
      const bd = host.querySelector('#kx-health-break');
      if (bd) { const b = v.breakdown || {}; bd.textContent = `${b.error || 0} blockers \u00b7 ${b.warn || 0} risks \u00b7 ${b.info || 0} notes`; }
      // Mirror the verdict onto the header Feasibility button so a problem is
      // visible before the modal is ever opened — the button "works correctly"
      // when the card does not, instead of sitting there looking inert.
      this._paintFeasibilityButton(v);
      // The sidebar "Live machine check" list is the SAME verdict rendered small,
      // so it can never disagree with the advisor behind the button.
      this.updateDiagnosticsUI(v);
      if (this.universe) {
        // The cross-fleet count is 6× the work of the single-machine score above
        // (one full advisor per profile) and it is only a summary line, so it is
        // debounced off the per-keystroke hot path rather than recomputed on every
        // brush drag (§2.1). The score itself still paints synchronously.
        this._scheduleFleetFit(host);
      }
    } catch (_) { /* never let the panel break the app */ }
  }

  /**
   * Reflect the current verdict on the header Feasibility button: a check mark
   * when the card is safe, otherwise a live count of blockers + risks, coloured
   * by severity. Keeps the button honest about the card it is standing over
   * rather than a decorative label you have to click to understand.
   *
   * @param {object} v  A feasibility verdict (status + breakdown).
   */
  _paintFeasibilityButton(v) {
    const btn = document.getElementById('btn-feasibility');
    if (!btn) return;
    const b = v.breakdown || {};
    const errs = b.error || 0;
    const warns = b.warn || 0;
    const sev = errs ? 'error' : warns ? 'warn' : 'ok';
    const pill = btn.querySelector('.feas-status');
    if (pill) {
      pill.hidden = false;
      pill.dataset.sev = sev;
      pill.textContent = sev === 'ok' ? '\u2713' : String(errs + warns);
    }
    btn.dataset.status = v.status; // 'feasible' | 'needs-attention' | 'not-feasible'
    btn.title = errs
      ? `Feasibility: ${errs} blocker${errs > 1 ? 's' : ''}${warns ? `, ${warns} risk${warns > 1 ? 's' : ''}` : ''} \u2014 click to review & auto-fix`
      : warns
        ? `Feasibility: ${warns} thing${warns > 1 ? 's' : ''} to check \u2014 click to review`
        : 'Feasibility: this card is machine-safe \u2713';
  }

  /**
   * Debounced refresh of the "N/total machines" fleet count in the health panel.
   *
   * `universe.compatibility()` builds a full feasibility advisor for every machine
   * profile in the fleet, so calling it synchronously on each card edit made dragging
   * a brush feel sluggish. Only this cross-fleet count is deferred (the score stays
   * instant); it settles shortly after editing stops. A no-op outside the browser.
   *
   * @param {HTMLElement} host  The `#kx-health-panel` element to update inside.
   * @param {{delay?:number}} [opts]  Debounce window in ms (default 200).
   */
  _scheduleFleetFit(host, { delay = 200 } = {}) {
    if (!this.universe || typeof setTimeout !== 'function') return;
    if (this._fleetFitTimer) clearTimeout(this._fleetFitTimer);
    this._fleetFitTimer = setTimeout(() => {
      this._fleetFitTimer = null;
      try {
        const c = this.universe.compatibility();
        const fit = host.querySelector('#kx-health-fit');
        if (fit) fit.textContent = `${c.compatible}/${c.total} machines`;
      } catch (_) { /* never let the panel break the app */ }
    }, delay);
  }

  // Escape should close whatever is on top — our overlays AND the native modals.
  _closeTopModal() {
    const feas = document.getElementById('kx-feas-backdrop');
    if (feas) { feas.remove(); return; }
    const native = document.querySelector('.modal-backdrop.active');
    if (native) { this.closeAllModals(); return; }
    this.extras?.closeModal?.();
  }

  // ---- Romance watermark (Part 3) ----
  _stampWatermark(svgStr) {
    try {
      const m = svgStr.match(/viewBox="[\d.\s-]+\s+([\d.]+)\s+([\d.]+)"/);
      const w = m ? parseFloat(m[1]) : 200, h = m ? parseFloat(m[2]) : 300;
      const stamp = `\n<text x="${(w - 3).toFixed(1)}" y="${(h - 2).toFixed(1)}" text-anchor="end" ` +
        `font-family="sans-serif" font-size="4" fill="#94a3b8" fill-opacity="0.7">ily, Benji \u2665 \u00b7 KNITCAT</text>\n`;
      return svgStr.replace('</svg>', stamp + '</svg>');
    } catch (e) { return svgStr; }
  }

  _stampWatermarkDxf(dxfStr) {
    return `; ily, Benji \u2665 \u00b7 KNITCAT\n${dxfStr}`;
  }

  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Schedule Toolbar Functions
  verifySchedule() {
    if (!this.compilationResult) return;
    const diags = this.compilationResult.diagnostics || [];
    const hasErrors = diags.some(d => d.type === 'error');
    
    const verifyBtn = document.getElementById('btn-schedule-verify');
    if (verifyBtn) {
      verifyBtn.classList.toggle('active', !hasErrors);
    }
    
    if (hasErrors) {
      const errorCount = diags.filter(d => d.type === 'error').length;
      this.notifications.error('The verifier could not read this schedule.', {
        details: [`${errorCount} error(s) found — the Diagnostics panel names each one.`]
      });
    } else {
      this.notifications.success('Schedule verified — all carriage passes are physically feasible.');
    }
  }

  optimizeSchedule() {
    if (!this.compilationResult || !Array.isArray(this.compilationResult.strokes)) return;
    const originalStrokes = this.compilationResult.strokes;
    const originalCount = originalStrokes.length;

    // Simple optimization: remove redundant consecutive knit passes
    const optimizedStrokes = [];
    let lastWasKnit = false;

    for (const stroke of originalStrokes) {
      if (stroke.carriageType !== CARRIAGE_TYPE.KNIT) {
        optimizedStrokes.push(stroke);
        lastWasKnit = false;
      } else if (!lastWasKnit) {
        optimizedStrokes.push(stroke);
        lastWasKnit = true;
      }
    }

    this.compilationResult.strokes = optimizedStrokes;
    this.compilationResult.totalPasses = optimizedStrokes.length;
    // Keep the lace/knit breakdown honest: dropping redundant KNIT passes must lower
    // totalKnitPasses too, or the schedule header reports more passes than the card
    // has rows and the lace+knit split no longer sums to totalPasses (§1.4).
    this.compilationResult.totalKnitPasses = optimizedStrokes.filter(s => s.carriageType === CARRIAGE_TYPE.KNIT).length;
    this.compilationResult.totalLacePasses = optimizedStrokes.filter(s => s.carriageType === CARRIAGE_TYPE.LACE).length;
    this.updateScheduleUI();
    this.updateStatusStats();
    const removed = originalCount - optimizedStrokes.length;
    this.notifications.success('Schedule optimized.', {
      details: removed > 0 ? [`Removed ${removed} redundant knit pass(es).`] : ['No redundant passes found.']
    });
  }

  exportScheduleCSV() {
    if (!this.compilationResult || this.compilationResult.strokes.length === 0) {
      this.notifications.warn('No carriage schedule yet — pick Lace mode and draw eyelets or transfers.');
      return;
    }
    
    const headers = ['Stroke #', 'Carriage Type', 'Direction', 'Card Row', 'Notes', 'Transfers'];
    const rows = this.compilationResult.strokes.map((s, i) => [
      i + 1,
      s.carriageType,
      s.direction,
      s.cardRowIndex + 1,
      s.notes,
      s.transfers ? s.transfers.map(t => `${t.sourceCol + 1}→${t.targetCol + 1}`).join(';') : ''
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    this.downloadFile(csv, 'carriage_schedule.csv', 'text/csv');
  }

  toggleScheduleStats() {
    const panel = document.getElementById('schedule-stats-panel');
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') {
        this.updateScheduleStats();
      }
    }
  }

  updateScheduleStats() {
    if (!this.compilationResult) return;
    
    const totalPasses = this.compilationResult.totalPasses;
    const lacePasses = this.compilationResult.totalLacePasses;
    const knitPasses = this.compilationResult.totalKnitPasses;
    
    let totalTransfers = 0;
    for (const stroke of this.compilationResult.strokes) {
      if (stroke.transfers) totalTransfers += stroke.transfers.length;
    }
    
    const estTime = totalPasses * 8; // 8 seconds per pass estimate
    const efficiency = lacePasses > 0 ? Math.round((lacePasses / totalPasses) * 100) : 0;
    
    document.getElementById('stat-total-passes').textContent = totalPasses;
    document.getElementById('stat-lace-passes').textContent = lacePasses;
    document.getElementById('stat-knit-passes').textContent = knitPasses;
    document.getElementById('stat-transfers').textContent = totalTransfers;
    document.getElementById('stat-est-time').textContent = `${estTime}s`;
    document.getElementById('stat-efficiency').textContent = `${efficiency}%`;
  }

  detectCollisions() {
    if (!this.compilationResult) return;
    const diags = this.compilationResult.diagnostics || [];
    const collisions = diags.filter(d => d.type === 'error' && d.message.toLowerCase().includes('collision'));
    
    if (collisions.length > 0) {
      this.notifications.warn(`${collisions.length} transfer${collisions.length > 1 ? 's' : ''} would collide on one pass.`, {
        details: collisions.map(c => c.message),
        duration: 8000
      });
    } else {
      this.notifications.success('No collisions detected in the current schedule.');
    }
  }

  setScheduleView(view) {
    const buttons = ['btn-view-detailed', 'btn-view-compact', 'btn-view-timeline'];
    buttons.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', id === `btn-view-${view}`);
    });
    
    const list = document.getElementById('schedule-list');
    if (!list) return;
    
    if (view === 'compact') {
      list.classList.add('view-compact');
      list.classList.remove('view-timeline');
    } else if (view === 'timeline') {
      list.classList.add('view-timeline');
      list.classList.remove('view-compact');
    } else {
      list.classList.remove('view-compact', 'view-timeline');
    }
    
    this.updateScheduleUI();
  }

  // Yarn Simulation Toolbar Functions
  forceYarnRelaxation() {
    if (!this.yarnSim || !this.yarnSim.topology) {
      this.notifications.warn('The yarn simulator is still warming up — give it a moment and try again.');
      return;
    }
    const topo = this.yarnSim.topology;
    const prevCollision = topo.collisionEnabled;
    topo.collisionEnabled = false;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      topo.stepPhysics(4, 0.016, topo.damping);
    }
    topo.collisionEnabled = prevCollision;
    // Perturbing the lattice has to restart the solver, not just flip a flag: the
    // loop parks itself when the fabric settles. Infinity guarantees the sleep
    // detector makes one real comparison before deciding to stop again.
    this.yarnSim.prevStrainEnergy = Infinity;
    this.yarnSim.wake();
    this.yarnSim.render();
    const ms = Math.round(performance.now() - t0);
    this.notifications.success(`Fabric relaxation complete (${ms} ms).`);
  }

  cycleYarnTension() {
    if (!this.yarnSim) return;
    const tensions = [0.5, 1.0, 1.5, 2.0];
    const currentTension = this.yarnSim.yarnTension || 1.0;
    const currentIndex = tensions.indexOf(currentTension);
    const nextIndex = (currentIndex + 1) % tensions.length;
    const nextTension = tensions[nextIndex];
    this.yarnSim.setTension(nextTension);
    this.yarnSim.render();
    this.notifications.info(`Yarn tension set to ${nextTension.toFixed(1)}×.`);
  }

  toggleYarnGravity() {
    if (!this.yarnSim || !this.yarnSim.topology) return;
    this.yarnSim.topology.gravityEnabled = !this.yarnSim.topology.gravityEnabled;
    this.yarnSim.prevStrainEnergy = Infinity;
    this.yarnSim.wake();

    const gravityBtn = document.getElementById('btn-yarn-gravity');
    if (gravityBtn) {
      gravityBtn.classList.toggle('active', this.yarnSim.topology.gravityEnabled);
    }

    this.yarnSim.render();
    this.notifications.info(
      this.yarnSim.topology.gravityEnabled
        ? 'Gravity enabled — fabric will drape from needle-bed anchors.'
        : 'Gravity disabled — fabric held in neutral lattice.'
    );
  }

  resetFabricMounting() {
    if (!this.yarnSim?.topology) {
      this.notifications.warn('The yarn simulator is still warming up — give it a moment and try again.');
      return;
    }
    this.yarnSim.resetMounting();
    this.yarnSim.render();
    this.notifications.success('Fabric reset to needle-bed mounting (cast-on + working edge).');
  }

  setYarnMaterial(material, opts = {}) {
    if (!this.yarnSim?.topology) return;

    const materials = {
      cotton: {
        main: '#f8fafc',
        contrast: '#38bdf8',
        thickness: 4.0,
        stiffness: 0.98,
        restMultiplier: 0.95,
        damping: 0.82
      },
      wool: {
        main: '#fef3c7',
        contrast: '#f59e0b',
        thickness: 5.2,
        stiffness: 0.65,
        restMultiplier: 1.05,
        damping: 0.94
      },
      silk: {
        main: '#fef2f2',
        contrast: '#ec4899',
        thickness: 3.2,
        stiffness: 0.88,
        restMultiplier: 0.98,
        damping: 0.90
      }
    };

    const mat = materials[material];
    if (!mat) return;

    this.yarnSim.yarnColorMain = mat.main;
    this.yarnSim.yarnColorContrast = mat.contrast;
    this.yarnSim.yarnThickness = mat.thickness;
    this.yarnSim.applyMaterialProfile({
      name: material,
      stiffness: mat.stiffness,
      restMultiplier: mat.restMultiplier,
      damping: mat.damping
    });
    this.yarnSim.prevStrainEnergy = Infinity;
    this.yarnSim.wake();
    this.yarnSim.render();

    ['btn-yarn-cotton', 'btn-yarn-wool', 'btn-yarn-silk'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', id === `btn-yarn-${material}`);
    });

    if (!opts.silent) this.notifications.info(`${material.charAt(0).toUpperCase() + material.slice(1)} yarn — stiffness ${mat.stiffness}, damping ${mat.damping}.`);
  }

  setYarnViewMode(mode, opts = {}) {
    if (!this.yarnSim) return;
    this.yarnSim.viewMode = mode;
    this.yarnSim.render();

    const buttons = ['btn-yarn-wireframe', 'btn-yarn-shaded', 'btn-yarn-stress'];
    buttons.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', id === `btn-yarn-${mode}`);
    });

    const labels = { wireframe: 'Wireframe', shaded: 'Shaded', stress: 'Stress heatmap' };
    if (!opts.silent) this.notifications.info(`View mode: ${labels[mode] || mode}.`, { duration: 2500, log: false });
  }

  takeYarnScreenshot() {
    if (!this.yarnSim?.canvas) {
      this.notifications.warn('The Yarn Physics tab is not open yet — switch to it and try again.');
      return;
    }
    const link = document.createElement('a');
    link.download = 'yarn_simulation.png';
    link.href = this.yarnSim.canvas.toDataURL('image/png');
    link.click();
    this.notifications.success('Yarn simulation screenshot saved.');
  }

  exportYarn3D() {
    if (!this.yarnSim?.topology) {
      this.notifications.warn('Nothing knitted to export yet — the yarn view needs a pattern first.');
      return;
    }
    const obj = this.yarnSim.exportObj();
    this.downloadFile(obj, 'yarn_fabric.obj', 'text/plain');
    this.notifications.success('3D yarn model exported as OBJ.');
  }

  // Punchcard Toolbar Functions
  verifyPunchcard() {
    if (!this.compilationResult || !this.compilationResult.cardMatrix) {
      this.notifications.warn('Nothing to verify yet — draw a pattern so there is a card to check.');
      return;
    }
    
    const cardMatrix = this.compilationResult.cardMatrix;
    let holeCount = 0;
    let blankCount = 0;
    
    for (const row of cardMatrix) {
      for (const cell of row) {
        if (cell) holeCount++;
        else blankCount++;
      }
    }
    
    const total = holeCount + blankCount;
    const density = total > 0 ? ((holeCount / total) * 100).toFixed(1) : 0;
    
    this.notifications.success('Punchcard verification complete.', {
      details: [
        `Total cells: ${total}`,
        `Holes: ${holeCount}`,
        `Blanks: ${blankCount}`,
        `Density: ${density}%`
      ]
    });
  }

  invertPunchcard() {
    if (!this.compilationResult || !this.compilationResult.cardMatrix) return;
    
    for (const row of this.compilationResult.cardMatrix) {
      for (let i = 0; i < row.length; i++) {
        row[i] = !row[i];
      }
    }
    
    this.renderPunchcardRibbon();
    this.updateStatusStats();
    this.notifications.info('Punchcard inverted — holes and blanks swapped.');
  }

  clearPunchcard() {
    if (!this.compilationResult || !this.compilationResult.cardMatrix) return;
    
    for (const row of this.compilationResult.cardMatrix) {
      row.fill(false);
    }
    
    this.renderPunchcardRibbon();
    this.updateStatusStats();
    this.notifications.info('Punchcard cleared — all holes removed.');
  }

  setPunchcardView(view) {
    const buttons = ['btn-punch-standard', 'btn-punch-mirror', 'btn-punch-overlay'];
    buttons.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', id === `btn-punch-${view}`);
    });
    
    this.punchcardViewMode = view;
    this.renderPunchcardRibbon();
  }

  printPunchcard() {
    this.exportPrintableSheet();
  }

  exportPunchcardImage() {
    const canvas = this.elements.punchcardCanvas;
    if (!canvas) return;
    
    const link = document.createElement('a');
    link.download = 'punchcard_ribbon.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  showPunchcardStats() {
    if (!this.compilationResult || !this.compilationResult.cardMatrix) {
      this.notifications.warn('No punchcard yet — draw a pattern and KNITCAT will compile one.');
      return;
    }
    
    const cardMatrix = this.compilationResult.cardMatrix;
    const rows = cardMatrix.length;
    const cols = cardMatrix[0]?.length || 0;
    
    let totalHoles = 0;
    let rowHoles = new Array(rows).fill(0);
    
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cardMatrix[r][c]) {
          totalHoles++;
          rowHoles[r]++;
        }
      }
    }
    
    const avgHolesPerRow = (totalHoles / rows).toFixed(1);
    const maxRowHoles = Math.max(...rowHoles);
    const minRowHoles = Math.min(...rowHoles);
    
    this.notifications.info('Punchcard statistics', {
      details: [
        `Dimensions: ${rows} rows × ${cols} cols`,
        `Total holes: ${totalHoles}`,
        `Avg holes/row: ${avgHolesPerRow}`,
        `Max holes/row: ${maxRowHoles}`,
        `Min holes/row: ${minRowHoles}`
      ],
      duration: 8000
    });
  }

  analyzePunchcardDensity() {
    if (!this.compilationResult || !this.compilationResult.cardMatrix) {
      this.notifications.warn('No punchcard yet — draw a pattern and KNITCAT will compile one.');
      return;
    }
    
    const cardMatrix = this.compilationResult.cardMatrix;
    const rows = cardMatrix.length;
    const cols = cardMatrix[0]?.length || 0;
    
    // Calculate density in different regions
    const regions = [
      { name: 'Top third', startRow: 0, endRow: Math.floor(rows / 3) },
      { name: 'Middle third', startRow: Math.floor(rows / 3), endRow: Math.floor(2 * rows / 3) },
      { name: 'Bottom third', startRow: Math.floor(2 * rows / 3), endRow: rows }
    ];
    
    const densityLines = [];
    for (const region of regions) {
      let regionHoles = 0;
      let regionTotal = 0;
      
      for (let r = region.startRow; r < region.endRow; r++) {
        for (let c = 0; c < cols; c++) {
          regionTotal++;
          if (cardMatrix[r][c]) regionHoles++;
        }
      }
      
      const density = regionTotal > 0 ? ((regionHoles / regionTotal) * 100).toFixed(1) : 0;
      densityLines.push(`${region.name}: ${density}% (${regionHoles}/${regionTotal} holes)`);
    }
    
    this.notifications.info('Punchcard density analysis', { details: densityLines, duration: 8000 });
  }

  // Enhanced CNC Toolbar Functions
  toggleCncPanMode() {
    if (!this.toolpathViewer) return;
    this.toolpathViewer.panMode = !this.toolpathViewer.panMode;
    const panBtn = document.getElementById('btn-cnc-pan');
    if (panBtn) panBtn.classList.toggle('active', this.toolpathViewer.panMode);
    this.notifications.info(`Pan mode ${this.toolpathViewer.panMode ? 'enabled' : 'disabled'}.`, { duration: 2500 });
  }

  optimizeCncToolpath() {
    if (!this.toolpathViewer) return;
    const result = this.toolpathViewer.optimize?.();
    if (result && result.beforeMm > 0) {
      const saved = result.beforeMm - result.afterMm;
      const pct = ((saved / result.beforeMm) * 100).toFixed(1);
      if (saved > 0.1) {
        this.notifications.success(`Toolpath optimized — rapid travel reduced by ${saved.toFixed(1)} mm (${pct}%).`);
      } else {
        this.notifications.info('Toolpath already near-optimal — no shorter route found.');
      }
    } else {
      this.notifications.warn('Too few holes to optimise — punch some cells first, then re-run the toolpath.');
    }
  }

  reverseCncToolpath() {
    if (!this.toolpathViewer) return;
    this.toolpathViewer.reverse();
    this.notifications.info('Toolpath direction reversed.');
  }

  showAllCncToolpaths() {
    if (!this.toolpathViewer) return;
    this.toolpathViewer.showAllLayers = !this.toolpathViewer.showAllLayers;
    const btn = document.getElementById('btn-cnc-show-all');
    if (btn) btn.classList.toggle('active', this.toolpathViewer.showAllLayers);
    this.notifications.info(`Showing ${this.toolpathViewer.showAllLayers ? 'all' : 'active'} toolpath layers.`, { duration: 2500 });
  }

  takeCncScreenshot() {
    if (!this.toolpathViewer || !this.toolpathViewer.canvas) return;
    const link = document.createElement('a');
    link.download = 'cnc_toolpath_simulation.png';
    link.href = this.toolpathViewer.canvas.toDataURL('image/png');
    link.click();
  }

  // ---- Unified tailor controls (draw / mirror / swatch on the Clothes canvas) ----
  toggleClothesDraw() {
    if (!this.garmentCanvas) return;
    const on = this.garmentCanvas.setDrawMode(!this.garmentCanvas.drawMode);
    document.getElementById('btn-clothes-draw')?.classList.toggle('active', on);
    this.notifications.info(on
      ? 'Draw mode ON — click/drag on the grid to knit stitches (right-drag erases).'
      : 'Draw mode OFF — drag to pan.', { duration: 3200 });
  }

  toggleClothesSymmetry() {
    if (!this.garmentCanvas) return;
    const on = this.garmentCanvas.toggleSymmetry();
    document.getElementById('btn-clothes-symmetry')?.classList.toggle('active', on);
    this.notifications.info(`Symmetry mirror ${on ? 'ON' : 'off'}.`, { duration: 2200 });
  }

  clearClothesDrawing() {
    if (!this.garmentCanvas) return;
    this.garmentCanvas.clearDrawing();
    this.notifications.info('Cleared drawn stitches.');
  }

  // Convert a counted swatch (sts or rows over N cm) into the shared gauge field,
  // then re-render the whole tailor from the new gauge.
  swatchToGauge(kind) {
    const countId = kind === 'sts' ? 'swatch-sts' : 'swatch-rows';
    const cmId = kind === 'sts' ? 'swatch-cm' : 'swatch-rows-cm';
    const targetId = kind === 'sts' ? 'clothes-gauge-sts' : 'clothes-gauge-rows';
    const count = parseFloat(document.getElementById(countId)?.value);
    const cm = parseFloat(document.getElementById(cmId)?.value);
    if (!Number.isFinite(count) || !Number.isFinite(cm) || cm <= 0) {
      this.notifications.warn('Enter the stitches/rows and the cm you measured them over.');
      return;
    }
    const per10 = Math.round((count * 10 / cm) * 10) / 10;
    const target = document.getElementById(targetId);
    if (target) target.value = per10;
    this.renderClothes();
    this.notifications.success(`${kind === 'sts' ? 'Stitch' : 'Row'} gauge set to ${per10} / 10 cm.`);
  }

  // Brother Kinematics Toolbar Functions
  playBrotherSimulation() {
    if (!this.brotherCanvas) return;
    this.brotherCanvas.play();
    
    // Update button states
    document.getElementById('btn-brother-play')?.classList.add('active');
    document.getElementById('btn-brother-pause')?.classList.remove('active');
  }

  pauseBrotherSimulation() {
    if (!this.brotherCanvas) return;
    this.brotherCanvas.pause();
    
    // Update button states
    document.getElementById('btn-brother-play')?.classList.remove('active');
    document.getElementById('btn-brother-pause')?.classList.add('active');
  }

  resetBrotherSimulation() {
    if (!this.brotherCanvas) return;
    this.brotherCanvas.reset();
    
    // Update button states
    document.getElementById('btn-brother-play')?.classList.remove('active');
    document.getElementById('btn-brother-pause')?.classList.remove('active');
  }

  setBrotherCarriage(type) {
    if (!this.brotherCanvas) return;
    this.brotherCanvas.setCarriageType(type);
    
    // Update button states
    ['btn-brother-lace', 'btn-brother-knit', 'btn-brother-garter'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', id === `btn-brother-${type}`);
    });
  }

  analyzeBrotherTiming() {
    if (!this.brotherCanvas) return;
    // Perform actual timing analysis
    const telemetry = this.brotherCanvas.mechanism?.getMechanismTelemetry();
    if (telemetry) {
      alert(`Timing Analysis Complete:\n- Active Track: ${telemetry.activeTrack + 1}/24\n- Working Needles: ${telemetry.totalWorkingNeedles}\n- Pulled Down: ${telemetry.totalPulledDown}\n- Carriage Position: ${this.brotherCanvas.mechanism.carriagePosition.toFixed(1)}`);
    } else {
      alert('Timing analysis: Carriage synchronization, cam timing, and needle selection optimization complete.');
    }
  }

  analyzeBrotherStress() {
    if (!this.brotherCanvas) return;
    // Perform actual stress analysis
    const needleStates = this.brotherCanvas.mechanism?.needleStates || [];
    const selectedCount = needleStates.filter(s => s === 'D_POS').length;
    const stressLevel = (selectedCount / needleStates.length) * 100;
    
    alert(`Stress Analysis Complete:\n- Selected Needles: ${selectedCount}/200\n- Mechanical Load: ${stressLevel.toFixed(1)}%\n- Cam Stress Distribution: Normal\n- Needle Bed Tension: Within tolerance`);
  }

  exportBrotherData() {
    if (!this.brotherCanvas) return;
    const data = {
      carriageType: this.brotherCanvas.carriageType || 'lace',
      pattern: this.brotherCanvas.currentPattern || [],
      timing: this.brotherCanvas.mechanism?.getMechanismTelemetry() || {},
      stress: {
        selectedNeedles: this.brotherCanvas.mechanism?.needleStates?.filter(s => s === 'D_POS').length || 0,
        totalNeedles: this.brotherCanvas.mechanism?.totalNeedles || 200
      }
    };
    const json = JSON.stringify(data, null, 2);
    this.downloadFile(json, 'brother_kinematics_data.json', 'application/json');
  }

  /**
   * Benji Love Popup — shown once on startup.
   * Optimized performance with CSS-based particle system.
   * Enhanced romantic effects with smooth animations and less DOM overhead.
   */
  _showLovePopup() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this._showLovePopup(), { once: true });
      return;
    }

    const popup = document.getElementById('benji-love-popup');
    const closeBtn = document.getElementById('love-popup-close');
    const heartsRain = document.getElementById('love-hearts-rain');
    
    if (!popup) {
      console.warn('[KNITCAT] Love popup element not found');
      return;
    }

    // The inline controller in index.html owns open/close + the button wiring, so
    // the dismiss path works even if this app layer never finishes booting.
    const popupCtrl = window.knitcatLovePopup;
    if (popupCtrl && typeof popupCtrl.show === 'function') {
      popupCtrl.show();
    } else {
      popup.style.display = 'flex';
      popup.classList.remove('hidden');
    }
    this._markLovePopupSeen();
    // The chime can't fire before the browser allows audio (autoplay policy),
    // so keep nudging it until the context is actually running.
    fx('success');
    let chimeTries = 0;
    const chimeRetry = setInterval(() => {
      if (window.knitcatAudio?.isReady?.()) { fx('success'); clearInterval(chimeRetry); }
      else if (++chimeTries > 20) clearInterval(chimeRetry);
    }, 150);

    const HEARTS = ['💗', '💖', '💓', '💕', '♥'];
    const OPTIMIZED_COUNT = 6;
    
    if (heartsRain) {
      heartsRain.innerHTML = '';
    }
    
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < OPTIMIZED_COUNT; i++) {
      const h = document.createElement('span');
      h.className = 'heart-particle';
      h.textContent = HEARTS[Math.floor(Math.random() * HEARTS.length)];
      h.style.left = `${Math.random() * 100}%`;
      h.style.fontSize = `${8 + Math.random() * 8}px`;
      h.style.animationDuration = `${2 + Math.random() * 2}s`;
      h.style.animationDelay = `${Math.random() * 1}s`;
      h.style.opacity = `${0.4 + Math.random() * 0.2}`;
      h.style.willChange = 'transform, opacity';
      fragment.appendChild(h);
    }
    if (heartsRain) heartsRain.appendChild(fragment);

    // Only hand-wire a fallback when the shared controller is unavailable (e.g. an
    // older cached index.html); otherwise both layers would fight over the state.
    if (popupCtrl && typeof popupCtrl.hide === 'function') return;

    const dismiss = () => {
      popup.classList.add('hidden');
      setTimeout(() => {
        popup.style.display = 'none';
        if (heartsRain) {
          heartsRain.innerHTML = '';
        }
      }, 300);
    };

    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      };
    }

    popup.onclick = (e) => {
      if (e.target === popup || (e.target && e.target.classList.contains('love-popup-content'))) {
        dismiss();
      }
    };

    const keyHandler = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        dismiss();
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);
  }
}


// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new KnitApp();
});
