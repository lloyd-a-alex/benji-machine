// The Project superstructure: hierarchy, knitting math, persistence round-trip,
// and the hub summary. This is the data model the whole "make it one studio"
// effort hangs off, so it is tested as arithmetic and as a contract, not as UI.
//
// Run with: node --test "tests/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPERSTRUCTURE_VERSION, WEIGHT_METERS_PER_100G, GARMENT_CATEGORIES,
  cmToStitches, cmToRows, pieceDimensions,
  estimateYarnMeters, metersPer100g, gramsFromMeters, estimateYarnGrams, substitutionDelta,
  pieceProgress, currentRowLabel, weightedCompletion, nextPiece, nextAction,
  newChart, newPiece, newGarment, newYarn, newGauge, newTimelineEvent,
  Project, summarizeProject
} from '../js/project/project-model.js';

// A fixed clock so timestamps are asserted, never flapped by wall time.
const CLOCK = () => Date.parse('2026-01-02T03:04:05.000Z');
const ISO = '2026-01-02T03:04:05.000Z';

// ─── gauge → dimensions ──────────────────────────────────────────────────────

test('cmToStitches / cmToRows convert gauge and cm to whole needles and rows', () => {
  assert.equal(cmToStitches(22, 50), 110);      // 22 sts/10cm × 50 cm = 110
  assert.equal(cmToStitches(22, 23), 51);        // 50.6 → nearest whole needle
  assert.equal(cmToRows(30, 47), 141);
  assert.equal(cmToStitches(4.5, 20), 9);        // 9.0 exact
});

test('dimension helpers guard against garbage and never return a bogus needle count', () => {
  for (const bad of [0, -5, NaN, Infinity, null, undefined, 'x']) {
    assert.equal(cmToStitches(bad, 50), 0);
    assert.equal(cmToStitches(22, bad), 0);
    assert.equal(cmToRows(bad, 50), 0);
  }
});

test('pieceDimensions ties a garment target size to needles + rows in one place', () => {
  const gauge = { stsPer10cm: 22, rowsPer10cm: 30 };
  const d = pieceDimensions(gauge, { widthCm: 56, lengthCm: 20 });
  assert.deepEqual(d, { castOn: cmToStitches(22, 56), rowCount: cmToRows(30, 20) });
  // Missing gauge fields degrade to zero, not NaN.
  assert.deepEqual(pieceDimensions({}, { widthCm: 10, lengthCm: 10 }), { castOn: 0, rowCount: 0 });
});

// ─── yarn estimation ─────────────────────────────────────────────────────────

test('yarn estimate is linear in each dimension (double the fabric, double the yarn)', () => {
  const g = { stsPer10cm: 22, rowsPer10cm: 30 };
  const single = estimateYarnMeters(g, { widthCm: 50, lengthCm: 47 });
  const doubled = estimateYarnMeters(g, { widthCm: 100, lengthCm: 47 });
  assert.ok(single > 0);
  assert.ok(Math.abs(doubled - single * 2) <= 1, `${doubled} ≈ 2×${single}`);
});

test('a denser gauge uses more yarn for the same piece (it is a real function of gauge)', () => {
  const loose = { stsPer10cm: 18, rowsPer10cm: 24 };
  const tight = { stsPer10cm: 28, rowsPer10cm: 36 };
  const size = { widthCm: 50, lengthCm: 50 };
  assert.ok(estimateYarnMeters(tight, size) > estimateYarnMeters(loose, size));
});

test('waste factor is honoured but clamped so nobody estimates a 100× swatch', () => {
  const g = { stsPer10cm: 22, rowsPer10cm: 30 };
  const size = { widthCm: 50, lengthCm: 47 };
  assert.ok(estimateYarnMeters(g, size, 1.5) > estimateYarnMeters(g, size, 1));
  // Absurd factors clamp to the 1..3 band, so 9 and 3 agree.
  assert.equal(estimateYarnMeters(g, size, 9), estimateYarnMeters(g, size, 3));
  assert.equal(estimateYarnMeters(g, size, 0.1), estimateYarnMeters(g, size, 1));
});

test('estimateYarnMeters returns 0 when any input is missing (no silent garbage)', () => {
  assert.equal(estimateYarnMeters({ stsPer10cm: 22 }, { widthCm: 50, lengthCm: 47 }), 0);
  assert.equal(estimateYarnMeters({ stsPer10cm: 22, rowsPer10cm: 30 }, {}), 0);
});

