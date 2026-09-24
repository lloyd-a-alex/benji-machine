/**
 * KNITCAT V2 — Pattern Health Dashboard (ready-to-cast-on summary).
 *
 * A master knitter sitting down with a fresh project wants ONE answer: "Is this pattern READY to
 * cast on?" Right now that answer is scattered across six V2 panels — verification in the Compiler,
 * yarn shortfall in Yarn, feasibility in Production, validation in the Project model. This module
 * fuses them into a single traffic-light readiness card: each check gets a green/amber/red light
 * and a one-line explanation, and the overall verdict rolls up.
 *
 * Pure, DOM-free. Operates on the PipelineReport shape from `runFullPipeline`.
 *
 * @module v2/health-view
 */

/**
 * @typedef {object} HealthCheck
 * @property {string} id        Machine-readable identifier ('model', 'verify', 'machine', etc.)
 * @property {string} label     Human label ('Model integrity', 'Verification', ...)
 * @property {'pass'|'warn'|'fail'|'na'} status
 * @property {string} detail    One-sentence explanation
 */

/**
 * @typedef {object} HealthSummary
 * @property {boolean} ready       All checks pass or are n/a
 * @property {number}  level        0 = red, 1 = amber, 2 = green
 * @property {string}  tone         'ok' | 'warn' | 'bad' | 'info'
 * @property {string}  headline     One-line summary for the chip
 * @property {HealthCheck[]} checks Individual check results
 */

/**
 * Compute the consolidated Pattern Health card from a pipeline report.
 * Never throws — missing sub-reports are gracefully absorbed as 'na'.
 *
 * @param {object|null} report The full return from `runFullPipeline`
 * @returns {HealthSummary}
 */
