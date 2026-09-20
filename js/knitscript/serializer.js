/**
 * KNITCAT V2 — KnitScript serializer.
 *
 * The inverse of {@link module:knitscript/interpreter}: render a normalised project
 * spec back out to KnitScript text so a Project can be saved as a `.knit` file, shown
 * in the text-mode editor, and diffed. The output is meant to re-parse to the same spec
 * (the round-trip is asserted in tests), so the emitter is deliberately faithful about
 * units, quotes and structure rather than pretty.
 *
 * DOM-free.
 *
 * @module knitscript/serializer
 */

/**
 * Serialise a spec (from {@link module:knitscript/interpreter#interpret}) to KnitScript.
 * @param {{name:string, sections:Record<string,any>}} spec
 * @returns {string}
 */
export function serialize(spec) {
  const s = (spec && spec.sections) || {};
  const name = quote(spec && spec.name ? spec.name : 'Untitled project');
  const lines = [`project ${name} {`];
  const push = (indent, text) => lines.push('  '.repeat(indent) + text);

  if (s.body) { push(1, 'body: measurements {'); emitProps(s.body, 2, push); push(1, '}'); }
  for (const [mName, m] of Object.entries(s.machine ? { _self: s.machine } : {})) {
    // machine is single; special-cased below.
    void mName;
    const id = m.id ? quote(m.id) : '';
    const rest = omit(m, ['id']);
    push(1, `machine: ${id} {`); emitProps(rest, 2, push); push(1, '}');
  }
  for (const [yName, y] of entries(s.yarn)) {
    push(1, `yarn ${quote(yName)}: {`); emitProps(omit(y, ['_name']), 2, push); push(1, '}');
  }
  if (s.garment) {
    const kind = s.garment.kind || '';
    const rest = omit(s.garment, ['kind']);
    push(1, `garment: ${kind} {`); emitProps(rest, 2, push); push(1, '}');
  }
  for (const [cName, c] of entries(s.chart)) {
    push(1, `chart ${quote(cName)}: {`); emitProps(omit(c, ['_name']), 2, push); push(1, '}');
  }
  for (const key of ['swatch', 'compile', 'budget', 'timeline', 'production']) {
    if (s[key]) { push(1, `${key} {`); emitProps(s[key], 2, push); push(1, '}'); }
  }
  for (const [wName, w] of entries(s.colorway)) {
    push(1, `colorway ${quote(wName)}: {`); emitProps(omit(w, ['_name']), 2, push); push(1, '}');
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

/** Emit `key: value` lines for a flat/nested props object. */
function emitProps(obj, indent, push) {
  for (const [k, v] of entries(obj)) {
    if (k.startsWith('_')) continue; // internal bookkeeping keys
    push(indent, `${k}: ${formatValue(v)}`);
  }
}

/** Render one value node (already-interpreted JS value) as KnitScript source text. */
export function formatValue(v) {
  if (v == null) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return looksLikeIdent(v) ? v : quote(v);
  if (Array.isArray(v)) return '[' + v.map(formatValue).join(', ') + ']';
  if (typeof v === 'object') {
    // A length: { value, unit } with a scalar value.
    if (typeof v.value === 'number' && typeof v.unit === 'string' && Object.keys(v).length === 2) {
      return `${v.value}${v.unit}`;
    }
    // A pair: { left, right, sep }.
    if ('left' in v && 'right' in v && 'sep' in v && Object.keys(v).length === 3) {
      const sep = v.sep === '×' || v.sep === '/' ? v.sep : ` ${v.sep} `;
      return `${formatValue(v.left)}${sep}${formatValue(v.right)}`;
    }
    // A colour string already handled above; inline object. A typed object keeps its
    // tag OUTSIDE the braces (`crew { … }`) — the only form the parser accepts.
    const inner = entries(v).filter(([k]) => !k.startsWith('_')).map(([k, val]) => `${k}: ${formatValue(val)}`).join(', ');
    const body = `{ ${inner} }`.replace(/\{ \}/, '{}').replace(/\s+}/, ' }');
    return v._kind ? `${v._kind} ${body}` : body;
  }
  return String(v);
}

/** Copy an object without the given keys. */
function omit(obj, keys) {
  const drop = new Set(keys);
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (!drop.has(k)) out[k] = v;
  return out;
}

function entries(obj) { return obj && typeof obj === 'object' ? Object.entries(obj) : []; }

/** Wrap a string in double quotes with minimal escaping. */
function quote(str) {
  return '"' + String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

/** A bare identifier is safe unquoted: snake/camel word with no spaces or symbols. */
function looksLikeIdent(str) {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(str) && !/^(true|false|project|out|of)$/.test(str);
}