test('weight table resolves standard names, aliases and casing; unknown stays unknown', () => {
  assert.equal(metersPer100g('DK'), WEIGHT_METERS_PER_100G.dk);
  assert.equal(metersPer100g(' worsted '), WEIGHT_METERS_PER_100G.worsted);
  assert.equal(metersPer100g('aran'), 130);
  assert.equal(metersPer100g('chunky'), WEIGHT_METERS_PER_100G.bulky); // alias
  assert.equal(metersPer100g('unobtainium'), null);
  assert.equal(metersPer100g(123), null);
});

test('gramsFromMeters rounds up to whole grams (you buy a ball, not a gram)', () => {
  assert.equal(gramsFromMeters(125, 'dk'), 50);              // 125 m at 250 m/100g
  assert.equal(gramsFromMeters(12.5, 'dk'), 5);
  assert.equal(gramsFromMeters(1, 'dk'), 1);                 // tiny but never 0
  assert.equal(gramsFromMeters(100, 'mysteryweight'), null); // unknown → no fake answer
  assert.equal(gramsFromMeters(0, 'dk'), null);
});

test('estimateYarnGrams is exactly meters→grams, and null without a known weight', () => {
  const g = { stsPer10cm: 22, rowsPer10cm: 30 };
  const size = { widthCm: 56, lengthCm: 20 };
  const expected = gramsFromMeters(estimateYarnMeters(g, size), 'dk');
  assert.equal(estimateYarnGrams(g, size, 'dk'), expected);
  assert.ok(expected > 0);
  assert.equal(estimateYarnGrams(g, size, 'nonsense'), null);
});

test('substitutionDelta reads a gauge difference as a signed percentage', () => {
  assert.equal(substitutionDelta({ stsPer10cm: 22 }, { stsPer10cm: 22 }), 0);
  assert.equal(substitutionDelta({ stsPer10cm: 22 }, { stsPer10cm: 24 }), 9.1); // +, denser
  assert.equal(substitutionDelta({ stsPer10cm: 22 }, { stsPer10cm: 20 }), -9.1); // −, looser
  assert.equal(substitutionDelta({ stsPer10cm: 0 }, { stsPer10cm: 20 }), null);
});

// ─── progress ────────────────────────────────────────────────────────────────

test('pieceProgress clamps to 0..1 and ignores a piece with no plan', () => {
  assert.equal(pieceProgress({ totalRows: 100, currentRow: 25 }), 0.25);
  assert.equal(pieceProgress({ totalRows: 100, currentRow: 500 }), 1);   // overshoot clamps
  assert.equal(pieceProgress({ totalRows: 0, currentRow: 0 }), 0);
  assert.equal(pieceProgress({ totalRows: null, currentRow: 10 }), 0);
});

test('currentRowLabel renders the phrase the hub and editor show', () => {
  assert.equal(currentRowLabel({ totalRows: 142, currentRow: 84 }), 'row 84 of 142');
  assert.equal(currentRowLabel({ totalRows: 10, currentRow: 99 }), 'row 10 of 10'); // clamped
  assert.equal(currentRowLabel({ totalRows: 0, currentRow: 3 }), 'row 3');
});

test('completion is ROW-weighted, so a body outweighs a cuff', () => {
  const pieces = [
    { name: 'body', totalRows: 140, currentRow: 70 },
    { name: 'cuff', totalRows: 40, currentRow: 40 }
  ];
  // (70+40) / (140+40) = 110/180 = 61%  — NOT the naive 50% "one of two done".
  assert.equal(weightedCompletion(pieces), 61);
});

test('un-planned pieces (no totalRows) are ignored, and all-zero weights read 0', () => {
  assert.equal(weightedCompletion([{ totalRows: 100, currentRow: 100 }, { name: 'todo' }]), 100);
  assert.equal(weightedCompletion([]), 0);
  assert.equal(weightedCompletion([{ name: 'a' }, { name: 'b' }]), 0);
});

