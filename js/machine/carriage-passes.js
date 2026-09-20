/**
 * What the carriage actually does, pass by pass.
 *
 * A chart says *what* the fabric should look like. This module says *how many
 * times you have to push a carriage across the bed to get there*, which is the
 * part a knitter cannot fake: get the pass count wrong and the stitches do not
 * move, or they move the wrong way, or the punchcard drifts out of step halfway
 * through the repeat.
 *
 * ── The three-pass reality of a Brother lace carriage ───────────────────────
 * A lace carriage does not transfer a needle the first time it goes over it. A
 * transfer row is really:
 *
 *   1. SELECT    the carriage crosses and the punched holes tip the chosen
 *                needles out to holding position. Nothing moves yet.
 *   2. TRANSFER  the carriage comes back the other way, and the needles sitting
 *                in holding position are pushed sideways — in the direction the
 *                carriage is travelling. This is why a leftward transfer must be
 *                done on a right-to-left pass, and why one operation can only
 *                ever move stitches one way.
 *   3. COMPLETE  one more pass to finish the function and release the needles,
 *                before the knitting carriage is put on to feed yarn.
 *
 * Which side the operation ends on follows from the pass count, and the carriage
 * has to finish parked on the LEFT, because that is where the knitting carriage
 * picks up. So the planner adds a short idle traverse when the arithmetic would
 * otherwise leave it on the right: a full single-direction transfer row on a
 * Brother is normally four passes of the L carriage, not the one pass a naive
 * compiler emits.
 *
 * ── Double bed is a different machine, not a different setting ──────────────
 * On a ribber/E6000 a hole is made by taking the stitch onto the OPPOSED bed and
 * bringing it back one needle over — the bed slides sideways, which is called
 * racking. The whole bed racks together, so every transfer in one row must share
 * one rack value: two stitches that need to lean opposite ways are two rows, not
 * one row with two symbols. `planDoubleBedHole` and `validateRackRow` model that,
 * and `occupancyAfterTransfers` gives the needle-by-needle loop count that a
 * double-bed editor shows as its occupancy view (one needle empty, its neighbour
 * holding two, and three where two fans meet).
 *
 * ── Honesty rule ────────────────────────────────────────────────────────────
 * Where a profile does not state its mechanics, the corresponding field comes
 * back `null` and `modelled` goes false, so the UI can say "this is assumed"
 * instead of presenting a guess as a fact about somebody's machine.
 */

import { STITCH_TYPE } from '../math/knit-topology.js';

export const PASS_PURPOSE = {
  POSITION: 'position', // idle traverse to get the carriage onto the right side
  SELECT: 'select', // punches read, needles come out to holding position
  TRANSFER: 'transfer', // loops slide sideways in the direction of travel
  COMPLETE: 'complete', // finishes the function and releases the needles
  RETURN: 'return', // idle traverse home to the left park
  KNIT: 'knit' // yarn carriage feeds a plain row
};

export const SIDE = { LEFT: 'LEFT', RIGHT: 'RIGHT' };

const DIRECTION_NAMES = { L_TO_R: 'L_TO_R', R_TO_L: 'R_TO_L' };

/** Left park means a pass starting there travels rightwards. */
export function directionFromSide(side) {
  return side === SIDE.RIGHT ? DIRECTION_NAMES.R_TO_L : DIRECTION_NAMES.L_TO_R;
}

export function sideAfterPass(side, direction) {
  const goingRight = direction === DIRECTION_NAMES.L_TO_R;
  return goingRight ? SIDE.RIGHT : SIDE.LEFT;
}

export function oppositeDirection(direction) {
  return direction === DIRECTION_NAMES.L_TO_R ? DIRECTION_NAMES.R_TO_L : DIRECTION_NAMES.L_TO_R;
}

/**
 * The mechanics each carriage *family* works by, so six profiles cannot drift
 * into six slightly different stories.
 *
 * The `brother_*` / `toyota_*` rows are the separated L + K carriage scheme, described
 * by the owner of a Brother LC-2 on a KH-830: "it selects the needles on the first
 * pass by bringing them out, then on the second pass in the opposite direction it
 * moves the stitches in the direction that the carriage is moving ... you need an
 * extra pass of the lace carriage to complete the function before having the main
 * carriage knit, and it always needs to finish on the left side." That is a first
 * hand account of real hardware, so it is safe to encode.
 *
 * The combined and pusher carriages are deliberately left unset where nobody has
 * verified the behaviour: an absent field becomes `null`, which becomes a visible
 * assumption in the UI rather than a quiet invention.
 */
