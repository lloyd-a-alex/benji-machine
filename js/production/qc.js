/**
 * KNITCAT V2 — Production: quality control (spec §6.7).
 *
 * A knitted piece leaves the machine half-done; the difference between a £15 hobby giveaway and a
 * £60 retail item is the finish, and the finish is a checklist. This module defines the standard
 * QC checklist (gauge, measurements-with-tolerance, dropped stitches, seams, ends, blocking,
 * labelling — the spec's list, plus machine-specific extras), lets you stamp each line pass/fail/na
 * with an optional measurement, and scores the whole piece: a verdict, a pass rate, and the
 * specific blocking failures a maker must fix before shipping.
 *
 * The measurement lines are interesting: a check can carry a `target` and a `tolerance`, so "chest
 * 96 ± 2 cm" is *verified* against a logged `actual` rather than ticked by eye. {@link evaluateQc}
 * computes that tolerance pass/fail automatically. This is what ties QC back to the Fit Engine —
 * a plan can generate its QC targets straight from `garment.finishedBust` etc.
 *
 * Pure and DOM-free; a QC checklist is plain JSON so it serialises into the plan and stores.
 *
 * @module production/qc
 */

import { QC_VERDICTS, clamp, num, pct, round, slug } from './_util.js';

/**
 * @typedef {object} QCCheck
 * @property {string} key @property {string} label @property {string} category
 * @property {'boolean'|'measurement'|'count'} type @property {boolean} required
 * @property {number|null} target @property {number|null} tolerance @property {string} [unit]
 * @property {string} verdict 'pass'|'fail'|'na'|'pending'
 * @property {number|string|null} actual @property {string} note
 */

/**
 * @typedef {object} QCChecklist
 * @property {string} id @property {string} [projectId] @property {string} [batchId]
 * @property {string} title @property {QCCheck[]} checks @property {string} inspectedAt
 * @property {string} inspector @property {object} score
 */

/** The canonical checklist template a maker starts from (spec §6.7 + machine realities). */
export const QC_TEMPLATE = [
  { key: 'gauge', label: 'Gauge correct (stitches & rows per 10 cm)', category: 'structure', type: 'measurement', required: true, target: null, tolerance: null, unit: 'sts/10cm' },
  { key: 'measurements', label: 'Measurements within tolerance', category: 'fit', type: 'measurement', required: true, target: null, tolerance: 2, unit: 'cm' },
  { key: 'dropped', label: 'No dropped or ladder stitches', category: 'structure', type: 'boolean', required: true },
  { key: 'seams', label: 'Seams even and invisible', category: 'finish', type: 'boolean', required: true },
  { key: 'ends', label: 'Ends woven in', category: 'finish', type: 'boolean', required: true },
  { key: 'blocked', label: 'Blocked to measurements', category: 'finish', type: 'boolean', required: true },
  { key: 'holes', label: 'No holes at decreases / short rows', category: 'structure', type: 'boolean', required: true },
  { key: 'floats', label: 'Floats caught and even (colourwork)', category: 'structure', type: 'boolean', required: false },
  { key: 'labels', label: 'Labelled (fibre, care, size)', category: 'presentation', type: 'boolean', required: true },
  { key: 'clean', label: 'Clean, no marks or pet hair', category: 'presentation', type: 'boolean', required: true },
  { key: 'packaging', label: 'Packaged for shipping', category: 'presentation', type: 'boolean', required: false }
];

/**
 * Build a fresh checklist from the template, optionally seeding measurement targets from a Project
 * (so "measurements" checks the finished bust within tolerance).
 * @param {{projectId?:string, batchId?:string, title?:string, inspector?:string, targets?:{chest?:number}}} [opts]
 * @returns {QCChecklist}
 */
export function createChecklist(opts = {}) {
  const checks = QC_TEMPLATE.map((t) => ({
    key: t.key,
    label: t.label,
    category: t.category,
    type: t.type,
    required: !!t.required,
    target: t.target != null ? t.target : null,
    tolerance: t.tolerance != null ? t.tolerance : null,
    unit: t.unit || '',
    verdict: 'pending',
    actual: null,
    note: ''
  }));
  // Seed the measurement targets from the Project graph when available.
  if (opts.targets && opts.targets.chest != null) {
    const m = checks.find((c) => c.key === 'measurements');
    if (m) {
      m.target = num(opts.targets.chest);
      if (m.tolerance == null) m.tolerance = 2;
    }
  }
  return {
    id: `qc-${Date.now().toString(36)}`,
    projectId: opts.projectId || '',
    batchId: opts.batchId || '',
    title: opts.title || 'QC inspection',
    checks,
    inspectedAt: opts.inspectedAt || '',
    inspector: opts.inspector || '',
    score: { passed: 0, failed: 0, na: 0, pending: checks.length, passRate: 0, verdict: 'pending', blocking: [] }
  };
}

