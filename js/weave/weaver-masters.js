/**
 * KNITCAT — Masters of cloth: biographies with importable signature patterns.
 *
 * The heritage index (`weave/textile-heritage.js`) knows *that* Anni Albers and William
 * Morris existed; it deliberately carries only a name, an era and a one-line note. This
 * module is the deep layer stacked on top of it for the people a weaver most wants to
 * learn from: a short, original biography and a shelf of real, generative patterns —
 * drawn straight from `presets/preset-library.js` — that evoke each master's visual
 * language and drop onto the card with one click. Nothing here is a static bitmap: every
 * thumbnail is a preset that resizes itself to whatever machine bed you are on, exactly
 * like the pattern browser.
 *
 * Two hard rules keep this honest, and both are asserted by the test suite:
 *   1. a master's `name` must be a real person already listed in the heritage index
 *      (so we never invent a "famous weaver" the reference does not carry), and
 *   2. every entry in a master's `patterns` must be a real preset id (so no button ever
 *      promises a pattern the software cannot generate).
 *
 * Biographies are original prose written for KNITCAT, summarising public-domain facts.
 *
 * @module weave/weaver-masters
 */

import { DESIGNERS, WEAVERS } from './textile-heritage.js';
import { PATTERN_PRESETS } from '../presets/preset-library.js';

/**
 * @typedef {object} Master
 * @property {string} name        Exactly as the heritage index lists them.
 * @property {'weaver'|'designer'} role
 * @property {string} years       Lifespan, e.g. "1899–1994".
 * @property {string} movement    Short handle: "Bauhaus", "Arts & Crafts", …
 * @property {string} backstory   Original biography (a few sentences).
 * @property {string[]} patterns  Preset ids from `PATTERN_PRESETS` in their spirit.
 */

/**
 * The masters, roughly oldest-first. Signatures are curated from the live preset
 * catalogue so each is genuinely importable; the mapping is an homage to a visual
 * language, not an attribution of any specific historic cloth.
 * @type {Master[]}
 */
