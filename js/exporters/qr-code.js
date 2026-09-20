/**
 * A QR code encoder, written from the geometry rather than a library.
 *
 * Why hand-roll it: KNITCAT has no dependencies and no build step, and a QR code
 * is exactly the kind of thing a static site should be able to make on its own —
 * it is a grid of squares plus Reed–Solomon error correction over GF(256).
 *
 * Scope: byte mode (ISO/IEC 18004 §6.4.2, which carries every UTF-8 character a
 * pattern URL needs) across ALL versions 1–40 and all four error-correction levels
 * L / M / Q / H. That is up to 2953 bytes at v40-L, so *any* share link fits — a
 * QR code is produced no matter how long the payload, and only a genuinely absurd
 * (> 2953 byte) input is refused. Auto-selection picks the smallest version that
 * fits at the requested level (default L, for maximum capacity).
 *
 * The error-correction block structure (EC codewords per block, the two groups of
 * block counts / data widths) for every version × level is transcribed from the
 * published ISO/IEC 18004 Table — reproduced on thonky.com/qr-code-tutorial/
 * error-correction-table — and is *not* invented. The version-information and
 * alignment-pattern geometry follow the standard too. Correctness is proven in the
 * test suite the way a QR encoder deserves to be: the finished symbol is read back
 * by an independent implementation of the geometry, and the codeword polynomial is
 * divided by each block's Reed–Solomon generator — a valid code has zero remainder.
 */

export const ECC_LEVELS = ['L', 'M', 'Q', 'H'];

// 2-bit format indicators for the four levels (ISO 18004 §6.3.3).
const ECC_INDICATOR = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/**
 * [ecCodewordsPerBlock, group1Blocks, group1DataPerBlock, group2Blocks, group2DataPerBlock]
 * Indexed [version][level]. Group 2 is [0, 0] for most small versions.
 */
