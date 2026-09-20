/**
 * KNITCAT V2 — the construction template registry.
 *
 * Maps a construction id (the KnitScript `garment:` kind and the 12 `Construction` names in
 * the spec) to its generator function, and exposes one entry point,
 * {@link draftGarment}, that every other system calls to get pattern pieces. This is the
 * seam between "what garment do you want" and "here is the row-by-row draft".
 *
 * Aliases let a KnitScript say `garment: raglanSweater { construction: bottomUp }` or just
 * `garment: bottom-up-raglan` and land on the same generator. DOM-free.
 *
 * @module fit/templates
 */

import { bottomUpRaglan, topDownRaglan, modifiedRaglan, saddleShoulder } from './raglan.js';
import { bottomUpSetIn, topDownSetIn } from './set-in.js';
import { circularYoke, dropShoulder } from './yoke.js';
import { dolman, kimono, sideToSide, seamlessHybrid } from './flat.js';
import { EaseProfile } from '../ease.js';

/** The 12 canonical constructions (spec §2.3). */
export const CONSTRUCTIONS = Object.freeze([
  'bottom-up-raglan', 'top-down-raglan', 'bottom-up-set-in', 'top-down-set-in',
  'drop-shoulder', 'circular-yoke', 'dolman', 'kimono',
  'seamless-hybrid', 'side-to-side', 'modified-raglan', 'saddle-shoulder'
]);

/** construction id -> generator. */
export const TEMPLATE_BY_CONSTRUCTION = Object.freeze({
  'bottom-up-raglan': bottomUpRaglan,
  'top-down-raglan': topDownRaglan,
  'modified-raglan': modifiedRaglan,
  'saddle-shoulder': saddleShoulder,
  'bottom-up-set-in': bottomUpSetIn,
  'top-down-set-in': topDownSetIn,
  'drop-shoulder': dropShoulder,
  'circular-yoke': circularYoke,
  dolman,
  kimono,
  'side-to-side': sideToSide,
  'seamless-hybrid': seamlessHybrid
});

/** Human-facing metadata for the construction picker UI (spec §2.9). */
export const TEMPLATE_INFO = Object.freeze({
  'bottom-up-raglan': { name: 'Bottom-Up Raglan', difficulty: 2, blurb: 'Body and sleeves knit to the armhole, joined, four raglan lines to the neck.' },
  'top-down-raglan': { name: 'Top-Down Raglan', difficulty: 2, blurb: 'Start at the neck, increase along four lines, divide, work down. Try-on fitting.' },
  'bottom-up-set-in': { name: 'Bottom-Up Set-In', difficulty: 4, blurb: 'Tailored armhole and shaped sleeve cap, sewn in.' },
  'top-down-set-in': { name: 'Top-Down Set-In', difficulty: 4, blurb: 'Pick up around the armhole, short-row the cap, work down.' },
  'drop-shoulder': { name: 'Drop Shoulder', difficulty: 1, blurb: 'Boxy and forgiving — straight sleeves, no cap shaping.' },
  'circular-yoke': { name: 'Circular Yoke', difficulty: 3, blurb: 'Nordic colourwork yoke worked in the round, no shoulder seams.' },
  dolman: { name: 'Dolman', difficulty: 3, blurb: 'One piece, deep angled armline, no armhole seam.' },
  kimono: { name: 'Kimono', difficulty: 1, blurb: 'A flat T of rectangles — the simplest construction there is.' },
  'seamless-hybrid': { name: 'Seamless Hybrid', difficulty: 3, blurb: 'Bottom-up body, top-down sleeves, joined with no seaming.' },
  'side-to-side': { name: 'Side-to-Side', difficulty: 4, blurb: 'Knit across the body; short rows square the shoulders.' },
  'modified-raglan': { name: 'Modified Raglan', difficulty: 3, blurb: 'A shoulder saddle gives a set-in look with raglan ease.' },
  'saddle-shoulder': { name: 'Saddle Shoulder', difficulty: 3, blurb: 'A knit strap across the shoulder; sleeve picked up from it.' }
});

