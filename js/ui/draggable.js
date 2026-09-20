/**
 * KNITCAT — draggable surfaces.
 *
 * Every floating dock (the kit `.kx-panel`s), the Studio and the modal dialogs are
 * positioned by fixed corners, which is tidy until you want one out of the way of
 * the canvas. This module lets you grab any of them by its header bar and move it,
 * exactly like a desktop window — and it remembers where you put it.
 *
 * It is deliberately a single delegated listener rather than a per-widget call:
 * modules keep building their own panels and modals with `buildPanel` / the modal
 * shell, and this picks them all up automatically, present and future, purely by
 * recognising the shared header markup. Movement is done with a CSS `transform`,
 * never by rewriting `left`/`top`, so a dragged dock can't fight the flex/position
 * rules it was authored with, and a reset is as simple as clearing the transform.
 *
 * Importing this module has no DOM side effects; {@link enableDraggable} wires it.
 *
 * @module ui/draggable
 */

const STORE_PREFIX = 'knitcat.drag.v1.';
const PAD = 6; // px of the title bar that must stay on-screen after a clamp

/**
 * Clamp a moved box's top-left so it stays inside the viewport (a sliver of the
 * header must always remain grabbable, so you can never fling a window out of
 * reach). Pure and DOM-free for testing.
 *
 * @param {number} x candidate left
 * @param {number} y candidate top
 * @param {number} w box width
 * @param {number} h box height
 * @param {{vw:number,vh:number}} vp viewport
 * @returns {{x:number,y:number}}
 */
export function constrainToViewport(x, y, w, h, vp) {
  const vw = (vp && vp.vw) || 1024;
  const vh = (vp && vp.vh) || 768;
  // Allow the box to overhang right/bottom only a little; never hide the header.
  const minX = -w + 80;
  const maxX = vw - 80;
  const minY = PAD - h + 34;      // at least ~34px of the title bar visible
  const maxY = vh - 34;
  const cx = Math.min(Math.max(x, Math.min(minX, maxX)), Math.max(minX, maxX));
  const cy = Math.min(Math.max(y, Math.min(minY, maxY)), Math.max(minY, maxY));
  return { x: Math.round(cx), y: Math.round(cy) };
}

// Header ⇄ surface pairs, keyed by the element that starts the drag. `data-drag`
// lets any module opt a custom panel in without matching a known class.
const SURFACES = [
  { surface: '.kx-panel', handle: '.kx-panel__bar' },
  { surface: '.kx-studio', handle: '.kx-studio-head' },
  { surface: '.modal-card', handle: '.modal-header' },
  { surface: '[data-drag]', handle: '[data-drag-handle]' }
];

// Controls that should still behave like controls when you click them in a header.
function isInteractive(node) {
  return node && node.closest && node.closest('button, a, input, select, textarea, [data-close], [data-no-drag]');
}

/** Read the current translate offset from an element's dataset (px numbers). */
function offset(el) {
  return { x: Number(el.dataset.kxTx) || 0, y: Number(el.dataset.kxTy) || 0 };
}

/** Apply an offset as a transform and stash it for the next read/persist. */
function applyOffset(el, x, y) {
  el.dataset.kxTx = String(Math.round(x));
  el.dataset.kxTy = String(Math.round(y));
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function storeKey(el) {
  return el.id ? STORE_PREFIX + el.id : (el.dataset.dragId ? STORE_PREFIX + el.dataset.dragId : null);
}

function persist(el) {
  const key = storeKey(el);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(offset(el))); } catch (_) { /* storage off */ }
}

function restore(el) {
  const key = storeKey(el);
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) applyOffset(el, o.x, o.y);
  } catch (_) { /* corrupt offset: start put-put */ }
}

let zCounter = 9100;
function bringForward(el) {
  zCounter += 1;
  el.style.zIndex = String(zCounter);
}

/**
 * Restore every already-mounted draggable to its remembered spot (call once at boot
 * and again whenever a new surface appears).
 * @param {Document|Element} root
 */
