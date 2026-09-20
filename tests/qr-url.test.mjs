// Share links and QR codes — the two ways a static site hands a pattern over.
//
// The URL codec is verified by round-tripping real charts. The QR encoder is
// verified the way a QR encoder deserves to be: by reading the finished matrix
// back with an *independent* implementation of the symbol geometry, recovering
// the payload, and dividing the codeword polynomial by the Reed–Solomon generator
// to prove the error correction is real rather than decorative.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeCard, decodeCard, packRuns, unpackRuns, toBase64Url, fromBase64Url,
  buildShareUrl, readShareUrl, CODEC_VERSION, PRACTICAL_URL_LIMIT
} from '../js/project/url-state.js';
import {
  encodeQr, byteCapacity, maxByteCapacity, pickVersion, rsGenerator, rsRemainder, formatBits,
  penaltyScore, qrToSvg, utf8Bytes, ecBlocks, totalCodewords, versionInfoBits
} from '../js/exporters/qr-code.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';

// ─── URL state ────────────────────────────────────────────────────────────────

test('a Fair Isle card survives the trip through a link', () => {
  const matrix = [
    [1, 0, 0, 1, 1],
    [0, 0, 0, 0, 0],
    [1, 1, 1, 0, 1]
  ];
  const encoded = encodeCard({ mode: 'fair_isle', profileId: 'brother_standard_24', stitchMatrix: matrix });
  assert.equal(encoded.ok, true);
  assert.ok(encoded.chars < 40, `a 5×3 card should be tiny, got ${encoded.chars}`);
  const decoded = decodeCard(encoded.code);
  assert.equal(decoded.ok, true, decoded.error);
  assert.deepEqual(decoded.card.stitchMatrix, matrix);
  assert.equal(decoded.card.mode, 'fair_isle');
  assert.equal(decoded.card.profileId, 'brother_standard_24');
  assert.equal(decoded.card.rows, 3);
  assert.equal(decoded.card.cols, 5);
});

test('every lace glyph survives, including the two-letter and three-letter ones', () => {
  const codes = Object.values(STITCH_TYPE);
  const matrix = [codes, [...codes].reverse()];
  const encoded = encodeCard({ mode: 'lace', profileId: 'silver_reed_standard_24', stitchMatrix: matrix });
  const decoded = decodeCard(encoded.code);
  assert.equal(decoded.ok, true, decoded.error);
  assert.deepEqual(decoded.card.stitchMatrix, matrix);
  assert.equal(decoded.card.mode, 'lace');
  assert.equal(decoded.card.profileId, 'silver_reed_standard_24');
  assert.ok(codes.length <= 16, 'four bits per lace cell is only enough for 16 glyphs');
});

test('tuck and slip round-trip, and an unknown profile is not invented', () => {
  for (const mode of ['tuck', 'slip']) {
    const matrix = [[1, 0], [0, 1], [1, 1]];
    const decoded = decodeCard(encodeCard({ mode, stitchMatrix: matrix }).code);
    assert.deepEqual(decoded.card.stitchMatrix, matrix, mode);
    assert.equal(decoded.card.mode, mode);
    assert.equal(decoded.card.profileId, null, 'index 255 means "keep the reader\'s machine"');
  }
});

test('a big card compresses, because most of it is plain knit', () => {
  const rows = 60;
  const cols = 200;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let c = 0; c < cols; c += 7) matrix[30][c] = 1;
  const encoded = encodeCard({ mode: 'fair_isle', profileId: 'brother_standard_24', stitchMatrix: matrix });
  const rawCells = rows * cols / 8;
  assert.ok(encoded.bytes < rawCells / 4, `run coding should win big: ${encoded.bytes} vs ${rawCells}`);
  assert.ok(encoded.chars <= PRACTICAL_URL_LIMIT, 'and still fit a shareable link');
  assert.deepEqual(decodeCard(encoded.code).card.stitchMatrix, matrix);
});

