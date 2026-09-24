/**
 * KNITCAT - Pattern library browser (the presets modal).
 *
 * One hundred and fifty patterns will not live in a flat grid any more than a bookshop
 * can be one long shelf. This renders the collection as an accessible two-tier browser —
 * family tabs on top, `<details>` group drawers inside — with search, a single/double-bed
 * filter and favourites that persist. It is deliberately a module and not more methods on
 * the app object: the taxonomy, the storage key and the DOM live here, so the app only has
 * to say "open the browser" and the editor only has to expose `loadPreset`.
 *
 * Accessibility notes, because a submenu is only "accessible" if it actually is:
 *   - family tabs are a real `role="tablist"` with arrow-key movement and `aria-selected`;
 *   - every group drawer is a native `<details>/<summary>`, so it is operable by keyboard
 *     and announced as an expandable section with no custom widget to keep in sync;
 *   - the search box is a live region owner; the result count is announced on change;
 *   - the ★ favourite toggle is a toggle button (`aria-pressed`), never a bare icon click.
 *
 * Nothing here touches the DOM at import time; `openPresetsBrowser()` is the entry point.
 */

import { PATTERN_PRESETS } from './preset-library.js';
import { classify, buildTaxonomy, FAMILIES, BED_LABELS } from './preset-catalog.js';
import { fitPreset } from './preset-feasibility.js';
import { MACHINE_PROFILES } from '../machine/profiles.js';
import { logger } from '../core/logging.js';

const log = logger('presets/presets-browser');

const FAV_KEY = 'knitcad.presetFavourites';

/** Escape text for safe interpolation into the innerHTML templates below. */
function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"]/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
  ));
}

export function loadFavourites() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch (err) {
    log.warn('the saved favourites were corrupt — starting with none', { error: err?.message });
    return new Set();
  }
}

export function saveFavourites(set) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...set]));
  } catch (err) {
    /* private mode / quota: favourites simply do not persist, the UI still works */
    log.debug('favourites could not be persisted (private mode or quota)', { error: err?.message });
  }
}

/**
 * The searchable text for a preset, assembled once. Tradition names, tags, the family
 * and the group all go in, so "estonian", "nordic", "heart" or "waffle" all hit.
 */
function haystack(preset) {
  const c = preset.__classification;
  return [
    preset.name,
    preset.description,
    preset.category,
    c.family,
    c.group,
    c.bed,
    ...(c.tags || [])
  ]
    .join(' ')
    .toLowerCase();
}

