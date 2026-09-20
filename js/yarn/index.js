/**
 * KNITCAT V2 — the Yarn Lab barrel.
 *
 * The single import surface for yarn: the registry, the stash, the substitution / colour /
 * behaviour / care / cost / blending engines, and one high-level entry, {@link yarnLabForProject},
 * that reads the yarn + cost nodes off a live {@link module:project/project.Project} and returns
 * a consolidated report the UI and the Compiler can consume. Every other system imports
 * `js/yarn/index.js`, never the leaves, so the internal layout can change freely.
 *
 * @module yarn
 */

// Registry + normalisation.
export {
  YarnDatabase, normalizeYarn, getDefaultDatabase, resetDefaultDatabase,
  representativeGauge, metersForGrams, ballsForMeters
} from './database.js';
export { SEED_YARNS, SEED_COLORWAY_COUNT } from './yarn-db-seed.js';

// Stash.
export { Stash } from './stash.js';
export { parseDelimited, importRavelryCSV, importStashJSON, importFromPhoto, entryToCustomYarn } from './stash-import.js';

// Substitution.
export { substitute, rankSubstitutes, compareFibers, matchColor } from './substitution.js';

// Colour.
export {
  hexToRgb, rgbToHex, rgbToHsl, hslToRgb, hexToLab, labToHex, deltaE, colorsMatch,
  HARMONY_TYPES, suggestPalette, generateGradient, extractPalette, matchToYarns, luminance, checkContrast
} from './color.js';
export { CVD_TYPES, simulate as simulateColorBlindness, confusablePairs, auditPalette, paletteIsSafe } from './color-blindness.js';

// Fibre behaviour + care.
export { FIBRE_PROFILES, YARN_WEIGHTS, normalizeFiber, behaviourFor } from './behavior.js';
export { CARE_SYMBOLS, careInstructions, careLabel } from './care.js';

// Cost + blending.
export { computeCost, costFromProject } from './cost.js';
export { holdStrands, suggestHoldForGauge, fairIslePlan, fadePlan } from './blending.js';

import { getDefaultDatabase, normalizeYarn, representativeGauge, ballsForMeters } from './database.js';
import { behaviourFor } from './behavior.js';
import { careLabel } from './care.js';
import { computeCost } from './cost.js';

/**
 * Consolidated yarn picture for a Project: pulls the yarns named in the spec, their gauge and
 * behaviour, the total metres the graph computed, the ball counts, and the cost — everything the
 * "Yarn" tab and the Compiler's yarn verification need, in one object.
 *
 * @param {import('../project/project.js').Project} project
 * @param {{db?:import('./database.js').YarnDatabase, laborRate?:number, hours?:number}} [opts]
 * @returns {{yarns:Array, totalMeters:number, totalCost:number, gauge:object, behavior:object, care:object[], cost:object, shortfalls:Array}}
 */
export function yarnLabForProject(project, opts = {}) {
  const db = opts.db || getDefaultDatabase();
  const get = id => (project && project.get ? project.get(id) : undefined);
  const spec = (project && project.spec && project.spec.sections) || {};
  const yarnSection = spec.yarn || {};
  const names = Object.keys(yarnSection);

  const totalMeters = Number(get('yarn.totalMeters')) || 0;
  const yarns = [];
  const shortfalls = [];
  const care = [];

  for (const name of names) {
    const declared = yarnSection[name] || {};
    const resolved = resolveProjectYarn(db, declared);
    const meters = Number(get(`yarn.${name}.meters`)) || (names.length ? totalMeters / names.length : 0);
    const ballsNeeded = ballsForMeters(resolved.yarn, meters);
    const owned = Number(get(`yarn.${name}.owned`)) || Math.round(Number(declared.quantity) || 0);
    const short = Math.max(0, ballsNeeded - owned);
    const gauge = representativeGauge(resolved.yarn);
    const behavior = behaviourFor(resolved.yarn.fiber);
    yarns.push({
      name,
      yarn: resolved.yarn,
      matched: resolved.matched,
      meters: round1(meters),
      ballsNeeded,
      owned,
      shortfall: short,
      gauge,
      behavior,
      color: declared.color || (resolved.yarn.colors[0] && resolved.yarn.colors[0].hex) || null
    });
    if (short > 0) shortfalls.push({ name, buy: short, yarn: resolved.yarn });
    care.push({ name, label: careLabel(resolved.yarn.fiber) });
  }

  const primary = yarns[0];
  const cost = computeCost({
    yarns: yarns.map(y => ({ name: y.name, meters: y.meters, ballMeters: y.yarn.meterage.metersPerBall, ballPrice: priceFor(y), balls: y.ballsNeeded })),
    hours: Number(get('time.totalHours')) || opts.hours || 0,
    laborRate: opts.laborRate || 0
  });

  return {
    yarns,
    totalMeters: round1(totalMeters),
    totalCost: cost.total,
    gauge: primary ? primary.gauge : { stsPer10cm: Number(get('gauge.stitchesPer10cm')) || 22, rowsPer10cm: Number(get('gauge.rowsPer10cm')) || 30 },
    behavior: primary ? primary.behavior : behaviourFor([]),
    care,
    cost,
    shortfalls
  };
}

/** Resolve a KnitScript yarn declaration to a database yarn by source path / brand / name. */
function resolveProjectYarn(db, declared) {
  const source = String(declared.source || '');
  const hints = [declared.name, declared.brand, source.split('/').pop()].filter(Boolean);
  for (const h of hints) {
    const found = db.search(h).find(y => y.name.toLowerCase() === String(h).toLowerCase() || y.id === slug(h));
    if (found) return { yarn: found, matched: true };
  }
  // Fall back to the declared fields normalised into a synthetic yarn.
  return { yarn: normalizeYarn(Object.assign({}, declared, { id: declared.id || slug(declared.name || 'project-yarn') }), { custom: true }), matched: false };
}

function priceFor(y) {
  const declared = y.yarn && y.yarn.price;
  if (typeof declared === 'number') return declared;
  return 0;
}

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
