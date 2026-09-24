/**
 * KNITCAT V2 — the quality-control inspection card.
 *
 * The QC engine (`production/qc.js`) ships an eleven-line checklist with categories, measurement
 * tolerances, auto-decided pass/fail, a pass rate, a blocking list and a lifecycle verdict
 * ('approved' | 'rejected' | 'incomplete' | 'incomplete-failing' | 'pending'). Every production
 * plan computes this on each refresh (`computePlan` seeds it via `targetsFromProject` and calls
 * `evaluateQc`), yet the Production panel shows only costing, batches and the quote — the QC
 * checklist is entirely invisible, so a knitter never sees "measurements off by 3.5 cm" or
 * "ends not woven in" until the customer emails them. This view turns the hidden checklist back
 * into a printable inspection card grouped by category. DOM-free and total: garbage yields `null`,
 * an empty list yields a "nothing inspected yet" summary so callers can hide the section cleanly.
 *
 * @module production/qc-view
 */

/** Category display order + human labels; unknown categories fall through with a Title-Cased name. */
const CATEGORY_LABELS = Object.freeze({
  structure: 'Structure',
  fit: 'Fit & measurements',
  finish: 'Finishing',
  presentation: 'Presentation'
});
const CATEGORY_ORDER = ['structure', 'fit', 'finish', 'presentation'];

/** Glyph for each verdict — kept as text so the printable sheet mirrors the panel. */
const VERDICT_MARK = Object.freeze({ pass: '✓', fail: '✗', na: '—', pending: '○' });

/**
 * Turn a live QC checklist (the `qc` field on `computePlan` output, or any `evaluateQc` result)
 * into a UI-shaped inspection card. Every `verdict`, `actual`, `note` and measurement `target ±
 * tolerance` from the engine is preserved verbatim — this view never re-scores or re-decides.
 *
 * @param {{checks?:Array, score?:object, title?:string, inspectedAt?:string, inspector?:string}|null} qc
 * @returns {{ok:true, headline:string, tone:'ok'|'warn'|'bad'|'info', title:string, inspectedAt:string, inspector:string,
 *   score:{passed:number, failed:number, na:number, pending:number, passRate:number, verdict:string, blocking:Array<{key:string,label:string}>},
 *   progress:{done:number,total:number,pct:number},
 *   categories:Array<{id:string, label:string, checks:Array<{key:string,label:string,type:string,required:boolean,verdict:string,mark:string,actual:number|string|null,note:string,reading:string|null}>}>,
 *   blocking:Array<{key:string,label:string}>}|null}
 */
