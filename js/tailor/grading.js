/**
 * KNITCAT — size grading (browser-free).
 *
 * Real knitwear is graded, not eyeballed: you design one block and scale a set of
 * sizes off it. This module takes a garment's base parameters and emits a graded
 * size run — XS–XL for bodies, a baby→adult head set for hats, shoe sizes for
 * socks — each entry a complete parameter object you can hand straight back to the
 * ClothesEngine. It is deliberately a pure function so the monotonic relationship
 * between the driver measurement and the cast-on is testable.
 *
 * @module tailor/grading
 */

const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Which parameter carries the width of each structure when grading. */
const DRIVER = {
  body: 'chest', tank: 'chest', hat: 'head', tube: 'head',
  flat: 'width', hand: 'hand', sock: 'calf', triangle: 'wingspan'
};

/** Named size sets as (label, multiplier) runs — always ascending. */
const SETS = {
  alpha: [['XS', 0.88], ['S', 0.94], ['M', 1.0], ['L', 1.07], ['XL', 1.15]],
  head: [['Baby', 0.68], ['Child', 0.82], ['S/M', 0.93], ['M/L', 1.0], ['XL', 1.07]],
  foot: [['Baby', 0.5], ['Toddler', 0.68], ['Child', 0.84], ['S', 0.93], ['M', 1.0], ['L', 1.08]]
};

function inferMode(garment) {
  const s = garment?.structure;
  if (s === 'hat') return 'head';
  if (s === 'sock') return 'foot';
  return 'alpha';
}

/**
 * Produce a graded size run for a garment.
 *
 * @param {object} garment   a GARMENTS entry (uses .structure)
 * @param {object} baseParams the "M" / reference block parameters
 * @param {object} [opts]     { mode:'alpha'|'head'|'foot' }
 * @returns {Array<{label:string, params:object}>} ascending in size
 */
export function gradeSizes(garment, baseParams = {}, opts = {}) {
  const mode = opts.mode && SETS[opts.mode] ? opts.mode : inferMode(garment);
  const set = SETS[mode];
  const driver = DRIVER[garment?.structure] || DRIVER.tube;
  const base = finite(baseParams[driver], NaN);

  return set.map(([label, factor]) => {
    const params = { ...baseParams };
    if (Number.isFinite(base)) {
      params[driver] = Math.round(base * factor * 10) / 10;
      // Socks also grow in foot length with the same factor so the L stays in shape.
      if (garment?.structure === 'sock' && finite(baseParams.foot, 0) > 0) {
        params.foot = Math.round(finite(baseParams.foot) * factor * 10) / 10;
      }
    }
    return { label, params };
  });
}
