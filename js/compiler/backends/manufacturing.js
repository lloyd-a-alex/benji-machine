/**
 * KNITCAT V2 — the manufacturing backend (spec §4.6.7).
 *
 * Everything a small-batch or studio producer needs to actually *make* the garment N times, on a
 * schedule, without re-deriving a single number by hand. It reads the compiler IR (piece geometry,
 * carriage schedule, yarn assignments) and — when the pipeline hands it the live Project — the
 * constraint graph's cost / time / yarn nodes, so the tech pack agrees to the penny with what the
 * Yarn Lab and Cost Engine computed elsewhere in the app. This is the "V1 → V10" jump: the old app
 * could print a chart; this produces a cut list, a purchase order, a per-size grading table, a
 * labour time budget, a QC checklist and a packing slip from one button.
 *
 * It is a pure function `(ir, options) => object`; `options.project` and `options.quantity` are
 * optional and everything degrades gracefully when absent (a single sample, cost pulled from the
 * IR metadata only). DOM-free.
 *
 * @module compiler/backends/manufacturing
 */

/** Standard finished-measurement tolerance in cm, by garment zone, for the QC checklist. */
const MEASURE_TOLERANCE_CM = { chest: 1.5, length: 2.0, sleeve: 1.0, neck: 0.6, default: 1.0 };

/**
 * Compile an IR into a manufacturing tech pack.
 * @param {object} ir
 * @param {{project?:object, quantity?:number, currency?:string, wastagePct?:number}} [options]
 * @returns {object} a structured tech pack (see fields below)
 */
export function manufacturingBackend(ir, options = {}) {
  const project = options.project || null;
  const get = id => {
    if (!project || !project.get) return undefined;
    if (project.has && !project.has(id)) return undefined;
    try { return project.get(id); } catch { return undefined; }
  };
  const qty = Math.max(1, Math.round(Number(options.quantity) || 1));
  const currency = options.currency || 'GBP';
  const wastage = 1 + (Number(options.wastagePct != null ? options.wastagePct : get('cost.wastagePct')) || 8) / 100;

  const pieces = buildCutList(ir, qty);
  const yarn = buildYarnOrder(ir, get, qty, wastage);
  const time = buildTimeBudget(ir, get, qty);
  const cost = buildCosting(ir, get, qty, yarn, time);
  const grading = buildGradingTable(ir, get);
  const qc = buildQcChecklist(ir, get, qty);
  const packing = buildPackingSlip(ir, qty, currency, cost);

  return {
    kind: 'tech-pack',
    generatedFrom: (ir.metadata && ir.metadata.name) || 'pattern',
    quantity: qty,
    currency,
    machine: (ir.machine && ir.machine.id) || 'standard',
    construction: (ir.metadata && ir.metadata.construction) || 'unknown',
    pieces, yarn, time, cost, grading, qc, packing,
    warnings: collectWarnings(ir, yarn, cost)
  };
}

/** Per-piece cut / knit list, × the run quantity, with finished dimensions and make-count. */
function buildCutList(ir, qty) {
  return ((ir && ir.pieces) || []).map(p => {
    const make = (p.dimensions && Number(p.dimensions.make)) || (/sleeve|cuff/i.test(p.id || '') ? 2 : 1);
    const dims = p.dimensions || {};
    return {
      id: p.id, name: p.name || p.id, makePerGarment: make,
      makeTotal: make * qty,
      castOn: Number(p.stitches) || 0,
      rows: Number(p.rows) || (p.rowsDetail ? p.rowsDetail.length : 0),
      widthCm: round1(dims.width || dims.finishedBust || 0),
      lengthCm: round1(dims.length || 0),
      edges: (p.edges || []).map(e => e.with || e.kind || 'seam'),
      material: (p.yarn && p.yarn.main) || 'main'
    };
  });
}

