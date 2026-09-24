/**
 * Brother KH-830 Mechanical Kinematic Simulator
 * 
 * Mathematically models the mechanical punchcard selector mechanism of the
 * Brother KH-830 / KH-881 / KH-890 single-bed knitting machine:
 * 
 * 1. 24 Sensing Pins:
 *    U-shaped pins feel the punchcard holes.
 * 2. Spiral Drum Cam Assembly:
 *    Geared directly to the carriage timing belt. As the carriage traverses
 *    the 200-needle bed, the spiral cam rotates continuously:
 *      theta_cam(X) = (2 * PI * X) / 24
 * 3. 8 Full-Bed Selector Bars:
 *    8 long steel sub-bars span the entire 200 needles.
 *    Needle n is actuated by Bar (n mod 8).
 *    The spiral cam cyclically reassigns which of the 24 punchcard tracks
 *    drives each of the 8 selector bars:
 *      TrackIndex(n) = n mod 24
 *      BarIndex(n)   = n mod 8
 * 4. Needle Butt Gates & Channels:
 *    Hooks on the 8 bars pull selected needle butts down, disengaging them
 *    from the carriage cam channel or elevating them into working position.
 * 5. The Single-Carriage Bay:
 *    A punchcard bed is ONE channel: only a single carriage can be seated at a
 *    time, and that carriage is what pulls the timing belt which advances the
 *    card-reading drum. Mounting a second carriage is physically impossible, so
 *    the bay ejects the old one as the new one drops on. When the machine is
 *    rigged for lace the bay is locked to the Lace carriage — the knit and
 *    garter carriages cannot be connected while the lace setup is in place.
 */

import { logger } from '../core/logging.js';

const log = logger('machine/brother-selector');

export class BrotherSelectorMechanism {
  constructor(totalNeedles = 200, repeatLength = 24, numSelectorBars = 8) {
    // A non-positive bed/repeat/bar count silently poisons every downstream modulo and
    // division with NaN/Infinity, so flag it loudly and fall back to the reference geometry.
    if (!(totalNeedles > 0) || !(repeatLength > 0) || !(numSelectorBars > 0)) {
      log.error('BrotherSelectorMechanism built with non-positive geometry, falling back to defaults', {
        totalNeedles, repeatLength, numSelectorBars,
      });
      if (!(totalNeedles > 0)) totalNeedles = 200;
      if (!(repeatLength > 0)) repeatLength = 24;
      if (!(numSelectorBars > 0)) numSelectorBars = 8;
    }
    this.totalNeedles = totalNeedles;
    this.repeatLength = repeatLength;
    this.numSelectorBars = numSelectorBars;

    // Current carriage position along needle bed (0 to totalNeedles)
    this.carriagePosition = 100;
    this.carriageDirection = 1; // +1 = moving right, -1 = moving left

    // 24 punchcard track inputs (true = hole punched / pin pushed up)
    this.punchcardPins = new Array(repeatLength).fill(false);

    // 8 Sub-bar lateral displacement states (in mm)
    this.barDisplacements = new Float32Array(numSelectorBars);

    // 200 Needle mechanical states:
    // 'B_POS' = Non-working / pulled down by hook
    // 'D_POS' = Selected / in cam channel
    // 'E_POS' = Fully extended (holding/lace)
    this.needleStates = new Array(totalNeedles).fill('B_POS');

    // ── The carriage bay: the physical single-carriage constraint ──────────
    // One bed, one channel, one carriage. Whichever carriage is `mounted` is the
    // one riding the bed and hauling the belt that turns the card drum, so it is
    // also the only one that can index the punchcard. `laceMode` models a machine
    // rigged for lace, where that one carriage is fixed to the Lace carriage and
    // no other may be seated. This is not a UI nicety — a real bed cannot carry
    // two carriages, and pretending it can lets the simulator draw an impossible
    // rig and mis-index the card.
    this.carriageTypes = ['lace', 'knit', 'garter'];
    this.mountedCarriage = 'lace';
    this.beltDriven = true; // the mounted carriage is coupled to the card reader
    this.laceMode = false; // true = bed locked to the Lace carriage

    // Bed needle labels: Center 0, Left 1..100 (L1..L100), Right 1..100 (R1..R100)
    this.needleLabels = [];
    for (let i = 0; i < totalNeedles; i++) {
      const idxFromCenter = i - Math.floor(totalNeedles / 2);
      if (idxFromCenter < 0) {
        this.needleLabels.push(`L${Math.abs(idxFromCenter)}`);
      } else if (idxFromCenter === 0) {
        this.needleLabels.push('0');
      } else {
        this.needleLabels.push(`R${idxFromCenter}`);
      }
    }
  }

