/**
 * KNITCAT V2 — the card-format compiler backends.
 *
 * Up to now the machine text formats (AYAB bitstream, Passap double-bed, DesignaKnit,
 * KnitMate two-bed, CSV and the raw binary bitstream) lived only as `FormatsExporter`
 * static methods and one-off button handlers in `app.js`. That meant the compiler — the
 * single place that turns a design into *every* output from *one* IR — could not emit
 * them: `compileProject({ outputs: ['punchcard'] })` gave you a card, but
 * `compileProject({ outputs: ['ayab', 'knitmate'] })` reported unknown backends. This
 * module closes that gap by promoting the six machine formats into first-class compiler
 * backends that read the same IR the punchcard backend already reduces to a boolean card
 * (via `./_card.js`), then hand the card straight to the battle-tested exporters.
 *
 * The fusion principle holds: **nothing here re-implements a format.** Each backend is a
 * thin `(ir, options) => { text, meta }` adapter that (a) reduces the IR to a card with
 * the shared `punchMatrix`, and (b) calls the one authoritative writer for that format
 * (`FormatsExporter`, `generatePassapPattern`, `generateKnitMatePattern`). Because the
 * matching readers in `js/importers/*` are the exact inverses of those same writers, the
 * whole set round-trips: `readAnyProject(compileProject(...).outputs.ayab)` reproduces
 * the chart, and the round trip is asserted in `tests/card-formats.test.mjs`.
 *
 * Every backend is total: it never throws (a poisoned IR degrades to `{ text:'', meta }`
 * with the error captured in `meta.errors`), so `compileProject(p, { outputs: 'all' })`
 * stays safe for the adversarial tests that iterate `BACKEND_IDS`.
 *
 * DOM-free, pure. @module compiler/backends/cards
 */

import { FormatsExporter } from '../../exporters/formats-dak.js';
import { generatePassapPattern, passapSummary } from '../../exporters/formats-passap.js';
import { generateKnitMatePattern, knitMateSummary } from '../../exporters/formats-knitmate.js';
import { punchMatrix, resolveProfile } from './_card.js';
import { logger } from '../../core/logging.js';

const log = logger('compiler/backends/cards');

/**
 * Reduce an IR to the card both the boolean and colour families of formats need.
 * Returns the machine profile, the boolean punch matrix, and a numeric colour matrix
 * (real colour indices when the IR carries them, otherwise 0/1 from the punch card) —
 * so `generateDakText` gets the numbers it prints and the bit formats get booleans.
 * @param {object} ir @param {object} options
 * @returns {{profile:object, card:{matrix:boolean[][],columns:number,rows:number,source:string,truncated:boolean,notes:string[]}, colourMatrix:number[][], holes:number}}
 */
function cardFromIr(ir, options = {}) {
  const profile = resolveProfile((ir && ir.machine) || 'brother_standard_24');
  const card = punchMatrix(ir, { ...options, columns: options.columns || profile.columns });
  const colourSource = ir && Array.isArray(ir.cardMatrix) && ir.cardMatrix.length ? ir.cardMatrix : null;
  const colourMatrix = colourSource
    ? card.matrix.map((row, r) => row.map((_, c) => {
      const src = colourSource[r];
      return Number(src && src[c] != null ? src[c] : 0) || 0;
    }))
    : card.matrix.map(row => row.map(b => (b ? 1 : 0)));
  const holes = card.matrix.reduce((n, row) => n + row.filter(Boolean).length, 0);
  return { profile, card, colourMatrix, holes };
}

/**
 * Wrap a card-emitting function so it is total: any throw inside becomes an
 * `{ text:'', meta:{ errors:[…] } }` verdict rather than aborting `runBackends` (which
 * would drop the key from `report.outputs` and break the "every backend was invoked"
 * invariant). @param {(ir:object, options:object)=>{text:string, meta:object}} make
 * @returns {(ir:object, options?:object)=>{text:string, meta:object}}
 */