/** Yarn purchase order — meters & balls per colour for the whole run, with a safety/wastage factor. */
function buildYarnOrder(ir, get, qty, wastage) {
  const colors = (ir && ir.colors) || [];
  const lines = [];
  const areaMeters = num(get('yarn.fabricAreaCm2'), 0) / 100 * num(get('yarn.coverageFactor'), 0); // rough meters per garment
  const perColorTotal = areaMeters / Math.max(1, colors.length || 1);
  const names = colors.length ? colors.map(c => c.yarn) : (ir && ir.metadata && ir.metadata.yarnNames && ir.metadata.yarnNames.length ? ir.metadata.yarnNames : ['main']);

  for (const name of names) {
    const meters = num(get(`yarn.${name}.meters`), perColorTotal) * qty * wastage;
    const ballsFromGraph = num(get(`yarn.${name}.ballsNeeded`), 0);
    const balls = Math.ceil(ballsFromGraph > 0 ? ballsFromGraph * qty * wastage : (meters > 0 ? Math.ceil(meters / 100) : 0));
    const owned = num(get(`yarn.${name}.owned`), 0);
    lines.push({
      yarn: name,
      metersRun: round1(meters),
      ballsToBuy: Math.max(0, balls - owned),
      ballsNeededTotal: balls,
      alreadyOwned: owned,
      short: Math.max(0, balls - owned),
      gramsEstimate: Math.round(meters * 1.6) // ~1.6 g/m across common weights; refined by the cost roll-up
    });
  }
  const totalBalls = lines.reduce((n, l) => n + l.ballsNeededTotal, 0);
  const totalShort = lines.reduce((n, l) => n + l.short, 0);
  return { lines, totalBalls, totalShort, wastageFactor: round1(wastage) };
}

/** Labour time budget from the constraint graph (falls back to a stitch-rate heuristic on the IR). */
function buildTimeBudget(ir, get, qty) {
  const hoursPerGarment = num(get('time.totalHours'), estimateHoursFromIr(ir));
  const totalHours = round1(hoursPerGarment * qty);
  const breakdown = [];
  for (const p of (ir.pieces || [])) {
    const rows = Number(p.rows) || (p.rowsDetail ? p.rowsDetail.length : 0);
    breakdown.push({ piece: p.name || p.id, knitingHours: round1(rows * 0.012) });
  }
  breakdown.push({ piece: 'Finishing & seaming', knitingHours: round1(hoursPerGarment * 0.28) });
  return {
    hoursPerGarment: round1(hoursPerGarment),
    totalHours,
    machineHours: round1(totalHours * 0.55),
    handHours: round1(totalHours * 0.45),
    breakdown,
    source: get('time.totalHours') != null ? 'constraint-graph' : 'ir-heuristic'
  };
}

/** Cost roll-up: materials + labour + overhead, scaled to the run, with a margin to reach a price. */
function buildCosting(ir, get, qty, yarn, time) {
  const materialsUnit = num(get('cost.materials'), 0) || yarn.lines.reduce((n, l) => n + l.ballsNeededTotal * num(get(`yarn.${l.yarn}.pricePerBall`), 3.5), 0);
  const labourRate = num(get('cost.labourRatePerHour'), 12);
  const labourUnit = round1(time.hoursPerGarment * labourRate);
  const overheadRate = num(get('cost.overheadPct'), 18) / 100;
  const overheadUnit = round1((materialsUnit + labourUnit) * overheadRate);
  const unitCost = round1(materialsUnit + labourUnit + overheadUnit);
  const margin = num(get('cost.marginPct'), 60) / 100;
  const unitPrice = round1(unitCost * (1 + margin));
  return {
    currency: 'GBP',
    perGarment: { materials: round1(materialsUnit), labour: labourUnit, overhead: overheadUnit, unitCost },
    run: { quantity: qty, materials: round1(materialsUnit * qty), labour: round1(labourUnit * qty), overhead: round1(overheadUnit * qty), totalCost: round1(unitCost * qty) },
    pricing: { marginPct: round1(margin * 100), unitPrice, runRevenue: round1(unitPrice * qty), runProfit: round1((unitPrice - unitCost) * qty) },
    breakEvenUnits: unitCost > 0 ? Math.ceil(num(get('cost.fixedCosts'), 0) / (unitPrice - unitCost) || 0) : 0
  };
}

