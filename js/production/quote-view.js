/**
 * KNITCAT V2 — the design-quote read.
 *
 * The pipeline already calls {@link buildDesignQuote} on every draft and stores the result on
 * `state.report.quote`, but the Production panel only rendered the raw `costing` numbers — the
 * chart histogram, per-colour yarn demand, carriage-pass time and priced customer lines that
 * the fused engine derives were all invisible. This is the missing read: a pure, DOM-free
 * presenter that reshapes a {@link module:production/quote.DesignQuote} into the exact fields the
 * panel needs and never re-derives any logic. It is total — bad input yields `null`, a real quote
 * yields a summary — and it delegates the printable text straight to `renderQuoteSheet` so the
 * copied card and the shown card can never disagree.
 *
 * @module production/quote-view
 */

import { renderQuoteSheet } from './quote.js';

const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const pct = (v) => (Number.isFinite(v) ? Math.round(v * 100) : null);

/**
 * Turn a full {@link module:production/quote.DesignQuote} into a UI-shaped summary. Total: pass
 * `null`, `{}` or garbage and you get `null` back — never a throw. Nothing here re-computes what
 * the quote engine already produced; every figure on the summary is lifted from the quote and
 * re-labelled, so the panel can never disagree with the underlying numbers.
 *
 * @param {object|null} quote the design quote from `state.report.quote` (or `buildDesignQuote`).
 * @returns {{ok:true, feasible:boolean, tone:'ok'|'info'|'warn'|'bad', headline:string,
 *   name:string, sku:string, currency:string, quantity:number, mode:string, presetId:string|null,
 *   footprint:{width:number|null, height:number|null}, stitches:number,
 *   chart:{rows:number, cols:number, cells:number, activeCells:number, opennessPct:number},
 *   yarnNeeds:Array<{name:string, colorway:string|null, hex:string|null, sharePct:number,
 *     balls:number, meters:number, grams:number, cost:number}>,
 *   yarnTotals:{meters:number, grams:number, cost:number},
 *   machine:{profileId:string|null, modelled:boolean, passes:number, cardRows:number,
 *     speed:number, minutesPer:number, hoursPer:number},
 *   time:{batchHours:number}, price:{retail:number, wholesale:number, profit:number,
 *     marginPct:number, unitCost:number}, lines:Array<{label:string, detail:string, amount:number}>,
 *   warnings:string[]}|null}
 */
export function summariseQuote(quote) {
  if (!quote || typeof quote !== 'object') return null;
  // Require the three headline sections the panel needs; anything thinner means the quote engine
  // never actually produced a run (bad input on buildDesignQuote), so treat as no summary.
  if (!quote.costing || !quote.price || !quote.yarn) return null;

  const feasible = !!quote.feasible;
  const warnings = Array.isArray(quote.warnings) ? quote.warnings.filter((w) => typeof w === 'string') : [];
  const marginPct = Number.isFinite(quote.price.marginPct) ? quote.price.marginPct : null;
  const profit = Number.isFinite(quote.price.profit) ? quote.price.profit : 0;
  const retail = Number.isFinite(quote.price.retail) ? quote.price.retail : 0;
  const currency = quote.currency || 'GBP';

  // Tone reflects the commercial reality of the quote, not just pass/fail.
  // - no profit (loss) or no yarn: 'bad'
  // - profitable but with warnings: 'warn' (actionable — read the notes)
  // - profitable and margin thin (<40%): 'info'
  // - profitable and healthy: 'ok'
  let tone;
  if (!feasible) tone = 'bad';
  else if (warnings.length) tone = 'warn';
  else if (marginPct != null && marginPct < 40) tone = 'info';
  else tone = 'ok';

  const headline = feasible
    ? `${formatMoneyLite(retail, currency)}/unit · ${marginPct != null ? marginPct.toFixed(0) + '% margin' : 'priced'}`
    : profit <= 0
      ? 'Not profitable at this price'
      : 'No yarn metres — check gauge & pieces';

  const chart = quote.chart || {};
  const needs = Array.isArray(quote.yarn.needs) ? quote.yarn.needs : [];
  const yarnNeeds = needs.map((n) => ({
    name: String(n.name || 'Yarn'),
    colorway: n.colorway ? String(n.colorway) : null,
    hex: n.hex ? String(n.hex) : null,
    sharePct: pct(n.share),
    balls: Number.isFinite(n.balls) ? n.balls : 0,
    meters: round1(n.meters) || 0,
    grams: round1(n.grams) || 0,
    cost: Number.isFinite(n.cost) ? n.cost : 0
  }));

  const machine = quote.machine || {};
  const design = quote.design || {};
  const fp = design.footprintCm || {};
  const time = quote.time || {};
  const lines = Array.isArray(quote.lines) ? quote.lines.map((l) => ({
    label: String(l.label || ''),
    detail: String(l.detail || ''),
    amount: Number.isFinite(l.amount) ? l.amount : 0
  })) : [];

  return {
    ok: true,
    feasible,
    tone,
    headline,
    name: String(quote.name || 'Custom design'),
    sku: String(quote.sku || ''),
    currency,
    quantity: Number.isFinite(quote.quantity) ? quote.quantity : 1,
    mode: String(design.mode || 'plain'),
    presetId: design.presetId ? String(design.presetId) : null,
    footprint: { width: round1(fp.width), height: round1(fp.height) },
    stitches: Number.isFinite(quote.geometry && quote.geometry.totalStitches) ? quote.geometry.totalStitches : 0,
    chart: {
      rows: chart.rows || 0,
      cols: chart.cols || 0,
      cells: chart.cells || 0,
      activeCells: chart.activeCells || 0,
      opennessPct: Number.isFinite(chart.opennessPct) ? chart.opennessPct : 0
    },
    yarnNeeds,
    yarnTotals: {
      meters: round1(quote.yarn.totalMeters) || 0,
      grams: round1(quote.yarn.totalGrams) || 0,
      cost: Number.isFinite(quote.yarn.totalCost) ? quote.yarn.totalCost : 0
    },
    machine: {
      profileId: machine.profileId ? String(machine.profileId) : null,
      modelled: !!machine.modelled,
      passes: Number.isFinite(machine.passesPerUnit) ? machine.passesPerUnit : 0,
      cardRows: Number.isFinite(machine.cardRowsPerUnit) ? machine.cardRowsPerUnit : 0,
      speed: Number.isFinite(machine.carriageSpeed) ? machine.carriageSpeed : 0,
      // Minutes per unit can be very small on a tiny test card; keep two decimals so 0.04 doesn't
      // collapse to 0. `|| 0` also normalises NaN/null to a displayable zero.
      minutesPer: round2(machine.knitMinutesPerUnit) || 0,
      hoursPer: Number.isFinite(machine.knitHoursPerUnit) ? machine.knitHoursPerUnit : 0
    },
    time: { batchHours: round1(time.batchHours) || 0 },
    price: {
      retail,
      wholesale: Number.isFinite(quote.price.wholesale) ? quote.price.wholesale : 0,
      profit,
      marginPct,
      unitCost: Number.isFinite(quote.costing.unitCost) ? quote.costing.unitCost : 0
    },
    lines,
    warnings
  };
}

