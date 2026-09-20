/**
 * KNITCAT — Card Structure & Analysis panel.
 *
 * Five subsystems under `js/edit/` were built, tested and never wired to a hand:
 * `documents` (what a card *is*), `layers` (a stack of paintable grids), `guides`
 * (repeats and the "does it tile?" arithmetic), `history` (a branching undo tree)
 * and `annotations` (notes and dimensions that ride along as the card changes). The
 * engine for all of them exists and is exercised in `tests/editor-inspect.test.mjs`;
 * nothing under `js/` reached it, so the module-graph guard rightly reported them as
 * dead source.
 *
 * This module is those hands, and it is a *read-only consumer* by the same rule the
 * {@link module:ui/stitch-inspector} and {@link module:ui/clip-shelf} follow: it reads
 * the live editor and *reports* — it never touches the drawing matrix, never replaces
 * the working full-matrix undo stack, and can therefore never corrupt a card. A
 * failure to boot it means no panel, never a broken canvas.
 *
 * Two halves:
 *
 *   - {@link analyzeCard} is pure and DOM-free. It answers the two questions a punchcard
 *     knitter always asks — "how big is this on the bed, in mm?" and "does my repeat
 *     tile across the card?" — using the real subsystems (a layer stack composited back
 *     to one grid, a repeat tiled over the card, a normalised document). Being pure, it
 *     is asserted directly in `tests/structure-panel.test.mjs`.
 *   - {@link createStructurePanel} mounts a floating panel over that analysis and adds
 *     the two things that only make sense live: an edit *trail* maintained by an
 *     independent `history.js` tree that simply observes the card, and a hovered-cell
 *     *measurement / note* powered by `annotations.js`.
 *
 * Importing this module has no DOM side effects — every DOM touch happens inside
 * {@link createStructurePanel}, which the app boots under a guarded step.
 *
 * @module ui/structure-panel
 */

import { createDocument } from '../edit/documents.js';
import { createStack, stackInfo, composite } from '../edit/layers.js';
import { createRepeat, repeatTiles } from '../edit/guides.js';
import { pitchFor, gridSizeMm, formatLength } from '../edit/measure.js';
import { isPunched } from '../edit/modes.js';
import { createHistory } from '../edit/history.js';
import { addAnnotation, dimensionText, annotationSummary, sanitizeAnnotations } from '../edit/annotations.js';
import { getDiagnostics } from '../core/diagnostics.js';
import { buildPanel } from './kit.js';

const STYLE_ID = 'kx-structure-style';
const PANEL_ID = 'kx-structure';
const BUTTON_ID = 'kx-structure-btn';
const NOTES_KEY = 'knitcat.structure.notes.v1';

/**
 * Analyse a card with the structural subsystems. Pure and DOM-free so it can be
 * asserted against real matrices without a browser.
 *
 * @param {object} input
 * @param {Array<Array<any>>} [input.matrix] The editor's current grid.
 * @param {string} [input.mode]              Pattern mode id (lace | fair_isle | tuck | slip).
 * @param {any} [input.profile]              Machine profile (carries pitchX/pitchY, name).
 * @param {string} [input.name]              Card title for the document descriptor.
 * @param {{rows:number, cols:number}|null} [input.repeat] Repeat box to tile, or null.
 * @returns {{rows:number, cols:number, worked:number, document:object,
 *            size:object, layers:object, repeat:object|null, fit:object, mode:string}}
 */
export function analyzeCard({ matrix, mode = 'lace', profile = null, name = 'Untitled card', repeat = null } = {}) {
  const grid = Array.isArray(matrix) ? matrix : [];
  const rows = grid.length;
  let cols = 0;
  for (const row of grid) if (Array.isArray(row) && row.length > cols) cols = row.length;

  // A normalised document descriptor — the card as the multi-document engine sees it.
  const document = createDocument({
    name,
    mode,
    profileId: (profile && (profile.id || profile.profileId)) || null,
    rows,
    cols
  });

  // Physical size, in the hand: two numbers a knitter can act on.
  const pitch = pitchFor(profile || {});
  const size = gridSizeMm(rows, cols, pitch);
  size.widthLabel = formatLength(size.widthMm, 'mm');
  size.heightLabel = formatLength(size.heightMm, 'mm');
  size.profileLabel = (profile && (profile.gauge || profile.name)) || 'Standard (4.5mm)';

  // Model the card as a one-layer stack and composite it back down. This is the real
  // layers.js pipeline (blank-derived-from-mode, topmost-non-blank-wins), not a
  // reimplementation, so the "worked" count can never disagree with the editor.
  const stack = createStack({ rows, cols, mode, name });
  if (rows > 0 && cols > 0) stack.layers[0].matrix = grid.map(row => (Array.isArray(row) ? row.slice() : []));
  const layers = stackInfo(stack);
  const comp = composite(stack);
  let worked = 0;
  for (const row of comp.matrix) {
    for (const value of row) if (isPunched(mode, value)) worked++;
  }
  layers.worked = worked;
  layers.total = rows * cols;

  // Repeat fit — the first question of machine design: does it tile the bed?
  let fit = { ok: false, error: 'No repeat set.', across: 0, down: 0, tiles: [], summary: 'Set a repeat to see how it tiles.' };
  let normalized = null;
  if (repeat && Number(repeat.rows) > 0 && Number(repeat.cols) > 0) {
    const rr = Math.trunc(Number(repeat.rows));
    const rc = Math.trunc(Number(repeat.cols));
    normalized = createRepeat({ r1: 0, c1: 0, r2: rr - 1, c2: rc - 1, name: 'Repeat' });
    fit = repeatTiles(normalized, rows, cols);
  }

  return { rows, cols, worked, document, size, layers, repeat: normalized, fit, mode };
}

