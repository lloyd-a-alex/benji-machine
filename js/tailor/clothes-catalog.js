/**
 * KNITCAT — Clothes Catalog & generic garment planner (browser-free + testable).
 *
 * One place that knows how to turn body measurements + a measured gauge into a
 * real machine-knitting plan for every kind of garment — not just the beanie and
 * the tank top. Each garment is a small declarative recipe; the engine computes
 * cast-on, rib, body, and shaping and emits round-by-round / row-by-row steps.
 *
 * Parameters flagged `advanced:true` are finer-fit controls. They are no longer
 * hidden behind the designer key — the UI shows every knit control to everyone;
 * the flag just groups the fiddly ones. This file only describes what exists.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = Math.round;
const toF = (v, d) => parseFloat(Number(v).toFixed(d == null ? 1 : d));

/**
 * A parameter descriptor:
 *   { key, label, unit, min, max, step, default, type?, options?, advanced? }
 * type defaults to 'range'. 'select' uses options:[{value,label}].
 */
export const GARMENTS = [
  // ─── Hats ────────────────────────────────────────────────────────────────
  {
    id: 'beanie', name: 'Classic Beanie', category: 'Hats', structure: 'hat', icon: '\uD83E\uDDE2',
    blurb: 'Ribbed brim, straight body, even crown that cinches shut.',
    params: [
      { key: 'head', label: 'Head circumference', unit: 'cm', min: 46, max: 68, step: 1, default: 56 },
      { key: 'height', label: 'Height (brim to crown)', unit: 'cm', min: 14, max: 30, step: 1, default: 20 },
      { key: 'rib', label: 'Brim rib height', unit: 'cm', min: 2, max: 10, step: 1, default: 5 },
      { key: 'segments', label: 'Crown segments', min: 5, max: 10, step: 1, default: 6 },
      { key: 'ease', label: 'Negative ease', unit: 'cm', min: 0, max: 5, step: 0.5, default: 2, advanced: true },
      { key: 'fold', label: 'Fold-over brim', unit: 'cm', min: 0, max: 8, step: 1, default: 0, advanced: true },
      { key: 'crowndepth', label: 'Crown depth', unit: '%', min: 60, max: 140, step: 5, default: 100, advanced: true },
      { key: 'ribtype', label: 'Ribbing', type: 'select', default: '1x1', advanced: true, options: [{ value: '1x1', label: '1×1' }, { value: '2x2', label: '2×2' }] }
    ]
  },
  {
    id: 'slouch', name: 'Slouch Beanie', category: 'Hats', structure: 'hat', icon: '\uD83E\uDDE2',
    blurb: 'Deep, relaxed crown with extra length for that slouch.',
    params: [
      { key: 'head', label: 'Head circumference', unit: 'cm', min: 48, max: 68, step: 1, default: 57 },
      { key: 'height', label: 'Height', unit: 'cm', min: 22, max: 38, step: 1, default: 28 },
      { key: 'rib', label: 'Brim rib height', unit: 'cm', min: 3, max: 10, step: 1, default: 6 },
      { key: 'segments', label: 'Crown segments', min: 6, max: 12, step: 1, default: 8 },
      { key: 'ease', label: 'Negative ease', unit: 'cm', min: 0, max: 4, step: 0.5, default: 1, advanced: true }
    ]
  },
  {
    id: 'beret', name: 'Beret', category: 'Hats', structure: 'hat', icon: '\uD83C\uDFA8',
    blurb: 'Shallow band with a wide, fast-decreasing crown.',
    params: [
      { key: 'head', label: 'Head band circumference', unit: 'cm', min: 46, max: 62, step: 1, default: 55 },
      { key: 'height', label: 'Total height', unit: 'cm', min: 12, max: 22, step: 1, default: 16 },
      { key: 'rib', label: 'Band height', unit: 'cm', min: 2, max: 6, step: 0.5, default: 3 },
      { key: 'segments', label: 'Crown segments', min: 8, max: 12, step: 1, default: 10 },
      { key: 'flare', label: 'Crown flare', unit: 'cm', min: 2, max: 12, step: 1, default: 7, advanced: true }
    ]
  },
  {
    id: 'watchcap', name: 'Watch Cap', category: 'Hats', structure: 'hat', icon: '\u2693',
    blurb: 'Snug, tall-rib fisherman’s cap that sits close.',
    params: [
      { key: 'head', label: 'Head circumference', unit: 'cm', min: 50, max: 66, step: 1, default: 58 },
      { key: 'height', label: 'Height', unit: 'cm', min: 16, max: 24, step: 1, default: 19 },
      { key: 'rib', label: 'Brim rib height', unit: 'cm', min: 4, max: 9, step: 1, default: 7 },
      { key: 'segments', label: 'Crown segments', min: 5, max: 8, step: 1, default: 6 }
    ]
  },
  {
    id: 'headband', name: 'Headband / Ear Warmer', category: 'Hats', structure: 'tube', icon: '\uD83C\uDFD3',
    blurb: 'A simple ribbed tube — quick, stretchy, one size fits most.',
    params: [
      { key: 'head', label: 'Stretched circumference', unit: 'cm', min: 40, max: 58, step: 1, default: 48 },
      { key: 'height', label: 'Width', unit: 'cm', min: 4, max: 14, step: 1, default: 8 },
      { key: 'rib', label: 'All ribbing', unit: 'cm', min: 4, max: 14, step: 1, default: 8 }
    ]
  },

  // ─── Tops ────────────────────────────────────────────────────────────────
  {
    id: 'sweater', name: 'Crewneck Sweater', category: 'Tops', structure: 'body', icon: '\uD83D\uDCE6',
    blurb: 'Pullover worked as a tube from the bottom up, then split for neck + sleeves.',
    params: [
      { key: 'chest', label: 'Finished chest', unit: 'cm', min: 80, max: 150, step: 1, default: 100 },
      { key: 'length', label: 'Body length (hem to shoulder)', unit: 'cm', min: 45, max: 80, step: 1, default: 62 },
      { key: 'rib', label: 'Hem rib height', unit: 'cm', min: 3, max: 8, step: 0.5, default: 5 },
      { key: 'sleeve', label: 'Sleeve length', unit: 'cm', min: 20, max: 70, step: 1, default: 45 },
      { key: 'ease', label: 'Positive ease', unit: 'cm', min: 0, max: 20, step: 1, default: 8, advanced: true },
      { key: 'neckdrop', label: 'Neck drop', unit: 'cm', min: 2, max: 12, step: 0.5, default: 6, advanced: true },
      { key: 'waist', label: 'Waist shaping', unit: 'cm', min: -10, max: 6, step: 1, default: 0, advanced: true },
      { key: 'armhole', label: 'Armhole depth', unit: 'cm', min: 12, max: 30, step: 0.5, default: 20, advanced: true }
    ]
  },
  {
    id: 'cardigan', name: 'Cardigan', category: 'Tops', structure: 'body', icon: '\uD83E\uDDE5',
    blurb: 'Open-front body; front bands are picked up and knit after.',
    params: [
      { key: 'chest', label: 'Finished chest (closed)', unit: 'cm', min: 80, max: 150, step: 1, default: 102 },
      { key: 'length', label: 'Length', unit: 'cm', min: 45, max: 90, step: 1, default: 66 },
      { key: 'rib', label: 'Hem rib height', unit: 'cm', min: 3, max: 8, step: 0.5, default: 5 },
      { key: 'sleeve', label: 'Sleeve length', unit: 'cm', min: 20, max: 70, step: 1, default: 46 },
      { key: 'band', label: 'Front band width', unit: 'cm', min: 2, max: 6, step: 0.5, default: 4, advanced: true }
    ]
  },
  {
    id: 'camisole', name: 'Camisole / Shell', category: 'Tops', structure: 'body', icon: '\uD83D\uDC54',
    blurb: 'Sleeveless top; straps finish the shoulders.',
    params: [
      { key: 'chest', label: 'Finished bust', unit: 'cm', min: 70, max: 140, step: 1, default: 92 },
      { key: 'length', label: 'Body length', unit: 'cm', min: 30, max: 65, step: 1, default: 42 },
      { key: 'rib', label: 'Hem rib height', unit: 'cm', min: 1, max: 5, step: 0.5, default: 2 },
      { key: 'sleeve', label: 'Straps (no sleeves)', unit: 'cm', min: 0, max: 0, step: 1, default: 0 },
      { key: 'neckdrop', label: 'Neck drop', unit: 'cm', min: 4, max: 20, step: 0.5, default: 12, advanced: true }
    ]
  },

  // ─── Neckwear ──────────────────────────────────────────────────────────────
  {
    id: 'scarf', name: 'Scarf', category: 'Neckwear', structure: 'flat', icon: '\uD83E\uDDE3',
    blurb: 'A long ribbed or textured rectangle. Knit flat, back and forth.',
    params: [
      { key: 'width', label: 'Width', unit: 'cm', min: 12, max: 40, step: 1, default: 18 },
      { key: 'length', label: 'Length', unit: 'cm', min: 80, max: 220, step: 5, default: 150 },
      { key: 'border', label: 'End border rib', unit: 'cm', min: 0, max: 12, step: 1, default: 6 }
    ]
  },
  {
    id: 'cowl', name: 'Cowl', category: 'Neckwear', structure: 'tube', icon: '\uD83E\uDDE3',
    blurb: 'A seamless tube you loop over the head — double it for warmth.',
    params: [
      { key: 'head', label: 'Circumference', unit: 'cm', min: 60, max: 130, step: 2, default: 90 },
      { key: 'height', label: 'Height', unit: 'cm', min: 15, max: 40, step: 1, default: 26 },
      { key: 'rib', label: 'Brim rib height', unit: 'cm', min: 0, max: 8, step: 1, default: 4 }
    ]
  },
  {
    id: 'shawl', name: 'Triangle Shawl', category: 'Neckwear', structure: 'triangle', icon: '\uD83E\uDDF4',
    blurb: 'Grown from the nape with an every-row increase to a wide border.',
    params: [
      { key: 'wingspan', label: 'Wingspan (top edge)', unit: 'cm', min: 100, max: 220, step: 5, default: 160 },
      { key: 'height', label: 'Depth (nape to point)', unit: 'cm', min: 30, max: 80, step: 1, default: 55 },
      { key: 'border', label: 'Yarn-over border', unit: 'cm', min: 0, max: 10, step: 1, default: 5 }
    ]
  },

  // ─── Hands & Feet ──────────────────────────────────────────────────────────
  {
    id: 'mittens', name: 'Mittens', category: 'Hands & Feet', structure: 'hand', icon: '\uD83E\uDDE4',
    blurb: 'A ribbed cuff, a warm hand tube and a thumb gusset.',
    params: [
      { key: 'hand', label: 'Hand circumference', unit: 'cm', min: 16, max: 30, step: 1, default: 22 },
      { key: 'length', label: 'Length (cuff to tip)', unit: 'cm', min: 18, max: 32, step: 1, default: 24 },
      { key: 'rib', label: 'Cuff height', unit: 'cm', min: 3, max: 9, step: 1, default: 6 }
    ]
  },
  {
    id: 'wristwarmers', name: 'Wrist Warmers', category: 'Hands & Feet', structure: 'tube', icon: '\uD83E\uDDE4',
    blurb: 'Short ribbed tubes — the fastest gift on the bed.',
    params: [
      { key: 'head', label: 'Wrist circumference', unit: 'cm', min: 14, max: 26, step: 1, default: 18 },
      { key: 'height', label: 'Length', unit: 'cm', min: 8, max: 24, step: 1, default: 16 },
      { key: 'rib', label: 'Cuff rib', unit: 'cm', min: 2, max: 8, step: 1, default: 5 }
    ]
  },
  {
    id: 'socks', name: 'Socks', category: 'Hands & Feet', structure: 'sock', icon: '\uD83E\uDDE6',
    blurb: 'Cuff, leg, heel flap & turn, instep and a tapered toe.',
    params: [
      { key: 'calf', label: 'Calf circumference', unit: 'cm', min: 18, max: 40, step: 1, default: 24 },
      { key: 'leg', label: 'Leg height', unit: 'cm', min: 8, max: 40, step: 1, default: 20 },
      { key: 'foot', label: 'Foot length', unit: 'cm', min: 18, max: 32, step: 0.5, default: 25 },
      { key: 'rib', label: 'Cuff rib height', unit: 'cm', min: 3, max: 8, step: 1, default: 5 }
    ]
  },
  {
    id: 'booties', name: 'Baby Booties', category: 'Baby', structure: 'sock', icon: '\uD83D\uDC3E',
    blurb: 'Tiny cuffed socks for the smallest human.',
    params: [
      { key: 'calf', label: 'Ankle circumference', unit: 'cm', min: 10, max: 18, step: 0.5, default: 13 },
      { key: 'leg', label: 'Leg height', unit: 'cm', min: 3, max: 10, step: 0.5, default: 6 },
      { key: 'foot', label: 'Sole length', unit: 'cm', min: 7, max: 14, step: 0.5, default: 10 },
      { key: 'rib', label: 'Cuff rib height', unit: 'cm', min: 1, max: 5, step: 0.5, default: 3 }
    ]
  },
  {
    id: 'bonnet', name: 'Baby Bonnet', category: 'Baby', structure: 'hat', icon: '\uD83D\uDC76',
    blurb: 'A soft little hat for a newborn.',
    params: [
      { key: 'head', label: 'Head circumference', unit: 'cm', min: 30, max: 46, step: 1, default: 38 },
      { key: 'height', label: 'Height', unit: 'cm', min: 12, max: 22, step: 1, default: 16 },
      { key: 'rib', label: 'Brim rib height', unit: 'cm', min: 1, max: 5, step: 1, default: 3 },
      { key: 'segments', label: 'Crown segments', min: 6, max: 10, step: 1, default: 8 }
    ]
  },
  {
    id: 'babysweater', name: 'Baby Sweater', category: 'Baby', structure: 'body', icon: '\uD83D\uDC76',
    blurb: 'A tiny pullover, knitted from the bottom up.',
    params: [
      { key: 'chest', label: 'Chest', unit: 'cm', min: 44, max: 70, step: 1, default: 55 },
      { key: 'length', label: 'Length', unit: 'cm', min: 24, max: 45, step: 1, default: 32 },
      { key: 'rib', label: 'Hem rib', unit: 'cm', min: 1.5, max: 5, step: 0.5, default: 3 },
      { key: 'sleeve', label: 'Sleeve length', unit: 'cm', min: 12, max: 34, step: 1, default: 22 }
    ]
  },

  // ─── Home ──────────────────────────────────────────────────────────────────
  {
    id: 'washcloth', name: 'Washcloth', category: 'Home', structure: 'flat', icon: '\uD83E\uDDFC',
    blurb: 'A dense garter square that scrubs and dries fast.',
    params: [
      { key: 'width', label: 'Width', unit: 'cm', min: 15, max: 35, step: 1, default: 28 },
      { key: 'length', label: 'Length', unit: 'cm', min: 15, max: 35, step: 1, default: 28 },
      { key: 'border', label: 'Border', unit: 'cm', min: 0, max: 4, step: 0.5, default: 0 }
    ]
  },
  {
    id: 'blanket', name: 'Baby Blanket', category: 'Home', structure: 'flat', icon: '\uD83D\uDECF',
    blurb: 'A squarish throw — big on stitches, easy on the mind.',
    params: [
      { key: 'width', label: 'Width', unit: 'cm', min: 50, max: 120, step: 2, default: 80 },
      { key: 'length', label: 'Length', unit: 'cm', min: 50, max: 150, step: 2, default: 90 },
      { key: 'border', label: 'Border rib', unit: 'cm', min: 0, max: 8, step: 1, default: 4 }
    ]
  },
  {
    id: 'pillow', name: 'Pillow Cover', category: 'Home', structure: 'flat', icon: '\uD83D\uDECB',
    blurb: 'A square panel with a folded envelope back.',
    params: [
      { key: 'width', label: 'Width', unit: 'cm', min: 30, max: 60, step: 1, default: 45 },
      { key: 'length', label: 'Length', unit: 'cm', min: 30, max: 60, step: 1, default: 45 },
      { key: 'border', label: 'Border', unit: 'cm', min: 0, max: 6, step: 1, default: 3 }
    ]
  }
];