export function syncDraggables(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  for (const { surface } of SURFACES) {
    const nodes = root.matches && root.matches(surface) ? [root] : Array.from(root.querySelectorAll(surface));
    for (const el of nodes) if (!el.dataset.kxDragReady) { el.dataset.kxDragReady = '1'; restore(el); }
  }
}

/**
 * Turn on header-dragging for all recognised surfaces. Idempotent; returns a handle
 * with `rescan()` to adopt freshly-added panels/modals.
 * @param {object} [deps]
 * @param {Document} [deps.doc]
 * @param {Window} [deps.win]
 */
export function enableDraggable(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  if (!doc || !win || doc.__kxDragOn) {
    if (doc && doc.__kxDragHandle) return doc.__kxDragHandle;
  }
  if (doc) syncDraggables(doc.body);

  let drag = null; // { el, handle, startX, startY, baseX, baseY, rect }

  function findSurface(target) {
    let el = target;
    while (el && el !== doc.body) {
      for (const { surface, handle } of SURFACES) {
        const surf = el.closest && el.closest(surface);
        if (surf) {
          const head = surf.querySelector(handle);
          if (head && head.contains(el)) return { surf, head };
        }
      }
      el = el.parentNode;
    }
    return null;
  }

  function onPointerDown(e) {
    if (e.button !== 0 || isInteractive(e.target)) return;
    const found = findSurface(e.target);
    if (!found) return;
    const { surf } = found;
    // Don't drag a modal card that is being resized via an input etc. (handled by isInteractive).
    drag = {
      el: surf,
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset(surf).x,
      baseY: offset(surf).y,
      rect: surf.getBoundingClientRect()
    };
    bringForward(surf);
    surf.dataset.kxDragging = '1';
    if (surf.setPointerCapture) { try { surf.setPointerCapture(e.pointerId); } catch (_) { /* noop */ } }
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!drag) return;
    const nx = drag.baseX + (e.clientX - drag.startX);
    const ny = drag.baseY + (e.clientY - drag.startY);
    // Clamp using the box's on-screen position minus its current offset.
    const originLeft = drag.rect.left - drag.baseX;
    const originTop = drag.rect.top - drag.baseY;
    const clamped = constrainToViewport(originLeft + nx, originTop + ny, drag.rect.width, drag.rect.height,
      { vw: win.innerWidth, vh: win.innerHeight });
    applyOffset(drag.el, clamped.x - originLeft, clamped.y - originTop);
  }

  function onPointerUp() {
    if (!drag) return;
    delete drag.el.dataset.kxDragging;
    persist(drag.el);
    drag = null;
  }

  function onDblClick(e) {
    const found = findSurface(e.target);
    if (!found) return;
    const { surf } = found;
    applyOffset(surf, 0, 0);
    const key = storeKey(surf);
    if (key) { try { localStorage.removeItem(key); } catch (_) { /* noop */ } }
  }

  doc.addEventListener('pointerdown', onPointerDown, true);
  win.addEventListener('pointermove', onPointerMove);
  win.addEventListener('pointerup', onPointerUp);
  win.addEventListener('pointercancel', onPointerUp);
  doc.addEventListener('dblclick', onDblClick, true);

  const handle = {
    rescan: () => syncDraggables(doc.body),
    disable() {
      doc.removeEventListener('pointerdown', onPointerDown, true);
      win.removeEventListener('pointermove', onPointerMove);
      win.removeEventListener('pointerup', onPointerUp);
      win.removeEventListener('pointercancel', onPointerUp);
      doc.removeEventListener('dblclick', onDblClick, true);
      try { delete doc.__kxDragOn; delete doc.__kxDragHandle; } catch (_) { /* readonly in some envs */ }
    }
  };
  if (doc) { doc.__kxDragOn = true; doc.__kxDragHandle = handle; }

  // Adopt panels/modals added later (Studio open, a dock opening for the first time).
  if (typeof MutationObserver !== 'undefined') {
    const obs = new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) if (n && n.nodeType === 1) syncDraggables(n);
    });
    obs.observe(doc.body, { childList: true, subtree: true });
    handle._observer = obs;
  }
  return handle;
}