/**
 * Mount the Card Structure panel. Idempotent per document: a second call reuses nodes.
 *
 * @param {object} deps
 * @param {() => any} deps.getEditor     Live CanvasEditor (matrix, hoverCell, canvas).
 * @param {() => string} deps.getMode    Current pattern mode id.
 * @param {() => any} deps.getProfile    Current machine profile.
 * @param {() => string} [deps.getName]  Current card title.
 * @param {{info?:Function,warn?:Function}} [deps.notifications]
 * @returns {{toggle:Function, open:Function, close:Function, isOpen:Function, refresh:Function, destroy:Function, button:HTMLElement}}
 */
export function createStructurePanel(deps = {}) {
  const getEditor = deps.getEditor || (() => null);
  const getMode = deps.getMode || (() => 'lace');
  const getProfile = deps.getProfile || (() => null);
  const getName = deps.getName || (() => 'Untitled card');
  const notifier = deps.notifications || null;
  const diag = getDiagnostics().child('structure');

  injectStyles();

  // Panel-local repeat box, seeded from the card so the first render is meaningful.
  const state = { repeatRows: 0, repeatCols: 0, notes: loadNotes(), lastTrailMatrix: null, trail: null };

  let button = document.getElementById(BUTTON_ID);
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = 'kx-hbtn';
    button.title = 'Card structure & analysis';
    button.setAttribute('aria-label', 'Open the card structure and analysis panel');
    button.innerHTML = '<span aria-hidden="true">🗂️</span>';
    (document.querySelector('.brand-section') || document.body).appendChild(button);
  }

  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    const shell = buildPanel({
      id: PANEL_ID,
      className: 'kx-struct',
      glyph: '🗂️',
      title: 'Card Structure',
      pos: 'tr',
      stat: false,
      ariaLabel: 'Card structure and analysis'
    });
    panel = shell.panel;
    shell.body.innerHTML = `
      <section class="kxs-sec"><h3 class="kx-panel__h3">Document</h3><div data-doc></div></section>
      <section class="kxs-sec"><h3 class="kx-panel__h3">Repeat fit</h3>
        <div class="kx-numlist">
          <label>Rows <input type="number" min="0" data-rep-rows class="kx-input"></label>
          <label>Needles <input type="number" min="0" data-rep-cols class="kx-input"></label>
          <button class="kx-btn kx-btn--ghost" data-rep-full>Whole card</button>
        </div>
        <div data-fit class="kxs-fit"></div>
      </section>
      <section class="kxs-sec"><h3 class="kx-panel__h3">Layers</h3><div data-layers></div></section>
      <section class="kxs-sec"><h3 class="kx-panel__h3">Edit trail</h3>
        <div data-trail></div>
        <button class="kx-btn kx-btn--ghost" data-checkpoint>Checkpoint current state</button>
      </section>
      <section class="kxs-sec"><h3 class="kx-panel__h3">Measurement</h3><div data-measure></div></section>
      <section class="kxs-sec"><h3 class="kx-panel__h3">Notes <button class="kx-btn kx-btn--ghost" data-add-note>Add note at hover</button></h3>
        <ul data-notes class="kx-list"></ul>
      </section>`;
    document.body.appendChild(panel);
  }

  const q = sel => panel.querySelector(sel);
  const els = {
    doc: q('[data-doc]'), repRows: q('[data-rep-rows]'), repCols: q('[data-rep-cols]'),
    repFull: q('[data-rep-full]'), fit: q('[data-fit]'), layers: q('[data-layers]'),
    trail: q('[data-trail]'), checkpoint: q('[data-checkpoint]'), measure: q('[data-measure]'),
    addNote: q('[data-add-note]'), notes: q('[data-notes]')
  };

  let open = false;
  let seeded = false;

  function isOpen() { return open; }
  function show() { panel.hidden = false; open = true; refresh(); }
  function hide() { panel.hidden = true; open = false; }
  function toggle() { open ? hide() : show(); }

  button.addEventListener('click', toggle);
  q('[data-close]').addEventListener('click', hide);

  function readRepeat() {
    const rows = Math.trunc(Number(els.repRows.value)) || 0;
    const cols = Math.trunc(Number(els.repCols.value)) || 0;
    state.repeatRows = rows;
    state.repeatCols = cols;
  }
  els.repRows.addEventListener('input', () => { readRepeat(); render(); });
  els.repCols.addEventListener('input', () => { readRepeat(); render(); });
  els.repFull.addEventListener('click', () => {
    const ed = getEditor();
    const m = (ed && ed.matrix) || [];
    els.repRows.value = m.length || 0;
    els.repCols.value = m.length && m[0] ? m[0].length : 0;
    readRepeat();
    render();
  });

  els.checkpoint.addEventListener('click', () => {
    const name = safePrompt('Checkpoint label', `checkpoint ${new Date().toLocaleTimeString()}`);
    if (!state.trail || name === null) return;
    try {
      state.trail.checkpoint(String(name).slice(0, 60) || 'checkpoint');
      render();
      notifier && notifier.info && notifier.info('Checkpoint added to the edit trail.');
    } catch (err) { diag.warn('checkpoint failed: ' + err.message); }
  });

  els.addNote.addEventListener('click', () => {
    const ed = getEditor();
    const hc = ed && ed.hoverCell;
    if (!hc || hc.r < 0 || hc.c < 0) { notifier && notifier.warn && notifier.warn('Hover a needle first.'); return; }
    const text = safePrompt('Note for this cell', '');
    if (text === null) return;
    const rows = (ed.matrix && ed.matrix.length) || Infinity;
    const cols = (ed.matrix && ed.matrix[0] && ed.matrix[0].length) || Infinity;
    addAnnotation(state.notes, 'note', { r: hc.r, c: hc.c, text: text || '' });
    const clean = sanitizeAnnotations(state.notes, { rows, cols });
    state.notes = clean.annotations;
    saveNotes(state.notes);
    render();
  });

  /** Recompute the analysis + trail and repaint. Cheap enough to poll while open. */
  function refresh() {
    const ed = getEditor();
    if (!ed) return;
    const matrix = ed.matrix || [];
    if (!seeded) {
      els.repRows.value = matrix.length || 0;
      els.repCols.value = matrix.length && matrix[0] ? matrix[0].length : 0;
      readRepeat();
      seeded = true;
    }
    observeHistory(matrix);
    render();
  }

  // An independent history tree that simply watches the card. It never drives the
  // editor's own undo — it only records where you have been, so the panel can show a
  // real branching trail (the abandoned branches included).
  function observeHistory(matrix) {
    const mode = getMode();
    const sig = signature(matrix);
    if (!state.trail) {
      state.trail = createHistory({ matrix: clone(matrix), mode, label: 'opened' });
      state.lastTrailMatrix = sig;
      return;
    }
    if (sig === state.lastTrailMatrix) return;
    state.trail.commit({ matrix: clone(matrix), label: 'edit' });
    state.lastTrailMatrix = sig;
  }

  function render() {
    const ed = getEditor();
    if (!ed) return;
    const report = analyzeCard({
      matrix: ed.matrix,
      mode: getMode(),
      profile: getProfile(),
      name: getName(),
      repeat: state.repeatRows > 0 && state.repeatCols > 0 ? { rows: state.repeatRows, cols: state.repeatCols } : null
    });

    els.doc.textContent = `${report.document.name} · ${report.mode} · ${report.rows}×${report.cols}`;
    els.doc.title = `Physical size ${report.size.widthLabel} × ${report.size.heightLabel} on ${report.size.profileLabel}`;

    els.fit.textContent = report.fit.ok
      ? `${report.fit.summary}${report.fit.coversWholeCard ? ' ✓' : ''}`
      : report.fit.summary || report.fit.error;
    els.fit.className = 'kxs-fit ' + (report.fit.ok ? (report.fit.coversWholeCard ? 'kxs-ok' : 'kxs-warn') : 'kxs-muted');

    els.layers.textContent = `${report.layers.layers} layer(s), ${report.layers.visible} visible · ${report.worked}/${report.layers.total} needles worked`;

    if (state.trail) {
      const nodes = state.trail.nodes ? state.trail.nodes.size : state.trail.tree().length;
      const cps = (state.trail.checkpoints ? state.trail.checkpoints() : []).length;
      els.trail.textContent = `${nodes} state(s) recorded · ${cps} checkpoint(s) · undo ${state.trail.canUndo() ? 'yes' : 'no'}`;
    }

    renderMeasure(ed);
    renderNotes();
  }

  // A live dimension from the card origin to the hovered cell, via annotations.js.
  function renderMeasure(ed) {
    const hc = ed.hoverCell;
    if (!hc || hc.r < 0 || hc.c < 0) { els.measure.textContent = 'Hover a needle to measure from the card origin.'; return; }
    const profile = getProfile() || {};
    const ann = { kind: 'dimension', r: 0, c: 0, end: { r: hc.r, c: hc.c }, follow: 'cell' };
    const dm = dimensionText({ ...ann, from: { r: 0, c: 0 } }, profile);
    const rows = hc.r + 1;
    const cols = hc.c + 1;
    const mm = gridSizeMm(rows, cols, pitchFor(profile));
    els.measure.textContent = `Row ${rows} · Needle ${cols} — ${mm.widthLabel} × ${mm.heightLabel} from origin${dm && dm.text ? ' · ' + dm.text : ''}`;
  }

  function renderNotes() {
    els.notes.textContent = '';
    if (!state.notes.length) {
      const li = document.createElement('li');
      li.className = 'kxs-muted';
      li.textContent = 'No notes yet.';
      els.notes.appendChild(li);
      return;
    }
    for (const note of state.notes) {
      const li = document.createElement('li');
      const s = annotationSummary(note);
      li.textContent = `${s.where} — ${s.text || s.kind}`;
      els.notes.appendChild(li);
    }
  }

  const timer = setInterval(() => { if (open) { const ed = getEditor(); if (ed) observeHistory(ed.matrix || []); } }, 500);

  function destroy() {
    clearInterval(timer);
    button.remove();
    panel.remove();
  }

  diag.info('structure panel mounted');
  return { toggle, open: show, close: hide, isOpen, refresh, destroy, button, panel };
}

