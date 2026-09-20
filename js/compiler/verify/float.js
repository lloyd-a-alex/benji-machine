/**
 * KNITCAT V2 — float verification (spec §4.5 "are there any floats over the limit?").
 *
 * In colourwork the unused colour "floats" behind the work. A long float catches fingers and
 * puckers the fabric; on a machine you bridge/tuck it. This scans the IR's colourwork card matrix
 * for runs of one colour where the other is carried, reports the worst offenders, and gives the
 * specific fix (tuck at column N, or catch the float every M stitches). DOM-free.
 *
 * @module compiler/verify/float
 */
import { makeResult } from './_result.js';

/** A float this many stitches wide is a fail; this many is a warn (typical machine guidance 5–7). */
const WARN_FLOAT = 5;
const FAIL_FLOAT = 8;

export function verifyFloat(ir, project, options = {}) {
  const matrix = ir.cardMatrix;
  if (!matrix || !matrix.length) return makeResult('float', 'pass', 'No colourwork card — no floats to check.', '');
  const maxFloat = Number(options.maxFloat) || FAIL_FLOAT;
  const worst = worstFloat(matrix);
  if (worst.length >= maxFloat) {
    return makeResult('float', 'fail', `Float of ${worst.length} sts at row ${worst.row}, col ${worst.col} exceeds ${maxFloat - 1}.`, `Add a tuck/bridge at col ${worst.col} (catch the float every ${WARN_FLOAT} sts).`, { worst });
  }
  if (worst.length >= WARN_FLOAT) {
    return makeResult('float', 'warn', `Longest float is ${worst.length} sts (row ${worst.row}) — near the comfort limit.`, 'Consider catching floats every 5 sts if the fabric will stretch.', { worst });
  }
  return makeResult('float', 'pass', `Longest float ${worst.length} sts — within limits.`, '', { worst: worst.length });
}

/** Find the longest same-colour run while a different colour is carried across the row. */
function worstFloat(matrix) {
  let worst = { length: 0, row: 0, col: 0 };
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || [];
    let run = 1;
    for (let c = 1; c <= row.length; c++) {
      const same = c < row.length && row[c] === row[c - 1];
      run = same ? run + 1 : 1;
      if (run > worst.length) worst = { length: run, row: r + 1, col: c };
    }
  }
  return worst;
}
