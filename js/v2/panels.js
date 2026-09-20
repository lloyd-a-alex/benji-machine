/**
 * KNITCAT V2 — the runtime panels (spec §10 UI, §6.10 Production UI).
 *
 * The hands of the V2 layer: six floating docks, one per system, mounted *at runtime* over the
 * existing editor. The legacy app keeps its seven HTML tabs untouched (the accessibility contract
 * pins that exactly seven `.tab-btn`s exist and that V2 never adds one); everything V2 is a
 * `.kv2-`-classed dock built from the shared `ui/kit.js` shell, so it looks like the rest of the
 * app's panels but is entirely additive. Every dock opens on top of the same fused pipeline result
 * ({@link module:v2.runFullPipeline}), so the Project panel, the Fit dock and the Production board
 * are always describing the *same* garment — the fusion made visible.
 *
 * Design rules this file obeys:
 *   - DOM-free at import: nothing here runs until {@link installV2} is called by the app boot.
 *   - Resilient: each render is wrapped; a broken system shows an inline error, never a dead panel,
 *     and never takes the editor down with it.
 *   - Self-contained drag: the header can be dragged to reposition (pointer events), so the docks
 *     do not depend on the global draggable registry.
 *   - Deterministic where it can be: the panel content is a function of the live Project + app
 *     state, re-derived on `refresh()`.
 *
 * @module v2/panels
 */

import { buildPanel, esc, sectionHeading, ensureKitStyles } from '../ui/kit.js';
import { getDiagnostics } from '../core/diagnostics.js';
import { DEFAULT_KNITSCRIPT, V2_SYSTEM_CATALOG, V2_VERSION } from './_catalog.js';
import { projectFromKnitScript, runFullPipeline } from './index.js';

/** The panel ids, in the order the launcher shows them. */
export const V2_SYSTEMS = V2_SYSTEM_CATALOG.map((s) => s.id);

/** Per-app controller registry so open/close commands find the right docks. */
const CONTROLLERS = new WeakMap();

const STYLE_ID = 'kv2-style';
const LAUNCHER_ID = 'kv2-launcher';

/**
 * Install the V2 layer over a running app. Idempotent per app. Returns a controller:
 * `{ open(id), close(id), toggle(id), isOpen(id), closeAll(), refresh(), setScript(text),
 *   getScript(), project, report, systems }`.
 *
 * @param {object} app the live KnitApp (needs currentProfile / projectMeta / editor; all optional)
 * @returns {object|null} null when there is no DOM (headless import / tests)
 */
export function installV2(app) {
  if (typeof document === 'undefined') return null;
  const existing = CONTROLLERS.get(app);
  if (existing) return existing;
  ensureStyles();

  const state = {
    script: DEFAULT_KNITSCRIPT,
    project: null,
    report: null,
    reportError: null,
    builtAt: 0
  };
  const panels = {}; // id -> { panel, body, countEl, render }
  let dragZ = 9100;

  const controller = {
    version: V2_VERSION,
    systems: V2_SYSTEM_CATALOG,
    get project() { return ensureReport().project; },
    get report() { return ensureReport().report; },
    open, close, toggle, isOpen, closeAll, refresh,
    setScript(text) { state.script = text || ''; state.builtAt = 0; },
    getScript() { return state.script; }
  };
  CONTROLLERS.set(app, controller);
  buildLauncher(controller);

  return controller;

  // ---- core: (re)build the fused report lazily, once per edit ----
  function ensureReport(force = false) {
    if (force || !state.report || !state.builtAt) {
      try {
        const built = projectFromKnitScript(state.script, { machine: app && app.currentProfile && app.currentProfile.id });
        state.project = built.project;
        state.reportError = built.error;
        state.report = built.project ? runFullPipeline(built.project, {}) : null;
      } catch (err) {
        state.report = null;
        state.reportError = err && err.message ? err.message : String(err);
        getDiagnostics().logError('V2 pipeline', err, { level: 'warn' });
      }
      state.builtAt = Date.now();
    }
    return state;
  }

  function panelFor(id) {
    if (panels[id]) return panels[id];
    const meta = V2_SYSTEM_CATALOG.find((s) => s.id === id) || { id, label: id, glyph: '•' };
    const built = buildPanel({
      id: `kv2-${id}`,
      title: `${meta.glyph}  ${meta.label}`,
      className: `kv2-panel kv2-panel--${id}`,
      pos: 'tr',
      actionsHtml: `<button type="button" class="kx-btn kx-btn--ghost kv2-refresh" title="Re-run the pipeline">↻</button>`,
      footHtml: `<span class="kv2-foot">KNITCAT V2 · ${esc(meta.hint || '')}</span>`
    });
    built.panel.style.width = id === 'compiler' || id === 'production' ? '520px' : '420px';
    built.panel.style.maxHeight = '76vh';
    document.body.appendChild(built.panel);
    wireDrag(built.panel, () => (dragZ += 1), () => ensureReport(true));
    const entry = {
      panel: built.panel,
      body: built.body,
      countEl: built.panel.querySelector('[data-count]'),
      render: RENDERERS[id] || (() => `<p class="kv2-empty">No panel for "${esc(id)}".</p>`)
    };
    built.close.addEventListener('click', () => close(id));
    built.panel.querySelector('.kv2-refresh').addEventListener('click', () => { ensureReport(true); paint(id); });
    panels[id] = entry;
    return entry;
  }

  function paint(id) {
    const entry = panelFor(id);
    const st = ensureReport();
    try {
      const html = entry.render(st, app) || '';
      entry.body.innerHTML = html;
      binders[id] && binders[id](entry, controller, st);
    } catch (err) {
      entry.body.innerHTML = renderError(err, id);
    }
    if (entry.countEl) entry.countEl.textContent = counts[id] ? counts[id](st) : '';
  }

  function open(id) {
    const entry = panelFor(id);
    entry.panel.hidden = false;
    paint(id);
  }
  function close(id) {
    const entry = panelFor(id);
    entry.panel.hidden = true;
  }
  function isOpen(id) {
    return !!panels[id] && !panels[id].panel.hidden;
  }
  function toggle(id) {
    if (isOpen(id)) close(id);
    else open(id);
    syncLauncher();
  }
  function closeAll() {
    for (const id of Object.keys(panels)) close(id);
    syncLauncher();
  }
  function refresh() {
    ensureReport(true);
    for (const id of Object.keys(panels)) if (!panels[id].panel.hidden) paint(id);
    syncLauncher();
  }
}

