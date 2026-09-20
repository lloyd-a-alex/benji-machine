/**
 * KNITCAT — Knit-Along companion.
 *
 * The editor, the compiler and the Design-Health advisor all know a great deal
 * about a card, but they answer different questions at different times. A person
 * actually standing at the machine has one question, over and over: *"what do I do
 * on THIS row?"* This module turns the whole compiled schedule into a single,
 * row-at-a-time walking companion — a big current-row readout, the carriage
 * direction, how many needles are in play, any transfers to make, and the specific
 * Design-Health warnings that apply to exactly this row — and lights that row up on
 * the card using the editor highlight the advisor already uses.
 *
 * Two halves, split so the maths is testable without a browser:
 *
 *   - {@link buildRowPlan} is pure and DOM-free. It folds the compiler's
 *     `strokes` / `cardMatrix` / `rowMapping` (see `js/compiler/lace-decompiler.js`)
 *     and the advisor's `issues` into one ordered list of per-card-row steps. No
 *     reimplementation of carriage logic — it reads the passes the compiler already
 *     emitted, so the companion can never disagree with the schedule tab.
 *   - {@link createKnitAlong} mounts a floating dock over that plan and drives the
 *     live editor highlight. It is a *consumer*: it only reads the card and paints a
 *     spotlight, never mutates the drawing matrix, so a failure to boot it means no
 *     panel, never a broken card.
 *
 * Importing this module has no DOM side effects — every DOM touch happens inside
 * {@link createKnitAlong}, which the app boots under a guarded step.
 *
 * @module features/knit-along
 */

import { buildPanel, esc } from '../ui/kit.js';
import { getDiagnostics } from '../core/diagnostics.js';

const STYLE_ID = 'kx-knitalong-style';
const PANEL_ID = 'kx-knitalong';
const BUTTON_ID = 'kx-knitalong-btn';

const ARROW = { L_TO_R: '\u2192', R_TO_L: '\u2190' };
const CARRIAGE_LABEL = { LACE: 'Transfer (L)', KNIT: 'Knit (K)', COMBINED: 'Combined' };

/**
 * Fold a compiled schedule + advisor issues into an ordered, per-card-row plan.
 * Pure and DOM-free so it can be asserted against real or synthetic results.
 *
 * @param {object} input
 * @param {Array<object>} [input.strokes]    CarriageStrokes (carry cardRowIndex,
 *                                           direction, carriageType, transfers).
 * @param {Array<Array<boolean>>} [input.cardMatrix] Punchcard grid, true = hole.
 * @param {Array<object>} [input.rowMapping] { patternRow, cardStartRow, cardEndRow }.
 * @param {Array<object>} [input.issues]     Advisor issues (may carry `cells`[[r,c]]
 *                                           and `where`) to surface per row.
 * @returns {Array<object>} one step per card row, in knitting order.
 */
export function buildRowPlan({ strokes = [], cardMatrix = [], rowMapping = [], issues = [] } = {}) {
  const rows = Array.isArray(strokes) ? strokes : [];
  const card = Array.isArray(cardMatrix) ? cardMatrix : [];
  const map = Array.isArray(rowMapping) ? rowMapping : [];
  const probs = Array.isArray(issues) ? issues : [];

  // How many card rows are there? The punchcard is authoritative, but a stray stroke
  // past its end (shouldn't happen) must still be shown rather than silently dropped.
  let nRows = card.length;
  for (const s of rows) nRows = Math.max(nRows, (Number(s.cardRowIndex) || 0) + 1);

  // Bucket strokes by the card row that reads them, so per-row work is exact.
  const byRow = new Map();
  for (const s of rows) {
    const cr = Number(s.cardRowIndex) || 0;
    if (!byRow.has(cr)) byRow.set(cr, []);
    byRow.get(cr).push(s);
  }

  const plan = [];
  for (let cr = 0; cr < nRows; cr++) {
    const rowStrokes = byRow.get(cr) || [];
    const cardRow = card[cr] || [];
    let punched = 0;
    for (const h of cardRow) if (h) punched++;

    const patternRows = [];
    for (const m of map) {
      if (cr >= m.cardStartRow && cr <= m.cardEndRow && patternRows.indexOf(m.patternRow) === -1) {
        patternRows.push(m.patternRow);
      }
    }

    const directions = [];
    const types = [];
    let transferCount = 0;
    for (const s of rowStrokes) {
      const d = ARROW[s.direction] || '';
      if (d && directions.indexOf(d) === -1) directions.push(d);
      const label = CARRIAGE_LABEL[s.carriageType] || s.carriageType || '';
      if (label && types.indexOf(label) === -1) types.push(label);
      transferCount += (s.transfers && s.transfers.length) || 0;
    }

    // Warnings that live on one of this card row's pattern rows.
    const rowsSet = new Set(patternRows);
    const warnings = [];
    for (const it of probs) {
      if (!it || !Array.isArray(it.cells)) continue;
      if (it.cells.some(cell => cell && rowsSet.has(cell[0]))) {
        warnings.push({ title: it.title || 'Advisory', sev: it.sev || 'warn', where: it.where || '' });
      }
    }

    plan.push({
      cardRow: cr,
      label: `Row ${cr + 1}`,
      patternRows,
      passes: rowStrokes.length,
      directions,
      directionLabel: directions.join(' ') || '\u2014',
      types,
      typeLabel: types.join(' + ') || 'Knit',
      punched,
      width: cardRow.length,
      transferCount,
      warnings
    });
  }
  return plan;
}

