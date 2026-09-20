/**
 * KNITCAT V2 — the Fit Engine barrel.
 *
 * The single import surface for the whole Fit Engine, plus one high-level entry point,
 * {@link draftFromProject}, that reads body/gauge/ease/garment straight off a {@link
 * module:project/project.Project}'s constraint graph, drafts the garment into pattern pieces,
 * runs the drape simulation and returns a fit report — the "make me a garment that fits" call
 * the entire V2 promises. Every other system imports `js/fit/index.js`, never the leaves, so
 * the internal file layout can change without breaking callers.
 *
 * @module fit
 */

export { MEASUREMENTS, MEASUREMENT_BY_KEY, defaultMeasurements, normalizeMeasurements } from './measurements.js';
export { CHARTS, resolveSize, gradeFromBust, allSizeLabels } from './standard-sizes.js';
export { BodyModel, BODY_TYPES, POSTURES } from './body-model.js';
export { EaseProfile, PREFERENCE_BASE } from './ease.js';
export { taperSchedule, eventSpread, knitEven, bindOff, joinSegments } from './shaping-scheduler.js';
export { shortRowSchedule, partialKnittingSpans, suggestTurnCount, rowsForShoulderSlope } from './short-rows.js';
export { pickUpCount, necklinePickUp, fitRibToMultiple, pickupPlanForEdges, EDGE_RATIOS } from './pick-up.js';
export { planFinishing, hemBand, neckband, buttonBand, pocket, hood, collar, HEM_STYLES } from './finishing.js';
export { buildBodyMesh, buildGarmentMesh, panelCircumference } from './mesh.js';
export { DrapeSimulator } from './drape.js';
export { computeFitReport, assessPoint, EASE_BANDS } from './fit-report.js';
export { draftGarment, resolveConstruction, CONSTRUCTIONS, TEMPLATE_BY_CONSTRUCTION, TEMPLATE_INFO } from './templates/index.js';

import { draftGarment, resolveConstruction } from './templates/index.js';
import { buildBodyMesh, buildGarmentMesh } from './mesh.js';
import { DrapeSimulator } from './drape.js';
import { computeFitReport } from './fit-report.js';
import { planFinishing } from './finishing.js';
import { EaseProfile } from './ease.js';

/**
 * Draft a whole garment directly from a Project's live graph.
 * @param {import('../project/project.js').Project} project
 * @param {object} [opts] { yarnBehaviour?:{drape,stretch}, styleExtra?:object }
 * @returns {{construction:string, pieces:object[], body:object, gauge:object, ease:object, mesh:object, drape:object, report:object, finishing:object}}
 */
export function draftFromProject(project, opts = {}) {
  const g = id => (project && typeof project.get === 'function' ? project.get(id) : undefined);
  const body = {
    bust: num(g('body.bust'), 96), waist: num(g('body.waist'), 82), hip: num(g('body.hip'), 100),
    upperArm: num(g('body.upperArm'), 32), wrist: num(g('body.wrist'), 18), neck: num(g('body.neck'), 38),
    shoulderWidth: num(g('body.shoulderWidth'), 42), backLength: num(g('body.backLength'), 46),
    armholeDepth: num(g('body.armholeDepth'), 22), sleeveLength: num(g('body.sleeveLength'), 48)
  };
  const gauge = { stsPer10cm: num(g('gauge.stitchesPer10cm'), 22), rowsPer10cm: num(g('gauge.rowsPer10cm'), 30) };
  const ease = {
    chest: num(g('ease.chest'), 6), bust: num(g('ease.chest'), 6),
    waist: num(g('ease.waist'), 4), hip: num(g('ease.hip'), 3.5), arm: num(g('ease.arm'), 7)
  };
  const construction = resolveConstruction(g('garment.construction') || 'raglanSweater');
  const style = Object.assign({
    construction,
    lengthCm: num(g('garment.length'), 62),
    sleeveLengthCm: num(g('garment.sleeveLength'), 48),
    armholeDepthCm: num(g('garment.armholeDepth'), 22)
  }, opts.styleExtra || {});

  const drafted = draftGarment({ body, gauge, ease: new EaseProfile('standard', ease), style });
  const pieces = drafted.pieces;

  const bodyMesh = buildBodyMesh(body);
  const garmentMesh = buildGarmentMesh(pieces, gauge);
  const simulator = new DrapeSimulator();
  const drape = simulator.simulate(bodyMesh, garmentMesh, opts.yarnBehaviour || {});
  const report = computeFitReport({ body, gauge, ease, pieces, drape, style });
  const finishing = planFinishing({
    gauge, dims: { hemStitches: pieces[0] && pieces[0].castOn, cuffStitches: findCuff(pieces), neckCircumferenceCm: body.neck, construction },
    style: { hem: 'rib2x2', cuffs: 'rib2x2', neckband: { shape: 'crew' } }
  });

  return { construction, pieces, body, gauge, ease, mesh: { body: bodyMesh, garment: garmentMesh }, drape, report, finishing };
}

function num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
function findCuff(pieces) {
  const s = pieces.find(p => /sleeve/i.test(p.id));
  return s && s.dimensions && s.dimensions.cuffSts != null ? s.dimensions.cuffSts : (s ? s.castOn : 40);
}
