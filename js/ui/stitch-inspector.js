/**
 * KNITCAT — Stitch Inspector.
 *
 * A small, read-only HUD that answers "what is this cell?" the instant you hover a
 * needle: the symbol's name, what it does at the machine, which carriage and travel
 * direction perform it, its stitch count effect, the two neighbours that give a
 * transfer its meaning, and any local warning.
 *
 * It is deliberately a *consumer* of the editor, never a mutator: it reads
 * `editor.hoverCell` + `editor.matrix` and renders. All of the knitting knowledge
 * lives in `js/edit/stitch-info.js` (the single source of truth the compiler tests
 * also assert against), so the inspector can never disagree with the schedule.
 *
 * Importing this module has no DOM side effects — everything happens inside
 * {@link createStitchInspector}, which the app boots under a guarded step.
 *
 * @module ui/stitch-inspector
 */

import { inspectCell, inspectCellWarnings } from '../edit/stitch-info.js';
import { ensureKitStyles } from './kit.js';
import { logger } from '../core/logging.js';

const log = logger('ui/stitch-inspector');

const STYLE_ID = 'kx-stitch-inspector-style';
const PANEL_ID = 'kx-stitch-inspector';

/** Human labels for the carriage + travel enums emitted by stitch-info. */
const CARRIAGE_LABEL = { knit: 'Knit carriage', lace: 'Lace carriage', either: 'Either carriage' };
const TRAVEL_LABEL = { either: 'either pass', 'left-to-right': '→ L-to-R', 'right-to-left': '← R-to-L' };

/**
 * Mount the stitch inspector. Idempotent: a second call reuses the existing node.
 *
 * @param {object} deps
 * @param {() => any} deps.getEditor       Returns the live CanvasEditor (canvas, matrix, hoverCell).
 * @param {() => string} deps.getMode      Returns the current pattern mode id.
 * @param {() => any} deps.getProfile      Returns the current machine profile (used for limits).
 * @returns {{refresh: () => void, show: () => void, hide: () => void, destroy: () => void}}
 */
export function createStitchInspector(deps) {
  const getEditor = deps.getEditor || (() => null);
  const getMode = deps.getMode || (() => 'lace');
  const getProfile = deps.getProfile || (() => null);

  injectStyles();
  ensureKitStyles();

  // Reuse a node if one already exists (e.g. a re-init after a hot reload).
  let root = document.getElementById(PANEL_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = PANEL_ID;
    root.className = 'kx-hud';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.hidden = true;
    root.innerHTML = `
      <div class="kxi-head">
        <span class="kx-hud__pos" data-pos>Row — · Needle —</span>
        <span class="kx-tag" data-tag></span>
      </div>
      <div class="kx-hud__name" data-name></div>
      <div class="kx-hud__does" data-does></div>
      <div class="kx-hud__row" data-chips></div>
      <div class="kxi-nbrs" data-nbrs></div>
      <ul class="kxi-warns" data-warns></ul>`;
    document.body.appendChild(root);
  }

  const q = (sel) => root.querySelector(sel);
  const els = {
    pos: q('[data-pos]'), tag: q('[data-tag]'), name: q('[data-name]'),
    does: q('[data-does]'), chips: q('[data-chips]'), nbrs: q('[data-nbrs]'), warns: q('[data-warns]')
  };

  let last = null;       // last rendered signature, to avoid needless DOM churn
  let queued = false;    // rAF throttle guard
  let active = false;    // is the pointer over the canvas

  const editor = getEditor();
  const canvas = editor && editor.canvas;

  const onMove = () => schedule();
  const onEnter = () => { active = true; root.hidden = false; schedule(); };
  const onLeave = () => { active = false; root.hidden = true; last = null; };

  if (canvas) {
    canvas.addEventListener('pointermove', onMove, { passive: true });
    canvas.addEventListener('pointerenter', onEnter, { passive: true });
    canvas.addEventListener('pointerleave', onLeave, { passive: true });
  }
  // Re-render after any content edit that could change the hovered cell while the
  // pointer is parked (mode switch, resize, undo…). A cheap rAF refresh covers it.
  const onTick = () => { if (active) schedule(); };
  const timer = setInterval(onTick, 350);

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; refresh(); });
  }

  /** Recompute and repaint from the editor's current hover cell. Safe if off-card. */
  function refresh() {
    const ed = getEditor();
    const hc = ed && ed.hoverCell;
    if (!hc || hc.r < 0 || hc.c < 0) { if (!active) root.hidden = true; return; }
    const mode = getMode();
    const profile = getProfile();
    const info = inspectCell(ed.matrix, hc.r, hc.c, { mode, profile });

    // Only touch the DOM when something actually changed.
    const sig = `${info.r},${info.c},${mode},${info.value},${info.name},${info.ok ? 1 : 0}`;
    if (sig === last) return;
    last = sig;

    if (!info.ok) {
      root.hidden = false;
      els.pos.textContent = `Row ${info.r + 1} · Needle ${info.c + 1}`;
      els.tag.textContent = '';
      els.name.textContent = 'Off the card';
      els.does.textContent = info.error || '';
      els.chips.textContent = '';
      els.nbrs.textContent = '';
      els.warns.textContent = '';
      return;
    }

    root.hidden = false;
    els.pos.textContent = `Row ${info.row} · Needle ${info.needle}`;
    setText(els.tag, info.punched ? 'punched' : (info.blank ? 'blank' : ''), info.punched ? 'kx-tag--on' : 'kx-tag--off');
    els.name.textContent = info.chart ? `${info.name}  ·  ${info.chart}` : (info.name || '—');
    els.does.textContent = info.does || '';

    els.chips.textContent = '';
    addChip(els.chips, CARRIAGE_LABEL[info.carriage] || info.carriage || '');
    addChip(els.chips, TRAVEL_LABEL[info.travel] || info.travel || '');
    if (typeof info.stitchDelta === 'number' && info.stitchDelta !== 0) {
      addChip(els.chips, `${info.stitchDelta > 0 ? '+' : ''}${info.stitchDelta} live stitches`, info.stitchDelta > 0 ? 'kx-chip--up' : 'kx-chip--down');
    }
    els.chips.hidden = !els.chips.childElementCount;

    // Neighbours give a transfer its meaning; render them compactly, or hide the row.
    els.nbrs.textContent = '';
    if (Array.isArray(info.neighbours) && info.neighbours.length) {
      for (const n of info.neighbours) {
        const s = document.createElement('span');
        s.className = 'kxi-nbr';
        s.textContent = n.edge ? n.text : `${n.label}: ${n.name}${n.punched ? ' ●' : ''}`;
        els.nbrs.appendChild(s);
      }
    }

    els.warns.textContent = '';
    let warns = [];
    try { warns = inspectCellWarnings(ed.matrix, hc.r, hc.c, { mode }) || []; } catch (err) { log.warn('cell warnings could not be computed for the inspector', { row: hc.r, col: hc.c, error: err?.message }); }
    for (const w of warns) {
      const li = document.createElement('li');
      li.className = `kxi-warn kxi-warn--${w.level || 'info'}`;
      li.textContent = w.text || String(w);
      els.warns.appendChild(li);
    }
    els.warns.hidden = !warns.length;
  }

  function show() { root.hidden = false; }
  function hide() { root.hidden = true; }
  function destroy() {
    if (canvas) {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerenter', onEnter);
      canvas.removeEventListener('pointerleave', onLeave);
    }
    clearInterval(timer);
    root.remove();
  }

  return { refresh, show, hide, destroy, root };
}