const EC_BLOCKS = {
  1: { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
  2: { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
  3: { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
  4: { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
  5: { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6: { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] },
  7: { L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8: { L: [24, 2, 97, 0, 0], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
  9: { L: [30, 2, 116, 0, 0], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] },
  11: { L: [20, 4, 81, 0, 0], M: [30, 1, 50, 4, 51], Q: [28, 4, 22, 4, 23], H: [24, 3, 12, 8, 13] },
  12: { L: [24, 2, 92, 2, 93], M: [22, 6, 36, 2, 37], Q: [26, 4, 20, 6, 21], H: [28, 7, 14, 4, 15] },
  13: { L: [26, 4, 107, 0, 0], M: [22, 8, 37, 1, 38], Q: [24, 8, 20, 4, 21], H: [22, 12, 11, 4, 12] },
  14: { L: [30, 3, 115, 1, 116], M: [24, 4, 40, 5, 41], Q: [20, 11, 16, 5, 17], H: [24, 11, 12, 5, 13] },
  15: { L: [22, 5, 87, 1, 88], M: [24, 5, 41, 5, 42], Q: [30, 5, 24, 7, 25], H: [24, 11, 12, 7, 13] },
  16: { L: [24, 5, 98, 1, 99], M: [28, 7, 45, 3, 46], Q: [24, 15, 19, 2, 20], H: [30, 3, 15, 13, 16] },
  17: { L: [28, 1, 107, 5, 108], M: [28, 10, 46, 1, 47], Q: [28, 1, 22, 15, 23], H: [28, 2, 14, 17, 15] },
  18: { L: [30, 5, 120, 1, 121], M: [26, 9, 43, 4, 44], Q: [28, 17, 22, 1, 23], H: [28, 2, 14, 19, 15] },
  19: { L: [28, 3, 113, 4, 114], M: [26, 3, 44, 11, 45], Q: [26, 17, 21, 4, 22], H: [26, 9, 13, 16, 14] },
  20: { L: [28, 3, 107, 5, 108], M: [26, 3, 41, 13, 42], Q: [30, 15, 24, 5, 25], H: [28, 15, 15, 10, 16] },
  21: { L: [28, 4, 116, 4, 117], M: [26, 17, 42, 0, 0], Q: [28, 17, 22, 6, 23], H: [30, 19, 16, 6, 17] },
  22: { L: [28, 2, 111, 7, 112], M: [28, 17, 46, 0, 0], Q: [30, 7, 24, 16, 25], H: [24, 34, 13, 0, 0] },
  23: { L: [30, 4, 121, 5, 122], M: [28, 4, 47, 14, 48], Q: [30, 11, 24, 14, 25], H: [30, 16, 15, 14, 16] },
  24: { L: [30, 6, 117, 4, 118], M: [28, 6, 45, 14, 46], Q: [30, 11, 24, 16, 25], H: [30, 30, 16, 2, 17] },
  25: { L: [26, 8, 106, 4, 107], M: [28, 8, 47, 13, 48], Q: [30, 7, 24, 22, 25], H: [30, 22, 15, 13, 16] },
  26: { L: [28, 10, 114, 2, 115], M: [28, 19, 46, 4, 47], Q: [28, 28, 22, 6, 23], H: [30, 33, 16, 4, 17] },
  27: { L: [30, 8, 122, 4, 123], M: [28, 22, 45, 3, 46], Q: [30, 8, 23, 26, 24], H: [30, 12, 15, 28, 16] },
  28: { L: [30, 3, 117, 10, 118], M: [28, 3, 45, 23, 46], Q: [30, 4, 24, 31, 25], H: [30, 11, 15, 31, 16] },
  29: { L: [30, 7, 116, 7, 117], M: [28, 21, 45, 7, 46], Q: [30, 1, 23, 37, 24], H: [30, 19, 15, 26, 16] },
  30: { L: [30, 5, 115, 10, 116], M: [28, 19, 47, 10, 48], Q: [30, 15, 24, 25, 25], H: [30, 23, 15, 25, 16] },
  31: { L: [30, 13, 115, 3, 116], M: [28, 2, 46, 29, 47], Q: [30, 42, 24, 1, 25], H: [30, 23, 15, 28, 16] },
  32: { L: [30, 17, 115, 0, 0], M: [28, 10, 46, 23, 47], Q: [30, 10, 24, 35, 25], H: [30, 19, 15, 35, 16] },
  33: { L: [30, 17, 115, 1, 116], M: [28, 14, 46, 21, 47], Q: [30, 29, 24, 19, 25], H: [30, 11, 15, 46, 16] },
  34: { L: [30, 13, 115, 6, 116], M: [28, 14, 46, 23, 47], Q: [30, 44, 24, 7, 25], H: [30, 59, 16, 1, 17] },
  35: { L: [30, 12, 121, 7, 122], M: [28, 12, 47, 26, 48], Q: [30, 39, 24, 14, 25], H: [30, 22, 15, 41, 16] },
  36: { L: [30, 6, 121, 14, 122], M: [28, 6, 47, 34, 48], Q: [30, 46, 24, 10, 25], H: [30, 2, 15, 64, 16] },
  37: { L: [30, 17, 122, 4, 123], M: [28, 29, 46, 14, 47], Q: [30, 49, 24, 10, 25], H: [30, 24, 15, 46, 16] },
  38: { L: [30, 4, 122, 18, 123], M: [28, 13, 46, 32, 47], Q: [30, 48, 24, 14, 25], H: [30, 42, 15, 32, 16] },
  39: { L: [30, 20, 117, 4, 118], M: [28, 40, 47, 7, 48], Q: [30, 43, 24, 22, 25], H: [30, 10, 15, 67, 16] },
  40: { L: [30, 19, 118, 6, 119], M: [28, 18, 47, 31, 48], Q: [30, 34, 24, 34, 25], H: [30, 20, 15, 61, 16] }
};

/**
 * Alignment-pattern centre coordinates per version (ISO 18004 Table E.1). The
 * patterns at the three finder corners are skipped during placement.
 */
const ALIGNMENT_POSITIONS = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66],
  15: [6, 26, 48, 70], 16: [6, 26, 50, 74], 17: [6, 30, 54, 78], 18: [6, 30, 56, 82],
  19: [6, 30, 58, 86], 20: [6, 34, 62, 90], 21: [6, 28, 50, 72, 94], 22: [6, 26, 50, 74, 98],
  23: [6, 30, 54, 78, 102], 24: [6, 28, 54, 80, 106], 25: [6, 32, 58, 84, 110],
  26: [6, 30, 58, 86, 114], 27: [6, 34, 62, 90, 118], 28: [6, 26, 50, 74, 98, 122],
  29: [6, 30, 54, 78, 102, 126], 30: [6, 26, 52, 78, 104, 130], 31: [6, 30, 56, 82, 108, 134],
  32: [6, 34, 60, 86, 112, 138], 33: [6, 30, 58, 86, 114, 142], 34: [6, 34, 62, 90, 118, 146],
  35: [6, 30, 54, 78, 102, 126, 150], 36: [6, 24, 50, 76, 102, 128, 154],
  37: [6, 28, 54, 80, 106, 132, 158], 38: [6, 32, 58, 84, 110, 136, 162],
  39: [6, 26, 54, 82, 110, 138, 166], 40: [6, 30, 58, 86, 114, 142, 170]
};

const FORMAT_MASK = 0b101010000010010; // 0x5412, per ISO 18004 §6.3.3
const BCH_GENERATOR = 0b10100110111; // 0x537, the (15,5) format generator
const VERSION_GENERATOR = 0b1111100100101; // 0x1F25, the (18,6) version generator

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
  const out = [];
  const encoded = unescape(encodeURIComponent(String(text)));
  for (let i = 0; i < encoded.length; i++) out.push(encoded.charCodeAt(i) & 0xff);
  return Uint8Array.from(out);
}

function totalDataCodewords(version, level) {
  const [, g1n, g1d, g2n, g2d] = EC_BLOCKS[version][level];
  return g1n * g1d + g2n * g2d;
}

function totalBlocks(version, level) {
  const [, g1n, , g2n] = EC_BLOCKS[version][level];
  return g1n + g2n;
}

function totalEcCodewords(version, level) {
  const [ec] = EC_BLOCKS[version][level];
  return ec * totalBlocks(version, level);
}

/**
 * The published Reed–Solomon block layout for a version + level, as
 * `[ecCodewordsPerBlock, group1Blocks, group1DataPerBlock, group2Blocks, group2DataPerBlock]`.
 * Exposed so the test suite can de-interleave and divide every block by its
 * generator independently of the encoder's own placement code.
 */
export function ecBlocks(version, level = 'L') {
  const table = EC_BLOCKS[version];
  return table && table[level] ? [...table[level]] : null;
}

/** Total codewords (data + EC) the geometry of a version offers. */
export function totalCodewords(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    modules -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) modules -= 36; // two 18-module version-information blocks
  }
  return Math.floor(modules / 8);
}

