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

export class BrotherSimCanvas {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    this.mechanism = new BrotherSelectorMechanism(200, 24, 8);
    this.isDraggingCarriage = false;
    this.animating = true;
    this.autoSweep = true;
    this.sweepSpeed = 0.4;

    this.setupEvents();
    this.resize();
    this.startLoop();
  }

  setCardPattern(cardRow24) {
    this.mechanism.setPunchcardRow(cardRow24);
    this.currentPattern = cardRow24;
    this.render();
  }

  play() {
    this.autoSweep = true;
    this.animating = true;
  }

  pause() {
    this.autoSweep = false;
  }

  reset() {
    this.mechanism.setCarriagePosition(0);
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
    this.canvas.addEventListener('mousedown', e => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const carriageX = this.needleToScreenX(this.mechanism.carriagePosition);

      if (Math.abs(mouseX - carriageX) < 40) {
        this.isDraggingCarriage = true;
        this.autoSweep = false;
      }
    });

    window.addEventListener('mousemove', e => {
      if (this.isDraggingCarriage) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const needle = this.screenXToNeedle(mouseX);
        this.mechanism.setCarriagePosition(needle);
        this.render();
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDraggingCarriage = false;
    });

    window.addEventListener('resize', () => {
      this.resize();
    });
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (parent) {
      this.canvas.width = parent.clientWidth || 800;
      this.canvas.height = parent.clientHeight || 500;
      this.render();
    }
  }

  needleToScreenX(needleIndex) {
    const w = this.canvas.width;
    const bedMargin = 50;
    const bedWidth = w - (bedMargin * 2);
    return bedMargin + (needleIndex / (this.mechanism.totalNeedles - 1)) * bedWidth;
  }

  screenXToNeedle(screenX) {
    const w = this.canvas.width;
    const bedMargin = 50;
    const bedWidth = w - (bedMargin * 2);
    const norm = (screenX - bedMargin) / bedWidth;
    return Math.max(0, Math.min(this.mechanism.totalNeedles - 1, norm * (this.mechanism.totalNeedles - 1)));
  }

  startLoop() {
    let lastTime = performance.now();
    const loop = (now) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (this.autoSweep && !this.isDraggingCarriage) {
        let pos = this.mechanism.carriagePosition + (this.mechanism.carriageDirection * this.sweepSpeed * 60 * dt);
        if (pos >= this.mechanism.totalNeedles - 1) {
          pos = this.mechanism.totalNeedles - 1;
          this.mechanism.carriageDirection = -1;
        } else if (pos <= 0) {
          pos = 0;
          this.mechanism.carriageDirection = 1;
        }
        this.mechanism.setCarriagePosition(pos);
      }

      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

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
    ctx.fillText('24-PIN PUNCHCARD READER', drumX + 12, drumY + 18);

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
