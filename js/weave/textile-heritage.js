/**
 * KNITCAT — Textile heritage reference.
 *
 * The pattern library can *draft* a twill or a Jacquard figure, but a CAD that knows
 * the geometry and not the lineage is a calculator wearing overalls. This module is the
 * other half of the craft: the designers, weavers, tools, mills, traditions and
 * fundamentals that sit behind every structure in `weave/weave-knowledge.js`. It is a
 * deliberately browser-free data module (names, eras, one-line notes and nothing else)
 * so the heritage browser panel and the test suite can both read it without a DOM —
 * the same rule the rest of the reference layers follow.
 *
 * Source is the public-domain "Textile arts" / "Textile designers" navigation taxonomy;
 * entries are grouped the way that reference groups them (by era for designers, by role
 * for everything else). Notes are kept short and factual.
 *
 * @module weave/textile-heritage
 */

/** Ordered design eras, oldest first — the timeline the heritage panel walks down. */
export const TEXTILE_ERAS = [
  { id: '18th', name: '18th century' },
  { id: '19th', name: '19th century' },
  { id: 'early20', name: 'Early 20th century' },
  { id: 'mid20', name: 'Mid 20th century' },
  { id: 'late20', name: 'Late 20th century' }
];

/**
 * @typedef {object} Designer
 * @property {string} name
 * @property {string} era    One of {@link TEXTILE_ERAS}' ids.
 * @property {string} [note] One-line context (where known).
 */

/**
 * Textile *designers*, by era — the names a weaving or surface-design history carries.
 * @type {Designer[]}
 */
