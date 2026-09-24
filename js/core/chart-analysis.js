/**
 * KNITCAT — Chart analysis (pure, DOM-free, testable).
 *
 * The low-level "what does this rectangle actually do at the machine" measurements —
 * longest carried float per row, longest vertical tuck hold, punched-vs-blank density,
 * bed and card overflow — used to be locked inside the feasibility advisor, which is
 * coupled to a live `app` object and the editor. Several other subsystems want exactly
 * these numbers with no editor in sight: the pattern browser wants to badge a preset
 * before it is ever loaded, the production cost engine wants a snag-risk figure, and any
 * future "does this tile cleanly" check wants the run maths.
 *
 * So the primitives live here once, with no DOM, no `app`, no canvas — just a matrix of
 * cells and a machine limits object. `js/features/feasibility.js` imports them (rather
 * than carrying its own copies) and layers the prose, one-click fixes and spotlighting
 * on top, so the two can never disagree about what a "long float" is.
 *
 * Per-mode float semantics (the thing the old code got wrong and this file pins down):
 *   fair_isle : a run of punched cells (1) floats yarn A, a run of blanks (0) floats B;
 *               the binding risk is the longer of the two directions.
 *   slip      : a run of slipped cells (0) is the float (yarn carried behind).
 *   tuck      : the risk is a long VERTICAL run of held cells (0) stacking loops, not a
 *               horizontal strand.
 *   lace      : floats do not apply; only bed/card overflow and openwork balance matter,
 *               and balance is measured elsewhere (`laceBalance`), so here we only report
 *               physical overflow.
 */

import { STITCH_TYPE as S } from '../math/knit-topology.js';
import { logger } from './logging.js';

const log = logger('core/chart-analysis');

/** Cells that mean "this needle just knits" in a lace chart (nothing active). */
const LACE_PLAIN = [S.KNIT, S.PURL, S.EMPTY, undefined, null];
/** Fast membership view over {@link LACE_PLAIN}. */
const LACE_PLAIN_SET = new Set(LACE_PLAIN);

/** Map a raw cell to the colour index *knitting* there, for numeric (direct) modes. */
function directColor(cell) {
  if (typeof cell === 'number') return Math.max(0, Math.trunc(cell));
  return cell ? 1 : 0;
}

/** The four machine modes KNITCAT models. Kept local so this core module imports nothing UI-side. */
export const MODES = ['lace', 'fair_isle', 'tuck', 'slip'];

/**
 * Is this cell "active" (doing something the machine physically reacts to)?
 * Direct modes punch `1`; lace does something whenever the cell is not a plain knit/purl/empty.
 *
 * @param {string} mode  one of {@link MODES}
 * @param {*} cell
 */
export function isActiveCell(mode, cell) {
  return mode === 'lace' ? !LACE_PLAIN.includes(cell) : cell === 1;
}

/** Defensive: a chart is a rectangular array of arrays, but callers may hand us holes. */
function isMatrix(M) {
  return Array.isArray(M) && M.length > 0 && Array.isArray(M[0]);
}

/**
 * Longest horizontal run of cells equal to `want` in any row, restricted to runs strictly
 * longer than `limit`. Returns the offending cells (for spotlighting), the set of row
 * indices that contain such a run, and the worst run length (0 when nothing exceeds limit).
 *
 * Behaviour is identical to the helper that used to live privately in the feasibility
 * advisor, so swapping one for the other changes nothing observable.
 *
 * @param {Array<Array<*>>} M
 * @param {*} want   the cell value to trace (1 for punched, 0 for blank/slip)
 * @param {number} [limit=0]  only runs longer than this are collected
 * @returns {{cells: Array<[number,number]>, rows: Set<number>, worst: number}}
 */
export function horizontalRuns(M, want, limit = 0) {
  const cells = [];
  const rows = new Set();
  let worst = 0;
  if (!isMatrix(M)) return { cells, rows, worst };
  for (let i = 0; i < M.length; i++) {
    const line = M[i];
    if (!line) continue;
    let start = -1;
    for (let c = 0; c <= line.length; c++) {
      const isRun = c < line.length && line[c] === want;
      if (isRun && start < 0) start = c;
      if (!isRun && start >= 0) {
        const len = c - start;
        if (len > limit) {
          rows.add(i);
          if (len > worst) worst = len;
          for (let k = start; k < c; k++) cells.push([i, k]);
        }
        start = -1;
      }
    }
  }
  return { cells, rows, worst };
}

