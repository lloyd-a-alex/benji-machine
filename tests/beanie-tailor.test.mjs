// Regression + behaviour tests for the newer tailor / card features.
// Run with:  node --test "tests/*.test.mjs"
// These exercise only browser-free code (pure math + static export methods).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BeanieEngine } from '../js/tailor/beanie-engine.js';
import { PATTERN_PRESETS } from '../js/presets/preset-library.js';
import { MACHINE_PROFILES } from '../js/machine/profiles.js';
import { CadDxfExporter } from '../js/exporters/cad-dxf.js';

const byId = id => PATTERN_PRESETS.find(p => p.id === id);

// ─── Beanie engine ───────────────────────────────────────────────────────────

test('beanie cast-on is snapped to a clean multiple of the crown segments', () => {
  const b = new BeanieEngine();
  const model = b.compute({ headCircumferenceCm: 58, crownSegments: 8, ribbingType: '1x1' },
    { stitchesPer10Cm: 24, rowsPer10Cm: 32 });
  assert.equal(model.bodySts % model.segments, 0, 'body sts must divide evenly by segments');
  assert.ok(model.bodySts > 0);
});

test('beanie 2x2 rib keeps cast-on a multiple of segments * 2', () => {
  const b = new BeanieEngine();
  const model = b.compute({ crownSegments: 6, ribbingType: '2x2' }, { stitchesPer10Cm: 28, rowsPer10Cm: 40 });
  assert.equal(model.bodySts % (model.segments * 2), 0);
});

test('beanie row counts add up and it emits a full instruction list', () => {
  const b = new BeanieEngine();
  const model = b.compute({ beanieHeightCm: 22, ribbingHeightCm: 6 }, { stitchesPer10Cm: 20, rowsPer10Cm: 28 });
  assert.equal(model.totalRows, model.ribbingRows + model.bodyRows);
  const last = model.instructions[model.instructions.length - 1];
  assert.match(last.title, /Finish/i);
});

test('beanie engine is defensive against garbage input', () => {
  const b = new BeanieEngine();
  const model = b.compute({ headCircumferenceCm: NaN, crownSegments: 0 }, { stitchesPer10Cm: 'x' });
  assert.ok(Number.isFinite(model.bodySts) && model.bodySts > 0);
  assert.ok(model.segments >= 4 && model.segments <= 12);
});

// ─── Reversible double-bed presets (must fit 24 sts and tile seamlessly) ──────

test('reversible chevron preset exists, stays inside 24 cols and tiles with period 12', () => {
  const p = byId('reversible_double_bed_chevron');
  assert.ok(p, 'preset present');
  const m = p.generate(24, 24);
  assert.equal(m.length, 24);
  assert.equal(m[0].length, 24);
  // Seamless horizontal tiling: column c and c+12 must match everywhere.
  for (let r = 0; r < 24; r++) {
    for (let c = 0; c + 12 < 24; c++) {
      assert.equal(m[r][c], m[r][c + 12], `tiling break at r${r} c${c}`);
    }
  }
});

test('reversible diamond preset tiles with period 8', () => {
  const p = byId('reversible_double_bed_diamond');
  assert.ok(p, 'preset present');
  const m = p.generate(24, 24);
  for (let r = 0; r < 24; r++) {
    for (let c = 0; c + 8 < 24; c++) {
      assert.equal(m[r][c], m[r][c + 8], `tiling break at r${r} c${c}`);
    }
  }
});

test('reversible presets use only punched / unpunched values', () => {
  for (const id of ['reversible_double_bed_chevron', 'reversible_double_bed_diamond']) {
    const m = byId(id).generate(24, 24);
    for (const row of m) for (const v of row) assert.ok(v === 0 || v === 1, `${id} produced ${v}`);
  }
});

// ─── Brother vs Silver Reed row positioning actually matters in the export ─────

test('brother and silver reed reading offsets differ', () => {
  const bro = MACHINE_PROFILES.brother_standard_24.carriageRules.cardReadingOffsetRows;
  const sr = MACHINE_PROFILES.silver_reed_standard_24.carriageRules.cardReadingOffsetRows;
  assert.ok(bro > sr, 'brother should read further below the needles');
});

test('same pattern exports to a physically different card for brother vs silver reed', () => {
  const pat = [[true, false, true], [false, true, false]];
  const bro = CadDxfExporter.generateDxf(MACHINE_PROFILES.brother_standard_24, pat);
  const sr = CadDxfExporter.generateDxf(MACHINE_PROFILES.silver_reed_standard_24, pat);
  assert.notEqual(bro, sr, 'leader rows must shift the pattern so cards differ by machine');
});