/** Cells for every pattern row in a step, across the editor width (empty if none). */
export function rowHighlightCells(step, cols) {
  if (!step || !Array.isArray(step.patternRows) || !Number.isFinite(cols) || cols <= 0) return [];
  const cells = [];
  for (const r of step.patternRows) {
    for (let c = 0; c < cols; c++) cells.push([r, c]);
  }
  return cells;
}

/**
 * Mount the Knit-Along dock. Idempotent per document: a second call reuses nodes.
 *
 * @param {object} deps
 * @param {() => any} deps.getEditor        Live CanvasEditor (matrix, setHighlight).
 * @param {() => any} deps.getCompilation   Latest compilationResult (strokes/cardMatrix/rowMapping).
 * @param {() => Array<object>} [deps.getIssues] Advisor issues for per-row warnings.
 * @param {{info?:Function,warn?:Function}} [deps.notifications]
 * @returns {{toggle:Function, open:Function, close:Function, isOpen:Function, refresh:Function, destroy:Function, button:HTMLElement}}
 */
export function createKnitAlong(deps = {}) {
  const getEditor = deps.getEditor || (() => null);
  const getCompilation = deps.getCompilation || (() => null);
  const getIssues = deps.getIssues || (() => []);
  const notifier = deps.notifications || null;
  const diag = getDiagnostics().child('knit-along');

  injectStyles();

  const state = { index: 0, plan: [], follow: true };

  let button = document.getElementById(BUTTON_ID);
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = 'kx-hbtn';
    button.title = 'Knit-along row companion';
    button.setAttribute('aria-label', 'Open the row-by-row knit-along companion');
    button.innerHTML = '<span aria-hidden="true">\uD83E\uDDF6</span>';
    (document.querySelector('.brand-section') || document.body).appendChild(button);
  }

  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    const shell = buildPanel({
      id: PANEL_ID,
      className: 'kx-ka',
      glyph: '\uD83E\uDDF6',
      title: 'Knit-Along',
      pos: 'tr',
      stat: true,
      ariaLabel: 'Row-by-row knit-along companion',
      footHtml: '<label class="kx-ka-follow"><input type="checkbox" data-follow checked> Highlight the current row on the card</label>'
    });
    panel = shell.panel;
    shell.body.innerHTML = `
      <div class="kx-ka-nav">
        <button type="button" class="kx-btn kx-btn--ghost" data-start title="First row">\u23EE</button>
        <button type="button" class="kx-btn" data-prev title="Previous row">\u25C0 Prev</button>
        <button type="button" class="kx-btn kx-btn--primary" data-next title="Next row">Next \u25B6</button>
        <button type="button" class="kx-btn kx-btn--ghost" data-end title="Last row">\u23ED</button>
      </div>
      <div class="kx-ka-row" data-row></div>
      <div class="kx-ka-facts" data-facts></div>
      <div class="kx-ka-warn" data-warn></div>`;
    document.body.appendChild(panel);
  }

  const q = sel => panel.querySelector(sel);
  const els = {
    count: q('[data-count]'), row: q('[data-row]'), facts: q('[data-facts]'), warn: q('[data-warn]'),
    follow: q('[data-follow]')
  };

  let open = false;
  function isOpen() { return open; }
  function show() { panel.hidden = false; open = true; rebuild(); goto(state.index); }
  function hide() { panel.hidden = true; open = false; clearHighlight(); }
  function toggle() { open ? hide() : show(); }

  button.addEventListener('click', toggle);
  q('[data-close]').addEventListener('click', hide);

  function rebuild() {
    const comp = getCompilation() || {};
    state.plan = buildRowPlan({
      strokes: comp.strokes || [],
      cardMatrix: comp.cardMatrix || [],
      rowMapping: comp.rowMapping || [],
      issues: safeIssues(getIssues)
    });
    if (state.index >= state.plan.length) state.index = Math.max(0, state.plan.length - 1);
  }

  function clearHighlight() {
    try { getEditor()?.clearHighlight?.(); } catch (_) { /* contained */ }
  }

  function goto(i) {
    rebuild();
    if (!state.plan.length) {
      els.count.textContent = '';
      els.row.innerHTML = '<span class="kx-ka-empty">Nothing compiled yet — design a pattern first.</span>';
      els.facts.textContent = '';
      els.warn.textContent = '';
      return;
    }
    state.index = Math.max(0, Math.min(state.plan.length - 1, i));
    render();
  }

  function render() {
    const step = state.plan[state.index];
    const total = state.plan.length;
    els.count.textContent = `${state.index + 1} / ${total}`;
    els.row.innerHTML =
      `<span class="kx-ka-num">${esc(step.label)}</span>` +
      `<span class="kx-ka-of">of ${total} card rows</span>`;

    const facts = [
      `<span class="kx-ka-fact"><b>${esc(step.typeLabel)}</b> carriage</span>`,
      `<span class="kx-ka-fact">direction <b>${esc(step.directionLabel)}</b></span>`,
      `<span class="kx-ka-fact"><b>${step.punched}</b>/${step.width} needles in play</span>`
    ];
    if (step.transferCount > 0) facts.push(`<span class="kx-ka-fact"><b>${step.transferCount}</b> transfer${step.transferCount > 1 ? 's' : ''}</span>`);
    if (step.patternRows.length) facts.push(`<span class="kx-ka-fact">pattern row ${esc(step.patternRows.map(r => r + 1).join(', '))}</span>`);
    els.facts.innerHTML = facts.join('');

    if (step.warnings.length) {
      els.warn.className = 'kx-ka-warn kx-ka-warn--on';
      els.warn.innerHTML = '\u26A0 ' + step.warnings.map(w => esc(w.title) + (w.where ? ` <i>(${esc(w.where)})</i>` : '')).join(' &nbsp;·&nbsp; ');
    } else {
      els.warn.className = 'kx-ka-warn';
      els.warn.innerHTML = '<span class="kx-ka-clear">\u2713 This row is clear.</span>';
    }

    if (state.follow) {
      const ed = getEditor();
      const cols = ed && (ed.cols || (ed.matrix && ed.matrix[0] && ed.matrix[0].length));
      const cells = rowHighlightCells(step, cols);
      try {
        if (cells.length && ed.setHighlight) ed.setHighlight(cells, { label: step.label, color: '#38bdf8', fill: 'rgba(56,189,248,0.26)' });
        else clearHighlight();
      } catch (_) { /* contained */ }
    }
  }

  els.follow.addEventListener('change', () => {
    state.follow = !!els.follow.checked;
    if (!state.follow) clearHighlight();
    else render();
  });
  q('[data-prev]').addEventListener('click', () => goto(state.index - 1));
  q('[data-next]').addEventListener('click', () => goto(state.index + 1));
  q('[data-start]').addEventListener('click', () => goto(0));
  q('[data-end]').addEventListener('click', () => goto(state.plan.length - 1));

  function destroy() {
    clearHighlight();
    button.remove();
    panel.remove();
  }

  diag.info('knit-along panel mounted');
  return { toggle, open: show, close: hide, isOpen, refresh: () => { if (open) rebuild(); }, goto, destroy, button, panel };
}

