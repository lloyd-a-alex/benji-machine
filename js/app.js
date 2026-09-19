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

  /**
   * Benji Love Popup — shown once on startup.
   * Creates a cascade of falling heart emoji particles and wires the close button.
   * Not annoying: single auto-dismiss option + manual close button.
   */
  _showLovePopup() {
    const popup = document.getElementById('benji-love-popup');
    const closeBtn = document.getElementById('love-popup-close');
    const heartsRain = document.getElementById('love-hearts-rain');
    if (!popup) return;

    // Create falling heart particles
    const HEARTS = ['💗', '💖', '💓', '💕', '♥', '🌸', '✨', '💝'];
    const COUNT = 28;
    for (let i = 0; i < COUNT; i++) {
      const h = document.createElement('span');
      h.className = 'heart-particle';
      h.textContent = HEARTS[Math.floor(Math.random() * HEARTS.length)];
      h.style.left = `${Math.random() * 100}%`;
      h.style.fontSize = `${14 + Math.random() * 18}px`;
      h.style.animationDuration = `${3.5 + Math.random() * 5}s`;
      h.style.animationDelay = `${Math.random() * 4}s`;
      h.style.opacity = `${0.5 + Math.random() * 0.5}`;
      if (heartsRain) heartsRain.appendChild(h);
    }

    const dismiss = () => {
      popup.classList.add('hidden');
      popup.addEventListener('animationend', () => {
        popup.style.display = 'none';
      }, { once: true });
    };

    // Close button
    closeBtn?.addEventListener('click', dismiss);

    // Also close if user clicks the backdrop (outside the card)
    popup.addEventListener('click', (e) => {
      if (e.target === popup || (e.target && e.target.classList.contains('love-popup-content'))) {
        dismiss();
      }
    });
  }
}


// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new KnitApp();
});
