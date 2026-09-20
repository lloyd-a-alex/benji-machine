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
 * information" layer: brand, real model numbers, era, a short true history, the
 * yarn weights and tension window the gauge wants, the actual carriage and
 * accessory names, what each bed can and cannot do, common failure modes and
 * mode-by-mode craft guidance. A machine profile that is missing here still
 * works — the advisors fall back to the pure physics in profiles.js — but the
 * prose thins out, so every profile KNITCAT ships is given a full dossier.
 *
 * The field contract (enforced by tests/machine-knowledge.test.mjs) is: every
 * real profile supplies
 *   aka[], brand, family, era, history, yarnWeights[], yarnGauge, tension,
 *   carriage, accessories[], strengths[], caveats[], commonFailures[],
 *   capabilities{}, notesForMode{ lace, fair_isle, slip, tuck }.
 * ─────────────────────────────────────────────────────────────────────────── */
export const MACHINE_KNOWLEDGE = {
  brother_standard_24: {
    aka: ['Brother KH-830', 'KH-840', 'KH-881', 'KH-890', 'KH-892', 'KH-894', 'Studio SK-155 (rebate)'],
    brand: 'Brother', family: 'Punchcard standard gauge', era: '1980s–90s domestic',
    history: 'Brother’s KH-830 family became the default home punchcard machine of the 1980s. Its 24-stitch card and drop-stitch mechanics are why so much vintage pattern literature assumes a Brother gauge — when in doubt, a period card was cut for this bed.',
    yarnWeights: ['fingering', 'sport', 'DK'], yarnGauge: '21–28 sts / 4in on 3.5–4.5mm needles',
    tension: 'The dial usually settles 4–7 for DK; tighten a number or two for lace passes that slip many needles, loosen if eyelets strain the yarn.',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: false, cables: false },
    carriage: 'Separate L (lace) and K (knit) carriages. The L-carriage transfers and drops but feeds NO yarn, so plain knit rows must be knitted back by the K-carriage.',
    accessories: ['KR-850 / KR-860 ribber (adds a true second bed)', 'KC / KG knit carriage set', 'LC5 / LC7 / LC8 lace carriage'],
    strengths: ['Enormous punchcard library', 'Directional transfers map cleanly to a single bed', 'Forgiving 4.5mm gauge for DK-weight stranded work'],
    caveats: ['7-row card-to-needle lag — the drum reads 7 rows below the live stitches', 'No true ribbing without a ribber attachment'],
    commonFailures: ['A stray unravelling row ratchets back several rows at once once the latches clear', 'Long stranded floats catch on the alternate-colour yarn-feeder and pucker the fabric'],
    notesForMode: {
      lace: 'Fashion lace wants ≥2 plain knit rows after each transfer pass to lock the eyelets before they grow.',
      fair_isle: 'Bridge up to ~9 needles; beyond that a stitch must be caught so the float cannot snag.',
      slip: 'Slipped (blank) runs carry the idle colour behind — keep the blanks short or the fabric laces tight.',
      tuck: 'Hold ≤6 loops before knitting them off; stacked bulk lifts the needle out of the cam channel.'
    }
  },
  silver_reed_standard_24: {
    aka: ['Silver Reed SK-280', 'SK-155', 'SK-840', 'Singer Memo-Matic', 'Studio MX'],
    brand: 'Silver Reed / Studio / Singer', family: 'Punchcard standard gauge', era: '1980s–90s domestic',
    history: 'The Silver Reed SK-280 — sold as a Studio and badged by Singer too — is arguably the most-knitted machine on earth. Near-identical 4.5mm geometry to Brother but with a combined lace carriage, which is why the cards mostly interchange while the transfers land a row earlier.',
    yarnWeights: ['fingering', 'sport', 'DK'], yarnGauge: '21–28 sts / 4in',
    tension: 'Dial 4–7 for DK; because the combined carriage feeds yarn as it transfers, it tolerates slightly looser tension than a Brother L-carriage pass.',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: false, cables: false },
    carriage: 'Combined LC carriage transfers AND feeds yarn in one pass — faster, but the eyelet opens a row earlier than a Brother would.',
    accessories: ['RSS-10 / RKR-900 ribber', 'LC-1 / LC-5 / LC-8 combined lace carriage', 'Punchcard linking strips'],
    strengths: ['Single-carriage lace is quicker', 'Same 4.5mm bed geometry as Brother, so cards mostly interchange'],
    caveats: ['5-row reading lag, not 7 — a Brother card is subtly mistimed on a Silver Reed', 'Lace carriage behaves differently, so transfer timing shifts'],
    commonFailures: ['Assuming Brother timings gives eyelets a row early — the openwork drifts off motif', 'Same long-float snag as the Brother bed at the identical 4.5mm pitch'],
    notesForMode: {
      lace: 'The LC knits through as it transfers, so fewer plain rows — but do not assume a Brother card transfers on the same row.',
      fair_isle: 'Same ~9-needle bridge as the Brother bed at this pitch.',
      slip: 'Keep blank runs short; the carried idle colour laces the fabric otherwise.',
      tuck: '≤6 held loops, then knit them off before bulk builds.'
    }
  },
  passap_duo_40: {
    aka: ['Passap Duo 80', 'Passap E6000', 'Passap Basic', 'Passap W66'],
    brand: 'Passap', family: 'Punchcard / electronic, double bed', era: '1970s–90s European',
    history: 'Passap built the Duo 80 / E6000 in Switzerland around a pusher-and-two-bed philosophy that predates most Japanese machines. Its twin carriages and lock-stitch system are why ribbers and fisherman’s rib are first-class citizens here rather than an afterthought.',
    yarnWeights: ['fingering', 'sport', 'DK', 'worsted'], yarnGauge: '18–24 sts / 4in on 5mm',
    tension: 'Passap sets tension with the yarn-tension unit and the N/GX carriage locks rather than one dial; start loose and tighten until the pushers register cleanly.',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: true, cables: false },
    carriage: 'Twin carriages (main + aux) with pushers and the N/GX lock system. Transfers move loops BETWEEN the two opposed beds, not along one row.',
    accessories: ['Flexmatic (rib / fisherman’s-rib attachment)', 'W66 / Standard twin carriage set', 'Main + auxiliary (colour) carriage pair'],
    strengths: ['True ribbing and fisherman’s rib from the second bed', '40-stitch repeat is the widest punchcard here'],
    caveats: ['A single-bed transfer schedule is NOT this machine’s timing — treat lace output as a stranded drill', '5mm pitch: the same stitch count is a longer loose strand, so the float cap is tighter'],
    commonFailures: ['Pushers out of step read the card one row off — the classic Passap “everything shifted” bug', 'Cross-bed transfers need both beds in register; a single-bed schedule hides that dependency'],
    notesForMode: {
      lace: 'Cross-bed transfers need their own pass plan; the single-bed model is only an approximation.',
      fair_isle: 'Cap floats at ~7 — the wider pitch means more slack per skipped needle.',
      slip: 'Short blanks; the second bed gives more escape routes for carried yarn.',
      tuck: '≤6 held loops per needle, and watch rib-tuck bulk across both beds.'
    }
  },
  brother_bulky_24: {
    aka: ['Brother KH-260', 'KH-270', 'Brother Chunky'],
    brand: 'Brother', family: 'Punchcard bulky gauge', era: '1990s domestic',
    history: 'Brother’s chunky punchcard line (KH-260 / KH-270) is the fast, unfussy big-needle sibling of the standard gauge — the machine knitters reach for a weekend blanket and reach for it again, because thick yarn hides a lot of sins.',
    yarnWeights: ['aran', 'bulky', 'chunky'], yarnGauge: '12–16 sts / 4in on 6–8mm',
    tension: 'Wide needles want the higher half of the dial; fat yarn forgives tension errors but absolutely not long floats.',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: false, cables: false },
    carriage: 'Chunky Brother: bulky L/K carriages, single bed, wide 9mm needle spacing.',
    accessories: ['KH-270 bulky lace carriage', 'Bulky-gauge punchcard blanks'],
    strengths: ['Fast, thick fabric', 'Very forgiving for openwork shawls and colorwork that must read big'],
    caveats: ['9mm pitch means a float of 5 needles is as much loose yarn as 9 on a fine bed', 'Short 24-column card, chunky repeat'],
    commonFailures: ['A single long carried float on a 9mm bed is 5 real centimetres of snag-able yarn', 'Tuck bulk lifts fat needles out of the cam faster than fine ones'],
    notesForMode: {
      lace: 'Eyelets are large and dramatic; still needs plain rows to lock them before they run.',
      fair_isle: 'Hard cap of ~5 carried needles before puckering — the pitch, not the pattern.',
      slip: 'Keep blanks to a few stitches; each slipped needle is a lot of loose yarn.',
      tuck: 'Only ≤4 held loops — chunky bulk lifts off fast.'
    }
  },
  toyota_standard_24: {
    aka: ['Toyota KS-901', 'KS-950', 'KS-930', 'Toyota Simplex'],
    brand: 'Toyota', family: 'Punchcard standard gauge (Simplex)', era: '1970s–80s',
    history: 'Toyota’s Simplex line (KS-901 / KS-950) is the rarest of the standard-gauge punchcards — beautifully built, mechanically distinctive, and thinly documented. KNITCAT therefore holds it to conservative float assumptions rather than guess at a carriage few people still have.',
    yarnWeights: ['fingering', 'sport', 'DK'], yarnGauge: '20–28 sts / 4in',
    tension: 'Treat the ~7-needle float cap as a safe floor until you have proven a longer bridge on your own carriage.',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: false, cables: false },
    carriage: 'Simplex transfer system; single bed. Rarer carriages, so reference punches matter more.',
    accessories: ['Toyota Simplex transfer carriage', 'KS-series punchcard reader'],
    strengths: ['Robust mechanical build', 'Standard 4.5mm gauge plays well with DK'],
    caveats: ['Scarce documentation; the ~7-needle float assumption is the safe floor', 'Few ready cards — expect to convert'],
    commonFailures: ['Converting a Brother card silently mistimes the Simplex transfer — verify one repeat by hand first'],
    notesForMode: {
      lace: 'Model like a Brother single bed; verify the transfer direction against your carriage before committing.',
      fair_isle: 'Cap floats ~7 — the conservative number for an undocumented bed.',
      slip: 'Short blanks until you trust the carriage.',
      tuck: '≤6 held loops, then knit them off — the Simplex cam will not hold more bulk.'
    }
  },
  brother_maxi_60: {
    aka: ['Brother KH-940', 'KH-950', 'KH-950i', 'KH-960', 'KH-970', 'Brother Maxi'],
    brand: 'Brother', family: 'Punchcard mid gauge (60-needle)', era: '1980s–90s domestic',
    history: 'Brother’s 5mm “Maxi” beds (KH-940 through KH-970) were the roomier option for knitters who found a 24-stitch repeat claustrophobic — the same drop-stitch punchcard logic as the standard family, just a canvas two-and-a-half times wider so a big motif fits without tiling.',
    yarnWeights: ['sport', 'DK', 'worsted'], yarnGauge: '18–24 sts / 4in on 4.5–5mm',
    tension: 'Dial around 5–7 for DK-to-worsted; the 5mm pitch wants a touch more slack than the 4.5mm bed for the same yarn.',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: false, cables: false },
    carriage: 'A wider 60-needle bed on the same separated lace/knit philosophy — a 5mm punchcard strip with far more motif room than a 24-stitch card.',
    accessories: ['Maxi 60-needle punchcard strips', 'Brother 5mm-gauge lace/knit carriage set'],
    strengths: ['60-column repeat: big motifs fit without tiling', '5mm mid gauge takes sport through light worsted', 'Drop-stitch punchcard mechanics identical to the rest of the Brother family'],
    caveats: ['Wider card, so a single long float spans more real yarn — cap floats a touch tighter than the 4.5mm bed', 'Fewer ready-made 60-stitch cards than 24-stitch; expect to widen or tile'],
    commonFailures: ['Designing at 24 stitches then loading onto 60 leaves the repeat off-centre — plan the full width from the start'],
    notesForMode: {
      lace: 'Same Brother single-bed transfer logic; the extra width just gives the eyelets more room to breathe.',
      fair_isle: 'Bridge ~7 needles, not 9 — 5mm pitch means more slack per skipped needle.',
      slip: 'Long card means long blank runs are tempting; keep them short or the fabric laces.',
      tuck: '≤6 held loops, same bulk ceiling as the standard bed.'
    }
  },
  custom_parametric: {
    aka: ['DIY / CNC / experimental', 'AYAB', 'laser-cut blanks'],
    brand: 'Custom', family: 'Parametric', era: 'n/a',
    history: 'KNITCAT’s parametric profile stands in for CNC and laser cutters, AYAB-style Arduino machines and any experimental bed. You supply the physics; the advisor reasons about the numbers you give it and nothing more — which is exactly the point.',
    yarnWeights: ['any'], yarnGauge: 'whatever you set the pitch to',
    tension: 'Undefined until you set the pitch and carriage rules; the advisor treats your numbers as ground truth.',
    capabilities: { lace: true, fair_isle: true, slip: true, tuck: true, intarsia: true, ribbing: true, cables: true },
    carriage: 'You are the carriage. Limits are whatever you dial into the profile.',
    accessories: ['Your own tooling — set the pitch, carriage rules and bed count and the rest follows'],
    strengths: ['Reach 600 rows and any pitch', 'Great for laser/CNC punch blanks and AYAB-style builds'],
    caveats: ['Garbage in, jam out: the advisor can only reason about the numbers you give it'],
    commonFailures: ['An over-optimistic float or tuck cap here produces a card the real machine rejects'],
    notesForMode: {
      lace: 'Assumes a single bed unless you add a ribber and set beds: 2.',
      fair_isle: 'Float cap is entirely your choice — be honest with it.',
      slip: 'Your choice; the physics follows the pitch you set.',
      tuck: 'Your choice of held-loop ceiling.'
    }
  }
};

/** A tiny default so an unknown profile id still yields a shape-complete object
 *  (the UI can read every field without guard-checking), just with sparse prose. */
const GENERIC = {
  aka: [], brand: 'Unknown', family: 'Generic', era: '', history: '',
  yarnWeights: [], yarnGauge: '', tension: '',
  capabilities: { lace: true, fair_isle: true, slip: true, tuck: true },
  carriage: 'Carriage behaviour not described for this profile; falling back to the physical limits only.',
  accessories: [], strengths: [], caveats: [], commonFailures: [], notesForMode: {}
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
