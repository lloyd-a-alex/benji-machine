/**
 * Printing, without a popup.
 *
 * Several features need paper: the punched-card sheet, the QR code pinned to a
 * project, the row-counter strip, the gauge card, the pattern booklet. The old
 * export path did `window.open(...)` and wrote into the new window, which modern
 * browsers either block outright (it is not a user-gesture-initiated navigation in
 * the way popup blockers define one) or leave as a blank tab.
 *
 * A same-origin `<iframe>` needs no permission at all: the browser treats its
 * `print()` as part of the current page, so the print dialog appears immediately.
 * Everything is composed off-screen, printed, and removed.
 *
 * The page written into the frame is deliberately self-contained — its own styles,
 * millimetre units and a print rule — because the app's dark CAD theme is exactly
 * the wrong thing to send to an inkjet.
 */

const BASE_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body {
    font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 11pt; line-height: 1.45;
  }
  h1 { font-size: 17pt; margin: 0 0 2mm; }
  h2 { font-size: 13pt; margin: 6mm 0 2mm; }
  p  { margin: 0 0 2mm; }
  small, .fine { font-size: 8.5pt; color: #444; }
  table { border-collapse: collapse; }
  .page { padding: 10mm; }
  .grid { display: grid; gap: 4mm; }
  svg { max-width: 100%; height: auto; }
  @page { margin: 8mm; }
  @media print {
    .page { padding: 0; }
    .no-print { display: none !important; }
    a[href]::after { content: ""; }
  }
  @media screen {
    body { background: #e5e7eb; }
    .page { max-width: 200mm; margin: 0 auto; background: #fff; box-shadow: 0 0 12px rgba(0,0,0,.18); }
  }
`;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Named CSS page sizes, with an optional orientation, or an explicit dimension. */
const PAGE_SIZE = new RegExp([
  '^(?:',
  'A[0-6]|B[0-6]|Letter|Legal|Tabloid|Ledger|Junior|Statement|Executive',
  '|[0-9]{1,3}(\\.[0-9])?(mm|cm|in|pt|px|pc)( [0-9]{1,3}(\\.[0-9])?(mm|cm|in|pt|px|pc))?',
  ')( (portrait|landscape))?$'
].join(''), 'i');

/** A complete, printable HTML document from a title and a body fragment. */
export function buildPrintDocument({ title = 'KNITCAT', body = '', styles = '', page = 'A4' } = {}) {
  const size = PAGE_SIZE.test(String(page).trim()) ? String(page).trim() : 'A4';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${BASE_STYLES}
@page { size: ${size}; }${styles}</style>
</head>
<body><div class="page">${body}</div></body>
</html>`;
}

/**
 * Print a composed document.
 *
 * @param {object} options
 * @param {string} options.title   browser tab / printed document name
 * @param {string} options.body    HTML fragment for the page
 * @param {string} [options.styles] extra CSS, appended after the base
 * @param {string} [options.page]   `A4`, `Letter`, or a size like `80mm 297mm`
 * @param {(html: string) => boolean} [options.open]  injected sink, for tests
 * @returns {{ok: boolean, html?: string, error?: string, method: string}}
 */
export function printHtml(options = {}) {
  const html = buildPrintDocument(options);
  const sink = options.open || defaultSink;
  try {
    const done = sink(html, options.title);
    return done === false
      ? { ok: false, html, method: 'iframe', error: 'The browser would not open a print frame.' }
      : { ok: true, html, method: 'iframe' };
  } catch (err) {
    return { ok: false, html, method: 'none', error: err?.message || 'Printing failed.' };
  }
}

function defaultSink(html) {
  if (typeof document === 'undefined') return false;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', 'print');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return false;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const win = frame.contentWindow;
  const finish = () => setTimeout(() => frame.remove(), 1200);
  win.addEventListener?.('afterprint', finish, { once: true });
  // Images and fonts inside the fragment need a beat before the pagination is right.
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch (_) {
      frame.remove();
    }
    // If the browser never fires afterprint (Firefox does this on some builds),
    // the frame still has to leave the document or the next print is stale.
    setTimeout(finish, 12000);
  }, 250);
  return true;
}

/** A4 / Letter at 300 DPI and in millimetres — the numbers print shops ask for. */
export const PAPER = Object.freeze({
  A4: { label: 'A4 portrait', mm: [210, 297], px300: [2480, 3508] },
  Letter: { label: 'US Letter portrait', mm: [215.9, 279.4], px300: [2550, 3300] }
});

export { escapeHtml };