export function summariseQC(qc) {
  if (!qc || typeof qc !== 'object' || !Array.isArray(qc.checks) || qc.checks.length === 0) return null;
  const byCategory = new Map();
  for (const c of qc.checks) {
    if (!c || typeof c !== 'object') continue;
    const entry = normaliseCheck(c);
    const cat = String(c.category || 'other');
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(entry);
  }
  // Order categories: canonical first, unknown alphabetically after.
  const known = CATEGORY_ORDER.filter((k) => byCategory.has(k));
  const extras = [...byCategory.keys()].filter((k) => !CATEGORY_ORDER.includes(k)).sort();
  const categories = [...known, ...extras].map((id) => ({
    id,
    label: CATEGORY_LABELS[id] || titleCase(id),
    checks: byCategory.get(id)
  }));

  const score = normaliseScore(qc.score);
  const total = categories.reduce((n, k) => n + k.checks.length, 0);
  const done = categories.reduce(
    (n, k) => n + k.checks.filter((c) => c.verdict === 'pass' || c.verdict === 'fail' || c.verdict === 'na').length,
    0
  );
  const progress = { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  const tone = scoreTone(score);
  const headline = buildHeadline(score, progress);
  return {
    ok: true,
    headline,
    tone,
    title: String(qc.title || 'QC inspection'),
    inspectedAt: String(qc.inspectedAt || ''),
    inspector: String(qc.inspector || ''),
    score,
    progress,
    categories,
    blocking: score.blocking
  };
}

/** Fill in safe defaults for the score block; a checklist with no score is "pending". */
function normaliseScore(s) {
  const score = s && typeof s === 'object' ? s : {};
  return {
    passed: Number.isFinite(score.passed) ? score.passed : 0,
    failed: Number.isFinite(score.failed) ? score.failed : 0,
    na: Number.isFinite(score.na) ? score.na : 0,
    pending: Number.isFinite(score.pending) ? score.pending : 0,
    passRate: Number.isFinite(score.passRate) ? score.passRate : 0,
    verdict: String(score.verdict || 'pending'),
    blocking: Array.isArray(score.blocking) ? score.blocking.slice() : []
  };
}

/** Shape one raw check into a UI row, computing the human "reading" for measurement lines. */
function normaliseCheck(c) {
  const verdict = String(c.verdict || 'pending');
  const mark = VERDICT_MARK[verdict] || '○';
  const reading = buildReading(c);
  return {
    key: String(c.key || ''),
    label: String(c.label || c.key || 'check'),
    type: String(c.type || 'boolean'),
    required: !!c.required,
    verdict,
    mark,
    actual: c.actual == null ? null : c.actual,
    note: String(c.note || ''),
    reading
  };
}

/** '96 · ±2 cm · off by 3.5' when a measurement has a target; null for boolean/count checks. */
function buildReading(c) {
  if (c.type !== 'measurement') return null;
  const target = Number.isFinite(c.target) ? c.target : null;
  const tolerance = Number.isFinite(c.tolerance) ? c.tolerance : null;
  const unit = String(c.unit || '');
  if (target == null) return unit ? `target — · ${unit}` : null;
  const tol = tolerance != null ? ` ±${tolerance}${unit ? ' ' + unit : ''}` : '';
  const actual = Number.isFinite(c.actual) ? c.actual : null;
  if (actual == null) return `target ${target}${unit ? ' ' + unit : ''}${tol}`;
  const off = Math.abs(actual - target);
  const within = tolerance == null ? null : off <= tolerance + 1e-9;
  const suffix = within === false ? ` · off by ${round1(off)}` : within === true ? ' · within' : '';
  return `${actual}${unit ? ' ' + unit : ''} vs ${target}${tol}${suffix}`;
}

/** Round to one decimal without collapsing small legit offsets (3.5 → 3.5). */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/** 'some_unknown' → 'Some Unknown'; used for categories outside the canonical four. */
function titleCase(s) {
  return String(s)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** 'rejected' or 'incomplete-failing' → bad; blocking without finish → bad; approved → ok. */
function scoreTone(score) {
  if (score.verdict === 'rejected' || score.verdict === 'incomplete-failing') return 'bad';
  if (score.blocking.length) return 'bad';
  if (score.verdict === 'incomplete' || score.verdict === 'pending') return 'warn';
  if (score.verdict === 'approved') return 'ok';
  return 'info';
}

/** Compose the panel's one-line summary from the score + progress. */
function buildHeadline(score, progress) {
  const parts = [score.verdict];
  parts.push(`${progress.done}/${progress.total} inspected`);
  if (score.failed) parts.push(`${score.failed} failed`);
  if (score.pending) parts.push(`${score.pending} pending`);
  if (!score.failed && !score.pending && score.passRate != null) parts.push(`${score.passRate}% pass`);
  return parts.join(' · ');
}

/**
 * Render a {@link summariseQC} summary as a plain-text inspection card ready to print and pin
 * above the machine, or hand to a technician. Total: null → a helpful prompt; never throws.
 * Blocking failures appear at the top with their note; every category is listed with mark +
 * label + reading.
 *
 * @param {object|null} summary the result of {@link summariseQC}.
 * @param {object} [opts] @param {string} [opts.title] overrides the summary's title.
 * @returns {string} always ends in a newline.
 */
export function qcToText(summary, opts = {}) {
  if (!summary || !summary.ok) return 'Inspect a piece to get the QC checklist.\n';
  const title = (opts && opts.title) || summary.title;
  const lines = [];
  lines.push(title);
  lines.push('='.repeat(title.length));
  lines.push(summary.headline);
  if (summary.inspectedAt) lines.push(`inspected ${summary.inspectedAt}${summary.inspector ? ' · ' + summary.inspector : ''}`);
  lines.push('');
  if (summary.blocking.length) {
    lines.push('BLOCKING — fix before shipping');
    for (const b of summary.blocking) lines.push(`  ✗ ${b.label} (${b.key})`);
    lines.push('');
  }
  for (const cat of summary.categories) {
    lines.push(`-- ${cat.label} ${'-'.repeat(Math.max(0, 40 - cat.label.length))}`);
    for (const c of cat.checks) {
      const req = c.required ? '*' : ' ';
      lines.push(`  ${c.mark} ${req} ${c.label}${c.reading ? ` — ${c.reading}` : ''}${c.note ? ` (${c.note})` : ''}`);
    }
    lines.push('');
  }
  lines.push(`pass rate ${summary.score.passRate}% · verdict ${summary.score.verdict}`);
  return lines.join('\n') + '\n';
}