export const CATEGORIES = ['Hats', 'Tops', 'Neckwear', 'Hands & Feet', 'Baby', 'Home'];

function paramDefaults(g) {
  const p = {};
  g.params.forEach(x => { p[x.key] = x.default; });
  return p;
}

export class ClothesEngine {
  /**
   * @param {object} garment  a GARMENTS entry
   * @param {object} params   user values
   * @param {object} gauge    { stitchesPer10Cm, rowsPer10Cm }
   */
  compute(garment, params = {}, gauge = {}) {
    if (!garment) return null;
    const p = { ...paramDefaults(garment), ...params };
    const stsPer10 = clamp(parseFloat(gauge.stitchesPer10Cm) || 28, 8, 120);
    const rowsPer10 = clamp(parseFloat(gauge.rowsPer10Cm) || 40, 8, 200);
    const spc = stsPer10 / 10, rpc = rowsPer10 / 10;
    const N = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

    const plan = {
      garment: { id: garment.id, name: garment.name, category: garment.category, structure: garment.structure, icon: garment.icon, blurb: garment.blurb },
      params: p, gauge: { stitchesPer10Cm: stsPer10, rowsPer10Cm: rpc },
      parts: [], instructions: [], footprintCm: { w: 0, h: 0 }
    };

    switch (garment.structure) {
      case 'hat': this._hat(plan, p, spc, rpc, N); break;
      case 'tube': this._tube(plan, p, spc, rpc, N); break;
      case 'flat': this._flat(plan, p, spc, rpc, N); break;
      case 'body': this._body(plan, p, spc, rpc, N); break;
      case 'hand': this._hand(plan, p, spc, rpc, N); break;
      case 'sock': this._sock(plan, p, spc, rpc, N); break;
      case 'triangle': this._triangle(plan, p, spc, rpc, N); break;
      default: this._tube(plan, p, spc, rpc, N);
    }
    return plan;
  }