test('broken links are refused with a sentence, not a stack trace', () => {
  assert.equal(encodeCard({ stitchMatrix: [] }).ok, false);
  assert.match(encodeCard({}).error, /no chart/i);

  const good = encodeCard({ mode: 'lace', stitchMatrix: [['K', 'O']] }).code;
  assert.match(decodeCard('').error, /No pattern data/i);
  assert.match(decodeCard('!!!!').error, /not valid|impossible/i);

  // A payload from a future codec must be refused, never half-read.
  const raw = unpackRuns(fromBase64Url(good));
  raw[0] = (raw[0] & 0x0f) | ((CODEC_VERSION + 3) << 4);
  const future = toBase64Url(packRuns(raw));
  const refused = decodeCard(future);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /newer KNITCAT link format/);
});

test('a truncated link says it is truncated', () => {
  const encoded = encodeCard({ mode: 'fair_isle', stitchMatrix: [[1, 0, 1, 0], [0, 1, 0, 1]] });
  const chopped = encoded.code.slice(0, 4);
  const result = decodeCard(chopped);
  assert.equal(result.ok, false);
  assert.match(result.error, /impossible size|truncated|not valid/);
});

test('run-length packing is lossless on adversarial bytes', () => {
  const cases = [
    new Uint8Array([]),
    new Uint8Array([0, 1, 2, 3]),
    new Uint8Array(300).fill(7),
    Uint8Array.from({ length: 256 }, (_, i) => i),
    Uint8Array.from({ length: 500 }, (_, i) => (i % 11 === 0 ? 200 : i % 3)),
    new Uint8Array([128, 128, 128, 128, 128, 4, 4, 4, 4, 255])
  ];
  for (const bytes of cases) {
    const back = unpackRuns(packRuns(bytes));
    assert.deepEqual([...back], [...bytes], `${bytes.length} bytes round-tripped`);
    assert.ok(packRuns(bytes).length <= bytes.length + Math.ceil(bytes.length / 129) * 1 + 2);
  }
});

test('base64url carries every byte and no padding', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const code = toBase64Url(bytes);
  assert.equal(/[+/=]/.test(code), false, 'URL-safe alphabet only');
  assert.deepEqual([...fromBase64Url(code)], [...bytes]);
  for (const len of [1, 2, 3, 4, 5]) {
    const slice = bytes.slice(0, len);
    assert.deepEqual([...fromBase64Url(toBase64Url(slice))], [...slice], `length ${len}`);
  }
});

test('the share URL keeps the card in the fragment, off the server', () => {
  const url = buildShareUrl('AbC-_123', { base: 'https://example.test/benji-machine/index.html' });
  assert.match(url, /^https:\/\/example\.test\/benji-machine\/index\.html#p=AbC-_123$/);
  assert.equal(url.includes('?p='), false, 'a query string would reach the web server');
  assert.equal(readShareUrl(url), 'AbC-_123');
  assert.equal(readShareUrl('https://example.test/benji-machine/?p=Query42'), 'Query42');
  assert.equal(readShareUrl('https://example.test/benji-machine/#tab=cnc'), null);
  assert.equal(readShareUrl('not a url at all'), null);
});

// ─── QR code: geometry ────────────────────────────────────────────────────────

const L_TABLE = {
  1: { total: 26, data: 19, ec: 7 },
  2: { total: 44, data: 34, ec: 10 },
  3: { total: 70, data: 55, ec: 15 },
  4: { total: 100, data: 80, ec: 20 },
  5: { total: 134, data: 108, ec: 26 }
};

// Independent alignment-centre rule (ISO 18004 §7.2), not the encoder's table.
function alignmentCentres(version) {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32
    ? 26
    : Math.floor((version * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;
  const result = new Array(numAlign);
  result[0] = 6;
  for (let i = numAlign - 1, pos = version * 4 + 10; i >= 1; i--, pos -= step) result[i] = pos;
  return result;
}

function functionMap(size, version) {
  const fn = Array.from({ length: size }, () => new Uint8Array(size));
  const mark = (r, c) => { if (r >= 0 && r < size && c >= 0 && c < size) fn[r][c] = 1; };
  for (const [r, c] of [[3, 3], [3, size - 4], [size - 4, 3]]) {
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) mark(r + dr, c + dc);
  }
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  // Alignment patterns at every centre, except the three under the finders.
  const centres = alignmentCentres(version);
  const n = centres.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(centres[i] + dr, centres[j] + dc);
    }
  }
  // Version information: two 18-module triangles, versions 7 and up.
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }
  for (let i = 0; i <= 8; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) mark(8, size - 1 - i);
  for (let i = 0; i < 8; i++) mark(size - 1 - i, 8);
  return fn;
}

