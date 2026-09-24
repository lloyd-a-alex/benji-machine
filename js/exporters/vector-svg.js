/**
 * Scalable Vector Graphics (SVG) Exporter
 * 
 * Features:
 * 1. Laser-cutter CAM standard format (LightBurn / Glowforge / K40 ready)
 * 2. 1:1 Scale Printable PDF / Vector multi-page tiling engine:
 *    Automatically tiles long punchcard strips onto standard A4 or US-Letter pages
 *    with registration crosses, overlap seam lines, and precision calibration ruler.
 */

import { calculateCardDimensions } from '../machine/profiles.js';
import { logger } from '../core/logging.js';

const log = logger('exporters/vector-svg');

/** Geometry fields the SVG circle coordinates depend on — a missing one becomes a NaN path. */
const REQUIRED_GEOMETRY = ['pitchX', 'pitchY', 'holeDiameter', 'sprocketDiameter', 'sprocketPitchY', 'marginSide', 'sprocketToFirstHole', 'marginTopBottom', 'cardWidth'];

export class VectorSvgExporter {
  /**
   * Generates a single continuous laser-cutter ready SVG
   */
  static generateLaserSvg(profile, cardMatrix, options = {}) {
    // The physical card geometry (pitch, sprockets, hole diameters) comes only from
    // the profile; a missing one is a caller bug, surfaced clearly rather than as a
    // null property access deep in the routine.
    if (!profile || typeof profile !== 'object') {
      throw new TypeError('VectorSvgExporter.generateLaserSvg requires a machine profile.');
    }
    const badFields = REQUIRED_GEOMETRY.filter((k) => !Number.isFinite(profile[k]));
    if (badFields.length) log.error('machine profile is missing non-numeric geometry fields, SVG will carry NaN coordinates', { profile: profile.name || profile.id, badFields });
    const {
      cutColor = '#ff0000',
      scoreColor = '#0000ff',
      textColor = '#000000',
      includeSprockets = true,
      includeText = true
    } = options;

    let rows = cardMatrix.length;
    let cols = cardMatrix[0]?.length || 24;
    // Physical leader differs by machine (Brother 7 vs Silver Reed 5 reading rows).
    const lead = profile.carriageRules?.cardReadingOffsetRows || 0;
    if (lead > 0) { cardMatrix = [...Array.from({ length: lead }, () => new Array(cols).fill(false)), ...cardMatrix]; rows = cardMatrix.length; }
    const dims = calculateCardDimensions(profile, rows, cols);

    const holeR = profile.holeDiameter / 2.0;
    const sprockR = profile.sprocketDiameter / 2.0;

    const svg = [];
    svg.push(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>`);
    svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${dims.widthMm}mm" height="${dims.heightMm}mm" viewBox="0 0 ${dims.widthMm} ${dims.heightMm}">`);
    svg.push(`<defs>`);
    svg.push(`  <style>`);
    svg.push(`    .cut-line { fill: none; stroke: ${cutColor}; stroke-width: 0.15; stroke-linecap: round; }`);
    svg.push(`    .score-line { fill: none; stroke: ${scoreColor}; stroke-width: 0.15; stroke-dasharray: 1,1; }`);
    svg.push(`    .engrave-text { font-family: monospace; font-size: 2.2px; fill: ${textColor}; stroke: none; font-weight: bold; }`);
    svg.push(`  </style>`);
    svg.push(`</defs>`);

    // Group: Perimeter Card Boundary
    svg.push(`<g id="card-outline">`);
    svg.push(`  <rect class="cut-line" x="0" y="0" width="${dims.widthMm}" height="${dims.heightMm}" rx="2" ry="2"/>`);
    svg.push(`</g>`);

    // Group: Sprocket Tractor Holes
    if (includeSprockets) {
      svg.push(`<g id="sprocket-holes">`);
      for (let r = 0; r < rows; r++) {
        const y = dims.rowOffsetYMm + r * profile.sprocketPitchY;
        svg.push(`  <circle class="cut-line" cx="${dims.leftSprocketXMm.toFixed(2)}" cy="${y.toFixed(2)}" r="${sprockR}"/>`);
        svg.push(`  <circle class="cut-line" cx="${dims.rightSprocketXMm.toFixed(2)}" cy="${y.toFixed(2)}" r="${sprockR}"/>`);
      }
      svg.push(`</g>`);
    }

    // Group: Pattern Punch Holes
    svg.push(`<g id="pattern-holes">`);
    for (let r = 0; r < rows; r++) {
      const y = dims.rowOffsetYMm + r * profile.pitchY;
      for (let c = 0; c < cols; c++) {
        if (cardMatrix[r][c]) {
          const x = dims.colOffsetXMm + c * profile.pitchX;
          svg.push(`  <circle class="cut-line" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${holeR}"/>`);
        }
      }
    }
    svg.push(`</g>`);

    // Group: Text & Markings
    if (includeText) {
      svg.push(`<g id="engrave-labels">`);
      const title = profile.name ? String(profile.name).toUpperCase() : 'KNITCAT CARD';
      if (!profile.name) log.warn('generateLaserSvg profile has no name — labelling with a placeholder');
      svg.push(`  <text class="engrave-text" x="${dims.widthMm / 2}" y="7" text-anchor="middle">${title}</text>`);

      for (let r = 0; r < rows; r += 2) {
        const y = dims.rowOffsetYMm + r * profile.pitchY + 0.8;
        svg.push(`  <text class="engrave-text" x="${(dims.leftSprocketXMm + 2.8).toFixed(2)}" y="${y.toFixed(2)}">${r + 1}</text>`);
        svg.push(`  <text class="engrave-text" x="${(dims.rightSprocketXMm - 2.8).toFixed(2)}" y="${y.toFixed(2)}" text-anchor="end">${r + 1}</text>`);
      }
      svg.push(`</g>`);
    }

    svg.push(`</svg>`);
    return svg.join('\n');
  }

