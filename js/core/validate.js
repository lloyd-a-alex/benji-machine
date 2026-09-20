/**
 * KNITCAT — Runtime validation core.
 *
 * Small, composable, dependency-light validators for every untrusted boundary in
 * the app: imported .kcard files, shared-link URLs, pasted JSON, image bitmaps,
 * machine profiles, user-typed dimensions. Each validator is total — it either
 * returns a normalised value or throws a {@link DiagError} in the `validation`
 * category carrying the offending field, what it got and what it expected. That
 * means a bad input produces a *specific, loggable* failure, never a vague crash
 * three layers downstream.
 *
 * Nothing here touches the DOM; the whole module is pure and headless-testable.
 * `.soft` variants never throw and instead return `{ ok, value, error }` for the
 * places that would rather collect problems than abort.
 *
 * @module core/validate
 */

import { DiagError, CATEGORIES } from './diagnostics.js';

let _vseq = 0;
/** @returns {string} a fresh validation code (KV-nnn). */
function vcode() { return `KV-${String(++_vseq % 100000).padStart(3, '0')}`; }

/**
 * Build (but do not throw) a validation DiagError.
 * @param {string} field   The property/argument name at fault.
 * @param {string} reason  Why it failed.
 * @param {*}      got     The offending value (will be summarised, not dumped).
 * @param {*}      expected A description of what was required.
 * @returns {DiagError}
 */
export function validationError(field, reason, got, expected) {
  return new DiagError({
    code: vcode(),
    category: CATEGORIES.VALIDATION,
    message: `${field}: ${reason}`,
    meta: { field, reason, got: summarise(got), expected }
  });
}