  _hat(plan, p, spc, rpc, N) {
    const segs = clamp(round(N(p.segments)) || 6, 4, 12);
    const circ = Math.max(30, N(p.head) - N(p.ease));
    const height = N(p.height) + Math.max(0, N(p.fold)); // fold-over brim adds working length
    const rib = N(p.rib);
    const divisor = segs * (p.ribtype === '2x2' ? 4 : 1); // 2×2 needs a multiple of 4
    let bodySts = round(circ * spc);
    bodySts = Math.max(divisor, Math.floor(bodySts / divisor) * divisor);
    const ribSts = Math.max(divisor, Math.floor(bodySts * 0.86 / 2) * 2);
    const ribRows = round(rib * rpc), bodyRows = Math.max(4, round((height - rib) * rpc));
    const crownScale = clamp((N(p.crowndepth) || 100) / 100, 0.6, 1.4);
    const crown = []; let remaining = bodySts, guard = 0;
    const crownTarget = round(segs * crownScale) || segs;
    while (remaining > crownTarget && guard < 10) {
      guard++;
      const dec = Math.max(segs, Math.floor(remaining / 5 / segs) * segs || segs);
      remaining -= dec; crown.push({ dec, remaining });
    }
    plan.parts.push({ name: 'Body (brim→crown)', castOn: ribSts, rows: ribRows + bodyRows, circumferenceCm: toF(circ), heightCm: toF(height) });
    plan.instructions = [
      { step: 1, title: 'Cast on & rib', text: `Cast on ${ribSts} sts, join in the round. Work ${rib} cm (${ribRows} rounds) of rib on reduced tension.` },
      { step: 2, title: 'Body', text: `Increase to ${bodySts} sts. Knit even until the piece measures ${toF(height - rib)} cm above the rib (${bodyRows} rounds).` },
      { step: 3, title: 'Crown', text: `Place ${segs} markers (${Math.round(bodySts / segs)} sts apart).` },
      ...crown.map((c, i) => ({ step: 4 + i, title: `Crown dec ${i + 1}`, text: `Decrease ${c.dec} sts evenly (every ${Math.max(1, Math.round(bodySts / segs))}st st this round) → ${c.remaining} sts.` })),
      { step: 4 + crown.length, title: 'Finish', text: `Break yarn, thread the last ${segs} sts, cinch and fasten off. Weave in ends.` }
    ];
    plan.footprintCm = { w: toF(circ / 3.14), h: toF(height) };
  }

