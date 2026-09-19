/**
 * The card as a URL — no server, no database, no link expiry.
 *
 * KNITCAT is a static site: there is nowhere to upload a pattern to, so a share
 * link has to carry the pattern *inside itself*. That is entirely possible
 * because a punched card is astonishingly compressible: a 24×200 Fair Isle chart
 * is 4 800 binary decisions, which is 600 bytes before any run-length coding, and
 * a lace chart is mostly plain knit.
 *
 * Layout, deliberately tiny and versioned in the payload rather than in the URL
 * shape so an old link can never be mistaken for a new one:
 *
 *   4 bits  codec version          (1)
 *   2 bits  pattern mode           (lace / fair isle / tuck / slip)
 *   8 bits  machine profile index  (255 = "keep the reader's own")
 *  16 bits  rows
 *  16 bits  columns
 *   then one value per cell: 4 bits for a lace glyph, 1 bit for punched/blank
 *
 * The bit stream is then PackBits-compressed (runs of repeated bytes, which is
 * what large plain-knit areas and colour blocks turn into) and base64url encoded,
 * because `+` and `/` in a fragment get mangled by chat apps and `=` padding is
 * wasted characters.
 *
 * Everything here is pure and injectable: the tests round-trip real charts
 * through it without a browser.
 */

import { STITCH_TYPE } from '../math/knit-topology.js';
import { MACHINE_PROFILES } from '../machine/profiles.js';

export const URL_STATE_PARAM = 'p';
/** Bump only when the bit layout below changes. */
export const CODEC_VERSION = 1;
/**
 * Browsers tolerate far more, but chat apps, SMS and QR codes do not. Past this
 * many characters the UI stops promising a link and offers a file instead.
 */
export const PRACTICAL_URL_LIMIT = 1800;

const MODE_ORDER = ['lace', 'fair_isle', 'tuck', 'slip'];
const LACE_CODES = Object.values(STITCH_TYPE);
const LACE_INDEX = new Map(LACE_CODES.map((code, index) => [code, index]));
const PROFILE_IDS = Object.keys(MACHINE_PROFILES);

// ─── bit plumbing ─────────────────────────────────────────────────────────────

class BitWriter {
  constructor() {
    this.bytes = [];
    this.current = 0;
    this.bits = 0;
  }
  write(value, width) {
    for (let i = width - 1; i >= 0; i--) {
      this.current = (this.current << 1) | ((value >> i) & 1);
      this.bits++;
      if (this.bits === 8) {
        this.bytes.push(this.current & 0xff);
        this.current = 0;
        this.bits = 0;
      }
    }
    return this;
  }
  finish() {
    if (this.bits > 0) {
      this.current = (this.current << (8 - this.bits)) & 0xff;
      this.bytes.push(this.current);
      this.bits = 0;
    }
    return Uint8Array.from(this.bytes);
  }
}

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }
  read(width) {
    let value = 0;
    for (let i = 0; i < width; i++) {
      const byte = this.bytes[this.pos >> 3] ?? 0;
      const bit = (byte >> (7 - (this.pos & 7))) & 1;
      value = (value << 1) | bit;
      this.pos++;
    }
    return value;
  }
  get remainingBits() {
    return this.bytes.length * 8 - this.pos;
  }
}

/**
 * PackBits: control byte 0..127 = that many literal bytes, 129..255 = repeat.
 * 128 is the reserved no-op, so a repeat can never be longer than 127 bytes.
 */
export function packRuns(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const value = bytes[i];
    let run = 1;
    while (run < 127 && i + run < bytes.length && bytes[i + run] === value) run++;
    if (run >= 4) {
      out.push((256 - run) & 0xff, value);
      i += run;
      continue;
    }
    // Literal run: gather until the next repeat worth encoding.
    const start = i;
    while (i < bytes.length && i - start < 128) {
      let ahead = 1;
      while (ahead < 4 && i + ahead < bytes.length && bytes[i + ahead] === bytes[i]) ahead++;
      if (ahead >= 4) break;
      i++;
    }
    const count = i - start;
    out.push(count - 1);
    for (let j = start; j < i; j++) out.push(bytes[j]);
  }
  return Uint8Array.from(out);
}

export function unpackRuns(packed) {
  const out = [];
  let i = 0;
  while (i < packed.length) {
    const control = packed[i++];
    if (control < 128) {
      const count = control + 1;
      for (let j = 0; j < count && i < packed.length; j++) out.push(packed[i++]);
    } else if (control > 128) {
      const count = 256 - control;
      const value = packed[i++];
      for (let j = 0; j < count; j++) out.push(value);
    }
    // 128 is the documented no-op marker; skipping it keeps us forgiving.
  }
  return Uint8Array.from(out);
}

// ─── base64url, without padding and without a dependency ──────────────────────

