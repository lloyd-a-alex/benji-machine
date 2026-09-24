/**
 * KNITCAT — drafted garment engines (browser-free, pure arithmetic).
 *
 * The catalogue (`clothes-catalog.js`) could already name every garment and route the
 * two "gold standard" structures — the beanie and the tank top — through dedicated
 * engines that emit real, exact numbers. But everything else (sweaters, cardigans,
 * socks, mittens) fell through to the generic `_body` / `_sock` / `_hand` planners,
 * which wrote friendly prose ("shape the armhole, then the neck") rather than the
 * actual row-by-row stitch schedule a machine knitter sits down and follows.
 *
 * Meanwhile the Fit Engine already had exactly the maths we needed: the shared
 * shaping scheduler (`fit/shaping-scheduler.js`) and the drafting helpers
 * (`fit/templates/_helpers.js`) turn "start at A sts, end at B sts, over N rows,
 * shaping `perEvent` at a time" into an explicit schedule of {@link ShapingRow}
 * events. This module *fuses* the two systems: it drives the generic structures with
 * the same battle-tested scheduler the fit templates use, so the catalogue and the
 * fit engine finally share one source of shaping truth instead of two that disagree.
 *
 * What each engine returns (the "drafted model"):
 *   {
 *     params, gauge,                       // echo of the normalised inputs
 *     structure,                           // 'body' | 'sock' | 'hand'
 *     parts:   [{ name, castOn, rows, circumferenceCm|widthCm, heightCm }],
 *     schedule:[ PatternPiece, ... ],      // fit/templates/_helpers piece() shape
 *     instructions: [{ step, title, text }],
 *     metrics: { ...engine specific stitch/row targets... },
 *     footprintCm: { w, h }
 *   }
 *
 * `parts` is exactly the shape `ClothesEngine._augment`, `estimateYarn` and
 * `buildFashioning` already consume, so wiring an engine into the catalogue is a
 * drop-in: the plan keeps every field the existing tests assert and *gains* the
 * drafted `schedule`. Nothing here touches the DOM and no method ever throws — bad
 * input is clamped to a sane, finite, knittable plan.
 *
 * @module tailor/drafted-engines
 */

import {
  stsFor, rowsFor, toMultiple, ribRows, knitRows,
  distributedDecreases, distributedIncreases, underarmBindOff, neckShaping, piece
} from '../fit/templates/_helpers.js';
import { shortRowSchedule, suggestTurnCount } from '../fit/short-rows.js';
import { logger } from '../core/logging.js';

const log = logger('tailor/drafted-engines');

const round = Math.round;
const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** A cm → stitches / rows pair derived from a per-10-cm gauge, clamped sane. */
function gaugeRates(gauge = {}) {
  const stsPer10 = clamp(parseFloat(gauge.stitchesPer10Cm) || 28, 8, 120);
  const rowsPer10 = clamp(parseFloat(gauge.rowsPer10Cm) || 40, 8, 200);
  return { stsPer10, rowsPer10, spc: stsPer10 / 10, rpc: rowsPer10 / 10 };
}

/**
 * Walk a joined schedule and summarise every non-plain shaping event with the running
 * live-stitch count, so the UI and the machine-step builder can quote exact numbers.
 * @param {object} joined a `joinSegments`/`piece()` result with `.rows` carrying `_after`
 * @returns {Array<{row:number, action:string, count:number, position:string, stsAfter:number}>}
 */
export function describeSchedule(joined) {
  const rows = Array.isArray(joined?.rows) ? joined.rows : [];
  const out = [];
  for (const r of rows) {
    if (r.action && r.action !== 'knit' && finite(r.count, 0) !== 0) {
      out.push({
        row: round(r.row), action: r.action, count: round(r.count),
        position: r.position || 'both', stsAfter: round(finite(r._after, 0))
      });
    }
  }
  return out;
}

