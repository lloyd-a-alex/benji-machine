// The double decreases and two-needle transfers a knitter can draw, compiled.
//
// js/machine/carriage-passes.js documents that its `transfersInRow()` "mirrors what
// the compiler does with the same symbols, so the pass plan and the compiled card
// cannot tell two different stories about one chart." These three symbols used to
// break that promise: DOUBLE_DEC_RIGHT was handled by the plan reader but silently
// dropped by the compiler, and TRANSFER_DOUBLE_L/R were handled by neither. So the
// tests below assert BOTH that each symbol now compiles to a real movement AND that
// the compiler and the plan reader agree, cell for cell.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LaceCompiler } from '../js/compiler/lace-decompiler.js';
import { transfersInRow } from '../js/machine/carriage-passes.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';
import { MACHINE_PROFILES } from '../js/machine/profiles.js';

const S = STITCH_TYPE;
const K = S.KNIT;
const compiler = new LaceCompiler(MACHINE_PROFILES.brother_standard_24);

/** Every sideways loop move the compiler scheduled for a single-row chart. */
function compilerMoves(matrix) {
  const result = compiler.compile(matrix);
  assert.equal(result.success, true, 'the schedule must be valid');
  return result.strokes
    .flatMap(stroke => stroke.transfers || [])
    .map(op => `${op.sourceCol}>${op.targetCol}`)
    .sort();
}

/** The plan reader's view of the same row, as the same `from>to` strings. */
function planMoves(row) {
  return transfersInRow(row).map(t => `${t.from}>${t.to}`).sort();
}

test('a right-leaning double decrease pulls both neighbours onto its needle', () => {
  // DDR at index 2: needles 1 and 2 ... the loop either side moves onto the centre.
  const row = [K, K, S.DOUBLE_DEC_RIGHT, K, K];
  const moves = compilerMoves([row.slice()]);
  assert.ok(moves.length >= 2, 'the compiler used to emit nothing here — the real bug');
  assert.deepEqual(moves, ['1>2', '3>2']);
});

test('the three double decreases are all two-transfer operations', () => {
  for (const sym of [S.DOUBLE_DEC_LEFT, S.DOUBLE_DEC_RIGHT, S.CENTER_DEC]) {
    const row = [K, K, sym, K, K];
    assert.deepEqual(compilerMoves([row.slice()]), planMoves(row), `${sym} compiles like the plan reads it`);
  }
});

test('a two-needle left transfer jumps the needle between', () => {
  const row = [K, K, K, S.TRANSFER_DOUBLE_L, K];
  const moves = compilerMoves([row.slice()]);
  assert.deepEqual(moves, ['3>1'], 'one loop, two places left, source vacated');
});

test('a two-needle right transfer jumps the needle between', () => {
  const row = [K, S.TRANSFER_DOUBLE_R, K, K, K];
  const moves = compilerMoves([row.slice()]);
  assert.deepEqual(moves, ['1>3'], 'one loop, two places right');
});

test('compiler and plan reader tell one story for a mixed double-op row', () => {
  const row = [S.TRANSFER_DOUBLE_R, K, S.DOUBLE_DEC_RIGHT, K, K, S.TRANSFER_DOUBLE_L, K];
  assert.deepEqual(compilerMoves([row.slice()]), planMoves(row));
});

test('a two-needle transfer at the very edge is refused, not wrapped', () => {
  // T2L at column 1 wants to land on column -1; nothing may be scheduled off the bed.
  const row = [K, S.TRANSFER_DOUBLE_L, K, K];
  const moves = compilerMoves([row.slice()]);
  assert.ok(moves.every(m => {
    const [, to] = m.split('>').map(Number);
    return to >= 0 && to < row.length;
  }), 'no transfer may leave the bed');
});

test('the lace palette offers every double op, and every button is a real symbol', async () => {
  // The point of compiling these is that a knitter can DRAW them, so the picker has
  // to carry them — and no button may name a symbol the topology does not know.
  const html = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
  const offered = new Set([...html.matchAll(/data-stitch="([^"]+)"/g)].map(m => m[1]));
  for (const sym of [S.DOUBLE_DEC_LEFT, S.DOUBLE_DEC_RIGHT, S.TRANSFER_DOUBLE_L, S.TRANSFER_DOUBLE_R]) {
    assert.ok(offered.has(sym), `${sym} is drawable from the palette`);
  }
  for (const sym of offered) {
    assert.ok(Object.values(STITCH_TYPE).includes(sym), `palette button "${sym}" is a real STITCH_TYPE`);
  }
});
