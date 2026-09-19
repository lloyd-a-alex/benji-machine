/**
 * Industrial Lace Action Sequence Compiler & Graph Decompiler
 * 
 * Solves the high-level knitting machine lace decomposition problem:
 * Converts high-level lace pattern charts (eyelets, left/right decreases,
 * double transfers, cables) into physically valid carriage passes
 * for Brother (separated L/K carriage) and Silver Reed (combined) machines.
 * 
 * Formalized as a DAG (Directed Acyclic Graph) scheduling problem with:
 * 1. Directional transfer cam invariants:
 *      sign(TransferOffset) == sign(CarriageVelocity)
 * 2. Spatial needle collision invariants:
 *      No simultaneous read/write race conditions on adjacent needles
 * 3. Carriage physical traverse continuity:
 *      Carriage position parity p_{k+1} = -p_k
 * 4. Automatic insertion of idle return passes & plain yarn rows
 */

import { STITCH_TYPE } from '../math/knit-topology.js';

export const CARRIAGE_TYPE = {
  LACE: 'LACE',       // Transfer carriage (Brother LC-2, etc.)
  KNIT: 'KNIT',       // Yarn knitting carriage (K-carriage)
  COMBINED: 'COMB'    // Silver Reed simultaneous transfer & knit
};

export const DIRECTION = {
  LEFT_TO_RIGHT: 'L_TO_R', // Carriage moving Right (x increases)
  RIGHT_TO_LEFT: 'R_TO_L'  // Carriage moving Left (x decreases)
};

/**
 * Single transfer operation in the dependency graph
 */
export class TransferOp {
  constructor(id, row, sourceCol, targetCol, direction, stitchType) {
    this.id = id;
    this.row = row;
    this.sourceCol = sourceCol;
    this.targetCol = targetCol;
    this.direction = direction; // DIRECTION.L_TO_R (target > source) or R_TO_L (target < source)
    this.stitchType = stitchType;
    this.dependencies = [];    // Operations that MUST precede this one
    this.assignedPass = null;  // Pass index assigned by scheduler
  }
}

/**
 * Physical carriage stroke in the execution schedule
 */
export class CarriageStroke {
  constructor(strokeIndex, carriageType, direction, cardRowIndex = 0) {
    this.strokeIndex = strokeIndex;
    this.carriageType = carriageType; // CARRIAGE_TYPE.LACE or KNIT
    this.direction = direction;       // DIRECTION.L_TO_R or R_TO_L
    this.cardRowIndex = cardRowIndex; // Which row of the physical punchcard is read
    this.transfers = [];              // Array of TransferOp executed in this pass
    this.punchcardHoles = [];         // Array of column indices punched for this pass
    this.needleBedState = [];         // Snapshot of stitches on needles [0..numCols-1]
    this.notes = '';
  }
}

/**
 * Compilation Result containing the full intermediate representation,
 * generated punchcard bitmask, and validation diagnostics.
 */
export class LaceCompilationResult {
  constructor() {
    this.success = true;
    this.strokes = [];
    this.cardMatrix = [];       // 2D boolean array [row][col] true = punch hole
    this.totalPasses = 0;
    this.totalLacePasses = 0;
    this.totalKnitPasses = 0;
    this.diagnostics = [];      // Warnings & error messages
    this.rowMapping = [];       // Maps original pattern rows to punchcard card rows
  }

  addWarning(msg, row = null, col = null) {
    this.diagnostics.push({ type: 'warning', message: msg, row, col });
  }

  addError(msg, row = null, col = null) {
    this.success = false;
    this.diagnostics.push({ type: 'error', message: msg, row, col });
  }
}

/**
 * Main Industrial Lace Compiler
 */
export class LaceCompiler {
  constructor(machineProfile) {
    this.profile = machineProfile;
  }

  setProfile(profile) {
    this.profile = profile;
  }

