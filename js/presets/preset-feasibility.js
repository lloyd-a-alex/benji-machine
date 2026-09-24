/**
 * KNITCAT — Preset machine-fit analysis (pure, DOM-free, testable).
 *
 * The pattern browser shows ~two hundred designs, but until now it told you *nothing*
 * about whether a design would actually run on the machine you have selected: a reaction-
 * diffusion labyrinth with a 15-stitch carried float is beautiful on screen and a snagging
 * disaster on a 9-needle Brother bridge, and a 60-column motif silently wastes half a
 * 24-needle punchcard. Computing that required the editor's live matrix, which a browsing
 * grid does not have.
 *
 * This module closes the loop without an editor: it draws a preset at its natural size,
 * runs the shared chart analysis (`js/core/chart-analysis.js`) against a machine profile's
 * limits, and folds the findings into the SAME 0–100 health score and status vocabulary the
 * feasibility advisor uses (`scoreIssues` / `riskLabel` from machine-knowledge), so the
 * browser badge and the advisor verdict can never contradict each other about one card.
 *
 * Everything here is deterministic and never throws: a preset whose generator misbehaves
 * degrades to an 'unknown' fit rather than breaking the grid.
 */

import { analyzeChart } from '../core/chart-analysis.js';
import { profileLimits, MACHINE_PROFILES } from '../machine/profiles.js';
import { scoreIssues, riskLabel, universalEnvelope } from '../machine/machine-knowledge.js';
import { logger } from '../core/logging.js';

const log = logger('presets/preset-feasibility');

/** The profile the browser falls back to when none is selected (the default single-bed). */
const DEFAULT_PROFILE_ID = 'brother_standard_24';

/** Resolve a profile from an object, an id, or nothing at all. */
function resolveProfile(profile) {
  if (profile && typeof profile === 'object' && profile.id) return profile;
  if (typeof profile === 'string' && MACHINE_PROFILES[profile]) return MACHINE_PROFILES[profile];
  return MACHINE_PROFILES[DEFAULT_PROFILE_ID];
}

/**
 * Fit an already-drawn chart to a machine. Pure and total (never throws).
 *
 * @param {Array<Array<*>>} matrix rows of cells in chart convention
 * @param {object} [opts]
 * @param {string} [opts.mode='fair_isle']
 * @param {object|string} [opts.profile] profile object or id
 * @param {number} [opts.beds] override bed count (defaults to the profile's)
 * @returns {{status:string, score:number, risk:object, reasons:string[], reasonsDetailed:Array, metrics:object, fitsBed:boolean}}
 */
export function fitChart(matrix, { mode = 'fair_isle', profile = DEFAULT_PROFILE_ID, beds } = {}) {
  const resolved = resolveProfile(profile);
  const limits = profileLimits(resolved);
  const bedCount = Number.isFinite(beds) ? beds : limits.beds;
  const analysis = analyzeChart(matrix, { mode, limits, beds: bedCount });
  const score = scoreIssues(analysis.findings);
  const risk = riskLabel(score);
  const fitsBed = analysis.cols <= limits.maxNeedles && analysis.rows <= limits.maxRows;
  return {
    status: analysis.status,
    score,
    risk,
    reasons: analysis.findings.map((f) => f.title),
    reasonsDetailed: analysis.findings.map((f) => ({ sev: f.sev, title: f.title, message: f.message, code: f.code })),
    metrics: analysis.metrics,
    fitsBed
  };
}

/**
 * Draw a preset at its natural size and fit it to a machine. The generator is called once
 * per (preset, profile, width) and memoised so re-filtering the browser does not re-solve a
 * reaction-diffusion field a hundred times.
 *
 * @param {object} preset a PATTERN_PRESETS entry ({ id, mode, rows, cols, generate })
 * @param {object|string} [profile] profile object or id
 * @param {object} [opts]
 * @param {number} [opts.width] override the natural card width (e.g. the bed's columns)
 * @returns {object} the {@link fitChart} result, or an 'unknown' fit if the preset cannot draw
 */
export function fitPreset(preset, profile = DEFAULT_PROFILE_ID, { width } = {}) {
  const resolved = resolveProfile(profile);
  const cols = Number.isFinite(width) ? width : preset.cols;
  const cacheKey = `${preset.id}|${resolved.id}|${cols}`;
  if (FIT_CACHE.has(cacheKey)) return FIT_CACHE.get(cacheKey);

  let fit;
  try {
    const matrix = preset.generate(preset.rows, cols);
    fit = fitChart(matrix, { mode: preset.mode, profile: resolved });
  } catch (err) {
    // A generator that throws is a bug in the preset, not something the browser should
    // surface as a machine problem — report an honest 'unknown' and keep the grid alive.
    log.error(`preset "${preset.id}" generator threw — reporting an unknown fit`, { presetId: preset.id, error: err && err.message ? err.message : String(err) });
    fit = {
      status: 'unknown',
      score: 0,
      risk: riskLabel(0),
      reasons: ['Could not evaluate'],
      reasonsDetailed: [{ sev: 'info', title: 'Could not evaluate', message: err && err.message ? err.message : String(err), code: 'draw-error' }],
      metrics: { punchedRatio: 0, longestFloat: 0, maxFloat: profileLimits(resolved).maxFloatNeedles },
      fitsBed: true
    };
  }
  FIT_CACHE.set(cacheKey, fit);
  memoCap();
  return fit;
}

// Bounded memo: a browsing session re-fits the same presets repeatedly (filter changes,
// re-renders), but we never want the cache to outgrow the library by accidents of width.
const FIT_CACHE = new Map();
const FIT_CACHE_LIMIT = 4000;
function memoCap() {
  if (FIT_CACHE.size > FIT_CACHE_LIMIT) FIT_CACHE.clear();
}

/**
 * Does this preset knit cleanly on *every* machine KNITCAT ships, using the strictest
 * float bridge and narrowest bed across the registry? This powers the browser's
 * "portable" indicator without evaluating each profile separately.
 *
 * @param {object} preset
 * @returns {{status:string, score:number, portable:boolean, reasons:string[]}}
 */
export function universalFit(preset) {
  const envelope = universalEnvelope(Object.values(MACHINE_PROFILES));
  let matrix;
  try {
    matrix = preset.generate(preset.rows, preset.cols);
  } catch (err) {
    log.error(`preset "${preset.id}" generator threw during the portability sweep — reported as not portable`, { presetId: preset.id, error: err && err.message ? err.message : String(err) });
    return { status: 'unknown', score: 0, portable: false, reasons: ['Could not evaluate'] };
  }
  const fit = fitChart(matrix, { mode: preset.mode, profile: resolveProfile(null), beds: 1 });
  // Re-evaluate against the strictest limits the envelope represents, not one profile's.
  const strict = analyzeChart(matrix, { mode: preset.mode, limits: envelope, beds: 1 });
  const score = scoreIssues(strict.findings);
  const portable = strict.status === 'feasible' && fit.status === 'feasible';
  return { status: strict.status, score, portable, reasons: strict.findings.map((f) => f.title) };
}

/** Drop memoised fits (used after a preset library change or in tests). */
export function clearFitCache() {
  FIT_CACHE.clear();
}
