// KNITCAT — diabolical integration battery.
//
// This is the "try to break it" layer that runs *after* the feature wiring, and it
// deliberately tests CONTRACTS and INVARIANTS rather than golden values, so ordinary
// internal changes never force edits here. Every assertion is a promise the code must
// keep no matter what hostile input arrives:
//
//   • the physical-card pipeline (export -> import) is round-trip lossless,
//   • no DOM-free engine throws on garbage — it returns ok:false / a string,
//   • the machine registry cannot be prototype-poluted through a crafted id,
//   • the exporters fail *descriptively* when a required profile is missing,
//   • the schedule exporter HTML-escapes everything it interpolates,
//   • Web Serial degrades to inert no-ops where the API does not exist.
//
// Several cases here are regression pins for real defects found while fuzzing; each is
// marked "REGRESSION".
//
//   node --test "tests/diabolical-integrations.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerProfile, unregisterProfile, listCustomProfiles, loadCustomProfiles,
  MACHINE_PROFILES, BUILT_IN_PROFILES, isBuiltInProfile
} from '../js/machine/profiles.js';
import { readAnyProject } from '../js/importers/reader-registry.js';
import { holesToMatrix, estimatePitch } from '../js/importers/grid-quantize.js';
import { analyzePunchcard, otsuFromHistogram, histogram, luminance, labelComponents, componentStats, filterBlobs } from '../js/importers/punchcard-reader.js';
import { isSerialSupported, textToBytes, createSerialSender, openSerialIfSupported } from '../js/features/serial.js';
import { CadDxfExporter } from '../js/exporters/cad-dxf.js';
import { CncGcodeExporter } from '../js/exporters/cnc-gcode.js';
import { FormatsExporter } from '../js/exporters/formats-dak.js';
import { VectorSvgExporter } from '../js/exporters/vector-svg.js';
import { diffCells } from '../js/ui/thumbnail.js';

const profile = BUILT_IN_PROFILES.brother_standard_24;

// A card with a hole in every row and column (and all four corners) so a grid
// re-anchored at the sparsest corner still spans the full width/height — this lets the
// round-trip assertions compare exact dimensions without depending on blank edges.
const ROWS = 5;
const COLS = 11; // deliberately NOT a multiple of 8 to exercise bit packing
const CHECKER = Array.from({ length: ROWS }, (_, r) =>
  Array.from({ length: COLS }, (_, c) => ((r + c) % 2 === 0 || r === 0 || r === ROWS - 1) ? 1 : 0));

function cellsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) if ((a[r][c] ? 1 : 0) !== (b[r][c] ? 1 : 0)) return false;
  }
  return true;
}

// A battery of malformed / hostile matrices every engine must survive without throwing.
const EVIL_MATRICES = [
  [], [[]], [[], [1]], [[1], [1, 1, 1]], [[NaN]], [[Infinity]], [[-1]], [[2]],
  [[null]], [[undefined]], [[{}]],
  Array.from({ length: 2500 }, () => [1, 0]),
  [[1, '<svg onload="x">', '&"\''], [1, 0]]
];
const GARBAGE_TEXT = ['', '   ', '{{{{', 'null', '[]', '{}', 'G1 X', '0,', '<script>x</script>', 'VERSION 1\n', '\u0000\u0001binary', '0\nSECTION\n2\nENTITIES'];

/* ─────────────────────────── machine registry hardening ─────────────────────────── */

test('registerProfile rejects every prototype-pollution id and leaves the registry clean', () => {
  const protoBefore = Object.getPrototypeOf(MACHINE_PROFILES);
  for (const bad of ['__proto__', 'constructor', 'prototype']) {
    const res = registerProfile({ ...profile, id: bad, name: 'evil-' + bad });
    assert.equal(res.ok, false, `${bad} must not register`);
  }
  // The shared registry keeps its real prototype and a plain object is unaffected.
  assert.equal(Object.getPrototypeOf(MACHINE_PROFILES), protoBefore);
  assert.equal({}.name, undefined, 'Object.prototype.name must stay clean');
  assert.equal(({}).__proto__, Object.prototype, 'Object.prototype must stay clean');
});

