#!/usr/bin/env node
/**
 * Renders the PNG icons a real PWA install needs, from the same geometry as
 * favicon.svg.
 *
 * Why generated and committed rather than "just use the SVG": Chrome will
 * install from an SVG manifest icon, iOS will not — it wants a square PNG at
 * 180×180 — and Android needs 192 and 512 to pick a density-aware one. Shipping
 * an SVG alone is how you end up with a desktop shortcut and a blank tile on the
 * phone that half the audience is holding.
 *
 * There is deliberately no image library here: this repo has zero runtime
 * dependencies and CI does not have one either, so the rasteriser and the PNG
 * encoder are written out below. Run it whenever favicon.svg changes:
 *
 *     node scripts/generate-icons.mjs
 */

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ─── The brand mark, in the favicon's 32×32 coordinate space ──────────────────
const ART = {
  size: 32,
  background: '#0f172a',
  stroke: '#38bdf8',
  dot: '#f8fafc',
  cornerRadius: 6,
  strokeWidth: 2.6,
  // M7 22 c… C… s… C…   — the two yarn arches, flattened to polylines below.
  curves: [
    [{ x: 7, y: 22 }, { x: 7, y: 16 }, { x: 11, y: 16 }, { x: 11.5, y: 11.5 }],
    [{ x: 11.5, y: 11.5 }, { x: 11.8, y: 8 }, { x: 14, y: 7.5 }, { x: 16, y: 7.5 }],
    // `s` mirrors the previous control point through the current one.
    [{ x: 16, y: 7.5 }, { x: 18, y: 7.5 }, { x: 20.2, y: 8 }, { x: 20.5, y: 11.5 }],
    [{ x: 20.5, y: 11.5 }, { x: 21, y: 16 }, { x: 25, y: 16 }, { x: 25, y: 22 }]
  ],
  dotCentre: { x: 16, y: 24 },
  dotRadius: 2.2
};

// ─── Tiny raster with signed-distance antialiasing ────────────────────────────
const hexToRgb = hex => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
];

class Raster {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  /** Source-over a colour with coverage `a` (0..1) at integer pixel x,y. */
  blend(x, y, [r, g, b], a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const da = this.data[i + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    this.data[i] = (r * a + this.data[i] * da * (1 - a)) / oa;
    this.data[i + 1] = (g * a + this.data[i + 1] * da * (1 - a)) / oa;
    this.data[i + 2] = (b * a + this.data[i + 2] * da * (1 - a)) / oa;
    this.data[i + 3] = oa * 255;
  }

  /** Paint every pixel whose signed distance to `sd` is within half a pixel. */
  paint(sd, rgb) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const d = sd(x + 0.5, y + 0.5);
        if (d < 0.5) this.blend(x, y, rgb, Math.max(0, Math.min(1, 0.5 - d)));
      }
    }
  }
}

const sdRoundRect = (cx, cy, hw, hh, r) => (px, py) => {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), -r);
};

const sdDisc = (cx, cy, radius) => (px, py) => Math.hypot(px - cx, py - cy) - radius;

/** Flatten a cubic bézier into a polyline; 48 slices is invisible at 512px. */
function flattenCubic([p0, p1, p2, p3], slices = 48) {
  const out = [];
  for (let i = 0; i <= slices; i++) {
    const t = i / slices;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
    });
  }
  return out;
}

/**
 * Stroke a polyline by splatting antialiased discs along it — which is exactly
 * what a round-capped SVG stroke is, and cheap enough to do without a renderer.
 */
function strokePath(raster, points, widthPx, rgb) {
  const radius = widthPx / 2;
  const stamp = (cx, cy) => {
    const x0 = Math.floor(cx - radius - 1);
    const x1 = Math.ceil(cx + radius + 1);
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius;
        if (d < 0.5) raster.blend(x, y, rgb, Math.max(0, Math.min(1, 0.5 - d)));
      }
    }
  };
  stamp(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(length / (radius * 0.5)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
  }
}

/**
 * @param {number} size square edge in pixels
 * @param {object} [options]
 *   bleed: fill the whole square (maskable / Apple tiles get no rounded corners)
 *   scale: art scale, so a maskable icon can sit inside the 80% safe zone
 */
function renderIcon(size, options = {}) {
  const { bleed = false, scale = 1 } = options;
  const raster = new Raster(size, size);
  const s = (size / ART.size) * scale;
  const offset = (size - ART.size * s) / 2;
  const toPx = p => ({ x: offset + p.x * s, y: offset + p.y * s });
  const bg = hexToRgb(ART.background);

  raster.paint(
    bleed
      ? () => -1
      : sdRoundRect(size / 2, size / 2, size / 2, size / 2, ART.cornerRadius * (size / ART.size)),
    bg
  );

  const stroke = hexToRgb(ART.stroke);
  for (const curve of ART.curves) {
    strokePath(raster, flattenCubic(curve).map(toPx), ART.strokeWidth * s, stroke);
  }
  const dot = toPx(ART.dotCentre);
  raster.paint(sdDisc(dot.x, dot.y, ART.dotRadius * s), hexToRgb(ART.dot));

  return raster;
}

// ─── Minimal PNG encoder (8-bit RGBA, no interlace, filter 0 per scanline) ─────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, tail]);
}

function encodePng(raster) {
  const { width, height, data } = raster;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: None
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const TARGETS = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  // Maskable: full-bleed background, art shrunk into the circular safe zone.
  ['icon-maskable-512.png', 512, { bleed: true, scale: 0.66 }],
  // iOS refuses to round an SVG; it wants this file at exactly 180×180.
  ['apple-touch-icon.png', 180, { bleed: true }]
];

let report = '';
for (const [name, size, options] of TARGETS) {
  const png = encodePng(renderIcon(size, options));
  writeFileSync(join(ROOT, name), png);
  report += `${name}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB\n`;
}
process.stdout.write(report);