/** kind/construction aliases from KnitScript garment names. */
const ALIASES = {
  raglansweater: 'bottom-up-raglan', raglan: 'bottom-up-raglan', sweater: 'bottom-up-raglan',
  pullover: 'bottom-up-raglan', jumper: 'bottom-up-raglan',
  yokesweater: 'circular-yoke', lopi: 'circular-yoke', fairisleyoke: 'circular-yoke',
  setin: 'bottom-up-set-in', 'set-insleeve': 'bottom-up-set-in', cardigan: 'bottom-up-set-in',
  boxy: 'drop-shoulder', 'dropshouldersweater': 'drop-shoulder',
  'topdownraglan': 'top-down-raglan', 'bottomupraglan': 'bottom-up-raglan',
  butterfly: 'dolman', 'kimono-cardigan': 'kimono'
};

/**
 * Resolve any construction spelling (canonical id, alias, camelCase kind, or with direction)
 * to one of the 12 canonical construction ids.
 * @param {string} kind @param {string} [construction] @returns {string}
 */
export function resolveConstruction(kind, construction) {
  const hay = [construction, kind].filter(Boolean);
  for (const raw of hay) {
    const s = String(raw).trim();
    const kebab = s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/\s+/g, '-');
    if (CONSTRUCTIONS.includes(kebab)) return kebab;
    const compact = s.replace(/[-_\s]/g, '').toLowerCase();
    if (ALIASES[compact]) return ALIASES[compact];
    // "bottomUp" / "topDown" modifier on a base kind.
    if (/top.?down/i.test(s) && /raglan/i.test(kind || '')) return 'top-down-raglan';
    if (/bottom.?up/i.test(s) && /raglan/i.test(kind || '')) return 'bottom-up-raglan';
    if (/top.?down/i.test(s) && /set.?in/i.test(s)) return 'top-down-set-in';
  }
  return 'bottom-up-raglan';
}

/**
 * Draft a garment into pattern pieces — the single call every system uses.
 * @param {object} params
 * @param {object} params.body     measurement-ish object (BodyModel works, plain object too)
 * @param {object} params.gauge    { stsPer10cm, rowsPer10cm }
 * @param {object} [params.ease]   EaseProfile or { point: cm } map or preference string
 * @param {object} [params.style]  { kind, construction, lengthCm, sleeveLengthCm, ... }
 * @returns {{construction:string, generator:string, pieces:object[], templateInfo:object}}
 */
export function draftGarment(params = {}) {
  const style = params.style || {};
  const construction = resolveConstruction(style.kind || style.construction, style.construction);
  const generator = TEMPLATE_BY_CONSTRUCTION[construction] || bottomUpRaglan;
  const ease = normaliseEase(params.ease, style);
  const body = params.body && params.body.measurements ? params.body.measurements : (params.body || {});
  const gauge = params.gauge || { stsPer10cm: 22, rowsPer10cm: 30 };
  const pieces = generator(body, gauge, ease, style);
  return { construction, generator: generator.name, pieces, templateInfo: TEMPLATE_INFO[construction] };
}

/** Coerce an ease input (profile | map | string) into a {at(point)}-ish plain map templates use. */
function normaliseEase(ease, style) {
  if (ease && typeof ease.at === 'function') return flattenEase(ease);
  if (typeof ease === 'string') return flattenEase(new EaseProfile(ease));
  if (ease && typeof ease === 'object') return ease;
  if (style && style.easePreference) return flattenEase(new EaseProfile(style.easePreference));
  return flattenEase(new EaseProfile('standard'));
}
function flattenEase(profile) {
  const out = {};
  for (const point of ['chest', 'bust', 'waist', 'hip', 'arm', 'upperArm', 'cuff', 'neck', 'leg']) out[point] = profile.at(point);
  return out;
}

export { bottomUpRaglan, topDownRaglan, modifiedRaglan, saddleShoulder, bottomUpSetIn, topDownSetIn, dropShoulder, circularYoke, dolman, kimono, sideToSide, seamlessHybrid };