// ---------------------------------------------------------------------------
// helpers used by the renderers + the boot-level open/close API
// ---------------------------------------------------------------------------

/** A safe standalone opener (used by the command dispatcher before/without a cached controller). */
export function openV2Panel(app, id) {
  const c = CONTROLLERS.get(app) || (typeof document !== 'undefined' ? installV2(app) : null);
  if (c && c.open) { c.open(id); return true; }
  return false;
}

/** Close every V2 dock for an app. */
export function closeAllV2Panels(app) {
  const c = CONTROLLERS.get(app);
  if (c && c.closeAll) { c.closeAll(); return true; }
  return false;
}

/** Look up the controller installed for an app (or null). */
export function getV2Controller(app) {
  return CONTROLLERS.get(app) || null;
}

function renderError(err, id) {
  const message = err && err.message ? err.message : String(err);
  return `<div class="kv2-error"><strong>${esc(id)} panel hit an error.</strong><br>${esc(message)}<br><span class="kv2-faint">The editor is unaffected — close this dock and keep working.</span></div>`;
}

/** Format a value for a table cell (numbers tabular, nulls faint). */
function cell(v, suffix = '') {
  if (v == null || v === '') return '<span class="kv2-faint">—</span>';
  if (typeof v === 'number') return `<span class="kv2-num">${fmtNum(v)}</span>${esc(suffix)}`;
  return esc(v) + esc(suffix);
}
function fmtNum(n) {
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
function moneyCell(v, currency = 'GBP') {
  if (v == null) return '<span class="kv2-faint">—</span>';
  const sym = { GBP: '£', USD: '$', EUR: '€' }[String(currency).toUpperCase()] || '';
  return `<span class="kv2-num">${sym}${(Math.round(num(v) * 100) / 100).toFixed(2)}</span>`;
}
function num(v) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; }
function row(label, valueHtml) {
  return `<div class="kv2-row"><span class="kv2-k">${esc(label)}</span><span class="kv2-v">${valueHtml}</span></div>`;
}
function chip(text, tone = '') { return `<span class="kv2-chip${tone ? ' kv2-chip--' + tone : ''}">${esc(text)}</span>`; }
function bar(pctVal, tone) {
  const p = Math.max(0, Math.min(100, num(pctVal)));
  return `<span class="kv2-bar"><span class="kv2-bar__fill${tone ? ' kv2-bar__fill--' + tone : ''}" style="width:${p}%"></span></span><span class="kv2-num">${p}%</span>`;
}