  _tube(plan, p, spc, rpc, N) {
    const circ = N(p.head) || N(p.calf); const height = N(p.height);
    const sts = Math.max(8, round(circ * spc));
    const rib = Math.min(N(p.rib) || 0, height);
    const rows = Math.max(4, round(height * rpc));
    plan.parts.push({ name: 'Tube', castOn: sts, rows, circumferenceCm: toF(circ), heightCm: toF(height) });
    plan.instructions = [
      { step: 1, title: 'Cast on', text: `Cast on ${sts} sts and join in the round (don’t twist).` },
      { step: 2, title: 'Work', text: rib > 0 ? `Work ribbing for ${rib} cm, then knit even to ${height} cm total (${rows} rounds).` : `Knit even until the tube measures ${height} cm (${rows} rounds).` },
      { step: 3, title: 'Bind off', text: 'Bind off in pattern, stretchy. Weave in ends.' }
    ];
    plan.footprintCm = { w: toF(circ), h: toF(height) };
  }

  _flat(plan, p, spc, rpc, N) {
    const width = N(p.width), length = N(p.length), border = Math.min(N(p.border) || 0, length / 2);
    const sts = Math.max(6, round(width * spc));
    const rows = Math.max(4, round(length * rpc));
    plan.parts.push({ name: 'Panel', castOn: sts, rows, widthCm: toF(width), lengthCm: toF(length) });
    plan.instructions = [
      { step: 1, title: 'Cast on', text: `Cast on ${sts} sts (${width} cm wide).` },
      border > 0
        ? { step: 2, title: 'Borders & body', text: `Work ${border} cm (${round(border * rpc)} rows) of rib, knit the middle plain, then mirror the rib for the last ${border} cm. Total ${rows} rows.` }
        : { step: 2, title: 'Body', text: `Knit every row (garter) or in pattern until the piece measures ${length} cm (${rows} rows).` },
      { step: 3, title: 'Bind off', text: 'Bind off loosely in pattern. Block to measurements.' }
    ];
    plan.footprintCm = { w: toF(width), h: toF(length) };
  }

