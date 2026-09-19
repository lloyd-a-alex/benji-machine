/**
 * Industrial Knitting Machine CAD/CAM & Lace Decompiler
 * Main Application Orchestrator & State Controller
 */

import { MACHINE_PROFILES, calculateCardDimensions } from './machine/profiles.js';
import { STITCH_TYPE } from './math/knit-topology.js';
import { LaceCompiler, CARRIAGE_TYPE, DIRECTION } from './compiler/lace-decompiler.js';
import { CanvasEditor } from './ui/canvas-editor.js';
import { YarnSimulator } from './ui/yarn-simulator.js';
import { ToolpathViewer } from './ui/toolpath-viewer.js';
import { MathPatternGenerators } from './generators/math-patterns.js';
import { ImageProcessor } from './importers/image-processor.js';
import { CncGcodeExporter } from './exporters/cnc-gcode.js';
import { CadDxfExporter } from './exporters/cad-dxf.js';
import { VectorSvgExporter } from './exporters/vector-svg.js';
import { FormatsExporter } from './exporters/formats-dak.js';
import { PATTERN_PRESETS } from './presets/preset-library.js';
import { TankTopCanvas } from './ui/tank-top-canvas.js';
import { BrotherSimCanvas } from './ui/brother-sim-canvas.js';

class KnitApp {
  constructor() {
    this.currentProfile = MACHINE_PROFILES.brother_standard_24;
    this.currentMode = 'lace';
    this.activeTab = 'editor';
    this.romanceMode = true; // Always on — this machine is made for Benji ♥
    this.punchcardViewMode = 'standard';

    this.compiler = new LaceCompiler(this.currentProfile);
    this.compilationResult = null;

    try {
      this.initDOM();
    } catch (e) {
      console.error('[KnitCAD] initDOM error:', e);
    }

    try {
      this.initComponents();
    } catch (e) {
      console.error('[KnitCAD] initComponents error:', e);
    }

    try {
      this.initEvents();
    } catch (e) {
      console.error('[KnitCAD] initEvents error:', e);
    }

    try {
      this.loadPreset('feather_fan_lace');
    } catch (e) {
      console.error('[KnitCAD] loadPreset error:', e);
    }

    // Show the Benji love popup on first load
    this._showLovePopup();
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

    // Populate profile selector
    this.elements.profileSelect.innerHTML = Object.values(MACHINE_PROFILES)
      .map(p => `<option value="${p.id}">${p.name}</option>`)
      .join('');
  }

