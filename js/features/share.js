/**
 * Share & Links — hand a card to someone else without a server.
 *
 * Four ways out, in descending order of how much the browser can do by itself:
 *
 *   1. a link that *contains* the pattern (`#p=…`, see js/project/url-state.js)
 *   2. a QR code of that link, for a phone across the room
 *   3. the native share sheet (`navigator.share`), which on a phone means WhatsApp,
 *      Messages, Mail, AirDrop… without KNITCAT knowing or caring which
 *   4. a file, either through the Save dialog or a plain download
 *
 * Plus two things that are not really different code paths: a branded PNG card for
 * posting, and mailto/sms/Discord links for the cases where a share sheet is absent.
 *
 * The DOM half of this module is a sidebar panel and one modal. The pure half —
 * payload building, link reading, channel lists, the branded-card layout — is
 * exported separately and exercised by `node --test`.
 */

import {
  encodeCard, decodeCard, buildShareUrl, readShareUrl, stripShareUrl, PRACTICAL_URL_LIMIT
} from '../project/url-state.js';
import { encodeQr, qrToSvg, drawQrToCanvas, byteCapacity } from '../exporters/qr-code.js';
import { buildProjectDocument } from '../project/kcard.js';
import { printHtml, escapeHtml } from '../ui/printing.js';

const STYLE_ID = 'knitcat-share-style';
const PANEL_ID = 'kx-share-panel';

const CSS = `
.kx-share{display:flex;flex-direction:column;gap:8px}
.kx-share-row{display:flex;flex-wrap:wrap;gap:6px}
.kx-share-row .btn-action{flex:1 1 auto;font-size:11px;padding:7px 9px}
.kx-share-note{font-size:10px;color:var(--text-muted,#64748b);line-height:1.5}
.kx-link{display:flex;gap:6px;align-items:stretch}
.kx-link input{flex:1 1 auto;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:11px;padding:7px 9px;border-radius:var(--radius-md,8px);
  border:1px solid var(--border-subtle,#1e293b);background:var(--bg-inset,#0b1020);color:var(--text-secondary,#94a3b8)}
.kx-meter{height:4px;border-radius:999px;background:var(--border-subtle,#1e293b);overflow:hidden}
.kx-meter-fill{height:100%;width:0;background:var(--accent-emerald,#34d399);transition:width .2s ease}
.kx-meter-fill--warn{background:var(--accent-amber,#fbbf24)}
.kx-meter-fill--bad{background:var(--accent-rose,#f43f5e)}
.kx-qr-wrap{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
.kx-qr-canvas{image-rendering:pixelated;border-radius:var(--radius-md,8px);
  max-width:min(260px,60vw);height:auto;background:#fff}
.kx-qr-side{flex:1 1 220px;min-width:0}
.kx-channels{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.kx-channels a,.kx-channels button{font-size:11px;padding:6px 9px;border-radius:999px;
  border:1px solid var(--border-subtle,#1e293b);color:var(--text-secondary,#94a3b8);
  text-decoration:none;background:transparent;cursor:pointer;font-family:inherit}
.kx-channels a:hover,.kx-channels button:hover{color:var(--text-primary,#f8fafc);border-color:var(--border-active,#38bdf8)}
.kx-verify{font-size:10px;margin-top:6px;color:var(--text-muted,#64748b)}
.kx-verify--ok{color:var(--accent-emerald,#34d399)}
.kx-verify--bad{color:var(--accent-rose,#f43f5e)}
@media (max-width:720px){
  .kx-qr-wrap{flex-direction:column;align-items:center}
  .kx-qr-side{width:100%}
  .kx-link{flex-direction:column}
}
@media (forced-colors:active){.kx-link input,.kx-channels a,.kx-channels button{border-color:CanvasText}}
`;

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ─── pure: building a payload ────────────────────────────────────────────────

/**
 * @param {object} snapshot { mode, profileId, stitchMatrix, name }
 * @param {object} [options] { base, limit }
 * @returns {{ok:boolean, url?:string, code?:string, chars?:number, tooLong?:boolean, error?:string}}
 */