/** Flatten a list of shaping events into a human "dec 2 every 6th row ×4" style sentence. */
function phraseEvents(events, noun = 'stitch') {
  if (!events.length) return 'work even';
  const first = events[0];
  if (events.length === 1) return `${first.action} ${first.count} ${noun} at ${first.position}`;
  // Measure the spacing between shaping rows to describe the cadence honestly.
  const gaps = [];
  for (let i = 1; i < events.length; i++) gaps.push(events[i].row - events[i - 1].row);
  const gap = gaps.length ? round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 1;
  const perEv = round(first.count / (first.position === 'both' ? 2 : 1)) || 1;
  return `${first.action} ${perEv} ${noun}${perEv === 1 ? '' : 'es'} at ${first.position} every ${gap} row${gap === 1 ? '' : 's'}, ${events.length} times`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweater / body engine — a bottom-up pullover with real armhole + neck + sleeve
// shaping. Drives every 'body' structure garment (sweater, cardigan, hoodie, vest,
// turtleneck, crop, baby sweater, camisole).
// ─────────────────────────────────────────────────────────────────────────────

export class SweaterEngine {
  static DEFAULTS = {
    chest: 100, length: 62, rib: 5, sleeve: 45,
    ease: 8, neckdrop: 6, waist: 0, armhole: 20
  };

  /**
   * @param {object} params catalogue params (cm)
   * @param {object} gauge  { stitchesPer10Cm, rowsPer10Cm }
   * @returns {object} drafted model
   */
  compute(params = {}, gauge = {}) {
    const p = { ...SweaterEngine.DEFAULTS, ...params };
    const { stsPer10, rowsPer10, spc, rpc } = gaugeRates(gauge);

    const chestCm = clamp(finite(p.chest, 100), 44, 170);
    const lengthCm = clamp(finite(p.length, 62), 24, 95);
    const ribCm = clamp(finite(p.rib, 5), 0, 12);
    const sleeveCm = clamp(finite(p.sleeve, 45), 0, 75);
    const armholeCm = clamp(finite(p.armhole, lengthCm * 0.34), 8, 36);
    const neckdropCm = clamp(finite(p.neckdrop, 6), 0, 24);
    const waistDelta = clamp(finite(p.waist, 0), -14, 8);

    // Stitch targets. The tube is worked all the way round, so the cast-on is the whole
    // chest; the waist pinches in by `waistDelta` cm and the hip/rib is slightly tighter.
    const bustSts = toMultiple(stsFor(chestCm, stsPer10), 2);
    const waistSts = toMultiple(Math.max(20, stsFor(chestCm + waistDelta, stsPer10)), 2);
    const ribSts = toMultiple(Math.max(20, round(bustSts * 0.92)), 2);
    const underarmSts = Math.max(2, round(bustSts * 0.08));
    const shoulderSts = round((bustSts - underarmSts * 2) * 0.42); // live at shoulder per half
    const neckSts = Math.max(2, round(bustSts * 0.3));

    // Row targets.
    const ribRowsN = rowsFor(ribCm, rowsPer10);
    const bodyToArmhole = Math.max(4, rowsFor(lengthCm - armholeCm, rowsPer10));
    const armholeRows = rowsFor(armholeCm, rowsPer10);
    const neckRows = rowsFor(neckdropCm, rowsPer10);
    const totalBodyRows = ribRowsN + bodyToArmhole + armholeRows;

    // Assemble the BODY schedule from shared shaping segments.
    const waistEvents = distributedDecreases(Math.max(0, ribSts - waistSts), Math.max(1, round(bodyToArmhole * 0.35)), 'both');
    const bustEvents = distributedIncreases(Math.max(0, bustSts - waistSts), Math.max(1, round(bodyToArmhole * 0.35)), 'both');
    const straightEven = knitRows(Math.max(0, bodyToArmhole - round(bodyToArmhole * 0.7)));
    const armholeEvents = distributedDecreases(underarmSts, Math.max(1, round(armholeRows * 0.6)), 'both');
    const bodyPiece = piece({
      id: 'body', name: 'Body (bottom-up tube)', castOn: ribSts,
      segments: [
        ribRows(ribRowsN, ribSts, 'rib2x2'),
        waistEvents, bustEvents, straightEven,
        underarmBindOff(underarmSts, 1), armholeEvents
      ],
      extra: {
        seams: [{ with: 'sleeve', edge: 'underarm-to-shoulder' }],
        dimensions: { bustSts, waistSts, ribSts, shoulderSts, neckSts, armholeRows, lengthCm }
      }
    });

    // The two sleeves: cuff rib, increase to upper arm, bind off underarm, live for the yoke.
    let sleevePiece = null;
    const cuffSts = toMultiple(Math.max(16, stsFor(chestCm * 0.16, stsPer10)), 2);
    const upperArmSts = toMultiple(Math.max(cuffSts + 4, stsFor(chestCm * 0.34, stsPer10)), 2);
    if (sleeveCm > 0) {
      const cuffRowsN = rowsFor(Math.min(ribCm + 1, 7), rowsPer10);
      const sleeveRows = Math.max(cuffRowsN + 2, rowsFor(sleeveCm, rowsPer10));
      sleevePiece = piece({
        id: 'sleeve', name: 'Sleeves ×2', castOn: cuffSts,
        segments: [
          ribRows(cuffRowsN, cuffSts, 'rib2x2'),
          distributedIncreases(upperArmSts - cuffSts, Math.max(1, sleeveRows - cuffRowsN - 2), 'both'),
          underarmBindOff(underarmSts, 1)
        ],
        extra: {
          seams: [{ with: 'body', edge: 'underarm-to-shoulder' }],
          dimensions: { cuffSts, upperArmSts, sleeveRows, sleeveCm }
        }
      });
    }

    const schedule = sleevePiece ? [bodyPiece, sleevePiece] : [bodyPiece];
    const parts = [
      { name: 'Body', castOn: ribSts, rows: totalBodyRows, circumferenceCm: to1(chestCm), heightCm: to1(lengthCm) },
      ...(sleevePiece ? [{ name: 'Sleeves ×2', castOn: cuffSts, rows: sleevePiece.totalRows, circumferenceCm: to1(chestCm * 0.34) }] : [])
    ];

    const bodyDecEvents = describeSchedule(bodyPiece);
    const sleeveIncEvents = sleevePiece ? describeSchedule(sleevePiece) : [];

    const instructions = [
      { step: 1, title: 'Hem rib', text: `Cast on ${ribSts} sts, join in the round being careful not to twist. Work ${ribCm} cm (${ribRowsN} rounds) of 2×2 rib on firmer tension.` },
      waistDelta !== 0
        ? { step: 2, title: 'Waist shaping', text: `${phraseEvents(bodyDecEvents.slice(0, Math.max(1, bodyDecEvents.filter(e => e.action === 'decrease').length)))} down to ${waistSts} sts, then mirror back out to ${bustSts} sts at the bust. Knit even to ${to1(lengthCm - armholeCm)} cm.` }
        : { step: 2, title: 'Body to armholes', text: `Change to ${bustSts} sts and knit even until the piece measures ${to1(lengthCm - armholeCm)} cm to the armhole (${bodyToArmhole} rounds above the rib).` },
      { step: 3, title: 'Armholes', text: `Bind off ${underarmSts} sts at each underarm, then ${phraseEvents(bodyDecEvents.filter(e => e.action === 'decrease'))} for the scye. Put the final ${shoulderSts} shoulder sts per side on hold; shape the neck over ${neckRows} rows.` },
      sleeveCm > 0
        ? { step: 4, title: 'Sleeves', text: `Cast on ${cuffSts} sts ×2, rib ${to1(Math.min(ribCm + 1, 7))} cm, then ${phraseEvents(sleeveIncEvents.filter(e => e.action === 'increase'))} to ${upperArmSts} sts. Work to ${sleeveCm} cm, bind off ${underarmSts} at each underarm and leave live.` }
        : { step: 4, title: 'Straps / bands', text: `Sleeveless: pick up and knit the shoulder straps and a ${neckSts}-st neckband to length.` },
      { step: 5, title: 'Join shoulders & neck', text: `Three-needle bind off the ${shoulderSts} held shoulder sts front-to-back. Pick up ${neckSts} sts around the neck and work ${to1(Math.max(2, neckdropCm * 0.5))} cm of rib; bind off stretchy. Seam sleeves, weave in ends, block.` }
    ];

    return {
      structure: 'body', params: p, gauge: { stitchesPer10Cm: stsPer10, rowsPer10Cm: rowsPer10 },
      parts, schedule, instructions,
      metrics: { bustSts, waistSts, ribSts, underarmSts, shoulderSts, neckSts, totalBodyRows, bodyToArmhole, armholeRows, cuffSts, upperArmSts },
      footprintCm: { w: to1(chestCm / 2), h: to1(lengthCm + (sleeveCm > 0 ? 6 : 0)) }
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sock engine — cuff, leg, a true heel flap + wedge turn, gusset pick-up and
// decrease-back, a shaped foot and a tapered toe graft. Drives 'sock' garments
// (socks, baby booties).
// ─────────────────────────────────────────────────────────────────────────────

export class SockEngine {
  static DEFAULTS = { calf: 24, leg: 20, foot: 25, rib: 5 };

  /**
   * @param {object} params { calf, leg, foot, rib } in cm
   * @param {object} gauge  { stitchesPer10Cm, rowsPer10Cm }
   */
  compute(params = {}, gauge = {}) {
    const p = { ...SockEngine.DEFAULTS, ...params };
    const { stsPer10, rowsPer10, spc, rpc } = gaugeRates(gauge);

    const calfCm = clamp(finite(p.calf, 24), 10, 46);
    const legCm = clamp(finite(p.leg, 20), 3, 44);
    const footCm = clamp(finite(p.foot, 25), 6, 34);
    const ribCm = clamp(finite(p.rib, 5), 1, 10);

    // Sock tube sits at ~0.72 × calf at the ankle; the cast-on is snapped even and to a
    // multiple of 4 so the heel flap (half) and the toe (quarters) both divide cleanly.
    const sts = toMultiple(Math.max(24, stsFor(calfCm * 0.72, stsPer10)), 4);
    const heelSts = Math.max(8, round(sts / 2));
    const heelFlapRows = Math.max(6, round(heelSts / 2));
    const ribRowsN = rowsFor(ribCm, rowsPer10);
    const legRows = Math.max(4, rowsFor(legCm, rowsPer10));
    const footRows = Math.max(8, round(rowsFor(footCm, rowsPer10) * 0.62));
    const gussetPick = Math.max(4, round(heelFlapRows * 0.5));
    const toeSts = Math.max(8, round(sts / 3));
    const toeRounds = Math.max(4, round((sts - toeSts) / 4));

    // The heel turn is the only genuinely short-row part of a sock — reuse the shared
    // short-row scheduler so the wedge/turn count matches the rest of the app. A heel is
    // a centred wedge worked over roughly half the flap's depth.
    const heelTurnDepth = Math.max(1, round(heelSts / 4));
    const heelTurnCount = suggestTurnCount(heelSts / 2, heelSts);
    const heelTurn = shortRowSchedule({ method: 'heel', totalStitches: heelSts, extraRows: heelSts / 2, turnCount: heelTurnCount });
    const heelTurnRows = Math.max(2, heelTurn.rows.length);

    const cuffPiece = piece({
      id: 'cuff', name: 'Cuff & leg', castOn: sts,
      segments: [ribRows(ribRowsN, sts, 'rib2x2'), knitRows(legRows)],
      extra: { dimensions: { sts, ribRows: ribRowsN, legRows, legCm } }
    });
    const footPiece = piece({
      id: 'foot', name: 'Foot & toe', castOn: sts + gussetPick * 2,
      segments: [
        distributedDecreases(gussetPick * 2, Math.max(1, round(gussetPick * 1.2)), 'both'),
        knitRows(footRows),
        distributedDecreases(sts - toeSts, Math.max(1, toeRounds), 'four-lines')
      ],
      extra: { dimensions: { footRows, toeSts, toeRounds, gussetPick } }
    });

    const totalRows = ribRowsN + legRows + heelFlapRows + heelTurnRows + footPiece.totalRows;
    const parts = [
      { name: 'Sock', castOn: sts, rows: totalRows, circumferenceCm: to1(calfCm), heightCm: to1(legCm + footCm) }
    ];

    const footDec = describeSchedule(footPiece);
    const instructions = [
      { step: 1, title: 'Cuff', text: `Cast on ${sts} sts, join in the round; work ${ribCm} cm (${ribRowsN} rounds) of 2×2 rib, then knit the leg even for ${legCm} cm (${legRows} rounds).` },
      { step: 2, title: 'Heel flap', text: `Drop the final ${heelSts} sts and work them flat back and forth for ${heelFlapRows} rows (a ${heelSts}-st, ${to1(heelFlapRows * getRowToCm(rowsPer10))}-cm flap).` },
      { step: 3, title: 'Heel turn', text: `Turn the wedge with ${heelTurnCount} wrapped short rows: work to 1 st before the gap, wrap & turn, returning one stitch further each pass, until ${heelSts - 2 * heelTurnDepth} sts remain on the needle; pick up and unwrap each gap on the return pass.` },
      { step: 4, title: 'Gusset', text: `Knit across the heel, picking up ${gussetPick} sts along each flap edge (${sts + gussetPick * 2} on the needle). ${phraseEvents(footDec.filter(e => e.action === 'decrease').slice(0, 3))} to bring the count back to ${sts} sts.` },
      { step: 5, title: 'Foot', text: `Knit even until the foot measures ${to1(footCm * 0.6)} cm from the back of the heel (${footRows} rounds), ending with the toe.` },
      { step: 6, title: 'Wedge toe', text: `Decrease 4 sts (one at each of four corners) every other round for ${toeRounds} rounds until ${toeSts} remain; graft the toe with Kitchener's stitch for a seamless tip. Weave in ends.` }
    ];

    return {
      structure: 'sock', params: p, gauge: { stitchesPer10Cm: stsPer10, rowsPer10Cm: rowsPer10 },
      parts, schedule: [cuffPiece, footPiece], instructions,
      metrics: { sts, heelSts, heelFlapRows, gussetPick, footRows, toeSts, toeRounds, heelTurn },
      footprintCm: { w: to1(calfCm), h: to1(legCm + footCm) }
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mitten / hand engine — cuff rib, hand tube, a genuine round-by-round thumb
// gusset increase, an evenly-closed fingertip and the grafted thumb. Drives 'hand'
// garments (mittens, fingerless mitts).
// ─────────────────────────────────────────────────────────────────────────────

export class MittenEngine {
  static DEFAULTS = { hand: 22, length: 24, rib: 6 };

  /**
   * @param {object} params { hand, length, rib } in cm
   * @param {object} gauge  { stitchesPer10Cm, rowsPer10Cm }
   */
  compute(params = {}, gauge = {}) {
    const p = { ...MittenEngine.DEFAULTS, ...params };
    const { stsPer10, rowsPer10, spc, rpc } = gaugeRates(gauge);

    const handCm = clamp(finite(p.hand, 22), 14, 34);
    const lengthCm = clamp(finite(p.length, 24), 10, 34);
    const ribCm = clamp(finite(p.rib, 6), 2, 10);

    const sts = toMultiple(Math.max(32, stsFor(handCm, stsPer10)), 2);
    const ribRowsN = rowsFor(ribCm, rowsPer10);
    const handRows = Math.max(6, round(rowsFor(lengthCm, rowsPer10) * 0.5));
    // A thumb gusset grows a wedge of ~28% of the stitches out of the side over 4
    // increase rounds, held on waste yarn while the hand is knit to the tip.
    const thumbSts = toMultiple(Math.max(8, round(sts * 0.28)), 2);
    const gussetRounds = 4;
    const tipRounds = Math.max(4, round(sts / 8));
    const tipClose = sts;

    const gussetPiece = piece({
      id: 'gusset', name: 'Hand + thumb gusset', castOn: sts,
      segments: [
        ribRows(ribRowsN, sts, 'rib1x1'),
        knitRows(Math.max(1, round(handRows * 0.6))),
        distributedIncreases(thumbSts, gussetRounds, 'distributed'),
        knitRows(Math.max(1, round(handRows * 0.4)))
      ],
      extra: { dimensions: { sts, thumbSts, gussetRounds, handRows } }
    });
    const handPiece = piece({
      id: 'hand', name: 'Fingertip', castOn: sts + thumbSts,
      segments: [
        knitRows(1),
        distributedDecreases(tipClose, tipRounds * 2, 'both')
      ],
      extra: { dimensions: { tipRounds } }
    });
    const thumbPiece = piece({
      id: 'thumb', name: 'Thumb', castOn: thumbSts + 4,
      segments: [
        knitRows(Math.max(4, rowsFor(3.5, rowsPer10))),
        distributedDecreases(thumbSts + 4, Math.max(2, round(rowsFor(3.5, rowsPer10) / 2)), 'both')
      ],
      extra: { dimensions: { thumbSts } }
    });

    const rows = ribRowsN + handPiece.totalRows + tipRounds;
    const parts = [{ name: 'Mitten', castOn: sts, rows, circumferenceCm: to1(handCm), heightCm: to1(lengthCm) }];

    const gussetInc = describeSchedule(gussetPiece).filter(e => e.action === 'increase');
    const instructions = [
      { step: 1, title: 'Cuff', text: `Cast on ${sts} sts, join; work ${ribCm} cm (${ribRowsN} rounds) of rib.` },
      { step: 2, title: 'Hand', text: `Knit even until ${to1(lengthCm * 0.4)} cm from the cuff at the wrist.` },
      { step: 3, title: 'Thumb gusset', text: `${phraseEvents(gussetInc, 'stitch')} over ${gussetRounds} rounds to add a ${thumbSts}-st thumb wedge; place those ${thumbSts} sts on waste yarn and continue the hand with ${sts} sts.` },
      { step: 4, title: 'Fingertip', text: `Knit to ${to1(lengthCm * 0.9)} cm then ${phraseEvents(describeSchedule(handPiece).filter(e => e.action === 'decrease'))} to close the tip over ${tipRounds} rounds; break and thread the remaining sts.` },
      { step: 5, title: 'Thumb', text: `Return the ${thumbSts} held sts to the needle, pick up 4 around the gusset (${thumbSts + 4} sts), knit the thumb ${to1(3.5)} cm and taper it shut over ${Math.max(2, round(rowsFor(3.5, rowsPer10) / 2))} rounds.` }
    ];

    return {
      structure: 'hand', params: p, gauge: { stitchesPer10Cm: stsPer10, rowsPer10Cm: rowsPer10 },
      parts, schedule: [gussetPiece, handPiece, thumbPiece], instructions,
      metrics: { sts, thumbSts, gussetRounds, tipRounds, handRows, ribRows: ribRowsN },
      footprintCm: { w: to1(handCm), h: to1(lengthCm) }
    };
  }
}

/** Convert mm→cm with one decimal for the friendly part fields. */
function to1(v) { return round(finite(v, 0) * 10) / 10; }
/** mm-per-row from a per-10cm row rate, used to quote heel-flap depth in cm. */
function getRowToCm(rowsPer10) { return 10 / clamp(rowsPer10, 8, 200); }

/**
 * Route a catalogue garment to the right drafted engine, or return null when the
 * structure is handled elsewhere (hats→beanie, tank→CAD, tube/flat/triangle are already
 * exact in one step so they need no schedule).
 *
 * @param {object} garment a GARMENTS entry
 * @param {object} params  resolved catalogue params (cm)
 * @param {object} gauge   { stitchesPer10Cm, rowsPer10Cm }
 * @returns {?object} a drafted model, or null for non-drafted structures
 */
export function draftGarment(garment, params = {}, gauge = {}) {
  if (!garment) return null;
  try {
    switch (garment.structure) {
      case 'body': return new SweaterEngine().compute(params, gauge);
      case 'sock': return new SockEngine().compute(params, gauge);
      case 'hand': return new MittenEngine().compute(params, gauge);
      default: return null;
    }
  } catch (err) {
    // The engines are written never to throw; this is a belt-and-braces guard so a bad
    // catalogue param can never take down a whole compute() call in the UI.
    log.error(`the "${garment.structure}" drafting engine threw — this garment falls back to no drafted geometry`, { structure: garment.structure, error: err?.message });
    return null;
  }
}

export { toMultiple };