// ---------------------------------------------------------------------------
// Per-system renderers. Each is (state, app) -> innerHTML. All dynamic strings
// go through esc(); numbers through cell()/moneyCell(). They read the already
// computed fused report so the six docks never disagree.
// ---------------------------------------------------------------------------

const RENDERERS = {
  project(state) {
    const r = state.report;
    if (!r) return `<p class="kv2-error">${esc(state.reportError || 'Could not build a Project.')}</p>`;
    const vals = r.project && r.project.keyValues ? [] : [];
    const keyRows = Object.entries({
      'Cast on': r.headline.castOn, 'Body rows': r.headline.bodyRows,
      'Finished bust (cm)': r.headline.finishedBust, 'Gauge (sts/10cm)': r.headline.gaugeStitches,
      'Time (h)': r.headline.totalHours, 'Cost': r.headline.costTotal, 'Suggested price': r.headline.suggestedPrice
    }).map(([k, v]) => row(k, typeof v === 'number' && (k === 'Cost' || k === 'Suggested price') ? moneyCell(v) : cell(v)));
    const issues = safeValidate(state.project);
    const issueHtml = issues.length
      ? `<div class="kv2-issues">${issues.map((i) => `<div class="kv2-issue kv2-issue--${esc(i.severity || 'info')}">${esc(i.message || i.code || JSON.stringify(i))}</div>`).join('')}</div>`
      : `<p class="kv2-faint">No validation issues — the KnitScript is coherent.</p>`;
    return `${sectionHeading('KnitScript', 'the single source of truth')}
      <textarea class="kv2-script" spellcheck="false" aria-label="KnitScript source">${esc(state.script)}</textarea>
      <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--primary" data-act="apply">Apply & re-run</button>
      <button type="button" class="kx-btn" data-act="reset">Reset to template</button>
      <button type="button" class="kx-btn" data-act="copy">Copy</button></div>
      ${state.reportError ? `<p class="kv2-issue kv2-issue--error">Parse: ${esc(state.reportError)}${' · showing the working scaffold instead.'}</p>` : ''}
      ${sectionHeading('Key values')}${keyRows.join('')}
      ${sectionHeading('What would change')}${issueHtml}`;
  },

  fit(state) {
    const fit = state.report && state.report.fit;
    if (!fit) return `<p class="kv2-error">The Fit Engine produced no draft${state.reportError ? ': ' + esc(state.reportError) : '.'}</p>`;
    const pieces = (fit.pieces || []).map((p) => {
      const d = p.dimensions || {};
      return `<tr><td>${esc(p.id || p.name || 'piece')}</td><td class="kv2-num">${cell(p.castOn)}</td><td class="kv2-num">${cell(p.rows || d.rows)}</td><td class="kv2-num">${cell(d.widthCm != null ? Math.round(d.widthCm * 10) / 10 : null, 'cm')}</td></tr>`;
    }).join('');
    const rep = fit.report || {};
    const verdict = rep.verdict || rep.summary || null;
    return `${sectionHeading('Construction', esc(fit.construction || ''))}
      ${row('Pieces', cell((fit.pieces || []).length))}
      ${row('Body gauge', cell(fit.gauge && fit.gauge.stsPer10cm, ' sts'))}
      ${verdict ? row('Fit verdict', chip(typeof verdict === 'string' ? verdict : (verdict.overall || 'assessed'), fitVerdictTone(verdict))) : ''}
      ${sectionHeading('Pattern pieces')}
      <table class="kv2-table"><thead><tr><th>Piece</th><th>Cast&nbsp;on</th><th>Rows</th><th>Width</th></tr></thead><tbody>${pieces || '<tr><td colspan="4" class="kv2-faint">none</td></tr>'}</tbody></table>
      ${fit.report && Array.isArray(fit.report.points) ? sectionHeading('Ease check') + fit.report.points.slice(0, 8).map((pt) => row(pt.region || pt.label || 'point', `${cell(pt.measurement != null ? Math.round(pt.measurement * 10) / 10 : pt.value, 'cm')} ${pt.status ? chip(pt.status, pt.status === 'good' ? 'ok' : 'warn') : ''}`)).join('') : ''}`;
  },

  yarn(state) {
    const y = state.report && state.report.yarn;
    if (!y) return `<p class="kv2-error">The Yarn Lab produced no report${state.reportError ? ': ' + esc(state.reportError) : '.'}</p>`;
    const list = (y.yarns || []).map((yy) => `<tr><td>${esc(yy.name)}</td><td class="kv2-num">${cell(yy.meters, 'm')}</td><td class="kv2-num">${cell(yy.ballsNeeded)}</td><td>${yy.shortfall > 0 ? chip('+' + yy.shortfall + ' to buy', 'warn') : chip('in stash', 'ok')}</td></tr>`).join('');
    return `${sectionHeading('Yarns')}
      <table class="kv2-table"><thead><tr><th>Yarn</th><th>Metres</th><th> Balls</th><th>Stash</th></tr></thead><tbody>${list || '<tr><td colspan="4" class="kv2-faint">no yarn declared</td></tr>'}</tbody></table>
      ${row('Total length', cell(y.totalMeters, ' m'))}
      ${row('Yarn cost', moneyCell(y.totalCost))}
      ${row('Gauge', cell(y.gauge && y.gauge.stsPer10cm, ` sts / ${cell(y.gauge && y.gauge.rowsPer10cm)} rows`))}
      ${y.behavior ? row('Behaviour', chip(`${y.behavior.fibre || 'mixed'} · drape ${cell(y.behavior.drape)}`, '')) : ''}
      ${y.care && y.care[0] ? row('Care', esc(Array.isArray(y.care[0].label) ? y.care[0].label.join(', ') : (y.care[0].label || ''))) : ''}
      ${y.shortfalls && y.shortfalls.length ? `<p class="kv2-issue kv2-issue--warn">Buy ${y.shortfalls.reduce((n, s) => n + num(s.buy), 0)} more ball(s) before casting on.</p>` : ''}`;
  },

  compiler(state) {
    const c = state.report && state.report.compile;
    if (!c) return `<p class="kv2-error">The Compiler produced no report${state.reportError ? ': ' + esc(state.reportError) : '.'}</p>`;
    const checks = (c.verification || []).map((v) => `<tr><td>${esc(v.id || v.label || v.check || '')}</td><td>${chip(v.verdict || v.status || '?', verdictTone(v.verdict || v.status))}</td><td class="kv2-check-fix">${esc(v.message || v.detail || '')}</td></tr>`).join('');
    const m = c.metrics || {};
    const written = c.outputs && c.outputs.written ? String(typeof c.outputs.written === 'string' ? c.outputs.written : (c.outputs.written.text || '')) : '';
    return `${sectionHeading('Pipeline', `${c.summary && c.summary.verdict ? esc(c.summary.verdict) : ''}`)}
      <div class="kv2-chips">${chip(m.pieces + ' pieces')}${chip(m.rows + ' rows')}${chip(m.decreases + ' dec')}${chip(m.increases + ' inc')}${chip(m.shortRows + ' short-rows')}${c.optimisation ? chip('optimised', 'ok') : ''}</div>
      ${sectionHeading('Verification')}
      <table class="kv2-table"><thead><tr><th>Check</th><th>Verdict</th><th>Detail</th></tr></thead><tbody>${checks || '<tr><td colspan="3" class="kv2-faint">none ran</td></tr>'}</tbody></table>
      ${sectionHeading('Outputs')}
      <div class="kv2-actions">
        <button type="button" class="kx-btn" data-out="written">Written</button>
        <button type="button" class="kx-btn" data-out="chart">Chart</button>
        <button type="button" class="kx-btn" data-out="machine">Machine</button>
        <button type="button" class="kx-btn" data-out="punchcard">Punchcard</button>
        <button type="button" class="kx-btn" data-out="dxf">DXF</button>
        <button type="button" class="kx-btn" data-out="gcode">G-code</button>
        <button type="button" class="kx-btn" data-out="manufacturing">Tech pack</button>
      </div>
      <pre class="kv2-out" data-out-pane>${esc(written.slice(0, 4000))}</pre>`;
  },

  reverse(state, app) {
    return `${sectionHeading('Photo → pattern', 'FFT gauge + construction → KnitScript')}
      <p class="kv2-faint">Drop a photo of a knitted garment (or a swatch with a coin/ruler for scale). KNITCAT counts the stitches in Fourier space and drafts a matching project.</p>
      <input type="file" accept="image/*" class="kv2-file" data-reverse-file aria-label="Choose a photo">
      <label class="kv2-inline">Reference object width (cm) <input type="number" class="kv2-input" data-reverse-ref value="2.5" min="0.1" step="0.1"></label>
      <label class="kv2-inline">…its width in px <input type="number" class="kv2-input" data-reverse-refpx value="80" min="1" step="1"></label>
      <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--primary" data-act="run-reverse">Analyse</button></div>
      <div data-reverse-out class="kv2-reverse-out">${state.reverseResult ? renderReverseResult(state.reverseResult) : '<p class="kv2-faint">No analysis run yet.</p>'}</div>`;
  },

  production(state) {
    const r = state.report;
    const prod = r && r.production;
    if (!prod) return `<p class="kv2-error">Production could not cost this project${state.reportError ? ': ' + esc(state.reportError) : '.'}</p>`;
    const cost = prod.costing || {};
    const pricing = prod.pricing || {};
    const breakdown = (cost.breakdown || []).map((b) => `<tr><td>${esc(b.label)}</td><td>${moneyCell(b.perUnit, cost.currency)}</td><td>${moneyCell(b.total, cost.currency)}</td></tr>`).join('');
    const batches = (prod.batches || []).map((b) => `<tr><td class="kv2-num">${cell(b.orderIndex)}</td><td class="kv2-num">${cell(b.quantity)}</td><td>${esc(b.startDate)}</td><td>${esc(b.endDate)}</td><td class="kv2-num">${cell(b.hours, 'h')}</td></tr>`).join('');
    return `${sectionHeading('Costing')}
      <table class="kv2-table"><thead><tr><th>Bucket</th><th>Per unit</th><th>Batch</th></tr></thead><tbody>${breakdown || '<tr><td colspan="3" class="kv2-faint">—</td></tr>'}</tbody></table>
      ${row('Unit cost', moneyCell(cost.unitCost, cost.currency))}
      ${row('Suggested price', `${moneyCell(pricing.price, cost.currency)} ${pricing.marginPct != null ? bar(pricing.marginPct, pricing.marginPct >= 40 ? 'ok' : 'warn') : ''}`)}
      ${row('Profit / unit', moneyCell(pricing.profitPerUnit, cost.currency))}
      ${row('Break-even units', cell(cost.breakEvenUnits))}
      ${sectionHeading('Batch plan')}
      <div class="kv2-actions">${'quantity'}: <input type="number" class="kv2-input" data-qty value="${esc((prod.plan && prod.plan.quantity) || 1)}" min="1"> <button type="button" class="kx-btn" data-act="replan">Re-plan</button></div>
      <div class="kv2-chips">${chip(prod.feasible ? 'feasible' : 'not feasible', prod.feasible ? 'ok' : 'warn')}${chip(cell(prod.time && prod.time.batchHours) + ' h')}${chip(cost.quantity + ' units')}</div>
      ${prod.warnings && prod.warnings.length ? `<div class="kv2-issues">${prod.warnings.map((w) => `<div class="kv2-issue kv2-issue--warn">${esc(w)}</div>`).join('')}</div>` : ''}
      <table class="kv2-table"><thead><tr><th>#</th><th>Qty</th><th>Start</th><th>End</th><th>Hours</th></tr></thead><tbody>${batches || '<tr><td colspan="5" class="kv2-faint">no schedule</td></tr>'}</tbody></table>`;
  }
};

