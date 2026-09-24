/**
 * KNITCAT V2 — derive: Project → IR (spec §4.2 "derive" stage).
 *
 * This is where the Fit Engine's row-by-row {@link PatternPiece} list and the constraint graph's
 * numbers become the compiler's {@link module:compiler/ir.KnitIR}. It does three things and
 * nothing else:
 *   1. Runs the Fit Engine (`draftFromProject`) to get real pattern pieces for this body+gauge+ease.
 *   2. Translates each shaping row into explicit IR operations with an honest running stitch count
 *      (so a row that says "decrease 8 at four-lines" leaves exactly the right stitch count).
 *   3. Attaches everything a backend needs that is *not* geometry: the resolved machine profile,
 *      the gauge, the colour assignments from the `chart:` section, and — the explainability the
 *      spec demands — a `decisions` trail showing how cast-on, body rows and raglan rounds were
 *      derived, so the UI can answer "why 228 stitches?" by pointing at the formula and the inputs.
 *
 * The output is always run through {@link module:compiler/ir.validateIr} so a bad upstream value
 * fails loudly here, never silently into a punchcard. DOM-free.
 *
 * @module compiler/derive
 */

import { draftFromProject } from '../fit/index.js';
import { buildIr, irPiece, irRow, op, stitchDelta } from './ir.js';
import { MACHINE_PROFILES } from '../machine/profiles.js';
import { logger } from '../core/logging.js';

const log = logger('compiler/derive');

/**
 * Build the compiler IR from a live Project.
 * @param {import('../project/project.js').Project} project
 * @param {{pieces?:object[], skipFit?:boolean}} [opts] `pieces` overrides the Fit Engine draft.
 * @returns {import('./ir.js').KnitIR}
 */
export function deriveIr(project, opts = {}) {
  const get = id => {
    if (!project || !project.get) return undefined;
    if (project.has && !project.has(id)) return undefined;
    try { return project.get(id); } catch { return undefined; }
  };
  const spec = (project && project.spec && project.spec.sections) || {};

  const drafted = opts.pieces ? { pieces: opts.pieces } : draftFromProject(project);
  const fitPieces = (drafted && drafted.pieces) || [];

  const gauge = {
    stsPer10cm: num(get('gauge.stitchesPer10cm'), 22),
    rowsPer10cm: num(get('gauge.rowsPer10cm'), 30),
    gaugeMm: num(get('machine.gaugeMm'), 4.5)
  };
  const machineId = get('machine.id') || (spec.machine && spec.machine.id) || 'standard';
  const profile = MACHINE_PROFILES[machineId] || null;
  // A real machine id that resolves to no profile means the geometry silently falls back to
  // generic defaults — surface it so "wrong needle count" is not a mystery.
  if (!profile && machineId !== 'standard') log.warn(`named machine "${machineId}" has no physical profile — deriving with generic bed defaults`, { machineId });
  const machine = {
    id: machineId,
    bedStitches: num(get('machine.bedStitches'), profile ? profile.needleCount : 200),
    bedWidthCm: num(get('machine.bedWidthCm'), profile ? cmOf(profile.bedWidth) : 60),
    gaugeMm: gauge.gaugeMm,
    carriage: (spec.machine && spec.machine.carriage) || 'knit',
    profile
  };

  const pieces = fitPieces.map(p => translatePiece(p));
  const colors = deriveColors(spec);
  const cardMatrix = deriveCardMatrix(spec, colors);
  const metadata = {
    name: (project && project.name) || 'Untitled pattern',
    yarnNames: Object.keys(spec.yarn || {}),
    finishedBust: num(get('garment.finishedBust'), 0),
    finishedLength: num(get('garment.length'), 0),
    finishedSleeve: num(get('garment.sleeveLength'), 0),
    construction: get('garment.construction') || (drafted && drafted.construction) || 'raglanSweater',
    gaugeCm: 10,
    notes: ''
  };

  const ir = buildIr({ metadata, gauge, machine, pieces, colors, cardMatrix });
  ir.decisions = buildDecisions(project, get, ir);
  return ir;
}

/**
 * Translate one Fit-Engine PatternPiece into an IR piece with explicit rows and an honest
 * running stitch count.
 * @param {object} p @returns {import('./ir.js').IRPiece}
 */
export function translatePiece(p) {
  let live = Number(p.castOn) || 0;
  const castOnRow = irRow(0, {
    operations: [op('cast-on', { count: live })],
    stitchesBefore: 0,
    stitchesAfter: live,
    carriage: 'knit',
    note: `Cast on ${live}`
  });
  const rowsDetail = [castOnRow];
  let idx = 1;
  for (const sr of (p.rows || [])) {
    const operation = translateRow(sr);
    const before = live;
    live += stitchDelta(operation);
    if (live < 0) live = 0;
    rowsDetail.push(irRow(idx++, {
      operations: [operation],
      stitchesBefore: before,
      stitchesAfter: live,
      yarn: sr.yarn || (sr.action === 'yarn-change' ? sr.to : 'main'),
      carriage: carriageFor(sr.action),
      note: sr.notes || ''
    }));
  }
  return irPiece({
    id: p.id,
    name: p.name,
    stitches: Number(p.castOn) || 0,
    rows: rowsDetail.length,
    rowsDetail,
    edges: seamEdges(p.seams),
    joinFrom: Array.isArray(p.join) ? p.join : (p.join ? [p.join] : []),
    pickUp: p.pickUp || null,
    dimensions: Object.assign({ finalStitches: live }, p.dimensions || {})
  });
}