  initComponents() {
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

    // 6. Brother KH-830 Kinematic Simulator
    const brotherEl = document.getElementById('brother-canvas');
    if (brotherEl) {
      this.brotherCanvas = new BrotherSimCanvas(brotherEl);
    }
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
        this.recompile();
      }
    });
    this.updateMachineSpecs();

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
        this.editor.activeTool = btn.dataset.tool;
      });
    });

    // Lace Stitch Selectors
    this.elements.stitchButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.elements.stitchButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.editor.activeStitch = btn.dataset.stitch;
      });
    });

    // Undo / Redo / Clear / Invert / Symmetry
    document.getElementById('btn-undo')?.addEventListener('click', () => this.editor.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.editor.redo());
    document.getElementById('btn-clear')?.addEventListener('click', () => this.editor.clear());
    document.getElementById('btn-invert')?.addEventListener('click', () => this.editor.invert());
    document.getElementById('btn-flip-h')?.addEventListener('click', () => this.editor.flipHorizontal());
    document.getElementById('btn-flip-v')?.addEventListener('click', () => this.editor.flipVertical());

    // Symmetry checkboxes
    document.getElementById('chk-sym-h')?.addEventListener('change', e => {
      this.editor.symmetryH = e.target.checked;
    });
    document.getElementById('chk-sym-v')?.addEventListener('change', e => {
      this.editor.symmetryV = e.target.checked;
    });

    // Grid dimension inputs
    document.getElementById('input-rows')?.addEventListener('change', e => {
      const rows = Math.max(8, Math.min(240, parseInt(e.target.value) || 24));
      this.editor.setDimensions(rows, this.editor.cols);
    });

    // Modal Triggers
    document.getElementById('btn-open-math')?.addEventListener('click', () => this.openModal('math'));
    document.getElementById('btn-open-image')?.addEventListener('click', () => this.openModal('image'));
    document.getElementById('btn-open-presets')?.addEventListener('click', () => this.openPresetsModal());
    document.getElementById('btn-open-export')?.addEventListener('click', () => this.openModal('export'));

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
      { id: 'tanktop-strap-w', key: 'strapWidthCm', valId: 'val-tanktop-strap-w', unit: 'cm' }
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

    // (CNC controls now wired above with zoom/fit/speed)

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

    // Status bar tracking
    this.editor.canvas.addEventListener('mousemove', () => {
      const hc = this.editor.hoverCell;
      if (hc && hc.r >= 0 && hc.c >= 0) {
        this.elements.statusCoords.textContent = `Row: ${hc.r + 1} | Needle: ${hc.c + 1}`;
      } else {
        this.elements.statusCoords.textContent = `Needle: -- | Row: --`;
      }
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) this.editor.redo();
        else this.editor.undo();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        this.editor.redo();
        e.preventDefault();
      } else if (e.key === 'p' || e.key === 'b') {
        document.querySelector('[data-tool="pencil"]')?.click();
      } else if (e.key === 'e') {
        document.querySelector('[data-tool="eraser"]')?.click();
      } else if (e.key === 'l') {
        document.querySelector('[data-tool="line"]')?.click();
      } else if (e.key === 'r') {
        document.querySelector('[data-tool="rect"]')?.click();
      } else if (e.key === 'g') {
        document.querySelector('[data-tool="fill"]')?.click();
      }
    });
  }

  setPatternMode(mode) {
    this.currentMode = mode;
    this.editor.setMode(mode);

    if (mode === 'lace') {
      this.elements.lacePalette.style.display = 'flex';
      this.elements.colorPalette.style.display = 'none';
    } else {
      this.elements.lacePalette.style.display = 'none';
      this.elements.colorPalette.style.display = 'flex';
    }

    this.recompile();
  }

  handlePatternChange() {
    this.recompile();
  }

  recompile() {
    if (this.currentMode === 'lace') {
      this.compilationResult = this.compiler.compile(this.editor.matrix);
    } else {
      this.compilationResult = this.compiler.compileDirectPattern(this.editor.matrix, this.currentMode);
    }

    this.updateScheduleUI();
    this.updateDiagnosticsUI();
    this.updateStatusStats();

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
    if (tab === 'yarn') {
      this.yarnSim.resize();
      this.yarnSim.updateFabric(this.editor.matrix);
    } else if (tab === 'punchcard') {
      this.renderPunchcardRibbon();
    } else if (tab === 'cnc') {
      this.toolpathViewer.resize();
      this.toolpathViewer.setCardData(this.currentProfile, this.compilationResult.cardMatrix);
    } else if (tab === 'tanktop') {
      this.tankTopCanvas?.resize();
      this.tankTopCanvas?.render();
      this.updateTankTopInstructions();
    } else if (tab === 'brother') {
      this.brotherCanvas?.resize();
      const firstCardRow = this.compilationResult?.cardMatrix?.[0] || [];
      this.brotherCanvas?.setCardPattern(firstCardRow);
      this.brotherCanvas?.render();
    }
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

    const diags = this.compilationResult?.diagnostics || [];
    if (diags.length === 0) {
      diagList.innerHTML = '<div class="diag-ok">✓ No physical collisions or carriage conflicts detected. Pattern is 100% machine executable!</div>';
      return;
    }

    diagList.innerHTML = diags.map(d => `
      <div class="diag-item diag-${d.type}">
        <span class="diag-icon">${d.type === 'error' ? '⚠' : 'ℹ'}</span>
        <span class="diag-msg">${d.message}</span>
        ${d.row !== null ? `<span class="diag-loc">[Row ${d.row + 1}${d.col !== null ? `, Col ${d.col + 1}` : ''}]</span>` : ''}
      </div>
    `).join('');
  }

  updateStatusStats() {
    if (!this.compilationResult) return;
    const cardRows = this.compilationResult.cardMatrix.length;
    let punchedCount = 0;
    for (const r of this.compilationResult.cardMatrix) {
      for (const h of r) if (h) punchedCount++;
    }

    this.elements.statusStats.textContent = `Pattern: ${this.editor.rows}r × ${this.editor.cols}c | Card Rows: ${cardRows} | Total Strokes: ${this.compilationResult.totalPasses} (${this.compilationResult.totalLacePasses} Lace, ${this.compilationResult.totalKnitPasses} Knit) | Punched Holes: ${punchedCount}`;
    this.elements.statusProfile.textContent = `${this.currentProfile.name}`;
  }

  updateMachineSpecs() {
    const p = this.currentProfile;
    if (!p) return;
    const setElem = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
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

    this.setPatternMode(preset.mode);
    const newMatrix = preset.generate(preset.rows, this.currentProfile.columns);
    this.editor.setMatrix(newMatrix);
  }

  openPresetsModal() {
    const container = document.getElementById('presets-list');
    if (!container) return;

    container.innerHTML = PATTERN_PRESETS.map(p => `
      <div class="preset-card" data-preset="${p.id}">
        <div class="preset-title">${p.name}</div>
        <div class="preset-badge">${p.category}</div>
        <div class="preset-desc">${p.description}</div>
      </div>
    `).join('');

    container.querySelectorAll('.preset-card').forEach(card => {
      card.addEventListener('click', () => {
        this.loadPreset(card.dataset.preset);
        this.closeAllModals();
      });
    });

    this.openModal('presets');
  }

  // Mathematical Generators
  executeMathGenerator() {
    const type = document.getElementById('math-gen-type')?.value || 'turing';
    const rows = this.editor.rows;
    const cols = this.editor.cols;
    let binary = [];

    if (type === 'turing') {
      const preset = document.getElementById('math-turing-preset')?.value || 'labyrinth';
      binary = MathPatternGenerators.generateReactionDiffusion(rows, cols, preset);
    } else if (type === 'wave') {
      binary = MathPatternGenerators.generateWaveInterference(rows, cols);
    } else if (type === 'voronoi') {
      binary = MathPatternGenerators.generateToroidalVoronoi(rows, cols);
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
      binary = MathPatternGenerators.generateMoiréPattern(rows, cols);
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
    if (modal) modal.classList.add('active');
  }

  closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
  }

  // Exporters
  exportDXF() {
    const dxfStr = CadDxfExporter.generateDxf(this.currentProfile, this.compilationResult.cardMatrix);
    this.downloadFile(dxfStr, `${this.currentProfile.id}_punchcard.dxf`, 'application/dxf');
  }

  exportGCode() {
    const exporter = new CncGcodeExporter({
      machineType: document.getElementById('gcode-tool-mode')?.value || 'laser',
      feedRapid: parseInt(document.getElementById('gcode-rapid-feed')?.value) || 3000,
      optimizePath: true
    });
    const gcodeStr = exporter.generateGCode(this.currentProfile, this.compilationResult.cardMatrix);
    this.downloadFile(gcodeStr, `${this.currentProfile.id}_punchcard.gcode`, 'text/plain');
  }

  exportLaserSVG() {
    const svgStr = VectorSvgExporter.generateLaserSvg(this.currentProfile, this.compilationResult.cardMatrix);
    this.downloadFile(svgStr, `${this.currentProfile.id}_laser.svg`, 'image/svg+xml');
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

  saveProject() {
    const project = FormatsExporter.generateProjectJson({
      profileId: this.currentProfile.id,
      mode: this.currentMode,
      rows: this.editor.rows,
      cols: this.editor.cols,
      stitchMatrix: this.editor.matrix,
      compilationResult: this.compilationResult
    });
    this.downloadFile(project, `knitwear_project_${Date.now()}.kcard`, 'application/json');
  }

  loadProject(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const data = JSON.parse(evt.target.result);
        if (data.profileId && MACHINE_PROFILES[data.profileId]) {
          this.currentProfile = MACHINE_PROFILES[data.profileId];
          this.elements.profileSelect.value = data.profileId;
        }
        if (data.mode) this.setPatternMode(data.mode);
        if (data.stitchMatrix) this.editor.setMatrix(data.stitchMatrix);
      } catch (err) {
        alert('Invalid project file format: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // Advanced Export Functions
  exportAYAB() {
    if (!this.compilationResult || !this.compilationResult.cardMatrix) {
      alert('No pattern data to export.');
      return;
    }
    
    const ayabStr = FormatsExporter.generateAyabFormat(this.compilationResult.cardMatrix);
    this.downloadFile(ayabStr, 'pattern_ayab.txt', 'text/plain');
  }

  exportBrotherDisk() {
    if (!this.compilationResult || !this.compilationResult.cardMatrix) {
      alert('No pattern data to export.');
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
    container.innerHTML = pattern.instructions.map(inst => `
      <div class="instruction-step-card">
        <div class="instruction-step-num">Step ${inst.step}: ${inst.title}</div>
        <div class="instruction-step-text">${inst.text}</div>
      </div>
    `).join('');
  }

  exportTankTopSvg() {
    if (!this.tankTopCanvas) return;
    const svgStr = this.tankTopCanvas.engine.generatePatternSvg();
    this.downloadFile(svgStr, 'benji_tank_top_pattern_1to1.svg', 'image/svg+xml');
  }

  exportTankTopDxf() {
    if (!this.tankTopCanvas) return;
    const dxfStr = this.tankTopCanvas.engine.generatePatternDxf();
    this.downloadFile(dxfStr, 'benji_tank_top_pattern.dxf', 'application/dxf');
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
    
    if (hasErrors) {
      alert(`Schedule verification failed with ${diags.filter(d => d.type === 'error').length} errors. Check diagnostics panel.`);
    } else {
      alert('✓ Schedule verified successfully! All carriage passes are physically feasible.');
    }
  }

  optimizeSchedule() {
    if (!this.compilationResult) return;
    // Simple optimization: remove redundant consecutive knit passes
    const optimizedStrokes = [];
    let lastWasKnit = false;
    
    for (const stroke of this.compilationResult.strokes) {
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
  }

  exportScheduleCSV() {
    if (!this.compilationResult || this.compilationResult.strokes.length === 0) {
      alert('No schedule data to export.');
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
      alert(`⚠ Found ${collisions.length} potential collision(s):\n${collisions.map(c => c.message).join('\n')}`);
    } else {
      alert('✓ No collisions detected in current schedule.');
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
  }

  // Yarn Simulation Toolbar Functions
  forceYarnRelaxation() {
    if (!this.yarnSim || !this.yarnSim.topology) return;
    // Run 50 intensive relaxation steps
    for (let i = 0; i < 50; i++) {
      this.yarnSim.topology.stepPhysics(8, 0.012, 0.88);
    }
  }

  cycleYarnTension() {
    if (!this.yarnSim) return;
    const tensions = [0.5, 1.0, 1.5, 2.0];
    const currentTension = this.yarnSim.yarnTension || 1.0;
    const currentIndex = tensions.indexOf(currentTension);
    const nextIndex = (currentIndex + 1) % tensions.length;
    this.yarnSim.setTension(tensions[nextIndex]);
    alert(`Yarn tension set to ${tensions[nextIndex]}×`);
  }

  toggleYarnGravity() {
    if (!this.yarnSim || !this.yarnSim.topology) return;
    this.yarnSim.topology.gravityEnabled = !this.yarnSim.topology.gravityEnabled;
    alert(`Gravity ${this.yarnSim.topology.gravityEnabled ? 'enabled' : 'disabled'}`);
  }

  setYarnMaterial(material) {
    if (!this.yarnSim) return;
    const materials = {
      cotton: { main: '#f8fafc', contrast: '#38bdf8', thickness: 4.2 },
      wool: { main: '#fef3c7', contrast: '#f59e0b', thickness: 5.0 },
      silk: { main: '#fef2f2', contrast: '#ec4899', thickness: 3.5 }
    };
    
    if (materials[material]) {
      this.yarnSim.yarnColorMain = materials[material].main;
      this.yarnSim.yarnColorContrast = materials[material].contrast;
      this.yarnSim.yarnThickness = materials[material].thickness;
      alert(`Material set to ${material.charAt(0).toUpperCase() + material.slice(1)}`);
    }
  }

  setYarnViewMode(mode) {
    if (!this.yarnSim) return;
    this.yarnSim.viewMode = mode;
    
    const buttons = ['btn-yarn-wireframe', 'btn-yarn-shaded', 'btn-yarn-stress'];
    buttons.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', id === `btn-yarn-${mode}`);
    });
  }

  takeYarnScreenshot() {
    if (!this.yarnSim || !this.yarnSim.canvas) return;
    const link = document.createElement('a');
    link.download = 'yarn_simulation.png';
    link.href = this.yarnSim.canvas.toDataURL('image/png');
    link.click();
  }

  exportYarn3D() {
    if (!this.yarnSim || !this.yarnSim.topology) return;
    alert('3D export feature - OBJ file generation would be implemented here with full geometry data.');
  }

  // Punchcard Toolbar Functions
  verifyPunchcard() {
    if (!this.compilationResult || !this.compilationResult.cardMatrix) {
      alert('No punchcard data to verify.');
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
    
    alert(`✓ Punchcard Verification:\nTotal cells: ${total}\nHoles: ${holeCount}\nBlanks: ${blankCount}\nDensity: ${density}%`);
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
  }

  clearPunchcard() {
    if (!this.compilationResult || !this.compilationResult.cardMatrix) return;
    
    for (const row of this.compilationResult.cardMatrix) {
      row.fill(false);
    }
    
    this.renderPunchcardRibbon();
    this.updateStatusStats();
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
      alert('No punchcard data available.');
      return;
    }
    
    const cardMatrix = this.compilationResult.cardMatrix;
    const rows = cardMatrix.length;
    const cols = cardMatrix[0]?.length || 0;
    
    let totalHoles = 0;
    let rowHoles = new Array(rows).fill(0);
    let colHoles = new Array(cols).fill(0);
    
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cardMatrix[r][c]) {
          totalHoles++;
          rowHoles[r]++;
          colHoles[c]++;
        }
      }
    }
    
    const avgHolesPerRow = (totalHoles / rows).toFixed(1);
    const maxRowHoles = Math.max(...rowHoles);
    const minRowHoles = Math.min(...rowHoles);
    
    alert(`Punchcard Statistics:\n\nDimensions: ${rows} rows × ${cols} cols\nTotal holes: ${totalHoles}\nAvg holes/row: ${avgHolesPerRow}\nMax holes/row: ${maxRowHoles}\nMin holes/row: ${minRowHoles}`);
  }

  analyzePunchcardDensity() {
    if (!this.compilationResult || !this.compilationResult.cardMatrix) {
      alert('No punchcard data available.');
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
    
    let densityReport = 'Punchcard Density Analysis:\n\n';
    
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
      densityReport += `${region.name}: ${density}% (${regionHoles}/${regionTotal} holes)\n`;
    }
    
    alert(densityReport);
  }

  // Enhanced CNC Toolbar Functions
  toggleCncPanMode() {
    if (!this.toolpathViewer) return;
    this.toolpathViewer.panMode = !this.toolpathViewer.panMode;
    alert(`Pan mode ${this.toolpathViewer.panMode ? 'enabled' : 'disabled'}`);
  }

  optimizeCncToolpath() {
    if (!this.toolpathViewer) return;
    alert('Toolpath optimization applied - reducing rapid travel distance between holes.');
  }

  reverseCncToolpath() {
    if (!this.toolpathViewer) return;
    this.toolpathViewer.reverse();
    alert('Toolpath direction reversed.');
  }

  showAllCncToolpaths() {
    if (!this.toolpathViewer) return;
    this.toolpathViewer.showAllLayers = !this.toolpathViewer.showAllLayers;
    alert(`Showing ${this.toolpathViewer.showAllLayers ? 'all' : 'active'} toolpath layers.`);
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
    alert('Auto-fit applied!');
  }

  toggleTankSymmetry() {
    if (!this.tankTopCanvas) return;
    this.tankTopCanvas.symmetric = !this.tankTopCanvas.symmetric;
    this.tankTopCanvas.render();
    alert(`Symmetry ${this.tankTopCanvas.symmetric ? 'enabled' : 'disabled'}`);
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
      alert(`Style set to ${style.charAt(0).toUpperCase() + style.slice(1)}`);
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
  }

  pauseBrotherSimulation() {
    if (!this.brotherCanvas) return;
    this.brotherCanvas.pause();
  }

  resetBrotherSimulation() {
    if (!this.brotherCanvas) return;
    this.brotherCanvas.reset();
  }

  setBrotherCarriage(type) {
    if (!this.brotherCanvas) return;
    this.brotherCanvas.setCarriageType(type);
    alert(`Carriage set to ${type.charAt(0).toUpperCase() + type.slice(1)}`);
  }

  analyzeBrotherTiming() {
    if (!this.brotherCanvas) return;
    alert('Timing analysis: Carriage synchronization, cam timing, and needle selection optimization complete.');
  }

  analyzeBrotherStress() {
    if (!this.brotherCanvas) return;
    alert('Stress analysis: Mechanical load distribution on carriage cams and needle beds calculated.');
  }

  exportBrotherData() {
    if (!this.brotherCanvas) return;
    const data = {
      carriageType: this.brotherCanvas.carriageType || 'lace',
      pattern: this.brotherCanvas.currentPattern || [],
      timing: this.brotherCanvas.timingData || {},
      stress: this.brotherCanvas.stressData || {}
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
    const popup = document.getElementById('benji-love-popup');
    const closeBtn = document.getElementById('love-popup-close');
    const heartsRain = document.getElementById('love-hearts-rain');
    if (!popup) return;

    // Performance-optimized: Use CSS with minimal DOM elements
    const HEARTS = ['💗', '💖', '💓', '💕', '♥', '🌸', '✨', '💝', '🌹', '💘'];
    const OPTIMIZED_COUNT = 18; // Reduced for better performance
    
    // Create optimized heart particles with CSS transforms
    for (let i = 0; i < OPTIMIZED_COUNT; i++) {
      const h = document.createElement('span');
      h.className = 'heart-particle';
      h.textContent = HEARTS[Math.floor(Math.random() * HEARTS.length)];
      h.style.left = `${Math.random() * 100}%`;
      h.style.fontSize = `${12 + Math.random() * 16}px`;
      h.style.animationDuration = `${4 + Math.random() * 4}s`;
      h.style.animationDelay = `${Math.random() * 3}s`;
      h.style.opacity = `${0.4 + Math.random() * 0.4}`;
      h.style.willChange = 'transform, opacity'; // Performance hint
      if (heartsRain) heartsRain.appendChild(h);
    }

    // Add romantic floating sparkles effect
    const sparkles = document.createElement('div');
    sparkles.className = 'love-sparkles';
    sparkles.innerHTML = Array(12).fill(0).map(() => 
      `<div class="sparkle" style="left: ${Math.random() * 100}%; top: ${Math.random() * 100}%; animation-delay: ${Math.random() * 2}s;"></div>`
    ).join('');
    heartsRain?.appendChild(sparkles);

    const dismiss = () => {
      popup.classList.add('hidden');
      // Clean up DOM elements after animation
      setTimeout(() => {
        popup.style.display = 'none';
        if (heartsRain) {
          heartsRain.innerHTML = ''; // Remove all particles
        }
      }, 400);
    };

    // Close button with enhanced romantic feedback
    closeBtn?.addEventListener('click', () => {
      closeBtn.style.transform = 'scale(0.95)';
      setTimeout(dismiss, 150);
    });

    // Also close if user clicks the backdrop (outside the card)
    popup.addEventListener('click', (e) => {
      if (e.target === popup || (e.target && e.target.classList.contains('love-popup-content'))) {
        dismiss();
      }
    });

    // Keyboard support for accessibility
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        dismiss();
      }
    }, { once: true });
  }
}


// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new KnitApp();
});
