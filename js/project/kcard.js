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
// The knitter's working context (pinned notes, ruler guides, repeat tiles) already
// has a DOM-free sanitizer each. Reusing them here means a hand-edited or hostile
// file cannot smuggle a half-shaped annotation into the canvas renderer, and the
// file format can never disagree with the editor about what a guide looks like.
import { sanitizeAnnotations } from '../edit/annotations.js';
import { normalizeGuideList } from '../edit/guides.js';
import { logger } from '../core/logging.js';

const log = logger('project/kcard');

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

/**
 * Ceilings for the knitter's working context. These are deliberately far above any
 * real project — nobody draws 400 ruler guides — so hitting one means the file was
 * not written by a person. The correct response is to keep the card and drop the
 * field, not to refuse the whole document.
 */
export const KCARD_MAX_GUIDES = 400;
export const KCARD_MAX_REPEATS = 64;
export const KCARD_MAX_LAYERS = 48;
export const KCARD_MAX_HISTORY_ENTRIES = 1000;
export const KCARD_MAX_HISTORY_CELLS = 2_000_000;

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
 * The undo tree, as it arrives from `HistoryTree.serialize()`.
 *
 * Only the *shape* is checked here — `HistoryTree.deserialize` is already defensive
 * and returns `null` rather than throwing on garbage. What this guard is for is the
 * file-size attack: a 200 MB "history" field would freeze the tab long before the
 * tree ever got built, so the entry count and the total patch-cell count are capped.
 *
 * @returns {{history: object|null, warnings: string[]}}
 */
export function readProjectHistory(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { history: null, warnings };
  if (!Array.isArray(raw.root) || !Array.isArray(raw.root[0])) {
    warnings.push('The saved edit history was unreadable and was dropped — the card itself loaded fine.');
    return { history: null, warnings };
  }
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  if (entries.length > KCARD_MAX_HISTORY_ENTRIES) {
    warnings.push(
      `That file carries ${entries.length} undo steps, past the ${KCARD_MAX_HISTORY_ENTRIES}-step ceiling — the history was dropped.`
    );
    return { history: null, warnings };
  }
  let cells = 0;
  for (const entry of entries) {
    cells += Array.isArray(entry?.patch) ? entry.patch.length : 0;
    if (cells > KCARD_MAX_HISTORY_CELLS) {
      warnings.push('The saved edit history was larger than this build will replay, so it was dropped.');
      return { history: null, warnings };
    }
  }
  return {
    history: {
      version: Number.isFinite(raw.version) ? raw.version : 1,
      root: raw.root,
      rootCheckpoint: typeof raw.rootCheckpoint === 'string' ? raw.rootCheckpoint.slice(0, 120) : null,
      mode: typeof raw.mode === 'string' ? raw.mode : null,
      limit: Number.isFinite(raw.limit) ? Math.max(2, Math.min(KCARD_MAX_HISTORY_ENTRIES, raw.limit)) : null,
      entries: entries.map(entry => ({
        patch: Array.isArray(entry?.patch) ? entry.patch.slice(0, KCARD_MAX_HISTORY_CELLS) : [],
        label: typeof entry?.label === 'string' ? entry.label.slice(0, 120) : 'Edit',
        mode: typeof entry?.mode === 'string' ? entry.mode : null,
        selection: entry?.selection && typeof entry.selection === 'object' ? entry.selection : null,
        checkpoint: typeof entry?.checkpoint === 'string' ? entry.checkpoint.slice(0, 120) : null,
        at: typeof entry?.at === 'number' ? entry.at : null
      }))
    },
    warnings
  };
}

/**
 * Repeat tiles: the same tolerance `normalizeGuideList` gives rulers, applied to
 * rectangles. A tile whose corners are inverted or off-card is repaired by
 * `createRepeat`/`addRepeatFromSelection` on the editor side, so all that is
 * checked here is that the numbers are numbers and there are not absurd many.
 */