export const MASTERS = [
  {
    name: 'William Morris', role: 'designer', years: '1834–1896', movement: 'Arts & Crafts',
    backstory: 'Poet, printer and the driving spirit of the Arts & Crafts revival, Morris turned against industrial cheapness and re-founded hand-weaving and natural dyeing at Merton Abbey. His wallpapers and textiles unfurl dense, repeating gardens — acanthus, vine and bird — drawn so the repeat never announces itself.',
    patterns: ['ivy_chain_lace', 'leaf_vine_lace', 'vine_trellis_lace', 'fern_frond_lace', 'trumpet_vine_lace', 'damask']
  },
  {
    name: 'John Henry Dearle', role: 'designer', years: '1860–1939', movement: 'Arts & Crafts',
    backstory: 'Morris & Co.’s great pattern designer of woven textiles and wallpapers, Dearle composed lush double-cloth and damask florals whose interlacing leaves and blossoms carried the firm into the twentieth century after Morris’s death.',
    patterns: ['ivy_chain_lace', 'rose_window_lace', 'leaf_vine_lace', 'damask', 'brocade']
  },
  {
    name: 'C. F. A. Voysey', role: 'designer', years: '1857–1941', movement: 'Arts & Crafts / Modern',
    backstory: 'An architect-designer whose fabric drawings distilled the Arts & Crafts line into something close to art nouveau minimalism: stylised hearts, thistles and roses on long, confident stems, repeated across woven and printed cloth with spare, modern elegance.',
    patterns: ['leaf_lace', 'vine_trellis_lace', 'sweetheart_pixel_fair_isle', 'rose_window_lace']
  },
  {
    name: 'Ethel Mairet', role: 'weaver', years: '1872–1952', movement: 'Craft revival',
    backstory: 'From her workshop at Gospels Cottage in Ditchling, Mairet taught a generation to weave by hand and wrote “Hand-Weaving”, the book that kept craft technique alive between the wars. Her cloth honours the plain warp-and-weft and the honest border.',
    patterns: ['greek_meander', 'moroccan_lattice', 'tartan_plaid', 'damask']
  },
  {
    name: 'Anni Albers', role: 'weaver', years: '1899–1994', movement: 'Bauhaus',
    backstory: 'Bauhaus weaving workshop’s most celebrated graduate, Albers treated the loom as a laboratory of structure and later wrote “On Weaving”. Her “pictorial weavings” reduce cloth to geometry — grids, checks and diagonal fields — proving a woven surface can think like a drawing.',
    patterns: ['optical_checker', 'staircase_optical', 'chevron_truchet', 'argyle_lattice', 'double_weave', 'huckaback_weave']
  },
  {
    name: 'Gunta Stölzl', role: 'weaver', years: '1897–1983', movement: 'Bauhaus',
    backstory: 'The only woman to rise to master at the Bauhaus, Stölzl ran its weaving workshop and pushed it from expressive, dyed abstraction toward rigorous, industrially minded material experiment. Her figured cloths layer colour and structure with painterly control.',
    patterns: ['jacquard_figure', 'coverlet', 'brocade', 'damask', 'lampas', 'optical_checker']
  },
  {
    name: 'Otti Berger', role: 'weaver', years: '1896–1944', movement: 'Bauhaus',
    backstory: 'A Bauhaus textile designer of ingenious, rigorous interior fabrics, Berger specialised in structured, often double-layered weaves whose surfaces were as considered as architecture. Her work treats a cloth as a system of interlacing, not a decoration.',
    patterns: ['pique', 'leno', 'charvet', 'double_weave', 'huckaback_weave']
  },
  {
    name: 'Margaretha Reichardt', role: 'weaver', years: '1907–1984', movement: 'Bauhaus',
    backstory: 'A Bauhaus weaving-workshop designer who went on to run her own textile studio, Reichardt made clear, geometric hand- and industrial-weaves rooted in the movement’s belief that good structure is good design.',
    patterns: ['argyle_lattice', 'optical_checker', 'chevron_truchet', 'double_weave']
  },
  {
    name: 'Lilly Reich', role: 'designer', years: '1885–1955', movement: 'Deutscher Werkbund / Modern',
    backstory: 'A designer and editor closely tied to the Deutscher Werkbund and to Mies van der Rohe, Reich brought a cool, material-honest eye to textiles and interiors, letting the weave and the fibre carry the design rather than applied ornament.',
    patterns: ['huckaback_weave', 'argyle_lattice', 'optical_checker', 'tartan_plaid']
  },
  {
    name: 'Ada Dietz', role: 'weaver', years: '1876–1959', movement: 'American craft',
    backstory: 'An American weaver who moved between craft and industry and wrote on the subject, Dietz worked the classic loom structures — overshot and summer-and-winter — with a designer’s sense of the repeat.',
    patterns: ['argyle_diamond', 'hexagon_tessellation', 'tartan_plaid', 'old_sign_of_hamu', 'peebeg_fair_isle']
  },
  {
    name: 'Dorothy Liebes', role: 'weaver', years: '1893–1972', movement: 'American modern',
    backstory: 'California’s “Dean of Weavers”, Liebes bridged hand-weaving and American factory production, dyeing wild, colour-saturated cloth for Hollywood and industry alike and proving craft could scale without losing its nerve.',
    patterns: ['turkish_kilim', 'persian_boteh', 'kilim_diamond_band', 'navajo_step', 'moroccan_lattice']
  },
  {
    name: 'Clara Sherman', role: 'weaver', years: '1877–1959', movement: 'American craft',
    backstory: 'An American weaver of figured and pictorial cloth working squarely in the Arts & Crafts current, Sherman’s tapestry-like surfaces brought painterly imagery to the hand loom.',
    patterns: ['damask', 'brocade', 'coverlet', 'lampas', 'jacquard_figure']
  },
  {
    name: 'Ruth Reeves', role: 'designer', years: '1892–1966', movement: 'American modern',
    backstory: 'An American modernist weaver and artist, Reeves fused folk and machine idioms, treating woven and printed surfaces as fields of bold, interlocking motif with a graphic designer’s discipline.',
    patterns: ['celtic_knotwork', 'lsystem_branches', 'game_of_life_ruins', 'dragon_curve']
  },
  {
    name: 'Marianne Straub', role: 'weaver', years: '1920–2006', movement: 'British industrial craft',
    backstory: 'One of the leading British weavers of the post-war years and a devoted teacher, Straub made hand-woven cloth destined for industry — crisp checks, tweeds and geometric structures with architectural clarity.',
    patterns: ['tartan_plaid', 'houndstooth_jacquard', 'argyle_diamond', 'optical_checker']
  },
  {
    name: 'Alexander Girard', role: 'designer', years: '1907–1993', movement: 'Mid-century modern',
    backstory: 'An Italian-American modernist behind Herman Miller’s fabrics, Girard flooded mid-century interiors with exuberant colour and a globe-spanning vocabulary of folk motif, and was one of the great collectors of textile lore.',
    patterns: ['bukovina_birds', 'serbian_kolna', 'navajo_step', 'moroccan_lattice', 'andean_chakana', 'latvian_fishbone']
  },
  {
    name: 'Lucienne Day', role: 'designer', years: '1917–2010', movement: 'Festival of Britain modern',
    backstory: 'The British modernist who defined Festival-of-Britain fabric with prints like “Contemplation” and “Plantin” for Heal’s and Liberty, Day drew a light, dancing, semi-abstract botanical line that brought the atom-age optimism of the 1950s onto cloth.',
    patterns: ['fern_frond_lace', 'wave_pebble_lace', 'scallop_shell_lace', 'zigzag_chevron_lace', 'superformula_bloom']
  },
  {
    name: 'Bernat Klein', role: 'designer', years: '1922–2008', movement: 'Scottish colour',
    backstory: 'The colourist of the Scottish tweed industry, Klein spun and designed bold, softly-blended tweeds for his Borders mill and dressed the 1960s in them, working with fashion houses to drag hard-wear cloth into high style.',
    patterns: ['selbu_star', 'setesdal_rosette', 'latvian_star', 'ostrogs_star', 'tartan_plaid']
  },
  {
    name: 'Maija Isola', role: 'designer', years: '1914–2001', movement: 'Marimekko',
    backstory: 'Marimekko’s most prolific designer and the hand behind “Unikko”, the giant poppy that made the Finnish house famous, Isola drew fearless, large-scale florals and graphic colour fields with a naive-seeming confidence.',
    patterns: ['superformula_bloom', 'rose_curve_petals', 'trumpet_vine_lace', 'fir_tree_lace']
  },
  {
    name: 'Laura Ashley', role: 'designer', years: '1925–1985', movement: 'Revival domestic craft',
    backstory: 'With block-printed chintz of closely-drawn florals, Laura Ashley built an entire aesthetic of romantic, historically-fed domestic craft that quietly dominated 1970s homes on both sides of the Atlantic.',
    patterns: ['rose_window_lace', 'trumpet_vine_lace', 'vine_trellis_lace', 'leaf_vine_lace']
  },
  {
    name: 'Vuokko Nurmesniemi', role: 'designer', years: '1930–2023', movement: 'Marimekko / Finnish graphic',
    backstory: 'A Finnish designer of the Marimekko era, Nurmesniemi created the “Jokapoika” stripe — that river of two colourways — and a stripped, graphic idiom that made bold rhythm out of nothing but width and hue.',
    patterns: ['tartan_plaid', 'ocean_wave', 'staircase_optical', 'moire_rings']
  },
  {
    name: 'Micheline Beauchemin', role: 'weaver', years: '1908–1985', movement: 'Quebec tapestry',
    backstory: 'A Quebec tapestry weaver of monumental public works, Beauchemin hung vast, ruggedly coloured woven murals in buildings across Canada, bringing the hand loom into civic scale.',
    patterns: ['damask', 'brocade', 'jacquard_figure', 'coverlet']
  },
  {
    name: 'Bronwyn Bancroft', role: 'designer', years: 'b. 1958', movement: 'Australian Aboriginal design',
    backstory: 'A Bundjalung artist and designer, Bancroft translates Country — waterholes, tracks, flight paths — into bold, dotted, all-over pattern, running a textile house that carries First Nations design into cloth.',
    patterns: ['reaction_diffusion_spots', 'topograph_bands', 'value_noise_field', 'superformula_bloom', 'rose_curve_petals']
  }
];

