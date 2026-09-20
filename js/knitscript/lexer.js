/**
 * KNITCAT V2 — KnitScript lexer (tokenizer).
 *
 * Turns the text of a `.knit` file into a flat array of tokens, each carrying the
 * exact source `{ line, column, end }` it came from so the parser and the
 * diagnostics layer can point at a precise place when something is wrong. This is
 * the front of the pipeline described in the macro spec:
 *
 *   KnitScript text → [tokens] → AST → Project (via the interpreter)
 *
 * The language is deliberately small and forgiving: a `project` block containing
 * named sections (`body`, `yarn`, `machine`, `garment`, `chart`, `compile`, …),
 * each a `{ key: value }` object. Values may be numbers, numbers-with-units
 * (`96cm`, `4.5mm`, `12deg`, `100%`), identifiers (`dk`, `relaxed`), quoted
 * strings, hex colours (`#2d4a6b`), arrays (`[a, b]`), inline objects
 * (`crew { width: 18cm }`), and compound pairs (`8×8`, `100m/50g`).
 *
 * Comments: a double-slash line comment and a slash-star block comment. Both are
 * skipped, but a run of newlines is
 * preserved as a `newline` token so the parser can use line structure to end a bare
 * `key: value` property without needing a mandatory separator.
 *
 * DOM-free and dependency-free: importable under `node --test`.
 *
 * @module knitscript/lexer
 */

/** The token kinds the lexer can emit. Centralised so nothing typos a kind string. */
export const TOKEN = Object.freeze({
  NEWLINE: 'newline',
  IDENT: 'ident',
  STRING: 'string',
  NUMBER: 'number',
  LENGTH: 'length', // a number fused with a unit: 96cm, 12deg, 100%, 4.5mm
  COLOR: 'color', // #rrggbb or #rgb
  PUNCT: 'punct', // : { } [ ] , ( )
  PAIRSEP: 'pairsep', // × / used inside compound values
  KEYWORD: 'keyword', // reserved words: project, true, false, out, of
  EOF: 'eof'
});

/** Words that are reserved and emitted as KEYWORD rather than IDENT. */
const KEYWORDS = new Set(['project', 'true', 'false', 'out', 'of']);

/** Units that glue straight onto a number to form a LENGTH token. */
const UNIT_PATTERN = /^(cm|mm|in|inch|yd|yds|m|deg|g|oz|kg|st|%|sts|rows|balls|skeins|sp|ply)/;

/** A single char test helper that keeps the scanning loop readable. */
const isDigit = (c) => c >= '0' && c <= '9';
const isSpace = (c) => c === ' ' || c === '\t' || c === '\r';
const isIdentStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
const isIdentPart = (c) => isIdentStart(c) || isDigit(c) || c === '-';

/**
 * @typedef {object} Token
 * @property {string} type  one of {@link TOKEN}
 * @property {*} value  the parsed value (number, string, single-char punct, …)
 * @property {string} text  the raw source slice (for error messages)
 * @property {number} line  1-based line
 * @property {number} column  1-based column
 * @property {number} start  0-based offset into the source
 * @property {number} end  offset just past the token
 */

/**
 * Tokenise a KnitScript source string.
 *
 * The lexer never throws on unexpected characters the way a stricter grammar might:
 * an unknown byte becomes a `punct` token holding that character, and it is the
 * *parser* that decides whether it is legal, so error reporting stays in one place
 * and one stray symbol cannot abort a whole-project parse.
 *
 * @param {string} src  the raw `.knit` text
 * @returns {Token[]}  tokens ending with a single EOF token
 */
