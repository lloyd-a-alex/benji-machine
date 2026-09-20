/**
 * KNITCAT V2 — KnitScript parser (recursive descent).
 *
 * Consumes the flat token stream from {@link module:knitscript/lexer} and builds the
 * plain-object AST defined in {@link module:knitscript/ast}. There is no separate
 * token *class* and no builder indirection beyond the tiny helpers in `ast.js`: the
 * parser constructs AST objects directly, so the tree is JSON-serialisable and can be
 * structurally asserted in tests.
 *
 * Grammar (informally):
 *
 *   program    := project
 *   project    := 'project' STRING? '{' section* '}'
 *   section    := IDENT namePrefix? (':' nameSuffix?)? '{' property* '}'
 *   property   := (IDENT|STRING) ':' value (NL | ',')*
 *   value      := pair | array | object | length | number | color | string
 *               | boolean | identifier | typedObject
 *   pair       := simple (('×'|'/') simple | 'out' 'of' simple)?
 *
 * Newlines and commas both separate properties; either may be absent at a closing
 * brace. On the first structural violation the parser throws a {@link ParseError}
 * carrying the offending token's line/column so the diagnostics layer can render a
 * caret pointing at the exact source location.
 *
 * @module knitscript/parser
 */

import { TOKEN, tokenize } from './lexer.js';
import {
  AST, program, project as projectNode, section, property,
  lengthValue, numberValue, identifier, stringLiteral, color,
  array as arrayNode, pair as pairNode, booleanValue
} from './ast.js';

/** An error that knows where in the source it happened. */
export class ParseError extends Error {
  /** @param {string} message @param {{line?:number,column?:number,text?:string}} [tok] */
  constructor(message, tok = {}) {
    super(message);
    this.name = 'ParseError';
    this.line = tok.line || 0;
    this.column = tok.column || 0;
    this.text = tok.text || '';
  }
}

/**
 * Parse KnitScript text into a Program AST.
 * @param {string|Array} input  source text, or a pre-made token array
 * @returns {object} a Program node whose single body element is a Project node
 * @throws {ParseError} on the first structural error
 */
export function parse(input) {
  const tokens = Array.isArray(input) ? input : tokenize(input);
  const p = new Parser(tokens);
  return p.parseProgram();
}