/** Character-count field width for byte mode: 8 bits for v1–9, 16 bits above. */
function countBits(version) {
  return version < 10 ? 8 : 16;
}

/** How many UTF-8 bytes fit at a version + level. Defaults to level L (the max). */
export function byteCapacity(version, level = 'L') {
  const table = EC_BLOCKS[version];
  if (!table || !table[level]) return 0;
  const data = totalDataCodewords(version, level);
  return Math.floor((data * 8 - (4 + countBits(version))) / 8);
}

/** Largest byte-mode payload this encoder can carry: v40 at level L. */
export function maxByteCapacity(level = 'L') {
  return byteCapacity(40, level);
}

/** Smallest version whose `level` capacity holds `byteLength`, or null. */
export function pickVersion(byteLength, level = 'L') {
  for (let version = 1; version <= 40; version++) {
    if (byteLength <= byteCapacity(version, level)) return version;
  }
  return null;
}

function buildCodewords(bytes, version, level) {
  const [ec, g1n, g1d, g2n, g2d] = EC_BLOCKS[version][level];
  const data = g1n * g1d + g2n * g2d;

  const bits = [];
  const push = (value, width) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, countBits(version));
  for (const b of bytes) push(b, 8);

  const capacityBits = data * 8;
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(data);
  for (let i = 0; i < bits.length; i++) {
    dataBytes[i >> 3] = (dataBytes[i >> 3] << 1) | bits[i];
  }
  for (let i = bits.length / 8, toggle = 0; i < data; i++, toggle ^= 1) {
    dataBytes[i] = toggle ? 0x11 : 0xec;
  }

  // Split into the standard blocks, then Reed–Solomon each one.
  const blocks = [];
  let offset = 0;
  for (let b = 0; b < g1n + g2n; b++) {
    const width = b < g1n ? g1d : g2d;
    const slice = dataBytes.slice(offset, offset + width);
    offset += width;
    blocks.push({ data: slice, ec: rsRemainder(slice, rsGenerator(ec)) });
  }

  // Interleave: data column-major across blocks, then EC column-major.
  const out = [];
  const maxData = Math.max(g1d, g2d);
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < ec; i++) {
    for (const block of blocks) out.push(block.ec[i]);
  }
  return Uint8Array.from(out);
}

// ─── matrix construction ──────────────────────────────────────────────────────

function setGrid(size) {
  return {
    modules: Array.from({ length: size }, () => new Uint8Array(size)),
    isFunction: Array.from({ length: size }, () => new Uint8Array(size))
  };
}

function set(grid, size, row, col, value) {
  if (row < 0 || row >= size || col < 0 || col >= size) return;
  grid.modules[row][col] = value ? 1 : 0;
  grid.isFunction[row][col] = 1;
}

