/**
 * KNITCAT — Machine Universe.
 *
 * The second half of the "make it as good as the machine lets me" idea. Where the
 * feasibility advisor answers *"will this knit on the machine I picked?"*, the
 * universe answers the wider question: *"how close is this card to working on
 * EVERY machine, which ones will take it as-is, and what is the smallest change
 * that makes it universal?"*
 *
 * It reuses the advisor rather than re-deriving the physics: for each machine
 * profile it builds a throwaway app object (same live editor, foreign profile) and
 * runs the full expert system. One source of truth for "what can go wrong", so the
 * matrix can never disagree with the advisor about the very same card.
 *
 * Nothing at import time touches the DOM. Tuning (`tune`, `tuneForAll`) is the only
 * mutating path, and it drives the advisor's OWN safe fixes against the live
 * editor, so undo/autosave/render all behave exactly as if the user clicked them.
 */

import { MACHINE_PROFILES, profileLimits } from '../machine/profiles.js';
import { createFeasibilityAdvisor } from './feasibility.js';
import {
  universalEnvelope, commonCapabilities, riskLabel
} from '../machine/machine-knowledge.js';
import { soft, matrix as validateMatrix } from '../core/validate.js';
import { getDiagnostics } from '../core/diagnostics.js';

/** Shared diagnostics child logger for the universe feature. */
const diag = getDiagnostics().child('universe');

