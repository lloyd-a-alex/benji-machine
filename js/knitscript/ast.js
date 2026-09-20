/**
 * KNITCAT V2 — KnitScript abstract syntax tree.
 *
 * KnitScript is the project's single source of truth: a small declarative language,
 * LaTeX-for-knitting, that a `.knit` file is written in and that the whole graphical
 * app is a front-end over. The parser turns that text into the node types defined here;
 * the interpreter walks the AST into a live `Project` + `ConstraintGraph`; the
 * serializer walks a `Project` back into AST (and then text). Keeping the node shapes
 * in one DOM-free module means every other stage shares one vocabulary.
 *
 * Node shapes (plain objects with a `type` discriminant — no classes, so they serialise
 * to JSON trivially and can be structurally inspected in tests):
 *
 *   Program        { type:'Program', body:[ BlockNode ] }
 *   Project        { type:'Project', name, body:[ SectionNode ] }
 *   Section        { type:'Section', kind, name?, args?, body|value }
 *   Property       { type:'Property', key, value: ValueNode|LengthValue|NumberValue|… }
 *   Length         { type:'length', value, unit }            // 96cm, 12deg
 *   Number         { type:'number', value }
 *   Identifier     { type:'identifier', name }
 *   StringLiteral  { type:'string', value }
 *   Color          { type:'color', hex }
 *   Array          { type:'array', items:[ ValueNode ] }
 *   Object         { type:'object', properties:[ Property ] }  // { width: 18cm, ... }
 *   Pair           { type:'pair', left, right, sep }           // 8×8, 100m/50g, 3 out of 4
 *   Boolean        { type:'boolean', value }
 *
 * @module knitscript/ast
 */

/** The `type` string of every AST node. Centralised so a typo is impossible. */
export const AST = Object.freeze({
  PROGRAM: 'Program',
  PROJECT: 'Project',
  SECTION: 'Section',
  PROPERTY: 'Property',
  LENGTH: 'length',
  NUMBER: 'number',
  IDENTIFIER: 'identifier',
  STRING: 'string',
  COLOR: 'color',
  ARRAY: 'array',
  OBJECT: 'object',
  PAIR: 'pair',
  BOOLEAN: 'boolean'
});

/** Section kinds the parser recognises as top-level blocks inside a project. */
export const SECTION_KINDS = Object.freeze([
  'body', 'yarn', 'machine', 'garment', 'chart', 'compile', 'colorway', 'budget', 'timeline', 'production', 'swatch'
]);

/** Construct a Program node. @param {Array} body @returns {object} */
export const program = (body = []) => ({ type: AST.PROGRAM, body });
/** Construct a Project node. @param {string} name @param {Array} body @returns {object} */
export const project = (name, body = []) => ({ type: AST.PROJECT, name, body });
/** Construct a Section node. @returns {object} */
export const section = (kind, name, body, extra = {}) => ({ type: AST.SECTION, kind, name: name ?? null, ...extra, body: body ?? null });
/** Construct a Property node. @returns {object} */
export const property = (key, value) => ({ type: AST.PROPERTY, key, value });
/** Construct a length/angle/value-with-unit node. @returns {object} */
export const lengthValue = (value, unit) => ({ type: AST.LENGTH, value, unit });
/** Construct a number node. @returns {object} */
export const numberValue = (value) => ({ type: AST.NUMBER, value });
/** Construct an identifier node. @returns {object} */
export const identifier = (name) => ({ type: AST.IDENTIFIER, name });
/** Construct a string node. @returns {object} */
export const stringLiteral = (value) => ({ type: AST.STRING, value });
/** Construct a color node from a `#rrggbb` string. @returns {object} */
export const color = (hex) => ({ type: AST.COLOR, hex });
/** Construct an array node. @returns {object} */
export const array = (items) => ({ type: AST.ARRAY, items });
/** Construct an inline object node. @returns {object} */
export const objectNode = (properties) => ({ type: AST.OBJECT, properties });
/** Construct a compound pair (`8×8`, `100m/50g`). @returns {object} */
export const pair = (left, right, sep) => ({ type: AST.PAIR, left, right, sep });
/** Construct a boolean node. @returns {object} */
export const booleanValue = (value) => ({ type: AST.BOOLEAN, value: !!value });

/**
 * True when `node` is any value node the interpreter knows how to turn into a JS value.
 * @param {object} node @returns {boolean}
 */
export function isValueNode(node) {
  if (!node || typeof node !== 'object') return false;
  switch (node.type) {
    case AST.LENGTH: case AST.NUMBER: case AST.IDENTIFIER: case AST.STRING:
    case AST.COLOR: case AST.ARRAY: case AST.OBJECT: case AST.PAIR: case AST.BOOLEAN:
      return true;
    default:
      return false;
  }
}

/** A tiny structural walker: call `fn(node)` for `node` and every descendant node. */
export function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  fn(node);
  if (Array.isArray(node.body)) for (const c of node.body) walk(c, fn);
  if (Array.isArray(node.items)) for (const c of node.items) walk(c, fn);
  if (Array.isArray(node.properties)) for (const c of node.properties) walk(c, fn);
  if (node.value) walk(node.value, fn);
  if (node.left) walk(node.left, fn);
  if (node.right) walk(node.right, fn);
}