function placeFinder(grid, size, row, col) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      set(grid, size, row + dy, col + dx, dist !== 2 && dist !== 4 ? 1 : 0);
    }
  }
}

function placeAlignment(grid, size, row, col) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      set(grid, size, row + dy, col + dx, dist !== 1 ? 1 : 0);
    }
  }
}

export function versionInfoBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * VERSION_GENERATOR);
  return (version << 12) | rem; // 18 bits
}

function placeFunctionPatterns(grid, size, version) {
  // Timing patterns along row 6 and column 6, alternating from a dark module.
  for (let i = 0; i < size; i++) {
    set(grid, size, 6, i, i % 2 === 0 ? 1 : 0);
    set(grid, size, i, 6, i % 2 === 0 ? 1 : 0);
  }
  placeFinder(grid, size, 3, 3);
  placeFinder(grid, size, 3, size - 4);
  placeFinder(grid, size, size - 4, 3);

  // Alignment patterns at every centre except the three finder corners.
  const centres = ALIGNMENT_POSITIONS[version] || [];
  const n = centres.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      placeAlignment(grid, size, centres[i], centres[j]);
    }
  }

  // Version information: two 18-module triangles, only for versions 7 and up.
  if (version >= 7) {
    const bits = versionInfoBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(grid, size, a, b, bit);
      set(grid, size, b, a, bit);
    }
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

/** The masked 15-bit format string for a level + mask (defaults to level L). */
export function formatBits(mask, level = 'L') {
  const data = (ECC_INDICATOR[level] << 3) | (mask & 0b111);
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * BCH_GENERATOR);
  return ((data << 10) | rem) ^ FORMAT_MASK;
}

function placeFormatBits(grid, size, mask, level) {
  const bits = formatBits(mask, level);
  const bitAt = i => (bits >> i) & 1;
  for (let i = 0; i <= 5; i++) grid.modules[i][8] = bitAt(i);
  grid.modules[7][8] = bitAt(6);
  grid.modules[8][8] = bitAt(7);
  grid.modules[8][7] = bitAt(8);
  for (let i = 9; i < 15; i++) grid.modules[8][14 - i] = bitAt(i);
  for (let i = 0; i < 8; i++) grid.modules[8][size - 1 - i] = bitAt(i);
  for (let i = 8; i < 15; i++) grid.modules[size - 15 + i][8] = bitAt(i);
  grid.modules[size - 8][8] = 1; // the dark module, at row 4·version+9, column 8
}

/** The four penalty rules of ISO 18004 §7.3.1, summed. */
export function penaltyScore(modules, size) {
  let score = 0;

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

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const value = modules[r][c];
      if (value === modules[r][c + 1] && value === modules[r + 1][c] && value === modules[r + 1][c + 1]) score += 3;
    }
  }

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

  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += modules[r][c] ? 1 : 0;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * Encode text into a QR matrix, picking the smallest fitting version at `level`.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {'L'|'M'|'Q'|'H'} [options.eccLevel='L']  higher levels trade capacity for durability
 * @param {number} [options.mask]     force a mask 0–7 (default: the standard penalty choice)
 * @param {number} [options.minVersion]
 * @returns {{ok: boolean, error?: string, size?: number, modules?: number[][],
 *            version?: number, mask?: number, level?: string, bytes?: number, codewords?: Uint8Array}}
 */
export function encodeQr(text, options = {}) {
  const level = ECC_LEVELS.includes(options.eccLevel) ? options.eccLevel : 'L';
  const bytes = utf8Bytes(text);
  const version = pickVersion(bytes.length, level);
  if (!version) {
    return {
      ok: false,
      bytes: bytes.length,
      level,
      error:
        `That is ${bytes.length} bytes, past the ${maxByteCapacity(level)}-byte ceiling of a QR code at level ${level}. ` +
        'Copy the link text instead, or save a .kcard file.'
    };
  }
  if (options.minVersion && options.minVersion > version) {
    return { ok: false, error: `Needs at least version ${options.minVersion}, larger than the ${version} this payload fits.` };
  }

  const codewords = buildCodewords(bytes, version, level);
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
        if (!grid.isFunction[r][c] && MASKS[mask](r, c)) grid.modules[r][c] ^= 1;
      }
    }
    placeFormatBits(grid, size, mask, level);
    const score = penaltyScore(grid.modules, size);
    if (!best || score < best.score) {
      best = { score, mask, modules: grid.modules.map(row => Array.from(row)) };
    }
  }

  return {
    ok: true,
    size,
    version,
    level,
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