class Parser {
  /** @param {Array} tokens */
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  // ---- token cursor helpers -------------------------------------------------
  peek(offset = 0) { return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]; }
  next() { return this.tokens[this.pos++]; }
  atEof() { return this.peek().type === TOKEN.EOF; }
  is(type, value) {
    const t = this.peek();
    return t.type === type && (value === undefined || t.value === value);
  }
  expect(type, value, what) {
    const t = this.peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new ParseError(`Expected ${what || (value || type)} but found ${describe(t)}.`, t);
    }
    return this.next();
  }
  /** Advance past any run of newlines/commas (property separators). */
  skipSeparators() {
    while (this.peek().type === TOKEN.NEWLINE || this.is(TOKEN.PUNCT, ',')) this.next();
  }

  // ---- productions ----------------------------------------------------------
  parseProgram() {
    this.skipSeparators();
    const sections = [];
    let name = 'Untitled project';
    if (this.is(TOKEN.KEYWORD, 'project')) {
      this.next();
      if (this.is(TOKEN.STRING)) name = this.next().value;
      this.expectPunct('{', "project body '{'");
      sections.push(...this.parseSections('}'));
      this.expectPunct('}', "closing '}'");
    } else {
      // Lenient: a file with no `project` wrapper is still a project of sections.
      sections.push(...this.parseSections(TOKEN.EOF));
    }
    this.skipSeparators();
    if (!this.atEof()) throw new ParseError(`Unexpected trailing ${describe(this.peek())}.`, this.peek());
    return program([projectNode(name, sections)]);
  }

  /** Parse `{ section }`* until the given terminator (a punct string) or EOF. */
  parseSections(terminator) {
    const out = [];
    for (;;) {
      this.skipSeparators();
      const t = this.peek();
      if (t.type === TOKEN.EOF) break;
      if (terminator !== TOKEN.EOF && t.type === TOKEN.PUNCT && t.value === terminator) break;
      out.push(this.parseSection());
    }
    return out;
  }

  parseSection() {
    const kindTok = this.expect(TOKEN.IDENT, undefined, 'a section name');
    const kind = kindTok.value;
    let name = null;

    // `yarn "main":` / `chart "yoke":` — a name string before an optional colon.
    if (this.is(TOKEN.STRING)) {
      name = this.next().value;
    } else if (this.is(TOKEN.IDENT) && this.peek(1).type !== TOKEN.PUNCT) {
      // A bare subtype word `body measurements {` (rare, no colon) — only when the very
      // next token is not punctuation, so we never steal a `key` from a following `:`.
      // (Handled below after the colon for the common `body: measurements {` form.)
    }

    if (this.is(TOKEN.PUNCT, ':')) {
      this.next();
      // `machine: "brother_kh830" {` or `garment: raglanSweater {` or `body: measurements {`
      const after = this.peek();
      if ((after.type === TOKEN.IDENT || after.type === TOKEN.STRING) && this.peek(1).type === TOKEN.PUNCT && this.peek(1).value === '{') {
        name = this.next().value;
      } else if (after.type === TOKEN.STRING && name === null) {
        name = this.next().value;
      }
    }

    this.skipSeparators();
    let body = null;
    if (this.is(TOKEN.PUNCT, '{')) {
      this.next();
      body = this.parseProperties('}');
      this.expectPunct('}', "closing '}' for the " + kind + ' section');
    } else {
      throw new ParseError(`Section "${kind}" needs a { block }.`, this.peek());
    }
    return section(kind, name, body, {});
  }

  parseProperties(terminator) {
    const props = [];
    for (;;) {
      this.skipSeparators();
      const t = this.peek();
      if (t.type === TOKEN.EOF) break;
      if (terminator !== TOKEN.EOF && t.type === TOKEN.PUNCT && t.value === terminator) break;
      props.push(this.parseProperty());
    }
    return props;
  }

  parseProperty() {
    const keyTok = this.peek();
    if (keyTok.type !== TOKEN.IDENT && keyTok.type !== TOKEN.STRING) {
      throw new ParseError(`Expected a property name but found ${describe(keyTok)}.`, keyTok);
    }
    this.next();
    const key = String(keyTok.value);
    this.expectPunct(':', `a ':' after "${key}"`);
    const value = this.parseValue();
    return property(key, value);
  }

  parseValue() {
    let first = this.parseSimpleValue();
    // A trailing count word: `8 balls`, `22 sts`, `6 skeins`. The lexer only fuses a
    // unit glued to a number (`96cm`); a space-separated count noun arrives as a bare
    // identifier, so we adopt it here into a `{value,unit}` length-like node.
    if (first && first.type === AST.NUMBER && this.peek().type === TOKEN.IDENT && COUNT_UNITS.has(this.peek().value)) {
      first = lengthValue(first.value, this.next().value);
    }
    // Compound pairs: `8×8`, `100m/50g`, `3 out of 4`.
    if (this.is(TOKEN.PAIRSEP)) {
      const sep = this.next().value;
      const right = this.parseSimpleValue();
      return pairNode(first, right, sep);
    }
    if (this.is(TOKEN.KEYWORD, 'out') && this.peek(1).type === TOKEN.KEYWORD && this.peek(1).value === 'of') {
      this.next(); this.next();
      const right = this.parseSimpleValue();
      return pairNode(first, right, 'out of');
    }
    return first;
  }

  parseSimpleValue() {
    const t = this.peek();
    switch (t.type) {
      case TOKEN.LENGTH: this.next(); return lengthValue(t.value.value, t.value.unit);
      case TOKEN.NUMBER: this.next(); return numberValue(t.value);
      case TOKEN.COLOR: this.next(); return color(t.value);
      case TOKEN.STRING: this.next(); return stringLiteral(t.value);
      case TOKEN.KEYWORD:
        if (t.value === 'true' || t.value === 'false') { this.next(); return booleanValue(t.value === 'true'); }
        this.next(); return identifier(t.value);
      case TOKEN.IDENT: {
        // Typed inline object: `crew { width: 18cm }` — an identifier followed by '{'.
        if (this.peek(1).type === TOKEN.PUNCT && this.peek(1).value === '{') {
          this.next();
          this.next(); // consume {
          const props = this.parseProperties('}');
          this.expectPunct('}', "closing '}'");
          const node = { type: AST.OBJECT, properties: props };
          node.name = t.value;
          return node;
        }
        this.next();
        return identifier(t.value);
      }
      case TOKEN.PUNCT:
        if (t.value === '[') { this.next(); return this.parseArray(); }
        if (t.value === '{') {
          this.next();
          const props = this.parseProperties('}');
          this.expectPunct('}', "closing '}'");
          return { type: AST.OBJECT, properties: props, name: null };
        }
        throw new ParseError(`Unexpected ${describe(t)} where a value was expected.`, t);
      default:
        throw new ParseError(`Unexpected ${describe(t)} where a value was expected.`, t);
    }
  }

  parseArray() {
    const items = [];
    for (;;) {
      this.skipSeparators();
      if (this.is(TOKEN.PUNCT, ']')) { this.next(); break; }
      if (this.atEof()) throw new ParseError('Unterminated array: missing "]".', this.peek());
      items.push(this.parseValue());
      this.skipSeparators();
      if (this.is(TOKEN.PUNCT, ',')) { this.next(); continue; }
      if (this.is(TOKEN.PUNCT, ']')) { this.next(); break; }
    }
    return arrayNode(items);
  }

  expectPunct(ch, what) {
    const t = this.peek();
    if (t.type !== TOKEN.PUNCT || t.value !== ch) {
      throw new ParseError(`Expected ${what || `'${ch}'`} but found ${describe(t)}.`, t);
    }
    return this.next();
  }
}

/** Count nouns that may follow a number with a space (`8 balls`). */
const COUNT_UNITS = new Set(['balls', 'skeins', 'sts', 'rows', 'sp', 'ply', 'st', 'g', 'oz', 'kg', 'deg']);

/** Human-readable token description for error messages. */
function describe(tok) {
  if (!tok) return 'end of file';
  if (tok.type === TOKEN.EOF) return 'end of file';
  if (tok.type === TOKEN.NEWLINE) return 'end of line';
  const shown = tok.text || String(tok.value);
  return `${tok.type} "${shown}"`;
}
