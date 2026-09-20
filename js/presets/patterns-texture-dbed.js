/**
 * KNITCAT - Pattern library, TEXTURE and DOUBLE-BED families.
 *
 * Texture is the family the carriage makes rather than the yarn: needles are held
 * (tuck) or skipped (slip) so loops pile up into waffles, ribs, blisters and welts.
 * The value alphabet is the same 0/1 the compiler expects in `tuck` and `slip` modes —
 * `1` punches the needle into work, `0` leaves it held/slipped — exactly as the classic
 * `honeycomb_tuck` and `bird_eye_slip` presets already use it.
 *
 * Double-bed patterns are honest about what they are. A flat single-bed card cannot
 * physically cross two needle beds, so these are authored as *two-face* charts (a colour
 * that must appear on the front and its reverse on the back), tagged `bed: 'double-bed'`
 * so the browser and the feasibility advisor both say "this wants two beds" before you
 * commit. The hole-and-rack recipe is the one the boyfriend's video described: transfer
 * out at rack 0, transfer back at rack ±1, and because the whole bed racks together a
 * single row can only carry one rack value — the exact constraint
 * `js/machine/carriage-passes.js` (validateRackRow, planDoubleBedHole) encodes.
 */

import {
  preset,
  blankDirect
} from './preset-recipe-helpers.js';
import {
  planDoubleBedHole,
  validateRackRow,
  occupancyAfterTransfers
} from '../machine/carriage-passes.js';

const X = 1;
const _ = 0;

/** A generate() that tiles a boolean rule over the card. */
function rule(fn) {
  return (rows, cols) => {
    const matrix = new Array(rows);
    for (let r = 0; r < rows; r++) {
      matrix[r] = new Array(cols);
      for (let c = 0; c < cols; c++) matrix[r][c] = fn(r, c, rows, cols) ? X : _;
    }
    return matrix;
  };
}

