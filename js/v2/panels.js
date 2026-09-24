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
import { renderMarkdownLite } from '../ui/markdown-lite.js';
import { getDiagnostics } from '../core/diagnostics.js';
import { DEFAULT_KNITSCRIPT, V2_SYSTEM_CATALOG, V2_VERSION } from './_catalog.js';
import { projectFromKnitScript, runFullPipeline } from './index.js';
// The Pareto optimiser's trade-off view (spec §4.4): the compiler already computes it, this
// renders it so the knitter can choose *what to optimise for* instead of trusting a tick.
import { summariseOptimisation, normalisePriority, PRIORITY_OPTIONS } from '../compiler/optimise/summary.js';
// The explainable-derivation trail (spec §4.7): derive already records *why* every headline number
// is what it is, this renders it so the knitter can trust the count instead of taking it on faith.
import { summariseDerivations, derivationToText } from '../compiler/derive-summary.js';
// The colour-vision (CVD) preview (spec §3.5): the whole colour-blindness simulation engine exists in
// yarn/color-blindness.js but had no renderer — this shows the palette and the card as each
// deficiency sees them, so colourwork is legible to the fifth of knitters who need it to be.
import { summariseColorVision, colorVisionToText } from '../core/color-vision.js';
// The yarn-substitution read (spec §3.4): the substitution engine already ranks the closest library
// swaps for the project's yarn but no panel ever showed them — this turns "my yarn is discontinued,
// what changes?" into a ranked table plus the concrete edits (needle, yardage, size drift).
import { bestSubstitutesFor, substitutionToText } from '../yarn/substitution-view.js';
// The blending lab (spec §3.6): holding strands to reach a gauge you don't own, and a Fair Isle
// float/contrast safety read straight off the compiled card — both engines existed, both had no UI.
import { summariseHoldForGauge, holdPlanToText, summariseFairIsle, fairIsleToText } from '../yarn/blending-view.js';
// The finishing & pick-up read (spec §7): the Fit Engine computes a full finishing plan on every
// draft and pick-up.js can rank every edge's exact counts, but no panel showed them — this turns
// "how do I actually finish this?" into the ordered checklist a knitter pins above the machine.
import { summariseFinishing, finishingToText } from '../fit/finishing-view.js';
// The drape read (spec §2.5): DrapeSimulator settles the garment onto the body on every draft,
// yet the physics summary (score / average ease / per-panel heatmap / tight spots) was invisible.
import { summariseDrape, drapeToText } from '../fit/drape-view.js';
// The garment-care read (spec §3.2): the care engine returns a full wash/dry/iron/symbol regimen
// but only a flattened one-liner was shown — this surfaces the structured answer knitters need.
import { summariseCare, careToText } from '../yarn/care-view.js';
// The short-row atlas (spec §7): every wrap-and-turn is already on the fit draft's piece rows, but
// the compiler only counts them ("12 short-rows"). This shows which piece, which rows, which wedge
// shape (shoulder / back neck / bust dart / heel), and the exact worked-stitch march.
import { summariseShortRows, shortRowsToText } from '../fit/short-rows-view.js';
// The verification action list (spec §4.5): every check the compiler runs carries a specific,
// actionable `fix` string ("Buy the shortfall", "Knit that needle at row 42") that the flat
// verification table never surfaced. This turns the hidden hints back into a knitter's to-do list.
import { summariseVerification, verificationToText } from '../compiler/verify-view.js';
// The design-quote read (spec §6.10): the pipeline already computes a full quote from chart→yarn→
// time→money, but the Production panel only showed the raw costing — the fused commercial answer was
// invisible. This surfaces the derived per-colour demand, carriage time and priced customer lines.
import { summariseQuote, quoteToText } from '../production/quote-view.js';
// The QC inspection card (spec §6.7): every computePlan run scores an eleven-line checklist with
// measurement tolerances, a pass rate and a lifecycle verdict — but the Production panel never
// showed it. This turns the hidden "measurements off by 3.5 cm" into a printable inspection card.
import { summariseQC, qcToText } from '../production/qc-view.js';
import { planNarrative } from '../production/plan.js';
// Chart DNA (spec §5): the editor's structural analyses (true repeat, symmetry axes, density,
// content bounding box) were only ever shown as transient toast messages. This gives the same
// four computations a persistent home in the Compiler panel.
import { summariseChartDNA, chartDNAToText } from '../edit/pattern-intel-view.js';
// Pattern Health — the consolidated "ready to cast on?" traffic-light card.
import { summariseHealth, healthToText } from './health-view.js';
import { apcaLc } from '../core/apca.js';

/** The panel ids, in the order the in-dock switch shows them. */
export const V2_SYSTEMS = V2_SYSTEM_CATALOG.map((s) => s.id);

/** Per-app controller registry so open/close commands find the right docks. */
const CONTROLLERS = new WeakMap();

