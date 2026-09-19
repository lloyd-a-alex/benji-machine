/**
 * KnitCAD — hidden Designer (admin) key.
 *
 * The app looks calm and finished to its recipient; designer mode — which lets
 * Alex tweak the "behind the glass" settings (advanced garment parameters, the
 * letter text baked into exports, a future anniversary date & photo) — stays
 * hidden until a passphrase is typed anywhere on the page.
 *
 * The passphrase is never stored or compared in plaintext. We keep only a
 * DOUBLE digest (two chained FNV-1a rounds with salted envelopes) and, on each
 * keystroke, hash every recent suffix of what was typed and match it against
 * that digest. So the secret string appears nowhere in the source, in git, or in
 * localStorage — only its two-round digest does.
 *
 * Unlocked state is persisted quietly; there is no visible badge or menu name.
 */

const ADMIN_FLAG = 'knitcad.designer.v1';

const SALT_A = 'knit';
const SALT_B = 'cad';
const SALT_C = 'loomsign-v3';

function fnv1a(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Two chained rounds of hashing — "super doubly-encrypted". */
function digest(phrase) {
  const r1 = fnv1a(`${SALT_A}::${phrase}::${SALT_B}`);
  const r2 = fnv1a(`${SALT_C}:${r1.toString(36)}:${SALT_A}`);
  return `${r2.toString(36)}-${r1.toString(36)}`;
}

// digest(<the phrase>) — the only thing stored. The phrase itself is nowhere.
const EXPECTED = '161k6x8-b1w405';

export function isAdmin() {
  try { return localStorage.getItem(ADMIN_FLAG) === EXPECTED; } catch (_) { return false; }
}

function applyState(on) {
  window.__knitAdmin = !!on;
  try { document.body.classList.toggle('kx-admin-on', !!on); } catch (_) { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('knit:admin', { detail: { on: !!on } })); } catch (_) { /* ignore */ }
}

function setAdmin(on) {
  try {
    if (on) localStorage.setItem(ADMIN_FLAG, EXPECTED);
    else localStorage.removeItem(ADMIN_FLAG);
  } catch (_) { /* ignore */ }
  applyState(on);
}

/** Boot: reflect any persisted state and listen for the typed passphrase. */
export function initAdmin(ctx = {}) {
  const notifier = ctx.notifier || null;
  applyState(isAdmin());

  let buf = '';
  window.addEventListener('keydown', e => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = (e.key || '').toLowerCase();
    if (!/^[a-z]$/.test(k)) return;
    buf = (buf + k).slice(-14);
    if (isAdmin()) return;
    // Match the digest of every plausible suffix length (never the raw phrase).
    for (let len = 6; len <= buf.length; len++) {
      if (digest(buf.slice(-len)) === EXPECTED) {
        buf = '';
        setAdmin(true);
        if (notifier) notifier.success('designer mode unlocked ♥');
        return;
      }
    }
  });

  return {
    isAdmin,
    // Escape hatch for the developer console (no need to type on the page).
    unlockWith(phrase) { const ok = digest(phrase) === EXPECTED; if (ok) setAdmin(true); return ok; },
    lock() { setAdmin(false); },
    digest
  };
}

export { digest };