export const DESIGNERS = [
  // 18th century — the Spitalfields silk-drawing tradition.
  { name: 'Anna Maria Garthwaite', era: '18th', note: 'Spitalfields silk designer; naturalistic florals drawn for the loom.' },
  { name: 'William Kilburn', era: '18th', note: 'Calico printer and designer of the “Queen Charlotte” pattern.' },

  // 19th century — the Arts & Crafts revival.
  { name: 'John Henry Dearle', era: '19th', note: 'Morris & Co. designer of woven textiles and wallcoverings.' },
  { name: 'William Morris', era: '19th', note: 'Arts & Crafts founder; revived hand-weaving and dyeing at Merton Abbey.' },
  { name: 'C. F. A. Voysey', era: '19th', note: 'Architect-designer; stylised hearts and thistles across fabric and paper.' },
  { name: 'Bernard Adeney', era: '19th', note: 'Arts & Crafts textile designer and watercolourist.' },
  { name: 'Ethel Mairet', era: '19th', note: 'Weaver and author of “Hand-Weaving”, key figure of the craft revival.' },
  { name: 'Silver Studio', era: '19th', note: 'Manchester design studio supplying pattern books to the mills.' },

  // Mid-20th century — the modern movement and the Scandinavian/american boom.
  { name: 'Laura Ashley', era: 'mid20', note: 'Block-printed chintz and a whole aesthetic of revival domestic craft.' },
  { name: 'Helen Berman', era: 'mid20', note: 'Sculptural textiles bridging craft and the fine-art world.' },
  { name: 'Lucienne Day', era: 'mid20', note: 'British modernist; “Contemplation” and “Plantin” for Heal’s and liberty.' },
  { name: 'Ada Dietz', era: 'mid20', note: 'American weaver and designer bridging craft and industry.' },
  { name: 'Elenhank', era: 'mid20', note: 'Post-war British textiles label for the home.' },
  { name: 'Alexander Girard', era: 'mid20', note: 'Italian-American modernist; Herman Miller fabrics and exuberant colour.' },
  { name: 'Joan Glass', era: 'mid20', note: 'Weaver-artist; historic tapestry technique with a modern hand.' },
  { name: 'Viola Gråsten', era: 'mid20', note: 'Finnish-Swedish designer of printed and woven textiles.' },
  { name: 'Maija Isola', era: 'mid20', note: 'Marimekko; “Unikko” poppy and a vocabulary of bold prints.' },
  { name: 'Bernat Klein', era: 'mid20', note: 'Colourist of the Scottish tweed industry; worked with Hemingway & Bell.' },
  { name: 'Jack Lenor Larsen', era: 'mid20', note: 'American designer and collector; brought world textiles to US interiors.' },
  { name: 'Dorothy Liebes', era: 'mid20', note: '“California’s Dean of Weavers”; industrial hand-weaving and colour.' },
  { name: 'Marimekko', era: 'mid20', note: 'Finnish house of printed cloth and its graphic idiom.' },
  { name: 'Mario Prassinos', era: 'mid20', note: 'Painter-designer of celebrated Liberty prints.' },
  { name: 'Ernest Race', era: 'mid20', note: 'Designer associated with post-war British make-do-and-mend textiles.' },
  { name: 'Ruth Reeves', era: 'mid20', note: 'American modernist weaver; machined and folk idioms.' },
  { name: 'Astrid Sampe', era: 'mid20', note: 'Swedish designer; the “Tärna” check for Gustavsberg and textiles.' },
  { name: 'Franco Scalamandré', era: 'mid20', note: 'Italian-American firm reviving historic European silks.' },
  { name: 'May Smith', era: 'mid20', note: 'British hand-weaver and writer; Lancashire and craft revival.' },
  { name: 'Marianne Straub', era: 'mid20', note: 'Leading British industrial hand-weaver and teacher.' },
  { name: 'Thelma Johnson Streat', era: 'mid20', note: 'Native American-born artist of textiles, painting and performance.' },
  { name: 'Mary White', era: 'mid20', note: 'Cotton-into-fashion pioneer for Courtaulds.' },
  { name: 'Suzie Zuzek', era: 'mid20', note: 'Kodell “Molka” prints; the fabric of the American mid-century.' },

  // Late-20th century — global, graphic and craft-revival voices.
  { name: 'Angela Adams', era: 'late20', note: 'Irish-born printed-textile designer.' },
  { name: 'Hiroshi Awatsuji', era: 'late20', note: 'Japanese designer of woven furnishing textiles.' },
  { name: 'Bronwyn Bancroft', era: 'late20', note: 'Bundjalung artist designing bold, country-derived prints.' },
  { name: 'Celia Birtwell', era: 'late20', note: 'Liberty-print couturier of the Swinging Sixties (Ossie Clark).' },
  { name: 'Valerie Campbell-Harding', era: 'late20', note: 'British printed and woven textile designer.' },
  { name: 'Georgina von Etzdorf', era: 'late20', note: 'Woven tapestry-style garments and flat-weave craft.' },
  { name: 'Lily Goddard', era: 'late20', note: 'Weaver, designer and craft-education writer.' },
  { name: 'Hans Krondahl', era: 'late20', note: 'Swedish textile designer and educator.' },
  { name: 'Meera Mehta', era: 'late20', note: 'Indian-British designer; block-print and Jacquard for industry.' },
  { name: 'Vuokko Nurmesniemi', era: 'late20', note: 'Finnish designer; “Jokapoika” stripe and Marimekko-era graphics.' },
  { name: 'Graziela Preiser', era: 'late20', note: 'Brazilian-born Swedish textile designer.' },
  { name: 'Siona Shimshi', era: 'late20', note: 'Israeli designer and painter of textiles and stage.' },
  { name: 'Sue Timney', era: 'late20', note: 'British designer of printed domestic textiles.' },
  { name: 'Up Tied', era: 'late20', note: 'Collective label working at the edge of craft and design.' }
];

/**
 * Notable *weavers* and weaving houses — the people and firms defined by the loom
 * rather than the drawing sheet, many from the early-20th-century craft and Bauhaus world.
 * @type {Designer[]}
 */