const TYPE_MECHANICS = {
  brother_separated: {
    selectsBeforeTransfer: true,
    requiresCompletionPass: true,
    transfersInCarriageDirection: true,
    knitsYarnDuringLace: false,
    parksOnSide: SIDE.LEFT,
    oneDirectionPerOperation: true
  },
  brother_bulky: {
    selectsBeforeTransfer: true,
    requiresCompletionPass: true,
    transfersInCarriageDirection: true,
    knitsYarnDuringLace: false,
    parksOnSide: SIDE.LEFT,
    oneDirectionPerOperation: true
  },
  toyota_simplex: {
    selectsBeforeTransfer: true,
    requiresCompletionPass: true,
    transfersInCarriageDirection: true,
    knitsYarnDuringLace: false,
    parksOnSide: SIDE.LEFT,
    oneDirectionPerOperation: true
  },
  // A combined carriage transfers and knits in one traverse, but nobody has said
  // how many passes its selection needs, so only what is certain is set.
  silver_reed_combined: {
    transfersInCarriageDirection: true,
    knitsYarnDuringLace: true,
    parksOnSide: SIDE.LEFT,
    oneDirectionPerOperation: true
  },
  // Two opposed beds: the movement is a cross-bed transfer plus a rack, and the
  // bed racks as one unit, so one row can only carry one rack value.
  passap_pushers: {
    transfersInCarriageDirection: true,
    knitsYarnDuringLace: true,
    parksOnSide: SIDE.LEFT,
    oneDirectionPerOperation: true
  }
};

/**
 * The mechanics a planner needs, with unknowns kept visibly unknown.
 *
 * @param {object} profile a machine profile from js/machine/profiles.js
 */
export function carriageMechanics(profile = {}) {
  const rules = profile.carriageRules || {};
  const base = TYPE_MECHANICS[rules.type] || {};
  const merged = { ...base, ...pruneNulls(rules) };
  const mechanics = {
    profileId: profile.id || null,
    beds: profile.beds ?? null,
    type: rules.type || null,
    // `null` = the profile never said, and the UI must not claim otherwise.
    selectsBeforeTransfer: readBool(merged.selectsBeforeTransfer),
    requiresCompletionPass: readBool(merged.requiresCompletionPass),
    transfersInCarriageDirection: readBool(merged.transfersInCarriageDirection),
    knitsYarnDuringLace: readBool(merged.knitsYarnDuringLace),
    parksOnSide:
      typeof merged.parksOnSide === 'string' ? merged.parksOnSide.toUpperCase() : null,
    minPlainRowsAfterLace: Number.isFinite(merged.minPlainRowsAfterLace)
      ? merged.minPlainRowsAfterLace
      : null,
    oneDirectionPerOperation: readBool(merged.oneDirectionPerOperation),
    // How far one point of rack moves the bed, in needle spaces. Double bed only.
    rackPointsPerTransfer: Number.isFinite(merged.rackPointsPerTransfer)
      ? merged.rackPointsPerTransfer
      : profile.beds === 2
        ? 1
        : null
  };
  const unknowns = Object.entries(mechanics)
    .filter(([key, value]) => value === null && key !== 'profileId' && key !== 'minPlainRowsAfterLace')
    // A single bed cannot rack, so "we don't know the rack increment" is not an
    // unknown about the machine — it does not apply.
    .filter(([key]) => key !== 'rackPointsPerTransfer' || profile.beds === 2)
    .map(([key]) => key);
  return { ...mechanics, unknowns, modelled: unknowns.length === 0 };
}