  _body(plan, p, spc, rpc, N) {
    const chest = N(p.chest); const length = N(p.length); const rib = N(p.rib); const sleeve = N(p.sleeve);
    const bodySts = Math.max(16, round(chest * spc));
    const ribSts = Math.max(16, Math.floor(bodySts * 0.92 / 2) * 2);
    const waistSts = Math.max(16, round((chest + N(p.waist)) * spc / 2) * 2); // designer waist shaping
    const bodyRows = Math.max(8, round(length * rpc));
    const armhole = N(p.armhole) || length * 0.4;
    const armSts = round(bodySts * 0.24);
    const sleeveRows = Math.max(6, round(sleeve * rpc));
    plan.parts.push({ name: 'Body', castOn: ribSts, rows: bodyRows, circumferenceCm: toF(chest), heightCm: toF(length) });
    if (sleeve > 0) plan.parts.push({ name: 'Sleeves ×2', castOn: round(chest * 0.18 * spc), rows: sleeveRows, circumferenceCm: toF(chest * 0.24) });
    const inst = [
      { step: 1, title: 'Hem rib', text: `Cast on ${ribSts} sts, join in the round. Work ${rib} cm rib.` },
      N(p.waist) !== 0
        ? { step: 2, title: 'Waist shaping', text: `Change to ${bodySts} sts; shape in to ${waistSts} sts at the waist then back out, reaching the armhole at ${toF(length - armhole)} cm.` }
        : { step: 2, title: 'Body to armholes', text: `Change to ${bodySts} sts; knit until the piece measures ${toF(length - armhole)} cm to the armhole.` },
      { step: 3, title: 'Shoulders & neck', text: `Put ${armSts} sts on hold for each armhole; shape the neck over the last ${round(N(p.neckdrop) * rpc)} rows.` },
      sleeve > 0
        ? { step: 4, title: 'Sleeves', text: `Knit two sleeves of ${plan.parts[1].castOn} sts working a few increases to ${armSts} sts at the top, ${sleeve} cm long.` }
        : { step: 4, title: 'Straps / bands', text: 'Pick up and knit the shoulder straps and neckband to length.' },
      { step: 5, title: 'Finish', text: 'Seam underarms, weave in ends, block.' }
    ];
    plan.instructions = inst;
    plan.footprintCm = { w: toF(chest / 2), h: toF(length + sleeve) };
  }