function renderReverseResult(res) {
  if (!res || res.error) return `<p class="kv2-error">${esc((res && res.error) || 'Analysis failed.')}</p>`;
  const g = res.gauge || {};
  return `${row('Gauge', cell(g.stitchesPer10cm, ` sts / ${cell(g.rowsPer10cm)} rows /10cm`))}
    ${row('Confidence', bar(Math.round(num(res.confidence) * 100), res.confidence > 0.6 ? 'ok' : 'warn'))}
    ${row('Pattern', chip((res.pattern && res.pattern.primary) || 'unknown'))}
    ${row('Construction', chip((res.construction && res.construction.construction) || 'unknown', (res.construction && res.construction.confidence) > 0.5 ? 'ok' : ''))}
    ${res.colors && res.colors.length ? row('Palette', `<span class="kv2-swatches">${res.colors.slice(0, 6).map((c) => `<i style="background:${esc(c.hex || '#888')}" title="${esc(c.name || c.hex || '')}"></i>`).join('')}</span>`) : ''}
    ${res.warnings && res.warnings.length ? `<div class="kv2-issues">${res.warnings.map((w) => `<div class="kv2-issue kv2-issue--warn">${esc(w)}</div>`).join('')}</div>` : ''}
    ${res.reconstruction ? `<pre class="kv2-out kv2-script-out">${esc((res.reconstruction.knitScript || '').slice(0, 3000))}</pre><div class="kv2-actions"><button type="button" class="kx-btn kx-btn--primary" data-act="load-reconstruction">Load into Project</button></div>` : ''}`;
}

