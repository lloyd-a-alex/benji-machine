/**
 * KNITCAT — one tiny HTML-escaping helper, shared by every module that builds
 * markup from user-authored strings (project names, labels, links). Previously
 * the menu bar, the context menu and the Studio each carried a private copy; this
 * is the single source so an escaping rule can never drift between surfaces.
 *
 * DOM-free at import — it is pure string work.
 *
 * @module ui/text
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape a value for safe interpolation into HTML text or a double-quoted attr.
 * @param {any} s
 * @returns {string}
 */
export function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ESCAPES[m]);
}
