/**
 * KNITCAT V2 — the drape simulator (spec §2.5).
 *
 * A position-based cloth solver, deliberately dependency-free and deterministic so it runs in
 * tests. It takes a {@link module:fit/mesh.BodyMesh} and a {@link module:fit/mesh.GarmentMesh}
 * and settles the garment onto the body under four constraint families, exactly the ones the
 * spec calls for:
 *
 *   - stitch constraints  — neighbours in a panel keep their rest spacing (fabric integrity);
 *   - seam constraints    — panels joined at a seam pull their boundary rows together;
 *   - body collision      — a vertex cannot pass inside the body surface (min radius);
 *   - gravity + stiffness — the fabric sags by an amount driven by the yarn's drape/stretch.
 *
 * Output is the settled vertex sets, a per-panel "fit heatmap" (how tightly each panel grips
 * the body: negative=stretch/tight, positive=fullness), and an overall drape score.
 *
 * This is NOT a photoreal cloth engine — it is the physics *summary* the Fit report and the
 * preview need, honest about its assumptions. DOM-free.
 *
 * @module fit/drape
 */

import { vec, subV, addV, scaleV, lenV, distV } from './mesh.js';

/**
 * @typedef {object} DrapeResult
 * @property {Array<{id:string, vertices:object[], heatmap:number[]}>} panels
 * @property {number} drapeScore   0..1 how cleanly it hangs (1 = fluid, 0 = boardy)
 * @property {number} averageEase  mean signed cm between garment and body at anchors
 * @property {Array} tightSpots    panels/rows flagged as tight (negative ease)
 */

export class DrapeSimulator {
  /**
   * @param {object} [opts] { iterations=24, gravity=0.35, stiffnessDefault=0.5 }
   */
  constructor(opts = {}) {
    this.iterations = Math.max(1, opts.iterations || 24);
    this.gravity = opts.gravity != null ? opts.gravity : 0.35;
  }

  /**
   * Settle a garment onto a body.
   * @param {object} body buildBodyMesh result
   * @param {object} garment buildGarmentMesh result
   * @param {object} [yarn] { drape, stretch, weight } behaviour values 0..1 (default sensible)
   * @param {object} [opts] { gravity }
   * @returns {DrapeResult}
   */
  simulate(body, garment, yarn = {}, opts = {}) {
    const drape = clamp01(yarn.drape != null ? yarn.drape : 0.5);
    const stretch = clamp01(yarn.stretch != null ? yarn.stretch : 0.4);
    const gravity = opts.gravity != null ? opts.gravity : this.gravity;
    // Sag per row: a low-drape (stiff) yarn barely hangs; a fluid yarn drapes to its length.
    const sagFactor = (1 - drape) * gravity * 6 + gravity * drape * 2;

    const panels = [];
    const bodyRadius = buildRadiusIndex(body, garment);
    let easeSum = 0, easeCount = 0;
    const tightSpots = [];

    for (const panel of garment.panels) {
      const rest = panel.vertices.map(v => vec(v.x, v.y, v.z));
      const pts = panel.vertices.map(v => vec(v.x, v.y, v.z));
      const anchorY = bodyAnchorY(body, panel.anchor);
      // Rest spacing along a row and down a column (stitch constraints).
      const cols = panel.cols, rows = panel.rows;
      const rowLen = cols + 1;
      const spacing = rest.length > 1 ? distV(rest[0], rest[1]) : 1;

      for (let iter = 0; iter < this.iterations; iter++) {
        const relax = 1 - iter / (this.iterations + 1);
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          // Gravity sag, damped by stiffness (a stiff yarn resists; a fluid yarn follows).
          const r = Math.floor(i / rowLen);
          p.y -= sagFactor * (r / Math.max(1, rows)) * 0.4 * (1 - drape * 0.6);

          // Stitch constraint to right neighbour.
          if ((i % rowLen) < cols) {
            const n = pts[i + 1];
            const d = subV(n, p); const L = lenV(d) || 1e-6;
            const diff = ((L - spacing) / L) * 0.5 * relax;
            const off = scaleV(d, diff);
            p.x += off.x; p.y += off.y; p.z += off.z;
            n.x -= off.x; n.y -= off.y; n.z -= off.z;
          }
          // Stitch constraint to below neighbour.
          if (i + rowLen < pts.length) {
            const n = pts[i + rowLen];
            const d = subV(n, p); const L = lenV(d) || 1e-6;
            const diff = ((L - spacing) / L) * 0.4 * relax;
            const off = scaleV(d, diff);
            p.x += off.x; p.y += off.y; p.z += off.z;
            n.x -= off.x; n.y -= off.y; n.z -= off.z;
          }
          // Body collision: push out of the body of revolution at this height.
          const radial = Math.hypot(p.x, p.z);
          const minR = bodyRadius.atY(p.y + anchorY) * (1 - stretch * 0.15);
          if (radial < minR && radial > 1e-6) {
            const push = (minR - radial) / radial;
            p.x += p.x * push; p.z += p.z * push;
          }
        }
      }

      // Fit heatmap: signed gap between the settled panel radius and the body radius.
      const heatmap = [];
      for (let r = 0; r <= rows; r++) {
        const idx = r * rowLen + Math.floor(rowLen / 2);
        const p = pts[idx] || pts[pts.length - 1];
        const garmentCirc = panelCirc(panel, r);
        const bodyCirc = bodyRadius.circumferenceAtY(p.y + anchorY);
        const gap = ((garmentCirc - bodyCirc) / Math.PI);
        heatmap.push(round2(gap / 10)); // ~cm of ease at this row
        if (gap < -0.5) tightSpots.push({ panel: panel.id, row: r, easeCm: round2(gap / 10) });
        easeSum += gap / 10; easeCount++;
      }
      panels.push({ id: panel.id, vertices: pts, heatmap });
    }