  _hand(plan, p, spc, rpc, N) {
    const circ = N(p.hand); const length = N(p.length); const rib = N(p.rib);
    const sts = Math.max(24, round(circ * spc));
    const rows = Math.max(20, round(length * rpc));
    const thumbSts = round(sts * 0.28);
    plan.parts.push({ name: 'Mitten', castOn: sts, rows, circumferenceCm: toF(circ), heightCm: toF(length) });
    plan.instructions = [
      { step: 1, title: 'Cuff', text: `Cast on ${sts} sts, join; rib for ${rib} cm (${round(rib * rpc)} rounds).` },
      { step: 2, title: 'Hand', text: `Knit even until ${toF(length * 0.55)} cm from the cuff.` },
      { step: 3, title: 'Thumb gusset', text: `Increase ${thumbSts} sts over 4 rounds at the base of the thumb; keep them on hold.` },
      { step: 4, title: 'Close the top', text: `Knit to the fingertip then decrease ${Math.max(2, round(sts / 8))} sts per round to close.` },
      { step: 5, title: 'Thumb', text: `Return the ${thumbSts} held sts, pick up 4 around the gusset, knit the thumb down 3.5 cm and tip it.` }
    ];
    plan.footprintCm = { w: toF(circ), h: toF(length) };
  }

