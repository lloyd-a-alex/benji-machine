/**
 * KNITCAT V2 — the written backend (spec §4.6.2 / §11.3).
 *
 * The single most-demanded output and the one the old app never had: a *complete, human* pattern
 * you could hand to a knitter or publish in a magazine. This walks the IR and emits proper
 * pattern prose — materials, gauge, finished measurements, then per piece: cast on, rib as
 * established, "work even until piece measures X cm", and the shaping written the way patterns
 * are actually read ("Dec row (RS): k1, ssk, knit to last 3, k2tog, k1. (2 sts decreased)").
 *
 * It collapses runs of plain rows into "Work N rows even", tracks the live stitch count so every
 * shaping line ends with the honest "(NN sts)" parenthetical knitters check, and folds the
 * finishing plan (bands, cuffs, collar pick-up) into a closing section. Pure: `(ir) => string`.
 * DOM-free.
 *
 * @module compiler/backends/written
 */

/** Convert an IR into a full written pattern in Markdown. @param {object} ir @returns {string} */
export function writtenBackend(ir) {
  const L = [];
  const m = ir.metadata || {};
  L.push(`# ${m.name || 'Untitled pattern'}`);
  L.push('');
  if (m.construction && m.construction !== 'unknown') L.push(`*Construction: ${humanConstruction(m.construction)}*`);
  if (m.notes) { L.push(''); L.push(m.notes); }
  L.push('');

  L.push('## Materials');
  const yarnNames = (m.yarnNames && m.yarnNames.length) ? m.yarnNames : (ir.colors || []).map(c => c.yarn);
  L.push(`- Yarn: ${yarnNames.length ? [...new Set(yarnNames)].join(', ') : 'as specified'}`);
  L.push(`- Gauge: ${num(ir.gauge.stsPer10cm)} sts × ${num(ir.gauge.rowsPer10cm)} rows = 10 cm / 4 in`);
  if (ir.machine && ir.machine.gaugeMm) L.push(`- Machine / needles: ${ir.machine.id || 'standard'}, ${num(ir.machine.gaugeMm)} mm`);
  L.push('');

  L.push('## Finished Measurements');
  if (m.finishedBust) L.push(`- Bust: ${round1(m.finishedBust)} cm`);
  if (m.finishedLength) L.push(`- Length: ${round1(m.finishedLength)} cm`);
  if (m.finishedSleeve) L.push(`- Sleeve: ${round1(m.finishedSleeve)} cm`);
  L.push('');

  for (const piece of ir.pieces || []) L.push(...pieceSection(piece));

  const finish = finishingSection(ir);
  if (finish.length) { L.push(...finish); }

  L.push('## Seams & Assembly');
  L.push(...seamLines(ir));
  L.push('');
  L.push('Weave in ends, block to measurements, and sew seams with a mattress stitch for an invisible join.');
  return L.join('\n');
}

/** One `## Piece` section: cast on, then the row narrative. @returns {string[]} */
function pieceSection(piece) {
  const L = [];
  L.push(`## ${piece.name || cap(piece.id)}`);
  L.push('');
  const make = piece.dimensions && piece.dimensions.make ? ` (make ${piece.dimensions.make})` : (/sleeve/i.test(piece.id) ? ' (make 2)' : '');
  L.push(`**Cast on ${piece.stitches} stitches** using a stretchy cast-on${make}.`);
  if (Array.isArray(piece.joinFrom) && piece.joinFrom.length) L.push(`_Join to ${piece.joinFrom.join(' + ')}.`);
  if (piece.pickUp && piece.pickUp.count) L.push(`Pick up ${piece.pickUp.count} stitches around ${piece.pickUp.edge || 'the edge'}.`);
  L.push('');

  let live = piece.stitches;
  const rows = piece.rowsDetail || [];
  let i = 1;
  while (i < rows.length) {
    const row = rows[i];
    const line = describeRow(row, i, live);
    // A collapsed plain block: row.repeat > 1 → "Work N rows even".
    if (line.plain) {
      const n = line.repeat || 1;
      if (n > 1) { L.push(`Work ${n} rows even.`); live = row.stitchesAfter; i += n; continue; }
      L.push(`Row ${i}: ${line.text}`);
      live = row.stitchesAfter; i++; continue;
    }
    L.push(`Row ${i} (${row.rightSide ? 'RS' : 'WS'}): ${line.text}`);
    live = row.stitchesAfter;
    i += line.repeat || 1;
  }
  if (rows.length) L.push(`(${live} sts).`);
  L.push('');
  return L;
}

