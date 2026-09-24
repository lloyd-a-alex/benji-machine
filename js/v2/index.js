/**
 * KNITCAT V2 — the facade (spec §7 "The Fusion").
 *
 * This is the one import surface the running app (js/app.js) and the test battery use to reach the
 * whole re-architecture. It is deliberately tiny *in behaviour* but *total* in reach: it pulls the
 * five V2 systems plus the shared Project model together under one module, exposes them both as
 * namespaces (`V2.FitEngine`, `V2.YarnLab`, …) and as the fused, cross-system functions that are the
 * entire point of the rewrite. Nothing here touches the DOM at import time — the panels live in
 * ./panels.js and are only constructed when {@link installV2} is called by the app.
 *
 * The fusion, in one function ({@link runFullPipeline}): a single {@link
 * module:project/project.Project} is drafted by the Fit Engine, costed and gauged by the Yarn Lab,
 * derived → optimised → verified → emitted by the Compiler, wrapped in a Production plan, and
 * returned as one report whose numbers cannot disagree because they all read the same graph. That
 * is what "change the yarn → everything updates" means in code: call it again and the ripple is
 * recomputed from the one source of truth.
 *
 * @module v2
 */

import * as FitEngine from '../fit/index.js';
import * as YarnLab from '../yarn/index.js';
import * as Compiler from '../compiler/index.js';
import * as ReverseEngineer from '../reverse/index.js';
import * as Production from '../production/index.js';
import { Project } from '../project/project.js';
import { MACHINE_PROFILES } from '../machine/profiles.js';

export { FitEngine, YarnLab, Compiler, ReverseEngineer, Production, Project };
export { installV2, V2_SYSTEMS, openV2Panel, closeAllV2Panels } from './panels.js';
export { summariseHealth, healthToText } from './health-view.js';
export { V2_VERSION, DEFAULT_KNITSCRIPT, V2_SYSTEM_CATALOG } from './_catalog.js';

import { DEFAULT_KNITSCRIPT } from './_catalog.js';
import { logger } from '../core/logging.js';

const log = logger('v2');

/**
 * Build a Project from a KnitScript source string (the editor's text). Never throws — on a parse
 * error it returns a Project built from {@link DEFAULT_KNITSCRIPT} plus the error, so the UI can
 * show "your KnitScript didn't parse, here's a working scaffold" instead of a blank screen.
 *
 * @param {string} [knitScript]
 * @param {{machine?:string}} [opts]
 * @returns {{project:Project|null, error:string|null, usedFallback:boolean}}
 */
export function projectFromKnitScript(knitScript, opts = {}) {
  const text = knitScript && knitScript.trim() ? knitScript : DEFAULT_KNITSCRIPT;
  try {
    const project = Project.fromKnitScript(text, opts.machine ? { machine: MACHINE_PROFILES[opts.machine] } : undefined);
    return { project, error: null, usedFallback: !knitScript || !knitScript.trim() };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    log.warn('a KnitScript source could not be parsed into a Project — falling back to the working scaffold', { error: message, usedFallback: true });
    if (text === DEFAULT_KNITSCRIPT) return { project: null, error: message, usedFallback: true };
    // Fall back to the known-good scaffold so downstream systems still run.
    try {
      return { project: Project.fromKnitScript(DEFAULT_KNITSCRIPT), error: message, usedFallback: true };
    } catch (_) {
      return { project: null, error: message, usedFallback: true };
    }
  }
}

/**
 * A Project built from the *current app state* — the machine profile the picker is on, the card
 * name, and the scaffold measurements. This is the bridge between the legacy canvas editor and the
 * V2 model: the V2 panels operate on a real Project seeded from what the knitter is looking at.
 * @param {{currentProfile?:{id:string}, projectMeta?:{name?:string}}} app
 * @param {string} [knitScript] optional user-authored KnitScript to honour over the scaffold
 * @returns {Project}
 */
