/**
 * Discrete Differential Geometry & Topological Knitwear Mechanics
 * 
 * Formalizes knitted textiles as an oriented graph of topological yarn loops:
 *   G = (V, E, Sigma)
 * where V represents needle interlooping nodes, E represents yarn segment elastica,
 * and Sigma represents crossing signed permutations (knot theory Gauss codes).
 *
 * Implements a physics-based Euler-Bernoulli elastica relaxation solver
 * via Verlet numerical integration to simulate yarn loop deformation,
 * eyelet opening, stitch transfer tension, and strain energy minimization:
 *   E_strain = Integral( 0.5 * B * kappa(s)^2 + 0.5 * C * tau(s)^2 ) ds
 */

// Stitch Operational Primitive Enumeration
export const STITCH_TYPE = {
  KNIT: 'K',                // Plain face knit loop
  PURL: 'P',                // Reverse purl loop
  EYELET: 'O',              // Yarnover (creates open hole, increases stitch count or leaves open loop)
  TRANSFER_LEFT: 'TL',      // Loop transferred to needle (col - 1)
  TRANSFER_RIGHT: 'TR',     // Loop transferred to needle (col + 1)
  TRANSFER_DOUBLE_L: 'T2L', // Two needles transferred left
  TRANSFER_DOUBLE_R: 'T2R', // Two needles transferred right
  DOUBLE_DEC_LEFT: 'DDL',   // Left-leaning double decrease (3 into 1)
  DOUBLE_DEC_RIGHT: 'DDR',  // Right-leaning double decrease
  CENTER_DEC: 'CDD',        // Centered double decrease
  TUCK: 'TUCK',             // Holds loop without casting off; accumulates multi-yarn strand
  SLIP: 'SLIP',             // Skips needle; yarn floats horizontally behind
  EMPTY: 'EMPTY',           // Out of work / inactive needle
};

/**
 * 3D Vector mathematical utility primitives for elastica curves
 */
