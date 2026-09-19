/**
 * Realistic Physical Yarn & Knitted Fabric Simulator
 */

import { KnitTopologyNetwork, STITCH_TYPE } from '../math/knit-topology.js';

export class YarnSimulator {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    this.rows = options.rows || 24;
    this.cols = options.cols || 24;
    this.topology = new KnitTopologyNetwork(this.rows, this.cols, 22, 18);
    this.topology.collisionEnabled = false;

    this.yarnColorMain = options.yarnColorMain || '#f8fafc';
    this.yarnColorContrast = options.yarnColorContrast || '#38bdf8';
    this.yarnThickness = 4.2;
    this.yarnTension = 1.0;
    this.viewMode = 'shaded';
    this.materialProfile = {
      name: 'cotton',
      stiffness: 0.98,
      restMultiplier: 0.95,
      damping: 0.82
    };

    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.isMouseDown = false;
    this.lastMouse = { x: 0, y: 0 };

    this.animating = true;
    this.animFrameId = null;
    this.prevStrainEnergy = Infinity;
    this.energySleepThreshold = 1e-4;

    this.setupEvents();
    this.resize();
  }

  updateFabric(stitchMatrix, colorMatrix = null) {
    if (!stitchMatrix || stitchMatrix.length === 0) return;
    const t0 = performance.now();
    try {
      this.rows = stitchMatrix.length;
      this.cols = stitchMatrix[0]?.length || 24;
      this.topology = new KnitTopologyNetwork(this.rows, this.cols, 22, 18);
      this.topology.buildFromStitchMatrix(stitchMatrix, colorMatrix);
      this.applyMaterialProfile(this.materialProfile);

      // Fast Jacobi warm-up without quadratic collision passes
      this.topology.collisionEnabled = false;
      for (let i = 0; i < 6; i++) {
        this.topology.stepPhysics(3, 0.016, this.topology.damping);
      }

      this.prevStrainEnergy = this.topology.totalStrainEnergy;
      this.animating = true;
      this.centerFabric();
      this.render();
      console.log(`[KnitCAD][Yarn] updateFabric completed in ${Math.round(performance.now() - t0)}ms (${this.rows}×${this.cols})`);
    } catch (err) {
      console.error('[KnitCAD][Yarn] updateFabric error:', err);
    }
  }

  applyMaterialProfile(profile) {
    if (!profile || !this.topology?.constraints) return;
    this.materialProfile = { ...this.materialProfile, ...profile };
    this.topology.damping = this.materialProfile.damping;
    for (const c of this.topology.constraints) {
      if (c.baseRestLength == null) c.baseRestLength = c.restLength;
      c.stiffness = this.materialProfile.stiffness * this.yarnTension;
      c.restLength = c.baseRestLength * this.materialProfile.restMultiplier;
    }
  }

  setYarnColors(main, contrast) {
    if (main) this.yarnColorMain = main;
    if (contrast) this.yarnColorContrast = contrast;
  }

  setTension(tensionFactor) {
    this.yarnTension = Math.max(0.2, Math.min(3.0, tensionFactor));
    this.applyMaterialProfile(this.materialProfile);
    this.animating = true;
  }

  resetMounting() {
    if (!this.topology?.matrix) return;
    const topo = this.topology;

    for (let r = 0; r < topo.rows; r++) {
      for (let c = 0; c < topo.cols; c++) {
        const node = topo.matrix[r][c];
        if (!node) continue;
        const zOffset = (node.type === STITCH_TYPE.PURL) ? -2.5 : 2.0;
        node.pos.set(
          (c - topo.cols / 2) * topo.spacingX,
          (r - topo.rows / 2) * topo.spacingY,
          zOffset
        );
        node.prevPos = node.pos.clone();
        node.acc.set(0, 0, 0);
        node.isFixed = (r === 0 || r === topo.rows - 1);
      }
    }

    topo.totalStrainEnergy = 0;
    this.prevStrainEnergy = 0;
    this.animating = true;
    this.centerFabric();
    console.log('[KnitCAD][Yarn] Fabric mounting reset to needle-bed anchors');
  }

  centerFabric() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.panX = w / 2;
    this.panY = h / 2;
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (parent) {
      this.canvas.width = parent.clientWidth || 800;
      this.canvas.height = parent.clientHeight || 600;
      this.centerFabric();
    }
  }

  setupEvents() {
    this.canvas.addEventListener('mousedown', e => {
      this.animating = true;
      this.isMouseDown = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', e => {
      if (this.isMouseDown) {
        this.panX += e.clientX - this.lastMouse.x;
        this.panY += e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      this.zoom = Math.max(0.3, Math.min(4.0, this.zoom * factor));
    });

    window.addEventListener('resize', () => {
      this.resize();
    });
  }

  startAnimationLoop() {
    if (this.animFrameId) return;
    this.animating = true;
    const loop = () => {
      if (this.animating) {
        this.topology.stepPhysics(1, 0.016, this.topology.damping);
        const energy = this.topology.totalStrainEnergy;
        // Never sleep while gravity is draping the fabric — keep integrating
        if (!this.topology.gravityEnabled &&
            Math.abs(this.prevStrainEnergy - energy) < this.energySleepThreshold) {
          this.animating = false;
        }
        this.prevStrainEnergy = energy;
        this.render();
      }
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    try {
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 0.5;
      const bgSpacing = 30;
      ctx.beginPath();
      for (let x = 0; x < w; x += bgSpacing) {
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
      }
      for (let y = 0; y < h; y += bgSpacing) {
        ctx.moveTo(0, y); ctx.lineTo(w, y);
      }
      ctx.stroke();

      ctx.save();
      ctx.translate(this.panX, this.panY);
      ctx.scale(this.zoom, this.zoom);

      if (this.topology) {
        const geometries = this.topology.generateDetailedYarnGeometry();

        if (geometries && geometries.length > 0) {
          geometries.sort((a, b) => {
            const midA = Math.floor(a.points.length / 2);
            const midB = Math.floor(b.points.length / 2);
            const zA = a.points[midA]?.z || 0;
            const zB = b.points[midB]?.z || 0;
            return zA - zB;
          });

          for (const geom of geometries) {
            this.renderYarnStrand(ctx, geom);
          }
        }
      }
    } catch (err) {
      console.warn('[KnitCAD][Yarn] render error:', err);
    } finally {
      ctx.restore();
    }
  }

  _strokeCatmullRomPath(ctx, pts, yOffset, xOffset = 0) {
    const numSubdivisions = 5;
    ctx.beginPath();
    let started = false;

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      for (let s = 0; s < numSubdivisions; s++) {
        const t = s / numSubdivisions;
        const t2 = t * t;
        const t3 = t2 * t;
        const f0 = -0.5 * t3 + t2 - 0.5 * t;
        const f1 = 1.5 * t3 - 2.5 * t2 + 1.0;
        const f2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
        const f3 = 0.5 * t3 - 0.5 * t2;
        const sx = (p0.x * f0 + p1.x * f1 + p2.x * f2 + p3.x * f3) + xOffset;
        const sy = -(p0.y * f0 + p1.y * f1 + p2.y * f2 + p3.y * f3) + yOffset;
        if (!started) {
          ctx.moveTo(sx, sy);
          started = true;
        } else {
          ctx.lineTo(sx, sy);
        }
      }
    }

    const last = pts[pts.length - 1];
    ctx.lineTo(last.x + xOffset, -last.y + yOffset);
    ctx.stroke();
  }

  renderYarnStrand(ctx, geom) {
    const pts = geom.points;
    if (!pts || pts.length < 2) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (this.viewMode === 'wireframe') {
      ctx.strokeStyle = (geom.colorIndex === 1) ? this.yarnColorContrast : '#94a3b8';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const sx = pts[i].x;
        const sy = -pts[i].y;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      return;
    }

    if (this.viewMode === 'stress') {
      const tension = geom.tension || 1.0;
      const hue = Math.max(0, Math.min(240, 240 - (tension - 0.5) * 160));
      ctx.strokeStyle = `hsl(${hue}, 90%, 55%)`;
      ctx.lineWidth = this.yarnThickness;
      this._strokeCatmullRomPath(ctx, pts, 0);
      return;
    }

    const baseColor = (geom.colorIndex === 1) ? this.yarnColorContrast : this.yarnColorMain;
    const strokeWidth = this.yarnThickness;

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = strokeWidth + 2.5;
    this._strokeCatmullRomPath(ctx, pts, 2.5);

    ctx.strokeStyle = baseColor;
    ctx.lineWidth = strokeWidth;
    this._strokeCatmullRomPath(ctx, pts, 0);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = strokeWidth * 0.35;
    this._strokeCatmullRomPath(ctx, pts, -0.8, -0.6);
  }

  exportObj() {
    const geoms = this.topology?.generateDetailedYarnGeometry?.() || [];
    let obj = '# Benji KnitCAD Yarn Fabric Export\n';
    obj += `# Loops: ${geoms.length}\n`;
    let vertexIndex = 1;

    for (let g = 0; g < geoms.length; g++) {
      const geom = geoms[g];
      const start = vertexIndex;
      for (const p of geom.points) {
        obj += `v ${p.x.toFixed(4)} ${p.y.toFixed(4)} ${p.z.toFixed(4)}\n`;
        vertexIndex++;
      }
      obj += `g loop_${g}_${geom.type || 'strand'}\n`;
      for (let i = 0; i < geom.points.length - 1; i++) {
        obj += `l ${start + i} ${start + i + 1}\n`;
      }
    }

    return obj;
  }
}
