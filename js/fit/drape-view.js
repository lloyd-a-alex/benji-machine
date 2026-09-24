/**
 * KNITCAT V2 — the drape read.
 *
 * The Fit Engine runs a position-based cloth solver on *every* draft (`DrapeSimulator.simulate`
 * — spec §2.5) and it returns a genuinely useful summary: how fluidly the fabric will hang
 * (drapeScore 0..1), the mean signed ease across all rows, a per-panel heatmap of ease and a
 * list of the rows that go negative (where the garment will pinch). A test even asserts the
 * drape ran — but no panel ever showed the result. This module is that missing read.
 *
 * It is a pure presenter: it re-derives nothing from the physics. It simply labels the numbers
 * a knitter can act on (fluid vs boardy; average ease in cm; "panel X row Y is 0.4 cm tight").
 * DOM-free and total: bad or empty input yields null, never a throw.
 *
 * @module fit/drape-view
 */

/** A finite number; anything else (null, "", NaN, {}, undefined) is rejected to null. */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Round to `dp` decimals, null-safe. */
function round(v, dp = 1) {
  const n = num(v);
  if (n == null) return null;
  const s = 10 ** dp;
  return Math.round(n * s) / s;
}

/**
 * Translate the simulator's 0..1 drape score into a plain-English verdict. Thresholds are
 * chosen around the physical behavior of knit fabric: 0.7+ behaves like fluid silk or fine
 * laceweight, 0.4–0.7 hangs like DK/aran on a body, 0.25–0.4 sits more like stiff tweed,
 * under that the fabric reads as boardy and won't follow curves.
 */
export function drapeVerdict(score) {
  const s = num(score);
  if (s == null) return { label: 'Unknown', tone: '' };
  if (s >= 0.7) return { label: 'Fluid', tone: 'ok' };
  if (s >= 0.4) return { label: 'Balanced', tone: 'ok' };
  if (s >= 0.25) return { label: 'Stiff', tone: 'warn' };
  return { label: 'Boardy', tone: 'bad' };
}

/**
 * Summarise a DrapeResult (`fit.drape`) into a UI-friendly shape. Never recomputes anything
 * the simulator did; only labels, rounds and ranks what came back.
 *
 * @param {object} drape the `fit.drape` object from `draftFromProject`.
 * @returns {{ok:true, score:number|null, verdict:string, tone:string, averageEase:number|null,
 *   panelCount:number, panels:Array, tightSpotCount:number, tightSpots:Array, headline:string}|null}
 */
export function summariseDrape(drape) {
  if (!drape || typeof drape !== 'object') return null;
  const rawPanels = Array.isArray(drape.panels) ? drape.panels : [];
  if (!rawPanels.length) return null;
  const score = num(drape.drapeScore);
  const v = drapeVerdict(score);
  const averageEase = round(drape.averageEase, 1);

  const panels = rawPanels
    .filter((p) => p && typeof p === 'object')
    .slice(0, 12)
    .map((p) => {
      const heat = (Array.isArray(p.heatmap) ? p.heatmap : []).map(num).filter((n) => n != null);
      if (!heat.length) return { id: String(p.id || 'panel'), rows: 0, min: null, max: null, mean: null };
      const sum = heat.reduce((s, n) => s + n, 0);
      return {
        id: String(p.id || 'panel'),
        rows: heat.length,
        min: round(Math.min(...heat), 2),
        max: round(Math.max(...heat), 2),
        mean: round(sum / heat.length, 2)
      };
    });

  const allTight = Array.isArray(drape.tightSpots) ? drape.tightSpots : [];
  const tightSpots = allTight
    .filter((t) => t && typeof t === 'object')
    .map((t) => ({ panel: String(t.panel || 'panel'), row: num(t.row), easeCm: round(t.easeCm, 2) }))
    .filter((t) => t.easeCm != null && t.easeCm < 0)
    .sort((a, b) => a.easeCm - b.easeCm) // tightest first
    .slice(0, 8);

  const tone = score != null && score >= 0.5 && tightSpots.length === 0
    ? 'ok'
    : score != null && score < 0.3
      ? 'bad'
      : 'warn';

  const parts = [];
  parts.push(`Drape ${score != null ? score.toFixed(2) : 'n/a'} · ${v.label}`);
  if (averageEase != null) parts.push(`avg ease ${averageEase} cm`);
  parts.push(tightSpots.length ? `${tightSpots.length} tight spot${tightSpots.length === 1 ? '' : 's'}` : 'no tight spots');
  const headline = parts.join(' · ');

  return {
    ok: true,
    score,
    verdict: v.label,
    tone,
    averageEase,
    panelCount: panels.length,
    panels,
    tightSpotCount: tightSpots.length,
    tightSpots,
    headline
  };
}

/**
 * Render a {@link summariseDrape} summary as a plain-text sheet, ready to paste into notes or
 * a tech pack. Total and defensive: a null summary yields a short prompt.
 *
 * @param {object|null} summary the summary from {@link summariseDrape}.
 * @param {object} [opts] @param {string} [opts.title='Drape report'] the sheet heading.
 * @returns {string} the printable sheet, always ending in a newline.
 */
export function drapeToText(summary, opts = {}) {
  const title = (opts && opts.title) || 'Drape report';
  if (!summary || !summary.ok) {
    return 'Simulate a garment in the Fit panel to see how the fabric will hang.\n';
  }
  const lines = [];
  lines.push(title);
  lines.push('='.repeat(title.length));
  lines.push(summary.headline);
  if (summary.panels.length) {
    lines.push('');
    lines.push('Per-panel ease heatmap (cm; negative = fabric grips the body)');
    for (const p of summary.panels) {
      lines.push(`  ${p.id} · ${p.rows} row(s) · mean ${fmt(p.mean)} · min ${fmt(p.min)} · max ${fmt(p.max)}`);
    }
  }
  if (summary.tightSpots.length) {
    lines.push('');
    lines.push('Tight spots (where the garment will pinch)');
    for (const t of summary.tightSpots) {
      lines.push(`  ${t.panel} row ${t.row == null ? '?' : t.row}: ${fmt(t.easeCm)} cm`);
    }
  } else {
    lines.push('');
    lines.push('No tight spots — the fabric clears the body everywhere.');
  }
  return lines.join('\n') + '\n';
}

function fmt(n) { return n == null ? '—' : String(n); }
