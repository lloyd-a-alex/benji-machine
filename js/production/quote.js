/**
 * KNITCAT V2 — Production: the Design-to-Quote engine.
 *
 * This is the connective tissue the creative half of KNITCAT and the commercial half have always
 * been missing between them. A preset carries a *chart*; the machine module knows how many carriage
 * *passes* that chart costs; the tailor knows how many *metres of yarn* a garment of a given gauge
 * and size drinks; the yarn lab knows what a ball costs; the production costing engine knows how to
 * turn hours + yarn into a price. Until now those five facts lived in five modules and never spoke:
 * to quote a design you had to transcribe them by hand into a Project's `cost.*` / `time.*` /
 * `yarn.*` graph nodes, and the first transcription error was invisible.
 *
 * {@link buildDesignQuote} closes that loop in one pure, DOM-free call. Given a design — a chart (or
 * a `presetId` resolved through the library), a machine profile, a gauge, garment parts and a yarn
 * selection — it derives everything from first principles and returns a single, self-consistent
 * quote whose yarn, time and money cannot disagree, because they are all computed from the same
 * chart and the same geometry:
 *
 *   1. **Colour from the chart** — the real per-colour cell histogram of the card ({@link
 *      chartColorHistogram}), which is how much of each colour actually sits on the bed, not a guess.
 *   2. **Yarn from the geometry** — metres via `tailor/yarn-estimate` (topology, honest about being
 *      an estimate), grams via the yarn's own meterage, balls via `yarn/database.ballsForMeters`.
 *   3. **Time from the carriage** — the pass-by-pass plan in `machine/carriage-passes` ÷ a carriage
 *      speed, so a lace card is quoted at its true four-passes-per-transfer-row cost, then
 *      `production/time.estimateHours` adds the finishing operations (set-up, seaming, blocking, …).
 *   4. **Money from the costing engine** — the authoritative `production/costing.buildCosting` does
 *      the labour / materials / overhead / margin arithmetic, so a quoted price is the *same* number
 *      an order and a dashboard would show.
 *   5. **An order + a printable sheet** — `production/order.createOrder` wraps the quote so it can
 *      flow straight into the sales lifecycle, and {@link renderQuoteSheet} renders the human doc.
 *
 * Nothing here re-implements those engines; this module only *wires* them and clamps the inputs so a
 * half-specified design still produces a finite, honest quote (with warnings) instead of throwing.
 *
 * @module production/quote
 */

import { clamp, money, num, round, sum, makeId, makeSku, titleCase, formatMoney, today } from './_util.js';
import { buildCosting, DEFAULT_MARKUP, DEFAULT_WASTAGE } from './costing.js';
import { estimateHours } from './time.js';
import { createOrder, setOrderItems } from './order.js';
import { estimateYarn } from '../tailor/yarn-estimate.js';
import { analyzeYarnConsumption } from '../core/yarn-consumption.js';
import { planPatternPasses } from '../machine/carriage-passes.js';
import { MACHINE_PROFILES } from '../machine/profiles.js';
import { STITCH_TYPE } from '../math/knit-topology.js';
import { PATTERN_PRESETS } from '../presets/preset-library.js';
import { logger } from '../core/logging.js';

const log = logger('production/quote');

/** Lace symbols that mean "this needle is just knitting" — the ground colour of a lace card. */
const LACE_GROUND = new Set([STITCH_TYPE.KNIT, STITCH_TYPE.PURL, STITCH_TYPE.EMPTY, undefined, null]);

/** A hand-cranked punchcard carriage: roughly one pass a second is a comfortable, honest default. */
const DEFAULT_CARRIAGE_PASSES_PER_MINUTE = 90;
/** Default ball price when a yarn is chosen but the seller has not typed what they paid. */
const DEFAULT_PRICE_PER_BALL = 0;
/** Default ball size when a yarn record omits its meterage. */
const DEFAULT_BALL_METERS = 100;
const DEFAULT_BALL_GRAMS = 50;

/**
 * @typedef {object} DesignYarn
 * @property {string} [name] seller label for this colourway
 * @property {string} [colorway] shade name / code
 * @property {string} [hex] colour for the chart legend
 * @property {number} [index] palette index this yarn answers on the chart (defaults to array order)
 * @property {number} [metersPer100g] yarn meterage density (else gramsPerMeter)
 * @property {number} [gramsPerMeter] inverse density; either form is accepted
 * @property {number} [ballMeters] metres in one ball (default 100)
 * @property {number} [ballGrams] grams in one ball (default 50)
 * @property {number} [pricePerBall] what one ball costs the maker (default 0 → warn)
 * @property {number} [pricePer100g] alternative price basis (wins over pricePerBall if given)
 * @property {number} [share] manual colour share 0..1 that overrides the chart histogram
 */

