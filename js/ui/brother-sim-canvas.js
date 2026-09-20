/**
 * Interactive Brother KH-830 Mechanical Kinematics Visualizer
 * 
 * Visually animates and simulates:
 * 1. The 200 needles on the needle bed with needle butts & hooks
 * 2. The 24-hole punchcard reading drum & sensing pins
 * 3. The rotating spiral drum cam driven by the carriage belt
 * 4. The 8 sub-bars sliding and hook fingers pulling needle butts down
 * 5. Interactive draggable carriage with direction indicator
 */

import { BrotherSelectorMechanism } from '../machine/brother-selector.js';
import { bedNeedleCapacity } from '../machine/profiles.js';

export class BrotherSimCanvas {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    // The selector's needle count comes from the machine profile, not a hardcoded
    // 200 (5.6): a chunky 9 mm bed really holds ~100 needles, and the sim should
    // look like the machine you picked. `setProfile` rebuilds it when you switch.
    this.profile = options.profile || null;
    this.mechanism = new BrotherSelectorMechanism(bedNeedleCapacity(this.profile), 24, 8);
    this.dpr = 1;
    this.isDraggingCarriage = false;
    this.animating = true;
    this.autoSweep = true;
    this.sweepSpeed = 0.4;
    this.animFrameId = null;

    // The whole compiled card, not just one row. A punchcard is a *sequence*: the
    // drum indexes forward one row at the end of every carriage pass, so feeding
    // the simulator a single row and looping it paints a false picture of the
    // machine (every pattern looked like its own first row).
    this.cardRows = [];
    this.rowCarriage = [];
    this.cardRow = 0;
    this.passesCompleted = 0;

