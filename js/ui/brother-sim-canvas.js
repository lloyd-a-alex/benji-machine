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
import { logger } from '../core/logging.js';

const log = logger('ui/brother-sim-canvas');

export class BrotherSimCanvas {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    if (!this.ctx) log.error('Brother sim 2D context is unavailable — the mechanism cannot render', { hasElement: !!canvasElement });

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
    const scheduled = this.rowCarriage[this.cardRow];
    this.scheduledCarriage = scheduled || null;
    if (this.mechanism.laceMode) {
      // Single-carriage lace rig: the Lace carriage stays connected whatever the
      // schedule labels this row. The operator cannot swap a carriage mid-stroke,
      // and on this machine the one carriage works the plain rows too.
      this.setCarriageType('lace');
    } else if (scheduled) {
      this.setCarriageType(scheduled === 'knit' ? 'knit' : 'lace');
    }
  }

  /**
   * A completed pass indexes the card forward, exactly like the ratchet pawl on
   * the machine. Wraps so the demo keeps running on short cards.
   *
   * The drum is turned by the belt the mounted carriage hauls, so with no
   * carriage seated on the bed there is nothing to drive it and the card cannot
   * advance — an empty pass reads blank rows and must not slip the pattern.
   */
  _indexCard() {
    if (!this.mechanism.mountedCarriage || !this.mechanism.beltDriven) return;
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

  /**
   * Seat a carriage on the bed, honouring the physical single-carriage rule.
   *
   * The mechanism ejects the old carriage as the new one drops on, and refuses
   * the swap outright while the machine is rigged for lace (only the Lace
   * carriage may be connected). A refused swap leaves the previously-mounted
   * carriage in place and reports the reason back so the toolbar can bounce the
   * button and the caller can tell the knitter why.
   * @param {'lace'|'knit'|'garter'} type
   * @returns {{ok:boolean, blocked:boolean, mounted:string, ejected:string|null, reason:string}}
   */
  setCarriageType(type) {
    const result = this.mechanism.mountCarriage(type);
    const mounted = result.mounted;
    this.carriageType = mounted;
    this.carriageNote = result.blocked ? result.reason : '';
    // The belt speed follows whichever carriage actually rode onto the bed, so a
    // blocked swap keeps the running carriage's cadence rather than snapping to a
    // carriage that never seated.
    if (mounted === 'lace') this.sweepSpeed = 0.4;
    else if (mounted === 'knit') this.sweepSpeed = 0.6;
    else if (mounted === 'garter') this.sweepSpeed = 0.3;
    return result;
  }

  /**
   * Rig the whole simulation for lace (or take it off). In lace mode only the Lace
   * carriage can be on the bed, so the per-row knit carriage in a schedule is
   * worked by that one belt-driven carriage instead of a physical swap.
   * @param {boolean} on
   * @returns {{ok:boolean, blocked:boolean, mounted:string, ejected:string|null}}
   */
  setLaceMode(on) {
    const result = this.mechanism.setLaceMode(on);
    this.carriageType = this.mechanism.mountedCarriage;
    this.laceMode = this.mechanism.laceMode;
    this._applyCardRow();
    this.render();
    return result;
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
      // A lace carriage raises punched needles all the way out to holding position
      // ('E_POS'); a knit carriage only lifts them into the working cam channel
      // ('D_POS'). Both are "selected", but holding sits higher and reads amber.
      const isHolding = state === 'E_POS';
      const isSelected = state === 'D_POS' || isHolding;

      // Needle shank (vertical post)
      // If pulled down by hook: butt is lowered
      const buttOffsetY = isHolding ? -14 : isSelected ? -10 : 8;

      ctx.strokeStyle = isHolding ? '#fbbf24' : isSelected ? '#38bdf8' : '#64748b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(nx, bedY + 30);
      ctx.lineTo(nx, bedY + buttOffsetY);
      ctx.stroke();

      // Needle Butt (square post)
      ctx.fillStyle = isHolding ? '#fbbf24' : isSelected ? '#38bdf8' : '#475569';
      ctx.fillRect(nx - 1.5, bedY + buttOffsetY - 4, 3, 5);

      // The lace carriage slides a held loop in ITS direction of travel, so a
      // needle sitting in holding position gets a small transfer arrow on the way
      // the carriage is currently moving — › going right, ‹ going left. This is
      // the physical heart of machine lace and the whole reason a left-leaning
      // transfer must be worked on a right-to-left pass. It only appears once the
      // bed is actually rigged for lace, so a knit carriage shows plain needles.
      if (isHolding && this.mechanism.laceMode) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this.mechanism.carriageDirection > 0 ? '\u203A' : '\u2039', nx, bedY + buttOffsetY - 9);
      }

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
    // The bay is the physical constraint: exactly one carriage is on the bed, and
    // the shell names that carriage so the knitter can see the lace lock holding.
    const bay = this.mechanism.getCarriageState();
    const bayColor = bay.mounted === 'lace' ? '#f43f5e' : bay.mounted === 'knit' ? '#fbbf24' : '#38bdf8';
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('KH-830', carriageScreenX, carriageY + 16);
    ctx.font = '9px monospace';
    ctx.fillStyle = bayColor;
    ctx.fillText(`${(bay.mounted || 'NONE').toUpperCase()} ⬤`, carriageScreenX, carriageY + 28);
    ctx.fillStyle = '#94a3b8';
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
      const laceLocked = bay.laceMode && rowCarriage === 'knit';
      ctx.fillStyle = rowCarriage === 'knit' ? '#fbbf24' : '#f43f5e';
      ctx.fillText(
        `Row wants: ${rowCarriage === 'knit' ? 'K — knit carriage' : 'L — lace carriage'}`,
        drumX + 112, drumY + 74
      );
      ctx.fillStyle = '#64748b';
      ctx.fillText(`Card passes: ${this.passesCompleted}`, drumX + 112, drumY + 86);
      // A schedule that wants a knit carriage while the bed is lace-locked is not a
      // contradiction — the one carriage knits the plain row too. Say so honestly.
      if (laceLocked) {
        ctx.fillStyle = '#f43f5e';
        ctx.fillText('→ worked by L (lace rig)', drumX + 112, drumY + 60);
      }
    }

    // 4b. The timing belt — the ONE mounted carriage hauls it, and it turns the
    // card drum. Nothing else can advance the card, so the belt is drawn from the
    // carriage physically riding the bed up to the reader it drives.
    const beltEngaged = bay.beltDriven && bay.mounted;
    const beltTargetX = drumX + drumW / 2;
    const beltTargetY = drumY + drumH;
    ctx.save();
    ctx.strokeStyle = beltEngaged ? 'rgba(251, 191, 36, 0.85)' : 'rgba(100, 116, 139, 0.4)';
    ctx.lineWidth = beltEngaged ? 2.5 : 1.5;
    ctx.setLineDash(beltEngaged ? [6, 4] : [3, 5]);
    ctx.beginPath();
    ctx.moveTo(carriageScreenX, carriageY + carriageH * 0.25);
    ctx.quadraticCurveTo((carriageScreenX + beltTargetX) / 2, carriageY - 46, beltTargetX, beltTargetY);
    ctx.stroke();
    ctx.restore();

    // 4c. Carriage bay — one seat on the bed; the rest are parked off-machine.
    ctx.textAlign = 'left';
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('CARRIAGE BAY (one seat on the bed)', 40, 84);
    ['lace', 'knit', 'garter'].forEach((c, i) => {
      const bx = 40 + i * 68;
      const by = 92;
      const isMounted = bay.mounted === c;
      const lockedOut = bay.laceMode && c !== 'lace';
      ctx.fillStyle = isMounted ? 'rgba(56, 189, 248, 0.18)' : 'rgba(30, 41, 59, 0.5)';
      ctx.strokeStyle = isMounted ? '#38bdf8' : lockedOut ? '#7f1d1d' : '#334155';
      ctx.lineWidth = isMounted ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, 62, 24, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isMounted ? '#e0f2fe' : lockedOut ? '#64748b' : '#94a3b8';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${c.toUpperCase()}${isMounted ? ' ●' : lockedOut ? ' ✕' : ''}`, bx + 31, by + 16);
    });
    ctx.textAlign = 'left';
    ctx.font = '9px monospace';
    ctx.fillStyle = bay.laceMode ? '#f43f5e' : '#64748b';
    ctx.fillText(
      bay.laceMode
        ? 'LACE MODE: bed locked to the Lace carriage — no other may connect'
        : `${(bay.mounted || 'no').toUpperCase()} carriage connected, driving the belt`,
      40, 132
    );

    // 5b. Lace Carriage Pass Strip — the knitter's "what does the carriage do,
    // pass by pass" read, drawn straight off the compiled card and its stroke
    // schedule. Each line is one traverse: a travel arrow, the 24 punchcard tracks
    // rendered as holding dots / transfer arrows / knit bars, and the L or K
    // carriage tag that physically rides that pass. The current pass glows.
    this._renderLacePassStrip(w - 40);

    // 6. Registration guides — a heavier rule seven row-pitches up from the bottom
    // (how far a design sits above the cast-on) and a centre line dropping through
    // the middle of the bed, so a motif's height and its centring are read at a
    // glance. Deliberately translucent: reference marks, not fabric.
    const rowPitch = 14;
    const guideY = h - 7 * rowPitch;
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(40, guideY);
    ctx.lineTo(w - 40, guideY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('7 ROWS UP FROM CAST-ON', 44, guideY - 5);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.38)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(w / 2, 14);
    ctx.lineTo(w / 2, h - 14);
    ctx.stroke();
    ctx.restore();

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

  /**
   * Draw the rolling Lace Carriage pass strip. One line per carriage traverse
   * around the live row, read the way a knitter reads a pass sheet at the machine:
   * which way the carriage is going (▶ / ◀), what each of the 24 punchcard tracks
   * does as it passes (a held needle gets a transfer arrow › / ‹ pointing the way
   * the loop will slide; a knit row shows a bar of plain stitches), and which
   * carriage — Lace (L) or Knit (K) — is physically riding that pass. The live
   * pass is highlighted, and its direction follows the real carriage so the strip
   * and the bed never tell two different stories.
   * @param {number} rightEdge x the strip may not draw past (kept clear of the drum)
   */
  _renderLacePassStrip(rightEdge) {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    const h = this.canvas.height / dpr;
    const x0 = 40;
    const rowH = 13;
    // The carriage body rides the bed at y≈120–210 and the 8 selector bars fill
    // y≈285–365, so the only clear band for a wide read-out is BELOW the bars.
    // Anchor it there (under the mechanism), and let it climb only if the canvas
    // is unusually short so it never spills past the bottom edge.
    const stripH = 12 + 4 * rowH + 6;
    const top = Math.min(372, Math.max(200, h - stripH - 8));
    const cols = this.mechanism.repeatLength; // 24 punchcard tracks
    const dirW = 12;
    const idxW = 22;
    const tagW = 18;
    const labelW = dirW + idxW;
    const cellAreaW = Math.max(60, rightEdge - x0 - labelW - tagW - 8);
    const cw = cellAreaW / cols;
    const total = this.cardRows.length || 1;

    ctx.textAlign = 'left';
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#f43f5e';
    ctx.fillText('LACE CARRIAGE PASS STRIP', x0, top);
    ctx.font = '8px monospace';
    ctx.fillStyle = '#64748b';
    ctx.fillText('\u25B6\u25C0 travel   0/\u203A\u2039 hold+transfer   \u25AC knit   L/K carriage', x0 + 168, top);

    for (let k = -1; k <= 2; k++) {
      const ri = ((this.cardRow + k) % total + total) % total;
      const y = top + 12 + (k + 1) * rowH;
      const isCurrent = k === 0;
      const row = this.cardRows[ri] || [];
      let carriage = this.rowCarriage[ri] || null;
      if (!carriage) carriage = this.mechanism.laceMode ? 'lace' : (this.mechanism.mountedCarriage || null);
      // A real carriage reverses on every traverse; the live row follows the one
      // actually on the bed right now, the neighbours just alternate around it.
      const dir = isCurrent ? this.mechanism.carriageDirection : (ri % 2 === 0 ? 1 : -1);

      if (isCurrent) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.fillRect(x0 - 4, y - 9, (rightEdge - x0) + tagW + 12, rowH - 1);
      }

      ctx.textAlign = 'left';
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = dir > 0 ? '#38bdf8' : '#fbbf24';
      ctx.fillText(dir > 0 ? '\u25B6' : '\u25C0', x0, y);

      ctx.fillStyle = isCurrent ? '#e2e8f0' : '#475569';
      ctx.font = '8px monospace';
      ctx.fillText(String(ri + 1).padStart(2, '\u2007'), x0 + dirW + 2, y);

      const cellX = x0 + labelW;
      const showCells = cw >= 3;
      for (let p = 0; p < cols; p++) {
        const cx = cellX + p * cw;
        const punched = Boolean(row[p]);
        let ch;
        let color;
        if (carriage === 'knit') { ch = '\u25AC'; color = punched ? '#7dd3fc' : '#334155'; }
        else if (carriage === 'lace') {
          if (punched) { ch = dir > 0 ? '\u203A' : '\u2039'; color = '#fbbf24'; }
          else { ch = '\u00B7'; color = '#475569'; }
        } else {
          ch = punched ? '0' : '\u00B7'; color = punched ? '#fbbf24' : '#475569';
        }
        if (showCells) {
          ctx.fillStyle = color;
          ctx.font = '9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(ch, cx + cw / 2, y);
        }
      }

      const tagX = cellX + cols * cw + 6;
      ctx.textAlign = 'left';
      ctx.font = 'bold 10px monospace';
      if (carriage === 'knit') { ctx.fillStyle = '#fbbf24'; ctx.fillText('K', tagX, y); }
      else if (carriage === 'lace') { ctx.fillStyle = '#f43f5e'; ctx.fillText('L', tagX, y); }
      else { ctx.fillStyle = '#64748b'; ctx.fillText('\u00B7', tagX, y); }
    }
  }
}
