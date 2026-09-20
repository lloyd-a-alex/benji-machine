/**
 * Interactive Knitting Pattern Grid Canvas Editor
 * 
 * High-performance 2D Canvas matrix editor featuring:
 * - Sub-pixel panning & smooth zoom
 * - Vectorized knitting glyphs (Standard Japanese & Hand-Knit symbols)
 * - Drawing tools: Pencil, Line (Bresenham), Rect, Circle, Flood Fill (BFS)
 * - Marquee selection, symmetry mirrors, shift, invert
 * - 100-level Undo/Redo history stack
 * - Industrial needle bed ruler & coordinate HUD
 */

import { STITCH_TYPE } from '../math/knit-topology.js';
// One source of truth for what a cell means in each mode. The lace<->numeric
// conversion used to be duplicated here, which risked the editor and the
// clipboard/exports telling different stories about the same chart (see modes.js).
import { convertMatrixBetweenModes, isDirectMode } from '../edit/modes.js';

export class CanvasEditor {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    this.rows = options.rows || 60;
    this.cols = options.cols || 24;
    this.mode = options.mode || 'lace'; // 'lace', 'fair_isle', 'tuck', 'slip'

    // Stitch matrix [row][col]
    this.matrix = [];
    this.initMatrix();

    // History stack for undo/redo
    this.history = [];
    this.historyIndex = -1;
    this.saveState();

    // Viewport transform
    this.zoom = 22; // Pixels per grid cell
    this.panX = 60;
    this.panY = 60;

    // Interaction state
    this.activeTool = 'pencil'; // 'pencil', 'eraser', 'line', 'rect', 'circle', 'fill', 'select', 'pan'
    this.activeStitch = STITCH_TYPE.EYELET; // Current stitch for painting in lace mode
    this.activeColor = 1; // 0 = main yarn A, 1 = contrast yarn B

    this.isMouseDown = false;
    this.isPanning = false;
    this.lastMousePos = { x: 0, y: 0 };
    this.dragStartCell = null;
    this.hoverCell = { r: -1, c: -1 };
    
    // Performance optimization
    this.renderThrottle = 0;
    this.lastRenderTime = 0;

    // Selection
    this.selection = null; // { r1, c1, r2, c2 }
    this.clipboard = null; // { rows, cols, cells[][] } captured for paste

    // Symmetry options
    this.symmetryH = false;
    this.symmetryV = false;

    // Callback on change
    this.onChange = options.onChange || (() => { });