export function summariseHealth(report) {
  if (!report || typeof report !== 'object') {
    return { ready: false, level: 0, tone: 'bad', headline: 'No pipeline report available.', checks: [] };
  }

  const checks = [];

  // 1. Model integrity — any validation errors?
  const modelErrors = report.modelErrorCount || 0;
  const modelWarnings = (report.validation || []).filter(v => v && v.severity === 'warn').length;
  checks.push({
    id: 'model',
    label: 'Model integrity',
    status: modelErrors > 0 ? 'fail' : modelWarnings > 0 ? 'warn' : 'pass',
    detail: modelErrors > 0 ? `${modelErrors} error(s) in the project graph.`
      : modelWarnings > 0 ? `${modelWarnings} advisory note(s).`
      : 'KnitScript is coherent — no errors.'
  });

  // 2. Compile verification — blocking failures?
  const summary = report.compile && report.compile.summary;
  if (summary) {
    const blocking = (summary.blocking || []).length || summary.failures || 0;
    const warns = summary.warnings || 0;
    checks.push({
      id: 'verify',
      label: 'Verification checks',
      status: blocking > 0 ? 'fail' : warns > 0 ? 'warn' : 'pass',
      detail: blocking > 0 ? `${blocking} blocking issue(s).`
        : warns > 0 ? `${warns} advisory warning(s) — read the Compiler panel.`
        : `All ${summary.passed || 0} checks passed.`
    });
  } else {
    checks.push({ id: 'verify', label: 'Verification checks', status: 'na', detail: 'Compiler did not run.' });
  }

  // 3. Machine fit — specific sub-check from the verification results.
  const mcheck = (report.compile && report.compile.verification || []).find(v => v && v.id === 'machine');
  if (mcheck) {
    checks.push({
      id: 'machine',
      label: 'Machine compatibility',
      status: mcheck.verdict === 'fail' ? 'fail' : mcheck.verdict === 'warn' ? 'warn' : 'pass',
      detail: mcheck.message || ''
    });
  } else {
    checks.push({ id: 'machine', label: 'Machine compatibility', status: 'na', detail: 'No machine check returned.' });
  }

  // 4. Yarn sufficiency — any shortfalls?
  const shortfalls = report.yarn && report.yarn.shortfalls;
  if (shortfalls && shortfalls.length) {
    const total = shortfalls.reduce((s, f) => s + (f.buy || 0), 0);
    checks.push({ id: 'yarn', label: 'Yarn in stash', status: 'fail', detail: `Need ${total} more ball(s) before casting on.` });
  } else if (report.yarn) {
    checks.push({ id: 'yarn', label: 'Yarn in stash', status: 'pass', detail: 'All yarns covered by your stash.' });
  } else {
    checks.push({ id: 'yarn', label: 'Yarn in stash', status: 'na', detail: 'Yarn Lab did not run.' });
  }

  // 5. Production feasibility.
  const prod = report.production;
  if (prod && prod.feasible != null) {
    checks.push({
      id: 'feasible',
      label: 'Production feasibility',
      status: prod.feasible ? 'pass' : 'warn',
      detail: prod.feasible ? 'Batch plan is feasible for the deadline.' : 'Deadline or stock may not be achievable.'
    });
  } else {
    checks.push({ id: 'feasible', label: 'Production feasibility', status: 'na', detail: 'Production did not run.' });
  }

  // 6. QC verdict.
  const qcVerdict = prod && prod.qc && prod.qc.score && prod.qc.score.verdict;
  if (qcVerdict) {
    checks.push({
      id: 'qc',
      label: 'QC inspection',
      status: qcVerdict === 'approved' ? 'pass' : qcVerdict === 'rejected' || qcVerdict === 'incomplete-failing' ? 'fail' : 'warn',
      detail: `Verdict: ${qcVerdict}.`
    });
  } else {
    checks.push({ id: 'qc', label: 'QC inspection', status: 'na', detail: 'No QC checklist evaluated.' });
  }

  // 7. Gauge consistency — Fit and Yarn should agree on the working gauge.
  const fitG = report.fit && report.fit.gauge && report.fit.gauge.stsPer10cm;
  const yarnG = report.yarn && report.yarn.gauge && report.yarn.gauge.stsPer10cm;
  if (fitG != null && yarnG != null) {
    const match = Math.abs(fitG - yarnG) < 0.5;
    checks.push({
      id: 'gauge',
      label: 'Gauge consistency',
      status: match ? 'pass' : 'warn',
      detail: match ? `Fit and Yarn agree at ${fitG} sts/10 cm.` : `Discrepancy: Fit uses ${fitG}, Yarn recommends ${yarnG}. Swatch to confirm.`
    });
  } else {
    checks.push({ id: 'gauge', label: 'Gauge consistency', status: 'na', detail: 'Gauge data incomplete.' });
  }

  // Roll-up
  const hasFail = checks.some(c => c.status === 'fail');
  const hasWarn = checks.some(c => c.status === 'warn');
  const hasNa = checks.some(c => c.status === 'na');
  const level = hasFail ? 0 : (hasWarn || hasNa) ? 1 : 2;
  const tone = hasFail ? 'bad' : (hasWarn || hasNa) ? 'warn' : 'ok';
  const ready = level === 2;
  const headline = ready ? 'Ready to cast on!'
    : hasFail ? 'Not ready — fix blocking issues.'
    : hasNa ? 'Incomplete — some subsystems did not run.'
    : 'Almost — a few advisories worth reading.';

  // Prescriptive: what should the knitter DO next? First non-pass check wins.
  const first = checks.find(c => c.status === 'fail') || checks.find(c => c.status === 'warn');
  const ACTION_MAP = {
    model: 'Fix the KnitScript errors shown in the Project panel.',
    verify: 'Resolve the Compiler warnings (check gauge/floats/machine).',
    machine: 'Switch machine profile or narrow the chart to fit the bed.',
    yarn: 'Buy more yarn or substitute a heavier strand.',
    feasible: 'Adjust the deadline, batch size, or daily hours.',
    qc: 'Complete the QC inspection checklist before shipping.',
    gauge: 'Swatch to confirm you can reach the required gauge.'
  };
  const nextAction = first ? (ACTION_MAP[first.id] || first.detail) : ready ? 'Cast on and enjoy!' : null;

  return { ready, level, tone, headline, checks, nextAction };
}

/**
 * Plain-text version of the health card for clipboard or console output.
 *
 * @param {HealthSummary|null} summary
 * @param {{title?:string}} [opts]
 * @returns {string}
 */
export function healthToText(summary, opts = {}) {
  if (!summary) return 'Health: no data available.';
  const title = (opts && opts.title) || 'PATTERN HEALTH';
  const L = [title, '─'.repeat(title.length)];
  L.push(`Status: ${summary.headline}`);
  L.push('');
  const marks = { pass: '✓', warn: '⚠', fail: '✗', na: '—' };
  for (const c of summary.checks) {
    L.push(`  ${marks[c.status] || '?'} ${c.label}: ${c.detail}`);
  }
  if (summary.nextAction) {
    L.push('');
    L.push(`  Next: ${summary.nextAction}`);
  }
  return L.join('\n');
}