/**
 * Independent re-implementation of the placement zigzag, for reading back.
 * `reserved` comes from this file's own `functionMap`, not from the encoder, so a
 * disagreement between the two about which modules carry data shows up here.
 */
function readCodewords(modules, size, reserved, count) {
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (reserved[row][col]) continue;
        bits.push(modules[row][col] & 1);
      }
    }
  }
  const out = new Uint8Array(count);
  for (let i = 0; i < count * 8; i++) out[i >> 3] = (out[i >> 3] << 1) | (bits[i] || 0);
  return out;
}

function unmask(qr) {
  const fn = functionMap(qr.size, qr.version);
  const masks = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];
  const grid = qr.modules.map(row => Uint8Array.from(row));
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (!fn[r][c] && masks[qr.mask](r, c)) grid[r][c] ^= 1;
    }
  }
  return { grid, fn };
}

/** Read both copies of the format information back out of a finished symbol. */
function readFormatBits(modules, size) {
  const at = (r, c) => modules[r][c] & 1;
  let first = 0;
  let second = 0;
  for (let i = 0; i < 15; i++) {
    const bit = i <= 5 ? at(i, 8) : i === 6 ? at(7, 8) : i === 7 ? at(8, 8) : i === 8 ? at(8, 7) : at(8, 14 - i);
    first |= bit << i;
  }
  for (let i = 0; i < 15; i++) {
    const bit = i < 8 ? at(8, size - 1 - i) : at(size - 15 + i, 8);
    second |= bit << i;
  }
  return { first, second };
}

// The format string is XOR-masked on the way out; undo it to see the payload.
const FORMAT_MASK = 0b101010000010010;

test('the version table matches the standard, and capacity follows from it', () => {
  for (const [version, table] of Object.entries(L_TABLE)) {
    assert.equal(table.total, table.data + table.ec, `v${version} codewords add up`);
    assert.equal(byteCapacity(Number(version)), Math.floor((table.data * 8 - 12) / 8));
  }
  assert.equal(byteCapacity(1), 17, 'published v1-L byte capacity is 17');
  assert.equal(byteCapacity(5), 106);
  assert.equal(pickVersion(1), 1);
  assert.equal(pickVersion(17), 1);
  assert.equal(pickVersion(18), 2);
  assert.equal(pickVersion(106), 5);
  assert.equal(pickVersion(107), 6, 'and version 6 exists — chosen, not refused');
  // The full-range rewrite: the whole 1–40 span is now reachable.
  assert.equal(pickVersion(maxByteCapacity()), 40, 'the byte ceiling maps to v40 at level L');
  assert.equal(pickVersion(maxByteCapacity() + 1), null, 'one byte past the ceiling is refused');
});

test('the symbol is the right size with the right fixed patterns', () => {
  const qr = encodeQr('https://example.test/benji-machine/#p=hello');
  assert.equal(qr.ok, true, qr.error);
  assert.equal(qr.size, qr.version * 4 + 17);
  assert.equal(qr.modules.length, qr.size);
  for (const row of qr.modules) assert.equal(row.length, qr.size);

  // Finder patterns: 7×7, dark ring, light ring, 3×3 dark core.
  for (const [r0, c0] of [[0, 0], [0, qr.size - 7], [qr.size - 7, 0]]) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const dist = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        assert.equal(qr.modules[r0 + r][c0 + c], dist === 2 ? 0 : 1,
          `finder at (${r0},${c0}) module (${r},${c})`);
      }
    }
  }
  // Timing patterns alternate, starting dark next to the finder.
  for (let i = 8; i < qr.size - 8; i++) {
    assert.equal(qr.modules[6][i], i % 2 === 0 ? 1 : 0, `row 6 column ${i}`);
    assert.equal(qr.modules[i][6], i % 2 === 0 ? 1 : 0, `column 6 row ${i}`);
  }
  // The dark module that every reader looks for: row 4·version+9, column 8.
  assert.equal(qr.modules[qr.size - 8][8], 1);
  if (qr.version >= 2) {
    const centre = qr.version * 4 + 10;
    assert.equal(qr.modules[centre][centre], 1);
    assert.equal(qr.modules[centre - 1][centre - 1], 0);
    assert.equal(qr.modules[centre - 2][centre - 2], 1);
  }
});

