/**
 * The .kcard project file — schema, migration and validation.
 *
 * Why this exists as its own module: saving used to write
 * `{ format: 'KNITCAT_PROJECT_V2', version: '2.0.0', ... }` while loading read
 * whichever fields happened to be there and checked *nothing*. Not the format
 * string, not the version, not whether `stitchMatrix` was even a matrix. So a
 * file from a future build, a hand-edited JSON, a DesignaKnit export renamed to
 * .kcard, or a 40-megapixel imported pattern all went straight into the editor —
 * and the failure surfaced later as a blank canvas or a frozen tab, with no clue
 * which file caused it.
 *
 * Rules enforced here:
 *   - a numeric `schemaVersion` on every new file, and a loud refusal if a file
 *     is newer than this build understands (never guess at a format you have not
 *     seen)
 *   - old files with no version are migrated, not rejected, and the user is told
 *     what was assumed
 *   - the stitch matrix is validated and sanitised before it touches the editor
 *   - hard size ceilings, because JSON.parse of a monster file is a browser-tab
 *     funeral, not a pattern
 */

import { STITCH_TYPE } from '../math/knit-topology.js';

/** Bump this when the document shape changes; readers migrate from older ones. */
export const KCARD_SCHEMA_VERSION = 2;

/** Envelope discriminator, so a random JSON tab does not look like a project. */
export const KCARD_KIND = 'KNITCAT_PROJECT';

/**
 * Absolute ceilings, independent of any machine profile. A card can be legal for
 * a profile and still be too much for `JSON.parse` + a canvas redraw to survive,
 * so the file layer refuses the absurd before the machine layer sees it.
 */
export const KCARD_MAX_ROWS = 4000;
export const KCARD_MAX_COLS = 4000;
export const KCARD_MAX_CELLS = 2_000_000;

const LACE_CODE_SET = new Set(Object.values(STITCH_TYPE));
export const PATTERN_MODES = new Set(['lace', 'fair_isle', 'tuck', 'slip']);

/** Legacy field names that older builds or hand-edited files may use. */
const MATRIX_ALIASES = ['stitchMatrix', 'matrix', 'pattern', 'patternMatrix'];

/**
 * Wrap application state in the on-disk document. Everything the exporter writes
 * goes through here so the envelope can only ever have one shape.
 */
export function buildProjectDocument(fields = {}) {
  return {
    format: `${KCARD_KIND}_V${KCARD_SCHEMA_VERSION}`,
    kind: KCARD_KIND,
    schemaVersion: KCARD_SCHEMA_VERSION,
    // Just "who wrote this", for humans reading the raw JSON. Deliberately not a
    // build stamp: nothing in the JS module graph knows the deploy version.
    writtenBy: 'KNITCAT',
    timestamp: new Date().toISOString(),
    ...fields
  };
}

/**
 * Validate (and copy) a stitch matrix.
 *
 * Never trusts the caller: rows must be equally long, cells must be a value the
 * editor can actually render for this mode. Returns the sanitised matrix so a
 * successful result is safe to hand straight to `editor.setMatrix`.
 *
 * @returns {{ok: boolean, matrix?: Array<Array>, rows: number, cols: number,
 *            errors: string[], warnings: string[]}}
 */
