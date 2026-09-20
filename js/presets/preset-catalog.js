/**
 * KNITCAT - Pattern library taxonomy.
 *
 * The library outgrew a flat list of badges the moment it passed thirty patterns, so
 * the browser is two levels deep: a *family* (the technique door you walk through)
 * and a *group* (the tradition or structural idea inside it). Every preset names one
 * of each, and this file is the single place that decides what those menus look like,
 * in what order, and what they are called.
 *
 * It also carries the two facts the UI needs before a pattern is even clicked:
 * whether the design wants a single bed or a double bed, and whether the machine's
 * carriage can physically perform it. `stitchDelta` is the loop-count arithmetic of
 * a symbol, kept here so the feasibility side and the preset side never disagree.
 */

export const FAMILIES = [
  {
    id: 'lace',
    name: 'Lace',
    icon: '\u2740',
    blurb:
      'Eyelets and transfers. One bed, one carriage pass at a time; every hole is a yarn-over paid for by a needle taken out of work.',
    groups: [
      { id: 'shetland', name: 'Shetland & Unst', blurb: 'Herringbone, pie, rangale, cat\u2019s crown \u2014 the Buroughoe/Brae canon.' },
      { id: 'cathedral', name: 'Cathedral & Gothic', blurb: 'Windows, arches, spokes, faggot net \u2014 Victorian commercial lace.' },
      { id: 'continental', name: 'French & Italian', blurb: 'Cluny, French lace ruffles, Italian ruche, bobbin-derived grounds.' },
      { id: 'british', name: 'British & Colonial', blurb: 'Beehive, bee\u2019s wing, honeycomb, Faroes, M\u00f8ster \u2014 the knit-purl mesh family.' },
      { id: 'botanical', name: 'Botanical & Geometric', blurb: 'Leaves, vines, ferns, fans, chevrons, shells, diamonds.' },
      { id: 'mesh', name: 'Mesh, Net & Gauze', blurb: 'Open drop-stitch grounds where the fabric is mostly hole.' },
      { id: 'brimage', name: 'Brimage & Point Prune', blurb: 'Slate-textured stocking-stitch lace, no holes at all \u2014 pure transfer.' },
      { id: 'romance', name: 'Romance & Gift Lace', blurb: 'Hearts, knots and love-token lace for a cuff, a hem or a gift.' },
      { id: 'beginner', name: 'Learning Lace', blurb: 'Straight runs, two-row repeats, nothing that needs a lifetime of counting.' }
    ]
  },
  {
    id: 'colorwork',
    name: 'Colorwork',
    icon: '\u25c8',
    blurb:
      'Two or more colours carried across the row. The card says which feeder each needle takes; floats are the budget.',
    groups: [
      { id: 'nordic', name: 'Nordic & Baltic', blurb: 'Selbu, Marius, Latvian stars, Kolin, Ostro\u017ce \u2014 eight-pointed and armed.' },
      { id: 'celtic', name: 'Celtic & British Isles', blurb: 'Fair Isle canon: true lovers\u2019 knot, peebeg, great star, zig-zag.' },
      { id: 'geometric', name: 'Geometric & Optical', blurb: 'Tessellations, checkers, optics, plaid, argyle, deco.' },
      { id: 'global', name: 'Global Textiles', blurb: 'Kilim, Kazak, Bukitsuna, Persian, Slovak, Hungarian, Andean, Sami.' },
      { id: 'novelty', name: 'Novelty Techniques', blurb: 'Mosaic, intarsia-style blocks, shadow, illusion, marl effect.' },
      { id: 'picture', name: 'Picture & Motif', blurb: 'Roses, animals, hearts, snowflake borders, lettering rows.' },
      { id: 'borders', name: 'Yokes & Borders', blurb: 'Narrow repeat bands meant to sit at a hem, cuff or neckline.' },
      { id: 'romance', name: 'Romance & Gift', blurb: 'The bespoke ones: hearts, XOXO, monograms, dates.' }
    ]
  },
  {
    id: 'texture',
    name: 'Texture & Structure',
    icon: '\u229f',
    blurb:
      'Fabric built by the carriage rather than by the yarn: tuck, slip, piqu\u00e9, rib, wire, punch.',
    groups: [
      { id: 'tuck', name: 'Tuck Stitch', blurb: 'Held loops accumulate into blisters, welts, honeycomb, shaker.' },
      { id: 'slip', name: 'Slip & Waffle', blurb: 'Skipped needles float the yarn behind into grids, ribs and birds-eye.' },
      { id: 'pique', name: 'Piqu\u00e9 & Wire', blurb: 'Double-plate constructions: thermal, shell, herringbone piqu\u00e9, wire.' },
      { id: 'ribs', name: 'Ribs & Foundations', blurb: '1x1, 2x2, French, tuck rib, pleat \u2014 the stretchy floor of the craft.' },
      { id: 'stitches', name: 'Signature Stitch Patterns', blurb: 'Moss, rice, potato chip, dogtooth, diamond \u2014 named hand stitches, machined.' },
      { id: 'terry', name: 'Terry, Loop & Boucl\u00e9', blurb: 'Loop-forming attachments: sinker and plush structures.' }
    ]
  },
  {
    id: 'double-bed',
    name: 'Double Bed',
    icon: '\u2261',
    blurb:
      'Two needle beds facing each other. Loops move *across* as well as along, which is where cables, reversible fabric and true 3-D shaping come from.',
    groups: [
      { id: 'transfers', name: 'Cross-Bed Transfers', blurb: 'The 1x1 / 2x2 rib transfers that make fisherman\u2019s rib and its variants.' },
      { id: 'cables', name: 'DB Cables & Briods', blurb: 'Loops swapped bed-to-bed to travel a cable without a needle.' },
      { id: 'holes', name: 'Holes, Racking & Rack-back', blurb: 'Transfer out at rack 0, transfer back at rack \u00b11: a hole that costs two rows.' },
      { id: 'shaping', name: 'DB Shaping & Part Knitting', blurb: 'Partial knitting, gores, set-in shapes, three-dimensional blocks.' },
      { id: 'reversible', name: 'Reversible & Two-Face', blurb: 'Fabric that reads correctly from either side, colour-symmetric.' },
      { id: 'tubular', name: 'Tubular & I-Cord', blurb: 'Circular construction on two straight beds: tubes, cords, hidden selvedges.' }
    ]
  },
  {
    id: 'edges',
    name: 'Edges & Finishings',
    icon: '\u23df',
    blurb:
      'The rows at the start and the end of a piece. These are placed, not repeated \u2014 row 0 is the cast-on edge and the top row is the bind-off.',
    groups: [
      { id: 'cast-on', name: 'Decorative Cast-Ons', blurb: 'Picot, cable-twist, German twist, tubular, needle-rib.' },
      { id: 'bind-off', name: 'Bind-Offs & Edgings', blurb: 'Henry Neuhaus, knitted-on, applied i-cord, ruffle, shell, lace tab.' },
      { id: 'collars', name: 'Collars, Cuffs & Hems', blurb: 'Standing, polo, split, ribbed bands with the mitre worked in.' },
      { id: 'selvedges', name: 'Selvedges & Openings', blurb: 'Buttonholes, slit vents, chain edges, invisible decrease seams.' }
    ]
  },
  {
    id: 'shaping',
    name: 'Shaping & Garment Parts',
    icon: '\u25b3',
    blurb:
      'Fulling a flat card into a garment: the row-by-row narrowing and widening that makes a sleeve fit.',
    groups: [
      { id: 'saddle', name: 'Saddle Shoulders', blurb: 'The Shetland h-shaped saddle and its stepped shoulder lines.' },
      { id: 'raglan', name: 'Raglan & Set-In', blurb: 'Diagonal armhole shaping, increase/decrease runs, cap shaping.' },
      { id: 'necklines', name: 'Necklines', blurb: 'Crew, V, split, heart, boat \u2014 the front and back neck drafts.' },
      { id: 'silhouettes', name: 'Waist, Hip & Gore', blurb: 'Long and short rows, wedges, peplum and A-line drafts.' }
    ]
  },
  {
    id: 'generative',
    name: 'Generative & Mathematical',
    icon: '\u221e',
    blurb:
      'Charts produced by a rule rather than a tradition. Cellular automata, L-systems, number theory, noise.',
    groups: [
      { id: 'automata', name: 'Cellular Automata', blurb: 'Elementary rules and their knitworthy descendants.' },
      { id: 'fractals', name: 'Fractals & Curves', blurb: 'Sierpi\u0144ski, Koch, dragon, Hilbert, Julia-ish structure.' },
      { id: 'number', name: 'Number Theory', blurb: 'Primes, modular grids, Fibonacci, Pascal mod k.' },
      { id: 'tiling', name: 'Tilings & Voronoi', blurb: 'Penrose-ish, truchet, hexagonal, cellular random tilings.' },
      { id: 'noise', name: 'Noise & Organic', blurb: 'Value-noise fields, dithered gradients, organic scatter.' },
      { id: 'optical', name: 'Optical & Moir\u00e9', blurb: 'Interference, moir\u00e9, anamorphosis \u2014 patterns that argue with the eye.' }
    ]
  },
  {
    id: 'weave',
    name: 'Weave Structures',
    icon: '\u25a4',
    blurb:
      'Woven cloth, drafted. A weave is a warp-up / weft-up grid \u2014 the same rectangle a punchcard carries \u2014 so the classic structures drop straight into the card engine. Each names its shaft count and the loom that would weave it.',
    groups: [
      { id: 'plain', name: 'Plain & Basket', blurb: 'Tabby and its doubled, ribbed and shot-silk relatives \u2014 the balanced floor of weaving.' },
      { id: 'twill', name: 'Twill Family', blurb: 'Diagonals: 2/2, warp- and weft-faced, herringbone, diamond, gabardine, whipcord.' },
      { id: 'satin', name: 'Satin & Sateen', blurb: 'Scattered binding points, unbroken floats, deep gloss \u2014 no visible diagonal.' },
      { id: 'dobby', name: 'Dobby Structures', blurb: 'Geometric figures the dobby head selects: piqu\u00e9, leno, double cloth, pile, charvet.' },
      { id: 'jacquard', name: 'Jacquard & Figure', blurb: 'Individually controlled ends \u2014 damask, brocade, lampas, coverlet stars \u2014 whole pictures in cloth.' }
    ]
  },
  {
    id: 'garments',
    name: 'Whole Garments',
    icon: '\u2307',
    blurb:
      'Pre-flighted cards from the tailor engines \u2014 a beanie, a tank top, a sleeve \u2014 already sized to a head, a chest or a gauge.',
    groups: [
      { id: 'hats', name: 'Hats & Beanies', blurb: 'Brim, body, crown decreases, calosh and lapped.' },
      { id: 'tops', name: 'Tops & Tanks', blurb: 'Strap, bust and hem drafted from measurements.' },
      { id: 'pieces', name: 'Squares, Panels & Mufflers', blurb: 'Granny squares, pocket panels, scarves, wristers.' }
    ]
  }
];

