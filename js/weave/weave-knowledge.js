/**
 * KNITCAT — Weave & Loom Knowledge Base.
 *
 * The rest of the app reasons about *knitting* machines: needles, carriages, a
 * punchcard drum that reads one row at a time. This module is deliberately about
 * the *other* half of textile making — **woven cloth** — because the two share a
 * single, ancient representation: a rectangular grid that says, for every crossing,
 * "is this strand up or down?". A weaver reads that as warp-over-weft; a KnitCAD
 * user reads the very same grid as punched / unpunched. So every classic weave
 * structure below is expressed as a pure `draft(rows, cols)` that returns a 0/1
 * interlacement grid, and `js/presets/patterns-weave.js` feeds those drafts straight
 * into the Fair Isle card engine with no translation layer.
 *
 * It also carries the *loom taxonomy*: which physical loom (a four-shaft hand
 * loom, a dobby head, a Jacquard, a modern rapier/air-jet) can actually raise the
 * sheds a structure demands, and how many harnesses/shafts that costs. That is the
 "which structures can this machine produce?" question the Design Health and
 * Machine Universe surfaces ask for, answered from ONE place so the prose, the
 * shaft arithmetic and the pattern library can never disagree.
 *
 * Nothing in here touches `document` or `window` — data plus pure functions — which
 * is what lets `tests/weave-knowledge.test.mjs` exercise it head-to-head.
 *
 * @module weave/weave-knowledge
 */

/** Non-negative modulo (JS `%` keeps the sign of the dividend). */
function mod(a, n) {
  return ((a % n) + n) % n;
}

/** Triangle wave of `period`: 0,1,2,…,h-1,h-2,…,1,0 — how a herringbone/fold reflects. */
function fold(index, period) {
  const p = period * 2;
  const x = mod(index, p);
  return x < period ? x : p - 1 - x;
}

/**
 * A weave structure: one repeat of an interlacement pattern plus the *dressing*
 * (how many shafts, what class of control) it needs to be woven on a real loom.
 *
 * @typedef {object} WeaveStructure
 * @property {string} id            Stable id, also the preset's structure key.
 * @property {string} name          Human name as it appears in a weaving book.
 * @property {string} group         Taxonomy group id (see preset-catalog `weave` family).
 * @property {number} shafts        Harnesses/shafts required (Jacquard figures use 1 as a sentinel — see `control`).
 * @property {'hand'|'dobby'|'jacquard'} control  Minimum class of shed control.
 * @property {'warp'|'weft'|'balanced'} face       Which yarn dominates the face of the cloth.
 * @property {number[]} repeat      [width, height] of one motif repeat, in threads.
 * @property {string} blurb         One-line craft description.
 * @property {(rows:number, cols:number)=>number[][]} draft Pure 0/1 interlacement grid (1 = warp up).
 */

/** The canonical warp-up / weft-up test builders, kept tiny so each draft reads like its rule. */
const warpUp = 1;
const weftUp = 0;

/**
 * Every structure KNITCAT can draft, keyed by id. The set covers the weave
 * structures a weaving reference lists — the three foundations (plain, twill,
 * satin), their basket/rib relatives, the dobby family (piqué, leno, double
 * cloth, pile) and the Jacquard figured group — each with the real harness count a
 * weaver would dress.
 * @type {Record<string, WeaveStructure>}
 */
