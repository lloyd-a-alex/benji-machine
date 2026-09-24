/**
 * KNITCAT — Lace Intelligence: make the compiler's implicit transfers explicit.
 *
 * The single most common machine-lace mistake is a lone yarn-over: an eyelet with
 * no decrease beside it. It is *legal* — the compiler silently vacates the needle
 * to the right (or left at the edge) so the hole still forms — but it is invisible
 * work: the chart says "hole here" while the fabric quietly loses a stitch the
 * knitter never drew, and the row's stitch count slides. The inspector warns about
 * one cell at a time and the feasibility advisor reports the imbalance, but nothing
 * could *fix the card* — you had to hunt each eyelet and place its decrease.
 *
 * This module is that fix. It is the editing twin of the authoring atoms in
 * `js/presets/preset-recipe-helpers.js` (`holePair` / `addHole`), and it uses the
 * exact same definition of "paired" the compiler and `inspectCellWarnings` use: an
 * eyelet at column `c` is paid when the needle to its left is a `TRANSFER_LEFT` or
 * the needle to its right is a `TRANSFER_RIGHT`. Pairing therefore never changes
 * what the compiler will do to a row that was already correct — it only writes in
 * the decreases the compiler was going to invent anyway, onto plain needles, so the
 * chart finally says out loud what the fabric does.
 *
 * Everything here is pure (matrix in, *new* matrix out) so the undo tree keeps
 * storing by value and each rule is assertable under `node --test` with no browser.
 *
 * @module edit/lace-intel
 */

import { STITCH_TYPE } from '../math/knit-topology.js';
import { isLaceMode, isPunched } from './modes.js';
import { cellKey } from './select-ops.js';

const EYELET = STITCH_TYPE.EYELET;
const TRANSFER_LEFT = STITCH_TYPE.TRANSFER_LEFT;
const TRANSFER_RIGHT = STITCH_TYPE.TRANSFER_RIGHT;

/**
 * Is this needle "nothing there" — free to receive a companion decrease?
 * Reuses the one authority on what reads as plain in a lace chart (`isPunched`
 * over {@link module:edit/modes}) rather than re-listing the blank glyphs, so it
 * can never drift from how the rest of the app reads a cell. `null`/`undefined`
 * only ever appear in a half-built test matrix and are plainly not worked.
 */
function isPlainCell(value) {
  return value == null || !isPunched('lace', value);
}

/**
 * Is the eyelet at `(row, c)` already paid for by an adjacent transfer? The single
 * shared definition of "paired" — mirroring `hasLeftDecrease`/`hasRightDecrease` in
 * the compiler and the `paid` test in `inspectCellWarnings`.
 */
export function isEyeletPaid(row, c) {
  return row[c - 1] === TRANSFER_LEFT || row[c + 1] === TRANSFER_RIGHT;
}

/**
 * Every eyelet on the card with no transfer beside it.
 *
 * Returns the offending `[row, col]` cells (ready for `editor.setHighlight`), a
 * `count`, and the full `eyelets`/`paid` tallies so a caller can celebrate "all
 * paired" instead of showing a zero that reads like an error.
 */
export function findUnpairedEyelets(matrix, { mode = 'lace' } = {}) {
  const cells = [];
  const tally = { cells, count: 0, eyelets: 0, paid: 0, lace: isLaceMode(mode) };
  if (!tally.lace) return tally;
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== EYELET) continue;
      tally.eyelets++;
      if (isEyeletPaid(row, c)) tally.paid++;
      else cells.push([r, c]);
    }
  }
  tally.count = cells.length;
  return tally;
}

/**
 * Add the missing companion decrease next to every unpaired eyelet.
 *
 * Options:
 *   - `within` — a Set of `row,col` keys limiting *which eyelets* are fixed (the
 *     selection); the decrease may still land on any plain needle so the pair is
 *     always well formed. `null` means the whole card.
 *   - `direction` — `'auto'` (prefer a plain neighbour to the right, then left),
 *     `'right'` (force the decrease onto `c + 1`, fall back to the left only if the
 *     right is impossible), or `'left'` (its mirror).
 *
 * Guarantees the safety-critical properties a knitter would be furious to lose:
 *   - never overwrites a worked cell — a decrease only ever lands on a plain needle;
 *   - never overwrites another eyelet's fresh decrease (a per-row `claimed` set);
 *   - never removes anything, so it cannot empty a card;
 *   - each newly placed decrease keeps the row's stitch count where it was
 *     (eyelet `+1`, transfer `-1`), so a fully-paired row balances.
 *
 * Returns `{ ok, matrix, paired, skipped, alreadyPaired, unpaired }`. `paired` is
 * the number of decreases added, `alreadyPaired` the eyelets left untouched because
 * they were correct, and `skipped` the eyelets with nowhere legal to put a decrease
 * (edge + occupied neighbours) — reported, never silently dropped.
 */
export function pairEyelets(matrix, { mode = 'lace', within = null, direction = 'auto' } = {}) {
  const clone = (matrix || []).map(row => [...(row || [])]);
  if (!isLaceMode(mode)) {
    return {
      ok: false,
      error: 'Eyelets and transfers are a lace-chart thing — this card is in another mode.',
      matrix: clone, paired: 0, skipped: 0, alreadyPaired: 0, unpaired: 0
    };
  }
  const out = clone;
  let paired = 0;
  let skipped = 0;
  let alreadyPaired = 0;

  for (let r = 0; r < out.length; r++) {
    const row = out[r];
    // Freeze the eyelet columns before writing, so a decrease we add can never be
    // re-read as part of the scan. (It also can't create a false "paid" neighbour:
    // we only ever add a TR that pays the eyelet to its *left*, and a TL that pays
    // the eyelet to its *right*, and both require an eyelet on that exact side —
    // which is what we are placing beside, not something newly paid.)
    const eyeletCols = [];
    for (let c = 0; c < row.length; c++) if (row[c] === EYELET) eyeletCols.push(c);
    const claimed = new Set();

    for (const c of eyeletCols) {
      if (within && !within.has(cellKey(r, c))) continue;
      if (isEyeletPaid(row, c)) {
        alreadyPaired++;
        continue;
      }
      const right = c + 1;
      const left = c - 1;
      const canRight = right < row.length && isPlainCell(row[right]) && !claimed.has(right);
      const canLeft = left >= 0 && isPlainCell(row[left]) && !claimed.has(left);
      let side = null;
      if (direction === 'left') side = canLeft ? 'left' : canRight ? 'right' : null;
      else side = canRight ? 'right' : canLeft ? 'left' : null; // 'auto' and 'right' lean right first
      if (!side) {
        skipped++;
        continue;
      }
      if (side === 'right') {
        row[right] = TRANSFER_RIGHT;
        claimed.add(right);
      } else {
        row[left] = TRANSFER_LEFT;
        claimed.add(left);
      }
      paired++;
    }
  }

  return { ok: true, matrix: out, paired, skipped, alreadyPaired, unpaired: skipped };
}