/**
 * Longest vertical run of cells equal to `want` in any column, restricted to runs strictly
 * longer than `limit`. This is the tuck failure mode: a needle held out of action for many
 * rows piles loops into a lump that can lift off the cam track.
 *
 * @param {Array<Array<*>>} M
 * @param {*} want
 * @param {number} [limit=0]
 * @returns {{cells: Array<[number,number]>, columns: Set<number>, worst: number}}
 */
export function verticalRuns(M, want, limit = 0) {
  const cells = [];
  const columns = new Set();
  let worst = 0;
  if (!isMatrix(M)) return { cells, columns, worst };
  const cols = M[0] ? M[0].length : 0;
  for (let c = 0; c < cols; c++) {
    let start = -1;
    for (let r = 0; r <= M.length; r++) {
      const isRun = r < M.length && M[r] && M[r][c] === want;
      if (isRun && start < 0) start = r;
      if (!isRun && start >= 0) {
        const len = r - start;
        if (len > limit) {
          columns.add(c);
          if (len > worst) worst = len;
          for (let k = start; k < r; k++) cells.push([k, c]);
        }
        start = -1;
      }
    }
  }
  return { cells, columns, worst };
}

/**
 * Fraction of the chart that is an active (punched / non-plain) cell.
 * @param {Array<Array<*>>} M
 * @param {string} mode
 * @returns {{active:number, total:number, ratio:number}}
 */
export function punchedDensity(M, mode) {
  if (!isMatrix(M)) return { active: 0, total: 0, ratio: 0 };
  let active = 0;
  let total = 0;
  for (const row of M) {
    if (!row) continue;
    for (const cell of row) {
      total++;
      if (isActiveCell(mode, cell)) active++;
    }
  }
  return { active, total, ratio: total ? active / total : 0 };
}

/**
 * Count how many cells each colour knits, plus the total cell count and the number
 * of distinct colours. Lace folds into two buckets (0 ground, 1 worked) exactly like
 * the production histogram; the direct modes keep their numeric palette indices, so a
 * 6-shade jacquard reports 6. This is the ONE answer to "how many colours is this
 * card" — `analyzeChart` checks it against the machine's yarn feeders and
 * `core/yarn-consumption.js` weights each colour's yarn path from it, so the two can
 * never count colours differently.
 *
 * @param {Array<Array<*>>} M
 * @param {string} [mode='fair_isle']
 * @returns {{counts: Map<number,number>, cells:number, colors:number}}
 */
export function colorCellCounts(M, mode = 'fair_isle') {
  const counts = new Map();
  let cells = 0;
  if (!isMatrix(M)) return { counts, cells, colors: 0 };
  const lace = mode === 'lace';
  for (const row of M) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      cells++;
      const idx = lace ? (LACE_PLAIN_SET.has(cell) ? 0 : 1) : directColor(cell);
      counts.set(idx, (counts.get(idx) || 0) + 1);
    }
  }
  return { counts, cells, colors: counts.size };
}

/** A stable, order-independent key for an unordered colour pair (a < b). */
export function colorPairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Which colours actually TOUCH each other on the card — the pairs that share a horizontal or
 * vertical edge. This is the physically correct basis for a colour-legibility check: two yarns
 * only need to be distinguishable if they sit next to each other in the fabric, so a three-colour
 * jacquard where the two similar shades never meet is perfectly readable. Lace folds to the same
 * ground(0)/worked(1) buckets as {@link colorCellCounts}. Returns a de-duplicated, ascending list
 * of `[a, b]` index pairs plus a `Set` of {@link colorPairKey}s for O(1) membership tests.
 *
 * @param {Array<Array<*>>} M
 * @param {string} [mode='fair_isle']
 * @returns {{pairs: Array<[number,number]>, keys: Set<string>}}
 */