export const WEAVE_STRUCTURES = {
  plain_weave: {
    id: 'plain_weave', name: 'Plain (Tabby) Weave', group: 'plain', shafts: 2, control: 'hand',
    face: 'balanced', repeat: [2, 2],
    blurb: 'The simplest cloth: every weft passes over one warp, under the next, each row reversing. Two shafts, maximum interlacement, dead flat.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(r + c, 2) === 0 ? warpUp : weftUp))
  },
  basketweave: {
    id: 'basketweave', name: 'Basketweave (2/2)', group: 'plain', shafts: 4, control: 'hand',
    face: 'balanced', repeat: [4, 4],
    blurb: 'Plain weave with the threads doubled — two ends up, two down — so the cloth reads as a checkerboard of little mats.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(Math.floor(r / 2) + Math.floor(c / 2), 2) === 0 ? warpUp : weftUp))
  },
  oxford: {
    id: 'oxford', name: 'Oxford (Rib Basket)', group: 'plain', shafts: 4, control: 'hand',
    face: 'warp', repeat: [4, 4],
    blurb: 'A warp-faced basket with soft crossing ribs — the shirting weave that gives oxford cloth its grain and its drape.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (r % 2 === 0 || c % 2 === 0 ? warpUp : weftUp))
  },
  even_weave: {
    id: 'even_weave', name: 'Even Weave (4/4)', group: 'plain', shafts: 4, control: 'hand',
    face: 'balanced', repeat: [8, 8],
    blurb: 'A coarse square basket — blocks of four by four — the sampler ground and the towel weave where an even grid is the point.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(Math.floor(r / 4) + Math.floor(c / 4), 2) === 0 ? warpUp : weftUp))
  },
  shot_weave: {
    id: 'shot_weave', name: 'Shot (Changeable) Weave', group: 'plain', shafts: 2, control: 'hand',
    face: 'balanced', repeat: [2, 2],
    blurb: 'Plain weave with an unlike warp and weft, so the two colours chase each other over and under and the cloth flickers shot-silk.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(r + c, 2) === 0 ? warpUp : weftUp))
  },
  twill_2_2: {
    id: 'twill_2_2', name: 'Twill (2/2 Z)', group: 'twill', shafts: 4, control: 'hand',
    face: 'balanced', repeat: [4, 4],
    blurb: 'The balanced twill: each row steps one end sideways, throwing a 45° diagonal across the face. Stronger and looser than plain for the same thread.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(c - r, 4) < 2 ? warpUp : weftUp))
  },
  warp_twill: {
    id: 'warp_twill', name: 'Warp-faced Twill (3/1)', group: 'twill', shafts: 4, control: 'hand',
    face: 'warp', repeat: [4, 4],
    blurb: 'Three over, one under — the diagonal is all warp on the face and all weft floats on the back. Denim and gabardine are cousins of this.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(c - r, 4) < 3 ? warpUp : weftUp))
  },
  weft_twill: {
    id: 'weft_twill', name: 'Weft-faced Twill (1/3)', group: 'twill', shafts: 4, control: 'hand',
    face: 'weft', repeat: [4, 4],
    blurb: 'The warp-faced twill turned inside out: one warp riser, three weft floats, so the weft colour owns the face.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(c - r, 4) < 1 ? warpUp : weftUp))
  },
  herringbone: {
    id: 'herringbone', name: 'Herringbone', group: 'twill', shafts: 4, control: 'hand',
    face: 'balanced', repeat: [8, 4],
    blurb: 'A twill whose diagonal reverses every few ends, so the slantings meet in a spine and the cloth is strewn with little fish bones.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(fold(c, 4) - r, 4) < 2 ? warpUp : weftUp))
  },
  diamond_twill: {
    id: 'diamond_twill', name: 'Diamond (Point) Twill', group: 'twill', shafts: 6, control: 'dobby',
    face: 'balanced', repeat: [12, 12],
    blurb: 'A point twill that folds back on itself both ways, so the diagonals close into diamonds — the draft that made the dobby worth inventing.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(fold(c, 6) - fold(r, 6), 6) < 3 ? warpUp : weftUp))
  },
  gabardine: {
    id: 'gabardine', name: 'Gabardine (Steep Twill)', group: 'twill', shafts: 6, control: 'dobby',
    face: 'warp', repeat: [6, 6],
    blurb: 'A warp-faced twill worked at a steep pitch — the diagonal nearly vertical, the face nearly all warp. Burberry’s whole claim to weather.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(c - 2 * r, 6) < 5 ? warpUp : weftUp))
  },
  whipcord: {
    id: 'whipcord', name: 'Whipcord', group: 'twill', shafts: 7, control: 'dobby',
    face: 'warp', repeat: [7, 7],
    blurb: 'Gabardine taken steeper still — one dominant ridge so pronounced it looks corded, worked off a warp-faced step of three.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(c - 3 * r, 7) < 6 ? warpUp : weftUp))
  },
  satin_5h: {
    id: 'satin_5h', name: 'Satin (5-Harness, Warp-faced)', group: 'satin', shafts: 5, control: 'hand',
    face: 'warp', repeat: [5, 5],
    blurb: 'Warp floats unbroken by any weft, with the single binding point scattered by a counter of two so no diagonal forms — smooth, lustrous, and five shafts to hold it.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(c, 5) === mod(r * 2, 5) ? weftUp : warpUp))
  },
  sateen_5h: {
    id: 'sateen_5h', name: 'Sateen (5-Harness, Weft-faced)', group: 'satin', shafts: 5, control: 'hand',
    face: 'weft', repeat: [5, 5],
    blurb: 'Satin flipped: the weft does the floating and the warp does the dotting, so the face reads weft — the hand of a good bed sateen.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(c, 5) === mod(r * 2, 5) ? warpUp : weftUp))
  },
  satin_8h: {
    id: 'satin_8h', name: 'Crayonne Satin (8-Harness)', group: 'satin', shafts: 8, control: 'dobby',
    face: 'warp', repeat: [8, 8],
    blurb: 'An eight-end satin with a counter of three — longer floats, deeper gloss, and a binding point so scattered the face looks liquid.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(c, 8) === mod(r * 3, 8) ? weftUp : warpUp))
  },
  pique: {
    id: 'pique', name: 'Piqué (Waffle)', group: 'dobby', shafts: 12, control: 'dobby',
    face: 'warp', repeat: [12, 12],
    blurb: 'A dobby structure that puckers the cloth into square waffle cells — raised ribs framing a sunken centre, which is why it becomes a bath towel.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(r, 6) === 0 || mod(c, 6) === 0 ? warpUp : weftUp))
  },
  leno: {
    id: 'leno', name: 'Leno (Gauze) Weave', group: 'dobby', shafts: 6, control: 'dobby',
    face: 'balanced', repeat: [6, 4],
    blurb: 'Neighbouring warp ends are crossed and twisted around the weft, locking an open mesh open — the only plain-looking grid that actually holds a lace-like hole.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (c % 2 === 0 ? (mod(r + Math.floor(c / 2), 2) === 0 ? warpUp : weftUp) : (mod(r - Math.floor(c / 2), 2) === 0 ? warpUp : weftUp)))
  },
  double_weave: {
    id: 'double_weave', name: 'Double Weave', group: 'dobby', shafts: 8, control: 'dobby',
    face: 'balanced', repeat: [8, 8],
    blurb: 'Two layers of cloth woven back to back, joined only where the pattern wants them joined — two faces, a hollow pocket, and every dobby shaft it can borrow.',
    draft: (rows, cols) => build(rows, cols, (r, c) => {
      const cell = mod(Math.floor(r / 2) + Math.floor(c / 2), 2) === 0 ? warpUp : weftUp;
      // A binder end every fourth thread stitches the two faces together.
      return c % 4 === 0 ? warpUp : cell;
    })
  },
  pile: {
    id: 'pile', name: 'Pile Weave (Corduroy)', group: 'dobby', shafts: 16, control: 'dobby',
    face: 'warp', repeat: [8, 8],
    blurb: 'A third (pile) warp is floated over groups of ground ends and later cut, raising the nap. This draft shows the pile risers against the ground.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(c, 4) < 3 && mod(r, 4) !== 0 ? warpUp : weftUp))
  },
  charvet: {
    id: 'charvet', name: 'Charvet', group: 'dobby', shafts: 8, control: 'dobby',
    face: 'warp', repeat: [8, 8],
    blurb: 'A firm warp-faced dress fabric with a satin ground broken by fine rib lines — the tailored shirt-weave the Paris house gave its name to.',
    draft: (rows, cols) => build(rows, cols, (r, c) => (mod(c - r, 5) < 1 || mod(c, 8) === 0 ? weftUp : warpUp))
  },
  damask: {
    id: 'damask', name: 'Damask', group: 'jacquard', shafts: 1, control: 'jacquard',
    face: 'balanced', repeat: [24, 24],
    blurb: 'One warp, one weft, two faces: the figure is a warp-faced satin while the ground is a weft-faced sateen, so the pattern shows as a sheen against a matte field.',
    draft: (rows, cols) => figure(rows, cols, 24, true)
  },
  jacquard_figure: {
    id: 'jacquard_figure', name: 'Jacquard Figure', group: 'jacquard', shafts: 1, control: 'jacquard',
    face: 'warp', repeat: [24, 24],
    blurb: 'Any end can be raised independently, so a whole pictorial repeat is possible — this is the medallion field the Jacquard head was built to draw in cloth.',
    draft: (rows, cols) => figure(rows, cols, 24, false)
  },
  coverlet: {
    id: 'coverlet', name: 'Coverlet (Overshot Star)', group: 'jacquard', shafts: 4, control: 'jacquard',
    face: 'warp', repeat: [16, 16],
    blurb: 'The American overshot star: a plain ground with pattern threads shot over it to throw an eight-point medallion across the bedcover.',
    draft: (rows, cols) => build(rows, cols, (r, c) => {
      const c2 = mod(c, 16) - 7.5;
      const r2 = mod(r, 16) - 7.5;
      const star = Math.max(Math.abs(c2), Math.abs(r2));
      const diag = (Math.abs(c2) + Math.abs(r2)) / 2;
      const ring = Math.min(star, diag);
      return ring < 3 || ring > 6.5 ? warpUp : weftUp;
    })
  },
  lampas: {
    id: 'lampas', name: 'Lampas', group: 'jacquard', shafts: 1, control: 'jacquard',
    face: 'balanced', repeat: [20, 20],
    blurb: 'A figured warp combined with a pattern weft binding on its own ties — ground and ornament woven at once, the dressy polychrome of the old silk looms.',
    draft: (rows, cols) => build(rows, cols, (r, c) => {
      const ground = mod(c - r, 4) < 2 ? warpUp : weftUp;
      const dx = mod(c, 20) - 9.5;
      const dy = mod(r, 20) - 9.5;
      const figure = Math.hypot(dx, dy) < 6 ? weftUp : warpUp;
      return Math.abs(dx) < 1.5 || Math.abs(dy) < 1.5 ? figure : ground;
    })
  },
  brocade: {
    id: 'brocade', name: 'Brocade', group: 'jacquard', shafts: 1, control: 'jacquard',
    face: 'warp', repeat: [16, 16],
    blurb: 'A ground cloth with pattern wefts floated in only where the design needs them, so the ornament sits on the surface like embroidery.',
    draft: (rows, cols) => build(rows, cols, (r, c) => {
      const dx = mod(c, 16) - 7.5;
      const dy = mod(r, 16) - 7.5;
      const petal = Math.abs(dx) + Math.abs(dy);
      return petal < 5 || (petal > 8 && petal < 10) ? warpUp : weftUp;
    })
  }
};

