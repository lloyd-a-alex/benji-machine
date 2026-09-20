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
import { getDiagnostics } from '../core/diagnostics.js';
import {
  knowledgeFor, phil, scoreIssues, riskLabel, techniqueSupported
} from '../machine/machine-knowledge.js';

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
      // Two colours, two kinds of float. A run of punched needles (1) works yarn B at
      // the front and carries yarn A behind it; a run of blanks (0) is the mirror —
      // yarn A knits and yarn B is floated. Both snag, so the check has to look at
      // each colour, not just the punched one (which is all this used to do, so a
      // field of background could hide arbitrarily long carried B floats).
      let worst = 0;
      const floatRows = new Set();
      for (let i = 0; i < M.length; i++) {
        for (const want of [1, 0]) {
          const r = runsAbove(M[i], want, limit);
          if (r) { floatRows.add(i); worst = Math.max(worst, r); }
        }
      }
      const count = floatRows.size;
      if (count) {
        issues.push(mk('warn', `${count} long float${count > 1 ? 's' : ''} (up to ${worst} sts)`,
          `A carried yarn over ${limit} needles snags on needles and puckers the fabric — either colour floats when the other is the one being carried across a long gap.`,
          PHIL.peakEnd,
          { label: 'Auto-catch every long float', safe: true, run: () => { catchFloats(M, 1, limit); catchFloats(M, 0, limit); } }));
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

    // ── structure needs something to grip ────────────────────────────────────
    if (mode === 'fair_isle' || mode === 'slip' || mode === 'tuck') {
      const punched = M.reduce((a, r) => a + r.filter(v => v === 1).length, 0);
      const ratio = rows * cols ? punched / (rows * cols) : 0;
      if (ratio > 0.92) issues.push(mk('warn', 'Almost fully punched',
        'A card that is nearly all holes gives the machine no structure to grip; consider negative space.',
        PHIL.pragnanz, { label: 'Thin it out (skip every 4th column)', safe: true, run: () => thin(M, 4) }));
    }

    // ── the exhaustive expert pass ───────────────────────────────────────────
    // Beyond the handful of hard mechanical limits above, read every softer
    // signal the card emits — colourwork budget, edge anchors, repeat hygiene,
    // openwork balance, yarn-vs-gauge — and add the ones worth knowing about.
    // These are advisory (info) by design: they refine the reading without ever
    // gate-keeping a knit that the physics above already cleared.
    try { extrasPass(M, { rows, cols, mode, profile, limits, issues }); }
    catch (err) { getDiagnostics().logError('Feasibility deep pass', err, { level: 'warn' }); /* the core verdict stands */ }

    // A card is "clean" when nothing rose to error or warning. Info notes are
    // allowed to coexist with the all-clear, so we key off severity, not length.
    const hasError = issues.some(i => i.sev === 'error');
    const hasWarn = issues.some(i => i.sev === 'warn');
    if (!hasError && !hasWarn) {
      issues.unshift(mk('ok', 'This card is machine-feasible ♥',
        `Checked against ${profile.name}: no long floats, no impossible passes, within the needle bed. ${countAdvice(issues)} soft note${countAdvice(issues) === 1 ? '' : 's'} below are just craft tips.`,
        PHIL.pragnanz, null, { category: 'verdict' }));
    }
    return issues;
  }

  // ── the deep pass: everything that is worth saying but not worth blocking on ─
  function extrasPass(M, ctx) {
    const { rows, cols, mode, profile, limits, issues } = ctx;
    const know = knowledgeFor(profile);
    if (!rows || !cols) return;

    // 1. Craft context: what THIS carriage wants, read from the knowledge base.
    const note = know.notesForMode && know.notesForMode[mode];
    if (note) {
      issues.push(mk('info', `${profile.gauge} · ${capital(mode)} on a ${know.brand}`,
        note, phil('gauge'), null, { category: 'context' }));
    }

    // 2. Yarn weight the gauge is actually happy with (from the knowledge base).
    if (know.yarnWeights && know.yarnWeights.length && know.yarnWeights[0] !== 'any') {
      issues.push(mk('info', 'Yarn this gauge likes',
        `${know.yarnWeights.join(', ')} — ${know.yarnGauge}. A weight far off this range makes every float and tuck judgement below less reliable.`,
        phil('gauge'), null, { category: 'material' }));
    }

    // 3. Colourwork budget (fair isle / slip): how close runs sit UNDER the cap.
    if (mode === 'fair_isle' || mode === 'slip') {
      const want = mode === 'slip' ? 0 : 1;
      let near = 0, isolated = 0, total = 0;
      for (const row of M) {
        let run = 0;
        for (let c = 0; c <= row.length; c++) {
          const is = c < row.length && row[c] === want;
          if (is) { run++; total++; continue; }
          if (run) {
            if (run > limits.maxFloatNeedles - 2 && run <= limits.maxFloatNeedles) near++;
            if (run === 1) isolated++;
            run = 0;
          }
        }
      }
      if (near) {
        issues.push(mk('info', `${near} run${near > 1 ? 's' : ''} sit right at the catch line`,
          `Within two needles of the ${limits.maxFloatNeedles}-needle bridge. Fine today, one edit away from snagging — worth an eyeball if you keep editing.`,
          phil('hickey'), null, { category: 'stranding' }));
      }
      if (total && isolated / total > 0.5) {
        issues.push(mk('info', 'Mostly single, isolated stitches',
          `Over half the ${mode === 'slip' ? 'slipped' : 'punched'} cells stand alone. A scatter of lone stitches tugs on the carried yarn from both sides and reads as noise, not motif.`,
          phil('pragnanz'), null, { category: 'stranding' }));
      }
      const punched = M.reduce((a, r) => a + r.filter(v => v === 1).length, 0);
      const ratio = punched / (rows * cols);
      if (Math.abs(ratio - 0.5) > 0.35 && ratio > 0.05 && ratio < 0.95) {
        issues.push(mk('info', `Strong ${ratio > 0.5 ? 'B (punched)' : 'A (blank)'} colour dominance`,
          `Only ${Math.round(Math.min(ratio, 1 - ratio) * 100)}% one colour across the field. Dominant-ground colourwork is a real style, but know that the minority colour is the one carrying every ${mode === 'slip' ? 'slip' : 'stranded'} run.`,
          phil('colorwork'), null, { category: 'stranding' }));
      }
    }

    // 4. Edge anchors: a fully-blank outer column has nothing to hold the fabric.
    if (mode !== 'lace') {
      const firstAllBlank = M.every(r => r[0] === 0);
      const lastAllBlank = M.every(r => r[cols - 1] === 0);
      if ((firstAllBlank || lastAllBlank) && cols > 2) {
        issues.push(mk('info', 'Edge ' + (firstAllBlank && lastAllBlank ? 'columns are' : 'column is') + ' entirely blank',
          'A blank selvedge column gives the cast-on nothing punched to grip, so the edges can curl or ladder. A column of knit at each edge is cheap insurance.',
          phil('margin'), null, { category: 'structure' }));
      }
    }

    // 5. Repeat hygiene: does the card close on a clean horizontal repeat?
    const rep = smallestRepeat(M, cols);
    if (cols >= 6 && rep && rep.repeat && cols % rep.repeat !== 0) {
      issues.push(mk('info', 'Repeat does not divide the card width',
        `The motif looks ${rep.repeat} needles wide but the card is ${cols}; tiling it will cut the pattern mid-motif at the seam. Snap the width to a multiple of ${rep.repeat}.`,
        phil('pragnanz'), null, { category: 'structure' }));
    }

    // 6. Lace: openwork needs its increases and decreases to balance out.
    if (mode === 'lace') {
      let yo = 0, dec = 0;
      for (const row of M) for (const v of row) {
        if (v === STITCH_TYPE.EYELET) yo++;
        else if (v === STITCH_TYPE.TRANSFER_LEFT || v === STITCH_TYPE.TRANSFER_RIGHT ||
                 v === STITCH_TYPE.TRANSFER_DOUBLE_L || v === STITCH_TYPE.TRANSFER_DOUBLE_R) dec++;
      }
      if (yo && dec && Math.abs(yo - dec) > Math.max(2, 0.15 * (yo + dec))) {
        issues.push(mk('info', `Openwork is unbalanced (${yo} yarnovers vs ${dec} transfers)`,
          'Each yarnover adds a stitch, each transfer takes one away. A surplus widens the fabric row after row (a ruffle); a deficit narrows it toward nothing. Pair them to hold the stitch count.',
          phil('structure'), null, { category: 'lace' }));
      }
    }
  }

  function verdict() {
    const issues = analyze();
    const profile = app.currentProfile;
    const hasError = issues.some(i => i.sev === 'error');
    const hasWarn = issues.some(i => i.sev === 'warn');
    const status = hasError ? 'not-feasible' : hasWarn ? 'needs-attention' : 'feasible';
    const score = scoreIssues(issues);
    const breakdown = {
      error: issues.filter(i => i.sev === 'error').length,
      warn: issues.filter(i => i.sev === 'warn').length,
      info: issues.filter(i => i.sev === 'info').length,
      ok: issues.filter(i => i.sev === 'ok').length
    };
    return {
      issues,
      status,
      fixable: issues.filter(i => i.fix && i.fix.safe).length,
      score,
      risk: riskLabel(score),
      breakdown,
      machine: describeMachine(profile, app.currentMode),
      narrative: synthesize(issues, { profile, mode: app.currentMode, score, status })
    };
  }

  // ── helpers for the deep pass and the verdict extras ─────────────────────────
  function capital(s) { return s ? s[0].toUpperCase() + s.slice(1).replace('_', ' ') : s; }
  function countAdvice(issues) { return issues.filter(i => i.sev === 'info').length; }

  /**
   * Smallest horizontal period P (1<=P<=cols) whose tile reproduces every column.
   * Returns { repeat } or null when nothing smaller than the whole width fits.
   * Cheap: bails as soon as a candidate mismatches, and only tries divisors-ish
   * candidates up to half the width.
   */
  function smallestRepeat(M, cols) {
    if (!cols) return { repeat: 0 };
    for (let p = 1; p <= Math.floor(cols / 2); p++) {
      let ok = true;
      outer: for (const row of M) {
        for (let c = p; c < row.length; c++) {
          if (row[c] !== row[c - p]) { ok = false; break outer; }
        }
      }
      if (ok) return { repeat: p };
    }
    return { repeat: cols }; // no smaller repeat than the card itself
  }

  /** A compact, human machine briefing pulled from the knowledge base. */
  function describeMachine(profile, mode) {
    if (!profile) return null;
    const know = knowledgeFor(profile);
    const limits = profileLimits(profile);
    return {
      name: profile.name,
      brand: know.brand,
      family: know.family,
      era: know.era,
      aka: know.aka || [],
      gauge: profile.gauge,
      beds: limits.beds,
      history: know.history,
      carriage: know.carriage,
      tension: know.tension,
      accessories: know.accessories || [],
      yarnWeights: know.yarnWeights || [],
      yarnGauge: know.yarnGauge,
      strengths: know.strengths || [],
      caveats: know.caveats || [],
      commonFailures: know.commonFailures || [],
      modeSupported: techniqueSupported(profile, mode),
      limits
    };
  }

  /**
   * Compose a plain-language "expert reading" from the findings. This is the
   * narrative that makes the advisor feel considered rather than like a linter:
   * it names the machine, the mode, the headline concern and the governing
   * principle, then closes with the single most useful next step.
   */
  function synthesize(issues, ctx) {
    const { profile, mode, score, status } = ctx;
    const know = knowledgeFor(profile);
    const errs = issues.filter(i => i.sev === 'error');
    const warns = issues.filter(i => i.sev === 'warn');
    const infos = issues.filter(i => i.sev === 'info');
    const risk = riskLabel(score);
    const bits = [];
    bits.push(`Against the ${profile ? profile.name : 'selected machine'} (${know.brand}, ${profile ? profile.gauge : 'gauge?'}) in ${capital(mode)} mode this card scores ${score}/100 — ${risk.label.toLowerCase()}, ${risk.blurb}.`);
    if (errs.length) {
      bits.push(`${errs.length} blocker${errs.length > 1 ? 's' : ''} must be resolved first: ${errs.slice(0, 3).map(e => `"${e.title}"`).join(', ')}.`);
    } else if (warns.length) {
      bits.push(`No hard blockers, but ${warns.length} mechanical${warns.length > 1 ? 's' : ''} risk${warns.length === 1 ? '' : 's'} to weigh: ${warns.slice(0, 3).map(w => `"${w.title}"`).join(', ')}.`);
    } else {
      bits.push('Nothing here breaks the machine.');
    }
    if (know.caveats && know.caveats[0]) bits.push(`Worth remembering about this bed: ${know.caveats[0]}.`);
    if ((errs.length || warns.length) && know.commonFailures && know.commonFailures[0]) {
      bits.push(`The failure this usually turns into: ${know.commonFailures[0]}.`);
    }
    // Lead the next step with the highest-severity actionable fix available.
    const next = errs.find(i => i.fix && i.fix.safe) || warns.find(i => i.fix && i.fix.safe);
    if (next) bits.push(`Fastest improvement: “${next.fix.label}” — ${status === 'not-feasible' ? 'it clears a blocker' : 'it sharpens the fabric'}.`);
    else if (infos.length) bits.push(`The rest are craft notes (${infos.length}) rather than fixes — read them, then cast on.`);
    else bits.push('Knit it with confidence.');
    return bits.join(' ');
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

  function mk(sev, title, problem, philosophy, fix, extra) {
    return Object.assign({ sev, title, problem, philosophy, fix: fix || null }, extra || {});
  }

  return { analyze, verdict, maxFloatFor, describeMachine };
}
