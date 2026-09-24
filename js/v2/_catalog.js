/**
 * KNITCAT V2 — the shared catalog (leaf module; imported by both the facade and the panels).
 *
 * These three constants are referenced at *module-evaluation time* by `js/v2/panels.js` (it builds
 * the panel map and its in-dock switch as soon as it loads) *and* by `js/v2/index.js`. If they lived in
 * the facade, the panels→facade→panels import cycle would put them in the temporal dead zone when
 * the panels evaluate, crashing the whole V2 layer at boot. Hoisting only saves function
 * declarations, not `const`/template data — so the shared, eagerly-needed literals live here, in a
 * module with no V2 imports of its own, breaking the cycle cleanly.
 *
 * DOM-free, dependency-free.
 *
 * @module v2/_catalog
 */

/** The build stamp of the whole V2 layer, surfaced in diagnostics and the About panel. */
export const V2_VERSION = '2.0.0';

/** A friendly, complete KnitScript a first-time user can edit — the "New project" starting point. */
export const DEFAULT_KNITSCRIPT = [
  `project "My First Sweater" {`,
  `  body: measurements {`,
  `    system: custom`,
  `    bust: 96cm`,
  `    waist: 82cm`,
  `    hip: 100cm`,
  `    upperArm: 32cm`,
  `    shoulderWidth: 42cm`,
  `    neck: 38cm`,
  `    easePreference: relaxed`,
  `  }`,
  `  gauge {`,
  `    stitchesPer10cm: 22`,
  `    rowsPer10cm: 30`,
  `  }`,
  `  yarn "main": {`,
  `    weight: dk`,
  `    color: "#3b6ea5"`,
  `  }`,
  `  machine: "brother_standard_24" { }`,
  `  garment {`,
  `    construction: bottom-up-raglan`,
  `    length: 62cm`,
  `  }`,
  `}`
].join('\n');

/**
 * The six systems, in switch order. Shared by the menu, the command palette and the panel dock so
 * all three surfaces describe the same systems with the same ids and can never drift.
 */
export const V2_SYSTEM_CATALOG = [
  { id: 'project', label: 'Project · KnitScript', glyph: '📝', hint: 'The single source of truth — edit the .knit, watch everything ripple.' },
  { id: 'fit', label: 'Fit Engine', glyph: '📐', hint: 'A garment drafted to a real body, in every construction.' },
  { id: 'yarn', label: 'Yarn Lab', glyph: '🧶', hint: 'Stash, substitution, gauge, colour and cost.' },
  { id: 'compiler', label: 'Compiler V2', glyph: '⚙️', hint: 'One pattern → chart, written, machine, punchcard, DXF, G-code, tech-pack.' },
  { id: 'reverse', label: 'Reverse Engineer', glyph: '📷', hint: 'Copy that sweater from a photo — FFT gauge, construction, back to KnitScript.' },
  { id: 'production', label: 'Production', glyph: '💼', hint: 'Cost, batch, orders, inventory, QC and pricing for knitters who sell.' }
];