/** A size-grading reference table so the producer can run the style across a size curve. */
function buildGradingTable(ir, get) {
  const base = { bust: num(get('garment.finishedBust'), 0), length: num(get('garment.length'), 0), sleeve: num(get('garment.sleeveLength'), 0), castOn: num(get('pattern.castOn'), (ir.pieces && ir.pieces[0] && ir.pieces[0].stitches) || 0) };
  const grades = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
  const bustStep = 10, lenStep = 2; // cm per grade
  const spc = num(get('gauge.stsPerCm'), num(get('gauge.stitchesPer10cm'), 22) / 10);
  return grades.map((g, i) => {
    const d = i - 2; // M is index 2, the base
    const bust = round1(base.bust + d * bustStep);
    return {
      size: g,
      finishedBustCm: bust,
      finishedLengthCm: round1(base.length + d * lenStep),
      finishedSleeveCm: round1(base.sleeve + d * 1.5),
      castOnStitches: Math.round((bust * spc) / 4) * 4
    };
  });
}

/** QC checklist — a finished-measurement spot-check within tolerance, plus knit-specific gates. */
function buildQcChecklist(ir, get, qty) {
  const tol = MEASURE_TOLERANCE_CM;
  const checks = [
    { id: 'gauge', item: 'Knit a gauge swatch: match pattern gauge ±1 sts over 10 cm', critical: true },
    { id: 'bust', item: `Finished chest within ±${tol.chest} cm of spec (${round1(num(get('garment.finishedBust'), 0))} cm)`, critical: true },
    { id: 'length', item: `Finished body length within ±${tol.length} cm`, critical: false },
    { id: 'sleeve', item: `Sleeve length within ±${tol.sleeve} cm, both sleeves equal`, critical: false }
  ];
  const maxRow = Math.max(0, ...((ir.pieces || []).map(p => Number(p.rows) || 0)));
  if (maxRow > 0) checks.push({ id: 'rows', item: `Row count within ±2 of ${maxRow} on the body panel`, critical: true });
  if ((ir.machine && ir.machine.bedStitches) && num(get('pattern.castOn'), 0) > ir.machine.bedStitches) {
    checks.push({ id: 'bed', item: 'Cast-on exceeds bed width — confirm the panel is knitted in sections', critical: true });
  }
  checks.push({ id: 'finish', item: 'Ends woven in, blocked to measurements, no ladders at colour joins', critical: false });
  checks.push({ id: 'count', item: `Sample ${Math.max(1, Math.min(qty, 5))} of ${qty} units before packing`, critical: false });
  return { sample: Math.max(1, Math.min(qty, 5)), checks };
}

/** A packing slip skeleton the producer prints and staples to each carton. */
function buildPackingSlip(ir, qty, currency, cost) {
  return {
    style: (ir.metadata && ir.metadata.name) || 'pattern',
    units: qty,
    totalValue: `${currency} ${cost.pricing.runRevenue}`,
    skuBase: sku(ir),
    pieces: ((ir && ir.pieces) || []).map(p => ({ name: p.name || p.id, qty }))
  };
}

function sku(ir) {
  const name = (ir && ir.metadata && ir.metadata.name) || 'KNIT';
  const stem = name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase().slice(0, 12);
  return `${stem || 'KNIT'}-${(ir && ir.machine && ir.machine.id ? String(ir.machine.id).slice(0, 3) : 'STD').toUpperCase()}`;
}

function estimateHoursFromIr(ir) {
  const rows = Math.max(0, ...((ir && ir.pieces || []).map(p => Number(p.rows) || 0)));
  const sts = (ir && ir.pieces && ir.pieces[0] && ir.pieces[0].stitches) || 200;
  return (rows * sts) / 40000 + 1.5; // ~40k machine sts/hr + finishing
}

function collectWarnings(ir, yarn, cost) {
  const w = [];
  if (yarn.totalShort > 0) w.push(`${yarn.totalShort} balls short for the full run — raise a purchase order before scheduling.`);
  if (cost.breakEvenUnits > 0) w.push(`Break-even at ${cost.breakEvenUnits} units at the current margin.`);
  for (const p of (ir.pieces || [])) { const last = (p.rowsDetail || []).slice(-1)[0]; if (last && last.stitchesAfter <= 0) w.push(`${p.name || p.id} closes on 0 stitches — check the bind-off.`); }
  return w;
}

function num(v, d) { return Number.isFinite(Number(v)) ? Number(v) : d; }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