/** Fast lookup tables built once from the definitions above. */
export const FAMILY_BY_ID = Object.fromEntries(FAMILIES.map(f => [f.id, f]));

export const GROUP_BY_KEY = Object.fromEntries(
  FAMILIES.flatMap(f => f.groups.map(g => [`${f.id}/${g.id}`, { ...g, familyId: f.id, familyName: f.name }]))
);

export const BED = { SINGLE: 'single-bed', DOUBLE: 'double-bed', EITHER: 'either' };

export const BED_LABELS = {
  [BED.SINGLE]: 'Single bed',
  [BED.DOUBLE]: 'Double bed',
  [BED.EITHER]: 'Either bed'
};

/**
 * Metadata for the patterns that shipped before the taxonomy existed, keyed by preset
 * id. Keeping it here instead of editing twenty-nine literal objects means the classic
 * library and the new recipes can be concatenated untouched.
 */
export const LEGACY_CLASSIFICATION = {
  feather_fan_lace: { family: 'lace', group: 'botanical', bed: 'single-bed', tags: ['shetland', 'classic', 'fan', 'eyelet'] },
  diamond_mesh_lace: { family: 'lace', group: 'british', bed: 'single-bed', tags: ['diamond', 'mesh', 'eyelet'] },
  horseshoe_lace: { family: 'lace', group: 'cathedral', bed: 'single-bed', tags: ['arch', 'gothic', 'decrease'] },
  leaf_vine_lace: { family: 'lace', group: 'botanical', bed: 'single-bed', tags: ['leaf', 'vine', 'organic'] },
  nordic_star_jacquard: { family: 'colorwork', group: 'nordic', bed: 'single-bed', tags: ['star', 'snowflake', 'scandinavian'] },
  houndstooth_jacquard: { family: 'colorwork', group: 'geometric', bed: 'single-bed', tags: ['optical', 'bespoke', 'tessellation'] },
  honeycomb_tuck: { family: 'texture', group: 'tuck', bed: 'single-bed', tags: ['honeycomb', '3d', 'tuck'] },
  benji_pixel_hearts_lace: { family: 'lace', group: 'beginner', bed: 'single-bed', tags: ['heart', 'bespoke', 'romance'] },
  sweetheart_pixel_fair_isle: { family: 'colorwork', group: 'romance', bed: 'single-bed', tags: ['heart', 'pixel', 'gift'] },
  rose_window_lace: { family: 'lace', group: 'cathedral', bed: 'single-bed', tags: ['gothic', 'rose', 'radiating'] },
  spiral_lace: { family: 'lace', group: 'cathedral', bed: 'single-bed', tags: ['spiral', 'fibonacci'] },
  double_faggot_lace: { family: 'lace', group: 'cathedral', bed: 'single-bed', tags: ['faggot', 'net', 'victorian'] },
  moss_diamond_lace: { family: 'lace', group: 'cathedral', bed: 'single-bed', tags: ['moss', 'diamond', 'victorian'] },
  vine_trellis_lace: { family: 'lace', group: 'botanical', bed: 'single-bed', tags: ['vine', 'trellis', 'art-nouveau'] },
  argyle_diamond: { family: 'colorwork', group: 'geometric', bed: 'single-bed', tags: ['argyle', 'scottish', 'diamond'] },
  peacock_tail: { family: 'colorwork', group: 'picture', bed: 'single-bed', tags: ['feather', 'art-deco', 'arc'] },
  turkish_kilim: { family: 'colorwork', group: 'global', bed: 'single-bed', tags: ['kilim', 'anatolian', 'stepped'] },
  art_deco_fan: { family: 'colorwork', group: 'geometric', bed: 'single-bed', tags: ['deco', 'sunburst', '1920s'] },
  tartan_plaid: { family: 'colorwork', group: 'geometric', bed: 'single-bed', tags: ['tartan', 'plaid', 'scottish'] },
  seed_stitch_tuck: { family: 'texture', group: 'stitches', bed: 'single-bed', tags: ['seed', 'checker', 'tuck'] },
  welt_tuck: { family: 'texture', group: 'tuck', bed: 'single-bed', tags: ['welt', 'fisherman', 'ridge'] },
  bird_eye_slip: { family: 'texture', group: 'slip', bed: 'single-bed', tags: ['birds-eye', 'slip', 'float'] },
  xoxo_fair_isle: { family: 'colorwork', group: 'romance', bed: 'single-bed', tags: ['xoxo', 'lettering', 'gift'] },
  rose_blossom_fair_isle: { family: 'colorwork', group: 'picture', bed: 'single-bed', tags: ['rose', 'botanical', 'english'] },
  infinity_lace: { family: 'lace', group: 'cathedral', bed: 'single-bed', tags: ['knot', 'infinity', 'romance'] },
  reversible_double_bed_chevron: { family: 'double-bed', group: 'reversible', bed: 'double-bed', tags: ['chevron', 'two-face', 'reversible'] },
  reversible_double_bed_diamond: { family: 'double-bed', group: 'reversible', bed: 'double-bed', tags: ['diamond', 'lattice', 'reversible'] },
  hexagon_tessellation: { family: 'generative', group: 'tiling', bed: 'single-bed', tags: ['hexagon', 'honeycomb', 'tessellation'] },
  detailed_star_tessellation: { family: 'generative', group: 'number', bed: 'single-bed', tags: ['star', 'polar', 'tessellation'] }
};