  _sock(plan, p, spc, rpc, N) {
    const leg = N(p.leg), foot = N(p.foot), rib = N(p.rib);
    const ankle = Math.max(16, round((N(p.calf) * 0.72) * spc));
    const legRows = Math.max(10, round(leg * rpc));
    const footRows = Math.max(10, round(foot * rpc));
    const heelRows = round(ankle / 2);
    plan.parts.push({ name: 'Sock', castOn: ankle, rows: legRows + heelRows + footRows, circumferenceCm: toF(N(p.calf)), heightCm: toF(leg + foot) });
    plan.instructions = [
      { step: 1, title: 'Cuff', text: `Cast on ${ankle} sts, join; rib ${rib} cm (${round(rib * rpc)} rounds).` },
      { step: 2, title: 'Leg', text: `Knit even for ${leg} cm (${legRows} rounds).` },
      { step: 3, title: 'Heel flap', text: `Work ${ankle / 2} sts flat over ${heelRows} rows, then turn the wedge (short rows).` },
      { step: 4, title: 'Gusset & foot', text: `Pick up ${round(heelRows * 0.6)} sts each side, decrease the gusset back to ${ankle} sts, foot down ${toF(foot * 0.6)} cm.` },
      { step: 5, title: 'Toe', text: `Decrease 4 sts every other round until ${Math.max(8, round(ankle / 3))} remain; Kitchener the seam.` }
    ];
    plan.footprintCm = { w: toF(N(p.calf)), h: toF(leg + foot) };
  }