export function validateStitchMatrix(matrix, options = {}) {
  const mode = options.mode;
  const errors = [];
  const warnings = [];

  if (!Array.isArray(matrix) || matrix.length === 0) {
    return { ok: false, rows: 0, cols: 0, errors: ['The stitch chart is missing or empty.'], warnings };
  }
  if (matrix.length > KCARD_MAX_ROWS) {
    return {
      ok: false, rows: matrix.length, cols: 0,
      errors: [`A ${matrix.length}-row chart is past the ${KCARD_MAX_ROWS}-row file ceiling.`],
      warnings
    };
  }

  const cols = Array.isArray(matrix[0]) ? matrix[0].length : NaN;
  if (!Number.isFinite(cols) || cols === 0) {
    return { ok: false, rows: matrix.length, cols: 0, errors: ['The first row of the chart is not a list of cells.'], warnings };
  }
  if (cols > KCARD_MAX_COLS) {
    return {
      ok: false, rows: matrix.length, cols,
      errors: [`A ${cols}-column chart is past the ${KCARD_MAX_COLS}-column file ceiling.`],
      warnings
    };
  }
  if (matrix.length * cols > KCARD_MAX_CELLS) {
    return {
      ok: false, rows: matrix.length, cols,
      errors: [`That chart is ${matrix.length}×${cols} — too many cells to open safely.`],
      warnings
    };
  }

  const wantLace = mode === 'lace';
  const out = new Array(matrix.length);
  let raggedRow = -1;
  let badCell = null;

  for (let r = 0; r < matrix.length && !badCell; r++) {
    const row = matrix[r];
    if (!Array.isArray(row) || row.length !== cols) {
      raggedRow = r;
      break;
    }
    const cells = new Array(cols);
    for (let c = 0; c < cols; c++) {
      const value = row[c];
      if (typeof value === 'boolean') {
        // JSON hand-edits love true/false; the editor speaks 0/1.
        cells[c] = value ? 1 : 0;
        continue;
      }
      if (wantLace) {
        if (typeof value === 'string' && LACE_CODE_SET.has(value)) {
          cells[c] = value;
          continue;
        }
        if (value === 0 || value === 1) {
          // A punched/unpunched card pasted into a lace chart: readable, but it
          // is not a stitch glyph, so map it and say so once.
          cells[c] = value ? STITCH_TYPE.EYELET : STITCH_TYPE.KNIT;
          continue;
        }
        badCell = { r, c, value };
        break;
      }
      if (value === 0 || value === 1) {
        cells[c] = value;
        continue;
      }
      if (typeof value === 'string' && LACE_CODE_SET.has(value)) {
        // A lace chart opened in a stranded mode: the glyph has no meaning here.
        badCell = { r, c, value };
        break;
      }
      badCell = { r, c, value };
      break;
    }
    out[r] = cells;
  }

  if (raggedRow >= 0) {
    return {
      ok: false, rows: matrix.length, cols,
      errors: [`Row ${raggedRow + 1} has a different number of cells from row 1 — a chart must be rectangular.`],
      warnings
    };
  }
  if (badCell) {
    const shown = typeof badCell.value === 'string' ? `"${badCell.value}"` : String(badCell.value);
    return {
      ok: false, rows: matrix.length, cols,
      errors: wantLace
        ? [`Cell ${badCell.c + 1} in row ${badCell.r + 1} is ${shown}, which is not a stitch symbol KNITCAT knows.`]
        : [`Cell ${badCell.c + 1} in row ${badCell.r + 1} is ${shown}; a ${mode || 'stranded'} chart holds only punched (1) and blank (0) cells.`],
      warnings
    };
  }
  if (mode && !PATTERN_MODES.has(mode)) {
    warnings.push(`Unknown pattern mode "${mode}" — the chart was loaded as-is.`);
  }

  return { ok: true, matrix: out, rows: out.length, cols, errors, warnings };
}

/**
 * Free-form descriptive fields (name, author, notes, licence, dedication…).
 * Kept as a small, boring allow-list: strings and numbers only, capped, never
 * nested — so a hand-edited or hostile file cannot smuggle arbitrary structure
 * into whatever UI happens to render the metadata.
 */
export function readProjectMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  let kept = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (kept >= 24) break;
    if (!/^[a-z][a-z0-9]{0,24}$/i.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) { out[key] = value; kept++; }
    else if (typeof value === 'string') { out[key] = value.slice(0, 2000); kept++; }
  }
  return kept ? out : null;
}

/**
 * Read any .kcard-ish object into the shape this build uses.
 *
 * @param {object|string} raw parsed JSON or the JSON text itself
 * @returns {{ok: boolean, error?: string, project?: object, warnings: string[]}}
 */