function totalCardBackend(make) {
  return (ir, options = {}) => {
    try {
      return make(ir, options || {});
    } catch (e) {
      // The backend is total by design, but a swallowed emit failure is otherwise
      // invisible: capture it so "my AYAB file came out empty" has a trace.
      log.warn('a card backend threw and degraded to an empty output', { error: e && e.message ? e.message : String(e) });
      return { text: '', meta: { errors: [e && e.message ? e.message : String(e)] } };
    }
  };
}

/**
 * AYAB bitstream backend — the format the `js/features/serial.js` "Send to machine" wire
 * protocol streams, and the one the Arduino / KH-930 floppy emulator consumes.
 * @param {object} ir @param {object} [options]
 * @returns {{text:string, meta:object}}
 */
export const ayabBackend = totalCardBackend((ir, options) => {
  const { profile, card, holes } = cardFromIr(ir, options);
  const text = FormatsExporter.generateAyabFormat(card.matrix);
  return {
    text,
    meta: {
      format: 'ayab', machine: profile.name, machineId: profile.id,
      columns: card.columns, rows: card.rows, source: card.source,
      truncated: card.truncated, punchedHoles: holes, notes: card.notes.slice()
    }
  };
});

/**
 * CSV matrix backend — a spreadsheet of cells (`Row,Col_1,…`) every knitting program and
 * every KNITCAT reader understands. Bottom row first, exactly as the editor stores it.
 * @param {object} ir @param {object} [options]
 * @returns {{text:string, meta:object}}
 */
export const csvBackend = totalCardBackend((ir, options) => {
  const { profile, card, holes } = cardFromIr(ir, options);
  const text = FormatsExporter.generateCsv(card.matrix);
  return {
    text,
    meta: {
      format: 'csv', machine: profile.name, machineId: profile.id,
      columns: card.columns, rows: card.rows, source: card.source,
      truncated: card.truncated, punchedHoles: holes, notes: card.notes.slice()
    }
  };
});

/**
 * DesignaKnit stitch-pattern backend. Prints the *colour* matrix (real indices where the
 * IR carries them), so a stranded chart comes back as `0/1/2/…` rather than a flattened
 * punch card. @param {object} ir @param {object} [options]
 * @returns {{text:string, meta:object}}
 */
export const dakBackend = totalCardBackend((ir, options) => {
  const { profile, card, colourMatrix } = cardFromIr(ir, options);
  const text = FormatsExporter.generateDakText(colourMatrix);
  const colours = colourMatrix.reduce((set, row) => { for (const v of row) set.add(v); return set; }, new Set());
  return {
    text,
    meta: {
      format: 'dak', machine: profile.name, machineId: profile.id,
      columns: card.columns, rows: card.rows, source: card.source,
      truncated: card.truncated, colours: [...colours].sort((a, b) => a - b), notes: card.notes.slice()
    }
  };
});

/**
 * Raw packed binary bitstream backend (1 bit per hole, MSB first) — the byte blob an
 * Arduino / AYAB shield reads off an SD card. It is not text, so this backend returns
 * `base64` (portable, DOM-free) alongside the byte length rather than a `text` field.
 * @param {object} ir @param {object} [options]
 * @returns {{text:string, base64:string, byteLength:number, meta:object}}
 */
export const binaryBackend = totalCardBackend((ir, options) => {
  const { profile, card, holes } = cardFromIr(ir, options);
  const bytes = FormatsExporter.generateBinaryBitstream(card.matrix);
  const base64 = bytesToBase64(bytes);
  return {
    text: base64,
    base64,
    byteLength: bytes ? bytes.length : 0,
    meta: {
      format: 'binary', machine: profile.name, machineId: profile.id,
      columns: card.columns, rows: card.rows, bytesPerRow: Math.ceil(card.columns / 8),
      source: card.source, truncated: card.truncated, punchedHoles: holes, notes: card.notes.slice()
    }
  };
});

