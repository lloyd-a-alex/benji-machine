/**
 * tests/written-render.test.mjs
 *
 * Verifies the Markdown-to-HTML renderer for the written-pattern output and the time-operation
 * breakdown added to the Production panel. Also checks source integration (panels imports the
 * module and the template uses innerHTML for 'written').
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderMarkdownLite } from '../js/ui/markdown-lite.js';

// ---------------------------------------------------------------------------
// renderMarkdownLite — behavioural
// ---------------------------------------------------------------------------

test('renderMarkdownLite handles null/garbage/empty gracefully', () => {
  assert.equal(renderMarkdownLite(null), '');
  assert.equal(renderMarkdownLite(undefined), '');
  assert.equal(renderMarkdownLite(''), '');
  assert.equal(renderMarkdownLite(123), '');
  assert.equal(renderMarkdownLite({}), '');
});

test('# heading → <h2>', () => {
  const html = renderMarkdownLite('# My Pattern');
  assert.match(html, /<h2[^>]*>My Pattern<\/h2>/);
});

test('## heading → <h3> with accent colour', () => {
  const html = renderMarkdownLite('## Materials');
  assert.match(html, /<h3[^>]*>Materials<\/h3>/);
  assert.match(html, /var\(--accent\)/);
});

test('### heading → <h4> uppercase', () => {
  const html = renderMarkdownLite('### Cast on');
  assert.match(html, /<h4[^>]*>Cast on<\/h4>/);
  assert.match(html, /text-transform:uppercase/);
});

test('- bullet list wraps in <ul> with items', () => {
  const md = '- Yarn: Wool\n- Gauge: 22 sts\n- Needles: 4mm';
  const html = renderMarkdownLite(md);
  assert.match(html, /<ul[^>]*>/);
  assert.match(html, /<li>Yarn: Wool<\/li>/);
  assert.match(html, /<li>Gauge: 22 sts<\/li>/);
  assert.match(html, /<\/ul>/);
});

test('1. numbered list wraps in <ol>', () => {
  const md = '1. Cast on 80 sts\n2. Work rib for 5 cm\n3. Begin chart';
  const html = renderMarkdownLite(md);
  assert.match(html, /<ol[^>]*>/);
  assert.match(html, /<li>Cast on 80 sts<\/li>/);
  assert.match(html, /<li>Begin chart<\/li>/);
  assert.match(html, /<\/ol>/);
});

test('**bold** → <strong>', () => {
  const html = renderMarkdownLite('Work **even** until 10 cm');
  assert.match(html, /<strong>even<\/strong>/);
});

test('*italic* → <em>', () => {
  const html = renderMarkdownLite('*Construction: top-down*');
  assert.match(html, /<em>Construction: top-down<\/em>/);
});

test('HTML entities are escaped (XSS safety)', () => {
  const html = renderMarkdownLite('# <script>alert("xss")</script>');
  assert.ok(!html.includes('<script>'), 'must not inject script tags');
  assert.match(html, /&lt;script&gt;/);
});

test('blank lines close open lists', () => {
  const md = '- item A\n\nSome text\n- item B';
  const html = renderMarkdownLite(md);
  // First list closes before the paragraph, second list starts fresh
  const ulClose = html.indexOf('</ul>');
  const p = html.indexOf('<p');
  assert.ok(ulClose < p, '</ul> before paragraph');
  assert.ok(html.lastIndexOf('<ul') > p, 'second list after paragraph');
});

test('multi-section written pattern renders all headings and items', () => {
  const md = [
    '# Test Shawl',
    '',
    '## Materials',
    '- Yarn: Merino DK',
    '- Gauge: 22 sts = 10 cm',
    '',
    '## Instructions',
    '### Body',
    '1. Cast on 3 sts',
    '2. Work 40 rows',
    '',
    'Weave in ends and block.'
  ].join('\n');
  const html = renderMarkdownLite(md);
  assert.match(html, /<h2[^>]*>Test Shawl<\/h2>/);
  assert.match(html, /<h3[^>]*>Materials<\/h3>/);
  assert.match(html, /<h4[^>]*>Body<\/h4>/);
  assert.match(html, /<li>Yarn: Merino DK<\/li>/);
  assert.match(html, /<li>Cast on 3 sts<\/li>/);
  assert.match(html, /<li>Work 40 rows<\/li>/);
  assert.match(html, /Weave in ends and block/);
});

// ---------------------------------------------------------------------------
// panels.js integration (source regex assertions)
// ---------------------------------------------------------------------------

const panels = await readFile(new URL('../js/v2/panels.js', import.meta.url), 'utf8');

test('panels.js imports renderMarkdownLite from markdown-lite', () => {
  assert.match(panels, /import\s+\{.*renderMarkdownLite.*\}\s+from\s+'[^']*markdown-lite/);
});

test('output pane is a <div> (not <pre>) and initial render calls renderMarkdownLite', () => {
  assert.match(panels, /data-out-pane[^>]*>\$\{written\s*\?\s*renderMarkdownLite/);
  assert.ok(!panels.includes('<pre class="kv2-out" data-out-pane'), 'no <pre> for out-pane');
});

test('output click handler uses innerHTML + renderMarkdownLite for written', () => {
  assert.match(panels, /id\s*===\s*'written'[\s\S]*?pane\.innerHTML\s*=\s*renderMarkdownLite/);
});

test('renderTimeOps function exists and is called in production(state)', () => {
  assert.match(panels, /function renderTimeOps\(time\)/);
  assert.match(panels, /\$\{renderTimeOps\(prod\.time\)\}/);
});

test('renderTimeOps produces table rows from operations array', () => {
  // Inline verification of the function logic (extracted): null/empty → ''
  const renderTimeOps = panels.match(/function renderTimeOps\(time\)\s*\{([\s\S]*?)^\}/m);
  assert.ok(renderTimeOps, 'function found');
  // Check it uses .toFixed(2) and <td>
  assert.match(renderTimeOps[1], /\.toFixed\(2\)/);
  assert.match(renderTimeOps[1], /<tr><td>/);
});

test('renderMachineChip function exists and is called in compiler(state)', () => {
  assert.match(panels, /function renderMachineChip\(mach\)/);
  assert.match(panels, /\$\{renderMachineChip\(c\.ir && c\.ir\.machine\)\}/);
});

test('renderMachineChip shows name + gauge + needles', () => {
  const fn = panels.match(/function renderMachineChip\(mach\)\s*\{([\s\S]*?)^\}/m);
  assert.ok(fn, 'function found');
  assert.match(fn[1], /\.name/);
  assert.match(fn[1], /gaugeMm|pitchX/);
  assert.match(fn[1], /bedStitches|bedLengthMm/);
  assert.match(fn[1], /maxColors/);
  assert.match(fn[1], /maxFloatNeedles/);
});

test('renderBodyEase function exists and is called in fit(state)', () => {
  assert.match(panels, /function renderBodyEase\(fit\)/);
  assert.match(panels, /\$\{renderBodyEase\(fit\)\}/);
});

test('renderBodyEase shows bust, waist, hip, ease chip', () => {
  const fn = panels.match(/function renderBodyEase\(fit\)\s*\{([\s\S]*?)^\}/m);
  assert.ok(fn, 'function found');
  assert.match(fn[1], /b\.bust|b\.waist|b\.hip/);
  assert.match(fn[1], /e\.chest|e\.waist|e\.hip|e\.arm/);
  assert.match(fn[1], /kv2-chip/);
});

test('renderEaseCheck uses .sections (not the old broken .points) and is called in fit(state)', () => {
  assert.match(panels, /function renderEaseCheck\(report\)/);
  assert.match(panels, /\$\{renderEaseCheck\(fit\.report\)\}/);
  // The function accesses report.sections
  const fn = panels.match(/function renderEaseCheck\(report\)\s*\{([\s\S]*?)^\}/m);
  assert.ok(fn, 'function found');
  assert.match(fn[1], /report\.sections/);
  assert.ok(!fn[1].includes('report.points'), 'must NOT reference the old non-existent .points');
});

test('planNarrative is imported and rendered at the top of production(state)', () => {
  assert.match(panels, /import\s+\{\s*planNarrative\s*\}\s+from/);
  assert.match(panels, /planNarrative\(prod\)/);
});

test('fit panel uses rep.grade (not the non-existent rep.verdict) for the fit chip', () => {
  // The old code read `rep.verdict || rep.summary` which never existed in computeFitReport.
  // Fixed to read `rep.grade`. Verify the broken access is gone.
  assert.ok(!panels.includes('rep.verdict') || panels.indexOf('rep.verdict') > panels.indexOf('rep.grade'),
    'rep.verdict should not be the primary fit field');
  assert.match(panels, /const fitGrade = rep\.grade/);
  assert.match(panels, /fitGrade.*row\('Fit grade'/)   ;
});

test('chart output renders inline SVG via innerHTML', () => {
  assert.match(panels, /id === 'chart' && out && out\.svg/);
  assert.match(panels, /pane\.innerHTML = out\.svg/);
});

test('outputBlob function maps all 7 output ids to extension+mime', () => {
  assert.match(panels, /function outputBlob\(id, out\)/);
  const fn = panels.match(/function outputBlob\(id, out\)\s*\{([\s\S]*?)^\}/m);
  assert.ok(fn, 'function found');
  for (const id of ['written', 'chart', 'machine', 'punchcard', 'dxf', 'gcode', 'manufacturing']) {
    assert.ok(fn[1].includes(`'${id}'`), `handles ${id}`);
  }
});

test('download button exists in outputs section and data-active-out is tracked', () => {
  assert.match(panels, /data-download-out/);
  assert.match(panels, /setAttribute\('data-active-out', id\)/);
});