export function readProject(raw) {
  const warnings = [];
  let data = raw;

  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {
      return { ok: false, warnings, error: `That is not JSON at all: ${err.message}` };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, warnings, error: 'A KNITCAT project is a JSON object, not a list or a bare value.' };
  }
  if (!data.format && !data.kind && !data.schemaVersion && !MATRIX_ALIASES.some(k => k in data)) {
    return {
      ok: false, warnings,
      error: 'No KNITCAT project fields in this file — it looks like some other JSON.'
    };
  }

  // ── version gate ────────────────────────────────────────────────────────────
  // `schemaVersion` is the numeric contract. Older builds wrote only a free-text
  // `version` ('2.0.0'), whose major number happens to mean the same thing, so it
  // is used when present. Anything predating both is v1 and gets migrated.
  let schema = Number.isFinite(data.schemaVersion) ? data.schemaVersion : NaN;
  if (!Number.isFinite(schema) && typeof data.version === 'string') {
    const major = parseInt(data.version, 10);
    if (Number.isFinite(major)) schema = major;
  }
  if (!Number.isFinite(schema)) schema = 1;
  if (schema > KCARD_SCHEMA_VERSION) {
    return {
      ok: false, warnings,
      error: `This project was written by a newer KNITCAT (schema v${schema}); this build reads up to v${KCARD_SCHEMA_VERSION}. Open it in the version that saved it rather than guessing at the format.`
    };
  }
  if (schema < KCARD_SCHEMA_VERSION) {
    warnings.push(`Upgraded from project schema v${schema} to v${KCARD_SCHEMA_VERSION}.`);
  }

  const project = {
    schemaVersion: KCARD_SCHEMA_VERSION,
    profileId: typeof data.profileId === 'string' ? data.profileId : null,
    mode: typeof data.mode === 'string' ? data.mode : null,
    name: typeof data.name === 'string' ? data.name : null,
    notes: typeof data.notes === 'string' ? data.notes : null,
    yarn: data.yarn && typeof data.yarn === 'object' ? data.yarn : null,
    gauge: data.gauge && typeof data.gauge === 'object' ? data.gauge : null,
    meta: readProjectMeta(data.meta),
    savedAt: typeof data.timestamp === 'string' ? data.timestamp : null,
    // Compile output is never trusted from disk: it is derived from the chart, so
    // a stale or hand-edited schedule would desync from what is drawn.
    discardedCompiled: Boolean(data.compilationResult)
  };
  if (project.discardedCompiled) {
    warnings.push('The saved carriage schedule was ignored — it is rebuilt from your chart on open.');
  }
  if (project.mode && !PATTERN_MODES.has(project.mode)) {
    warnings.push(`Unknown pattern mode "${project.mode}" in the file — kept your current mode.`);
    project.mode = null;
  }

  const key = MATRIX_ALIASES.find(k => Array.isArray(data[k]));
  if (!key) {
    return { ok: false, warnings, error: 'No stitch chart in this file. A KNITCAT project carries a "stitchMatrix" field.' };
  }
  if (key !== 'stitchMatrix') warnings.push(`Read the chart from the legacy "${key}" field.`);

  const checked = validateStitchMatrix(data[key], { mode: project.mode || undefined });
  if (!checked.ok) return { ok: false, warnings, error: checked.errors.join(' ') };
  project.stitchMatrix = checked.matrix;

  // Header rows/cols are decorative; the matrix is the truth. Disagreement is a
  // warning, never a reason to load something that does not match its own data.
  for (const [field, actual] of [['rows', checked.rows], ['cols', checked.cols]]) {
    if (Number.isFinite(data[field]) && data[field] !== actual) {
      warnings.push(`The file claims ${data[field]} ${field}; the chart actually holds ${actual}. Believed the chart.`);
    }
  }

  return { ok: true, project, warnings };
}
