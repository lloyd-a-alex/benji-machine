/**
 * KNITCAT V2 — the verification action list.
 *
 * The compiler's verify suite (`compiler/verify/_result.js`) makes every check return a
 * {@link CheckResult} with a *specific, actionable* `fix` string — "Knit that needle at row 42 to
 * clear the stack", "Buy the shortfall or shrink the size", "Increase ease.chest toward 8 cm".
 * The docstring calls this out as the whole point of the module: "a verdict list, each with a
 * specific, actionable fix — not a red X". Yet the Compiler panel only rendered the `message`
 * column and silently dropped the `fix`. This view turns the hidden hints back into the
 * knitter's to-do list, sorted so blocking failures surface first, warnings second, and the
 * passing checks last (as reassurance, not noise). DOM-free and total: garbage yields `null`,
 * an empty array yields an "all clear" summary.
 *
 * @module compiler/verify-view
 */

/** Human labels for the compiler's canonical check ids. Unknown ids are Title-Cased as fallback. */
const CHECK_LABELS = Object.freeze({
  fit: 'Fit & wearability',
  gauge: 'Gauge & swatch',
  machine: 'Machine compatibility',
  float: 'Float length (Fair Isle)',
  tuck: 'Tuck stack depth',
  ease: 'Ease & silhouette',
  color: 'Colourwork contrast',
  time: 'Estimated build time',
  yarn: 'Yarn & stash coverage'
});

/**
 * Turn a live `compile.verification` array into a UI-shaped action list. Every `fix` string the
 * engine wrote is preserved verbatim — this view never re-derives any verdict or rewrites any
 * instruction. Total: `null`, non-array, or malformed entries yield `null`; an empty array yields
 * a "nothing to check" summary so callers can hide the section cleanly.
 *
 * @param {Array<{id?:string, verdict?:string, message?:string, fix?:string, label?:string}>|null} verification
 * @returns {{ok:true, headline:string, tone:'ok'|'warn'|'bad'|'info', counts:{passed:number, warnings:number, failures:number, errors:number},
 *   blocking:Array<{id:string, label:string, message:string, fix:string}>,
 *   warnings:Array<{id:string, label:string, message:string, fix:string}>,
 *   passed:Array<{id:string, label:string, message:string}>}|null}
 */
export function summariseVerification(verification) {
  if (!Array.isArray(verification)) return null;
  const blocking = [];
  const warnings = [];
  const passed = [];
  let errors = 0;
  for (const r of verification) {
    if (!r || typeof r !== 'object') continue;
    const entry = {
      id: String(r.id || r.label || r.check || 'check'),
      label: humanLabel(r.id || r.label || r.check),
      message: String(r.message || r.detail || ''),
      fix: String(r.fix || '')
    };
    const verdict = String(r.verdict || r.status || '').toLowerCase();
    if (verdict === 'pass' || verdict === 'ok') {
      passed.push({ id: entry.id, label: entry.label, message: entry.message });
    } else if (verdict === 'warn') {
      warnings.push(entry);
    } else if (verdict === 'fail') {
      blocking.push(entry);
    } else if (verdict === 'error') {
      errors++;
      blocking.push(entry);
    }
    // Anything else (empty verdict) is silently dropped — the check may be N/A for this pattern.
  }
  // Sort each bucket by id so the order is deterministic across runs.
  blocking.sort((a, b) => a.id.localeCompare(b.id));
  warnings.sort((a, b) => a.id.localeCompare(b.id));
  passed.sort((a, b) => a.id.localeCompare(b.id));

  const failures = blocking.filter((b) => b.id).length - errors;
  const counts = { passed: passed.length, warnings: warnings.length, failures, errors };
  const tone = errors || failures > 0 ? 'bad' : warnings.length ? 'warn' : passed.length ? 'ok' : 'info';
  const headline = buildHeadline(counts);
  return { ok: true, headline, tone, counts, blocking, warnings, passed };
}

/** Compose the panel's one-line summary from the counts. */
function buildHeadline(c) {
  const parts = [];
  if (c.errors) parts.push(`${c.errors} error${c.errors === 1 ? '' : 's'}`);
  if (c.failures) parts.push(`${c.failures} to fix`);
  if (c.warnings) parts.push(`${c.warnings} warning${c.warnings === 1 ? '' : 's'}`);
  if (c.passed) parts.push(`${c.passed} passed`);
  return parts.length ? parts.join(' · ') : 'nothing to check';
}

/** Turn 'gauge' / 'color' / 'fit' into 'Gauge' / 'Color' / 'Fit'; unknown ids pass through. */
function humanLabel(id) {
  const key = String(id || '');
  if (CHECK_LABELS[key]) return CHECK_LABELS[key];
  return key ? key.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Check';
}

/**
 * Render a {@link summariseVerification} summary as a plain-text action list, ready to paste into
 * notes or send to a colleague. Total: null → a helpful prompt; never throws. Blocking failures
 * come first with their `fix:` line under each, then warnings, then a compact passed list.
 *
 * @param {object|null} summary the result from {@link summariseVerification}.
 * @param {object} [opts] @param {string} [opts.title='Verification report'] the heading.
 * @returns {string} always ends in a newline.
 */
export function verificationToText(summary, opts = {}) {
  const title = (opts && opts.title) || 'Verification report';
  if (!summary || !summary.ok) return 'Run the compiler to get a check-by-check action list.\n';
  const lines = [];
  lines.push(title);
  lines.push('='.repeat(title.length));
  lines.push(summary.headline);
  lines.push('');
  if (summary.blocking.length) {
    lines.push('BLOCKING — fix before casting on');
    for (const b of summary.blocking) {
      lines.push(`  ✗ ${b.label} (${b.id})`);
      if (b.message) lines.push(`      ${b.message}`);
      if (b.fix) lines.push(`      fix: ${b.fix}`);
    }
    lines.push('');
  }
  if (summary.warnings.length) {
    lines.push('WARNINGS — read before you commit');
    for (const w of summary.warnings) {
      lines.push(`  ⚠ ${w.label} (${w.id})`);
      if (w.message) lines.push(`      ${w.message}`);
      if (w.fix) lines.push(`      fix: ${w.fix}`);
    }
    lines.push('');
  }
  if (summary.passed.length) {
    lines.push('PASSED');
    for (const p of summary.passed) lines.push(`  ✓ ${p.label}${p.message ? ` — ${p.message}` : ''}`);
  }
  return lines.join('\n') + '\n';
}