/* ── module-private helpers (all DOM use is after boot) ──────────────────────── */

/** Set text + (optionally) swap a single modifier class. @param {Element} el */
function setText(el, text, modClass) {
  el.textContent = text || '';
  el.hidden = !text;
  if (modClass) {
    el.classList.remove('kx-tag--on', 'kx-tag--off');
    if (text) el.classList.add(modClass);
  }
}

/** Append a small labelled chip. @param {Element} host @param {string} text */
function addChip(host, text, modClass) {
  if (!text) return;
  const chip = document.createElement('span');
  chip.className = 'kx-chip' + (modClass ? ' ' + modClass : '');
  chip.textContent = text;
  host.appendChild(chip);
}

let stylesInjected = false;
/** Inject the inspector stylesheet once. Additive and never throws into boot. */
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) { stylesInjected = true; return; }
  const css = `
  #kx-stitch-inspector .kxi-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px}
  #kx-stitch-inspector .kxi-nbrs{display:flex;flex-wrap:wrap;gap:8px;color:var(--panel-muted);font-size:11.5px;margin-bottom:4px}
  #kx-stitch-inspector .kxi-nbr::before{content:'· ';color:#4b556a}
  #kx-stitch-inspector .kxi-warns{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:3px}
  #kx-stitch-inspector .kxi-warn{font-size:11.5px;line-height:1.4;padding-left:12px;position:relative;color:var(--panel-muted)}
  #kx-stitch-inspector .kxi-warn::before{content:'';position:absolute;left:0;top:5px;width:6px;height:6px;border-radius:50%;background:var(--accent-amber)}
  #kx-stitch-inspector .kxi-warn--error::before{background:var(--accent-rose)}
  #kx-stitch-inspector .kxi-warn--info::before{background:var(--accent-cyan)}
  @media (max-width:640px){ #kx-stitch-inspector{max-width:min(76vw,300px)} }
  `;
  try {
    const style = document.createElement('style');
    style.id = STYLE_ID; style.textContent = css;
    document.head.appendChild(style);
    stylesInjected = true;
  } catch (err) { stylesInjected = true; log.debug('the stitch-inspector stylesheet failed to inject — it stays unstyled but functional', { error: err?.message }); }
}