  /**
   * Generates Multi-Page Tiled Printable SVG Sheets for standard A4 / US-Letter printers.
   * Includes 50mm calibration test ruler and overlap gluing margins!
   */
  static generateTiledPrintablePages(profile, cardMatrix, paperType = 'A4') {
    if (!profile || typeof profile !== 'object') {
      throw new TypeError('VectorSvgExporter.generateTiledPrintablePages requires a machine profile.');
    }
    const badFields = REQUIRED_GEOMETRY.filter((k) => !Number.isFinite(profile[k]));
    if (badFields.length) log.error('machine profile is missing non-numeric geometry fields, tiled print will carry NaN coordinates', { profile: profile.name || profile.id, badFields });
    const paperDims = (paperType === 'Letter')
      ? { widthMm: 215.9, heightMm: 279.4 }
      : { widthMm: 210.0, heightMm: 297.0 }; // Standard A4

    let rows = cardMatrix.length;
    let cols = cardMatrix[0]?.length || 24;
    const lead = profile.carriageRules?.cardReadingOffsetRows || 0;
    if (lead > 0) { cardMatrix = [...Array.from({ length: lead }, () => new Array(cols).fill(false)), ...cardMatrix]; rows = cardMatrix.length; }
    const dims = calculateCardDimensions(profile, rows, cols);

    const printableMargin = 15.0; // mm margins on paper
    const maxPrintHeight = paperDims.heightMm - (printableMargin * 2);
    const overlapMm = 15.0; // Overlap area for taping segments together

    // Number of rows that fit per page
    const effectiveHeightPerPage = maxPrintHeight - overlapMm;
    const totalPages = Math.ceil(dims.heightMm / effectiveHeightPerPage);

    const pages = [];

    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
      const startY = pageIdx * effectiveHeightPerPage;
      const endY = Math.min(dims.heightMm, startY + maxPrintHeight);
      const segmentHeight = endY - startY;

      const svg = [];
      svg.push(`<?xml version="1.0" encoding="UTF-8"?>`);
      svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${paperDims.widthMm}mm" height="${paperDims.heightMm}mm" viewBox="0 0 ${paperDims.widthMm} ${paperDims.heightMm}">`);
      
      // Page styling
      svg.push(`<style>
        .paper-border { fill: #ffffff; stroke: #e2e8f0; stroke-width: 0.5; }
        .card-body { fill: #fdfbf7; stroke: #0f172a; stroke-width: 0.4; }
        .punch-hole { fill: #000000; stroke: #000000; stroke-width: 0.2; }
        .sprocket-hole { fill: #334155; stroke: #0f172a; stroke-width: 0.2; }
        .grid-line { stroke: #cbd5e1; stroke-width: 0.15; stroke-dasharray: 0.8, 0.8; }
        .cut-marker { stroke: #e11d48; stroke-width: 0.4; stroke-dasharray: 3, 2; }
        .overlap-guide { fill: #fff1f2; opacity: 0.5; stroke: #e11d48; stroke-width: 0.2; }
        .label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; font-size: 2.2px; fill: #0f172a; }
        .title { font-family: monospace; font-size: 3.5px; font-weight: bold; fill: #0f172a; }
        .ruler-mark { stroke: #0f172a; stroke-width: 0.3; }
      </style>`);

      // Centering card segment on paper
      const cardOffsetX = (paperDims.widthMm - dims.widthMm) / 2;
      const cardOffsetY = printableMargin;

      // Draw Card Segment Background
      svg.push(`<rect class="card-body" x="${cardOffsetX}" y="${cardOffsetY}" width="${dims.widthMm}" height="${segmentHeight}"/>`);

      // Overlap indicator
      if (pageIdx < totalPages - 1) {
        svg.push(`<rect class="overlap-guide" x="${cardOffsetX}" y="${cardOffsetY + segmentHeight - overlapMm}" width="${dims.widthMm}" height="${overlapMm}"/>`);
        svg.push(`<line class="cut-marker" x1="${cardOffsetX - 5}" y1="${cardOffsetY + segmentHeight - overlapMm}" x2="${cardOffsetX + dims.widthMm + 5}" y2="${cardOffsetY + segmentHeight - overlapMm}"/>`);
        svg.push(`<text class="label" x="${cardOffsetX + 5}" y="${cardOffsetY + segmentHeight - overlapMm + 4}" fill="#e11d48">▲ TAPE OVERLAP SEAM (PAGE ${pageIdx + 1} OVER ${pageIdx + 2}) ▲</text>`);
      }

      // Draw Punch Holes in this vertical segment
      const holeR = profile.holeDiameter / 2;
      const sprockR = profile.sprocketDiameter / 2;

      for (let r = 0; r < rows; r++) {
        const absY = dims.rowOffsetYMm + r * profile.pitchY;
        if (absY >= startY && absY <= endY) {
          const localY = cardOffsetY + (absY - startY);

          // Tractor Sprockets
          svg.push(`<circle class="sprocket-hole" cx="${cardOffsetX + dims.leftSprocketXMm}" cy="${localY}" r="${sprockR}"/>`);
          svg.push(`<circle class="sprocket-hole" cx="${cardOffsetX + dims.rightSprocketXMm}" cy="${localY}" r="${sprockR}"/>`);

          // Row Label
          svg.push(`<text class="label" x="${cardOffsetX + dims.leftSprocketXMm + 2.8}" y="${localY + 0.8}">${r + 1}</text>`);
          svg.push(`<text class="label" x="${cardOffsetX + dims.rightSprocketXMm - 2.8}" y="${localY + 0.8}" text-anchor="end">${r + 1}</text>`);

          // Column holes
          for (let c = 0; c < cols; c++) {
            const localX = cardOffsetX + dims.colOffsetXMm + c * profile.pitchX;
            if (cardMatrix[r][c]) {
              svg.push(`<circle class="punch-hole" cx="${localX}" cy="${localY}" r="${holeR}"/>`);
            } else {
              // Dim crosshair center marking for unpunched cells
              svg.push(`<circle cx="${localX}" cy="${localY}" r="0.25" fill="#94a3b8"/>`);
            }
          }
        }
      }

      // 50mm Calibration Test Ruler (Crucial for verifying 100% scale without printer shrink!)
      const rulerX = cardOffsetX;
      const rulerY = paperDims.heightMm - 8.0;
      svg.push(`<g id="calibration-ruler">`);
      svg.push(`  <text class="label" x="${rulerX}" y="${rulerY - 3}">CALIBRATION VERIFICATION: MEASURE EXACTLY 50mm WITH RULER (DO NOT FIT-TO-PAGE)</text>`);
      svg.push(`  <line class="ruler-mark" x1="${rulerX}" y1="${rulerY}" x2="${rulerX + 50}" y2="${rulerY}"/>`);
      for (let mm = 0; mm <= 50; mm += 5) {
        const h = (mm % 10 === 0) ? 3.0 : 1.8;
        svg.push(`  <line class="ruler-mark" x1="${rulerX + mm}" y1="${rulerY - h}" x2="${rulerX + mm}" y2="${rulerY + h}"/>`);
      }
      svg.push(`  <text class="label" x="${rulerX}" y="${rulerY + 5}">0mm</text>`);
      svg.push(`  <text class="label" x="${rulerX + 50}" y="${rulerY + 5}" text-anchor="end">50mm</text>`);
      svg.push(`</g>`);

      // Page Header Info
      svg.push(`<text class="title" x="${paperDims.widthMm / 2}" y="10" text-anchor="middle">${profile.name || 'KNITCAT CARD'} - Page ${pageIdx + 1} of ${totalPages}</text>`);

      svg.push(`</svg>`);
      pages.push(svg.join('\n'));
    }

