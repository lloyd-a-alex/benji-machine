/**
 * Realistic Physical Yarn & Knitted Fabric Simulator
 * 
 * Renders relaxed 3D yarn loops using the KnitTopologyNetwork physics engine:
 * - Real-time elastica curve spline generation
 * - Fiber sheen, loop shadows, and specular highlights
 * - Interactive tension relaxation
 * - Authentic eyelet aperture opening and directional transfer leaning
 */

import { KnitTopologyNetwork, catmullRomSpline, Vec3 } from '../math/knit-topology.js';

export class YarnSimulator {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    this.rows = options.rows || 24;
    this.cols = options.cols || 24;
    this.topology = new KnitTopologyNetwork(this.rows, this.cols, 22, 18);

    this.yarnColorMain = options.yarnColorMain || '#f8fafc';    // Soft off-white / pink
    this.yarnColorContrast = options.yarnColorContrast || '#38bdf8'; // Electric blue / rose
    this.yarnThickness = 4.2; // pixels
    this.yarnTension = 1.0;

    // Viewport
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.isMouseDown = false;
    this.lastMouse = { x: 0, y: 0 };

    this.animating = true;
    this.animFrameId = null;

    this.setupEvents();
    this.resize();
    this.startAnimationLoop();
  }

  updateFabric(stitchMatrix, colorMatrix = null) {
    if (!stitchMatrix || stitchMatrix.length === 0) return;
    try {
      this.rows = stitchMatrix.length;
      this.cols = stitchMatrix[0]?.length || 24;
      this.topology = new KnitTopologyNetwork(this.rows, this.cols, 22, 18);
      this.topology.buildFromStitchMatrix(stitchMatrix, colorMatrix);

      // Warm-up relaxation physics (run 25 initial integration steps)
      for (let i = 0; i < 25; i++) {
        this.topology.stepPhysics(6, 0.016, 0.90);
      }

      this.centerFabric();
    } catch (err) {
      console.warn('[YarnSimulator] updateFabric caught error:', err);
    }
  }

  setYarnColors(main, contrast) {
    if (main) this.yarnColorMain = main;
    if (contrast) this.yarnColorContrast = contrast;
  }

  setTension(tensionFactor) {
    this.yarnTension = Math.max(0.2, Math.min(3.0, tensionFactor));
    if (this.topology && this.topology.constraints) {
      for (const c of this.topology.constraints) {
        c.stiffness = 0.85 * this.yarnTension;
      }
    }
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
    const loop = () => {
      if (this.animating) {
        // Continuous micro-relaxation step
        this.topology.stepPhysics(2, 0.016, 0.94);
        this.render();
      }
      this.animFrameId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    try {
      // Subtle background woven texture grid
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
        // Generate 3D loop curves from topology
        const geometries = this.topology.generateDetailedYarnGeometry();

        if (geometries && geometries.length > 0) {
          // Sort loops by depth (Z-buffer painter's algorithm)
          geometries.sort((a, b) => {
            const midA = Math.floor(a.points.length / 2);
            const midB = Math.floor(b.points.length / 2);
            const zA = a.points[midA]?.z || 0;
            const zB = b.points[midB]?.z || 0;
            return zA - zB;
          });

          // Render each yarn loop with shaded strand rendering
          for (const geom of geometries) {
            this.renderYarnStrand(ctx, geom);
          }
        }
      }
    } catch (err) {
      console.warn('[YarnSimulator] render error:', err);
    } finally {
      ctx.restore();
    }
  }

  renderYarnStrand(ctx, geom) {
    const pts = geom.points;
    if (!pts || pts.length < 2) return;

    const baseColor = (geom.colorIndex === 1) ? this.yarnColorContrast : this.yarnColorMain;
    const strokeWidth = this.yarnThickness;

    // Evaluate smooth Catmull-Rom spline points
    const smoothPoints = [];
    const numSubdivisions = 8;

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      for (let s = 0; s < numSubdivisions; s++) {
        const t = s / numSubdivisions;
        smoothPoints.push(catmullRomSpline(p0, p1, p2, p3, t));
      }
    }
    smoothPoints.push(pts[pts.length - 1]);

    // 1. Cast drop-shadow for 3D depth
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = strokeWidth + 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < smoothPoints.length; i++) {
      const p = smoothPoints[i];
      // Invert Y because canvas Y increases downwards
      const sx = p.x;
      const sy = -p.y + 2.5;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // 2. Base yarn strand body
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    for (let i = 0; i < smoothPoints.length; i++) {
      const p = smoothPoints[i];
      const sx = p.x;
      const sy = -p.y;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // 3. Specular yarn fiber luster / highlight
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = strokeWidth * 0.35;
    ctx.beginPath();
    for (let i = 0; i < smoothPoints.length; i++) {
      const p = smoothPoints[i];
      const sx = p.x - 0.6;
      const sy = -p.y - 0.8;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }
}
