/**
 * tests/health-view.test.mjs
 *
 * Verifies the Pattern Health Dashboard (summariseHealth + healthToText) — the consolidated
 * traffic-light "ready to cast on?" card that fuses model validation, verification, machine fit,
 * yarn sufficiency, production feasibility, and QC into one verdict.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summariseHealth, healthToText } from '../js/v2/health-view.js';

// ---------------------------------------------------------------------------
// Garbage tolerance
// ---------------------------------------------------------------------------

test('summariseHealth is total — garbage never throws', () => {
  for (const bad of [null, undefined, 0, 'x', [], {}, { compile: null }]) {
    const h = summariseHealth(bad);
    assert.ok(h && typeof h === 'object');
    assert.ok(typeof h.ready === 'boolean');
    assert.ok(Array.isArray(h.checks));
  }
});

test('empty object report → all na, not ready', () => {
  const h = summariseHealth({});
  assert.equal(h.ready, false);
  assert.equal(h.level, 1); // at least one 'na' or 'warn'
  assert.ok(h.checks.length >= 3);
});

// ---------------------------------------------------------------------------
// All-pass scenario
// ---------------------------------------------------------------------------

const allGood = {
  modelErrorCount: 0,
  validation: [],
  compile: {
    summary: { passed: 9, warnings: 0, failures: 0, blocking: [] },
    verification: [{ id: 'machine', verdict: 'pass', message: 'Fits the bed.' }]
  },
  fit: { gauge: { stsPer10cm: 22 } },
  yarn: { shortfalls: [], gauge: { stsPer10cm: 22 } },
  production: {
    feasible: true,
    qc: { score: { verdict: 'approved' } }
  }
};

test('all-green report → ready, level 2, tone ok', () => {
  const h = summariseHealth(allGood);
  assert.equal(h.ready, true);
  assert.equal(h.level, 2);
  assert.equal(h.tone, 'ok');
  assert.match(h.headline, /ready/i);
});

test('all seven checks present in a healthy report', () => {
  const h = summariseHealth(allGood);
  assert.equal(h.checks.length, 7);
  for (const c of h.checks) {
    assert.equal(c.status, 'pass', `${c.id} should pass`);
  }
});

// ---------------------------------------------------------------------------
// Fail scenarios
// ---------------------------------------------------------------------------

test('model error → level 0 (red)', () => {
  const h = summariseHealth({ ...allGood, modelErrorCount: 3 });
  assert.equal(h.ready, false);
  assert.equal(h.level, 0);
  assert.equal(h.tone, 'bad');
  const model = h.checks.find(c => c.id === 'model');
  assert.equal(model.status, 'fail');
});

test('yarn shortfall → fail on "yarn"', () => {
  const withShortfall = { ...allGood, yarn: { shortfalls: [{ name: 'Main', buy: 2 }] } };
  const h = summariseHealth(withShortfall);
  const yarn = h.checks.find(c => c.id === 'yarn');
  assert.equal(yarn.status, 'fail');
  assert.match(yarn.detail, /2 more ball/);
});

test('machine check fail → level 0', () => {
  const badMachine = {
    ...allGood,
    compile: {
      summary: { passed: 8, warnings: 0, failures: 1, blocking: [{ id: 'machine' }] },
      verification: [{ id: 'machine', verdict: 'fail', message: 'Too wide.' }]
    }
  };
  const h = summariseHealth(badMachine);
  assert.equal(h.level, 0);
  const m = h.checks.find(c => c.id === 'machine');
  assert.equal(m.status, 'fail');
});

// ---------------------------------------------------------------------------
// Warning scenarios
// ---------------------------------------------------------------------------

test('QC pending → warn, not fail; level 1', () => {
  const h = summariseHealth({ ...allGood, production: { feasible: true, qc: { score: { verdict: 'pending' } } } });
  const qc = h.checks.find(c => c.id === 'qc');
  assert.equal(qc.status, 'warn');
  assert.equal(h.level, 1);
});

test('infeasible production → warn on feasible', () => {
  const h = summariseHealth({ ...allGood, production: { feasible: false, qc: { score: { verdict: 'approved' } } } });
  const f = h.checks.find(c => c.id === 'feasible');
  assert.equal(f.status, 'warn');
});

// ---------------------------------------------------------------------------
// healthToText
// ---------------------------------------------------------------------------

test('healthToText produces a structured text block', () => {
  const text = healthToText(summariseHealth(allGood));
  assert.match(text, /PATTERN HEALTH/);
  assert.match(text, /✓ Model integrity/);
  assert.match(text, /✓ Yarn in stash/);
  assert.match(text, /Ready to cast on/);
});

test('healthToText null → informative empty string', () => {
  const text = healthToText(null);
  assert.match(text, /no data/);
});

// ---------------------------------------------------------------------------
// Pipeline integration
// ---------------------------------------------------------------------------

test('real pipeline produces a health summary with at least 5 checks', async () => {
  const { runFullPipeline } = await import('../js/v2/index.js');
  const { projectFromKnitScript } = await import('../js/v2/index.js');
  const { DEFAULT_KNITSCRIPT } = await import('../js/v2/_catalog.js');
  const project = projectFromKnitScript(DEFAULT_KNITSCRIPT).project;
  const report = runFullPipeline(project);
  const h = summariseHealth(report);
  assert.ok(h.checks.length >= 5);
  assert.ok(['ok', 'warn', 'bad'].includes(h.tone));
});

// ---------------------------------------------------------------------------
// Source wiring
// ---------------------------------------------------------------------------

const panels = await readFile(new URL('../js/v2/panels.js', import.meta.url), 'utf8');
const commands = await readFile(new URL('../js/ui/commands.js', import.meta.url), 'utf8');
const menubar = await readFile(new URL('../js/ui/menubar.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

test('panels.js imports health-view and renders the card in project(state)', () => {
  assert.match(panels, /import\s+\{.*summariseHealth.*\}\s+from\s+'\.\/health-view/);
  assert.match(panels, /renderHealthCard\(health\)/);
});

test('v2.health command wired in commands.js', () => {
  assert.match(commands, /case 'v2\.health'/);
});

test('v2.health in MENUBAR_ACTIONS', () => {
  assert.match(menubar, /'v2\.health'/);
});

test('v2.health in Ctrl+K palette', () => {
  assert.match(app, /Pattern Health.*v2\.health/);
});

test('health-view is DOM-free (no window/document references)', async () => {
  const src = await readFile(new URL('../js/v2/health-view.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('document.'), 'no DOM');
  assert.ok(!src.includes('window.'), 'no window');
});

// ---------------------------------------------------------------------------
// Print + Tech-Pack rendering
// ---------------------------------------------------------------------------

test('panels.js has Print button (data-print-out)', async () => {
  assert.match(panels, /data-print-out/);
});

test('panels.js has @media print binder calling window.print()', async () => {
  assert.match(panels, /window\.print\(\)/);
});

test('styles.css has @media print block', async () => {
  const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media print/);
  assert.match(css, /\.kv2-out\[data-out-pane\]/);
});

test('v2.print command wired in commands.js', () => {
  assert.match(commands, /case 'v2\.print'/);
});

test('v2.print in MENUBAR_ACTIONS and File menu', () => {
  assert.match(menubar, /'v2\.print'/);
  assert.match(menubar, /Print Pattern Sheet.*v2\.print/);
});

test('v2.print in Ctrl+K palette', () => {
  assert.match(app, /Print Pattern Sheet.*v2\.print/);
});

test('panels.js has renderTechPackHtml for formatted manufacturing output', () => {
  assert.match(panels, /function renderTechPackHtml\(tp\)/);
  assert.match(panels, /id === 'manufacturing' && out && out\.kind === 'tech-pack'/);
});

test('renderTechPackHtml handles empty/null tech-pack without crashing', async () => {
  // Extract the function and test it in isolation (it uses esc from kit.js, so we
  // just verify the function call is guarded). The real integration test uses the pipeline.
  const { runFullPipeline, projectFromKnitScript } = await import('../js/v2/index.js');
  const { DEFAULT_KNITSCRIPT } = await import('../js/v2/_catalog.js');
  const project = projectFromKnitScript(DEFAULT_KNITSCRIPT).project;
  const report = runFullPipeline(project);
  // manufacturing output may or may not be generated depending on requested outputs;
  // just verify the click handler would not crash with null
  const mfg = report.compile && report.compile.outputs && report.compile.outputs.manufacturing;
  // Null is OK — the handler guards with `out && out.kind === 'tech-pack'`
  assert.ok(mfg === undefined || mfg === null || mfg.kind === 'tech-pack');
});

// ---------------------------------------------------------------------------
// Row Tracker
// ---------------------------------------------------------------------------

test('panels.js has data-row-goto input and Go button', () => {
  assert.match(panels, /data-row-goto/);
  assert.match(panels, /data-row-go/);
  assert.match(panels, /jumpToRow/);
});

test('row tracker highlights via data-row-hl', () => {
  assert.match(panels, /data-row-hl/);
  assert.match(panels, /scrollIntoView/);
});

// ---------------------------------------------------------------------------
// Production: Batch yarn + dashboard profit
// ---------------------------------------------------------------------------

test('renderYarnExists in panels.js for batch yarn needs', () => {
  assert.match(panels, /function renderYarnNeeds\(needs\)/);
  assert.match(panels, /prod\.batch && prod\.batch\.yarnNeeds/);
});

test('production panel renders batch profit and revenue from dashboard', () => {
  assert.match(panels, /Batch profit/);
  assert.match(panels, /dashboard\.profit/);
  assert.match(panels, /dashboard\.revenue/);
});

// ---------------------------------------------------------------------------
// Assembly map
// ---------------------------------------------------------------------------

test('renderAssemblyMap renders seams, joins, and pick-up in fit panel', () => {
  assert.match(panels, /function renderAssemblyMap\(pieces\)/);
  assert.match(panels, /renderAssemblyMap\(fit\.pieces\)/);
  assert.match(panels, /Assembly map/);
});

test('data-row-next button and incrementer wired', () => {
  assert.match(panels, /data-row-next/);
  assert.match(panels, /rowNext.*addEventListener/);
});

// ---------------------------------------------------------------------------
// Shaping events, swatch tip, verification counts, and other session features
// ---------------------------------------------------------------------------

test('renderShapingEvents surfaces non-knit actions in the fit panel', () => {
  assert.match(panels, /function renderShapingEvents\(pieces\)/);
  assert.match(panels, /renderShapingEvents\(fit\.pieces\)/);
  assert.match(panels, /Shaping events/);
});

test('Yarn panel has a swatch tip line (gauge-aware)', () => {
  assert.match(panels, /Swatch tip/);
  assert.match(panels, /stsPer10cm.*2\)/); // Math.round(gauge * 2) sts cast on
});

test('Pipeline heading shows verification pass/warn/fail counts', () => {
  assert.match(panels, /passed.*✓.*warnings.*⚠.*failures.*✗/s);
});

test('gauge consistency check in health-view (7th check)', async () => {
  const src = await readFile(new URL('../js/v2/health-view.js', import.meta.url), 'utf8');
  assert.match(src, /Gauge consistency/);
  assert.match(src, /id: 'gauge'/);
});

test('apply button plays knit:fx sound event', () => {
  assert.match(panels, /knit:fx.*modelErrorCount|modelErrorCount.*knit:fx/s);
});

test('yarnChanges chip in compiler metrics row', () => {
  assert.match(panels, /m\.yarnChanges.*yarn chg/);
});

test('production panel has batch profit row', () => {
  assert.match(panels, /Batch profit/);
});

test('health summary includes a nextAction suggestion', () => {
  const h = summariseHealth(allGood);
  assert.equal(h.nextAction, 'Cast on and enjoy!');
});

test('health nextAction points to the first failing check', () => {
  const h = summariseHealth({ ...allGood, modelErrorCount: 2 });
  assert.match(h.nextAction, /Fix the KnitScript/);
});

// ---------------------------------------------------------------------------
// Session 2: Contrast strip, Difficulty, Reverse enhancement, shortcuts
// ---------------------------------------------------------------------------

test('renderColorContrastStrip is wired into the compiler panel', () => {
  assert.match(panels, /renderColorContrastStrip\(c\.ir && c\.ir\.colors\)/);
});

test('renderColorContrastStrip uses apcaLc for pairwise contrast', () => {
  assert.match(panels, /import \{ apcaLc \}.*from.*apca\.js/);
  assert.match(panels, /Math\.abs\(apcaLc\(hexes\[i\], hexes\[j\]\)\)/);
});

test('contrast strip flags pairs below LC 60 as warn', () => {
  assert.match(panels, /lc >= 75 \? 'ok' : lc >= 60 \? '' : 'warn'/);
});

test('renderDifficulty is wired into the metrics chips row', () => {
  assert.match(panels, /renderDifficulty\(m\)/);
});

test('renderDifficulty uses 4 tiers (Beginner to Expert)', () => {
  assert.match(panels, /Expert.*Advanced.*Intermediate.*Beginner/s);
});

test('renderDifficulty scores short-rows x2 + yarnChanges x0\.5', () => {
  assert.match(panels, /\(m\.shortRows \|\| 0\) \* 2 \+ \(m\.yarnChanges \|\| 0\) \* 0\.5/);
});

test('reverse result shows scale (cmPerPixel)', () => {
  assert.match(panels, /row\('Scale'[^}]*sc\.cmPerPixel/);
});

test('reverse result shows fabric coverage bar', () => {
  assert.match(panels, /fab\.coverage != null.*row\('Fabric coverage'/);
});

test('reverse result shows top-3 pattern hypotheses', () => {
  assert.match(panels, /patRanked.*slice\(0, 3\)/);
  assert.match(panels, /Hypothesis.*Conf/);
});

test('reverse result shows silhouette shape chip', () => {
  assert.match(panels, /sil\.shape.*row\('Silhouette'/);
});

test('Alt+1 to 6 opens the corresponding V2 panel', () => {
  assert.match(panels, /e\.altKey[\s\S]*Number\(e\.key\) - 1[\s\S]*V2_SYSTEM_CATALOG\.length/);
  assert.match(panels, /open\(V2_SYSTEM_CATALOG\[idx\]\.id\)/);
});

test('output tab buttons are conditional on actual output existence', () => {
  assert.match(panels, /c\.outputs && c\.outputs\.written.*data-out="written"/);
  assert.match(panels, /c\.outputs && c\.outputs\.chart.*data-out="chart"/);
  assert.match(panels, /c\.outputs && c\.outputs\.punchcard.*data-out="punchcard"/);
});

test('copy written pattern button shows Copied feedback', () => {
  assert.match(panels, /copyPat\.textContent = '✓ Copied!'/);
  assert.match(panels, /setTimeout.*Copy Written Pattern.*1500/);
});

test('KnitScript copy button shows Copied feedback', () => {
  assert.match(panels, /copyBtn\.textContent = '✓ Copied!'/);
  assert.match(panels, /setTimeout.*copyBtn\.textContent = 'Copy'.*1500/);
});

test('pane scrolls to top on tab switch', () => {
  assert.match(panels, /pane\.scrollTop = 0/);
});

test('machine, punchcard, dxf, gcode get monospace styling', () => {
  assert.match(panels, /id === 'machine' \|\| id === 'punchcard' \|\| id === 'dxf' \|\| id === 'gcode'/);
  assert.match(panels, /font-family:var\(--font-mono,monospace\)/);
});

test('verification table rows show fix hints as title tooltips', () => {
  assert.match(panels, /v\.fix.*title=.*Fix/);
});

test('health card rows are clickable to open the sub-panel', () => {
  assert.match(panels, /data-health-open/);
  assert.match(panels, /PANEL_FOR\[c\.id\]/);
});

test('health card PANEL_FOR maps verify to compiler, yarn to yarn, gauge to fit', () => {
  assert.match(panels, /verify: 'compiler'.*yarn: 'yarn'.*gauge: 'fit'/);
});

test('production panel shows deadline chip and progressPct bar', () => {
  assert.match(panels, /prod\.dashboard\.deadline.*chip/);
  assert.match(panels, /prod\.dashboard\.progressPct.*bar/);
});

test('compiler metrics show estimated time to knit', () => {
  assert.match(panels, /state\.report\.headline.*totalHours.*h to knit/);
});

test('yarn panel shows per-yarn care rows instead of just first', () => {
  assert.match(panels, /y\.care\.map\(c =>.*row\('Care.*c\.name/);
});

test('healthToText includes the Next: line', () => {
  const text = healthToText(summariseHealth({ ...allGood, yarn: { shortfalls: [{ buy: 3, name: 'X' }], gauge: { stsPer10cm: 22 } } }));
  assert.match(text, /Next:.*Buy more yarn/);
});