function safeValidate(project) {
  try { return project && project.validate ? (project.validate() || []) : []; } catch (_) { return []; }
}
function verdictTone(v) { return ({ pass: 'ok', ok: 'ok', warn: 'warn', fail: 'bad', error: 'bad' })[String(v).toLowerCase()] || ''; }
function fitVerdictTone(v) { const s = typeof v === 'string' ? v : (v && v.overall) || ''; return /good|pass|great|excellent/i.test(s) ? 'ok' : /poor|bad|tight|loose/i.test(s) ? 'warn' : ''; }

// ---------------------------------------------------------------------------
// DOM binders (event handlers that need live elements) + live counts.
// ---------------------------------------------------------------------------

const binders = {
  project(entry, controller, state) {
    const ta = entry.body.querySelector('.kv2-script');
    entry.body.querySelector('[data-act="apply"]').addEventListener('click', () => { controller.setScript(ta.value); controller.refresh(); });
    entry.body.querySelector('[data-act="reset"]').addEventListener('click', () => { controller.setScript(DEFAULT_KNITSCRIPT); controller.refresh(); });
    entry.body.querySelector('[data-act="copy"]').addEventListener('click', () => { try { navigator.clipboard && navigator.clipboard.writeText(ta.value); } catch (_) { /* denied */ } });
  },
  compiler(entry, controller) {
    entry.body.querySelectorAll('[data-out]').forEach((btn) => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-out');
      const c = controller.report && controller.report.compile;
      const out = c && c.outputs ? c.outputs[id] : null;
      const pane = entry.body.querySelector('[data-out-pane]');
      if (!pane) return;
      pane.textContent = summariseOutput(id, out);
    }));
  },
  reverse(entry, controller, state) {
    const fileEl = entry.body.querySelector('[data-reverse-file]');
    const run = entry.body.querySelector('[data-act="run-reverse"]');
    const out = entry.body.querySelector('[data-reverse-out]');
    run.addEventListener('click', () => {
      const f = fileEl.files && fileEl.files[0];
      if (!f) { out.innerHTML = '<p class="kv2-issue kv2-issue--warn">Choose an image first.</p>'; return; }
      run.disabled = true;
      out.innerHTML = '<p class="kv2-faint">Analysing…</p>';
      analyseImageFile(f, {
        refCm: num(entry.body.querySelector('[data-reverse-ref]').value),
        refPx: num(entry.body.querySelector('[data-reverse-refpx]').value)
      }).then((res) => {
        state.reverseResult = res;
        run.disabled = false;
        out.innerHTML = renderReverseResult(res);
        binders.reverse(entry, controller, state);
      }).catch((err) => {
        run.disabled = false;
        out.innerHTML = `<p class="kv2-error">${esc(err && err.message ? err.message : String(err))}</p>`;
      });
    });
    const load = entry.body.querySelector('[data-act="load-reconstruction"]');
    if (load && state.reverseResult && state.reverseResult.reconstruction) {
      load.addEventListener('click', () => {
        controller.setScript(state.reverseResult.reconstruction.knitScript);
        controller.refresh();
        controller.open('project');
      });
    }
  },
  production(entry, controller) {
    const replan = entry.body.querySelector('[data-act="replan"]');
    const qty = entry.body.querySelector('[data-qty]');
    if (replan && qty) replan.addEventListener('click', () => { controller._qty = Math.max(1, Math.round(num(qty.value))); controller.refresh(); });
  }
};

