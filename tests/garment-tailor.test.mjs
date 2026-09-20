// Tests for the unified tailor's browser-free math: geometry, exports, machine
// fashioning, size grading and yarn estimation. Run with:
//   node --test "tests/garment-tailor.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildGeometry } from '../js/tailor/garment-geometry.js';
import { outlineToDxf, outlineToSvg } from '../js/tailor/garment-export.js';
import { buildFashioning } from '../js/tailor/machine-steps.js';
import { gradeSizes } from '../js/tailor/grading.js';
import { estimateYarn } from '../js/tailor/yarn-estimate.js';
import { ClothesEngine, GARMENTS, CATEGORIES } from '../js/tailor/clothes-catalog.js';

const STRUCTURES = ['hat', 'tube', 'flat', 'body', 'hand', 'sock', 'triangle', 'tank'];
const byId = id => GARMENTS.find(g => g.id === id);

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
}

// ─── Geometry: every structure yields a real, finite closed outline ───────────

test('buildGeometry returns a finite closed loop for every structure', () => {
  for (const structure of STRUCTURES) {
    const spec = structure === 'tank'
      ? { params: {}, gauge: { stitchesPer10Cm: 24, rowsPer10Cm: 32 }, cols: 24, rows: 24 }
      : { cols: 24, rows: 30, cellW: 4, cellH: 5 };
    const geo = buildGeometry(structure, spec);
    assert.ok(Array.isArray(geo.outlineMm) && geo.outlineMm.length >= 3, `${structure} has a polygon`);
    for (const p of geo.outlineMm) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${structure} finite vertex`);
    }
    assert.ok(polygonArea(geo.outlineMm) > 0, `${structure} encloses area (closed loop)`);
    assert.ok(geo.widthMm > 0 && geo.heightMm > 0, `${structure} has extents`);
    assert.ok(geo.cols >= 2 && geo.rows >= 2, `${structure} grid is at least 2x2`);
  }
});

test('geometry grid maps one cell to one needle (width = cols * cell)', () => {
  const geo = buildGeometry('tube', { cols: 20, rows: 40, cellW: 4.5, cellH: 5 });
  assert.ok(Math.abs(geo.widthMm - 20 * 4.5) < 1e-6);
  assert.ok(Math.abs(geo.heightMm - 40 * 5) < 1e-6);
});

test('buildGeometry is defensive against garbage spec input', () => {
  const geo = buildGeometry('body', { cols: NaN, rows: 'x', cellW: undefined });
  assert.ok(geo.outlineMm.length >= 3);
  assert.ok(geo.outlineMm.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

// ─── Exports: DXF and seam-allowance print SVG for any outline ────────────────

const sample = buildGeometry('body', { cols: 24, rows: 30, cellW: 4.5, cellH: 5 });

test('DXF export is well-formed, layered and signed', () => {
  const dxf = outlineToDxf(sample.outlineMm, { heightMm: sample.heightMm });
  assert.match(dxf, /AC1009/);
  assert.match(dxf, /CUT_LINE/);
  assert.match(dxf, /GRAIN_LINE/);
  assert.match(dxf, /made for Benji/);
  assert.match(dxf, /EOF$/);
});

test('print SVG is well-formed with a cut edge, seam line and signature', () => {
  const svg = outlineToSvg(sample.outlineMm, {
    widthMm: sample.widthMm, heightMm: sample.heightMm, seamAllowance: 10,
    title: 'Sweater', castOn: 120, rows: 180, gauge: '24/32'
  });
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<svg[\s\S]*<\/svg>/);
  assert.match(svg, /class="cut-edge"/);
  assert.match(svg, /class="seam-line"/);
  assert.match(svg, /made for Benji/);
});

test('exports tolerate empty input without throwing', () => {
  assert.equal(outlineToDxf([]), '');
  assert.equal(outlineToSvg(null), '');
});

// ─── Machine fashioning: needle positions for the KH-830 ──────────────────────

test('fashioning emits centred needle ranges for a body and a hat', () => {
  const eng = new ClothesEngine();
  const gauge = { stitchesPer10Cm: 24, rowsPer10Cm: 32 };
  for (const id of ['sweater', 'beanie']) {
    const plan = eng.compute(byId(id), {}, gauge);
    const steps = buildFashioning(plan, { pitchX: 4.5, bedLengthMm: 900, columns: 24 });
    assert.ok(steps.length >= 4, `${id} has a real schedule`);
    assert.ok(steps.every(s => Number.isFinite(s.step) && s.title && s.text));
    assert.ok(steps.some(s => /Needles L\d/.test(s.text)), `${id} names needle positions`);
  }
});

// ─── Size grading: monotonic cast-on across the run ───────────────────────────

test('graded sizes produce a monotonic cast-on for a body garment', () => {
  const eng = new ClothesEngine();
  const gauge = { stitchesPer10Cm: 24, rowsPer10Cm: 32 };
  const sweater = byId('sweater');
  const run = gradeSizes(sweater, { chest: 100, length: 62, rib: 5, sleeve: 45 }, { mode: 'alpha' });
  assert.ok(run.length >= 5, 'a full XS–XL run');
  const castOns = run.map(s => eng.compute(sweater, s.params, gauge).parts[0].castOn);
  for (let i = 1; i < castOns.length; i++) {
    assert.ok(castOns[i] >= castOns[i - 1], `cast-on never shrinks (${castOns[i - 1]} → ${castOns[i]})`);
  }
  assert.ok(castOns[castOns.length - 1] > castOns[0], 'XL is genuinely bigger than XS');
});

test('hats grade by head size and socks by foot size', () => {
  const hatRun = gradeSizes(byId('beanie'), { head: 56, height: 20, rib: 5, segments: 6 }, {});
  assert.equal(hatRun[0].label, 'Baby', 'hats use the head size set');
  const sockRun = gradeSizes(byId('socks'), { calf: 24, leg: 20, foot: 25, rib: 5 }, {});
  assert.equal(sockRun[0].label, 'Baby', 'socks use the foot size set');
});

// ─── Yarn estimate: scales with the work and converts to grams ────────────────

test('yarn estimate scales with stitch work and honours grams-per-metre', () => {
  const gauge = { stitchesPer10Cm: 24, rowsPer10Cm: 32 };
  const small = { parts: [{ castOn: 50, rows: 50 }] };
  const big = { parts: [{ castOn: 50, rows: 100 }] };
  const a = estimateYarn(small, gauge, {});
  const b = estimateYarn(big, gauge, {});
  assert.ok(b.meters > a.meters, 'more rows → more yarn');
  assert.ok(a.meters > 0);
  const weighed = estimateYarn(small, gauge, { gramsPerMeter: 2 });
  assert.ok(Math.abs(weighed.grams - weighed.meters * 2) < 1e-6, 'grams = metres × density');
});

test('yarn estimate is zero (not NaN) on missing gauge', () => {
  const r = estimateYarn({ parts: [{ castOn: 10, rows: 10 }] }, {}, {});
  assert.equal(r.meters, 0);
  assert.equal(r.grams, null);
});

// ─── The catalogue now carries the shared capabilities ────────────────────────

test('every catalog plan carries geometry, fashioning, yarn and sizes', () => {
  const eng = new ClothesEngine();
  const gauge = { stitchesPer10Cm: 24, rowsPer10Cm: 32 };
  for (const g of GARMENTS) {
    const plan = eng.compute(g, {}, gauge);
    assert.ok(plan.geometry && plan.geometry.outlineMm.length >= 3, `${g.id} geometry`);
    assert.ok(Array.isArray(plan.fashioning) && plan.fashioning.length >= 3, `${g.id} fashioning`);
    assert.ok(Number.isFinite(plan.yarn.meters), `${g.id} yarn`);
    assert.ok(Array.isArray(plan.sizes) && plan.sizes.length >= 1, `${g.id} sizes`);
  }
});

test('the extended catalogue adds real, correctly-categorised garments', () => {
  const added = ['tam', 'sunhat', 'hoodie', 'vest', 'turtleneck', 'crop', 'snood', 'bandana', 'fingerless', 'legwarmers', 'slipper', 'rug', 'teacosy'];
  const cats = new Set(CATEGORIES);
  assert.ok(GARMENTS.length >= 34, `catalogue should have grown (found ${GARMENTS.length})`);
  for (const id of added) {
    const g = byId(id);
    assert.ok(g, `garment ${id} exists`);
    assert.ok(cats.has(g.category), `${id} in a known category (${g.category})`);
    assert.ok(STRUCTURES.includes(g.structure), `${id} uses a real structure`);
    assert.ok(g.name && g.blurb && Array.isArray(g.params) && g.params.length >= 2, `${id} is fully described`);
  }
  // no duplicate ids in the whole catalogue
  const ids = GARMENTS.map(g => g.id);
  assert.equal(new Set(ids).size, ids.length, 'garment ids are unique');
});

test('the tank top survives as a catalog garment with the CAD pattern attached', () => {
  const eng = new ClothesEngine();
  const plan = eng.compute(byId('tank'), {}, { stitchesPer10Cm: 28, rowsPer10Cm: 40 });
  assert.ok(plan.parts[0].castOn > 0 && plan.parts[0].rows > 0);
  assert.ok(plan.tank && plan.tank.frontProfileMm.length > 3, 'gold-standard pattern retained');
  assert.ok(plan.geometry.outlineMm.some(p => p.x < 0) && plan.geometry.outlineMm.some(p => p.x > 0), 'mirrored outline');
});

// Regression (§1.5): plan.gauge.rowsPer10Cm once stored the per-CENTIMETRE rate
// (rowsPer10 / 10), a 10× slip that inflated every non-tank outline, wrecked the
// yarn estimate and printed a nonsense "4 rows per 10 cm" on the 1:1 SVG. The two
// gauge fields must be on the same per-10-cm basis and feed geometry consistently.
test('plan.gauge reports stitches AND rows per 10 cm on the same basis', () => {
  const eng = new ClothesEngine();
  const gauge = { stitchesPer10Cm: 24, rowsPer10Cm: 32 };
  const plan = eng.compute(byId('sweater'), {}, gauge);
  assert.equal(plan.gauge.stitchesPer10Cm, 24);
  assert.equal(plan.gauge.rowsPer10Cm, 32, 'rows per 10 cm, not per cm');
  // A 32-row/10cm gauge is ~3.1 mm per row — a real knit row, not a 25 mm absurdity.
  const rowPitchMm = 100 / plan.gauge.rowsPer10Cm;
  assert.ok(rowPitchMm > 1 && rowPitchMm < 12, `row pitch ${rowPitchMm.toFixed(2)}mm is sane`);
  assert.ok(Number.isFinite(plan.yarn.meters) && plan.yarn.meters > 0, 'yarn estimate stays finite');
});
