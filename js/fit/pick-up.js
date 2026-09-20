/**
 * KNITCAT V2 — pick-up arithmetic.
 *
 * The finishing that ruins hand-made-looking machine knits is a neckband that ripples or a
 * button band that gapes, and both come from getting the pick-up count wrong. The rule every
 * experienced knitter knows (and every CAD system omits) is that you do not pick up one
 * stitch per row along a vertical edge — the row gauge and stitch gauge differ, so you pick
 * up a *fraction* of the rows. This module encodes the real formula and the standard edge
 * ratios so the finishing planner can emit exact counts:
 *
 *   pickUpCount = edgeRows × (stsPer10cm / rowsPer10cm) × pickUpRatio
 *
 * where `pickUpRatio` captures how many rows a picked-up stitch spans on that edge type (a
 * knit selvedge takes 3 sts over 4 rows, a bound-off edge takes 1 per stitch, a cast-on
 * edge takes 1 per stitch). DOM-free.
 *
 * @module fit/pick-up
 */

/** Standard picked-up stitches per unit edge length, by edge type. */
export const EDGE_RATIOS = Object.freeze({
  /** A vertical knit selvedge: pick up ~3 stitches across every 4 rows. */
  knitEdge: 0.75,
  /** A bound-off edge: one stitch in every bound-off stitch. */
  boundOff: 1.0,
  /** A cast-on edge: one stitch per cast-on stitch. */
  castOn: 1.0,
  /** A curved neckline worked off live stitches: 1:1 with a slight negative for a flat band. */
  neckline: 0.9,
  /** A sleeve head (set-in, eased): pick up 1:1 but plan ease. */
  sleeveHead: 1.0,
  /** A ribbed edge: pick up loosely, 1:1 but worked on a larger needle. */
  rib: 1.0
});

/**
 * Convert an edge described in rows to the number of stitches to pick up along it.
 * @param {object} params
 * @param {number} params.edgeRows     rows along the edge (for a vertical edge) OR
 * @param {number} [params.edgeCm]     edge length in cm (used if edgeRows absent)
 * @param {number} params.stsPer10cm
 * @param {number} params.rowsPer10cm
 * @param {keyof typeof EDGE_RATIOS|string} [params.edge]  edge type or a raw ratio number
 * @returns {{count:number, ratio:number, perRow:number, edgeRows:number}}
 */
export function pickUpCount(params = {}) {
  const spc = params.stsPer10cm || 0;
  const rpc = params.rowsPer10cm || 0;
  const edge = typeof params.edge === 'number' ? params.edge : (EDGE_RATIOS[params.edge] != null ? EDGE_RATIOS[params.edge] : EDGE_RATIOS.knitEdge);
  let rows = Number.isFinite(params.edgeRows) ? params.edgeRows : 0;
  if (!rows && Number.isFinite(params.edgeCm) && rpc) rows = (params.edgeCm * rpc) / 10;
  // stitches-per-cm over rows-per-cm is just spc/rpc; ratio captures how many we actually take.
  const perRow = rpc ? (spc / rpc) * edge : edge;
  const count = Math.max(0, Math.round(rows * perRow));
  return { count, ratio: edge, perRow, edgeRows: Math.round(rows) };
}

/**
 * Pick up evenly around a circular/oval neckline, splitting the total into front and back
 * halves with a small centre-front decrease allowance so the band lies flat instead of
 * flaring. Returns the pick-up plan for a crew/V/shawl collar.
 * @param {object} p
 * @param {number} p.neckCircumferenceCm @param {number} p.stsPer10cm @param {number} p.rowsPer10cm
 * @param {'crew'|'v'|'shawl'|'henley'} [p.shape='crew'] @param {number} [p.bandNegativeCm=1]
 * @returns {{total:number, back:number, front:number, shoulders:number, perNeedle:string}}
 */
export function necklinePickUp(p = {}) {
  const spc = (p.stsPer10cm || 0) / 10;
  const neckCm = p.neckCircumferenceCm || 0;
  const negative = Number.isFinite(p.bandNegativeCm) ? p.bandNegativeCm : 1;
  const ratio = EDGE_RATIOS.neckline;
  let total = Math.round((neckCm - negative) * spc * ratio * (1 / Math.max(ratio, 0.0001)));
  // Simpler honest model: band is slightly smaller than the neck opening it must grip.
  total = Math.max(0, Math.round((neckCm - negative) * spc));
  let back, front, shoulders;
  if (p.shape === 'v') {
    shoulders = Math.round(total * 0.12);
    back = Math.round((total - shoulders * 2) * 0.52);
    front = total - shoulders * 2 - back;
  } else if (p.shape === 'shawl') {
    shoulders = Math.round(total * 0.1);
    back = Math.round((total - shoulders * 2) * 0.55);
    front = total - shoulders * 2 - back;
  } else {
    shoulders = Math.round(total * 0.14);
    back = Math.round((total - shoulders * 2) * 0.5);
    front = total - shoulders * 2 - back;
  }
  return { total, back, front, shoulders, perNeedle: `pick up ${total} sts evenly around ${p.shape || 'crew'} neck` };
}

/**
 * Plan the decrease/increase a picked-up band needs to fit its opening over a collar/hood:
 * returns how many rows the band is and, for rib bands, the stitch-multiple to round to so
 * the rib pattern lands on a corner (2x2 rib wants a multiple of 4).
 * @param {number} count @param {number} [multiple=2] @returns {{count:number, rounded:number, delta:number}}
 */
export function fitRibToMultiple(count, multiple = 2) {
  const m = Math.max(1, Math.trunc(multiple));
  const rounded = Math.max(m, Math.round(count / m) * m);
  return { count: Math.trunc(count), rounded, delta: rounded - Math.trunc(count) };
}

/**
 * A complete pick-up plan for the common edges of a garment, given gauge and the relevant
 * dimensions, so the finishing planner can print exact counts in one call.
 * @param {object} g { stsPer10cm, rowsPer10cm }
 * @param {object} dims { armholeRows, sideSeamRows, frontBandRows, neckCircumferenceCm }
 * @returns {Record<string,{count:number,note:string}>}
 */
export function pickupPlanForEdges(g = {}, dims = {}) {
  const out = {};
  const add = (key, edgeRows, edge, note) => {
    const r = pickUpCount({ edgeRows, stsPer10cm: g.stsPer10cm, rowsPer10cm: g.rowsPer10cm, edge });
    out[key] = { count: r.count, note: `${note} — pick up ${r.count} sts (${edge} edge)` };
  };
  if (dims.armholeRows) add('armhole', dims.armholeRows * 2, 'knitEdge', 'each armhole');
  if (dims.sideSeamRows) add('sideSeam', dims.sideSeamRows, 'knitEdge', 'side seam');
  if (dims.frontBandRows) add('frontBand', dims.frontBandRows, 'knitEdge', 'front opening');
  if (dims.neckCircumferenceCm) {
    const neck = necklinePickUp({ neckCircumferenceCm: dims.neckCircumferenceCm, stsPer10cm: g.stsPer10cm, rowsPer10cm: g.rowsPer10cm });
    out.neckline = { count: neck.total, note: neck.perNeedle };
  }
  return out;
}