/**
 * @typedef {object} DesignInput
 * @property {string} [name] design / product name
 * @property {string} [presetId] resolve the chart from the library instead of passing `chart`
 * @property {Array<Array<*>>} [chart] rows × cols; lace symbols, colourwork indices or 0/1
 * @property {string} [mode] 'lace' | 'fair_isle' | 'tuck' | 'slip' (falls back to the preset's mode)
 * @property {Array<DesignYarn>} [yarns] colours to buy, matched to the chart's colour buckets
 * @property {Array<{name?:string, castOn:number, rows:number}>} [parts] garment geometry; if omitted
 *   a single flat piece of `chart.width × chart.height × repeats` is drafted
 * @property {{stitchesPer10Cm?:number, rowsPer10Cm?:number, stsPer10cm?:number, rowsPer10cm?:number}} [gauge]
 * @property {{across?:number, up?:number}} [repeats] how many times the card repeats across/up the piece
 * @property {object|string} [machine] a profile object, a profile id, or omitted
 * @property {number} [carriagePassesPerMinute] machine throughput for the knit operation
 * @property {number} [quantity] pieces in the run (default 1)
 * @property {string} [currency] ISO code (default GBP)
 * @property {number} [labourRate] currency/hour
 * @property {number} [markup] cost multiplier for the retail price
 * @property {number} [targetMarginPct] price-to-margin instead of markup
 * @property {number} [wastagePct] yarn wastage % (defaults to costing's 10%)
 * @property {number} [materialsCost] notions/labels/packaging per unit
 * @property {number} [overheadPct] overhead as % of running cost
 * @property {number} [setupCost] one-off amortised in break-even units
 * @property {Object<string, number>} [finishing] per-operation minute overrides for {@link estimateHours}
 * @property {Record<string, number>} [stock] grams-on-hand keyed by yarn name, for shortfall notes
 */

/**
 * @typedef {object} DesignQuote
 * @property {string} id @property {string} createdAt @property {string} name @property {string} sku
 * @property {string} currency @property {number} quantity
 * @property {object} design echo of the resolved design (mode, repeats, footprint cm)
 * @property {object} chart {rows, cols, cells, activeCells, histogram, presetId}
 * @property {object} machine {profileId, modelled, passesPerUnit, cardRowsPerUnit, totalPasses, knitMinutes, carriageSpeed}
 * @property {object} geometry {totalStitches, parts, areaCm2}
 * @property {object} yarn {needs:YarnNeed[], totalMeters, totalGrams, totalCost, shortfalls}
 * @property {object} time the {@link estimateHours} result reused verbatim
 * @property {object} costing the {@link buildCosting} result reused verbatim
 * @property {object} price {retail, wholesale, profit, marginPct}
 * @property {Array<{label:string, detail:string, amount:number}>} lines customer-facing quote lines
 * @property {object} order a ready {@link createOrder} order carrying this quote
 * @property {string[]} warnings @property {boolean} feasible
 */

/**
 * @typedef {object} YarnNeed
 * @property {number} index palette index @property {string} name @property {?string} colorway
 * @property {?string} hex @property {number} share @property {number} stitches
 * @property {number} meters @property {number} grams @property {number} balls @property {number} cost
 */

const round1 = (n) => round(n, 1);
const round2 = (n) => round(n, 2);

/**
 * Resolve a design's chart: an explicit matrix wins; else a `presetId` is looked up in the library
 * and generated at its declared size. Returns the matrix plus the mode to price it under.
 *
 * @param {DesignInput} design
 * @returns {{matrix:Array<Array<*>>, mode:string, presetId:string|null, warnings:string[]}}
 */
