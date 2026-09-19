/**
 * Annotations: the parts of a pattern that are for the knitter, not the machine.
 *
 * "3-needle cast on, then 4 rows", an arrow at the shoulder shaping, a dimension
 * line across the cuff. None of it may ever reach a punchcard or a G-code toolpath,
 * so annotations live in their own list with their own kind tag and are filtered out
 * at the compile boundary rather than remembered to be excluded at each call site —
 * the difference between a design note and a stray hole in row 6.
 *
 * Anchors are in *cell* coordinates, so an annotation follows the chart when rows are
 * inserted. `follow` states which way it moves: with the cell it is pinned to, or
 * with the edge of the card (a dimension line across the whole cuff belongs to the
 * cuff, not to needle 4).
 */

import { measureBetween, formatLength } from './measure.js';
import { cellKey } from './select-ops.js';

let annotationCounter = 0;

function nextId() {
  annotationCounter += 1;
  return `anno${annotationCounter}`;
}

export const ANNOTATION_KINDS = ['note', 'pin', 'label', 'dimension', 'arrow', 'symbol'];

/** Kinds that must never be compiled. Everything in this module is one of these. */
export const ANNOTATION_LAYER_KIND = 'annotation';

export function createAnnotation(kind, { r = 0, c = 0, r2 = null, c2 = null, text = '', color = null, follow = 'cell', id = null, at = null } = {}) {
  if (!ANNOTATION_KINDS.includes(kind)) return null;
  const anchor = { r: finite(r, 0), c: finite(c, 0) };
  const end = r2 === null && c2 === null ? null : { r: finite(r2, anchor.r), c: finite(c2, anchor.c) };
  return {
    id: id || nextId(),
    kind,
    ...anchor,
    end,
    text: String(text).slice(0, 2000),
    color,
    // `follow: 'cell'` rides along when rows or needles are inserted before it;
    // `follow: 'card'` stays pinned to the edge it was measured from, which is what
    // a whole-garment dimension wants.
    follow: follow === 'card' ? 'card' : 'cell',
    at: at || Date.now()
  };
}

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function addAnnotation(list, kind, spec) {
  const annotation = createAnnotation(kind, spec);
  if (!annotation) return { ok: false, error: `Unknown annotation kind "${kind}".`, list };
  if (annotation.kind === 'dimension' && !annotation.end) {
    return { ok: false, error: 'A dimension line needs two corners — drag from one to the other.', list };
  }
  list.push(annotation);
  return { ok: true, annotation, list };
}

export function updateAnnotation(list, id, patch = {}) {
  const found = list.find(item => item.id === id);
  if (!found) return { ok: false, error: 'That note is gone.', list };
  if (typeof patch.text === 'string') found.text = patch.text.slice(0, 2000);
  if (patch.color === null || typeof patch.color === 'string') found.color = patch.color;
  if (Number.isFinite(patch.r)) found.r = Math.trunc(patch.r);
  if (Number.isFinite(patch.c)) found.c = Math.trunc(patch.c);
  if (found.end) {
    if (Number.isFinite(patch.r2)) found.end.r = Math.trunc(patch.r2);
    if (Number.isFinite(patch.c2)) found.end.c = Math.trunc(patch.c2);
  }
  if (patch.follow === 'card' || patch.follow === 'cell') found.follow = patch.follow;
  return { ok: true, annotation: found, list };
}

export function moveAnnotation(list, id, dr, dc) {
  const found = list.find(item => item.id === id);
  if (!found) return { ok: false, error: 'That note is gone.', list };
  found.r += Math.trunc(dr) || 0;
  found.c += Math.trunc(dc) || 0;
  if (found.end) {
    found.end.r += Math.trunc(dr) || 0;
    found.end.c += Math.trunc(dc) || 0;
  }
  return { ok: true, annotation: found, list };
}

/**
 * Shift annotations when the card itself changes shape.
 *
 * The two cases that lose work if handled wrongly: a note sitting *on* an inserted
 * row should end up below it, and a note past the deletion point has to come back a
 * row, or the label drifts off the shaping it was written against.
 */
export function shiftForInsert(list, { axis = 'row', at, count = 1 }) {
  const step = Math.trunc(count) || 0;
  let moved = 0;
  for (const item of list) {
    if (item.follow !== 'cell') continue;
    const key = axis === 'row' ? 'r' : 'c';
    const endKey = axis === 'row' ? 'r' : 'c';
    if (item[key] >= at) {
      item[key] += step;
      moved++;
    }
    if (item.end && item.end[endKey] >= at) item.end[endKey] += step;
  }
  return { list, moved };
}