/** Every family id, for validation. */
export const FAMILY_IDS = FAMILIES.map(f => f.id);

/** Every `family/group` key, for validation. */
export const GROUP_KEYS = Object.keys(GROUP_BY_KEY);

/**
 * Resolve one preset's classification: the recipe's own fields win, the legacy table
 * fills the gaps, and anything still missing is reported rather than guessed at, so a
 * mislabelled pattern shows up as a failing test instead of a mystery in the menu.
 */
export function classify(preset, { strict = false } = {}) {
  const legacy = LEGACY_CLASSIFICATION[preset.id] || {};
  const family = preset.family || legacy.family || null;
  const group = preset.group || legacy.group || null;
  const bed = preset.bed || legacy.bed || BED.EITHER;
  const tags = [...new Set([...(legacy.tags || []), ...(preset.tags || [])])];
  const problems = [];
  if (!family || !FAMILY_BY_ID[family]) problems.push(`unknown family "${family}"`);
  if (!group) problems.push('no group');
  else if (!GROUP_BY_KEY[`${family}/${group}`]) problems.push(`group "${group}" is not in family "${family}"`);
  if (!BED_LABELS[bed]) problems.push(`unknown bed "${bed}"`);
  if (strict && problems.length) {
    throw new Error(`preset ${preset.id}: ${problems.join('; ')}`);
  }
  return { family, group, bed, tags, problems };
}