export function resolveDesignChart(design = {}) {
  const warnings = [];
  if (Array.isArray(design.chart) && design.chart.length && Array.isArray(design.chart[0])) {
    return { matrix: design.chart, mode: design.mode || 'fair_isle', presetId: design.presetId || null, warnings };
  }
  if (design.presetId) {
    const preset = PATTERN_PRESETS.find((p) => p.id === design.presetId);
    if (preset) {
      try {
        const rows = Math.max(1, Math.round(num(design.rows, preset.rows)));
        const cols = Math.max(1, Math.round(num(design.cols, preset.cols)));
        const matrix = preset.generate(rows, cols, preset.seed);
        return { matrix, mode: design.mode || preset.mode || 'fair_isle', presetId: preset.id, warnings };
      } catch (err) {
        log.warn(`preset "${design.presetId}" threw while generating its chart — quoting without a chart`, { presetId: design.presetId, error: err && err.message ? err.message : String(err) });
        warnings.push(`Preset "${design.presetId}" failed to generate (${err && err.message ? err.message : err}); quoting without a chart.`);
      }
    } else {
      log.warn(`a quote referenced an unknown preset id "${design.presetId}" — quoting without a chart`, { presetId: design.presetId });
      warnings.push(`Unknown preset id "${design.presetId}"; quoting without a chart.`);
    }
  }
  return { matrix: [], mode: design.mode || 'fair_isle', presetId: design.presetId || null, warnings };
}

/**
 * The real per-colour makeup of a card: count how many cells belong to each colour bucket. A
 * colourwork/texture/generative chart is read as palette indices (0 = background); a boolean chart
 * as two colours; a lace chart as two buckets — the plain ground and the worked eyelet/transfer
 * symbols — so a single-colour lace card correctly reports ~100% ground while the histogram still
 * tells the seller how open the fabric is.
 *
 * @param {Array<Array<*>>} matrix
 * @param {string} mode
 * @returns {Array<{index:number, cells:number, share:number, ground:boolean}>} sorted by index
 */
export function chartColorHistogram(matrix = [], mode = 'fair_isle') {
  const buckets = new Map();
  let total = 0;
  const bump = (index, ground) => {
    const entry = buckets.get(index) || { index, cells: 0, ground };
    entry.cells += 1;
    buckets.set(index, entry);
    total += 1;
  };
  const laceMode = mode === 'lace';
  for (const row of matrix) {
    for (const cell of row) {
      if (laceMode) {
        bump(LACE_GROUND.has(cell) ? 0 : 1, LACE_GROUND.has(cell));
      } else if (typeof cell === 'number') {
        bump(Math.max(0, Math.trunc(cell)), cell === 0);
      } else {
        bump(cell ? 1 : 0, !cell);
      }
    }
  }
  const list = [...buckets.values()].sort((a, b) => a.index - b.index);
  for (const b of list) b.share = total > 0 ? b.cells / total : 0;
  return list;
}

/** Read either spelling of a gauge pair, tolerating the cm/per-10cm naming drift across the app. */
function readGauge(design = {}) {
  const g = design.gauge || {};
  const stitchesPer10Cm = num(g.stitchesPer10Cm, num(g.stsPer10cm, 0));
  const rowsPer10Cm = num(g.rowsPer10Cm, num(g.rowsPer10cm, 0));
  return { stitchesPer10Cm, rowsPer10Cm };
}

/**
 * Draft the garment geometry: use the caller's parts (tailor plan shape: `{name, castOn, rows}`),
 * or fall back to a single flat piece sized from the chart and its repeat counts. Every part is
 * clamped to finite, non-negative stitch/row counts so a bad input yields a small piece, never NaN.
 *
 * @param {DesignInput} design @param {number} chartRows @param {number} chartCols
 * @param {{stitchesPer10Cm:number, rowsPer10Cm:number}} gauge
 * @returns {Array<{name:string, castOn:number, rows:number}>}
 */
function resolveParts(design, chartRows, chartCols, gauge) {
  const across = Math.max(1, Math.round(num(design.repeats && design.repeats.across, 1)));
  const up = Math.max(1, Math.round(num(design.repeats && design.repeats.up, 1)));
  if (Array.isArray(design.parts) && design.parts.length) {
    return design.parts.map((p, i) => ({
      name: p.name || `Piece ${i + 1}`,
      castOn: Math.max(0, Math.round(num(p.castOn))),
      rows: Math.max(0, Math.round(num(p.rows)))
    }));
  }
  const castOn = Math.round(chartCols) * across;
  const rows = Math.round(chartRows) * up;
  return [{ name: 'Piece 1', castOn, rows }];
}

/**
 * Resolve the machine profile: accept a profile object, a profile id string, or nothing, and always
 * return a usable object so the pass planner runs. Unknown ids degrade to the single-bed standard.
 * @param {object|string} machine
 * @returns {object}
 */