test('nextPiece / nextAction surface the thing to knit next', () => {
  const garments = [{
    pieces: [
      { id: 'a', name: 'back', totalRows: 100, currentRow: 100 },
      { id: 'b', name: 'front', totalRows: 100, currentRow: 40 },
      { id: 'c', name: 'sleeve', totalRows: 80, currentRow: 0 }
    ]
  }];
  assert.equal(nextPiece(garments).id, 'b');
  assert.deepEqual(nextAction(garments), { pieceId: 'b', pieceName: 'front', label: 'row 40 of 100' });
  // All done → null.
  assert.equal(nextAction([{ pieces: [{ totalRows: 10, currentRow: 10 }] }]), null);
});

// ─── factories ───────────────────────────────────────────────────────────────

test('factories assign unique ids, clamp rows to totals, and sanitise types', () => {
  const a = newPiece({ name: 12345, totalRows: 100, currentRow: 500 });
  const b = newPiece({ totalRows: 100 });
  assert.notEqual(a.id, b.id);
  assert.equal(a.name, 'Piece');           // non-string name falls back to the default
  assert.equal(a.currentRow, 100);         // overshoot clamps to the total
  assert.equal(newPiece({ totalRows: 10, currentRow: 99 }).currentRow, 10);
  assert.equal(newGarment({ category: 'nonsense' }).category, 'other');
  assert.ok(GARMENT_CATEGORIES.includes(newGarment({ category: 'hat' }).category));
});

test('newYarn keeps gramsLeft as-is but defaults it to null when absent', () => {
  assert.equal(newYarn({ grams: 100, gramsLeft: 40 }).gramsLeft, 40);
  assert.equal(newYarn({ grams: 100 }).gramsLeft, null);
});

// ─── the Project: create / stamp / mutate ──────────────────────────────────

test('Project.create stamps created/updated from the injected clock', () => {
  const p = Project.create({ name: "Benji's Winter Sweater" }, CLOCK);
  assert.equal(p.name, "Benji's Winter Sweater");
  assert.equal(p.createdAt, ISO);
  assert.equal(p.updatedAt, ISO);
  assert.equal(p.version, SUPERSTRUCTURE_VERSION);
  assert.deepEqual(p.garments, []);
});

test('add* helpers return the new node, grow the arrays, and bump updatedAt', () => {
  const p = Project.create({}, CLOCK);
  const g = p.addGarment({ name: 'Beanie', category: 'hat' }, CLOCK);
  const c = p.addChart({ name: 'Celtic cable', rows: 24, cols: 32 }, CLOCK);
  const piece = p.addPiece(g.id, { name: 'Brim', chartId: c.id, totalRows: 40 }, CLOCK);
  p.addYarn({ brand: 'Drops', name: 'Karisma', weight: 'DK', grams: 500 }, CLOCK);
  p.addGauge({ stsPer10cm: 22, rowsPer10cm: 30 }, CLOCK);
  p.addTimeline({ kind: 'milestone', text: 'cast on' }, CLOCK);
  assert.equal(p.garments.length, 1);
  assert.equal(piece.totalRows, 40);
  assert.equal(g.pieces.length, 1);
  assert.equal(g.pieces[0].chartId, c.id);
  assert.equal(p.charts.length, 1);
  assert.equal(p.yarns.length, 1);
  assert.equal(p.gauges.length, 1);
  assert.equal(p.timeline.length, 1);
  assert.equal(p.updatedAt, ISO);
});

test('addPiece on an unknown garment returns null (no crash, no orphan)', () => {
  const p = Project.create({}, CLOCK);
  assert.equal(p.addPiece('does-not-exist', { name: 'x' }, CLOCK), null);
});

test('activeGauge follows gaugeId, else falls back to the only recorded gauge', () => {
  const p = Project.create({}, CLOCK);
  assert.equal(p.activeGauge(), null);
  const g1 = p.addGauge({ stsPer10cm: 20, rowsPer10cm: 26 }, CLOCK);
  const g2 = p.addGauge({ stsPer10cm: 24, rowsPer10cm: 32 }, CLOCK);
  assert.equal(p.activeGauge().id, g1.id);   // no gaugeId → first
  p.gaugeId = g2.id;
  assert.equal(p.activeGauge().id, g2.id);
});

