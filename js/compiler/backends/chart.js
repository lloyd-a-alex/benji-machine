/**
 * KNITCAT V2 — the chart backend (spec §4.6.1).
 *
 * Emits a colour or symbol knitting chart as SVG from the IR's `cardMatrix` (rows × colour
 * indices) and colour assignments. Charts are drawn the way knitters read them: right-side rows
 * alternate direction (odd rows left→right, even rows right→left), with a border, repeat boxes,
 * row numbers and a colour key. This is the old "chart tool" made honest — it now renders whatever
 * the compiler derived, not a separately-maintained matrix. Pure `(ir) => string`. DOM-free
 * (returns an SVG string; the UI injects it).
 *
 * @module compiler/backends/chart
 */

const CELL = 24;
const BORDER = 40;

/** Render a charted colourwork grid as an SVG string. @param {object} ir @returns {string} */
export function chartBackend(ir) {
  const matrix = ir.cardMatrix;
  if (!matrix || !matrix.length) return emptyChart('No colourwork chart to render.');
  const cols = Math.max(...matrix.map(r => r.length));
  const rows = matrix.length;
  const width = cols * CELL + BORDER * 2;
  const height = rows * CELL + BORDER * 2 + 40;
  const colors = ir.colors || [];
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, monospace" font-size="11">`);
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(`<text x="${BORDER}" y="24" font-size="14" font-weight="700">${escapeXml(ir.metadata && ir.metadata.name ? ir.metadata.name + ' — chart' : 'Chart')}</text>`);

  // Grid cells, top row drawn first (knitters read bottom-up, but SVG y grows down: reverse).
  for (let r = rows - 1; r >= 0; r--) {
    const y = BORDER + (rows - 1 - r) * CELL;
    for (let c = 0; c < cols; c++) {
      // Right-side rows read right-to-left; flip the x mapping on WS rows.
      const visualCol = (r % 2 === 0) ? c : (cols - 1 - c);
      const idx = (matrix[r] || [])[visualCol] || 0;
      const x = BORDER + c * CELL;
      const fill = colors[idx] && colors[idx].hex ? colors[idx].hex : '#ffffff';
      parts.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${escapeAttr(fill)}" stroke="#333" stroke-width="0.5"/>`);
      if (colors[idx] && colors[idx].symbol && isLight(fill)) parts.push(`<text x="${x + CELL / 2}" y="${y + CELL / 2 + 4}" text-anchor="middle" fill="#111">${escapeXml(colors[idx].symbol)}</text>`);
    }
    const rowNum = r % 2 === 1 ? r + 1 : '';
    const label = rowNum || '';
    parts.push(`<text x="${BORDER - 6}" y="${y + CELL / 2 + 4}" text-anchor="end" fill="#333">${label}</text>`);
    parts.push(`<text x="${BORDER + cols * CELL + 6}" y="${y + CELL / 2 + 4}" text-anchor="start" fill="#333">${r % 2 === 0 ? r + 1 : ''}</text>`);
  }

  // Colour key.
  let kx = BORDER, ky = BORDER + rows * CELL + 24;
  parts.push(`<text x="${kx}" y="${ky}" font-weight="700">Key:</text>`);
  kx += 40;
  colors.forEach((col, i) => {
    parts.push(`<rect x="${kx}" y="${ky - 11}" width="14" height="14" fill="${escapeAttr(col.hex || '#fff')}" stroke="#333"/>`);
    parts.push(`<text x="${kx + 18}" y="${ky}">${escapeXml(col.yarn || ('C' + (i + 1)))}</text>`);
    kx += 18 + String(col.yarn || ('C' + (i + 1))).length * 7 + 20;
  });
  parts.push('</svg>');
  return parts.join('');
}

function emptyChart(msg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="60"><rect width="360" height="60" fill="#f4f4f4"/><text x="12" y="34" font-family="sans-serif" font-size="14" fill="#555">${escapeXml(msg)}</text></svg>`;
}
function isLight(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
function escapeXml(s) { return String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }
