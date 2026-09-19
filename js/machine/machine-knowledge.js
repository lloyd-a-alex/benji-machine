/**
 * KNITCAT — Machine Knowledge Base.
 *
 * A deliberately over-stuffed, browser-free reference that the feasibility
 * advisor and the machine-universe analyzer both read from. The point of keeping
 * it in one module is that the *prose*, the *physical reasoning* and the *design
 * philosophy* all come from a single place, so the app can never tell one user
 * "this gauge loves long floats" and another the opposite.
 *
 * Nothing in here touches `document` or `window`. It is data plus pure functions,
 * which is what lets the advisor be exercised head-to-head under `node --test`.
 */

import { profileLimits } from './profiles.js';

/* ─────────────────────────────────────────────────────────────────────────────
 * Design & engineering philosophies.
 *
 * Every advisory the advisor raises is pinned to one of these so a recommendation
 * is never a bare assertion — you can always see the principle it is an instance
 * of. They span knitting craft, ergonomics, systems thinking and classical
 * engineering because a knitting machine is all four at once.
 * ─────────────────────────────────────────────────────────────────────────── */
export const PHILOSOPHIES = {
  parsimony: ['Occam’s Razor', 'The simplest card that still knits the fabric you want is the best card — every extra hole is another thing that can snag.'],
  fewerThings: ['Occam’s Razor, applied twice', 'Prune the pattern, not just the errors: fewer distinct operations read as intentional and jam less.'],
  pareto: ['The Pareto Principle', 'A handful of trouble spots cause most of the dropped stitches; fix the worst runs first and the whole fabric relaxes.'],
  postel: ['Postel’s Law', 'Never send more to the machine than the channel can be trusted to carry — be conservative on the wire.'],
  peakEnd: ['The Peak-End Rule', 'A clean edge and a caught float are what people remember about a fabric; the middle is forgiven.'],
  pragnanz: ['The Law of Prägnanz', 'A repeat that resolves simply and closes on itself reads as designed rather than accidental.'],
  mapTerritory: ['The map is not the territory', 'A schedule built for one needle bed does not describe a two-bed machine; do not confuse the model for the mechanism.'],
  solidWorst: ['Design for the worst case', 'A card that is safe on the tightest gauge and narrowest bed is safe everywhere; optimise for the floor, not the ceiling.'],
  tolerance: ['Tolerance stacking', 'Several limits each a hair away from their ceiling compound into a jam; margin on one axis buys you slack on another.'],
  feedback: ['Negative feedback beats brute force', 'A caught float that self-arrests (a knit stitch through it) is more robust than trusting the operator to notice.'],
  eliminateSPOF: ['Eliminate single points of failure', 'Give the yarn somewhere to go; a strand with no escape route becomes the snag that stops the carriage.'],
  swissCheese: ['The Swiss Cheese Model', 'One slipped stitch is survivable; several thin defences lining up is a dropped-stitch column. Redundancy across rows protects the fabric.'],
  hickey: ['The Hickey Law (debugging)', 'The obvious culprit (the long float you can see) is rarely the real one — the near-miss run beside it is what actually pops off.'],
  normalcy: ['The Normalcy Bias', 'A card that looks fine at a glance is exactly where the machine disagrees with you; measure, do not eyeball.'],
  margin: ['Make the margins do the work', 'Selvedge and plain rows cost nothing and save everything: they absorb tension the body of the pattern cannot.'],
  affordance: ['Perceived affordance', 'If a fix is one obvious click, it gets done; if it needs a manual, it doesn’t. Offer the mechanical fixes as buttons.'],
  progressive: ['Progressive disclosure', 'Lead with the one number that matters (a health score), then let the curious drill into every parameter.'],
  yagni: ['YAGNI', 'Do not design a 40-stitch eyelet into a 24-stitch repeat the carriage will never reach.'],
  fitts: ["Fitts’s Law", 'The worst float is the one far from where you are working; surface problems near the needles they affect.'],
  goodhart: ["Goodhart’s Law", 'A single score is a guide, not a target — never chase the number past the point where the fabric actually knits.'],
  reversibility: ['Design for reversibility', 'Prefer changes a knitter can undo: a weft float can be caught, a cut column cannot be uncut.'],
  leastAstonishment: ['Principle of Least Astonishment', 'The machine should fail the way the maker expects — flag the mismatch (double bed, over-wide) before it knits a surprise.'],
  gauge: ['Knit to gauge, not to hope', 'Gauge is the physical contract between yarn and needle; every count in the advisor is downstream of pitch.'],
  tensionWindow: ['The Goldilocks tension window', 'Too tight lace-laces the fabric, too loose droops; both floats and tucks are really asking whether tension sits inside the window.'],
  colorwork: ['Stranded colourwork is a budget', 'You are spending carried yarn on every stitch not knits; the float cap is the exchange rate.'],
  structure: ['Fabric needs structure to grip', 'A near-fully-punched card gives the carriage nothing blank to register against; negative space is load-bearing.'],
  history: ['Stand on the punchcard', 'These limits were learned the expensive way on 1980s domestic machines; the profiles encode that folklore so you don’t relive it.']
};

/** Convenience for callers that only want the one-line motto. */
export function phil(key) {
  const p = PHILOSOPHIES[key];
  return p ? `${p[0]} — ${p[1]}` : '';
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Techniques KNITCAT can model, and which machines can actually do them.
 * ─────────────────────────────────────────────────────────────────────────── */
export const TECHNIQUES = ['lace', 'fair_isle', 'slip', 'tuck', 'intarsia', 'ribbing', 'cables'];

/* ─────────────────────────────────────────────────────────────────────────────
 * Per-machine knowledge, keyed by profile id. This is the "take ALL the
 * information" layer: brand, real model numbers, era, yarn weights the gauge
 * wants, what each carriage family is and is not, and mode-by-mode guidance.
 * A machine profile that is missing here still works — the advisors fall back to
 * the pure physics in profiles.js — but the prose thins out.
 * ─────────────────────────────────────────────────────────────────────────── */
export const MACHINE_KNOWLEDGE = {
  brother_standard_24: {
    aka: ['Brother KH-830', 'KH-840', 'KH-881', 'KH-890', 'KH-892', 'KH-894', 'Studio SK-155 (rebate)'],
    brand: 'Brother', family: 'Punchcard standard gauge', era: '1980s–90s domestic',
    yarnWeights: ['fingering', 'sport', 'DK'], yarnGauge: '21–28 sts / 4in on 3.5–4.5mm needles',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: false, cables: false },
    carriage: 'Separate L (lace) and K (knit) carriages. The L-carriage transfers and drops but feeds NO yarn, so plain knit rows must be knitted back by the K-carriage.',
    strengths: ['Enormous punchcard library', 'Directional transfers map cleanly to a single bed', 'Forgiving 4.5mm gauge for DK-weight stranded work'],
    caveats: ['7-row card-to-needle lag — the drum reads 7 rows below the live stitches', 'No true ribbing without a ribber attachment'],
    notesForMode: {
      lace: 'Fashion lace wants ≥2 plain knit rows after each transfer pass to lock eyelets.',
      fair_isle: 'Bridge up to ~9 needles; beyond that a stitch must be caught.',
      slip: 'Slipped (blank) runs carry the idle colour — keep the blanks short.',
      tuck: 'Hold ≤6 loops before knitting them off; bulk lifts the needle out of the cam.'
    }
  },
  silver_reed_standard_24: {
    aka: ['Silver Reed SK-280', 'SK-155', 'SK-840', 'Singer Memo-Matic', 'Studio MX'],
    brand: 'Silver Reed / Studio / Singer', family: 'Punchcard standard gauge', era: '1980s–90s domestic',
    yarnWeights: ['fingering', 'sport', 'DK'], yarnGauge: '21–28 sts / 4in',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: false, cables: false },
    carriage: 'Combined LC carriage transfers AND feeds yarn in one pass — faster, but the eyelet opens a row earlier than a Brother would.',
    strengths: ['Single-carriage lace is quicker', 'Same 4.5mm bed geometry as Brother, so cards mostly interchange'],
    caveats: ['5-row reading lag, not 7 — a Brother card is subtly mistimed on a Silver Reed', 'Lace carriage behaves differently, so transfer timing shifts'],
    notesForMode: {
      lace: 'The LC-knits-through means fewer plain rows, but do not assume a Brother card transfers on the same row.',
      fair_isle: 'Same ~9-needle bridge as the Brother bed.', slip: 'Short blank runs.', tuck: '≤6 held loops.'
    }
  },
  passap_duo_40: {
    aka: ['Passap Duo 80', 'Passap E6000', 'Passap Basic'],
    brand: 'Passap', family: 'Punchcard / electronic, double bed', era: '1970s–90s European',
    yarnWeights: ['fingering', 'sport', 'DK', 'worsted'], yarnGauge: '18–24 sts / 4in on 5mm',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: true, cables: false },
    carriage: 'Twin carriages (main + aux) with pushers and the N/GX lock system. Transfers move loops BETWEEN the two opposed beds, not along one row.',
    strengths: ['True ribbing and fisherman’s rib from the second bed', '40-stitch repeat is the widest punchcard here'],
    caveats: ['A single-bed transfer schedule is NOT this machine’s timing — treat lace output as a stranded drill', '5mm pitch: the same stitch count is a longer loose strand, so the float cap is tighter'],
    notesForMode: {
      lace: 'Cross-bed transfers need their own pass plan; the single-bed model is only an approximation.',
      fair_isle: 'Cap floats at ~7 — the wider pitch means more slack per skipped needle.',
      slip: 'Short blanks.', tuck: '≤6 held loops per needle.'
    }
  },
  brother_bulky_24: {
    aka: ['Brother KH-260', 'KH-270'],
    brand: 'Brother', family: 'Punchcard bulky gauge', era: '1990s domestic',
    yarnWeights: ['aran', 'bulky', 'chunky'], yarnGauge: '12–16 sts / 4in on 6–8mm',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: false, cables: false },
    carriage: 'Chunky Brother: bulky L/K carriages, single bed, wide 9mm needle spacing.',
    strengths: ['Fast, thick fabric', 'Very forgiving for openwork shawls'],
    caveats: ['9mm pitch means a float of 5 needles is as much loose yarn as 9 on a fine bed', 'Short 24-column card, chunky repeat'],
    notesForMode: {
      lace: 'Eyelets are large and dramatic; still needs plain rows to lock them.',
      fair_isle: 'Hard cap of ~5 carried needles before puckering.',
      slip: 'Keep blanks to a few stitches.', tuck: 'Only ≤4 held loops — chunky bulk lifts off fast.'
    }
  },
  toyota_standard_24: {
    aka: ['Toyota KS-901', 'KS-950', 'KS-930'],
    brand: 'Toyota', family: 'Punchcard standard gauge (Simplex)', era: '1970s–80s',
    yarnWeights: ['fingering', 'sport', 'DK'], yarnGauge: '20–28 sts / 4in',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: false, cables: false },
    carriage: 'Simplex transfer system; single bed. Rarer carriages, so reference punches matter more.',
    strengths: ['Robust mechanical build', 'Standard 4.5mm gauge plays well with DK'],
    caveats: ['Scarce documentation; the ~7-needle float assumption is the safe floor', 'Few ready cards — expect to convert'],
    notesForMode: {
      lace: 'Model like a Brother single bed; verify the transfer direction against your carriage.',
      fair_isle: 'Cap floats ~7.', slip: 'Short blanks.', tuck: '≤6 held loops.'
    }
  },
  custom_parametric: {
    aka: ['DIY / CNC / experimental'],
    brand: 'Custom', family: 'Parametric', era: 'n/a',
    yarnWeights: ['any'], yarnGauge: 'whatever you set the pitch to',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: true, cables: true },
    carriage: 'You are the carriage. Limits are whatever you dial into the profile.',
    strengths: ['Reach 600 rows and any pitch', 'Great for laser/CNC punch blanks and AYAB-style builds'],
    caveats: ['Garbage in, jam out: the advisor can only reason about the numbers you give it'],
    notesForMode: {
      lace: 'Assumes a single bed unless you add a ribber.', fair_isle: 'Float cap is your choice.', slip: 'Your choice.', tuck: 'Your choice.'
    }
  }
};

