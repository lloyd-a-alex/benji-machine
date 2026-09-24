/**
 * KNITCAT — the guided handbook (pure content).
 *
 * A CAD this deep needs a manual that is *part of the machine*, not a PDF parked in a
 * corner. This module is the words: an exhaustive, structured handbook authored as
 * plain data so it can be rendered as a beautiful docked guide (`ui/guide-panel.js`),
 * crawled, searched, and — most importantly — *clicked through*. Every section carries
 * `try:` buttons whose targets are real action ids from the live command vocabulary
 * (`MENUBAR_ACTIONS`) or the app's own tabs, so a beginner reading "tile a motif" can
 * press the button and land exactly where that happens.
 *
 * It is deliberately browser-free: no DOM at import, no side effects. The prose is
 * original to KNITCAT; the only external facts are public-domain textile history.
 *
 * The "no dead links" guarantee is enforced by {@link collectGuideLinks}, which the
 * test suite cross-checks against the real dispatcher vocabulary — so this handbook can
 * never advertise a button that leads nowhere, no matter how much it grows.
 *
 * @module docs/guide-content
 */

/**
 * A single clickable deep-link inside a section.
 * @typedef {object} GuideLink
 * @property {string} label  Button text ("Open the pattern library").
 * @property {string} run    `command:<id>` (a MENUBAR_ACTIONS id) or `tab:<name>`.
 * @property {string} [hint] Short tooltip.
 */

/**
 * @typedef {object} GuideSection
 * @property {string} id
 * @property {string} title
 * @property {string} body   Original handbook prose (a few sentences).
 * @property {string[]} [steps]  Ordered "do this" lines for how-to sections.
 * @property {GuideLink[]} [try] Buttons that jump into the software.
 * @property {string} [tip]      A single high-value aside, shown distinctly.
 */

/**
 * @typedef {object} GuideChapter
 * @property {string} id
 * @property {string} title
 * @property {string} glyph  Emoji shown in the chapter rail.
 * @property {string} blurb  One line under the chapter title.
 * @property {GuideSection[]} sections
 */

/** The tabs a guide link can drive you to (kept in step with index.html `data-tab`). */
export const GUIDE_TABS = ['editor', 'schedule', 'yarn', 'punchcard', 'cnc', 'clothes', 'brother'];

/**
 * The whole handbook, in reading order. Chapters are grouped by the journey a new
 * weaver actually takes: make a card → understand it → fit it to a body → send it to
 * the machine → and the human/heritage story underneath it all.
 * @type {GuideChapter[]}
 */
