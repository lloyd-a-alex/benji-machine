# Antigravity KnitCAD: Industrial Knitting Machine CAD/CAM & Lace Decompiler

An industrial-grade, browser-native Computer-Aided Design (CAD) and Computer-Aided Manufacturing (CAM) suite for vintage, modern, and CNC-driven knitting machines.

---

## 1. Overview & Core Architecture

Domestic and industrial punchcard knitting machines (Brother, Silver Reed / Studio / Singer, Passap, Toyota) operate by mechanical needle selection via punched card drums or pushers. While standard Fair Isle (jacquard colorwork), Tuck, and Slip stitches follow a 1:1 correspondence between punchcard rows and knitted yarn passes, **machine lace knitting is fundamentally more complex**:

1. **Directional Transfer Cam Kinematics**:
   Lace carriages (such as the Brother LC-2) have directional transfer points. A carriage stroke moving **Left-to-Right ($L \to R$)** can only transfer stitches in the direction of carriage velocity (i.e. to the **Right**, needle $i \to i+1$), while a stroke moving **Right-to-Left ($R \to L$)** can only transfer stitches to the **Left** ($i \to i-1$).
2. **Transfer Collision & Race Conditions**:
   If two adjacent stitches transfer simultaneously or if multiple transfers stack (such as centered double decreases, cables, or multi-stitch eyelet mesh), they cannot occur on the same carriage pass without dropping loops or crashing mechanical transfer cams.
3. **Brother Fashion Lace vs. Simple Lace Separation**:
   On Brother machines, the Lace Carriage (L) does not feed yarn; it only performs transfers. Once transfer passes are complete, the user knits 2 plain rows using the Main Knit Carriage (K) to anchor the eyelets and create new loops. The punchcard must encode both active transfer passes and blank rows for plain knitting.

**Antigravity KnitCAD solves this via an automated Directed Acyclic Graph (DAG) Lace Decompiler and Scheduler**, transforming high-level stitch design charts into physically feasible carriage passes, hole bitmasks, laser-cut DXF files, and CNC G-Code programs.

---

## 2. Mathematical Modeling & Foundations

### 2.1 Discrete Knitwear Topology
We formalize knitted textiles as an oriented graph of topological yarn loops:
$$\mathcal{G} = (V, E, \Sigma)$$
- **Vertices $V$**: Needle interlooping nodes $(r, c, \tau)$ where $r$ is row, $c$ is needle column, and $\tau \in \{\text{Knit}, \text{Purl}, \text{Eyelet}, \text{Transfer Left}, \text{Transfer Right}, \text{Centered Double Decrease}, \text{Tuck}, \text{Slip}\}$.
- **Edges $E$**: Continuous yarn strand segments connecting loop heads, legs, and feet.
- **Crossing Sign Matrix $\Sigma$**: Knot-theoretical Gauss codes specifying over- and under-crossings.

### 2.2 Euler-Bernoulli Elastica Relaxation & Strain Minimization
Physical yarn deformation is simulated using continuous 3D Catmull-Rom splines governed by Euler-Bernoulli elastica bending energy minimization:
$$E_{\text{strain}} = \int_0^L \left( \frac{1}{2} B \kappa(s)^2 + \frac{1}{2} C \tau(s)^2 \right) ds$$
where $\kappa(s)$ is spline curvature, $\tau(s)$ is torsional twist, and $B, C$ are flexural and torsional rigidities.
The simulation engine executes a real-time Verlet integration physics loop:
$$\mathbf{x}_{n+1} = \mathbf{x}_n + (\mathbf{x}_n - \mathbf{x}_{n-1}) \cdot \gamma + \frac{\mathbf{F}_{\text{net}}}{m} \Delta t^2$$
subject to iterative Jacobi distance constraints, accurately rendering how eyelet apertures dilate and draw neighboring wales together.

