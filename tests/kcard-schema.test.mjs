// Tests for the .kcard project file contract: version gate, migration, and the
// matrix validator that stands between a bad file and a frozen tab.
// Run with: node --test "tests/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KCARD_SCHEMA_VERSION,
  KCARD_MAX_COLS,
  buildProjectDocument,
  readProject,
  validateStitchMatrix
} from '../js/project/kcard.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';

const chart = [
  [1, 0, 1],
  [0, 1, 0]
];

// ─── Round trip ───────────────────────────────────────────────────────────────

test('a saved project reads back with its chart intact', () => {
  const text = JSON.stringify(buildProjectDocument({
    profileId: 'brother_standard_24',
    mode: 'fair_isle',
    rows: 2,
    cols: 3,
    stitchMatrix: chart
  }));
  const result = readProject(text);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.project.schemaVersion, KCARD_SCHEMA_VERSION);
  assert.deepEqual(result.project.stitchMatrix, chart);
  assert.deepEqual(result.warnings, [], 'a current-version file needs no explaining');
});

test('the envelope always carries a numeric schema version', () => {
  const doc = buildProjectDocument({ stitchMatrix: chart });
  assert.equal(typeof doc.schemaVersion, 'number');
  assert.match(doc.format, /^KNITCAT_PROJECT_V\d+$/);
  assert.ok(!Number.isNaN(Date.parse(doc.timestamp)), 'timestamp is a real date');
});

// ─── Version gate ─────────────────────────────────────────────────────────────

test('a file from a future build is refused, not guessed at', () => {
  const result = readProject({
    format: 'KNITCAT_PROJECT_V99',
    schemaVersion: 99,
    stitchMatrix: chart
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /newer KNITCAT/i);
  assert.match(result.error, /v99/, 'names the version it found');
});

test('a version string is read as a major number, not waved through', () => {
  // A free-text version must not be waved through: only its major number counts,
  // so a v3 file is refused instead of being half-parsed against v2 rules.
  const future = readProject({ format: 'KNITCAT_PROJECT_V3', version: '3.0.0', stitchMatrix: chart });
  assert.equal(future.ok, false);
  assert.match(future.error, /newer KNITCAT/i);

  const current = readProject({ format: 'KNITCAT_PROJECT_V2', version: '2.0.0', stitchMatrix: chart });
  assert.equal(current.ok, true, current.error);
  assert.deepEqual(current.warnings, []);
});

test('legacy files that predate schemaVersion still open', () => {
  // Exactly what KNITCAT wrote before the version gate existed.
  const legacy = {
    format: 'KNITCAT_PROJECT_V2',
    version: '2.0.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    profileId: 'brother_standard_24',
    mode: 'lace',
    stitchMatrix: [[STITCH_TYPE.KNIT, STITCH_TYPE.EYELET]]
  };
  const result = readProject(legacy);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.project.stitchMatrix[0][1], STITCH_TYPE.EYELET);
});

test('a v1 file opens but says it was upgraded', () => {
  const result = readProject({ version: '1.0.0', stitchMatrix: chart });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.warnings.some(w => /upgraded from project schema v1/i.test(w)),
    `expected an upgrade note, got ${JSON.stringify(result.warnings)}`);
});

