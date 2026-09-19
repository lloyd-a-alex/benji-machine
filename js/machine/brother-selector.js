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
 */

export class BrotherSelectorMechanism {
  constructor(totalNeedles = 200, repeatLength = 24, numSelectorBars = 8) {
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
    for (let i = 0; i < this.repeatLength; i++) {
      this.punchcardPins[i] = Boolean(bits24 && bits24[i]);
    }
    this.recalculateKinematics();
  }

  /**
   * Updates carriage position across the needle bed and recalculates mechanical linkage
   */
  setCarriagePosition(posNeedle) {
    const prevPos = this.carriagePosition;
    this.carriagePosition = Math.max(0, Math.min(this.totalNeedles - 1, posNeedle));
    this.carriageDirection = (this.carriagePosition >= prevPos) ? 1 : -1;
    this.recalculateKinematics();
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
    for (let n = 0; n < this.totalNeedles; n++) {
      const assignedBar = n % this.numSelectorBars;
      const assignedTrack = n % this.repeatLength;
      const isSelectedByCard = this.punchcardPins[assignedTrack];

      // Proximity to carriage: Carriage cams only actuate needles within carriage gate span (+/- 14 needles)
      const distFromCarriage = Math.abs(n - X);
      if (distFromCarriage <= 12) {
        // Active carriage cam interaction
        if (isSelectedByCard) {
          // Needle selected: butt raised into carriage cam channel (D position)
          this.needleStates[n] = 'D_POS';
        } else {
          // Unselected: pulled down by hook bar (B position)
          this.needleStates[n] = 'B_POS';
        }
      } else {
        // Outside carriage: resting position
        this.needleStates[n] = isSelectedByCard ? 'D_POS' : 'B_POS';
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
      if (this.needleStates[n] === 'D_POS') selectedCount++;
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
      barDisplacements: Array.from(this.barDisplacements)
    };
  }
}