/* ── module-private helpers (all DOM/localStorage use is after boot) ─────────── */

function clone(matrix) {
  return (Array.isArray(matrix) ? matrix : []).map(row => (Array.isArray(row) ? row.slice() : []));
}

// A cheap, order-sensitive digest of the card so the trail only commits on a real
// change. It does not have to be cryptographic — it only has to differ whenever the
// visible card does, which this scan guarantees for the grid sizes we handle.
function signature(matrix) {
  const rows = matrix.length;
  if (!rows) return '0:0';
  const cols = matrix[0].length;
  let h = rows * 100003 + cols;
  for (let r = 0; r < rows; r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < row.length; c++) h = (h * 31 + String(row[c]).length + c + r) | 0;
  }
  return `${rows}x${cols}:${h}`;
}

function safePrompt(title, value) {
  try { return typeof window !== 'undefined' && window.prompt ? window.prompt(title, value) : null; } catch (_) { return null; }
}

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

function loadNotes() {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(NOTES_KEY);
    if (!raw) return [];
    const clean = sanitizeAnnotations(JSON.parse(raw), {});
    return clean.annotations;
  } catch (_) { return []; }
}

function saveNotes(notes) {
  const store = storage();
  if (!store) return;
  try { store.setItem(NOTES_KEY, JSON.stringify(notes.map(n => ({ kind: n.kind, r: n.r, c: n.c, text: n.text })))); } catch (_) { /* quota is fine */ }
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) { stylesInjected = true; return; }
  const css = `
  #kx-structure{width:288px;max-height:min(72vh,620px)}
  #kx-structure .kxs-sec{padding:2px 0 6px;margin-bottom:6px;border-bottom:1px solid var(--panel-hairline)}
  #kx-structure .kxs-sec:last-child{border-bottom:none}
  #kx-structure .kxs-fit{font-variant-numeric:tabular-nums}
  #kx-structure .kxs-ok{color:var(--accent-emerald)}
  #kx-structure .kxs-warn{color:var(--accent-amber)}
  #kx-structure .kxs-muted{color:var(--panel-muted)}
  #kx-structure [data-doc],#kx-structure [data-layers],#kx-structure [data-trail],#kx-structure [data-measure]{color:var(--panel-text)}
  @media (max-width:640px){ #kx-structure{width:min(90vw,300px)} }
  `;
  try {
    const style = document.createElement('style');
    style.id = STYLE_ID; style.textContent = css;
    document.head.appendChild(style);
    stylesInjected = true;
  } catch (_) { stylesInjected = true; /* unstyled but functional is acceptable */ }
}