function resolveProfile(machine) {
  if (machine && typeof machine === 'object' && (machine.id || machine.carriageRules)) return machine;
  const id = typeof machine === 'string' ? machine : 'brother_standard_24';
  return MACHINE_PROFILES[id] || MACHINE_PROFILES.brother_standard_24 || { id, beds: 1, carriageRules: {} };
}

/**
 * The honest knit time: run the carriage-pass planner over the chart once (that already knows a
 * Brother transfer row costs four passes and the card must land back on the left), scale it by the
 * piece's repeat count, and divide by the machine's passes-per-minute. Lace with no transfers and a
 * plain colourwork card both collapse to ~one pass per row, which is correct.
 *
 * @param {Array<Array<*>>} matrix @param {object} profile @param {object} gauge
 * @param {{across:number, up:number}} repeats @param {number} passesPerMinute
 * @param {string} mode
 * @returns {{perRepeatPasses:number, totalPasses:number, minutesPerUnit:number, cardRows:number, modelled:boolean}}
 */
function estimateMachineTime(matrix, profile, gauge, repeats, passesPerMinute, mode) {
  const up = Math.max(1, repeats.up);
  const across = Math.max(1, repeats.across);
  if (!matrix.length) {
    return { perRepeatPasses: 0, totalPasses: 0, minutesPerUnit: 0, cardRows: 0, modelled: false };
  }
  // Lace passes come from the transfer planner; direct modes are a straight one-pass-per-row knit.
  if (mode === 'lace') {
    const plan = planPatternPasses(matrix, { profile });
    const perRepeatPasses = plan.totals.passes;
    const totalPasses = perRepeatPasses * up;
    return {
      perRepeatPasses,
      totalPasses,
      minutesPerUnit: round2(totalPasses / Math.max(1, passesPerMinute)),
      cardRows: plan.cardRows,
      modelled: plan.mechanics ? plan.mechanics.modelled : false
    };
  }
  const cardRows = matrix.length * up;
  const totalPasses = matrix.length * up;
  return {
    perRepeatPasses: matrix.length,
    totalPasses,
    minutesPerUnit: round2(totalPasses / Math.max(1, passesPerMinute)),
    cardRows,
    modelled: true
  };
}

/** Normalise a seller's yarn record into the fields the quote needs, with defensive defaults. */
function normalizeYarnEntry(y = {}, index = 0) {
  const metersPer100g = num(y.metersPer100g, 0);
  let gramsPerMeter = num(y.gramsPerMeter, 0);
  // metresPer100g says how many metres 100 g runs, so one metre *weighs* 100 ÷ that many grams.
  if (!gramsPerMeter && metersPer100g > 0) gramsPerMeter = 100 / metersPer100g;
  if (!gramsPerMeter && y.ballGrams && y.ballMeters) gramsPerMeter = num(y.ballGrams) / num(y.ballMeters);
  const ballMeters = num(y.ballMeters, DEFAULT_BALL_METERS) || DEFAULT_BALL_METERS;
  const ballGrams = num(y.ballGrams, num(y.ballWeight, DEFAULT_BALL_GRAMS)) || DEFAULT_BALL_GRAMS;
  // Price basis: an explicit per-100g beats per-ball; derive whichever the other needs.
  let pricePerBall = num(y.pricePerBall, num(y.ballPrice, -1));
  const pricePer100g = num(y.pricePer100g, -1);
  if (pricePer100g >= 0 && pricePerBall < 0) pricePerBall = (pricePer100g * ballGrams) / 100;
  if (pricePerBall < 0) pricePerBall = DEFAULT_PRICE_PER_BALL;
  return {
    index: Number.isFinite(y.index) ? y.index : index,
    name: y.name || y.brand || `Colour ${index + 1}`,
    colorway: y.colorway || y.color || null,
    hex: y.hex || null,
    share: Number.isFinite(y.share) ? clamp(y.share, 0, 1) : null,
    gramsPerMeter,
    metersPer100g,
    ballMeters,
    ballGrams,
    pricePerBall: money(pricePerBall)
  };
}

/**
 * Map chart colour buckets to the seller's yarn list. A palette entry may pin a yarn with `index`
 * (its chart colour) or `yarnIndex`; with no mapping the buckets fill the yarns in order, and any
 * leftover colour is bought as the last yarn so nothing is silently dropped.
 *
 * @param {ReturnType<typeof chartColorHistogram>} histogram
 * @param {ReturnType<typeof normalizeYarnEntry>[]} yarns
 * @param {Array} colors design palette (may carry `{index, yarn/yarnIndex}`)
 * @returns {Map<number, number>} chart bucket index → yarn array index
 */