export const TEXTURE_PRESETS = [
  preset({
    id: 'waffle_slip',
    name: 'Waffle (Thermal) Slip Stitch',
    family: 'texture',
    group: 'slip',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'slip',
    tags: ['waffle', 'thermal', 'slip', 'warm'],
    description:
      'The thermal waffle: slipped needles trap a grid of little pockets, so the fabric thickens and insulates — the classic winter slip-stitch structure.',
    generate: rule((r, c) => !((r % 4 === 0 && c % 4 === 0) || (r % 4 === 2 && c % 4 === 2)))
  }),

  preset({
    id: 'basket_weave_tuck',
    name: 'Basketweave Tuck',
    family: 'texture',
    group: 'tuck',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['basket', 'weave', 'tuck'],
    description:
      'A woven-basket relief: alternating 3x3 blocks of tuck and knit so the surface reads like wicker, worked entirely in one colour.',
    generate: rule((r, c) => (Math.floor(r / 3) + Math.floor(c / 3)) % 2 === 0)
  }),

  preset({
    id: 'shaker_rib_tuck',
    name: 'Shaker Rib (Shaker Knot)',
    family: 'texture',
    group: 'tuck',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['shaker', 'rib', 'tuck', 'simple'],
    description:
      'The Shaker rib: one held needle every few plain ones draws a clean vertical cord, the humblest and most useful of the tuck ribs.',
    generate: rule((r, c) => c % 4 !== 2)
  }),

  preset({
    id: 'blister_tuck',
    name: 'Blister (Tuck Bubble)',
    family: 'texture',
    group: 'tuck',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['blister', 'bubble', 'tuck', '3d'],
    description:
      'A blister fabric: a patch of needles tucked several rows running piles up extra yarn and domes outward into a bubble that stands proud of the ground.',
    generate: rule((r, c) => {
      const inBlister = c % 8 < 4 && r % 8 < 4;
      return inBlister ? (r % 8) % 2 === 0 : true;
    })
  }),

  preset({
    id: 'diamond_tuck',
    name: 'Diamond Tuck Texture',
    family: 'texture',
    group: 'tuck',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['diamond', 'tuck', 'relief'],
    description:
      'Raised diamonds on a plain ground: tuck columns that widen then narrow, the relief standing along the diagonals of an 8-point lattice.',
    generate: rule((r, c) => {
      const dx = Math.abs((c % 8) - 3.5);
      const dy = Math.abs((r % 8) - 3.5);
      return dx + dy > 4;
    })
  }),

  preset({
    id: 'wave_tuck',
    name: 'Wave Tuck Fabric',
    family: 'texture',
    group: 'tuck',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['wave', 'tuck', 'organic'],
    description:
      'A rolling wave relief: the tuck line follows a sine across the bed and crests and troughs forever, drawing the fabric into standing ripples.',
    generate: rule((r, c) => {
      const crest = Math.round(3 * Math.sin((c / 24) * Math.PI * 4) + 3.5);
      return Math.abs((r % 8) - crest) > 1;
    })
  }),

  preset({
    id: 'seed_slip',
    name: 'Seed (Lincoln) Slip Stitch',
    family: 'texture',
    group: 'slip',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'slip',
    tags: ['seed', 'granary', 'slip'],
    description:
      'A granary seed texture from alternating slipped stitches, the pebbled face that curls less than stockinette and hides yarn ends.',
    generate: rule((r, c) => (r + c) % 2 === 0)
  }),

  preset({
    id: 'twill_slip',
    name: 'Twill Slip Stitch',
    family: 'texture',
    group: 'slip',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'slip',
    tags: ['twill', 'diagonal', 'slip'],
    description:
      'A woven twill drawn in slipped stitches: the float line shifts one needle each row so the fabric is ribbed on the diagonal, like a worsted suit cloth.',
    generate: rule((r, c) => (c - r) % 6 >= 3)
  }),

  preset({
    id: 'herringbone_slip',
    name: 'Herringbone Slip Stitch',
    family: 'texture',
    group: 'slip',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'slip',
    tags: ['herringbone', 'twill', 'slip'],
    description:
      'Herringbone twill in slip: the diagonal reverses every eight needles, breaking the twill line into the classic broken-zigzag of a tweed.',
    generate: rule((r, c) => {
      const band = Math.floor(c / 8) % 2 === 0 ? 1 : -1;
      return ((c + band * r) % 8) < 4;
    })
  }),

  preset({
    id: 'moss_tuck',
    name: 'Moss (Granstone) Stitch',
    family: 'texture',
    group: 'stitches',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['moss', 'granstone', 'checker'],
    description:
      'Moss stitch — the checkerboard of knit and purl bumps that lies flat on both beds, here worked as a one-by-one tuck/checker so neither side curls.',
    generate: rule((r, c) => (Math.floor(r / 2) + Math.floor(c / 2)) % 2 === 0)
  }),

  preset({
    id: 'rice_stitch',
    name: 'Rice (Sedelle) Stitch',
    family: 'texture',
    group: 'stitches',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['rice', 'sedenelle', 'texture'],
    description:
      'Rice stitch: seed on the offset, so the bumps scatter like grains rather than lining up, giving a denser, squarer fabric than plain moss.',
    generate: rule((r, c) => (r + Math.floor(c / 2) * 2 + (c % 2)) % 4 < 2)
  }),

  preset({
    id: 'dogtooth_tuck',
    name: 'Dogtooth (Houndstooth Relief)',
    family: 'texture',
    group: 'stitches',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['dogtooth', 'houndstooth', 'relief'],
    description:
      'A dogtooth relief built from tuck rather than colour: the abstract four-pointed shape of pied-de-poule raised in texture instead of yarn contrast.',
    generate: rule((r, c) => {
      const x = c % 8;
      const y = r % 8;
      return (x < 4) === (y < 4) ? (x + y) % 4 < 2 : (x + y) % 4 >= 2;
    })
  }),

  preset({
    id: 'rib_2x2_tuck',
    name: '2x2 Faux Rib (Single Bed)',
    family: 'texture',
    group: 'ribs',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['rib', '2x2', 'single-bed', 'faux'],
    description:
      'A single-bed stand-in for a 2x2 rib: tuck columns fake the cord and the fabric still lies reasonably flat, for hems where a true cross-bed rib is overkill.',
    generate: rule((r, c) => c % 4 < 2)
  }),

  preset({
    id: 'pleat_tuck',
    name: 'Knife Pleat Fabric',
    family: 'texture',
    group: 'ribs',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['pleat', 'accordion', 'tuck'],
    description:
      'Standing knife pleats: a dense tuck line every sixth needle lets the fabric collapse into an accordion that reads as pressed pleating.',
    generate: rule((r, c) => c % 6 !== 0)
  }),

  preset({
    id: 'birds_eye_wide_slip',
    name: "Bird's Eye (Wide Float)",
    family: 'texture',
    group: 'slip',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'slip',
    tags: ['birds-eye', 'float', 'slip', 'speckle'],
    description:
      'The birds-eye used as a lining: wide slipped floats leave tiny pinholes scattered over the face, the classic jacquard-filling texture on the reverse.',
    generate: rule((r, c) => !((r % 5 === 0 && c % 3 === 0) || (r % 5 === 3 && c % 3 === 2)))
  }),

  preset({
    id: 'terry_spiral',
    name: 'Terry Loop (Spiral Plush)',
    family: 'texture',
    group: 'terry',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['terry', 'loop', 'plush', 'tuck'],
    description:
      'A terry-style loop field approximated with deep tucks: every needle held for four rows lets a pile of loops stand proud, the machine-knit cousin of a bath towel.',
    generate: rule((r, c) => r % 4 !== 1 || (c + Math.floor(r / 4)) % 3 !== 0)
  }),

  preset({
    id: 'pique_shell',
    name: 'Piqu\u00e9 Shell (Honeycomb Piqu\u00e9)',
    family: 'texture',
    group: 'pique',
    bed: 'double-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['piqu\u00e9', 'honeycomb', 'double-bed', 'gaufre'],
    description:
      'Gaufre piqu\u00e9: a hexagonal cellular relief that only a double-plate (two-bed) setup can sink the corners into, giving the dimpled waistcoat cloth.',
    generate: rule((r, c) => {
      const col = c % 6;
      const row = r % 4;
      const cell = (row === 0 && col % 3 === 0) || (row === 2 && (col + 1) % 3 === 0);
      return !cell;
    })
  }),

  preset({
    id: 'french_rib',
    name: 'French Rib',
    family: 'texture',
    group: 'ribs',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['french-rib', 'rib', 'tuck'],
    description:
      'French rib: every other needle held in relief to make a broad, springy cord, the wide-rib that reads well on a blanket edge or a chunky collar.',
    generate: rule((r, c) => (c % 6 === 0 && r % 2 === 0) || c % 6 !== 0)
  }),

  preset({
    id: 'punch_tuck',
    name: 'Punch (Pique Punch) Tuck',
    family: 'texture',
    group: 'pique',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['punch', 'pique', 'tuck', 'relief'],
    description:
      'A punch-relief: small tuck cells punched forward into puffs on a plain ground, the dobby-like motif used on polo shirts and summer vests.',
    generate: rule((r, c) => {
      const inCell = r % 6 < 3 && c % 6 < 3;
      return !inCell || (r % 6 === 1 && c % 6 === 1);
    })
  }),

  preset({
    id: 'diagonal_fisherman',
    name: 'Diagonal Fisherman Rib',
    family: 'texture',
    group: 'tuck',
    bed: 'single-bed',
    rows: 24,
    cols: 24,
    mode: 'tuck',
    tags: ['fisherman', 'rib', 'diagonal', 'tuck'],
    description:
      'Fisherman\u2019s rib running on the diagonal: the held column creeps one needle each repeat, so the cord wanders across the fabric instead of standing vertical.',
    generate: rule((r, c) => (c + Math.floor(r / 2)) % 5 !== 0)
  })
];

