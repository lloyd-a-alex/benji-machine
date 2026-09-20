// Exhaustive, DOM-free tests for the two new observability cores:
//   js/core/diagnostics.js  (structured logging, ring buffer, error taxonomy,
//                            guard/assert/check/time, global capture net)
//   js/core/validate.js     (composable runtime validators with typed DiagErrors)
// These modules must import with no browser present, exactly like the rest of the
// graph (see module-graph.test.mjs), so nothing here touches window/document.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDiagnostics, getDiagnostics, installDiagnostics,
  LEVELS, CATEGORIES, DiagError, classifyError, serializeError
} from '../js/core/diagnostics.js';

import {
  number as vNumber, integer as vInteger, string as vString, oneOf as vOneOf,
  boolean as vBoolean, func as vFunc, object as vObject, array as vArray,
  shape as vShape, matrix as vMatrix, machineProfile as vProfile,
  dimensions as vDims, soft as vSoft, collect as vCollect, validationError
} from '../js/core/validate.js';

/** A fresh, silent instance with a controllable clock. */
function fresh(extra = {}) {
  let t = 0;
  return createDiagnostics(Object.assign({ quiet: true, now: () => t }, extra));
}

/* ── diagnostics: levels, buffer, counters ────────────────────────────────── */

test('log records structure, increments counters and fills the ring buffer', () => {
  const d = fresh();
  d.info('hello', { a: 1 });
  d.warn('careful');
  d.error('boom');
  const rec = d.records();
  assert.equal(rec.length, 3);
  assert.deepEqual(rec.map(r => r.level), ['info', 'warn', 'error']);
  assert.equal(rec[0].seq, 1);
  assert.equal(rec[2].seq, 3);
  assert.equal(rec[0].data.a, 1);
  const s = d.snapshot();
  assert.equal(s.total, 3);
  assert.equal(s.byLevel.warn, 1);
  assert.equal(s.byLevel.error, 1);
});

test('the ring buffer is bounded and drops the oldest records first', () => {
  const d = fresh({ capacity: 3 });
  for (let i = 0; i < 10; i++) d.debug(`m${i}`);
  const rec = d.records();
  assert.equal(rec.length, 3);
  assert.deepEqual(rec.map(r => r.message), ['m7', 'm8', 'm9']);
  // Counters keep the true total even though the buffer is trimmed.
  assert.equal(d.snapshot().total, 10);
});

test('minLevel filters what is mirrored but everything is still buffered', () => {
  const d = fresh({ minLevel: 'error' });
  d.info('quiet');
  d.error('loud');
  assert.equal(d.records().length, 2); // buffer keeps both
});

/* ── diagnostics: guard / assert / check / time ───────────────────────────── */

test('guard returns the value, the fallback, or rethrows per options', () => {
  const d = fresh();
  assert.equal(d.guard('ok', () => 42), 42);
  assert.equal(d.guard('bad', () => { throw new Error('x'); }, { fallback: -1 }), -1);
  assert.throws(() => d.guard('rt', () => { throw new Error('y'); }, { rethrow: true }), /y/);
  // both failures were recorded
  assert.equal(d.snapshot().byLevel.error, 2);
});

test('guard awaits a rejected promise and returns the fallback', async () => {
  const d = fresh();
  const out = await d.guard('async', () => Promise.reject(new Error('nope')), { fallback: 'fellback' });
  assert.equal(out, 'fellback');
});

test('assert throws a typed DiagError; check records without throwing', () => {
  const d = fresh();
  assert.equal(d.assert(true, 'fine'), true);
  assert.throws(() => d.assert(false, 'nope', { category: CATEGORIES.VALIDATION }), (err) => {
    return err instanceof DiagError && err.category === CATEGORIES.VALIDATION && /^KV-/.test(err.code);
  });
  assert.equal(d.check(false, 'soft invariant'), false);
  assert.equal(d.check(true, 'ok'), true);
});

test('time measures and surfaces the slowest op in the snapshot', () => {
  let t = 0;
  const d = fresh({ now: () => t });
  const out = d.time('slow', () => { t += 300; return 'value'; });
  assert.equal(out, 'value');
  const s = d.snapshot();
  assert.equal(s.slowest[0].label, 'slow');
  assert.equal(s.slowest[0].maxMs, 300);
  // a >200ms op also raises a warn
  assert.equal(s.byLevel.warn, 1);
});

test('subscribe receives records and unsubscribe stops delivery', () => {
  const d = fresh();
  const seen = [];
  const off = d.subscribe(r => seen.push(r.message));
  d.info('one');
  off();
  d.info('two');
  assert.deepEqual(seen, ['one']);
});

test('a throwing subscriber cannot break logging or other subscribers', () => {
  const d = fresh();
  const got = [];
  d.subscribe(() => { throw new Error('bad listener'); });
  d.subscribe(r => got.push(r.seq));
  d.info('fine');
  assert.deepEqual(got, [1]);
});

