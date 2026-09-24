/**
 * KNITCAT — the guided handbook dock.
 *
 * Renders the pure handbook in `docs/guide-content.js` as a floating dock (the same
 * surface family as the heritage browser and stitch inspector, built from `ui/kit.js`)
 * with a chapter rail on top, a live search, and — the whole point — **"try it" buttons
 * that jump you into the exact feature a paragraph is describing**. A link whose target
 * is `command:x` runs through the one shared command dispatcher; a `tab:y` link drives the
 * real tab strip, so the guide and the software can never disagree about where a button
 * leads.
 *
 * It is a reader, never an editor: the only thing it mutates is which panel/tab is on
 * screen. Importing has no DOM side effects; {@link createGuidePanel} is the entry point,
 * booted under a guarded step so a failure means no guide dock, never a broken editor.
 *
 * @module ui/guide-panel
 */

import { buildPanel, sectionHeading, esc } from './kit.js';
import { getDiagnostics } from '../core/diagnostics.js';
import {
  GUIDE_CHAPTERS,
  guideStats,
  searchGuide
} from '../docs/guide-content.js';

const STYLE_ID = 'kx-guide-style';
const PANEL_ID = 'kx-guide';
const BUTTON_ID = 'kx-guide-btn';

/**
 * Mount the guided-handbook dock. Idempotent per document: a second call reuses nodes.
 *
 * @param {object} deps
 * @param {(id:string) => void} [deps.runCommand] Runs a command id through the shared dispatcher.
 * @param {(tab:string) => void} [deps.openTab] Activates an app tab by name.
 * @param {{info?:Function,warn?:Function}} [deps.notifications]
 * @returns {{toggle:Function, open:Function, close:Function, isOpen:Function, destroy:Function, button:HTMLElement, panel:HTMLElement}}
 */
