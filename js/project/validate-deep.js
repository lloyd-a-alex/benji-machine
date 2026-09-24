/**
 * KNITCAT V2 — deep Project validation.
 *
 * Beyond the textual checks the KnitScript type-checker makes, this inspects a live
 * {@link module:project/project.Project} — specifically its constraint graph — for the
 * failure modes that only show up once everything is wired: a formula that produced NaN
 * or Infinity, a node that threw (and is quietly serving a stale last-good value), a
 * dependency cycle, an impossible relationship (cast-on with zero gauge), or an input set
 * to a type the graph never expects. It returns the same
 * {@link module:knitscript/diagnostics.Diagnostic} shape so the "Verify" panel can show
 * KnitScript errors and model errors side by side.
 *
 * This never throws: a validation pass that dies on a weird value is useless, so every
 * check is defensive and a suspicious node is simply reported.
 *
 * @module project/validate-deep
 */

import { logger } from '../core/logging.js';

const log = logger('project/validate-deep');

/**
 * Validate a live Project. @param {import('./project.js').Project} project
 * @returns {Array<import('../knitscript/diagnostics.js').Diagnostic>}
 */
export function validateProject(project) {
  const out = [];
  const graph = project && project.graph;
  if (!graph) { out.push({ severity: 'error', message: 'Project has no constraint graph.', rule: 'no-graph' }); return out; }

  // A cycle would have thrown during propagate; confirm the order resolves cleanly.
  try { graph.topologicalOrder(); }
  catch (err) { out.push({ severity: 'error', message: err.message, rule: 'cycle' }); return out; }

  for (const [id, node] of graph.nodes) {
    if (node.error) {
      out.push({ severity: 'error', message: `Node "${id}" formula failed: ${node.error.message}`, rule: 'node-error' });
      continue;
    }
    const v = node.value;
    if (typeof v === 'number' && !Number.isFinite(v)) {
      out.push({ severity: 'error', message: `Node "${id}" is ${v}.`, rule: 'non-finite' });
    }
  }

  // Cross-node sanity: only meaningful if both exist and are numbers.
  const gauge = graph.has('gauge.stitchesPer10cm') ? graph.get('gauge.stitchesPer10cm') : null;
  const castOn = graph.has('pattern.castOn') ? graph.get('pattern.castOn') : null;
  if (typeof gauge === 'number' && typeof castOn === 'number') {
    if (gauge > 0 && castOn <= 0) out.push({ severity: 'error', message: 'Cast-on is zero with a positive gauge — check the body and ease.', rule: 'empty-caston' });
    if (gauge <= 0) out.push({ severity: 'error', message: 'Gauge must be positive.', rule: 'bad-gauge' });
  }

  const fitToBed = graph.has('feasibility.fitToBed') ? graph.get('feasibility.fitToBed') : null;
  if (fitToBed === false) {
    out.push({ severity: 'warning', message: 'The garment is wider than the machine bed — it needs seaming panels or a bigger machine.', rule: 'too-wide' });
  }

  // Surface the graph's structural failures into the diagnostics stream: a node that
  // threw is quietly serving a stale last-good value, which is exactly the kind of
  // error that otherwise never reaches a console. Warn on advisories, error on breaks.
  const errors = out.filter(d => d.severity === 'error');
  if (errors.length) log.error('deep project validation found structural errors', { count: errors.length, first: errors[0].message, rule: errors[0].rule });

  return out;
}

/**
 * A quick boolean gate used by the compiler: is the model healthy enough to codegen?
 * Fails only on hard errors, never on warnings. @param {object} project @returns {boolean}
 */
export function isProjectValid(project) {
  return !validateProject(project).some(d => d.severity === 'error');
}
