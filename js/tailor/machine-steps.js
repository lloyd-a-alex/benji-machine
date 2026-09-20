/**
 * KNITCAT — machine-specific fashioning steps (browser-free).
 *
 * The generic planner in clothes-catalog.js writes friendly prose ("knit even, then
 * shape the neck"). A real KH-830 operator needs needle numbers: which needles are
 * in work, how many to bind off each side, where the transfer tool goes, and short-
 * row / crown counts that respect the bed. This module turns a computed plan into
 * that precise, needle-position fashioning schedule — the capability the tank-top
 * CAD had and every other garment was missing.
 *
 * @module tailor/machine-steps
 */

import { profileLimits } from '../machine/profiles.js';

const round = Math.round;
const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Format a centred needle span so L/R read the way a bed is actually numbered. */
function needleSpan(count) {
  const n = Math.max(1, round(count));
  const half = round(n / 2);
  return `Needles L${half}–R${n - half} (${n} needles, centred on 0)`;
}

/**
 * Build the KH-830-accurate fashioning schedule for a plan.
 *
 * @param {object} plan   a ClothesEngine.compute() plan (uses garment.structure,
 *                        parts[0].castOn/rows, params, gauge)
 * @param {object} [profile] machine profile (defaults to a standard 4.5mm bed)
 * @returns {Array<{step:number,title:string,text:string}>}
 */
export function buildFashioning(plan, profile) {
  if (!plan || !plan.parts || !plan.parts.length) return [];
  const limits = profileLimits(profile || {});
  const part = plan.parts[0];
  const sts = Math.max(1, round(finite(part.castOn, 1)));
  const rows = Math.max(1, round(finite(part.rows, 1)));
  const structure = plan.garment?.structure || 'tube';
  const gauge = plan.gauge || {};
  const pitch = finite(profile?.pitchX, 4.5);
  const widthMm = sts * pitch;

  const steps = [];
  const push = (title, text) => steps.push({ step: steps.length + 1, title, text });

  push('Set up the bed',
    `Center the work on needle 0. This piece is ${sts} sts wide (≈ ${widthMm.toFixed(0)} mm at ${pitch} mm pitch) — ${sts > limits.maxNeedles ? `WIDER than the ${limits.maxNeedles}-needle bed; split across panels or reduce cast-on.` : `within the ${limits.maxNeedles}-needle bed`}.`);

  push('Cast on',
    `E-wrap / tubular cast on ${sts} sts — ${needleSpan(sts)}. Tension 3–4 for the edge, then main tension for the body. Row counter 000.`);

  switch (structure) {
    case 'hat': {
      const segs = Math.max(4, round(finite(plan.params?.segments, 6)));
      const per = Math.max(1, round(sts / segs));
      push('Crown setup', `Knit even to ${rows} rows, then place ${segs} markers ${per} sts apart.`);
      push('Crown decreases', `Every other round, work a 2-stitch-together ${segs} times per round (once before each marker) — decrease ${segs} sts per shaping round with a ${segs > 6 ? '3-prong' : '2-prong'} transfer tool for tidy lines. Repeat until ${segs} sts remain.`);
      push('Cinch', `Break yarn, thread the final ${segs} needles and cinch the crown shut; the tail hides inside a pom-pom if used.`);
      break;
    }
    case 'body':
    case 'tank': {
      const armDec = Math.max(1, round(sts * 0.06));
      push('Underarm bind-off', `At the armhole, cast off ${armDec} sts at each end of the next 2 rows (Needles R${round(sts / 2)} down to R${round(sts / 2) - armDec}, then the mirror on the L).`);
      push('Armhole shaping', `Using a 2-prong transfer tool for a fully-fashioned edge: decrease 1 stitch at each side every 2 rows, ${armDec} times.`);
      push('Neck split', `Put the centre ${Math.max(2, round(sts * 0.3))} needles on hold; work each shoulder / strap up ${Math.round(rows * 0.2)} rows, then bind off.`);
      break;
    }
    case 'sock': {
      const heelSts = Math.max(4, round(sts / 2));
      push('Heel flap', `Drop ${heelSts} sts onto hold needles and work them flat back-and-forth for ${round(heelSts / 2)} rows.`);
      push('Heel turn (short rows)', `Turn the wedge with wrapped short rows: decrease 1 at each gap end every row until ${round(heelSts / 2)} sts remain; unwrap on the pass.`);
      push('Gusset & toe', `Pick up ${round(heelSts * 0.4)} sts each side of the flap, decrease the gusset back to ${sts} sts, then decrease 4 sts every other round to ${Math.max(8, round(sts / 3))} and Kitchener the toe.`);
      break;
    }
    case 'hand': {
      const thumb = Math.max(2, round(sts * 0.14));
      push('Thumb gusset', `At the thumb base increase ${thumb} sts over 4 rounds; hold them on a waste yarn / holder on ${needleSpan(thumb).split('(')[0].trim()}.`);
      push('Fingertip', `Knit to the tip, then decrease ${Math.max(2, round(sts / 8))} sts per round closing evenly.`);
      break;
    }
    case 'triangle': {
      push('Growth', `Increase 6 sts every right-side row (yarn-overs at both edges and either side of the centre spine) up to ${sts} sts.`);
      break;
    }
    default:
      push('Body', `Knit even in the round for ${rows} rounds.`);
  }

  push('Bind off', `Bind off in pattern on a ${structure === 'tube' || structure === 'hat' ? 'stretchy (sewn / tubular)' : 'standard'} edge. Block to the finished measurements.`);

  return steps;
}
