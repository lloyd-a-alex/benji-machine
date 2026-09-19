/**
 * KNITCAT — Feasibility Advisor.
 *
 * A small expert system that reads the ACTUAL pattern in the editor and the
 * constraints of the SELECTED machine, then explains — in plain language — every
 * reason the card would misbehave at the machine, and offers a one-click fix for
 * the ones that are safely mechanical. Each recommendation is framed with a
 * design principle ("philosophy") so the reasoning is transparent, not magic.
 *
 * It never throws and never mutates anything unless a specific "fix" is clicked.
 *
 * Per-mode float semantics get this right (they were previously mixed up):
 *   fair_isle : a run of punched cells (1) is a carried float on the reverse
 *   slip      : a run of slipped cells   (0) is the float (yarn carried behind)
 *   tuck      : a long VERTICAL run of tucked cells (0) is the real risk (bulk)
 *
 * Needle beds matter more than anything else here, so the advisor reports them:
 * a SINGLE-bed machine (Brother KH-830, Silver Reed SK-280, Toyota, Brother
 * Chunky) transfers a loop from one needle to its neighbour in the SAME bed,
 * which is exactly the model LaceCompiler schedules. A DOUBLE-bed machine
 * (Passap Duo 80 / E6000, or a Brother with a ribber) moves loops BETWEEN two
 * opposed beds instead, so its transfer timing cannot be read off a single-bed
 * schedule. `profile.beds` is the data; the advisories below are the prose.
 */

import { STITCH_TYPE } from '../math/knit-topology.js';
import { profileLimits } from '../machine/profiles.js';

// Float and tuck limits are read from the machine profile and NOWHERE else.
// This file used to carry its own copy (7 needles, 5 for chunky) while the
// diagnostics panel said 9 — so the app contradicted itself about the very same
// card, which is worse than saying nothing at all.
function maxFloatFor(profile) {
  return profileLimits(profile).maxFloatNeedles;
}

function runsAbove(line, want, limit) {
  // longest run of cells === want
  let best = 0, cur = 0;
  for (const v of line) {
    if (v === want) { cur++; if (cur > best) best = cur; } else cur = 0;
  }
  return best > limit ? best : 0;
}

const PHIL = {
  parsimony: 'Occam’s Razor — the simplest card that still knits is the best card.',
  pareto: 'The Pareto Principle — a handful of trouble spots cause most of the dropped stitches.',
  postel: 'Postel’s Law — be conservative about what you send to the machine.',
  peakEnd: 'The Peak-End Rule — a clean edge is what people remember about a fabric.',
  pragnanz: 'The Law of Prägnanz — a repeat that resolves simply reads as intentional.',
  mapTerritory: 'The map is not the territory — a schedule built for one needle bed does not describe a two-bed machine.'
};

/**
 * @param {object} app  the KnitApp instance (uses editor, currentMode,
 *                      currentProfile, compilationResult, recompile)
 * @returns {{ analyze: () => Array, verdict: () => object }}
 */
