/**
 * KNITCAT — Stitch-symbol legend.
 *
 * The chart is drawn in a notation (○, \, /, filled squares) that a first punchcard
 * is not expected to already read. The vocabulary exists — every symbol's name,
 * carriage, travel direction and a plain-language "what happens" already live in
 * {@link module:edit/stitch-info}'s `symbolLegend()` — but it was only ever shown for
 * a single hovered cell, and `symbolLegend()` itself had no consumer at all. This
 * turns that dormant table into a browsable legend you can *point at the card with*:
 * click a symbol and every needle doing that thing lights up, so "where are my
 * left-transfers?" is answered by looking, not by guessing.
 *
 * Split like the rest of the feature docks:
 *   - {@link countSymbols} / {@link cellsOfValue} are pure + DOM-free (testable).
 *   - {@link createSymbolLegend} mounts the dock and drives the editor highlight. It
 *     never mutates the matrix, so a boot failure is no panel, never a broken card.
 *
 * @module features/symbol-legend
 */

import { symbolLegend } from '../edit/stitch-info.js';
import { buildPanel, esc } from '../ui/kit.js';
import { getDiagnostics } from '../core/diagnostics.js';

const STYLE_ID = 'kx-legend-style';
const PANEL_ID = 'kx-symbol-legend';
const BUTTON_ID = 'kx-symbol-legend-btn';

/** Count how many cells of the card carry each symbol value. Pure. */
export function countSymbols(matrix) {
  const counts = new Map();
  const grid = Array.isArray(matrix) ? matrix : [];
  for (const row of grid) {
    if (!Array.isArray(row)) continue;
    for (const value of row) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

/** Every [row, col] on the card whose value === `value`. Pure. */
export function cellsOfValue(matrix, value) {
  const cells = [];
  const grid = Array.isArray(matrix) ? matrix : [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) if (row[c] === value) cells.push([r, c]);
  }
  return cells;
}

/**
 * Mount the symbol-legend dock. Idempotent per document.
 *
 * @param {object} deps
 * @param {() => any} deps.getEditor  Live CanvasEditor (matrix, setHighlight, cols).
 * @param {{info?:Function,warn?:Function}} [deps.notifications]
 * @returns {{toggle:Function, open:Function, close:Function, isOpen:Function, refresh:Function, destroy:Function, button:HTMLElement}}
 */
export function createSymbolLegend(deps = {}) {
  const getEditor = deps.getEditor || (() => null);
  const notifier = deps.notifications || null;
  const diag = getDiagnostics().child('symbol-legend');

  injectStyles();
  const legend = symbolLegend();

  let button = document.getElementById(BUTTON_ID);
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = 'kx-hbtn';
    button.title = 'Stitch-symbol legend';
    button.setAttribute('aria-label', 'Open the stitch-symbol legend');
    button.innerHTML = '<span aria-hidden="true">\uD83D\uDCD6</span>';
    (document.querySelector('.brand-section') || document.body).appendChild(button);
  }

  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    const shell = buildPanel({
      id: PANEL_ID,
      className: 'kx-leg',
      glyph: '\uD83D\uDCD6',
      title: 'Symbol legend',
      pos: 'tr',
      stat: false,
      ariaLabel: 'Stitch-symbol legend and highlighter',
      actionsHtml: '<button type="button" class="kx-btn kx-btn--ghost" data-clear title="Clear highlight">Clear</button>'
    });
    panel = shell.panel;
    shell.body.innerHTML = '<p class="kx-leg-hint">Click a symbol to light up every needle doing it. Hover the editor for one cell\u2019s full story.</p><div class="kx-leg-list"></div>';
    document.body.appendChild(panel);
  }

  const list = panel.querySelector('.kx-leg-list');
  let open = false;
  function isOpen() { return open; }
  function show() { panel.hidden = false; open = true; render(); }
  function hide() { panel.hidden = true; open = false; }
  function toggle() { open ? hide() : show(); }

  button.addEventListener('click', toggle);
  panel.querySelector('[data-close]').addEventListener('click', hide);
  panel.querySelector('[data-clear]').addEventListener('click', () => {
    try { getEditor()?.clearHighlight?.(); } catch (_) { /* contained */ }
  });

  function render() {
    const ed = getEditor();
    const matrix = (ed && ed.matrix) || [];
    const counts = countSymbols(matrix);
    list.textContent = '';
    for (const item of legend) {
      const n = counts.get(item.value) || 0;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'kx-leg-item' + (n ? '' : ' kx-leg-item--zero');
      row.disabled = !n;
      row.innerHTML =
        `<span class="kx-leg-glyph" aria-hidden="true">${esc(chartGlyph(item.chart))}</span>` +
        `<span class="kx-leg-main"><b>${esc(item.name)}</b>` +
        `<i>${esc(item.does)}</i>` +
        `<em>${esc(item.carriage)} carriage · ${esc(item.travelLabel)} · ${n} on card</em></span>`;
      row.addEventListener('click', () => highlight(item, n));
      list.appendChild(row);
    }
  }

  function highlight(item, n) {
    const ed = getEditor();
    if (!ed || !n) return;
    const cells = cellsOfValue(ed.matrix, item.value);
    try { ed.setHighlight(cells, { label: item.name, color: '#a78bfa', fill: 'rgba(167,139,250,0.30)' }); } catch (_) { /* contained */ }
    notifier && notifier.info && notifier.info(`${item.name}: ${n} needle${n === 1 ? '' : 's'} highlighted. ${item.does}`);
  }

  function destroy() { button.remove(); panel.remove(); }

  diag.info('symbol legend mounted');
  return { toggle, open: show, close: hide, isOpen, refresh: () => { if (open) render(); }, destroy, button, panel };
}