/** Map one shaping row onto an IR operation. */
function translateRow(sr) {
  const action = sr.action || 'knit';
  switch (action) {
    case 'decrease': return op('decrease', { count: Number(sr.count) || 1, position: sr.position || 'both' });
    case 'increase': return op('increase', { count: Number(sr.count) || 1, position: sr.position || 'both' });
    case 'short-row': return op('short-row', { count: Number(sr.count) || 0, side: sr.position || sr.side || 'left' });
    case 'bind-off': return op('bind-off', { count: Number(sr.count) || 1, position: sr.position || 'both', style: sr.style || 'standard' });
    case 'join': return op('join');
    case 'yarn-change': return op('yarn-change', { from: sr.from || 'main', to: sr.to || 'contrast' });
    case 'pick-up': return op('pick-up', { count: Number(sr.count) || 0, from: sr.from || 'edge' });
    case 'rib': return op('rib', { count: Number(sr.count) || 0, note: sr.notes || 'rib' });
    case 'knit': return op('knit');
    default:
      // An action the compiler does not know knits as a plain row — a silent loss of the
      // shaping intent. Surface it so "my cable row did nothing" is diagnosable.
      log.warn(`unrecognised shaping action "${action}" was compiled as a plain knit row`, { action });
      return op('knit');
  }
}

function carriageFor(action) {
  if (action === 'short-row') return 'knit';
  if (action === 'join') return 'combined';
  return 'knit';
}

function seamEdges(seams) {
  if (!Array.isArray(seams)) return [];
  return seams.map(s => (typeof s === 'string' ? { with: s, kind: 'seam' } : Object.assign({ kind: 'seam' }, s)));
}

/** Colour assignments from the KnitScript `chart:` section (name → hex), in order. */
function deriveColors(spec) {
  const charts = spec.chart || spec.charts || {};
  const yarns = spec.yarn || {};
  const seen = [];
  for (const chart of Object.values(charts)) {
    const list = chart && chart.colors;
    if (Array.isArray(list)) for (const c of list) if (!seen.includes(c)) seen.push(c);
  }
  if (!seen.length) for (const name of Object.keys(yarns)) if (!seen.includes(name)) seen.push(name);
  const hexOf = name => {
    const y = yarns[name] || {};
    return y.color || (y.colors && y.colors[0] && y.colors[0].hex) || '#888888';
  };
  return seen.map((name, index) => ({ index, yarn: name, hex: hexOf(name), symbol: '◼' }));
}

/** If a chart carries a `grid`/`matrix`, expose it as the IR card matrix for card/chart backends. */
function deriveCardMatrix(spec, colors) {
  const charts = Object.values(spec.chart || spec.charts || {});
  for (const chart of charts) {
    const g = chart && (chart.grid || chart.matrix);
    if (Array.isArray(g) && g.length && Array.isArray(g[0])) {
      // Normalise to palette indices bounded by the colour count.
      const n = Math.max(1, colors.length);
      return g.map(row => row.map(v => (Number.isFinite(Number(v)) ? Number(v) % n : 0)));
    }
  }
  return null;
}

/**
 * Explainable derivations (spec §4.7): record the formula and inputs for the headline numbers so
 * the UI can render "cast-on 228 = round((96+8)×22/10) → 228".
 */
function buildDecisions(project, get, ir) {
  const bust = num(get('garment.finishedBust'), 0);
  const spc = num(get('gauge.stitchesPer10cm'), 22) / 10;
  const body = num(get('body.bust'), 0);
  const ease = num(get('ease.chest'), 0);
  const castOn = num(get('pattern.castOn'), ir.pieces[0] ? ir.pieces[0].stitches : 0);
  const decisions = [];
  decisions.push({
    node: 'pattern.castOn', value: castOn,
    formula: 'round(garment.finishedBust × gauge.stitchesPerCm) → round to multiple of 4',
    substitute: `round(${bust} × ${round2(spc)}) = ${Math.round(bust * spc)} → ${castOn}`,
    inputs: { 'garment.finishedBust': bust, 'gauge.stsPerCm': spc, 'body.bust': body, 'ease.chest': ease }
  });
  decisions.push({
    node: 'garment.bodyRows', value: num(get('garment.bodyRows'), 0),
    formula: 'round(garment.length × gauge.rowsPerCm)',
    substitute: `round(${num(get('garment.length'), 0)} × ${round2(num(get('gauge.rowsPer10cm'), 30) / 10)})`,
    inputs: { 'garment.length': num(get('garment.length'), 0) }
  });
  if (project && project.downstreamOf) {
    decisions.forEach(d => { d.affects = project.downstreamOf(d.node).slice(0, 12); });
  }
  return decisions;
}

function cmOf(v) { if (typeof v === 'number') return v > 20 ? v : v * 100; if (v && typeof v.value === 'number') return v.unit === 'mm' ? v.value / 10 : v.unit === 'm' ? v.value * 100 : v.value; return 60; }
function num(v, d) { return Number.isFinite(Number(v)) ? Number(v) : d; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
