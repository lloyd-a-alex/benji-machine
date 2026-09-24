/**
 * Zero-dependency cache-busting step for the GitHub Pages deploy.
 *
 * Runs at build time (in CI) and again locally if you like. It guarantees that
 * every deploy hands the browser brand-new URLs, so stale cached JS/CSS can no
 * longer silently hide a fix.
 *
 *   1. Replaces the `__BUILD__` token in HTML files with the build version.
 *   2. Appends `?v=<version>` to every relative ES module import specifier so
 *      the whole module graph is re-fetched on each deploy.
 *
 * Usage:  BUILD=<sha-or-timestamp> node scripts/bust-cache.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const VERSION = process.env.BUILD || new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);

let errors = 0;
function fail(msg, err) {
  errors++;
  console.error(`[bust-cache] ${msg}`, err && err.message ? err.message : err);
}

function walk(dir, filter, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch (err) {
      fail(`cannot stat ${full} (broken symlink or race) — skipping`, err);
      continue;
    }
    if (st.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

// 1. HTML: swap the __BUILD__ token for the concrete version.
const htmlFiles = walk(ROOT, f => f.endsWith('.html'));
for (const file of htmlFiles) {
  try {
    const src = readFileSync(file, 'utf8');
    const next = src.replace(/__BUILD__/g, VERSION);
    if (next !== src) {
      writeFileSync(file, next);
      console.log(`[bust-cache] versioned HTML ${file} -> v${VERSION}`);
    }
  } catch (err) {
    fail(`could not version HTML ${file}`, err);
  }
}

// 2. JS: append ?v=<version> to relative "./" or "../" module specifiers.
//    Matches both `from '...'` and `import '...'` static specifiers ending in .js.
const jsFiles = walk(ROOT, f => f.endsWith('.js'));
const SPEC_RE = /(\bfrom\s+|\bimport\s+)(['"])(\.\.?\/[^'"]*?\.js)(['"])/g;
let touched = 0;
for (const file of jsFiles) {
  try {
    const src = readFileSync(file, 'utf8');
    const next = src.replace(SPEC_RE, (_m, kw, q1, spec, q2) => {
      const clean = spec.replace(/\?v=[^'"]*$/, ''); // idempotent
      return `${kw}${q1}${clean}?v=${VERSION}${q2}`;
    });
    if (next !== src) {
      writeFileSync(file, next);
      touched++;
    }
  } catch (err) {
    fail(`could not version JS imports in ${file}`, err);
  }
}
console.log(`[bust-cache] versioned ${touched} JS file(s) with imports at v${VERSION}`);
if (errors) {
  console.error(`[bust-cache] finished with ${errors} error(s) — some files were NOT versioned`);
  process.exit(1);
}