export function adjacentColorPairs(M, mode = 'fair_isle') {
  const keys = new Set();
  const pairs = [];
  if (!isMatrix(M)) return { pairs, keys };
  const lace = mode === 'lace';
  const colorAt = (cell) => (lace ? (LACE_PLAIN_SET.has(cell) ? 0 : 1) : directColor(cell));
  const add = (a, b) => {
    if (a === b) return;
    const key = colorPairKey(a, b);
    if (!keys.has(key)) { keys.add(key); pairs.push(a < b ? [a, b] : [b, a]); }
  };
  for (let r = 0; r < M.length; r++) {
    const line = M[r];
    if (!Array.isArray(line)) continue;
    for (let c = 0; c < line.length; c++) {
      const here = colorAt(line[c]);
      if (c + 1 < line.length) add(here, colorAt(line[c + 1]));   // horizontal neighbour
      const below = M[r + 1];
      if (Array.isArray(below) && c < below.length) add(here, colorAt(below[c])); // vertical
    }
  }
  return { pairs, keys };
}

/**
 * The headline float length for a mode: the longest strand the carriage lays down behind
 * the needles. Lace has none (transfers, not floats), so it reports 0.
 *
 * @param {Array<Array<*>>} M
 * @param {string} mode
 * @returns {number}
 */
export function longestFloat(M, mode) {
  if (!isMatrix(M) || mode === 'lace') return 0;
  if (mode === 'tuck') {
    // A tuck "float" is really the vertical hold; report the longest run of held (0) cells.
    return verticalRuns(M, 0, 0).worst;
  }
  if (mode === 'slip') return horizontalRuns(M, 0, 0).worst;
  // fair_isle: either colour can be the one carried across a gap, so take the worse.
  return Math.max(horizontalRuns(M, 1, 0).worst, horizontalRuns(M, 0, 0).worst);
}

/** A single finding, shaped exactly like the advisor's issue objects so `scoreIssues` consumes it. */
function finding(sev, code, title, message, extra) {
  return Object.assign({ sev, code, title, message }, extra || {});
}

/**
 * Full machine-fit analysis of a chart against a machine's limits.
 *
 * Pure: never throws, never mutates. Returns the measurements plus a list of findings in
 * the advisor's `{ sev, code, title, message }` shape (sev ∈ ok|info|warn|error), a derived
 * `status`, and the raw metrics the UI can phrase however it likes.
 *
 * @param {Array<Array<*>>} matrix  rows of cells (chart convention: row 0 is the cast-on edge)
 * @param {object} [opts]
 * @param {string} [opts.mode='fair_isle']
 * @param {object} [opts.limits]  from `profileLimits()` — {maxNeedles,maxRows,maxFloatNeedles,maxTuckLoops}
 * @param {number} [opts.beds=1]  needle-bed count (a two-bed machine reads a single-bed schedule differently)
 * @returns {{rows:number, cols:number, mode:string, metrics:object, findings:Array, status:string, longestFloat:number}}
 */