  /**
   * Compiles a high-level stitch matrix into physical punchcard rows and carriage passes.
   * 
   * @param {Array<Array<string>>} stitchMatrix - 2D matrix of STITCH_TYPE strings
   * @param {Object} options - Compiler configuration flags
   * @returns {LaceCompilationResult}
   */
  compile(stitchMatrix, options = {}) {
    const result = new LaceCompilationResult();
    const rows = stitchMatrix.length;
    const cols = stitchMatrix[0]?.length || 24;

    const carriageRule = this.profile.carriageRules?.type || 'brother_separated';
    const isBrotherSeparated = carriageRule === 'brother_separated' || carriageRule === 'brother_bulky' || carriageRule === 'toyota_simplex';

    // Track simulated needle bed state: array of number of loops on each needle
    // 1 = normal single loop, 0 = empty needle, 2 = double loop (decrease)
    let currentBed = new Array(cols).fill(1);
    let currentCarriageSide = 'LEFT'; // Standard starting position on the left
    let strokeCount = 0;
    let cardRowCounter = 0;

    // Process pattern row by row from bottom (cast-on) upwards
    for (let r = 0; r < rows; r++) {
      const patternRow = stitchMatrix[r];
      const transferOps = [];

      // 1. Identify all required transfer operations for this row
      for (let c = 0; c < cols; c++) {
        const stitch = patternRow[c];

        if (stitch === STITCH_TYPE.TRANSFER_LEFT) {
          const target = c - 1;
          if (target < 0) {
            result.addWarning(`Transfer Left at edge col ${c} wraps or drops stitch.`, r, c);
          } else {
            transferOps.push(new TransferOp(
              `T_${r}_${c}_L`, r, c, target, DIRECTION.RIGHT_TO_LEFT, stitch
            ));
          }
        } else if (stitch === STITCH_TYPE.TRANSFER_RIGHT) {
          const target = c + 1;
          if (target >= cols) {
            result.addWarning(`Transfer Right at edge col ${c} wraps or drops stitch.`, r, c);
          } else {
            transferOps.push(new TransferOp(
              `T_${r}_${c}_R`, r, c, target, DIRECTION.LEFT_TO_RIGHT, stitch
            ));
          }
        } else if (stitch === STITCH_TYPE.EYELET) {
          // In machine lace, an eyelet is formed by transferring the loop to an adjacent needle.
          // By convention, if not specified, eyelet transfers to the right if c is even, left if odd,
          // or user specifies companion decrease. Check if adjacent column is a decrease.
          const hasLeftDecrease = (c > 0 && patternRow[c - 1] === STITCH_TYPE.TRANSFER_LEFT);
          const hasRightDecrease = (c < cols - 1 && patternRow[c + 1] === STITCH_TYPE.TRANSFER_RIGHT);

          if (!hasLeftDecrease && !hasRightDecrease) {
            // Implicit eyelet: transfer needle c to needle c + 1 to leave needle c empty
            const target = (c + 1 < cols) ? c + 1 : c - 1;
            const dir = (target > c) ? DIRECTION.LEFT_TO_RIGHT : DIRECTION.RIGHT_TO_LEFT;
            transferOps.push(new TransferOp(
              `EYE_${r}_${c}`, r, c, target, dir, STITCH_TYPE.TRANSFER_RIGHT
            ));
          }
        } else if (stitch === STITCH_TYPE.CENTER_DEC || stitch === STITCH_TYPE.DOUBLE_DEC_LEFT) {
          // Double decrease requires two transfers: left loop into center, right loop into center
          if (c > 0) {
            transferOps.push(new TransferOp(
              `DD_${r}_${c}_L`, r, c - 1, c, DIRECTION.LEFT_TO_RIGHT, STITCH_TYPE.TRANSFER_RIGHT
            ));
          }
          if (c < cols - 1) {
            transferOps.push(new TransferOp(
              `DD_${r}_${c}_R`, r, c + 1, c, DIRECTION.RIGHT_TO_LEFT, STITCH_TYPE.TRANSFER_LEFT
            ));
          }
        }
      }

      // If no transfers needed on this row, it's a plain knit row
      if (transferOps.length === 0) {
        // Just knit plain rows with yarn carriage
        const nextSide = (currentCarriageSide === 'LEFT') ? 'RIGHT' : 'LEFT';
        const dir = (currentCarriageSide === 'LEFT') ? DIRECTION.LEFT_TO_RIGHT : DIRECTION.RIGHT_TO_LEFT;
        
        const stroke = new CarriageStroke(strokeCount++, CARRIAGE_TYPE.KNIT, dir, cardRowCounter);
        stroke.notes = `Plain knit row ${r + 1}`;
        stroke.needleBedState = [...currentBed];
        result.strokes.push(stroke);
        currentCarriageSide = nextSide;

        // Card row for plain knit (all unpunched / blank)
        result.cardMatrix.push(new Array(cols).fill(false));
        result.rowMapping.push({ patternRow: r, cardStartRow: cardRowCounter, cardEndRow: cardRowCounter });
        cardRowCounter++;
        continue;
      }

      // 2. Build Dependency Graph (DAG) for conflicting transfer operations
      // Conflict Case A: Operations going in opposite directions cannot be in same pass
      // Conflict Case B: Cascading transfers (e.g. needle i -> i+1 and i+1 -> i+2)
      // Conflict Case C: Two operations transferring onto the same needle in the same pass
      const rightOps = transferOps.filter(op => op.direction === DIRECTION.LEFT_TO_RIGHT);
      const leftOps = transferOps.filter(op => op.direction === DIRECTION.RIGHT_TO_LEFT);

      // Multi-pass schedule generation
      const cardStartThisRow = cardRowCounter;

      if (isBrotherSeparated) {
        // BROTHER FASHION LACE COMPILATION RULES:
        // Lace Carriage (L) must execute transfers in passes.
        // Brother transfer cams transfer in the DIRECTION the carriage moves!
        // To transfer to the RIGHT (L->R), carriage must move Left to Right.
        // To transfer to the LEFT (R->L), carriage must move Right to Left.
        
        // Pass scheduling loop:
        let pendingOps = [...transferOps];
        let passIteration = 0;

        while (pendingOps.length > 0 && passIteration < 16) {
          passIteration++;
          const requiredDirection = (currentCarriageSide === 'LEFT') ? DIRECTION.LEFT_TO_RIGHT : DIRECTION.RIGHT_TO_LEFT;
          
          // Filter candidate ops that match carriage velocity direction
          const candidateOps = pendingOps.filter(op => op.direction === requiredDirection);

          // Check spatial non-collision among candidates
          const selectedOps = [];
          const occupiedSources = new Set();
          const occupiedTargets = new Set();

          for (const op of candidateOps) {
            // Cannot read from empty needle or a needle already transferred in this stroke
            if (occupiedSources.has(op.sourceCol) || occupiedTargets.has(op.sourceCol)) {
              continue;
            }
            // Cannot write into a needle that is already a target in this stroke
            if (occupiedTargets.has(op.targetCol)) {
              continue;
            }

            selectedOps.push(op);
            occupiedSources.add(op.sourceCol);
            occupiedTargets.add(op.targetCol);
          }

          // Create punchcard row for this carriage pass
          // On Brother lace cards: A hole selects a needle for transfer!
          const cardHoles = new Array(cols).fill(false);
          for (const op of selectedOps) {
            cardHoles[op.sourceCol] = true;
          }

          const stroke = new CarriageStroke(strokeCount++, CARRIAGE_TYPE.LACE, requiredDirection, cardRowCounter);
          stroke.transfers = selectedOps;
          stroke.punchcardHoles = selectedOps.map(op => op.sourceCol);

          // Apply transfers to simulated needle bed
          for (const op of selectedOps) {
            if (currentBed[op.sourceCol] > 0) {
              currentBed[op.sourceCol]--;
              currentBed[op.targetCol]++;
            } else {
              result.addWarning(`Carriage attempted transfer from already empty needle col ${op.sourceCol}`, r, op.sourceCol);
            }
          }

          stroke.needleBedState = [...currentBed];
          if (selectedOps.length > 0) {
            stroke.notes = `L-Carriage ${requiredDirection === DIRECTION.LEFT_TO_RIGHT ? 'L→R' : 'R←L'}: Transfer ${selectedOps.length} stitches (${selectedOps.map(o => `${o.sourceCol}→${o.targetCol}`).join(', ')})`;
          } else {
            stroke.notes = `L-Carriage return stroke (${requiredDirection === DIRECTION.LEFT_TO_RIGHT ? 'L→R' : 'R←L'}) to reposition carriage`;
          }

          result.strokes.push(stroke);
          result.cardMatrix.push(cardHoles);
          cardRowCounter++;

          // Remove completed ops
          pendingOps = pendingOps.filter(op => !selectedOps.includes(op));
          currentCarriageSide = (currentCarriageSide === 'LEFT') ? 'RIGHT' : 'LEFT';
        }

        if (pendingOps.length > 0) {
          result.addError(`Could not resolve lace transfer dependencies within 16 passes at row ${r + 1}. Cyclic dependency detected.`, r);
        }

        // Return L-Carriage to parked side (LEFT side) if needed
        if (currentCarriageSide !== 'LEFT') {
          const stroke = new CarriageStroke(strokeCount++, CARRIAGE_TYPE.LACE, DIRECTION.RIGHT_TO_LEFT, cardRowCounter);
          stroke.notes = 'L-Carriage idle return to left park position';
          stroke.needleBedState = [...currentBed];
          result.strokes.push(stroke);
          result.cardMatrix.push(new Array(cols).fill(false)); // Blank row
          cardRowCounter++;
          currentCarriageSide = 'LEFT';
        }

        // Now Knit Carriage (K) knits plain rows with yarn (standard: 2 plain knit passes)
        const plainRowsCount = this.profile.carriageRules?.minPlainRowsAfterLace || 2;
        for (let p = 0; p < plainRowsCount; p++) {
          const kDir = (p % 2 === 0) ? DIRECTION.LEFT_TO_RIGHT : DIRECTION.RIGHT_TO_LEFT;
          const kStroke = new CarriageStroke(strokeCount++, CARRIAGE_TYPE.KNIT, kDir, cardRowCounter);
          kStroke.notes = `K-Carriage knit plain row with yarn (${kDir === DIRECTION.LEFT_TO_RIGHT ? 'L→R' : 'R←L'})`;
          
          // Needles replenished with new yarn loops
          currentBed = new Array(cols).fill(1);
          kStroke.needleBedState = [...currentBed];
          result.strokes.push(kStroke);

          // Blank rows on punchcard for plain knitting
          result.cardMatrix.push(new Array(cols).fill(false));
          cardRowCounter++;
        }

      } else {
        // SILVER REED COMBINED LACE RULES:
        // LC-1 Carriage transfers and knits simultaneously.
        // Requires separate passes for right vs left transfers, but knits yarn on the fly.
        if (rightOps.length > 0) {
          const cardHoles = new Array(cols).fill(false);
          for (const op of rightOps) cardHoles[op.sourceCol] = true;
          const stroke = new CarriageStroke(strokeCount++, CARRIAGE_TYPE.COMBINED, DIRECTION.LEFT_TO_RIGHT, cardRowCounter);
          stroke.transfers = rightOps;
          stroke.notes = `Silver Reed Lace LC: Knit & Transfer Right (${rightOps.length} stitches)`;
          result.strokes.push(stroke);
          result.cardMatrix.push(cardHoles);
          cardRowCounter++;
        }

        if (leftOps.length > 0) {
          const cardHoles = new Array(cols).fill(false);
          for (const op of leftOps) cardHoles[op.sourceCol] = true;
          const stroke = new CarriageStroke(strokeCount++, CARRIAGE_TYPE.COMBINED, DIRECTION.RIGHT_TO_LEFT, cardRowCounter);
          stroke.transfers = leftOps;
          stroke.notes = `Silver Reed Lace LC: Knit & Transfer Left (${leftOps.length} stitches)`;
          result.strokes.push(stroke);
          result.cardMatrix.push(cardHoles);
          cardRowCounter++;
        }
      }

      result.rowMapping.push({
        patternRow: r,
        cardStartRow: cardStartThisRow,
        cardEndRow: cardRowCounter - 1
      });
    }

    result.totalPasses = result.strokes.length;
    result.totalLacePasses = result.strokes.filter(s => s.carriageType === CARRIAGE_TYPE.LACE).length;
    result.totalKnitPasses = result.strokes.filter(s => s.carriageType === CARRIAGE_TYPE.KNIT).length;

    return result;
  }