export function createSharePayload(snapshot = {}, options = {}) {
  const limit = options.limit ?? PRACTICAL_URL_LIMIT;
  const encoded = encodeCard(snapshot);
  if (!encoded.ok) return { ok: false, error: encoded.error };
  const url = buildShareUrl(encoded.code, { base: options.base });
  return {
    ok: true,
    code: encoded.code,
    url,
    chars: encoded.chars,
    bytes: encoded.bytes,
    tooLong: encoded.chars > limit,
    limit,
    urlChars: url.length
  };
}

/** Turn a decoded link into the document shape `loadProjectText` already accepts. */
export function incomingShareDocument(card, options = {}) {
  const rows = card.rows || (Array.isArray(card.stitchMatrix) ? card.stitchMatrix.length : 0);
  const cols = card.cols || (Array.isArray(card.stitchMatrix?.[0]) ? card.stitchMatrix[0].length : 0);
  return buildProjectDocument({
    profileId: card.profileId || undefined,
    mode: card.mode,
    rows,
    cols,
    stitchMatrix: card.stitchMatrix,
    name: options.name || 'Shared card',
    notes: options.notes || `Opened from a KNITCAT share link on ${new Date().toLocaleDateString()}.`,
    meta: { sharedVia: 'link', codecVersion: card.codecVersion || null }
  });
}

/**
 * Apply a `#p=…` link found in the address bar. Deliberately injected rather than
 * reaching for `location` so the whole boot path is testable.
 *
 * @param {object} options
 * @param {string} options.href
 * @param {(doc: object, label: string) => boolean} options.load
 * @param {() => void} [options.clean]
 */
export function applyIncomingShare(options = {}) {
  const { href, load, clean = () => {}, decode = decodeCard } = options;
  const code = readShareUrl(href);
  if (!code) return { found: false, ok: false };
  const result = decode(code);
  if (!result.ok) return { found: true, ok: false, error: result.error, code };
  const doc = incomingShareDocument(result.card, {
    name: `Shared card (${result.card.rows}×${result.card.cols})`,
    notes: result.note || null
  });
  const applied = load(doc, 'a shared link');
  if (applied) clean();
  return { found: true, ok: applied, card: result.card, note: result.note || null };
}

// ─── pure: the channels themselves ───────────────────────────────────────────

/**
 * Everything a desktop browser without a share sheet can still do: hand the user a
 * pre-filled message in an app they already have. `mailto:` and `sms:` need no
 * account, no key and no network; the Discord/Slack entry copies a message shaped
 * for a chat, because those have no URL scheme that a static page may open.
 */
export function shareChannels({ url, title = 'A KNITCAT card', note = '' } = {}) {
  if (typeof url !== 'string' || !url) return [];
  const subject = `${title} — KNITCAT`;
  const body = note ? `${note}\n\n${url}` : url;
  const chat = `${title}\n${url}\n\n_Drawn in KNITCAT: open the link and the card loads itself._`;
  return [
    {
      id: 'copy',
      label: 'Copy link',
      action: 'copy',
      copy: url
    },
    {
      id: 'chat',
      label: 'Copy for Discord / Slack',
      action: 'copy',
      copy: chat
    },
    {
      id: 'email',
      label: 'Email',
      href: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    },
    {
      id: 'sms',
      label: 'Text message',
      href: `sms:?&body=${encodeURIComponent(body)}`
    },
    {
      id: 'qr',
      label: 'QR code',
      action: 'qr'
    }
  ];
}

/**
 * Copy to the clipboard, with the fallback that still works when the page is not
 * focused, not secure, or on a browser without the async clipboard.
 */
