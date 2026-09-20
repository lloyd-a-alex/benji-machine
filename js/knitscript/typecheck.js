/**
 * KNITCAT V2 — KnitScript type-checker.
 *
 * Sits between the parser and the interpreter in the pipeline. It does *not* decide the
 * program is executable — that is the interpreter's job — it collects the soft,
 * knitter-meaningful problems a raw parse cannot: a body with no bust/chest, a length in
 * a unit we cannot convert, a yarn with no meterage, a gauge that is physically absurd,
 * an unknown machine or construction. Everything it returns is a
 * {@link module:knitscript/diagnostics.Diagnostic}; it never throws, so a half-written
 * KnitScript still gets useful feedback in the editor rather than a stack trace.
 *
 * DOM-free.
 *
 * @module knitscript/typecheck
 */

import { UNITS_TO_CM } from './interpreter.js';

/** Length units the whole system can convert. Anything else is a warning. */
const KNOWN_LEN_UNITS = new Set(Object.keys(UNITS_TO_CM));
/** Units that are legal but not lengths (weights, counts, angles, percentages). */
const OTHER_UNITS = new Set(['g', 'oz', 'kg', 'st', 'deg', '%', 'sts', 'rows', 'balls', 'skeins', 'sp', 'ply', 'mm']);

/** The measurement a "fitting" garment cannot be drafted without. */
const REQUIRED_BODY = ['bust', 'backLength'];

/**
 * Type-check a normalised spec (the interpreter's output) and return diagnostics.
 * @param {{name:string, sections:Record<string,any>}} spec
 * @returns {Array<import('./diagnostics.js').Diagnostic>}
 */
export function typecheck(spec) {
  const out = [];
  if (!spec || typeof spec !== 'object') {
    out.push(err('A KnitScript must contain a project.'));
    return out;
  }
  const s = spec.sections || {};
  checkBody(s.body, out);
  checkYarns(s.yarn, out);
  checkMachine(s.machine, out);
  checkGarment(s.garment, out);
  checkGauge(s.swatch, out);
  return out;
}

function checkBody(body, out) {
  if (!body) { out.push(warn('No body: measurements section — garments will fall back to a standard size.')); return; }
  walkLengths(body, (path, len) => {
    if (len.unit && !KNOWN_LEN_UNITS.has(len.unit) && !OTHER_UNITS.has(len.unit)) {
      out.push(warn(`Unknown unit "${len.unit}" on ${path}.`, 'unknown-unit'));
    }
  });
  for (const key of REQUIRED_BODY) {
    if (!hasMeasurement(body, key)) {
      out.push(warn(`Body has no "${key}" measurement; it will be estimated from the size chart.`, 'missing-measurement'));
    }
  }
}

function checkYarns(yarns, out) {
  if (!yarns) return;
  for (const [name, y] of Object.entries(yarns)) {
    if (!y || typeof y !== 'object') { out.push(warn(`Yarn "${name}" is empty.`)); continue; }
    if (y.meterage == null && y.weight == null) {
      out.push(warn(`Yarn "${name}" has no meterage or weight — cost and yardage cannot be computed.`, 'incomplete-yarn'));
    }
    if (y.color && typeof y.color === 'string' && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(y.color)) {
      out.push(warn(`Yarn "${name}" color "${y.color}" is not a #hex value.`));
    }
  }
}

function checkMachine(machine, out) {
  if (!machine) return;
  if (!machine.id) out.push(warn('Machine section has no id (e.g. "brother_kh830").'));
  if (machine.gauge && machine.gauge.value != null) {
    const mm = machine.gauge.unit === 'cm' ? machine.gauge.value * 10 : machine.gauge.value;
    if (!(mm > 0) || mm > 20) out.push(warn(`Machine gauge ${machine.gauge.value}${machine.gauge.unit || ''} looks out of range (0–20mm).`, 'implausible-gauge'));
  }
}

function checkGarment(garment, out) {
  if (!garment) { out.push(warn('No garment: section — nothing to fit.')); return; }
  if (!garment.kind) out.push(warn('Garment has no construction (e.g. raglanSweater).', 'no-construction'));
  if (garment.ease && garment.ease.value != null && garment.ease.value < -5) {
    out.push(warn(`Ease of ${garment.ease.value}${garment.ease.unit || ''} is strongly negative — the garment will not fit over the body.`, 'impossible-ease'));
  }
}

function checkGauge(swatch, out) {
  if (!swatch) return;
  const sts = swatch.stitchesPer10cm != null ? swatch.stitchesPer10cm
    : (swatch.sts && (swatch.sts.left != null ? swatch.sts.left : swatch.sts.value));
  if (sts != null && (sts < 5 || sts > 80)) out.push(warn(`Swatch gauge ${sts} sts/10cm is implausible.`, 'implausible-gauge'));
}

/** Does a body map carry a measurement under any of a set of aliases? */
function hasMeasurement(body, key) {
  const aliases = { bust: ['bust', 'chest'], backLength: ['backLength', 'backLengthCm', 'back'] };
  for (const a of [key].concat(aliases[key] || [])) if (body[a] != null) return true;
  return false;
}

/** Visit every `{value,unit}` length in a nested spec object, calling cb(path, len). */
function walkLengths(obj, cb, prefix = '') {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') {
      if (typeof v.value === 'number' && ('unit' in v)) cb(path, v);
      else if (Array.isArray(v)) v.forEach((item, i) => walkLengths(item, cb, `${path}[${i}]`));
      else walkLengths(v, cb, path);
    }
  }
}

const err = (message, rule) => ({ severity: 'error', message, rule: rule || 'typecheck' });
const warn = (message, rule) => ({ severity: 'warning', message, rule: rule || 'typecheck' });