/**
 * Group the whole library for the browser: family -> group -> presets, in catalogue
 * order. Empty groups are dropped so the menu never shows a door to an empty room.
 */
export function buildTaxonomy(presets) {
  return FAMILIES.map(family => {
    const groups = family.groups
      .map(group => ({
        id: group.id,
        name: group.name,
        blurb: group.blurb,
        presets: presets.filter(p => {
          const c = p.__classification || classify(p);
          return c.family === family.id && c.group === group.id;
        })
      }))
      .filter(group => group.presets.length > 0);
    return {
      id: family.id,
      name: family.name,
      icon: family.icon,
      blurb: family.blurb,
      groups,
      count: groups.reduce((total, g) => total + g.presets.length, 0)
    };
  }).filter(family => family.count > 0);
}

/** Flat list of every submenu label, for the command palette / omni search. */
export function taxonomySearchIndex(presets) {
  const entries = [];
  for (const family of buildTaxonomy(presets)) {
    entries.push({
      kind: 'family',
      id: family.id,
      label: family.name,
      blurb: family.blurb,
      count: family.count
    });
    for (const group of family.groups) {
      entries.push({
        kind: 'group',
        id: `${family.id}/${group.id}`,
        label: `${family.name} \u203a ${group.name}`,
        blurb: group.blurb,
        count: group.presets.length,
        presets: group.presets.map(p => p.id)
      });
      for (const preset of group.presets) {
        entries.push({
          kind: 'preset',
          id: preset.id,
          label: preset.name,
          blurb: preset.description,
          family: family.id,
          group: `${family.id}/${group.id}`,
          tags: classify(preset).tags
        });
      }
    }
  }
  return entries;
}