function assignBucketsToYarns(histogram, yarns, colors = []) {
  const map = new Map();
  if (!yarns.length) return map;
  for (let i = 0; i < histogram.length; i++) {
    const bucket = histogram[i];
    const palette = colors.find((c) => c && (c.index === bucket.index || c.colorIndex === bucket.index));
    let yarnIdx = -1;
    if (palette) {
      if (Number.isFinite(palette.yarnIndex)) yarnIdx = palette.yarnIndex;
      else if (palette.yarn != null) yarnIdx = yarns.findIndex((y) => y.name === palette.yarn || y.index === palette.yarn);
    }
    if (yarnIdx < 0) yarnIdx = i; // order-based default
    map.set(bucket.index, clamp(yarnIdx, 0, yarns.length - 1));
  }
  return map;
}

/**
 * Turn a resolved chart + geometry into the per-colour yarn shopping list: metres by colour (total
 * metres from the topology estimate, split by the chart's own colour share), grams via each yarn's
 * density, balls via the yarn database, cost via the seller's ball price. Reused by the order build.
 *
 * @param {{totalMeters:number, totalStitches:number}} yarnModel
 * @param {ReturnType<typeof chartColorHistogram>} histogram
 * @param {number} repeatsUp
 * @param {Array} yarns normalised yarn entries
 * @param {Map<number, number>} bucketToYarn
 * @param {number} wastage 1 + waste fraction
 * @param {{densityFactor:number, shares:Map<number,number>}} [consumption] chart-aware yarn-path
 *   analysis (see `core/yarn-consumption.js`). When present, yarn *metres* follow the real path each
 *   colour travels — including carried floats — instead of the flat visible-cell share; omit it (or
 *   pass a neutral one) and behaviour is exactly the historic cell-share split.
 * @returns {{needs:YarnNeed[], totalMeters:number, totalGrams:number, totalCost:number}}
 */
function computeColorYarnNeeds(yarnModel, histogram, repeatsUp, yarns, bucketToYarn, wastage, consumption) {
  const meters = Math.max(0, num(yarnModel.meters)) * repeatsUp;
  const stitches = Math.max(0, num(yarnModel.totalStitches)) * repeatsUp;
  // Density factor lifts (stranded) or holds (every other mode) the flat one-loop-per-cell estimate
  // so the invisible carried yarn is bought too. Guarded to 1 for a missing/degenerate analysis.
  const density = consumption && Number.isFinite(consumption.densityFactor) ? consumption.densityFactor : 1;
  const needs = [];
  const used = new Set();
  for (const bucket of histogram) {
    const yarnIdx = bucketToYarn.has(bucket.index) ? bucketToYarn.get(bucket.index) : 0;
    const yarn = yarns[yarnIdx] || yarns[0];
    if (!yarn) break;
    // Visible share decides how many *stitches* read as this colour; yarn-path share decides how
    // many *metres* it eats. For plain work they are identical, so nothing changes off colorwork.
    const visibleShare = bucket.share;
    const share = consumption && consumption.shares && consumption.shares.has(bucket.index)
      ? consumption.shares.get(bucket.index)
      : visibleShare;
    const colorMeters = meters * density * share * wastage;
    const grams = colorMeters * (yarn.gramsPerMeter || 0);
    const balls = yarn.ballMeters ? Math.ceil(colorMeters / yarn.ballMeters) : 0;
    const cost = money(balls * yarn.pricePerBall);
    const need = {
      index: bucket.index,
      name: yarn.name,
      colorway: yarn.colorway,
      hex: yarn.hex,
      share: round(share, 4),
      stitches: Math.round(stitches * visibleShare),
      meters: round1(colorMeters),
      grams: round1(grams),
      balls,
      cost
    };
    needs.push(need);
    used.add(yarnIdx);
  }
  return {
    needs,
    totalMeters: round1(sum(needs.map((n) => n.meters))),
    totalGrams: round1(sum(needs.map((n) => n.grams))),
    totalCost: money(sum(needs.map((n) => n.cost)))
  };
}

