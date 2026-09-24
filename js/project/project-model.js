/**
 * The Project superstructure — the data model that makes KNITCAT one studio
 * instead of twelve tools that don't know about each other.
 *
 * WHY THIS EXISTS
 * ---------------
 * The .kcard layer (kcard.js) and the autosave layer (backups.js) already make a
 * single *chart* durable. But a knitter isn't making "a chart" — they're making
 * "Benji's Winter Sweater," which owns a machine, a stash, a gauge log, several
 * garments, each garment several pieces, each piece a chart AND a row counter AND
 * progress. Nothing carried that hierarchy, so the editor, the clothes engine, the
 * schedule and the Brother sim each floated a lone artifact with no shared parent.
 *
 * THIS MODULE is that parent. It is deliberately:
 *   - PURE and DOM-free at import (no window/document/localStorage touched) so it
 *     runs under `node --test` exactly as it runs in the page;
 *   - DETERMINISTIC — every function is a plain map from input to output; time is
 *     injected (`now()`), never read at module load;
 *   - JSON-safe — a Project serialises to a boring object that slots straight into
 *     the existing PROJECTS store and the .kcard envelope; and
 *   - VALIDATING on the way back in — hand-edited or future files are coerced and
 *     capped, never trusted, mirroring the discipline in kcard.js.
 *
 * The arithmetic is real knitting math, documented where it looks up:
 *   - gauge (sts/rows per 10 cm) → cast-on and row counts for a target width,
 *   - a gauge-derived yarn-length estimator (why the closed form works is in
 *     estimateYarnMeters),
 *   - a row-weighted completion percentage so a finished sleeve counts as much as
 *     a finished cuff, not as "one of two pieces."
 */

import { logger } from '../core/logging.js';

const log = logger('project/project-model');

/** Bump when the persisted superstructure shape changes; readers migrate down. */
export const SUPERSTRUCTURE_VERSION = 1;

/** Caps so a hand-edited or runaway file can't DoS the hub that renders it. */
export const MAX_GARMENTS = 500;
export const MAX_PIECES = 2000;
export const MAX_CHARTS = 2000;
export const MAX_YARNS = 2000;
export const MAX_GAUGES = 2000;
export const MAX_TIMELINE = 2000;
const NAME_MAX = 200;
const TEXT_MAX = 4000;

/**
 * Standard yarn conversion, metres per 100 g, by weight name. These are the
 * commonly-published craft-industry ranges (midpoint of each band); a knitter's
 * exact band varies by mill, but the ORDERING and rough magnitude are stable, and
 * that is all an estimate needs. Unknown weights return null rather than a fake.
 */
export const WEIGHT_METERS_PER_100G = Object.freeze({
  lace: 800,
  fingering: 400,
  sport: 300,
  dk: 250,
  worsted: 180,
  aran: 130,
  bulky: 100,
  superbulky: 60,
  jumbo: 40
});

/** Garment families the hub can group by (taxonomy seed; content, not logic). */
export const GARMENT_CATEGORIES = Object.freeze([
  'hat', 'top', 'bottom', 'sleeve', 'neckline', 'hem',
  'accessory', 'bag', 'home', 'baby', 'pet', 'menswear', 'other'
]);

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
const int = (n, dflt = 0) => (Number.isFinite(n) ? Math.round(n) : dflt);
const clean = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');

