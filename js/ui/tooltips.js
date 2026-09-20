/**
 * KNITCAT — custom tooltip layer.
 *
 * The browser's built-in tooltips (the `title` attribute) are slow, un-styleable,
 * inconsistent across platforms, and impossible to theme with the app. This module
 * replaces them everywhere with one floating, token-styled surface that appears
 * quickly, follows the accent, and — crucially for accessibility — is wired up as a
 * real `role="tooltip"` linked to its owner with `aria-describedby`, so a screen
 * reader still hears the description.
 *
 * How it works:
 *   - On boot (and whenever the DOM gains nodes, via a MutationObserver) every
 *     `title="…"` is migrated to `data-ktip="…"` so the native tooltip can never
 *     fire alongside ours. Elements may also be authored with `data-ktip` directly.
 *   - A single delegated pointer/focus listener on the document shows one shared tip
 *     for whatever is hovered or focused — no per-widget wiring, so the ~40 buttons,
 *     panels, chips and mode selectors all get the same treatment for free, present
 *     and future.
 *
 * Importing this module has no DOM side effects; {@link initTooltips} does the
 * wiring, so it is fully testable and can never break boot.
 *
 * @module ui/tooltips
 */

const TIP_ID = 'kx-tooltip';
const STYLE_ID = 'kx-tooltip-style';
const SHOW_DELAY = 110;   // ms — long enough to skip accidental passes, snappy on purpose
const VIEWPORT_PAD = 8;   // px — breathing room kept from every screen edge

/**
 * Where should a tip sit, given its owner's bounding box and the tip's own size,
 * without spilling off any edge? Pure and DOM-free so the geometry can be asserted
 * without a browser.
 *
 * Prefers sitting centred above the owner; flips below when there is no room up top;
 * then clamps horizontally and vertically into the viewport.
 *
 * @param {{left:number,top:number,width:number,height:number}} owner  the hovered element's rect
 * @param {{w:number,h:number}} tip        the measured tip box
 * @param {{vw:number,vh:number}} vp       the viewport size
 * @param {number} [gap=8]                px gap between owner and tip
 * @returns {{x:number,y:number,placement:'top'|'bottom'}}
 */
export function placeTip(owner, tip, vp, gap = 8) {
  const o = owner || { left: 0, top: 0, width: 0, height: 0 };
  const tw = Math.max(0, tip && tip.w != null ? tip.w : 0);
  const th = Math.max(0, tip && tip.h != null ? tip.h : 0);
  const vw = (vp && vp.vw) || 1024;
  const vh = (vp && vp.vh) || 768;
  const pad = VIEWPORT_PAD;

  // Horizontal: centre on the owner, then clamp so the tip stays inside the screen.
  let x = o.left + o.width / 2 - tw / 2;
  x = Math.min(Math.max(pad, x), Math.max(pad, vw - tw - pad));

  // Vertical: above by default, flip below if it would clip the top.
  let placement = 'top';
  let y = o.top - th - gap;
  if (y < pad) {
    placement = 'bottom';
    y = o.top + o.height + gap;
  }
  // Last resort: if below also clips, pull it up to sit just inside the bottom edge.
  if (y + th > vh - pad) y = Math.max(pad, vh - th - pad);

  return { x: Math.round(x), y: Math.round(y), placement };
}

/**
 * The tip text for an element, or null. Reads our `data-ktip` first, then a raw
 * (not-yet-migrated) `title`. Skips empty strings so we never show a blank bubble.
 * @param {Element|null} el
 * @returns {string|null}
 */
export function tipTextFor(el) {
  if (!el || typeof el.getAttribute !== 'function') return null;
  const tip = el.getAttribute('data-ktip');
  if (tip && String(tip).trim()) return String(tip).trim();
  const title = el.getAttribute('title');
  if (title && String(title).trim()) return String(title).trim();
  return null;
}

/**
 * Migrate a `title` off an element onto `data-ktip` so the native tooltip is
 * suppressed and ours takes over. A `title` ALWAYS loses: some widgets re-set
 * `.title` at runtime (the feasibility button, the network chip), so we let the
 * freshest title win, copy it into `data-ktip`, and drop the native one — which
 * also keeps our tooltip text current. Returns true if anything changed.
 * @param {Element} el
 */
function migrate(el) {
  if (!el || el.nodeType !== 1 || !el.getAttribute) return false;
  const title = el.getAttribute('title');
  if (title == null) return false;
  const text = String(title);
  if (!text.trim()) { el.removeAttribute('title'); return true; }
  if (el.getAttribute('data-ktip') !== text) el.setAttribute('data-ktip', text);
  el.removeAttribute('title');
  return true;
}

/**
 * Migrate every title in a subtree (including the root itself).
 * @param {ParentNode&Element} root
 */