const counts = {
  project(state) { return state.report ? `${state.report.projectMeta.sections.length} sections` : ''; },
  fit(state) { return state.report && state.report.fit ? `${(state.report.fit.pieces || []).length} pieces` : ''; },
  yarn(state) { return state.report && state.report.yarn ? `${(state.report.yarn.yarns || []).length} yarns` : ''; },
  compiler(state) { return state.report && state.report.compile ? `${(state.report.compile.verification || []).length} checks` : ''; },
  production(state) { const p = state.report && state.report.production; return p && p.costing ? `${(p.batches || []).length} batches` : ''; }
};

function summariseOutput(id, out) {
  if (out == null) return `(no output for ${id})`;
  if (typeof out === 'string') return out.slice(0, 20000);
  if (id === 'chart' && out.svg) return '[chart SVG generated — ' + out.svg.length + ' bytes of vector markup]';
  if (id === 'punchcard' && out.ascii) return out.ascii;
  if (id === 'dxf' && out.dxf) return out.dxf.slice(0, 20000);
  if (id === 'gcode' && out.gcode) return out.gcode.slice(0, 20000);
  if (id === 'manufacturing') return techPackText(out);
  return JSON.stringify(out, null, 2).slice(0, 20000);
}

function techPackText(tp) {
  const lines = ['TECH PACK'];
  if (tp.pieces) lines.push('Pieces: ' + tp.pieces.map((p) => `${p.name || p.id}×${p.count || 1}`).join(', '));
  if (tp.yarn) lines.push('Yarn order: ' + (tp.yarn.lines ? tp.yarn.lines.map((y) => `${y.balls || y.ballsNeeded || '?'} × ${y.meters || '?'}m ${y.colorId || ''}`).join('; ') : JSON.stringify(tp.yarn).slice(0, 400)));
  if (tp.cost) lines.push(`Cost ${tp.cost.unitCost || '?'} → price ${tp.cost.price || tp.cost.suggestedPrice || '?'} (${tp.cost.marginPct || '?'}% margin)`);
  if (tp.time) lines.push('Time: ' + JSON.stringify(tp.time).slice(0, 200));
  if (tp.grading) lines.push('Grading: ' + (Array.isArray(tp.grading) ? tp.grading.map((g) => g.size || g.label).join(', ') : Object.keys(tp.grading).join(', ')));
  if (tp.qc) lines.push('QC checks: ' + (Array.isArray(tp.qc) ? tp.qc.length : (tp.qc.checks ? tp.qc.checks.length : '?')));
  return lines.join('\n');
}

