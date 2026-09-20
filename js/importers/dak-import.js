/**
 * KNITCAT — DesignaKnit (DAK) stitch-pattern reader.
 *
 * The reverse of `FormatsExporter.generateDakText`: a `[DESIGNAKNIT_STITCH_PATTERN]`
 * tag, `WIDTH=`/`HEIGHT=` header, `DATA=`, then the chart written TOP row first (the
 * exporter iterates `r = rows-1 … 0`), one comma-joined line per row. Cells are the
 * raw stitch tokens the exporter printed, so a lace card comes back as `'K'`/`'O'`
 * strings and a stranded card as `0`/`1` — the reader detects which and sets the mode
 * to match, exactly the way `readProject` trusts the matrix over the header.
 *
 * @module importers/dak-import
 */

export function looksLikeDakText(text) {
  return /\[DESIGNAKNIT_STITCH_PATTERN\]/.test(String(text || ''));
}

/**
 * @param {string} text
 * @returns {{ok:boolean, matrix?:Array<Array<*>>, mode?:string, warnings?:string[], error?:string}}
 */
export function readDakText(text) {
  const raw = String(text || '').split(/\r?\n/);
  const start = raw.findIndex(l => l.trim() === 'DATA=');
  if (start < 0) return { ok: false, error: 'The DAK block has no DATA= section.' };
  const header = {};
  for (const line of raw.slice(0, start)) {
    const m = /^(WIDTH|HEIGHT)=(\d+)/i.exec(line.trim());
    if (m) header[m[1].toLowerCase()] = parseInt(m[2], 10);
  }

  const topFirst = [];
  for (let i = start + 1; i < raw.length; i++) {
    const line = raw[i].trim();
    if (!line) continue;
    if (looksLikeDakText(line) || /^(WIDTH|HEIGHT|DATA)=/i.test(line)) continue;
    topFirst.push(line.split(',').map(cell => normaliseCell(cell)));
  }
  if (!topFirst.length) return { ok: false, error: 'The DAK DATA block held no rows.' };

  // Exporter wrote the top of the chart first; KNITCAT indexes row 0 at the bottom,
  // so reverse to put it back the way the editor stores it.
  const matrix = topFirst.reverse();
  const width = Math.max(...matrix.map(r => r.length));
  const warnings = [];
  if (Number.isFinite(header.width) && header.width !== width) {
    warnings.push(`The file declares ${header.width} columns but the data is ${width} wide. Believed the data.`);
  }
  for (const row of matrix) {
    while (row.length < width) row.push(blankFor(row, matrix));
  }
  const mode = inferMode(matrix);
  return { ok: true, matrix, mode, warnings };
}

/** Trim a printed cell; numeric tokens stay numbers so the mode inference is honest. */
function normaliseCell(raw) {
  const v = String(raw).trim();
  if (v === '') return 0;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** A blank that matches whatever kind of value this chart already uses. */
function blankFor() {
  return 0;
}

/** All-numeric 0/1-ish values are a stranded (Fair Isle) chart; anything else is lace. */
function inferMode(matrix) {
  let sawText = false;
  for (const row of matrix) {
    for (const cell of row) {
      if (typeof cell === 'string' && cell !== '') { sawText = true; break; }
    }
    if (sawText) break;
  }
  return sawText ? 'lace' : 'fair_isle';
}
