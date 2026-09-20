/**
 * KNITCAT — Textile Heritage & Loom browser.
 *
 * A read-only floating dock (the same surface as the stitch inspector, clip shelf and
 * card-structure panel, built from `ui/kit.js`) that answers two questions the pattern
 * library raises but cannot itself answer: *"where does this weave come from?"* and
 * *"which loom would actually make it?"*. It is a **consumer**, never an editor: it reads
 * the pure reference modules (`weave/weave-knowledge.js`, `weave/textile-heritage.js`) and
 * reports. The one thing it *does* is hand a structure id back to the app so you can drop
 * a real woven draft onto the card — exactly the click the pattern browser would do.
 *
 * Importing this module has no DOM side effects; everything lives inside
 * {@link createHeritagePanel}, which the app boots under a guarded step, so a failure to
 * mount it means no heritage dock, never a broken editor.
 *
 * @module ui/heritage-panel
 */

import { buildPanel, sectionHeading, esc } from './kit.js';
import { getDiagnostics } from '../core/diagnostics.js';
import {
  WEAVE_STRUCTURES,
  LOOM_TYPES,
  structureReport,
  simplestLoomFor,
  structuresForLoom
} from '../weave/weave-knowledge.js';
import {
  DESIGNERS,
  WEAVERS,
  TOOLS,
  FUNDAMENTALS,
  REGIONAL_TRADITIONS,
  HISTORY_TOPICS,
  TEXTILE_ERAS,
  byEra,
  heritageSummary
} from '../weave/textile-heritage.js';

const STYLE_ID = 'kx-heritage-style';
const PANEL_ID = 'kx-heritage';
const BUTTON_ID = 'kx-heritage-btn';

/**
 * Mount the Textile Heritage dock. Idempotent per document: a second call reuses nodes.
 *
 * @param {object} deps
 * @param {(structureId:string) => void} [deps.applyStructure] Loads a weave structure's draft onto the live card.
 * @param {{info?:Function,warn?:Function}} [deps.notifications]
 * @returns {{toggle:Function, open:Function, close:Function, isOpen:Function, destroy:Function, button:HTMLElement, panel:HTMLElement}}
 */