/**
 * Render a {@link summariseQuote} summary as a plain-text quote sheet, ready to paste into an
 * email or a `.kcard` note. Delegates to the quote engine's own {@link renderQuoteSheet} when the
 * input is a live quote, so the pasted text and the panel read always come from the same source.
 * When passed a summary (rather than the original quote), it emits an equivalent structure from the
 * summary alone — still deterministic, still never throws.
 *
 * @param {object|null} quoteOrSummary a DesignQuote (preferred) or a {@link summariseQuote} result.
 * @param {object} [opts] @param {string} [opts.title] an optional heading override.
 * @returns {string} always ends in a newline; empty on nothing to say.
 */
export function quoteToText(quoteOrSummary, opts = {}) {
  if (!quoteOrSummary) return 'Add a fit draft, a gauge and a yarn selection to generate a design quote.\n';
  // Prefer the live DesignQuote — its own renderer is the canonical printable form.
  if (quoteOrSummary.costing && quoteOrSummary.price) {
    const sheet = renderQuoteSheet(quoteOrSummary);
    if (sheet) return sheet.endsWith('\n') ? sheet : sheet + '\n';
  }
  const s = quoteOrSummary.ok ? quoteOrSummary : summariseQuote(quoteOrSummary);
  if (!s) return 'The quote engine returned no data.\n';
  const title = (opts && opts.title) || `Design quote${s.sku ? ' · ' + s.sku : ''}`;
  const lines = [];
  lines.push(title);
  lines.push('='.repeat(title.length));
  lines.push(`${s.name} · ${s.mode} · qty ${s.quantity}`);
  if (s.footprint.width || s.footprint.height) lines.push(`Finished ~${s.footprint.width} × ${s.footprint.height} cm · ${s.stitches} sts`);
  lines.push('');
  if (s.yarnNeeds.length) {
    lines.push('Yarn');
    for (const n of s.yarnNeeds) {
      const cw = n.colorway ? ` (${n.colorway})` : '';
      const share = n.sharePct != null ? ` ${n.sharePct}%` : '';
      lines.push(`  • ${n.name}${cw}: ${n.balls} ball(s), ${n.meters} m, ${n.grams} g${share} — ${formatMoneyLite(n.cost, s.currency)}`);
    }
    lines.push(`  Total ${formatMoneyLite(s.yarnTotals.cost, s.currency)} · ${s.yarnTotals.meters} m · ${s.yarnTotals.grams} g`);
    lines.push('');
  }
  lines.push('Machine');
  lines.push(`  ${s.machine.passes} passes/piece · ${s.machine.cardRows} card rows · ${s.machine.speed}/min`);
  lines.push(`  Knit ${s.machine.minutesPer} min/piece · run ${s.time.batchHours} h (incl. finishing)`);
  lines.push('');
  lines.push('Price');
  for (const l of s.lines) lines.push(`  ${l.label}${l.detail ? ` (${l.detail})` : ''}  ${formatMoneyLite(l.amount, s.currency)}`);
  lines.push(`  Unit cost ${formatMoneyLite(s.price.unitCost, s.currency)}`);
  lines.push(`  Retail    ${formatMoneyLite(s.price.retail, s.currency)} (margin ${s.price.marginPct != null ? s.price.marginPct.toFixed(1) : '—'}%)`);
  lines.push(`  Wholesale ${formatMoneyLite(s.price.wholesale, s.currency)}`);
  lines.push(`  Batch     ${formatMoneyLite(s.price.retail * s.quantity, s.currency)}`);
  if (s.warnings.length) {
    lines.push('');
    lines.push('Notes');
    for (const w of s.warnings) lines.push(`  ! ${w}`);
  }
  return lines.join('\n') + '\n';
}

/** A tiny currency formatter used only inside this view (never mutates global state). */
function formatMoneyLite(v, currency) {
  if (!Number.isFinite(v)) return `${currency || 'GBP'} 0.00`;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v).toFixed(2);
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  return `${sign}${sym || currency + ' '}${abs}`;
}
