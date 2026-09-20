/**
 * The Studio — KNITCAT's project hub, the screen that answers "what am I making,
 * and how far have I got?" (the top of the triple-A audit's "why" list).
 *
 * It is intentionally a *client* of the pieces that already exist rather than a
 * new silo:
 *   - persistence rides the shared storage drivers (project/storage.js) and the
 *     PROJECTS object store, so IndexedDB / localStorage / memory all just work
 *     and nothing new is bolted onto the save path;
 *   - the data it moves around is the Project superstructure (project/project-model.js),
 *     so a project card's progress bar and "row 84 of 142" resume line are the
 *     same arithmetic the rest of the app uses;
 *   - the little punchcard on every card is drawn by the exact same ui/thumbnail
 *     renderer the bottom taskbar uses, so a project is one picture in both places;
 *   - the live editor chart is injected via callbacks (getChart / loadChart), so
 *     this module never reaches into the app and never breaks if it is absent.
 *
 * DOM-free at import: every browser touch lives inside exported functions, so
 * `node --test` can import this file with no window/document defined.
 */

import { openDriver, STORES } from '../project/storage.js';
import { Project, summarizeProject, newChart } from '../project/project-model.js';
import { previewMatrix, renderThumbnail } from '../ui/thumbnail.js';
import { escHtml as _esc } from '../ui/text.js';

const LIVE_CHART = 'live';
const ACTIVE_KEY = 'knitcad.activeProject.v1';
const THUMB_BOX = 72; // px square of each dashboard thumbnail

let _opts = {};
let _driverP = null;
let _activeId = null;
let _modal = null;
let _sort = 'recent';

function _driver() {
  if (!_driverP) _driverP = openDriver({ logger: _opts.logger || console });
  return _driverP.then(r => r.driver);
}

function _ls() { return _opts.localStorage ?? (typeof globalThis !== 'undefined' ? globalThis.localStorage : null); }
function _rememberActive(id) {
  try { _ls()?.setItem(ACTIVE_KEY, id || ''); } catch (_) { /* private mode */ }
}
function _recallActive() {
  try { return _ls()?.getItem(ACTIVE_KEY) || null; } catch (_) { return null; }
}

// ─── persistence (all through the shared driver; nothing is re-invented) ───────

export async function listProjects() {
  let raw = [];
  try { raw = (await (await _driver()).getAll(STORES.PROJECTS)) || []; } catch (_) { raw = []; }
  const projects = [];
  for (const item of raw) {
    const { project } = Project.fromJSON(item);
    if (project) projects.push(project);
  }
  projects.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return projects;
}

async function _save(p) {
  p.touch();
  try { await (await _driver()).put(STORES.PROJECTS, p.toJSON(), p.id); } catch (_) { /* quota: still usable this session */ }
  _activeId = p.id;
  _rememberActive(p.id);
  _renderResume();
  return p;
}

async function removeProject(id) {
  try { await (await _driver()).delete(STORES.PROJECTS, id); } catch (_) { /* gone either way */ }
  if (_activeId === id) { _activeId = null; _rememberActive(null); }
}

/** Rename a project in place; a cancelled prompt changes nothing. */
async function renameProject(id) {
  const p = (await listProjects()).find(x => x.id === id);
  if (!p) return null;
  let typed = null;
  try {
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      typed = window.prompt('Rename project', p.name);
    }
  } catch (_) { typed = null; /* prompt unavailable: treat as cancelled */ }
  if (typed == null) return p; // cancelled
  const name = String(typed).trim().slice(0, 200);
  if (name) { p.name = name; await _save(p); }
  return p;
}

/** Duplicate a project — a full deep copy under a fresh id, named "… copy". */
async function duplicateProject(id) {
  const p = (await listProjects()).find(x => x.id === id);
  if (!p) return null;
  const fresh = Project.fromJSON(Object.assign({}, p.toJSON(), { id: null })).project;
  if (!fresh) return null;
  fresh.name = `${(p.name || 'Project').slice(0, 190)} copy`;
  return _save(fresh);
}

/**
 * Fold the current editor chart into a project and persist it — the "don't lose
 * my place" save. Creates the project / garment / piece on first call so the
 * progress numbers have something honest to divide.
 */