// Pick the most legible single glyph out of the chart description ("circle ○" → ○).
function chartGlyph(chart) {
  const s = String(chart || '');
  const glyphs = [...s].filter(ch => ch.charCodeAt(0) > 0x2500);
  if (glyphs.length) return glyphs[0];
  if (/blank|nothing|dash/i.test(s)) return '\u00B7';
  if (/square/i.test(s)) return '\u25A0';
  if (/\\\\/.test(s)) return '\u2934';
  return '\u25C7';
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) { stylesInjected = true; return; }
  const css = `
  #kx-symbol-legend{width:330px;max-height:min(76vh,680px)}
  #kx-symbol-legend .kx-leg-hint{font-size:11px;color:var(--panel-muted);margin:2px 0 8px}
  #kx-symbol-legend .kx-leg-list{display:flex;flex-direction:column;gap:6px}
  #kx-symbol-legend .kx-leg-item{display:flex;gap:9px;align-items:flex-start;text-align:left;width:100%;cursor:pointer;
    background:rgba(2,6,23,.4);border:1px solid var(--panel-hairline);border-radius:10px;padding:7px 9px;color:var(--panel-text);font:inherit}
  #kx-symbol-legend .kx-leg-item:hover{border-color:var(--accent)}
  #kx-symbol-legend .kx-leg-item--zero{opacity:.42;cursor:default}
  #kx-symbol-legend .kx-leg-glyph{flex:0 0 26px;height:26px;display:inline-flex;align-items:center;justify-content:center;
    font-size:16px;color:#c4b5fd;background:rgba(167,139,250,.14);border:1px solid rgba(167,139,250,.34);border-radius:7px}
  #kx-symbol-legend .kx-leg-main{display:flex;flex-direction:column;min-width:0}
  #kx-symbol-legend .kx-leg-main b{font-size:12.5px}
  #kx-symbol-legend .kx-leg-main i{font-style:normal;font-size:11px;color:var(--panel-muted);line-height:1.4}
  #kx-symbol-legend .kx-leg-main em{font-style:normal;font-size:10px;color:var(--panel-faint);text-transform:uppercase;letter-spacing:.4px;margin-top:2px}
  @media (max-width:640px){ #kx-symbol-legend{width:min(90vw,340px)} }
  `;
  try {
    const style = document.createElement('style');
    style.id = STYLE_ID; style.textContent = css;
    document.head.appendChild(style);
    stylesInjected = true;
  } catch (_) { stylesInjected = true; /* unstyled but functional is acceptable */ }
}
