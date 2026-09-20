/**
 * KNITCAT V2 — the fibre behaviour model (spec §3.8).
 *
 * The whole reason a merino sweater and a cotton one of the *same pattern* behave completely
 * differently is fibre. This turns a fibre-composition list into the ten behavioural scores
 * the rest of V2 consumes: the drape simulator reads `drape`/`stretch`, the substitution
 * engine compares `warmth`/`pillingRisk`, the care planner reads `felting`/`shrinking`, and
 * the UI shows "is this going to grow when I hang it wet?".
 *
 * Every fibre carries a profile of the ten traits; a blend is a weighted average, then a few
 * interaction rules adjust it (nylon adds strength to a fine wool; a little silk lifts drape;
 * high acrylic dulls stitch definition). DOM-free.
 *
 * @module yarn/behavior
 */

/**
 * Behaviour traits per fibre, all 0..1. Sourced from standard handcraft knowledge of these
 * fibres; they are relative descriptors, not lab measurements.
 * @type {Record<string,{drape,stretch,recovery,warmth,breathability,pillingRisk,shrinking,felting,colorBleeding,definition}>}
 */
export const FIBRE_PROFILES = Object.freeze({
  wool: { drape: 0.45, stretch: 0.75, recovery: 0.85, warmth: 0.85, breathability: 0.6, pillingRisk: 0.45, shrinking: 0.5, felting: 0.7, colorBleeding: 0.2, definition: 0.6 },
  merino: { drape: 0.5, stretch: 0.8, recovery: 0.9, warmth: 0.75, breathability: 0.65, pillingRisk: 0.5, shrinking: 0.45, felting: 0.6, colorBleeding: 0.15, definition: 0.7 },
  alpaca: { drape: 0.8, stretch: 0.7, recovery: 0.45, warmth: 0.9, breathability: 0.5, pillingRisk: 0.6, shrinking: 0.4, felting: 0.35, colorBleeding: 0.1, definition: 0.5 },
  cashmere: { drape: 0.82, stretch: 0.65, recovery: 0.5, warmth: 0.95, breathability: 0.55, pillingRisk: 0.75, shrinking: 0.4, felting: 0.3, colorBleeding: 0.1, definition: 0.55 },
  mohair: { drape: 0.7, stretch: 0.6, recovery: 0.5, warmth: 0.85, breathability: 0.5, pillingRisk: 0.55, shrinking: 0.3, felting: 0.25, colorBleeding: 0.1, definition: 0.3 },
  qiviut: { drape: 0.8, stretch: 0.6, recovery: 0.6, warmth: 0.98, breathability: 0.6, pillingRisk: 0.3, shrinking: 0.1, felting: 0.05, colorBleeding: 0.1, definition: 0.6 },
  yak: { drape: 0.75, stretch: 0.6, recovery: 0.55, warmth: 0.9, breathability: 0.6, pillingRisk: 0.4, shrinking: 0.2, felting: 0.1, colorBleeding: 0.1, definition: 0.6 },
  possum: { drape: 0.72, stretch: 0.6, recovery: 0.55, warmth: 0.92, breathability: 0.6, pillingRisk: 0.45, shrinking: 0.2, felting: 0.1, colorBleeding: 0.1, definition: 0.6 },
  angora: { drape: 0.7, stretch: 0.6, recovery: 0.45, warmth: 0.9, breathability: 0.5, pillingRisk: 0.8, shrinking: 0.3, felting: 0.2, colorBleeding: 0.1, definition: 0.4 },
  cotton: { drape: 0.6, stretch: 0.2, recovery: 0.2, warmth: 0.3, breathability: 0.8, pillingRisk: 0.5, shrinking: 0.5, felting: 0.0, colorBleeding: 0.25, definition: 0.75 },
  linen: { drape: 0.55, stretch: 0.1, recovery: 0.25, warmth: 0.25, breathability: 0.9, pillingRisk: 0.35, shrinking: 0.5, felting: 0.0, colorBleeding: 0.2, definition: 0.7 },
  hemp: { drape: 0.5, stretch: 0.1, recovery: 0.3, warmth: 0.3, breathability: 0.85, pillingRisk: 0.4, shrinking: 0.45, felting: 0.0, colorBleeding: 0.2, definition: 0.7 },
  bamboo: { drape: 0.8, stretch: 0.35, recovery: 0.4, warmth: 0.4, breathability: 0.8, pillingRisk: 0.55, shrinking: 0.3, felting: 0.0, colorBleeding: 0.2, definition: 0.6 },
  tencel: { drape: 0.85, stretch: 0.3, recovery: 0.5, warmth: 0.4, breathability: 0.8, pillingRisk: 0.5, shrinking: 0.3, felting: 0.0, colorBleeding: 0.2, definition: 0.65 },
  silk: { drape: 0.9, stretch: 0.35, recovery: 0.55, warmth: 0.45, breathability: 0.7, pillingRisk: 0.3, shrinking: 0.2, felting: 0.0, colorBleeding: 0.2, definition: 0.85 },
  nylon: { drape: 0.5, stretch: 0.55, recovery: 0.6, warmth: 0.35, breathability: 0.4, pillingRisk: 0.4, shrinking: 0.2, felting: 0.0, colorBleeding: 0.15, definition: 0.5 },
  acrylic: { drape: 0.4, stretch: 0.5, recovery: 0.55, warmth: 0.55, breathability: 0.35, pillingRisk: 0.65, shrinking: 0.25, felting: 0.0, colorBleeding: 0.1, definition: 0.45 }
});