### 2.3 Reaction-Diffusion Morphogenesis PDEs
Algorithmic biological lace textures are synthesized using the Gray-Scott reaction-diffusion system solved on a discrete toroidal domain with a 9-point Laplacian convolution stencil:
$$\frac{\partial u}{\partial t} = D_u \nabla^2 u - u v^2 + F(1 - u)$$
$$\frac{\partial v}{\partial t} = D_v \nabla^2 v + u v^2 - (F + k)v$$

### 2.4 Toolpath Optimization (2-Opt TSP Heuristic)
When punching or laser-cutting hundreds of punchcard holes, non-cutting rapid traversals dominate machining time. The CAM post-processor solves the Traveling Salesperson Problem (TSP) over all hole coordinates $(x_i, y_i)$:
$$\min \sum_{i=1}^{N-1} \|\mathbf{p}_{\pi(i+1)} - \mathbf{p}_{\pi(i)}\|_2$$
using an initial greedy nearest-neighbor tour followed by 2-Opt local search edge reversals.

---

## 3. Supported Machines & Physical Profiles

| Machine System | Gauge | Needle Pitch ($P_x$) | Row Pitch ($P_y$) | Hole Dia | Sprocket Dia | Carriage Mechanics |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Brother Standard 24** | 4.5 mm | 4.50 mm | 5.08 mm (0.2") | 3.2 mm | 3.5 mm | Separated L-Carriage & K-Carriage |
| **Silver Reed Standard 24** | 4.5 mm | 4.50 mm | 5.00 mm | 3.2 mm | 3.6 mm | Combined LC Transfer & Knit |
| **Passap Duo 80 / E6000** | 5.0 mm | 5.00 mm | 5.00 mm | 2.8 mm | 3.2 mm | Dual-bed pushers (40-stitch) |
| **Brother Bulky 24** | 9.0 mm | 9.00 mm | 6.50 mm | 4.2 mm | 4.5 mm | Heavy gauge 24-stitch |
| **Toyota Standard 24** | 4.5 mm | 4.50 mm | 5.08 mm | 3.2 mm | 3.5 mm | Simplex carriage system |
| **Custom Parametric** | Any | Parametric | Parametric | Custom | Custom | DIY / experimental CNC punch |

---

## 4. Export Formats

1. **AutoCAD DXF (ASCII Release 12)**:
   - Specification-compliant DXF ready for LightBurn, Glowforge, Trotec, and CAD software.
   - Organized into distinct CAM layers:
     - `CUT_HOLES` (Red, Color 1): Stitch punch holes.
     - `CUT_SPROCKETS` (Yellow, Color 2): Tractor feed holes.
     - `CUT_OUTLINE` (Green, Color 3): Perimeter card boundary cut.
     - `ENGRAVE_TEXT` (Blue, Color 5): Row and column markers.
     - `ALIGN_MARKS` (Cyan, Color 4): Centerlines and overlap alignment marks.
2. **CNC G-Code (`.gcode` / `.nc`)**:
   - Compatible with GRBL, Marlin, Mach3/4, and LinuxCNC.
   - Configurable modes: **Laser Cutter** (`M03`/`M05` power pulses), **Mechanical Solenoid Punch** (`M64`/`M65` actuator trigger with dwell), and **CNC Drill Press** (`G81` drill cycles).
3. **1:1 Scale Multi-Page Printable PDF / Vector Sheets**:
   - Automatically tiles punchcard strips onto standard A4 or US-Letter pages.
   - Includes overlap margins, alignment crosses, and a **50.0 mm calibration test ruler** to ensure exact 100% scale output without printer distortion.
4. **Electronic Formats**:
   - **DesignaKnit (`.pat`)**: Textile CAD chart data.
   - **Binary Bitstream (`.bin`)**: Packed raw bits for Arduino, AYAB, Knitic, and Brother KH-930 floppy emulators.
   - **CSV / ASCII Matrix**: Human-readable punchcard data.
   - **KnitCAD Project (`.kcard`)**: Complete JSON project snapshot.

---

## 5. Getting Started

Simply open `index.html` in any modern web browser (Google Chrome, Mozilla Firefox, Microsoft Edge, or Safari). No build tools, package managers, or server installations are required.