test('compile output on disk is discarded rather than trusted', () => {
  const result = readProject({
    schemaVersion: KCARD_SCHEMA_VERSION,
    stitchMatrix: chart,
    compilationResult: { cardMatrix: [[1, 1]], passes: ['a lie'] }
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.project.compilationResult, undefined);
  assert.ok(result.project.discardedCompiled);
  assert.ok(result.warnings.some(w => /schedule was ignored/i.test(w)));
});

// ─── Rejection of things that are not projects ───────────────────────────────

test('unrelated JSON is refused by name, not with a stack trace', () => {
  const packageJson = { name: 'knitcat', dependencies: { leftpad: '1.0.0' } };
  const result = readProject(packageJson);
  assert.equal(result.ok, false);
  assert.match(result.error, /No KNITCAT project fields/i);
});

test('broken JSON gets one readable sentence', () => {
  const result = readProject('{ "stitchMatrix": [[1,0],,]');
  assert.equal(result.ok, false);
  assert.match(result.error, /not JSON at all/i);
});

test('a chart of the wrong shape never reaches the editor', () => {
  const ragged = readProject({ schemaVersion: 2, stitchMatrix: [[1, 0], [1]] });
  assert.equal(ragged.ok, false);
  assert.match(ragged.error, /row 2 has a different number of cells/i);

  const empty = readProject({ schemaVersion: 2, stitchMatrix: [] });
  assert.equal(empty.ok, false, 'an empty chart is not a project');

  const notAList = readProject({ schemaVersion: 2, stitchMatrix: '101010' });
  assert.equal(notAList.ok, false, 'a string is not a matrix');
});

test('a bogus cell is reported with its position', () => {
  const checked = validateStitchMatrix([[1, 0], [1, 'maybe']], { mode: 'fair_isle' });
  assert.equal(checked.ok, false);
  assert.match(checked.errors[0], /cell 2 in row 2/i);
});

test('lace glyphs and stranded bits do not cross-contaminate silently', () => {
  const laceAsStranded = validateStitchMatrix([[STITCH_TYPE.EYELET]], { mode: 'tuck' });
  assert.equal(laceAsStranded.ok, false, 'a yarnover is not a punched cell');

  const unknownGlyph = validateStitchMatrix([['Z']], { mode: 'lace' });
  assert.equal(unknownGlyph.ok, false, 'an invented symbol is not a stitch');

  const strandedAsLace = validateStitchMatrix([[1, 0]], { mode: 'lace' });
  assert.equal(strandedAsLace.ok, true, 'a card opened as lace becomes eyelet/knit');
  assert.equal(strandedAsLace.matrix[0][0], STITCH_TYPE.EYELET);
  assert.equal(strandedAsLace.matrix[0][1], STITCH_TYPE.KNIT);
});

test('boolean cells are accepted and normalised to 0 and 1', () => {
  const checked = validateStitchMatrix([[true, false]], { mode: 'fair_isle' });
  assert.equal(checked.ok, true, checked.errors.join(' '));
  assert.deepEqual(checked.matrix, [[1, 0]]);
});

// ─── Size ceilings ────────────────────────────────────────────────────────────

test('an absurdly large chart is refused before it is copied cell by cell', () => {
  // One 4001-column row: past the width ceiling, and cheap enough to build in a
  // test. The check has to reject on the header, not by walking the grid.
  const tooWide = readProject({
    schemaVersion: 2,
    stitchMatrix: [new Array(KCARD_MAX_COLS + 1).fill(0)]
  });
  assert.equal(tooWide.ok, false);
  assert.match(tooWide.error, /column file ceiling/i);

  // 3000 rows x 900 columns = 2.7M cells, over the total ceiling. Every row is
  // the SAME array on purpose: building the real thing would cost more memory
  // than the check it is testing.
  const shared = new Array(900).fill(0);
  const started = performance.now();
  const tooBig = readProject({ schemaVersion: 2, stitchMatrix: new Array(3000).fill(shared) });
  const elapsed = performance.now() - started;
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.error, /too many cells/i);
  assert.ok(elapsed < 250, `rejection must be instant, took ${elapsed.toFixed(0)}ms`);
});

test('validateStitchMatrix copies rather than aliasing the caller matrix', () => {
  const input = [chart[0].slice(), chart[1].slice()];
  const checked = validateStitchMatrix(input, { mode: 'fair_isle' });
  checked.matrix[0][0] = 0;
  assert.equal(input[0][0], 1, 'the caller rows must not be mutated');
});

test('a header that disagrees with its own chart is overruled, loudly', () => {
  const result = readProject({
    schemaVersion: KCARD_SCHEMA_VERSION,
    rows: 999,
    cols: 77,
    stitchMatrix: chart
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.project.rows, undefined, 'the lies are not carried forward');
  assert.equal(result.warnings.filter(w => /believed the chart/i.test(w)).length, 2);
});
