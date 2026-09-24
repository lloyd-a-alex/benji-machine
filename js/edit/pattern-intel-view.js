/**
 * KNITCAT V2 — Chart DNA: the structural fingerprint of a punchcard.
 *
 * `js/edit/pattern-intel.js` computes four beautiful read-only analyses — the smallest true
 * repeat, three symmetry axes, worked-cell density, and the content bounding box — but they are
 * only ever called from `chart-commands.js` as ephemeral toast notifications that vanish in three
 * seconds. The knitter who wants to know "does this tile cleanly?", "is it mirror-symmetric?",
 * "where is my densest band?" gets no persistent answer anywhere in the V2 panel architecture.
 *
 * This view calls the four analysis functions once, folds their results into a single structured
 * object the Compiler panel can render persistently, and offers a plain-text export for tech packs.
 * DOM-free (it imports only from the pure pattern-intel module which itself imports only math).
 *
 * @module edit/pattern-intel-view
 */

import { detectRepeat, symmetryReport, densityStats, contentBounds } from './pattern-intel.js';

/**
 * Compute and fold the four structural analyses into a panel-ready summary. Returns `null` when
 * the matrix is empty or entirely blank (nothing to analyse). Total: null/garbage → null; an
 * all-blank card → null (no worked cells means no repeat/symmetry to report).
 *
 * @param {number[][]|null} matrix the IR's cardMatrix (rows × cols of colour indices or STITCH_TYPE).
 * @param {{mode?:string}} [opts]
 * @param {string} [opts.mode='fair_isle'] the chart mode ('lace'|'fair_isle'|'tuck'|'slip').
 * @returns {{ok:true, headline:string, tone:'ok'|'warn'|'info',
 *   matrix:{rows:number,cols:number,mode:string},
 *   repeat:{rowPeriod:number,colPeriod:number,tilesY:number,tilesX:number,isFullRow:boolean,isFullCol:boolean},
 *   symmetry:{verticalPct:number,horizontalPct:number,rotationalPct:number,dominant:string},
 *   density:{pct:number,punched:number,total:number,busiestRow:number,densestCount:number},
 *   bounds:{rows:number,cols:number,wastedPct:number}|null}|null}
 */
export function summariseChartDNA(matrix, opts = {}) {
  if (!Array.isArray(matrix) || !matrix.length || !Array.isArray(matrix[0]) || !matrix[0].length) return null;
  const mode = String(opts.mode || 'fair_isle');

  const repeat = detectRepeat(matrix, { mode });
  const sym = symmetryReport(matrix, { mode });
  const dens = densityStats(matrix, { mode });
  const bounds = contentBounds(matrix, { mode });

  // If entirely blank, nothing interesting to say.
  if (dens.punched === 0) return null;

  const rows = matrix.length;
  const cols = matrix[0].length;

  // Symmetry percentages (0–100 integers).
  const verticalPct = Math.round((sym.vertical.pct || 0) * 100);
  const horizontalPct = Math.round((sym.horizontal.pct || 0) * 100);
  const rotationalPct = Math.round((sym.rotational.pct || 0) * 100);
  const axes = [['left↔right', verticalPct], ['top↔bottom', horizontalPct], ['180°', rotationalPct]];
  const dominant = axes.reduce((best, a) => (a[1] > best[1] ? a : best), axes[0])[0];

  // Busiest row (0-indexed → 1-indexed for humans).
  let busiestRow = 0;
  for (let i = 1; i < dens.perRow.length; i++) {
    if (dens.perRow[i] > dens.perRow[busiestRow]) busiestRow = i;
  }
  const densestCount = dens.perRow[busiestRow] || 0;
  const densityPct = Math.round((dens.density || 0) * 100);

  // Wasted padding: the area outside the content bounds vs. the full card.
  let boundInfo = null;
  if (bounds) {
    const contentArea = bounds.rows * bounds.cols;
    const wastedPct = Math.max(0, Math.round((1 - contentArea / dens.total) * 100));
    boundInfo = { rows: bounds.rows, cols: bounds.cols, wastedPct };
  }

  // Tile count.
  const tilesY = Math.max(1, Math.round(rows / repeat.rowPeriod));
  const tilesX = Math.max(1, Math.round(cols / repeat.colPeriod));

  // Tone: density > 85% → 'warn' (pull risk); no smaller repeat than whole + low symmetry → 'info'.
  const noRepeat = repeat.isFullRow && repeat.isFullCol;
  const lowSymmetry = Math.max(verticalPct, horizontalPct, rotationalPct) < 40;
  const tone = densityPct > 85 ? 'warn' : noRepeat && lowSymmetry ? 'info' : 'ok';

  // Headline: "6r × 8c repeat · 84% L↔R mirror · 34% density"
  const headline = [
    `${repeat.rowPeriod}r × ${repeat.colPeriod}c repeat`,
    `${verticalPct}% L↔R mirror`,
    `${densityPct}% density`
  ].join(' · ');

  return {
    ok: true,
    headline,
    tone,
    matrix: { rows, cols, mode },
    repeat: {
      rowPeriod: repeat.rowPeriod,
      colPeriod: repeat.colPeriod,
      tilesY,
      tilesX,
      isFullRow: repeat.isFullRow,
      isFullCol: repeat.isFullCol
    },
    symmetry: { verticalPct, horizontalPct, rotationalPct, dominant },
    density: { pct: densityPct, punched: dens.punched, total: dens.total, busiestRow: busiestRow + 1, densestCount },
    bounds: boundInfo
  };
}

/**
 * Render a {@link summariseChartDNA} summary as a plain-text report suitable for tech packs or
 * notes. Total: null → helpful prompt; never throws.
 *
 * @param {object|null} summary the result from {@link summariseChartDNA}.
 * @param {object} [opts] @param {string} [opts.title='Chart DNA'] heading override.
 * @returns {string} always ends in a newline.
 */
export function chartDNAToText(summary, opts = {}) {
  if (!summary || !summary.ok) return 'Load a chart to see its structural DNA.\n';
  const title = (opts && opts.title) || 'Chart DNA';
  const lines = [];
  lines.push(title);
  lines.push('='.repeat(title.length));
  lines.push(summary.headline);
  lines.push('');
  lines.push(`Matrix: ${summary.matrix.rows} rows × ${summary.matrix.cols} cols (${summary.matrix.mode})`);
  lines.push(`Repeat: ${summary.repeat.rowPeriod}r × ${summary.repeat.colPeriod}c → ${summary.repeat.tilesY}×${summary.repeat.tilesX} tiles`);
  if (summary.repeat.isFullRow && summary.repeat.isFullCol) lines.push('  (No smaller repeat than the whole card.)');
  lines.push(`Symmetry: L↔R ${summary.symmetry.verticalPct}% · T↔B ${summary.symmetry.horizontalPct}% · 180° ${summary.symmetry.rotationalPct}% (dominant: ${summary.symmetry.dominant})`);
  lines.push(`Density: ${summary.density.pct}% (${summary.density.punched}/${summary.density.total} worked)`);
  lines.push(`Busiest row: ${summary.density.busiestRow} (${summary.density.densestCount} needles)`);
  if (summary.bounds) {
    lines.push(`Content box: ${summary.bounds.rows}r × ${summary.bounds.cols}c · ${summary.bounds.wastedPct}% padding`);
  }
  return lines.join('\n') + '\n';
}
