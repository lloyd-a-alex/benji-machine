/**
 * KNITCAT V2 — the cost calculator (spec §3.7 CostReport).
 *
 * One place that turns "what did this cost me" into a real number a seller can price from:
 * yarn (from the yardage the graph computed and the per-ball price in the stash), labour (from
 * the time estimate at a chosen rate), materials (buttons/zipper/other), and a slice of
 * overhead. It then does the maths knitters get wrong by hand — cost per unit across a batch,
 * a suggested retail price at a target margin, wholesale at keystone, and the profit that is
 * actually left. DOM-free.
 *
 * @module yarn/cost
 */

/**
 * @typedef {object} CostInput
 * @property {Array<{name:string, meters:number, ballMeters:number, ballPrice:number, balls:number}>} [yarns]
 * @property {number} [hours] total machine/hand hours
 * @property {number} [laborRate] currency per hour
 * @property {number} [buttons] @property {number} [zipper] @property {number} [otherMaterials]
 * @property {number} [overheadElectricity] @property {number} [overheadWear]
 * @property {number} [quantity] number made (for per-unit cost)
 * @property {number} [targetMargin] 0..1 desired gross margin
 * @property {string} [currency]
 */

/**
 * Compute a full {@link CostReport}.
 * @param {CostInput} input @returns {object}
 */
export function computeCost(input = {}) {
  const currency = input.currency || '£';
  const yarns = Array.isArray(input.yarns) ? input.yarns : [];
  const perYarn = {};
  let yarnTotal = 0;
  for (const y of yarns) {
    const ballMeters = Number(y.ballMeters) || 0;
    const needed = Number(y.meters) || 0;
    const balls = Number(y.balls) || (ballMeters ? Math.ceil(needed / ballMeters) : 0);
    const cost = round2(balls * (Number(y.ballPrice) || 0));
    perYarn[y.name || 'yarn'] = cost;
    yarnTotal += cost;
  }
  yarnTotal = round2(yarnTotal);

  const hours = Number(input.hours) || 0;
  const laborRate = Number(input.laborRate) || 0;
  const laborTotal = round2(hours * laborRate);

  const materials = {
    buttons: round2(input.buttons || 0),
    zipper: round2(input.zipper || 0),
    other: round2(input.otherMaterials || 0)
  };
  materials.total = round2(materials.buttons + materials.zipper + materials.other);

  const overhead = {
    electricity: round2(input.overheadElectricity || 0),
    wear: round2(input.overheadWear || 0)
  };
  overhead.total = round2(overhead.electricity + overhead.wear);

  const total = round2(yarnTotal + laborTotal + materials.total + overhead.total);
  const quantity = Math.max(1, Number(input.quantity) || 1);
  const perUnit = round2(total / quantity);

  const targetMargin = clamp(input.targetMargin != null ? Number(input.targetMargin) : 0.6, 0, 0.95);
  // Gross margin price = cost / (1 - margin).
  const suggestedPrice = round2(perUnit / (1 - targetMargin));
  const wholesalePrice = round2(perUnit * 2); // keystone
  const profit = round2(suggestedPrice - perUnit);
  const profitMargin = suggestedPrice ? round2(profit / suggestedPrice) : 0;

  return {
    currency,
    yarn: { perYarn, total: yarnTotal },
    labor: { hours: round2(hours), rate: laborRate, total: laborTotal },
    materials,
    overhead,
    total,
    perUnit,
    quantity,
    suggestedPrice,
    wholesalePrice,
    profit,
    profitMargin,
    targetMargin,
    breakdown: [
      { label: 'Yarn', value: yarnTotal },
      { label: 'Labor', value: laborTotal },
      { label: 'Materials', value: materials.total },
      { label: 'Overhead', value: overhead.total }
    ]
  };
}

/**
 * Convenience: derive the yarn cost from a Project's graph nodes (meters) + a price map.
 * @param {object} project @param {Record<string,{ballPrice:number, ballMeters:number}>} prices
 * @param {object} [extra] { hours, laborRate, ... } fed to {@link computeCost}
 * @returns {object}
 */
export function costFromProject(project, prices = {}, extra = {}) {
  const get = id => (project && project.get ? project.get(id) : undefined);
  const meters = Number(get('yarn.totalMeters')) || Number(get('yarn.totalYards')) || 0;
  const yarns = Object.entries(prices).map(([name, p]) => ({
    name, meters, ballMeters: p.ballMeters, ballPrice: p.ballPrice, balls: p.balls
  }));
  return computeCost(Object.assign({ yarns, hours: Number(get('time.totalHours')) || 0 }, extra));
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
