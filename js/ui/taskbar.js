/**
 * KNITCAT — the project taskbar.
 *
 * A slim, persistent dock along the bottom of the screen that shows every project
 * you have saved as a little punchcard, always one click (or hover) away — the
 * "Alt-Tab strip" a knitter juggling several garments actually wants. Hovering a
 * thumbnail lifts a live preview popover (a bigger render of the real card plus its
 * machine, progress and last-edited line); clicking opens it straight into the
 * editor; right-clicking reuses the shared context menu.
 *
 * It is a *client* of what already exists, never a new silo: the project list comes
 * from the Studio's `listProjects`, opening routes back through the app's own
 * `loadChart`, and the thumbnails are drawn by the same `ui/thumbnail` code the
 * dashboard uses — so a card looks identical in both places and there is one save
 * path, not two.
 *
 * Importing this module has no DOM side effects; {@link createTaskbar} wires it.
 *
 * @module ui/taskbar
 */

import { renderThumbnail, previewMatrix } from './thumbnail.js';

const BAR_ID = 'kx-taskbar';
const STYLE_ID = 'kx-taskbar-style';
const POP_ID = 'kx-taskbar-pop';
const THUMB = 46;         // px square of each taskbar thumbnail
export const MAX_TASKS = 24; // cap so a huge library can't bloat the bar

/**
 * The chart matrix to preview for a project. Delegates to the shared
 * {@link previewMatrix} so a project looks identical in the bar and the Studio.
 * @param {object} project
 * @returns {Array<Array<any>>}
 */
export function chartForPreview(project) {
  return previewMatrix(project);
}

/**
 * The human lines shown in the hover popover. Pure so the wording is testable.
 * @param {object} project
 * @param {object} [summary] output of summarizeProject (optional)
 * @returns {{title:string, lines:string[]}}
 */