/** Positive number or null — the guard every gauge/yarn reading shares. */
function posNum(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

// ─── gauge → dimensions ──────────────────────────────────────────────────────

/** Stitches to cast on for `widthCm` at `stsPer10cm` (half-stitch rounds to nearest whole needle). */
export function cmToStitches(stsPer10cm, widthCm) {
  const g = posNum(stsPer10cm);
  const w = posNum(widthCm);
  if (!g || !w) return 0;
  return Math.max(1, Math.round((g * w) / 10));
}

/** Rows to work for `lengthCm` at `rowsPer10cm`. */
export function cmToRows(rowsPer10cm, lengthCm) {
  const g = posNum(rowsPer10cm);
  const l = posNum(lengthCm);
  if (!g || !l) return 0;
  return Math.max(1, Math.round((g * l) / 10));
}

/**
 * Cast-on and row count for a rectangular piece from a gauge object
 * ({ stsPer10cm, rowsPer10cm }) and target cm. This is the single place the app
 * converts "I want a 56 cm hat" into needles and rows, so garments, the schedule
 * and feasibility all agree on one answer.
 */
export function pieceDimensions(gauge, size = {}) {
  const sts = posNum(gauge?.stsPer10cm);
  const rows = posNum(gauge?.rowsPer10cm);
  return {
    castOn: sts ? cmToStitches(sts, size.widthCm) : 0,
    rowCount: rows ? cmToRows(rows, size.lengthCm) : 0
  };
}

/**
 * Yarn length (metres) for a flat rectangular piece, estimated from gauge alone —
 * no black-box constant.
 *
 * A knit stitch lays yarn across its own width and up-and-over two row heights,
 * so yarn per stitch ≈ (1/stsPerCm + 2·rowsPerCm) cm. A piece holds
 * (stsPerCm·w)·(rowsPerCm·l) stitches. Multiplying, the stitch-density factors
 * cancel into a clean closed form: total cm ≈ w·l·(rowsPerCm + 2·stsPerCm). It is
 * monotone in area and in gauge (denser fabric, more yarn), which is the behaviour
 * a knitter sanity-checks by eye. `wasteFactor` covers floats, swatching and
 * seam allowance (default 1.12 ≈ 12%).
 */
export function estimateYarnMeters(gauge, size = {}, wasteFactor = 1.12) {
  const sts10 = posNum(gauge?.stsPer10cm);
  const rows10 = posNum(gauge?.rowsPer10cm);
  const w = posNum(size.widthCm);
  const l = posNum(size.lengthCm);
  if (!sts10 || !rows10 || !w || !l) return 0;
  const stsPerCm = sts10 / 10;
  const rowsPerCm = rows10 / 10;
  const cm = w * l * (rowsPerCm + 2 * stsPerCm) * clamp(wasteFactor, 1, 3);
  return Math.round((cm / 100) * 10) / 10; // one decimal
}

/** Resolve a weight name to metres-per-100g, case/spacing-tolerant; null if unknown. */
export function metersPer100g(weight) {
  if (typeof weight !== 'string') return null;
  const key = weight.toLowerCase().replace(/[\s_-]/g, '');
  const alias = { superfine: 'fingering', lightdk: 'dk', lightworsted: 'worsted', afghani: 'aran', chunky: 'bulky', gri: 'lace' };
  const name = alias[key] || key;
  return WEIGHT_METERS_PER_100G[name] ?? null;
}

/** Grams needed for a length of yarn of a given weight (ceiling — you buy the ball, not the gram). */
export function gramsFromMeters(meters, weight) {
  const per100 = metersPer100g(weight);
  const m = posNum(meters);
  if (!per100 || !m) return null;
  return Math.ceil((m * 100) / per100);
}

/**
 * Grams of a named weight to knit a piece — the "how many balls?" answer, built
 * entirely from gauge + size + the weight table (estimateYarnMeters × gramsFromMeters).
 */
export function estimateYarnGrams(gauge, size = {}, weight) {
  const meters = estimateYarnMeters(gauge, size);
  return meters > 0 ? gramsFromMeters(meters, weight) : null;
}

/**
 * Gauge difference when substituting yarn, as a percentage of stitch count
 * (positive = the alternative knits denser, so the piece comes out smaller). The
 * knitter reads this as "expect your 56 cm hat to land ~8% smaller."
 */
export function substitutionDelta(baseGauge, altGauge) {
  const a = posNum(baseGauge?.stsPer10cm);
  const b = posNum(altGauge?.stsPer10cm);
  if (!a || !b) return null;
  return Math.round(((b / a - 1) * 100) * 10) / 10;
}

// ─── progress ────────────────────────────────────────────────────────────────

/** Fraction (0..1) done on one piece, by rows. A piece with no defined length is 0. */
export function pieceProgress(piece) {
  const total = posNum(piece?.totalRows);
  if (!total) return 0;
  return clamp((posNum(piece?.currentRow) || 0) / total, 0, 1);
}

/** "row 84 of 142" — the phrase the hub and editor status line both show. */
export function currentRowLabel(piece) {
  const total = int(piece?.totalRows, 0);
  const cur = clamp(int(piece?.currentRow, 0), 0, total || Infinity);
  return total > 0 ? `row ${cur} of ${total}` : `row ${cur}`;
}

/**
 * Row-weighted completion of a list of pieces (0..100). Weighting by totalRows —
 * not by piece count — means a 140-row body dominates a 40-row cuff, which is
 * how progress actually feels. Pieces with no row count are ignored so an
 * un-planned piece can't silently tank the number.
 */
export function weightedCompletion(pieces) {
  let done = 0;
  let weight = 0;
  for (const p of pieces || []) {
    const total = posNum(p?.totalRows);
    if (!total) continue;
    done += clamp(int(p?.currentRow, 0), 0, total);
    weight += total;
  }
  return weight > 0 ? clamp(Math.round((done / weight) * 100), 0, 100) : 0;
}

/** First in-progress (or untouched) piece — what to knit next. */
export function nextPiece(garmentsOrPieces) {
  const list = Array.isArray(garmentsOrPieces)
    ? (garmentsOrPieces[0]?.pieces ? garmentsOrPieces.flatMap(g => g.pieces || []) : garmentsOrPieces)
    : [];
  return list.find(p => pieceProgress(p) < 1) || null;
}

/** "Front panel — row 84 of 142" for the Resume card; null when everything is done. */
export function nextAction(garments) {
  const p = nextPiece(garments);
  if (!p) return null;
  return { pieceId: p.id, pieceName: p.name, label: currentRowLabel(p) };
}

// ─── factories (plain JSON-safe objects; ids are caller-supplied or generated) ─

let _seq = 0;
const uid = prefix => `${prefix}_${Date.now ? Date.now().toString(36) : ''}_${(_seq++).toString(36)}`;

export function newChart(fields = {}) {
  return {
    id: clean(fields.id, 64) || uid('chart'),
    name: clean(fields.name, NAME_MAX) || 'Untitled chart',
    mode: clean(fields.mode, 16) || null,
    rows: int(fields.rows, 0),
    cols: int(fields.cols, 0),
    // Optional full matrix so the Studio hub can round-trip a live card. Left
    // unvalidated here on purpose — kcard.js is the single authority on a chart
    // that is about to touch the editor; the model only stores what it is handed.
    cells: Array.isArray(fields.cells) ? fields.cells : null
  };
}

export function newPiece(fields = {}) {
  return {
    id: clean(fields.id, 64) || uid('piece'),
    name: clean(fields.name, NAME_MAX) || 'Piece',
    chartId: clean(fields.chartId, 64) || null,
    totalRows: Math.max(0, int(fields.totalRows, 0)),
    currentRow: clamp(int(fields.currentRow, 0), 0, Math.max(0, int(fields.totalRows, 0)) || Infinity),
    repeatsTotal: Math.max(0, int(fields.repeatsTotal, 0)),
    repeatsDone: clamp(int(fields.repeatsDone, 0), 0, Math.max(0, int(fields.repeatsTotal, 0)) || Infinity),
    startedAt: clean(fields.startedAt, 40) || null,
    finishedAt: clean(fields.finishedAt, 40) || null,
    notes: clean(fields.notes, TEXT_MAX)
  };
}

export function newGarment(fields = {}) {
  return {
    id: clean(fields.id, 64) || uid('garment'),
    name: clean(fields.name, NAME_MAX) || 'Untitled garment',
    category: GARMENT_CATEGORIES.includes(fields.category) ? fields.category : 'other',
    size: clean(fields.size, NAME_MAX) || null,
    measurements: fields.measurements && typeof fields.measurements === 'object' ? { ...fields.measurements } : {},
    pieces: Array.isArray(fields.pieces) ? fields.pieces.slice(0, MAX_PIECES).map(newPiece) : [],
    assembly: clean(fields.assembly, TEXT_MAX)
  };
}

export function newYarn(fields = {}) {
  return {
    id: clean(fields.id, 64) || uid('yarn'),
    brand: clean(fields.brand, NAME_MAX),
    name: clean(fields.name, NAME_MAX) || 'Yarn',
    weight: clean(fields.weight, NAME_MAX),
    colour: clean(fields.colour, NAME_MAX),
    dyeLot: clean(fields.dyeLot, NAME_MAX),
    grams: Math.max(0, int(fields.grams, 0)),
    gramsLeft: Number.isFinite(fields.gramsLeft) ? Math.max(0, Math.round(fields.gramsLeft)) : null,
    metersPer100g: fields.metersPer100g ?? null
  };
}

export function newGauge(fields = {}) {
  return {
    id: clean(fields.id, 64) || uid('gauge'),
    yarnId: clean(fields.yarnId, 64) || null,
    machine: clean(fields.machine, NAME_MAX) || null,
    stsPer10cm: Number.isFinite(fields.stsPer10cm) ? fields.stsPer10cm : null,
    rowsPer10cm: Number.isFinite(fields.rowsPer10cm) ? fields.rowsPer10cm : null,
    tension: Number.isFinite(fields.tension) ? fields.tension : null,
    note: clean(fields.note, TEXT_MAX)
  };
}

export function newTimelineEvent(fields = {}, now) {
  return {
    id: clean(fields.id, 64) || uid('evt'),
    at: clean(fields.at, 40) || new Date(now ? now() : 0).toISOString(),
    kind: clean(fields.kind, 32) || 'note',
    text: clean(fields.text, TEXT_MAX)
  };
}

// ─── the Project ───────────────────────────────────────────────────────────────

export class Project {
  constructor(fields = {}) {
    this.version = SUPERSTRUCTURE_VERSION;
    this.id = clean(fields.id, 64) || uid('project');
    this.name = clean(fields.name, NAME_MAX) || 'Untitled project';
    this.machine = clean(fields.machine, NAME_MAX) || null;
    this.gaugeId = clean(fields.gaugeId, 64) || null;
    this.charts = Array.isArray(fields.charts) ? fields.charts.map(newChart) : [];
    this.garments = Array.isArray(fields.garments) ? fields.garments.map(newGarment) : [];
    this.yarns = Array.isArray(fields.yarns) ? fields.yarns.map(newYarn) : [];
    this.gauges = Array.isArray(fields.gauges) ? fields.gauges.map(newGauge) : [];
    this.timeline = Array.isArray(fields.timeline) ? fields.timeline.map(t => newTimelineEvent(t)) : [];
    this.favourites = fields.favourites && typeof fields.favourites === 'object' ? { ...fields.favourites } : {};
    this.createdAt = clean(fields.createdAt, 40) || null;
    this.updatedAt = clean(fields.updatedAt, 40) || null;
  }

  static create(fields = {}, now = () => Date.now()) {
    const p = new Project(fields);
    const iso = new Date(now()).toISOString();
    p.createdAt = p.createdAt || iso;
    p.updatedAt = p.updatedAt || iso;
    return p;
  }

  /**
   * Rebuild from arbitrary (possibly hostile/stale) input. Never throws; drops
   * malformed entries, enforces caps, dedupes ids, and refuses anything written by
   * a newer version rather than guessing at a shape it has not seen.
   */
  static fromJSON(obj) {
    const warnings = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { project: null, warnings: ['A project must be a JSON object.'] };
    }
    const v = Number.isFinite(obj.version) ? obj.version : 0;
    if (v > SUPERSTRUCTURE_VERSION) {
      log.warn('refusing to load a superstructure written by a newer KNITCAT', { version: v, latest: SUPERSTRUCTURE_VERSION });
      return {
        project: null,
        warnings: [`Written by a newer KNITCAT (superstructure v${v} > v${SUPERSTRUCTURE_VERSION}).`]
      };
    }
    if (v < SUPERSTRUCTURE_VERSION && v !== 0) warnings.push(`Upgraded superstructure v${v} → v${SUPERSTRUCTURE_VERSION}.`);

    const dedupe = (list, make, cap, label) => {
      const seen = new Set();
      const out = [];
      if (Array.isArray(list) && list.length > cap) {
        log.warn(`a project's ${label} list is past the ${cap}-entry ceiling — the extras were dropped`, { count: list.length, cap });
      }
      for (const raw of (list || []).slice(0, cap)) {
        const item = make(raw);
        if (seen.has(item.id)) { item.id = uid(item.id.split('_')[0]); }
        seen.add(item.id);
        out.push(item);
      }
      return out;
    };

    const project = new Project({
      id: obj.id,
      name: clean(obj.name, NAME_MAX) || 'Untitled project',
      machine: clean(obj.machine, NAME_MAX) || null,
      gaugeId: clean(obj.gaugeId, 64) || null,
      charts: dedupe(obj.charts, newChart, MAX_CHARTS, 'chart'),
      garments: dedupe(obj.garments, g => {
        const gar = newGarment(g);
        gar.pieces = dedupe(gar.pieces, newPiece, MAX_PIECES, 'piece');
        return gar;
      }, MAX_GARMENTS, 'garment'),
      yarns: dedupe(obj.yarns, newYarn, MAX_YARNS, 'yarn'),
      gauges: dedupe(obj.gauges, newGauge, MAX_GAUGES, 'gauge'),
      timeline: dedupe(obj.timeline, t => newTimelineEvent(t), MAX_TIMELINE, 'timeline event'),
      favourites: obj.favourites,
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt
    });
    return { project, warnings };
  }

  toJSON() {
    return {
      version: this.version,
      id: this.id,
      name: this.name,
      machine: this.machine,
      gaugeId: this.gaugeId,
      charts: this.charts,
      garments: this.garments,
      yarns: this.yarns,
      gauges: this.gauges,
      timeline: this.timeline,
      favourites: this.favourites,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  // additive helpers keep id-creation and updatedAt stamping in one place ──────

  touch(now = () => Date.now()) {
    this.updatedAt = new Date(now()).toISOString();
    return this;
  }

  addChart(fields, now) { const c = newChart(fields); this.charts.push(c); this.touch(now); return c; }
  addGarment(fields, now) { const g = newGarment(fields); this.garments.push(g); this.touch(now); return g; }
  addPiece(garmentId, fields, now) {
    const g = this.garments.find(x => x.id === garmentId);
    if (!g) return null;
    const p = newPiece(fields);
    g.pieces.push(p);
    this.touch(now);
    return p;
  }
  addYarn(fields, now) { const y = newYarn(fields); this.yarns.push(y); this.touch(now); return y; }
  addGauge(fields, now) { const g = newGauge(fields); this.gauges.push(g); this.touch(now); return g; }
  addTimeline(fields, now) { const e = newTimelineEvent(fields, now); this.timeline.push(e); this.touch(now); return e; }

  /** All pieces across every garment, in garment order. */
  allPieces() { return this.garments.flatMap(g => g.pieces || []); }

  /** The active gauge object (by gaugeId, else the only/first recorded, else null). */
  activeGauge() {
    return this.gauges.find(g => g.id === this.gaugeId) || this.gauges[0] || null;
  }

  /** 0..100 completion, row-weighted across the whole project. */
  completion() { return weightedCompletion(this.allPieces()); }

  /** The Resume line: next in-progress piece, or a done/cold-start message. */
  resumeLine() {
    const next = nextAction(this.garments);
    if (!next) return this.allPieces().length ? 'Everything is knitted — congratulations.' : 'No pieces planned yet.';
    return `${next.pieceName} — ${next.label}`;
  }
}

/**
 * The hub summary — one small, JSON-safe object the landing page renders per
 * project, so it never has to walk the whole tree to draw a card.
 */
export function summarizeProject(project) {
  const pieces = project.allPieces ? project.allPieces() : project.pieces || [];
  return {
    id: project.id,
    name: project.name,
    machine: project.machine || null,
    garmentCount: (project.garments || []).length,
    chartCount: (project.charts || []).length,
    yarnCount: (project.yarns || []).length,
    pieceCount: pieces.length,
    completion: project.completion ? project.completion() : weightedCompletion(pieces),
    resume: project.resumeLine ? project.resumeLine() : null,
    updatedAt: project.updatedAt || null,
    status: pieces.length === 0 ? 'draft' : project.completion?.() > 0 ? 'in progress' : 'not started'
  };
}
