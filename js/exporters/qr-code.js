/**
 * A QR code encoder, written from the geometry rather than a library.
 *
 * Why hand-roll it: KNITCAT has no dependencies and no build step, and a QR code
 * is exactly the kind of thing a static site should be able to make on its own —
 * it is a grid of squares and some error-correction arithmetic over GF(256).
 *
 * Scope, and the honesty that comes with it: byte mode (ISO/IEC 18004 §6.4.2,
 * which carries every UTF-8 character a pattern URL needs) at error-correction
 * level L, versions 1–5, i.e. up to 106 bytes. That comfortably covers a share
 * link for a normal card. Rather than risk a half-verified lookup table for the
 * higher versions, larger payloads are *refused* with a message saying so, and
 * the caller falls back to "copy the link" or ".kcard file".
 *
 * The five (version, L) capacity triples below — total codewords, data codewords,
 * EC codewords, one block each — are the part of the standard that must be exact:
 *   v1  26 = 19 + 7      v2  44 = 34 + 10     v3  70 = 55 + 15
 *   v4 100 = 80 + 20     v5 134 = 108 + 26
 * They are cross-checked in the test suite by dividing the finished codeword
 * polynomial by the Reed–Solomon generator: a correct code has zero remainder.
 */

const ECC_L_CAPACITIES = {
  1: { total: 26, data: 19, ec: 7 },
  2: { total: 44, data: 34, ec: 10 },
  3: { total: 70, data: 55, ec: 15 },
  4: { total: 100, data: 80, ec: 20 },
  5: { total: 134, data: 108, ec: 26 }
};

/** Error-correction indicator bits: L is 01 in the 15-bit format information. */
const ECC_L_INDIATOR = 0b01;
const FORMAT_MASK = 0b101010000010010; // 0x5412, per ISO 18004 §6.3.3
const BCH_GENERATOR = 0b10100110111;   // 0x537, the (15,5) format generator

// ─── GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D) ──────────

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Monic generator polynomial of degree `degree`, coefficients in descending order. */
export function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return Uint8Array.from(poly);
}

/** Remainder of `data` divided by the generator — the EC codewords. */
export function rsRemainder(data, generator) {
  const degree = generator.length - 1;
  const rem = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[degree - 1] = 0;
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(generator[i + 1], factor);
  }
  return rem;
}

// ─── segment building ─────────────────────────────────────────────────────────

export function utf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text));
  // Node also has TextEncoder; this branch exists so the module never hard-fails.
  const out = [];
  const encoded = unescape(encodeURIComponent(String(text)));
  for (let i = 0; i < encoded.length; i++) out.push(encoded.charCodeAt(i) & 0xff);
  return Uint8Array.from(out);
}

/** How many UTF-8 bytes fit in a version at level L (byte mode, 8-bit count). */
export function byteCapacity(version) {
  const table = ECC_L_CAPACITIES[version];
  if (!table) return 0;
  // 4 bits mode + 8 bits count, and a 4-bit terminator only if there is room.
  return Math.floor((table.data * 8 - 12) / 8);
}

export function pickVersion(byteLength) {
  for (const key of Object.keys(ECC_L_CAPACITIES)) {
    const version = Number(key);
    if (byteLength <= byteCapacity(version)) return version;
  }
  return null;
}

function buildCodewords(bytes, version) {
  const table = ECC_L_CAPACITIES[version];
  const bits = [];
  const push = (value, width) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);        // byte mode
  push(bytes.length, 8);  // versions 1–9 use an 8-bit character count
  for (const b of bytes) push(b, 8);

  const capacityBits = table.data * 8;
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(table.data);
  for (let i = 0; i < bits.length; i++) {
    data[i >> 3] = (data[i >> 3] << 1) | bits[i];
  }
  // Pad bytes alternate 0xEC, 0x11 until the data block is full.
  for (let i = bits.length / 8, toggle = 0; i < table.data; i++, toggle ^= 1) {
    data[i] = toggle ? 0x11 : 0xec;
  }

  const generator = rsGenerator(table.ec);
  const ec = rsRemainder(data, generator);
  // One block for every version supported here, so no interleaving is needed.
  const all = new Uint8Array(table.total);
  all.set(data, 0);
  all.set(ec, table.data);
  return all;
}