test('registerProfile rejects non-slug ids and non-objects without throwing', () => {
  for (const bad of ['', 'a.b', 'with space', 'x'.repeat(300), '../../etc', 'ok/../x', '1;DROP']) {
    assert.equal(registerProfile({ ...profile, id: bad }).ok, false, `id ${JSON.stringify(bad)} rejected`);
  }
  for (const notObj of [null, undefined, 42, 'str', [], true]) {
    assert.doesNotThrow(() => registerProfile(notObj));
    assert.equal(registerProfile(notObj).ok, false);
  }
});

test('a valid custom profile registers as custom, lists, and unregisters', () => {
  const id = 'dia_test_machine_1';
  if (MACHINE_PROFILES[id]) unregisterProfile(id);
  const res = registerProfile({ ...profile, id, name: 'Diabolic Test Machine' });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.profile.custom, true);
  assert.ok(listCustomProfiles().some(p => p.id === id));
  assert.equal(isBuiltInProfile(id), false);
  assert.equal(unregisterProfile(id).ok, true);
  assert.equal(unregisterProfile(id).ok, false, 'second removal reports nothing to remove');
});

test('built-in ids can never be overwritten and removal is refused', () => {
  const id = 'brother_standard_24';
  const originalName = MACHINE_PROFILES[id].name;
  assert.equal(registerProfile({ ...profile, id, name: 'HIJACK' }).ok, false);
  assert.equal(MACHINE_PROFILES[id].name, originalName);
  assert.equal(unregisterProfile(id).ok, false);
});

test('loadCustomProfiles survives corrupt and hostile storage without throwing', () => {
  const shims = [
    { getItem() { throw new Error('storage exploded'); } },
    { getItem: () => 'not json at all {' },
    { getItem: () => '{"not":"an array"}' },
    { getItem: () => '[null,1,"x",{},{"id":"__proto__"}]' },
    { getItem: () => '[]' },
    null
  ];
  for (const storage of shims) {
    assert.doesNotThrow(() => {
      const n = loadCustomProfiles(storage);
      assert.equal(typeof n, 'number');
      assert.ok(n >= 0);
    });
  }
  assert.equal(({}).__proto__, Object.prototype, 'a stored __proto__ id must not pollute');
});

/* ─────────────────────────── reader registry (never throws) ─────────────────────────── */

test('readAnyProject never throws and always returns {ok, warnings[]} for garbage', () => {
  for (const g of GARBAGE_TEXT) {
    const res = readAnyProject(g, { profile });
    assert.equal(typeof res.ok, 'boolean', 'ok is boolean for ' + JSON.stringify(g.slice(0, 12)));
    assert.ok(Array.isArray(res.warnings), 'warnings is an array');
  }
  for (const g of [null, undefined, 123, {}, [], Symbol ? 'sym' : 'x']) {
    assert.doesNotThrow(() => readAnyProject(g, { profile }));
  }
});

/* ─────────────────────────── export -> import round trips ─────────────────────────── */

function roundTrip(label, text) {
  const res = readAnyProject(text, { profile, name: label });
  assert.equal(res.ok, true, `${label}: expected a successful read, got "${res.error}"`);
  const m = res.project.stitchMatrix;
  assert.ok(Array.isArray(m) && m.length && Array.isArray(m[0]), `${label}: produced a matrix`);
  assert.ok(cellsEqual(m, CHECKER), `${label}: round trip must reproduce the exact chart (${m.length}x${m[0].length})`);
}

test('DAK text export imports back identically', () => roundTrip('dak', FormatsExporter.generateDakText(CHECKER)));
test('CSV export imports back identically', () => roundTrip('csv', FormatsExporter.generateCsv(CHECKER)));
test('AYAB export imports back identically', () => roundTrip('ayab', FormatsExporter.generateAyabFormat(CHECKER)));

test('DXF export imports back identically', () => {
  // REGRESSION: the reader used to look for `0 / ENTITIES` and so never entered the
  // entities section of a conforming DXF (including our own export), recovering zero
  // holes. A section is named by `2 <name>` following `0 SECTION`.
  roundTrip('dxf', CadDxfExporter.generateDxf(profile, CHECKER));
});

test('G-code export imports back identically (sprockets excluded)', () => {
  // REGRESSION: the reader used to fold the tractor sprocket strip into the pattern,
  // inflating the recovered grid. Sprocket moves are annotated `(sprocket)` and must be
  // skipped exactly like the DXF reader drops the CUT_SPROCKETS layer.
  roundTrip('gcode', new CncGcodeExporter({}).generateGCode(profile, CHECKER));
});