export async function commitCurrentChart() {
  const chart = _opts.getChart?.();
  if (!chart || !Array.isArray(chart.matrix) || !chart.matrix.length) return null;
  let p = _activeId ? (await listProjects()).find(x => x.id === _activeId) : null;
  if (!p) p = Project.create({ name: chart.name || 'Untitled project', machine: chart.profileId || null });

  let c = p.charts.find(x => x.id === LIVE_CHART);
  if (!c) {
    c = newChart({ id: LIVE_CHART, name: 'Current chart', mode: chart.mode || null, rows: chart.rows || chart.matrix.length, cols: chart.cols || (chart.matrix[0] || []).length, cells: chart.matrix });
    p.charts.push(c);
  } else {
    c.rows = chart.rows || chart.matrix.length;
    c.cols = chart.cols || (chart.matrix[0] || []).length;
    c.cells = chart.matrix;
    if (chart.mode) c.mode = chart.mode;
  }
  if (!p.garments.length) {
    const g = p.addGarment({ name: 'Main' });
    p.addPiece(g.id, { name: 'Front', chartId: LIVE_CHART, totalRows: c.rows, currentRow: 0 });
  }
  return _save(p);
}

async function openProject(p) {
  const c = p.charts.find(x => x.id === LIVE_CHART) || p.charts[0];
  _activeId = p.id;
  _rememberActive(p.id);
  if (c && Array.isArray(c.cells) && c.cells.length && _opts.loadChart) {
    _opts.loadChart({ cells: c.cells, mode: c.mode, profileId: p.machine, name: p.name });
  }
  _renderResume();
  return p;
}

/** Open a project by id (used by the taskbar and command palette). */
async function openProjectById(id) {
  const p = (await listProjects()).find(x => x.id === id);
  if (!p) return null;
  return openProject(p);
}

/** Prompt for a name and start a fresh, empty project (the menu "New project"). */
async function createNew() {
  // Some contexts block window.prompt (automation, embedded frames); never let a
  // name prompt reject the whole create — fall back to the default title instead.
  let name = 'Untitled project';
  try {
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      const typed = window.prompt('Project name', name);
      if (typed != null && String(typed).trim()) name = String(typed).trim();
    }
  } catch (_) { /* prompt unavailable: keep the default name */ }
  const p = await _save(Project.create({ name: name.slice(0, 200) }));
  await openProject(p);
  _renderResume();
  return p;
}

// ─── UI: a self-contained modal + a footer trigger ─────────────────────────────

// _esc is imported from ui/text.js (single shared HTML-escaping rule).