export function createGuidePanel(deps = {}) {
  const runCommand = typeof deps.runCommand === 'function' ? deps.runCommand : null;
  const openTab = typeof deps.openTab === 'function' ? deps.openTab : null;
  const notifier = deps.notifications || null;
  const diag = getDiagnostics().child('guide');

  injectStyles();

  const state = { open: false, chapter: GUIDE_CHAPTERS[0]?.id || '', query: '' };

  let button = document.getElementById(BUTTON_ID);
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = 'kx-hbtn';
    button.title = 'The KNITCAT handbook';
    button.setAttribute('aria-label', 'Open the guided handbook');
    button.innerHTML = '<span aria-hidden="true">\u{1F4D6}</span>';
    (document.querySelector('.brand-section') || document.body).appendChild(button);
  }

  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    const shell = buildPanel({
      id: PANEL_ID,
      className: 'kx-guide',
      glyph: '\u{1F4D6}',
      title: 'Handbook',
      pos: 'tl',
      stat: true,
      ariaLabel: 'The KNITCAT guided handbook'
    });
    panel = shell.panel;
    shell.body.innerHTML = `
      <input type="search" class="kx-input kx-guide__search" data-search
             placeholder="Search the handbook\u2026" aria-label="Search the handbook">
      <nav class="kx-guide__rail" data-rail aria-label="Guide chapters"></nav>
      <div data-content></div>`;
    document.body.appendChild(panel);
  }

  const q = sel => panel.querySelector(sel);
  const els = {
    search: q('[data-search]'),
    rail: q('[data-rail]'),
    content: q('[data-content]'),
    count: q('[data-count]')
  };

  function isOpen() { return state.open; }
  function show() { panel.hidden = false; state.open = true; render(); }
  function hide() { panel.hidden = true; state.open = false; }
  function toggle() { state.open ? hide() : show(); }

  button.addEventListener('click', toggle);
  q('[data-close]').addEventListener('click', hide);
  els.search.addEventListener('input', () => { state.query = els.search.value.trim(); render(); });

  // Rail + "try it" buttons both resolved by delegation, so re-rendering never orphans
  // a handler. A rail chip only changes which chapter is shown; a try-button acts.
  els.rail.addEventListener('click', ev => {
    const chip = ev.target.closest('[data-chapter]');
    if (!chip) return;
    state.chapter = chip.getAttribute('data-chapter');
    state.query = '';
    els.search.value = '';
    render();
  });

  els.content.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-run]');
    if (!btn) return;
    activateLink(btn.getAttribute('data-run'), btn.getAttribute('data-label') || 'that');
  });

  /** Resolve one `command:x` / `tab:y` target against the live app. */
  function activateLink(run, label) {
    const target = String(run || '');
    if (target.startsWith('command:')) {
      const id = target.slice('command:'.length);
      if (!runCommand) { notifier?.warn?.('The handbook is read-only in this build.'); return; }
      try { runCommand(id); } catch (err) { diag.warn('runCommand failed: ' + err.message); }
      hide();
    } else if (target.startsWith('tab:')) {
      const name = target.slice('tab:'.length);
      if (openTab) { try { openTab(name); } catch (err) { diag.warn('openTab failed: ' + err.message); } }
      hide();
    }
  }

  function render() {
    const s = guideStats();
    if (els.count) els.count.textContent = `${s.chapters} chapters \u00B7 ${s.sections} sections`;
    els.rail.innerHTML = GUIDE_CHAPTERS.map(c =>
      `<button type="button" class="kx-guide__chip${!state.query && c.id === state.chapter ? ' is-active' : ''}" data-chapter="${esc(c.id)}">
        <span aria-hidden="true">${c.glyph}</span> ${esc(c.title)}</button>`).join('');

    if (state.query) {
      els.content.innerHTML = renderSearch(state.query);
      return;
    }
    const chapter = GUIDE_CHAPTERS.find(c => c.id === state.chapter) || GUIDE_CHAPTERS[0];
    if (!chapter) { els.content.innerHTML = '<p class="kx-empty">The handbook is empty.</p>'; return; }
    els.content.innerHTML =
      `${sectionHeading(chapter.title, chapter.blurb)}` +
      chapter.sections.map(sectionCard).join('');
  }

  function renderSearch(query) {
    const hits = searchGuide(query);
    if (!hits.length) return '<p class="kx-empty">Nothing in the handbook matches that.</p>';
    return sectionHeading('Search', `${hits.length} match${hits.length === 1 ? '' : 'es'}`) +
      hits.map(({ section, chapter }) => sectionCard(section, chapter.title)).join('');
  }

  /** One section: title, prose, optional steps/tip, and its row of "try it" buttons. */
  function sectionCard(section, chapterTitle = '') {
    const steps = section.steps && section.steps.length
      ? `<ol class="kx-guide__steps">${section.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : '';
    const tip = section.tip
      ? `<p class="kx-guide__tip"><span aria-hidden="true">\u{1F4A1}</span> ${esc(section.tip)}</p>` : '';
    const links = section.try && section.try.length
      ? `<div class="kx-guide__acts">${section.try.map(link =>
          `<button type="button" class="kx-btn kx-btn--primary" data-run="${esc(link.run)}" data-label="${esc(link.label)}"${link.hint ? ` title="${esc(link.hint)}"` : ''}>${esc(link.label)} \u2197</button>`
        ).join('')}</div>` : '';
    return `<article class="kx-guide__sec">
      <h4 class="kx-guide__h4">${esc(section.title)}${chapterTitle ? ` <span class="kx-guide__from">${esc(chapterTitle)}</span>` : ''}</h4>
      <p class="kx-guide__body">${esc(section.body)}</p>
      ${steps}${tip}${links}</article>`;
  }

  function destroy() {
    button.remove();
    panel.remove();
  }

  diag.info('guide panel mounted');
  return { toggle, open: show, close: hide, isOpen, render, destroy, button, panel };
}

/* ── module-private styling (never runs at import) ──────────────────────────── */

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) { stylesInjected = true; return; }
  const css = `
  #kx-guide{width:392px;max-height:min(80vh,720px)}
  #kx-guide .kx-guide__search{width:100%;margin:6px 0 2px}
  #kx-guide .kx-guide__rail{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 4px}
  #kx-guide .kx-guide__chip{display:inline-flex;align-items:center;gap:5px;background:var(--btn-bg);border:1px solid var(--btn-border);
    color:var(--btn-text);border-radius:20px;padding:3px 10px;font:inherit;font-size:11.5px;cursor:pointer;transition:border-color .15s,background .15s}
  #kx-guide .kx-guide__chip:hover{border-color:var(--accent)}
  #kx-guide .kx-guide__chip.is-active{border-color:var(--accent);background:var(--btn-bg-hover);font-weight:600}
  #kx-guide .kx-guide__sec{border:1px solid var(--panel-hairline);border-radius:12px;padding:9px 11px;margin:0 0 8px;background:rgba(2,6,23,.35)}
  #kx-guide .kx-guide__h4{margin:0 0 3px;font-size:13px;font-weight:700;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
  #kx-guide .kx-guide__from{font-size:10px;font-weight:400;color:var(--panel-faint);text-transform:uppercase;letter-spacing:.5px}
  #kx-guide .kx-guide__body{margin:0 0 6px;color:var(--panel-text);font-size:12.5px;line-height:1.5}
  #kx-guide .kx-guide__steps{margin:0 0 7px;padding-left:18px;color:var(--panel-muted);font-size:12px}
  #kx-guide .kx-guide__steps li{margin:2px 0}
  #kx-guide .kx-guide__tip{margin:0 0 7px;font-size:11.5px;color:var(--panel-muted);background:rgba(240,169,191,.08);
    border-left:2px solid var(--accent);border-radius:0 8px 8px 0;padding:5px 9px}
  #kx-guide .kx-guide__acts{display:flex;flex-wrap:wrap;gap:6px}
  @media (max-width:640px){ #kx-guide{width:min(94vw,392px)} }
  `;
  try {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
    stylesInjected = true;
  } catch (_) {
    stylesInjected = true; // unstyled but functional is acceptable
  }
}