  /**
   * Sets current punchcard row pattern bits (24 bits)
   */
  setPunchcardRow(bits24) {
    if (bits24 && (!Array.isArray(bits24) || bits24.length < this.repeatLength)) {
      log.warn('setPunchcardRow given fewer bits than the repeat length — missing tracks read as unpunched', {
        given: bits24?.length, repeatLength: this.repeatLength,
      });
    }
    for (let i = 0; i < this.repeatLength; i++) {
      this.punchcardPins[i] = Boolean(bits24 && bits24[i]);
    }
    this.recalculateKinematics();
  }

  /**
   * Updates carriage position across the needle bed and recalculates mechanical linkage.
   *
   * `explicitDirection` (+1 / -1) exists because inferring the travel direction by
   * comparing positions silently breaks at the ends of the bed: the position gets
   * clamped to the limit, so `new >= prev` reads as "moving right" and overwrites
   * the reversal the caller had just decided on. The auto-sweep used to park the
   * carriage at the right-hand stop and flicker there forever.
   *
   * @param {number} posNeedle needle index along the bed
   * @param {number|null} explicitDirection +1 left-to-right, -1 right-to-left, or null to infer
   */
  setCarriagePosition(posNeedle, explicitDirection = null) {
    const prevPos = this.carriagePosition;
    this.carriagePosition = Math.max(0, Math.min(this.totalNeedles - 1, posNeedle));
    if (explicitDirection === 1 || explicitDirection === -1) {
      this.carriageDirection = explicitDirection;
    } else if (this.carriagePosition !== prevPos) {
      // Only re-derive when the needle actually moved; a no-op must not flip it.
      this.carriageDirection = this.carriagePosition > prevPos ? 1 : -1;
    }
    this.recalculateKinematics();
  }

  /**
   * Whether a carriage may be seated right now, and the physical reason it may not.
   * @param {string} type 'lace' | 'knit' | 'garter'
   */
  canMountCarriage(type) {
    if (!this.carriageTypes.includes(type)) {
      return { ok: false, reason: `There is no ${type} carriage for this bed.` };
    }
    if (this.laceMode && type !== 'lace') {
      return { ok: false, reason: 'The machine is rigged for lace — only the Lace carriage can be connected.' };
    }
    return { ok: true, reason: '' };
  }

  /**
   * Seat exactly one carriage, ejecting whatever was on the bed before it.
   *
   * The bay cannot hold two carriages, so mounting a new one always displaces the
   * old one, and the timing belt re-couples to the carriage now riding the bed —
   * the card drum is driven off the mounted carriage, never off a parked one.
   *
   * @param {string} type 'lace' | 'knit' | 'garter'
   * @param {{force?: boolean}} [options] force bypasses the lace-mode lock
   * @returns {{ok:boolean, blocked:boolean, mounted:string, ejected:string|null, reason:string}}
   */
  mountCarriage(type, { force = false } = {}) {
    const verdict = force ? { ok: true, reason: '' } : this.canMountCarriage(type);
    if (!verdict.ok) {
      log.warn('carriage mounting blocked by the single-carriage / lace-mode rule', {
        requested: type, mounted: this.mountedCarriage, laceMode: this.laceMode, reason: verdict.reason,
      });
      return { ok: false, blocked: true, mounted: this.mountedCarriage, ejected: null, reason: verdict.reason };
    }
    if (!this.carriageTypes.includes(type)) return { ok: false, blocked: true, mounted: this.mountedCarriage, ejected: null, reason: verdict.reason };
    const ejected = this.mountedCarriage === type ? null : this.mountedCarriage;
    this.mountedCarriage = type;
    this.beltDriven = true;
    this.recalculateKinematics();
    return { ok: true, blocked: false, mounted: type, ejected, reason: '' };
  }

  /**
   * Rig the machine for lace (or take it off lace).
   *
   * Engaging lace mode locks the bed to the Lace carriage: the knit and garter
   * carriages can no longer be connected, and if another carriage was riding the
   * bed it is ejected so the Lace carriage takes over. Disengaging leaves whichever
   * carriage is currently mounted in place; the operator then swaps by hand.
   *
   * @param {boolean} on
   */
  setLaceMode(on) {
    this.laceMode = Boolean(on);
    if (this.laceMode && this.mountedCarriage !== 'lace') {
      return this.mountCarriage('lace', { force: true });
    }
    this.recalculateKinematics();
    return { ok: true, blocked: false, mounted: this.mountedCarriage, ejected: null, reason: '' };
  }

  /** A read-only snapshot of the bay for the UI and the simulator overlay. */
  getCarriageState() {
    return {
      mounted: this.mountedCarriage,
      laceMode: this.laceMode,
      beltDriven: Boolean(this.mountedCarriage) && this.beltDriven,
      available: [...this.carriageTypes],
      parked: this.carriageTypes.filter(t => t !== this.mountedCarriage)
    };
  }