/** Fill a rows×cols grid from a per-thread predicate (r = row, c = column). */
function build(rows, cols, fn) {
  const grid = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = fn(r, c) ? 1 : 0;
    grid[r] = row;
  }
  return grid;
}

/**
 * A Jacquard-style medallion field. `damask` flips the ground/figure faces so the
 * motif reads by lustre rather than colour, which is the actual damask trick.
 */
function figure(rows, cols, cell, damask) {
  const half = (cell - 1) / 2;
  return build(rows, cols, (r, c) => {
    const dx = mod(c, cell) - half;
    const dy = mod(r, cell) - half;
    const dist = Math.hypot(dx, dy);
    const diamond = Math.abs(dx) + Math.abs(dy);
    const motif = dist < half * 0.55 || diamond < half * 0.5;
    const ground = damask
      ? mod(c + r, 6) < 3
      : mod(c - r, 4) < 2;
    return motif ? (damask ? 1 : 1) : ground ? 1 : 0;
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Loom taxonomy — the machines that can raise these sheds.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {object} LoomType
 * @property {string} id            Stable id.
 * @property {string} name          Common name.
 * @property {'hand'|'dobby'|'jacquard'|'power'} drive  Shed-control family.
 * @property {number|null} maxShafts  Harnesses available (null = individually controlled, effectively unlimited).
 * @property {boolean} jacquardHead   Whether a Jacquard (figure) head can be fitted.
 * @property {string} [insertion]     How the weft is put in (shuttle, rapier, jet, projectile…).
 * @property {string} era             Rough period / context.
 * @property {string} blurb           What this loom is *for*.
 */

/**
 * The loom types a weaving reference lists, each with the shed-control ceiling and
 * harness count it brings. `maxShafts` is the practical dressing limit for shaft
 * structures; `jacquardHead` opens the figured group.
 * @type {Record<string, LoomType>}
 */
export const LOOM_TYPES = {
  warp_weighted: {
    id: 'warp_weighted', name: 'Warp-weighted (Ground) Loom', drive: 'hand', maxShafts: 4, jacquardHead: false,
    insertion: 'hand shuttle', era: 'Neolithic – Iron Age',
    blurb: 'The oldest upright loom: the warp is held by hanging weights and the shed is picked by hand. Plain and simple tablets only.'
  },
  hand_shaft: {
    id: 'hand_shaft', name: 'Hand / Treadle Shaft Loom', drive: 'hand', maxShafts: 12, jacquardHead: false,
    insertion: 'hand or boat shuttle', era: 'Medieval – present',
    blurb: 'Countermarch or jack loom with a handful of shafts treadled by foot — the whole plain/twill/satin canon up to about twelve ends lives here.'
  },
  table_loom: {
    id: 'table_loom', name: 'Tablet / Inkle Loom', drive: 'hand', maxShafts: 4, jacquardHead: false,
    insertion: 'cards or shed rod', era: 'Ancient – present',
    blurb: 'Rigid heddles (a deck of cards) or a narrow warp stretched on a frame — band weaving, belts and trim, not widthwise cloth.'
  },
  dobby: {
    id: 'dobby', name: 'Dobby Loom', drive: 'dobby', maxShafts: 40, jacquardHead: false,
    insertion: 'shuttle or rapier', era: '1840s – present',
    blurb: 'A mechanical head that selects which shafts rise each pick — geometric repeats up to ~40 harnesses (piqué, leno, double cloth) with no big picture.'
  },
  jacquard: {
    id: 'jacquard', name: 'Jacquard Loom', drive: 'jacquard', maxShafts: null, jacquardHead: true,
    insertion: 'shuttle / rapier', era: '1804 – present',
    blurb: 'Every warp end is hooked and controlled individually (the punched cards Babbage saw), so an arbitrary figured repeat — damask, brocade — is possible.'
  },
  rapier: {
    id: 'rapier', name: 'Rapier Loom', drive: 'power', maxShafts: 32, jacquardHead: true,
    insertion: 'rigid/flexible rapier', era: '1950s – present',
    blurb: 'A modern projectile-free power loom that carries the weft in on a steel rapier; up to a few dozen shafts, and a Jacquard head can be added for figures.'
  },
  air_jet: {
    id: 'air_jet', name: 'Air-jet Loom', drive: 'power', maxShafts: 24, jacquardHead: true,
    insertion: 'pulsed air jet', era: '1980s – present',
    blurb: 'The weft is fired across on a puff of compressed air — blisteringly fast, superb for plain/twill/satin shirting and suiting.'
  },
  water_jet: {
    id: 'water_jet', name: 'Water-jet Loom', drive: 'power', maxShafts: 16, jacquardHead: false,
    insertion: 'water jet', era: '1980s – present',
    blurb: 'Air-jet’s cheaper sibling that uses a fine water column to carry the weft; lowest energy, but only for synthetics that shrink from water.'
  },
  projectile: {
    id: 'projectile', name: 'Projectile (Dornier) Loom', drive: 'power', maxShafts: 24, jacquardHead: true,
    insertion: 'gripper projectile', era: '1940s – present',
    blurb: 'A steel gripper is shot across the shed clutching the weft, and flies back under the cloth — the classic high-speed broadgoods loom.'
  },
  multi_phase: {
    id: 'multi_phase', name: 'Multi-phase / Gripper Loom', drive: 'power', maxShafts: 24, jacquardHead: false,
    insertion: 'gripper chain', era: '1970s – present',
    blurb: 'Wefts are laid in several phases at once so several cloths are woven side by side from bobbins fed continuously.'
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Pure queries — the arithmetic every consumer (presets, universe, panel) reads.
 * ─────────────────────────────────────────────────────────────────────────── */

/** All structure ids, in a stable order. @returns {string[]} */
export function structureIds() {
  return Object.keys(WEAVE_STRUCTURES);
}

/** All loom ids, in a stable order. @returns {string[]} */
export function loomIds() {
  return Object.keys(LOOM_TYPES);
}

/**
 * Can one loom physically weave one structure?
 * Figured (Jacquard-control) structures need a head that controls ends individually;
 * shaft structures need enough harnesses to dress the repeat.
 * @param {LoomType} loom
 * @param {WeaveStructure} structure
 * @returns {boolean}
 */
export function loomCanWeave(loom, structure) {
  if (!loom || !structure) return false;
  if (structure.control === 'jacquard') return loom.jacquardHead === true;
  // maxShafts === null means individually controlled — always enough shafts.
  if (loom.maxShafts === null) return true;
  return loom.maxShafts >= structure.shafts;
}

/**
 * @param {string} structureId
 * @returns {string[]} every loom id able to weave the structure, most capable last
 */
export function loomsForStructure(structureId) {
  const s = WEAVE_STRUCTURES[structureId];
  if (!s) return [];
  return loomIds().filter((id) => loomCanWeave(LOOM_TYPES[id], s));
}

/**
 * @param {string} loomId
 * @returns {string[]} every structure id this loom can produce
 */
export function structuresForLoom(loomId) {
  const l = LOOM_TYPES[loomId];
  if (!l) return [];
  return structureIds().filter((id) => loomCanWeave(l, WEAVE_STRUCTURES[id]));
}

/**
 * The simplest loom that can weave a structure — the "what do I need to make this?"
 * answer, ordered hand → dobby → jacquard → power (a power loom only wins if it is
 * the cheapest shaft-count fit).
 * @param {string} structureId
 * @returns {{loomId:string, loom:LoomType}|null}
 */
export function simplestLoomFor(structureId) {
  const s = WEAVE_STRUCTURES[structureId];
  if (!s) return null;
  const rank = { hand: 0, dobby: 1, jacquard: 2, power: 3 };
  const fits = loomIds()
    .map((id) => LOOM_TYPES[id])
    .filter((l) => loomCanWeave(l, s))
    .sort((a, b) => (rank[a.drive] - rank[b.drive]) || (a.name < b.name ? -1 : 1));
  return fits.length ? { loomId: fits[0].id, loom: fits[0] } : null;
}

/**
 * A full loom × structure coverage matrix — the machine-universe view of weaving.
 * @returns {{looms:string[], structures:string[], cells:Record<string, Record<string, boolean>>}}
 */
export function coverageMatrix() {
  const looms = loomIds();
  const structures = structureIds();
  const cells = {};
  for (const loomId of looms) {
    cells[loomId] = {};
    for (const structureId of structures) {
      cells[loomId][structureId] = loomCanWeave(LOOM_TYPES[loomId], WEAVE_STRUCTURES[structureId]);
    }
  }
  return { looms, structures, cells };
}

/**
 * Plain-language readiness report for a structure: name, group, face, the shaft
 * count or "Jacquard figure", and the looms that would take it.
 * @param {string} structureId
 * @returns {{id:string, name:string, group:string, shaftsLabel:string, control:string, face:string, repeat:number[], looms:{id:string,name:string}[]}}
 */
export function structureReport(structureId) {
  const s = WEAVE_STRUCTURES[structureId];
  if (!s) return null;
  const shaftsLabel = s.control === 'jacquard' ? 'Jacquard figure (individual ends)' : `${s.shafts} shafts`;
  return {
    id: s.id,
    name: s.name,
    group: s.group,
    shaftsLabel,
    control: s.control,
    face: s.face,
    repeat: s.repeat,
    looms: loomsForStructure(structureId).map((id) => ({ id, name: LOOM_TYPES[id].name }))
  };
}