test('the format information matches the published level-L strings', () => {
  // ISO/IEC 18004 Table C.1 — the fifteen bits for ECC level L, mask 0 to 7.
  const PUBLISHED = [
    '111011111000100',
    '111001011110011',
    '111110110101010',
    '111100010011101',
    '110011000101111',
    '110001100011000',
    '110110001000001',
    '110100101110110'
  ];
  for (let mask = 0; mask < 8; mask++) {
    const bits = formatBits(mask);
    assert.equal(bits.toString(2).padStart(15, '0'), PUBLISHED[mask], `mask ${mask}`);
  }
});

test('a code can be read back, and its error correction really divides', () => {
  const texts = [
    'K',
    'https://example.test/#p=AbCdEf-123_x',
    'knitcat:{"mode":"lace","rows":24}',
    '♥ for Benji — non-ASCII in a QR byte mode payload'
  ];
  for (const text of texts) {
    const qr = encodeQr(text);
    assert.equal(qr.ok, true, `${text}: ${qr.error}`);
    const table = L_TABLE[qr.version];
    const { grid, fn } = unmask(qr);
    const codewords = readCodewords(grid, qr.size, fn, table.total);

    // 1. The codeword polynomial must be exactly divisible by the RS generator.
    const remainder = rsRemainder(codewords, rsGenerator(table.ec));
    assert.deepEqual([...remainder], new Array(table.ec).fill(0), `RS remainder for "${text}"`);

    // 2. The payload must read back as the original bytes.
    const bits = [];
    for (const byte of codewords.slice(0, table.data)) {
      for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
    }
    const take = n => {
      let value = 0;
      for (let i = 0; i < n; i++) value = (value << 1) | bits.shift();
      return value;
    };
    assert.equal(take(4), 0b0100, 'byte mode indicator');
    const length = take(8);
    assert.equal(length, utf8Bytes(text).length);
    const payload = new Uint8Array(length);
    for (let i = 0; i < length; i++) payload[i] = take(8);
    assert.equal(new TextDecoder().decode(payload), text);

    // 3. Both painted copies of the format information say the same thing, and
    //    once the standard XOR mask is undone they name level L and this mask.
    const copies = readFormatBits(qr.modules, qr.size);
    assert.equal(copies.second, copies.first, 'the second format copy must agree');
    assert.equal(copies.first, formatBits(qr.mask), 'format bits written = format bits chosen');
    const formatData = copies.first ^ FORMAT_MASK;
    assert.equal((formatData >> 13) & 0b11, 0b01, 'level L indicator');
    assert.equal((formatData >> 10) & 0b111, qr.mask);
    assert.equal(qr.modules[qr.size - 8][8], 1, 'the dark module stays dark');
  }
});

/**
 * Read a finished symbol back with no help from the encoder's placement code: reserve
 * the patterns with this file's own geometry, undo the mask, walk the zigzag, then split
 * the interleaved stream into its Reed–Solomon blocks and prove each one divides and the
 * payload decodes to the original text. This is the check the full 1–40 range needs.
 */
