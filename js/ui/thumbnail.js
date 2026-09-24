/**
 * KNITCAT — punchcard thumbnails.
 *
 * A saved project means almost nothing as a filename; it means everything as the
 * *picture of the card*. Both the bottom taskbar and the Projects Dashboard show a
 * little rendered punchcard so you can pick "the feather-and-fan one" at a glance,
 * and they share the exact same drawing so a card can never look like two different
 * things in two places.
 *
 * The two geometry/text decisions are pure and DOM-free ({@link punchMask},
 * {@link fitThumb}) and asserted in `tests/thumbnail.test.mjs`; {@link drawPunchcard}
 * only touches a 2D context you hand it, so it stays importable under Node.
 *
 * @module ui/thumbnail
 */

import { logger } from '../core/logging.js';

const log = logger('ui/thumbnail');

/** A cell counts as "punched" (drawn filled) unless it is blank/empty. */
function isPunchedValue(v) {
  return v !== 0 && v !== false && v != null && v !== '' && v !== 'EMPTY';
}

/**
 * Reduce any matrix (numbers, STITCH_TYPE strings, booleans, ragged rows) to a
 * rectangular boolean grid — true where a needle is punched / carries pattern.
 * @param {Array<Array<any>>} matrix
 * @returns {boolean[][]}
 */
export function punchMask(matrix) {
  const src = Array.isArray(matrix) ? matrix : [];
  let cols = 0;
  for (const row of src) if (Array.isArray(row) && row.length > cols) cols = row.length;
  const out = [];
  for (let r = 0; r < src.length; r++) {
    const row = Array.isArray(src[r]) ? src[r] : [];
    const line = new Array(cols).fill(false);
    for (let c = 0; c < cols; c++) line[c] = isPunchedValue(row[c]);
    out.push(line);
  }
  return out;
}

/**
 * Choose the largest cell size that fits a `rows × cols` grid inside a `box × box`
 * square (with `pad` inset on every side). A whole-pixel cell is preferred for crisp
 * 1× rendering, but a card with more cells than the box has pixels can only fit with
 * a sub-pixel cell — which is fine on a canvas and correct on HiDPI — so the result
 * is fractional there. Always returns cell > 0 and width/height <= the inner box.
 * @param {number} rows
 * @param {number} cols
 * @param {number} box  the square the thumbnail must fit in, px
 * @param {number} [pad=2]
 * @returns {{cell:number,width:number,height:number,rows:number,cols:number}}
 */
export function fitThumb(rows, cols, box, pad = 2) {
  const r = Math.max(0, Math.trunc(rows) || 0);
  const c = Math.max(0, Math.trunc(cols) || 0);
  const inner = Math.max(1, (Math.trunc(box) || 1) - pad * 2);
  if (!r || !c) return { cell: 1, width: inner, height: inner, rows: r, cols: c };
  // Whole pixels when they fit; otherwise a fractional cell so it still fits.
  const raw = Math.min(inner / c, inner / r);
  const cell = raw >= 1 ? Math.floor(raw) : Math.max(0.05, raw);
  return { cell, width: cell * c, height: cell * r, rows: r, cols: c };
}

/**
 * The chart matrix to preview for a project: the live chart if it has cells, else
 * the first chart that does. Pure — shared by the taskbar and the Studio so the
 * same project is always the same picture. Returns [] when there is nothing drawn.
 * @param {object} project
 * @returns {Array<Array<any>>}
 */
export function previewMatrix(project) {
  const charts = (project && project.charts) || [];
  const live = charts.find(c => c && c.id === 'live' && Array.isArray(c.cells) && c.cells.length)
    || charts.find(c => c && Array.isArray(c.cells) && c.cells.length);
  return live ? live.cells : [];
}

function _dpr() { return (typeof window !== 'undefined' && window.devicePixelRatio) || 1; }

/**
 * Render a punchcard thumbnail straight into a canvas element, HiDPI-aware and
 * letterboxed in a `box × box` CSS-pixel square. The only DOM-touching helper here
 * so the taskbar and the dashboard share one pixel-identical renderer.
 * @param {HTMLCanvasElement} canvas
 * @param {Array<Array<any>>} matrix
 * @param {number} box  CSS pixel size of the square
 * @param {{bg?:string,fg?:string,pad?:number}} [opts]
 */
export function renderThumbnail(canvas, matrix, box, opts = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') { log.debug('renderThumbnail got no usable canvas — skipping the punchcard thumb'); return; }
  const d = _dpr();
  canvas.width = Math.round(box * d);
  canvas.height = Math.round(box * d);
  canvas.style.width = box + 'px';
  canvas.style.height = box + 'px';
  const ctx = canvas.getContext('2d');
  if (!ctx) { log.warn('a thumbnail canvas returned no 2D context — it cannot be drawn'); return; }
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, box, box);
  drawPunchcard(ctx, punchMask(matrix), Object.assign({ box }, opts));
}

/**
 * Paint a punchcard mask into a 2D context, letterboxed inside `box × box`.
 * The caller sizes the canvas (width = height = box); nothing here reads the DOM.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {boolean[][]} mask  output of {@link punchMask}
 * @param {object} [opts]
 * @param {number} [opts.box=64]      the square to draw within, in canvas px
 * @param {number} [opts.pad=2]
 * @param {string} [opts.bg]          hole/blank colour (default transparent)
 * @param {string} [opts.fg='#e8eefc'] punched/ink colour
 */
