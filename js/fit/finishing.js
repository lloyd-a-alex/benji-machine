/**
 * KNITCAT V2 — the finishing planner.
 *
 * The difference between a garment that looks made and one that looks knitted is the
 * finishing, and the finishing is the part knitters forget until it is too late. This turns
 * a garment's dimensions and edge pick-up counts into an ordered, explicit plan of every
 * band, collar, pocket, buttonhole and seam — each with its row-by-row instructions — the
 * thing a knitter pins above the machine so nothing is missed.
 *
 * It consumes {@link module:fit/pick-up} for exact pick-up counts and reuses
 * {@link module:fit/shaping-scheduler} row primitives so the compiler and the written
 * backend see finishing rows in the same shape as body rows. DOM-free.
 *
 * @module fit/finishing
 */

import { necklinePickUp, pickUpCount, fitRibToMultiple } from './pick-up.js';
import { knitEven } from './shaping-scheduler.js';

/** Recognised hem/edging styles and how they are worked. */
export const HEM_STYLES = Object.freeze({
  'rib1x1': { multiple: 2, stretch: 0.9 },
  'rib2x2': { multiple: 4, stretch: 0.82 },
  'rib2x1': { multiple: 3, stretch: 0.86 },
  'seed': { multiple: 2, stretch: 0.95 },
  'garter': { multiple: 1, stretch: 0.98 },
  'picot': { multiple: 2, stretch: 0.9 },
  'rolled': { multiple: 1, stretch: 1.0 },
  'tubular': { multiple: 1, stretch: 0.75 },
  'folded': { multiple: 1, stretch: 0.9 }
});

/**
 * A hem / band worked in a rib or textured edging.
 * @param {object} p
 * @param {'rib1x1'|'rib2x2'|'rib2x1'|'seed'|'garter'|'picot'|'rolled'|'tubular'|'folded'|string} p.style
 * @param {number} p.stitches @param {number} p.heightCm @param {number} p.rowsPer10cm
 * @param {string} [p.label]
 * @returns {{kind:string, label:string, style:string, stitches:number, rows:number, instructions:string[]}}
 */
export function hemBand(p = {}) {
  const style = HEM_STYLES[p.style] ? p.style : 'rib2x2';
  const spec = HEM_STYLES[style];
  const fit = fitRibToMultiple(p.stitches || 0, spec.multiple);
  const rows = Math.max(2, Math.round(((p.heightCm || 4) * (p.rowsPer10cm || 0)) / 10));
  const instructions = [];
  if (style.startsWith('rib')) {
    const [k, pp] = style.slice(3).split('x').map(Number);
    instructions.push(`Set the ribber or use the lace/carriage rib setting: *K${k}, P${pp}; rep from *.`);
    instructions.push(`Work ${rows} rows of ${style} over ${fit.rounded} sts.`);
  } else if (style === 'picot') {
    instructions.push(`Work ${Math.floor(rows / 2)} rows even, *yo, k2tog* every edge st for a picot turn.`);
  } else if (style === 'tubular') {
    instructions.push(`Work ${Math.floor(rows / 2)} rows, fold, graft or mattress-stitch the tubular hem.`);
  } else {
    instructions.push(`Work ${rows} rows of ${style} over ${fit.rounded} sts.`);
  }
  return { kind: 'hem', label: p.label || 'Hem', style, stitches: fit.rounded, rows, deltaStitches: fit.delta, instructions };
}

/**
 * A neckband: pick-up, optional decrease rows to shape, work to height, bind off.
 * @param {object} p { shape, neckCircumferenceCm, stsPer10cm, rowsPer10cm, heightCm, style }
 */
export function neckband(p = {}) {
  const neck = necklinePickUp({
    neckCircumferenceCm: p.neckCircumferenceCm || 40,
    stsPer10cm: p.stsPer10cm || 24,
    rowsPer10cm: p.rowsPer10cm || 32,
    shape: p.shape || 'crew'
  });
  const band = hemBand({ style: p.style || 'rib1x1', stitches: neck.total, heightCm: p.heightCm || 3, rowsPer10cm: p.rowsPer10cm, label: 'Neckband' });
  const instructions = [neck.perNeedle + ` (back ${neck.back}, front ${neck.front}, shoulders ${neck.shoulders} each).`].concat(band.instructions);
  if (p.shape === 'v') instructions.push(`Place a marker at centre front; dec 1 st each side of marker every other row to shape the V.`);
  instructions.push(`Bind off in pattern, stretching to match the neck opening.`);
  return { kind: 'neckband', shape: p.shape || 'crew', pickUp: neck, band, stitches: neck.total, instructions };
}

