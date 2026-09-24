// The per-module logging facade over the diagnostics core.
//
// logging.js is the door 200+ modules walk through to reach core/diagnostics, so it
// must be: importable with no DOM, side-effect free until used, memoised per scope,
// and total (a logger must never throw out of a log call). This exercises the real
// shared diagnostics instance by reading its ring buffer back.
//
// Run just this file:  node --test tests/logging.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger, getDiagnostics, LEVELS } from '../js/core/logging.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('logger() returns a memoised, correctly-shaped scoped logger', () => {
  const a = logger('test/facade');
  const b = logger('test/facade');
  assert.equal(a, b, 'the same name returns the same instance');
  for (const m of ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'logError', 'guard', 'check', 'assert', 'time', 'child']) {
    assert.equal(typeof a[m], 'function', `missing ${m}()`);
  }
  assert.notEqual(logger('test/other'), a, 'different names are different scopes');
});

test('a scoped call lands in the shared buffer with the module prefix', () => {
  const diag = getDiagnostics({ capacity: 500 });
  const before = diag.records().length;
  logger('test/paint').warn('a deliberate test warning', { marker: 42 });
  const after = diag.records();
  assert.ok(after.length > before, 'the record was buffered');
  const rec = after[after.length - 1];
  assert.equal(rec.level, LEVELS.WARN);
  assert.match(rec.message, /\[test\/paint\]/, 'child() prefixes the scope');
  assert.match(rec.message, /deliberate test warning/);
});

test('logError preserves category/code from a typed cause and never throws', () => {
  const log = logger('test/err');
  const rec = log.logError('boundary', new Error('cannot read properties of undefined'), { level: LEVELS.ERROR });
  assert.equal(rec.level, LEVELS.ERROR);
  // classifyError buckets a "cannot read …" as a DOM/runtime fault.
  assert.ok(rec.category, 'category assigned');
  assert.match(rec.message, /test\/err · boundary/);
});

test('guard contains a throw and returns the fallback while recording it', () => {
  const log = logger('test/guard');
  const out = log.guard('risky', () => { throw new Error('boom'); }, { fallback: 'safe' });
  assert.equal(out, 'safe', 'the fallback is returned, the throw is swallowed');
  const rec = getDiagnostics().records().at(-1);
  assert.equal(rec.level, LEVELS.ERROR);
  assert.match(rec.message, /boom/);
});

test('check records without throwing; assert records and throws', () => {
  const log = logger('test/invariant');
  assert.equal(log.check(false, 'soft invariant broke'), false);
  assert.match(getDiagnostics().records().at(-1).message, /CHECK:/);
  assert.throws(() => log.assert(false, 'hard invariant broke'), (e) => e.code && e.name === 'DiagError');
});

test('an empty/falsy name still yields a usable logger (total, never throws)', () => {
  const log = logger('');
  assert.equal(log.name, 'app', 'falls back to the root scope');
  assert.doesNotThrow(() => { log.info('hi'); log.error(new Error('x')); });
});

test('logging.js is wired pervasively into real modules (the facade is not an orphan)', () => {
  const jsDir = path.join(ROOT, 'js');
  const byDir = new Map();
  const consumers = [];
  const self = path.join(jsDir, 'core', 'logging.js');
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!entry.name.endsWith('.js') || p === self) continue;
      if (/from\s+['"][^'"]*logging\.js['"]/.test(readFileSync(p, 'utf8'))) {
        consumers.push(p);
        const sub = path.relative(jsDir, p).split(path.sep)[0];
        byDir.set(sub, (byDir.get(sub) || 0) + 1);
      }
    }
  })(jsDir);
  // Pervasive instrumentation is the whole point of the facade: dozens of modules
  // across the tree must reach the diagnostics core through it.
  assert.ok(consumers.length >= 60, `expected the facade to be widely used, found ${consumers.length} importers`);
  // Every load-bearing subsystem directory must carry at least one scoped logger.
  for (const dir of ['core', 'compiler', 'importers', 'exporters', 'project', 'ui', 'machine', 'presets']) {
    assert.ok((byDir.get(dir) || 0) >= 1, `js/${dir} has no logging.js consumer — its errors are un-instrumented`);
  }
});
