/**
 * Industrial CNC G-Code Generator & Toolpath Optimizer
 * 
 * Supports:
 * - Solenoid punch heads (3D printer / DIY puncher with mechanical pin actuator)
 * - Laser cutters (GRBL, Marlin, LinuxCNC M3/M5 laser power modulation)
 * - CNC routers / milling machines (canned drill cycles G81, G83 peck drilling)
 * 
 * Ordering of the holes lives in ../math/tsp-path.js - the same code the CNC
 * preview runs - so the rapid distance you see on screen is the rapid distance
 * this program will actually produce.
 */

import { calculateCardDimensions } from '../machine/profiles.js';
import { optimizeToolpath, orderColumnSweep, pathLengthMm } from '../math/tsp-path.js';
import { logger } from '../core/logging.js';

const log = logger('exporters/cnc-gcode');

/** Geometry fields the toolpath maths depends on — a missing one becomes a NaN axis. */
const REQUIRED_GEOMETRY = ['pitchX', 'pitchY', 'holeDiameter', 'sprocketDiameter', 'sprocketPitchY', 'marginSide', 'sprocketToFirstHole', 'marginTopBottom', 'cardWidth'];

export class CncGcodeExporter {
  constructor(options = {}) {
    this.options = {
      machineType: 'laser',        // 'laser', 'solenoid', 'cnc_drill'
      feedRapid: 3000,             // mm/min G00 rapid traverse
      feedPlunge: 400,             // mm/min Z plunge feed
      feedCut: 1200,               // mm/min cutting feed
      laserPower: 255,             // S-value (0-255 or 0-1000)
      safeZ: 3.0,                  // Clearance Z height in mm
      cutZ: -1.2,                  // Punch / drill plunge depth in mm
      dwellTimeMs: 150,            // Solenoid dwell time in ms
      spindleRpm: 12000,
      optimizePath: true,          // Run 2-Opt TSP optimization
      includeSprockets: true,      // Punch feed tractor pin holes
      cutCardOutline: true,        // Cut perimeter border of card
      ...options
    };
  }

