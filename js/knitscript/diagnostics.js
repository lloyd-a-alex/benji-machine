/**
 * KNITCAT V2 — KnitScript diagnostics.
 *
 * Turns the {@link module:knitscript/parser.ParseError} and the soft semantic notes
 * produced by the type-checker into friendly, source-pointed messages the UI can show
 * in the KnitScript editor. The important job is the caret: given the original text and
 * an error with a line/column, render the offending line with a `^` under it so a
 * person sees *exactly* where the file stopped making sense.
 *
 * DOM-free: pure string and object work.
 *
 * @module knitscript/diagnostics
 */

/**
 * @typedef {object} Diagnostic
 * @property {'error'|'warning'|'info'} severity
 * @property {string} message
 * @property {number} [line]
 * @property {number} [column]
 * @property {string} [rule]  a stable id like `unknown-unit`
 */

/**
 * Format one error (a ParseError or a plain {message,line,column}) with a source caret.
 * @param {string} src  the original KnitScript text
 * @param {{message:string,line?:number,column?:number}} err
 * @returns {string} e.g. `line 4, col 12: … \n   bust: 96cm\n          ^`
 */
export function formatError(src, err) {
  const line = Math.max(1, err.line || 1);
  const col = Math.max(1, err.column || 1);
  const head = `line ${line}, col ${col}: ${err.message}`;
  const lines = String(src == null ? '' : src).split(/\r?\n/);
  const snippet = lines[line - 1];
  if (snippet === undefined) return head;
  const gutter = String(line).length;
  const prefix = ' '.repeat(gutter);
  const caret = `${prefix} | ${snippet}\n${prefix} | ${' '.repeat(Math.max(0, col - 1))}^`;
  return `${head}\n${prefix} | ${snippet}\n${caret}`;
}

/**
 * Normalise any thrown value from the parser/interpreter into a Diagnostic. Never
 * throws — a diagnostic layer that itself blows up would be worse than the bug it
 * reports — so an unexpected shape degrades to an `{ severity:'error' }` note.
 * @param {*} thrown
 * @returns {Diagnostic}
 */
export function toDiagnostic(thrown) {
  if (thrown && typeof thrown === 'object' && typeof thrown.message === 'string') {
    return {
      severity: 'error',
      message: thrown.message,
      line: Number.isFinite(thrown.line) ? thrown.line : undefined,
      column: Number.isFinite(thrown.column) ? thrown.column : undefined,
      rule: thrown.rule || (thrown.name === 'ParseError' ? 'parse' : 'runtime')
    };
  }
  return { severity: 'error', message: String(thrown == null ? 'Unknown error' : thrown), rule: 'unknown' };
}

/**
 * A tiny summariser for the console panel: "2 errors, 1 warning" plus the first few
 * formatted lines. Keeps the whole thing to a couple of lines so it fits a toast.
 * @param {string} src
 * @param {Diagnostic[]} diags
 * @returns {string}
 */
export function summarize(src, diags = []) {
  const list = Array.isArray(diags) ? diags : [];
  const errors = list.filter(d => d.severity === 'error').length;
  const warnings = list.filter(d => d.severity === 'warning').length;
  const parts = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  if (!parts.length) return 'KnitScript OK.';
  const first = list.find(d => d.severity === 'error') || list[0];
  const detail = first ? formatError(src, first).split('\n')[0] : '';
  return `${parts.join(', ')}${detail ? ` — ${detail}` : ''}`;
}
