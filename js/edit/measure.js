/**
 * Physical measurement: what a cell is *in the hand*, not just in the grid.
 *
 * The punchcard is a drawing of a real object. A 24-stitch window on standard gauge
 * is 108 mm wide and 122 mm tall for 24 rows, and a knitter deciding whether a motif
 * fits a sleeve cuff thinks in those numbers, not in cell indices. So every ruler,
 * readout and zoom level in the editor is derived from the machine profile's
 * `pitchX` / `pitchY` (millimetres per stitch and per row), which keeps the maths
 * honest when the gauge changes: the same 24 cells are 120 mm on a 5 mm bed.
 *
 * One thing this module deliberately refuses to promise: that a screen is really
 * 96 CSS pixels per inch. `physicalZoom` computes the cell size that *would* be
 * true-size under that assumption, and `calibrate` lets the user correct it against
 * a ruler held to the monitor — because claiming exact print scale from a browser
 * without calibration is a lie that ends with someone's cuff not fitting.
 */

export const MM_PER_INCH = 25.4;
export const CSS_PPI = 96; // the browser's definition of 1 CSS px, not a measurement

export const LENGTH_UNITS = ['mm', 'cm', 'inch', 'stitch'];

export function pitchFor(profile) {
  const pitchX = Number(profile && profile.pitchX);
  const pitchY = Number(profile && profile.pitchY);
  return {
    pitchX: Number.isFinite(pitchX) && pitchX > 0 ? pitchX : 4.5,
    pitchY: Number.isFinite(pitchY) && pitchY > 0 ? pitchY : 5.08
  };
}

export function mmToInch(mm) {
  return mm / MM_PER_INCH;
}

export function inchToMm(inch) {
  return inch * MM_PER_INCH;
}

/**
 * Format a length for display.
 *
 * Inches are rendered as a fraction where it is unambiguous ("4 1/4″") because that
 * is what a tape measure says, and decimal otherwise ("4.31″") because a
 * sixteenths-rounding of an odd metric number would be quietly wrong.
 */
export function formatLength(mm, unit = 'mm', { digits, fraction = true } = {}) {
  const value = Number(mm);
  if (!Number.isFinite(value)) return '--';
  if (unit === 'inch') {
    const inches = value / MM_PER_INCH;
    if (!fraction) return `${inches.toFixed(digits === undefined ? 2 : digits)}″`;
    const whole = Math.floor(inches);
    const sixteenths = Math.round((inches - whole) * 16);
    if (sixteenths === 16) return `${whole + 1}″`;
    if (sixteenths === 0) return `${inches < 0.5 ? inches.toFixed(2) : whole}″`;
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const divisor = gcd(16, sixteenths);
    const num = sixteenths / divisor;
    const den = 16 / divisor;
    return whole ? `${whole} ${num}/${den}″` : `${num}/${den}″`;
  }
  if (unit === 'cm') return `${(value / 10).toFixed(digits === undefined ? 1 : digits)} cm`;
  return `${value.toFixed(digits === undefined ? 1 : digits)} mm`;
}

/** Cell grid → real-world size. */
export function gridSizeMm(rows, cols, profileOrPitch) {
  const { pitchX, pitchY } = normalizePitch(profileOrPitch);
  const widthMm = cols * pitchX;
  const heightMm = rows * pitchY;
  return { widthMm, heightMm, widthIn: mmToInch(widthMm), heightIn: mmToInch(heightMm), rows, cols };
}

function normalizePitch(profileOrPitch) {
  if (!profileOrPitch) return pitchFor(null);
  const x = Number(profileOrPitch.pitchX ?? profileOrPitch.x);
  const y = Number(profileOrPitch.pitchY ?? profileOrPitch.y);
  if (Number.isFinite(x) && x > 0) return { pitchX: x, pitchY: Number.isFinite(y) && y > 0 ? y : x };
  return pitchFor(profileOrPitch);
}

export function cellOriginMm(r, c, profileOrPitch) {
  const { pitchX, pitchY } = normalizePitch(profileOrPitch);
  // Row 0 is the cast-on edge and is drawn at the bottom, so its *y* in mm is
  // measured from the far end: the ruler has to agree with the canvas or the two
  // disagree in a way the user reads as a broken tool.
  return { xMm: c * pitchX, yMm: r * pitchY };
}

export function stitchesForMm(mm, profileOrPitch, { round = 'nearest' } = {}) {
  const { pitchX } = normalizePitch(profileOrPitch);
  const raw = Number(mm) / pitchX;
  if (!Number.isFinite(raw)) return 0;
  if (round === 'up') return Math.ceil(raw);
  if (round === 'down') return Math.floor(raw);
  return Math.round(raw);
}

export function rowsForMm(mm, profileOrPitch, { round = 'nearest' } = {}) {
  const { pitchY } = normalizePitch(profileOrPitch);
  const raw = Number(mm) / pitchY;
  if (!Number.isFinite(raw)) return 0;
  if (round === 'up') return Math.ceil(raw);
  if (round === 'down') return Math.floor(raw);
  return Math.round(raw);
}