function verifySymbol(qr, text) {
  const level = qr.level;
  const [ec, g1n, g1d, g2n, g2d] = ecBlocks(qr.version, level);
  const widths = [...new Array(g1n).fill(g1d), ...new Array(g2n).fill(g2d)];
  const dataTotal = widths.reduce((sum, w) => sum + w, 0);
  const total = dataTotal + ec * widths.length;

  const { grid, fn } = unmask({ ...qr, modules: qr.modules });
  const codewords = readCodewords(grid, qr.size, fn, total);

  // De-interleave: data column-major across blocks, then EC column-major.
  const data = widths.map(w => new Uint8Array(w));
  const ecs = widths.map(() => new Uint8Array(ec));
  let idx = 0;
  const maxData = Math.max(g1d, g2d);
  for (let i = 0; i < maxData; i++) {
    for (let b = 0; b < widths.length; b++) if (i < widths[b]) data[b][i] = codewords[idx++];
  }
  for (let i = 0; i < ec; i++) {
    for (let b = 0; b < widths.length; b++) ecs[b][i] = codewords[idx++];
  }

  // 1. Every block's data+EC polynomial is exactly divisible by the generator.
  const gen = rsGenerator(ec);
  for (let b = 0; b < widths.length; b++) {
    const full = new Uint8Array([...data[b], ...ecs[b]]);
    const rem = rsRemainder(full, gen);
    assert.deepEqual([...rem], new Array(ec).fill(0), `v${qr.version}${level} block ${b} RS remainder`);
  }

  // 2. The payload decodes back to the original bytes.
  const bits = [];
  for (const block of data) {
    for (const byte of block) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  const take = n => {
    let value = 0;
    for (let i = 0; i < n; i++) value = (value << 1) | bits.shift();
    return value;
  };
  assert.equal(take(4), 0b0100, `v${qr.version}${level} byte mode indicator`);
  const countWidth = qr.version < 10 ? 8 : 16;
  const length = take(countWidth);
  assert.equal(length, utf8Bytes(text).length, `v${qr.version}${level} payload length`);
  const payload = new Uint8Array(length);
  for (let i = 0; i < length; i++) payload[i] = take(8);
  assert.equal(new TextDecoder().decode(payload), text, `v${qr.version}${level} payload reads back`);

  // 3. Format information names this level + mask, and both copies agree.
  const copies = readFormatBits(qr.modules, qr.size);
  assert.equal(copies.second, copies.first, 'the two format copies agree');
  assert.equal(copies.first, formatBits(qr.mask, level), 'format bits written = chosen');
}

test('long payloads work at any length, verified across versions and levels', () => {
  const varied = n => Array.from({ length: n }, (_, i) => String.fromCharCode(48 + (i % 74))).join('');
  const targets = [
    ['L', 5], ['L', 7], ['L', 9], ['M', 10], ['Q', 14], ['H', 20], ['L', 27], ['M', 33], ['L', 40]
  ];
  for (const [level, version] of targets) {
    const text = varied(byteCapacity(version, level));
    const qr = encodeQr(text, { eccLevel: level });
    assert.equal(qr.ok, true, `v${version}${level}: ${qr.error}`);
    assert.equal(qr.version, version, `a full ${level}-level payload maps to v${version}`);
    verifySymbol(qr, text);
  }
});

test('the format information encodes every level, not just L', () => {
  // ISO/IEC 18004 §6.3.3 level indicators: L=01, M=00, Q=11, H=10.
  const indicator = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
  for (const level of ['L', 'M', 'Q', 'H']) {
    for (let mask = 0; mask < 8; mask++) {
      const data = (formatBits(mask, level) ^ 0b101010000010010) >> 13;
      assert.equal(data, indicator[level], `${level} indicator in the format string`);
    }
  }
});

test('mask choice is the standard penalty, not whichever was built first', () => {
  const text = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const qr = encodeQr(text);
  // Same symbol, every mask, same scoring function: the encoder must have picked
  // the minimum. Forcing the mask is exactly what the option is for.
  const scores = [0, 1, 2, 3, 4, 5, 6, 7].map(mask => {
    const forced = encodeQr(text, { mask });
    assert.equal(forced.mask, mask, `mask ${mask} was not honoured`);
    return penaltyScore(forced.modules, forced.size);
  });
  assert.equal(qr.mask, scores.indexOf(Math.min(...scores)), `chosen ${qr.mask}, scores ${scores.join(', ')}`);
  assert.ok(new Set(scores).size > 1, 'the masks really differ, or this proves nothing');
});

test('a payload past the QR ceiling is refused with a usable message', () => {
  const big = 'x'.repeat(maxByteCapacity() + 10);
  const result = encodeQr(big);
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(`${maxByteCapacity()}-byte ceiling`));
  assert.match(result.error, /\.kcard/);
});

test('the SVG is standalone, sized, and layered with names', () => {
  const qr = encodeQr('knitcat://share/abc');
  const svg = qrToSvg(qr, { scale: 4, margin: 4, label: 'Pattern link' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3.org\/2000\/svg"/);
  assert.equal((svg.match(/<rect /g) || []).length, qr.modules.flat().filter(v => v).length + 1);
  assert.match(svg, /id="quiet-zone"/);
  assert.match(svg, /id="qr-modules"/);
  assert.match(svg, /inkscape:label="QR modules"/, 'named for CAD import');
  assert.match(svg, /aria-label="Pattern link"/);
  assert.match(svg, new RegExp(`width="${(qr.size + 8) * 4}"`));
});