/** Customer-facing line items: one per colour plus labour and finishing, from the costed numbers. */
function buildQuoteLines(yarn, time, costing, currency) {
  const lines = [];
  for (const n of yarn.needs) {
    const label = `${n.name}${n.colorway ? ` (${n.colorway})` : ''}`;
    const detail = `${n.balls} ball${n.balls === 1 ? '' : 's'} · ${round1(n.meters)} m · ${round1(n.grams)} g`;
    lines.push({ label: `Yarn — ${label}`, detail, amount: money(n.cost) });
  }
  lines.push({
    label: 'Labour & finishing',
    detail: `${round2(time.batchHours)} h at ${formatMoney(costing.labourRate, currency)}/h`,
    amount: money(costing.batch.labour)
  });
  if (costing.batch.materials > 0) lines.push({ label: 'Materials & notions', detail: `${costing.quantity} × ${formatMoney(costing.perUnit.materials, currency)}`, amount: money(costing.batch.materials) });
  if (costing.batch.overhead > 0) lines.push({ label: 'Overhead', detail: `${costing.quantity} × ${formatMoney(costing.perUnit.overhead, currency)}`, amount: money(costing.batch.overhead) });
  return lines;
}

/**
 * Build a complete, self-consistent design-to-quote. Pure, DOM-free and defensive: every input is
 * clamped to a finite value, so a partial design returns a real quote with explanatory `warnings`
 * rather than throwing. This is the single entry point the UI and the facade use.
 *
 * @param {DesignInput} design
 * @returns {DesignQuote}
 */
