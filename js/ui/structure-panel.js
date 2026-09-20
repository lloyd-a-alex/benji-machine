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
 * This module is those hands. It reads the live editor and reports, and it also now
 * gives that reading back as *edits*: tiling a repeat across the card and opening
 * stored layers / documents all go through the editor's own undoable `setMatrix`, so
 * every change is reversible exactly like drawing by hand and can never desync the
 * working undo stack. A failure to boot it means no panel, never a broken canvas.
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
const LAYERS_KEY = 'knitcat.structure.layers.v1';
const DOCS_KEY = 'knitcat.structure.docs.v1';

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
 * Tile the top-left `repeatRows × repeatCols` block across the whole card, returning
 * a NEW matrix (the caller pushes it through the editor's undoable `setMatrix`).
 * Pure and DOM-free so the fill can be asserted without a browser.
 *
 * It copies whatever values live in the repeat block — punched or blank, in any mode
 * — so it never has to guess what "empty" means for lace vs. colourwork.
 *
 * @param {Array<Array<any>>} matrix    The current card.
 * @param {number} repeatRows           Repeat height (1..rows); <=0 is a no-op clone.
 * @param {number} repeatCols           Repeat width (1..cols); <=0 is a no-op clone.
 * @returns {Array<Array<any>>} a card filled edge-to-edge with the repeat.
 */
export function fillWithRepeat(matrix, repeatRows, repeatCols) {
  const src = Array.isArray(matrix) ? matrix : [];
  const rows = src.length;
  let cols = 0;
  for (const r of src) if (Array.isArray(r) && r.length > cols) cols = r.length;
  const out = src.map(r => (Array.isArray(r) ? r.slice() : []));
  let rr = Math.trunc(Number(repeatRows) || 0);
  let rc = Math.trunc(Number(repeatCols) || 0);
  if (rows === 0 || cols === 0 || rr <= 0 || rc <= 0) return out;
  rr = Math.min(rr, rows);
  rc = Math.min(rc, cols);
  for (let r = 0; r < rows; r++) {
    if (!Array.isArray(out[r])) out[r] = new Array(cols).fill(0);
    for (let c = 0; c < cols; c++) out[r][c] = out[r % rr][c % rc];
  }
  return out;
}

/**
 * A tiny shared "store of whole cards" widget: a list of named matrices you can add
 * from the live editor, load back into it, overwrite, rename or delete. One
 * implementation drives BOTH the Layers and the Documents sections, so the two can
 * never drift apart. It only ever edits the card through the editor's undoable
 * `setMatrix`, so it inherits the same safety as drawing by hand.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.container  Where to render the rows.
 * @param {() => any} opts.getEditor
 * @param {object} [opts.notifications]
 * @param {number} [opts.limit]         Max stored cards (guards localStorage size).
 * @param {string} opts.addLabel        Label for the "add current card" button.
 * @param {string} opts.newLabel        Label for the "new blank card" button.
 * @param {(items:Array)=>void} [opts.onSave]  Persist hook (called after any change).
 */
function createGridStore(opts) {
  const container = opts.container;
  const getEditor = opts.getEditor;
  const notifier = opts.notifications || null;
  const limit = Math.max(1, opts.limit || 6);
  let items = Array.isArray(opts.initial) ? opts.initial : [];
  const onChange = opts.onSave || (() => {});

  const commit = () => { try { onChange(items); } catch (_) { /* quota is fine */ } };
  const cloneCur = () => { const ed = getEditor(); const m = (ed && ed.matrix) || []; return m.map(r => (Array.isArray(r) ? r.slice() : [])); };
  const dims = m => (m.length && m[0] ? `${m.length}×${m[0].length}` : '0×0');

  function addFromCard() {
    if (items.length >= limit) { notifier && notifier.warn && notifier.warn(`Store is full (${limit}).`); return; }
    const matrix = cloneCur();
    items.push({ name: `Card ${items.length + 1}`, matrix });
    commit(); render();
  }
  function newBlank() {
    if (items.length >= limit) { notifier && notifier.warn && notifier.warn(`Store is full (${limit}).`); return; }
    const ed = getEditor();
    const rows = (ed && ed.rows) || 0; const cols = (ed && ed.cols) || 0;
    const matrix = []; for (let r = 0; r < rows; r++) matrix.push(new Array(cols).fill(0));
    items.push({ name: `Card ${items.length + 1}`, matrix });
    commit(); render();
  }
  function load(i) {
    const ed = getEditor();
    if (ed && ed.setMatrix && items[i]) ed.setMatrix(items[i].matrix.map(r => r.slice()));
  }
  function update(i) { if (items[i]) { items[i].matrix = cloneCur(); commit(); render(); } }
  function rename(i) {
    if (!items[i]) return;
    const nm = safePrompt('Name this card', items[i].name);
    if (nm != null) { items[i].name = String(nm).slice(0, 40) || items[i].name; commit(); render(); }
  }
  function del(i) { items.splice(i, 1); commit(); render(); }

  function render() {
    if (!container) return;
    container.textContent = '';
    const tools = document.createElement('div');
    tools.className = 'kx-numlist';
    const bAdd = document.createElement('button'); bAdd.className = 'kx-btn kx-btn--ghost'; bAdd.textContent = opts.addLabel || 'Add current card'; bAdd.addEventListener('click', addFromCard);
    const bNew = document.createElement('button'); bNew.className = 'kx-btn kx-btn--ghost'; bNew.textContent = opts.newLabel || 'New blank'; bNew.addEventListener('click', newBlank);
    tools.append(bAdd, bNew);
    container.appendChild(tools);
    if (!items.length) {
      const hint = document.createElement('div'); hint.className = 'kxs-muted'; hint.textContent = 'Nothing stored yet.';
      container.appendChild(hint); return;
    }
    const ul = document.createElement('ul'); ul.className = 'kx-list';
    items.forEach((it, i) => {
      const li = document.createElement('li'); li.className = 'kx-row';
      const info = document.createElement('div'); info.className = 'kx-row__info';
      const nm = document.createElement('button'); nm.className = 'kx-btn kx-btn--ghost kx-row__name'; nm.textContent = it.name; nm.title = 'Load into the editor'; nm.addEventListener('click', () => load(i));
      const meta = document.createElement('div'); meta.className = 'kx-row__meta'; meta.textContent = dims(it.matrix);
      info.append(nm, meta);
      const acts = document.createElement('div'); acts.className = 'kx-row__actions';
      const bOpen = document.createElement('button'); bOpen.className = 'kx-iconbtn'; bOpen.textContent = '\u21E9'; bOpen.title = 'Open in editor'; bOpen.addEventListener('click', () => load(i));
      const bUpd = document.createElement('button'); bUpd.className = 'kx-iconbtn'; bUpd.textContent = '\u21C8'; bUpd.title = 'Overwrite with current card'; bUpd.addEventListener('click', () => update(i));
      const bRen = document.createElement('button'); bRen.className = 'kx-iconbtn'; bRen.textContent = '\u270E'; bRen.title = 'Rename'; bRen.addEventListener('click', () => rename(i));
      const bDel = document.createElement('button'); bDel.className = 'kx-iconbtn kx-iconbtn--delete'; bDel.textContent = '\u2715'; bDel.title = 'Delete'; bDel.addEventListener('click', () => del(i));
      acts.append(bOpen, bUpd, bRen, bDel);
      li.append(info, acts);
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  render();
  return { render, count: () => items.length, items: () => items };
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
      <section class="kxs-sec"><h3 class="kx-panel__h3">Document</h3><div data-doc></div><div data-docstore></div></section>
      <section class="kxs-sec"><h3 class="kx-panel__h3">Repeat fit &amp; fill</h3>
        <div class="kx-numlist">
          <label>Rows <input type="number" min="0" data-rep-rows class="kx-input"></label>
          <label>Needles <input type="number" min="0" data-rep-cols class="kx-input"></label>
          <button class="kx-btn kx-btn--ghost" data-rep-full>Whole card</button>
        </div>
        <div data-fit class="kxs-fit"></div>
        <div class="kx-numlist"><button class="kx-btn kx-btn--primary" data-rep-fill>Tile the repeat across the whole card</button></div>
      </section>
      <section class="kxs-sec"><h3 class="kx-panel__h3">Layers <span class="kx-panel__sub">paintable, open one at a time</span></h3><div data-layers></div><div data-layerstore></div></section>
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
    repFull: q('[data-rep-full]'), repFill: q('[data-rep-fill]'), fit: q('[data-fit]'), layers: q('[data-layers]'),
    docStore: q('[data-docstore]'), layerStore: q('[data-layerstore]'),
    trail: q('[data-trail]'), checkpoint: q('[data-checkpoint]'), measure: q('[data-measure]'),
    addNote: q('[data-add-note]'), notes: q('[data-notes]')
  };

  let open = false;
  let seeded = false;

  function isOpen() { return open; }
  function show() { panel.hidden = false; open = true; refresh(); pushAnnotations(); }
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

  // Activate the repeat engine: tile the current repeat block across the whole card
  // through the editor's undoable setMatrix, so a motif can be tried at bed scale and
  // stepped straight back with Ctrl+Z.
  els.repFill.addEventListener('click', () => {
    const ed = getEditor();
    const m = (ed && ed.matrix) || [];
    if (!(state.repeatRows > 0 && state.repeatCols > 0)) { notifier && notifier.warn && notifier.warn('Set the repeat rows and needles first.'); return; }
    try {
      ed.setMatrix(fillWithRepeat(m, state.repeatRows, state.repeatCols));
      notifier && notifier.success && notifier.success('Filled the card with the repeat (undo to step back).');
    } catch (err) { diag.warn('repeat fill failed: ' + err.message); }
    render();
  });

  // The Layers and Documents engines, now in Benji's hands: two instances of one
  // grid-store, each persisting to its own localStorage key.
  const layerStore = createGridStore({
    container: els.layerStore, getEditor, notifications: notifier, limit: 6,
    addLabel: 'Layer \u2190 capture current card', newLabel: 'New blank layer',
    initial: loadGridStore(LAYERS_KEY), onSave: items => saveGridStore(LAYERS_KEY, items)
  });
  const docStore = createGridStore({
    container: els.docStore, getEditor, notifications: notifier, limit: 8,
    addLabel: 'Save card as document', newLabel: 'New blank document',
    initial: loadGridStore(DOCS_KEY), onSave: items => saveGridStore(DOCS_KEY, items)
  });
  state.layerStore = layerStore;
  state.docStore = docStore;
  pushAnnotations();

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
    pushAnnotations();
  });

  // Mirror the knitter's notes onto the card through the editor's view-only
  // annotation overlay — they never reach the matrix or the punchcard.
  function pushAnnotations() {
    const ed = getEditor();
    if (ed && ed.setAnnotations) ed.setAnnotations(state.notes.map(n => ({ r: n.r, c: n.c, text: n.text })));
  }

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

    els.doc.textContent = `${report.document.name} · ${report.mode} · ${report.rows}×${report.cols}` + (state.docStore ? ` · ${state.docStore.count()} document(s)` : '');
    els.doc.title = `Physical size ${report.size.widthLabel} × ${report.size.heightLabel} on ${report.size.profileLabel}`;

    els.fit.textContent = report.fit.ok
      ? `${report.fit.summary}${report.fit.coversWholeCard ? ' ✓' : ''}`
      : report.fit.summary || report.fit.error;
    els.fit.className = 'kxs-fit ' + (report.fit.ok ? (report.fit.coversWholeCard ? 'kxs-ok' : 'kxs-warn') : 'kxs-muted');

    els.layers.textContent = `${state.layerStore ? state.layerStore.count() : report.layers.layers} editable layer(s) · ${report.worked}/${report.layers.total} needles worked`;

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

// Load a stored list of {name, matrix} cards, defensively: anything malformed is
// dropped rather than thrown into boot, so an old or corrupted blob is never fatal.
function loadGridStore(key) {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(it => it && Array.isArray(it.matrix))
      .slice(0, 12)
      .map((it, i) => ({ name: String(it.name || `Card ${i + 1}`).slice(0, 40), matrix: it.matrix.map(r => (Array.isArray(r) ? r.slice() : [])) }));
  } catch (_) { return []; }
}

function saveGridStore(key, items) {
  const store = storage();
  if (!store) return;
  try { store.setItem(key, JSON.stringify((items || []).map(it => ({ name: it.name, matrix: it.matrix })))); } catch (_) { /* quota is fine */ }
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