  _triangle(plan, p, spc, rpc, N) {
    const wingspan = N(p.wingspan), depth = N(p.height);
    const finalSts = round(wingspan * spc);
    const rows = Math.max(20, round(depth * rpc));
    plan.parts.push({ name: 'Shawl', castOn: 3, rows, widthCm: toF(wingspan), lengthCm: toF(depth) });
    plan.instructions = [
      { step: 1, title: 'Start at the nape', text: 'Cast on 3 sts.' },
      { step: 2, title: 'Grow the triangle', text: `On every right-side row work a YO at both edges and either side of the centre spine (6 sts added per RS row) until you have ${finalSts} sts.` },
      { step: 3, title: 'Border', text: N(p.border) > 0 ? `Work ${p.border} cm of garter or a YO lace border.` : 'Knit the final plain rows.' },
      { step: 4, title: 'Bind off & block', text: `Bind off in pattern (approx ${finalSts} sts). Block hard to open the lace — a ${wingspan} cm wingspan.` }
    ];
    plan.footprintCm = { w: toF(wingspan), h: toF(depth) };
  }

  /** 1:1 printable SVG of the plan outline(s). */
  toSvg(plan) {
    if (!plan) return '';
    const mm = 1; // work in mm
    const m = 15;
    const w = Math.max(60, (plan.footprintCm.w || 10)) * 10 + m * 2;
    const h = Math.max(60, (plan.footprintCm.h || 10)) * 10 + m * 2;
    const first = plan.parts[0] || {};
    const lines = plan.parts.map((part, i) =>
      `<text x="${m}" y="${h - m - (plan.parts.length - i - 1) * 5}" font-family="monospace" font-size="4" fill="#0f172a">${part.name}: cast on ${part.castOn} · ${part.rows} rows</text>`
    ).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${(w / 10).toFixed(1)}cm" height="${(h / 10).toFixed(1)}cm" viewBox="0 0 ${w} ${h}">
  <style>.cut{fill:none;stroke:#e11d48;stroke-width:1.2}</style>
  <rect class="cut" x="${m}" y="${m}" width="${w - m * 2}" height="${h - m * 2}" />
  <text x="${w / 2}" y="${m + 8}" text-anchor="middle" font-family="monospace" font-size="6" font-weight="bold" fill="#0f172a">${plan.garment.name.toUpperCase()} — 1:1</text>
  ${lines}
  <text x="${w / 2}" y="${h - 3}" text-anchor="middle" font-family="monospace" font-size="4" fill="#334155">Gauge ${plan.gauge.stitchesPer10Cm} sts / ${plan.gauge.rowsPer10Cm} rows per 10 cm · made for Benji ♥</text>
</svg>`;
  }
}