export function buildDesignQuote(design = {}) {
  const warnings = [];
  const currency = design.currency || 'GBP';
  const quantity = Math.max(1, Math.round(num(design.quantity, 1)));
  const gauge = readGauge(design);
  const wastagePct = clamp(num(design.wastagePct, DEFAULT_WASTAGE * 100), 0, 100);
  const wastage = 1 + wastagePct / 100;

  // 1. The chart.
  const resolved = resolveDesignChart(design);
  warnings.push(...resolved.warnings);
  const matrix = resolved.matrix;
  const mode = resolved.mode;
  const rows = matrix.length;
  const cols = matrix.length ? matrix[0].length : 0;
  let histogram = chartColorHistogram(matrix, mode);
  const cells = rows * cols;
  // A garment quoted from geometry alone (no chart) still needs its yarn: fold it all into a single
  // ground colour so nothing is dropped before the costing engine sees it.
  if (!histogram.length) histogram = [{ index: 0, cells: Math.max(1, cells), share: 1, ground: true }];
  const activeCells = histogram.filter((b) => !b.ground).reduce((t, b) => t + b.cells, 0);

  // 2. Geometry + yarn demand (reusing the tailor's topology estimator).
  const parts = resolveParts(design, rows, cols, gauge);
  const totalStitches = sum(parts.map((p) => p.castOn * p.rows));
  const repeatsUp = Math.max(1, Math.round(num(design.repeats && design.repeats.up, 1)));
  const across = Math.max(1, Math.round(num(design.repeats && design.repeats.across, 1)));
  const yarnModel = estimateYarn({ parts }, gauge);
  if (yarnModel.meters <= 0) {
    warnings.push('Yarn metres are zero — set a real gauge (stitches & rows per 10 cm) and piece sizes.');
  }
  const yarns = (Array.isArray(design.yarns) && design.yarns.length ? design.yarns : [{}]).map(normalizeYarnEntry);
  if (!Array.isArray(design.yarns) || !design.yarns.length) warnings.push('No yarn selected — quoted at zero yarn cost; add your colourway and its price.');
  const bucketToYarn = assignBucketsToYarns(histogram, yarns, design.colors || []);
  // Chart-aware yarn path: fair-isle carries a second colour behind every float, so that yarn must
  // be bought even though it shows nowhere. Only meaningful once two *different* yarns are on the
  // card — with a single yarn there is nothing being floated, so fall back to the flat model.
  const distinctYarns = new Set([...bucketToYarn.values()]).size;
  const analysis = analyzeYarnConsumption(matrix, mode);
  const consumption = distinctYarns >= 2 ? analysis : { densityFactor: 1, shares: new Map() };
  const yarnResult = computeColorYarnNeeds({ ...yarnModel }, histogram, repeatsUp, yarns, bucketToYarn, wastage, consumption);
  if (yarns.some((y) => y.pricePerBall <= 0)) warnings.push('One or more yarns have no price — the quote understates material cost until you add what you paid.');

  // Footprint (cm) from gauge so the seller can eyeball the finished size.
  const widthCm = gauge.stitchesPer10Cm > 0 ? (Math.max(...parts.map((p) => p.castOn), 0) / gauge.stitchesPer10Cm) * 10 * across : 0;
  const heightCm = gauge.rowsPer10Cm > 0 ? (Math.max(...parts.map((p) => p.rows), 0) / gauge.rowsPer10Cm) * 10 : 0;

  // 3. Time — honest carriage passes for the knit, then the shared finishing operations.
  const profile = resolveProfile(design.machine);
  const speed = clamp(num(design.carriagePassesPerMinute, DEFAULT_CARRIAGE_PASSES_PER_MINUTE), 1, 600);
  const mach = estimateMachineTime(matrix, profile, gauge, { across, up: repeatsUp }, speed, mode);
  const knitHoursPerUnit = round(mach.minutesPerUnit / 60, 4);
  // Feed the derived stitch count so the finishing ops scale sensibly, but override the knit line
  // with the carriage-derived hours so the machine physics — not a stitches/min guess — sets price.
  const projectSnapshot = {
    'time.totalStitches': Math.round(totalStitches * repeatsUp),
    'yarn.totalMeters': round1(yarnResult.totalMeters)
  };
  const time = estimateHours(projectSnapshot, {
    quantity,
    hoursPerUnit: knitHoursPerUnit,
    perOperation: design.finishing || {}
  });
  if (!mach.modelled && mode === 'lace') {
    warnings.push('The machine profile did not fully model its carriage mechanics; lace pass count is partly assumed.');
  }

  // 4. Money — one authoritative costing so price, order and dashboard can never disagree.
  const weightedPricePer100m = yarnResult.totalMeters > 0 ? (yarnResult.totalCost / yarnResult.totalMeters) * 100 : 0;
  const costing = buildCosting(projectSnapshot, {
    quantity,
    currency,
    labourRate: design.labourRate != null ? num(design.labourRate) : undefined,
    markup: design.markup != null ? num(design.markup) : DEFAULT_MARKUP,
    targetMarginPct: design.targetMarginPct,
    materials: design.materialsCost,
    overheadPct: design.overheadPct,
    overhead: design.overhead,
    setupCost: design.setupCost,
    hoursPerUnit: knitHoursPerUnit,
    // Supply the *derived* yarn figure directly so the costing reproduces our per-colour total
    // exactly (wastage already folded in above, so tell costing not to add it twice).
    unitYardage: round1(yarnResult.totalMeters),
    yarnPricePer100m: round2(weightedPricePer100m),
    wastagePct: 0
  });
  warnings.push(...(costing.warnings || []).filter((w) => !/No yarn cost/.test(w) || yarnResult.totalCost > 0));

  // 5. Stock / shortfall (optional) — reuse nothing exotic, just compare grams-on-hand.
  const shortfalls = [];
  if (design.stock && typeof design.stock === 'object') {
    for (const n of yarnResult.needs) {
      const have = num(design.stock[n.name], num(design.stock[`${n.name}::${n.colorway}`], -1));
      if (have >= 0 && have < n.grams) shortfalls.push({ name: n.name, colorway: n.colorway, need: round1(n.grams), have: round1(have), buy: round1(n.grams - have) });
    }
    if (shortfalls.length) warnings.push(`Short on ${shortfalls.length} colourway${shortfalls.length === 1 ? '' : 's'} for this run.`);
  }

  // 6. The order + quote lines (customer-facing).
  const lines = buildQuoteLines(yarnResult, time, costing, currency);
  const name = design.name || (resolved.presetId ? titleCase(resolved.presetId) : 'Custom design');
  const sku = makeSku(name, mode, `${widthCm | 0}x${heightCm | 0}`);
  const order = createOrder({
    currency,
    note: `Design quote ${sku} — ${name}${design.customerName ? ` for ${design.customerName}` : ''}`
  });
  const pricedOrder = setOrderItems(order, lines.map((l, i) => ({
    sku: makeSku(sku, `L${i + 1}`),
    name: l.label,
    quantity: 1,
    unitPrice: l.amount,
    unitCost: 0
  })));

  const price = {
    retail: money(costing.suggestedPrice),
    wholesale: money(costing.wholesalePrice),
    profit: money(costing.profit),
    marginPct: round(costing.marginPct, 1)
  };

  const feasible = costing.profit > 0 && yarnResult.totalMeters > 0;
  if (costing.profit <= 0) warnings.push('At this price the piece makes no profit — raise the price, cut a finishing step, or find cheaper yarn.');

  return {
    id: makeId('quote'),
    createdAt: today(),
    name,
    sku,
    currency,
    quantity,
    design: {
      mode,
      presetId: resolved.presetId,
      repeats: { across, up: repeatsUp },
      gauge,
      footprintCm: { width: round1(widthCm), height: round1(heightCm) }
    },
    chart: {
      rows,
      cols,
      cells,
      activeCells,
      opennessPct: cells > 0 ? round((activeCells / cells) * 100, 1) : 0,
      histogram,
      presetId: resolved.presetId
    },
    machine: {
      profileId: profile.id || null,
      modelled: mach.modelled,
      passesPerUnit: mach.totalPasses,
      cardRowsPerUnit: mach.cardRows,
      carriageSpeed: speed,
      knitMinutesPerUnit: mach.minutesPerUnit,
      knitHoursPerUnit
    },
    geometry: { totalStitches: Math.round(totalStitches * repeatsUp), parts, areaCm2: round1(widthCm * heightCm) },
    yarn: { ...yarnResult, shortfalls },
    time,
    costing,
    price,
    lines,
    order: pricedOrder,
    warnings: [...new Set(warnings)],
    feasible
  };
}