/** Keep `got` small and JSON-safe inside error meta. @param {*} v @returns {string} */
function summarise(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'number' || t === 'boolean') return String(v);
  if (t === 'string') return v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`;
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (t === 'object') return `Object{${Object.keys(v).slice(0, 6).join(',')}}`;
  return t;
}

/**
 * @param {DiagError} err
 * @throws {DiagError} always.
 */
function fail(err) { throw err; }

/* ── primitives ───────────────────────────────────────────────────────────── */

/**
 * Require a finite number, optionally bounded and integer.
 * @param {unknown} value
 * @param {object} [opts] {min, max, int, field='value'}
 * @returns {number} the validated number.
 * @throws {DiagError}
 */
export function number(value, opts = {}) {
  const field = opts.field || 'value';
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) {
    fail(validationError(field, 'must be a finite number', value, 'finite number'));
  }
  if (opts.int && !Number.isInteger(n)) fail(validationError(field, 'must be an integer', n, 'integer'));
  if (opts.min != null && n < opts.min) fail(validationError(field, `must be ≥ ${opts.min}`, n, `≥ ${opts.min}`));
  if (opts.max != null && n > opts.max) fail(validationError(field, `must be ≤ ${opts.max}`, n, `≤ ${opts.max}`));
  return n;
}

/**
 * Require an integer in an optional range.
 * @param {unknown} value
 * @param {object} [opts] {min, max, field}
 * @returns {number}
 */
export function integer(value, opts = {}) { return number(value, Object.assign({ int: true }, opts)); }

/**
 * Require a non-empty string (optionally bounded length).
 * @param {unknown} value
 * @param {object} [opts] {min, max, field, allowEmpty}
 * @returns {string}
 */
export function string(value, opts = {}) {
  const field = opts.field || 'value';
  if (typeof value !== 'string') fail(validationError(field, 'must be a string', value, 'string'));
  if (!opts.allowEmpty && value.trim() === '') fail(validationError(field, 'must not be empty', value, 'non-empty string'));
  if (opts.min != null && value.length < opts.min) fail(validationError(field, `must be ≥ ${opts.min} chars`, value.length, `≥ ${opts.min}`));
  if (opts.max != null && value.length > opts.max) fail(validationError(field, `must be ≤ ${opts.max} chars`, value.length, `≤ ${opts.max}`));
  return value;
}

/**
 * Require the value to be one of an allow-list.
 * @param {unknown} value
 * @param {Array<*>} allowed
 * @param {object} [opts] {field}
 * @returns {*} the value
 */
export function oneOf(value, allowed, opts = {}) {
  const field = opts.field || 'value';
  if (!Array.isArray(allowed) || !allowed.includes(value)) {
    fail(validationError(field, 'must be one of the allowed values', value, allowed.join(' | ')));
  }
  return value;
}

/** @param {unknown} value @param {object} [opts] {field} @returns {boolean} */
export function boolean(value, opts = {}) {
  const field = opts.field || 'value';
  if (typeof value !== 'boolean') fail(validationError(field, 'must be a boolean', value, 'boolean'));
  return value;
}

/** @param {unknown} value @param {object} [opts] {field} @returns {Function} */
export function func(value, opts = {}) {
  const field = opts.field || 'value';
  if (typeof value !== 'function') fail(validationError(field, 'must be a function', value, 'function'));
  return value;
}

/**
 * Require a plain object (not null / array / primitive).
 * @param {unknown} value
 * @param {object} [opts] {field}
 * @returns {Object}
 */
export function object(value, opts = {}) {
  const field = opts.field || 'value';
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(validationError(field, 'must be an object', value, 'object'));
  }
  return value;
}

/**
 * Require an array, optionally with a length range, validating each item.
 * @param {unknown} value
 * @param {object} [opts] {min, max, field, item: (v, i) => any}
 * @returns {Array<*>}
 */
export function array(value, opts = {}) {
  const field = opts.field || 'value';
  if (!Array.isArray(value)) fail(validationError(field, 'must be an array', value, 'array'));
  if (opts.min != null && value.length < opts.min) fail(validationError(field, `must have ≥ ${opts.min} items`, value.length, `≥ ${opts.min}`));
  if (opts.max != null && value.length > opts.max) fail(validationError(field, `must have ≤ ${opts.max} items`, value.length, `≤ ${opts.max}`));
  if (typeof opts.item === 'function') return value.map((v, i) => opts.item(v, i));
  return value;
}

/* ── composable object shape ──────────────────────────────────────────────── */

/**
 * Validate an object against a shape spec. Each key maps to either a validator
 * function `(v) => v` or `{validate, optional, default}`. Unknown keys are passed
 * through untouched (this is a checker, not a sanitiser).
 *
 * @param {unknown} value
 * @param {Object<Function|{validate:Function, optional?:boolean, default?:*}>} shape
 * @param {object} [opts] {field='value'}
 * @returns {Object} a shallow copy with validated/normalised keys.
 * @throws {DiagError}
 */
export function shape(value, spec, opts = {}) {
  const field = opts.field || 'value';
  object(value, { field });
  const out = Object.assign({}, value);
  for (const key of Object.keys(spec)) {
    const rule = spec[key];
    const validator = typeof rule === 'function' ? rule : rule.validate;
    const optional = typeof rule === 'function' ? false : Boolean(rule.optional);
    const has = Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;
    if (!has) {
      if (optional) {
        if (typeof rule === 'object' && 'default' in rule) out[key] = rule.default;
        continue;
      }
      fail(validationError(`${field}.${key}`, 'is required', undefined, 'a value'));
    }
    try {
      out[key] = validator(value[key], { field: `${field}.${key}` });
    } catch (err) {
      // Re-throw with the nested path if it is one of ours.
      if (err instanceof DiagError && err.category === CATEGORIES.VALIDATION) {
        fail(validationError(`${field}.${key}`, err.meta ? err.meta.reason : err.message, value[key], err.meta ? err.meta.expected : '?'));
      }
      throw err;
    }
  }
  return out;
}

/* ── domain validators ────────────────────────────────────────────────────── */

/**
 * Validate a punchcard/stitch matrix: a rectangular grid of cells. Every row must
 * be an array of equal length, and every cell must pass `cell` (defaults to 0/1).
 *
 * @param {unknown} value            The candidate matrix.
 * @param {object}  [opts]
 * @param {number}  [opts.rows]      Required row count.
 * @param {number}  [opts.cols]      Required column count.
 * @param {number}  [opts.minRows=1]
 * @param {number}  [opts.maxRows=100000]
 * @param {(v:*, ctx:object)=>*} [opts.cell] Per-cell validator (default: 0/1).
 * @param {string}  [opts.field='matrix']
 * @returns {Array<Array<*>>} the validated matrix (not the same array references).
 * @throws {DiagError}
 */
export function matrix(value, opts = {}) {
  const field = opts.field || 'matrix';
  const minRows = opts.minRows != null ? opts.minRows : 1;
  const maxRows = opts.maxRows != null ? opts.maxRows : 100000;
  if (!Array.isArray(value)) fail(validationError(field, 'must be an array of rows', value, '2-D array'));
  if (value.length < minRows) fail(validationError(field, `must have ≥ ${minRows} rows`, value.length, `≥ ${minRows}`));
  if (value.length > maxRows) fail(validationError(field, `must have ≤ ${maxRows} rows`, value.length, `≤ ${maxRows}`));
  if (opts.rows != null && value.length !== opts.rows) fail(validationError(field, `must have exactly ${opts.rows} rows`, value.length, opts.rows));

  const cellValidator = opts.cell || defaultCell;
  let width = null;
  const out = [];
  for (let r = 0; r < value.length; r++) {
    const row = value[r];
    if (!Array.isArray(row)) fail(validationError(`${field}[${r}]`, 'row must be an array', row, 'array'));
    if (width === null) width = row.length;
    else if (row.length !== width) fail(validationError(`${field}[${r}]`, `row width ${row.length} ≠ first row width ${width}`, row.length, width));
    if (opts.cols != null && row.length !== opts.cols) fail(validationError(`${field}[${r}]`, `must have ${opts.cols} columns`, row.length, opts.cols));
    out.push(row.map((v, c) => {
      try { return cellValidator(v, { field: `${field}[${r}][${c}]` }); }
      catch (err) { if (err instanceof DiagError) fail(err); throw err; }
    }));
  }
  if (width === 0) fail(validationError(field, 'rows must not be empty', 0, '≥ 1 column'));
  return out;
}

/** Default cell rule for {@link matrix}: allow 0 or 1 (numbers) and pass through. */
function defaultCell(v, ctx) {
  if (v === 0 || v === 1) return v;
  // Booleans are a common JSON stand-in for the two states.
  if (v === true) return 1;
  if (v === false) return 0;
  fail(validationError(ctx.field, 'cell must be 0 or 1', v, '0 | 1'));
}

/**
 * Validate a machine profile object has the physical fields every downstream
 * consumer (advisor, exporters, editor limits) reads without re-checking.
 * @param {unknown} value
 * @param {object} [opts] {field='profile'}
 * @returns {Object} the profile
 * @throws {DiagError}
 */
export function machineProfile(value, opts = {}) {
  const field = opts.field || 'profile';
  return shape(value, {
    id: (v) => string(v, { field: 'id' }),
    name: (v) => string(v, { field: 'name' }),
    pitchX: (v) => number(v, { min: 0.1, field: 'pitchX' }),
    pitchY: (v) => number(v, { min: 0.1, field: 'pitchY' }),
    columns: (v) => integer(v, { min: 1, field: 'columns' }),
    maxRows: (v) => integer(v, { min: 1, field: 'maxRows' }),
    beds: (v) => oneOf(v, [1, 2], { field: 'beds' }),
    maxFloatNeedles: (v) => integer(v, { min: 1, field: 'maxFloatNeedles' }),
    maxTuckLoops: (v) => integer(v, { min: 1, field: 'maxTuckLoops' }),
    carriageRules: (v) => object(v, { field: 'carriageRules' })
  }, { field });
}

/**
 * Validate a {rows, cols} pair against a min/max envelope.
 * @param {number} rows
 * @param {number} cols
 * @param {object} [limits] {minRows, maxRows, maxNeedles}
 * @returns {{rows:number, cols:number}}
 */
export function dimensions(rows, cols, limits = {}) {
  const r = integer(rows, { min: 1, field: 'rows' });
  const c = integer(cols, { min: 1, field: 'cols' });
  if (limits.minRows != null && r < limits.minRows) fail(validationError('rows', `must be ≥ ${limits.minRows}`, r, `≥ ${limits.minRows}`));
  if (limits.maxRows != null && r > limits.maxRows) fail(validationError('rows', `must be ≤ ${limits.maxRows}`, r, `≤ ${limits.maxRows}`));
  if (limits.maxNeedles != null && c > limits.maxNeedles) fail(validationError('cols', `exceeds the ${limits.maxNeedles}-needle bed`, c, `≤ ${limits.maxNeedles}`));
  return { rows: r, cols: c };
}

/* ── soft (never-throwing) wrappers ───────────────────────────────────────── */

/**
 * Run any throwing validator and capture the outcome instead of aborting.
 * @template T
 * @param {() => T} fn A call to one of the strict validators.
 * @param {string} [field] A label for a caught non-DiagError.
 * @returns {{ok:true, value:T} | {ok:false, error:DiagError}}
 */
export function soft(fn, field = 'value') {
  try { return { ok: true, value: fn() }; }
  catch (err) {
    if (err instanceof DiagError) return { ok: false, error: err };
    return { ok: false, error: validationError(field, String((err && err.message) || err), undefined, 'a valid value') };
  }
}

/**
 * Collect every problem in a value at once rather than stopping at the first —
 * ideal for a validation report panel.
 * @param {Array<[string, () => *]}> entries `[label, thunk]` pairs to attempt.
 * @returns {Array<{label:string, ok:boolean, error?:Object}>}
 */
export function collect(entries) {
  return (Array.isArray(entries) ? entries : []).map(([label, thunk]) => {
    const r = soft(() => (typeof thunk === 'function' ? thunk() : thunk), label);
    return r.ok ? { label, ok: true } : { label, ok: false, error: r.error.toJSON ? r.error.toJSON() : { message: r.error.message } };
  });
}