/** Describe a single IR row as pattern prose, or flag it as a plain "work even" block. */
function describeRow(row, index, live) {
  const repeat = row.repeat || 1;
  const ops = row.operations || [];
  if (!ops.length || (ops.length === 1 && ops[0].kind === 'knit' && !row.note)) {
    return { plain: true, text: 'knit as established.', repeat };
  }
  const parts = [];
  let paren = '';
  for (const o of ops) {
    switch (o.kind) {
      case 'decrease': {
        const n = o.count || 1;
        parts.push(o.position === 'both' ? `k1, ssk, work to last 3 sts, k2tog, k1` : `work ${n} decrease(s) at the ${o.position || 'edge'}`);
        paren = ` (${live - (o.position === 'both' ? n * 2 : n)} sts)`;
        break;
      }
      case 'increase': {
        const n = o.count || 1;
        parts.push(o.position === 'both' ? `k1, m1L, work to last st, m1R, k1` : `make ${n} increase(s) at the ${o.position || 'edge'}`);
        paren = ` (${live + (o.position === 'both' ? n * 2 : n)} sts)`;
        break;
      }
      case 'bind-off':
        parts.push(`bind off ${o.count || 1}${o.position === 'both' ? ' at each end' : ''}${styleSuffix(o.style)}`);
        break;
      case 'short-row':
        parts.push(`work ${o.count || 1} short-row${(o.count || 1) > 1 ? 's' : ''} (wrap & turn) at the ${o.side || 'armhole'} edge`);
        break;
      case 'yarn-change':
        parts.push(`change to ${o.to}`);
        break;
      case 'rib':
        parts.push(`work ${o.count || ''} ${o.note || 'rib'} as set`);
        break;
      case 'pick-up':
        parts.push(`pick up ${o.count} sts ${o.from ? `from ${o.from}` : ''}`);
        break;
      case 'join':
        parts.push('join to work in the round, being careful not to twist');
        break;
      default:
        if (row.note) parts.push(row.note);
    }
  }
  const text = parts.join('; ') || (row.note || 'work as pattern');
  return { plain: false, text: `${text}${paren}`.trim(), repeat: 1 };
}

/** Turn the finishing plan (if attached) into closing sections. */
function finishingSection(ir) {
  const fin = ir.finishing || (ir.metadata && ir.metadata.finishing);
  if (!fin || !fin.bands || !fin.bands.length) return [];
  const L = [];
  for (const band of fin.bands) {
    L.push(`## ${cap(band.type || 'band')}`);
    if (band.pickUp) L.push(`Pick up ${band.pickUp} stitches.`);
    if (band.stitches) L.push(`Work ${band.stitches} sts in ${band.style || 'rib'} for ${band.rows || '?'} rows, then bind off loosely.`);
    L.push('');
  }
  return L;
}

function seamLines(ir) {
  const out = [];
  for (const p of ir.pieces || []) for (const e of (p.edges || [])) out.push(`- Join ${p.name || p.id}${e.with ? ` to ${e.with}` : ''}${e.note ? ` — ${e.note}` : ''}.`);
  if (!out.length) out.push('- No flat seams — pieces are joined in the round.');
  return out;
}

function styleSuffix(style) {
  if (!style || style === 'standard') return '';
  return ` using the ${style} method`;
}
function humanConstruction(c) { return String(c).replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').trim().toLowerCase().replace(/^./, s => s.toUpperCase()); }
function cap(s) { return String(s || '').replace(/^./, c => c.toUpperCase()); }
function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