/**
 * Render a printable quote / tech-pack sheet from a {@link DesignQuote}. Plain text (Markdown-ish),
 * so it pastes into an email, a shop listing or a `.kcard` note without a DOM. Deterministic given
 * the same quote (uses the quote's own stored id/date, never `Date.now`).
 *
 * @param {DesignQuote} quote
 * @returns {string}
 */
export function renderQuoteSheet(quote) {
  if (!quote || !quote.costing) return '';
  const cur = quote.currency;
  const fm = (v) => formatMoney(v, cur);
  const out = [];
  out.push(`QUOTE ${quote.sku}`);
  out.push('─'.repeat(48));
  out.push(`${quote.name}  ·  ${quote.createdAt}  ·  ref ${quote.id}`);
  out.push(`Mode ${quote.design.mode}${quote.design.presetId ? ` (preset ${quote.design.presetId})` : ''}  ·  qty ${quote.quantity}`);
  const fp = quote.design.footprintCm;
  if (fp.width || fp.height) out.push(`Finished ~${fp.width} × ${fp.height} cm  ·  ${quote.geometry.totalStitches} stitches`);
  out.push('');

  out.push('YARN');
  for (const n of quote.yarn.needs) {
    const pct = Math.round(n.share * 100);
    out.push(`  • ${n.name}${n.colorway ? ` — ${n.colorway}` : ''}: ${n.balls} ball(s), ${n.meters} m, ${n.grams} g  (${pct}% of card)  ${fm(n.cost)}`);
  }
  out.push(`  Total materials ${fm(quote.yarn.totalCost)}  (${quote.yarn.totalMeters} m, ${quote.yarn.totalGrams} g, wastage included)`);
  out.push('');

  out.push('MACHINE TIME');
  out.push(`  ${quote.machine.passesPerUnit} carriage passes/piece on ${quote.machine.profileId || 'machine'} at ${quote.machine.carriageSpeed} passes/min`);
  out.push(`  Knit ${quote.machine.knitMinutesPerUnit} min/piece; whole run ${round2(quote.time.batchHours)} h incl. finishing`);
  out.push('');

  out.push('PRICE');
  for (const l of quote.lines) out.push(`  ${l.label}  ${l.detail ? `(${l.detail})` : ''}  ${fm(l.amount)}`);
  out.push('  ' + '─'.repeat(30));
  out.push(`  Unit cost      ${fm(quote.costing.unitCost)}`);
  out.push(`  Retail/unit    ${fm(quote.price.retail)}   (margin ${quote.price.marginPct}%)`);
  out.push(`  Wholesale/unit ${fm(quote.price.wholesale)}`);
  out.push(`  Batch total    ${fm(quote.price.retail * quote.quantity)}`);
  if (quote.costing.breakEvenUnits) out.push(`  Break-even     ${quote.costing.breakEvenUnits} unit(s)`);
  out.push('');

  if (quote.warnings.length) {
    out.push('NOTES');
    for (const w of quote.warnings) out.push(`  ! ${w}`);
    out.push('');
  }
  out.push(quote.feasible ? '✓ This design is worth making at this price.' : '⚠ Review before quoting a customer — see notes.');
  return out.join('\n');
}