/**
 * A button band with evenly-spaced buttonholes, honouring horizontal vs vertical orientation.
 * @param {object} p
 * @param {number} p.rows @param {number} p.stitches @param {number} p.stsPer10cm @param {number} p.rowsPer10cm
 * @param {number} [p.buttons=5] @param {'vertical'|'horizontal'} [p.orientation='vertical']
 * @param {number} [p.buttonholeCm=1.5] @param {number} [p.topGapCm=2] @param {number} [p.bottomGapCm=2]
 */
export function buttonBand(p = {}) {
  const spc = (p.stsPer10cm || 24) / 10;
  const rpc = (p.rowsPer10cm || 32) / 10;
  const bandSts = Math.max(4, Math.round((p.stitches || 6) * 1));
  const totalRows = p.rows || Math.round((p.lengthCm || 40) * rpc);
  const buttons = Math.max(1, p.buttons || 5);
  const gapRows = Math.max(0, Math.round((p.topGapCm || 2) * rpc));
  const bottomGapRows = Math.max(0, Math.round((p.bottomGapCm || 2) * rpc));
  const usable = Math.max(buttons, totalRows - gapRows - bottomGapRows);
  const spacing = Math.floor(usable / buttons);
  const holeRows = Math.max(1, Math.round((p.buttonholeCm || 1.5) * rpc));
  const instructions = [];
  instructions.push(`Pick up and knit ${bandSts} sts along the front band (${Math.round(totalRows / rpc)} cm).`);
  instructions.push(`Work ${gapRows} rows even before the first buttonhole.`);
  for (let i = 0; i < buttons; i++) {
    const rowPos = gapRows + i * spacing;
    instructions.push(`At row ${rowPos + 1}: work a ${p.orientation === 'horizontal' ? 'vertical (no-yo, bound-off)' : 'horizontal'} buttonhole over ${holeRows} rows.`);
    if (i < buttons - 1) instructions.push(`  work ${spacing - holeRows} rows even to next hole.`);
  }
  instructions.push(`Work to ${bottomGapRows} sts from the hem end; mirror-bind off loosely.`);
  return { kind: 'button-band', stitches: bandSts, totalRows, buttons, holeRows, spacing, instructions };
}

/** A patch / inset / kangaroo pocket. */
export function pocket(p = {}) {
  const spc = (p.stsPer10cm || 24) / 10;
  const rpc = (p.rowsPer10cm || 32) / 10;
  const sts = Math.round((p.widthCm || 12) * spc);
  const rows = Math.round((p.heightCm || 13) * rpc);
  const kind = p.type || 'patch';
  const instructions = [];
  if (kind === 'kangaroo') instructions.push(`Work two pocket bags from a split cast-on, joining at the top band.`);
  else if (kind === 'inset') instructions.push(`Work the lining, then pick up around the garment slit and knit the facing.`);
  else instructions.push(`Cast on ${sts} sts, work ${rows} rows (add ${Math.round(2 * rpc)} rows for a folded hem if desired), bind off.`);
  instructions.push(`Block, then mattress-stitch or sew down three sides at the planned position.`);
  return { kind: 'pocket', type: kind, stitches: sts, rows, instructions };
}

/** A hood: two mirrored panels from a wedge of short rows, seamed. */
export function hood(p = {}) {
  const spc = (p.stsPer10cm || 24) / 10;
  const rpc = (p.rowsPer10cm || 32) / 10;
  const headCm = p.headCircumferenceCm || 56;
  const sts = Math.round((headCm / 2) * spc);
  const rows = Math.round(((p.depthCm || 24) + (p.headCircumferenceCm ? headCm / 4 : 14)) * rpc);
  return {
    kind: 'hood', stitches: sts, rows, panels: 2,
    instructions: [
      `Cast on ${sts} sts for one hood half.`,
      `Work a straight section for ${Math.round((p.brimCm || 3) * rpc)} rows.`,
      `Shape the crown: dec 1 st at the back-neck edge every other row until ${Math.round(sts * 0.4)} sts remain.`,
      `Work even, then dec at crown edge to a point. Bind off.`,
      `Make 2 (mirror the second). Matte-stitch the centre-back seam, then sew to the neckband.`
    ]
  };
}

