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
 *   - the live editor chart is injected via callbacks (getChart / loadChart), so
 *     this module never reaches into the app and never breaks if it is absent.
 *
 * DOM-free at import: every browser touch lives inside exported functions, so
 * `node --test` can import this file with no window/document defined.
 */

import { openDriver, STORES } from '../project/storage.js';
import { Project, summarizeProject, newChart } from '../project/project-model.js';

const LIVE_CHART = 'live';
const ACTIVE_KEY = 'knitcad.activeProject.v1';

let _opts = {};
let _driverP = null;
let _activeId = null;
let _modal = null;

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

// ─── UI: a self-contained modal + a footer trigger ─────────────────────────────

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function _ensureStyles() {
  if (document.getElementById('kx-studio-style')) return;
  const css = `
  .kx-studio-backdrop{position:fixed;inset:0;z-index:1610;background:rgba(5,8,16,.6);backdrop-filter:blur(3px);
    display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px 16px}
  .kx-studio{width:min(880px,96vw);max-height:84vh;display:flex;flex-direction:column;overflow:hidden;
    background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:16px;color:var(--text-primary);
    box-shadow:0 30px 80px rgba(0,0,0,.6)}
  .kx-studio-head{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border-subtle)}
  .kx-studio-head h2{font-size:15px;margin:0;letter-spacing:.02em;text-transform:uppercase}
  .kx-studio-head .grow{flex:1 1 auto}
  .kx-studio-body{overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
  .kx-studio-search{width:100%;box-sizing:border-box;padding:9px 12px;border-radius:10px;border:1px solid var(--border-subtle);
    background:var(--bg-main);color:var(--text-primary);font-size:13px}
  .kx-studio-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:12px}
  .kx-proj{display:flex;flex-direction:column;gap:8px;padding:14px;border:1px solid var(--border-subtle);
    border-radius:12px;background:var(--bg-surface-elevated)}
  .kx-proj.active{border-color:var(--accent-cyan);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent-cyan) 40%,transparent)}
  .kx-proj h3{margin:0;font-size:14px}
  .kx-proj .meta{font-size:11px;color:var(--text-muted);line-height:1.5}
  .kx-proj .bar{height:6px;border-radius:999px;background:var(--bg-main);overflow:hidden}
  .kx-proj .bar > i{display:block;height:100%;background:var(--accent-cyan)}
  .kx-proj .acts{display:flex;gap:6px;margin-top:2px}
  .kx-proj .acts button{flex:1 1 auto}
  .kx-studio-empty{padding:28px 16px;text-align:center;color:var(--text-muted);font-size:13px;line-height:1.6}
  .kx-studio-link{cursor:pointer;color:var(--accent-cyan);border-bottom:1px solid transparent}
  .kx-studio-link:hover{border-bottom-color:var(--accent-cyan)}
  `;
  const el = document.createElement('style');
  el.id = 'kx-studio-style';
  el.textContent = css;
  document.head.appendChild(el);
}

async function _render() {
  if (!_modal) return;
  const grid = _modal.querySelector('.kx-studio-grid');
  const q = (_modal.querySelector('.kx-studio-search')?.value || '').trim().toLowerCase();
  grid.innerHTML = '';
  let projects = await listProjects();
  if (q) projects = projects.filter(p => (p.name + ' ' + (p.machine || '')).toLowerCase().includes(q));
  if (!projects.length) {
    grid.innerHTML = `<div class="kx-studio-empty">${q ? 'No projects match that search.' : 'No projects yet. “New project” starts one, and “Snapshot current chart” folds whatever is on the canvas into it — the app finally remembers what you are making.'}</div>`;
    return;
  }
  for (const p of projects) {
    const s = summarizeProject(p);
    const card = document.createElement('div');
    card.className = 'kx-proj' + (p.id === _activeId ? ' active' : '');
    card.innerHTML = `
      <h3>${_esc(s.name)}</h3>
      <div class="meta">${_esc(s.machine || 'No machine')} · ${s.garmentCount} garment${s.garmentCount === 1 ? '' : 's'} · ${s.chartCount} chart${s.chartCount === 1 ? '' : 's'}</div>
      <div class="meta">${_esc(s.resume || '')}</div>
      <div class="bar" title="${s.completion}% done"><i style="width:${s.completion}%"></i></div>
      <div class="acts">
        <button class="btn-action" data-open="${_esc(p.id)}">Open</button>
        <button class="btn-action" data-del="${_esc(p.id)}">Delete</button>
      </div>`;
    grid.appendChild(card);
  }
}

function _bindGrid() {
  _modal.querySelector('.kx-studio-grid').addEventListener('click', async e => {
    const open = e.target.closest('[data-open]');
    const del = e.target.closest('[data-del]');
    if (open) {
      const p = (await listProjects()).find(x => x.id === open.dataset.open);
      if (p) { await openProject(p); _opts.onOpened?.(p); close(); }
    } else if (del) {
      await removeProject(del.dataset.del);
      await _render();
    }
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
      <h2>Your Studio</h2>
      <span class="grow"></span>
      <button class="btn-action" data-snapshot title="Fold the chart on the canvas into your current project">Snapshot current chart</button>
      <button class="btn-action btn-primary" data-new>+ New Project</button>
      <button class="modal-close" data-close type="button" aria-label="Close the studio">&times;</button>
    </div>
    <div class="kx-studio-body">
      <input class="kx-studio-search" type="search" placeholder="Search projects…" autocomplete="off">
      <div class="kx-studio-grid"></div>
    </div>
  </div>`;
  document.body.appendChild(backdrop);
  _modal = backdrop;
  _bindGrid();
  backdrop.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('.kx-studio-search').addEventListener('input', () => _render());
  backdrop.querySelector('[data-new]').addEventListener('click', async () => {
    const name = (window.prompt?.('Project name', 'Untitled project') || 'Untitled project').slice(0, 200);
    const p = Project.create({ name });
    await _save(p);
    await openProject(p);
    await _render();
  });
  backdrop.querySelector('[data-snapshot]').addEventListener('click', async () => {
    const p = await commitCurrentChart();
    _opts.notifier?.success?.(p ? `Saved “${p.name}”.` : 'Nothing on the canvas to save yet.');
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
    el.textContent = s && s.resume && s.pieceCount ? `▶ ${s.name}: ${s.resume} · ${s.completion}%` : 'Studio';
  }).catch(() => { /* leave last text */ });
}

export function getCommands() {
  return [
    { label: 'Your Studio — open a project', group: 'Project', keywords: 'project studio hub resume open my projects list', run: () => open() },
    { label: 'Snapshot current chart into the project', group: 'Project', keywords: 'project save snapshot current chart studio keep place', run: async () => { const p = await commitCurrentChart(); _opts.notifier?.success?.(p ? `Saved “${p.name}”.` : 'Nothing to save yet.'); } },
    { label: 'New project', group: 'Project', keywords: 'new project create start blank studio', run: async () => { const name = (window.prompt?.('Project name', 'Untitled project') || 'Untitled project').slice(0, 200); const p = await _save(Project.create({ name })); _opts.notifier?.success?.(`Created “${p.name}”.`); open(); } }
  ];
}

/**
 * Boot the Studio. Returns a small handle the app can drive (palette actions, an
 * autosave hook). Safe to call in a headless/test context — it touches no DOM
 * until open() runs, and every storage read is guarded.
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
    commands: getCommands,
    commit: commitCurrentChart,
    list: listProjects,
    activeId: () => _activeId
  };
}