// ─── matrix construction ──────────────────────────────────────────────────────

function setGrid(size) {
  return {
    modules: Array.from({ length: size }, () => new Uint8Array(size)),
    isFunction: Array.from({ length: size }, () => new Uint8Array(size))
  };
}

function placeFinder(grid, size, row, col) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const r = row + dy;
      const c = col + dx;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      grid.modules[r][c] = dist !== 2 && dist !== 4 ? 1 : 0;
      grid.isFunction[r][c] = 1;
    }
  }
}

function placeAlignment(grid, size, row, col) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      grid.modules[row + dy][col + dx] = dist !== 1 ? 1 : 0;
      grid.isFunction[row + dy][col + dx] = 1;
    }
  }
}

function placeFunctionPatterns(grid, size, version) {
  // Timing patterns along row 6 and column 6, alternating from a dark module.
  for (let i = 0; i < size; i++) {
    grid.modules[6][i] = i % 2 === 0 ? 1 : 0;
    grid.isFunction[6][i] = 1;
    grid.modules[i][6] = i % 2 === 0 ? 1 : 0;
    grid.isFunction[i][6] = 1;
  }
  placeFinder(grid, size, 3, 3);
  placeFinder(grid, size, 3, size - 4);
  placeFinder(grid, size, size - 4, 3);

  if (version >= 2) {
    // Versions 2–6 have exactly one alignment pattern, away from the finders.
    const centre = version * 4 + 10;
    placeAlignment(grid, size, centre, centre);
  }

  // Reserve the format-information areas (the real bits are written last).
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      grid.isFunction[8][i] = 1;
      grid.isFunction[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    grid.isFunction[8][size - 1 - i] = 1;
    grid.isFunction[size - 1 - i][8] = 1;
  }
  grid.isFunction[8][8] = 1;
  grid.isFunction[size - 8][8] = 1; // the permanently dark module
}

function placeDataBits(grid, size, codewords) {
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // step over the vertical timing pattern
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (grid.isFunction[row][col]) continue;
        if (index >= codewords.length * 8) {
          grid.modules[row][col] = 0; // remainder bits are zero, by the standard
          continue;
        }
        const bit = (codewords[index >> 3] >> (7 - (index & 7))) & 1;
        grid.modules[row][col] = bit;
        index++;
      }
    }
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

export function formatBits(mask) {
  const data = (ECC_L_INDIATOR << 3) | (mask & 0b111);
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * BCH_GENERATOR);
  return ((data << 10) | rem) ^ FORMAT_MASK;
}

function placeFormatBits(grid, size, mask) {
  const bits = formatBits(mask);
  const bitAt = i => (bits >> i) & 1;
  for (let i = 0; i <= 5; i++) grid.modules[i][8] = bitAt(i);
  grid.modules[7][8] = bitAt(6);
  grid.modules[8][8] = bitAt(7);
  grid.modules[8][7] = bitAt(8);
  for (let i = 9; i < 15; i++) grid.modules[8][14 - i] = bitAt(i);
  // Second copy: bits 0–7 up the bottom-right edge of row 8, bits 8–14 down
  // column 8, exactly as ISO 18004 Figure 25 lays them out.
  for (let i = 0; i < 8; i++) grid.modules[8][size - 1 - i] = bitAt(i);
  for (let i = 8; i < 15; i++) grid.modules[size - 15 + i][8] = bitAt(i);
  grid.modules[size - 8][8] = 1; // the dark module, at row 4·version+9, column 8
}

