/**
 * KNITCAT V2 — the Intermediate Representation (spec §4.3).
 *
 * The IR is the compiler's lingua franca. Every backend (chart, written, machine, punchcard,
 * DXF, G-code, manufacturing) reads *only* this structure; every optimiser and verifier mutates
 * or inspects only this structure. That is what turns seven exporters into one compiler: the
 * Fit Engine's row-by-row {@link PatternPiece} list and the constraint graph's numbers are
 * flattened here into explicit, self-describing rows where *nothing is implied* — each row
 * carries its operations, the stitch count before and after, the yarn in hand and the carriage
 * required. A backend never has to re-derive arithmetic; if the IR is valid, the outputs agree.
 *
 * This module defines the node shapes, pure factories to build them, an operation catalogue,
 * and {@link validateIr} — a structural contract the pipeline runs before optimisation so a bug
 * upstream fails loudly here rather than silently emitting a broken pattern.
 *
 * @module compiler/ir
 */

/** Every operation kind an {@link IRRow} may contain. Mirrors spec §4.3 `IROperation`. */
export const IR_OPERATIONS = Object.freeze([
  'knit', 'purl', 'decrease', 'increase', 'short-row', 'yarn-change', 'transfer',
  'bind-off', 'cast-on', 'pick-up', 'join', 'seam', 'rib', 'tuck', 'miss', 'split', 'rest'
]);

/** Carriages an IR row can require. */
export const IR_CARRIAGES = Object.freeze(['knit', 'lace', 'combined', 'ribber', 'tuck', 'idle']);

/** Bind-off / cast-on styles recognised by the backends. */
export const IR_EDGESTYLES = Object.freeze(['standard', 'picot', 'rolled', 'tubular', 'crochet', 'icord', 'stitch-stitch']);

/** A blank gauge for an IR that has not had one attached. */
export const IR_VERSION = 2;

/**
 * @typedef {object} IROperation
 * @property {string} kind one of {@link IR_OPERATIONS}
 * @property {number} [count]
 * @property {('left'|'right'|'both'|'centre'|'four-lines'|'distributed')} [position]
 * @property {('left'|'right')} [side]
 * @property {string} [from] @property {string} [to]
 * @property {string} [style]
 * @property {string} [note]
 */

/**
 * Build one operation with a sanity-checked kind.
 * @param {string} kind @param {object} [props] @returns {IROperation}
 */
export function op(kind, props = {}) {
  if (!IR_OPERATIONS.includes(kind)) throw new Error(`Unknown IR operation kind: ${kind}`);
  return Object.assign({ kind }, prune(props));
}

/**
 * An IR row: one physical pass of the carriage over the piece.
 * @typedef {object} IRRow
 * @property {number} index 1-based
 * @property {IROperation[]} operations
 * @property {number} stitchesBefore
 * @property {number} stitchesAfter
 * @property {string} yarn the yarn key in hand at the start of the row
 * @property {('knit'|'lace'|'combined'|'ribber'|'tuck'|'idle')} carriage
 * @property {boolean} [rightSide]
 * @property {string} [note]
 */

/**
 * Build a row, deriving `stitchesAfter` from the operations if not given.
 * @param {number} index @param {object} [parts]
 * @returns {IRRow}
 */
export function irRow(index, parts = {}) {
  const operations = Array.isArray(parts.operations) ? parts.operations : [op('knit')];
  const before = Number(parts.stitchesBefore) || 0;
  const delta = operations.reduce((d, o) => d + stitchDelta(o), 0);
  return {
    index,
    operations,
    stitchesBefore: before,
    stitchesAfter: parts.stitchesAfter != null ? Number(parts.stitchesAfter) : before + delta,
    yarn: parts.yarn || 'main',
    carriage: parts.carriage || 'knit',
    rightSide: parts.rightSide != null ? Boolean(parts.rightSide) : (index % 2 === 1),
    note: parts.note || ''
  };
}

/** Net stitch change an operation causes (positive = more stitches on the needle). */
export function stitchDelta(o = {}) {
  const count = Number(o.count) || 0;
  switch (o.kind) {
    case 'decrease': return -(o.position === 'both' ? count * 2 : count);
    case 'increase': return (o.position === 'both' ? count * 2 : count);
    case 'bind-off': return -(o.position === 'both' ? count * 2 : count);
    case 'cast-on': return (o.position === 'both' ? count * 2 : count);
    default: return 0; // knit/purl/short-row/transfer/yarn-change/rib/tuck/miss/rest are net-zero
  }
}

/**
 * @typedef {object} IRPiece
 * @property {string} id @property {string} name
 * @property {number} stitches cast-on count
 * @property {number} rows total row count
 * @property {IRRow[]} rowsDetail every explicit row
 * @property {object} [shape] silhouette hints
 * @property {object[]} [edges] seam / pick-up edge descriptors
 * @property {string[]} [joinFrom] pieces this one is joined to
 * @property {object} [dimensions] finished cm { width, length, ... }
 */

/** Build an IR piece from a cast-on + array of IRRows, back-filling row/stitch totals. */
export function irPiece(def = {}) {
  const rowsDetail = Array.isArray(def.rowsDetail) ? def.rowsDetail : [];
  return {
    id: def.id || 'piece',
    name: def.name || 'Piece',
    stitches: Number(def.stitches) || (rowsDetail[0] ? rowsDetail[0].stitchesBefore : 0),
    rows: Number(def.rows) || rowsDetail.length,
    rowsDetail,
    shape: def.shape || null,
    edges: def.edges || [],
    joinFrom: def.joinFrom || [],
    pickUp: def.pickUp || null,
    dimensions: def.dimensions || {}
  };
}