function _ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('kx-studio-style')) return;
  const css = `
  .kx-studio-backdrop{position:fixed;inset:0;z-index:1610;background:rgba(5,8,16,.62);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
    display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 16px}
  .kx-studio{width:min(1080px,96vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;
    background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:18px;color:var(--text-primary);
    box-shadow:0 30px 90px rgba(0,0,0,.66)}
  .kx-studio-head{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border-subtle);cursor:move;user-select:none;
    background:linear-gradient(180deg,color-mix(in srgb,var(--accent-cyan) 9%,var(--bg-surface)),var(--bg-surface))}
  .kx-studio-head h2{font-size:16px;margin:0;letter-spacing:.03em;text-transform:uppercase;display:flex;align-items:center;gap:9px}
  .kx-studio-head .grow{flex:1 1 auto}
  .kx-studio-body{overflow:auto;padding:16px 20px 22px;display:flex;flex-direction:column;gap:14px}
  .kx-studio-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .kx-studio-search{flex:1 1 220px;min-width:180px;box-sizing:border-box;padding:9px 13px;border-radius:10px;border:1px solid var(--border-subtle);
    background:var(--bg-main);color:var(--text-primary);font-size:13px}
  .kx-studio-search:focus{outline:none;border-color:var(--accent-cyan)}
  .kx-studio-stats{font-size:11.5px;color:var(--text-muted);letter-spacing:.01em}
  .kx-studio-sort{display:inline-flex;gap:2px;padding:2px;border-radius:9px;border:1px solid var(--border-subtle);background:var(--bg-main)}
  .kx-studio-sort button{border:0;background:transparent;color:var(--text-muted);font:inherit;font-size:11.5px;padding:5px 10px;border-radius:7px;cursor:pointer}
  .kx-studio-sort button:hover{color:var(--text-primary)}
  .kx-studio-sort button.on{background:color-mix(in srgb,var(--accent-cyan) 22%,transparent);color:var(--text-primary)}
  .kx-studio-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(262px,1fr));gap:14px}
  .kx-proj{position:relative;display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--border-subtle);
    border-radius:14px;background:var(--bg-surface-elevated);transition:transform .12s,border-color .15s,box-shadow .15s}
  .kx-proj:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--accent-cyan) 55%,var(--border-subtle));
    box-shadow:0 16px 34px -18px rgba(0,0,0,.8)}
  .kx-proj.active{border-color:var(--accent-cyan);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent-cyan) 40%,transparent)}
  .kx-proj:focus-visible{outline:2px solid var(--accent-cyan);outline-offset:2px}
  .kx-proj-tag{position:absolute;top:11px;right:11px;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
    color:var(--accent-cyan);border:1px solid color-mix(in srgb,var(--accent-cyan) 50%,transparent);background:color-mix(in srgb,var(--accent-cyan) 14%,transparent);
    padding:2px 7px;border-radius:999px}
  .kx-proj-top{display:flex;gap:12px;align-items:center}
  .kx-proj-thumb{flex:0 0 auto;width:${THUMB_BOX}px;height:${THUMB_BOX}px;border-radius:10px;background:#0a1120;border:1px solid var(--border-subtle);image-rendering:pixelated}
  .kx-proj-id{min-width:0;flex:1 1 auto}
  .kx-proj h3{margin:0 0 5px;font-size:14px;line-height:1.25;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .kx-proj-badges{display:flex;flex-wrap:wrap;gap:5px}
  .kx-proj-badge{font-size:9.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--text-muted);border:1px solid var(--border-subtle);border-radius:6px;padding:2px 6px}
  .kx-proj-badge.machine{color:var(--accent-cyan);border-color:color-mix(in srgb,var(--accent-cyan) 40%,transparent)}
  .kx-proj-resume{font-size:11px;color:var(--text-secondary);line-height:1.5;min-height:16px}
  .kx-proj-meter{display:flex;align-items:center;gap:8px}
  .kx-proj-bar{flex:1 1 auto;height:7px;border-radius:999px;background:var(--bg-main);overflow:hidden}
  .kx-proj-bar > i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent-cyan),color-mix(in srgb,var(--accent-emerald) 70%,var(--accent-cyan)))}
  .kx-proj-pct{font-size:10.5px;font-weight:700;color:var(--text-muted);min-width:32px;text-align:right}
  .kx-proj-acts{display:flex;gap:6px;margin-top:1px}
  .kx-proj-acts button{flex:1 1 auto;font-size:11px;padding:6px 7px}
  .kx-proj-acts .kx-proj-del{flex:0 0 auto}
  .kx-studio-empty{grid-column:1/-1;padding:40px 16px;text-align:center;color:var(--text-muted);font-size:13px;line-height:1.7}
  .kx-studio-link{cursor:pointer;color:var(--accent-cyan);border-bottom:1px solid transparent}
  .kx-studio-link:hover{border-bottom-color:var(--accent-cyan)}
  @media (max-width:560px){.kx-studio-head{flex-wrap:wrap}.kx-studio-head .btn-action{flex:1 1 auto}}
  @media (prefers-reduced-motion:reduce){.kx-proj{transition:none}.kx-proj:hover{transform:none}}
  `;
  const el = document.createElement('style');
  el.id = 'kx-studio-style';
  el.textContent = css;
  document.head.appendChild(el);
}

/** Aggregate one-line library stats for the toolbar. */
function _statsLine(projects) {
  if (!projects.length) return 'No projects yet';
  const charts = projects.reduce((n, p) => n + ((p.charts || []).length), 0);
  const pieces = projects.reduce((n, p) => n + (p.allPieces ? p.allPieces().length : 0), 0);
  const avg = Math.round(projects.reduce((n, p) => n + summarizeProject(p).completion, 0) / projects.length);
  const one = (label, n) => `${n} ${label}${n === 1 ? '' : 's'}`;
  return `${one('project', projects.length)} \u00b7 ${one('chart', charts)} \u00b7 ${one('piece', pieces)} \u00b7 ${avg}% knit on average`;
}

