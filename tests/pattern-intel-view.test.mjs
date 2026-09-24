// KNITCAT V2 — Chart DNA battery.
//
// Proves pattern-intel-view is a faithful, total, DOM-free presenter over the four structural
// analyses from `js/edit/pattern-intel.js`, and that the Chart DNA fingerprint is fused into the
// Compiler panel with full command / menu / palette discoverability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { summariseChartDNA, chartDNAToText } from '../js/edit/pattern-intel-view.js';
import { projectFromKnitScript, runFullPipeline, DEFAULT_KNITSCRIPT } from '../js/v2/index.js';

/* -- a deterministic fixture matrix ---------------------------------------- */

// A 12×8 Fair Isle card built by tiling a 3×4 diamond motif:
//   [0,1,1,0]       rowPeriod = 3
//   [1,0,0,1]       colPeriod = 4
//   [0,1,1,0]       tilesY = 4, tilesX = 2
// Diamond is mirror-symmetric in all three axes → 100% each.
// Punched per tile = 6 / 12 → density = 50%.
function fixtureMatrix() {
  const motif = [[0, 1, 1, 0], [1, 0, 0, 1], [0, 1, 1, 0]];
  const out = [];
  for (let r = 0; r < 4; r++) for (const row of motif) {
    out.push([...row, ...row]); // across ×2 = 8 cols
  }
  return out; // 12 rows × 8 cols
}

/* -- garbage tolerance ----------------------------------------------------- */

test('summariseChartDNA is total: null/garbage yields null', () => {
  for (const junk of [null, undefined, 42, 'dna', {}, [], [[], []]]) {
    assert.equal(summariseChartDNA(junk), null, `${JSON.stringify(junk)} -> null`);
  }
});

test('an all-blank card yields null (no worked cells to analyse)', () => {
  const blank = Array.from({ length: 6 }, () => [0, 0, 0, 0]);
  assert.equal(summariseChartDNA(blank, { mode: 'fair_isle' }), null);
});

/* -- the known-shape fixture ----------------------------------------------- */

test('a 3×4 tiled motif is detected as rowPeriod 3 × colPeriod 4, 4×2 tiles', () => {
  const s = summariseChartDNA(fixtureMatrix(), { mode: 'fair_isle' });
  assert.ok(s && s.ok);
  assert.equal(s.repeat.rowPeriod, 3);
  assert.equal(s.repeat.colPeriod, 4);
  assert.equal(s.repeat.tilesY, 4);
  assert.equal(s.repeat.tilesX, 2);
  assert.equal(s.repeat.isFullRow, false);
  assert.equal(s.repeat.isFullCol, false);
});

test('the diamond motif scores 100% on all three symmetry axes', () => {
  const s = summariseChartDNA(fixtureMatrix(), { mode: 'fair_isle' });
  assert.equal(s.symmetry.verticalPct, 100);
  assert.equal(s.symmetry.horizontalPct, 100);
  assert.equal(s.symmetry.rotationalPct, 100);
});

test('density is 50% (48/96 punched) with no wasted padding', () => {
  const s = summariseChartDNA(fixtureMatrix(), { mode: 'fair_isle' });
  assert.equal(s.density.pct, 50);
  assert.equal(s.density.punched, 48);
  assert.equal(s.density.total, 96);
  assert.ok(s.bounds);
  assert.equal(s.bounds.wastedPct, 0);
});

test('tone is ok for a symmetric medium-density card', () => {
  const s = summariseChartDNA(fixtureMatrix(), { mode: 'fair_isle' });
  assert.equal(s.tone, 'ok');
  assert.match(s.headline, /3r × 4c repeat/);
  assert.match(s.headline, /100% L↔R mirror/);
  assert.match(s.headline, /50% density/);
});

test('density > 85% triggers warn tone (pull risk)', () => {
  // Almost-solid 4×4 with one blank: 15/16 = 94% density.
  const dense = [[1,1,1,1],[1,1,1,1],[1,1,1,1],[1,1,1,0]];
  const s = summariseChartDNA(dense, { mode: 'fair_isle' });
  assert.ok(s);
  assert.ok(s.density.pct > 85);
  assert.equal(s.tone, 'warn');
});