/* ─────────────────────────── grid quantiser ─────────────────────────── */

test('holesToMatrix recovers a lattice it produced (matrix -> holes -> matrix)', () => {
  const holes = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (CHECKER[r][c]) holes.push({ x: c * 4.5, y: r * 5.08 });
  const res = holesToMatrix(holes, { pitchX: 4.5, pitchY: 5.08 });
  assert.equal(res.ok, true);
  assert.ok(cellsEqual(res.matrix, CHECKER));
});

test('holesToMatrix handles a huge hole cloud without a stack overflow', () => {
  // REGRESSION: `Math.min(...xs)` on a several-hundred-thousand hole cloud threw
  // "RangeError: Maximum call stack size exceeded" — reachable from a high-resolution
  // photo of a fine card. A linear scan cannot overflow.
  const n = 400_000;
  const holes = new Array(n);
  for (let i = 0; i < n; i++) holes[i] = { x: (i % 1500) * 4.5, y: Math.floor(i / 1500) * 5.08 };
  assert.doesNotThrow(() => holesToMatrix(holes, { pitchX: 4.5, pitchY: 5.08 }));
});

test('grid primitives never throw on degenerate input', () => {
  assert.doesNotThrow(() => holesToMatrix([], {}));
  assert.doesNotThrow(() => holesToMatrix([{ x: NaN, y: 1 }, null, { x: 1 }], { pitchX: 0, pitchY: 0 }));
  assert.equal(estimatePitch([]), 0);
  assert.equal(estimatePitch([5]), 0);
  assert.equal(estimatePitch([NaN, Infinity]), 0);
});

/* ─────────────────────────── punchcard photo reader ─────────────────────────── */

test('analyzePunchcard degrades gracefully on malformed images', () => {
  const bad = [null, undefined, {}, { width: 0, height: 0, data: new Uint8ClampedArray(0) },
    { width: 3, height: 3, data: new Uint8ClampedArray(4) }, // short data
    { width: 4, height: 4 }]; // no data at all
  for (const img of bad) {
    let res;
    assert.doesNotThrow(() => { res = analyzePunchcard(img, {}); });
    assert.equal(typeof res.ok, 'boolean');
    if (!res.ok) assert.equal(typeof res.error, 'string');
  }
});

test('analyzePunchcard reads a synthetic high-contrast card back to a grid', () => {
  const w = 60, h = 40, px = 6, py = 8; // hole every 6x8 px => a clean lattice
  const data = new Uint8ClampedArray(w * h * 4); // all black card
  for (let i = 0; i < w * h; i++) { data[i * 4 + 3] = 255; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const isHole = (Math.floor(x / px) % 2 === 0) && (Math.floor(y / py) % 2 === 0);
    if (isHole) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; }
  }
  const res = analyzePunchcard({ width: w, height: h, data }, { punchedIsLight: true, minBlobPx: 4 });
  assert.equal(res.ok, true, res.error);
  assert.ok(res.rows >= 2 && res.cols >= 2, 'recovered a real grid');
  assert.ok(res.matrix.some(row => row.some(v => v)), 'grid has punched cells');
});

test('low-level image helpers are total functions (never throw)', () => {
  assert.doesNotThrow(() => luminance({ width: 2, height: 1, data: [1, 2, 3] })); // short data ok
  assert.doesNotThrow(() => histogram([NaN, -5, 999, 3]));
  const th = otsuFromHistogram(new Int32Array(0));
  assert.equal(typeof th, 'number');
  assert.ok(th >= 0 && th <= 255);
  assert.doesNotThrow(() => labelComponents(new Uint8Array(0), 0, 0));
  assert.doesNotThrow(() => componentStats(new Int32Array(0), 0, 1));
  assert.deepEqual(filterBlobs([], {}), []);
});

/* ─────────────────────────── Web Serial (headless) ─────────────────────────── */

test('serial is inert where the API is absent', () => {
  assert.equal(isSerialSupported(), false); // node has no navigator.serial
  assert.equal(openSerialIfSupported({}), null);
});

test('textToBytes is total and UTF-8 correct', () => {
  assert.ok(textToBytes('') instanceof Uint8Array);
  assert.equal(textToBytes('').length, 0);
  assert.equal(textToBytes(null).length, 0);
  assert.equal(textToBytes(undefined).length, 0);
  assert.deepEqual(Array.from(textToBytes('ab')), [97, 98]);
});