export function createMachineUniverse(app) {
  // Validate the host contract once, loudly but non-fatally: the universe needs an
  // editor with a matrix and a current mode/profile. Everything degrades to an
  // empty fleet reading rather than throwing if the app is only half booted.
  soft(() => {
    if (!app || typeof app !== 'object') throw new Error('universe: app object is required');
    return true;
  });

  function matrix() { return app.editor && app.editor.matrix; }
  function cloneMatrix() {
    const m = matrix();
    if (!Array.isArray(m)) { diag.warn('cloneMatrix: editor matrix missing or non-array', { got: typeof m }); return []; }
    // Rectangularity is an invariant the whole fleet analysis assumes. Validate a
    // copy softly: a malformed card is recorded for diagnosis but never aborts.
    const check = soft(() => validateMatrix(m, { cell: (v) => v }));
    if (!check.ok) diag.warn('cloneMatrix: editor matrix is ragged', { detail: check.error.meta });
    return m.map(r => Array.isArray(r) ? r.slice() : r);
  }

  /** An advisor pointed at a foreign machine but the SAME live editor. */
  function advisorFor(profile, live) {
    const shim = live
      ? Object.assign({}, app, { currentProfile: profile })
      : {
        currentMode: app.currentMode,
        currentProfile: profile,
        compilationResult: app.compilationResult,
        // A throwaway copy so scoring never mutates the real card.
        editor: { matrix: cloneMatrix(), setDimensions() {} }
      };
    return createFeasibilityAdvisor(shim);
  }

  /** One machine's full verdict for the current card. */
  function evaluate(profile) {
    const adv = advisorFor(profile, false);
    const v = adv.verdict();
    const machine = adv.describeMachine(profile, app.currentMode);
    const blockers = v.issues.filter(i => i.sev === 'error');
    const risks = v.issues.filter(i => i.sev === 'warn');
    return {
      profileId: profile.id,
      name: profile.name,
      short: (machine.aka && machine.aka[0]) || profile.name,
      brand: machine.brand,
      gauge: profile.gauge,
      beds: machine.beds,
      score: v.score,
      status: v.status,
      risk: v.risk,
      canKnit: v.status !== 'not-feasible' && machine.modeSupported,
      blockers: blockers.map(i => i.title),
      risks: risks.map(i => i.title),
      fixes: v.issues.filter(i => i.fix && i.fix.safe).map(i => i.fix.label),
      machine,
      verdict: v
    };
  }

  /** Every profile, ranked most-to-least compatible with the current card. */
  function analyzeAll() {
    const results = Object.values(MACHINE_PROFILES)
      .map((p) => {
        // Contain each machine independently: one bad verdict must not sink the
        // whole fleet comparison. A failure is recorded and scored as blocked.
        try {
          return evaluate(p);
        } catch (err) {
          diag.logError(`evaluate(${p && p.id})`, err);
          return null;
        }
      })
      .filter(Boolean);
    return results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  function bestMachine() { return analyzeAll()[0] || null; }

  /** Headline counts across the whole fleet. */
  function compatibility() {
    const all = analyzeAll();
    return {
      total: all.length,
      compatible: all.filter(r => r.canKnit && r.status === 'feasible').length,
      attention: all.filter(r => r.status === 'needs-attention').length,
      blocked: all.filter(r => r.status === 'not-feasible').length,
      results: all
    };
  }

  /**
   * The single most conservative envelope across the fleet, plus which machine is
   * the bottleneck on each axis. A card inside this box fits every machine here.
   */
  function universalSpec() {
    const list = Object.values(MACHINE_PROFILES);
    const env = universalEnvelope(list);
    const caps = commonCapabilities(list);
    const bottleneck = {
      float: strictestProfile(list, p => profileLimits(p).maxFloatNeedles),
      tuck: strictestProfile(list, p => profileLimits(p).maxTuckLoops),
      width: strictestProfile(list, p => profileLimits(p).maxNeedles),
      rows: strictestProfile(list, p => profileLimits(p).maxRows)
    };
    return { envelope: env, capabilities: caps, bottleneck };
  }

  function strictestProfile(profiles, pick) {
    let best = null, bestVal = Infinity;
    for (const p of profiles) {
      const v = pick(p);
      if (Number.isFinite(v) && v < bestVal) { bestVal = v; best = p; }
    }
    return best ? { id: best.id, name: best.name, value: bestVal } : null;
  }

  // Order the fleet toughest-first so a single sweep lands inside every box.
  function byStrictness() {
    return Object.values(MACHINE_PROFILES).sort((a, b) => {
      const la = profileLimits(a), lb = profileLimits(b);
      return (la.maxFloatNeedles - lb.maxFloatNeedles)
        || (la.maxTuckLoops - lb.maxTuckLoops)
        || (la.maxNeedles - lb.maxNeedles)
        || (la.maxRows - lb.maxRows);
    });
  }

  /**
   * Drive one machine's SAFE fixes against the LIVE editor until it stops finding
   * anything to change. Reuses the advisor's own mutation helpers, which call the
   * editor's saveState/render/onChange — so this is indistinguishable from a human
   * clicking "Fix all safe" while that machine is selected.
   */
  function tune(profileId) {
    const profile = MACHINE_PROFILES[profileId];
    if (!profile) return { changed: false, applied: [], target: null };
    const live = advisorFor(profile, true);
    const applied = [];
    let guard = 0;
    while (guard++ < 16) {
      let v;
      try { v = live.verdict(); } catch (_) { break; }
      const nxt = v.issues.find(i => i.fix && i.fix.safe && typeof i.fix.run === 'function');
      if (!nxt) break;
      try { nxt.fix.run(); } catch (_) { break; }
      applied.push(nxt.fix.label);
    }
    if (app.recompile) { try { app.recompile(); } catch (_) { /* not booted */ } }
    let after = null;
    try { after = evaluate(profile); } catch (_) { /* contained */ }
    return { changed: applied.length > 0, applied, target: profile.name, after };
  }

  /** Tune against every machine, toughest first, so the result is universal. */
  function tuneForAll() {
    diag.info('tuneForAll: starting universal sweep');
    const applied = [];
    for (const p of byStrictness()) {
      const r = tune(p.id);
      for (const a of r.applied) if (!applied.includes(a)) applied.push(a);
    }
    diag.info(`tuneForAll: ${applied.length} fix(es) applied`);
    return { changed: applied.length > 0, applied, spec: universalSpec(), after: compatibility() };
  }

  /** A plain-language fleet reading for the modal header. */
  function summary() {
    const c = compatibility();
    const spec = universalSpec();
    const best = c.results[0];
    const bits = [];
    bits.push(`This card, read against all ${c.total} machines KNITCAT knows.`);
    bits.push(`${c.compatible} take it as-is, ${c.attention} need a look, and ${c.blocked} can't reach it without a change.`);
    if (best) {
      const risk = riskLabel(best.score);
      bits.push(`Best fit right now: ${best.name} (${best.score}/100, ${risk.label.toLowerCase()}).`);
    }
    if (spec.bottleneck.float) {
      bits.push(`The tightest constraint across the fleet is ${spec.bottleneck.float.name} — it caps carried yarn at ${spec.bottleneck.float.value} needles, so that is the bar a truly universal card must clear.`);
    }
    return bits.join(' ');
  }

  return { analyzeAll, evaluate, bestMachine, compatibility, universalSpec, tune, tuneForAll, summary };
}
