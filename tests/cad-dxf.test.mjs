// Regression guard for the CAD DXF exporter (§1.10).
//
// An AutoCAD DXF LINE stores its start point under group codes 10/20/30 (X/Y/Z)
// and its END point under 11/21/31. The exporter used to emit `11` then a second
// `20` and `30`, which overwrote the start Y/Z and left every card outline,
// centreline and alignment notch malformed in downstream CAM. The tank-top engine
// beside it had this right — only this path drifted. This test pins the codes so
// the mistake cannot silently return.
//
//   node --test "tests/cad-dxf.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CadDxfExporter } from '../js/exporters/cad-dxf.js';
import { MACHINE_PROFILES } from '../js/machine/profiles.js';

const profile = MACHINE_PROFILES.brother_standard_24;
const card = Array.from({ length: 8 }, () => new Array(12).fill(true));
const dxf = CadDxfExporter.generateDxf(profile, card, {
  includeSprockets: true, includeText: true, includeAlignMarks: true,
});

test('the DXF is R12, metric and non-empty', () => {
  assert.match(dxf, /AC1009/);
  assert.ok(dxf.includes('$INSUNITS'), 'unit header present');
  const lines = dxf.split('\n');
  const insUnits = lines.indexOf('$INSUNITS');
  assert.ok(insUnits >= 0 && lines[insUnits + 2] === '4', 'units are millimetres ($INSUNITS = 4)');
  assert.match(dxf, /EOF$/);
  assert.ok((dxf.match(/^LINE$/gm) || []).length >= 4, 'the card outline emits at least 4 LINEs');
});

// Parse each LINE entity as (group-code, value) pairs and assert the point codes.
// Walking tokens avoids brittle multiline string matching.
function lineEntityCodes(text) {
  const L = text.split('\n');
  const entities = [];
  for (let i = 0; i < L.length - 1; i++) {
    if (L[i] === '0' && L[i + 1] === 'LINE') {
      const codes = [];
      i += 2;
      while (i + 1 < L.length) {
        if (L[i] === '0') break;              // next entity begins
        codes.push(L[i]);                     // group code
        i += 2;                               // skip its value
      }
      entities.push(codes);
    }
  }
  return entities;
}

test('every LINE end point uses group codes 11/21/31 (never a second 20/30)', () => {
  const entities = lineEntityCodes(dxf);
  assert.ok(entities.length >= 4, `parsed ${entities.length} LINE entities`);
  for (const codes of entities) {
    const count = c => codes.filter(x => x === c).length;
    // A malformed line repeats 20/30 (start + bogus end) and omits 21/31 entirely.
    assert.equal(count('20'), 1, 'group code 20 only for the start Y');
    assert.equal(count('30'), 1, 'group code 30 only for the start Z');
    assert.equal(count('21'), 1, 'group code 21 present for the end Y');
    assert.equal(count('31'), 1, 'group code 31 present for the end Z');
  }
});