test('a serial sender with no connection reports failure instead of throwing', async () => {
  const sender = createSerialSender({});
  assert.equal(sender.supported, false);
  assert.equal(sender.connected, false);
  const connect = await sender.connect();
  assert.equal(connect.ok, false);
  assert.equal(connect.unsupported, true);
  const send = await sender.send('anything');
  assert.equal(send.ok, false);
  assert.equal(typeof send.error, 'string');
  await sender.disconnect(); // idempotent teardown
});

/* ─────────────────────────── exporters: robustness + escaping ─────────────────────────── */

test('exporters return strings for any matrix and never throw', () => {
  const emit = [
    m => CadDxfExporter.generateDxf(profile, m),
    m => new CncGcodeExporter({}).generateGCode(profile, m),
    m => VectorSvgExporter.generateLaserSvg(profile, m),
    m => FormatsExporter.generateAsciiCard(profile, m),
    m => FormatsExporter.generateCsv(m),
    m => FormatsExporter.generateDakText(m),
    m => FormatsExporter.generateAyabFormat(m)
  ];
  for (const make of emit) {
    for (const m of EVIL_MATRICES) {
      let out;
      assert.doesNotThrow(() => { out = make(m); });
      assert.equal(typeof out, 'string');
    }
  }
  // The raw bitstream is a byte array, not text — assert only that it is total.
  for (const m of EVIL_MATRICES) {
    assert.doesNotThrow(() => {
      const b = FormatsExporter.generateBinaryBitstream(m);
      assert.ok(b == null || typeof b === 'string' || ArrayBuffer.isView(b) || Array.isArray(b));
    });
  }
  // The tiler returns one SVG string per physical page — assert that shape holds.
  for (const m of EVIL_MATRICES) {
    assert.doesNotThrow(() => {
      const pages = VectorSvgExporter.generateTiledPrintablePages(profile, m, 'A4');
      assert.ok(Array.isArray(pages) ? pages.every(p => typeof p === 'string') : typeof pages === 'string');
    });
  }
});

test('the geometry exporters fail descriptively (not by property access) without a profile', () => {
  // REGRESSION: with a null profile these threw a cryptic
  // "Cannot read properties of null (reading 'carriageRules')" from deep inside.
  const needProfile = [
    () => CadDxfExporter.generateDxf(null, [[1]]),
    () => new CncGcodeExporter({}).generateGCode(undefined, [[1]]),
    () => VectorSvgExporter.generateLaserSvg(null, [[1]]),
    () => VectorSvgExporter.generateTiledPrintablePages(null, [[1]])
  ];
  for (const call of needProfile) {
    assert.throws(call, (err) => err instanceof TypeError && /profile/i.test(err.message));
  }
});

test('the schedule sheet escapes every interpolated field', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = VectorSvgExporter.generateScheduleSheets(
    [{ notes: evil, carriageType: 'x"' + evil, punchcardHoles: [1, evil], transfers: [{ sourceCol: 0, targetCol: evil }] }],
    { profile: { name: evil } }
  );
  assert.ok(!/<img/i.test(html), 'no raw <img tag leaks');
  assert.ok(!/<script/i.test(html), 'no raw script leaks');
  assert.ok(html.includes('&lt;'), 'markup was escaped to entities');
  assert.ok(html.includes('&quot;'), 'quotes were escaped');
  assert.doesNotThrow(() => VectorSvgExporter.generateScheduleSheets(null, {}));
  assert.doesNotThrow(() => VectorSvgExporter.generateScheduleSheets([null, {}, { x: NaN }], { profile: null }));
});

/* ─────────────────────────── thumbnail diff ─────────────────────────── */

test('diffCells returns a well-formed grid and tolerates ragged / empty input', () => {
  const d = diffCells([[1, 0], [0, 1]], [[1, 1], [0, 0]]);
  assert.equal(typeof d.rows, 'number');
  assert.equal(typeof d.cols, 'number');
  assert.ok(Array.isArray(d.cells));
  for (const [a, b] of [[null, null], [[], []], [[1]], [[1, 2], [3]], [[9]], [[-1]]]) {
    assert.doesNotThrow(() => diffCells(a, b));
  }
});