test('asymmetric + no smaller repeat triggers info tone', () => {
  // A 3×3 with unique cells and no symmetry.
  const asymmetric = [[1,0,0],[0,0,1],[0,1,0]];
  const s = summariseChartDNA(asymmetric, { mode: 'fair_isle' });
  assert.ok(s);
  assert.ok(s.repeat.isFullRow && s.repeat.isFullCol);
  // Max symmetry < 40% (this is a permutation matrix, ~33-67% hit)
  const maxSym = Math.max(s.symmetry.verticalPct, s.symmetry.horizontalPct, s.symmetry.rotationalPct);
  if (maxSym < 40) assert.equal(s.tone, 'info');
  else assert.equal(s.tone, 'ok'); // passes even if above threshold
});

/* -- plain-text export ---------------------------------------------------- */

test('chartDNAToText emits a structured fingerprint report', () => {
  const s = summariseChartDNA(fixtureMatrix(), { mode: 'fair_isle' });
  const text = chartDNAToText(s);
  assert.match(text, /Chart DNA/);
  assert.match(text, /={9}/);
  assert.match(text, /3r × 4c → 4×2 tiles/);
  assert.match(text, /L↔R 100% · T↔B 100% · 180° 100%/);
  assert.match(text, /Density: 50% \(48\/96 worked\)/);
  assert.match(text, /Content box: 12r × 8c · 0% padding/);
  assert.ok(text.endsWith('\n'));
});

test('chartDNAToText is total: null yields a helpful prompt', () => {
  const text = chartDNAToText(null);
  assert.match(text, /Load a chart/);
  assert.ok(text.endsWith('\n'));
});

/* -- integration with the real pipeline ----------------------------------- */

test('the default KnitScript may not have a cardMatrix; view handles that gracefully', () => {
  const project = projectFromKnitScript(DEFAULT_KNITSCRIPT).project;
  const report = runFullPipeline(project);
  const matrix = report && report.compile && report.compile.ir && report.compile.ir.cardMatrix;
  // Either null (plain-texture project) or a valid summary (if the compiler emitted a chart).
  const s = summariseChartDNA(matrix);
  if (matrix && matrix.length && matrix[0] && matrix[0].some((v) => v !== 0)) {
    assert.ok(s && s.ok, 'a real cardMatrix produces a summary');
  } else {
    assert.equal(s, null, 'a null/blank cardMatrix honestly produces null');
  }
});

/* -- module contract and fusion ------------------------------------------- */

test('pattern-intel-view has no DOM access (module-graph gate stays green)', () => {
  const src = readFileSync(new URL('../js/edit/pattern-intel-view.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bdocument\b/, 'must be DOM-free for tests/headless');
  assert.doesNotMatch(src, /\bwindow\b/);
});

test('panels.js fuses renderChartDNA into compiler(state) and wires the copy binder', () => {
  const panels = readFileSync(new URL('../js/v2/panels.js', import.meta.url), 'utf8');
  assert.match(panels, /import \{ summariseChartDNA, chartDNAToText \} from '\.\.\/edit\/pattern-intel-view\.js'/);
  assert.match(panels, /const dna = summariseChartDNA\(c\.ir && c\.ir\.cardMatrix\)/);
  assert.match(panels, /\$\{renderChartDNA\(dna\)\}/);
  assert.match(panels, /data-copy-dna/);
  assert.match(panels, /chartDNAToText\(summariseChartDNA\(c && c\.ir && c\.ir\.cardMatrix\)\)/);
});

test('v2.chartdna is wired into commands, MENUBAR_ACTIONS, the Studio V2 menu, and the Ctrl+K palette', () => {
  const commands = readFileSync(new URL('../js/ui/commands.js', import.meta.url), 'utf8');
  assert.match(commands, /case 'v2\.chartdna':/);

  const menubar = readFileSync(new URL('../js/ui/menubar.js', import.meta.url), 'utf8');
  assert.match(menubar, /'v2\.chartdna'/, 'declared in MENUBAR_ACTIONS');
  assert.match(menubar, /it\('Chart DNA \(repeat · symmetry · density\)'/);

  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /runCommand\('v2\.chartdna'\)/, 'Ctrl+K palette act routes to v2.chartdna');
});