export const GUIDE_CHAPTERS = [
  {
    id: 'start',
    title: 'Getting started',
    glyph: '\u{1F33F}',
    blurb: 'What KNITCAT is and the three things to try first.',
    sections: [
      {
        id: 'what',
        title: 'KNITCAT in one breath',
        body: 'KNITCAT is a full knitting-machine CAD that runs in the browser with no install and no account. You draw a pattern on a punchcard grid, it compiles that grid into a real carriage schedule for a domestic knitting machine, and it can export the result to G-code, DXF, SVG and more. Everything you make autosaves locally and can be shared as a single link.',
        try: [
          { label: 'New card', run: 'command:file.new', hint: 'Start a blank project' },
          { label: 'Command palette', run: 'command:help.search', hint: 'Ctrl+K — jump to any feature' }
        ]
      },
      {
        id: 'three',
        title: 'The first three minutes',
        body: 'The fastest way to understand the machine is to drop a known pattern on the card and watch it compile, then reshape one motif by hand.',
        steps: [
          'Open the pattern library and click any preset — it loads straight onto the card.',
          'Switch to the schedule tab to see the carriage passes the compiler generated.',
          'Back on the editor, use the pencil to punch a few holes and watch the schedule update live.'
        ],
        try: [
          { label: 'Pattern library', run: 'command:design.presets' },
          { label: 'Go to the editor', run: 'tab:editor' },
          { label: 'See the schedule', run: 'tab:schedule' }
        ]
      },
      {
        id: 'modes',
        title: 'Four patterning modes',
        body: 'A card means different things in different modes. Lace stores stitch types (knit, purl, eyelet, left/right transfers); Fair Isle, tuck and slip modes store a simple worked/blank cell. The mode decides the palette you see and what the compiler is allowed to do.',
        try: [
          { label: 'Symbol legend', run: 'command:design.legend', hint: 'Every stitch symbol explained' },
          { label: 'Eyelets vs transfers', run: 'command:help.eyelets' }
        ]
      }
    ]
  },
  {
    id: 'editor',
    title: 'The CAD editor',
    glyph: '\u270F\uFE0F',
    blurb: 'Tools, selection, layers and the undo tree.',
    sections: [
      {
        id: 'tools',
        title: 'Drawing tools',
        body: 'The left toolbar carries pencil, eraser, flood fill, magic wand, lasso, bezier and spline curves, line, rectangle and ellipse (filled and outline), smudge, measure, annotate and pan. Every tool the canvas knows is also searchable in the palette, so you never have to remember where an icon lives.',
        tip: 'Hold Shift while drawing a line or rectangle to lock it to 45\u00B0.',
        try: [{ label: 'Fit the view', run: 'command:view.fit' }]
      },
      {
        id: 'select',
        title: 'Select, copy and the clip shelf',
        body: 'Marquee- or wand-select a region, then cut/copy/paste or duplicate it. Copies land in the clip shelf, a little library of recent snippets you can re-paste anywhere, on any card.',
        try: [
          { label: 'Select all', run: 'command:edit.selectAll' },
          { label: 'Open the clip shelf', run: 'command:edit.clipshelf' }
        ]
      },
      {
        id: 'layers',
        title: 'Layers and the undo tree',
        body: 'Pattern layers stack bottom-up with a topmost-non-blank-wins composite. History is a branching tree, not a single line: undo, then draw something new, and the abandoned branch is kept so you can jump back.',
        try: [{ label: 'Undo', run: 'command:edit.undo' }, { label: 'Redo', run: 'command:edit.redo' }]
      }
    ]
  },
  {
    id: 'pattern',
    title: 'Pattern intelligence',
    glyph: '\u{1F517}',
    blurb: 'Crop, tile, repeat, symmetrise and read the numbers behind a card.',
    sections: [
      {
        id: 'fit-design',
        title: 'Fit the card to the design',
        body: 'Once a motif exists, stop fighting empty margins. Crop trims the card to the bounding box of real stitches (plus optional padding); pad adds margin to reach a target size; tile repeats the whole card across and down; border frames it.',
        try: [
          { label: 'Crop to content', run: 'command:pattern.crop' },
          { label: 'Tile / repeat', run: 'command:pattern.tile' },
          { label: 'Add a border', run: 'command:pattern.border' }
        ]
      },
      {
        id: 'understand',
        title: 'Understand the design',
        body: 'KNITCAT measures a card the way a knitter reads it: where the repeat hides (detect repeat), how symmetric it already is, how dense the punching is row by row, and how many separate motifs you actually drew.',
        try: [
          { label: 'Detect the repeat', run: 'command:pattern.detectRepeat' },
          { label: 'Symmetry report', run: 'command:pattern.symmetry' },
          { label: 'Density map', run: 'command:pattern.density' },
          { label: 'Count the motifs', run: 'command:motif.summary' }
        ]
      },
      {
        id: 'true',
        title: 'Make it perfectly symmetric',
        body: 'Turn a hand-drawn quarter into a full motif. Mirror left onto right or top onto bottom, keeping whichever half you drew, and the whole card becomes a repeatable, balanced figure.',
        try: [
          { label: 'Symmetric \u2194 (left/right)', run: 'command:pattern.symmetric.h' },
          { label: 'Symmetric \u2195 (top/bottom)', run: 'command:pattern.symmetric.v' },
          { label: 'Kaleidoscope', run: 'command:motif.kaleidoscope' }
        ]
      },
      {
        id: 'shape',
        title: 'Reshape the worked area',
        body: 'Morphology for stitch charts: thicken (dilate) or shrink (erode) the worked cells, trace an outline around every figure, fill enclosed holes so a ring becomes a disc, and despeckle stray single stitches.',
        try: [
          { label: 'Thicken', run: 'command:motif.dilate' },
          { label: 'Outline', run: 'command:motif.outline' },
          { label: 'Fill enclosed holes', run: 'command:motif.fillHoles' }
        ]
      }
    ]
  },
  {
    id: 'design',
    title: 'Generating design',
    glyph: '\u{1F308}',
    blurb: 'Presets, math studio, image tracing and photo punchcards.',
    sections: [
      {
        id: 'library',
        title: 'The pattern library',
        body: 'Around a hundred and fifty generative presets — lace, colourwork, texture, double-bed, weave, edges, shaping and math-studio families — all authored as code, so any preset resizes itself to whatever bed you are on. Browse by family, filter by bed, favourite the ones you love.',
        try: [{ label: 'Open the library', run: 'command:design.presets' }]
      },
      {
        id: 'math',
        title: 'The math studio',
        body: 'Generate patterns from equations, cellular automata, spirals and noise, with a seed you can roll. A result you like is reproducible because the seed is kept.',
        try: [{ label: 'Open the math studio', run: 'command:design.math' }]
      },
      {
        id: 'image',
        title: 'Trace an image or a photo',
        body: 'Drop in a bitmap and KNITCAT quantises it to the card with your choice of dither, contrast and gamma, optionally enforcing paper-bridge protection so nothing falls apart on the loom. You can also photograph a real punchcard and read it back in.',
        try: [
          { label: 'Import an image', run: 'command:design.image' },
          { label: 'Read a punchcard photo', run: 'command:design.punchcard-photo' }
        ]
      }
    ]
  },
  {
    id: 'clothes',
    title: 'Garments & fit',
    glyph: '\u{1F9F3}',
    blurb: 'Tailor knits to a body, grade sizes and estimate yarn.',
    sections: [
      {
        id: 'atelier',
        title: 'The clothes atelier',
        body: 'Every garment you can knit — hats, tops, tanks, scarves, socks and more — is tailored from real measurements to your gauge and yarn, drawn as a precise cutting outline rather than a boxy rectangle. Pick a garment and KNITCAT computes the cast-on, the shaping and the stitch grid.',
        try: [{ label: 'Go to the clothes tab', run: 'tab:clothes' }]
      },
      {
        id: 'fit',
        title: 'Fit, ease and standard sizes',
        body: 'The fit engine turns body measurements into finished dimensions with wearing ease, handles grading across a size run, short-row shaping and drape, and prints a fit report you can act on.',
        try: [{ label: 'Open the fit system', run: 'command:v2.fit' }]
      },
      {
        id: 'yarnest',
        title: 'Yarn estimates',
        body: 'Because a pattern is only real once you know how much yarn it eats, garment estimates pull from the same geometry that draws them.',
        try: [{ label: 'Open the yarn system', run: 'command:v2.yarn' }]
      }
    ]
  },
  {
    id: 'schedule',
    title: 'Schedule, punchcard & simulation',
    glyph: '\u{1F5D3}\uFE0F',
    blurb: 'How a grid becomes carriage passes and knitted fabric.',
    sections: [
      {
        id: 'compile',
        title: 'The compiler',
        body: 'The card compiles into carriage passes — which carriage runs each row and which way it travels. The schedule tab and the punchcard ribbon show the same truth two ways: as a knit-along list and as a physical card with sprockets.',
        try: [
          { label: 'Go to the schedule', run: 'tab:schedule' },
          { label: 'Go to the punchcard', run: 'tab:punchcard' },
          { label: 'Compiler system', run: 'command:v2.compiler' }
        ]
      },
      {
        id: 'knitalong',
        title: 'Knit-along companion',
        body: 'Walk the compiled schedule one row at a time with the current row spotlighted on the card. It only paints a highlight — it never edits your design.',
        try: [{ label: 'Toggle knit-along', run: 'command:design.knitalong' }]
      },
      {
        id: 'simulate',
        title: 'Physical yarn simulation',
        body: 'The yarn tab renders the card as fabric with a real material model and colour choices, so you can see gauge and drape before committing yarn.',
        try: [{ label: 'Go to the yarn simulation', run: 'tab:yarn' }]
      }
    ]
  },
  {
    id: 'machine',
    title: 'Machines, feasibility & export',
    glyph: '\u2699\uFE0F',
    blurb: 'Will it knit? On which machine? And how does it leave the app?',
    sections: [
      {
        id: 'feasibility',
        title: 'Check feasibility',
        body: 'The advisor scores a card against the current machine and explains, in plain language, anything that will snag: too-long floats, impossible transfers, bridges that will fall. Fix issues one at a time from the report.',
        try: [{ label: 'Check feasibility', run: 'command:machine.feasibility' }]
      },
      {
        id: 'universe',
        title: 'The machine universe',
        body: 'Compare one design across every supported machine — Brother, Silver Reed, and more — and see which carriages and gauges can run it. "Tune to fit all" adjusts the card so it is valid on every machine at once.',
        try: [
          { label: 'Open the universe', run: 'command:machine.universe' },
          { label: 'Tune to fit every machine', run: 'command:machine.fitAll' },
          { label: 'Pick a machine', run: 'command:machine.pick' }
        ]
      },
      {
        id: 'export',
        title: 'Export & CAM',
        body: 'A finished card leaves as G-code for CNC, DXF for CAD, vector SVG, APL/DAK format and more, with a QR/link share for everything else.',
        try: [
          { label: 'Export', run: 'command:file.export' },
          { label: 'Go to the CNC tab', run: 'tab:cnc' }
        ]
      }
    ]
  },
  {
    id: 'heritage',
    title: 'Heritage & the people of cloth',
    glyph: '\u{1F9F5}',
    blurb: 'The weavers, designers and looms behind every structure.',
    sections: [
      {
        id: 'browser',
        title: 'The heritage browser',
        body: 'A CAD that knows geometry but not lineage is a calculator wearing overalls. The heritage dock catalogs weave structures, loom taxonomy, the great designers and weavers, tools, regional traditions and the fiber-arts fundamentals — and drops any woven structure straight onto your card.',
        try: [{ label: 'Open the heritage browser', run: 'command:design.heritage' }]
      },
      {
        id: 'weavers',
        title: 'Famous weavers, in their own story',
        body: 'The celebrated weavers — Anni Albers, Gunta St\u00F6lzl, Ethel Mairet, Dorothy Liebes and the rest — each carry a short biography and a shelf of signature patterns you can import to the editor with one click, then make your own.',
        try: [{ label: 'Meet the weavers', run: 'command:design.heritage' }]
      }
    ]
  },
  {
    id: 'files',
    title: 'Projects, files & sharing',
    glyph: '\u{1F4C1}',
    blurb: 'Where your work lives and how it travels.',
    sections: [
      {
        id: 'projects',
        title: 'Projects & checkpoints',
        body: 'Cards autosave to your browser. The project dashboard lists recent work; snapshots are named checkpoints you can return to; backups and restore cover the whole library.',
        try: [
          { label: 'Project dashboard', run: 'command:project.dashboard' },
          { label: 'Snapshot this card', run: 'command:project.snapshot' }
        ]
      },
      {
        id: 'share',
        title: 'Share as a link',
        body: 'The whole card packs into the URL, so a share link opens the exact design on someone else\u2019s machine — and a QR code prints it for a friend.',
        tip: 'A hard reload (Ctrl+Shift+R) always fetches the freshest build of the app itself.',
        try: [{ label: 'Export / share', run: 'command:file.export' }]
      }
    ]
  },
  {
    id: 'power',
    title: 'Power tools',
    glyph: '\u26A1',
    blurb: 'Palette, shortcuts, console and theme.',
    sections: [
      {
        id: 'palette',
        title: 'The command palette',
        body: 'Ctrl+K opens a searchable palette over every command, tool, mode, preset and surface in the app. If you can name it, you can jump to it without hunting for an icon.',
        try: [{ label: 'Open the palette', run: 'command:help.search' }]
      },
      {
        id: 'shortcuts',
        title: 'Keyboard shortcuts',
        body: 'Standard edit chords (Ctrl+Z / Ctrl+Shift+Z, Ctrl+C/V, Delete), tool single-key selectors, and view toggles. The card lists them all.',
        try: [
          { label: 'Show shortcuts', run: 'command:help.shortcuts' },
          { label: 'Open the console', run: 'command:view.console' }
        ]
      },
      {
        id: 'chrome',
        title: 'Panels, theme & layout',
        body: 'Inspector, structure and systems docks, a light/dark theme, and a "reset panels" that untangles any windows you have dragged out of reach.',
        try: [
          { label: 'Toggle theme', run: 'command:view.theme' },
          { label: 'Reset panel layout', run: 'command:view.resetPanels' },
          { label: 'Preferences', run: 'command:file.prefs' }
        ]
      }
    ]
  }
];