  /**
   * Compiles Standard Jacquard / Fair Isle / Tuck / Slip patterns directly to punchcard
   * In Jacquard/Tuck/Slip: 1 pattern row = 1 punchcard row = 1 carriage pass!
   */
  compileDirectPattern(stitchOrColorMatrix, mode = 'fair_isle') {
    const rows = stitchOrColorMatrix.length;
    const cols = stitchOrColorMatrix[0]?.length || 24;
    const result = new LaceCompilationResult();

    for (let r = 0; r < rows; r++) {
      const cardHoles = new Array(cols).fill(false);
      for (let c = 0; c < cols; c++) {
        const val = stitchOrColorMatrix[r][c];

        if (mode === 'fair_isle') {
          // In Fair Isle: punched hole = Contrast Yarn B; unpunched = Main Yarn A
          cardHoles[c] = (val === 1 || val === true || val === 'B' || val === STITCH_TYPE.KNIT);
        } else if (mode === 'tuck') {
          // In Tuck: unpunched = tuck (holds loop); punched = plain knit
          cardHoles[c] = (val === STITCH_TYPE.KNIT || val === 1);
        } else if (mode === 'slip') {
          // In Slip: unpunched = slip (yarn floats); punched = plain knit
          cardHoles[c] = (val === STITCH_TYPE.KNIT || val === 1);
        }
      }
      result.cardMatrix.push(cardHoles);
      
      const dir = (r % 2 === 0) ? DIRECTION.LEFT_TO_RIGHT : DIRECTION.RIGHT_TO_LEFT;
      const stroke = new CarriageStroke(r, CARRIAGE_TYPE.KNIT, dir, r);
      stroke.punchcardHoles = cardHoles.map((h, i) => h ? i : null).filter(i => i !== null);
      stroke.notes = `Carriage pass row ${r + 1} (${mode.toUpperCase()})`;
      result.strokes.push(stroke);
    }

    result.totalPasses = rows;
    result.totalKnitPasses = rows;
    return result;
  }
}