const TRAITS = ['drape', 'stretch', 'recovery', 'warmth', 'breathability', 'pillingRisk', 'shrinking', 'felting', 'colorBleeding', 'definition'];

/** Canonical YarnWeight ordering for coverage/behaviour hints. */
export const YARN_WEIGHTS = Object.freeze(['lace', 'light-fingering', 'fingering', 'sport', 'dk', 'worsted', 'aran', 'bulky', 'super-bulky', 'jumbo']);

/**
 * Normalise a fibre spec — accepts [{name,percentage}], {"wool":100}, or "wool 80 nylon 20".
 * @param {Array|object|string} fiber @returns {Array<{name:string, percentage:number}>}
 */
export function normalizeFiber(fiber) {
  if (!fiber) return [];
  if (typeof fiber === 'string') {
    return fiber.split(/[,;]/).map(tok => {
      const m = tok.trim().match(/^([a-z-]+)\s*([\d.]+)?%?$/i);
      return m ? { name: m[1].toLowerCase(), percentage: m[2] ? Number(m[2]) : 0 } : null;
    }).filter(Boolean);
  }
  if (Array.isArray(fiber)) {
    return fiber.map(f => typeof f === 'string' ? { name: f.toLowerCase(), percentage: 0 } : { name: String(f.name || f.fiber || '').toLowerCase(), percentage: Number(f.percentage ?? f.percent ?? 0) }).filter(f => f.name);
  }
  if (typeof fiber === 'object') {
    return Object.entries(fiber).map(([name, percentage]) => ({ name: String(name).toLowerCase(), percentage: Number(percentage) || 0 }));
  }
  return [];
}

/**
 * Compute the {@link YarnBehaviour} of a fibre composition.
 * @param {Array|object|string} fiber @returns {object} the trait scores plus care/season/bestFor
 */