/* ─────────────────────────────────────────────────────────────────────────────
 * Pure queries — the panel renders through these, the tests assert against them.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Every section across every chapter, flattened, each tagged with its chapter id. */
export function allSections() {
  const out = [];
  for (const ch of GUIDE_CHAPTERS) {
    for (const s of ch.sections) out.push({ ...s, chapterId: ch.id, chapterTitle: ch.title });
  }
  return out;
}

/** Look one section up by its (globally unique) id. @returns {GuideSection|undefined} */
export function sectionById(id) {
  return allSections().find(s => s.id === id);
}

/** Look a chapter up by id. @returns {GuideChapter|undefined} */
export function chapterById(id) {
  return GUIDE_CHAPTERS.find(c => c.id === id);
}

/**
 * Collect every link target the handbook references, split by kind, so the test suite
 * can prove none of them are dead. A `run` of the form `command:x`/`tab:y` is parsed;
 * anything malformed is reported in `bad` so it can never silently render a no-op.
 * @returns {{commands:string[], tabs:string[], bad:string[]}}
 */
export function collectGuideLinks() {
  const commands = new Set();
  const tabs = new Set();
  const bad = [];
  for (const s of allSections()) {
    for (const link of s.try || []) {
      const run = String(link.run || '');
      if (run.startsWith('command:')) commands.add(run.slice('command:'.length));
      else if (run.startsWith('tab:')) tabs.add(run.slice('tab:'.length));
      else bad.push(run || '(empty)');
    }
  }
  return { commands: [...commands], tabs: [...tabs], bad };
}

/**
 * Case-insensitive search across chapter titles and section bodies.
 * @param {string} query
 * @returns {{section:GuideSection, chapter:GuideChapter}[]} best-effort matches
 */
export function searchGuide(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const chapter of GUIDE_CHAPTERS) {
    for (const section of chapter.sections) {
      const hay = [chapter.title, section.title, section.body, (section.steps || []).join(' '), section.tip || '']
        .join(' ')
        .toLowerCase();
      if (hay.includes(q)) hits.push({ section, chapter });
    }
  }
  return hits;
}

/** Counts the guide rail can show at a glance. */
export function guideStats() {
  const flat = allSections();
  return {
    chapters: GUIDE_CHAPTERS.length,
    sections: flat.length,
    withSteps: flat.filter(s => s.steps && s.steps.length).length,
    deepLinks: collectGuideLinks().commands.length + collectGuideLinks().tabs.length
  };
}
