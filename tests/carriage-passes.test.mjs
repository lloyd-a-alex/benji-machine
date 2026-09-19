/**
 * The carriage mechanics the owner of a Brother LC-2 described, encoded and pinned.
 *
 * Why this file exists: a chart can be beautiful, internally consistent, and
 * physically impossible. If the program says a transfer row is one pass of the lace
 * carriage, somebody will sit at the machine doing one pass, watch nothing move, and
 * blame the machine. Every test here is a sentence about real hardware that came from
 * the person who uses one:
 *
 *   "it selects the needles on the first pass by bringing them out, then on the second
 *    pass in the opposite direction it moves the stitches in the direction that the
 *    carriage is moving"
 *   "you need an extra pass of the lace carriage to complete the function before
 *    having the main carriage knit"
 *   "it always needs to finish on the left side"
 *
 * and from a double-bed walkthrough:
 *
 *   "to create a hole we transfer the stitch to the opposite needle bed and then back
 *    to the original one with a one-point rack ... we can apply multiple transfers in
 *    the same row as long as they share the same racking value ... since the racking
 *    direction differs for each transfer, they will need to be done on separate rows".
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PASS_PURPOSE,
  SIDE,
  carriageMechanics,
  checkCardRepeat,
  dedupeTransfers,
  describePasses,
  directionFromSide,
  occupancyAfterTransfers,
  oppositeDirection,
  planDoubleBedHole,
  planLaceOperation,
  planPatternPasses,
  rowCostComparison,
  sideAfterPass,
  splitIntoOperations,
  summariseNumbers,
  summariseStrokes,
  transfersInRow,
  validateRackRow
} from '../js/machine/carriage-passes.js';
import { LaceCompiler, DIRECTION } from '../js/compiler/lace-decompiler.js';
import { STITCH_TYPE as S } from '../js/math/knit-topology.js';
import { MACHINE_PROFILES } from '../js/machine/profiles.js';

const brother = carriageMechanics(MACHINE_PROFILES.brother_standard_24);
const LEFT_OP = [{ from: 4, to: 3 }, { from: 8, to: 7 }];
const RIGHT_OP = [{ from: 4, to: 5 }, { from: 8, to: 9 }];

// ─── the arithmetic of a side ────────────────────────────────────────────────

test('a carriage starting on the left travels right, and every pass flips the side', () => {
  assert.equal(directionFromSide(SIDE.LEFT), 'L_TO_R');
  assert.equal(directionFromSide(SIDE.RIGHT), 'R_TO_L');
  assert.equal(sideAfterPass(SIDE.LEFT, 'L_TO_R'), SIDE.RIGHT);
  assert.equal(sideAfterPass(SIDE.RIGHT, 'L_TO_R'), SIDE.RIGHT, 'a pass ending mid-bed still finishes on the right');
  assert.equal(oppositeDirection(oppositeDirection('R_TO_L')), 'R_TO_L');
});

test('the constants the planner and the compiler use are the same words', () => {
  // Two spellings of "left to right" in one codebase is how schedules and prose
  // quietly stop matching each other.
  assert.equal(DIRECTION.LEFT_TO_RIGHT, 'L_TO_R');
  assert.equal(DIRECTION.RIGHT_TO_LEFT, 'R_TO_L');
  assert.equal(directionFromSide(SIDE.LEFT), DIRECTION.LEFT_TO_RIGHT);
});

// ─── one operation, pass by pass ─────────────────────────────────────────────

test('a leftward transfer row from the left park is select, transfer, complete, return', () => {
  const plan = planLaceOperation(LEFT_OP, { mechanics: brother, startSide: SIDE.LEFT });
  assert.deepEqual(
    plan.passes.map(pass => pass.purpose),
    [PASS_PURPOSE.SELECT, PASS_PURPOSE.TRANSFER, PASS_PURPOSE.COMPLETE, PASS_PURPOSE.RETURN]
  );
  assert.equal(plan.passes.length, 4, 'the three passes he described, plus the blank one home');
  assert.equal(plan.endsOn, SIDE.LEFT, 'the lace carriage always finishes on the left side');
});

test('the transfer pass travels the way the stitches move, and selection goes the other way', () => {
  const plan = planLaceOperation(LEFT_OP, { mechanics: brother, startSide: SIDE.LEFT });
  const select = plan.passes.find(pass => pass.purpose === PASS_PURPOSE.SELECT);
  const transfer = plan.passes.find(pass => pass.purpose === PASS_PURPOSE.TRANSFER);
  assert.equal(transfer.direction, DIRECTION.RIGHT_TO_LEFT, 'loops slide left on a right-to-left pass');
  assert.equal(select.direction, DIRECTION.LEFT_TO_RIGHT, 'the pass that brings them out goes the opposite way');
  assert.equal(transfer.index, select.index + 1, 'selection happens on the pass immediately before');
});

test('only the selecting pass reads punches, and the rest of the card row is blank', () => {
  const plan = planLaceOperation(LEFT_OP, { mechanics: brother });
  for (const pass of plan.passes) {
    if (pass.purpose === PASS_PURPOSE.SELECT) {
      assert.deepEqual(pass.holes, [4, 8], 'the punches are what tip these needles out');
    } else {
      assert.deepEqual(pass.holes, [], `${pass.purpose} reads a blank row`);
    }
    if (pass.purpose === PASS_PURPOSE.SELECT || pass.purpose === PASS_PURPOSE.TRANSFER || pass.purpose === PASS_PURPOSE.COMPLETE) {
      assert.deepEqual(pass.needles, [4, 8], 'the sim still needs to know which needles are involved');
    } else {
      assert.deepEqual(pass.needles, [], `${pass.purpose} is a positioning move, not a stitch move`);
    }
  }
  assert.deepEqual(
    plan.passes.map(pass => pass.cardRow),
    [0, 1, 2, 3],
    'each pass advances the card by exactly one row'
  );
});

test('wanting the other direction costs a positioning pass, not a lie', () => {
  const plan = planLaceOperation(RIGHT_OP, { mechanics: brother, startSide: SIDE.LEFT });
  assert.equal(plan.passes[0].purpose, PASS_PURPOSE.POSITION);
  assert.deepEqual(
    plan.passes.map(pass => pass.purpose),
    [PASS_PURPOSE.POSITION, PASS_PURPOSE.SELECT, PASS_PURPOSE.TRANSFER, PASS_PURPOSE.COMPLETE]
  );
  assert.equal(plan.endsOn, SIDE.LEFT, 'the extra pass also brings it home, so no return is needed');
  const transfer = plan.passes.find(pass => pass.purpose === PASS_PURPOSE.TRANSFER);
  assert.equal(transfer.direction, DIRECTION.LEFT_TO_RIGHT);
});

test('a row that leans both ways becomes two operations, and says so', () => {
  const plan = planLaceOperation([...LEFT_OP, ...RIGHT_OP], { mechanics: brother });
  assert.equal(plan.operations.length, 2);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /one carriage pass only moves stitches in its own direction/);
  assert.equal(plan.passes.length, 6, 'the completion pass of one operation doubles as the positioning of the next');
  assert.equal(plan.endsOn, SIDE.LEFT);
  const directions = plan.passes.filter(pass => pass.purpose === PASS_PURPOSE.TRANSFER).map(pass => pass.direction);
  assert.deepEqual(directions, [DIRECTION.RIGHT_TO_LEFT, DIRECTION.LEFT_TO_RIGHT]);
});

test('an operation whose needles collide is not silently truncated', () => {
  // A transfer onto a needle that is itself transferring away is a cascade, and the
  // scheduler above takes a non-colliding subset. Here the inputs are clean, so
  // nothing may be dropped on the floor.
  const plan = planLaceOperation(LEFT_OP, { mechanics: brother });
  const taken = plan.passes.find(pass => pass.purpose === PASS_PURPOSE.TRANSFER).transfers;
  assert.equal(taken.length, 2);
});

test('a self-transfer is dropped with a warning rather than planned as a pass', () => {
  const { operations, warnings } = splitIntoOperations([{ from: 3, to: 3 }]);
  assert.equal(operations.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /does nothing/);
  const empty = planLaceOperation([], { mechanics: brother });
  assert.equal(empty.passes.length, 0, 'nothing to do is nothing to plan');
});

test('the prose tells the same story as the data', () => {
  const lines = describePasses(planLaceOperation(LEFT_OP, { mechanics: brother }));
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^Pass 1: lace carriage selecting, carriage left to right from the left — needles 5, 9/);
  assert.match(lines[0], /Nothing moves yet/);
  assert.match(lines[1], /Carriage travels right to left, so these loops slide that same way/);
  assert.match(lines[3], /always finishes parked on the left side/);
});

test('needle runs read as 1-based ranges, because knitters count needles from one', () => {
  assert.equal(summariseNumbers([0, 1, 2, 7]), '1–3, 8');
  assert.equal(summariseNumbers([4]), '5');
  assert.equal(summariseNumbers([4, 5]), '5, 6');
  assert.equal(summariseNumbers([]), '');
});

// ─── unknown mechanics stay visible ─────────────────────────────────

test('a profile that never states its mechanics produces assumptions, not confident nonsense', () => {
  const unknown = carriageMechanics({ id: 'mystery', beds: 1, carriageRules: { type: 'unknown_cart' } });
  assert.equal(unknown.selectsBeforeTransfer, null);
  assert.equal(unknown.parksOnSide, null);
  assert.equal(unknown.modelled, false);
  assert.ok(unknown.unknowns.includes('selectsBeforeTransfer'));

  const plan = planLaceOperation(LEFT_OP, { mechanics: unknown });
  assert.ok(plan.assumptions.length >= 2, 'it says what it assumed');
  assert.ok(plan.assumptions.some(text => text.includes('selects on the pass before')));
  // Even with nothing stated, the schedule is still valid: it must end parked.
  assert.equal(plan.endsOn, SIDE.LEFT);
});

test('a profile may override its family defaults without editing the family', () => {
  const tweaked = carriageMechanics({
    beds: 1,
    carriageRules: { type: 'brother_separated', requiresCompletionPass: false }
  });
  assert.equal(tweaked.requiresCompletionPass, false);
  assert.equal(tweaked.selectsBeforeTransfer, true, 'the rest of the family still applies');
  const plan = planLaceOperation(LEFT_OP, { mechanics: tweaked });
  assert.deepEqual(plan.passes.map(pass => pass.purpose), [PASS_PURPOSE.SELECT, PASS_PURPOSE.TRANSFER]);
});

test('a single bed is not asked how far it racks', () => {
  assert.ok(!brother.unknowns.includes('rackPointsPerTransfer'));
  const passap = carriageMechanics(MACHINE_PROFILES.passap_duo_40);
  assert.equal(passap.beds, 2);
  assert.equal(passap.rackPointsPerTransfer, 1);
});

// ─── a whole chart ─────────────────────────────────────────────────

test('plain rows are one knit pass each and lace rows expand', () => {
  const matrix = [
    [S.KNIT, S.KNIT, S.KNIT, S.KNIT],
    [S.KNIT, S.TRANSFER_LEFT, S.KNIT, S.KNIT],
    [S.KNIT, S.KNIT, S.KNIT, S.KNIT]
  ];
  const plan = planPatternPasses(matrix, { profile: MACHINE_PROFILES.brother_standard_24 });
  assert.equal(plan.rows[0].kind, 'plain');
  assert.equal(plan.rows[0].passCount, 1);
  assert.equal(plan.rows[1].kind, 'lace');
  assert.equal(plan.rows[2].kind, 'plain');
  assert.equal(plan.totals.laceRows, 1);
  assert.ok(plan.totals.passes > matrix.length, 'the card is longer than the design, and the tool must say so');
  assert.equal(plan.totals.passesPerLaceRow.length, 1, 'one tidy pass count for lace rows');
  assert.equal(plan.totals.lacePasses, plan.passes.filter(pass => pass.purpose !== PASS_PURPOSE.KNIT).length);
});

test('the carriage side is carried from row to row, never reset per row', () => {
  const matrix = [[S.KNIT, S.TRANSFER_RIGHT, S.KNIT, S.KNIT]];
  const plan = planPatternPasses(matrix, {
    profile: MACHINE_PROFILES.brother_standard_24,
    startSide: SIDE.LEFT
  });
  assert.equal(plan.endsOn, SIDE.LEFT, 'every operation parks the carriage, so the chart ends where it began');
  const continuous = plan.passes.every(
    (pass, index) => index === 0 || pass.startSide === plan.passes[index - 1].endsOn
  );
  assert.equal(continuous, true, 'no pass may start from a side the previous pass did not leave it on');
});

test('an eyelet with no companion decrease costs a transfer, and the pair costs one', () => {
  const lone = transfersInRow([S.KNIT, S.EYELET, S.KNIT]);
  assert.equal(lone.length, 1);
  assert.equal(lone[0].kind, 'implicit-eyelet', 'the machine has to move the loop somewhere');

  const paired = transfersInRow([S.KNIT, S.TRANSFER_LEFT, S.EYELET, S.KNIT]);
  assert.equal(paired.length, 1, 'the eyelet is paid for by the decrease next to it');

  const overlapping = transfersInRow([S.EYELET, S.EYELET, S.KNIT]);
  assert.deepEqual(
    dedupeTransfers(overlapping).map(transfer => `${transfer.from}>${transfer.to}`),
    ['0>1', '1>2']
  );
  assert.equal(
    dedupeTransfers([{ from: 2, to: 3 }, { from: 2, to: 3 }]).length,
    1,
    'two symbols asking for one movement is one movement'
  );
});

test('a double decrease pulls both neighbours onto its needle', () => {
  const ops = transfersInRow([S.KNIT, S.DOUBLE_DEC_LEFT, S.KNIT]);
  assert.deepEqual(
    ops.map(transfer => `${transfer.from}>${transfer.to}`).sort(),
    ['0>1', '2>1']
  );
  const occupancy = occupancyAfterTransfers(3, ops);
  assert.deepEqual(occupancy.counts, [0, 3, 0], 'both loops land on the centre needle, both sources empty');
  assert.deepEqual(occupancy.tripled, [1]);
});

test('a vertical repeat that is not a multiple of the pass count drifts', () => {
  const tidy = checkCardRepeat({ verticalRepeat: 24, passesPerLaceRow: 4 });
  assert.equal(tidy.aligned, true);
  assert.equal(tidy.designRows, 6);
  assert.match(tidy.message, /stay in step/);

  const drifting = checkCardRepeat({ verticalRepeat: 22, passesPerLaceRow: 4 });
  assert.equal(drifting.aligned, false);
  assert.equal(drifting.leftoverCardRows, 2);
  assert.match(drifting.message, /drift by 2 card row/);

  assert.equal(checkCardRepeat({ verticalRepeat: 0, passesPerLaceRow: 4 }).ok, false);
  assert.equal(checkCardRepeat({ verticalRepeat: 24, passesPerLaceRow: null }).ok, false);
});

test('mixed rows are compared by cost instead of lectured about', () => {
  const comparison = rowCostComparison([...LEFT_OP, ...RIGHT_OP], {
    mechanics: brother,
    plainRows: brother.minPlainRowsAfterLace ?? 0
  });
  assert.equal(comparison.requiredOnDoubleBed, true, 'on two beds this is physics, not preference');
  assert.equal(comparison.asDrawn.designRows, 1);
  assert.equal(comparison.separated.designRows, 2);
  assert.equal(comparison.delta.designRows, 1);
  assert.ok(Number.isFinite(comparison.delta.passes));
  assert.match(comparison.advice, /pass\(es\)/);
  assert.match(rowCostComparison(LEFT_OP, { mechanics: brother }).advice, /leans one way/);
});

// ─── double bed: across and back with a rack ──────────────────────────────

test('one hole on two beds is two rows: cross over, then rack one point back', () => {
  const hole = planDoubleBedHole(1, { needle: 10 });
  assert.equal(hole.steps.length, 2);
  assert.equal(hole.steps[0].rack, 0, 'the crossing pass racks nothing: the loop sits opposite');
  assert.equal(hole.steps[1].rack, 1, 'the return pass racks one point');
  assert.equal(hole.steps[0].to.bed, 'back');
  assert.deepEqual([hole.steps[1].from.bed, hole.steps[1].to.bed], ['back', 'front']);
  assert.equal(hole.steps[1].to.needle, 11);
  assert.equal(hole.rowCost, 2);
  assert.deepEqual(hole.occupancyEffect, { empty: [10], doubled: [11] });
  assert.match(hole.summary, /two cross-bed rows/);

  const mirrored = planDoubleBedHole(-1, { needle: 10 });
  assert.equal(mirrored.steps[1].to.needle, 9, 'the mirror of a hole is a hole leaning the other way, not a flip');
});

test('a row can only be racked one way, because the whole bed slides together', () => {
  const shared = validateRackRow([{ needle: 3, rack: 1 }, { needle: 9, rack: 1 }]);
  assert.equal(shared.ok, true);
  assert.match(shared.message, /share a one-point right rack/);

  const mixed = validateRackRow([{ needle: 3, rack: 1 }, { needle: 9, rack: -1 }]);
  assert.equal(mixed.ok, false);
  assert.equal(mixed.conflicts.length, 1);
  assert.match(mixed.error, /whole bed slides together/);

  assert.equal(validateRackRow([]).ok, true);
  assert.match(validateRackRow([{ needle: 1, rack: 0 }]).message, /zero rack/);
});

test('occupancy is the view that catches the mistake before the machine does', () => {
  const after = occupancyAfterTransfers([1, 1, 1, 1], [{ from: 1, to: 2 }]);
  assert.deepEqual(after.counts, [1, 0, 2, 1], 'one needle empty, its neighbour holding two');
  assert.deepEqual([after.empty, after.doubled], [[1], [2]]);

  const fan = occupancyAfterTransfers([1, 1, 1, 1, 1], [
    { from: 1, to: 2 },
    { from: 3, to: 2 }
  ]);
  assert.equal(fan.counts[2], 3, 'two transfers into one needle is the point of a fan');
  assert.deepEqual(fan.tripled, [2]);

  const offBed = occupancyAfterTransfers(2, [{ from: 0, to: 5 }]);
  assert.equal(offBed.events[0].kind, 'error');
  assert.match(offBed.events[0].message, /off the bed/);
  const empty = occupancyAfterTransfers([0, 1], [{ from: 0, to: 1 }]);
  assert.equal(empty.events[0].kind, 'empty');
  assert.deepEqual(empty.counts, [0, 1], 'nothing moved, so nothing was invented');
});

// ─── the compiler must agree with all of this ─────────────────────────────

test('the compiled card carries one punched row per lace operation, then blanks', () => {
  const compiler = new LaceCompiler(MACHINE_PROFILES.brother_standard_24);
  const result = compiler.compile([[S.KNIT, S.TRANSFER_LEFT, S.KNIT, S.TRANSFER_LEFT, S.KNIT]]);
  assert.equal(result.success, true);
  const lace = result.strokes.filter(stroke => stroke.carriageType === 'LACE');
  assert.equal(lace.length, 4, 'select, transfer, complete, return');
  assert.deepEqual(lace.map(stroke => stroke.purpose), [
    PASS_PURPOSE.SELECT,
    PASS_PURPOSE.TRANSFER,
    PASS_PURPOSE.COMPLETE,
    PASS_PURPOSE.RETURN
  ]);
  assert.equal(lace[0].punchcardHoles.length, 2, 'the selecting row is the one with the punches');
  assert.equal(lace[1].punchcardHoles.length, 0);
  assert.deepEqual(lace.map(stroke => stroke.cardRowIndex), [0, 1, 2, 3], 'each pass reads its own card row');
  assert.equal(result.cardMatrix[lace[0].cardRowIndex].filter(Boolean).length, 2, 'the card is punched on the selecting row');
  assert.equal(result.cardMatrix[lace[1].cardRowIndex].filter(Boolean).length, 0, 'and blank on the rows after it');
});

test('loops only move on the pass that transfers them', () => {
  const compiler = new LaceCompiler(MACHINE_PROFILES.brother_standard_24);
  const result = compiler.compile([[S.KNIT, S.TRANSFER_LEFT, S.KNIT, S.KNIT]]);
  const states = result.strokes.map(stroke => stroke.needleBedState.join(''));
  const unique = [...new Set(states)];
  assert.equal(unique.length, 2, 'one bed change for one transfer, no drift across the other passes');
  const selecting = result.strokes.find(stroke => stroke.purpose === PASS_PURPOSE.SELECT);
  assert.deepEqual(selecting.needleBedState, [1, 1, 1, 1], 'the selecting pass has moved nothing');
});

test('the pass summary is counted from the strokes, so it cannot disagree with the card', () => {
  const compiler = new LaceCompiler(MACHINE_PROFILES.brother_standard_24);
  const result = compiler.compile([
    [S.KNIT, S.KNIT, S.KNIT, S.KNIT],
    [S.KNIT, S.TRANSFER_LEFT, S.KNIT, S.KNIT]
  ]);
  const summary = summariseStrokes(result.strokes);
  assert.deepEqual(summary, result.passSummary);
  assert.equal(summary.passes, result.totalPasses);
  assert.equal(summary.knitPasses, result.totalKnitPasses);
  assert.equal(summary.rows.length, 2, 'both design rows accounted for');
  assert.equal(summary.passesPerLaceRow.length, 1);
  assert.ok(summary.passesPerLaceRow[0] >= 4, 'the lace row cost its passes plus the mandated knits');
});

test('a double-bed profile is told that this schedule is the single-bed model', () => {
  const compiler = new LaceCompiler(MACHINE_PROFILES.passap_duo_40);
  const result = compiler.compile([[S.KNIT, S.TRANSFER_RIGHT, S.KNIT, S.KNIT]]);
  const warning = result.diagnostics.find(entry => entry.type === 'warning');
  assert.ok(warning, 'it must say something rather than quietly mis-describe the machine');
  assert.match(warning.message, /two-bed machine/);
  assert.match(warning.message, /racking back one point/);
});