    return pages;
  }

  /**
   * Printable carriage-pass schedule sheets.
   *
   * A knitter standing at the machine does not want a CSV; they want a sheet of
   * paper they can tick rows off on. This turns the compiler's stroke list into a
   * two-column HTML grid, one compact line per carriage pass, chunked into pages
   * with a running footer. It is DOM-free (pure string) so it is unit-testable and
   * so `printHtml` can drop it straight into a print frame.
   *
   * Each line reads, for a transfer pass:
   *   #07  LACE L→R  card row 7  needles 12,14,18 → 11,13,17
   * and for a plain knit / blank selecting row the needle list is replaced by the
   * punch list or a short description.
   *
   * @param {Array<object>} strokes  The `compilationResult.strokes` array.
   * @param {object}        [options]
   * @param {object}        [options.profile]      Machine profile (used for the header name).
   * @param {string}        [options.paper='A4']   Paper label for the header.
   * @param {number}        [options.perPage=36]   Strokes per sheet before a page break.
   * @param {number}        [options.perColumn=18] Strokes per column within a sheet.
   * @returns {string} an HTML fragment (a run of `.sched-page` blocks).
   */
  static generateScheduleSheets(strokes, { profile = null, paper = 'A4', perPage = 36, perColumn = 18 } = {}) {
    const list = Array.isArray(strokes) ? strokes.filter(Boolean) : [];
    const esc = (v) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const machineName = profile && profile.name ? profile.name : 'Punchcard machine';
    const paperLabel = paper === 'Letter' ? 'US Letter' : String(paper || 'A4');

    const dirLabel = (d) => (d === 'L_TO_R' ? 'L→R' : d === 'R_TO_L' ? 'R←L' : '—');
    const carriageLabel = (t) => (t === 'LACE' ? 'LACE' : t === 'COMB' ? 'COMBINED' : t === 'KNIT' ? 'KNIT' : (t ? esc(t) : 'PASS'));
    const cols = (arr) => (Array.isArray(arr) && arr.length
      ? arr.map((n) => (Number.isFinite(n) ? n + 1 : n)).join(', ')
      : '');

    const lineFor = (s, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      const cardRow = Number.isFinite(s.cardRowIndex) ? s.cardRowIndex + 1 : '?';
      const transfers = Array.isArray(s.transfers) ? s.transfers : [];
      let detail;
      if (transfers.length) {
        const src = cols(transfers.map((t) => t.sourceCol));
        const dst = cols(transfers.map((t) => t.targetCol));
        detail = `<span class="sched-detail">needles ${esc(src)} → ${esc(dst)}</span>`;
      } else {
        const punches = cols(s.punchcardHoles);
        detail = punches
          ? `<span class="sched-detail">punches ${esc(punches)}</span>`
          : `<span class="sched-detail sched-blank">${esc(s.notes || 'blank pass')}</span>`;
      }
      return `<li class="sched-row${s.carriageType === 'LACE' ? ' is-lace' : ''}">`
        + `<span class="sched-num">#${num}</span>`
        + `<span class="sched-type">${carriageLabel(s.carriageType)}</span>`
        + `<span class="sched-dir">${dirLabel(s.direction)}</span>`
        + `<span class="sched-card">row ${cardRow}</span>`
        + `${detail}</li>`;
    };

    if (!list.length) {
      return `<div class="sched-page"><p class="sched-empty">No carriage passes to print. `
        + `Design a lace pattern and open the Schedule tab first.</p></div>`;
    }

    const safePerPage = Math.max(1, Math.min(200, perPage | 0));
    const pages = [];
    for (let start = 0; start < list.length; start += safePerPage) {
      pages.push(list.slice(start, start + safePerPage));
    }
    const total = pages.length;
    const half = Math.ceil((pages[0] || []).length / 2);

    const pageHtml = (pageStrokes, pageIdx) => {
      const columnSlice = (slice) => `<ul class="sched-col">`
        + slice.map((s, j) => lineFor(s, pageStrokes.indexOf(s) === -1 ? j : pageStrokes.indexOf(s))).join('')
        + `</ul>`;
      // Two balanced columns per sheet; indexOf keeps global stroke numbering.
      const offset = pageIdx * safePerPage;
      const leftIdx = pageStrokes.slice(0, half).map((s, j) => ({ s, n: offset + j }));
      const rightIdx = pageStrokes.slice(half).map((s, j) => ({ s, n: offset + half + j }));
      const renderCol = (rows) => `<ul class="sched-col">`
        + rows.map(({ s, n }) => lineFor(s, n)).join('') + `</ul>`;
      const body = (leftIdx.length || rightIdx.length)
        ? renderCol(leftIdx) + renderCol(rightIdx)
        : columnSlice(pageStrokes);
      return `<section class="sched-page">`
        + `<header class="sched-head"><span class="sched-title">Carriage schedule</span>`
        + `<span class="sched-machine">${esc(machineName)} · ${esc(paperLabel)}</span>`
        + `<span class="sched-count">${list.length} passes</span></header>`
        + `<div class="sched-cols">${body}</div>`
        + `<footer class="sched-foot">KNITCAT · page ${pageIdx + 1} of ${total}</footer>`
        + `</section>`;
    };

    const styles = `
      .sched-page { page-break-after: always; }
      .sched-page:last-child { page-break-after: auto; }
      .sched-head { display: flex; justify-content: space-between; align-items: baseline;
        border-bottom: 1.5pt solid #111; padding-bottom: 2mm; margin-bottom: 3mm; }
      .sched-title { font-size: 14pt; font-weight: 700; }
      .sched-machine, .sched-count { font-size: 9pt; color: #444; }
      .sched-cols { display: flex; gap: 6mm; }
      .sched-col { list-style: none; margin: 0; padding: 0; flex: 1 1 0; }
      .sched-row { display: flex; gap: 4px; align-items: baseline; font-family: ui-monospace, monospace;
        font-size: 9pt; line-height: 1.5; border-bottom: 0.4pt dotted #cbd5e1; }
      .sched-row.is-lace .sched-type { color: #b91c1c; font-weight: 700; }
      .sched-num { color: #64748b; min-width: 22px; }
      .sched-type { min-width: 44px; }
      .sched-dir { min-width: 34px; color: #0f766e; }
      .sched-card { min-width: 46px; color: #475569; }
      .sched-detail { flex: 1 1 auto; }
      .sched-blank { color: #94a3b8; font-style: italic; }
      .sched-foot { margin-top: 4mm; text-align: right; font-size: 8pt; color: #64748b; }
      .sched-empty { color: #64748b; font-style: italic; }
    `;
    return `<style>${styles}</style>` + pages.map(pageHtml).join('');
  }
}
