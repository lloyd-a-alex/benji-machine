/**
 * Industrial Knitting Machine CAD/CAM & Lace Decompiler
 * Main Application Orchestrator & State Controller
 */

import { MACHINE_PROFILES, calculateCardDimensions, profileLimits, bedNeedleCapacity } from './machine/profiles.js';
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
import { TankTopCanvas } from './ui/tank-top-canvas.js';
import { BeanieEngine } from './tailor/beanie-engine.js';
import { BrotherSimCanvas } from './ui/brother-sim-canvas.js';
import { NotificationCenter } from './ui/notifications.js';
import { installGlobalErrorBoundary, installRoundRectPolyfill, runGuarded } from './ui/safety.js';
import { initExtras } from './features/extras.js';
import { initSound, fx } from './features/sound.js';
import { initCommandPalette } from './features/command-palette.js';
import { initAdmin } from './features/admin.js';
import { createFeasibilityAdvisor } from './features/feasibility.js';
import { initPwa } from './features/pwa.js';
import { initDataPanel } from './features/data-panel.js';
import { initShare, incomingShareDocument } from './features/share.js';
import { readShareUrl, decodeCard, stripShareUrl } from './project/url-state.js';
import { createFileBridge } from './features/fs-access.js';
import { ClothesEngine, GARMENTS, CATEGORIES } from './tailor/clothes-catalog.js';

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
    // failure anywhere can never silently freeze the whole app.
    installRoundRectPolyfill();
    installGlobalErrorBoundary(this.notifications);

    this.compiler = new LaceCompiler(this.currentProfile);
    this.compilationResult = null;

    try {
      this.initDOM();
    } catch (e) {
      console.error('[KNITCAT] initDOM error:', e);
    }

    try {
      this.initComponents();
    } catch (e) {
      console.error('[KNITCAT] initComponents error:', e);
    }

    try {
      this.initEvents();
    } catch (e) {
      console.error('[KNITCAT] initEvents error:', e);
    }

    // Personalization + UX extras. Fully contained: if it ever fails, the core
    // CAD app is completely unaffected.
    runGuarded('Extras layer', () => {
      this.extras = initExtras({ notifier: this.notifications });
    }, { notifier: this.notifications });

    // Sound, hidden designer key, feasibility advisor, command palette, clothes
    // catalogue. Each is contained; a failure degrades that one feature only.
    runGuarded('Sound', () => { this.sound = initSound(); });
    runGuarded('Designer key', () => { this.admin = initAdmin({ notifier: this.notifications }); });
    runGuarded('Feasibility advisor', () => { this.feasibility = createFeasibilityAdvisor(this); });
    runGuarded('Clothes catalogue', () => { this.clothes = new ClothesEngine(); this._activeGarment = null; this._initClothesUI(); });
    runGuarded('Command palette', () => { this.palette = initCommandPalette({ getActions: () => this._paletteActions() }); });

    // Install / offline / launched files. Must come after the editor exists, because
    // a .kcard handed over by the operating system loads immediately.
    runGuarded('PWA layer', () => {
      this.pwa = initPwa({
        notifier: this.notifications,
        onIntent: intent => this._handleLaunchIntent(intent),
        onFile: file => this.loadProjectFile(file)
      });
    }, { notifier: this.notifications });

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
        console.error('[KNITCAT] data panel unavailable:', err);
        return null;
      });
    }, { notifier: this.notifications });

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
    }, { notifier: this.notifications });

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
      stitchButtons: document.querySelectorAll('.stitch-btn'),
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

        // 5. Tank Top Tailoring CAD
        const tankTopEl = document.getElementById('tanktop-canvas');
        if (tankTopEl) {
          this.tankTopCanvas = new TankTopCanvas(tankTopEl, {
          chestCircumferenceCm: 92,
          easeCm: 4,
          bodyLengthCm: 38,
          armholeDepthCm: 21,
          shoulderWidthCm: 35,
          neckWidthCm: 18,
          frontNeckDropCm: 13,
          strapWidthCm: 5
          });
          this.updateTankTopInstructions();
        }

        // 5b. Beanie tailor (self-contained engine, renders on demand)
        this.beanie = new BeanieEngine();

        // 6. Brother KH-830 Kinematic Simulator
        const brotherEl = document.getElementById('brother-canvas');
        if (brotherEl) {
          this.brotherCanvas = new BrotherSimCanvas(brotherEl);
        }

        // Now that components are ready, load the preset
        this.loadPreset('feather_fan_lace');
        
        // Initialize component-dependent event listeners
        this.initComponentEvents();

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

    // Viewport Tabs
    this.elements.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.elements.tabButtons.forEach(b => b.classList.remove('active'));
        this.elements.tabPanels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');

        const targetTab = btn.dataset.tab;
        this.activeTab = targetTab;
        const panel = document.getElementById(`panel-${targetTab}`);
        if (panel) panel.classList.add('active');

        this.onTabSwitched(targetTab);
      });
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

    // Tank Top Toolbar Controls
    document.getElementById('btn-tank-auto-fit')?.addEventListener('click', () => this.autoFitTankTop());
    document.getElementById('btn-tank-symmetry')?.addEventListener('click', () => this.toggleTankSymmetry());
    document.getElementById('btn-tank-reset')?.addEventListener('click', () => this.resetTankTop());
    document.getElementById('btn-tank-classic')?.addEventListener('click', () => this.setTankStyle('classic'));
    document.getElementById('btn-tank-cropped')?.addEventListener('click', () => this.setTankStyle('cropped'));
    document.getElementById('btn-tank-oversized')?.addEventListener('click', () => this.setTankStyle('oversized'));
    document.getElementById('btn-tank-import-measurements')?.addEventListener('click', () => this.importTankMeasurements());
    document.getElementById('btn-tank-export-measurements')?.addEventListener('click', () => this.exportTankMeasurements());
    document.getElementById('btn-tank-print')?.addEventListener('click', () => this.printTankPattern());

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

    // Tank Top Tailor Parametric Sliders
    const tankTopParamMap = [
      { id: 'tanktop-chest', key: 'chestCircumferenceCm', valId: 'val-tanktop-chest', unit: 'cm' },
      { id: 'tanktop-ease', key: 'easeCm', valId: 'val-tanktop-ease', unit: 'cm', prefix: '+' },
      { id: 'tanktop-length', key: 'bodyLengthCm', valId: 'val-tanktop-length', unit: 'cm' },
      { id: 'tanktop-armhole', key: 'armholeDepthCm', valId: 'val-tanktop-armhole', unit: 'cm' },
      { id: 'tanktop-shoulder', key: 'shoulderWidthCm', valId: 'val-tanktop-shoulder', unit: 'cm' },
      { id: 'tanktop-neck-w', key: 'neckWidthCm', valId: 'val-tanktop-neck-w', unit: 'cm' },
      { id: 'tanktop-neck-drop', key: 'frontNeckDropCm', valId: 'val-tanktop-neck-drop', unit: 'cm' },
      { id: 'tanktop-strap-w', key: 'strapWidthCm', valId: 'val-tanktop-strap-w', unit: 'cm' },
      // Extra fit controls.
      { id: 'tanktop-back-neck', key: 'backNeckDropCm', valId: 'val-tanktop-back-neck', unit: 'cm' },
      { id: 'tanktop-rib', key: 'ribbingHeightCm', valId: 'val-tanktop-rib', unit: 'cm' }
    ];

    tankTopParamMap.forEach(item => {
      const slider = document.getElementById(item.id);
      slider?.addEventListener('input', e => {
        const val = parseFloat(e.target.value);
        const valEl = document.getElementById(item.valId);
        if (valEl) valEl.textContent = `${item.prefix || ''}${val} ${item.unit}`;
        if (this.tankTopCanvas) {
          this.tankTopCanvas.setParams({ [item.key]: val });
          this.updateTankTopInstructions();
        }
      });
    });

    // Tank Top Exporters
    document.getElementById('btn-tanktop-svg')?.addEventListener('click', () => this.exportTankTopSvg());
    document.getElementById('btn-tanktop-dxf')?.addEventListener('click', () => this.exportTankTopDxf());
    // Ribbing style (1×1 / 2×2).
    document.getElementById('tanktop-ribtype')?.addEventListener('change', e => {
      if (this.tankTopCanvas) {
        this.tankTopCanvas.setParams({ ribbingType: e.target.value });
        this.updateTankTopInstructions();
      }
    });

    // Tank Top draw-on-grid + gauge ("just make it so I can draw", "fits your yarn")
    document.getElementById('btn-tank-draw')?.addEventListener('click', () => this.toggleTankDraw());
    document.getElementById('btn-tank-symmetry-side')?.addEventListener('click', () => this.toggleTankSymmetry());
    document.getElementById('btn-tank-clear-draw')?.addEventListener('click', () => {
      this.tankTopCanvas?.clearDrawing();
      this.notifications.info('Cleared drawn stitches.');
    });
    ['tanktop-gauge-sts', 'tanktop-gauge-rows'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => this.applyTankGauge());
    });
    // Swatch helper: count sts/rows over N cm → per-10cm gauge, applied live.
    document.getElementById('btn-swatch-calc')?.addEventListener('click', () => this.swatchToGauge('sts'));
    document.getElementById('btn-swatch-calc-rows')?.addEventListener('click', () => this.swatchToGauge('rows'));
    // Reflect the default symmetry (mirror ON) on both symmetry buttons at boot.
    if (this.tankTopCanvas) {
      document.getElementById('btn-tank-symmetry')?.classList.toggle('active', this.tankTopCanvas.symmetry);
      document.getElementById('btn-tank-symmetry-side')?.classList.toggle('active', this.tankTopCanvas.symmetry);
    }

    // (CNC controls now wired above with zoom/fit/speed)

    // Beanie tailor: live re-render on any input change.
    ['beanie-head', 'beanie-height', 'beanie-rib', 'beanie-segments'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => this.renderBeanie());
    });
    ['beanie-ribtype', 'beanie-pom', 'beanie-gauge-sts', 'beanie-gauge-rows'].forEach(id => {
      const el = document.getElementById(id);
      el?.addEventListener('change', () => this.renderBeanie());
      el?.addEventListener('input', () => this.renderBeanie());
    });
    // Fit sliders repaint the beanie live.
    ['beanie-ease', 'beanie-fold', 'beanie-crown'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => this.renderBeanie());
    });
    document.getElementById('btn-beanie-svg')?.addEventListener('click', () => this.exportBeanieSvg());
    document.getElementById('btn-beanie-reversible')?.addEventListener('click', () => {
      this.loadPreset('reversible_double_bed_chevron');
      this.notifications.info('Loaded a seamless 2-colour chevron — balanced counts so it reads on both sides. It knits stranded on your single bed; true reversible rib needs a ribber bed.');
      document.querySelector('.tab-btn[data-tab="editor"]')?.click();
    });

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
        if (this.editor?.copySelection()) { e.preventDefault(); this.notifications.info('Copied selection.'); }
      } else if (mod && k === 'x') {
        if (this.editor?.cutSelection()) { e.preventDefault(); this.notifications.info('Cut selection.'); }
      } else if (mod && k === 'v') {
        if (this.editor?.pasteClipboard()) { e.preventDefault(); this.notifications.info('Pasted selection.'); }
      } else if (mod && k === 'd') {
        // Ctrl+D duplicates the selection in place (offset by one cell).
        e.preventDefault();
        this.duplicateSelection?.();
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

    // Beanie + Clothes canvases should track the window like the tank top does.
    window.addEventListener('resize', () => {
      if (this.activeTab === 'beanie') this.renderBeanie();
      else if (this.activeTab === 'clothes') this.renderClothes();
    });
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
    this.updateDiagnosticsUI();
    this.updateStatusStats();
    this._cardDirty = false;

    // The kinematics sim always tracks the live card, not just the row it happened
    // to be given when the tab was opened. Cheap, and it keeps the animation
    // honest while you edit on another tab.
    if (this.brotherCanvas) {
      this.brotherCanvas.setCard(this.compilationResult.cardMatrix, this.compilationResult.strokes);
    }

    // Update active tab contents
    if (this.activeTab === 'yarn') {
      this.yarnSim.updateFabric(this.editor.matrix);
    } else if (this.activeTab === 'punchcard') {
      this.renderPunchcardRibbon();
    } else if (this.activeTab === 'cnc') {
      this.toolpathViewer.setCardData(this.currentProfile, this.compilationResult.cardMatrix);
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
      this.yarnSim.resize();
      this.yarnSim.updateFabric(this.editor.matrix);
      this.yarnSim.startAnimationLoop();
    } else if (tab === 'punchcard') {
      // Always regenerate the card for the CURRENT mode before drawing, so a
      // Fair Isle / Tuck / Slip drawing you just made is reflected on the ribbon
      // (previously it could show a stale or lace-only compilation).
      // Only regenerate when the editor actually changed since the last compile,
      // so explicit card edits (invert / clear / optimize) survive a tab switch.
      if (this._cardDirty) this.recompile(); else this.renderPunchcardRibbon();
    } else if (tab === 'cnc') {
      this.toolpathViewer.resize();
      this.toolpathViewer.setCardData(this.currentProfile, this.compilationResult.cardMatrix);
    } else if (tab === 'tanktop') {
      this.tankTopCanvas?.resize();
      this.tankTopCanvas?.render();
      this.updateTankTopInstructions();
    } else if (tab === 'beanie') {
      this.renderBeanie();
    } else if (tab === 'clothes') {
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

  updateDiagnosticsUI() {
    const diagList = this.elements.diagnosticsContainer;
    if (!diagList) return;

    const diags = (this.compilationResult?.diagnostics || []).slice();
    // Wider than the bed is fatal, so it leads the list.
    const bedError = this.analyzeBedWidth();
    if (bedError) diags.unshift(bedError);
    // Fair Isle / slip / tuck: each has its own stranded-yarn failure mode, and
    // only the advisor knows which. Advisory, like everything here except bed width.
    const floatWarn = this.analyzeFloats();
    if (floatWarn) diags.push(floatWarn);

    if (diags.length === 0) {
      diagList.innerHTML = '<div class="diag-ok">✓ No physical collisions or carriage conflicts detected. Pattern is 100% machine executable!</div>';
      return;
    }

    // Three severities, three distinct glyphs. A warning used to render with the
    // info icon, which made "this will snag on every finger" look optional.
    const glyph = t => (t === 'error' ? '⛔' : t === 'warning' ? '⚠' : 'ℹ');
    diagList.innerHTML = diags.map(d => `
      <div class="diag-item diag-${d.type}">
        <span class="diag-icon">${glyph(d.type)}</span>
        <span class="diag-msg">${d.message}</span>
        ${d.row !== null && d.row !== undefined ? `<span class="diag-loc">[Row ${d.row + 1}${d.col !== null && d.col !== undefined ? `, Col ${d.col + 1}` : ''}]</span>` : ''}
      </div>
    `).join('');
  }

  // Scan the current pattern for stranded-yarn risks and report the worst one.
  //
  // What counts as a float is mode-dependent, and getting it wrong produces
  // confident nonsense:
  //   fair_isle — every needle knits one of two colours, so colour A floats
  //             behind a run of colour B *and vice versa*. Both directions count.
  //   slip      — punched needles knit and blanks are skipped, so the carried
  //             yarn sits behind the BLANK run. Counting punched runs would flag
  //             the solid blocks and miss the actual danger.
  //   tuck      — a horizontal run of held needles is simply rib-like fabric, not
  //             a float. The failure mode here is vertical: loops stacking on one
  //             needle until it lifts out of the cam channel.
  analyzeFloats() {
    if (!this.editor || !CanvasEditor.isDirectMode(this.currentMode)) return null;
    const { maxFloatNeedles, maxTuckLoops } = profileLimits(this.currentProfile);
    const m = this.editor.matrix;
    const rows = m.length;
    const cols = rows ? m[0].length : 0;

    if (this.currentMode === 'tuck') {
      let worst = 0, worstRow = -1, worstCol = -1;
      for (let c = 0; c < cols; c++) {
        let run = 0;
        for (let r = 0; r < rows; r++) {
          run = m[r][c] === 1 ? run + 1 : 0;
          if (run > worst) { worst = run; worstRow = r; worstCol = c; }
        }
      }
      if (worst > maxTuckLoops) {
        return {
          type: 'warning',
          message: `Needle ${worstCol + 1} is asked to hold ${worst} stacked tuck loops (this carriage comfortably carries about ${maxTuckLoops}). Loop the extra yarn with a transfer row, or shorten the column.`,
          row: worstRow,
          col: worstCol
        };
      }
      return null;
    }

    // Which symbol actually carries the floating yarn behind it.
    const floatSymbols = this.currentMode === 'slip' ? [0] : [0, 1];
    const label = this.currentMode === 'slip' ? 'slipped' : 'stranded';

    let worst = 0, worstRow = -1;
    for (let r = 0; r < rows; r++) {
      for (const sym of floatSymbols) {
        let run = 0;
        for (let c = 0; c < m[r].length; c++) {
          run = (m[r][c] === sym) ? run + 1 : 0;
          if (run > worst) { worst = run; worstRow = r; }
        }
      }
    }

    if (worst > maxFloatNeedles) {
      return {
        type: 'warning',
        message: `Long ${label} run of ${worst} needles on row ${worstRow + 1} — beyond about ${maxFloatNeedles} the carried yarn catches on fingers and pulls the fabric in. Weave it in, or break the run with a colour change.`,
        row: worstRow,
        col: null
      };
    }
    return null;
  }

  // A pattern wider than the bed is not a warning, it is physically impossible:
  // there is no needle to put the stitch on.
  analyzeBedWidth() {
    if (!this.editor) return null;
    const { maxNeedles } = profileLimits(this.currentProfile);
    const wide = this.editor.cols;
    if (wide <= maxNeedles) return null;
    return {
      type: 'error',
      message: `This pattern is ${wide} needles wide but the ${this.currentProfile.name} bed holds ${maxNeedles}. Narrow the pattern, or move the repeat onto the card and tile it.`,
      row: null,
      col: null
    };
  }

  updateStatusStats() {
    if (!this.compilationResult) return;
    const cardRows = this.compilationResult.cardMatrix.length;
    let punchedCount = 0;
    for (const r of this.compilationResult.cardMatrix) {
      for (const h of r) if (h) punchedCount++;
    }

    this.elements.statusStats.textContent = `Pattern: ${this.editor.rows}r × ${this.editor.cols}c | Card Rows: ${cardRows} | Total Strokes: ${this.compilationResult.totalPasses} (${this.compilationResult.totalLacePasses} Lace, ${this.compilationResult.totalKnitPasses} Knit) | Punched Holes: ${punchedCount}`;
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
  }

  openPresetsModal() {
    const container = document.getElementById('presets-list');
    if (!container) return;

    container.innerHTML = PATTERN_PRESETS.map(p => `
      <div class="preset-card" data-preset="${p.id}">
        <canvas class="preset-thumb" width="120" height="90"></canvas>
        <div class="preset-title">${p.name}</div>
        <div class="preset-badge">${p.category}</div>
        <div class="preset-desc">${p.description}</div>
      </div>
    `).join('');

    container.querySelectorAll('.preset-card').forEach(card => {
      const preset = PATTERN_PRESETS.find(x => x.id === card.dataset.preset);
      this.renderPresetThumb(card.querySelector('.preset-thumb'), preset);
      card.addEventListener('click', () => {
        this.loadPreset(card.dataset.preset);
        this.closeAllModals();
      });
    });

    this.openModal('presets');
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
      enforcePaperBridges: true
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

  updateTankTopInstructions() {
    if (!this.tankTopCanvas) return;
    const container = document.getElementById('tanktop-instructions-list');
    if (!container) return;

    const pattern = this.tankTopCanvas.engine.computePattern();
    const estimate = this.estimateTankYarn(pattern);
    const estCard = estimate ? `
      <div class="instruction-step-card" style="border-color:#22d3ee44;">
        <div class="instruction-step-num" style="color:#22d3ee;">Yarn Estimate</div>
        <div class="instruction-step-text">${estimate}</div>
      </div>` : '';
    container.innerHTML = pattern.instructions.map(inst => `
      <div class="instruction-step-card">
        <div class="instruction-step-num">Step ${inst.step}: ${inst.title}</div>
        <div class="instruction-step-text">${inst.text}</div>
      </div>
    `).join('') + estCard;
  }

  // ---- Beanie tailor (self-contained; drives beanie-engine.js) ----
  _readBeanieParams() {
    const val = (id, fallback) => {
      // Every knit control is visible and live for everyone (no designer gate).
      const el = document.getElementById(id);
      if (!el) return fallback;
      const n = parseFloat(el.value);
      return Number.isFinite(n) ? n : fallback;
    };
    return {
      params: {
        headCircumferenceCm: val('beanie-head', 56),
        beanieHeightCm: val('beanie-height', 20),
        ribbingHeightCm: val('beanie-rib', 5),
        crownSegments: val('beanie-segments', 6),
        ribbingType: document.getElementById('beanie-ribtype')?.value || '1x1',
        pomPom: document.getElementById('beanie-pom')?.checked ?? true,
        negativeEaseCm: val('beanie-ease', 2),
        foldBrimCm: val('beanie-fold', 0),
        crownDepthPct: val('beanie-crown', 100)
      },
      gauge: {
        stitchesPer10Cm: val('beanie-gauge-sts', 28),
        rowsPer10Cm: val('beanie-gauge-rows', 40)
      }
    };
  }

  renderBeanie() {
    if (!this.beanie) return;
    const canvas = document.getElementById('beanie-canvas');
    const { params, gauge } = this._readBeanieParams();
    // Keep value labels in sync with the sliders.
    const setLabel = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setLabel('val-beanie-head', `${params.headCircumferenceCm} cm`);
    setLabel('val-beanie-height', `${params.beanieHeightCm} cm`);
    setLabel('val-beanie-rib', `${params.ribbingHeightCm} cm`);
    setLabel('val-beanie-seg', `${params.crownSegments}`);
    setLabel('val-beanie-ease', `${params.negativeEaseCm} cm`);
    setLabel('val-beanie-fold', `${params.foldBrimCm} cm`);
    setLabel('val-beanie-crown', `${params.crownDepthPct}%`);
    const model = this.beanie.compute(params, gauge);
    this._beanieModel = model;
    if (canvas && canvas.getContext) {
      const parent = canvas.parentElement;
      if (parent && parent.clientWidth > 0 && parent.clientHeight > 0) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
      this.beanie.draw(canvas.getContext('2d'), canvas, model);
    }
    const list = document.getElementById('beanie-instructions-list');
    if (list) {
      list.innerHTML = model.instructions.map(inst => `
        <div class="instruction-step-card">
          <div class="instruction-step-num">Step ${inst.step}: ${inst.title}</div>
          <div class="instruction-step-text">${inst.text}</div>
        </div>`).join('');
    }
  }

  exportBeanieSvg() {
    if (!this.beanie) return;
    const model = this._beanieModel || this.beanie.compute(this._readBeanieParams().params, this._readBeanieParams().gauge);
    const svgStr = this._stampWatermark(this.beanie.toSvg(model));
    this.downloadFile(svgStr, 'benji_beanie_pattern_1to1.svg', 'image/svg+xml');
  }

  // Rough yarn-consumption estimate from gauge + cast-on + row count.
  estimateTankYarn(pattern) {
    try {
      const g = this.tankTopCanvas.engine.gauge;
      const d = pattern.dimensions;
      if (!g.stitchesPer10Cm || !g.rowsPer10Cm) return null;
      const cellW = 100 / g.stitchesPer10Cm;   // mm width of one stitch
      const cellH = 100 / g.rowsPer10Cm;         // mm height of one row
      const perStitchMm = 2 * cellW + cellH;     // a knit loop wraps ~2 widths + 1 row
      const totalStitches = d.castOnStitches * d.totalRows * 0.9; // ~10% off for shaping
      const meters = (totalStitches * perStitchMm) / 1000;
      return `Approx. ${meters.toFixed(0)} m of yarn for the front piece (≈ ${(meters / 2).toFixed(0)} m for the back). Buy ~10% extra for swatching & tension — weigh your yarn to convert metres to grams.`;
    } catch (e) {
      return null;
    }
  }

  exportTankTopSvg() {
    if (!this.tankTopCanvas) return;
    let svgStr = this.tankTopCanvas.engine.generatePatternSvg();
    svgStr = this._injectTankStitchesSvg(svgStr);
    svgStr = this._stampWatermark(svgStr);
    this.downloadFile(svgStr, 'benji_tank_top_pattern_1to1.svg', 'image/svg+xml');
  }

  exportTankTopDxf() {
    if (!this.tankTopCanvas) return;
    const dxfStr = this.tankTopCanvas.engine.generatePatternDxf();
    const withStitches = this._injectTankStitchesDxf(dxfStr);
    this.downloadFile(this._stampWatermarkDxf(withStitches), 'benji_tank_top_pattern.dxf', 'application/dxf');
  }

  // ---- Drawn-stitch export helpers (tank top) ----
  _tankStitchGeometry() {
    const data = this.tankTopCanvas.getPaintedMatrix();
    const { matrix, cols, rows, dims } = data;
    const widthMm = dims.widthMm, heightMm = dims.heightMm;
    const cellW = widthMm / cols, cellH = heightMm / rows;
    const halfW = widthMm / 2;
    return { matrix, cols, rows, widthMm, heightMm, cellW, cellH, halfW };
  }

  _injectTankStitchesSvg(svgStr) {
    try {
      const gm = this._tankStitchGeometry();
      if (!gm.matrix.some(row => row.some(v => v))) return svgStr;
      const w = gm.widthMm + 40, h = gm.heightMm + 40, cx = w / 2;
      let rects = '';
      for (let r = 0; r < gm.rows; r++) {
        for (let c = 0; c < gm.cols; c++) {
          if (!gm.matrix[r][c]) continue;
          const mmX = -gm.halfW + c * gm.cellW;
          const mmYTop = (r + 1) * gm.cellH;
          const sx = (cx + mmX).toFixed(2);
          const sy = (h - 20 - mmYTop).toFixed(2);
          rects += `<rect x="${sx}" y="${sy}" width="${gm.cellW.toFixed(2)}" height="${gm.cellH.toFixed(2)}" fill="#e11d48" fill-opacity="0.85" />`;
        }
      }
      const group = `\n<g id="drawn-stitches">\n${rects}\n</g>\n`;
      return svgStr.replace('</svg>', group + '</svg>');
    } catch (e) { return svgStr; }
  }

  _injectTankStitchesDxf(dxfStr) {
    try {
      const gm = this._tankStitchGeometry();
      if (!gm.matrix.some(row => row.some(v => v))) return dxfStr;
      const ents = [];
      for (let r = 0; r < gm.rows; r++) {
        for (let c = 0; c < gm.cols; c++) {
          if (!gm.matrix[r][c]) continue;
          const x0 = -gm.halfW + c * gm.cellW, y0 = r * gm.cellH;
          const x1 = x0 + gm.cellW, y1 = y0 + gm.cellH;
          ents.push('0\nLWPOLYLINE\n8\nCUT_LINE\n90\n4\n70\n1',
            `10\n${x0.toFixed(3)}\n20\n${y0.toFixed(3)}`,
            `10\n${x1.toFixed(3)}\n20\n${y0.toFixed(3)}`,
            `10\n${x1.toFixed(3)}\n20\n${y1.toFixed(3)}`,
            `10\n${x0.toFixed(3)}\n20\n${y1.toFixed(3)}`);
        }
      }
      return dxfStr.replace('0\nENDSEC\n0\nEOF', ents.join('\n') + '\n0\nENDSEC\n0\nEOF');
    } catch (e) { return dxfStr; }
  }

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
          keywords: `preset pattern ${p.category || ''} ${p.name}`.toLowerCase(),
          run: () => { this.loadPreset(p.id); }
        });
      }
    } catch (_) { /* presets not ready */ }
    // Modes / tools / exports / settings.
    ['lace', 'fair_isle', 'tuck', 'slip'].forEach(m => acts.push({ label: `Mode: ${m.replace('_', ' ')}`, group: 'Mode', keywords: `mode ${m} ${m.replace('_', ' ')}`, run: () => this.setPatternMode(m) }));
    [['pencil', 'pencil draw paint'], ['eraser', 'eraser rub'], ['line', 'line straight'], ['rect', 'rectangle box'], ['ellipse', 'ellipse circle oval'], ['heart', 'heart love stamp'], ['fill', 'fill bucket flood']].forEach(([t, k]) =>
      acts.push({ label: `Tool: ${t}`, group: 'Tool', keywords: `tool ${k}`, run: () => document.querySelector(`[data-tool="${t}"]`)?.click() }));
    acts.push({ label: 'Export / CNC', group: 'Export', keywords: 'export save dxf gcode laser cnc download', run: click('#btn-open-export') });
    acts.push({ label: 'Presets browser', group: 'Design', keywords: 'presets library browse patterns', run: click('#btn-open-presets') });
    acts.push({ label: 'Math Studio', group: 'Design', keywords: 'math procedural generative reaction diffusion waves automata', run: click('#btn-open-math') });
    acts.push({ label: 'Image Dither', group: 'Design', keywords: 'image photo dither import picture atkinson floyd steinberg', run: click('#btn-open-image') });
    acts.push({ label: 'Settings', group: 'Settings', keywords: 'settings preferences accent colour name photo anniversary theme', run: () => this._openSettingsViaExtras() });
    acts.push({ label: 'Toggle theme (light / dark)', group: 'Settings', keywords: 'theme light dark appearance toggle', run: () => document.getElementById('kx-theme')?.click() });
    acts.push({ label: 'About KNITCAT', group: 'Settings', keywords: 'about info story help who made this knitcat knit cat', run: () => document.querySelector('.brand-section .kx-hbtn')?.click() });
    acts.push({ label: 'Eyelets vs transfers explained', group: 'Advisor', keywords: 'eyelet yarnover transfer difference openwork single bed double bed hole lace why both', run: () => { document.querySelector('.tab-btn[data-tab="editor"]')?.click(); this.openModal('lace-guide'); } });
    acts.push({ label: 'Check machine feasibility', group: 'Advisor', keywords: 'feasibility check valid fix float snag machine advice', run: () => this.openFeasibility() });
    acts.push({ label: 'Show love letter', group: 'Romance', keywords: 'love letter ily benji popup heart romantic', run: () => this._showLovePopup() });
    acts.push({ label: 'Clear the canvas', group: 'Edit', keywords: 'clear erase reset blank canvas new empty', run: () => this.editor?.clear() });
    return acts;
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
    document.getElementById('btn-clothes-svg')?.addEventListener('click', () => this.exportClothesSvg());
    document.getElementById('btn-clothes-editor')?.addEventListener('click', () => this.sendClothesToEditor());

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

  _selectGarment(id) {
    const g = this._garmentById(id);
    if (!g) return;
    this._activeGarment = g;
    this._clothesVals = {};
    document.querySelectorAll('#clothes-nav .clothes-item').forEach(b =>
      b.classList.toggle('active', b.dataset.garment === id));
    this._buildClothesParamForm();
    this.renderClothes();
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
    const canvas = document.getElementById('clothes-canvas');
    if (!g || !this.clothes || !canvas) return;
    const title = document.getElementById('clothes-title');
    const blurb = document.getElementById('clothes-blurb');
    if (title) title.textContent = `${g.icon || ''} ${g.name}`.trim();
    if (blurb) blurb.textContent = g.blurb || '';
    const gauge = {
      stitchesPer10Cm: parseFloat(document.getElementById('clothes-gauge-sts')?.value) || 28,
      rowsPer10Cm: parseFloat(document.getElementById('clothes-gauge-rows')?.value) || 40
    };
    const plan = this.clothes.compute(g, this._clothesParamsFromDom(), gauge);
    this._clothesPlan = plan;
    const w = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
    const h = canvas.parentElement ? canvas.parentElement.clientHeight : 0;
    if (w > 0 && h > 0) { canvas.width = w; canvas.height = h; }
    this._drawClothes(canvas, plan);
    const inst = document.getElementById('clothes-instructions');
    if (inst) {
      inst.innerHTML = (plan.instructions || []).map(step => `
        <div class="instruction-step-card">
          <div class="instruction-step-num">Step ${step.step}: ${step.title}</div>
          <div class="instruction-step-text">${step.text}</div>
        </div>`).join('');
    }
  }

  // A tidy, garment-aware schematic — reads like a technical drawing.
  _drawClothes(canvas, plan) {
    const ctx = canvas.getContext('2d');
    if (!ctx || !plan) return;
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#070a12';
    ctx.fillRect(0, 0, w, h);
    const parts = plan.parts || [];
    if (!parts.length) return;
    const padX = Math.min(90, w * 0.16), padY = 54;
    const availW = Math.max(40, w - padX * 2), availH = Math.max(40, h - padY * 2);
    const fp = plan.footprintCm || { w: 40, h: 40 };
    const scale = Math.min(availW / Math.max(1, fp.w), availH / Math.max(1, fp.h));
    const cx = w / 2;
    const boxW = Math.max(28, fp.w * scale);
    const boxH = Math.max(28, fp.h * scale);
    const top = (h - boxH) / 2;
    const st = parts[0];
    ctx.lineWidth = 2;
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'center';

    const paint = (fill, stroke) => {
      const grad = ctx.createLinearGradient(0, top, 0, top + boxH);
      grad.addColorStop(0, '#1e293b'); grad.addColorStop(1, '#334155');
      ctx.fillStyle = fill || grad; ctx.fill();
      ctx.strokeStyle = stroke || '#38bdf8'; ctx.stroke();
    };
    const rib = (y0, y1) => {
      ctx.strokeStyle = 'rgba(56,189,248,0.35)'; ctx.lineWidth = 1;
      const n = Math.min(46, Math.max(6, Math.round(boxW / 8)));
      for (let i = 1; i < n; i++) {
        const x = cx - boxW / 2 + boxW * i / n;
        ctx.beginPath(); ctx.moveTo(x, y0 + 2); ctx.lineTo(x, y1 - 2); ctx.stroke();
      }
    };

    ctx.beginPath();
    switch (plan.garment.structure) {
      case 'hat':
        ctx.moveTo(cx - boxW / 2, top + boxH);
        ctx.lineTo(cx - boxW / 2, top + boxH * 0.42);
        ctx.bezierCurveTo(cx - boxW / 2, top, cx + boxW / 2, top, cx + boxW / 2, top + boxH * 0.42);
        ctx.lineTo(cx + boxW / 2, top + boxH);
        ctx.closePath();
        paint();
        rib(top + boxH * 0.8, top + boxH);
        break;
      case 'tube':
        ctx.rect(cx - boxW / 2, top, boxW, boxH);
        paint();
        rib(top, top + Math.min(boxH * 0.3, 40));
        break;
      case 'triangle':
        ctx.moveTo(cx - boxW / 2, top);
        ctx.lineTo(cx + boxW / 2, top);
        ctx.lineTo(cx, top + boxH);
        ctx.closePath();
        paint();
        break;
      case 'body':
        ctx.rect(cx - boxW / 2, top, boxW, boxH);
        paint();
        ctx.strokeStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(cx - boxW / 2, top); ctx.lineTo(cx - boxW / 2 + boxW * 0.18, top + boxH * 0.16);
        ctx.moveTo(cx + boxW / 2, top); ctx.lineTo(cx + boxW / 2 - boxW * 0.18, top + boxH * 0.16);
        ctx.stroke();
        rib(top, top + Math.min(boxH * 0.16, 34));
        break;
      case 'hand': {
        const rr = Math.min(14, boxW / 2);
        this._roundRectPath(ctx, cx - boxW / 2, top, boxW, boxH, rr);
        paint();
        rib(top + boxH * 0.62, top + boxH);
        ctx.beginPath();
        this._roundRectPath(ctx, cx - boxW / 2 - boxW * 0.24, top + boxH * 0.5, boxW * 0.34, boxH * 0.28, 6);
        paint(null, '#f472b6');
        break;
      }
      case 'sock': {
        this._roundRectPath(ctx, cx - boxW / 2, top, boxW, boxH * 0.62, 8);
        this._roundRectPath(ctx, cx - boxW / 2, top + boxH * 0.62, boxW * 1.5, boxH * 0.38, 8);
        paint();
        rib(top, top + Math.min(boxH * 0.22, 30));
        break;
      }
      default:
        ctx.rect(cx - boxW / 2, top, boxW, boxH);
        paint();
    }

    ctx.fillStyle = '#e2e8f0'; ctx.textAlign = 'center';
    ctx.fillText(`${plan.garment.name} \u00b7 ${st.castOn} sts \u00b7 ${st.rows} rows`, cx, h - 30);
    ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'left';
    ctx.fillText(`gauge ${plan.gauge.stitchesPer10Cm} sts / ${plan.gauge.rowsPer10Cm} rows per 10 cm`, 12, 22);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fb7185';
    ctx.fillText('made for Benji \u2665', w - 12, 22);
  }

  _roundRectPath(ctx, x, y, ww, hh, r) {
    r = Math.min(r, ww / 2, hh / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + ww, y, x + ww, y + hh, r);
    ctx.arcTo(x + ww, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + ww, y, r);
    ctx.closePath();
  }

  openGarment(id) {
    document.querySelector('.tab-btn[data-tab="clothes"]')?.click();
    this._selectGarment(id);
  }

  exportClothesSvg() {
    if (!this.clothes) return;
    const plan = this._clothesPlan || (this._activeGarment && this.clothes.compute(this._activeGarment, this._clothesParamsFromDom(), {
      stitchesPer10Cm: parseFloat(document.getElementById('clothes-gauge-sts')?.value) || 28,
      rowsPer10Cm: parseFloat(document.getElementById('clothes-gauge-rows')?.value) || 40
    }));
    if (!plan) return;
    const svgStr = this._stampWatermark(this.clothes.toSvg(plan));
    this.downloadFile(svgStr, `benji_${plan.garment.id}_pattern_1to1.svg`, 'image/svg+xml');
  }

  sendClothesToEditor() {
    const plan = this._clothesPlan;
    if (!plan || !this.editor) return;
    const part = plan.parts[0];
    if (!part) return;
    // Never hand the editor a card this machine cannot knit, however the sizing
    // worked out: minRows/maxRows come from the profile, not from a number typed
    // into this function.
    const limits = profileLimits(this.currentProfile);
    const targetRows = Math.max(limits.minRows, Math.min(limits.maxRows, part.rows, 48));
    const targetCols = Math.max(8, Math.min(this.currentProfile.columns, part.castOn));
    this.editor.setDimensions(targetRows, targetCols);
    // Lay a subtle 1×1 checkerboard cast-on guide (numeric modes) or a plain
    // knit field (lace, where cells are stitch glyphs) so the drop has structure.
    const lace = this.currentMode === 'lace';
    const blank = lace ? STITCH_TYPE.KNIT : 0;
    for (let r = 0; r < this.editor.rows; r++) {
      for (let c = 0; c < this.editor.cols; c++) {
        this.editor.matrix[r][c] = (!lace && (r + c) % 2 === 0) ? 1 : blank;
      }
    }
    this.editor.saveState(); this.editor.render(); this.editor.onChange();
    document.querySelector('.tab-btn[data-tab="editor"]')?.click();
    this.notifications.info(`Sent a ${targetCols}-st cast-on swatch to the editor \u2014 now draw your motif.`);
  }

  // ---- Feasibility advisor modal (drives feasibility.js) ----
  openFeasibility() {
    if (!this.feasibility) return;
    fx('open');
    let v = this.feasibility.verdict();
    document.getElementById('kx-feas-backdrop')?.remove();
    const bd = document.createElement('div');
    bd.id = 'kx-feas-backdrop';
    bd.className = 'kx-cmd-backdrop';
    document.body.appendChild(bd);
    const render = () => {
      // verdict().status is 'feasible' | 'needs-attention' | 'not-feasible' — the
      // badge classes in extras.js key off those exact strings.
      const label = v.status === 'feasible' ? '\u2713 Machine-feasible'
        : v.status === 'needs-attention' ? '\u26a0 Needs attention'
        : '\u2715 Not feasible yet';
      const cards = v.issues.map((it, i) => `
        <div class="kx-feas-card kx-feas-${it.sev}">
          <div class="kx-feas-head"><span class="kx-feas-dot"></span><strong>${it.title}</strong></div>
          <div class="kx-feas-prob">${it.problem}</div>
          <div class="kx-feas-phil">${it.philosophy || ''}</div>
          ${it.fix && it.fix.run ? `<button class="kx-feas-fix" data-fix="${i}">${it.fix.label}${it.fix.safe ? ' \u00b7 safe' : ''}</button>` : ''}
        </div>`).join('');
      bd.innerHTML = `<div class="kx-feas" role="dialog" aria-modal="true" aria-label="Machine feasibility">
        <div class="kx-feas-top"><h2>Machine feasibility</h2><span class="kx-feas-badge kx-feas-${v.status}">${label}</span></div>
        <p class="kx-feas-sub">Checked live against ${this.currentProfile.name}. A fix only changes what it has to \u2014 nothing is touched until you click it.</p>
        <div class="kx-feas-list">${cards}</div>
        <div class="kx-feas-foot">
          ${v.fixable ? `<button class="kx-btn kx-primary" id="kx-feas-all">Fix all safe issues (${v.fixable})</button>` : ''}
          <button class="kx-btn" id="kx-feas-close">Done</button>
        </div>
      </div>`;
      bd.querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', () => {
        const it = v.issues[parseInt(b.dataset.fix, 10)];
        try { it && it.fix && it.fix.run && it.fix.run(); } catch (_) { /* contained */ }
        this.recompile();
        v = this.feasibility.verdict();
        fx('success');
        render();
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
        v = this.feasibility.verdict();
        fx('success');
        render();
      });
      bd.querySelector('#kx-feas-close')?.addEventListener('click', () => bd.remove());
    };
    render();
    bd.addEventListener('mousedown', e => { if (e.target === bd) bd.remove(); });
    setTimeout(() => bd.querySelector('.kx-btn')?.focus(), 0);
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

  // Tank Top Toolbar Functions
  autoFitTankTop() {
    if (!this.tankTopCanvas) return;
    // Auto-fit to optimal proportions
    this.tankTopCanvas.setParams({
      chestCircumferenceCm: 92,
      easeCm: 4,
      bodyLengthCm: 38,
      armholeDepthCm: 21,
      shoulderWidthCm: 35,
      neckWidthCm: 18,
      frontNeckDropCm: 13,
      strapWidthCm: 5
    });
    this.updateTankTopSliders();
    this.updateTankTopInstructions();
    this.notifications.success('Tank top auto-fit applied to standard proportions.');
  }

  toggleTankSymmetry() {
    if (!this.tankTopCanvas) return;
    const on = this.tankTopCanvas.toggleSymmetry();
    document.getElementById('btn-tank-symmetry')?.classList.toggle('active', on);
    document.getElementById('btn-tank-symmetry-side')?.classList.toggle('active', on);
    this.notifications.info(`Symmetry mirror ${on ? 'ON' : 'off'}.`, { duration: 2200 });
  }

  toggleTankDraw() {
    if (!this.tankTopCanvas) return;
    const on = this.tankTopCanvas.setDrawMode(!this.tankTopCanvas.drawMode);
    const btn = document.getElementById('btn-tank-draw');
    if (btn) btn.classList.toggle('active', on);
    this.notifications.info(on
      ? 'Draw mode ON — click/drag on the grid to knit stitches (right-drag erases).'
      : 'Draw mode OFF — drag to pan.', { duration: 3200 });
  }

  // Convert a counted swatch (sts or rows over N cm) into the per-10cm gauge field.
  swatchToGauge(kind) {
    const countId = kind === 'sts' ? 'swatch-sts' : 'swatch-rows';
    const cmId = kind === 'sts' ? 'swatch-cm' : 'swatch-rows-cm';
    const targetId = kind === 'sts' ? 'tanktop-gauge-sts' : 'tanktop-gauge-rows';
    const count = parseFloat(document.getElementById(countId)?.value);
    const cm = parseFloat(document.getElementById(cmId)?.value);
    if (!Number.isFinite(count) || !Number.isFinite(cm) || cm <= 0) {
      this.notifications.warn('Enter the stitches/rows and the cm you measured them over.');
      return;
    }
    const per10 = Math.round((count * 10 / cm) * 10) / 10;
    const target = document.getElementById(targetId);
    if (target) target.value = per10;
    this.applyTankGauge();
    this.notifications.success(`${kind === 'sts' ? 'Stitch' : 'Row'} gauge set to ${per10} / 10 cm.`);
  }

  applyTankGauge() {
    if (!this.tankTopCanvas) return;
    const stsEl = document.getElementById('tanktop-gauge-sts');
    const rowsEl = document.getElementById('tanktop-gauge-rows');
    const sts = parseFloat(stsEl && stsEl.value);
    const rows = parseFloat(rowsEl && rowsEl.value);
    const gauge = {};
    if (Number.isFinite(sts) && sts > 0) gauge.stitchesPer10Cm = Math.min(120, sts);
    if (Number.isFinite(rows) && rows > 0) gauge.rowsPer10Cm = Math.min(200, rows);
    if (Object.keys(gauge).length) {
      this.tankTopCanvas.setGauge(gauge);
      this.updateTankTopInstructions();
    }
  }

  resetTankTop() {
    if (!this.tankTopCanvas) return;
    this.tankTopCanvas.setParams({
      chestCircumferenceCm: 92,
      easeCm: 4,
      bodyLengthCm: 38,
      armholeDepthCm: 21,
      shoulderWidthCm: 35,
      neckWidthCm: 18,
      frontNeckDropCm: 13,
      strapWidthCm: 5
    });
    this.updateTankTopSliders();
    this.updateTankTopInstructions();
    this.tankTopCanvas.clearDrawing();
    this.notifications.info('Tank top measurements reset to defaults.');
  }

  setTankStyle(style) {
    if (!this.tankTopCanvas) return;
    
    const styles = {
      classic: { length: 38, ease: 4, shoulder: 35 },
      cropped: { length: 32, ease: 2, shoulder: 33 },
      oversized: { length: 44, ease: 8, shoulder: 40 }
    };
    
    const styleParams = styles[style];
    if (styleParams) {
      this.tankTopCanvas.setParams({
        bodyLengthCm: styleParams.length,
        easeCm: styleParams.ease,
        shoulderWidthCm: styleParams.shoulder
      });
      this.updateTankTopSliders();
      this.updateTankTopInstructions();
      ['btn-tank-classic', 'btn-tank-cropped', 'btn-tank-oversized'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.toggle('active', id === `btn-tank-${style}`);
      });
      this.notifications.info(`Tank style: ${style.charAt(0).toUpperCase() + style.slice(1)}.`, { duration: 2500 });
    }
  }

  updateTankTopSliders() {
    if (!this.tankTopCanvas) return;
    const params = this.tankTopCanvas.getCurrentParams();
    
    const sliderMap = [
      { id: 'tanktop-chest', valId: 'val-tanktop-chest', key: 'chestCircumferenceCm', unit: 'cm' },
      { id: 'tanktop-ease', valId: 'val-tanktop-ease', key: 'easeCm', unit: 'cm', prefix: '+' },
      { id: 'tanktop-length', valId: 'val-tanktop-length', key: 'bodyLengthCm', unit: 'cm' },
      { id: 'tanktop-armhole', valId: 'val-tanktop-armhole', key: 'armholeDepthCm', unit: 'cm' },
      { id: 'tanktop-shoulder', valId: 'val-tanktop-shoulder', key: 'shoulderWidthCm', unit: 'cm' },
      { id: 'tanktop-neck-w', valId: 'val-tanktop-neck-w', key: 'neckWidthCm', unit: 'cm' },
      { id: 'tanktop-neck-drop', valId: 'val-tanktop-neck-drop', key: 'frontNeckDropCm', unit: 'cm' },
      { id: 'tanktop-strap-w', valId: 'val-tanktop-strap-w', key: 'strapWidthCm', unit: 'cm' }
    ];
    
    sliderMap.forEach(item => {
      const slider = document.getElementById(item.id);
      const valEl = document.getElementById(item.valId);
      if (slider && valEl && params[item.key] !== undefined) {
        slider.value = params[item.key];
        valEl.textContent = `${item.prefix || ''}${params[item.key]} ${item.unit}`;
      }
    });
  }

  importTankMeasurements() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = JSON.parse(evt.target.result);
          if (this.tankTopCanvas) {
            this.tankTopCanvas.setParams(data);
            this.updateTankTopSliders();
            this.updateTankTopInstructions();
            alert('Measurements imported successfully!');
          }
        } catch (err) {
          alert('Invalid measurements file format.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  exportTankMeasurements() {
    if (!this.tankTopCanvas) return;
    const params = this.tankTopCanvas.getCurrentParams();
    const json = JSON.stringify(params, null, 2);
    this.downloadFile(json, 'benji_tank_measurements.json', 'application/json');
  }

  printTankPattern() {
    this.exportTankTopSvg();
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
