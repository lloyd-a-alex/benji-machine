/**
 * KNITCAT V2 — the finishing & pick-up read.
 *
 * The Fit Engine already computes a full finishing plan on every draft
 * (`draftFromProject` → `fit.finishing`, via `planFinishing`) and `pick-up.js` can turn
 * any garment's edge rows into exact pick-up counts, yet no panel ever showed either —
 * so the one part of machine knitting that decides whether a garment looks *made* or
 * *homemade* was invisible. This is that missing read: an ordered, copy-ready checklist
 * of every band and edge (hem, cuffs, neckband, collar, hood, button band, pockets) with
 * its row-by-row instructions, plus the pick-up arithmetic for the seamed edges.
 *
 * It is a pure presenter: it never recomputes the finishing that the engine already made,
 * and it feeds the *existing* `pickupPlanForEdges` engine with dimensions lifted straight
 * off the draft (armhole depth, back length, neck circumference) rather than inventing any
 * new knitting maths. DOM-free and total: bad or missing input yields `null`, never a throw.
 *
 * @module fit/finishing-view
 */

import { pickupPlanForEdges } from './pick-up.js';
import { cmToRows } from '../project/project-model.js';

/** Human labels for the edges `pickupPlanForEdges` can report. */
const EDGE_LABEL = Object.freeze({
  armhole: 'Armholes',
  sideSeam: 'Side seam',
  frontBand: 'Front band',
  neckline: 'Neckline'
});

/** A finite positive number, else null. */
function pos(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Turn an internal key/id into Title Case words. */
function humanise(s) {
  return String(s || '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build the finishing & pick-up summary from a Fit Engine draft
 * (`state.report.fit`: `{ gauge, body, ease, pieces, construction, finishing }`).
 *
 * @param {object} fit the fit draft report (shape from `module:fit`).
 * @returns {{ok:true, itemCount:number, items:Array, pickUp:Array, seaming:string[], headline:string}|null}
 *   null when the draft carries nothing to show (no bands and no derivable edges).
 */
export function summariseFinishing(fit) {
  if (!fit || typeof fit !== 'object') return null;

  const fin = fit.finishing && typeof fit.finishing === 'object' ? fit.finishing : {};
  const items = (Array.isArray(fin.items) ? fin.items : [])
    .filter((it) => it && typeof it === 'object')
    .slice(0, 8)
    .map((it) => ({
      kind: String(it.kind || 'band'),
      label: it.label ? humanise(it.label) : humanise(it.kind || 'Band'),
      style: it.style || it.shape || it.type || null,
      stitches: pos(it.stitches),
      rows: pos(it.rows),
      instructions: (Array.isArray(it.instructions) ? it.instructions : []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 6)
    }));

  // Feed the dark pick-up engine with real dimensions off this draft — no new maths here.
  const gauge = fit.gauge || {};
  const body = fit.body || {};
  const sts10 = pos(gauge.stsPer10cm);
  const rows10 = pos(gauge.rowsPer10cm);
  const construction = String(fit.construction || '');
  const openFront = /cardigan|button|front.?open|opening/i.test(construction);
  const dims = {
    armholeRows: rows10 && pos(body.armholeDepth) ? cmToRows(rows10, body.armholeDepth) : 0,
    sideSeamRows: rows10 && pos(body.backLength) ? cmToRows(rows10, body.backLength) : 0,
    frontBandRows: openFront && rows10 && pos(body.backLength) ? cmToRows(rows10, body.backLength) : 0,
    neckCircumferenceCm: pos(body.neck) || 0
  };
  let plan = {};
  if (sts10 && rows10 && (dims.armholeRows || dims.sideSeamRows || dims.neckCircumferenceCm)) {
    try {
      plan = pickupPlanForEdges({ stsPer10cm: sts10, rowsPer10cm: rows10 }, dims) || {};
    } catch (_) {
      plan = {};
    }
  }
  const pickUp = Object.keys(EDGE_LABEL)
    .filter((k) => plan[k] && pos(plan[k].count))
    .map((k) => ({ edge: EDGE_LABEL[k], key: k, count: plan[k].count, note: String(plan[k].note || '') }));

  const seaming = (Array.isArray(fin.seaming) ? fin.seaming : []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 6);

  if (!items.length && !pickUp.length) return null;

  const parts = [];
  if (items.length) parts.push(`${items.length} band${items.length > 1 ? 's' : ''}`);
  if (pickUp.length) parts.push(`${pickUp.length} pick-up edge${pickUp.length > 1 ? 's' : ''}`);
  const headline = parts.length ? `Finishing plan · ${parts.join(' · ')}` : 'Finishing plan';

  return { ok: true, itemCount: items.length, items, pickUp, seaming, headline };
}

/**
 * Render a {@link summariseFinishing} summary as a plain-text checklist, ready to paste
 * into notes or a tech pack. Total and defensive; a null summary yields a short prompt.
 *
 * @param {object|null} summary the summary from {@link summariseFinishing}.
 * @param {object} [opts] @param {string} [opts.title='Finishing & pick-up'] the sheet heading.
 * @returns {string} the printable sheet, always ending in a newline.
 */
export function finishingToText(summary, opts = {}) {
  const title = (opts && opts.title) || 'Finishing & pick-up';
  if (!summary || !summary.ok) {
    return 'Draft a garment in the Fit panel to plan its finishing.\n';
  }
  const lines = [];
  lines.push(title);
  lines.push('='.repeat(title.length));
  lines.push(summary.headline);
  if (summary.items.length) {
    lines.push('');
    for (const it of summary.items) {
      const dims = [it.stitches != null ? `${it.stitches} sts` : '', it.rows != null ? `${it.rows} rows` : '', it.style ? humanise(it.style) : '']
        .filter(Boolean)
        .join(' · ');
      lines.push(`• ${it.label}${dims ? ' — ' + dims : ''}`);
      for (const step of it.instructions) lines.push(`    ${step}`);
    }
  }
  if (summary.pickUp.length) {
    lines.push('');
    lines.push('Pick-up counts');
    for (const p of summary.pickUp) lines.push(`  ${p.note || `${p.edge}: ${p.count} sts`}`);
  }
  if (summary.seaming.length) {
    lines.push('');
    lines.push('Seaming & blocking');
    summary.seaming.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }
  return lines.join('\n') + '\n';
}