export function behaviourFor(fiber) {
  const list = normalizeFiber(fiber);
  let total = list.reduce((s, f) => s + (f.percentage || 0), 0);
  const use = list.length ? list : [{ name: 'wool', percentage: 100 }];
  if (!total) { total = use.length; use.forEach(f => (f.percentage = 1)); }
  const scores = {};
  for (const t of TRAITS) {
    let acc = 0;
    for (const f of use) {
      const prof = FIBRE_PROFILES[f.name] || FIBRE_PROFILES.wool;
      acc += (prof[t] != null ? prof[t] : 0.5) * (f.percentage || total);
    }
    scores[t] = clamp01(round2(acc / total));
  }
  applyBlendRules(scores, use);
  const names = use.map(f => f.name);
  return Object.assign(scores, {
    fibers: use,
    season: suggestSeason(scores),
    bestFor: suggestBestFor(scores, names),
    care: careForFibers(names, scores)
  });
}

/** Interaction rules that a straight average would miss. */
function applyBlendRules(s, fibers) {
  const has = (n) => fibers.some(f => f.name.includes(n));
  const pct = (n) => fibers.filter(f => f.name.includes(n)).reduce((a, f) => a + (f.percentage || 0), 0);
  if (has('nylon') && pct('nylon') < 30) { s.recovery = clamp01(s.recovery + 0.08); s.pillingRisk = clamp01(s.pillingRisk - 0.05); }
  if (has('silk') && pct('silk') > 20) { s.drape = clamp01(s.drape + 0.1); s.definition = clamp01(s.definition + 0.1); }
  if (has('acrylic') && pct('acrylic') > 50) { s.definition = clamp01(s.definition - 0.08); s.warmth = clamp01(s.warmth - 0.05); }
  if (has('mohair') || has('angora')) { s.halo = true; s.felting = clamp01(s.felting - 0.1); }
  if (has('linen') || has('hemp')) { s.memory = 'low'; s.recovery = clamp01(s.recovery + 0.1); } // plant fibres relax but don't stretch
  // Wool + a plant fibre: less felting, more drape, cooler.
  if (has('wool') && (has('cotton') || has('linen'))) { s.felting = clamp01(s.felting * 0.6); s.drape = clamp01(s.drape + 0.05); }
}

function suggestSeason(s) {
  const out = [];
  if (s.warmth > 0.75) out.push('winter');
  if (s.breathability > 0.65) out.push('summer');
  if (s.warmth > 0.5 && s.warmth <= 0.8) out.push('autumn', 'spring');
  if (!out.length) out.push('all-season');
  return [...new Set(out)];
}
function suggestBestFor(s, names) {
  const out = [];
  if (s.warmth > 0.7 && s.drape < 0.7) out.push('sweaters', 'hats');
  if (s.drape > 0.7) out.push('shawls', 'lace');
  if (s.breathability > 0.7 && s.warmth < 0.5) out.push('summer tops', 'baby');
  if (s.definition > 0.7) out.push('cables', 'texture');
  if (s.warmth > 0.85) out.push('cowls', 'mittens');
  if (names.includes('cotton') || names.includes('linen')) out.push('dishcloths', 'market bags');
  return [...new Set(out)];
}
function careForFibers(names, s) {
  const animal = names.some(n => ['wool', 'merino', 'alpaca', 'cashmere', 'mohair', 'angora', 'yak', 'qiviut', 'possum'].includes(n));
  const superwash = names.includes('superwash');
  const plant = names.some(n => ['cotton', 'linen', 'hemp', 'bamboo', 'tencel'].includes(n));
  return {
    handWash: animal && !superwash,
    machineWash: superwash || (plant && !animal),
    washTempC: superwash ? 30 : (animal ? 20 : 40),
    dryFlat: animal || s.recovery < 0.6,
    tumbleDry: plant && !animal && names.includes('acrylic'),
    iron: plant && !animal ? 'low' : 'none',
    dryClean: s.felting > 0.6 && s.drape > 0.75,
    notes: animal && !superwash ? 'Hand wash cool, do not wring, dry flat — felting risk.' : (plant ? 'Machine washable; may grow when wet, dry flat.' : 'Gentle cycle, dry flat.')
  };
}

function clamp01(n) { return Math.max(0, Math.min(1, n)); }
function round2(n) { return Math.round(n * 100) / 100; }
