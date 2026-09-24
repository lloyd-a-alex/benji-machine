/**
 * KNITCAT V2 — the short-row atlas.
 *
 * Short rows are the wedge work that turns a flat knitted rectangle into a shape that fits a
 * body — shoulder slope, back-neck scoop, bust dart, heel cup. The Fit Engine's templates
 * already emit every wrap-and-turn as an explicit `action: 'short-row'` row on each piece (see
 * `fit/short-rows.js` and `fit/templates/*.js`), and the Compiler counts them as a single
 * `shortRows` chip. But no UI ever told the knitter **which piece, which rows, what shape,
 * which anchor** — the actual instructions live on `piece.rows[i].notes`, and reading them
 * meant scrolling a raw row schedule. This is that missing read: a pure, DOM-free presenter
 * that groups consecutive short-row events on every piece into named wedges and quotes them
 * back as a knitter would want them: "left shoulder — rows 96-99, 4 turns, work 12 → 48 sts".
 *
 * Total: bad or empty input yields `null`; the view never throws. Nothing here re-derives any
 * shaping logic — every number is lifted straight from the piece's own row schedule.
 *
 * @module fit/short-rows-view
 */

/** The four wedge methods the Fit Engine templates emit. Anything else is labelled 'shaping'. */
const KNOWN_METHODS = ['shoulder', 'back neck', 'bust dart', 'heel turn'];

/**
 * Turn a live `state.report.fit.pieces` array into a UI-shaped atlas. Total: `null`, empty, or
 * garbage on either side yields `null` so the panel can hide the section rather than show an
 * empty table. Every figure is read from the piece's own row schedule — the view never
 * recomputes a wrap, a step, or an anchor.
 *
 * @param {Array<{id?:string, name?:string, castOn?:number, rows?:Array<{row:number, action:string, count:number, position?:string, notes?:string}>}>|null} pieces
 * @returns {{ok:true, headline:string, tone:'ok'|'warn', totalWedges:number, totalRows:number,
 *   totalExtraRows:number, methods:string[],
 *   pieces:Array<{id:string, name:string, wedges:Array<{method:string, anchor:string,
 *     firstRow:number, lastRow:number, turns:number, workedFrom:number, workedTo:number,
 *     extraRows:number, notes:string}>}>,
 *   all:string[]}|null}
 */
export function summariseShortRows(pieces) {
  if (!Array.isArray(pieces) || !pieces.length) return null;
  const perPiece = [];
  let totalWedges = 0;
  let totalRows = 0;
  let totalExtraRows = 0;
  const methodSet = new Set();
  const allLines = [];

  for (const p of pieces) {
    const rows = Array.isArray(p && p.rows) ? p.rows : [];
    const wedges = collectWedges(rows);
    if (!wedges.length) continue;
    perPiece.push({
      id: String((p && (p.id || p.name)) || 'piece'),
      name: String((p && p.name) || (p && p.id) || 'Piece'),
      wedges
    });
    totalWedges += wedges.length;
    for (const w of wedges) {
      totalRows += w.turns * 2; // each wedge covers `turns` forward rows and the same back
      totalExtraRows += w.extraRows;
      methodSet.add(w.method);
      allLines.push(`${p.name || p.id || 'Piece'} — ${w.method} (${w.anchor}), rows ${w.firstRow}–${w.lastRow}: ${w.turns} turns, worked ${w.workedFrom} → ${w.workedTo} sts, +${w.extraRows} rows`);
    }
  }

  if (!perPiece.length) return null;
  const methods = [...methodSet].sort();
  const headline = `${totalWedges} wedge${totalWedges === 1 ? '' : 's'} · ${methods.join(' + ') || 'shaping'}`;
  // Warn tone if any wedge has 8+ turns — that's a lot of wrap-and-turns the knitter should
  // know about before sitting down at the machine. Otherwise just informational.
  const busy = perPiece.some((pp) => pp.wedges.some((w) => w.turns >= 8));
  return {
    ok: true,
    headline,
    tone: busy ? 'warn' : 'ok',
    totalWedges,
    totalRows,
    totalExtraRows,
    methods,
    pieces: perPiece,
    all: allLines
  };
}

/** Walk a piece's row schedule and group consecutive `action:'short-row'` events into wedges. */
function collectWedges(rows) {
  const wedges = [];
  let current = null;
  for (const r of rows) {
    const isSR = r && r.action === 'short-row';
    if (isSR) {
      const method = methodFromNotes(r.notes);
      const worked = Number.isFinite(r.count) ? r.count : 0;
      if (current && current.method === method) {
        current.turns++;
        current.lastRow = r.row;
        current.workedTo = worked;
        current.notes = r.notes || current.notes;
      } else {
        if (current) wedges.push(finalise(current));
        current = {
          method,
          anchor: r.position || 'right',
          firstRow: r.row,
          lastRow: r.row,
          turns: 1,
          workedFrom: worked,
          workedTo: worked,
          notes: r.notes || ''
        };
      }
    } else if (current) {
      wedges.push(finalise(current));
      current = null;
    }
  }
  if (current) wedges.push(finalise(current));
  return wedges;
}

/** Add the derived `extraRows` (the vertical growth the wedge gives: half the SR row span). */
function finalise(w) {
  const span = Math.max(0, w.lastRow - w.firstRow + 1);
  w.extraRows = Math.max(w.turns, Math.round(span / 2));
  return w;
}

/** Parse "shoulder:", "back neck:", "bust dart:", "heel turn:" from a shaping note. */
function methodFromNotes(notes) {
  const s = String(notes || '');
  for (const m of KNOWN_METHODS) if (s.toLowerCase().includes(m)) return m;
  const colon = s.indexOf(':');
  return colon > 0 ? s.slice(0, colon).trim() : 'shaping';
}

/**
 * Render a {@link summariseShortRows} summary as a plain-text atlas, ready to paste into a
 * pattern or a knitter's working notes. Total: null → a short prompt, never a throw.
 *
 * @param {object|null} summary the result from {@link summariseShortRows}.
 * @param {object} [opts] @param {string} [opts.title='Short-row atlas'] the heading.
 * @returns {string} always ends in a newline.
 */
export function shortRowsToText(summary, opts = {}) {
  const title = (opts && opts.title) || 'Short-row atlas';
  if (!summary || !summary.ok) return 'Draft a garment with short rows (shoulders, back neck, bust darts, heels) to see the wedge-by-wedge plan.\n';
  const lines = [];
  lines.push(title);
  lines.push('='.repeat(title.length));
  lines.push(summary.headline);
  lines.push('');
  for (const p of summary.pieces) {
    lines.push(`${p.name}${p.id !== p.name ? ` (${p.id})` : ''}`);
    for (const w of p.wedges) {
      lines.push(`  • ${w.method} · ${w.anchor} · rows ${w.firstRow}–${w.lastRow}`);
      lines.push(`    ${w.turns} wrap-and-turn${w.turns === 1 ? '' : 's'} · worked ${w.workedFrom} → ${w.workedTo} sts · +${w.extraRows} rows`);
    }
    lines.push('');
  }
  lines.push(`Total: ${summary.totalWedges} wedge${summary.totalWedges === 1 ? '' : 's'} · ${summary.totalExtraRows} extra rows of length`);
  return lines.join('\n') + '\n';
}