export async function copyText(text, { doc = typeof document !== 'undefined' ? document : null } = {}) {
  if (typeof text !== 'string') return { ok: false, error: 'Nothing to copy.' };
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return { ok: true, method: 'clipboard-api' };
    }
  } catch (err) {
    if (!doc) return { ok: false, error: err?.message || 'Clipboard refused.' };
  }
  if (!doc?.createElement) return { ok: false, error: 'This browser will not hand data to the clipboard.' };
  try {
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
    doc.body.appendChild(area);
    area.select();
    area.setSelectionRange?.(0, text.length);
    const done = doc.execCommand ? doc.execCommand('copy') : false;
    area.remove();
    return done
      ? { ok: true, method: 'execCommand' }
      : { ok: false, error: 'Select the link and copy it by hand — the browser blocked the automatic copy.' };
  } catch (err) {
    return { ok: false, error: err?.message || 'Copy failed.' };
  }
}

// ─── pure: the branded share card ────────────────────────────────────────────

/**
 * Layout for the image version of a card: a 1200×630 social card whose chart is
 * drawn at the largest cell size that fits, with the QR in the corner.
 */
export function cardLayout(input = {}) {
  const width = input.width ?? 1200;
  const height = input.height ?? 630;
  const padding = input.padding ?? 48;
  const rows = Math.max(1, Number(input.rows) || 1);
  const cols = Math.max(1, Number(input.cols) || 1);
  const chartArea = {
    x: padding,
    y: padding + 74,
    w: Math.max(8, width - padding * 2 - (input.qr ? 210 : 0)),
    h: Math.max(8, height - padding - (padding + 74) - 66)
  };
  // Fractional cells on purpose: a 2 000-needle card cannot be shown at one pixel
  // per cell whatever the canvas is, and a chart that quietly overflowed the image
  // would be worse than one drawn at two tenths of a pixel — still the whole card.
  const cell = Math.min(chartArea.w / cols, chartArea.h / rows, 28);
  const chart = {
    x: chartArea.x,
    y: chartArea.y,
    w: cell * cols,
    h: cell * rows,
    cell
  };
  return {
    width,
    height,
    padding,
    cell,
    chart,
    title: { x: padding, y: padding + 34, size: 30 },
    caption: { x: padding, y: Math.min(height - padding, chart.y + chart.h + 34), size: 15 },
    brand: { x: width - padding, y: height - padding + 10, size: 15 },
    qr: input.qr ? { x: width - padding - 170, y: height - padding - 170, size: 170 } : null
  };
}

/**
 * Paint the branded card. Takes a 2D context so tests can pass a recorder and the
 * browser can pass a canvas — no DOM required.
 */
