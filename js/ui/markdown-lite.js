/**
 * KNITCAT — Minimal Markdown → HTML renderer (DOM-free).
 *
 * The compiler's written-backend produces a constrained subset of Markdown (headings, bullet
 * lists, numbered steps, italic notes, bold emphasis, paragraph breaks). This module converts
 * that subset into safe inline-styled HTML suitable for the V2 panel output pane.
 *
 * Security: all input is HTML-escaped BEFORE pattern matching so user-supplied project names
 * (which flow through the backend) cannot inject scripts.
 *
 * @module ui/markdown-lite
 */

/** Escape the 5 XML-significant characters. */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert a Markdown string to formatted HTML.
 * Supports: `#`/`##`/`###` headings, `- ` unordered lists, `N. ` ordered lists,
 * `**bold**`, `*italic*`, blank-line separation, and inline paragraphs.
 *
 * @param {string} md – raw Markdown (will be HTML-escaped internally).
 * @returns {string} safe HTML with inline styles (no external CSS required).
 */
export function renderMarkdownLite(md) {
  if (!md || typeof md !== 'string') return '';
  const safe = esc(md);
  const lines = safe.split('\n');
  const out = [];
  let inUl = false;
  let inOl = false;
  const closeList = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };
  for (const raw of lines) {
    // Apply inline emphasis first (works on escaped text since * isn't escaped).
    const line = raw
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');

    if (/^### (.+)/.test(line)) {
      closeList();
      out.push(`<h4 style="margin:8px 0 3px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;opacity:.7">${line.slice(4)}</h4>`);
    } else if (/^## (.+)/.test(line)) {
      closeList();
      out.push(`<h3 style="margin:10px 0 4px;font-size:13px;font-weight:600;color:var(--accent)">${line.slice(3)}</h3>`);
    } else if (/^# (.+)/.test(line)) {
      closeList();
      out.push(`<h2 style="margin:6px 0 6px;font-size:15px;font-weight:700">${line.slice(2)}</h2>`);
    } else if (/^- (.+)/.test(line)) {
      if (!inUl) { closeList(); out.push('<ul style="margin:2px 0 6px;padding-left:18px">'); inUl = true; }
      out.push(`<li>${line.slice(2)}</li>`);
    } else if (/^\d+\.\s+(.+)/.test(line)) {
      if (!inOl) { closeList(); out.push('<ol style="margin:2px 0 6px;padding-left:20px">'); inOl = true; }
      out.push(`<li>${line.replace(/^\d+\.\s+/, '')}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p style="margin:2px 0">${line}</p>`);
    }
  }
  closeList();
  return out.join('');
}