/** A collar (stand, shawl, funnel, polo). */
export function collar(p = {}) {
  const spc = (p.stsPer10cm || 24) / 10;
  const rpc = (p.rowsPer10cm || 32) / 10;
  const neckSts = Math.round((p.neckCircumferenceCm || 44) * spc * 0.9);
  const rows = Math.round((p.heightCm || 8) * rpc);
  const type = p.type || 'stand';
  const instructions = [
    type === 'shawl' ? `Pick up along the front edges and back neck continuously, increasing at the points.` : `Pick up ${neckSts} sts around the neck.`,
    `Work ${rows} rows; ${type === 'funnel' || type === 'stand' ? `on the last row work *(k2, yo, k2tog)* to stiffen the top edge` : `turn and fold, grafting the free edge`}.`,
    `Bind off firmly so the collar stands or lies as planned.`
  ];
  return { kind: 'collar', type, stitches: neckSts, rows, instructions };
}

/**
 * The full finishing plan for a drafted garment — the ordered checklist that ties the pieces
 * together. Every entry is one of the builders above with its instructions.
 * @param {object} ctx
 * @param {object} ctx.gauge { stsPer10cm, rowsPer10cm }
 * @param {object} ctx.dims  body/garment cm dimensions (neck, wrist, hem circumference, lengths)
 * @param {object} [ctx.style] which finishings the garment uses { hem, cuffs, collar, ... }
 * @returns {{items:Array, seaming:string[], summary:string[]}}
 */
export function planFinishing(ctx = {}) {
  const g = ctx.gauge || {};
  const d = ctx.dims || {};
  const s = ctx.style || {};
  const items = [];
  if (s.hem) items.push(hemBand({ style: s.hem, stitches: d.hemStitches, heightCm: d.hemHeightCm || 5, rowsPer10cm: g.rowsPer10cm, label: 'Hem' }));
  if (s.cuffs) for (const side of ['left', 'right']) items.push(hemBand({ style: s.cuffs, stitches: d.cuffStitches, heightCm: d.cuffHeightCm || 6, rowsPer10cm: g.rowsPer10cm, label: `Cuff (${side})` }));
  if (s.neckband) items.push(neckband({ shape: s.neckband.shape || 'crew', neckCircumferenceCm: d.neckCircumferenceCm, stsPer10cm: g.stsPer10cm, rowsPer10cm: g.rowsPer10cm, style: s.neckband.style, heightCm: s.neckband.heightCm }));
  if (s.collar) items.push(collar(Object.assign({ stsPer10cm: g.stsPer10cm, rowsPer10cm: g.rowsPer10cm, neckCircumferenceCm: d.neckCircumferenceCm }, s.collar)));
  if (s.hood) items.push(hood(Object.assign({ stsPer10cm: g.stsPer10cm, rowsPer10cm: g.rowsPer10cm }, s.hood)));
  if (s.buttonBand) items.push(buttonBand(Object.assign({ stsPer10cm: g.stsPer10cm, rowsPer10cm: g.rowsPer10cm }, s.buttonBand)));
  if (s.pockets) for (let i = 0; i < (s.pockets.count || 1); i++) items.push(pocket(Object.assign({ stsPer10cm: g.stsPer10cm, rowsPer10cm: g.rowsPer10cm, type: s.pockets.type }, s.pockets, {})));

  const seaming = [
    `Weave in all ends on the wrong side before seaming.`,
    d.construction === 'raglan' ? `Close the raglan seams first, then side seams and sleeve seams in one continuous pass.` : `Mattress-stitch the shoulder seams, then sleeves to body (matching underarm and cap-centre markers), then side seams and sleeve undersams in one run.`,
    `Sew the neckband/bands last, easing to fit.`,
    `Soak, roll in a towel, and dry flat to final measurements, pinning rib edges to avoid cinching.`
  ];
  const summary = items.map(it => `${it.kind}: ${it.instructions[0]}`);
  return { items, seaming, summary };
}
