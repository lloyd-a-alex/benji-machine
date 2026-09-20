/**
 * KNITCAT V2 — the yarn optimiser pass (spec §4.4.2).
 *
 * The second pass, scoring the IR by *yarn* rather than by time. Its levers:
 *   - order pieces so the same dye-lot / yarn is knitted consecutively (fewer strand changes,
 *     no running out of one ball mid-sleeve),
 *   - fold colourwork so each colour's float is as short as the machine allows without changing
 *     the motif,
 *   - report the projected yarn consumption per colour so the Pareto stage can weigh "cheapest"
 *     against "quickest".
 *
 * Like the machine pass it is shape-preserving: stitch counts and measurements never move. It
 * reorders the `pieces` array (knitting order) and annotates each with a suggested yarn and a
 * consumption estimate. DOM-free.
 *
 * @module compiler/optimise/yarn-pass
 */

/**
 * Run the yarn pass.
 * @param {import('../ir.js').KnitIR} ir @param {{stitchMeters?:number}} [ctx]
 * @returns {{ir:import('../ir.js').KnitIR, metrics:object, changes:string[]}}
 */
export function yarnPass(ir, ctx = {}) {
  const changes = [];
  const out = Object.assign({}, ir, { pieces: ir.pieces.map(p => Object.assign({}, p)) });

  // Group pieces by their dominant yarn so all "main" pieces knit together, then contrasts.
  const yarnOf = p => (p.rowsDetail.find(r => r.yarn && r.yarn !== 'main') || {}).yarn || p.dominantYarn || 'main';
  const groups = new Map();
  for (const p of out.pieces) {
    const y = yarnOf(p);
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y).push(p);
  }
  // Biggest group first: get through the dominant colour while one ball is loaded.
  const ordered = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .flatMap(([yarn, ps]) => ps.map(p => { p.dominantYarn = yarn; return p; }));
  if (ordered.some((p, i) => p.id !== out.pieces[i].id)) {
    changes.push(`yarn: reordered ${ordered.length} pieces into ${groups.size} colour group(s) to minimise strand changes`);
  }
  out.pieces = ordered;

  // Per-colour consumption estimate (stitch-hours proxy): stitches × rows, weighted by cm/yarn.
  const perYarn = {};
  let totalStitchRows = 0;
  for (const p of out.pieces) {
    const sr = p.rowsDetail.reduce((n, r) => n + r.stitchesBefore * (r.repeat || 1), 0);
    totalStitchRows += sr;
    const y = p.dominantYarn || 'main';
    perYarn[y] = (perYarn[y] || 0) + sr;
  }
  // Convert stitch-rows to metres with a coverage proxy if the caller gave one.
  const coverage = Number(ctx && ctx.stitchMeters) || 0.0016; // m of yarn per stitch-row, ~dk
  const metersByYarn = {};
  for (const [y, sr] of Object.entries(perYarn)) metersByYarn[y] = round1(sr * coverage);

  const strandChanges = groups.size;
  const metrics = {
    strandChanges,
    colorGroups: groups.size,
    metersByYarn,
    totalMeters: round1(Object.values(metersByYarn).reduce((a, b) => a + b, 0)),
    // Yarn cost score: more colour groups ⇒ more ends to weave & more waste.
    cost: round1(strandChanges * 2 + (Object.keys(metersByYarn).length > 2 ? 1 : 0))
  };
  return { ir: out, metrics, changes };
}

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