export const WEAVERS = [
  { name: 'Acesas', era: 'early20', note: 'Legendary figure of early Peruvian weaving.' },
  { name: 'Anni Albers', era: 'early20', note: 'Bauhaus weaver; “On Weaving” and pictorial weavings.' },
  { name: 'Otti Berger', era: 'early20', note: 'Bauhaus textile designer of innovative interior fabrics.' },
  { name: 'Micheline Beauchemin', era: 'early20', note: 'Quebec tapestry weaver of monumental public works.' },
  { name: 'Johanna Brunsson', era: 'early20', note: 'Swedish weaver and pattern-book author.' },
  { name: 'Ada Dietz', era: 'early20', note: 'American weaver; summer-and-winter and overshot structures.' },
  { name: 'Thomas Ferguson & Co Ltd', era: 'early20', note: 'Irish damask weavers of Kilbourneg.' },
  { name: 'Elisabeth Forsell', era: 'early20', note: 'Swedish weaving-school teacher and sampler maker.' },
  { name: 'Arshag Karagheusian', era: 'early20', note: 'Armenian-American carpet industrialist.' },
  { name: 'Latif Karimov', era: 'early20', note: 'Azerbaijani master of the Karabakh carpet.' },
  { name: 'Dorothy Liebes', era: 'early20', note: 'Bridged hand-weaving and American factory production.' },
  { name: 'Ethel Mairet', era: 'early20', note: 'Gospels, Ditchling; teacher of the craft-weaving revival.' },
  { name: 'Maria Elisabet Öberg', era: 'early20', note: 'Swedish rollakan and double-weave tradition.' },
  { name: 'Lilly Reich', era: 'early20', note: 'Austrian designer; textiles and the Deutscher Werkbund.' },
  { name: 'Margaretha Reichardt', era: 'early20', note: 'Bauhaus weaving-workshop textile designer.' },
  { name: 'John Rylands', era: 'early20', note: 'South Lancashire cotton-spinning dynasty (the “Cotton King”).' },
  { name: 'Brigitta Scherzenfeldt', era: 'early20', note: 'Swedish memoist of Central-Asian weaving and captivity.' },
  { name: 'Clara Sherman', era: 'early20', note: 'American weaver of figured and pictorial cloth.' },
  { name: 'Gunta Stölzl', era: 'early20', note: 'Only woman master at the Bauhaus; ran the weaving workshop.' },
  { name: 'Judocus de Vos', era: 'early20', note: 'Flemish weaver of the “de Vos” figured stuffs.' },
  { name: 'Margaretha Zetterberg', era: 'early20', note: 'Swedish weaver; textiles and craft reform.' }
];

/**
 * Tools and techniques of the loom — the verbs and kit of making cloth by hand and mill.
 * @type {{name:string, kind:string}[]}
 */
export const TOOLS = [
  { name: 'Band weaving', kind: 'technique' },
  { name: 'Barber-Colman knotter', kind: 'machine' },
  { name: 'Beamer', kind: 'machine' },
  { name: 'Braid', kind: 'technique' },
  { name: 'Coast Salish weaving', kind: 'tradition' },
  { name: 'Chilkat weaving', kind: 'tradition' },
  { name: 'Fingerweaving', kind: 'technique' },
  { name: 'Flying shuttle', kind: 'invention' },
  { name: 'Heddle', kind: 'tool' },
  { name: 'Ikat', kind: 'technique' },
  { name: 'Kasuri', kind: 'technique' },
  { name: 'Navajo weaving', kind: 'tradition' },
  { name: 'Pibiones', kind: 'technique' },
  { name: 'Reed', kind: 'tool' },
  { name: 'Shed', kind: 'tool' },
  { name: 'Shuttle', kind: 'tool' },
  { name: 'Sizing', kind: 'process' },
  { name: 'Tablet weaving', kind: 'technique' },
  { name: 'Talim code', kind: 'notation' },
  { name: 'Tāniko', kind: 'tradition' },
  { name: 'Tapestry', kind: 'technique' },
  { name: 'Temple', kind: 'tool' },
  { name: 'Wattle', kind: 'technique' },
  { name: 'Warp and weft', kind: 'component' },
  { name: 'Yarn', kind: 'component' }
];

