/**
 * KNITCAT V2 — Project migrations (schema v1 → v2 → v3).
 *
 * Stored projects outlive code. A `.kcard` saved by an old build must still open in the
 * new one, so every bump to {@link module:project/project.PROJECT_VERSION} gets a small,
 * pure, tested step function here that upgrades a plain stored object by exactly one
 * version. `migrate()` runs the needed steps in order and is idempotent — feeding it an
 * already-current object is a no-op — so it is always safe to call on load.
 *
 * The steps are deliberately defensive: they never assume a field is present, they only
 * add what the new schema requires, and they preserve everything the older app stored
 * (the editor matrix, the profile id) by tucking it under `legacy` rather than dropping
 * it, so an old chart is never lost even before it has a KnitScript equivalent.
 *
 * DOM-free.
 *
 * @module project/migrations
 */

/** The newest schema this file knows how to produce. */
export const LATEST_VERSION = 3;

/**
 * A map of `fromVersion → step(plain) → plain(nextVersion)`. Each step must set
 * `result.version` to its target. Add a new key whenever LATEST_VERSION is bumped.
 */
export const STEPS = Object.freeze({
  1: migrateV1toV2,
  2: migrateV2toV3
});

/**
 * Upgrade a stored project object to the latest version. Idempotent and total: any input
 * returns an object shaped like the current schema, even a bare/legacy one.
 * @param {object} plain @returns {object}
 */
export function migrate(plain) {
  let obj = clone(plain && typeof plain === 'object' ? plain : {});
  let version = Number.isFinite(obj.version) ? obj.version : 1;
  let guard = 0;
  while (version < LATEST_VERSION && guard++ < 10) {
    const step = STEPS[version];
    if (!step) break; // unknown step: stop rather than guess
    obj = step(obj) || obj;
    version = Number.isFinite(obj.version) ? obj.version : version + 1;
  }
  obj.version = LATEST_VERSION;
  return obj;
}

// ---- v1 → v2: introduce the KnitScript spec skeleton around a legacy chart ----------

/** @param {object} p @returns {object} */
function migrateV1toV2(p) {
  const out = Object.assign({}, p);
  // Preserve anything we don't understand rather than deleting it.
  out.legacy = { matrix: p.matrix || p.chart || null, profileId: p.profileId || p.machine || null };
  if (!out.spec || typeof out.spec !== 'object') {
    out.spec = {
      name: p.name || 'Migrated project',
      sections: {
        body: { system: 'custom' },
        yarn: {},
        machine: p.profileId ? { id: String(p.profileId) } : {},
        garment: { kind: 'pullover' },
        compile: { outputs: ['chart'], optimize: [], verify: [] }
      }
    };
  }
  out.version = 2;
  return out;
}

// ---- v2 → v3: normalise the spec and lift the current model to PROJECT_VERSION 3 -----

/** @param {object} p @returns {object} */
function migrateV2toV3(p) {
  const out = Object.assign({}, p);
  const spec = out.spec && typeof out.spec === 'object' ? out.spec : { name: out.name || 'Project', sections: {} };
  spec.sections = spec.sections || {};
  // v3 guarantees a compile section and a gauge-carrying swatch slot.
  if (!spec.sections.compile) spec.sections.compile = { outputs: ['chart', 'written'], optimize: [], verify: ['fit', 'gauge', 'machine'] };
  if (!spec.sections.swatch) spec.sections.swatch = {};
  // Move a top-level `gauge` (v2 shape) into the swatch so the graph reads it uniformly.
  if (out.gauge && !spec.sections.swatch.stitchesPer10cm) {
    if (typeof out.gauge.stitches === 'number') spec.sections.swatch.stitchesPer10cm = out.gauge.stitches;
    if (typeof out.gauge.rows === 'number') spec.sections.swatch.rowsPer10cm = out.gauge.rows;
  }
  out.spec = spec;
  out.name = spec.name || out.name || 'Project';
  out.version = 3;
  return out;
}

/** A cheap structural clone that survives missing crypto/structuredClone in tests. */
function clone(obj) {
  try { return JSON.parse(JSON.stringify(obj)); }
  catch (_) { return Object.assign({}, obj); }
}