/** Read an image File → ImageData (DOM-only, inside the panel handler) and run the Reverse Engineer. */
async function analyseImageFile(file, ref) {
  const { reverseEngineer } = await import('./index.js').then((m) => m.ReverseEngineer);
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const MAX = 900;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const w = Math.max(16, Math.round(img.width * scale));
    const h = Math.max(16, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const cmPerPixel = ref.refCm > 0 && ref.refPx > 0 ? ref.refCm / ref.refPx : undefined;
    return reverseEngineer(imageData, { cmPerPixel, buildProject: false, colorCount: 5 });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Header drag + the launcher strip.
// ---------------------------------------------------------------------------

function wireDrag(panel, bumpZ, onDragStart) {
  const handle = panel.querySelector('.kx-panel__bar');
  if (!handle) return;
  handle.style.cursor = 'grab';
  let startX = 0, startY = 0, origX = 0, origY = 0, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    onDragStart && onDragStart();
    panel.style.zIndex = String(bumpZ());
    const rect = panel.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    startX = e.clientX; startY = e.clientY; origX = rect.left; origY = rect.top;
    handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    panel.style.left = Math.max(0, origX + (e.clientX - startX)) + 'px';
    panel.style.top = Math.max(0, origY + (e.clientY - startY)) + 'px';
  });
  const stop = (e) => { if (!dragging) return; dragging = false; handle.releasePointerCapture && e.pointerId != null && handle.releasePointerCapture(e.pointerId); };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

function buildLauncher(controller) {
  ensureStyles();
  let strip = document.getElementById(LAUNCHER_ID);
  if (strip) strip.remove();
  strip = document.createElement('div');
  strip.id = LAUNCHER_ID;
  strip.setAttribute('role', 'toolbar');
  strip.setAttribute('aria-label', 'KNITCAT V2 systems');
  strip.innerHTML = V2_SYSTEM_CATALOG.map((s) => `<button type="button" class="kv2-launch" data-system="${esc(s.id)}" title="${esc(s.hint || s.label)}" aria-pressed="false"><span aria-hidden="true">${s.glyph}</span><span class="kv2-launch__label">${esc(s.label.replace(/ ·.*/, ''))}</span></button>`).join('');
  document.body.appendChild(strip);
  strip.querySelectorAll('[data-system]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-system');
      controller.toggle(id);
      syncLauncher();
    });
  });
}

function syncLauncher() {
  const strip = document.getElementById(LAUNCHER_ID);
  if (!strip) return;
  strip.querySelectorAll('[data-system]').forEach((btn) => {
    const id = btn.getAttribute('data-system');
    const open = !!document.getElementById(`kv2-${id}`) && !document.getElementById(`kv2-${id}`).hidden;
    btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    btn.classList.toggle('kv2-launch--on', open);
  });
}

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) { ensureKitStyles(); return; }
  ensureKitStyles();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = KV2_CSS;
  document.head.appendChild(style);
}