export function shiftForDelete(list, { axis = 'row', at, count = 1 }) {
  const step = Math.trunc(count) || 0;
  const keep = [];
  let dropped = 0;
  for (const item of list) {
    const key = axis === 'row' ? 'r' : 'c';
    const value = item[key];
    if (item.follow === 'cell' && value >= at && value < at + step) {
      dropped++;
      continue; // the row it annotated no longer exists
    }
    if (item.follow === 'cell' && value >= at + step) item[key] = value - step;
    if (item.end) {
      const endKey = axis === 'row' ? 'r' : 'c';
      if (item.end[endKey] >= at + step) item.end[endKey] -= step;
      else if (item.end[endKey] >= at) item.end[endKey] = at;
    }
    keep.push(item);
  }
  list.length = 0;
  list.push(...keep);
  return { list, dropped };
}

export function annotationsInRect(list, rect) {
  if (!rect) return [...list];
  const { r1, r2, c1, c2 } = rect;
  return list.filter(item => item.r >= r1 && item.r <= r2 && item.c >= c1 && item.c <= c2);
}

export function deleteAnnotation(list, id) {
  const before = list.length;
  const out = list.filter(item => item.id !== id);
  list.length = 0;
  list.push(...out);
  return { ok: list.length < before, removed: before - list.length, list };
}

export function clearAnnotations(list, { kind = null } = {}) {
  const before = list.length;
  const out = kind ? list.filter(item => item.kind !== kind) : [];
  const removed = before - out.length;
  list.length = 0;
  list.push(...out);
  return { removed, list };
}

/**
 * The text a dimension line shows.
 *
 * Both units and both counts, because a knitter reads "12 sts / 54 mm" off a chart
 * and writes "54 mm" into a notes app, and the two have to be reconcilable when the
 * gauge changes later.
 *
 * Always the same shape, even for a note that is not a dimension: a caller rendering
 * a list of mixed annotations should not have to type-check each one first.
 */
export function dimensionText(annotation, profileOrPitch, { unit = 'mm' } = {}) {
  if (!annotation) return { text: '', label: '', measurement: null, full: '' };
  if (!annotation.end) {
    return { text: annotation.text, label: annotation.kind, measurement: null, full: annotation.text };
  }
  const measurement = measureBetween(annotation, annotation.end, profileOrPitch);
  const parts = [
    `${measurement.absStitches} st${measurement.absStitches === 1 ? '' : 's'}`,
    `${measurement.absRows} row${measurement.absRows === 1 ? '' : 's'}`,
    formatLength(Math.abs(measurement.xMm), unit),
    `× ${formatLength(Math.abs(measurement.yMm), unit)}`
  ];
  const angle = Math.abs(measurement.angleDeg);
  const label =
    measurement.dStitches === 0 && measurement.dRows !== 0
      ? 'vertical'
      : measurement.dRows === 0 && measurement.dStitches !== 0
        ? 'horizontal'
        : measurement.dRows === 0
          ? 'a point'
          : `${angle.toFixed(1)}° ${measurement.slope}`;
  const text = parts.join(' ');
  return { text, label, measurement, full: `${text} · ${label}` };
}

/** Pin text, with the cell it is pinned to spelled out for the sidebar list. */
export function annotationSummary(annotation) {
  const where = `row ${annotation.r + 1} · needle ${annotation.c + 1}`;
  const body = annotation.text.trim() || `(${annotation.kind})`;
  return { id: annotation.id, kind: annotation.kind, where, body, key: cellKey(annotation.r, annotation.c) };
}

/**
 * Validate a list read back from a file.
 *
 * Anything malformed is dropped rather than repaired: an annotation that points at a
 * row which does not exist would be a lie on paper, and a lying note on a pattern is
 * worse than no note.
 */
export function sanitizeAnnotations(input, { rows = Infinity, cols = Infinity, limit = 500 } = {}) {
  const out = [];
  const dropped = [];
  if (!Array.isArray(input)) return { annotations: out, dropped: ['not a list'] };
  for (const item of input.slice(0, limit)) {
    const kind = item && ANNOTATION_KINDS.includes(item.kind) ? item.kind : null;
    const r = Number(item && item.r);
    const c = Number(item && item.c);
    if (!kind || !Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= rows || c >= cols) {
      dropped.push(String((item && item.id) || 'unknown'));
      continue;
    }
    const hasEnd = item.end && Number.isInteger(item.end.r) && Number.isInteger(item.end.c);
    out.push(
      createAnnotation(kind, {
        r,
        c,
        r2: hasEnd ? item.end.r : null,
        c2: hasEnd ? item.end.c : null,
        text: item.text,
        color: typeof item.color === 'string' ? item.color : null,
        follow: item.follow,
        id: typeof item.id === 'string' ? item.id : null,
        at: Number.isFinite(item.at) ? item.at : null
      })
    );
  }
  if (input.length > limit) dropped.push(`…and ${input.length - limit} more (over the ${limit}-note limit)`);
  return { annotations: out.filter(Boolean), dropped };
}