export function projectFromApp(app, knitScript) {
  const machineId = (app && app.currentProfile && app.currentProfile.id) || 'brother_standard_24';
  const name = (app && app.projectMeta && app.projectMeta.name) || null;
  let text = knitScript && knitScript.trim() ? knitScript : DEFAULT_KNITSCRIPT;
  if (name) text = text.replace(/project "[^"]*"/, `project ${JSON.stringify(name)}`);
  // Keep the machine in step with the picker unless the user's own KnitScript names one.
  if (text === DEFAULT_KNITSCRIPT) text = text.replace(/machine: "[^"]*"/, `machine: "${machineId}"`);
  const built = projectFromKnitScript(text, { machine: machineId });
  return built.project || Project.fromKnitScript(DEFAULT_KNITSCRIPT);
}

/**
 * @typedef {object} PipelineReport
 * @property {object} projectMeta {name, machine, stitchCount}
 * @property {object} fit the Fit Engine draft (pieces, mesh, drape, report)
 * @property {object} yarn the Yarn Lab consolidated view
 * @property {object} compile the Compiler CompileReport (IR + outputs + verification)
 * @property {object} production a Production costing/pricing for the same project
 * @property {string[]} errors non-fatal errors captured per stage
 * @property {object} headline the few numbers the dashboard shows first
 */

/**
 * Run every V2 system over one Project, in dependency order, and return a single fused report.
 * This is the demonstration and the engine of the "fusion": fit → yarn → compile → production, each
 * reading the same graph. It is defensive: a failure in one stage is captured and the later stages
 * still run on whatever the earlier ones produced, so you can always see the whole picture even
 * mid-edit. Pure (no DOM), deterministic, safe under Node — the test battery calls this directly.
 *
 * @param {Project} project
 * @param {{
 *   outputs?:string[], priority?:string, quantity?:number, currency?:string,
 *   labourRate?:number, yarnOpts?:object, compileOpts?:object, fitOpts?:object
 * }} [options]
 * @returns {PipelineReport}
 */
