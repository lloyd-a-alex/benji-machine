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
  const state = { repeatRows: 0, repeatCols: 0, notes: loadNotes() };

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
      <section class="kxs-sec"><h3 class="kx-panel__h3">Layers <span class="kx-panel__sub">the card is their composite</span></h3>
        <div data-layers class="kxs-muted"></div>
        <div class="kx-numlist">
          <button class="kx-btn kx-btn--primary" data-layer-add>\u271a New layer</button>
          <button class="kx-btn kx-btn--ghost" data-layer-merge>Merge down</button>
          <button class="kx-btn kx-btn--ghost" data-layer-flatten>Flatten</button>
        </div>
        <div data-layermgr class="kx-layers"></div>
      </section>
      <section class="kxs-sec"><h3 class="kx-panel__h3">Edit trail <span class="kx-panel__sub">branches &amp; checkpoints</span></h3>
        <div data-trail class="kxs-muted"></div>
        <div class="kx-numlist">
          <button class="kx-btn kx-btn--primary" data-undo>\u21b6 Undo</button>
          <button class="kx-btn kx-btn--ghost" data-redo>Redo \u21b7</button>
          <button class="kx-btn kx-btn--ghost" data-checkpoint>\u2691 Checkpoint</button>
        </div>
        <ul data-branch class="kx-branch"></ul>
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
    docStore: q('[data-docstore]'), layerMgr: q('[data-layermgr]'),
    layerAdd: q('[data-layer-add]'), layerMerge: q('[data-layer-merge]'), layerFlatten: q('[data-layer-flatten]'),
    trail: q('[data-trail]'), branch: q('[data-branch]'), undo: q('[data-undo]'), redo: q('[data-redo]'),
    checkpoint: q('[data-checkpoint]'), measure: q('[data-measure]'),
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

  // Documents stay a stored list of whole cards; the Layers section is now the
  // editor's *real* stack — every control calls an editor method that commits one
  // undoable step, so the panel and the canvas can never disagree about the card.
  const docStore = createGridStore({
    container: els.docStore, getEditor, notifications: notifier, limit: 8,
    addLabel: 'Save card as document', newLabel: 'New blank document',
    initial: loadGridStore(DOCS_KEY), onSave: items => saveGridStore(DOCS_KEY, items)
  });
  state.docStore = docStore;
  pushAnnotations();

  els.layerAdd.addEventListener('click', () => {
    const ed = getEditor();
    if (!ed || !ed.addNewLayer) return;
    try { ed.addNewLayer({ name: `Layer ${ed.getLayers().length + 1}`, kind: 'pattern' }); } catch (err) { diag.warn('add layer: ' + err.message); }
  });
  els.layerMerge.addEventListener('click', () => {
    const ed = getEditor();
    const active = ed && ed.getLayers && ed.getLayers().find(l => l.active);
    if (!ed || !active) { notifier && notifier.warn && notifier.warn('No active layer to merge.'); return; }
    try { const r = ed.mergeLayerDown(active.id); if (r && !r.ok && notifier) notifier.warn(r.error || 'Cannot merge the bottom layer.'); } catch (err) { diag.warn('merge: ' + err.message); }
  });
  els.layerFlatten.addEventListener('click', () => {
    const ed = getEditor();
    if (!ed || !ed.flattenLayers) return;
    try { ed.flattenLayers(); } catch (err) { diag.warn('flatten: ' + err.message); }
  });

  els.checkpoint.addEventListener('click', () => {
    const ed = getEditor();
    if (!ed || !ed.addCheckpoint) return;
    const name = safePrompt('Checkpoint label', `checkpoint ${new Date().toLocaleTimeString()}`);
    if (name === null) return;
    try {
      ed.addCheckpoint(String(name).slice(0, 60) || 'checkpoint');
      notifier && notifier.info && notifier.info('Checkpoint added to the edit trail.');
    } catch (err) { diag.warn('checkpoint failed: ' + err.message); }
  });

  els.undo.addEventListener('click', () => { const ed = getEditor(); try { ed && ed.undo && ed.undo(); } catch (err) { diag.warn('undo: ' + err.message); } });
  els.redo.addEventListener('click', () => { const ed = getEditor(); try { ed && ed.redo && ed.redo(); } catch (err) { diag.warn('redo: ' + err.message); } });

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

  /** Recompute the analysis and repaint. Cheap enough to poll while open. */
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
    render();
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

    els.layers.textContent = `${report.worked}/${report.layers.total} needles worked`;

    renderLayers(ed);
    renderBranch(ed);

    renderMeasure(ed);
    renderNotes();
  }

  /**
   * Paint the editor's real layer stack: one row per layer with select / rename /
   * visibility / lock toggles, an opacity slider (committed on release so a drag is
   * one undo step), a kind dropdown, and up/down/merge/delete per row. Every control
   * calls an editor method that commits, so the canvas and this list never diverge.
   */
  function renderLayers(ed) {
    if (!els.layerMgr || !ed.getLayers) return;
    const layers = ed.getLayers();
    els.layerMgr.textContent = '';
    if (!layers.length) {
      const hint = document.createElement('div');
      hint.className = 'kxs-muted';
      hint.textContent = 'No layers yet.';
      els.layerMgr.appendChild(hint);
      return;
    }
    // Topmost layer first, so it reads the way the composite is stacked visually.
    [...layers].reverse().forEach(layer => {
      const row = document.createElement('div');
      row.className = 'kx-layer' + (layer.active ? ' kx-layer--active' : '');

      const head = document.createElement('div');
      head.className = 'kx-layer__head';
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'kx-layer__name';
      pick.textContent = layer.name;
      pick.title = 'Make this the active (drawing) layer';
      pick.addEventListener('click', () => { ed.setActiveLayer(layer.id); });
      const vis = document.createElement('button');
      vis.type = 'button';
      vis.className = 'kx-iconbtn';
      vis.textContent = layer.visible ? '\ud83d\udc41' : '\u2298';
      vis.title = layer.visible ? 'Hide layer' : 'Show layer';
      vis.addEventListener('click', () => { ed.toggleLayerVisibleById(layer.id); });
      const lock = document.createElement('button');
      lock.type = 'button';
      lock.className = 'kx-iconbtn' + (layer.locked ? ' kx-layer__lock--on' : '');
      lock.textContent = layer.locked ? '\ud83d\udd12' : '\ud83d\udd13';
      lock.title = layer.locked ? 'Unlock layer' : 'Lock layer';
      lock.addEventListener('click', () => { ed.setLayerLockedById(layer.id, !layer.locked); });
      head.append(pick, vis, lock);

      const tools = document.createElement('div');
      tools.className = 'kx-layer__tools';
      const up = mkIconBtn('\u25b2', 'Move up', () => ed.moveLayerById(layer.id, 1));
      const down = mkIconBtn('\u25bc', 'Move down', () => ed.moveLayerById(layer.id, -1));
      const ren = mkIconBtn('\u270e', 'Rename', () => {
        const nm = safePrompt('Layer name', layer.name);
        if (nm != null) ed.renameLayerById(layer.id, String(nm).slice(0, 40) || layer.name);
      });
      const del = mkIconBtn('\u2715', 'Delete layer', () => {
        const r = ed.removeLayerById(layer.id);
        if (r && !r.ok && notifier) notifier.warn(r.error || 'Cannot delete the only layer.');
      });
      del.classList.add('kx-iconbtn--delete');
      tools.append(up, down, ren, del);

      const meta = document.createElement('div');
      meta.className = 'kx-layer__meta';
      const op = document.createElement('input');
      op.type = 'range'; op.min = '0'; op.max = '1'; op.step = '0.05';
      op.value = String(layer.opacity == null ? 1 : layer.opacity);
      op.title = 'Layer opacity'; op.setAttribute('aria-label', `Opacity of ${layer.name}`);
      op.addEventListener('change', () => { ed.setLayerOpacityById(layer.id, Number(op.value)); });
      const kind = document.createElement('select');
      kind.setAttribute('aria-label', `Kind of ${layer.name}`);
      for (const k of ['pattern', 'reference', 'annotation']) {
        const opt = document.createElement('option');
        opt.value = k; opt.textContent = k;
        if (layer.kind === k) opt.selected = true;
        kind.appendChild(opt);
      }
      kind.addEventListener('change', () => { ed.setLayerKindById(layer.id, kind.value); });
      meta.append(op, kind);

      row.append(head, tools, meta);
      els.layerMgr.appendChild(row);
    });
  }

  /**
   * The branching undo tree, straight from the editor. Each row is a state,
   * indented by depth; the current one is marked. Click jumps the editor there
   * (undo/redo/redraw), right-click deletes that branch (refused on the node in
   * view — the tree guards that itself). No separate observer, so it is always the
   * true trail.
   */
  function renderBranch(ed) {
    if (!els.branch) return;
    const rows = typeof ed.historyRows === 'function' ? ed.historyRows() : [];
    const stats = typeof ed.historyStats === 'function' ? ed.historyStats() : null;
    els.trail.textContent = stats
      ? `${stats.nodes} state(s) \u00b7 ${stats.checkpoints} checkpoint(s) \u00b7 depth ${stats.depth}`
      : `${rows.length} state(s)`;
    els.branch.textContent = '';
    for (const node of rows) {
      const li = document.createElement('li');
      li.className = 'kx-branch__row' + (node.current ? ' kx-branch__row--current' : '') + (node.checkpoint ? ' kx-branch__row--cp' : '');
      li.style.marginLeft = `${node.depth * 12}px`;
      li.textContent = (node.checkpoint ? '\u2691 ' : '') + (node.label || 'edit') + ` \u00b7 ${node.cells} cell(s)`;
      li.title = 'Jump to this state';
      li.tabIndex = 0;
      li.addEventListener('click', () => { ed.jumpHistory(node.id); });
      li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ed.jumpHistory(node.id); } });
      li.addEventListener('contextmenu', e => {
        e.preventDefault();
        const r = ed.deleteHistoryBranch(node.id);
        if (r && !r.ok && notifier) notifier.warn(r.error || 'Cannot delete that branch.');
      });
      els.branch.appendChild(li);
    }
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'kxs-muted';
      li.textContent = 'No history yet.';
      els.branch.appendChild(li);
    }
  }

  function mkIconBtn(text, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kx-iconbtn';
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    return b;
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

  // Keep the panel live while open: undo/redo driven from the menubar or keyboard
  // never routes through here, so poll the editor's own tree rather than a mirror.
  const timer = setInterval(() => { if (open) render(); }, 500);

  function destroy() {
    clearInterval(timer);
    button.remove();
    panel.remove();
  }

  diag.info('structure panel mounted');
  return { toggle, open: show, close: hide, isOpen, refresh, destroy, button, panel };
}