function pruneNulls(object) {
  const out = {};
  for (const [key, value] of Object.entries(object || {})) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

function readBool(value) {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Turn a row of transfers into the operations the carriage can physically do.
 *
 * One operation moves stitches one way only, so a row that leans both ways
 * becomes two operations — which is also the double-bed rule (two rack values
 * cannot be racked at once), so the same split is right on both machines.
 *
 * @param {Array<{from: number, to: number}>} transfers
 * @returns {{operations: Array, warnings: string[]}}
 */
export function splitIntoOperations(transfers = []) {
  const warnings = [];
  const groups = new Map();
  for (const transfer of transfers) {
    const delta = Math.sign(transfer.to - transfer.from) || 0;
    if (delta === 0) {
      warnings.push(`A transfer from needle ${transfer.from} to itself does nothing and was dropped.`);
      continue;
    }
    const key = delta > 0 ? DIRECTION_NAMES.L_TO_R : DIRECTION_NAMES.R_TO_L;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(transfer);
  }
  const operations = [...groups.entries()].map(([direction, list]) => ({
    direction,
    transfers: list,
    needleCount: list.length
  }));
  if (operations.length > 1) {
    warnings.push(
      `This row leans both ways (${operations.map(o => `${o.needleCount} ${o.direction === DIRECTION_NAMES.L_TO_R ? 'right' : 'left'}`).join(' and ')}), and one carriage pass only moves stitches in its own direction of travel. It becomes ${operations.length} separate operations, so ${operations.length} rows of card.`
    );
  }
  return { operations, warnings };
}

/**
 * Plan one transfer operation, pass by pass.
 *
 * @param {Array<{from: number, to: number}>} transfers all leaning the same way
 * @param {object} options
 * @param {object} options.mechanics from `carriageMechanics`
 * @param {string} options.startSide where the carriage is parked now
 * @param {number} options.cardRow first punchcard row index
 */
export function planLaceOperation(transfers = [], { mechanics = {}, startSide = SIDE.LEFT, cardRow = 0 } = {}) {
  const warnings = [];
  const assumptions = [];
  const { operations, warnings: splitWarnings } = splitIntoOperations(transfers);
  warnings.push(...splitWarnings);
  if (!operations.length) {
    return { ok: true, passes: [], operations: [], endsOn: startSide, warnings, assumptions, cardRows: 0 };
  }

  const parksOn = mechanics.parksOnSide || SIDE.LEFT;
  if (!mechanics.parksOnSide) assumptions.push('the carriage parks on the left (every punchcard machine in this library starts its knit row there)');

  const passes = [];
  let side = startSide;
  let row = cardRow;
  const addPass = (purpose, direction, list, note) => {
    const endsOn = sideAfterPass(side, direction);
    const involved = [...new Set(list.map(transfer => transfer.from))].sort((a, b) => a - b);
    passes.push({
      index: passes.length,
      purpose,
      direction,
      startSide: side,
      endsOn,
      cardRow: row,
      needles: involved,
      // Only the selecting pass reads punches. The passes after it advance the card
      // over blank rows, which is why a real lace card is one punched row with the
      // rows after it empty — and why the vertical repeat has to be a multiple of
      // the pass count.
      holes: purpose === PASS_PURPOSE.SELECT ? involved : [],
      transfers: list,
      note
    });
    side = endsOn;
    row += 1;
    return passes[passes.length - 1];
  };

  for (const operation of operations) {
    const transferDirection = operation.direction;
    // The needles have to be out in holding position before the cam can push
    // their loops, and that happens on the pass *before*, travelling the other
    // way. So the first pass of the operation has a fixed direction.
    const firstDirection =
      mechanics.selectsBeforeTransfer === false
        ? transferDirection
        : oppositeDirection(transferDirection);
    if (mechanics.selectsBeforeTransfer === null) {
      assumptions.push('the lace carriage selects on the pass before it transfers');
    }

    if (directionFromSide(side) !== firstDirection) {
      addPass(
        PASS_PURPOSE.POSITION,
        directionFromSide(side),
        [],
        'Idle traverse to bring the carriage to the side the selection pass has to start from.'
      );
    }

    if (mechanics.selectsBeforeTransfer !== false) {
      addPass(
        PASS_PURPOSE.SELECT,
        directionFromSide(side),
        operation.transfers,
        `Punched needles ${summariseNeedles(operation.transfers)} come out to holding position. Nothing moves yet.`
      );
    }

    addPass(
      PASS_PURPOSE.TRANSFER,
      transferDirection,
      operation.transfers,
      `Carriage travels ${phrase(transferDirection)}, so these loops slide that same way: ${summariseNeedles(operation.transfers)}.`
    );

    if (mechanics.requiresCompletionPass !== false) {
      if (mechanics.requiresCompletionPass === null) {
        assumptions.push('one extra pass of the lace carriage finishes the function');
      }
      addPass(
        PASS_PURPOSE.COMPLETE,
        directionFromSide(side),
        operation.transfers,
        'Completion pass: the transferred loops are laid onto their new latches and the needles are released.'
      );
    }
  }

  if (side !== parksOn) {
    addPass(
      PASS_PURPOSE.RETURN,
      directionFromSide(side),
      [],
      `Blank pass home: the lace carriage always finishes parked on the ${parksOn.toLowerCase()} side for the knitting carriage.`
    );
  }

  return {
    ok: true,
    passes,
    operations,
    startSide,
    endsOn: side,
    parksOn,
    cardRows: passes.length,
    transferPasses: passes.filter(pass => pass.purpose === PASS_PURPOSE.TRANSFER).length,
    warnings,
    assumptions: [...new Set(assumptions)]
  };
}

/**
 * Plan the passes for a whole chart.
 *
 * Rows without transfers are a single knit pass each; rows with them expand into
 * the operation sequence above, followed by the machine's mandated plain knit
 * rows. `passesPerPatternRow` is the number the vertical repeat has to be a
 * multiple of, which is what makes or breaks a punchcard lace design.
 *
 * @param {Array<Array<string>>} matrix stitch symbols, bottom (cast-on) upwards
 * @param {object} options { profile, mechanics, startSide, cardRowOffset }
 */
export function planPatternPasses(matrix = [], { profile = {}, mechanics = null, startSide = SIDE.LEFT, cardRowOffset = 0 } = {}) {
  const mech = mechanics || carriageMechanics(profile);
  const plainRows = Number.isFinite(mech.minPlainRowsAfterLace) ? mech.minPlainRowsAfterLace : 0;
  let side = startSide;
  let cardRow = cardRowOffset;
  const rows = [];
  const warnings = [];
  const assumptions = [];
  const allPasses = [];

  for (let r = 0; r < matrix.length; r++) {
    const patternRow = matrix[r] || [];
    const transfers = transfersInRow(patternRow, { cols: patternRow.length });
    if (!transfers.length) {
      const direction = directionFromSide(side);
      const pass = {
        index: allPasses.length,
        purpose: PASS_PURPOSE.KNIT,
        direction,
        startSide: side,
        endsOn: sideAfterPass(side, direction),
        cardRow,
        needles: [],
        holes: [],
        transfers: [],
        patternRow: r,
        note: `Plain knit row ${r + 1}, yarn carriage ${phrase(direction)}.`
      };
      side = pass.endsOn;
      cardRow += 1;
      allPasses.push(pass);
      rows.push({ row: r, kind: 'plain', transfers: 0, passes: [pass], passCount: 1 });
      continue;
    }

    const plan = planLaceOperation(transfers, { mechanics: mech, startSide: side, cardRow });
    warnings.push(...plan.warnings);
    assumptions.push(...plan.assumptions);
    for (const pass of plan.passes) {
      pass.patternRow = r;
      allPasses.push(pass);
    }
    side = plan.endsOn;
    cardRow += plan.cardRows;

    const knitPasses = [];
    for (let p = 0; p < plainRows; p++) {
      const direction = directionFromSide(side);
      const pass = {
        index: allPasses.length,
        purpose: PASS_PURPOSE.KNIT,
        direction,
        startSide: side,
        endsOn: sideAfterPass(side, direction),
        cardRow,
        needles: [],
        holes: [],
        transfers: [],
        patternRow: r,
        note: `Mandated plain knit row after lace (${p + 1} of ${plainRows}) so the transferred loops are knitted down.`
      };
      side = pass.endsOn;
      cardRow += 1;
      allPasses.push(pass);
      knitPasses.push(pass);
    }

    rows.push({
      row: r,
      kind: 'lace',
      transfers: transfers.length,
      passes: [...plan.passes, ...knitPasses],
      passCount: plan.passes.length + knitPasses.length,
      operations: plan.operations.length,
      assumptions: plan.assumptions
    });
  }

  const laceRows = rows.filter(entry => entry.kind === 'lace');
  const perRow = laceRows.length ? uniqueSorted(laceRows.map(entry => entry.passCount)) : [];
  if (perRow.length > 1) {
    warnings.push(
      `Lace rows take different numbers of passes (${perRow.join(', ')}), so the card advances unevenly: a fixed vertical repeat will drift out of step with the design.`
    );
  }

  return {
    ok: true,
    rows,
    passes: allPasses,
    startSide,
    endsOn: side,
    cardRows: cardRow - cardRowOffset,
    totals: {
      patternRows: matrix.length,
      laceRows: laceRows.length,
      plainRows: rows.filter(entry => entry.kind === 'plain').length,
      passes: allPasses.length,
      lacePasses: allPasses.filter(pass => pass.purpose !== PASS_PURPOSE.KNIT).length,
      knitPasses: allPasses.filter(pass => pass.purpose === PASS_PURPOSE.KNIT).length,
      passesPerLaceRow: perRow
    },
    warnings,
    assumptions: [...new Set(assumptions)],
    mechanics: mech
  };
}

/**
 * Will a card of this vertical repeat stay in step with the plan?
 *
 * The drum advances one card row per carriage pass, so if a lace row costs four
 * passes, a repeat of 24 card rows is 6 design rows and the pattern lands where
 * it was drawn. A repeat of 20 does not divide, and the design slides sideways
 * against itself from the second repeat onwards — the classic "my lace stopped
 * lining up" complaint, which is arithmetic and not a fault in the machine.
 */
export function checkCardRepeat({ verticalRepeat, passesPerLaceRow, laceRowRatio = 1 }) {
  const repeat = Math.trunc(verticalRepeat);
  const passes = Math.trunc(passesPerLaceRow);
  if (!Number.isFinite(repeat) || !Number.isFinite(passes) || repeat <= 0 || passes <= 0) {
    return { ok: false, error: 'Both the card repeat and the passes per lace row need to be whole numbers greater than zero.' };
  }
  const rowsPerRepeat = repeat / passes;
  const aligned = Number.isInteger(rowsPerRepeat);
  const designRows = aligned ? rowsPerRepeat : null;
  return {
    ok: true,
    aligned,
    repeat,
    passes,
    rowsPerRepeat,
    designRows,
    cardRowsUsed: aligned ? repeat : Math.floor(rowsPerRepeat) * passes,
    leftoverCardRows: aligned ? 0 : repeat - Math.floor(rowsPerRepeat) * passes,
    message: aligned
      ? `${repeat} card rows ÷ ${passes} passes per lace row = ${designRows} lace rows per repeat, so the card and the design stay in step.`
      : `${repeat} card rows is not a multiple of ${passes} passes per lace row: only ${Math.floor(rowsPerRepeat) * passes} of them line up and ${repeat % passes} spill, so the design will drift by ${repeat % passes} card row(s) every repeat.`
  };
}

/**
 * What a row that leans both ways really costs, honestly compared.
 *
 * The received wisdom is "put opposite transfers on separate rows", and on a double
 * bed that is not advice, it is physics: the bed racks one way at a time. On a
 * single bed both routes exist, so the tool shows the price of each instead of
 * quoting a rule — because splitting can genuinely cost *more* passes once the
 * mandated knit rows are counted, and a knitter told otherwise would distrust the
 * program the first time they counted by hand.
 *
 * @param {Array<{from: number, to: number}>} transfers
 */
export function rowCostComparison(transfers = [], { mechanics = {}, startSide = SIDE.LEFT, plainRows = 0 } = {}) {
  const asDrawn = planLaceOperation(transfers, { mechanics, startSide });
  const { operations } = splitIntoOperations(transfers);
  const separatedPlans = operations.map(operation =>
    planLaceOperation(operation.transfers, { mechanics, startSide })
  );
  const drawnPasses = asDrawn.passes.length + plainRows;
  const separatedPasses = separatedPlans.reduce((sum, plan) => sum + plan.passes.length + plainRows, 0);
  const separatedRows = Math.max(1, operations.length);
  const advice =
    operations.length < 2
      ? 'This row leans one way, so there is nothing to split.'
      : separatedPasses > drawnPasses
        ? `Keeping it as one row is ${separatedPasses - drawnPasses} pass(es) cheaper, but the mixed row must be worked as ${operations.length} separate lace operations with the needle bed knitted down between them. Splitting into ${separatedRows} rows costs ${separatedPasses - drawnPasses} extra pass(es) and ${separatedRows - 1} extra design row(s), and is the only option on a double bed.`
        : `Splitting into ${separatedRows} single-direction rows is ${drawnPasses - separatedPasses} pass(es) cheaper and one operation per row, which is also the only thing a double bed can do.`;
  return {
    asDrawn: { operations: operations.length, passes: drawnPasses, designRows: 1 },
    separated: {
      operations: operations.length,
      passes: separatedPasses,
      designRows: separatedRows,
      directions: operations.map(operation => operation.direction)
    },
    delta: { passes: separatedPasses - drawnPasses, designRows: separatedRows - 1 },
    requiredOnDoubleBed: operations.length > 1,
    advice
  };
}

// ─── reading a chart ─────────────────────────────────────────────────────────

/**
 * Every sideways loop movement a row of symbols asks for.
 *
 * Mirrors what the compiler does with the same symbols, so the pass plan and the
 * compiled card cannot tell two different stories about one chart: a transfer
 * moves its own needle, and a lone eyelet is paid for by transferring its needle
 * onto the neighbour, because a machine feeds no yarn out of thin air.
 */
export function transfersInRow(patternRow = [], { cols = patternRow.length, accountForEyelets = true } = {}) {
  const transfers = [];
  for (let c = 0; c < cols; c++) {
    const stitch = patternRow[c];
    if (stitch === STITCH_TYPE.TRANSFER_LEFT) {
      if (c - 1 >= 0) transfers.push({ from: c, to: c - 1, kind: 'transfer', stitchType: stitch });
    } else if (stitch === STITCH_TYPE.TRANSFER_RIGHT) {
      if (c + 1 < cols) transfers.push({ from: c, to: c + 1, kind: 'transfer', stitchType: stitch });
    } else if (stitch === STITCH_TYPE.DOUBLE_DEC_LEFT || stitch === STITCH_TYPE.DOUBLE_DEC_RIGHT || stitch === STITCH_TYPE.CENTER_DEC) {
      if (c - 1 >= 0) transfers.push({ from: c - 1, to: c, kind: 'transfer', stitchType: STITCH_TYPE.TRANSFER_RIGHT });
      if (c + 1 < cols) transfers.push({ from: c + 1, to: c, kind: 'transfer', stitchType: STITCH_TYPE.TRANSFER_LEFT });
    } else if (stitch === STITCH_TYPE.TRANSFER_DOUBLE_L) {
      if (c - 2 >= 0) transfers.push({ from: c, to: c - 2, kind: 'transfer', stitchType: stitch });
    } else if (stitch === STITCH_TYPE.TRANSFER_DOUBLE_R) {
      if (c + 2 < cols) transfers.push({ from: c, to: c + 2, kind: 'transfer', stitchType: stitch });
    } else if (accountForEyelets && stitch === STITCH_TYPE.EYELET) {
      const paired =
        (c > 0 && patternRow[c - 1] === STITCH_TYPE.TRANSFER_LEFT) ||
        (c < cols - 1 && patternRow[c + 1] === STITCH_TYPE.TRANSFER_RIGHT);
      if (!paired) {
        const target = c + 1 < cols ? c + 1 : c - 1;
        if (target >= 0 && target !== c) {
          transfers.push({ from: c, to: target, kind: 'implicit-eyelet', stitchType: STITCH_TYPE.EYELET });
        }
      }
    }
  }
  return dedupeTransfers(transfers);
}

/**
 * Two symbols can ask for the same movement (an eyelet next to a transfer, most
 * often). Physically it is one loop sliding once, so the plan must say so too —
 * a duplicated op would be scheduled as a collision and warned about wrongly.
 */
export function dedupeTransfers(transfers = []) {
  const seen = new Map();
  for (const transfer of transfers) {
    const key = `${transfer.from}>${transfer.to}`;
    if (seen.has(key)) {
      seen.get(key).dupes = (seen.get(key).dupes || 0) + 1;
      continue;
    }
    seen.set(key, { ...transfer });
  }
  return [...seen.values()];
}

// ─── double bed: transfer across, rack back ──────────────────────────────────

/**
 * The two movements that make one hole on two beds.
 *
 * Step 1 carries the stitch to the opposed bed with no racking, so it is sitting
 * directly opposite where it was. Step 2 brings it back while the bed is racked
 * one point, which lands it on the neighbouring needle — the source needle is now
 * empty and that neighbour holds two loops. That pair is a hole, and it costs two
 * rows.
 *
 * @param {number} direction +1 racks right, -1 racks left
 */
export function planDoubleBedHole(direction = 1, { needle = 0, rows = [0, 1] } = {}) {
  const sign = Math.sign(Math.trunc(direction)) || 1;
  return {
    rack: sign,
    rows: [...rows],
    steps: [
      {
        index: 0,
        row: rows[0],
        kind: 'cross-bed',
        rack: 0,
        from: { bed: 'front', needle },
        to: { bed: 'back', needle },
        note: 'Transfer the stitch to the needle directly opposite on the back bed. No racking yet.'
      },
      {
        index: 1,
        row: rows[1],
        kind: 'cross-bed',
        rack: sign,
        from: { bed: 'back', needle },
        to: { bed: 'front', needle: needle + sign },
        note: `Rack ${sign > 0 ? 'one point right' : 'one point left'} and transfer back to the front bed: the loop lands on needle ${needle + sign} and the source needle is left empty.`
      }
    ],
    occupancyEffect: { empty: [needle], doubled: [needle + sign] },
    rowCost: 2,
    summary: `A hole leaning ${sign > 0 ? 'right' : 'left'} costs two cross-bed rows with a ${sign > 0 ? 'right' : 'left'} one-point rack on the second.`
  };
}

/**
 * The constraint that makes or breaks a double-bed row: the bed racks as one.
 *
 * @param {Array<{needle: number, rack: number}>} transfers
 */
export function validateRackRow(transfers = []) {
  const values = uniqueSorted(transfers.map(transfer => Math.sign(transfer.rack || 0)));
  if (!transfers.length) return { ok: true, rack: 0, conflicts: [], message: 'No transfers on this row.' };
  if (values.length > 1) {
    const conflicts = transfers.filter(transfer => Math.sign(transfer.rack || 0) !== values[0]);
    return {
      ok: false,
      rack: values[0],
      conflicts,
      values,
      error: `A row can only be racked one way, because the whole bed slides together. These ${conflicts.length} transfer(s) want the other direction and have to move to their own row.`,
      message: `Mixed racking: ${values.join(' and ')}.`
    };
  }
  return {
    ok: true,
    rack: values[0],
    conflicts: [],
    values,
    message: `All ${transfers.length} transfers share a ${values[0] === 0 ? 'zero' : values[0] > 0 ? 'one-point right' : 'one-point left'} rack, so one pass does them all.`
  };
}

/**
 * Loops per needle after a set of transfers — the occupancy view.
 *
 * This is the check that catches a design mistake before the machine does: a
 * needle at 0 is a hole, a needle at 2 is the decrease you wanted, and a needle
 * at 3 in the middle of two fans is where two decrease lines have met.
 *
 * @param {number[]|number} bed starting loop counts, or a needle count for all 1s
 * @param {Array<{from: number, to: number}>} transfers
 */
export function occupancyAfterTransfers(bed, transfers = []) {
  const counts = Array.isArray(bed) ? bed.map(value => Math.trunc(value) || 0) : new Array(Math.max(0, Math.trunc(bed))).fill(1);
  const events = [];
  for (const transfer of transfers) {
    if (transfer.from < 0 || transfer.from >= counts.length) {
      events.push({ kind: 'error', needle: transfer.from, message: `Source needle ${transfer.from} is off the bed.` });
      continue;
    }
    if (transfer.to < 0 || transfer.to >= counts.length) {
      events.push({ kind: 'error', needle: transfer.to, message: `Needle ${transfer.to} is off the bed, so the stitch would drop.` });
      continue;
    }
    if (counts[transfer.from] < 1) {
      events.push({ kind: 'empty', needle: transfer.from, message: `Needle ${transfer.from} has nothing on it to transfer.` });
      continue;
    }
    counts[transfer.from] -= 1;
    counts[transfer.to] += 1;
    events.push({ kind: 'moved', from: transfer.from, to: transfer.to });
  }
  return {
    counts,
    events,
    empty: indicesWhere(counts, value => value === 0),
    doubled: indicesWhere(counts, value => value === 2),
    tripled: indicesWhere(counts, value => value >= 3),
    maxLoops: counts.length ? Math.max(...counts) : 0
  };
}

// ─── telling a human ─────────────────────────────────────────────────────────

/**
 * Plain-English pass list, for the inspector and the printed pattern notes.
 *
 * Reads the way you would narrate it standing at the machine, because that is how
 * it gets checked: "Lace carriage, left to right, nothing selected."
 */
export function describePasses(planOrPasses) {
  const passes = Array.isArray(planOrPasses) ? planOrPasses : planOrPasses?.passes || [];
  return passes.map(pass => {
    const label = PASS_VERBS[pass.purpose] || pass.purpose;
    const side = `from the ${pass.startSide.toLowerCase()}`;
    const detail = pass.needles.length ? ` — needles ${summariseNumbers(pass.needles)}` : '';
    return `Pass ${pass.index + 1}: ${label}, carriage ${phrase(pass.direction)} ${side}${detail}. ${pass.note || ''}`.trim();
  });
}

const PASS_VERBS = {
  [PASS_PURPOSE.POSITION]: 'lace carriage repositioning',
  [PASS_PURPOSE.SELECT]: 'lace carriage selecting',
  [PASS_PURPOSE.TRANSFER]: 'lace carriage transferring',
  [PASS_PURPOSE.COMPLETE]: 'lace carriage completing',
  [PASS_PURPOSE.RETURN]: 'lace carriage returning to the left park',
  [PASS_PURPOSE.KNIT]: 'knitting carriage'
};

/** "right-to-left", for prose that must agree with the compiler's constants. */
export function phrase(direction) {
  return direction === DIRECTION_NAMES.L_TO_R ? 'left to right' : 'right to left';
}

/**
 * Count what a compiled schedule really costs, from the passes that were emitted.
 *
 * Derived rather than stated separately on purpose: a summary computed from its own
 * idea of a lace row can quietly disagree with the card the compiler produced, and
 * then the printed notes lie about the machine.
 *
 * @param {Array<{patternRow?: number, purpose: string, carriageType?: string}>} strokes
 */
export function summariseStrokes(strokes = []) {
  const byRow = new Map();
  for (const stroke of strokes) {
    const key = stroke.patternRow ?? 'unmapped';
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push(stroke);
  }
  const rows = [];
  for (const [patternRow, list] of byRow) {
    const lace = list.filter(stroke => stroke.purpose && stroke.purpose !== PASS_PURPOSE.KNIT);
    rows.push({
      patternRow,
      passes: list.length,
      lacePasses: lace.length,
      knitPasses: list.length - lace.length,
      purposes: list.map(stroke => stroke.purpose || 'knit'),
      endsOn: list.length ? list[list.length - 1].endsOn || null : null
    });
  }
  rows.sort((a, b) => (Number(a.patternRow) || 0) - (Number(b.patternRow) || 0));
  const laceOnly = rows.filter(row => row.lacePasses > 0).map(row => row.passes);
  const designRowCount = new Set(strokes.map(stroke => stroke.patternRow)).size;
  // 5.7 — the old `cardRowsPerDesignRow` name promised a count but returned a ratio
  // (a fractional average). Split the honest two: the average, and the exact integer
  // only when every design row produced the *same whole* number of card rows — which
  // is the condition a repeat-check actually needs. null means "not a clean factor".
  const average = strokes.length / Math.max(1, designRowCount);
  const passCounts = rows.map(row => row.passes);
  const uniform = passCounts.length > 0 && passCounts.every(n => n === passCounts[0]);
  return {
    rows,
    passes: strokes.length,
    lacePasses: strokes.filter(stroke => stroke.purpose && stroke.purpose !== PASS_PURPOSE.KNIT).length,
    knitPasses: strokes.filter(stroke => !stroke.purpose || stroke.purpose === PASS_PURPOSE.KNIT).length,
    laceRows: laceOnly.length,
    passesPerLaceRow: uniqueSorted(laceOnly),
    // The numbers that decide whether a punched card stays in step with a design.
    averageCardRowsPerDesignRow: average,
    cardRowsPerDesignRowExact: uniform ? passCounts[0] : null
  };
}

function summariseNeedles(transfers) {
  return summariseNumbers([...new Set(transfers.map(transfer => transfer.from))].sort((a, b) => a - b));
}

/** [0,1,2,7] → "1–3, 8" in 1-based knitter numbering. */
export function summariseNumbers(sorted = []) {
  const parts = [];
  let start = null;
  let previous = null;
  for (const value of [...sorted].sort((a, b) => a - b)) {
    if (start === null) {
      start = previous = value;
      continue;
    }
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    parts.push(formatRun(start, previous));
    start = previous = value;
  }
  if (start !== null) parts.push(formatRun(start, previous));
  return parts.join(', ');
}

function formatRun(start, end) {
  return start === end ? `${start + 1}` : start === end - 1 ? `${start + 1}, ${end + 1}` : `${start + 1}–${end + 1}`;
}

function uniqueSorted(values = []) {
  return [...new Set(values.filter(value => Number.isFinite(value)))].sort((a, b) => a - b);
}

function indicesWhere(counts, test) {
  const out = [];
  for (let i = 0; i < counts.length; i++) if (test(counts[i])) out.push(i);
  return out;
}