test('exportJSON yields parseable session data', () => {
  const d = fresh();
  d.error('kaboom');
  const parsed = JSON.parse(d.exportJSON());
  assert.equal(parsed.records[0].message, 'kaboom');
  assert.equal(parsed.snapshot.total, 1);
});

test('reset clears the buffer and counters', () => {
  const d = fresh();
  d.info('x');
  d.reset();
  assert.equal(d.records().length, 0);
  assert.equal(d.snapshot().total, 0);
});

/* ── diagnostics: error taxonomy + serialisation ──────────────────────────── */

test('classifyError buckets by message across the cause chain', () => {
  assert.equal(classifyError(new Error('invalid value: out of range')), CATEGORIES.VALIDATION);
  assert.equal(classifyError(new Error('canvas 2d context is null')), CATEGORIES.CANVAS);
  assert.equal(classifyError(new Error('fetch failed: network')), CATEGORIES.NETWORK);
  assert.equal(classifyError(Object.assign(new Error('boom'), { cause: new Error('cannot read property x of undefined') })), CATEGORIES.DOM);
  assert.equal(classifyError(new Error('totally novel')), CATEGORIES.UNKNOWN);
});

test('serializeError handles DiagError, Error, string and null', () => {
  const de = new DiagError({ code: 'KV-1', message: 'm', category: CATEGORIES.VALIDATION, meta: { field: 'f' } });
  assert.equal(serializeError(de).code, 'KV-1');
  assert.equal(serializeError(new Error('plain')).name, 'Error');
  assert.equal(serializeError('a string').message, 'a string');
  assert.equal(serializeError(null).name, 'Thrown');
});

test('DiagError.toJSON walks its cause chain', () => {
  const inner = new DiagError({ code: 'KC-2', message: 'root', category: CATEGORIES.COMPILER });
  const outer = new DiagError({ code: 'KU-1', message: 'wrapper', cause: inner });
  const j = outer.toJSON();
  assert.equal(j.cause.code, 'KC-2');
});

/* ── diagnostics: the global capture net (with a fake window) ─────────────── */

function fakeWindow() {
  return {
    handlers: {},
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    dispatch(type, ev) { (this.handlers[type] || []).forEach(fn => fn(ev)); }
  };
}

test('installGlobal catches uncaught errors and unhandled rejections and bridges to onError', () => {
  const w = fakeWindow();
  const d = fresh();
  const bridged = [];
  d.installGlobal({ globals: { window: w }, console: false, onError: r => bridged.push(r.level) });

  w.dispatch('error', { message: 'script blew up', filename: 'https://x/js/app.js', lineno: 10, colno: 3, target: w, error: new Error('script blew up') });
  w.dispatch('unhandledrejection', { reason: new Error('promise rejected') });

  assert.equal(bridged.length, 2);
  assert.equal(bridged[0], LEVELS.FATAL);
  const recs = d.records();
  assert.ok(recs.some(r => /uncaught/.test(r.message)));
  assert.ok(recs.some(r => /unhandled rejection/.test(r.message)));
  assert.equal(w.KNITCAT_DIAG, d);
});

test('installGlobal records resource load failures under the resource category', () => {
  const w = fakeWindow();
  const d = fresh();
  d.installGlobal({ globals: { window: w }, console: false });
  w.dispatch('error', { target: { tagName: 'IMG', src: 'https://cdn/missing.png' } });
  const r = d.records().find(x => x.category === CATEGORIES.RESOURCE);
  assert.ok(r, 'a resource-category record should exist');
  assert.match(r.message, /missing\.png/);
});

test('installGlobal is a no-op with no window (headless safety)', () => {
  const d = fresh();
  // No globals.window, and Node has no window either — must not throw.
  assert.doesNotThrow(() => d.installGlobal({ console: false }));
});

test('getDiagnostics memoises a single instance and installDiagnostics uses it', () => {
  assert.equal(getDiagnostics(), getDiagnostics());
  const w = fakeWindow();
  installDiagnostics({ globals: { window: w }, console: false });
  assert.equal(w.KNITCAT_DIAG, getDiagnostics());
});

/* ── validate: primitives ─────────────────────────────────────────────────── */

function expectValidation(fn) {
  assert.throws(fn, (err) => err instanceof DiagError && err.category === CATEGORIES.VALIDATION && /^KV-/.test(err.code));
}

test('number / integer enforce finiteness, integrality and bounds', () => {
  assert.equal(vNumber('3.5'), 3.5);
  assert.equal(vNumber(4, { min: 1, max: 5 }), 4);
  expectValidation(() => vNumber(NaN));
  expectValidation(() => vNumber(3.5, { int: true }));
  expectValidation(() => vNumber(10, { max: 5 }));
  expectValidation(() => vNumber(true)); // booleans are not numbers here
  assert.equal(vInteger('7', { min: 1 }), 7);
  expectValidation(() => vInteger(1.5));
});

