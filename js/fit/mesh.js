/**
 * KNITCAT V2 — body and garment meshes for the 3D drape preview (spec §2.5).
 *
 * The drape preview needs geometry: a cylindrical-ish body built from the measurements, and a
 * garment built from the drafted pieces wrapped onto it. This module generates both as plain
 * vertex/face arrays (no Three.js, no DOM) so the solver in {@link module:fit/drape} can run
 * under Node and the UI can feed the arrays to any renderer it likes.
 *
 * The body is a stack of elliptical rings (chest, waist, hip, plus limbs) interpolated to a
 * tube; a garment piece is a quad grid sized by its own stitch/row counts, positioned at the
 * body landmark it belongs to. Landmarks are stored by name so the solver can apply seam and
 * collision constraints against them.
 *
 * @module fit/mesh
 */

/** A minimal 3-vector helper (kept here so no external math lib is pulled in). */
export function vec(x = 0, y = 0, z = 0) { return { x, y, z }; }
export function addV(a, b) { return vec(a.x + b.x, a.y + b.y, a.z + b.z); }
export function subV(a, b) { return vec(a.x - b.x, a.y - b.y, a.z - b.z); }
export function scaleV(a, s) { return vec(a.x * s, a.y * s, a.z * s); }
export function lenV(a) { return Math.hypot(a.x, a.y, a.z); }
export function distV(a, b) { return lenV(subV(a, b)); }

/** Convert a circumference (cm) into an ellipse radius pair assuming a 1.35:1 side:front. */
function circumferenceToRadii(cm) {
  const r = Math.max(1, cm) / (2 * Math.PI);
  return { rx: r * 0.72, rz: r * 1.0 }; // wider front-back than side-to-side for a torso
}

/**
 * Build a {@link BodyMesh}: a torso tube (neck→shoulder→chest→waist→hip) plus two arms.
 * @param {object} m measurements in cm (bust, waist, hip, neck, shoulderWidth, backLength, upperArm, wrist, armLength)
 * @returns {{vertices:{x:number,y:number,z:number}[], faces:[number,number,number][], landmarks:Record<string,number>, rings:number[], units:string}}
 */
export function buildBodyMesh(m = {}) {
  const bust = m.bust || 96, waist = m.waist || 82, hip = m.hip || 100, neck = m.neck || 38;
  const backLength = m.backLength || 46, shoulderWidth = m.shoulderWidth || 42;
  const upperArm = m.upperArm || 32, wrist = m.wrist || 18, armLength = m.armLength || 62;
  const SEG = 16; // points around each ring
  const vertices = [];
  const faces = [];
  const rings = [];
  const landmarks = {};

  const torsoLevels = [
    { y: 0, c: neck * 1.05, name: 'neck' },
    { y: -backLength * 0.12, c: bust * 1.02, name: 'shoulder' },
    { y: -backLength * 0.4, c: bust, name: 'bust' },
    { y: -backLength * 0.75, c: waist, name: 'waist' },
    { y: -backLength, c: hip, name: 'hip' }
  ];

  const addRing = (level, radiusScale = 1) => {
    const { rx, rz } = circumferenceToRadii(level.c * radiusScale);
    const half = shoulderWidth / 2;
    const start = vertices.length;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      vertices.push(vec(Math.cos(a) * rx, level.y, Math.sin(a) * rz));
    }
    rings.push(start);
    landmarks[level.name] = start;
    return start;
  };
  for (let l = 0; l < torsoLevels.length; l++) {
    const ringStart = addRing(torsoLevels[l]);
    if (l > 0) {
      const prev = rings[rings.length - 2];
      for (let i = 0; i < SEG; i++) {
        const a = prev + i, b = prev + ((i + 1) % SEG), c = ringStart + ((i + 1) % SEG), d = ringStart + i;
        faces.push([a, b, c], [a, c, d]);
      }
    }
  }

  // Two arm tubes hanging from the shoulder ring.
  for (const side of [-1, 1]) {
    const topY = torsoLevels[1].y;
    const shoulderX = (circumferenceToRadii(bust).rx) * side;
    const armLevels = [
      { y: topY, c: upperArm * 1.25 },
      { y: topY - armLength * 0.5, c: upperArm },
      { y: topY - armLength, c: wrist * 1.1 }
    ];
    const base = vertices.length;
    const armRings = [];
    for (let l = 0; l < armLevels.length; l++) {
      const { rx, rz } = circumferenceToRadii(armLevels[l].c);
      const start = vertices.length;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        vertices.push(vec(shoulderX + Math.cos(a) * rx, armLevels[l].y, Math.sin(a) * rz));
      }
      armRings.push(start);
      if (l === 0) landmarks[side < 0 ? 'leftShoulder' : 'rightShoulder'] = start;
      if (l === armLevels.length - 1) landmarks[side < 0 ? 'leftWrist' : 'rightWrist'] = start;
    }
    for (let l = 1; l < armRings.length; l++) {
      const prev = armRings[l - 1], cur = armRings[l];
      for (let i = 0; i < 8; i++) {
        const a = prev + i, b = prev + ((i + 1) % 8), c = cur + ((i + 1) % 8), d = cur + i;
        faces.push([a, b, c], [a, c, d]);
      }
    }
    void base;
  }

  return { vertices, faces, landmarks, rings, units: 'cm', seg: SEG };
}