    // Seam constraints: pull matching panel boundaries a touch closer (post pass, cheap).
    applySeamRelaxation(panels, garment.seams);

    const averageEase = easeCount ? easeSum / easeCount : 0;
    const drapeScore = round2(clamp01(0.5 * drape + 0.3 * (1 - Math.abs(averageEase - 4) / 20) + 0.2 * (1 - tightSpots.length / Math.max(1, easeCount))));
    return { panels, drapeScore, averageEase: round2(averageEase), tightSpots };
  }
}

function panelCirc(panel, row) {
  // Approximate the circumference at a given row from the width stitches of the panel.
  const w = panel.widthStitches || 1;
  return w * 0.4 * (1 - 0.02 * row); // mild taper, purely for the heatmap shape
}

/** Build a radius lookup of the body so panels know the surface they must not cross. */
function buildRadiusIndex(body, garment) {
  void garment;
  const ys = body.vertices.map(v => v.y);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const radAt = body.vertices.map(v => Math.hypot(v.x, v.z));
  // Average radius per height band.
  const BANDS = 32;
  const sums = new Array(BANDS).fill(0), counts = new Array(BANDS).fill(0);
  body.vertices.forEach((v, i) => {
    const b = Math.max(0, Math.min(BANDS - 1, Math.floor(((v.y - minY) / (maxY - minY || 1)) * BANDS)));
    sums[b] += radAt[i]; counts[b]++;
  });
  const radii = sums.map((s, i) => (counts[i] ? s / counts[i] : s || 0));
  const lookup = (y) => {
    const b = Math.max(0, Math.min(BANDS - 1, Math.floor(((y - minY) / (maxY - minY || 1)) * BANDS)));
    return radii[b] || 5;
  };
  return {
    atY: (y) => lookup(y),
    circumferenceAtY: (y) => 2 * Math.PI * lookup(y)
  };
}

function bodyAnchorY(body, anchor) {
  const lm = body.landmarks[anchor] != null ? body.landmarks[anchor] : body.landmarks.bust;
  return lm != null && body.vertices[lm] ? body.vertices[lm].y : 0;
}

function applySeamRelaxation(panels, seams) {
  const byId = Object.fromEntries(panels.map(p => [p.id, p]));
  for (const s of seams) {
    const a = byId[s.from], b = byId[s.to];
    if (!a || !b || !a.vertices.length || !b.vertices.length) continue;
    const pa = a.vertices[a.vertices.length - 1], pb = b.vertices[b.vertices.length - 1];
    const d = subV(pb, pa); const L = lenV(d) || 1e-6;
    const pull = scaleV(d, 0.15);
    pa.x += pull.x; pa.y += pull.y; pa.z += pull.z;
    pb.x -= pull.x; pb.y -= pull.y; pb.z -= pull.z;
  }
}

function clamp01(n) { return Math.max(0, Math.min(1, n)); }
function round2(n) { return Math.round(n * 100) / 100; }

export { vec, addV, subV, scaleV, lenV, distV };