export function previewMeta(project, summary) {
  const name = (project && project.name) || 'Untitled project';
  const lines = [];
  if (summary) {
    if (summary.machine) lines.push(summary.machine);
    const parts = [];
    if (summary.chartCount) parts.push(`${summary.chartCount} chart${summary.chartCount === 1 ? '' : 's'}`);
    if (summary.garmentCount) parts.push(`${summary.garmentCount} garment${summary.garmentCount === 1 ? '' : 's'}`);
    if (parts.length) lines.push(parts.join(' · '));
    if (typeof summary.completion === 'number' && summary.pieceCount) lines.push(`${summary.completion}% knit`);
  }
  const upd = project && project.updatedAt ? new Date(project.updatedAt) : null;
  if (upd && Number.isFinite(upd.getTime())) lines.push('Edited ' + upd.toLocaleDateString());
  return { title: name, lines };
}

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#kx-taskbar{position:fixed;left:0;right:0;bottom:0;z-index:8600;display:flex;align-items:center;gap:8px;
  padding:6px 10px;min-height:60px;box-sizing:border-box;
  background:linear-gradient(180deg,color-mix(in srgb,var(--bg-surface,#0f1830) 78%,transparent),var(--bg-surface,#0f1830));
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:1px solid var(--border-subtle,#24406e);
  box-shadow:0 -10px 30px -18px rgba(0,0,0,.8);font:11px/1.3 var(--font-ui,system-ui,sans-serif);color:var(--text-primary)}
#kx-taskbar[hidden]{display:none}
/* Reserve the bar's own height so the fixed dock never hides the in-flow status bar. */
body.kx-taskbar-on #app-container{padding-bottom:var(--kx-taskbar-h,66px);box-sizing:border-box}
.kx-tb-label{display:inline-flex;flex-direction:column;gap:3px;align-items:center;padding:2px 8px 2px 2px;
  border-right:1px solid var(--border-subtle);margin-right:2px;color:var(--text-muted);cursor:pointer;background:transparent}
.kx-tb-label:hover{color:var(--text-primary)}
.kx-tb-label .kx-tb-ico{font-size:18px;line-height:1}
.kx-tb-scroll{display:flex;align-items:center;gap:8px;overflow-x:auto;overflow-y:hidden;flex:1 1 auto;padding:2px;scrollbar-width:thin}
.kx-tb-scroll::-webkit-scrollbar{height:6px}
.kx-tb-item{position:relative;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:3px;width:60px;
  padding:4px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg-main);cursor:pointer;transition:transform .1s,border-color .15s,background .15s}
.kx-tb-item:hover{border-color:var(--accent-cyan);transform:translateY(-2px);background:color-mix(in srgb,var(--accent-cyan) 10%,var(--bg-main))}
.kx-tb-item.active{border-color:var(--accent-cyan);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent-cyan) 45%,transparent)}
.kx-tb-thumb{width:${THUMB}px;height:${THUMB}px;border-radius:6px;background:#0a1120;image-rendering:pixelated;display:block}
.kx-tb-name{max-width:58px;font-size:9.5px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
.kx-tb-empty{color:var(--text-muted);font-size:11px;padding:8px 10px;font-style:italic}
.kx-tb-add{flex:0 0 auto;width:44px;height:54px;border-radius:10px;border:1px dashed var(--border-subtle);background:transparent;
  color:var(--text-muted);cursor:pointer;font-size:20px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
.kx-tb-add:hover{color:var(--accent-cyan);border-color:var(--accent-cyan)}
#kx-taskbar-pop{position:fixed;z-index:8700;width:220px;padding:10px;display:none;gap:10px;
  background:var(--bg-surface,#0f1830);border:1px solid var(--border-subtle,#24406e);border-radius:12px;
  box-shadow:0 22px 55px -12px rgba(0,0,0,.8);pointer-events:none}
#kx-taskbar-pop.open{display:flex}
#kx-taskbar-pop canvas{width:120px;height:120px;border-radius:8px;background:#0a1120;flex:0 0 auto;image-rendering:pixelated}
.kx-pop-info{min-width:0;flex:1 1 auto;display:flex;flex-direction:column;gap:3px;justify-content:center}
.kx-pop-title{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kx-pop-line{font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (pointer:coarse){#kx-taskbar{min-height:68px}.kx-tb-item{min-width:60px}}
`;
  document.head.appendChild(style);
}

/** Render a punchcard into a canvas sized in CSS px, HiDPI-aware (shared renderer). */
function paintCanvas(canvas, matrix, box, opts = {}) {
  renderThumbnail(canvas, matrix, box, opts);
}

/**
 * Mount the taskbar. Idempotent.
 * @param {object} deps
 * @param {() => Promise<Array>} deps.listProjects  resolve the saved projects
 * @param {(id:string, project:object) => void} [deps.openProject]
 * @param {() => void} [deps.onDashboard]           open the Studio
 * @param {() => Promise|void} [deps.onSnapshot]    fold the canvas into a project
 * @param {() => object|null} [deps.summaryFor]     optional summarizeProject(p)
 * @param {() => string} [deps.activeId]            which project is loaded
 * @returns {{refresh:Function,show:Function,hide:Function,destroy:Function,element:HTMLElement}|null}
 */
export function createTaskbar(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function') return null;
  injectStyles();

  let bar = doc.getElementById(BAR_ID);
  if (!bar) {
    bar = doc.createElement('div');
    bar.id = BAR_ID;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Saved projects');
    doc.body.appendChild(bar);
  }
  let pop = doc.getElementById(POP_ID);
  if (!pop) {
    pop = doc.createElement('div');
    pop.id = POP_ID;
    pop.innerHTML = '<canvas width="240" height="240" aria-hidden="true"></canvas><div class="kx-pop-info"></div>';
    doc.body.appendChild(pop);
  }

  let items = [];
  let hoverTimer = 0;
  let resizeObs = null;

  function closePop() { pop.classList.remove('open'); }

  function openPopFor(item, project) {
    const matrix = chartForPreview(project);
    const info = previewMeta(project, typeof deps.summaryFor === 'function' ? deps.summaryFor(project) : null);
    const box = 120;
    paintCanvas(pop.querySelector('canvas'), matrix, box, { fg: '#cfe0ff', bg: '#0a1120' });
    const infoEl = pop.querySelector('.kx-pop-info');
    infoEl.innerHTML = '<div class="kx-pop-title"></div>' + info.lines.map(() => '<div class="kx-pop-line"></div>').join('');
    infoEl.querySelector('.kx-pop-title').textContent = info.title;
    infoEl.querySelectorAll('.kx-pop-line').forEach((el, i) => { el.textContent = info.lines[i]; });
    pop.classList.add('open');
    const r = item.getBoundingClientRect();
    const pw = pop.offsetWidth || 220;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    pop.style.left = left + 'px';
    pop.style.top = 'auto';
    pop.style.bottom = (window.innerHeight - r.top + 10) + 'px';
  }

  async function refresh() {
    let projects = [];
    try { projects = (await (deps.listProjects ? deps.listProjects() : [])) || []; } catch (_) { projects = []; }
    items = projects.slice(0, MAX_TASKS);
    render();
  }

  function render() {
    const active = typeof deps.activeId === 'function' ? deps.activeId() : null;
    bar.innerHTML = '';
    const label = doc.createElement('button');
    label.type = 'button';
    label.className = 'kx-tb-label';
    label.setAttribute('data-ktip', 'Open your Projects Dashboard (Studio)');
    label.innerHTML = '<span class="kx-tb-ico" aria-hidden="true">\u25A4</span><span>Projects</span>';
    label.addEventListener('click', () => { closePop(); deps.onDashboard && deps.onDashboard(); });
    bar.appendChild(label);

    const scroll = doc.createElement('div');
    scroll.className = 'kx-tb-scroll';
    if (!items.length) {
      const empty = doc.createElement('div');
      empty.className = 'kx-tb-empty';
      empty.textContent = 'No saved projects yet \u2014 snapshot the canvas or open the Studio to start one.';
      scroll.appendChild(empty);
    }
    for (const p of items) {
      const item = doc.createElement('button');
      item.type = 'button';
      item.className = 'kx-tb-item' + (active && p.id === active ? ' active' : '');
      item.dataset.project = p.id;
      item.setAttribute('data-ktip', p.name || 'Untitled project');
      const cv = doc.createElement('canvas');
      cv.className = 'kx-tb-thumb';
      item.appendChild(cv);
      const nm = doc.createElement('span');
      nm.className = 'kx-tb-name';
      nm.textContent = p.name || 'Untitled';
      item.appendChild(nm);
      scroll.appendChild(item);
      paintCanvas(cv, chartForPreview(p), THUMB, { fg: '#9fc4ff', bg: '#0a1120' });

      item.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => openPopFor(item, p), 60); });
      item.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); closePop(); });
      item.addEventListener('focus', () => openPopFor(item, p));
      item.addEventListener('blur', closePop);
      item.addEventListener('click', () => { closePop(); deps.openProject && deps.openProject(p.id, p); });
    }
    bar.appendChild(scroll);

    const add = doc.createElement('button');
    add.type = 'button';
    add.className = 'kx-tb-add';
    add.setAttribute('data-ktip', 'Snapshot the canvas into a project');
    add.setAttribute('aria-label', 'Snapshot current chart into a project');
    add.textContent = '\uFF0B';
    add.addEventListener('click', () => { Promise.resolve(deps.onSnapshot && deps.onSnapshot()).then(() => refresh()).catch(() => {}); });
    bar.appendChild(add);
    // Children just changed the bar's real height; recompute the reserved pad now
    // so the status bar is never clipped, rather than waiting on a ResizeObserver tick.
    syncPad();
  }

  function syncPad() {
    const h = bar.hidden ? 0 : (bar.offsetHeight || 0);
    const root = doc.documentElement;
    if (root && root.style) root.style.setProperty('--kx-taskbar-h', h + 'px');
    if (doc.body) doc.body.classList.toggle('kx-taskbar-on', h > 0);
  }

  function show() { bar.hidden = false; syncPad(); }
  function hide() { bar.hidden = true; closePop(); syncPad(); }
  function destroy() {
    if (resizeObs) { try { resizeObs.disconnect(); } catch (_) { /* already gone */ } resizeObs = null; }
    if (doc.body) doc.body.classList.remove('kx-taskbar-on');
    if (doc.documentElement && doc.documentElement.style) doc.documentElement.style.removeProperty('--kx-taskbar-h');
    bar.remove(); pop.remove();
  }

  refresh();
  // Keep the reserved height exact as the bar reflows (thumbnails, wrapping, resize).
  if (typeof ResizeObserver !== 'undefined') {
    try { resizeObs = new ResizeObserver(syncPad); resizeObs.observe(bar); } catch (_) { /* unsupported */ }
  }
  syncPad();
  return { refresh, show, hide, destroy, element: bar };
}