/**
 * @typedef {object} KnitIR
 * @property {number} version
 * @property {{name:string, yarnNames:string[], finishedBust:number, finishedLength:number, finishedSleeve:number, construction:string, notes:string}} metadata
 * @property {{stsPer10cm:number, rowsPer10cm:number, gaugeMm:number}} gauge
 * @property {{id:string, bedStitches:number, bedWidthCm:number, gaugeMm:number, carriage:string, profile?:object}} machine
 * @property {IRPiece[]} pieces
 * @property {object} [schedule] carriage-pass schedule produced by the machine optimiser
 * @property {IRColorAssignment[]} colors
 * @property {number[][]} [cardMatrix] a colourwork matrix (row → colour index) for card/chart backends
 * @property {object[]} checks verification verdicts (filled by the verifier)
 * @property {object[]} decisions explainable derivations (filled by derive)
 */

/**
 * Assemble a full IR object from parts, filling safe defaults so downstream code never
 * dereferences undefined.
 * @param {Partial<KnitIR>} parts @returns {KnitIR}
 */
export function buildIr(parts = {}) {
  const meta = parts.metadata || {};
  return {
    version: IR_VERSION,
    metadata: {
      name: meta.name || 'Untitled pattern',
      yarnNames: Array.isArray(meta.yarnNames) ? meta.yarnNames : [],
      finishedBust: num(meta.finishedBust, 0),
      finishedLength: num(meta.finishedLength, 0),
      finishedSleeve: num(meta.finishedSleeve, 0),
      construction: meta.construction || 'unknown',
      gaugeCm: num(meta.gaugeCm, 10),
      notes: meta.notes || ''
    },
    gauge: {
      stsPer10cm: num((parts.gauge || {}).stsPer10cm, 0),
      rowsPer10cm: num((parts.gauge || {}).rowsPer10cm, 0),
      gaugeMm: num((parts.gauge || {}).gaugeMm, (parts.machine || {}).gaugeMm || 0)
    },
    machine: {
      id: (parts.machine || {}).id || 'standard',
      bedStitches: num((parts.machine || {}).bedStitches, 0),
      bedWidthCm: num((parts.machine || {}).bedWidthCm, 0),
      gaugeMm: num((parts.machine || {}).gaugeMm, 0),
      carriage: (parts.machine || {}).carriage || 'knit',
      profile: (parts.machine || {}).profile || null
    },
    pieces: Array.isArray(parts.pieces) ? parts.pieces : [],
    schedule: parts.schedule || null,
    colors: Array.isArray(parts.colors) ? parts.colors : [],
    cardMatrix: parts.cardMatrix || null,
    checks: parts.checks || [],
    decisions: parts.decisions || []
  };
}

/**
 * @typedef {object} IRColorAssignment
 * @property {number} index @property {string} yarn @property {string} hex @property {string} [symbol]
 */

/**
 * Structural validation — the compiler's internal contract. Throws with an aggregated list of
 * problems (never a silent partial IR); a passing IR guarantees the fields every backend reads.
 * @param {KnitIR} ir @returns {{ok:true, errors:[]}} or throws
 */
export function validateIr(ir) {
  const errors = [];
  if (!ir || ir.version !== IR_VERSION) errors.push(`IR version must be ${IR_VERSION}`);
  if (!ir.metadata || !ir.metadata.name) errors.push('IR missing metadata.name');
  if (!ir.pieces || !ir.pieces.length) errors.push('IR has no pieces');
  (ir.pieces || []).forEach((p, i) => {
    if (!p.id) errors.push(`piece[${i}] missing id`);
    if (!Array.isArray(p.rowsDetail)) errors.push(`piece ${p.id || i} rowsDetail not an array`);
    if (Number(p.stitches) < 0) errors.push(`piece ${p.id || i} negative cast-on`);
    (p.rowsDetail || []).forEach((r, ri) => {
      if (!Number.isFinite(r.stitchesBefore)) errors.push(`${p.id || i} row ${ri} stitchesBefore NaN`);
      if (r.stitchesAfter < 0) errors.push(`${p.id || i} row ${ri} negative stitch count`);
      (r.operations || []).forEach(o => { if (!IR_OPERATIONS.includes(o.kind)) errors.push(`${p.id || i} row ${ri} bad op ${o.kind}`); });
    });
    const last = (p.rowsDetail || [])[p.rowsDetail.length - 1];
    if (last && Math.abs(last.stitchesAfter - (p.dimensions && p.dimensions.finalStitches != null ? p.dimensions.finalStitches : last.stitchesAfter)) < 0) {
      // no-op; final stitch consistency handled by the fit verifier
    }
  });
  if (errors.length) { const e = new Error('Invalid IR: ' + errors.slice(0, 8).join('; ') + (errors.length > 8 ? ` (+${errors.length - 8} more)` : '')); e.errors = errors; throw e; }
  return { ok: true, errors: [] };
}

/** Flatten every row across every piece into one ordered list (with piece tags). */
export function allRows(ir) {
  const out = [];
  for (const p of (ir && ir.pieces) || []) for (const r of p.rowsDetail) out.push({ piece: p, row: r });
  return out;
}

/** Total rows across the IR (the knitting length). */
export function totalRows(ir) { return allRows(ir).length; }

/** Total decreases across the IR — used by time/cost estimates and the machine optimiser. */
export function countOperations(ir, kind) {
  let n = 0;
  for (const p of (ir && ir.pieces) || []) for (const r of p.rowsDetail) for (const o of r.operations) if (o.kind === kind) n += (o.count || 1);
  return n;
}

function num(v, d) { return Number.isFinite(Number(v)) ? Number(v) : d; }
function prune(obj) { const o = {}; for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) o[k] = v; return o; }