test('completion() and resumeLine() read the whole tree', () => {
  const p = Project.create({ name: 'Sweater' }, CLOCK);
  const g = p.addGarment({ name: 'Body' }, CLOCK);
  p.addPiece(g.id, { name: 'back', totalRows: 100, currentRow: 60 }, CLOCK);
  p.addPiece(g.id, { name: 'front', totalRows: 100, currentRow: 40 }, CLOCK);
  assert.equal(p.completion(), 50);
  // nextPiece is the first not-yet-finished piece in order, i.e. 'back'.
  assert.equal(p.resumeLine(), 'back — row 60 of 100');
  assert.equal(Project.create({}).resumeLine(), 'No pieces planned yet.');
});

// ─── persistence round-trip + hostile input ──────────────────────────────────

test('a Project survives a toJSON → fromJSON round-trip', () => {
  const p = Project.create({ name: 'Hat', machine: 'Brother KH-830' }, CLOCK);
  const g = p.addGarment({ name: 'Beanie', category: 'hat' }, CLOCK);
  p.addPiece(g.id, { name: 'brim', totalRows: 40, currentRow: 12 }, CLOCK);
  p.addYarn({ name: 'Karisma', weight: 'DK' }, CLOCK);
  p.addChart({ name: 'rib', rows: 4, cols: 8 }, CLOCK);

  const { project: q, warnings } = Project.fromJSON(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(warnings, []);
  assert.equal(q.name, 'Hat');
  assert.equal(q.machine, 'Brother KH-830');
  assert.equal(q.completion(), p.completion());
  assert.equal(q.garments[0].pieces[0].currentRow, 12);
  assert.deepEqual(q.toJSON().garments, JSON.parse(JSON.stringify(p)).garments);
});

test('fromJSON refuses a newer superstructure instead of guessing', () => {
  const { project, warnings } = Project.fromJSON({ version: SUPERSTRUCTURE_VERSION + 1 });
  assert.equal(project, null);
  assert.match(warnings.join(' '), /newer/i);
});

test('fromJSON never throws on junk, coerces to safe defaults, and caps runaway arrays', () => {
  for (const junk of [null, 42, 'x', [], undefined, {}]) {
    const { project } = Project.fromJSON(junk);
    // {} is valid-shaped (an object) and yields a defaulted project; the rest yield null.
    if (junk && typeof junk === 'object' && !Array.isArray(junk)) {
      assert.ok(project instanceof Project);
      assert.equal(project.name, 'Untitled project');
      assert.deepEqual(project.garments, []);
    } else {
      assert.equal(project, null);
    }
  }
  // 2005 same-id charts collapse to the 2000 cap (deduped, not dropped).
  const huge = { version: 1, charts: Array.from({ length: 2005 }, () => ({ id: 'c' })) };
  const { project } = Project.fromJSON(huge);
  assert.equal(project.charts.length, 2000);
});

test('fromJSON dedupes colliding ids so the UI can key off them safely', () => {
  const { project } = Project.fromJSON({
    version: 1,
    charts: [{ id: 'dup', name: 'a' }, { id: 'dup', name: 'b' }]
  });
  assert.equal(project.charts.length, 2);
  assert.notEqual(project.charts[0].id, project.charts[1].id);
});

test('fromJSON upgrades an older version with a warning, not a rejection', () => {
  const { project, warnings } = Project.fromJSON({ version: 0, name: 'Legacy' });
  assert.ok(project instanceof Project);
  assert.equal(project.name, 'Legacy');
});

// ─── hub summary ─────────────────────────────────────────────────────────────

test('summarizeProject gives the hub one cheap object per project', () => {
  const p = Project.create({ name: 'Sweater', machine: 'KH-830' }, CLOCK);
  const g = p.addGarment({ name: 'Body' }, CLOCK);
  p.addPiece(g.id, { name: 'back', totalRows: 100, currentRow: 45 }, CLOCK);
  const s = summarizeProject(p);
  assert.equal(s.name, 'Sweater');
  assert.equal(s.machine, 'KH-830');
  assert.equal(s.garmentCount, 1);
  assert.equal(s.pieceCount, 1);
  assert.equal(s.completion, 45);
  assert.equal(s.resume, 'back — row 45 of 100');
  assert.equal(s.status, 'in progress');
});

test('summarizeProject marks a no-piece project as draft', () => {
  const s = summarizeProject(Project.create({ name: 'Empty' }, CLOCK));
  assert.equal(s.pieceCount, 0);
  assert.equal(s.completion, 0);
  assert.equal(s.status, 'draft');
});