export function readProjectRepeats(raw, { rows = Infinity, cols = Infinity } = {}) {
  const warnings = [];
  if (!Array.isArray(raw)) return { repeats: [], warnings };
  const finite = n => (Number.isFinite(n) ? Math.round(n) : null);
  const repeats = raw.slice(0, KCARD_MAX_REPEATS).map(item => {
    if (!item || typeof item !== 'object') return null;
    const r1 = finite(item.r1 ?? item.top);
    const c1 = finite(item.c1 ?? item.left);
    const r2 = finite(item.r2 ?? item.bottom);
    const c2 = finite(item.c2 ?? item.right);
    if ([r1, c1, r2, c2].some(v => v === null)) return null;
    return {
      id: typeof item.id === 'string' ? item.id.slice(0, 40) : null,
      name: typeof item.name === 'string' ? item.name.slice(0, 64) : 'Repeat',
      r1: Math.max(0, Math.min(rows - 1, Math.min(r1, r2))),
      r2: Math.max(0, Math.min(rows - 1, Math.max(r1, r2))),
      c1: Math.max(0, Math.min(cols - 1, Math.min(c1, c2))),
      c2: Math.max(0, Math.min(cols - 1, Math.max(c1, c2)))
    };
  }).filter(Boolean);
  if (raw.length > KCARD_MAX_REPEATS) {
    warnings.push(`Only the first ${KCARD_MAX_REPEATS} repeat tiles were kept.`);
  }
  return { repeats, warnings };
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
      log.warn('a .kcard file was not valid JSON', { error: err?.message, bytes: raw.length });
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

  // ── the knitter's working context (plan §4.2) ──────────────────────────────
  // Everything below is optional and additive: a card written before these fields
  // existed loads exactly as it always did, and each one is dropped with a
  // sentence if it is malformed rather than being allowed to half-apply.
  const size = { rows: checked.rows, cols: checked.cols };
  const guideList = normalizeGuideList(Array.isArray(data.guides) ? data.guides.slice(0, KCARD_MAX_GUIDES) : []);
  const repeatResult = readProjectRepeats(data.repeats, size);
  const annotationResult = sanitizeAnnotations(Array.isArray(data.annotations) ? data.annotations : [], size);
  const historyResult = readProjectHistory(data.history);

  project.guides = guideList;
  project.repeats = repeatResult.repeats;
  project.annotations = annotationResult.annotations;
  project.history = historyResult.history;
  project.layers = readProjectLayers(data.layers, size);
  warnings.push(...repeatResult.warnings, ...historyResult.warnings);
  // `sanitizeAnnotations` reports dropped notes as an ARRAY of ids/labels, not a
  // count — so the emptiness test is `.length` (a bare `[]` is truthy in JS).
  const droppedAnnotations = Array.isArray(annotationResult.dropped) ? annotationResult.dropped.length : (annotationResult.dropped | 0);
  if (droppedAnnotations) {
    warnings.push(`${droppedAnnotations} annotation${droppedAnnotations === 1 ? '' : 's'} in the file could not be read and were skipped.`);
  }
  if (Array.isArray(data.guides) && data.guides.length > guideList.length) {
    warnings.push('Some ruler guides were malformed and have been dropped.');
  }
  if (project.layers && project.layers.dropped) {
    warnings.push('Some layers in the file were unusable, so the card loaded from its flattened chart.');
    project.layers = null;
  }

  // A successful-but-partial load is the interesting case for debugging a "my file
  // opened but lost things" report — surface exactly what was dropped or upgraded.
  if (warnings.length) log.warn(`.kcard loaded with ${warnings.length} advisory(ies)`, { name: project.name || null, warnings });
  return { ok: true, project, warnings };
}

/**
 * The layer stack, if the file brought one.
 *
 * A stack is only usable when every layer is a matrix the size of the card, so the
 * check is strict and the fallback is graceful: `null` means "draw the composite",
 * which is always correct, just without the ability to peel a layer off.
 */
export function readProjectLayers(raw, { rows, cols }) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.layers)) return null;
  const kept = [];
  for (const layer of raw.layers.slice(0, KCARD_MAX_LAYERS)) {
    if (!layer || typeof layer !== 'object') continue;
    const matrix = Array.isArray(layer.matrix) ? layer.matrix : null;
    if (!matrix || matrix.length !== rows || matrix.some(r => !Array.isArray(r) || r.length !== cols)) continue;
    kept.push({
      id: typeof layer.id === 'string' ? layer.id.slice(0, 40) : null,
      name: typeof layer.name === 'string' ? layer.name.slice(0, 64) : 'Layer',
      kind: ['pattern', 'reference', 'annotation'].includes(layer.kind) ? layer.kind : 'pattern',
      visible: layer.visible !== false,
      locked: Boolean(layer.locked),
      opacity: Number.isFinite(layer.opacity) ? Math.min(1, Math.max(0, layer.opacity)) : 1,
      mode: typeof layer.mode === 'string' ? layer.mode : null,
      matrix
    });
  }
  return {
    layers: kept,
    activeId: typeof raw.activeId === 'string' ? raw.activeId.slice(0, 40) : null,
    dropped: kept.length < Math.min(raw.layers.length, KCARD_MAX_LAYERS)
  };
}