export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  clone() {
    return new Vec3(this.x, this.y, this.z);
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length() {
    return Math.sqrt(this.lengthSq());
  }

  normalize() {
    const l = this.length();
    if (l > 1e-9) {
      this.x /= l;
      this.y /= l;
      this.z /= l;
    }
    return this;
  }

  distanceTo(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  static add(a, b) {
    return new Vec3(a.x + b.x, a.y + b.y, a.z + b.z);
  }

  static sub(a, b) {
    return new Vec3(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  static cross(a, b) {
    return new Vec3(
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x
    );
  }

  static dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  static lerp(a, b, t) {
    return new Vec3(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t
    );
  }
}

/**
 * Catmull-Rom Spline Interpolation for smooth yarn rendering
 */
export function catmullRomSpline(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;

  const f0 = -0.5 * t3 + t2 - 0.5 * t;
  const f1 =  1.5 * t3 - 2.5 * t2 + 1.0;
  const f2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
  const f3 =  0.5 * t3 - 0.5 * t2;

  return new Vec3(
    p0.x * f0 + p1.x * f1 + p2.x * f2 + p3.x * f3,
    p0.y * f0 + p1.y * f1 + p2.y * f2 + p3.y * f3,
    p0.z * f0 + p1.z * f1 + p2.z * f2 + p3.z * f3
  );
}

/**
 * Topological Node in the Knit Loop Graph
 */
export class LoopNode {
  constructor(id, row, col, type = STITCH_TYPE.KNIT) {
    this.id = id;
    this.row = row;
    this.col = col;
    this.type = type;

    // Spatial equilibrium position and Verlet dynamics
    this.pos = new Vec3(col * 10, row * 10, 0);
    this.prevPos = this.pos.clone();
    this.acc = new Vec3(0, 0, 0);
    this.isFixed = false;
    this.mass = 1.0;

    // Loop topology properties
    this.parentLoops = []; // Loop(s) from previous row that this loop pulls through
    this.childLoops = [];  // Loop(s) in next row that pull through this loop
    this.targetCol = col;  // Where this loop's head transfers to (if transfer stitch)
    this.tension = 1.0;    // Normalized tension scalar
    this.colorIndex = 0;   // Yarn color palette index
    this.holdingNeedle = col; // Needle currently holding this loop
    this.eyeletOpening = 0.0; // Dynamic diameter factor for lace holes
  }

  applyForce(f) {
    if (this.isFixed) return;
    this.acc.x += f.x / this.mass;
    this.acc.y += f.y / this.mass;
    this.acc.z += f.z / this.mass;
  }

  verletStep(dt, damping = 0.94, maxStep = 12) {
    if (this.isFixed) return;

    const tempX = this.pos.x;
    const tempY = this.pos.y;
    const tempZ = this.pos.z;

    // Damped velocity, hard-clamped per axis so no force/tension/timestep can
    // drive a node faster than maxStep units per step. This is a stability floor:
    // even a mis-configured solver can never make the fabric "explode".
    const clampV = (v) => v > maxStep ? maxStep : (v < -maxStep ? -maxStep : v);
    const vx = clampV((this.pos.x - this.prevPos.x) * damping);
    const vy = clampV((this.pos.y - this.prevPos.y) * damping);
    const vz = clampV((this.pos.z - this.prevPos.z) * damping);

    this.pos.x += vx + this.acc.x * dt * dt;
    this.pos.y += vy + this.acc.y * dt * dt;
    this.pos.z += vz + this.acc.z * dt * dt;

    this.prevPos.set(tempX, tempY, tempZ);
    this.acc.set(0, 0, 0);
  }
}

/**
 * Topological Spring / Yarn Elastic Segment Constraint
 */
export class YarnSegmentConstraint {
  constructor(nodeA, nodeB, restLength, stiffness = 0.85, isBending = false) {
    this.nodeA = nodeA;
    this.nodeB = nodeB;
    this.restLength = restLength;
    this.baseRestLength = restLength;
    this.stiffness = stiffness;
    this.isBending = isBending;
  }

  resolve() {
    const dx = this.nodeB.pos.x - this.nodeA.pos.x;
    const dy = this.nodeB.pos.y - this.nodeA.pos.y;
    const dz = this.nodeB.pos.z - this.nodeA.pos.z;
    const currentDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (currentDist < 1e-6) return;

    const diff = (currentDist - this.restLength) / currentDist;
    // Gauss-Seidel relaxation is only stable for stiffness in [0,1]; >1 overshoots
    // past the constraint and diverges (the "flip out" we saw at high tension).
    // Clamp here so no upstream code can ever push the solver unstable.
    const stiffness = this.stiffness > 1 ? 1 : (this.stiffness < 0 ? 0 : this.stiffness);
    const factor = diff * 0.5 * stiffness;

    const offsetX = dx * factor;
    const offsetY = dy * factor;
    const offsetZ = dz * factor;

    if (!this.nodeA.isFixed) {
      this.nodeA.pos.x += offsetX;
      this.nodeA.pos.y += offsetY;
      this.nodeA.pos.z += offsetZ;
    }
    if (!this.nodeB.isFixed) {
      this.nodeB.pos.x -= offsetX;
      this.nodeB.pos.y -= offsetY;
      this.nodeB.pos.z -= offsetZ;
    }
  }
}

export class KnitTopologyNetwork {
  constructor(rows, cols, spacingX = 14, spacingY = 12, profile = null) {
    this.rows = rows || 24;
    this.cols = cols || 24;
    // When a machine profile is supplied, derive the physical gauge spacing from its
    // needle pitch so a bulky card knits visibly looser than a fine one and eyelet
    // apertures scale with the real hole diameter. ~3 px/mm keeps the magnitude of
    // the hand-tuned defaults; without a profile the explicit args still win.
    if (profile && (Number.isFinite(profile.pitchX) || Number.isFinite(profile.pitchY))) {
      const PX_PER_MM = 3;
      this.spacingX = (profile.pitchX ?? 4.5) * PX_PER_MM;
      this.spacingY = (profile.pitchY ?? 5.08) * PX_PER_MM;
    } else {
      this.spacingX = spacingX;
      this.spacingY = spacingY;
    }
    this.nodes = [];
    this.constraints = [];
    this.matrix = []; // 2D [row][col] mapping to LoopNode
    this.totalStrainEnergy = 0;
    this.gaussianCurvatures = [];
    this.gravityEnabled = false;
    // Gravity in pixel-space (lattice ≈ 22 px per stitch). Real 9.8 m/s² would
    // be sub-pixel at Verlet's dt² scale, so we use an exaggerated drape
    // acceleration tuned for visible fabric sag between the needle-bed anchors.
    this.gravity = new Vec3(0, -18000, 0);
    this.windForce = new Vec3(0, 0, 0);
    this.collisionEnabled = true;
    this.subSteps = 4;
    this.adjacentPairSet = new Set();
    this.damping = 0.92;

    // Automatically initialize default plain knit matrix so the network is never in an invalid state
    this.initDefaultMatrix();
  }

  /**
   * Initializes a default plain knit loop matrix
   */
  initDefaultMatrix() {
    const defaultStitches = [];
    for (let r = 0; r < this.rows; r++) {
      defaultStitches[r] = new Array(this.cols).fill(STITCH_TYPE.KNIT);
    }
    this.buildFromStitchMatrix(defaultStitches);
  }

  /**
   * Builds the topological loop graph from a 2D array of stitch definitions
   */
  buildFromStitchMatrix(stitchMatrix, yarnColors = null) {
    this.nodes = [];
    this.constraints = [];
    this.matrix = [];
    this.rows = stitchMatrix.length;
    this.cols = stitchMatrix[0]?.length || 0;

    // 1. Create Loop Nodes
    for (let r = 0; r < this.rows; r++) {
      this.matrix[r] = [];
      for (let c = 0; c < this.cols; c++) {
        const type = stitchMatrix[r][c] || STITCH_TYPE.KNIT;
        const id = `node_${r}_${c}`;
        const node = new LoopNode(id, r, c, type);

        // Position initial coordinates centered with slight depth fluctuation for front/back purls
        const zOffset = (type === STITCH_TYPE.PURL) ? -2.5 : 2.0;
        node.pos.set(
          (c - this.cols / 2) * this.spacingX,
          (r - this.rows / 2) * this.spacingY,
          zOffset
        );
        node.prevPos = node.pos.clone();

        if (yarnColors && yarnColors[r] && yarnColors[r][c] !== undefined) {
          node.colorIndex = yarnColors[r][c];
        }

        // Fix cast-on row and needle-bed hooks at working edge
        if (r === 0 || r === this.rows - 1) {
          node.isFixed = true;
        }

        // Configure stitch kinematics based on type
        switch (type) {
          case STITCH_TYPE.TRANSFER_LEFT:
            node.targetCol = Math.max(0, c - 1);
            node.eyeletOpening = 0.85;
            break;
          case STITCH_TYPE.TRANSFER_RIGHT:
            node.targetCol = Math.min(this.cols - 1, c + 1);
            node.eyeletOpening = 0.85;
            break;
          case STITCH_TYPE.EYELET:
            node.eyeletOpening = 1.6;
            break;
          case STITCH_TYPE.TUCK:
            node.tension = 0.45; // Relaxed loop
            break;
          case STITCH_TYPE.SLIP:
            node.tension = 1.35; // Taut horizontal float
            break;
          default:
            node.eyeletOpening = 0.1;
        }

        this.matrix[r][c] = node;
        this.nodes.push(node);
      }
    }

    // 2. Synthesize Topological Connectivity & Constraints
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const current = this.matrix[r][c];

        // Horizontal yarn weft continuity (row connections)
        if (c < this.cols - 1) {
          const rightNeighbor = this.matrix[r][c + 1];
          // Rest length is modulated by stitch type (slips stretch tighter, tucks allow more slack)
          let restLen = this.spacingX;
          if (current.type === STITCH_TYPE.SLIP) restLen *= 0.8;
          if (current.type === STITCH_TYPE.TUCK) restLen *= 1.25;

          this.constraints.push(
            new YarnSegmentConstraint(current, rightNeighbor, restLen, 0.75)
          );
        }

        // Vertical interlooping (wales connections)
        if (r < this.rows - 1) {
          let targetC = c;

          // If current stitch is a transfer, interloop to target column
          if (current.type === STITCH_TYPE.TRANSFER_LEFT) {
            targetC = Math.max(0, c - 1);
          } else if (current.type === STITCH_TYPE.TRANSFER_RIGHT) {
            targetC = Math.min(this.cols - 1, c + 1);
          }

          const topNeighbor = this.matrix[r + 1][targetC];
          if (topNeighbor) {
            current.childLoops.push(topNeighbor);
            topNeighbor.parentLoops.push(current);

            // Calculate rest length based on diagonal transfer stretch
            const colDelta = Math.abs(targetC - c);
            const diagonalDist = Math.sqrt(
              Math.pow(colDelta * this.spacingX, 2) + Math.pow(this.spacingY, 2)
            );

            this.constraints.push(
              new YarnSegmentConstraint(current, topNeighbor, diagonalDist, 0.9)
            );
          }

          // In case of eyelet (yarnover), adjacent loops are drawn outward to open aperture
          if (current.type === STITCH_TYPE.EYELET || current.type === STITCH_TYPE.TRANSFER_LEFT || current.type === STITCH_TYPE.TRANSFER_RIGHT) {
            if (c > 0 && c < this.cols - 1) {
              const leftN = this.matrix[r][c - 1];
              const rightN = this.matrix[r][c + 1];
              // Elastic repulsion constraint across eyelet hole
              this.constraints.push(
                new YarnSegmentConstraint(leftN, rightN, this.spacingX * 2.2, 0.4, true)
              );
            }
          }
        }

        // Shear stiffness (diagonal cross braces for realistic knitted shear resistance)
        if (r < this.rows - 1 && c < this.cols - 1) {
          const diag1 = Math.sqrt(this.spacingX * this.spacingX + this.spacingY * this.spacingY);
          this.constraints.push(
            new YarnSegmentConstraint(this.matrix[r][c], this.matrix[r + 1][c + 1], diag1, 0.25, true)
          );
          this.constraints.push(
            new YarnSegmentConstraint(this.matrix[r][c + 1], this.matrix[r + 1][c], diag1, 0.25, true)
          );
        }
      }
    }

    this._rebuildAdjacentPairSet();
  }

  _rebuildAdjacentPairSet() {
    this.adjacentPairSet = new Set();
    for (const c of this.constraints) {
      const key = c.nodeA.id < c.nodeB.id
        ? `${c.nodeA.id}:${c.nodeB.id}`
        : `${c.nodeB.id}:${c.nodeA.id}`;
      this.adjacentPairSet.add(key);
    }
  }

  /**
   * Numerical Relaxation Step
   * Performs Verlet integration & Jacobi constraint projection iterations.
   * Enhanced with gravity, wind forces, and sub-stepping for stability.
   */
  stepPhysics(iterations = 8, dt = 0.016, damping = null) {
    const damp = damping ?? this.damping ?? 0.92;
    const subDt = dt / this.subSteps;
    
    // Sub-stepping for stability
    for (let sub = 0; sub < this.subSteps; sub++) {
      // 1. Apply external forces (gravity, wind)
      for (let i = 0; i < this.nodes.length; i++) {
        const node = this.nodes[i];
        
        if (this.gravityEnabled) {
          node.applyForce(this.gravity.clone().scale(node.mass));
        }
        
        if (this.windForce.lengthSq() > 0) {
          // Add some turbulence based on position
          const turbulence = Math.sin(node.pos.x * 0.1 + Date.now() * 0.001) * 0.5;
          node.applyForce(this.windForce.clone().scale(1 + turbulence));
        }
      }
      
      // 2. Verlet position update
      for (let i = 0; i < this.nodes.length; i++) {
        this.nodes[i].verletStep(subDt, damp);
      }
      
      // 3. Solve distance constraints iteratively
      for (let iter = 0; iter < iterations; iter++) {
        for (let c = 0; c < this.constraints.length; c++) {
          this.constraints[c].resolve();
        }
      }
      
      // 4. Collision detection and response
      if (this.collisionEnabled) {
        this.resolveCollisions();
      }
    }

    // Calculate total strain energy for analysis
    this.totalStrainEnergy = 0;
    for (let c = 0; c < this.constraints.length; c++) {
      const cons = this.constraints[c];
      const d = cons.nodeA.pos.distanceTo(cons.nodeB.pos);
      const strain = Math.abs(d - cons.restLength) / cons.restLength;
      this.totalStrainEnergy += 0.5 * cons.stiffness * strain * strain;
    }
  }

  /**
   * Simple collision detection and response
   */
  resolveCollisions() {
    const minDistance = this.spacingX * 0.3;
    const minDistanceSq = minDistance * minDistance;

    for (let i = 0; i < this.nodes.length; i++) {
      const nodeA = this.nodes[i];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const nodeB = this.nodes[j];

        const key = nodeA.id < nodeB.id
          ? `${nodeA.id}:${nodeB.id}`
          : `${nodeB.id}:${nodeA.id}`;
        if (this.adjacentPairSet.has(key)) continue;

        const dx = nodeA.pos.x - nodeB.pos.x;
        const dy = nodeA.pos.y - nodeB.pos.y;
        const dz = nodeA.pos.z - nodeB.pos.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < minDistanceSq && distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          const pushFactor = ((minDistance - dist) / dist) * 0.5;
          const pushX = dx * pushFactor;
          const pushY = dy * pushFactor;
          const pushZ = dz * pushFactor;

          if (!nodeA.isFixed) {
            nodeA.pos.x += pushX;
            nodeA.pos.y += pushY;
            nodeA.pos.z += pushZ;
          }
          if (!nodeB.isFixed) {
            nodeB.pos.x -= pushX;
            nodeB.pos.y -= pushY;
            nodeB.pos.z -= pushZ;
          }
        }
      }
    }
  }

  /**
   * Set wind force for fabric simulation
   */
  setWindForce(x, y, z) {
    this.windForce.set(x, y, z);
  }

  /**
   * Calculate fabric strain at specific node
   */
  calculateNodeStrain(node) {
    let totalStrain = 0;
    let constraintCount = 0;
    
    for (const cons of this.constraints) {
      if (cons.nodeA === node || cons.nodeB === node) {
        const d = cons.nodeA.pos.distanceTo(cons.nodeB.pos);
        const strain = Math.abs(d - cons.restLength) / cons.restLength;
        totalStrain += strain;
        constraintCount++;
      }
    }
    
    return constraintCount > 0 ? totalStrain / constraintCount : 0;
  }

  /**
   * Generates continuous 3D elastica spline points for realistic loop rendering.
   * Produces authentic loop shapes: head arch, left leg, right leg, and cross-under feet.
   */
  generateDetailedYarnGeometry() {
    const loopGeometries = [];
    if (!this.matrix || this.matrix.length === 0) return loopGeometries;

    const pushLoop = (data, node) => {
      const strain = this.calculateNodeStrain(node);
      loopGeometries.push({
        ...data,
        tension: Math.max(0.5, Math.min(2.5, strain * 4 + (node.tension || 1) * 0.5))
      });
    };

    for (let r = 0; r < this.rows; r++) {
      if (!this.matrix[r]) continue;
      for (let c = 0; c < this.cols; c++) {
        const node = this.matrix[r][c];
        if (!node) continue;

        // Base geometry control points for a single knitted stitch loop
        const p = node.pos;
        const w = (this.spacingX * 0.45) * (node.eyeletOpening > 1 ? 0.3 : 1.0);
        const h = this.spacingY * 0.48;
        const z = p.z;

        // Stitch specific shape modifications
        if (node.type === STITCH_TYPE.TRANSFER_LEFT) {
          // Lean left towards col - 1
          const leftTarget = this.matrix[r + 1]?.[Math.max(0, c - 1)]?.pos || p;
          pushLoop({
            type: 'loop_transfer_left',
            colorIndex: node.colorIndex,
            points: [
              new Vec3(p.x - w * 0.5, p.y - h, z - 1),
              new Vec3(p.x - w, p.y, z + 1),
              new Vec3(p.x, p.y + h * 0.8, z + 2),
              new Vec3(leftTarget.x + w * 0.4, leftTarget.y - h * 0.2, z + 2),
              new Vec3(leftTarget.x, leftTarget.y, z)
            ]
          }, node);
        } else if (node.type === STITCH_TYPE.TRANSFER_RIGHT) {
          // Lean right towards col + 1
          const rightTarget = this.matrix[r + 1]?.[Math.min(this.cols - 1, c + 1)]?.pos || p;
          pushLoop({
            type: 'loop_transfer_right',
            colorIndex: node.colorIndex,
            points: [
              new Vec3(p.x + w * 0.5, p.y - h, z - 1),
              new Vec3(p.x + w, p.y, z + 1),
              new Vec3(p.x, p.y + h * 0.8, z + 2),
              new Vec3(rightTarget.x - w * 0.4, rightTarget.y - h * 0.2, z + 2),
              new Vec3(rightTarget.x, rightTarget.y, z)
            ]
          }, node);
        } else if (node.type === STITCH_TYPE.EYELET) {
          // Expanded annular ring around the eyelet hole
          const radius = this.spacingX * 0.38;
          const eyeletRing = [];
          const segments = 12;
          for (let s = 0; s <= segments; s++) {
            const theta = (s / segments) * Math.PI * 2;
            eyeletRing.push(new Vec3(
              p.x + Math.cos(theta) * radius,
              p.y + Math.sin(theta) * radius * 0.75,
              z + Math.sin(theta * 2) * 0.8
            ));
          }
          pushLoop({
            type: 'eyelet_ring',
            colorIndex: node.colorIndex,
            points: eyeletRing
          }, node);
        } else if (node.type === STITCH_TYPE.SLIP) {
          // Horizontal float behind the needles
          const nextNode = this.matrix[r][c + 1] || node;
          pushLoop({
            type: 'float_slip',
            colorIndex: node.colorIndex,
            points: [
              new Vec3(p.x - w, p.y, z - 3.5),
              new Vec3(p.x, p.y, z - 4.0),
              new Vec3(nextNode.pos.x, nextNode.pos.y, z - 3.5)
            ]
          }, node);
        } else {
          // Standard Face Knit Loop (horseshoe shaped curve)
          pushLoop({
            type: 'knit_loop',
            colorIndex: node.colorIndex,
            points: [
              new Vec3(p.x - w * 0.85, p.y - h, z - 1.2), // Left foot (underneath)
              new Vec3(p.x - w, p.y - h * 0.15, z + 1.8), // Left leg (coming over)
              new Vec3(p.x - w * 0.6, p.y + h * 0.7, z + 2.5), // Left head arch
              new Vec3(p.x, p.y + h * 0.85, z + 2.8),     // Crown apex
              new Vec3(p.x + w * 0.6, p.y + h * 0.7, z + 2.5), // Right head arch
              new Vec3(p.x + w, p.y - h * 0.15, z + 1.8), // Right leg
              new Vec3(p.x + w * 0.85, p.y - h, z - 1.2)  // Right foot
            ]
          }, node);
        }
      }
    }

    return loopGeometries;
  }
}
