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
    this.mode = newMode;
    this.render();
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
      this.render();
      this.onChange();
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.matrix = this.history[this.historyIndex].map(row => [...row]);
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
    this.saveState();
    this.render();
    this.onChange();
  }

  flipVertical() {
    this.matrix.reverse();
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

  // Mouse & Touch Event Handlers
  setupEvents() {
    const canvas = this.canvas;

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Performance optimization: throttled rendering
    this.throttledRender = this.throttle(() => this.render(), 16); // ~60fps max
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

    canvas.addEventListener('mousedown', e => {
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

    window.addEventListener('mousemove', e => {
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
        } else if (['line', 'rect', 'circle', 'select'].includes(this.activeTool)) {
          // Preview geometry during drag
          this.render();
        }
      } else {
        this.throttledRender();
      }
    });

    window.addEventListener('mouseup', e => {
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
          } else if (this.activeTool === 'circle') {
            this.drawCircle(this.dragStartCell.r, this.dragStartCell.c, cell.r, cell.c, val);
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
    });

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

  resizeCanvas() {
    const parent = this.canvas.parentElement;
    if (parent) {
      this.canvas.width = parent.clientWidth || 800;
      this.canvas.height = parent.clientHeight || 600;
    }
  }

  getActiveDrawValue() {
    return (this.mode === 'lace') ? this.activeStitch : 1;
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

    while (queue.length > 0) {
      const [r, c] = queue.shift();
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
    const w = this.canvas.width;
    const h = this.canvas.height;

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

    // Active tool drag preview (line/rect/circle)
    if (this.isMouseDown && this.dragStartCell && ['line', 'rect', 'circle'].includes(this.activeTool)) {
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

  renderCellContent(ctx, x, y, size, stitch, r, c) {
    const cx = x + size / 2;
    const cy = y + size / 2;

    if (this.mode === 'fair_isle') {
      if (stitch === 1) {
        ctx.fillStyle = '#38bdf8'; // Contrast yarn color
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      }
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

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
    ctx.lineWidth = 2.0;

    if (this.activeTool === 'line') {
      ctx.beginPath();
      ctx.moveTo(x0 + this.zoom / 2, y0 + this.zoom / 2);
      ctx.lineTo(x1 + this.zoom / 2, y1 + this.zoom / 2);
      ctx.stroke();
    } else if (this.activeTool === 'rect') {
      const rx = Math.min(x0, x1);
      const ry = Math.min(y0, y1);
      const rw = Math.abs(x1 - x0) + this.zoom;
      const rh = Math.abs(y1 - y0) + this.zoom;
      ctx.strokeRect(rx, ry, rw, rh);
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
