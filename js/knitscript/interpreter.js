/**
 * KNITCAT V2 — KnitScript interpreter.
 *
 * Walks the AST from {@link module:knitscript/parser} into a *normalised project
 * specification*: a plain, JSON-friendly object where every section is a keyed map of
 * resolved values. This is the bridge between "text" and "the Project object" — the
 * interpreter deliberately knows nothing about garments or gauges; it only turns AST
 * nodes into JavaScript values (numbers, `{value,unit}` lengths, `{left,right,sep}`
 * pairs, arrays, nested objects, colours, strings, booleans). The `Project` model then
 * reads that spec and wires the constraint graph.
 *
 * The shape it returns:
 *
 *   {
 *     name: "Benji's Winter Sweater",
 *     sections: {
 *       body:    { system:'custom', bust:{value:96,unit:'cm'}, easePreference:'relaxed', … },
 *       yarn:    { main: {…}, contrast: {…} },         // keyed by the section name
 *       machine: { id:'brother_kh830', bed:'single', gauge:{…}, … },
 *       garment: { kind:'raglanSweater', construction:'bottomUp', neckline:{…}, … },
 *       chart:   { yoke: {…} },
 *       compile: { outputs:['chart',…], optimize:[…], verify:[…] },
 *       swatch:  {…}, colorway:{…}, budget:{…}, timeline:{…}, production:{…}
 *     }
 *   }
 *
 * DOM-free and dependency-free.
 *
 * @module knitscript/interpreter
 */

import { AST } from './ast.js';

/** Convert a length's value to centimetres (the project's working unit). */
export const UNITS_TO_CM = Object.freeze({
  cm: 1, mm: 0.1, in: 2.54, inch: 2.54, yd: 91.44, yds: 91.44, m: 100
});

/**
 * Reduce a `{value,unit}` length to centimetres, or pass through a plain number.
 * @param {{value:number,unit:string}|number} len @returns {number}
 */
export function asCm(len) {
  if (typeof len === 'number') return len;
  if (len && typeof len.value === 'number') {
    const factor = UNITS_TO_CM[len.unit];
    return factor === undefined ? len.value : len.value * factor;
  }
  return 0;
}

/**
 * Interpret a Program AST into a normalised spec object.
 * @param {object} ast  a Program node (from {@link module:knitscript/parser#parse})
 * @returns {{name:string, sections:Record<string,any>}}
 */
export function interpret(ast) {
  const project = pickProject(ast);
  const spec = { name: project.name || 'Untitled project', sections: {} };
  for (const sec of project.body || []) {
    if (!sec || sec.type !== AST.SECTION) continue;
    const values = sec.body ? propsToObject(sec.body) : {};
    const kind = sec.kind;
    if (kind === 'yarn' || kind === 'chart' || kind === 'colorway') {
      // These repeat by name: yarn "main", chart "yoke".
      const bucket = spec.sections[kind] || (spec.sections[kind] = {});
      const key = sec.name || `#${Object.keys(bucket).length + 1}`;
      bucket[key] = values;
      if (sec.name) values._name = sec.name;
    } else if (kind === 'machine') {
      // `machine: "brother_kh830" { … }` — the name is the machine id.
      values.id = sec.name || values.id || null;
      spec.sections.machine = values;
    } else if (kind === 'garment') {
      // `garment: raglanSweater { … }` — the name is the construction template.
      values.kind = sec.name || values.kind || null;
      spec.sections.garment = values;
    } else if (kind === 'body') {
      spec.sections.body = values;
    } else {
      // compile/swatch/budget/timeline/production: single section, straight map.
      spec.sections[kind] = values;
    }
  }
  return spec;
}

/** Find the Project node inside a Program (tolerant of a bare Project or array). */
function pickProject(ast) {
  if (!ast) return { name: 'Untitled project', body: [] };
  if (ast.type === AST.PROJECT) return ast;
  if (ast.type === AST.PROGRAM && Array.isArray(ast.body)) {
    return ast.body.find(n => n && n.type === AST.PROJECT) || { name: 'Untitled project', body: ast.body };
  }
  if (Array.isArray(ast)) return { name: 'Untitled project', body: ast };
  return { name: 'Untitled project', body: [] };
}

/** Turn an array of Property nodes into a plain object. */
function propsToObject(props) {
  const out = {};
  for (const p of props || []) {
    if (!p || p.type !== AST.PROPERTY) continue;
    out[p.key] = valueOf(p.value);
  }
  return out;
}

/**
 * Convert a single AST value node into a JavaScript value.
 * @param {object} node @returns {*}
 */
export function valueOf(node) {
  if (!node || typeof node !== 'object') return node;
  switch (node.type) {
    case AST.LENGTH: return { value: node.value, unit: node.unit };
    case AST.NUMBER: return node.value;
    case AST.STRING: return node.value;
    case AST.COLOR: return node.hex;
    case AST.BOOLEAN: return node.value;
    case AST.IDENTIFIER: return node.name;
    case AST.PAIR: return { left: valueOf(node.left), right: valueOf(node.right), sep: node.sep };
    case AST.ARRAY: return (node.items || []).map(valueOf);
    case AST.OBJECT: {
      const obj = propsToObject(node.properties);
      if (node.name) obj._kind = node.name;
      return obj;
    }
    default: return node;
  }
}