export function mmForStitches(stitches, profileOrPitch) {
  return (Number(stitches) || 0) * normalizePitch(profileOrPitch).pitchX;
}

export function mmForRows(rows, profileOrPitch) {
  return (Number(rows) || 0) * normalizePitch(profileOrPitch).pitchY;
}

/** Stitches and rows per 10 cm — the number every pattern and gauge swatch uses. */
export function gaugePer10Cm(profileOrPitch) {
  const { pitchX, pitchY } = normalizePitch(profileOrPitch);
  return { stitchesPer10Cm: 100 / pitchX, rowsPer10Cm: 100 / pitchY };
}

/**
 * Cell size in CSS px that renders the card at (approximately) real-world scale.
 *
 * `dpr` is `window.devicePixelRatio`, which does not change the answer: it changes
 * how many device pixels back a CSS pixel, and the browser has already promised the
 * CSS pixel is 1/96 inch.
 */
export function physicalCellPx(profileOrPitch, { scale = 1, calibration = 1 } = {}) {
  const { pitchX } = normalizePitch(profileOrPitch);
  const px = (pitchX / MM_PER_INCH) * CSS_PPI * scale * calibration;
  return Math.max(1, px);
}

/**
 * Fold in a measured correction.
 *
 * Ask the user to lay a ruler on the 100 mm test strip and type what they see;
 * `calibration` then multiplies every derived size. Reported back rather than stored
 * invisibly, because a 15 % miscalibration should be visible and revertible.
 */
export function calibrationFor(measuredMm, expectedMm) {
  const measured = Number(measuredMm);
  const expected = Number(expectedMm);
  if (!Number.isFinite(measured) || !Number.isFinite(expected) || measured <= 0 || expected <= 0) {
    return { calibration: 1, ok: false, error: 'Type the length you measured, in millimetres.' };
  }
  const calibration = expected / measured;
  if (calibration < 0.5 || calibration > 2) {
    return { calibration: 1, ok: false, error: 'That is too far off to be a display setting; check the ruler is on straight.' };
  }
  return { calibration, ok: true, measuredMm: measured, expectedMm: expected };
}

/**
 * Ruler ticks along one edge of the card.
 *
 * A tick per cell boundary, labelled every whole number of cells: a chart is counted
 * in stitches, so a mark at 45 mm (ten needles) is worth more to a knitter than one
 * at 50 mm that falls between two needles and cannot be typed on the bed at all. The
 * interval grows with zoom so the numbers never collide.
 *
 * Indices run 0…count: `index` is a boundary, so boundary `i` is the left edge of
 * cell `i` and the last one is the right edge of the card.
 */
export function rulerTicks(count, pitchMm, { cellPx = 12, unit = 'mm', minLabelPx = 44 } = {}) {
  const ticks = [];
  if (!(count > 0) || !(pitchMm > 0) || !(cellPx > 0)) return ticks;
  const every = Math.max(1, Math.ceil(minLabelPx / cellPx));
  for (let i = 0; i <= count; i++) {
    const mm = i * pitchMm;
    const major = i % every === 0;
    ticks.push({ index: i, mm, px: i * cellPx, major, every, label: major ? formatRulerLabel(mm, unit) : '' });
  }
  return ticks;
}

function formatRulerLabel(mm, unit) {
  if (unit === 'inch') return `${(mm / MM_PER_INCH).toFixed(mm < 25.4 ? 1 : 0)}"`;
  if (unit === 'cm') return `${(mm / 10).toFixed(mm < 100 ? 1 : 0)}`;
  return `${Math.round(mm)}`;
}

/** Distance and bearing between two cells, in stitches, rows and millimetres. */
export function measureBetween(a, b, profileOrPitch) {
  const { pitchX, pitchY } = normalizePitch(profileOrPitch);
  const dC = b.c - a.c;
  const dR = b.r - a.r;
  const xMm = dC * pitchX;
  const yMm = dR * pitchY;
  const lengthMm = Math.hypot(xMm, yMm);
  return {
    dStitches: dC,
    dRows: dR,
    absStitches: Math.abs(dC),
    absRows: Math.abs(dR),
    xMm,
    yMm,
    lengthMm,
    lengthIn: mmToInch(lengthMm),
    angleDeg: (Math.atan2(yMm, xMm) * 180) / Math.PI,
    // A knitter measuring a raglan line wants "over 6, up 10", not a bearing, so
    // both are given and neither is derived from rounding the other.
    slope: dR === 0 ? 'horizontal' : dC === 0 ? 'vertical' : `${Math.abs(dC)}:${Math.abs(dR)}`,
    diagonal: dC !== 0 && dR !== 0 && Math.abs(dC) === Math.abs(dR)
  };
}

/** Angle in degrees, measured from the needle bed toward the fabric length. */
export function angleBetween(a, b) {
  const dC = b.c - a.c;
  const dR = b.r - a.r;
  if (!dC && !dR) return { angleDeg: 0, cardinal: 'point' };
  const raw = (Math.atan2(dR, dC) * 180) / Math.PI;
  return { angleDeg: raw, cardinal: cardinalFor(raw) };
}