test('string / boolean / func / object / oneOf guard their types', () => {
  assert.equal(vString('hi'), 'hi');
  expectValidation(() => vString('   ')); // empty after trim
  assert.equal(vString('', { allowEmpty: true }), '');
  assert.equal(vBoolean(false), false);
  expectValidation(() => vBoolean(0));
  assert.equal(vOneOf('b', ['a', 'b']), 'b');
  expectValidation(() => vOneOf('c', ['a', 'b']));
  assert.equal(typeof vFunc(() => {}), 'function');
  expectValidation(() => vFunc(5));
  expectValidation(() => vObject([]));
  expectValidation(() => vObject(null));
});

test('array validates length range and maps each item', () => {
  assert.deepEqual(vArray([1, 2, 3], { min: 2, max: 4 }), [1, 2, 3]);
  expectValidation(() => vArray('nope'));
  expectValidation(() => vArray([1], { min: 2 }));
  assert.deepEqual(vArray([1, 2], { item: (v) => v * 10 }), [10, 20]);
});

/* ── validate: shape / matrix / domain ────────────────────────────────────── */

test('shape enforces required keys, applies defaults and nests the field path', () => {
  const ok = vShape({ rows: 4, cols: 2 }, { rows: (v) => vInteger(v, { min: 1 }), cols: (v) => vInteger(v) });
  assert.deepEqual(ok, { rows: 4, cols: 2 });
  const withDefault = vShape({}, { mode: { validate: vString, optional: true, default: 'lace' } });
  assert.equal(withDefault.mode, 'lace');
  expectValidation(() => vShape({ rows: 0 }, { rows: (v) => vInteger(v, { min: 1 }) }));
  // The nested field path should surface in the error meta.
  try { vShape({ rows: -1 }, { rows: (v) => vInteger(v, { min: 1 }) }); }
  catch (err) { assert.match(err.meta.field, /rows/); }
});

test('matrix requires a rectangular grid of valid cells', () => {
  assert.deepEqual(vMatrix([[0, 1], [1, 0]]), [[0, 1], [1, 0]]);
  assert.deepEqual(vMatrix([[true, false]], { cell: (v) => v }), [[true, false]]);
  expectValidation(() => vMatrix([[0, 1], [1]]));          // ragged
  expectValidation(() => vMatrix([[0, 2]]));               // bad cell (default 0/1)
  expectValidation(() => vMatrix('nope'));                 // not an array
  expectValidation(() => vMatrix([], { minRows: 1 }));     // too few rows
});

test('machineProfile checks the physical fields downstream consumers rely on', () => {
  const good = {
    id: 'x', name: 'X', pitchX: 2, pitchY: 2, columns: 60, maxRows: 200,
    beds: 1, maxFloatNeedles: 7, maxTuckLoops: 48, carriageRules: {}
  };
  assert.equal(vProfile(good).id, 'x');
  expectValidation(() => vProfile(Object.assign({}, good, { beds: 3 })));
  expectValidation(() => vProfile(Object.assign({}, good, { pitchX: 0 })));
});

test('dimensions checks the row/col envelope', () => {
  assert.deepEqual(vDims(10, 20, { maxNeedles: 60, maxRows: 200 }), { rows: 10, cols: 20 });
  expectValidation(() => vDims(0, 20));
  expectValidation(() => vDims(10, 100, { maxNeedles: 60 }));
});

/* ── validate: soft / collect / validationError ───────────────────────────── */

test('soft captures success and typed failure without throwing', () => {
  assert.deepEqual(vSoft(() => vNumber(5)), { ok: true, value: 5 });
  const bad = vSoft(() => vNumber('x'));
  assert.equal(bad.ok, false);
  assert.ok(bad.error instanceof DiagError);
  // a non-DiagError is wrapped into a validation error
  assert.equal(vSoft(() => { throw new Error('weird'); }, 'field').error.category, CATEGORIES.VALIDATION);
});

test('collect reports every problem at once', () => {
  const report = vCollect([
    ['rows', () => vInteger(3)],
    ['cols', () => vInteger(-1, { min: 1 })]
  ]);
  assert.equal(report[0].ok, true);
  assert.equal(report[1].ok, false);
  assert.equal(report[1].label, 'cols');
});

test('validationError carries field/reason/got/expected meta', () => {
  const e = validationError('rows', 'must be ≥ 1', 0, '≥ 1');
  assert.equal(e.meta.field, 'rows');
  assert.equal(e.meta.got, '0');
  assert.equal(e.category, CATEGORIES.VALIDATION);
});
