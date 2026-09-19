// Machine-checked SEO contract for the published site.
//
// Metadata rots silently: a description drifts past the snippet limit, an OG
// image goes missing, an FAQPage answer stops matching the text on the page
// (which is the exact case Google's FAQ guidelines call out). Every assertion
// here is about something a crawler actually reads, so `npm test` is the proof
// that the optimisation is real rather than decorative.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');

const BASE = 'https://lloyd-a-alex.github.io/benji-machine';
const HOME = `${BASE}/`;
const GUIDE = `${BASE}/knitting-machine-lace-guide.html`;

const ENTITIES = {
  '&amp;': '&', '&quot;': '"', '&#39': "'", '&apos': "'", '&nbsp;': ' ',
  '&rarr;': '→', '&larr;': '←', '&minus;': '−', '&mdash;': '—',
  '&ndash;': '–', '&middot;': '·', '&hellip;': '…'
};
function decodeEntities(s) {
  return String(s).replace(/&(?:[a-zA-Z]+|#\d+);?/g, m => (m in ENTITIES ? ENTITIES[m] : m));
}
/** Visible text of an HTML fragment: no tags, no entities, single-spaced. */
function visibleText(html) {
  // Inline tags (<code>, <em>) must not inject spaces, or the FAQ comparison
  // against the structured data would fail on formatting alone.
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}
function linkHref(html, rel) {
  const m = html.match(new RegExp(`<link\\s+[^>]*rel=["']${rel}["'][^>]*href=["']([^"']*)["']`, 'i'))
    || html.match(new RegExp(`<link\\s+[^>]*href=["']([^"']*)["'][^>]*rel=["']${rel}["']`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}
function metaContent(html, name) {
  const re = new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const m = html.match(re) || html.match(
    new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}
function ldGraphs(html) {
  const out = [];
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) out.push(JSON.parse(m[1]));
  return out;
}
/** Flatten a @graph (or a single object) into a list of nodes. */
function nodes(graphs) {
  return graphs.flatMap(g => (g['@graph'] ? g['@graph'] : [g]));
}
function byType(all, type) {
  return all.filter(n => n['@type'] === type);
}

const home = read('index.html');
const guide = read('knitting-machine-lace-guide.html');
const sitemap = read('sitemap.xml');
const robots = read('robots.txt');
const allNodes = nodes([...ldGraphs(home), ...ldGraphs(guide)]);

// ── titles & descriptions: the two strings that decide a SERP click ──────────

test('both pages have exactly one title that fits a results page', () => {
  for (const [label, html, headTerm] of [['app', home, 'knitting machine'], ['guide', guide, 'lace']]) {
    const titles = html.match(/<title>/gi) || [];
    assert.equal(titles.length, 1, `${label}: one <title>`);
    const title = metaContent(html, 'title') || (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
    const clean = decodeEntities(title).trim();
    assert.ok(clean.length <= 60, `${label}: title is ${clean.length} chars, keep it ≤60 — "${clean}"`);
    assert.match(clean, /KNITCAT/, `${label}: brand in the title`);
    assert.ok(clean.toLowerCase().includes(headTerm), `${label}: head term "${headTerm}" in the title`);
  }
});

test('meta descriptions sit in the 110-160 character snippet window', () => {
  for (const [label, html] of [['app', home], ['guide', guide]]) {
    const d = metaContent(html, 'description');
    assert.ok(d, `${label}: has a description`);
    assert.ok(d.length >= 110 && d.length <= 160,
      `${label}: description is ${d.length} chars — "${d}"`);
  }
});

test('the app description names the mechanics, not just the brand', () => {
  const d = metaContent(home, 'description').toLowerCase();
  for (const term of ['knitting-machine', 'punchcard', 'eyelet', 'transfer', 'kh-830']) {
    assert.ok(d.includes(term), `description mentions "${term}"`);
  }
});

// ── canonical / sitemap / robots must agree with each other ─────────────────

test('canonicals are absolute, https and match the sitemap', () => {
  assert.equal(linkHref(home, 'canonical'), HOME);
  assert.equal(linkHref(guide, 'canonical'), GUIDE);
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual([...locs].sort(), [HOME, GUIDE].sort(), 'sitemap lists exactly the two indexable pages');
  for (const loc of locs) {
    assert.ok(loc.startsWith('https://'), `${loc} is https`);
    assert.ok(loc.startsWith(BASE), `${loc} is under the published base`);
  }
});

test('every sitemap URL resolves to a real file in the repo', () => {
  for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const rel = m[1].slice(BASE.length).replace(/^\//, '') || 'index.html';
    assert.ok(existsSync(path.join(ROOT, rel)), `${rel} exists`);
  }
});

test('robots.txt allows crawling and advertises the sitemap', () => {
  assert.match(robots, /User-agent:\s*\*/i);
  assert.match(robots, /Allow:\s*\//i);
  assert.ok(robots.includes(`${BASE}/sitemap.xml`), 'absolute Sitemap: line');
  assert.ok(!/Disallow/i.test(robots), 'nothing is blocked');
  assert.match(sitemap, /^<\?xml/, 'sitemap is real XML');
});

// ── structured data: valid JSON, and the right shapes ────────────────────────

test('every JSON-LD block parses and declares the schema context', () => {
  const graphs = [...ldGraphs(home), ...ldGraphs(guide)];
  assert.ok(graphs.length >= 2, 'at least one graph per page');
  for (const g of graphs) assert.equal(g['@context'], 'https://schema.org');
});

test('the app page describes a free WebApplication with real capability lists', () => {
  const app = byType(allNodes, 'WebApplication')[0];
  assert.ok(app, 'WebApplication node exists');
  assert.equal(app.name, 'KNITCAT');
  assert.equal(app.url, HOME);
  assert.equal(app.isAccessibleForFree, true);
  assert.equal(String(app.offers.price), '0');
  assert.ok(app.featureList.length >= 8, 'a substantial featureList');
  assert.ok(app.keywords.includes('lace decompiler'), 'keywords carry the money phrase');
  assert.ok(app.codeRepository.includes('github.com'), 'points at the source');
  // Feature list must be true: each of these exists somewhere in the shipped code.
  const js = read('js/app.js');
  for (const [phrase, needle] of [['G-Code', 'exportGCode'], ['DXF', 'exportDXF'],
    ['tailoring', 'BeanieEngine'], ['feasibility advisor', 'createFeasibilityAdvisor']]) {
    assert.ok(js.includes(needle), `${phrase} is claimed and implemented (${needle})`);
  }
  assert.ok(!/review|aggregateRating/i.test(JSON.stringify(app)),
    'no invented reviews or ratings');
});

test('the guide page carries Article, BreadcrumbList and FAQPage', () => {
  const guideNodes = nodes(ldGraphs(guide));
  assert.ok(byType(guideNodes, 'Article').length, 'Article');
  const crumbs = byType(guideNodes, 'BreadcrumbList')[0];
  assert.equal(crumbs.itemListElement.length, 2, 'home → guide');
  assert.ok(byType(guideNodes, 'FAQPage').length, 'FAQPage');
});

test('FAQ structured data matches the visible questions and answers word for word', () => {
  const faq = byType(nodes(ldGraphs(guide)), 'FAQPage')[0].mainEntity;
  assert.ok(faq.length >= 5, 'a real FAQ, not a token one');
  const pairs = [...guide.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)]
    .map(m => [visibleText(m[1]), visibleText(m[2])]);
  assert.equal(pairs.length, faq.length, 'as many visible Q&As as declared');
  for (const q of faq) {
    const hit = pairs.find(([ask]) => ask === q.name);
    assert.ok(hit, `visible question missing: "${q.name}"`);
    assert.equal(hit[1], visibleText(q.acceptedAnswer.text),
      `answer text differs from the page for "${q.name}"`);
  }
});

// ── the social card actually exists and is consistent ────────────────────────

test('og:image, twitter:image and the schema image all point at one real PNG', () => {
  const og = metaContent(home, 'og:image');
  assert.equal(og, `${BASE}/og-cover.png`);
  assert.equal(metaContent(home, 'twitter:image'), og);
  assert.equal(byType(allNodes, 'WebApplication')[0].image, og);
  assert.equal(metaContent(guide, 'og:image'), og, 'the guide shares the same cover');
  assert.ok(metaContent(home, 'og:image:alt'), 'the card has alt text');

  const png = path.join(ROOT, 'og-cover.png');
  assert.ok(existsSync(png), 'og-cover.png is committed, not a 404');
  const buf = readFileSync(png);
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', 'it really is a PNG');
  // IHDR: width at byte 16, height at byte 20, big-endian.
  assert.equal(buf.readUInt32BE(16), 1200, '1200px wide');
  assert.equal(buf.readUInt32BE(20), 630, '630px tall (1.91:1)');
  assert.ok(buf.length < 1_000_000, `under a megabyte (${buf.length} bytes)`);
});

test('twitter card is the large-image variant', () => {
  assert.equal(metaContent(home, 'twitter:card'), 'summary_large_image');
  assert.ok(metaContent(home, 'twitter:title'), 'twitter title');
  assert.ok(metaContent(home, 'twitter:description'), 'twitter description');
});

// ── semantics a renderer-based crawler depends on ───────────────────────────

test('exactly one visible h1, and it is the brand', () => {
  const withoutNoscript = home.replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');
  const h1s = withoutNoscript.match(/<h1[\s>]/gi) || [];
  assert.equal(h1s.length, 1, 'a single h1 outside <noscript>');
  assert.match(withoutNoscript, /<h1 class="brand-title">KNITCAT/);
  assert.match(withoutNoscript, /class="sr-only"[^>]*>\s*[\u2014-]?\s*knitting machine/i,
    'the h1 carries its keyword expansion for assistive tech');
});

test('the app page is honest about needing JavaScript, in words', () => {
  assert.match(home, /<noscript>[\s\S]*knitting machine/i, 'noscript prose describes the product');
  assert.match(home, /<a href="knitting-machine-lace-guide\.html"/, 'and links indexable content');
});

test('third-party fonts never block first paint', () => {
  const links = [...home.matchAll(/<link[^>]*fonts\.googleapis[^>]*>/gi)].map(m => m[0])
    .filter(l => /rel=["']stylesheet["']/.test(l));
  assert.ok(links.length, 'the font stylesheet is loaded');
  for (const l of links) {
    assert.match(l, /media=["']print["']/, 'print-swap media type');
    assert.match(l, /onload=["']this\.media='all'["']/, 'swapped back on load');
  }
});

test('language, viewport and robots directives are declared once each', () => {
  assert.match(home, /<html lang="en">/);
  assert.match(home, /name="viewport" content="width=device-width/);
  assert.match(home, /name="robots" content="index, follow/);
  assert.equal((home.match(/name="robots"/g) || []).length, 1, 'one robots meta');
  assert.equal((home.match(/rel="canonical"/g) || []).length, 1, 'one canonical');
});

// ── the rename is complete in everything a user or crawler sees ─────────────

test('the old brand name is gone from user-facing files', () => {
  const files = { 'index.html': home, 'knitting-machine-lace-guide.html': guide,
    'README.md': read('README.md'), 'package.json': read('package.json'),
    'css/styles.css': read('css/styles.css'), 'js/app.js': read('js/app.js') };
  for (const [name, text] of Object.entries(files)) {
    // Historic localStorage keys keep the old prefix on purpose (renaming them
    // would wipe a returning visitor's saved state); nothing else may.
    const stripped = text.replace(/knitcad[a-z0-9._]*/gi, '');
    assert.ok(!/knitcad/i.test(stripped), `${name} still says KnitCAD`);
    assert.match(text, /KNITCAT|knitcat/, `${name} uses the new brand`);
  }
  assert.equal(JSON.parse(read('package.json')).name, 'knitcat');
});

test('single-bed vs double-bed is stated in code, tooltips and docs alike', () => {
  const profiles = read('js/machine/profiles.js');
  const feasibility = read('js/features/feasibility.js');
  const decompiler = read('js/compiler/lace-decompiler.js');
  assert.match(profiles, /beds: 1/); assert.match(profiles, /beds: 2/);
  assert.match(feasibility, /needle beds?/i);
  assert.match(decompiler, /SINGLE-BED/i);
  assert.match(home, /single.bed/i, 'the mode tooltips say it out loud');
  assert.match(guide, /single-bed technique/, 'and the guide explains it');
});

test('eyelets and transfers are documented as complementary, not duplicated', () => {
  const decompiler = read('js/compiler/lace-decompiler.js');
  assert.match(home, /Eyelets vs transfers/i, 'there is a named explainer in the UI');
  assert.match(decompiler, /implicit/i, 'the compiler notes an eyelet is an implicit transfer');
  assert.match(decompiler, /complementary/, 'and says the two are complementary, not redundant');
  assert.match(guide, /yarnover/i);
});