export function createHeritagePanel(deps = {}) {
  const applyStructure = typeof deps.applyStructure === 'function' ? deps.applyStructure : null;
  const notifier = deps.notifications || null;
  const diag = getDiagnostics().child('heritage');

  injectStyles();

  const state = { open: false, query: '' };

  let button = document.getElementById(BUTTON_ID);
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = 'kx-hbtn';
    button.title = 'Textile heritage & looms';
    button.setAttribute('aria-label', 'Open the textile heritage and loom browser');
    button.innerHTML = '<span aria-hidden="true">\uD83E\uDDF5</span>';
    (document.querySelector('.brand-section') || document.body).appendChild(button);
  }

  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    const shell = buildPanel({
      id: PANEL_ID,
      className: 'kx-herit',
      glyph: '\uD83E\uDDF5',
      title: 'Textile Heritage',
      pos: 'tl',
      stat: true,
      ariaLabel: 'Textile heritage and loom browser'
    });
    panel = shell.panel;
    shell.body.innerHTML = `
      <input type="search" class="kx-input kx-herit__search" data-search
             placeholder="Search weaves, looms, designers…" aria-label="Search the textile heritage">
      <div data-content></div>`;
    document.body.appendChild(panel);
  }

  const q = sel => panel.querySelector(sel);
  const els = {
    search: q('[data-search]'),
    content: q('[data-content]'),
    count: q('[data-count]')
  };

  function isOpen() { return state.open; }
  function show() { panel.hidden = false; state.open = true; render(); }
  function hide() { panel.hidden = true; state.open = false; }
  function toggle() { state.open ? hide() : show(); }

  button.addEventListener('click', toggle);
  q('[data-close]').addEventListener('click', hide);
  els.search.addEventListener('input', () => { state.query = els.search.value.trim().toLowerCase(); render(); });

  // Wire "draft this structure" buttons via event delegation so re-rendering the body
  // never orphans a handler.
  els.content.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-draft]');
    if (!btn) return;
    const id = btn.getAttribute('data-draft');
    if (!applyStructure) {
      notifier && notifier.warn && notifier.warn('Weave drafting is not wired up in this build.');
      return;
    }
    try {
      applyStructure(id);
      notifier && notifier.info && notifier.info(`Drafted ${WEAVE_STRUCTURES[id]?.name || id} onto the card.`);
      hide();
    } catch (err) {
      diag.warn('applyStructure failed: ' + err.message);
    }
  });

  function matches(...needles) {
    if (!state.query) return true;
    return needles.join(' ').toLowerCase().includes(state.query);
  }

  function render() {
    const s = heritageSummary();
    if (els.count) els.count.textContent = `${Object.keys(WEAVE_STRUCTURES).length} weaves · ${Object.keys(LOOM_TYPES).length} looms`;

    const structures = Object.values(WEAVE_STRUCTURES)
      .filter(w => matches(w.name, w.group, structureReport(w.id).shaftsLabel, w.blurb))
      .map(structureRow);
    const looms = Object.values(LOOM_TYPES)
      .filter(l => matches(l.name, l.drive, l.insertion || '', l.era))
      .map(loomRow);
    const designerEras = byEra(DESIGNERS)
      .map(bucket => ({ ...bucket, people: bucket.people.filter(p => matches(p.name, p.note || '')) }))
      .filter(bucket => bucket.people.length);
    const weaverPeople = WEAVERS.filter(p => matches(p.name, p.note || ''));
    const tools = TOOLS.filter(t => matches(t.name, t.kind));
    const traditions = REGIONAL_TRADITIONS.filter(t => matches(t.name, t.region));

    const blocks = [];
    blocks.push(`${sectionHeading('Foundations', `${s.designers} designers · ${s.weavers} weavers · ${s.centuries} eras`)}
      <p class="kx-herit__lead">Woven cloth and a punchcard are the same rectangle — every structure below drops straight onto the card.</p>`);
    if (structures.length) blocks.push(sectionHeading('Weave structures', 'draft → card') + `<div class="kx-list">${structures.join('')}</div>`);
    if (looms.length) blocks.push(sectionHeading('Loom taxonomy', 'what can weave what') + `<div class="kx-list">${looms.join('')}</div>`);
    if (designerEras.length) blocks.push(sectionHeading('Designers', 'by era') + designerEras.map(eraBlock).join(''));
    if (weaverPeople.length) blocks.push(sectionHeading('Weavers & houses') + `<div class="kx-list">${weaverPeople.map(personRow).join('')}</div>`);
    if (tools.length) blocks.push(sectionHeading('Tools & techniques') + chipBlock(tools.map(t => t.name)));
    if (matches('fundamentals') || FUNDAMENTALS.some(f => matches(f))) blocks.push(sectionHeading('Fiber-arts fundamentals') + chipBlock(FUNDAMENTALS.filter(f => matches(f))));
    if (traditions.length) blocks.push(sectionHeading('Regional traditions') + chipBlock(traditions.map(t => `${t.name} · ${t.region}`)));
    if (HISTORY_TOPICS.some(h => matches(h))) blocks.push(sectionHeading('On the timeline') + chipBlock(HISTORY_TOPICS.filter(h => matches(h))));
    if (!structures.length && !looms.length && !designerEras.length && !weaverPeople.length && !tools.length) {
      blocks.push('<p class="kx-empty">Nothing matches that search.</p>');
    }
    els.content.innerHTML = blocks.join('');
  }

  /** One weave-structure row: name, dressing, simplest loom, and an optional Draft button. */
  function structureRow(w) {
    const report = structureReport(w.id);
    const simplest = simplestLoomFor(w.id);
    const draftBtn = applyStructure
      ? `<button class="kx-btn kx-btn--ghost" data-draft="${esc(w.id)}" title="Draft ${esc(w.name)} on the card">Draft</button>`
      : '';
    return `<div class="kx-row">
      <div class="kx-row__info">
        <span class="kx-row__name">${esc(w.name)}</span>
        <span class="kx-row__meta">${esc(report.shaftsLabel)} · ${esc(w.face)} face · ${simplest ? esc(simplest.loom.name) : 'no loom'}</span>
      </div>${draftBtn}</div>`;
  }

  /** One loom row: name, era, and how many library structures it could weave. */
  function loomRow(l) {
    const canWeave = structuresForLoom(l.id).length;
    const total = Object.keys(WEAVE_STRUCTURES).length;
    return `<div class="kx-row">
      <div class="kx-row__info">
        <span class="kx-row__name">${esc(l.name)}</span>
        <span class="kx-row__meta">${esc(l.era)} · ${esc(l.insertion || l.drive)} · weaves ${canWeave}/${total} structures</span>
      </div>
      <span class="kx-tag kx-tag--${l.drive === 'jacquard' || l.jacquardHead ? 'on' : 'off'}">${esc(l.drive)}</span>
    </div>`;
  }

  function eraBlock(bucket) {
    const eraName = (TEXTILE_ERAS.find(e => e.id === bucket.era.id) || bucket.era).name;
    return `<h4 class="kx-herit__era">${esc(eraName)}</h4>
      <div class="kx-list">${bucket.people.map(personRow).join('')}</div>`;
  }

  function personRow(p) {
    return `<div class="kx-row">
      <div class="kx-row__info">
        <span class="kx-row__name">${esc(p.name)}</span>
        ${p.note ? `<span class="kx-row__meta">${esc(p.note)}</span>` : ''}
      </div></div>`;
  }

  function chipBlock(items) {
    if (!items.length) return '';
    return `<div class="kx-herit__chips">${items.map(i => `<span class="kx-chip">${esc(i)}</span>`).join('')}</div>`;
  }

  function destroy() {
    button.remove();
    panel.remove();
  }

  diag.info('heritage panel mounted');
  return { toggle, open: show, close: hide, isOpen, render, destroy, button, panel };
}

/* ── module-private styling (never runs at import) ──────────────────────────── */

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) { stylesInjected = true; return; }
  const css = `
  #kx-heritage{width:340px;max-height:min(76vh,680px)}
  #kx-heritage .kx-herit__search{width:100%;margin:6px 0 2px}
  #kx-heritage .kx-herit__lead{color:var(--panel-muted);font-size:11.5px;margin:2px 2px 8px}
  #kx-heritage .kx-herit__era{margin:9px 2px 4px;font-size:11px;color:var(--accent);font-weight:700;letter-spacing:.3px}
  #kx-heritage .kx-herit__chips{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 6px}
  #kx-heritage .kx-list{display:flex;flex-direction:column;gap:5px;margin-bottom:4px}
  @media (max-width:640px){ #kx-heritage{width:min(92vw,340px)} }
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