export function openPresetsBrowser(app, { favourites = loadFavourites() } = {}) {
  const els = {
    grid: document.getElementById('presets-list'),
    search: document.getElementById('presets-search'),
    families: document.getElementById('presets-families'),
    bed: document.getElementById('presets-bed'),
    favOnly: document.getElementById('presets-fav-only'),
    fitsOnly: document.getElementById('presets-fits-only'),
    count: document.getElementById('presets-count'),
    live: document.getElementById('presets-live')
  };
  if (!els.grid) return;

  // Classify each preset once per open and cache it on the object for the filters.
  const presets = PATTERN_PRESETS.map(p => {
    if (!p.__classification) p.__classification = classify(p);
    return p;
  });
  presets.forEach(p => {
    p.__hay = haystack(p);
  });

  // Fit every preset against the machine the user currently has selected, ONCE per open.
  // `fitPreset` is memoised, but pre-warming here keeps the render loop pure-reading and
  // means the badge and the "fits my machine" filter can never disagree mid-scroll.
  const profile = app.currentProfile || MACHINE_PROFILES.brother_standard_24;
  const fits = new Map();
  for (const p of presets) fits.set(p.id, fitPreset(p, profile));

  const state = { query: '', family: 'all', bed: 'all', favOnly: false, fitsOnly: false };

  function matches(preset) {
    if (state.family !== 'all' && preset.__classification.family !== state.family) return false;
    if (state.bed === 'single-bed' && preset.__classification.bed === 'double-bed') return false;
    if (state.bed === 'double-bed' && preset.__classification.bed === 'single-bed') return false;
    if (state.favOnly && !favourites.has(preset.id)) return false;
    if (state.fitsOnly && (fits.get(preset.id) || {}).status !== 'feasible') return false;
    if (state.query && !preset.__hay.includes(state.query)) return false;
    return true;
  }

  function renderFamilyTabs() {
    if (!els.families) return;
    const counts = {};
    for (const p of presets) counts[p.__classification.family] = (counts[p.__classification.family] || 0) + 1;
    const tabs = [{ id: 'all', name: 'All', icon: '\u2606', count: presets.length }]
      .concat(FAMILIES.filter(f => counts[f.id]).map(f => ({ id: f.id, name: f.name, icon: f.icon, count: counts[f.id] })));
    els.families.innerHTML = tabs
      .map(
        tab => `<button class="preset-tab${state.family === tab.id ? ' active' : ''}" role="tab"
            aria-selected="${state.family === tab.id}" data-family="${tab.id}" tabindex="${state.family === tab.id ? 0 : -1}">
            <span class="preset-tab-icon">${tab.icon}</span>${esc(tab.name)}<span class="preset-tab-count">${tab.count}</span></button>`
      )
      .join('');
    els.families.querySelectorAll('.preset-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.family = btn.dataset.family;
        render();
      });
      btn.addEventListener('keydown', event => {
        const tabs = [...els.families.querySelectorAll('.preset-tab')];
        const index = tabs.indexOf(btn);
        let next = -1;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        if (next >= 0) {
          event.preventDefault();
          tabs[next].focus();
          tabs[next].click();
        }
      });
    });
  }

  function cardHtml(preset) {
    const c = preset.__classification;
    const fav = favourites.has(preset.id);
    const passes = preset.mode === 'lace' && preset.passesPerLaceRow ? `${preset.passesPerLaceRow}\u00d7/row` : '';
    const fit = fits.get(preset.id) || { status: 'unknown', reasons: [] };
    const fitIcon = { feasible: '\u2713', 'needs-attention': '\u26a0', 'not-feasible': '\u2715', unknown: '?' }[fit.status] || '?';
    const fitTitle =
      fit.status === 'feasible'
        ? `Knits cleanly on the ${profile.name}`
        : `On the ${profile.name}: ${(fit.reasons || []).join('; ') || fit.status}`;
    return `<div class="preset-card${fav ? ' favourite' : ''}" data-preset="${esc(preset.id)}"
        role="button" tabindex="0" aria-label="Load ${esc(preset.name)}">
        <button class="preset-fav${fav ? ' on' : ''}" aria-pressed="${fav}" aria-label="Toggle favourite" data-fav="${esc(preset.id)}">\u2605</button>
        <span class="preset-fit fit-${esc(fit.status)}" title="${esc(fitTitle)}" aria-label="${esc(fitTitle)}">${fitIcon}</span>
        <canvas class="preset-thumb" width="132" height="96"></canvas>
        <div class="preset-title">${esc(preset.name)}</div>
        <div class="preset-meta">
          <span class="preset-badge">${esc(BED_LABELS[c.bed] || c.bed)}</span>
          ${passes ? `<span class="preset-tag">${passes}</span>` : ''}
        </div>
        <div class="preset-desc">${esc(preset.description)}</div>
      </div>`;
  }

  function render() {
    const visible = presets.filter(matches);
    if (els.count) els.count.textContent = `${visible.length} pattern${visible.length === 1 ? '' : 's'} \u00b7 ${profile.name}`;
    if (els.live) els.live.textContent = `${visible.length} patterns shown, fit checked against ${profile.name}`;

    const taxonomy = buildTaxonomy(visible);
    if (!taxonomy.length) {
      els.grid.innerHTML = '<div class="presets-empty">No patterns match \u2014 try a different word, or clear the filters.</div>';
      renderFamilyTabs();
      return;
    }

    els.grid.innerHTML = taxonomy
      .map(family => {
        const groups = family.groups
          .map(
            group => `<details class="preset-group" open>
              <summary>${esc(group.name)}<span class="preset-group-count">${group.presets.length}</span></summary>
              <div class="presets-cards">${group.presets.map(cardHtml).join('')}</div>
            </details>`
          )
          .join('');
        return `<section class="preset-family" data-family="${family.id}">
            <header class="preset-family-head">
              <h3><span class="preset-tab-icon">${family.icon}</span>${esc(family.name)}<span class="preset-group-count">${family.count}</span></h3>
              <p>${esc(family.blurb)}</p>
            </header>
            <div class="preset-groups">${groups}</div>
          </section>`;
      })
      .join('');

    // Wire cards, favourites and thumbnails after the HTML exists.
    els.grid.querySelectorAll('.preset-card').forEach(card => {
      const preset = presets.find(p => p.id === card.dataset.preset);
      const pick = () => {
        app.loadPreset(card.dataset.preset);
        app.closeAllModals();
      };
      card.addEventListener('click', event => {
        if (event.target.closest('.preset-fav')) return;
        pick();
      });
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          pick();
        }
      });
      app.renderPresetThumb(card.querySelector('.preset-thumb'), preset);
    });
    els.grid.querySelectorAll('.preset-fav').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        const id = btn.dataset.fav;
        if (favourites.has(id)) favourites.delete(id);
        else favourites.add(id);
        saveFavourites(favourites);
        if (state.favOnly) render();
        else {
          const card = btn.closest('.preset-card');
          const on = favourites.has(id);
          btn.classList.toggle('on', on);
          btn.setAttribute('aria-pressed', String(on));
          card.classList.toggle('favourite', on);
        }
      });
    });

    renderFamilyTabs();
  }

  if (els.search) {
    els.search.value = state.query;
    els.search.oninput = () => {
      state.query = els.search.value.trim().toLowerCase();
      render();
    };
  }
  if (els.bed) {
    els.bed.value = state.bed;
    els.bed.onchange = () => {
      state.bed = els.bed.value;
      render();
    };
  }
  if (els.favOnly) {
    els.favOnly.checked = state.favOnly;
    els.favOnly.onchange = () => {
      state.favOnly = els.favOnly.checked;
      render();
    };
  }
  if (els.fitsOnly) {
    els.fitsOnly.checked = state.fitsOnly;
    els.fitsOnly.onchange = () => {
      state.fitsOnly = els.fitsOnly.checked;
      render();
    };
  }

  render();
}
