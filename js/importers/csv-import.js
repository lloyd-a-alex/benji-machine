/**
 * KNITCAT — CSV punchcard reader.
 *
 * The exact inverse of `FormatsExporter.generateCsv`: a `Row,Col_1,Col_2,…` header
 * followed by one line per chart row of `0`/`1` cells. Kept deliberately tolerant —
 * the value column is only used for its position, blank/extra columns are ignored,
 * and any row wider than the header simply sets the width — so a spreadsheet that
 * lost its header, gained a totals column, or reordered rows still comes in.
 *
 * @module importers/csv-import
 */

/** Match the exporter's header so the registry can tell CSV from anything else. */
export function looksLikeCsvMatrix(text) {
  return /^\s*Row\s*,\s*Col_1/i.test(String(text || ''));
}

/**
 * @param {string} text
 * @returns {{ok:boolean, matrix?:number[][], mode?:string, warnings?:string[], error?:string}}
 */
export function readCsvMatrix(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, error: 'The CSV file was empty.' };
  const dataLines = looksLikeCsvMatrix(lines[0]) ? lines.slice(1) : lines;
  const matrix = [];
  for (const line of dataLines) {
    const cells = line.split(',');
    // Drop the leading Row-number column when present; keep the rest as 0/1 flags.
    const body = looksLikeCsvMatrix(lines[0]) ? cells.slice(1) : cells;
    matrix.push(body.map(cell => (/^[1-9]/.test(String(cell).trim()) ? 1 : 0)));
  }
  if (!matrix.length) return { ok: false, error: 'The CSV had no data rows.' };
  const width = Math.max(...matrix.map(r => r.length));
  for (const row of matrix) if (row.length < width) row.push(0);
  return { ok: true, matrix, mode: 'fair_isle', warnings: [] };
}