export function tokenize(src) {
  if (typeof src !== 'string') src = String(src == null ? '' : src);
  const tokens = [];
  const len = src.length;
  let i = 0;
  let line = 1;
  let lineStart = 0; // offset of the current line's first character

  const column = (offset) => offset - lineStart + 1;
  const push = (type, start, end, value) => {
    tokens.push({ type, value, text: src.slice(start, end), line, column: column(start), start, end });
  };

  while (i < len) {
    const c = src[i];

    // Newlines: collapse a run of them into one NEWLINE token (structure, not count).
    if (c === '\n') {
      const start = i;
      while (i < len && (src[i] === '\n' || isSpace(src[i]))) {
        if (src[i] === '\n') { line++; lineStart = i + 1; }
        i++;
      }
      push(TOKEN.NEWLINE, start, i, '\n');
      continue;
    }

    // Horizontal whitespace (not leading a newline) — skip silently.
    if (isSpace(c)) { i++; continue; }

    // Line comment.
    if (c === '/' && src[i + 1] === '/') {
      while (i < len && src[i] !== '\n') i++;
      continue;
    }
    // Block comment.
    if (c === '/' && src[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < len && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') { line++; lineStart = i + 1; }
        i++;
      }
      i += 2; // consume */
      push(TOKEN.NEWLINE, start, i, '\n'); // a block comment is treated as whitespace/structure
      continue;
    }

    // Hex colour — must be # followed by 3 or 6 hex digits, else it is stray punct.
    if (c === '#') {
      const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})/.exec(src.slice(i, i + 7));
      if (m) {
        const start = i;
        i += m[0].length;
        push(TOKEN.COLOR, start, i, normalizeHex(m[0]));
        continue;
      }
    }

    // Quoted string.
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      let value = '';
      while (i < len && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < len) {
          const esc = src[i + 1];
          value += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
          i += 2;
          if (esc === '\n') { line++; lineStart = i; }
          continue;
        }
        if (src[i] === '\n') { line++; lineStart = i + 1; }
        value += src[i];
        i++;
      }
      i++; // closing quote (may run past end for an unterminated string; parser flags it)
      push(TOKEN.STRING, start, i, value);
      continue;
    }

    // Number, or number-with-unit (LENGTH). Handles 96, 4.5, .5, and 1e3.
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      const start = i;
      while (i < len && (isDigit(src[i]) || src[i] === '.')) i++;
      if ((src[i] === 'e' || src[i] === 'E') && (isDigit(src[i + 1]) || ((src[i + 1] === '+' || src[i + 1] === '-') && isDigit(src[i + 2])))) {
        i++; if (src[i] === '+' || src[i] === '-') i++;
        while (i < len && isDigit(src[i])) i++;
      }
      const numText = src.slice(start, i);
      const rest = src.slice(i);
      const unitMatch = UNIT_PATTERN.exec(rest);
      // Only fuse a unit when it is not immediately followed by more identifier
      // characters (so `96cm-wide` still reads as length `96cm` then `-wide`), and
      // guard against a bare number being mistaken for e.g. `4.5mm` vs `4ball`.
      if (unitMatch && !isIdentPart(rest[unitMatch[0].length] || '')) {
        i += unitMatch[0].length;
        push(TOKEN.LENGTH, start, i, { value: Number(numText), unit: unitMatch[0] });
      } else {
        push(TOKEN.NUMBER, start, i, Number(numText));
      }
      continue;
    }

    // Identifier or keyword — but a bare `x` immediately after a number is a repeat
    // pair separator (`8x8`), checked here so it wins over identifier scanning.
    if (c === 'x') {
      const prev = tokens[tokens.length - 1];
      const numish = prev && (prev.type === TOKEN.NUMBER || prev.type === TOKEN.LENGTH);
      if (numish) { push(TOKEN.PAIRSEP, i, i + 1, '×'); i++; continue; }
    }
    if (isIdentStart(c)) {
      const start = i;
      while (i < len && isIdentPart(src[i])) i++;
      const text = src.slice(start, i);
      push(KEYWORDS.has(text) ? TOKEN.KEYWORD : TOKEN.IDENT, start, i, text);
      continue;
    }

    // Compound pair separators. `×` (and an ASCII `x` that follows a number, handled
    // below) joins a repeat like 8×8.
    if (c === '×') { push(TOKEN.PAIRSEP, i, i + 1, '×'); i++; continue; }

    // Structural punctuation.
    if (':{}[],()'.includes(c)) {
      push(TOKEN.PUNCT, i, i + 1, c);
      i++;
      continue;
    }
    if (c === '/') {
      // A lone slash (not a comment, already handled above) is a pair separator: 100m/50g.
      push(TOKEN.PAIRSEP, i, i + 1, '/');
      i++;
      continue;
    }

    // Anything else: a stray character, kept as punct so the parser reports it precisely.
    push(TOKEN.PUNCT, i, i + 1, c);
    i++;
  }

  const end = len;
  tokens.push({ type: TOKEN.EOF, value: null, text: '', line, column: column(end), start: end, end });
  return tokens;
}

/** Expand a `#rgb` shorthand to `#rrggbb` and lower-case it, for stable comparisons. */
function normalizeHex(hex) {
  let h = hex.slice(1).toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h;
}