export function drawPunchcard(ctx, mask, opts = {}) {
  if (!ctx) return;
  const box = Math.trunc(opts.box) || 64;
  const pad = opts.pad == null ? 2 : opts.pad;
  const rows = mask.length;
  const cols = rows ? mask[0].length : 0;
  const fit = fitThumb(rows, cols, box, pad);
  if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, box, box); }
  ctx.fillStyle = opts.fg || '#e8eefc';
  const ox = Math.round((box - fit.width) / 2);
  const oy = Math.round((box - fit.height) / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r][c]) continue;
      ctx.fillRect(ox + c * fit.cell, oy + r * fit.cell, fit.cell, fit.cell);
    }
  }
}

/**
 * Cell-level diff of two charts, as a rectangular grid of small integer codes.
 *
 * {@link diffMatrices} in project/backups.js answers "how many cells changed" for
 * banners and toasts; a *picture* of the change needs to know which cell, and in
 * which direction. This is that per-cell view — pure, DOM-free, and the single
 * source of truth for both {@link drawDiff} and {@link renderDiffCard}, so the
 * versions modal can never disagree with the recovery banner about what moved.
 *
 * Codes: 0 unchanged-blank · 1 kept (punched in both) · 2 added (was blank) ·
 * 3 removed (now blank) · 4 recolored (punched in both, different value).
 *
 * @param {Array<Array<any>>} before  the older chart (left)
 * @param {Array<Array<any>>} after   the newer chart (right)
 * @returns {{rows:number,cols:number,cells:Uint8Array[]}}
 */
export function diffCells(before, after) {
  const a = Array.isArray(before) ? before : [];
  const b = Array.isArray(after) ? after : [];
  const rows = Math.max(a.length, b.length);
  let cols = 0;
  for (const row of a) if (Array.isArray(row)) cols = Math.max(cols, row.length);
  for (const row of b) if (Array.isArray(row)) cols = Math.max(cols, row.length);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const ra = Array.isArray(a[r]) ? a[r] : [];
    const rb = Array.isArray(b[r]) ? b[r] : [];
    const line = new Uint8Array(cols);
    for (let c = 0; c < cols; c++) {
      const pa = isPunchedValue(ra[c]);
      const pb = isPunchedValue(rb[c]);
      if (!pa && !pb) line[c] = 0;
      else if (pa && !pb) line[c] = 3;      // removed
      else if (!pa && pb) line[c] = 2;      // added
      else line[c] = normCell(ra[c]) === normCell(rb[c]) ? 1 : 4; // kept / recolored
    }
    cells.push(line);
  }
  return { rows, cols, cells };
}

/** Collapse a cell to a comparable primitive (blank -> 0). */
function normCell(v) {
  return v === false || v === null || v === undefined || v === '' ? 0 : v;
}

/** Default colour for each diff code; overridable via opts.colors. */
export const DIFF_COLORS = {
  1: '#64748b', // kept     — grey
  2: '#22c55e', // added    — green
  3: '#ef4444', // removed  — red
  4: '#3b82f6'  // recolored — blue
};

/**
 * Paint a {@link diffCells} result into a 2D context, letterboxed in `box × box`.
 * DOM-free — hand it a context (or an OffscreenCanvas context) and it draws.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{rows:number,cols:number,cells:Uint8Array[]}} diff
 * @param {object} [opts]
 * @param {number} [opts.box=64]
 * @param {number} [opts.pad=2]
 * @param {string} [opts.bg]
 * @param {Record<number,string>} [opts.colors]
 */
export function drawDiff(ctx, diff, opts = {}) {
  if (!ctx || !diff) return;
  const box = Math.trunc(opts.box) || 64;
  const pad = opts.pad == null ? 2 : opts.pad;
  const colors = Object.assign({}, DIFF_COLORS, opts.colors || {});
  const fit = fitThumb(diff.rows, diff.cols, box, pad);
  if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, box, box); }
  const ox = Math.round((box - fit.width) / 2);
  const oy = Math.round((box - fit.height) / 2);
  for (let r = 0; r < diff.rows; r++) {
    const line = diff.cells[r];
    if (!line) continue;
    for (let c = 0; c < diff.cols; c++) {
      const code = line[c];
      if (!code) continue;
      ctx.fillStyle = colors[code] || colors[1];
      ctx.fillRect(ox + c * fit.cell, oy + r * fit.cell, fit.cell, fit.cell);
    }
  }
}

/**
 * Render a before/after diff straight into a canvas, HiDPI-aware. Same pixel
 * pipeline as {@link renderThumbnail} so a diff card matches the look of every
 * other thumbnail in the app.
 * @param {HTMLCanvasElement} canvas
 * @param {Array<Array<any>>} before
 * @param {Array<Array<any>>} after
 * @param {number} box
 * @param {object} [opts]
 */
export function renderDiffCard(canvas, before, after, box, opts = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') { log.debug('a thumbnail render got no usable canvas — skipping'); return; }
  const d = _dpr();
  canvas.width = Math.round(box * d);
  canvas.height = Math.round(box * d);
  canvas.style.width = box + 'px';
  canvas.style.height = box + 'px';
  const ctx = canvas.getContext('2d');
  if (!ctx) { log.warn('a thumbnail canvas returned no 2D context — it cannot be drawn'); return; }
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, box, box);
  drawDiff(ctx, diffCells(before, after), Object.assign({ box }, opts));
}