  /**
   * Generates optimized G-Code program string for a punchcard bitmask
   */
  generateGCode(profile, cardMatrix) {
    // A machine profile is required — the drill coordinates come from its physical
    // geometry. Guard here so a missing profile is a clear error, not a null access.
    if (!profile || typeof profile !== 'object') {
      throw new TypeError('CncGcodeExporter.generateGCode requires a machine profile.');
    }
    const badFields = REQUIRED_GEOMETRY.filter((k) => !Number.isFinite(profile[k]));
    if (badFields.length) {
      // A missing pitch/diameter silently becomes NaN coordinates a real machine would
      // plunge to absurd positions — surface exactly which fields are broken.
      log.error('machine profile is missing non-numeric geometry fields, G-code will be malformed', { profile: profile.name || profile.id, badFields });
    }
    if (!Array.isArray(cardMatrix) || !cardMatrix.length) log.warn('generateGCode given an empty card matrix');
    let cols = cardMatrix[0]?.length || 24;
    // Machine-specific physical leader (Brother 7 vs Silver Reed 5 reading rows)
    // makes the drilled card positionally different between machines.
    const lead = profile.carriageRules?.cardReadingOffsetRows || 0;
    if (lead > 0) cardMatrix = [...Array.from({ length: lead }, () => new Array(cols).fill(false)), ...cardMatrix];
    const rows = cardMatrix.length;
    const dims = calculateCardDimensions(profile, rows, cols);

    // 1. Gather all hole coordinates (X, Y) in millimeters
    const holePoints = [];

    // Tractor sprocket holes (left and right columns, 1 per row pitch)
    if (this.options.includeSprockets) {
      for (let r = 0; r < rows; r++) {
        const y = dims.rowOffsetYMm + r * profile.sprocketPitchY;
        holePoints.push({
          x: dims.leftSprocketXMm,
          y,
          type: 'sprocket',
          radius: profile.sprocketDiameter / 2
        });
        holePoints.push({
          x: dims.rightSprocketXMm,
          y,
          type: 'sprocket',
          radius: profile.sprocketDiameter / 2
        });
      }
    }

    // Pattern punch holes
    for (let r = 0; r < rows; r++) {
      const y = dims.rowOffsetYMm + r * profile.pitchY;
      for (let c = 0; c < cols; c++) {
        if (cardMatrix[r][c]) {
          const x = dims.colOffsetXMm + c * profile.pitchX;
          holePoints.push({
            x,
            y,
            type: 'pattern_hole',
            radius: profile.holeDiameter / 2
          });
        }
      }
    }

    // 2. Path optimization.
    //    The tractor sprocket strip is fixturing, not pattern. It used to be
    //    thrown into the same TSP tour, so the optimiser could start mid-card on
    //    a feed hole and shuffle the strip out of sequence. Punch it first as
    //    straight column sweeps, then order the pattern holes with the shared
    //    nearest-neighbour + 2-opt pass.
    let orderedHoles = holePoints;
    if (this.options.optimizePath && holePoints.length > 2) {
      const sprocketPoints = holePoints.filter(p => p.type === 'sprocket');
      const patternPoints = holePoints.filter(p => p.type !== 'sprocket');
      const orderedPattern = patternPoints.length > 2
        ? optimizeToolpath(patternPoints)
        : patternPoints;
      orderedHoles = [...orderColumnSweep(sprocketPoints), ...orderedPattern];
    }
    log.debug('generated toolpath', { holes: orderedHoles.length, rapidMm: Number(pathLengthMm(orderedHoles).toFixed(1)), mode: this.options.machineType });

    // 3. Assemble G-Code program
    const gcode = [];
    const dateStr = new Date().toISOString();

    gcode.push(`; =======================================================`);
    gcode.push(`; KNITTING MACHINE PUNCHCARD CNC PROGRAM`);
    gcode.push(`; Generated: ${dateStr}`);
    gcode.push(`; Profile: ${profile.name}`);
    gcode.push(`; Dimensions: ${dims.widthMm.toFixed(2)}mm x ${dims.heightMm.toFixed(2)}mm`);
    gcode.push(`; Holes to punch: ${orderedHoles.length}`);
    gcode.push(`; Rapid traverse: ${pathLengthMm(orderedHoles).toFixed(1)}mm (from home)`);
    gcode.push(`; Path optimization: ${this.options.optimizePath ? 'NN + 2-opt' : 'source order'}`);
    gcode.push(`; Machine Mode: ${this.options.machineType.toUpperCase()}`);
    gcode.push(`; =======================================================`);
    gcode.push(`G21          ; Metric system millimeters`);
    gcode.push(`G90          ; Absolute positioning`);
    gcode.push(`G94          ; Feed rate mm/min`);
    gcode.push(`G17          ; XY circular plane`);
    gcode.push(`G54          ; Default work coordinate system`);
    gcode.push(`G00 Z${this.options.safeZ.toFixed(2)} ; Retract to safe clearance`);
    gcode.push(`G00 X0.00 Y0.00 ; Home to card origin`);

    if (this.options.machineType === 'cnc_drill') {
      gcode.push(`M03 S${this.options.spindleRpm} ; Spindle clockwise start`);
      gcode.push(`G04 P1.5     ; Wait for spindle ramp-up`);
    }

    gcode.push(`\n; --- BEGIN PUNCHING HOLES ---`);

    for (let i = 0; i < orderedHoles.length; i++) {
      const p = orderedHoles[i];
      gcode.push(`; Hole ${i + 1}/${orderedHoles.length} (${p.type})`);
      gcode.push(`G00 X${p.x.toFixed(3)} Y${p.y.toFixed(3)}`);

      if (this.options.machineType === 'laser') {
        // Laser circular pocket / perimeter cut for hole
        const r = p.radius;
        gcode.push(`G00 X${(p.x - r).toFixed(3)} Y${p.y.toFixed(3)}`);
        gcode.push(`M03 S${this.options.laserPower} ; Laser ON`);
        gcode.push(`G02 X${(p.x - r).toFixed(3)} Y${p.y.toFixed(3)} I${r.toFixed(3)} J0.000 F${this.options.feedCut}`);
        gcode.push(`M05          ; Laser OFF`);
      } else if (this.options.machineType === 'solenoid') {
        // Mechanical solenoid punch actuator
        gcode.push(`M64 P0       ; Trigger solenoid punch pin`);
        gcode.push(`G04 P${(this.options.dwellTimeMs / 1000).toFixed(3)} ; Dwell`);
        gcode.push(`M65 P0       ; Retract solenoid`);
      } else {
        // CNC Drill cycle
        gcode.push(`G01 Z${this.options.cutZ.toFixed(2)} F${this.options.feedPlunge}`);
        gcode.push(`G00 Z${this.options.safeZ.toFixed(2)}`);
      }
    }

    // 4. Perimeter boundary cut
    if (this.options.cutCardOutline) {
      gcode.push(`\n; --- PERIMETER CARD OUTLINE CUT ---`);
      gcode.push(`G00 Z${this.options.safeZ.toFixed(2)}`);
      gcode.push(`G00 X0.000 Y0.000`);

      if (this.options.machineType === 'laser') {
        gcode.push(`M03 S${this.options.laserPower}`);
      } else {
        gcode.push(`G01 Z${this.options.cutZ.toFixed(2)} F${this.options.feedPlunge}`);
      }

      gcode.push(`G01 X${dims.widthMm.toFixed(3)} Y0.000 F${this.options.feedCut}`);
      gcode.push(`G01 X${dims.widthMm.toFixed(3)} Y${dims.heightMm.toFixed(3)}`);
      gcode.push(`G01 X0.000 Y${dims.heightMm.toFixed(3)}`);
      gcode.push(`G01 X0.000 Y0.000`);

      if (this.options.machineType === 'laser') {
        gcode.push(`M05`);
      } else {
        gcode.push(`G00 Z${this.options.safeZ.toFixed(2)}`);
      }
    }

    // 5. Program End
    gcode.push(`\n; --- PROGRAM FOOTER ---`);
    if (this.options.machineType === 'cnc_drill') {
      gcode.push(`M05          ; Spindle stop`);
    }
    gcode.push(`G00 Z${this.options.safeZ.toFixed(2)}`);
    gcode.push(`G00 X0.00 Y0.00 ; Return home`);
    gcode.push(`M30          ; End of program`);

    return gcode.join('\n');
  }

  /**
   * @deprecated The ordering lives in ../math/tsp-path.js now, shared with the
   * CNC preview so the two can never disagree again. This is a thin delegation
   * left in place for any caller that still reaches for it.
   */
  optimizeHolePath2Opt(points) {
    return optimizeToolpath(points);
  }
}
