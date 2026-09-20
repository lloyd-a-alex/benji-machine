/**
 * KNITCAT — AYAB bitstream reader.
 *
 * The reverse of `FormatsExporter.generateAyabFormat`: an `AYAB_FORMAT_V1` tag, a
 * `ROWS:`/`COLS:` header, then `START_IMAGE`, one bit string per row (row 0 first,
 * exactly as the exporter writes them) and `END_IMAGE`. Because the exporter stores
 * `cardMatrix` (a boolean punchcard), what comes back is a 0/1 stranded chart.
 *
 * @module importers/ayab-import
 */

export function looksLikeAyabText(text) {
  return /^\s*AYAB_FORMAT_V1\b/.test(String(text || ''));
}

/**
 * @param {string} text
 * @returns {{ok:boolean, matrix?:number[][], mode?:string, warnings?:string[], error?:string}}
 */
export function readAyabText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const header = {};
  for (const line of lines) {
    const m = /^(ROWS|COLS):\s*(\d+)\b/.exec(line.trim());
    if (m) header[m[1].toLowerCase()] = parseInt(m[2], 10);
  }
  const start = lines.findIndex(l => l.trim() === 'START_IMAGE');
  if (start < 0) return { ok: false, error: 'AYAB file has no START_IMAGE block.' };
  const matrix = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === 'END_IMAGE') break;
    if (!line) continue;
    if (!/^[01]+$/.test(line)) continue; // ignore any stray commentary line
    matrix.push([...line].map(ch => (ch === '1' ? 1 : 0)));
  }
  if (!matrix.length) return { ok: false, error: 'The AYAB image block held no rows.' };
  const warnings = [];
  const declaredCols = header.cols;
  const actualCols = Math.max(...matrix.map(r => r.length));
  if (Number.isFinite(declaredCols) && declaredCols !== actualCols) {
    warnings.push(`The file declares ${declaredCols} columns but the image is ${actualCols} wide. Believed the image.`);
  }
  for (const row of matrix) while (row.length < actualCols) row.push(0);
  return { ok: true, matrix, mode: 'fair_isle', warnings };
}