    this.setupEvents();
    this.resize();
  }

  /**
   * Feed the simulator a full compiled punchcard.
   * @param {boolean[][]} cardMatrix rows x 24 hole flags
   * @param {{cardRowIndex:number, carriageType?:string}[]} [strokes] per-row carriage metadata
   */
  setCard(cardMatrix, strokes = []) {
    this.cardRows = Array.isArray(cardMatrix) ? cardMatrix : [];
    this.rowCarriage = new Array(this.cardRows.length).fill(null);
    for (const s of strokes || []) {
      if (s && s.cardRowIndex >= 0 && s.cardRowIndex < this.rowCarriage.length) {
        this.rowCarriage[s.cardRowIndex] = s.carriageType;
      }
    }
    this.cardRow = 0;
    this.passesCompleted = 0;
    this._applyCardRow();
    this.render();
  }

  /** Legacy single-row entry point; still valid, just no longer the whole story. */
  setCardPattern(cardRow24) {
    this.setCard([cardRow24], []);
  }

  /**
   * Rescale the whole simulation to a different machine (5.6). The needle capacity is
   * a property of the physical bed, so changing profile means rebuilding the
   * selector mechanism — then re-pushing the indexed card row so the display agrees.
   * @param {object} profile
   */
  setProfile(profile) {
    if (!profile) return;
    const same = this.profile && profile.id && this.profile.id === profile.id;
    this.profile = profile;
    if (same) return;
    this.mechanism = new BrotherSelectorMechanism(bedNeedleCapacity(profile), 24, 8);
    this._applyCardRow();
    this.resize();
    this.render();
  }

  /** Push the currently-indexed card row into the sensing pins. */
  _applyCardRow() {
    const row = this.cardRows[this.cardRow] || [];
    this.mechanism.setPunchcardRow(row);
    this.currentPattern = row;
    const carriage = this.rowCarriage[this.cardRow];
    if (carriage) this.setCarriageType(carriage === 'knit' ? 'knit' : 'lace');
  }

  /**
   * A completed pass indexes the card forward, exactly like the ratchet pawl on
   * the machine. Wraps so the demo keeps running on short cards.
   */
  _indexCard() {
    this.passesCompleted++;
    if (this.cardRows.length > 1) {
      this.cardRow = (this.cardRow + 1) % this.cardRows.length;
      this._applyCardRow();
    }
  }

  play() {
    this.autoSweep = true;
    this.animating = true;
    this.startLoop();
  }

  pause() {
    this.autoSweep = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  reset() {
    this.mechanism.setCarriagePosition(0, 1);
    this.cardRow = 0;
    this.passesCompleted = 0;
    this._applyCardRow();
    this.mechanism.carriageDirection = 1;
    this.autoSweep = true;
    this.render();
  }

  setCarriageType(type) {
    this.carriageType = type;
    // Update mechanism based on carriage type
    if (type === 'lace') {
      this.sweepSpeed = 0.4;
    } else if (type === 'knit') {
      this.sweepSpeed = 0.6;
    } else if (type === 'garter') {
      this.sweepSpeed = 0.3;
    }
  }

  setSimSpeed(speed) {
    this.sweepSpeed = speed;
  }

  setupEvents() {
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Pointer Events so the carriage can also be dragged with a finger or pen.
    this.canvas.addEventListener('pointerdown', e => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const carriageX = this.needleToScreenX(this.mechanism.carriagePosition);
      // Fingers are less precise than a cursor — grab a wider band on touch.
      const grab = e.pointerType === 'mouse' ? 40 : 56;

      if (Math.abs(mouseX - carriageX) < grab) {
        this.isDraggingCarriage = true;
        this._wasAutoSweeping = this.autoSweep;
        this.autoSweep = false;
        try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* window listeners still cover it */ }
      }
    });

    window.addEventListener('pointermove', e => {
      if (this.isDraggingCarriage) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const needle = this.screenXToNeedle(mouseX);
        const before = this.mechanism.carriageDirection;
        this.mechanism.setCarriagePosition(needle);
        // Hand-cranking the carriage through the end of a stroke indexes the card
        // too — the pawl does not know whether the belt or a person moved it.
        if (needle <= 0 && before < 0) this._indexCard();
        else if (needle >= this.mechanism.totalNeedles - 1 && before > 0) this._indexCard();
        this.render();
      }
    });

    // Releasing the carriage hands control back to the belt if it was the belt
    // driving before the grab. Previously a single drag stopped the animation for
    // the rest of the session with no obvious way to restart it.
    const release = () => {
      if (!this.isDraggingCarriage) return;
      this.isDraggingCarriage = false;
      if (this._wasAutoSweeping) {
        this.autoSweep = true;
        this._wasAutoSweeping = false;
        this.startLoop();
      }
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    // The resize storm matters on phones: opening the on-screen keyboard fires a
    // dozen layout changes a second, and each one would otherwise re-render 200
    // needles plus 8 bars. Coalesce to one repaint per animation frame.
    let resizePending = false;
    window.addEventListener('resize', () => {
      if (resizePending) return;
      resizePending = true;
      requestAnimationFrame(() => {
        resizePending = false;
        this.resize();
      });
    });
  }

  resize() {
    const parent = this.canvas.parentElement;
    // Skip while the tab is hidden — a 0×0 layout would bake in a stale buffer
    if (parent && parent.clientWidth > 0 && parent.clientHeight > 0) {
      // Back the buffer with devicePixelRatio device pixels but keep drawing in CSS
      // pixels (render sets a base dpr transform; the layout helpers divide by it),
      // so the schematic stays crisp on HiDPI screens and pointer mapping — which
      // already reads CSS px from getBoundingClientRect — keeps matching.
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      this.dpr = dpr;
      this.canvas.width = Math.round(parent.clientWidth * dpr);
      this.canvas.height = Math.round(parent.clientHeight * dpr);
      this.render();
    }
  }

  needleToScreenX(needleIndex) {
    const w = this.canvas.width / (this.dpr || 1);
    const bedMargin = 50;
    const bedWidth = w - (bedMargin * 2);
    return bedMargin + (needleIndex / (this.mechanism.totalNeedles - 1)) * bedWidth;
  }

  screenXToNeedle(screenX) {
    const w = this.canvas.width / (this.dpr || 1);
    const bedMargin = 50;
    const bedWidth = w - (bedMargin * 2);
    const norm = (screenX - bedMargin) / bedWidth;
    return Math.max(0, Math.min(this.mechanism.totalNeedles - 1, norm * (this.mechanism.totalNeedles - 1)));
  }

  startLoop() {
    if (this.animFrameId) return;
    let lastTime = performance.now();
    const loop = (now) => {
      // Nothing to animate: hand-dragging already paints from its own handler, so
      // holding a frame slot here would burn battery displaying a still image.
      if (!this.autoSweep && !this.isDraggingCarriage) {
        this.animFrameId = null;
        return;
      }
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (this.autoSweep && !this.isDraggingCarriage) {
        const step = this.mechanism.carriageDirection * this.sweepSpeed * 60 * dt;
        // stepCarriage owns the bounce off the bed stops and reports a completed
        // pass; feeding it a signed delta keeps the card indexed one row per pass.
        if (this.mechanism.stepCarriage(step)) this._indexCard();
      }

      this.render();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  render() {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;

    // Dark engineering workspace background
    ctx.fillStyle = '#070a12';
    ctx.fillRect(0, 0, w, h);

    const telemetry = this.mechanism.getMechanismTelemetry();

    // 1. Bed Base & 200 Needles
    const bedY = 220;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(40, bedY - 15, w - 80, 70);

    // Bed border
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(40, bedY - 15, w - 80, 70);

    // Draw 200 Needles
    for (let n = 0; n < this.mechanism.totalNeedles; n++) {
      const nx = this.needleToScreenX(n);
      const state = this.mechanism.needleStates[n];
      const isSelected = (state === 'D_POS');

      // Needle shank (vertical post)
      // If pulled down by hook: butt is lowered
      const buttOffsetY = isSelected ? -10 : 8;

      ctx.strokeStyle = isSelected ? '#38bdf8' : '#64748b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(nx, bedY + 30);
      ctx.lineTo(nx, bedY + buttOffsetY);
      ctx.stroke();

      // Needle Butt (square post)
      ctx.fillStyle = isSelected ? '#38bdf8' : '#475569';
      ctx.fillRect(nx - 1.5, bedY + buttOffsetY - 4, 3, 5);

      // Key needle markers (0, 5, 10, etc.)
      if (n % 20 === 0 || n === 100) {
        ctx.fillStyle = (n === 100) ? '#f43f5e' : '#94a3b8';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this.mechanism.needleLabels[n], nx, bedY + 46);
      }
    }

    // 2. The 8 Selector Bars (spans across the bed under needles)
    const barsStartY = bedY + 65;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(40, barsStartY, w - 80, 80);
    ctx.strokeStyle = '#1e293b';
    ctx.strokeRect(40, barsStartY, w - 80, 80);

    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('8 SELECTOR BARS (Hooks every 8th needle)', 50, barsStartY - 6);

    for (let b = 0; b < this.mechanism.numSelectorBars; b++) {
      const by = barsStartY + 8 + b * 9;
      const displacement = this.mechanism.barDisplacements[b];
      const isActive = displacement > 0.5;

      ctx.fillStyle = isActive ? 'rgba(56, 189, 248, 0.2)' : 'rgba(30, 41, 59, 0.4)';
      ctx.fillRect(45 + displacement * 2, by, w - 90, 6);

      ctx.fillStyle = isActive ? '#38bdf8' : '#64748b';
      ctx.font = '8px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`Bar ${b + 1}`, 42, by + 5);
    }

    // 3. Rotating Spiral Cam & Punchcard Reader Assembly (on carriage)
    const carriageScreenX = this.needleToScreenX(this.mechanism.carriagePosition);
    const carriageW = 70;
    const carriageH = 90;
    const carriageY = bedY - carriageH - 10;

    // Carriage Body Shadow & Shell
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.roundRect(carriageScreenX - carriageW / 2, carriageY, carriageW, carriageH, 6);
    ctx.fill();
    ctx.stroke();

    // Carriage Handle & Indicator
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('KH-830', carriageScreenX, carriageY + 16);
    ctx.font = '9px monospace';
    ctx.fillText(`CARRIAGE`, carriageScreenX, carriageY + 28);
    ctx.fillText(`${telemetry.carriageLabel}`, carriageScreenX, carriageY + 40);

    // Direction arrow on carriage
    ctx.fillStyle = '#fbbf24';
    ctx.font = '16px monospace';
    ctx.fillText(this.mechanism.carriageDirection > 0 ? '▶' : '◀', carriageScreenX, carriageY + 60);

    // 4. Punchcard Reader Drum (24-Hole Pin Matrix) at top-right
    const drumX = w - 240;
    const drumY = 25;
    const drumW = 200;
    const drumH = 95;

    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(drumX, drumY, drumW, drumH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    const total = this.cardRows.length || 1;
    ctx.fillText(`24-PIN PUNCHCARD READER  ROW ${this.cardRow + 1}/${total}`, drumX + 12, drumY + 18);

    // Draw 24 Sensing Pins
    const pinStartX = drumX + 16;
    const pinY = drumY + 38;
    const pinSpacing = (drumW - 32) / 24;

    for (let p = 0; p < 24; p++) {
      const px = pinStartX + p * pinSpacing;
      const isPunched = this.mechanism.punchcardPins[p];
      const isActiveTrack = (p === telemetry.activeTrack);

      ctx.fillStyle = isPunched ? '#38bdf8' : '#334155';
      ctx.beginPath();
      ctx.arc(px, pinY, isPunched ? 3.2 : 2.0, 0, Math.PI * 2);
      ctx.fill();

      if (isActiveTrack) {
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, pinY, 5.0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.fillText(`Active Track: ${telemetry.activeTrack + 1}/24 → Bar: ${telemetry.activeBar + 1}/8`, drumX + 12, drumY + 60);
    ctx.fillText(`Working Needles (D): ${telemetry.totalWorkingNeedles}`, drumX + 12, drumY + 74);
    ctx.fillText(`Pulled-Down (B):     ${telemetry.totalPulledDown}`, drumX + 12, drumY + 86);
    // Which carriage should be on the bed for THIS row, straight from the schedule.
    const rowCarriage = this.rowCarriage[this.cardRow];
    if (rowCarriage) {
      ctx.fillStyle = rowCarriage === 'knit' ? '#fbbf24' : '#f43f5e';
      ctx.fillText(`Row carriage: ${rowCarriage === 'knit' ? 'K — knit carriage' : 'L — lace carriage'}`, drumX + 112, drumY + 74);
      ctx.fillStyle = '#64748b';
      ctx.fillText(`Card passes: ${this.passesCompleted}`, drumX + 112, drumY + 86);
    }

    // 5. Educational Mechanism Explainer Banner at top-left
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Brother KH-830 Spiral Cam & 8-Selector Bar Kinematics', 40, 30);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText('24 punchcard tracks are mapped across all 200 needles using 8 synchronized selector bars.', 40, 48);
    ctx.fillText('Drag the carriage or watch the automatic mechanical belt stroke below:', 40, 64);
  }
}