const STYLE_ID = 'kv2-style';

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
    builtAt: 0,
    // What the compiler's Pareto optimiser should weight hardest. Persisted on state (not the
    // DOM) so it survives a repaint and is the single knob the panel and the palette both drive.
    priority: 'balanced'
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
    getScript() { return state.script; },
    // Drive the optimiser's objective from anywhere (the panel's buttons, the Ctrl+K palette).
    // Re-compiles and repaints so every open dock reflects the new frontier immediately.
    setOptimisePriority(priority) { state.priority = normalisePriority(priority); refresh(); },
    getOptimisePriority() { return state.priority; },
  };
  CONTROLLERS.set(app, controller);

  // Alt+1..6 opens the corresponding V2 panel for fast keyboard navigation.
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const idx = Number(e.key) - 1;
    if (idx >= 0 && idx < V2_SYSTEM_CATALOG.length) {
      e.preventDefault();
      open(V2_SYSTEM_CATALOG[idx].id);
    }
  });

  return controller;

  // ---- core: (re)build the fused report lazily, once per edit ----
  function ensureReport(force = false) {
    if (force || !state.report || !state.builtAt) {
      try {
        const built = projectFromKnitScript(state.script, { machine: app && app.currentProfile && app.currentProfile.id });
        state.project = built.project;
        state.reportError = built.error;
        state.report = built.project ? runFullPipeline(built.project, { priority: state.priority }) : null;
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
    // Integrated system switcher: instead of a separate floating launcher strip with
    // nested sub-buttons, every dock carries the six-way switch in its own header,
    // so navigating the fused systems happens *inside* the main layout.
    built.panel.insertBefore(buildSwitch(id), built.body);
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

  /** The in-dock six-way system switch that replaced the old #kv2-launcher strip. */
  function buildSwitch(activeId) {
    const nav = document.createElement('nav');
    nav.className = 'kv2-switch';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'KNITCAT V2 systems');
    for (const sys of V2_SYSTEM_CATALOG) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kv2-switch__btn' + (sys.id === activeId ? ' is-on' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', sys.id === activeId ? 'true' : 'false');
      b.title = sys.hint || sys.label;
      b.innerHTML = `<span class="kv2-switch__glyph" aria-hidden="true">${sys.glyph}</span><span class="kv2-switch__label">${esc(String(sys.label).replace(/\s*\u00b7.*$/, ''))}</span>`;
      b.addEventListener('click', () => { if (sys.id !== activeId) { open(sys.id); } });
      nav.appendChild(b);
    }
    return nav;
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
  }
  function closeAll() {
    for (const id of Object.keys(panels)) close(id);
  }
  function refresh() {
    ensureReport(true);
    for (const id of Object.keys(panels)) if (!panels[id].panel.hidden) paint(id);
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

/**
 * The Pareto scatter: machine time (x) against yarn (y), each point a candidate ordering, dot
 * size the appearance cost, and the non-dominated frontier drawn in the accent colour. Reads the
 * already-normalised [0..1] axes from the summary, so it plots honestly whatever the compiler
 * found. Returns '' when there is nothing meaningful to plot (fewer than two points).
 */
function renderParetoScatter(axes) {
  const pts = (axes || []).filter((p) => p && Number.isFinite(p.time) && Number.isFinite(p.yarn));
  if (pts.length < 2) return '';
  const W = 176, H = 128, PAD = 16;
  const x = (n) => (PAD + n * (W - 2 * PAD)).toFixed(1);
  const y = (n) => (H - PAD - n * (H - 2 * PAD)).toFixed(1); // more yarn plotted higher
  const dots = pts.map((p) => {
    const r = (3 + Math.min(4, (num(p.appearance) || 0) * 4)).toFixed(1);
    const fill = p.onFrontier ? 'var(--accent, #22d3ee)' : 'var(--panel-faint, #64748b)';
    const op = p.onFrontier ? '0.95' : '0.45';
    return `<circle cx="${x(p.time)}" cy="${y(p.yarn)}" r="${r}" fill="${fill}" opacity="${op}"><title>${esc(p.objective || '')}</title></circle>`;
  }).join('');
  return `<div style="margin:6px 0">
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Pareto frontier: machine time versus yarn, dot size is untidiness, accent dots are the honest trade-offs">
      <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="var(--panel-hairline, #334)" />
      <line x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="var(--panel-hairline, #334)" />
      ${dots}
      <text x="${W / 2}" y="${H - 3}" text-anchor="middle" font-size="8" fill="var(--panel-muted, #93a4c4)">less time → more time</text>
      <text x="9" y="${H / 2}" font-size="8" fill="var(--panel-muted, #93a4c4)" transform="rotate(-90 9 ${H / 2})" text-anchor="middle">less yarn → more yarn</text>
    </svg></div>`;
}

/**
 * The optimiser section: choose what to optimise for, see each priority's three costs and how it
 * trades off against the balanced default, and view the frontier the compiler weighed. Takes the
 * already-computed summary (see `summariseOptimisation`) so the caller can read the chosen priority
 * for its own header too; returns '' when there is no summary, so the panel stays honest.
 */
function renderOptimise(s) {
  if (!s) return '';
  const buttons = PRIORITY_OPTIONS.map((o) => {
    const on = o.priority === s.chosenPriority;
    return `<button type="button" class="kx-btn${on ? ' kx-btn--primary' : ''}" data-priority="${o.priority}" aria-pressed="${on ? 'true' : 'false'}" title="${esc(o.hint)}">${esc(o.label)}</button>`;
  }).join('');
  const rows = s.options.map((o) => {
    const style = o.isChosen ? ' style="font-weight:700"' : '';
    const mark = o.isChosen ? ' ◂' : '';
    return `<tr${style}><td>${esc(o.label)}${mark}</td><td>${cell(o.time)}</td><td>${cell(o.yarn)}</td><td>${cell(o.appearance)}</td><td class="kv2-faint">${esc(o.blurb)}</td></tr>`;
  }).join('');
  const notes = s.changeNotes.length
    ? `<ul class="kv2-faint" style="margin:6px 0 0;padding-left:18px;font-size:11px;line-height:1.5">${s.changeNotes.slice(0, 8).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
    : '';
  return `${sectionHeading('Optimise passes', s.chosenPriority ? esc(PRIORITY_OPTIONS.find((o) => o.priority === s.chosenPriority)?.label || '') : '')}
    <div class="kv2-actions">${buttons}</div>
    <table class="kv2-table"><thead><tr><th>Optimise for</th><th>Time</th><th>Yarn</th><th>Joins</th><th>vs balanced</th></tr></thead><tbody>${rows}</tbody></table>
    ${renderParetoScatter(s.axes)}
    <p class="kv2-faint" style="font-size:11px;margin:2px 0 0">Accent dots sit on the frontier — genuinely better on one cost only by being worse on another.</p>
    ${notes}`;
}

/**
 * The derivation section: the compiler's own "why this number" trail (spec §4.7), turned into a
 * readable list. Each headline number shows the resolved value, the rule it came from, the
 * arithmetic with the real inputs substituted in, and what it feeds downstream — so a knitter can
 * see "cast on 212 = round(96 × 2.2) → round to a multiple of 4" instead of wondering. Takes the
 * already-computed summary (see `summariseDerivations`); returns '' when there is none, so the
 * panel stays honest rather than showing an empty section. Nothing is re-derived — every figure is
 * the one the compiler recorded, so this view can never disagree with the emitted pattern.
 */
function renderDerivations(d) {
  if (!d) return '';
  const items = d.rows.map((r) => {
    const inputs = r.inputs && r.inputs.length
      ? `<div class="kv2-faint" style="font-size:11px">from ${r.inputs.map((i) => `${esc(i.label)} ${cell(i.value)}`).join(', ')}</div>`
      : '';
    const affects = r.affects && r.affects.length
      ? `<div class="kv2-faint" style="font-size:11px">feeds ${esc(r.affects.join(', '))}</div>`
      : '';
    return `<li style="margin:0 0 8px">
      <div><strong>${esc(r.label)}</strong> ${cell(r.value)}</div>
      ${r.formula ? `<div class="kv2-faint" style="font-size:11px">${esc(r.formula)}</div>` : ''}
      ${r.substitute ? `<div class="kv2-num" style="font-size:11px">= ${esc(r.substitute)}</div>` : ''}
      ${inputs}${affects}</li>`;
  }).join('');
  return `${sectionHeading('Why these numbers', 'how the compiler got them')}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-derive>Copy derivation</button></div>
    <ul class="kv2-derive" style="margin:6px 0 0;padding-left:18px;line-height:1.5">${items}</ul>`;
}

/** A fixed-size colour chip; the hex is validated upstream so it is safe to inline. */
function cvSwatch(hex, title) {
  return `<span style="display:inline-block;width:15px;height:15px;border-radius:3px;border:1px solid rgba(127,127,127,.4);background:${hex};vertical-align:middle" title="${esc(title || hex)}"></span>`;
}

/**
 * Redraw the colour card as one deficiency sees it: the compiler's index grid (`ir.cardMatrix`) with
 * every cell filled from that type's simulated palette. A handful of rects and no canvas, so it stays
 * a string and matches the real card exactly (values are already bounded to the palette). Returns ''
 * when there is no colour grid to recolour (e.g. a pure text/derived project).
 */
function cvCardSvg(matrix, simColors) {
  if (!Array.isArray(matrix) || !matrix.length) return '';
  const rows = matrix.length;
  let cols = 0;
  for (const row of matrix) if (Array.isArray(row) && row.length > cols) cols = row.length;
  if (!cols) return '';
  const cell = Math.max(2, Math.min(8, Math.floor(160 / Math.max(rows, cols))));
  const w = cols * cell, h = rows * cell;
  const rects = [];
  for (let r = 0; r < rows; r++) {
    const row = Array.isArray(matrix[r]) ? matrix[r] : [];
    for (let c = 0; c < cols; c++) {
      const idx = Number(row[c]);
      const fill = (Number.isFinite(idx) && simColors[idx]) ? simColors[idx].simulated : '#000';
      rects.push(`<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${fill}"/>`);
    }
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="The card recoloured for this vision type" style="margin-top:4px;border:1px solid var(--panel-hairline,#334)">${rects.join('')}</svg>`;
}

/**
 * Derive a pattern difficulty label from the compiler metrics.
 * Beginner (few techniques) → Advanced (many colours + shaping + short-rows).
 */
function renderDifficulty(m) {
  if (!m) return '';
  const score = (m.decreases || 0) + (m.increases || 0) + (m.shortRows || 0) * 2 + (m.yarnChanges || 0) * 0.5;
  const label = score > 80 ? 'Expert' : score > 40 ? 'Advanced' : score > 15 ? 'Intermediate' : 'Beginner';
  const tone = score > 80 ? 'bad' : score > 40 ? 'warn' : 'ok';
  return chip('★ ' + label, tone);
}

/**
 * Colour-pair contrast strip — shows each pattern colour next to every other, annotated with
 * the APCA Lightness Contrast (LC) value. Pairs below LC 60 are flagged as “hard to distinguish”.
 * Gives the knitter an instant “can I tell these two yarns apart at the machine?” read.
 */
function renderColorContrastStrip(colors) {
  if (!colors || colors.length < 2) return '';
  const hexes = colors.map(c => (typeof c === 'string' ? c : (c.hex || c.color || null))).filter(Boolean).slice(0, 6);
  if (hexes.length < 2) return '';
  const dots = hexes.map(h => `<i style="display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid #0003;background:${esc(h)};vertical-align:middle;margin-right:2px"></i>`).join(' ');
  const pairs = [];
  for (let i = 0; i < hexes.length; i++) {
    for (let j = i + 1; j < hexes.length; j++) {
      const lc = Math.abs(apcaLc(hexes[i], hexes[j]));
      const tone = lc >= 75 ? 'ok' : lc >= 60 ? '' : 'warn';
      pairs.push(chip(`${lc.toFixed(0)}`, tone) + ` `);
    }
  }
  // Build a compact inline display: swatches + pairwise LC values
  return `<div style="margin:4px 0 6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
    <span class="kv2-faint" style="font-size:10px;text-transform:uppercase;letter-spacing:.5px">Contrast (LC)</span>
    ${dots}
    <span style="font-size:11px">${pairs.join('')}</span></div>`;
}

/**
 * The colour-blindness section: for each simulated deficiency, every yarn shown original → as-seen,
 * the exact pairs that collapse into one another, and a recoloured preview of the card itself — the
 * "here is your chart as a deuteranope sees it" the engine always promised but never showed. Takes the
 * already-computed view (see `summariseColorVision`); returns '' when there is no palette, so the panel
 * stays honest. All hexes are validated in the summary module, so inlining them here is safe.
 */
function renderColorVision(cv, matrix) {
  if (!cv) return '';
  const tone = cv.safe ? 'ok' : (cv.commonCollapseCount ? 'warn' : 'info');
  const refRow = `<div style="margin:4px 0"><span class="kv2-faint" style="font-size:11px">Your yarns: </span>${cv.palette.map((p) => cvSwatch(p.hex, p.yarn || p.hex)).join(' ')}</div>`;
  const blocks = cv.types.map((t) => {
    const chips = t.colors.map((c, i) => {
      const name = c.yarn || cv.palette[i]?.hex || `Colour ${c.index}`;
      return `<span style="margin-right:6px;white-space:nowrap">${cvSwatch(c.original, `${name} (real)`)}→${cvSwatch(c.simulated, `${name} (as seen)`)}</span>`;
    }).join('');
    const collapses = t.collapseCount
      ? `<div class="kv2-issue kv2-issue--warn" style="font-size:11px">${esc(t.collapsed.map((p) => p.label).join(' · '))} read as one colour</div>`
      : `<div class="kv2-faint" style="font-size:11px">all distinct</div>`;
    return `<div style="margin:8px 0 0">
      <div><strong>${esc(t.label)}</strong>${t.collapseCount ? ' ' + chip(t.collapseCount + ' collapse' + (t.collapseCount > 1 ? 's' : ''), 'warn') : ''}</div>
      <div style="margin:2px 0">${chips}</div>
      ${collapses}
      ${cvCardSvg(matrix, t.colors)}</div>`;
  }).join('');
  return `${sectionHeading('Colour blindness', chip(cv.headline, tone))}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-cvd>Copy colour report</button></div>
    <p class="kv2-faint" style="font-size:11px;margin:2px 0 0">Each row redraws the real palette (left) and your card as that vision sees it (right). About 1 in 12 men and 1 in 200 women see colour this way.</p>
    ${refRow}${blocks}`;
}

/** Compact a substitution adjustment endpoint (numbers, or a needle `{min,max}`/`{mm}` pair). */
function subEndpoint(v) {
  if (v == null) return '—';
  if (typeof v === 'object') return v.mm != null ? `${v.mm}mm` : (v.min != null ? `${v.min}–${v.max}mm` : esc(JSON.stringify(v)));
  return esc(String(v));
}

/**
 * The substitution section: the closest swaps for the project's yarn, ranked by the substitution
 * engine (see `summariseSubstitution`), with the concrete edits for the best one. Takes the already
 * computed summary; returns '' when there is none (no yarn with a gauge, or an empty library), so the
 * panel hides it rather than showing an empty table. Nothing is re-derived — every figure is the one
 * the engine produced, so this view can never disagree with the pattern it came from.
 */
function renderSubstitutes(s) {
  if (!s) return '';
  const rows = s.picks.map((p) => {
    const fibre = [p.fiberAdded.length ? '+' + p.fiberAdded.join('/') : '', p.fiberRemoved.length ? '−' + p.fiberRemoved.join('/') : ''].filter(Boolean).join(' ');
    return `<tr><td>${esc(p.brand)} ${esc(p.name)}</td><td>${chip(p.recommendation, p.tone)}</td><td class="kv2-num">${cell(p.gaugeStitches, ' sts')}</td><td class="kv2-num">${cell(p.yardagePercent, '%')}</td><td class="kv2-faint">${esc(fibre || '—')}</td></tr>`;
  }).join('');
  const best = s.best;
  const adjust = best.adjustments.length
    ? `<ul class="kv2-derive" style="margin:6px 0 0;padding-left:18px;line-height:1.5">${best.adjustments.map((a) => `<li><strong>${esc(a.kind)}</strong> ${subEndpoint(a.from)} → ${subEndpoint(a.to)} <span class="kv2-faint" style="font-size:11px">${esc(a.note)}</span></li>`).join('')}</ul>`
    : '';
  const warns = best.warnings.length
    ? `<div class="kv2-issues" style="margin-top:4px">${best.warnings.map((w) => `<div class="kv2-issue kv2-issue--warn">${esc(w)}</div>`).join('')}</div>`
    : '';
  return `${sectionHeading('Swap this yarn', 'what changes if you substitute')}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-sub>Copy substitution report</button></div>
    <p class="kv2-faint" style="font-size:11px;margin:2px 0 0">Closest library swaps for ${esc(s.original.brand)} ${esc(s.original.name)}, ranked by gauge, yardage, fibre and colour.</p>
    <table class="kv2-table"><thead><tr><th>Substitute</th><th>Grade</th><th>Gauge Δ</th><th>Yardage</th><th>Fibre</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="margin-top:6px"><strong>Best swap — ${esc(best.brand)} ${esc(best.name)}</strong>${adjust}${warns}</div>`;
}

/**
 * The hold-to-gauge section: the closest single yarn or held strand-combination that reaches the
 * pattern's target gauge, ranked by how far off it lands (see `summariseHoldForGauge`). Takes the
 * already-computed summary; returns '' when there is no target gauge or no library to search.
 */
function renderHold(h) {
  if (!h) return '';
  const rows = h.picks.map((p, i) => {
    const fit = p.within ? chip('on target', 'ok') : chip(p.error + ' off', 'warn');
    return `<tr${i === 0 ? ' style="font-weight:700"' : ''}><td>${esc(p.names.join(' + '))}${i === 0 ? ' ◂' : ''}</td><td class="kv2-num">${cell(p.count)}</td><td class="kv2-num">${cell(p.predicted)}</td><td>${fit}</td></tr>`;
  }).join('');
  const marle = h.best.marledColor ? `${cvSwatch(h.best.marledColor, 'Marled colour')} ` : '';
  const notes = h.best.notes.length
    ? `<ul class="kv2-faint" style="margin:4px 0 0;padding-left:18px;font-size:11px;line-height:1.5">${h.best.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '';
  return `${sectionHeading('Hold to hit gauge', "fake a gauge you don't own")}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-hold>Copy hold plan</button></div>
    <p class="kv2-faint" style="font-size:11px;margin:2px 0 0">Target ${cell(h.target, ' sts/10cm')}. Holding strands combines their bulk — these are the closest ${h.count} plans in the library.</p>
    <table class="kv2-table"><thead><tr><th>Combine</th><th>Strands</th><th>Predicted</th><th>Fits</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="margin-top:6px">${marle}<strong>${esc(h.best.names.join(' + '))}</strong>${h.best.combinedRows != null ? ` <span class="kv2-faint">≈ ${cell(h.best.combinedRows)} rows/10cm</span>` : ''}${notes}</div>`;
}

/**
 * The Fair Isle safety section: long-float (snag) warnings with the rows to tuck, and low-contrast
 * motif pairs, read off the compiler's own palette and card grid (see `summariseFairIsle`). Takes the
 * already-computed summary; returns '' when there is no colourwork card to test. Palette hexes are
 * normalised upstream, so inlining them via cvSwatch is safe.
 */
function renderFairIsle(fi) {
  if (!fi) return '';
  const tone = fi.safe ? 'ok' : 'warn';
  const floats = `<ul class="kv2-faint" style="margin:4px 0;padding-left:18px;font-size:11px;line-height:1.5">${fi.floats.map((f) => `<li>row ${cell(f.row)}, col ${cell(f.col)}: <span class="kv2-num">${cell(f.length)}</span>-st float</li>`).join('')}</ul>`;
  const tuck = fi.tuckRows.length ? `<div class="kv2-faint" style="font-size:11px">Suggest tuck on row(s): <span class="kv2-num">${esc(fi.tuckRows.join(', '))}</span></div>` : '';
  const contrast = `<ul style="margin:4px 0;padding-left:18px;font-size:11px;line-height:1.5">${fi.contrast.map((c) => `<li>${cvSwatch(c.a, c.a)} vs ${cvSwatch(c.b, c.b)} <span class="kv2-faint">${esc(c.note)}</span></li>`).join('')}</ul>`;
  return `${sectionHeading('Fair Isle check', 'floats & contrast on the machine')}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-fi>Copy Fair Isle report</button></div>
    ${row('Verdict', chip(fi.headline, tone))}
    ${fi.safe ? '<p class="kv2-faint" style="font-size:11px;margin:2px 0 0">Every float is short enough to catch and every motif pair reads.</p>' : ''}
    ${fi.floats.length ? `<div style="margin-top:4px"><strong>Long floats</strong> <span class="kv2-faint">(snag risk — tuck or weave)</span>${floats}${tuck}</div>` : ''}
    ${fi.contrast.length ? `<div style="margin-top:4px"><strong>Low contrast</strong> <span class="kv2-faint">(may not read)</span>${contrast}</div>` : ''}`;
}

/**
 * The finishing & pick-up section: the ordered bands (hem/cuffs/neckband/…) with their
 * row-by-row instructions, the exact pick-up counts for seamed edges, and the seaming order —
 * all read from the draft the Fit Engine already made (see `summariseFinishing`). Takes the
 * already-computed summary; returns '' when the draft carries nothing to finish.
 */
function renderFinishing(f) {
  if (!f) return '';
  const items = f.items
    .map((it) => {
      const meta = [it.stitches != null ? chip(cell(it.stitches) + ' sts', '') : '', it.rows != null ? `<span class="kv2-faint">${cell(it.rows)} rows</span>` : '', it.style ? `<span class="kv2-faint">${esc(humanise(it.style))}</span>` : ''].filter(Boolean).join(' ');
      const steps = it.instructions.length
        ? `<ul class="kv2-derive" style="margin:3px 0 0;padding-left:18px;line-height:1.5">${it.instructions.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
        : '';
      return `<div style="margin-top:6px"><strong>${esc(it.label)}</strong> <span style="font-size:11px">${meta}</span>${steps}</div>`;
    })
    .join('');
  const pickUp = f.pickUp.length
    ? `<div style="margin-top:8px"><strong>Pick-up counts</strong> <span class="kv2-faint" style="font-size:11px">(sts to pick up per edge)</span><ul class="kv2-faint" style="margin:3px 0;padding-left:18px;font-size:11px;line-height:1.5">${f.pickUp.map((p) => `<li>${esc(p.note || p.edge + ': ' + p.count + ' sts')}</li>`).join('')}</ul></div>`
    : '';
  const seaming = f.seaming.length
    ? `<div style="margin-top:8px"><strong>Seaming &amp; blocking</strong><ol class="kv2-faint" style="margin:3px 0;padding-left:20px;font-size:11px;line-height:1.5">${f.seaming.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`
    : '';
  return `${sectionHeading('Finishing & pick-up', 'the steps that make it look made, not knitted')}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-fin>Copy finishing checklist</button></div>
    ${row('Plan', chip(f.headline, ''))}
    ${items}${pickUp}${seaming}`;
}

/** Title Case a short internal word for display (mirrors finishing-view's label). */
function humanise(s) {
  return String(s || '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The drape section: how the fabric will actually hang on the body — a verdict chip, average
 * ease, the per-panel heatmap and the tight spots the cloth solver flagged (see
 * `summariseDrape`). Takes the already-computed summary; returns '' when there is no draft
 * to describe. Reuses the same kv2-table / kv2-chip vocabulary as the rest of the dock.
 */
function renderDrape(dr) {
  if (!dr) return '';
  const rows = dr.panels.map((p) => {
    const tight = p.min != null && p.min < -0.05;
    return `<tr><td>${esc(p.id)}</td><td class="kv2-num">${cell(p.rows)}</td><td class="kv2-num">${cell(p.mean, ' cm')}</td><td class="kv2-num">${cell(p.min, ' cm')}</td><td class="kv2-num">${cell(p.max, ' cm')}</td><td>${tight ? chip('grips', 'warn') : '<span class="kv2-faint">—</span>'}</td></tr>`;
  }).join('');
  const tight = dr.tightSpots.length
    ? `<div style="margin-top:6px"><strong>Where it pinches</strong> <span class="kv2-faint" style="font-size:11px">(negative ease — size up here)</span><ul class="kv2-faint" style="margin:3px 0;padding-left:18px;font-size:11px;line-height:1.5">${dr.tightSpots.map((t) => `<li>${esc(t.panel)} row ${cell(t.row)} · <span class="kv2-num">${cell(t.easeCm, ' cm')}</span></li>`).join('')}</ul></div>`
    : '';
  return `${sectionHeading('Drape simulation', 'how this fabric will hang')}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-drape>Copy drape report</button></div>
    ${row('Verdict', chip(`${dr.verdict} · ${dr.score != null ? dr.score.toFixed(2) : 'n/a'}`, dr.tone))}
    ${row('Average ease', cell(dr.averageEase, ' cm'))}
    ${row('Tight spots', dr.tightSpotCount ? chip(dr.tightSpotCount + ' flagged', 'warn') : chip('none', 'ok'))}
    ${dr.panels.length ? `<table class="kv2-table"><thead><tr><th>Panel</th><th>Rows</th><th>Mean</th><th>Min</th><th>Max</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    ${tight}`;
}

/**
 * The garment-care section: the full wash/dry/iron/bleach regimen from the care engine, with
 * ISO symbols and a plain-English headline. Replaces the single flat "Care" row that previously
 * summarized this into a terse string. Returns '' when no fiber composition is available.
 */
function renderCare(c) {
  if (!c) return '';
  const symRow = c.symbols.length ? `<div style="margin-top:4px" class="kv2-faint" title="ISO 3758 care codes"><span style="font-size:13px;letter-spacing:2px">${c.symbols.map((s) => esc(s)).join('  ')}</span></div>` : '';
  return `${sectionHeading('Garment care', 'wash · dry · iron — generated from the fibre')}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-care>Copy care card</button></div>
    ${row('Wash', chip(`${c.wash} (${c.washTempC}°C)`, c.tone))}
    ${row('Dry', `${esc(c.dry)}${c.tumble ? ' · tumble low' : ' · no tumble'}`)}
    ${row('Iron', esc(c.iron === 'none' ? 'do not iron' : c.iron))}
    ${row('Bleach', c.bleach ? chip('okay', 'ok') : chip('do not bleach', 'warn'))}
    ${c.dryClean ? row('Dry clean', chip('okay', 'info')) : ''}
    ${symRow}`;
}

/**
 * Pattern Health traffic-light card — a consolidated "ready to cast on?" verdict aggregated from
 * model validation, verification checks, machine fit, yarn sufficiency, production feasibility,
 * and QC status. Rendered at the top of the Project panel so the knitter sees readiness BEFORE
 * diving into six individual panels.
 */
function renderHealthCard(h) {
  if (!h || !h.checks || !h.checks.length) return '';
  const statusIcon = { pass: '\u{1F7E2}', warn: '\u{1F7E1}', fail: '\u{1F534}', na: '\u26AA' };
  const PANEL_FOR = { model: 'project', verify: 'compiler', machine: 'compiler', yarn: 'yarn', feasible: 'production', qc: 'production', gauge: 'fit' };
  const rows = h.checks.map((c) =>
    `<tr data-health-open="${esc(PANEL_FOR[c.id] || '')}" style="cursor:pointer"><td style="font-size:14px">${statusIcon[c.status] || '?'}</td><td>${esc(c.label)}</td><td class="kv2-faint" style="font-size:11px">${esc(c.detail)}</td></tr>`
  ).join('');
  return `<div style="margin-bottom:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--panel-hairline,#21324f);background:var(--bg-inset,#0a1226)">
    <div class="kv2-actions"><span class="kv2-chip kv2-chip--${h.tone}">${h.ready ? '✅' : h.level === 1 ? '⚠️' : '🛑'} ${esc(h.headline)}</span><button type="button" class="kx-btn kx-btn--ghost" data-copy-health style="margin-left:auto">Copy</button></div>
    <table class="kv2-table" style="margin-top:6px"><tbody>${rows}</tbody></table>${h.nextAction ? `<div style="margin-top:6px;font-size:11px;font-weight:600;color:var(--accent)">→ ${esc(h.nextAction)}</div>` : ''}</div>`;
}

/**
 * Machine-profile identity line above the pipeline chips. The compiler already targets a specific
 * physical machine (bed width, gauge, supported operations), but the V2 panel never surfaced *which*
 * machine — knitters switching between a Bond and a Brother need instant confirmation.
 */
function renderMachineChip(mach) {
  if (!mach) return '';
  const p = mach.profile || null;
  const name = p && p.name ? p.name : mach.id || 'standard';
  const gauge = mach.gaugeMm || (p && p.pitchX) || 0;
  const bed = mach.bedStitches || (p && p.bedLengthMm && p.pitchX ? Math.floor(p.bedLengthMm / p.pitchX) : 0);
  const colours = p && p.maxColors ? p.maxColors : 0;
  const float = p && p.maxFloatNeedles ? p.maxFloatNeedles : 0;
  const beds = p && p.beds ? p.beds : 1;
  const bits = [gauge ? `${gauge} mm` : '', bed ? `${bed} needles` : '', colours ? `${colours} col max` : '', float ? `float ≤${float}` : '', beds > 1 ? `${beds} beds` : ''].filter(Boolean);
  return `<div style="margin-bottom:4px"><span class="kv2-chip kv2-chip--info" title="Target machine">🏭 ${esc(name)}</span>${bits.length ? ` <span class="kv2-faint" style="font-size:10px">${bits.join(' · ')}</span>` : ''}</div>`;
}

/**
 * Piece assembly map — a compact visual showing seams, joins, and pick-up relationships
 * between garment pieces. Tells the knitter "what attaches to what" without reading the
 * full finishing view.
 */
function renderAssemblyMap(pieces) {
  if (!pieces || !pieces.length) return '';
  const lines = [];
  for (const p of pieces) {
    const pid = p.id || p.name || 'piece';
    if (p.seams && p.seams.length) {
      for (const s of p.seams) {
        const target = typeof s === 'string' ? s : (s.with || s.edge || '');
        const edge = typeof s === 'object' && s.edge ? ` (${s.edge})` : '';
        lines.push(`${pid} → ${target}${edge}`);
      }
    }
    if (p.join) {
      const targets = Array.isArray(p.join) ? p.join.join(' + ') : String(p.join);
      lines.push(`${pid} joins: ${targets}`);
    }
    if (p.pickUp) {
      const pu = typeof p.pickUp === 'object' ? p.pickUp : {};
      const info = [pu.from, pu.edge, pu.count ? `${pu.count} sts` : ''].filter(Boolean).join(' / ');
      lines.push(`${pid} pick-up: ${info}`);
    }
  }
  if (!lines.length) return '';
  return `<div style="margin-top:6px"><span class="kv2-faint" style="font-size:10px;text-transform:uppercase;letter-spacing:.5px">Assembly map</span>
    <ul style="margin:4px 0 0;padding-left:16px;font-size:11px;line-height:1.6">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
}

/**
 * Shaping events table — the key moments where stitches change (increase, decrease, bind-off,
 * join, short-row). Each piece's rowsDetail[] carries per-row ShapingRow objects; we filter to
 * only non-knit actions so the knitter can scan "where does the shaping happen?" at a glance.
 */
function renderShapingEvents(pieces) {
  if (!pieces || !pieces.length) return '';
  const rows = [];
  for (const p of pieces) {
    const pid = p.id || p.name || '';
    const detail = p.rowsDetail || p.rows || [];
    // `rows` on a finished piece is a number; only arrays with action fields are useful.
    if (!Array.isArray(detail)) continue;
    for (const r of detail) {
      if (!r || r.action === 'knit' || !r.action) continue;
      rows.push({ piece: pid, row: r.row, action: r.action, count: r.count, position: r.position, notes: r.notes || '' });
    }
  }
  if (!rows.length) return '';
  // Cap display to the first 30 events (long garments can have many)
  const shown = rows.slice(0, 30);
  const body = shown.map((ev) =>
    `<tr><td>${esc(ev.piece)}</td><td class="kv2-num">${ev.row || '—'}</td><td>${esc(ev.action)}</td><td class="kv2-num">${ev.count || ''}</td><td>${esc(ev.position || '')}</td></tr>`
  ).join('');
  const more = rows.length > 30 ? `<p class="kv2-faint" style="font-size:10px">+${rows.length - 30} more events (see written pattern)</p>` : '';
  return `<div style="margin-top:6px"><span class="kv2-faint" style="font-size:10px;text-transform:uppercase;letter-spacing:.5px">Shaping events</span>
    <table class="kv2-table" style="margin-top:3px"><thead><tr><th>Piece</th><th>Row</th><th>Action</th><th>Sts</th><th>Position</th></tr></thead><tbody>${body}</tbody></table>${more}</div>`;
}

/**
 * Ease check section — maps the fit report's `sections` array (from `computeFitReport`). Previously
 * the panel looked for a non-existent `.points` field, so this whole section never rendered. Each
 * section has `{point, body, actual, ease, ideal, status, verdict}`. Also surfaces the overall
 * `grade` (letter) and `warnings` from the report.
 */
function renderEaseCheck(report) {
  if (!report || !Array.isArray(report.sections) || !report.sections.length) return '';
  const grade = report.grade ? chip(report.grade, /A|B/i.test(report.grade) ? 'ok' : 'warn') : '';
  const rows = report.sections.slice(0, 8).map((pt) =>
    `<tr><td>${esc(pt.point || '—')}</td><td class="kv2-num">${cell(pt.body, 'cm')}</td><td class="kv2-num">${cell(pt.actual, 'cm')}</td><td class="kv2-num">${cell(pt.ease, 'cm')}</td><td>${pt.status ? chip(pt.status, pt.status === 'good' ? 'ok' : 'warn') : ''}</td></tr>`
  ).join('');
  const warns = (report.warnings || []).length ? `<div class="kv2-issues">${report.warnings.map((w) => `<div class="kv2-issue kv2-issue--warn">${esc(w)}</div>`).join('')}</div>` : '';
  return `${sectionHeading('Ease check', grade ? 'grade ' + report.grade : '')}
    <table class="kv2-table"><thead><tr><th>Zone</th><th>Body</th><th>Garment</th><th>Ease</th><th>Fit</th></tr></thead><tbody>${rows}</tbody></table>
    ${warns}`;
}

/**
 * Body measurements & ease inputs — the raw numbers the entire draft depends on. Currently invisible:
 * the panel shows pieces and gauge but never “whose body is this?” — the first question every
 * knitter asks. Display as a compact inline row with the key 6 measurements + ease chips.
 */
function renderBodyEase(fit) {
  if (!fit || !fit.body) return '';
  const b = fit.body;
  const e = fit.ease || {};
  const measures = [
    ['Bust', b.bust, e.chest != null ? e.chest : e.bust],
    ['Waist', b.waist, e.waist],
    ['Hip', b.hip, e.hip],
    ['Arm', b.upperArm, e.arm],
    ['Shoulder', b.shoulderWidth, null],
    ['Sleeve', b.sleeveLength, null],
  ];
  const cells = measures.filter(([, val]) => val != null && val > 0).map(([label, val, ease]) =>
    `<span class="kv2-inline">${label} <span class="kv2-num">${val}</span> cm${ease != null ? ` <span class="kv2-chip">+${ease}</span>` : ''}</span>`
  ).join('');
  return cells ? `<div style="margin:4px 0 2px"><span class="kv2-faint" style="font-size:10px;text-transform:uppercase;letter-spacing:.5px">Body & ease</span><div style="display:flex;flex-wrap:wrap;gap:2px 8px">${cells}</div></div>` : '';
}

/**
 * Batch yarn-requirement table. `computeYarnNeeds` produces per-yarn per-colour gram totals
 * for the whole batch — critical for knowing how much to buy before starting a run.
 */
function renderYarnNeeds(needs) {
  if (!needs || !needs.length) return '';
  const rows = needs.map((y) =>
    `<tr><td>${esc(y.name || y.yarnId)}/${esc(y.colorId || '—')}</td><td class="kv2-num">${y.gramsTotal ? Math.round(y.gramsTotal) : '?'}g</td><td class="kv2-num">${y.ballsTotal || '?'}</td><td class="kv2-num">${y.available != null ? Math.round(y.available) + 'g' : '—'}</td></tr>`
  ).join('');
  return `<div style="margin-top:6px"><span class="kv2-faint" style="font-size:10px;text-transform:uppercase;letter-spacing:.5px">Batch yarn needed</span>
    <table class="kv2-table" style="margin-top:3px"><thead><tr><th>Yarn/Colour</th><th>Grams</th><th>Balls</th><th>Have</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/**
 * Time-operation breakdown under the batch-plan table. `estimateHours()` returns a rich
 * `operations[]` array (set-up / knitting / seaming / blocking / weaving / QC / packing) but the
 * panel only surfaced a single "X h" chip. Expanding it into a mini-table shows *where* the hours
 * go before committing to a production run.
 */
function renderTimeOps(time) {
  if (!time || !time.operations || !time.operations.length) return '';
  const rows = time.operations.map((op) =>
    `<tr><td>${esc(op.label)}</td><td class="kv2-num">${op.hoursPerUnit.toFixed(2)} h</td><td class="kv2-num">${op.hoursTotal.toFixed(2)} h</td></tr>`
  ).join('');
  return `<div style="margin-top:6px"><span class="kv2-faint" style="font-size:10px;text-transform:uppercase;letter-spacing:.5px">Time per operation</span>
    <table class="kv2-table" style="margin-top:3px"><thead><tr><th>Step</th><th>Per unit</th><th>Batch</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/**
 * The design-quote section: the derived chart → yarn → time → money answer the pipeline already
 * computes on every draft (see `summariseQuote`). The Production panel previously showed only the
 * raw costing engine output; this surfaces the fused commercial answer that ties the creative chart
 * and the priced quote to a single source of truth. Reuses the same kv2-table / chip vocabulary
 * as every other dock section.
 */
function renderQuote(q) {
  if (!q) return '';
  const fp = q.footprint.width || q.footprint.height
    ? row('Finished size', `${cell(q.footprint.width)} × ${cell(q.footprint.height)} cm`)
    : '';
  const yarnRows = q.yarnNeeds.map((n) => {
    const sw = n.hex ? cvSwatch(n.hex, n.colorway || n.name) + ' ' : '';
    const cw = n.colorway ? ` <span class="kv2-faint">${esc(n.colorway)}</span>` : '';
    const share = n.sharePct != null ? `${n.sharePct}%` : '—';
    return `<tr><td>${sw}${esc(n.name)}${cw}</td><td class="kv2-num">${cell(n.balls)}</td><td class="kv2-num">${cell(n.meters, 'm')}</td><td class="kv2-num">${cell(n.grams, 'g')}</td><td class="kv2-num">${share}</td><td>${moneyCell(n.cost, q.currency)}</td></tr>`;
  }).join('');
  const priceRows = q.lines.map((l) => `<tr><td>${esc(l.label)}${l.detail ? ` <span class="kv2-faint" style="font-size:11px">${esc(l.detail)}</span>` : ''}</td><td class="kv2-num">${moneyCell(l.amount, q.currency)}</td></tr>`).join('');
  const warns = q.warnings.length
    ? `<div class="kv2-issues" style="margin-top:6px">${q.warnings.map((w) => `<div class="kv2-issue kv2-issue--warn">${esc(w)}</div>`).join('')}</div>`
    : '';
  const yarnBlock = q.yarnNeeds.length
    ? `<div style="margin-top:6px"><strong>Yarn demand</strong> <span class="kv2-faint" style="font-size:11px">(per colourway, wastage included)</span><table class="kv2-table"><thead><tr><th>Colour</th><th>Balls</th><th>Metres</th><th>Grams</th><th>Share</th><th>Cost</th></tr></thead><tbody>${yarnRows}</tbody></table>${row('Yarn subtotal', `${cell(q.yarnTotals.meters, 'm')} · ${cell(q.yarnTotals.grams, 'g')} · ${moneyCell(q.yarnTotals.cost, q.currency)}`)}</div>`
    : '';
  const linesBlock = q.lines.length
    ? `<div style="margin-top:6px"><strong>Priced lines</strong><table class="kv2-table"><thead><tr><th>Line</th><th>Amount</th></tr></thead><tbody>${priceRows}</tbody></table></div>`
    : '';
  const chartBlock = q.chart.cells
    ? row('Chart', `${cell(q.chart.rows)}×${cell(q.chart.cols)} · <span class="kv2-faint">${cell(q.chart.opennessPct, '% open')}</span>`)
    : '';
  return `${sectionHeading('Design quote', 'chart → yarn → time → money, one source')}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-quote>Copy quote sheet</button></div>
    ${row('Verdict', chip(q.headline, q.tone))}
    ${row('SKU · mode', `${esc(q.sku || '—')} <span class="kv2-faint">· ${esc(q.mode)}</span>`)}
    ${fp}
    ${row('Stitches', cell(q.stitches))}
    ${chartBlock}
    ${yarnBlock}
    ${row('Carriage', `${cell(q.machine.passes)} passes/piece · ${cell(q.machine.minutesPer, 'min')} · <span class="kv2-faint">${q.machine.modelled ? 'modelled' : 'assumed'}</span>`)}
    ${row('Batch time', cell(q.time.batchHours, ' h'))}
    ${linesBlock}
    ${row('Unit cost', moneyCell(q.price.unitCost, q.currency))}
    ${row('Retail', `${moneyCell(q.price.retail, q.currency)} ${q.price.marginPct != null ? bar(q.price.marginPct, q.price.marginPct >= 40 ? 'ok' : 'warn') : ''}`)}
    ${row('Wholesale', moneyCell(q.price.wholesale, q.currency))}
    ${row('Batch total', moneyCell(q.price.retail * q.quantity, q.currency))}
    ${warns}`;
}

/**
 * The short-row atlas section: every wrap-and-turn wedge the Fit Engine drafted, grouped by piece
 * and shape (shoulder / back neck / bust dart / heel). See `summariseShortRows`. Takes the
 * already-computed summary; returns '' when the draft has no short rows so the panel hides the
 * section rather than showing an empty table.
 */
function renderShortRows(sr) {
  if (!sr) return '';
  const body = sr.pieces.map((p) => {
    const rows = p.wedges.map((w) => `<tr><td>${esc(w.method)}</td><td class="kv2-faint">${esc(w.anchor)}</td><td class="kv2-num">${cell(w.firstRow)}–${cell(w.lastRow)}</td><td class="kv2-num">${cell(w.turns)}</td><td class="kv2-num">${cell(w.workedFrom)} → ${cell(w.workedTo)}</td><td class="kv2-num">${cell(w.extraRows)}</td></tr>`).join('');
    return `<div style="margin-top:6px"><strong>${esc(p.name)}</strong>${p.id !== p.name ? ` <span class="kv2-faint" style="font-size:11px">${esc(p.id)}</span>` : ''}<table class="kv2-table"><thead><tr><th>Wedge</th><th>Anchor</th><th>Rows</th><th>Turns</th><th>Worked sts</th><th>Extra rows</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('');
  return `${sectionHeading('Short-row atlas', 'the wedges that bend flat fabric into a body')}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-sr>Copy short-row atlas</button></div>
    ${row('Plan', chip(sr.headline, sr.tone))}
    ${row('Total SR rows', cell(sr.totalRows))}
    ${row('Extra length', cell(sr.totalExtraRows, ' rows'))}
    ${body}`;
}

/**
 * The verification action list: every failing or warning check the compiler ran, with the
 * specific `fix` string the engine wrote (hidden by the flat table before this view existed).
 * Sorted blocking-first so the knitter sees what will actually stop them at the machine.
 */
function renderVerify(v) {
  if (!v) return '';
  const actionCard = (r, mark, tone) => `
    <div class="kv2-issue kv2-issue--${tone}" style="margin-top:4px">
      <div><strong>${mark} ${esc(r.label)}</strong> <span class="kv2-faint" style="font-size:11px">${esc(r.id)}</span></div>
      ${r.message ? `<div style="margin-top:2px">${esc(r.message)}</div>` : ''}
      ${r.fix ? `<div style="margin-top:2px"><span class="kv2-faint" style="font-size:11px">fix:</span> <em>${esc(r.fix)}</em></div>` : ''}
    </div>`;
  const blocking = v.blocking.map((r) => actionCard(r, '✗', 'error')).join('');
  const warnings = v.warnings.map((r) => actionCard(r, '⚠', 'warn')).join('');
  const passedRow = v.passed.length
    ? `<div class="kv2-faint" style="margin-top:6px;font-size:11px">${v.passed.map((p) => `✓ ${esc(p.label)}`).join(' · ')}</div>`
    : '';
  const allClear = !v.blocking.length && !v.warnings.length
    ? '<p class="kv2-faint" style="margin-top:6px">All checks pass — cast on with confidence.</p>'
    : '';
  return `${sectionHeading('What to fix', 'actionable hints the compiler wrote for every check')}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-verify>Copy action list</button></div>
    ${row('Status', chip(v.headline, v.tone))}
    ${v.blocking.length ? `<div style="margin-top:6px"><strong>Blocking</strong> <span class="kv2-faint" style="font-size:11px">(fix before casting on)</span>${blocking}</div>` : ''}
    ${v.warnings.length ? `<div style="margin-top:6px"><strong>Warnings</strong> <span class="kv2-faint" style="font-size:11px">(read before you commit)</span>${warnings}</div>` : ''}
    ${allClear}
    ${passedRow}`;
}

/**
 * The QC inspection card: every check the QC engine scored, grouped by category (Structure / Fit
 * & measurements / Finishing / Presentation) with pass/fail/pending marks and the measurement
 * reading ("96.5 cm vs 96 ±2 cm · within"). Blocking failures are lifted to the top so the maker
 * sees "ends not woven in" before shipping. See `summariseQC`.
 */
function renderQC(qc) {
  if (!qc) return '';
  const blockingList = qc.blocking.length
    ? `<div style="margin-top:4px">${qc.blocking.map((b) => `<div class="kv2-issue kv2-issue--error">✗ ${esc(b.label)} <span class="kv2-faint" style="font-size:11px">${esc(b.key)}</span></div>`).join('')}</div>`
    : '';
  const catBlocks = qc.categories.map((cat) => {
    const rows = cat.checks.map((c) => {
      const req = c.required ? ' *' : '';
      const reading = c.reading ? ` <span class="kv2-faint" style="font-size:11px">${esc(c.reading)}</span>` : '';
      const note = c.note ? ` <span class="kv2-faint" style="font-size:11px">(${esc(c.note)})</span>` : '';
      const tone = c.verdict === 'fail' ? 'error' : c.verdict === 'pass' ? 'ok' : c.verdict === 'pending' ? 'warn' : '';
      return `<tr><td style="width:1.4em;text-align:center" class="kv2-chip--${tone || 'info'}">${esc(c.mark)}</td><td>${esc(c.label)}${req}${reading}${note}</td></tr>`;
    }).join('');
    return `<div style="margin-top:6px"><strong>${esc(cat.label)}</strong><table class="kv2-table"><tbody>${rows}</tbody></table></div>`;
  }).join('');
  return `${sectionHeading('Quality control', 'the eleven-line checklist the shipping verdict is built from')}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-qc>Copy inspection card</button></div>
    ${row('Verdict', chip(qc.headline, qc.tone))}
    ${row('Pass rate', bar(qc.score.passRate, qc.score.passRate >= 100 ? 'ok' : qc.score.passRate >= 60 ? 'warn' : 'bad'))}
    ${blockingList}
    ${catBlocks}`;
}

/**
 * The Chart DNA section: repeat, symmetry, density and content bounds — the structural fingerprint
 * of the compiled card matrix. See `summariseChartDNA`. Returns '' when there is no cardMatrix
 * (a plain-texture project) so the section is hidden.
 */
function renderChartDNA(dna) {
  if (!dna) return '';
  const noRepeatNote = dna.repeat.isFullRow && dna.repeat.isFullCol
    ? ' <span class="kv2-faint" style="font-size:11px">(whole card is one tile)</span>' : '';
  const boundsRow = dna.bounds
    ? row('Content box', `${cell(dna.bounds.rows)}r × ${cell(dna.bounds.cols)}c · <span class="kv2-faint">${cell(dna.bounds.wastedPct, '% padding')}</span>`)
    : '';
  return `${sectionHeading('Chart DNA', 'the structural fingerprint the editor only toasts')}
    <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-dna>Copy Chart DNA</button></div>
    ${row('Fingerprint', chip(dna.headline, dna.tone))}
    ${row('Matrix', `${cell(dna.matrix.rows)} rows × ${cell(dna.matrix.cols)} needles · ${esc(dna.matrix.mode)}`)}
    ${row('True repeat', `${cell(dna.repeat.rowPeriod)}r × ${cell(dna.repeat.colPeriod)}c → ${cell(dna.repeat.tilesY)}×${cell(dna.repeat.tilesX)} tiles${noRepeatNote}`)}
    ${row('Symmetry', `L↔R ${cell(dna.symmetry.verticalPct, '%')} · T↔B ${cell(dna.symmetry.horizontalPct, '%')} · 180° ${cell(dna.symmetry.rotationalPct, '%')}`)}
    ${row('Density', `${bar(dna.density.pct, dna.density.pct > 85 ? 'warn' : 'ok')} busiest row ${cell(dna.density.busiestRow)} (${cell(dna.density.densestCount)} needles)`)}
    ${boundsRow}`;
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
      'Pieces': r.headline.pieces, 'Time (h)': r.headline.totalHours,
      'Unit cost': r.headline.unitCost, 'Cost': r.headline.costTotal, 'Suggested price': r.headline.suggestedPrice
    }).map(([k, v]) => row(k, typeof v === 'number' && (k.includes('cost') || k.includes('price') || k === 'Unit cost') ? moneyCell(v) : cell(v)));
    const issues = safeValidate(state.project);
    const issueHtml = issues.length
      ? `<div class="kv2-issues">${issues.map((i) => `<div class="kv2-issue kv2-issue--${esc(i.severity || 'info')}">${esc(i.message || i.code || JSON.stringify(i))}</div>`).join('')}</div>`
      : `<p class="kv2-faint">No validation issues — the KnitScript is coherent.</p>`;
    const health = summariseHealth(r);
    return `${sectionHeading('KnitScript', 'the single source of truth')}
      ${renderHealthCard(health)}
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
    const pieces = (fit.pieces || []).map((p) =>
      `<tr><td>${esc(p.id || p.name || 'piece')}</td><td class="kv2-num">${cell(p.castOn)}</td><td class="kv2-num">${cell(p.rows || p.totalRows)}</td><td class="kv2-num">${cell(p.finalStitches)}</td></tr>`
    ).join('');
    const rep = fit.report || {};
    const fitGrade = rep.grade || null;
    const fin = summariseFinishing(fit);
    const dr = summariseDrape(fit.drape);
    const sr = summariseShortRows(fit.pieces);
    return `${sectionHeading('Construction', esc(fit.construction || ''))}
      ${row('Pieces', cell((fit.pieces || []).length))}
      ${row('Body gauge', cell(fit.gauge && fit.gauge.stsPer10cm, ' sts'))}
      ${renderBodyEase(fit)}
      ${fitGrade ? row('Fit grade', chip(fitGrade + (rep.score ? ` (${rep.score}/100)` : ''), /A|B/i.test(fitGrade) ? 'ok' : 'warn')) : ''}
      ${sectionHeading('Pattern pieces')}
      <table class="kv2-table"><thead><tr><th>Piece</th><th>Cast&nbsp;on</th><th>Rows</th><th>Final&nbsp;sts</th></tr></thead><tbody>${pieces || '<tr><td colspan="4" class="kv2-faint">none</td></tr>'}</tbody></table>
      ${renderAssemblyMap(fit.pieces)}
      ${renderShapingEvents(fit.pieces)}
      ${renderEaseCheck(fit.report)}
      ${renderFinishing(fin)}
      ${renderDrape(dr)}
      ${renderShortRows(sr)}`;
  },

  yarn(state) {
    const y = state.report && state.report.yarn;
    if (!y) return `<p class="kv2-error">The Yarn Lab produced no report${state.reportError ? ': ' + esc(state.reportError) : '.'}</p>`;
    const list = (y.yarns || []).map((yy) => `<tr><td>${yy.color ? `<i style="width:12px;height:12px;border-radius:3px;border:1px solid #0003;display:inline-block;vertical-align:middle;margin-right:4px;background:${esc(yy.color)}"></i>` : ''}${esc(yy.name)}</td><td class="kv2-num">${cell(yy.meters, 'm')}</td><td class="kv2-num">${cell(yy.ballsNeeded)}</td><td>${yy.shortfall > 0 ? chip('+' + yy.shortfall + ' to buy', 'warn') : chip('in stash', 'ok')}</td></tr>`).join('');
    // Rank the library for the primary yarn; pass the pattern's metre estimate so the engine can
    // emit a concrete yardage adjustment alongside the gauge/needle edits.
    const primary = (y.yarns || [])[0];
    const sub = primary && primary.yarn ? bestSubstitutesFor(primary.yarn, Object.assign({}, y.gauge, { meters: y.totalMeters }), { limit: 5 }) : null;
    const hold = summariseHoldForGauge(y.gauge && y.gauge.stsPer10cm, { limit: 5 });
    const care = summariseCare(y.behavior && y.behavior.fibers, y.behavior);
    return `${sectionHeading('Yarns')}
      <table class="kv2-table"><thead><tr><th>Yarn</th><th>Metres</th><th> Balls</th><th>Stash</th></tr></thead><tbody>${list || '<tr><td colspan="4" class="kv2-faint">no yarn declared</td></tr>'}</tbody></table>
      ${row('Total length', cell(y.totalMeters, ' m'))}
      ${row('Yarn cost', moneyCell(y.totalCost))}
      ${row('Gauge', cell(y.gauge && y.gauge.stsPer10cm) + ' sts / ' + cell(y.gauge && y.gauge.rowsPer10cm) + ' rows')}
      ${y.gauge && y.gauge.stsPer10cm ? `<p class="kv2-faint" style="font-size:10px;margin:2px 0 6px">Swatch tip: cast on ${Math.round(Number(y.gauge.stsPer10cm) * 2)} sts, knit ${Math.round(Number(y.gauge.rowsPer10cm || 30) * 1.5)} rows, block, measure the centre 10×10 cm — adjust tension until it matches.</p>` : ''}
      ${y.behavior ? row('Behaviour', `<span class="kv2-chip">${esc(y.behavior.fibre || 'mixed')} · drape ${cell(y.behavior.drape)}</span>`) : ''}
      ${y.care && y.care.length ? y.care.map(c => row('Care \u00b7 ' + esc(c.name), esc(Array.isArray(c.label) ? c.label.join(', ') : (c.label || '')))).join('') : ''}
      ${y.shortfalls && y.shortfalls.length ? `<p class="kv2-issue kv2-issue--warn">Buy ${y.shortfalls.reduce((n, s) => n + num(s.buy), 0)} more ball(s) before casting on.</p>` : ''}
      ${renderSubstitutes(sub)}
      ${renderHold(hold)}
      ${renderCare(care)}`;
  },

  compiler(state) {
    const c = state.report && state.report.compile;
    if (!c) return `<p class="kv2-error">The Compiler produced no report${state.reportError ? ': ' + esc(state.reportError) : '.'}</p>`;
    const checks = (c.verification || []).map((v) => `<tr${v.fix ? ` title="Fix: ${esc(v.fix)}"` : ''}><td>${esc(v.id || v.label || v.check || '')}</td><td>${chip(v.verdict || v.status || '?', verdictTone(v.verdict || v.status))}</td><td class="kv2-check-fix">${esc(v.message || v.detail || '')}</td></tr>`).join('');
    const m = c.metrics || {};
    const opt = summariseOptimisation(c.optimisation);
    const optLabel = opt && opt.chosenPriority ? (PRIORITY_OPTIONS.find((o) => o.priority === opt.chosenPriority) || {}).label : null;
    const deriv = summariseDerivations(c.ir);
    const cv = summariseColorVision(c.ir && c.ir.colors);
    const fi = summariseFairIsle(c.ir && c.ir.colors ? c.ir.colors.map((k) => k.hex) : [], c.ir && c.ir.cardMatrix);
    const vsum = summariseVerification(c.verification);
    const dna = summariseChartDNA(c.ir && c.ir.cardMatrix);
    const written = c.outputs && c.outputs.written ? String(typeof c.outputs.written === 'string' ? c.outputs.written : (c.outputs.written.text || '')) : '';
    return `${sectionHeading('Pipeline', `${c.summary ? esc(c.summary.verdict) + ' — ' + (c.summary.passed || 0) + '✓ ' + (c.summary.warnings || 0) + '⚠ ' + (c.summary.failures || 0) + '✗' : ''}`)}
      ${renderMachineChip(c.ir && c.ir.machine)}
      <div class="kv2-chips">${chip(m.pieces + ' pieces')}${chip(m.rows + ' rows')}${chip(m.decreases + ' dec')}${chip(m.increases + ' inc')}${chip(m.shortRows + ' short-rows')}${m.yarnChanges ? chip(m.yarnChanges + ' yarn chg') : ''}${c.optimisation ? chip('optimised \u00b7 ' + (optLabel || 'balanced'), 'ok') : ''}${renderDifficulty(m)}${state.report.headline && state.report.headline.totalHours ? chip('~' + Math.round(state.report.headline.totalHours) + ' h to knit') : ''}</div>
      ${renderColorContrastStrip(c.ir && c.ir.colors)}
      ${renderOptimise(opt)}
      ${renderDerivations(deriv)}
      ${renderColorVision(cv, c.ir && c.ir.cardMatrix)}
      ${renderFairIsle(fi)}
      ${renderChartDNA(dna)}
      ${sectionHeading('Verification')}
      <table class="kv2-table"><thead><tr><th>Check</th><th>Verdict</th><th>Detail</th></tr></thead><tbody>${checks || '<tr><td colspan="3" class="kv2-faint">none ran</td></tr>'}</tbody></table>
      ${renderVerify(vsum)}
      ${sectionHeading('Outputs')}
      <div class="kv2-actions">
        ${c.outputs && c.outputs.written ? '<button type="button" class="kx-btn" data-out="written">Written</button>' : ''}
        ${c.outputs && c.outputs.chart ? '<button type="button" class="kx-btn" data-out="chart">Chart</button>' : ''}
        ${c.outputs && c.outputs.machine ? '<button type="button" class="kx-btn" data-out="machine">Machine</button>' : ''}
        ${c.outputs && c.outputs.punchcard ? '<button type="button" class="kx-btn" data-out="punchcard">Punchcard</button>' : ''}
        ${c.outputs && c.outputs.dxf ? '<button type="button" class="kx-btn" data-out="dxf">DXF</button>' : ''}
        ${c.outputs && c.outputs.gcode ? '<button type="button" class="kx-btn" data-out="gcode">G-code</button>' : ''}
        ${c.outputs && c.outputs.manufacturing ? '<button type="button" class="kx-btn" data-out="manufacturing">Tech pack</button>' : ''}
      </div>
      <div class="kv2-actions"><button type="button" class="kx-btn kx-btn--ghost" data-copy-pattern>Copy Written Pattern</button><button type="button" class="kx-btn kx-btn--ghost" data-download-out>Download</button><button type="button" class="kx-btn kx-btn--ghost" data-print-out>🖨 Print</button></div>
      <div class="kv2-actions" style="gap:4px;align-items:center"><label for="kv2-row-goto" style="font-size:11px;color:var(--text-dim)">Current row:</label><input type="number" id="kv2-row-goto" data-row-goto min="1" step="1" style="width:56px;font-size:12px;padding:2px 4px;background:var(--bg-inset);border:1px solid var(--panel-hairline);border-radius:4px;color:var(--text-main)"><button type="button" class="kx-btn kx-btn--ghost" data-row-go>⬇ Go</button><button type="button" class="kx-btn kx-btn--ghost" data-row-next title="Advance to next row">Next ▶</button><span class="kv2-faint" data-row-hint style="font-size:10px"></span></div>
      <div class="kv2-out" data-out-pane data-active-out="written" style="white-space:normal;font-family:var(--font-sans);font-size:12px;line-height:1.55">${written ? renderMarkdownLite(written.slice(0, 12000)) : '<span class="kv2-faint">(no written output)</span>'}</div>`;
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
    const quote = summariseQuote(r.quote);
    const qcs = summariseQC(prod && prod.qc);
    const narrative = prod.plan ? planNarrative(prod) : '';
    return `${narrative ? `<div style="margin-bottom:8px;padding:6px 10px;background:var(--bg-inset,#0a1226);border:1px solid var(--panel-hairline,#21324f);border-radius:8px;font-size:12px;line-height:1.5">${esc(narrative)}</div>` : ''}
      ${sectionHeading('Costing')}
      <table class="kv2-table"><thead><tr><th>Bucket</th><th>Per unit</th><th>Batch</th></tr></thead><tbody>${breakdown || '<tr><td colspan="3" class="kv2-faint">—</td></tr>'}</tbody></table>
      ${row('Unit cost', moneyCell(cost.unitCost, cost.currency))}
      ${row('Suggested price', `${moneyCell(pricing.price, cost.currency)} ${pricing.marginPct != null ? bar(pricing.marginPct, pricing.marginPct >= 40 ? 'ok' : 'warn') : ''}`)}
      ${row('Profit / unit', moneyCell(pricing.profitPerUnit, cost.currency))}
      ${row('Break-even units', cell(cost.breakEvenUnits))}
      ${prod.dashboard ? row('Batch profit', moneyCell(prod.dashboard.profit, cost.currency)) + row('Revenue', moneyCell(prod.dashboard.revenue, cost.currency)) : ''}
      ${renderYarnNeeds(prod.batch && prod.batch.yarnNeeds)}
      ${sectionHeading('Batch plan')}
      ${prod.dashboard && prod.dashboard.deadline ? `<div class="kv2-chips" style="margin-bottom:4px">${chip('\\u23F0 ' + esc(prod.dashboard.deadline))}${prod.dashboard.progressPct != null ? bar(prod.dashboard.progressPct, prod.dashboard.progressPct >= 60 ? 'ok' : 'warn') + ' done' : ''}</div>` : ''}
      <div class="kv2-actions">${'quantity'}: <input type="number" class="kv2-input" data-qty value="${esc((prod.plan && prod.plan.quantity) || 1)}" min="1"> <button type="button" class="kx-btn" data-act="replan">Re-plan</button></div>
      <div class="kv2-chips">${chip(prod.feasible ? 'feasible' : 'not feasible', prod.feasible ? 'ok' : 'warn')}<span class="kv2-chip">${cell(prod.time && prod.time.batchHours)} h</span>${chip(cost.quantity + ' units')}</div>
      ${prod.warnings && prod.warnings.length ? `<div class="kv2-issues">${prod.warnings.map((w) => `<div class="kv2-issue kv2-issue--warn">${esc(w)}</div>`).join('')}</div>` : ''}
      <table class="kv2-table"><thead><tr><th>#</th><th>Qty</th><th>Start</th><th>End</th><th>Hours</th></tr></thead><tbody>${batches || '<tr><td colspan="5" class="kv2-faint">no schedule</td></tr>'}</tbody></table>
      ${renderTimeOps(prod.time)}
      ${renderQC(qcs)}
      ${renderQuote(quote)}`;
  }
};

function renderReverseResult(res) {
  if (!res || res.error) return `<p class="kv2-error">${esc((res && res.error) || 'Analysis failed.')}</p>`;
  const g = res.gauge || {};
  const sc = res.scale || {};
  const fab = res.fabric || {};
  const sil = res.silhouette || {};
  const patRanked = (res.pattern && Array.isArray(res.pattern.ranked) ? res.pattern.ranked : []).slice(0, 3);
  const patRows = patRanked.map((p) => `<tr><td>${esc(p.name || p.pattern || '?')}</td><td class="kv2-num">${Math.round((p.confidence || 0) * 100)}%</td></tr>`).join('');
  return `${row('Gauge', cell(g.stitchesPer10cm) + ' sts / ' + cell(g.rowsPer10cm) + ' rows /10cm')}
    ${row('Scale', `${sc.cmPerPixel ? sc.cmPerPixel.toFixed(3) + ' cm/px' : 'not calibrated'}${sc.plausible === false ? ' ' + chip('unreliable', 'warn') : ''}`)}
    ${fab.coverage != null ? row('Fabric coverage', bar(Math.round(fab.coverage * 100), fab.coverage > 0.3 ? 'ok' : 'warn')) : ''}
    ${row('Confidence', bar(Math.round(num(res.confidence) * 100), res.confidence > 0.6 ? 'ok' : 'warn'))}
    ${row('Pattern', chip((res.pattern && res.pattern.primary) || 'unknown'))}
    ${patRows ? `<table class="kv2-table" style="margin:2px 0 4px"><thead><tr><th>Hypothesis</th><th>Conf</th></tr></thead><tbody>${patRows}</tbody></table>` : ''}
    ${row('Construction', chip((res.construction && res.construction.construction) || 'unknown', (res.construction && res.construction.confidence) > 0.5 ? 'ok' : ''))}
    ${sil.shape ? row('Silhouette', chip(esc(sil.shape))) : ''}
    ${res.colors && res.colors.length ? row('Palette', `<span class="kv2-swatches">${res.colors.slice(0, 6).map((c) => `<i style="background:${esc(c.hex || '#888')}" title="${esc(c.name || c.hex || '')}"></i>`).join('')}</span>`) : ''}
    ${res.warnings && res.warnings.length ? `<div class="kv2-issues">${res.warnings.map((w) => `<div class="kv2-issue kv2-issue--warn">${esc(w)}</div>`).join('')}</div>` : ''}
    ${res.reconstruction ? `<pre class="kv2-out kv2-script-out">${esc((res.reconstruction.knitScript || '').slice(0, 3000))}</pre><div class="kv2-actions"><button type="button" class="kx-btn kx-btn--primary" data-act="load-reconstruction">Load into Project</button></div>` : ''}`;
}

function safeValidate(project) {
  try { return project && project.validate ? (project.validate() || []) : []; } catch (_) { return []; }
}
function verdictTone(v) { return ({ pass: 'ok', ok: 'ok', warn: 'warn', fail: 'bad', error: 'bad' })[String(v).toLowerCase()] || ''; }

// ---------------------------------------------------------------------------
// DOM binders (event handlers that need live elements) + live counts.
// ---------------------------------------------------------------------------

const binders = {
  project(entry, controller, state) {
    const ta = entry.body.querySelector('.kv2-script');
    entry.body.querySelector('[data-act="apply"]').addEventListener('click', () => { controller.setScript(ta.value); controller.refresh(); try { window.dispatchEvent(new CustomEvent('knit:fx', { detail: controller.report && !controller.report.modelErrorCount ? 'success' : 'warn' })); } catch (_) {} });
    entry.body.querySelector('[data-act="reset"]').addEventListener('click', () => { controller.setScript(DEFAULT_KNITSCRIPT); controller.refresh(); });
    const copyBtn = entry.body.querySelector('[data-act="copy"]');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      try { navigator.clipboard && navigator.clipboard.writeText(ta.value); } catch (_) { /* denied */ }
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
    // Copy the health card as plain text — the same traffic-light report the card shows.
    const copyHealth = entry.body.querySelector('[data-copy-health]');
    if (copyHealth) copyHealth.addEventListener('click', () => {
      const r = controller.report;
      const text = healthToText(summariseHealth(r));
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
    // Click a health check row to open the corresponding panel.
    entry.body.querySelectorAll('[data-health-open]').forEach((tr) => {
      tr.addEventListener('click', () => { const target = tr.getAttribute('data-health-open'); if (target) controller.open(target); });
    });
  },
  fit(entry, controller) {
    // Copy the finishing checklist — the same bands, pick-up counts and seaming order the panel
    // shows, recomputed from the live draft so the pasted text always matches what is on screen.
    const copyFin = entry.body.querySelector('[data-copy-fin]');
    if (copyFin) copyFin.addEventListener('click', () => {
      const fit = controller.report && controller.report.fit;
      const text = finishingToText(summariseFinishing(fit));
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
    // Copy the drape report — the same verdict, heatmap and tight-spot list the section shows,
    // as a plain-text sheet. Recomputed from the live draft so the two views never disagree.
    const copyDrape = entry.body.querySelector('[data-copy-drape]');
    if (copyDrape) copyDrape.addEventListener('click', () => {
      const fit = controller.report && controller.report.fit;
      const text = drapeToText(summariseDrape(fit && fit.drape));
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
    // Copy the short-row atlas — the same wedge-by-wedge plan the section shows, as a plain-text
    // checklist the knitter can pin above the machine.
    const copySR = entry.body.querySelector('[data-copy-sr]');
    if (copySR) copySR.addEventListener('click', () => {
      const fit = controller.report && controller.report.fit;
      const text = shortRowsToText(summariseShortRows(fit && fit.pieces));
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
  },
  compiler(entry, controller) {
    entry.body.querySelectorAll('[data-out]').forEach((btn) => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-out');
      const c = controller.report && controller.report.compile;
      const out = c && c.outputs ? c.outputs[id] : null;
      const pane = entry.body.querySelector('[data-out-pane]');
      if (!pane) return;
      pane.setAttribute('data-active-out', id);
      pane.scrollTop = 0;
      if (id === 'written' && typeof out === 'string') {
        pane.style.cssText = 'white-space:normal;font-family:var(--font-sans);font-size:12px;line-height:1.55;padding:10px 12px;max-height:360px;overflow-y:auto';
        pane.innerHTML = renderMarkdownLite(out.slice(0, 12000));
      } else if (id === 'chart' && out && out.svg) {
        pane.style.cssText = 'padding:4px;text-align:center;overflow:auto;max-height:400px';
        pane.innerHTML = out.svg;
      } else if (id === 'manufacturing' && out && out.kind === 'tech-pack') {
        pane.style.cssText = 'white-space:normal;font-family:var(--font-sans);font-size:12px;line-height:1.5;padding:10px 12px;max-height:400px;overflow-y:auto';
        pane.innerHTML = renderTechPackHtml(out);
      } else if (id === 'machine' || id === 'punchcard' || id === 'dxf' || id === 'gcode') {
        pane.style.cssText = 'font-family:var(--font-mono,monospace);font-size:11px;line-height:1.4;padding:10px 12px;max-height:400px;overflow:auto;white-space:pre';
        pane.textContent = summariseOutput(id, out);
      } else {
        pane.style.cssText = '';
        pane.textContent = summariseOutput(id, out);
      }
    }));
    // Choosing what to optimise for re-runs the pipeline and repaints, so the trade-off table and
    // the frontier both move under the knitter — the whole point of surfacing the Pareto set.
    entry.body.querySelectorAll('[data-priority]').forEach((btn) => btn.addEventListener('click', () => {
      controller.setOptimisePriority(btn.getAttribute('data-priority'));
    }));
    // Copy the derivation trail as plain text — the same numbers the list shows, ready to paste
    // into notes or a tech pack. Falls back to a selectable prompt when the clipboard is blocked.
    const copyDerive = entry.body.querySelector('[data-copy-derive]');
    if (copyDerive) copyDerive.addEventListener('click', () => {
      const c = controller.report && controller.report.compile;
      const text = derivationToText(summariseDerivations(c && c.ir));
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
    // Copy the colour-vision report — the same accessibility read the section shows, as text.
    const copyCvd = entry.body.querySelector('[data-copy-cvd]');
    if (copyCvd) copyCvd.addEventListener('click', () => {
      const c = controller.report && controller.report.compile;
      const text = colorVisionToText(summariseColorVision(c && c.ir && c.ir.colors));
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
    // Copy the Fair Isle safety report — the same float/contrast read the section shows, as text.
    const copyFi = entry.body.querySelector('[data-copy-fi]');
    if (copyFi) copyFi.addEventListener('click', () => {
      const c = controller.report && controller.report.compile;
      const fi = summariseFairIsle(c && c.ir && c.ir.colors ? c.ir.colors.map((k) => k.hex) : [], c && c.ir && c.ir.cardMatrix);
      const text = fairIsleToText(fi);
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
    // Copy the verification action list — the same blocking/warning/passed buckets the section
    // shows, with every `fix` string the compiler wrote. Plain text so it pastes into notes or a
    // tech pack, and always matches the numbers on screen (recomputed from the live report).
    const copyVerify = entry.body.querySelector('[data-copy-verify]');
    if (copyVerify) copyVerify.addEventListener('click', () => {
      const c = controller.report && controller.report.compile;
      const text = verificationToText(summariseVerification(c && c.verification));
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
    // Copy the Chart DNA report — repeat, symmetry, density, bounds — as a plain-text fingerprint.
    const copyDNA = entry.body.querySelector('[data-copy-dna]');
    if (copyDNA) copyDNA.addEventListener('click', () => {
      const c = controller.report && controller.report.compile;
      const text = chartDNAToText(summariseChartDNA(c && c.ir && c.ir.cardMatrix));
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
    // Copy the full written pattern as raw Markdown — the same text the formatted pane shows.
    const copyPat = entry.body.querySelector('[data-copy-pattern]');
    if (copyPat) copyPat.addEventListener('click', () => {
      const c = controller.report && controller.report.compile;
      const w = c && c.outputs && c.outputs.written;
      const text = typeof w === 'string' ? w : (w && w.text) || '';
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
      copyPat.textContent = '✓ Copied!';
      setTimeout(() => { copyPat.textContent = 'Copy Written Pattern'; }, 1500);
    });
    // Download the active output as a file (G-code, DXF, SVG chart, written .md, etc.).
    const dl = entry.body.querySelector('[data-download-out]');
    if (dl) dl.addEventListener('click', () => {
      const pane = entry.body.querySelector('[data-out-pane]');
      const id = pane && pane.getAttribute('data-active-out');
      const c = controller.report && controller.report.compile;
      const out = c && c.outputs && id ? c.outputs[id] : null;
      const { blob, ext, mime } = outputBlob(id, out);
      if (!blob) return;
      const name = (c.ir && c.ir.metadata && c.ir.metadata.name ? c.ir.metadata.name.replace(/[^\w-]/g, '_') : 'pattern') + '.' + ext;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      try { window.dispatchEvent(new CustomEvent('knit:fx', { detail: 'success' })); } catch (_) { /* no audio */ }
    });
    // Print the current output pane content — @media print CSS hides everything else.
    const printBtn = entry.body.querySelector('[data-print-out]');
    if (printBtn) printBtn.addEventListener('click', () => { window.print(); });
    // Row tracker: jump to and highlight a specific "Row N:" in the output pane.
    const rowInput = entry.body.querySelector('[data-row-goto]');
    const rowGo = entry.body.querySelector('[data-row-go]');
    const rowHint = entry.body.querySelector('[data-row-hint]');
    const jumpToRow = () => {
      const pane = entry.body.querySelector('[data-out-pane]');
      if (!pane || !rowInput) return;
      const target = parseInt(rowInput.value, 10);
      if (!target || target < 1) { if (rowHint) rowHint.textContent = 'Enter a row number.'; return; }
      // Remove prior highlight
      const prev = pane.querySelector('[data-row-hl]');
      if (prev) { prev.style.background = ''; prev.removeAttribute('data-row-hl'); }
      // Search all li, p, td for "Row N:" or "N:" at the start
      const nodes = pane.querySelectorAll('li,p,pre,td,span');
      let found = false;
      const re = new RegExp('^\\s*(Row\\s+)?' + target + '\\b', 'i');
      for (const el of nodes) {
        if (re.test(el.textContent)) {
          el.style.background = 'rgba(255,220,50,.25)';
          el.setAttribute('data-row-hl', '1');
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          found = true;
          break;
        }
      }
      if (rowHint) rowHint.textContent = found ? `✓ Row ${target}` : `Row ${target} not found`;
    };
    if (rowGo) rowGo.addEventListener('click', jumpToRow);
    if (rowInput) rowInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') jumpToRow(); });
    // Next row: advance the input by 1 and jump.
    const rowNext = entry.body.querySelector('[data-row-next]');
    if (rowNext) rowNext.addEventListener('click', () => {
      const cur = parseInt(rowInput && rowInput.value, 10) || 0;
      if (rowInput) rowInput.value = String(cur + 1);
      jumpToRow();
    });
  },
  yarn(entry, controller) {
    // Copy the substitution report — the same ranked swaps the table shows, as plain text for a
    // tech pack. Recomputed from the live report so it always matches what is on screen.
    const copySub = entry.body.querySelector('[data-copy-sub]');
    if (copySub) copySub.addEventListener('click', () => {
      const y = controller.report && controller.report.yarn;
      const primary = y && y.yarns && y.yarns[0] && y.yarns[0].yarn;
      const sub = primary ? bestSubstitutesFor(primary, Object.assign({}, y.gauge, { meters: y.totalMeters }), { limit: 5 }) : null;
      const text = substitutionToText(sub);
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
    // Copy the hold-to-gauge plan — the same ranked strand combinations the table shows, as text.
    const copyHold = entry.body.querySelector('[data-copy-hold]');
    if (copyHold) copyHold.addEventListener('click', () => {
      const y = controller.report && controller.report.yarn;
      const text = holdPlanToText(summariseHoldForGauge(y && y.gauge && y.gauge.stsPer10cm, { limit: 5 }));
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
    // Copy the garment-care card — the same wash/dry/iron regimen shown in the section.
    const copyCare = entry.body.querySelector('[data-copy-care]');
    if (copyCare) copyCare.addEventListener('click', () => {
      const y = controller.report && controller.report.yarn;
      const text = careToText(summariseCare(y && y.behavior && y.behavior.fibers, y && y.behavior));
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
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
    // Copy the design quote sheet — the same fused commercial answer the section shows, as plain
    // text. Delegates to the quote engine's own `renderQuoteSheet` via `quoteToText`, so the pasted
    // sheet and the panel read come from the exact same numbers.
    const copyQuote = entry.body.querySelector('[data-copy-quote]');
    if (copyQuote) copyQuote.addEventListener('click', () => {
      const r = controller.report;
      const text = quoteToText(r && r.quote);
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
    // Copy the QC inspection card — the same eleven-line checklist grouped by category, with every
    // measurement reading the engine computed ("96.5 cm vs 96 ±2 cm · within"). Recomputed from
    // the live plan so the pasted sheet and the panel always agree.
    const copyQC = entry.body.querySelector('[data-copy-qc]');
    if (copyQC) copyQC.addEventListener('click', () => {
      const prod = controller.report && controller.report.production;
      const text = qcToText(summariseQC(prod && prod.qc));
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) { /* denied */ }
    });
  }
};

const counts = {
  project(state) { return state.report ? `${state.report.projectMeta.sections.length} sections` : ''; },
  fit(state) { return state.report && state.report.fit ? `${(state.report.fit.pieces || []).length} pieces` : ''; },
  yarn(state) { return state.report && state.report.yarn ? `${(state.report.yarn.yarns || []).length} yarns` : ''; },
  compiler(state) { return state.report && state.report.compile ? `${(state.report.compile.verification || []).length} checks` : ''; },
  production(state) { const p = state.report && state.report.production; return p && p.costing ? `${(p.batches || []).length} batches` : ''; }
};

/**
 * Map a compiler output (id + raw result) to a downloadable Blob with the correct file extension
 * and MIME. Returns `{blob, ext, mime}` or `{blob:null}` when the output is unavailable.
 */
function outputBlob(id, out) {
  if (out == null) return { blob: null, ext: '', mime: '' };
  let text = null;
  let ext = 'txt';
  let mime = 'text/plain';
  if (id === 'written' && typeof out === 'string') { text = out; ext = 'md'; mime = 'text/markdown'; }
  else if (id === 'chart' && out.svg) { text = out.svg; ext = 'svg'; mime = 'image/svg+xml'; }
  else if (id === 'machine' && typeof out === 'string') { text = out; ext = 'txt'; }
  else if (id === 'punchcard' && out.ascii) { text = out.ascii; ext = 'txt'; }
  else if (id === 'dxf' && out.dxf) { text = out.dxf; ext = 'dxf'; mime = 'application/dxf'; }
  else if (id === 'gcode' && out.gcode) { text = out.gcode; ext = 'gcode'; mime = 'text/plain'; }
  else if (id === 'manufacturing') { text = techPackText(out); ext = 'txt'; }
  else if (typeof out === 'string') { text = out; }
  else { text = JSON.stringify(out, null, 2); ext = 'json'; mime = 'application/json'; }
  if (!text) return { blob: null, ext: '', mime: '' };
  return { blob: new Blob([text], { type: mime }), ext, mime };
}

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

/**
 * Render the tech-pack manufacturing output as formatted HTML — proper tables for pieces,
 * yarn, time, grading, QC, and packing. Gives the knitter a print-ready production sheet.
 */
function renderTechPackHtml(tp) {
  const out = [];
  out.push(`<h3 style="margin:0 0 6px">Tech Pack — ${esc(tp.generatedFrom || 'Pattern')}</h3>`);
  out.push(`<p class="kv2-faint" style="font-size:11px;margin-bottom:8px">Qty ${tp.quantity} · ${esc(tp.machine)} · ${esc(tp.construction)} · ${esc(tp.currency)}</p>`);
  // Pieces
  if (tp.pieces && tp.pieces.length) {
    out.push('<h4>Pieces</h4><table class="kv2-table"><thead><tr><th>Piece</th><th>Make</th><th>Cast on</th><th>Rows</th><th>Yarn</th></tr></thead><tbody>');
    for (const p of tp.pieces) out.push(`<tr><td>${esc(p.name || p.id)}</td><td class="kv2-num">${p.makeTotal || 1}</td><td class="kv2-num">${p.castOn || '—'}</td><td class="kv2-num">${p.rows || '—'}</td><td>${esc(p.material || 'main')}</td></tr>`);
    out.push('</tbody></table>');
  }
  // Yarn order
  if (tp.yarn && tp.yarn.lines && tp.yarn.lines.length) {
    out.push('<h4>Yarn order</h4><table class="kv2-table"><thead><tr><th>Colour</th><th>Metres</th><th>Balls</th><th>Owned</th></tr></thead><tbody>');
    for (const y of tp.yarn.lines) out.push(`<tr><td>${esc(y.colorId || y.name)}</td><td class="kv2-num">${y.meters || '?'}</td><td class="kv2-num">${y.balls || y.ballsNeeded || '?'}</td><td class="kv2-num">${y.owned || 0}</td></tr>`);
    out.push('</tbody></table>');
  }
  // Time
  if (tp.time) {
    const t = tp.time;
    out.push(`<h4>Time</h4><p>${t.unitHours != null ? t.unitHours.toFixed(1) + ' h/unit' : ''} ${t.batchHours != null ? ' · ' + t.batchHours.toFixed(1) + ' h total' : ''}</p>`);
  }
  // Cost
  if (tp.cost) {
    const c = tp.cost;
    out.push(`<h4>Cost</h4><p>Unit ${c.unitCost || '?'} → Price ${c.price || c.suggestedPrice || '?'} (${c.marginPct || '?'}% margin)</p>`);
  }
  // Grading
  if (tp.grading && typeof tp.grading === 'object') {
    const sizes = Array.isArray(tp.grading) ? tp.grading : Object.entries(tp.grading).map(([k, v]) => ({ size: k, ...(typeof v === 'object' ? v : { value: v }) }));
    if (sizes.length) {
      const keys = Object.keys(sizes[0]).filter(k => k !== 'size' && k !== 'label');
      out.push(`<h4>Grading</h4><table class="kv2-table"><thead><tr><th>Size</th>${keys.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>`);
      for (const g of sizes) out.push(`<tr><td>${esc(g.size || g.label)}</td>${keys.map(k => `<td class="kv2-num">${g[k] != null ? g[k] : '—'}</td>`).join('')}</tr>`);
      out.push('</tbody></table>');
    }
  }
  // QC
  if (tp.qc) {
    const checks = Array.isArray(tp.qc) ? tp.qc : (tp.qc.checks || []);
    if (checks.length) {
      out.push(`<h4>QC (${checks.length} checks)</h4><ul style="font-size:11px;margin:4px 0;padding-left:16px">`);
      for (const q of checks.slice(0, 12)) out.push(`<li>${esc(q.label || q.name || q.text || JSON.stringify(q).slice(0, 80))}</li>`);
      out.push('</ul>');
    }
  }
  // Packing
  if (tp.packing) {
    const pk = tp.packing;
    out.push(`<h4>Packing</h4><p style="font-size:11px">${esc(pk.summary || pk.label || (pk.items ? pk.items.length + ' items' : '') || '')}</p>`);
  }
  // Warnings
  if (tp.warnings && tp.warnings.length) {
    out.push('<div class="kv2-issues">' + tp.warnings.map(w => `<div class="kv2-issue kv2-issue--warn">${esc(w)}</div>`).join('') + '</div>');
  }
  return out.join('');
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
// Header drag.
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
.kv2-panel .kx-panel__body{padding:6px 12px}
/* Integrated six-way system switch, docked inside every panel header — this
   replaced the old floating #kv2-launcher strip so navigating the fused
   systems happens entirely within the main layout. */
.kv2-switch{display:flex;gap:4px;padding:6px 10px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--panel-hairline,#21324f);background:color-mix(in srgb,var(--bg-inset,#0a1226) 55%,transparent)}
.kv2-switch::-webkit-scrollbar{display:none}
.kv2-switch__btn{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;border:1px solid var(--btn-border,#2b3d5c);background:var(--btn-bg,#141d33);color:var(--btn-text,#dbe6ff);border-radius:9px;padding:5px 9px;font:11.5px var(--font-ui,system-ui,sans-serif);cursor:pointer;transition:border-color .15s,background .15s,transform 80ms}
.kv2-switch__btn:hover{border-color:var(--accent-cyan,#22d3ee);transform:translateY(-1px)}
.kv2-switch__btn.is-on{background:color-mix(in srgb,var(--accent-cyan,#22d3ee) 22%,var(--btn-bg,#141d33));border-color:var(--accent-cyan,#22d3ee);font-weight:700}
.kv2-switch__glyph{font-size:13px;line-height:1}
.kv2-switch__label{white-space:nowrap}
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
`;