/**
 * Passap E6000 double-bed backend. Maps the card to interleaved Front/Back bit rows
 * (every needle punched on exactly one bed). A machine whose carriage rules mark it as a
 * `passap_pushers` bed reads the back bed reversed, so the mirror is derived from the
 * profile unless the caller forces it — matching the `app.js` export behaviour.
 * @param {object} ir @param {object} [options]
 * @returns {{text:string, meta:object}}
 */
export const passapBackend = totalCardBackend((ir, options) => {
  const { profile, card } = cardFromIr(ir, options);
  const mirrorBack = options.mirrorBack != null
    ? !!options.mirrorBack
    : !!(profile.carriageRules && profile.carriageRules.type === 'passap_pushers');
  const text = generatePassapPattern(card.matrix, { title: profile.name, mirrorBack });
  const summary = passapSummary(card.matrix, { mirrorBack });
  return {
    text,
    meta: {
      format: 'passap', machine: profile.name, machineId: profile.id, beds: 2,
      columns: card.columns, rows: card.rows, source: card.source, truncated: card.truncated,
      mirrorBack, frontPunches: summary.frontPunches, backPunches: summary.backPunches,
      notes: card.notes.slice()
    }
  };
});

/**
 * KnitMate two-bed punch-map backend. Unlike Passap (one bed per needle) this carries all
 * four needle states, so it is the double-bed dialect a camera-read or hand-edited card
 * round-trips through. `options.mirror` reverses each row for a card fed end-for-end.
 * @param {object} ir @param {object} [options]
 * @returns {{text:string, meta:object}}
 */
export const knitmateBackend = totalCardBackend((ir, options) => {
  const { profile, card } = cardFromIr(ir, options);
  const mirror = !!options.mirror;
  const text = generateKnitMatePattern(card.matrix, { title: profile.name, mirror });
  const summary = knitMateSummary(card.matrix, { mirror });
  return {
    text,
    meta: {
      format: 'knitmate', machine: profile.name, machineId: profile.id, beds: 2,
      columns: card.columns, rows: card.rows, source: card.source, truncated: card.truncated,
      mirror, frontPunches: summary.frontPunches, backPunches: summary.backPunches,
      bothPunches: summary.bothPunches, blankNeedles: summary.blankNeedles,
      notes: card.notes.slice()
    }
  };
});

/**
 * Encode bytes to base64 without depending on `Buffer` (Node) or `btoa` (browser) so this
 * backend stays environment-agnostic and DOM-free. Accepts a typed array or a plain array.
 * @param {Uint8Array|number[]} bytes @returns {string}
 */
function bytesToBase64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const len = bytes ? bytes.length : 0;
  let out = '';
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i] & 0xff;
    const b1 = i + 1 < len ? bytes[i + 1] & 0xff : 0;
    const b2 = i + 2 < len ? bytes[i + 2] & 0xff : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
    out += i + 1 < len ? alphabet[(n >> 6) & 63] : '=';
    out += i + 2 < len ? alphabet[n & 63] : '=';
  }
  return out;
}

/** The card-family backends, keyed by the id `compileProject({outputs:[…]})` expects. */
export const CARD_BACKENDS = Object.freeze({
  ayab: { run: ayabBackend, kind: 'object', label: 'AYAB bitstream' },
  csv: { run: csvBackend, kind: 'object', label: 'Card matrix (CSV)' },
  dak: { run: dakBackend, kind: 'object', label: 'DesignaKnit stitch pattern' },
  binary: { run: binaryBackend, kind: 'object', label: 'Raw binary bitstream' },
  passap: { run: passapBackend, kind: 'object', label: 'Passap double-bed pattern' },
  knitmate: { run: knitmateBackend, kind: 'object', label: 'KnitMate two-bed punch-map' }
});

/** Ids of the card-family backends, in canonical order. */
export const CARD_BACKEND_IDS = Object.freeze(Object.keys(CARD_BACKENDS));