    this.setupEvents();
    this.resizeCanvas();
    this.render();
  }

  initMatrix() {
    this.matrix = [];
    for (let r = 0; r < this.rows; r++) {
      this.matrix[r] = new Array(this.cols).fill(
        this.mode === 'lace' ? STITCH_TYPE.KNIT : 0
      );
    }
  }

  setDimensions(rows, cols) {
    const oldMatrix = this.matrix;
    this.rows = rows;
    this.cols = cols;
    this.matrix = [];

    for (let r = 0; r < rows; r++) {
      this.matrix[r] = [];
      for (let c = 0; c < cols; c++) {
        if (oldMatrix[r] && oldMatrix[r][c] !== undefined) {
          this.matrix[r][c] = oldMatrix[r][c];
        } else {
          this.matrix[r][c] = this.mode === 'lace' ? STITCH_TYPE.KNIT : 0;
        }
      }
    }
    this.saveState();
    this.render();
    this.onChange();
  }

  setMode(newMode) {
    const oldMode = this.mode;
    if (newMode === oldMode) {
      this.render();
      return;
    }
    this.mode = newMode;
    // Convert the cell representation whenever we cross between Lace mode (which
    // stores STITCH_TYPE strings such as 'K'/'O') and the direct-pattern modes
    // (fair_isle / tuck / slip, which store numeric 0/1). Without this the punchcard
    // compiler misreads every leftover 'K' as a punched hole, so a Fair Isle drawing
    // appears as a fully-punched card that hides what you actually drew.
    this.convertMatrixForMode(oldMode, newMode);
    this._normalizeStrayStrings();
    this.selection = null;
    this.saveState();
    this.render();
  }

  static isDirectMode(mode) {
    // Delegate: `isDirectMode` here is the module import, not this method, so no recursion.
    return isDirectMode(mode);
  }

  convertMatrixForMode(oldMode, newMode) {
    this.matrix = CanvasEditor.convertMatrixBetweenModes(oldMode, newMode, this.matrix);
  }

  // Thin delegate to the DOM-free canonical converter in js/edit/modes.js, kept as a
  // static so the lace<->numeric logic stays unit-testable in Node without touching the
  // canvas. `convertMatrixBetweenModes` resolves to the module import, not this method.
  static convertMatrixBetweenModes(oldMode, newMode, matrix) {
    return convertMatrixBetweenModes(oldMode, newMode, matrix);
  }

  _normalizeStrayStrings() {
    const LACE_BLANK = [STITCH_TYPE.KNIT, STITCH_TYPE.EMPTY, STITCH_TYPE.PURL];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v = this.matrix[r][c];
        if (CanvasEditor.isDirectMode(this.mode) && typeof v === 'string') {
          this.matrix[r][c] = LACE_BLANK.includes(v) ? 0 : 1;
        }
      }
    }
  }

  setMatrix(newMatrix) {
    this.rows = newMatrix.length;
    this.cols = newMatrix[0]?.length || 24;
    this.matrix = newMatrix.map(row => [...row]);
    this.saveState();
    this.render();
    this.onChange();
  }

  // History & State Management
  saveState() {
    // Truncate redo states
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }
    const stateCopy = this.matrix.map(row => [...row]);
    this.history.push(stateCopy);
    if (this.history.length > 80) this.history.shift();
    this.historyIndex = this.history.length - 1;
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.matrix = this.history[this.historyIndex].map(row => [...row]);
      // A history entry can carry different dimensions (e.g. a preset with fewer
      // rows was loaded then undone). Resync the bounds or render() walks
      // this.matrix[r] with a stale this.rows and throws.
      this.rows = this.matrix.length;
      this.cols = this.matrix[0]?.length || this.cols;
      this.render();
      this.onChange();
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.matrix = this.history[this.historyIndex].map(row => [...row]);
      this.rows = this.matrix.length;
      this.cols = this.matrix[0]?.length || this.cols;
      this.render();
      this.onChange();
    }
  }

  clear() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.matrix[r][c] = (this.mode === 'lace') ? STITCH_TYPE.KNIT : 0;
      }
    }
    this.saveState();
    this.render();
    this.onChange();
  }

  invert() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.mode === 'lace') {
          this.matrix[r][c] = (this.matrix[r][c] === STITCH_TYPE.KNIT) ? STITCH_TYPE.EYELET : STITCH_TYPE.KNIT;
        } else {
          this.matrix[r][c] = this.matrix[r][c] === 1 ? 0 : 1;
        }
      }
    }
    this.saveState();
    this.render();
    this.onChange();
  }

  flipHorizontal() {
    for (let r = 0; r < this.rows; r++) {
      this.matrix[r].reverse();
      if (this.mode === 'lace') {
        // Invert directional transfers when horizontally flipped
        for (let c = 0; c < this.cols; c++) {
          if (this.matrix[r][c] === STITCH_TYPE.TRANSFER_LEFT) {
            this.matrix[r][c] = STITCH_TYPE.TRANSFER_RIGHT;
          } else if (this.matrix[r][c] === STITCH_TYPE.TRANSFER_RIGHT) {
            this.matrix[r][c] = STITCH_TYPE.TRANSFER_LEFT;
          }
        }
      }
    }
    this.selection = null; // a flip is a one-time op: don't leave a stale marquee
    this.saveState();
    this.render();
    this.onChange();
  }

  flipVertical() {
    this.matrix.reverse();
    this.selection = null; // a flip is a one-time op: don't leave a stale marquee
    this.saveState();
    this.render();
    this.onChange();
  }

  shift(deltaR, deltaC) {
    const newMatrix = [];
    for (let r = 0; r < this.rows; r++) {
      newMatrix[r] = [];
      const srcR = (r - deltaR + this.rows * 10) % this.rows;
      for (let c = 0; c < this.cols; c++) {
        const srcC = (c - deltaC + this.cols * 10) % this.cols;
        newMatrix[r][c] = this.matrix[srcR][srcC];
      }
    }
    this.matrix = newMatrix;
    this.saveState();
    this.render();
    this.onChange();
  }

  // ---- Selection operations (copy / cut / paste / delete / rotate) ----
  // All are bounds-clamped and no-op safely when nothing is selected, so they can
  // never corrupt cells outside the marquee or throw on empty selections.
  getSelectionBounds() {
    if (!this.selection) return null;
    const s = this.selection;
    const r1 = Math.max(0, Math.min(s.r1, s.r2));
    const r2 = Math.min(this.rows - 1, Math.max(s.r1, s.r2));
    const c1 = Math.max(0, Math.min(s.c1, s.c2));
    const c2 = Math.min(this.cols - 1, Math.max(s.c1, s.c2));
    if (r1 > r2 || c1 > c2) return null;
    return { r1, r2, c1, c2 };
  }

  copySelection() {
    const b = this.getSelectionBounds();
    if (!b) { this.clipboard = null; return false; }
    const cells = [];
    for (let r = b.r1; r <= b.r2; r++) {
      const row = [];
      for (let c = b.c1; c <= b.c2; c++) row.push(this.matrix[r][c]);
      cells.push(row);
    }
    this.clipboard = { rows: cells.length, cols: cells[0].length, cells };
    return true;
  }

  deleteSelection() {
    const b = this.getSelectionBounds();
    if (!b) return false;
    const erase = this.getEraseValue();
    for (let r = b.r1; r <= b.r2; r++)
      for (let c = b.c1; c <= b.c2; c++) this.matrix[r][c] = erase;
    this.saveState(); this.render(); this.onChange();
    return true;
  }

  cutSelection() {
    const ok = this.copySelection();
    if (ok) this.deleteSelection();
    return ok;
  }

  // Paste at the current selection origin, else at the hovered cell, else top-left.
  pasteClipboard() {
    if (!this.clipboard) return false;
    let anchorR = 0, anchorC = 0;
    const b = this.getSelectionBounds();
    if (b) { anchorR = b.r1; anchorC = b.c1; }
    else if (this.hoverCell && this.hoverCell.r >= 0) { anchorR = this.hoverCell.r; anchorC = this.hoverCell.c; }

    for (let r = 0; r < this.clipboard.rows; r++) {
      for (let c = 0; c < this.clipboard.cols; c++) {
        const tr = anchorR + r, tc = anchorC + c;
        if (tr >= 0 && tr < this.rows && tc >= 0 && tc < this.cols) {
          this.matrix[tr][tc] = this.clipboard.cells[r][c];
        }
      }
    }
    // Move the marquee to cover the pasted block.
    this.selection = {
      r1: anchorR, c1: anchorC,
      r2: Math.min(this.rows - 1, anchorR + this.clipboard.rows - 1),
      c2: Math.min(this.cols - 1, anchorC + this.clipboard.cols - 1)
    };
    this.saveState(); this.render(); this.onChange();
    return true;
  }

  // Rotate the selected (or whole-grid) block 90 degrees. dir: 'cw' | 'ccw'.
  // The rotated block is written back from the same top-left origin and clipped
  // to the canvas, so a rotation can never overflow or throw.
  rotateSelection(dir = 'cw') {
    const b = this.getSelectionBounds() || { r1: 0, c1: 0, r2: this.rows - 1, c2: this.cols - 1 };
    const h = b.r2 - b.r1 + 1;
    const w = b.c2 - b.c1 + 1;
    const src = [];
    for (let r = 0; r < h; r++) {
      const row = [];
      for (let c = 0; c < w; c++) row.push(this.matrix[b.r1 + r][b.c1 + c]);
      src.push(row);
    }
    const blank = this.getEraseValue();
    // Destination is w tall x h wide.
    for (let dr = 0; dr < w; dr++) {
      for (let dc = 0; dc < h; dc++) {
        let sr, sc;
        if (dir === 'cw') { sr = h - 1 - dc; sc = dr; }      // (sr,sc) -> (sc, h-1-sr)
        else { sr = dc; sc = w - 1 - dr; }                    // ccw
        const tr = b.r1 + dr, tc = b.c1 + dc;
        if (tr >= 0 && tr < this.rows && tc >= 0 && tc < this.cols) {
          this.matrix[tr][tc] = (src[sr] && src[sr][sc] !== undefined) ? src[sr][sc] : blank;
        }
      }
    }
    this.selection = {
      r1: b.r1, c1: b.c1,
      r2: Math.min(this.rows - 1, b.r1 + w - 1),
      c2: Math.min(this.cols - 1, b.c1 + h - 1)
    };
    this.saveState(); this.render(); this.onChange();
    return true;
  }

  setActiveTool(tool) {
    this.activeTool = tool;
    
    // Update UI button states
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.tool === tool) {
        btn.classList.add('active');
      }
    });
    
    // Update cursor
    if (tool === 'pan') {
      this.canvas.style.cursor = 'grab';
    } else {
      this.canvas.style.cursor = 'crosshair';
    }
  }

  fitToView() {
    const rect = this.canvas.getBoundingClientRect();
    const availableWidth = rect.width - 40;
    const availableHeight = rect.height - 40;
    
    // Calculate optimal zoom to fit the grid
    const zoomX = availableWidth / this.cols;
    const zoomY = availableHeight / this.rows;
    this.zoom = Math.min(zoomX, zoomY);
    
    // Center the grid
    this.panX = (rect.width - this.cols * this.zoom) / 2;
    this.panY = (rect.height - this.rows * this.zoom) / 2;
    
    this.render();
  }

  throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // Coordinate transforms
  screenToCell(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = screenX - rect.left - this.panX;
    const y = screenY - rect.top - this.panY;

    const col = Math.floor(x / this.zoom);
    // In knitting, row 0 is at the bottom (cast-on), increasing upwards
    const row = this.rows - 1 - Math.floor(y / this.zoom);

    return { r: row, c: col };
  }

  cellToScreen(r, c) {
    const screenX = this.panX + c * this.zoom;
    const screenY = this.panY + (this.rows - 1 - r) * this.zoom;
    return { x: screenX, y: screenY };
  }

  // Mouse, touch & pen handlers — Pointer Events so every input device works.
  setupEvents() {
    const canvas = this.canvas;

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Performance optimization: throttled rendering
    this.throttledRender = this.throttle(() => this.render(), 16); // ~60fps max

    // Live pointers over the canvas, for pinch-zoom / two-finger pan.
    this._pointers = new Map();
    this._pinch = null;

    canvas.addEventListener('pointerdown', e => {
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size >= 2) {
        this._beginPinch();
        return;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* window listeners still cover it */ }

      const cell = this.screenToCell(e.clientX, e.clientY);
      this.lastMousePos = { x: e.clientX, y: e.clientY };

      if (e.button === 1 || e.altKey || this.activeTool === 'pan' || (e.button === 0 && e.shiftKey)) {
        // Pan tool
        this.isPanning = true;
        canvas.style.cursor = 'grabbing';
        return;
      }

      this.isMouseDown = true;
      this.dragStartCell = cell;

      if (e.button === 2) {
        // Right click: Erase
        this.applyStitchAt(cell.r, cell.c, this.getEraseValue());
      } else if (this.activeTool === 'pencil') {
        this.applyStitchAt(cell.r, cell.c, this.getActiveDrawValue());
      } else if (this.activeTool === 'eraser') {
        this.applyStitchAt(cell.r, cell.c, this.getEraseValue());
      } else if (this.activeTool === 'heart') {
        this.stampHeartAt(cell.r, cell.c, this.getActiveDrawValue());
      } else if (this.activeTool === 'fill') {
        this.floodFill(cell.r, cell.c, this.getActiveDrawValue());
      }
      this.render();
    });

    window.addEventListener('pointermove', e => {
      if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pinch) {
        this._updatePinch();
        return;
      }
      const cell = this.screenToCell(e.clientX, e.clientY);
      this.hoverCell = cell;

      if (this.isPanning) {
        this.panX += e.clientX - this.lastMousePos.x;
        this.panY += e.clientY - this.lastMousePos.y;
        this.lastMousePos = { x: e.clientX, y: e.clientY };
        this.render();
        return;
      }

      if (this.isMouseDown) {
        if (this.activeTool === 'pencil') {
          const val = (e.buttons === 2) ? this.getEraseValue() : this.getActiveDrawValue();
          this.applyStitchAt(cell.r, cell.c, val);
          this.render();
        } else if (this.activeTool === 'eraser') {
          this.applyStitchAt(cell.r, cell.c, this.getEraseValue());
          this.render();
        } else if (['line', 'rect', 'rectOutline', 'circle', 'circleOutline', 'select'].includes(this.activeTool)) {
          // Preview geometry during drag
          this.render();
        }
      } else {
        this.throttledRender();
      }
    });

    const endStroke = e => {
      this._pointers.delete(e.pointerId);
      if (this._pinch && this._pointers.size < 2) {
        this._pinch = null;
        canvas.style.cursor = 'crosshair';
      }
      if (this.isPanning) {
        this.isPanning = false;
        canvas.style.cursor = 'crosshair';
        return;
      }

      if (this.isMouseDown) {
        this.isMouseDown = false;
        const cell = this.screenToCell(e.clientX, e.clientY);

        if (this.dragStartCell) {
          const val = (e.button === 2) ? this.getEraseValue() : this.getActiveDrawValue();

          if (this.activeTool === 'line') {
            this.drawLine(this.dragStartCell.r, this.dragStartCell.c, cell.r, cell.c, val);
          } else if (this.activeTool === 'rect') {
            this.drawRect(this.dragStartCell.r, this.dragStartCell.c, cell.r, cell.c, val);
          } else if (this.activeTool === 'rectOutline') {
            this.drawRectOutline(this.dragStartCell.r, this.dragStartCell.c, cell.r, cell.c, val);
          } else if (this.activeTool === 'circle') {
            this.drawCircle(this.dragStartCell.r, this.dragStartCell.c, cell.r, cell.c, val);
          } else if (this.activeTool === 'circleOutline') {
            this.drawEllipseOutline(this.dragStartCell.r, this.dragStartCell.c, cell.r, cell.c, val);
          } else if (this.activeTool === 'select') {
            this.selection = {
              r1: Math.min(this.dragStartCell.r, cell.r),
              c1: Math.min(this.dragStartCell.c, cell.c),
              r2: Math.max(this.dragStartCell.r, cell.r),
              c2: Math.max(this.dragStartCell.c, cell.c)
            };
          }
        }

        this.dragStartCell = null;
        this.saveState();
        this.render();
        this.onChange();
      }
    };
    window.addEventListener('pointerup', endStroke);
    window.addEventListener('pointercancel', endStroke);

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.88;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const newZoom = Math.max(8, Math.min(70, this.zoom * zoomFactor));
      // Zoom centered at mouse position
      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;

      this.render();
    });

    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.render();
    });
  }

  /** Two fingers down: drop any stroke and switch to navigating. */
  _beginPinch() {
    this.isMouseDown = false;
    this.isPanning = false;
    this.dragStartCell = null;
    const [a, b] = [...this._pointers.values()];
    this._pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    };
    this.canvas.style.cursor = 'grabbing';
  }

  /** Pinch distance → zoom about the midpoint; midpoint drift → pan. */
  _updatePinch() {
    const pts = [...this._pointers.values()];
    if (pts.length < 2 || !this._pinch) return;
    const [a, b] = pts;
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rect = this.canvas.getBoundingClientRect();
    const px = mid.x - rect.left;
    const py = mid.y - rect.top;

    this.panX += mid.x - this._pinch.mid.x;
    this.panY += mid.y - this._pinch.mid.y;

    const newZoom = Math.max(8, Math.min(70, this.zoom * (dist / this._pinch.dist)));
    this.panX = px - (px - this.panX) * (newZoom / this.zoom);
    this.panY = py - (py - this.panY) * (newZoom / this.zoom);
    this.zoom = newZoom;

    this._pinch = { dist, mid };
    this.render();
  }

  resizeCanvas() {
    const parent = this.canvas.parentElement;
    // Skip while hidden (0×0) — otherwise the CSS 100% scaling stretches a
    // stale fallback buffer across the panel (e.g. on first tab switch).
    if (parent && parent.clientWidth > 0 && parent.clientHeight > 0) {
      // Back the canvas with `devicePixelRatio` device pixels per CSS pixel so lines
      // and Japanese glyphs stay crisp on hi-DPI screens. The CSS size stays logical
      // (`canvas { width:100%; height:100% }`), so pointer→cell maths and the ruler
      // keep working in CSS pixels untouched; render() re-applies the pixel-ratio
      // transform every frame (resizing the buffer resets the context transform).
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      this.dpr = dpr;
      this.canvas.width = Math.round(parent.clientWidth * dpr);
      this.canvas.height = Math.round(parent.clientHeight * dpr);
    }
  }

  getActiveDrawValue() {
    if (this.mode === 'lace') return this.activeStitch;
    // Direct modes: honour the selected yarn (A = 0 background, B = 1 contrast/hole).
    return this.activeColor === 0 ? 0 : 1;
  }

  getEraseValue() {
    return (this.mode === 'lace') ? STITCH_TYPE.KNIT : 0;
  }

  applyStitchAt(r, c, value) {
    if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
      this.matrix[r][c] = value;

      // Handle symmetries
      if (this.symmetryH) {
        const mirrorC = this.cols - 1 - c;
        let mirrorVal = value;
        if (value === STITCH_TYPE.TRANSFER_LEFT) mirrorVal = STITCH_TYPE.TRANSFER_RIGHT;
        else if (value === STITCH_TYPE.TRANSFER_RIGHT) mirrorVal = STITCH_TYPE.TRANSFER_LEFT;
        this.matrix[r][mirrorC] = mirrorVal;
      }
      if (this.symmetryV) {
        const mirrorR = this.rows - 1 - r;
        this.matrix[mirrorR][c] = value;
      }
    }
  }

  // Geometry Drawing Primitives
  drawLine(r0, c0, r1, c1, value) {
    // Bresenham's algorithm
    const dc = Math.abs(c1 - c0);
    const dr = Math.abs(r1 - r0);
    const sc = (c0 < c1) ? 1 : -1;
    const sr = (r0 < r1) ? 1 : -1;
    let err = dc - dr;

    let currC = c0;
    let currR = r0;

    while (true) {
      this.applyStitchAt(currR, currC, value);
      if (currC === c1 && currR === r1) break;
      const e2 = 2 * err;
      if (e2 > -dr) {
        err -= dr;
        currC += sc;
      }
      if (e2 < dc) {
        err += dc;
        currR += sr;
      }
    }
  }

  drawRect(r0, c0, r1, c1, value) {
    const minR = Math.min(r0, r1);
    const maxR = Math.max(r0, r1);
    const minC = Math.min(c0, c1);
    const maxC = Math.max(c0, c1);

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        this.applyStitchAt(r, c, value);
      }
    }
  }

  drawCircle(r0, c0, r1, c1, value) {
    const centerR = (r0 + r1) / 2;
    const centerC = (c0 + c1) / 2;
    const radiusR = Math.abs(r1 - r0) / 2;
    const radiusC = Math.abs(c1 - c0) / 2;

    const minR = Math.max(0, Math.floor(centerR - radiusR));
    const maxR = Math.min(this.rows - 1, Math.ceil(centerR + radiusR));
    const minC = Math.max(0, Math.floor(centerC - radiusC));
    const maxC = Math.min(this.cols - 1, Math.ceil(centerC + radiusC));

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const normDist = Math.pow((c - centerC) / (radiusC || 1), 2) + Math.pow((r - centerR) / (radiusR || 1), 2);
        if (normDist <= 1.0) {
          this.applyStitchAt(r, c, value);
        }
      }
    }
  }

  // Rectangle drawn as a 1-cell-thick perimeter only (outline), not filled.
  drawRectOutline(r0, c0, r1, c1, value) {
    const minR = Math.min(r0, r1), maxR = Math.max(r0, r1);
    const minC = Math.min(c0, c1), maxC = Math.max(c0, c1);
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (r === minR || r === maxR || c === minC || c === maxC) this.applyStitchAt(r, c, value);
      }
    }
  }

  // Ellipse drawn as a perimeter ring (outline), computed with a rotated-
  // superellipse membership test so the ring stays a consistent 1 cell thick.
  drawEllipseOutline(r0, c0, r1, c1, value) {
    const centerR = (r0 + r1) / 2, centerC = (c0 + c1) / 2;
    const radiusR = Math.abs(r1 - r0) / 2, radiusC = Math.abs(c1 - c0) / 2;
    const minR = Math.max(0, Math.floor(centerR - radiusR) - 1);
    const maxR = Math.min(this.rows - 1, Math.ceil(centerR + radiusR) + 1);
    const minC = Math.max(0, Math.floor(centerC - radiusC) - 1);
    const maxC = Math.min(this.cols - 1, Math.ceil(centerC + radiusC) + 1);
    const rr = radiusR || 1, rc = radiusC || 1;
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const d = Math.pow((c - centerC) / rc, 2) + Math.pow((r - centerR) / rr, 2);
        // Ring band between the outer edge and a slightly inset inner edge.
        if (d <= 1.0 && d >= 0.55) this.applyStitchAt(r, c, value);
      }
    }
  }

  stampHeartAt(centerR, centerC, value) {
    const heartOffsets = [
      [1, -1], [1, 1],
      [0, -2], [0, -1], [0, 0], [0, 1], [0, 2],
      [-1, -2], [-1, -1], [-1, 0], [-1, 1], [-1, 2],
      [-2, -1], [-2, 0], [-2, 1],
      [-3, 0]
    ];
    for (const [dr, dc] of heartOffsets) {
      this.applyStitchAt(centerR + dr, centerC + dc, value);
    }
    this.saveState();
    this.render();
    this.onChange();
  }

  floodFill(startR, startC, targetValue) {
    if (startR < 0 || startR >= this.rows || startC < 0 || startC >= this.cols) return;
    const initialVal = this.matrix[startR][startC];
    if (initialVal === targetValue) return;

    const queue = [[startR, startC]];
    const visited = new Set();
    visited.add(`${startR},${startC}`);
    // Consume with a moving cursor, not shift(): Array#shift is O(n), so popping the
    // head on a full-card fill (~48k cells) is O(n^2) and hangs the tab. This stays
    // breadth-first while dequeuing in O(1).
    let head = 0;

    while (head < queue.length) {
      const [r, c] = queue[head++];
      this.applyStitchAt(r, c, targetValue);

      const neighbors = [
        [r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]
      ];

      for (const [nr, nc] of neighbors) {
        if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
          const key = `${nr},${nc}`;
          if (!visited.has(key) && this.matrix[nr][nc] === initialVal) {
            visited.add(key);
            queue.push([nr, nc]);
          }
        }
      }
    }
  }

  // Rendering
  render() {
    const ctx = this.ctx;
    // Work in CSS pixels; the device-pixel-ratio scale is applied once here so every
    // coordinate below stays logical. `dpr` is set in resizeCanvas (defaults to 1 for
    // a hidden canvas, which matches the old 1:1 behaviour exactly).
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;

    // Background: Dark industrial CAD canvas
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.panX, this.panY);

    const totalGridWidth = this.cols * this.zoom;
    const totalGridHeight = this.rows * this.zoom;

    // Outer grid shadow & border
    ctx.fillStyle = '#131b2e';
    ctx.fillRect(0, 0, totalGridWidth, totalGridHeight);

    // Draw cells
    for (let r = 0; r < this.rows; r++) {
      const y = (this.rows - 1 - r) * this.zoom;

      for (let c = 0; c < this.cols; c++) {
        const x = c * this.zoom;
        const stitch = this.matrix[r][c];

        // Alternating subtle column guide
        if (c % 2 === 0) {
          ctx.fillStyle = '#17223b';
          ctx.fillRect(x, y, this.zoom, this.zoom);
        }

        // Draw stitch glyph or color
        this.renderCellContent(ctx, x, y, this.zoom, stitch, r, c);
      }
    }

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let c = 0; c <= this.cols; c++) {
      const x = c * this.zoom;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalGridHeight);
    }
    for (let r = 0; r <= this.rows; r++) {
      const y = r * this.zoom;
      ctx.moveTo(0, y);
      ctx.lineTo(totalGridWidth, y);
    }
    ctx.stroke();

    // Major grid lines (every 5 stitches / rows)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    for (let c = 0; c <= this.cols; c += 6) {
      const x = c * this.zoom;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalGridHeight);
    }
    ctx.stroke();

    // Active tool drag preview (line/rect/rectOutline/circle/circleOutline)
    if (this.isMouseDown && this.dragStartCell && ['line', 'rect', 'rectOutline', 'circle', 'circleOutline'].includes(this.activeTool)) {
      this.renderToolPreview(ctx);
    }

    // Selection highlight
    if (this.selection) {
      const s = this.selection;
      const x1 = s.c1 * this.zoom;
      const y1 = (this.rows - 1 - s.r2) * this.zoom;
      const sw = (s.c2 - s.c1 + 1) * this.zoom;
      const sh = (s.r2 - s.r1 + 1) * this.zoom;

      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2.0;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x1, y1, sw, sh);
      ctx.fillStyle = 'rgba(244, 63, 94, 0.15)';
      ctx.fillRect(x1, y1, sw, sh);
      ctx.setLineDash([]);
    }

    // Draw needle bed ruler and row numbers
    this.renderRulers(ctx, totalGridWidth, totalGridHeight);

    ctx.restore();
  }

  // Draws a knit stitch as a filled "V" (two legs meeting at the base) so a
  // colourwork / filled region reads as real stockinette rather than flat blocks.
  drawStitchV(ctx, x, y, size, color) {
    const pad = Math.max(1, size * 0.12);
    const left = x + pad, right = x + size - pad;
    const top = y + pad, bottom = y + size - pad;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, size * 0.16);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(x + size / 2, bottom);
    ctx.lineTo(right, top);
    ctx.stroke();
  }

  renderCellContent(ctx, x, y, size, stitch, r, c) {
    const cx = x + size / 2;
    const cy = y + size / 2;

    if (this.mode === 'fair_isle') {
      // Render each cell as an actual knit "V" stitch so the colourwork reads
      // like real stockinette (much easier to eyeball while knitting).
      const col = (stitch === 1) ? '#38bdf8' : '#e2e8f0';
      this.drawStitchV(ctx, x, y, size, col);
      return;
    }

    if (this.mode === 'tuck') {
      if (stitch === 0) {
        // Tuck loop marker (U symbol)
        ctx.fillStyle = '#f59e0b';
        ctx.font = `bold ${size * 0.65}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('∪', cx, cy);
      } else {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      }
      return;
    }

    if (this.mode === 'slip') {
      if (stitch === 0) {
        // Float dash marker (-)
        ctx.strokeStyle = '#ec4899';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x + 2, cy);
        ctx.lineTo(x + size - 2, cy);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      }
      return;
    }

    // Lace Mode Glyphs
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';

    switch (stitch) {
      case STITCH_TYPE.EYELET:
        // Circle (Standard international eyelet/yarnover symbol)
        ctx.strokeStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.32, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
        ctx.fill();
        break;

      case STITCH_TYPE.TRANSFER_LEFT:
        // Left-leaning decrease arrow (\)
        ctx.strokeStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(cx + size * 0.28, cy - size * 0.32);
        ctx.lineTo(cx - size * 0.28, cy + size * 0.32);
        // Arrow head pointing to (col - 1)
        ctx.lineTo(cx - size * 0.1, cy + size * 0.32);
        ctx.stroke();
        break;

      case STITCH_TYPE.TRANSFER_RIGHT:
        // Right-leaning decrease arrow (/)
        ctx.strokeStyle = '#34d399';
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.28, cy - size * 0.32);
        ctx.lineTo(cx + size * 0.28, cy + size * 0.32);
        // Arrow head pointing to (col + 1)
        ctx.lineTo(cx + size * 0.1, cy + size * 0.32);
        ctx.stroke();
        break;

      case STITCH_TYPE.TRANSFER_DOUBLE_L:
        // Two-needle left jump: two parallel backslash diagonals (STITCH_INFO double line).
        ctx.strokeStyle = '#0ea5e9';
        ctx.beginPath();
        ctx.moveTo(cx + size * 0.12, cy - size * 0.34);
        ctx.lineTo(cx - size * 0.3, cy + size * 0.18);
        ctx.moveTo(cx + size * 0.36, cy - size * 0.12);
        ctx.lineTo(cx - size * 0.06, cy + size * 0.38);
        ctx.stroke();
        break;

      case STITCH_TYPE.TRANSFER_DOUBLE_R:
        // Two-needle right jump: two parallel slash diagonals (mirror of the left one).
        ctx.strokeStyle = '#10b981';
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.12, cy - size * 0.34);
        ctx.lineTo(cx + size * 0.3, cy + size * 0.18);
        ctx.moveTo(cx - size * 0.36, cy - size * 0.12);
        ctx.lineTo(cx + size * 0.06, cy + size * 0.38);
        ctx.stroke();
        break;

      case STITCH_TYPE.DOUBLE_DEC_LEFT:
        // Left-leaning double decrease: a chevron pointing left over three needles.
        ctx.strokeStyle = '#c084fc';
        ctx.beginPath();
        ctx.moveTo(cx + size * 0.28, cy - size * 0.3);
        ctx.lineTo(cx - size * 0.24, cy);
        ctx.lineTo(cx + size * 0.28, cy + size * 0.3);
        ctx.stroke();
        break;

      case STITCH_TYPE.DOUBLE_DEC_RIGHT:
        // Right-leaning double decrease: a chevron pointing right (mirror of the left).
        ctx.strokeStyle = '#f472b6';
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.28, cy - size * 0.3);
        ctx.lineTo(cx + size * 0.24, cy);
        ctx.lineTo(cx - size * 0.28, cy + size * 0.3);
        ctx.stroke();
        break;

      case STITCH_TYPE.CENTER_DEC:
        // Double decrease inverted V (^)
        ctx.strokeStyle = '#f43f5e';
        ctx.beginPath();
        ctx.moveTo(cx - size * 0.3, cy + size * 0.3);
        ctx.lineTo(cx, cy - size * 0.3);
        ctx.lineTo(cx + size * 0.3, cy + size * 0.3);
        ctx.stroke();
        break;

      case STITCH_TYPE.KNIT:
      default:
        // Vertical plain knit bar (|)
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(cx, cy - size * 0.25);
        ctx.lineTo(cx, cy + size * 0.25);
        ctx.stroke();
        break;
    }
  }

  renderToolPreview(ctx) {
    const s = this.dragStartCell;
    const h = this.hoverCell;
    const x0 = s.c * this.zoom;
    const y0 = (this.rows - 1 - s.r) * this.zoom;
    const x1 = h.c * this.zoom;
    const y1 = (this.rows - 1 - h.r) * this.zoom;

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.20)';
    ctx.lineWidth = 2.0;

    if (this.activeTool === 'line') {
      ctx.beginPath();
      ctx.moveTo(x0 + this.zoom / 2, y0 + this.zoom / 2);
      ctx.lineTo(x1 + this.zoom / 2, y1 + this.zoom / 2);
      ctx.stroke();
    } else if (this.activeTool === 'rect' || this.activeTool === 'rectOutline') {
      const rx = Math.min(x0, x1);
      const ry = Math.min(y0, y1);
      const rw = Math.abs(x1 - x0) + this.zoom;
      const rh = Math.abs(y1 - y0) + this.zoom;
      if (this.activeTool === 'rect') ctx.fillRect(rx, ry, rw, rh);
      ctx.setLineDash(this.activeTool === 'rectOutline' ? [4, 3] : []);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    } else if (this.activeTool === 'circle' || this.activeTool === 'circleOutline') {
      const cx = (x0 + x1) / 2 + this.zoom / 2;
      const cy = (y0 + y1) / 2 + this.zoom / 2;
      const rxC = Math.abs(x1 - x0) / 2 + this.zoom / 2;
      const ryC = Math.abs(y1 - y0) / 2 + this.zoom / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rxC, ryC, 0, 0, Math.PI * 2);
      if (this.activeTool === 'circle') ctx.fill();
      ctx.setLineDash(this.activeTool === 'circleOutline' ? [4, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  renderRulers(ctx, totalW, totalH) {
    ctx.font = '10px monospace';
    ctx.fillStyle = '#94a3b8';

    // Horizontal Top Needle Numbers
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let c = 0; c < this.cols; c++) {
      const x = c * this.zoom + this.zoom / 2;
      const needleNum = c + 1;
      if (needleNum === 1 || needleNum === this.cols || needleNum % 5 === 0) {
        ctx.fillText(`${needleNum}`, x, -6);
        ctx.fillRect(x - 0.5, -4, 1, 4);
      }
    }

    // Vertical Left Row Numbers (Knitting rows count 1 at bottom to N at top)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < this.rows; r++) {
      const y = (this.rows - 1 - r) * this.zoom + this.zoom / 2;
      const rowNum = r + 1;
      if (rowNum === 1 || rowNum === this.rows || rowNum % 5 === 0) {
        ctx.fillText(`${rowNum}`, -10, y);
        ctx.fillRect(-6, y - 0.5, 6, 1);
      }
    }
  }
}