const KV2_CSS = `
.kv2-panel{font:13px/1.5 var(--font-ui,system-ui,sans-serif)}
.kv2-panel__body,.kx-panel .kv2-panel .kx-panel__body{padding:6px 12px}
#kv2-launcher{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:9500;display:flex;gap:4px;
  padding:6px;background:var(--panel-bg,#0f1830cc);backdrop-filter:blur(10px);border:1px solid var(--panel-border,#24406e);
  border-radius:14px;box-shadow:0 16px 40px -12px rgba(0,0,0,.7);flex-wrap:wrap;max-width:94vw}
.kv2-launch{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--btn-border,#2b3d5c);background:var(--btn-bg,#141d33);
  color:var(--btn-text,#dbe6ff);border-radius:10px;padding:7px 11px;font:12px var(--font-ui,system-ui,sans-serif);cursor:pointer;transition:transform .1s,background .15s,border-color .15s}
.kv2-launch:hover{transform:translateY(-1px);border-color:var(--accent-cyan,#22d3ee)}
.kv2-launch--on{background:color-mix(in srgb,var(--accent-cyan,#22d3ee) 22%,var(--btn-bg,#141d33));border-color:var(--accent-cyan,#22d3ee)}
.kv2-launch__label{white-space:nowrap}
.kv2-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 2px;border-bottom:1px dashed var(--panel-hairline,#21324f)}
.kv2-k{color:var(--panel-muted,#93a4c4)}
.kv2-v{font-weight:600;text-align:right}
.kv2-num{font-variant-numeric:tabular-nums}
.kv2-faint{color:#5f74a0;font-size:12px}
.kv2-chip{display:inline-block;background:rgba(2,6,23,.5);border:1px solid var(--panel-hairline,#21324f);border-radius:20px;padding:1px 8px;font-size:11px;color:var(--panel-text,#dbe6ff)}
.kv2-chip--ok{color:#8ff0b3;border-color:#265a3a}
.kv2-chip--warn{color:#f5d68a;border-color:#5a4a26}
.kv2-chip--bad{color:#fca5b0;border-color:#5a2630}
.kv2-chips{display:flex;flex-wrap:wrap;gap:5px;margin:5px 0}
.kv2-table{width:100%;border-collapse:collapse;margin:5px 0;font-size:12px}
.kv2-table th{text-align:left;color:var(--panel-muted,#93a4c4);font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;padding:3px 6px;border-bottom:1px solid var(--panel-hairline,#21324f)}
.kv2-table td{padding:4px 6px;border-bottom:1px solid rgba(33,50,79,.5)}
.kv2-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0}
.kv2-script{width:100%;min-height:180px;box-sizing:border-box;background:var(--bg-inset,#0a1226);color:var(--panel-text,#dbe6ff);
  border:1px solid var(--btn-border,#2b3d5c);border-radius:8px;padding:8px;font:12px/1.5 var(--font-mono,ui-monospace,monospace);resize:vertical}
.kv2-script:focus-visible{outline:none;border-color:var(--accent-cyan,#22d3ee)}
.kv2-out{max-height:260px;overflow:auto;background:var(--bg-inset,#0a1226);border:1px solid var(--panel-hairline,#21324f);border-radius:8px;
  padding:8px;font:11.5px/1.45 var(--font-mono,ui-monospace,monospace);white-space:pre-wrap;word-break:break-word}
.kv2-script-out{max-height:180px}
.kv2-error{color:#fca5b0}
.kv2-issues{display:flex;flex-direction:column;gap:3px;margin:6px 0}
.kv2-issue{font-size:11.5px;padding:3px 8px;border-radius:7px;border:1px solid var(--panel-hairline,#21324f)}
.kv2-issue--warn,.kv2-issue--info{color:#f5d68a;border-color:#5a4a26}
.kv2-issue--error{color:#fca5b0;border-color:#5a2630}
.kv2-check-fix{font-size:11px;color:var(--panel-muted,#93a4c4)}
.kv2-bar{display:inline-block;width:70px;height:7px;border-radius:5px;background:rgba(2,6,23,.5);overflow:hidden;vertical-align:middle;margin-right:6px;border:1px solid var(--panel-hairline,#21324f)}
.kv2-bar__fill{display:block;height:100%;background:var(--accent-cyan,#22d3ee)}
.kv2-bar__fill--ok{background:#34d399}.kv2-bar__fill--warn{background:#fbbf24}
.kv2-input{width:70px;background:var(--bg-inset,#0a1226);border:1px solid var(--btn-border,#2b3d5c);color:var(--panel-text);border-radius:6px;padding:3px 6px;font:inherit;font-size:12px}
.kv2-inline{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--panel-muted,#93a4c4);margin-right:8px}
.kv2-file{font-size:12px;margin:6px 0}
.kv2-swatches{display:inline-flex;gap:3px}.kv2-swatches i{width:16px;height:16px;border-radius:4px;border:1px solid #0003;display:inline-block}
@media (max-width:640px){#kv2-launcher{gap:3px;padding:5px}.kv2-launch__label{display:none}}
`;