export function normalizeTitles(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  if (root.nodeType === 1) migrate(root);
  const nodes = root.querySelectorAll('[title]');
  for (let i = 0; i < nodes.length; i++) migrate(nodes[i]);
}

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.kx-tip{position:fixed;z-index:12000;max-width:280px;pointer-events:none;opacity:0;transform:translateY(4px) scale(.98);
  transition:opacity .12s ease,transform .12s ease;
  background:linear-gradient(180deg,color-mix(in srgb,var(--bg-surface-elevated,#151f38) 96%,transparent),var(--bg-surface,#0f1830));
  color:var(--text-primary,#e6edf7);border:1px solid var(--border-subtle,#24406e);
  border-radius:10px;padding:7px 10px;font:12px/1.45 var(--font-ui,system-ui,sans-serif);
  box-shadow:0 12px 30px -10px rgba(0,0,0,.7),0 0 0 1px color-mix(in srgb,var(--accent-cyan,#38bdf8) 16%,transparent);
  white-space:pre-line;word-break:break-word}
.kx-tip.is-visible{opacity:1;transform:none}
.kx-tip::after{content:"";position:absolute;width:9px;height:9px;transform:rotate(45deg);
  background:var(--bg-surface,#0f1830);border:1px solid var(--border-subtle,#24406e)}
.kx-tip[data-place="top"]::after{bottom:-5px;border-top:0;border-right:0;left:var(--kx-tip-arrow,50%);margin-left:-4px}
.kx-tip[data-place="bottom"]::after{top:-5px;border-bottom:0;border-left:0;left:var(--kx-tip-arrow,50%);margin-left:-4px}
@media (prefers-reduced-motion:reduce){.kx-tip{transition:none}}
@media (forced-colors:active){.kx-tip{border-color:CanvasText;background:Canvas;color:CanvasText}}
`;
  document.head.appendChild(style);
}

/**
 * Mount the tooltip layer. Idempotent: a second call returns the existing handle.
 * @param {object} [deps]
 * @param {Document} [deps.doc]     override the document (tests / shadow roots)
 * @returns {{show:Function,hide:Function,destroy:Function}|null}
 */
export function initTooltips(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function') return null;

  let tip = doc.getElementById(TIP_ID);
  if (tip) return api(tip); // already mounted
  injectStyles();
  tip = doc.createElement('div');
  tip.id = TIP_ID;
  tip.className = 'kx-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  doc.body.appendChild(tip);

  // Adopt everything already on the page, then keep new nodes honest.
  normalizeTitles(doc.body);
  const observer = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) if (node && node.nodeType === 1) normalizeTitles(node);
      if (m.type === 'attributes' && m.target) migrate(m.target);
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });

  let owner = null;
  let timer = 0;

  function position(el) {
    const rect = el.getBoundingClientRect();
    const box = { w: tip.offsetWidth, h: tip.offsetHeight };
    const vp = { vw: window.innerWidth, vh: window.innerHeight };
    const at = placeTip(rect, box, vp);
    tip.style.left = at.x + 'px';
    tip.style.top = at.y + 'px';
    tip.dataset.place = at.placement;
    // Slide the little arrow to keep pointing at the owner's centre.
    const centre = rect.left + rect.width / 2 - at.x;
    tip.style.setProperty('--kx-tip-arrow', Math.max(12, Math.min(box.w - 12, centre)) + 'px');
  }

  function show(el) {
    const text = tipTextFor(el);
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    tip.classList.add('is-visible');
    tip.id = TIP_ID;
    position(el);
    owner = el;
    // Only claim a description link when the owner has no more specific label.
    if (!el.getAttribute('aria-describedby')) el.setAttribute('aria-describedby', TIP_ID);
  }

  function hide() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (owner && owner.getAttribute('aria-describedby') === TIP_ID) owner.removeAttribute('aria-describedby');
    owner = null;
    tip.classList.remove('is-visible');
    tip.hidden = true;
  }

  // The nearest tooltipable ancestor (or self) of an event target.
  function tipTarget(node) {
    let el = node;
    while (el && el !== doc.body) {
      if (el.nodeType === 1 && tipTextFor(el)) return el;
      el = el.parentNode;
    }
    return null;
  }

  const onOver = e => {
    const el = tipTarget(e.target);
    if (!el || el === owner) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = 0; show(el); }, SHOW_DELAY);
  };
  const onOut = e => {
    const el = tipTarget(e.target);
    if (!el) return;
    // Only hide when leaving the tip's owner, not when moving to its child.
    const to = e.relatedTarget && el.contains ? el.contains(e.relatedTarget) : false;
    if (!to) hide();
  };
  const onFocus = e => { const el = tipTarget(e.target); if (el) show(el); };

  tip._listeners = { onOver, onOut, onFocus, hide, observer };
  doc.addEventListener('pointerover', onOver, true);
  doc.addEventListener('pointerout', onOut, true);
  doc.addEventListener('focusin', onFocus, true);
  doc.addEventListener('focusout', hide, true);
  doc.addEventListener('pointerdown', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  doc.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });

  return api(tip);

  function api(node) {
    return {
      show,
      hide,
      element: node,
      destroy() {
        if (node._listeners) {
          const L = node._listeners;
          doc.removeEventListener('pointerover', L.onOver, true);
          doc.removeEventListener('pointerout', L.onOut, true);
          doc.removeEventListener('focusin', L.onFocus, true);
          doc.removeEventListener('focusout', L.hide, true);
          doc.removeEventListener('pointerdown', L.hide, true);
          doc.removeEventListener('keydown', e => {});
          window.removeEventListener('scroll', L.hide, true);
          window.removeEventListener('resize', L.hide);
          if (L.observer) L.observer.disconnect();
        }
        node.remove();
      }
    };
  }
}