/* ─────────────────────────────────────────────────────────────────────────────
 * Pure queries.
 * ─────────────────────────────────────────────────────────────────────────── */

const PRESET_BY_ID = new Map(PATTERN_PRESETS.map(p => [p.id, p]));
const HERITAGE_NAMES = new Set([...DESIGNERS.map(d => d.name), ...WEAVERS.map(w => w.name)]);

/** @returns {Master|undefined} the master with this exact name. */
export function masterByName(name) {
  return MASTERS.find(m => m.name === name);
}

/**
 * Resolve a master’s signature preset ids into catalog entries, dropping (silently) any
 * id that is not a real preset so a UI can never render a dead thumbnail.
 * @param {string} name
 * @returns {{presetId:string,name:string,category:string,mode:string}[]}
 */
export function masterPatterns(name) {
  const m = masterByName(name);
  if (!m) return [];
  const out = [];
  for (const id of m.patterns) {
    const p = PRESET_BY_ID.get(id);
    if (p) out.push({ presetId: p.id, name: p.name, category: p.category, mode: p.mode });
  }
  return out;
}

/**
 * Filter the master list, optionally by role and a free-text query over name, movement
 * and biography.
 * @param {{role?:'weaver'|'designer', query?:string}} [opts]
 * @returns {Master[]}
 */
export function listMasters(opts = {}) {
  const { role, query } = opts;
  const q = String(query || '').trim().toLowerCase();
  return MASTERS.filter(m => (!role || m.role === role) &&
    (!q || [m.name, m.movement, m.backstory].join(' ').toLowerCase().includes(q)));
}

/**
 * Data-integrity report the test suite turns into assertions: heritage names that do not
 * exist, preset ids that do not resolve, and any master with no importable pattern.
 * @returns {{unknownNames:string[], unknownPatterns:string[], emptyMasters:string[]}}
 */
export function mastersIntegrity() {
  const unknownNames = [];
  const unknownPatterns = [];
  const emptyMasters = [];
  for (const m of MASTERS) {
    if (!HERITAGE_NAMES.has(m.name)) unknownNames.push(m.name);
    const missing = m.patterns.filter(id => !PRESET_BY_ID.has(id));
    if (missing.length) unknownPatterns.push(...missing.map(id => `${m.name} → ${id}`));
    if (m.patterns.length && missing.length === m.patterns.length) emptyMasters.push(m.name);
  }
  return { unknownNames, unknownPatterns, emptyMasters };
}

/** Counts the master gallery can show at a glance. */
export function mastersSummary() {
  const presetCount = new Set(MASTERS.flatMap(m => m.patterns)).size;
  return {
    masters: MASTERS.length,
    weavers: MASTERS.filter(m => m.role === 'weaver').length,
    designers: MASTERS.filter(m => m.role === 'designer').length,
    distinctPatterns: presetCount
  };
}