export function createFeasibilityAdvisor(app) {
  function matrix() { return app.editor && app.editor.matrix; }

  function analyze() {
    const issues = [];
    const ed = app.editor, profile = app.currentProfile, mode = app.currentMode;
    if (!ed || !profile) return issues;
    const M = matrix();
    const rows = M.length, cols = M[0] ? M[0].length : 0;
    const limits = profileLimits(profile);
    const limit = limits.maxFloatNeedles;
    const tuckLimit = limits.maxTuckLoops;

    // ── empty canvas ────────────────────────────────────────────────────────
    const any = M.some(r => r.some(v => mode === 'lace' ? v !== STITCH_TYPE.KNIT && v !== 'K' && v !== 0 : v === 1));
    if (!any && mode !== 'lace') {
      issues.push(mk('info', 'Blank card',
        'Nothing is punched, so the machine will just knit plain rows.',
        PHIL.parsimony, null));
    } else if (!any && mode === 'lace') {
      issues.push(mk('info', 'No lace stitches yet',
        'This card is all plain knit, so there is nothing for the lace carriage to transfer. Paint eyelets (yarnovers) or directional transfers to start the openwork.',
        PHIL.parsimony, null));
    }

    // ── height over machine limit ─────────────────────────────────────────────
    const maxRows = profile.maxRows || 256;
    if (rows > maxRows) {
      issues.push(mk('error', `Too tall for ${profile.name}`,
        `This machine holds ${maxRows} rows; your card is ${rows}. The bottom would never be read.`,
        PHIL.postel,
        { label: `Trim to ${maxRows} rows`, safe: true, run: () => ed.setDimensions(maxRows, cols) }));
    }

    // ── width over the needle bed ───────────────────────────────────────────
    // The one limit no amount of patience gets around: a card wider than the bed
    // has columns the carriage can never reach. Imported art and oversized
    // presets hit this constantly.
    if (cols > limits.maxNeedles) {
      issues.push(mk('error', `Wider than the ${profile.name} bed`,
        `This bed has ${limits.maxNeedles} needles; your card is ${cols} columns across. Everything past needle ${limits.maxNeedles} is never read.`,
        PHIL.postel,
        { label: `Trim to ${limits.maxNeedles} columns`, safe: true, run: () => ed.setDimensions(rows, limits.maxNeedles) }));
    }

    if (mode === 'fair_isle') {
      let worst = 0, count = 0;
      for (const row of M) { const r = runsAbove(row, 1, limit); if (r) { count++; worst = Math.max(worst, r); } }
      if (count) {
        issues.push(mk('warn', `${count} long float${count > 1 ? 's' : ''} (up to ${worst} sts)`,
          `A carried yarn over ${limit} needles snags on needles and puckers the fabric.`,
          PHIL.peakEnd,
          { label: 'Auto-catch every long float', safe: true, run: () => catchFloats(M, 1, limit) }));
      }
    } else if (mode === 'slip') {
      let worst = 0, count = 0;
      for (const row of M) { const r = runsAbove(row, 0, limit); if (r) { count++; worst = Math.max(worst, r); } }
      if (count) {
        issues.push(mk('warn', `${count} long slip float${count > 1 ? 's' : ''} (up to ${worst} sts)`,
          `Slipped stitches carry the unused colour behind; past ${limit} it laces the fabric tight.`,
          PHIL.peakEnd,
          { label: 'Knit a stitch to catch each float', safe: true, run: () => catchFloats(M, 0, limit) }));
      }
    } else if (mode === 'tuck') {
      // Tuck holds a needle's loop over extra rows. The failure is VERTICAL (loop
      // stacking into a lump), not the horizontal float that fair isle and slip
      // care about — so measure the tallies, per column.
      let worst = 0, columnsOver = 0;
      for (let c = 0; c < cols; c++) {
        let cur = 0;
        let tall = 0;
        for (let r = 0; r < rows; r++) {
          if (M[r][c] === 0) { cur++; if (cur > tall) tall = cur; } else cur = 0;
        }
        if (tall > tuckLimit) { columnsOver++; worst = Math.max(worst, tall); }
      }
      if (columnsOver) {
        issues.push(mk('warn', `${columnsOver} column${columnsOver > 1 ? 's' : ''} tuck for up to ${worst} rows`,
          `Holding a needle in tuck for more than ${tuckLimit} rows stacks loops into a bulky lump that can pop off the bed.`,
          PHIL.pareto,
          { label: 'Knit a row through long tucks', safe: true, run: () => breakTucks(M, tuckLimit) }));
      }
    } else if (mode === 'lace') {
      // Surface the compiler's own physical diagnostics as actionable advice.
      const diags = (app.compilationResult && app.compilationResult.diagnostics) || [];
      const errs = diags.filter(d => d.type === 'error');
      if (errs.length) {
        issues.push(mk('error', `${errs.length} carriage-pass problem${errs.length > 1 ? 's' : ''}`,
          errs.slice(0, 3).map(e => e.message || String(e)).join('  •  ') || 'The decompiler found a physically impossible transfer.',
          PHIL.postel,
          { label: 'Show carriage schedule', safe: true, run: () => { const t = document.querySelector('.tab-btn[data-tab="schedule"]'); t && t.click(); } }));
      }
      if (profile.carriageRules && profile.carriageRules.type === 'brother_separated') {
        issues.push(mk('info', 'Brother needs plain rows after lace',
          'The lace carriage does not feed yarn, so plain knit rows are inserted after every transfer pass — keep them.',
          PHIL.parsimony, null));
      }
    }

    // ── needle-bed model: single bed vs double bed ───────────────────────────
    // The decompiler moves loops between neighbouring needles in ONE bed. If the
    // selected machine has two opposed beds, say so plainly rather than letting
    // the pass list imply it is that machine's real timing.
    if (profile.beds === 2) {
      issues.push(mk('warn', `${profile.name} has two needle beds`,
        'A transfer on this machine moves a loop from the front bed to the back bed. The schedule below was built for a single bed, where transfers step sideways to the next needle — so treat it as a stranded single-bed drill, not as this machine’s true transfer timing.',
        PHIL.mapTerritory,
        // Deliberately NOT `safe`: switching machines is a preference, so it must
        // never be swept up by "Fix all". The user clicks it themselves.
        { label: 'Switch to Brother KH-830 (single bed)', safe: false, run: () => selectProfile('brother_standard_24') }));
    } else if (mode === 'lace') {
      issues.push(mk('info', 'Modelled as a single needle bed',
        'Every transfer here hands a loop to its neighbour on the same bed — which is what a Brother KH-830 or Silver Reed lace carriage physically does. Double-bed machines (Passap, ribbers) hand loops across to a second bed instead.',
        PHIL.mapTerritory, null));
    }

    // ── density ───────────────────────────────────────────────────────────────
    if (mode === 'fair_isle' || mode === 'slip' || mode === 'tuck') {
      const punched = M.reduce((a, r) => a + r.filter(v => v === 1).length, 0);
      const ratio = rows * cols ? punched / (rows * cols) : 0;
      if (ratio > 0.92) issues.push(mk('warn', 'Almost fully punched',
        'A card that is nearly all holes gives the machine no structure to grip; consider negative space.',
        PHIL.pragnanz, { label: 'Thin it out (skip every 4th column)', safe: true, run: () => thin(M, 4) }));
    }

    if (!issues.length) {
      issues.push(mk('ok', 'This card is machine-feasible ♥',
        `Checked against ${profile.name}: no long floats, no impossible passes, within the needle bed. Knit it with confidence.`,
        PHIL.pragnanz, null));
    }
    return issues;
  }

  function verdict() {
    const issues = analyze();
    const hasError = issues.some(i => i.sev === 'error');
    const hasWarn = issues.some(i => i.sev === 'warn');
    const status = hasError ? 'not-feasible' : hasWarn ? 'needs-attention' : 'feasible';
    return { issues, status, fixable: issues.filter(i => i.fix && i.fix.safe).length };
  }

  // ── safe mutation helpers (each mutates the live matrix, then refreshes) ──
  function selectProfile(id) {
    // Drive the same path a human would: change the <select>, fire 'change'.
    const sel = document.getElementById('profile-select');
    if (!sel) return;
    sel.value = id;
    sel.dispatchEvent(new Event('change'));
  }
  function commit() {
    if (app.editor.saveState) app.editor.saveState();
    if (app.editor.render) app.editor.render();
    if (app.editor.onChange) app.editor.onChange();
  }
  function catchFloats(M, want, limit) {
    for (const row of M) {
      let runStart = -1;
      for (let c = 0; c <= row.length; c++) {
        const isRun = c < row.length && row[c] === want;
        if (isRun && runStart < 0) runStart = c;
        if (!isRun && runStart >= 0) {
          const len = c - runStart;
          if (len > limit) { for (let k = runStart + limit; k < c; k += limit) row[k] = want === 1 ? 0 : 1; }
          runStart = -1;
        }
      }
    }
    commit();
  }
  function breakTucks(M, limit) {
    const cols = M[0] ? M[0].length : 0;
    for (let c = 0; c < cols; c++) {
      let runStart = -1;
      for (let r = 0; r <= M.length; r++) {
        const isRun = r < M.length && M[r][c] === 0;
        if (isRun && runStart < 0) runStart = r;
        if (!isRun && runStart >= 0) {
          const len = r - runStart;
          if (len > limit) for (let k = runStart + limit; k < r; k += limit) M[k][c] = 1;
          runStart = -1;
        }
      }
    }
    commit();
  }
  function thin(M, every) {
    for (const row of M) for (let c = every - 1; c < row.length; c += every) row[c] = 0;
    commit();
  }

  function mk(sev, title, problem, philosophy, fix) {
    return { sev, title, problem, philosophy, fix };
  }

  return { analyze, verdict, maxFloatFor };
}