function safeIssues(getIssues) {
  try { const a = getIssues(); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) { stylesInjected = true; return; }
  const css = `
  #kx-knitalong{width:300px;max-height:min(74vh,640px)}
  #kx-knitalong .kx-ka-nav{display:flex;gap:6px;margin:4px 0 8px}
  #kx-knitalong .kx-ka-nav .kx-btn{flex:1 1 auto}
  #kx-knitalong .kx-ka-row{display:flex;align-items:baseline;gap:8px;padding:8px 10px;border-radius:12px;
    background:linear-gradient(135deg,rgba(56,189,248,.16),rgba(56,189,248,.05));border:1px solid rgba(56,189,248,.34);margin-bottom:8px}
  #kx-knitalong .kx-ka-num{font-size:22px;font-weight:800;letter-spacing:.3px;color:#7dd3fc;font-variant-numeric:tabular-nums}
  #kx-knitalong .kx-ka-of{font-size:11px;color:var(--panel-muted)}
  #kx-knitalong .kx-ka-facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
  #kx-knitalong .kx-ka-fact{font-size:11px;color:var(--panel-text);background:rgba(2,6,23,.4);border:1px solid var(--panel-hairline);
    border-radius:8px;padding:3px 8px}
  #kx-knitalong .kx-ka-fact b{color:var(--accent-emerald)}
  #kx-knitalong .kx-ka-warn{font-size:12px;line-height:1.5;min-height:18px}
  #kx-knitalong .kx-ka-warn--on{color:#fca5a5}
  #kx-knitalong .kx-ka-warn i{color:var(--panel-muted);font-style:normal}
  #kx-knitalong .kx-ka-clear{color:var(--accent-emerald)}
  #kx-knitalong .kx-ka-empty{color:var(--panel-faint);font-style:italic}
  #kx-knitalong .kx-ka-follow{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--panel-muted);cursor:pointer}
  @media (max-width:640px){ #kx-knitalong{width:min(90vw,320px)} }
  `;
  try {
    const style = document.createElement('style');
    style.id = STYLE_ID; style.textContent = css;
    document.head.appendChild(style);
    stylesInjected = true;
  } catch (_) { stylesInjected = true; /* unstyled but functional is acceptable */ }
}