export function drawBrandedCard(ctx, options = {}) {
  const {
    snapshot = {}, qr = null, title = 'Untitled card', caption = '',
    width = 1200, height = 630, isLace = false
  } = options;
  const matrix = Array.isArray(snapshot.stitchMatrix) ? snapshot.stitchMatrix : [];
  const rows = matrix.length || snapshot.rows || 0;
  const cols = (Array.isArray(matrix[0]) ? matrix[0].length : snapshot.cols) || 0;
  const layout = cardLayout({ width, height, rows: rows || 1, cols: cols || 1, qr });

  ctx.save();
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createLinearGradient?.(0, 0, width, height);
  if (glow) {
    glow.addColorStop(0, 'rgba(56,189,248,0.16)');
    glow.addColorStop(1, 'rgba(244,63,94,0.10)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f8fafc';
  ctx.font = `700 ${layout.title.size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(String(title).slice(0, 58), layout.title.x, layout.title.y);

  // The chart.
  ctx.fillStyle = 'rgba(15,23,42,0.55)';
  ctx.fillRect(layout.chart.x - 8, layout.chart.y - 8, layout.chart.w + 16, layout.chart.h + 16);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const value = matrix[r]?.[c];
      const x = layout.chart.x + c * layout.cell;
      const y = layout.chart.y + r * layout.cell;
      const punched = isLace ? String(value) !== 'K' && value !== 0 && value !== null && value !== '' : Boolean(value);
      if (!punched) continue;
      ctx.fillStyle = isLace ? '#38bdf8' : '#f8fafc';
      if (layout.cell >= 6) {
        ctx.beginPath();
        ctx.arc(x + layout.cell / 2, y + layout.cell / 2, Math.max(1.2, layout.cell * 0.31), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Below six pixels a hole punched in a card is a square, not a circle.
        const side = Math.max(0.25, layout.cell * 0.86);
        ctx.fillRect(x + (layout.cell - side) / 2, y + (layout.cell - side) / 2, side, side);
      }
    }
  }

  ctx.fillStyle = '#cbd5e1';
  ctx.font = `500 ${layout.caption.size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(String(caption || `${rows} rows × ${cols} needles`).slice(0, 120), layout.caption.x, layout.caption.y);

  ctx.fillStyle = '#94a3b8';
  ctx.font = `700 ${layout.brand.size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText('KNITCAT · knit the cat', layout.brand.x, layout.brand.y);
  ctx.textAlign = 'left';

  if (qr && layout.qr) {
    const scale = layout.qr.size / (qr.size + 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(layout.qr.x - 6, layout.qr.y - 6, layout.qr.size + 12, layout.qr.size + 12);
    ctx.fillStyle = '#0b1020';
    for (let r = 0; r < qr.size; r++) {
      for (let c = 0; c < qr.size; c++) {
        if (!qr.modules[r][c]) continue;
        ctx.fillRect(layout.qr.x + c * scale, layout.qr.y + r * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }
  }
  ctx.restore();
  return layout;
}

// ─── the printable QR sheet ───────────────────────────────────────────────────

/** HTML for a labelled QR sheet: big enough to scan from a metre away. */
export function qrSheetHtml({ svg = '', url = '', title = 'Untitled card', caption = '' } = {}) {
  const hint = 'Scan to open this card in KNITCAT — nothing is uploaded, the pattern is inside the link.';
  return `
<h1>${escapeHtml(title)}</h1>
<div style="display:flex;gap:10mm;align-items:flex-start;flex-wrap:wrap">
  <div>${svg}</div>
  <div style="flex:1 1 60mm;min-width:60mm">
    <h2>Scan me</h2>
    <p>${escapeHtml(hint)}</p>
    <p class="fine" style="word-break:break-all">${escapeHtml(url)}</p>
    <p class="fine">${escapeHtml(caption)}</p>
  </div>
</div>
<p class="fine">KNITCAT · knitting-machine CAD · printed ${escapeHtml(new Date().toLocaleDateString())}</p>`;
}

// ─── DOM layer ───────────────────────────────────────────────────────────────

/**
 * @param {object} context
 * @param {object} [context.notifier]
 * @param {() => object} context.snapshot
 * @param {(doc: object, label: string) => boolean} [context.applyDocument]
 * @param {(doc: object, filename: string) => void} [context.download]
 * @param {object} [context.fileBridge]              the File System Access bridge
 * @param {string} [context.base]                    page URL, injectable for tests
 */
export function initShare(context = {}) {
  if (typeof document === 'undefined') return null;
  injectStyles();
  const { notifier = null, snapshot = () => ({}), base = null } = context;

  // Refuse to build a link before there is anything to link to.
  const build = () => createSharePayload(snapshot(), { base: base || undefined });

  const sidebar = document.getElementById('right-sidebar');
  if (!sidebar) return null;
  const panel = document.createElement('div');
  panel.className = 'sidebar-panel';
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="sidebar-title"><span>Share &amp; Links</span></div>
    <div class="kx-share">
      <div class="kx-share-row">
        <button type="button" class="btn-action btn-primary" id="kx-btn-share" title="Link, QR, image or the native share sheet">Share this card</button>
        <button type="button" class="btn-action" id="kx-btn-copy-quick" title="Copy a link with the pattern inside it">Copy link</button>
      </div>
      <div class="kx-share-row">
        <button type="button" class="btn-action" id="kx-btn-open-link" title="Open a KNITCAT link you were sent" style="flex:1 1 100%">Open a shared link…</button>
      </div>
      <p class="kx-share-note" id="kx-share-note">A KNITCAT link carries the card inside itself, so it works with no account and no server.</p>
    </div>`;
  sidebar.insertBefore(panel, sidebar.lastElementChild);

  panel.querySelector('#kx-btn-share').addEventListener('click', () => openModal());
  panel.querySelector('#kx-btn-copy-quick').addEventListener('click', () => copyCurrent());
  panel.querySelector('#kx-btn-open-link').addEventListener('click', () => promptForLink());

  let modal = null;
  let currentQr = null;

  function setNote(text) {
    const note = panel.querySelector('#kx-share-note');
    if (note) note.textContent = text;
  }

  async function copyCurrent() {
    const payload = build();
    if (!payload.ok) {
      notifier?.warn?.(payload.error, { duration: 6000 });
      return false;
    }
    if (payload.tooLong) {
      notifier?.warn?.('This card is too big for a comfortable link.', {
        details: `${payload.chars} characters — a QR code and most chat apps stop far sooner. Save a .kcard file instead, or shrink the chart.`,
        duration: 9000
      });
      return false;
    }
    const copied = await copyText(payload.url);
    if (copied.ok) {
      setNote(`Link copied — ${payload.chars} characters, and the whole card is inside it.`);
      notifier?.success?.('Share link copied.', { details: 'Anyone who opens it sees this exact card.', duration: 4000 });
      return true;
    }
    notifier?.error?.('The browser would not copy the link.', { details: copied.error, duration: 8000 });
    return false;
  }

  function promptForLink() {
    const href = typeof window !== 'undefined' && typeof window.prompt === 'function'
      ? window.prompt('Paste a KNITCAT share link', '')
      : null;
    if (!href) return false;
    const result = applyIncomingShare({
      href: href.trim(),
      load: context.applyDocument || (() => false),
      clean: stripShareUrl
    });
    if (!result.found) {
      notifier?.error?.('That link has no KNITCAT card in it.', { details: 'A share link looks like …index.html#p=ABCDEFG.', duration: 8000 });
      return false;
    }
    if (!result.ok) {
      notifier?.error?.('That link could not be read.', { details: result.error, duration: 9000 });
      return false;
    }
    if (result.note) notifier?.info?.(result.note, { duration: 7000 });
    return true;
  }

  function openModal() {
    const payload = build();
    if (!payload.ok) {
      notifier?.warn?.(payload.error, { duration: 6000 });
      return;
    }
    modal?.remove();
    const state = snapshot() || {};
    const cardTitle = (state.name || 'KNITCAT card').slice(0, 80);
    const caption = `${state.rows ?? state.stitchMatrix?.length ?? '?'} rows × ${state.cols ?? state.stitchMatrix?.[0]?.length ?? '?'} needles · ${state.mode || 'lace'} · ${state.profileId || 'default machine'}`;
    const qr = encodeQr(payload.url);
    currentQr = qr.ok ? qr : null;

    const body = `
      <p class="kx-share-note" style="margin:0 0 10px">
        The card lives in the <code>#p=…</code> part of the link, which a web server never
        receives. There is nothing to log in to and nothing to expire: the link <em>is</em> the file.
      </p>
      <div class="kx-link">
        <input type="text" id="kx-share-url" readonly value="${escapeHtml(payload.url)}" aria-label="Share link">
        <button type="button" class="btn-action" id="kx-btn-copy">Copy</button>
      </div>
      <div class="kx-meter" style="margin-top:8px" aria-hidden="true"><div class="kx-meter-fill" id="kx-meter"></div></div>
      <p class="kx-share-note" id="kx-size-note"></p>
      <div class="kx-qr-wrap" style="margin-top:12px">
        <div class="kx-qr-side">
          <div class="kx-channels" id="kx-channels"></div>
          <p class="kx-verify" id="kx-verify"></p>
        </div>
      </div>
      ${qr.ok ? '' : `<p class="kx-share-note" id="kx-qr-refused">${escapeHtml(qr.error)}</p>`}`;

    modal = modalShell('kx-share-modal', `Share “${escapeHtml(cardTitle)}”`, body, `Share “${cardTitle}”`);
    modal.querySelector('#kx-share-url').addEventListener('click', e => e.target.select?.());
    const fill = modal.querySelector('#kx-meter');
    const ratio = Math.min(1, payload.chars / payload.limit);
    fill.style.width = `${Math.round(ratio * 100)}%`;
    fill.classList.add(ratio > 1 ? 'kx-meter-fill--bad' : ratio > 0.75 ? 'kx-meter-fill--warn' : 'kx-meter-fill--ok');
    modal.querySelector('#kx-size-note').textContent = payload.tooLong
      ? `${payload.chars} characters is past the ${payload.limit} KNITCAT will promise a link for. Use the file below.`
      : `${payload.chars} characters · ${payload.bytes} bytes of card · the QR holds ${byteCapacity(5)} bytes, so ${qr.ok ? 'this one scans' : 'this one is too big for the QR'}.`;
    modal.querySelector('#kx-btn-copy').addEventListener('click', async () => {
      const input = modal.querySelector('#kx-share-url');
      input.select?.();
      const copied = await copyText(payload.url);
      modal.querySelector('#kx-btn-copy').textContent = copied.ok ? 'Copied ✓' : 'Copy it by hand';
      if (!copied.ok) notifier?.error?.(copied.error, { duration: 8000 });
    });

    const channels = shareChannels({ url: payload.url, title: cardTitle, note: caption });
    const box = modal.querySelector('#kx-channels');
    if (canNativeShare()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Share…';
      btn.addEventListener('click', () => nativeShare({ title: cardTitle, text: caption, url: payload.url }));
      box.appendChild(btn);
    }
    for (const channel of channels) {
      const el = document.createElement(channel.href ? 'a' : 'button');
      el.textContent = channel.label;
      if (channel.href) {
        el.href = channel.href;
        el.rel = 'noopener noreferrer';
        if (channel.id === 'email' || channel.id === 'sms') el.target = '_blank';
      } else {
        el.type = 'button';
        el.addEventListener('click', () => {
          if (channel.action === 'copy') {
            copyText(channel.copy).then(done => {
              el.textContent = done.ok ? `${channel.label} ✓` : channel.label;
              if (!done.ok) notifier?.error?.(done.error, { duration: 8000 });
            });
          } else if (channel.action === 'qr') {
            printQrSheet({ payload, cardTitle, caption });
          }
        });
      }
      box.appendChild(el);
    }

    const png = document.createElement('button');
    png.type = 'button';
    png.textContent = 'Download share image (PNG)';
    png.addEventListener('click', () => exportCardImage({ payload, cardTitle, caption }));
    box.appendChild(png);

    const file = document.createElement('button');
    file.type = 'button';
    file.textContent = 'Save .kcard file';
    file.addEventListener('click', () => context.saveFile?.());
    box.appendChild(file);

    if (qr.ok) {
      const canvas = document.createElement('canvas');
      canvas.className = 'kx-qr-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `QR code of the share link for ${cardTitle}`);
      drawQrToCanvas(canvas, qr, { scale: 6 });
      modal.querySelector('.kx-qr-wrap').prepend(canvas);
      verifyQr(canvas, payload.url);
    }
    setTimeout(() => modal.querySelector('#kx-btn-copy')?.focus({ preventScroll: true }), 0);
  }

  function canNativeShare() {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  async function nativeShare(data) {
    if (!canNativeShare()) {
      // Safari desktop has no share sheet; say so rather than doing nothing.
      notifier?.info?.('This browser has no share sheet, so here is the link instead.', { duration: 6000 });
      const copied = await copyText(data.url);
      return copied.ok;
    }
    try {
      await navigator.share(data);
      return true;
    } catch (err) {
      // Cancel is not an error worth shouting about.
      if (err?.name === 'AbortError') return false;
      notifier?.warn?.('The share sheet refused that.', { details: err?.message, duration: 7000 });
      return false;
    }
  }

  async function printQrSheet({ payload, cardTitle, caption }) {
    const qr = encodeQr(payload.url);
    if (!qr.ok) {
      notifier?.warn?.('This link is too long for a QR code here.', { details: qr.error, duration: 8000 });
      return false;
    }
    const result = printHtml({
      title: `${cardTitle} — KNITCAT QR`,
      body: qrSheetHtml({ svg: qrToSvg(qr, { scale: 8, label: cardTitle }), url: payload.url, title: cardTitle, caption }),
      page: 'A5 portrait'
    });
    if (!result.ok) notifier?.error?.('Printing did not start.', { details: result.error, duration: 8000 });
    return result.ok;
  }

  /** The branded PNG, drawn on an offscreen canvas at 2× so it stays sharp. */
  function exportCardImage({ payload, cardTitle, caption }) {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) {
      notifier?.error?.('This browser cannot draw the share image.', { duration: 7000 });
      return false;
    }
    const qr = encodeQr(payload.url);
    drawBrandedCard(ctx, {
      snapshot: snapshot(),
      qr: qr.ok ? qr : null,
      title: cardTitle,
      caption,
      isLace: (snapshot().mode || 'lace') === 'lace'
    });
    canvas.toBlob(blob => {
      if (!blob) {
        notifier?.error?.('The browser gave back an empty image.', { duration: 7000 });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cardTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'knitcat'}-card.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      notifier?.success?.('Share image saved.', { details: '1200×630, sized for a chat preview.', duration: 4500 });
    }, 'image/png');
    return true;
  }

  /**
   * If the browser ships a barcode decoder, read our own symbol back. This is the
   * only way a static page can prove the QR will scan, so it is reported.
   */
  async function verifyQr(canvas, expected) {
    const line = modal?.querySelector('#kx-verify');
    if (!line) return;
    const Detector = globalThis.BarcodeDetector;
    if (typeof Detector !== 'function') {
      line.textContent = 'This browser cannot check its own QR code — worth one scan with your phone.';
      return;
    }
    try {
      const detector = new Detector({ formats: ['qr_code'] });
      const found = await detector.detect(canvas);
      const text = found?.[0]?.rawValue;
      if (text === expected) {
        line.textContent = 'Verified: this browser reads the code back exactly.';
        line.classList.add('kx-verify--ok');
      } else {
        line.textContent = text ? 'The scanned text differs from the link — do not trust this code.' : 'Nothing was detected in the code we just drew.';
        line.classList.add('kx-verify--bad');
      }
    } catch (err) {
      line.textContent = `Could not check the code: ${err?.message || 'decoder failed'}`;
    }
  }

  return {
    open: openModal,
    copyLink: copyCurrent,
    promptForLink,
    printQrSheet: () => printQrSheet({ payload: build(), cardTitle: snapshot()?.name || 'KNITCAT card', caption: '' }),
    shareNative: nativeShare,
    build,
    setNote,
    /** Called from app.js at boot: apply a `#p=…` link if the address bar has one. */
    consumeIncoming(href) {
      return applyIncomingShare({
        href: href || (typeof location !== 'undefined' ? location.href : ''),
        load: context.applyDocument || (() => false),
        clean: stripShareUrl
      });
    }
  };
}

function modalShell(id, title, body, accessibleName = '') {
  document.getElementById(id)?.remove();
  const el = document.createElement('div');
  el.className = 'modal-backdrop active';
  el.id = id;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', accessibleName || title.replace(/<[^>]*>/g, ''));
  el.innerHTML = `
    <div class="modal-card" style="width:min(720px,94vw)">
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button class="modal-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${body}</div>
    </div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.querySelector('.modal-close').addEventListener('click', close);
  el.addEventListener('mousedown', e => { if (e.target === el) close(); });
  el._close = close;
  return el;
}