export function analyzeChart(matrix, { mode = 'fair_isle', limits = {}, beds = 1 } = {}) {
  const M = isMatrix(matrix) ? matrix : [];
  if (matrix && !isMatrix(matrix)) log.debug('analyzeChart was handed something that is not a matrix — treating it as empty', { type: typeof matrix });
  const rows = M.length;
  const cols = rows && M[0] ? M[0].length : 0;
  const maxNeedles = Number.isFinite(limits.maxNeedles) ? limits.maxNeedles : Infinity;
  const maxRows = Number.isFinite(limits.maxRows) ? limits.maxRows : Infinity;
  const maxFloat = Number.isFinite(limits.maxFloatNeedles) ? limits.maxFloatNeedles : Infinity;
  const maxTuck = Number.isFinite(limits.maxTuckLoops) ? limits.maxTuckLoops : Infinity;
  const maxColors = Number.isFinite(limits.maxColors) ? limits.maxColors : Infinity;
  // Fit checked against no finite limits is a guaranteed "it fits", which is a
  // silent false pass rather than a real verdict — worth a line in diagnostics.
  if ([maxNeedles, maxRows, maxColors].every((v) => v === Infinity)) {
    log.debug('analyzeChart ran without machine limits — overflow feasibility is unconstrained');
  }

  const findings = [];
  const density = punchedDensity(M, mode);
  const colour = colorCellCounts(M, mode);
  let floatWorst = 0;
  let tuckWorst = 0;

  // ── physical overflow: the two limits no patience gets around ────────────────
  if (cols > maxNeedles) {
    findings.push(finding('error', 'too-wide', `Wider than the ${maxNeedles}-needle bed`,
      `The card is ${cols} columns across; needles ${maxNeedles + 1}\u2013${cols} are never read.`));
  }
  if (rows > maxRows) {
    findings.push(finding('error', 'too-tall', `Taller than the ${maxRows}-row card`,
      `The card is ${rows} rows; the bottom ${rows - maxRows} would never be read.`));
  }

  // ── mode-specific mechanical risk ───────────────────────────────────────────
  if (mode === 'fair_isle') {
    const a = horizontalRuns(M, 1, 0).worst;
    const b = horizontalRuns(M, 0, 0).worst;
    floatWorst = Math.max(a, b);
    if (floatWorst > maxFloat) {
      findings.push(finding('warn', 'long-floats', `Floats up to ${floatWorst} sts`,
        `A carried yarn bridges ${maxFloat} needles at most on this machine; ${floatWorst} will snag and pucker.`));
    }
  } else if (mode === 'slip') {
    floatWorst = horizontalRuns(M, 0, 0).worst;
    if (floatWorst > maxFloat) {
      findings.push(finding('warn', 'long-floats', `Slip floats up to ${floatWorst} sts`,
        `Slipped stitches carry the unused colour behind for ${floatWorst}; past ${maxFloat} it laces the fabric tight.`));
    }
  } else if (mode === 'tuck') {
    tuckWorst = verticalRuns(M, 0, 0).worst;
    floatWorst = tuckWorst;
    if (tuckWorst > maxTuck) {
      findings.push(finding('warn', 'long-tucks', `Tucks held for ${tuckWorst} rows`,
        `Holding a needle in tuck for more than ${maxTuck} rows stacks loops into a bulky lump.`));
    }
  } else if (mode === 'lace' && beds === 2) {
    findings.push(finding('info', 'double-bed-model', 'Two needle beds',
      'A single-bed transfer schedule only approximates this machine, whose transfers move loops between the opposed beds.'));
  }

  // ── density: nothing for the carriage to grip ───────────────────────────────
  if (mode !== 'lace' && density.ratio > 0.92 && density.total > 0) {
    findings.push(finding('warn', 'over-punched', 'Almost fully punched',
      `${Math.round(density.ratio * 100)}% of the bed is holes; the fabric has little structure to hold.`));
  }

  // ── colour count vs the machine's yarn feeders ────────────────────────
  // A punchcard selects one of two positions per needle; an electronic colour changer
  // drives more. A chart needing more colours than there are feeders simply cannot be
  // auto-patterned, no matter how it looks on screen — this is the jacquard-import trap.
  if (colour.colors > maxColors) {
    findings.push(finding('error', 'too-many-colours', `Needs ${colour.colors} colours, bed has ${maxColors}`,
      `The chart uses ${colour.colors} distinct yarns but this machine auto-selects between only ${maxColors}; the extra feeders cannot be chosen by the pattern system.`));
  }

  const hasError = findings.some((f) => f.sev === 'error');
  const hasWarn = findings.some((f) => f.sev === 'warn');
  const status = hasError ? 'not-feasible' : hasWarn ? 'needs-attention' : 'feasible';
  if (hasError) {
    log.warn(`chart is not feasible for this machine (${mode})`, { codes: findings.filter((f) => f.sev === 'error').map((f) => f.code), rows, cols });
  }

  return {
    rows,
    cols,
    mode,
    metrics: {
      punchedRatio: density.ratio,
      longestFloat: floatWorst,
      longestTuck: tuckWorst,
      maxFloat,
      maxTuck,
      maxNeedles,
      maxRows,
      colors: colour.colors,
      maxColors,
      beds
    },
    findings,
    status
  };
}