  /**
   * Move the carriage by `deltaNeedles`, bouncing off both bed stops.
   *
   * This is the one place allowed to reverse the carriage, and it returns whether
   * a reversal happened so the caller can index the punchcard. A real machine
   * advances the card one row at the end of every pass, in either direction.
   *
   * @param {number} deltaNeedles signed movement in needle pitches
   * @returns {0|1|-1} 0 = no reversal, +/-1 = a pass just completed
   */
  stepCarriage(deltaNeedles) {
    const max = this.totalNeedles - 1;
    let pos = this.carriagePosition + deltaNeedles;
    let reversed = 0;

    if (pos >= max) {
      pos = max;
      if (this.carriageDirection > 0) reversed = 1;
      this.carriageDirection = -1;
    } else if (pos <= 0) {
      pos = 0;
      if (this.carriageDirection < 0) reversed = -1;
      this.carriageDirection = 1;
    }

    this.carriagePosition = pos;
    this.recalculateKinematics();
    return reversed;
  }

  /**
   * Evaluates the mechanical cam and bar kinematics for the current position
   */
  recalculateKinematics() {
    const X = this.carriagePosition;
    // Spiral cam rotation angle in radians
    const camAngle = (X * 2 * Math.PI) / this.repeatLength;

    // 1. Calculate displacement of each of the 8 selector bars
    for (let b = 0; b < this.numSelectorBars; b++) {
      // Phase offset for bar b
      const phase = (b * 2 * Math.PI) / this.numSelectorBars;
      // Spiral cam ramp function
      const camRamp = Math.sin(camAngle + phase);

      // Determine which punchcard track is currently linked to bar b
      const repeatGroup = Math.floor(X / this.numSelectorBars);
      const trackIndex = (b + repeatGroup * this.numSelectorBars) % this.repeatLength;
      const isHolePunched = this.punchcardPins[trackIndex];

      // If hole is punched, pin transmits motion to bar b
      this.barDisplacements[b] = isHolePunched ? Math.max(0, camRamp * 3.5) : 0;
    }

    // 2. Evaluate hook engagement for each of the 200 needles
    // The state a *selected* needle is raised into depends on which carriage is on
    // the bed. A Lace carriage pushes punched needles all the way out to holding
    // position ('E_POS') ready to receive a transferred loop; a Knit (or Garter)
    // carriage only raises them into the working cam channel ('D_POS') to catch
    // yarn. Unselected needles rest at 'B_POS' either way.
    const selectedState = this.mountedCarriage === 'lace' ? 'E_POS' : 'D_POS';
    for (let n = 0; n < this.totalNeedles; n++) {
      const assignedBar = n % this.numSelectorBars;
      const assignedTrack = n % this.repeatLength;
      const isSelectedByCard = this.punchcardPins[assignedTrack];

      // Proximity to carriage: Carriage cams only actuate needles within carriage gate span (+/- 14 needles)
      const distFromCarriage = Math.abs(n - X);
      if (distFromCarriage <= 12) {
        // Active carriage cam interaction
        if (isSelectedByCard) {
          // Needle selected: raised by the mounted carriage (holding for lace,
          // working cam channel for a knit carriage).
          this.needleStates[n] = selectedState;
        } else {
          // Unselected: pulled down by hook bar (B position)
          this.needleStates[n] = 'B_POS';
        }
      } else {
        // Outside carriage: resting position
        this.needleStates[n] = isSelectedByCard ? selectedState : 'B_POS';
      }
    }
  }

  /**
   * Returns complete telemetry and diagnosis of the Brother KH-830 mechanism
   */
  getMechanismTelemetry() {
    const activeTrack = Math.floor(this.carriagePosition) % this.repeatLength;
    const activeBar = Math.floor(this.carriagePosition) % this.numSelectorBars;

    let selectedCount = 0;
    for (let n = 0; n < this.totalNeedles; n++) {
      if (this.needleStates[n] === 'D_POS' || this.needleStates[n] === 'E_POS') selectedCount++;
    }

    return {
      carriageNeedle: Math.round(this.carriagePosition),
      carriageLabel: this.needleLabels[Math.round(this.carriagePosition)],
      carriageDirection: this.carriageDirection > 0 ? 'LEFT_TO_RIGHT (→)' : 'RIGHT_TO_LEFT (←)',
      activeTrack,
      activeBar,
      totalWorkingNeedles: selectedCount,
      totalPulledDown: this.totalNeedles - selectedCount,
      pinStates: [...this.punchcardPins],
      barDisplacements: Array.from(this.barDisplacements),
      // The bay is a physical constraint, so it belongs in the readout: which one
      // carriage is on the bed, whether it is driving the belt, and whether the
      // machine is locked into the lace setup.
      carriage: this.getCarriageState()
    };
  }
}