/* ── module-private helpers (all DOM/localStorage use is after boot) ─────────── */

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
  #kx-structure .kx-layers{display:flex;flex-direction:column;gap:5px;margin-top:4px}
  #kx-structure .kx-layer{border:1px solid var(--panel-hairline);border-radius:8px;padding:5px 6px;display:flex;flex-direction:column;gap:4px}
  #kx-structure .kx-layer--active{border-color:var(--accent-sky);background:color-mix(in srgb,var(--accent-sky) 12%,transparent)}
  #kx-structure .kx-layer__head{display:flex;align-items:center;gap:4px}
  #kx-structure .kx-layer__name{flex:1 1 auto;text-align:left;background:none;border:none;color:var(--panel-text);cursor:pointer;font-weight:600;padding:0}
  #kx-structure .kx-layer__lock--on{opacity:.6}
  #kx-structure .kx-layer__tools{display:flex;gap:4px}
  #kx-structure .kx-layer__meta{display:flex;align-items:center;gap:8px}
  #kx-structure .kx-layer__meta input[type=range]{flex:1 1 auto;min-width:0}
  #kx-structure .kx-layer__meta select{font:inherit;font-size:11px;background:var(--panel-bg);color:var(--panel-text);border:1px solid var(--panel-hairline);border-radius:6px;padding:2px 4px}
  #kx-structure .kx-branch{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:2px;max-height:180px;overflow:auto}
  #kx-structure .kx-branch__row{font-size:11px;color:var(--panel-text);padding:3px 6px;border-radius:6px;cursor:pointer;border:1px solid transparent}
  #kx-structure .kx-branch__row:hover{background:color-mix(in srgb,var(--panel-text) 8%,transparent)}
  #kx-structure .kx-branch__row--current{border-color:var(--accent-sky);background:color-mix(in srgb,var(--accent-sky) 14%,transparent)}
  #kx-structure .kx-branch__row--cp{font-weight:700}
  @media (forced-colors:active){ #kx-structure .kx-layer,#kx-structure .kx-branch__row{border-color:CanvasText} }
  @media (max-width:640px){ #kx-structure{width:min(90vw,300px)} }
  `;
  try {
    const style = document.createElement('style');
    style.id = STYLE_ID; style.textContent = css;
    document.head.appendChild(style);
    stylesInjected = true;
  } catch (_) { stylesInjected = true; /* unstyled but functional is acceptable */ }
}