export function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - (String(text).length % 4)) % 4);
  let binary = '';
  if (typeof atob === 'function') {
    binary = atob(b64);
  } else {
    binary = Buffer.from(b64, 'base64').toString('binary');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ─── the card ⇄ string contract ───────────────────────────────────────────────

/**
 * @param {object} card  { mode, profileId, rows, cols, stitchMatrix }
 * @returns {{ok: boolean, code?: string, bytes?: number, error?: string, tooLong?: boolean}}
 */
export function encodeCard(card = {}) {
  const matrix = card.stitchMatrix;
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return { ok: false, error: 'There is no chart on the card to share.' };
  }
  const rows = matrix.length;
  const cols = Array.isArray(matrix[0]) ? matrix[0].length : 0;
  if (rows > 65535 || cols > 65535) {
    return { ok: false, error: 'That chart is too large to put inside a link.' };
  }
  const mode = MODE_ORDER.includes(card.mode) ? card.mode : 'lace';
  const isLace = mode === 'lace';
  const profileIndex = card.profileId ? PROFILE_IDS.indexOf(card.profileId) : 0xff;

  const writer = new BitWriter();
  writer.write(CODEC_VERSION, 4);
  writer.write(MODE_ORDER.indexOf(mode), 2);
  writer.write(profileIndex < 0 ? 0xff : profileIndex, 8);
  writer.write(rows, 16);
  writer.write(cols, 16);
  for (let r = 0; r < rows; r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < cols; c++) {
      const value = row[c];
      if (isLace) {
        const index = LACE_INDEX.get(value) ?? LACE_INDEX.get(STITCH_TYPE.KNIT);
        writer.write(index, 4);
      } else {
        writer.write(value ? 1 : 0, 1);
      }
    }
  }

  const packed = packRuns(writer.finish());
  const code = toBase64Url(packed);
  return {
    ok: true,
    code,
    bytes: packed.length,
    tooLong: code.length > PRACTICAL_URL_LIMIT,
    chars: code.length
  };
}

/**
 * @param {string} code the base64url payload from the fragment
 * @returns {{ok: boolean, card?: object, note?: string, error?: string}}
 */
export function decodeCard(code) {
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: false, error: 'No pattern data in that link.' };
  }
  let bytes;
  try {
    bytes = fromBase64Url(code.trim());
  } catch (err) {
    return { ok: false, error: `That link's pattern data is not valid: ${err.message}` };
  }
  const raw = unpackRuns(bytes);
  // 4 + 2 + 8 + 16 + 16 bits of header. Anything shorter is a link that got cut
  // off in transit, and "truncated" is the truth whereas "impossible size" is not.
  if (raw.length * 8 < 46) {
    return { ok: false, error: 'That link is truncated — even the chart size is missing.' };
  }
  const reader = new BitReader(raw);
  const version = reader.read(4);
  if (version !== CODEC_VERSION) {
    return {
      ok: false,
      error: `That link was written by ${version > CODEC_VERSION ? 'a newer' : 'an older'} KNITCAT link format (v${version}); this build reads v${CODEC_VERSION}.`
    };
  }
  const mode = MODE_ORDER[reader.read(2)] || 'lace';
  const profileIndex = reader.read(8);
  const rows = reader.read(16);
  const cols = reader.read(16);
  if (!rows || !cols || rows > 4000 || cols > 4000) {
    return { ok: false, error: 'That link claims an impossible chart size.' };
  }
  if (reader.remainingBits < rows * cols * (mode === 'lace' ? 4 : 1)) {
    return { ok: false, error: 'That link is truncated — the chart is not all there.' };
  }

  const isLace = mode === 'lace';
  const matrix = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) {
      if (isLace) {
        row[c] = LACE_CODES[reader.read(4) % LACE_CODES.length] ?? STITCH_TYPE.KNIT;
      } else {
        row[c] = reader.read(1) ? 1 : 0;
      }
    }
    matrix[r] = row;
  }

  const profileId = profileIndex < 0xff ? PROFILE_IDS[profileIndex] : null;
  const notes = [];
  if (profileIndex < 0xff && !profileId) notes.push('The link names a machine this build does not know.');

  return {
    ok: true,
    card: {
      codecVersion: version,
      mode,
      profileId: profileId || null,
      rows,
      cols,
      stitchMatrix: matrix
    },
    note: notes.join(' ') || null
  };
}

/**
 * Build the shareable absolute URL. The card lives in the fragment, which is
 * never sent to any server — GitHub Pages sees the same request for every link,
 * and nothing about the pattern leaks in a referrer or a log.
 */
export function buildShareUrl(code, options = {}) {
  const base = options.base || (typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : './');
  const url = new URL(base, typeof location !== 'undefined' ? location.href : 'https://example.invalid/');
  url.hash = `${URL_STATE_PARAM}=${code}`;
  return url.toString();
}

/** Read `#p=…` (or `?p=…`, which some apps rewrite a fragment into). */
export function readShareUrl(href) {
  if (typeof href !== 'string') return null;
  try {
    const url = new URL(href, 'https://example.invalid/');
    const fromHash = url.hash.replace(/^#/, '').match(new RegExp(`(?:^|&)${URL_STATE_PARAM}=([^&]+)`));
    if (fromHash) return decodeURIComponent(fromHash[1]);
    const fromQuery = url.searchParams.get(URL_STATE_PARAM);
    return fromQuery ? decodeURIComponent(fromQuery) : null;
  } catch (_) {
    return null;
  }
}

/** Wipe the payload from the address bar once it has been applied. */
export function stripShareUrl() {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  const url = new URL(location.href);
  url.hash = '';
  url.searchParams.delete(URL_STATE_PARAM);
  const query = url.searchParams.toString();
  history.replaceState(null, '', `${url.pathname}${query ? `?${query}` : ''}`);
}