export const DOUBLE_BED_PRESETS = [
  preset({
    id: 'db_fishermans_rib',
    name: 'Fisherman\u2019s Rib (Cross-Bed 1x1)',
    family: 'double-bed',
    group: 'transfers',
    bed: 'double-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['fisherman', 'rib', 'cross-bed', 'double-bed'],
    description:
      'True fisherman\u2019s rib: every needle on the front bed is worked against its opposite, giving the deep double-sided cord that only cross-bed transfer produces. Needs two beds.',
    generate: rule((r, c) => c % 2 === 0)
  }),

  preset({
    id: 'db_cable_ladder',
    name: 'Cross-Bed Cable Ladder',
    family: 'double-bed',
    group: 'cables',
    bed: 'double-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['cable', 'ladder', 'double-bed', 'braid'],
    description:
      'A cable without a cable needle: blocks of loops are passed bed-to-bed on a rack so a braided rope climbs the fabric, the double-bed cable-ladder motif.',
    generate: rule((r, c) => {
      const lane = Math.floor(c / 4) % 2 === 0 ? 1 : -1;
      const within = (c % 4 + (lane * Math.floor(r / 4)) % 4 + 4) % 4;
      return within < 2;
    })
  }),

  preset({
    id: 'db_brioche_chevron',
    name: 'Brioche Chevron (Double Bed)',
    family: 'double-bed',
    group: 'cables',
    bed: 'double-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['brioche', 'chevron', 'double-bed'],
    description:
      'Brioche, which the double bed knits in one pass: alternating ribs and slips make the squishy two-sided chevron hand knitters do with a live-and-a-half of wasted rows.',
    generate: rule((r, c) => {
      const zig = Math.abs((c % 8) - 4);
      return Math.abs((r % 8) - zig) < 3;
    })
  }),

  preset({
    id: 'db_reversible_diamond',
    name: 'Reversible Diamond (Two-Face)',
    family: 'double-bed',
    group: 'reversible',
    bed: 'double-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['reversible', 'two-face', 'diamond', 'double-bed'],
    description:
      'A colour-reversed diamond that looks right from either side: the front shows the lozenge in yarn A on B, the back shows it in B on A, so the scarf has no wrong face.',
    generate: rule((r, c) => {
      const dx = Math.abs((c % 12) - 5.5);
      const dy = Math.abs((r % 12) - 5.5);
      return dx + dy < 5;
    })
  }),

  preset({
    id: 'db_reversible_basket',
    name: 'Reversible Basketweave (Two-Face)',
    family: 'double-bed',
    group: 'reversible',
    bed: 'double-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['reversible', 'basket', 'two-face', 'double-bed'],
    description:
      'A two-face basketweave, the double-bed answer to a blanket that must look finished on both sides, colour-symmetric so front and back mirror each other.',
    generate: rule((r, c) => {
      const block = (Math.floor(r / 4) + Math.floor(c / 4)) % 2 === 0;
      const line = block ? (r % 4 < 2) : (c % 4 < 2);
      return line;
    })
  }),

  preset({
    id: 'db_tubular_caston',
    name: 'Tubular Cast-On Edge',
    family: 'double-bed',
    group: 'tubular',
    bed: 'double-bed',
    rows: 12,
    cols: 24,
    mode: 'fair_isle',
    tags: ['tubular', 'cast-on', 'edge', 'double-bed'],
    description:
      'A tubular (Italian) cast-on drafted for the two beds: front and back needles alternate so the very edge is a seamless rounded tube rather than a chained hem.',
    generate: rule((r, c) => (r + c) % 2 === 0)
  }),

  preset({
    id: 'db_rack_hole_band',
    name: 'Racked Eyelet Band (Transfer & Rack)',
    family: 'double-bed',
    group: 'holes',
    bed: 'double-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['eyelet', 'racking', 'double-bed', 'hole'],
    description:
      'A band of eyelets made by the method in the boyfriend\u2019s video: transfer out at rack 0, transfer back at rack \u00b11. Because the whole bed racks as one, every hole in a row shares the same rack value \u2014 so holes leaning opposite ways need separate rows.',
    generate: (rows, cols) => {
      const matrix = blankDirect(rows, cols);
      // The rack schedule the double-bed planner produces for a right-leaning hole:
      // one numeric sign, two cross-bed rows [out, back]. planDoubleBedHole takes a
      // signed number for direction and an array of row indices.
      const plan = planDoubleBedHole(1, { needle: 0, rows: [0, 1] });
      const rackBackRight = plan.steps.some(s => s.rack > 0);
      // Mark which needles are part of a hole on the two rows of each 4-row eyelet
      // unit, so the card shows the hole column honestly.
      for (let base = 0; base < rows; base += 4) {
        for (let needle = 2; needle < cols - 2; needle += 4) {
          // Out-pass row and the rack-back row of one eyelet.
          matrix[base % rows][needle] = X;
          matrix[(base + 1) % rows][needle + (rackBackRight ? 1 : -1)] = X;
        }
      }
      return matrix;
    },
    rackNote: 'One rack value per row; opposite leans split onto separate rows.'
  }),

  preset({
    id: 'db_partial_gore',
    name: 'Partial-Knit Gore (DB Shaping)',
    family: 'double-bed',
    group: 'shaping',
    bed: 'double-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['partial', 'shaping', 'gore', 'double-bed'],
    description:
      'A short-row gore built by partial knitting: only the needles inside the wedge are in work, so the fabric widens and narrows in the pass area — the shaping trick the double bed does best.',
    generate: rule((r, c, rows, cols) => {
      const width = 4 + (r % 12);
      const centre = cols / 2;
      return Math.abs(c - centre) < width;
    })
  }),

  preset({
    id: 'db_french_rib_reversible',
    name: 'French Rib (Reversible, Double Bed)',
    family: 'double-bed',
    group: 'transfers',
    bed: 'double-bed',
    rows: 24,
    cols: 24,
    mode: 'fair_isle',
    tags: ['french-rib', 'reversible', 'double-bed'],
    description:
      'The double-bed French rib: a wide held cord that reads identically front and back, the most economical reversible rib for a blanket or a reversible cardigan.',
    generate: rule((r, c) => c % 6 !== 0)
  })
];

/**
 * A tiny live check the tests use: prove that the video's rack constraint is real in
 * the planner we depend on, so the documentation and the physics cannot drift apart.
 */
export function rackRuleHolds() {
  const sameWay = validateRackRow([
    { needle: 2, rack: 1 },
    { needle: 6, rack: 1 }
  ]);
  const mixedWay = validateRackRow([
    { needle: 2, rack: 1 },
    { needle: 6, rack: -1 }
  ]);
  const occupancy = occupancyAfterTransfers(4, [
    { from: 0, to: 1 },
    { from: 2, to: 1 }
  ]);
  return {
    sameRowSameRack: sameWay.ok === true,
    sameRowMixedRack: mixedWay.ok === false,
    centerPile: occupancy.counts[1] === 3
  };
}