export function runFullPipeline(project, options = {}) {
  const errors = [];
  if (!project || typeof project.get !== 'function') {
    throw new TypeError('runFullPipeline needs a Project (build one with projectFromKnitScript).');
  }

  // 1. Fit — draft the garment and the body/garment meshes.
  let fit = null;
  try {
    fit = FitEngine.draftFromProject(project, options.fitOpts || {});
  } catch (e) {
    errors.push(`fit: ${msg(e)}`);
  }

  // 2. Yarn — cost, gauge and behaviour for the same graph.
  let yarn = null;
  try {
    yarn = YarnLab.yarnLabForProject(project, options.yarnOpts || {});
  } catch (e) {
    errors.push(`yarn: ${msg(e)}`);
  }

  // 3. Compile — derive → optimise → verify → emit every requested output, feeding the fit pieces
  //    in so the IR matches what the Fit Engine drafted (this is the seam between the two).
  let compile = null;
  try {
    compile = Compiler.compileProject(project, Object.assign({
      outputs: options.outputs || ['written', 'chart', 'machine', 'punchcard'],
      pieces: fit && fit.pieces,
      priority: options.priority,
      quantity: options.quantity
    }, options.compileOpts || {}));
  } catch (e) {
    errors.push(`compile: ${msg(e)}`);
  }

  // 4. Production — the same project costed and priced for someone who sells.
  let production = null;
  try {
    const plan = Production.createPlan({ projectId: 'v2', quantity: options.quantity || 1, currency: options.currency, budget: { labourRate: options.labourRate } });
    production = Production.computePlan(plan, project, {});
  } catch (e) {
    errors.push(`production: ${msg(e)}`);
  }

  // 4b. Design-to-quote — fuse the fit pieces, the project gauge and the machine profile through the
  //     carriage-pass planner and the costing engine, so the creative chart and the commercial quote
  //     are computed from one source of truth. Optional (only when the fit stage drafted pieces).
  let quote = null;
  try {
    const pieces = fit && Array.isArray(fit.pieces) && fit.pieces.length
      ? fit.pieces.map((pc, i) => ({ name: pc.name || pc.id || `Piece ${i + 1}`, castOn: pc.castOn, rows: pc.totalRows != null ? pc.totalRows : pc.rows }))
      : null;
    if (pieces) {
      quote = Production.buildDesignQuote({
        name: project.name,
        machine: safeGet(project, 'machine.id') || undefined,
        gauge: { stitchesPer10Cm: safeGet(project, 'gauge.stitchesPer10cm'), rowsPer10Cm: safeGet(project, 'gauge.rowsPer10cm') },
        parts: pieces,
        quantity: options.quantity || 1,
        currency: options.currency,
        labourRate: options.labourRate,
        yarns: options.quoteYarns
      });
    }
  } catch (e) {
    errors.push(`quote: ${msg(e)}`);
  }

  const headline = {
    castOn: safeGet(project, 'pattern.castOn'),
    bodyRows: safeGet(project, 'garment.bodyRows'),
    finishedBust: safeGet(project, 'garment.finishedBust'),
    gaugeStitches: safeGet(project, 'gauge.stitchesPer10cm'),
    totalHours: safeGet(project, 'time.totalHours'),
    costTotal: safeGet(project, 'cost.total'),
    suggestedPrice: safeGet(project, 'cost.suggestedPrice'),
    unitCost: production && production.costing ? production.costing.unitCost : null,
    pieces: fit ? fit.pieces.length : 0,
    verification: compile ? compile.summary.verdict : null,
    ok: compile ? compile.ok : true
  };

  // 5. Health — inspect the live graph for NaN/Infinity, thrown nodes, cycles and impossible
  //    relationships. The textual KnitScript check can't see these; they only appear once every
  //    derived node has actually been evaluated, which is exactly what the pipeline just did.
  let validation = [];
  try {
    validation = typeof project.fullValidate === 'function' ? project.fullValidate() : project.validate();
  } catch (e) {
    errors.push(`validate: ${msg(e)}`);
  }
  const modelErrors = validation.filter((d) => d && d.severity === 'error');

  // A whole V2 subsystem throwing is silently degraded to a null section of the report;
  // mirror each into the log so a broken stage can never hide behind a blank panel.
  for (const e of errors) log.error(`V2 pipeline stage failed — ${e}`, { stage: e.split(':')[0] });
  if (modelErrors.length) log.warn(`V2 model health: ${modelErrors.length} error(s) in the live graph`, { count: modelErrors.length });

  return {
    projectMeta: {
      name: project.name,
      machine: safeGet(project, 'machine.id') || null,
      sections: project.spec && project.spec.sections ? Object.keys(project.spec.sections) : []
    },
    fit,
    yarn,
    compile,
    production,
    quote,
    validation,
    modelErrorCount: modelErrors.length,
    errors,
    headline
  };
}

function safeGet(project, id) {
  try {
    if (project.has && !project.has(id)) return null;
    const v = project.get(id);
    return typeof v === 'number' && !Number.isFinite(v) ? null : (v === undefined ? null : v);
  } catch (_) {
    return null;
  }
}

function msg(e) {
  return e && e.message ? e.message : String(e);
}

/**
 * Standalone design-to-quote: the commercial bridge the creative systems were missing. Give it a
 * design — a `presetId` (or an explicit `chart`), a machine, a gauge, garment parts and a yarn
 * selection — and it composes the chart's colour histogram, the carriage-pass time model, the
 * tailor's yarn estimate and the production costing engine into one self-consistent {@link
 * module:production/quote.DesignQuote} whose yarn, time and money cannot disagree.
 *
 * @param {import('../production/quote.js').DesignInput} design
 * @returns {import('../production/quote.js').DesignQuote}
 */
export function quoteDesign(design) {
  return Production.buildDesignQuote(design);
}

export { renderQuoteSheet } from '../production/quote.js';