/**
 * Set a check's verdict (and optional actual value), then rescore. @returns {QCChecklist}
 */
export function setCheck(list, key, verdict, actual, note) {
  const checks = list.checks.map((c) => {
    if (c.key !== key) return c;
    const next = { ...c };
    if (verdict != null && QC_VERDICTS.includes(verdict)) next.verdict = verdict;
    if (actual !== undefined) next.actual = actual;
    if (note !== undefined) next.note = String(note);
    return next;
  });
  return evaluateQc({ ...list, checks, inspectedAt: list.inspectedAt || new Date().toISOString().slice(0, 10) });
}

/**
 * Record an actual measurement, auto-deciding pass/fail against target ± tolerance (when the check
 * is a measurement with a target), else just storing it. @returns {QCChecklist}
 */
export function recordMeasurement(list, key, actual) {
  const c = list.checks.find((x) => x.key === key);
  if (!c || c.target == null || c.tolerance == null) return setCheck(list, key, undefined, actual);
  const within = Math.abs(num(actual) - num(c.target)) <= num(c.tolerance, 0) + 1e-9;
  return setCheck(list, key, within ? 'pass' : 'fail', actual, within ? '' : `Off by ${round(Math.abs(num(actual) - num(c.target)), 2)} ${c.unit} (> ±${c.tolerance})`);
}

/**
 * Score a checklist: counts, pass rate over non-NA required checks, and the list of blocking
 * (required, failed) items. Returns the checklist with `score` filled in.
 * @param {QCChecklist} list @returns {QCChecklist}
 */
export function evaluateQc(list) {
  let passed = 0, failed = 0, na = 0, pending = 0;
  const blocking = [];
  for (const c of list.checks || []) {
    if (c.verdict === 'pass') passed++;
    else if (c.verdict === 'fail') {
      failed++;
      if (c.required) blocking.push({ key: c.key, label: c.label });
    } else if (c.verdict === 'na') na++;
    else pending++;
  }
  const requiredChecks = (list.checks || []).filter((c) => c.required && c.verdict !== 'na');
  const requiredPassed = requiredChecks.filter((c) => c.verdict === 'pass').length;
  const passRate = requiredChecks.length ? pct(requiredPassed / requiredChecks.length) : 100;
  const verdict = pending > 0 ? (failed > 0 ? 'incomplete-failing' : 'incomplete') : blocking.length ? 'rejected' : 'approved';
  return {
    ...list,
    score: {
      passed, failed, na, pending,
      passRate,
      verdict,
      approved: blocking.length === 0 && pending === 0,
      blocking
    }
  };
}

/** Group the checks by category for rendering. @returns {Record<string, QCCheck[]>} */
export function checksByCategory(list) {
  const out = {};
  for (const c of list.checks || []) (out[c.category] || (out[c.category] = [])).push(c);
  return out;
}

/** A compact progress bar object for the dashboard. @returns {{label:string, done:number, total:number, pct:number, verdict:string}} */
export function qcProgress(list) {
  const total = (list.checks || []).length;
  const done = (list.checks || []).filter((c) => c.verdict === 'pass' || c.verdict === 'fail' || c.verdict === 'na').length;
  return { label: list.title || 'QC', done, total, pct: total ? pct(done / total) : 0, verdict: (list.score && list.score.verdict) || 'pending' };
}

/** Blank out every verdict to re-inspect the same piece. @returns {QCChecklist} */
export function resetChecklist(list) {
  return evaluateQc({ ...list, inspectedAt: '', checks: list.checks.map((c) => ({ ...c, verdict: 'pending', actual: null, note: '' })) });
}

/** Merge two inspections of the same piece (later wins per key) — for re-checks across sittings. */
export function mergeInspections(a, b) {
  const byKey = new Map((a.checks || []).map((c) => [c.key, c]));
  for (const c of b.checks || []) if (c.verdict !== 'pending') byKey.set(c.key, c);
  return evaluateQc({ ...a, checks: QC_TEMPLATE.map((t) => byKey.get(t.key) || byKey.get(slug(t.key)) || { ...t, verdict: 'pending', actual: null, note: '' }) });
}

/**
 * Produce QC targets from a Project's finished-garment nodes so a checklist verifies against the
 * pattern's intent, not a remembered number. @returns {{chest?:number, length?:number}}
 */
export function targetsFromProject(project) {
  const out = {};
  const g = (id) => {
    try { return project && project.has && project.has(id) ? num(project.get(id)) : null; } catch { return null; }
  };
  const bust = g('garment.finishedBust');
  if (bust) out.chest = round(bust, 1);
  const len = g('garment.length');
  if (len) out.length = round(len, 1);
  return out;
}