/** The core fiber-arts fundamentals a card can touch or be measured against. */
export const FUNDAMENTALS = [
  'Beadwork', 'Braid', 'Crochet', 'Dyeing', 'Embroidery', 'Felting', 'Fiber',
  'Knitting', 'Lace', 'Macramé', 'Nålebinding', 'Needlework', 'Plying', 'Rope',
  'Rug making', 'Sewing', 'Spinning', 'Textile printing', 'Weaving', 'Yarn'
];

/** Threads a heritage timeline can follow (“History of …”). */
export const HISTORY_TOPICS = [
  'Clothing and textiles',
  'Quilting',
  'Silk (Byzantine, Indian subcontinent)',
  'Textile manufacture during the British Industrial Revolution',
  'Textile manufacturing by pre-industrial methods',
  'Timeline of clothing and textiles technology'
];

/** Regional and ethnic weaving traditions worth naming rather than flattening. */
export const REGIONAL_TRADITIONS = [
  { name: 'Kongo & Kuba cloth', region: 'Africa' },
  { name: 'Acheik', region: 'Burma' },
  { name: 'Aboriginal textile arts', region: 'Australia' },
  { name: 'Andean & Mapuche weaving', region: 'South America' },
  { name: 'Maya & Oaxacan weaving', region: 'Mesoamerica' },
  { name: 'Navajo weaving', region: 'North America' },
  { name: 'Hmong textile arts', region: 'Southeast Asia' },
  { name: 'Balinese & Sumba cloth', region: 'Indonesia' },
  { name: 'Korean weaving', region: 'Korea' },
  { name: 'Māori tāniko & raranga', region: 'Aotearoa' }
];

/** Employment practice and mill heritage (the human/economic half of the story). */
export const INDUSTRY_HERITAGE = [
  { name: 'Bancroft Shed', kind: 'mill', note: 'Preserved steam-powered Lancashire loom shed.' },
  { name: 'Queen Street Mill', kind: 'mill', note: '“Queen Anne” — a working loom museum in Burnley.' },
  { name: 'Kissing the shuttle', kind: 'practice', note: 'The old trade of wetting the shuttle eye — banned by mechanisation.' },
  { name: 'More looms', kind: 'practice', note: 'The weaving equivalent of “the more the merrier” at the loom-end.' },
  { name: 'Piece-rate list', kind: 'practice', note: 'The payment schedule that priced each cloth by the length.' }
];

/* ─────────────────────────────────────────────────────────────────────────────
 * Pure queries for the heritage browser and its tests.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Group a list of era-tagged entries (designers or weavers) into ordered buckets.
 * @param {Designer[]} list
 * @returns {{era: {id:string,name:string}, people: Designer[]}[]} oldest era first
 */
export function byEra(list) {
  return TEXTILE_ERAS
    .map(era => ({ era, people: list.filter(p => p.era === era.id) }))
    .filter(bucket => bucket.people.length > 0);
}

/** @returns {Designer[]} every designer in a given era id. */
export function designersInEra(eraId) {
  return DESIGNERS.filter(d => d.era === eraId);
}

/** A person appears in more than one list (Liebes, Mairet, Dietz span design and craft). */
export function crossoverPeople() {
  const weaverNames = new Set(WEAVERS.map(w => w.name));
  return DESIGNERS.filter(d => weaverNames.has(d.name)).map(d => d.name);
}

/** Counts the heritage panel can show at a glance. */
export function heritageSummary() {
  return {
    designers: DESIGNERS.length,
    weavers: WEAVERS.length,
    tools: TOOLS.length,
    fundamentals: FUNDAMENTALS.length,
    traditions: REGIONAL_TRADITIONS.length,
    eras: TEXTILE_ERAS.length,
    centuries: new Set(DESIGNERS.map(d => d.era)).size
  };
}