/**
 * Build a {@link GarmentMesh} from drafted pieces: each piece becomes a flat quad grid sized
 * by castOn (width) × totalRows (height), tagged with the body landmark it is anchored to.
 * @param {object[]} pieces PatternPieces from {@link module:fit/templates.draftGarment}
 * @param {object} gauge { stsPer10cm, rowsPer10cm } so we can convert counts to cm
 * @returns {{panels:Array, seams:Array, restShape:number}}
 */
export function buildGarmentMesh(pieces = [], gauge = {}) {
  const spc = (gauge.stsPer10cm || 22) / 10;
  const rpc = (gauge.rowsPer10cm || 30) / 10;
  const panels = [];
  const seams = [];
  let restShape = 0;
  for (const p of pieces) {
    const w = Math.max(1, Math.round((p.castOn || p.finalStitches || 1) * spc * 10)); // width in mm-ish units
    const h = Math.max(1, Math.round((p.totalRows || p.rows?.length || 1) * rpc * 10));
    const cols = Math.min(24, Math.max(4, Math.round(w / 12)));
    const rows = Math.min(24, Math.max(4, Math.round(h / 12)));
    const verts = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      verts.push(vec((c / cols) * w - w / 2, -((r / rows) * h), 0));
    }
    restShape += verts.length;
    panels.push({
      id: p.id, name: p.name, cols, rows, vertices: verts,
      anchor: anchorForPiece(p), widthStitches: p.castOn || p.finalStitches || 0, heightRows: p.totalRows || (p.rows || []).length
    });
    for (const s of (p.seams || [])) seams.push({ from: p.id, to: s.with, edge: s.edge || 'edge' });
    if (p.join) for (const j of p.join) seams.push({ from: p.id, to: j, edge: 'join' });
  }
  return { panels, seams, restShape };
}

/** Guess which body landmark a piece wraps. */
function anchorForPiece(p) {
  const id = String(p.id || '').toLowerCase();
  if (id.includes('sleeve')) return 'upperArm';
  if (id.includes('collar') || id.includes('neck')) return 'neck';
  if (id.includes('yoke')) return 'shoulder';
  if (id.includes('strap') || id.includes('saddle')) return 'shoulder';
  return 'bust';
}

/**
 * Measure the actual circumference a panel would produce at its anchor height, given gauge —
 * used by the fit report to compare target (body+ease) vs actual (piece stitches).
 * @param {number} stitches @param {number} stsPer10cm @returns {number} cm
 */
export function panelCircumference(stitches, stsPer10cm) {
  return stsPer10cm ? (stitches / stsPer10cm) * 10 : 0;
}
