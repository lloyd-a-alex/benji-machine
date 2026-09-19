# KNITCAT — Knitting Machine CAD/CAM, Punchcard Compiler & Lace Decompiler

**Live app: <https://lloyd-a-alex.github.io/benji-machine/>** — free, in the browser, nothing to install.

KNITCAT is a browser-native **knitting machine CAD/CAM studio** for punchcard and electronic knitting machines
(Brother, Silver Reed / Studio / Singer, Passap, Toyota). Draw a stitch chart and it becomes a physically valid
**punchcard**: an automatic **lace decompiler** turns eyelets (yarnovers) and directional **yarn transfer patterns**
into collision-free **carriage passes**, then exports laser-cut **DXF**, CNC **G-code**, DesignaKnit `.pat`, binary
bitstream, CSV and 1:1 printable cards. It is also a small **industrial knitwear design studio** — gauge calculators,
garment tailoring (tank top, beanie, catalogue), a feasibility advisor and a 3D yarn physics preview.

> Written for Benji, who has to sit at the machine and actually knit the thing. ♥

---

## Contents

1. [Why machine lace needs a compiler](#1-why-machine-lace-needs-a-compiler)
2. [Eyelets vs transfers — both make holes, deliberately](#2-eyelets-vs-transfers--both-make-holes-deliberately)
3. [Single bed vs double bed](#3-single-bed-vs-double-bed)
4. [Supported machines & physical profiles](#4-supported-machines--physical-profiles)
5. [Features](#5-features)
6. [Export formats](#6-export-formats)
7. [Mathematical foundations](#7-mathematical-foundations)
8. [Getting started](#8-getting-started)
9. [FAQ](#9-faq)

---

## 1. Why machine lace needs a compiler

Domestic punchcard machines (Brother, Silver Reed / Studio / Singer, Passap, Toyota) select needles mechanically from
a punched card drum or pusher strip. Fair Isle (stranded jacquard), tuck and slip all follow a simple 1:1 rule between
card rows and knitted passes. **Machine lace knitting is fundamentally harder:**

1. **Directional transfer cam kinematics** — a lace carriage such as the Brother LC-2 can only transfer a loop in the
   direction it is travelling. A stroke moving **left → right ($L \to R$)** transfers needle $i \to i+1$; a stroke
   moving **right → left ($R \to L$)** transfers $i \to i-1$.
2. **Transfer collisions & race conditions** — adjacent loops cannot move simultaneously, and stacked transfers
   (centred double decreases, cables, multi-stitch eyelet mesh) cannot share one pass without dropping stitches or
   jamming the transfer cams.
3. **Brother fashion lace separates L and K carriages** — the Lace (L) carriage transfers but feeds no yarn. After the
   transfer passes you must knit plain rows with the Knit (K) carriage to anchor the eyelets and cast new loops. The
   card has to encode both the active transfer rows *and* the blank plain rows.

KNITCAT solves this with an automated **DAG (directed acyclic graph) lace decompiler and scheduler**, turning a
high-level stitch chart into feasible carriage passes, a hole bitmask, the punchcard ribbon, and CNC/laser toolpaths.

## 2. Eyelets vs transfers — both make holes, deliberately

A knitting machine cannot wrap yarn around an empty needle on demand. To make an **eyelet** you must first *empty a
needle*, then knit past it so the yarn bridges the gap. So:

| Chart cell | Carriage action | Stitch count | Look in the cloth |
| :--- | :--- | :--- | :--- |
| **○ Eyelet (yarnover)** | compiled to a one-needle transfer that vacates the needle; the next plain row catches the yarnover | neutral | round hole, no lean |
| **↖ / ↗ Transfer** | slides an existing loop onto the neighbouring needle, in the carriage's travel direction | −1 needle in work | hole that leans — the shaping |
| **∧ Centred double decrease** | two transfers onto the middle needle, split across a L→R and a R→L pass | 3 → 1 | centred eyelet with spokes |
| **\| Plain knit** | K-carriage only (the anchor rows Brother's L-carriage cannot knit) | unchanged | stockinette |

They are **complementary, not redundant**: the eyelet is the *feeder*, the transfer is the *decreaser*. A repeat that
keeps its needle count pairs them — one yarnover per transfer, two per centred double decrease. The in-app
**ⓘ Eyelets vs transfers** panel (Pattern CAD Editor) says the same thing while you draw.

## 3. Single bed vs double bed

KNITCAT schedules **single-bed** machines: Brother KH-830 / KH-836 / KH-881 / KH-890 / KH-892 / KH-894 with an LC-2,
Silver Reed SK-280 / SK-700 / Studio / Singer, Toyota. One needle bed means a transfer can only move a loop to an
*adjacent needle on the same bed*, and only while the carriage travels that way — which is exactly what makes machine
lace a scheduling problem.

A **double-bed** machine (Passap Duo 80 / E6000, or a single-bed machine in ribbing setting with two carriages) moves
loops *between* a front and back bed: loop holding, fisherman's rib, tuck-and-rib, circular knitting, and transfers not
bound to a sideways neighbour. The Passap profile here still produces correct 40-stitch card geometry, pitch and hole
sizes, but its transfer plan is modelled as single-bed. True inter-bed transfers need that machine's own pattern
system. The **Feasibility** check flags the card whenever a two-bed profile is selected, and says what it did not
schedule.

## 4. Supported machines & physical profiles

| Machine system | Gauge | Needle pitch ($P_x$) | Row pitch ($P_y$) | Hole dia | Sprocket dia | Carriage mechanics |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Brother Standard 24** | 4.5 mm | 4.50 mm | 5.08 mm (0.2") | 3.2 mm | 3.5 mm | Separated L-carriage & K-carriage |
| **Silver Reed Standard 24** | 4.5 mm | 4.50 mm | 5.00 mm | 3.2 mm | 3.6 mm | Combined LC transfer & knit |
| **Passap Duo 80 / E6000** | 5.0 mm | 5.00 mm | 5.00 mm | 2.8 mm | 3.2 mm | Dual-bed pushers (40-stitch) |
| **Brother Bulky 24** | 9.0 mm | 9.00 mm | 6.50 mm | 4.2 mm | 4.5 mm | Heavy gauge 24-stitch |
| **Toyota Standard 24** | 4.5 mm | 4.50 mm | 5.08 mm | 3.2 mm | 3.5 mm | Simplex carriage system |
| **Custom parametric** | any | parametric | parametric | custom | custom | DIY / experimental CNC punch |

Each profile also carries its card-reading offset (the drum reads *below* the working needles: 7 rows Brother, 5 rows
Silver Reed), margins, leader/trailer lengths and colour conventions.

## 5. Features

- **Pattern CAD editor** — pencil, eraser, line, rectangle, ellipse, flood fill, marquee select, copy/cut/paste,
  duplicate, rotate, H/V mirror symmetry, heart stamp, undo/redo, pinch-zoom and touch drawing.
- **Lace decompiler & carriage pass schedule** — DAG scheduling, collision detection, automatic idle return passes and
  plain anchor rows, per-pass hole lists.
- **Punchcard ribbon at 1:1 scale** — with sprocket holes, row numbers and repeat marking.
- **3D yarn physics preview** — Verlet-integrated elastica loops that show eyelets opening and floats pulling.
- **Brother KH-830 kinematics simulator** — animated carriage, needle hooks, transfer cams, punchcard reader.
- **CNC toolpath visualiser** — 2-opt optimised drilling/laser order with travel statistics.
- **Tailoring** — tank top CAD, beanie engine (head circumference → cast-on, rib, crown, negative ease) and a garment
  catalogue with gauge-aware instructions.
- **Feasibility advisor** — flags long floats, impossible passes, over-tall cards and offers one-click safe fixes.
- **Generative patterns** — Gray-Scott reaction-diffusion, waves, cellular automata, image dithering
  (Floyd-Steinberg / Atkinson / ordered).
- **Command palette** (`Ctrl`/`⌘`+`K`, or `/`) — jump to any tab, garment, preset or action by typing.

### 5.1 Keyboard shortcuts

Everything is reachable from the keyboard, because nobody wants to let go of the mouse mid-repeat.

| Keys | What happens |
| --- | --- |
| `P` / `B` | Pencil |
| `E` | Eraser |
| `L` | Straight line |
| `R` / `O` | Rectangle, filled / outline |
| `C` / `I` | Ellipse, filled / outline |
| `G` | Flood fill |
| `S` | Marquee select |
| `Ctrl`+`Z` · `U` | Undo |
| `Ctrl`+`Y` · `Ctrl`+`Shift`+`Z` | Redo |
| `Ctrl`+`C` / `X` / `V` | Copy / cut / paste the selection |
| `Ctrl`+`D` | Duplicate the selection, offset by one cell |
| `[` / `]` | Rotate the selection anticlockwise / clockwise |
| `Alt`+`Arrow` | Wrap the whole card one cell — the fastest way to check a repeat's seam |
| `Delete` / `Backspace` | Delete the selection (the card itself is never wiped by a stray key) |
| `Ctrl`/`⌘`+`K` or `/` | Command palette |
| `F` · `+` / `-` · `Space` | CNC tab only: fit to view, zoom, play/pause the toolpath |
| `Esc` | Close the topmost dialog |

## 6. Export formats

1. **AutoCAD DXF (ASCII Release 12)** — for LightBurn, Glowforge, Trotec and any CAM stack, organised into layers:
   `CUT_HOLES`, `CUT_SPROCKETS`, `CUT_OUTLINE`, `ENGRAVE_TEXT`, `ALIGN_MARKS`.
2. **CNC G-code (`.gcode` / `.nc`)** — GRBL, Marlin, Mach3/4, LinuxCNC. Modes: laser (`M03`/`M05` power pulses),
   mechanical solenoid punch (`M64`/`M65` with dwell), drill press (`G81` cycles).
3. **1:1 scale multi-page printable sheets** — tiles punchcard strips onto A4 or US-Letter with overlap margins,
   alignment crosses and a 50.0 mm calibration ruler to prove true scale.
4. **Electronic formats** — DesignaKnit `.pat`, packed binary bitstream `.bin` (Arduino / AYAB / Knitic / Brother floppy
   emulators), CSV/ASCII matrix, and a complete **KNITCAT project `.kcard`** JSON snapshot.

## 7. Mathematical foundations

### 7.1 Discrete knitwear topology

Knitted textiles are formalised as an oriented graph of topological yarn loops $\mathcal{G} = (V, E, \Sigma)$:

- **Vertices $V$** — needle interlooping nodes $(r, c, \tau)$, where $r$ is the row, $c$ the needle column and
  $\tau \in \{\text{Knit}, \text{Purl}, \text{Eyelet}, \text{Transfer Left}, \text{Transfer Right}, \text{Centred Double Decrease}, \text{Tuck}, \text{Slip}\}$.
- **Edges $E$** — continuous yarn strand segments joining loop heads, legs and feet.
- **Crossing sign matrix $\Sigma$** — knot-theoretic Gauss codes for over/under crossings.

### 7.2 Euler-Bernoulli elastica relaxation & strain minimisation

Yarn deformation is simulated with continuous 3D Catmull-Rom splines governed by elastica bending-energy minimisation:

$$E_{\text{strain}} = \int_0^L \left( \tfrac{1}{2} B \kappa(s)^2 + \tfrac{1}{2} C \tau(s)^2 \right) ds$$

where $\kappa(s)$ is spline curvature, $\tau(s)$ torsional twist, and $B, C$ flexural and torsional rigidity. A
real-time Verlet loop integrates the motion:

$$\mathbf{x}_{n+1} = \mathbf{x}_n + (\mathbf{x}_n - \mathbf{x}_{n-1}) \cdot \gamma + \frac{\mathbf{F}_{\text{net}}}{m} \Delta t^2$$

subject to iterative Jacobi distance constraints — which is how eyelet apertures dilate and draw neighbouring wales
in.

### 7.3 Reaction-diffusion morphogenesis

Algorithmic lace textures use the Gray-Scott system solved on a discrete toroidal domain with a 9-point Laplacian
stencil:

$$\frac{\partial u}{\partial t} = D_u \nabla^2 u - u v^2 + F(1 - u)
\qquad
\frac{\partial v}{\partial t} = D_v \nabla^2 v + u v^2 - (F + k)v$$

### 7.4 Toolpath optimisation (2-opt TSP heuristic)

When punching or laser-cutting hundreds of holes, non-cutting rapid traversals dominate machining time. The
post-processor solves the TSP over hole coordinates $\mathbf{p}_i$:

$$\min \sum_{i=1}^{N-1} \|\mathbf{p}_{\pi(i+1)} - \mathbf{p}_{\pi(i)}\|_2$$

with a greedy nearest-neighbour tour followed by 2-opt edge reversals.

## 8. Getting started

Native ES modules are blocked over `file://`, so serve the folder with any static web server:

```bash
node server.js 3000      # zero dependencies — or: npm start
```

Then open **<http://localhost:3000>** in Chrome, Firefox, Edge or Safari. No build step, no package installs.

```bash
npm test                 # 39 zero-dependency unit tests (node --test)
npm run build            # optional local cache-bust; CI stamps ?v=<sha> on deploy
```

Deployed by GitHub Actions (`.github/workflows/pages.yml`): `scripts/bust-cache.mjs` replaces the `__BUILD__`
placeholder and appends `?v=<commit>` to every ES-module import, so a deploy can never serve a stale bundle.

**Layout** — `index.html` (shell + static docs), `css/styles.css` (design system + responsive layers),
`js/math` (topology), `js/compiler` (lace decompiler), `js/machine` (profiles), `js/ui` (canvases),
`js/exporters`, `js/importers`, `js/generators`, `js/tailor`, `js/features` (contained extras), `tests/`.

## 9. FAQ

**Does it work without a knitting machine?**
Yes — everything is in the browser, and the DXF/G-code output is what a laser cutter or CNC punch needs.

**Do I need to install anything?**
No. It is a static site: `index.html` + `css/` + `js/`, no framework, no dependencies, no tracking.

**Can it design DesignaKnit patterns?**
It exports DesignaKnit-compatible `.pat` charts, and imports/exports its own `.kcard` JSON projects.

**Why does my lace card need blank rows?**
Because a Brother L-carriage transfers but does not feed yarn: the plain knit rows anchor the eyelets. KNITCAT inserts
them automatically and shows them on the ribbon.

**Are floats checked?**
Yes — the feasibility advisor measures runs of carried yarn against the selected gauge (7 needles at 4.5 mm, 5 at
chunky) and can catch them for you.

**Is it free / open?**
Source available; see [LICENSE](LICENSE). Made with love for Benji.

---

*Made with infinite love for Benji 💗 — KNITCAT: because a punchcard should fit the machine first time.*
