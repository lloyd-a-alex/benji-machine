/**
 * KNITCAT V2 — gauge nodes.
 *
 * Gauge is the hinge between the abstract design and the physical machine: it converts
 * centimetres into stitches and rows. There are two honest sources for it — a *measured
 * swatch* (the truth) and a *yarn-weight expectation* (a good guess before you have knit
 * one). This pack wires both: if the KnitScript carries a `swatch` with real numbers,
 * those become the input nodes; otherwise the expected gauge is derived from the main
 * yarn's weight. Either way `gauge.stitchesPer10cm` and `gauge.rowsPer10cm` are the two
 * numbers every stitch-count downstream reads, so a yarn or swatch change re-derives the
 * entire garment through the graph.
 *
 * @module project/nodes/gauge-nodes
 */

/** Typical stitches-per-10cm range by yarn weight (midpoint drives the expected gauge). */
export const WEIGHT_GAUGE = Object.freeze({
  lace: [32, 40], 'light-fingering': [28, 36], fingering: [27, 32], baby: [26, 30],
  sport: [22, 26], dk: [21, 24], lightworsted: [18, 21], worsted: [16, 20],
  aran: [14, 16], bulky: [10, 13], 'super-bulky': [8, 10], chunky: [9, 12], jumbo: [6, 8]
});

/** Rows are typically ~1.35× the stitch count in stockinette. */
const ROW_RATIO = 1.35;

/**
 * Derive an expected gauge (sts/10cm, rows/10cm) from a yarn weight string.
 * @param {string} weight @returns {{sts:number, rows:number}}
 */
export function expectedGauge(weight) {
  const range = WEIGHT_GAUGE[String(weight || '').toLowerCase()];
  if (!range) return { sts: 22, rows: Math.round(22 * ROW_RATIO) };
  const sts = (range[0] + range[1]) / 2;
  return { sts, rows: sts * ROW_RATIO };
}

/**
 * Define the gauge nodes. Chooses swatch-measured values when present, else expected.
 * @param {import('../constraint-graph.js').ConstraintGraph} graph
 * @param {{spec:object}} ctx
 */
export function defineGaugeNodes(graph, ctx) {
  const s = (ctx.spec && ctx.spec.sections) || {};
  const sw = s.swatch || {};
  const mainYarn = firstYarn(s.yarn);
  const expected = expectedGauge(mainYarn && (mainYarn.weight || mainYarn));

  // Prefer explicit swatch numbers; `stitchesPer10cm` or a `sts: 22` scalar both count.
  const measuredSts = pickNumber(sw, ['stitchesPer10cm', 'sts', 'stitches']);
  const measuredRows = pickNumber(sw, ['rowsPer10cm', 'rows']);

  const sts = measuredSts != null ? measuredSts : expected.sts;
  const rows = measuredRows != null ? measuredRows : expected.rows;

  graph.define('gauge.stitchesPer10cm', [], null, sts, { isInput: true });
  graph.define('gauge.rowsPer10cm', [], null, rows, { isInput: true });
  graph.define('gauge.source', [], null, measuredSts != null ? 'swatch' : 'expected', { isInput: true });

  graph.define('gauge.stsPerCm', ['gauge.stitchesPer10cm'], (i) => i['gauge.stitchesPer10cm'] / 10);
  graph.define('gauge.rowsPerCm', ['gauge.rowsPer10cm'], (i) => i['gauge.rowsPer10cm'] / 10);
}

/** The first yarn assignment in the yarn bucket (whatever it is called), or null. */
export function firstYarn(yarns) {
  if (!yarns || typeof yarns !== 'object') return null;
  const keys = Object.keys(yarns);
  if (!keys.length) return null;
  const preferred = keys.find(k => /^(main|a|body|mc)$/i.test(k)) || keys[0];
  return yarns[preferred];
}

function pickNumber(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v && typeof v === 'object' && typeof v.value === 'number') return v.value;
    if (v && typeof v.left === 'number') return v.left; // a `22 sts × 30 rows` pair
  }
  return null;
}