/** The four penalty rules of ISO 18004 §7.3.1, summed. */
export function penaltyScore(modules, size) {
  let score = 0;

  // Rule 1: runs of five or more identical modules in each row and column.
  for (let line = 0; line < size; line++) {
    for (const dir of [0, 1]) {
      let run = 1;
      for (let i = 1; i < size; i++) {
        const prev = dir === 0 ? modules[line][i - 1] : modules[i - 1][line];
        const here = dir === 0 ? modules[line][i] : modules[i][line];
        if (here === prev) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Rule 2: 2×2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const value = modules[r][c];
      if (value === modules[r][c + 1] && value === modules[r + 1][c] && value === modules[r + 1][c + 1]) score += 3;
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with a four-light-module flank.
  const PATTERN_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const PATTERN_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (line, start, pattern) => pattern.every((v, i) => line[start + i] === v);
  for (let line = 0; line < size; line++) {
    const row = modules[line];
    const col = modules.map(r => r[line]);
    for (let i = 0; i + 11 <= size; i++) {
      if (matches(row, i, PATTERN_A) || matches(row, i, PATTERN_B)) score += 40;
      if (matches(col, i, PATTERN_A) || matches(col, i, PATTERN_B)) score += 40;
    }
  }

  // Rule 4: how far the dark proportion is from 50%.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += modules[r][c] ? 1 : 0;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * Encode text into a QR matrix.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.mask]     force a mask 0–7 (the default is the standard
 *                                    penalty choice, and this exists for debugging)
 * @param {number} [options.minVersion]
 * @returns {{ok: boolean, error?: string, size?: number, modules?: number[][],
 *            version?: number, mask?: number, bytes?: number}}
 */
export function encodeQr(text, options = {}) {
  const bytes = utf8Bytes(text);
  const version = pickVersion(bytes.length);
  if (!version) {
    return {
      ok: false,
      bytes: bytes.length,
      error: `That is ${bytes.length} bytes, and a QR code here holds ${byteCapacity(5)} bytes. Copy the link text instead, or save a .kcard file.`
    };
  }
  if (options.minVersion && options.minVersion > version) {
    return { ok: false, error: `Needs at least version ${options.minVersion}, which this encoder does not draw.` };
  }

  const codewords = buildCodewords(bytes, version);
  const size = version * 4 + 17;
  const base = setGrid(size);
  placeFunctionPatterns(base, size, version);
  placeDataBits(base, size, codewords);

  let best = null;
  const candidates = Number.isInteger(options.mask) ? [Math.min(Math.max(options.mask, 0), 7)] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const mask of candidates) {
    const grid = {
      modules: base.modules.map(row => Uint8Array.from(row)),
      isFunction: base.isFunction
    };
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!grid.isFunction[r][c] && MASKS[mask](r, c)) {
          grid.modules[r][c] ^= 1;
        }
      }
    }
    placeFormatBits(grid, size, mask);
    const score = penaltyScore(grid.modules, size);
    if (!best || score < best.score) {
      best = { score, mask, modules: grid.modules.map(row => Array.from(row)) };
    }
  }

  return {
    ok: true,
    size,
    version,
    mask: best.mask,
    bytes: bytes.length,
    modules: best.modules,
    codewords
  };
}

// ─── rendering ────────────────────────────────────────────────────────────────

/**
 * Standalone SVG, with named groups so a print workflow (LightBurn, Inkscape,
 * Illustrator) can select the quiet zone, the background and the modules
 * separately instead of fighting one anonymous path.
 */
export function qrToSvg(qr, options = {}) {
  const scale = options.scale ?? 4;
  const margin = options.margin ?? 4;
  const dark = options.dark || '#0b1020';
  const light = options.light || '#ffffff';
  const edge = (qr.size + margin * 2) * scale;
  const rects = [];
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (!qr.modules[r][c]) continue;
      rects.push(`<rect x="${(c + margin) * scale}" y="${(r + margin) * scale}" width="${scale}" height="${scale}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${edge}" height="${edge}" viewBox="0 0 ${edge} ${edge}" shape-rendering="crispEdges" role="img" aria-label="${(options.label || 'QR code').replace(/"/g, '&quot;')}">
<g id="quiet-zone" inkscape:label="Quiet zone"><rect width="${edge}" height="${edge}" fill="${light}"/></g>
<g id="qr-modules" inkscape:label="QR modules" fill="${dark}">${rects.join('')}</g>
</svg>`;
}

/** Paint into a 2D canvas — used for the on-screen code and the camera self-test. */
export function drawQrToCanvas(canvas, qr, options = {}) {
  if (!canvas || !canvas.getContext) return false;
  const scale = options.scale ?? 6;
  const margin = options.margin ?? 4;
  const edge = (qr.size + margin * 2) * scale;
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.fillStyle = options.light || '#ffffff';
  ctx.fillRect(0, 0, edge, edge);
  ctx.fillStyle = options.dark || '#0b1020';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (!qr.modules[r][c]) continue;
      ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
    }
  }
  return true;
}
