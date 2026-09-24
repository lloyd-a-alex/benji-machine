/**
 * KNITCAT V2 — the backends barrel (spec §4.6).
 *
 * The seven output generators the compiler can emit, gathered into one registry the driver maps
 * over. Each backend is a pure function of the IR (plus options) returning either a string or a
 * `{string, meta}` structure — nothing here touches the DOM or the Project directly; the driver
 * hands them what they need. Keeping them behind one map means "add an output format" is a single
 * line, and `compileProject({outputs:['written','machine']})` selects a subset without branching.
 *
 * @module compiler/backends
 */

export { chartBackend } from './chart.js';
export { writtenBackend } from './written.js';
export { machineBackend } from './machine.js';
export { punchcardBackend } from './punchcard.js';
export { dxfBackend } from './dxf.js';
export { gcodeBackend } from './gcode.js';
export { manufacturingBackend } from './manufacturing.js';
export { ayabBackend, csvBackend, dakBackend, binaryBackend, passapBackend, knitmateBackend, CARD_BACKENDS } from './cards.js';
export { punchMatrix, resolveProfile } from './_card.js';
import { logger } from '../../core/logging.js';

const log = logger('compiler/backends');

import { chartBackend } from './chart.js';
import { writtenBackend } from './written.js';
import { machineBackend } from './machine.js';
import { punchcardBackend } from './punchcard.js';
import { dxfBackend } from './dxf.js';
import { gcodeBackend } from './gcode.js';
import { manufacturingBackend } from './manufacturing.js';
import { CARD_BACKENDS } from './cards.js';

/**
 * The canonical backend registry: id → `{ run(ir, options), kind, label }`.
 * `kind` tells the caller whether to expect a raw string or a structured object.
 */
export const BACKENDS = Object.freeze({
  chart: { run: chartBackend, kind: 'string', label: 'Colourwork chart (SVG)' },
  written: { run: writtenBackend, kind: 'string', label: 'Written pattern (Markdown)' },
  machine: { run: machineBackend, kind: 'string', label: 'Machine instructions' },
  punchcard: { run: punchcardBackend, kind: 'object', label: 'Punchcard (SVG + ASCII)' },
  dxf: { run: dxfBackend, kind: 'object', label: 'Punchcard DXF (CAD)' },
  gcode: { run: gcodeBackend, kind: 'object', label: 'Punchcard G-code (CNC)' },
  manufacturing: { run: manufacturingBackend, kind: 'object', label: 'Manufacturing tech pack' },
  ...CARD_BACKENDS
});

/** Every backend id, in canonical order. */
export const BACKEND_IDS = Object.freeze(Object.keys(BACKENDS));

/** The default set emitted by `compileProject` when the caller asks for "everything". */
export const DEFAULT_OUTPUTS = Object.freeze(['written', 'chart', 'machine', 'punchcard']);

/**
 * Run one or more backends over an IR.
 * @param {object} ir
 * @param {string[]} [ids] backend ids (defaults to {@link DEFAULT_OUTPUTS})
 * @param {object} [options] forwarded to each backend; unknown ids are reported, never fatal
 * @returns {{results:Object.<string,*>, errors:Object.<string,string>}}
 */
export function runBackends(ir, ids = DEFAULT_OUTPUTS, options = {}) {
  const results = {};
  const errors = {};
  for (const id of ids) {
    const backend = BACKENDS[id];
    if (!backend) {
      log.warn(`requested an unknown backend "${id}"`, { known: BACKEND_IDS });
      errors[id] = `Unknown backend "${id}". Known: ${BACKEND_IDS.join(', ')}.`;
      continue;
    }
    try {
      results[id] = backend.run(ir, options);
    } catch (e) {
      // A backend throwing is an emit-time bug: keep the pipeline alive but capture the
      // full error here at the source, where the stack still exists.
      log.logError(`backend "${id}" threw while emitting`, e, { context: { backend: id } });
      errors[id] = e && e.message ? e.message : String(e);
    }
  }
  return { results, errors };
}