function cardinalFor(deg) {
  if (Math.abs(deg) < 1) return 'along the needle bed →';
  if (Math.abs(deg - 90) < 1) return 'up the fabric ↑';
  if (Math.abs(deg + 90) < 1) return 'down the fabric ↓';
  if (Math.abs(deg - 45) < 1) return 'diagonal up ↗';
  if (Math.abs(deg + 45) < 1) return 'diagonal down ↘';
  if (Math.abs(deg - 135) < 1) return 'diagonal up-left ↖';
  if (Math.abs(deg + 135) < 1) return 'diagonal down-left ↙';
  return `${deg.toFixed(1)}° from the needle bed`;
}

/**
 * Needle band labels.
 *
 * Two conventions are in play and both are real, so both are offered rather than
 * one being asserted as correct:
 *
 *   - `centre-zero`, the number printed on a Brother / Silver Reed needle band: the
 *     mark 0 sits at the middle of the bed and rises outwards, so needle positions
 *     are "12L" or "37R" relative to centre;
 *   - `left-origin`, the 1-based count a chart is written with, needle 1 at the
 *     knitting-direction end.
 *
 * On an even-width bed there is no needle under the centre mark, so the two
 * innermost needles are both 0 (written 0L and 0R) and that is flagged rather than
 * smoothed over — a wrong needle number is a dropped stitch.
 */
export function needleLabels({ total = 0, origin = 'centre-zero' } = {}) {
  const out = [];
  const count = Math.max(0, Math.trunc(total));
  const middle = (count - 1) / 2;
  const even = count > 0 && count % 2 === 0;
  for (let i = 0; i < count; i++) {
    if (origin === 'left-origin') {
      out.push({ index: i, label: `${i + 1}`, side: 'chart', fromCentre: null, ambiguous: false });
      continue;
    }
    // Signed distance from the centre of the bed, in needles. On an even bed the
    // centre falls between two needles, so the distance is a half-integer and the
    // two innermost needles are both "0" — distinguished only by side, and flagged
    // as ambiguous, because a knitter reading "0" off a 200-needle band has to
    // choose which one they meant.
    const d = i - middle;
    const side = d > 0 ? 'R' : d < 0 ? 'L' : 'C';
    const value = even ? Math.round(Math.abs(d) - 0.5) : Math.round(Math.abs(d));
    out.push({
      index: i,
      label: value === 0 && side === 'C' ? '0' : value === 0 ? `0${side}` : `${value}${side}`,
      side,
      value,
      fromCentre: d,
      ambiguous: even && value === 0
    });
  }
  return out;
}

export function needleLabelAt(index, options) {
  const total = Number(options && options.total) || 0;
  if (!(index >= 0) || index >= total) return { index, label: '--', error: 'Off the bed.' };
  return needleLabels(options)[index];
}

/**
 * Half-stitch / sub-grid positioning.
 *
 * On a single bed a loop cannot sit between two needles, so this is *not* a chart
 * operation — it is how a transfer target is drawn during a two-position carriage
 * move, and how a ribber's needle sits relative to the main bed. `offsetNeedles`
 * converts a half-stitch drawing offset into the whole-needle displacement plus the
 * remaining half-cell for display, which is the only honest decomposition.
 */
export function subGridOffset(value, { divisions = 2 } = {}) {
  const step = Math.max(1, Math.trunc(divisions) || 1);
  const units = Math.trunc(value * step);
  const whole = Math.trunc(units / step);
  const remainder = units % step;
  return {
    cells: whole,
    remainder,
    displayOffset: remainder / step,
    divisions: step,
    note: remainder ? 'a display offset only — a loop cannot sit between two needles' : ''
  };
}

export function offsetNeedleNumber(index, { total, offset = 0, origin = 'left-origin' } = {}) {
  const shifted = index + Math.trunc(offset);
  if (shifted < 0 || shifted >= total) return { ok: false, error: `Needle ${shifted + 1} is off a ${total}-needle bed.`, index: shifted };
  return { ok: true, index: shifted, ...needleLabelAt(shifted, { total, origin }) };
}

/** The HUD line under the pointer: "r14 · n7 · 63×32 mm from cast-on". */
export function cellReadout(r, c, profileOrPitch, { unit = 'mm' } = {}) {
  const { pitchX, pitchY } = normalizePitch(profileOrPitch);
  const xMm = c * pitchX;
  const yMm = r * pitchY;
  return {
    row: r + 1,
    needle: c + 1,
    xMm,
    yMm,
    size: gridSizeMm(1, 1, { pitchX, pitchY }),
    position: `${formatLength(xMm, unit)} × ${formatLength(yMm, unit)}`,
    label: `row ${r + 1} · needle ${c + 1} · ${formatLength(xMm, unit)} from left, ${formatLength(yMm, unit)} from cast-on`
  };
}
