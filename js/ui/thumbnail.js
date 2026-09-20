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
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const d = _dpr();
  canvas.width = Math.round(box * d);
  canvas.height = Math.round(box * d);
  canvas.style.width = box + 'px';
  canvas.style.height = box + 'px';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
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