async function _render() {
  if (!_modal) return;
  const grid = _modal.querySelector('.kx-studio-grid');
  const stats = _modal.querySelector('.kx-studio-stats');
  const q = (_modal.querySelector('.kx-studio-search')?.value || '').trim().toLowerCase();
  let projects = await listProjects();
  if (stats) stats.textContent = _statsLine(projects);

  const list = projects.slice();
  if (_sort === 'name') list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  else if (_sort === 'progress') list.sort((a, b) => summarizeProject(b).completion - summarizeProject(a).completion);
  // 'recent' keeps the updatedAt-desc order listProjects already returned.

  const shown = q ? list.filter(p => ((p.name || '') + ' ' + (p.machine || '')).toLowerCase().includes(q)) : list;
  grid.innerHTML = '';
  if (!shown.length) {
    grid.innerHTML = `<div class="kx-studio-empty">${q
      ? `No projects match \u201c${_esc(q)}\u201d.`
      : 'Your Studio is empty. \u201c+ New Project\u201d starts one, and \u201cSnapshot current chart\u201d folds whatever is on the canvas into it \u2014 so the app finally remembers what you are making.'}</div>`;
    return;
  }
  const thumbs = [];
  for (const p of shown) {
    const s = summarizeProject(p);
    const active = p.id === _activeId;
    const card = document.createElement('div');
    card.className = 'kx-proj' + (active ? ' active' : '');
    card.tabIndex = 0;
    card.dataset.id = p.id;
    card.setAttribute('data-ktip', active ? 'Currently open \u2014 click Open to return to it' : `Open \u201c${s.name}\u201d`);
    card.innerHTML = `
      ${active ? '<span class="kx-proj-tag">Open</span>' : ''}
      <div class="kx-proj-top">
        <canvas class="kx-proj-thumb" aria-hidden="true"></canvas>
        <div class="kx-proj-id">
          <h3>${_esc(s.name)}</h3>
          <div class="kx-proj-badges">
            <span class="kx-proj-badge machine">${_esc(s.machine || 'No machine')}</span>
            <span class="kx-proj-badge">${s.chartCount} chart${s.chartCount === 1 ? '' : 's'}</span>
            <span class="kx-proj-badge">${s.garmentCount} garment${s.garmentCount === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>
      <div class="kx-proj-resume">${_esc(s.resume || '')}</div>
      <div class="kx-proj-meter" title="${s.completion}% of planned rows knitted">
        <span class="kx-proj-bar"><i style="width:${s.completion}%"></i></span>
        <span class="kx-proj-pct">${s.completion}%</span>
      </div>
      <div class="kx-proj-acts">
        <button type="button" class="btn-action btn-primary" data-open="${_esc(p.id)}">Open</button>
        <button type="button" class="btn-action" data-ren="${_esc(p.id)}" title="Rename this project">Rename</button>
        <button type="button" class="btn-action" data-dup="${_esc(p.id)}" title="Duplicate this project">Duplicate</button>
        <button type="button" class="btn-action kx-proj-del" data-del="${_esc(p.id)}" title="Delete this project">Delete</button>
      </div>`;
    grid.appendChild(card);
    thumbs.push([card.querySelector('.kx-proj-thumb'), previewMatrix(p)]);
  }
  for (const [cv, matrix] of thumbs) renderThumbnail(cv, matrix, THUMB_BOX, { fg: '#bcd4ff', bg: '#0a1120', pad: 4 });
}

async function _doOpen(id) {
  const p = (await listProjects()).find(x => x.id === id);
  if (p) { await openProject(p); _opts.onOpened?.(p); close(); }
}

function _bindGrid() {
  const grid = _modal.querySelector('.kx-studio-grid');
  grid.addEventListener('click', async e => {
    const open = e.target.closest('[data-open]');
    const ren = e.target.closest('[data-ren]');
    const dup = e.target.closest('[data-dup]');
    const del = e.target.closest('[data-del]');
    if (open) return _doOpen(open.dataset.open);
    if (ren) { await renameProject(ren.dataset.ren); await _render(); return; }
    if (dup) { await duplicateProject(dup.dataset.dup); await _render(); return; }
    if (del) {
      const ok = typeof window === 'undefined' || typeof window.confirm !== 'function'
        || window.confirm('Delete this project? Your checkpoints and backup files keep their own copies.');
      if (!ok) return;
      await removeProject(del.dataset.del);
      await _render();
      return;
    }
    const card = e.target.closest('.kx-proj');
    if (card && e.detail === 2) _doOpen(card.dataset.id); // double-click a card to open it
  });
  grid.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const card = e.target.closest('.kx-proj'); if (card) _doOpen(card.dataset.id); }
  });
}