/** A tiny default so an unknown profile id still yields usable (if sparser) prose. */
const GENERIC = {
  aka: [], brand: 'Unknown', family: 'Generic', era: '',
  yarnWeights: [], yarnGauge: '', capabilities: { lace: true, fair_isle: true, slip: true, tuck: true },
  carriage: 'Carriage behaviour not described for this profile; falling back to the physical limits only.',
  strengths: [], caveats: [], notesForMode: {}
};

export function knowledgeFor(profile) {
  if (!profile) return GENERIC;
  return MACHINE_KNOWLEDGE[profile.id] || GENERIC;
}

export function capabilitiesFor(profile) {
  return Object.assign({}, GENERIC.capabilities, knowledgeFor(profile).capabilities || {});
}

export function techniqueSupported(profile, mode) {
  const caps = capabilitiesFor(profile);
  if (Object.prototype.hasOwnProperty.call(caps, mode)) return caps[mode];
  return true; // modes KNITCAT models are, by default, supported
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Scoring — one place so the advisor, the health panel and the universe matrix
 * all agree on what "87% feasible" means.
 *
 * Severity weights are deliberately asymmetric: a single hard error should sink a
 * card further than a pile of soft warnings, and info is free (it never gates a
 * knit, it just informs the maker).
 * ─────────────────────────────────────────────────────────────────────────── */
export const SEVERITY_WEIGHT = { error: 24, warn: 9, info: 0, ok: 0 };

/**
 * @param {Array<{sev:string}>} issues
 * @returns {number} a 0–100 design-health score
 */
export function scoreIssues(issues) {
  let score = 100;
  for (const it of issues || []) {
    score -= SEVERITY_WEIGHT[it.sev] || 0;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function riskLabel(score) {
  if (score >= 90) return { key: 'excellent', label: 'Excellent', blurb: 'knits clean with no babysitting' };
  if (score >= 75) return { key: 'good', label: 'Good', blurb: 'minor watch-outs, safe to cast on' };
  if (score >= 55) return { key: 'fair', label: 'Fair', blurb: 'needs attention before the machine' };
  if (score >= 30) return { key: 'risky', label: 'Risky', blurb: 'expect snags or dropped stitches' };
  return { key: 'poor', label: 'Poor', blurb: 'will fight you — fix the blockers first' };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Cross-machine arithmetic — the "make it work everywhere" maths.
 * ─────────────────────────────────────────────────────────────────────────── */

/** The strictest (smallest) value of a per-profile limit across a set. */
function strictest(profiles, pick) {
  let best = Infinity;
  for (const p of profiles) { const v = pick(p); if (Number.isFinite(v)) best = Math.min(best, v); }
  return best === Infinity ? undefined : best;
}

/** The widest (largest) value across a set. */
function loosest(profiles, pick) {
  let best = -Infinity;
  for (const p of profiles) { const v = pick(p); if (Number.isFinite(v)) best = Math.max(best, v); }
  return best === -Infinity ? undefined : best;
}

/**
 * The most conservative envelope a card must fit to knit on EVERY profile in the
 * set — shortest float bridge, narrowest bed, shortest card. This is the target
 * the "make it work on any machine" tuner aims for.
 */
export function universalEnvelope(profiles) {
  const list = (profiles || []).filter(Boolean);
  return {
    maxFloatNeedles: strictest(list, p => profileLimits(p).maxFloatNeedles),
    maxTuckLoops: strictest(list, p => profileLimits(p).maxTuckLoops),
    maxNeedles: strictest(list, p => profileLimits(p).maxNeedles),
    maxRows: strictest(list, p => profileLimits(p).maxRows),
    minRows: loosest(list, p => profileLimits(p).minRows),
    beds: 1 // single-bed is the common denominator; double-bed transfers are not portable
  };
}

/** Every technique the whole set can do at once. */
export function commonCapabilities(profiles) {
  const list = (profiles || []).filter(Boolean);
  const out = {};
  for (const t of TECHNIQUES) {
    out[t] = list.every(p => techniqueSupported(p, t));
  }
  return out;
}