export function open() {
  if (_modal) return;
  if (typeof document === 'undefined') return;
  _ensureStyles();
  const backdrop = document.createElement('div');
  backdrop.className = 'kx-studio-backdrop';
  backdrop.innerHTML = `<div class="kx-studio" role="dialog" aria-modal="true" aria-label="Your projects">
    <div class="kx-studio-head">
      <h2><span aria-hidden="true">\u25A4</span> Your Studio</h2>
      <span class="grow"></span>
      <button class="btn-action" data-snapshot title="Fold the chart on the canvas into your current project">Snapshot current chart</button>
      <button class="btn-action btn-primary" data-new>+ New Project</button>
      <button class="modal-close" data-close type="button" aria-label="Close the studio">&times;</button>
    </div>
    <div class="kx-studio-body">
      <div class="kx-studio-bar">
        <input class="kx-studio-search" type="search" placeholder="Search by name or machine\u2026" autocomplete="off">
        <span class="kx-studio-stats"></span>
        <div class="kx-studio-sort" role="group" aria-label="Sort projects">
          <button type="button" data-sort="recent" class="on">Recent</button>
          <button type="button" data-sort="name">Name</button>
          <button type="button" data-sort="progress">Progress</button>
        </div>
      </div>
      <div class="kx-studio-grid"></div>
    </div>
  </div>`;
  document.body.appendChild(backdrop);
  _modal = backdrop;
  _bindGrid();
  backdrop.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('.kx-studio-search').addEventListener('input', () => _render());
  backdrop.querySelector('.kx-studio-sort').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    _sort = b.dataset.sort;
    backdrop.querySelectorAll('.kx-studio-sort button').forEach(x => x.classList.toggle('on', x === b));
    _render();
  });
  backdrop.querySelector('[data-new]').addEventListener('click', async () => {
    const name = (window.prompt?.('Project name', 'Untitled project') || 'Untitled project').slice(0, 200);
    const p = Project.create({ name });
    await _save(p);
    await openProject(p);
    await _render();
  });
  backdrop.querySelector('[data-snapshot]').addEventListener('click', async () => {
    const p = await commitCurrentChart();
    _opts.notifier?.success?.(p ? `Saved \u201c${p.name}\u201d.` : 'Nothing on the canvas to save yet.');
    await _render();
  });
  _render();
}

export function close() {
  if (_modal) { _modal.remove(); _modal = null; }
}

export function isActive() { return Boolean(_modal); }

// ─── footer resume line (the always-visible "where I left off") ─────────────────

function _renderResume() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('kx-studio-resume');
  if (!el) return;
  listProjects().then(projects => {
    const p = projects.find(x => x.id === _activeId) || projects[0];
    const s = p ? summarizeProject(p) : null;
    el.textContent = s && s.resume && s.pieceCount ? `\u25b6 ${s.name}: ${s.resume} \u00b7 ${s.completion}%` : 'Studio';
  }).catch(() => { /* leave last text */ });
}

export function getCommands() {
  return [
    { label: 'Your Studio — open a project', group: 'Project', keywords: 'project studio hub resume open my projects list dashboard', run: () => open() },
    { label: 'Snapshot current chart into the project', group: 'Project', keywords: 'project save snapshot current chart studio keep place', run: async () => { const p = await commitCurrentChart(); _opts.notifier?.success?.(p ? `Saved \u201c${p.name}\u201d.` : 'Nothing to save yet.'); } },
    { label: 'New project', group: 'Project', keywords: 'new project create start blank studio', run: async () => { const name = (window.prompt?.('Project name', 'Untitled project') || 'Untitled project').slice(0, 200); const p = await _save(Project.create({ name })); _opts.notifier?.success?.(`Created \u201c${p.name}\u201d.`); open(); } }
  ];
}

/**
 * Boot the Studio. Returns a small handle the app can drive (palette actions, an
 * autosave hook, the taskbar's project plumbing). Safe to call in a headless/test
 * context — it touches no DOM until open() runs, and every storage read is guarded.
 */
export function initProjectHub(options = {}) {
  _opts = options;
  _activeId = _recallActive();
  if (typeof document !== 'undefined') {
    _ensureStyles();
    const right = document.querySelector('.status-right');
    if (right && !document.getElementById('kx-studio-link')) {
      const link = document.createElement('a');
      link.className = 'status-docs-link kx-studio-link';
      link.id = 'kx-studio-link';
      link.href = '#';
      link.title = 'Open your studio — every project you have started';
      link.textContent = 'Studio';
      link.addEventListener('click', e => { e.preventDefault(); open(); });
      const resume = document.createElement('span');
      resume.id = 'kx-studio-resume';
      resume.className = 'kx-studio-resume';
      right.insertBefore(resume, right.firstChild);
      right.insertBefore(link, right.firstChild);
      _renderResume();
    }
  }
  return {
    open,
    close,
    isActive,
    commands: getCommands,
    commit: commitCurrentChart,
    list: listProjects,
    openProjectById,
    createNew,
    rename: renameProject,
    duplicate: duplicateProject,
    remove: removeProject,
    activeId: () => _activeId
  };
}
