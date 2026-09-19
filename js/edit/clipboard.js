/**
 * Clipboard: a history, named slots, and a snippet library.
 *
 * One clipboard slot is not enough for this app, and the reason is specific to
 * knitting rather than to computers: a knitter assembles a chart from a *vocabulary*
 * — this eyelet cross, that 2×2 rib corner, the border they have used on eleven
 * shawls. Losing the last copy of a motif the moment you copy another one means
 * redrawing it, and redrawing means giving up. So:
 *
 *   - an undo-style history of the last copies, most recent first;
 *   - named slots that survive a reload, which is where the vocabulary lives;
 *   - a paste path that *converts* rather than refuses — Fair Isle into lace and
 *     back, and one machine's gauge onto another's needles — and says exactly what it
 *     had to change to do so.
 *
 * Cross-window copying goes through `createClipboardBridge`, which uses
 * BroadcastChannel when the browser has one and stays silent when it does not. It is
 * deliberately not a storage mechanism: a copy that only lives while both windows are
 * open is a clipboard, and pretending otherwise would put half-finished motifs into
 * the user's saved data.
 */

import { blankValue, convertMatrixBetweenModes, isKnownMode, isLaceMode, isPunched, normalizeCell } from './modes.js';
import { matrixInfo, regaugeMatrix, stampMotif, transformMotif } from './chart-ops.js';

export const CLIPBOARD_LIMIT = 24;
export const SLOT_STORAGE_KEY = 'knitcad.clipboard.slots.v1';

// ─── entries ─────────────────────────────────────────────────────────────────

/**
 * Freeze a copied block.
 *
 * The cells are copied, not referenced: the most annoying possible clipboard bug is
 * one that aliases the live matrix and then "pastes" whatever the card looks like
 * now, three edits later.
 */
export function createEntry(matrix, { mode = 'lace', name = '', pitch = null, profileId = null, source = 'copy' } = {}) {
  const cells = (matrix || []).map(row => [...row]);
  const { rows, cols } = matrixInfo(cells);
  let punched = 0;
  for (const row of cells) for (const value of row) if (isPunched(mode, value)) punched++;
  return {
    id: `clip${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: String(name || defaultName(cells, mode)).slice(0, 64),
    mode,
    cells,
    rows,
    cols,
    punched,
    pitch: pitch && Number.isFinite(pitch.x) && Number.isFinite(pitch.y) ? { x: pitch.x, y: pitch.y } : null,
    profileId: profileId || null,
    source,
    createdAt: Date.now()
  };
}

function defaultName(cells, mode) {
  const { rows, cols } = matrixInfo(cells);
  return `${rows}×${cols} ${labelForMode(mode)}`;
}

export function labelForMode(mode) {
  if (mode === 'fair_isle') return 'Fair Isle';
  if (mode === 'lace') return 'lace';
  if (mode === 'tuck') return 'tuck';
  if (mode === 'slip') return 'slip';
  return 'pattern';
}

export function entrySummary(entry) {
  if (!entry) return { label: 'nothing', punched: 0, rows: 0, cols: 0 };
  const size = entry.pitch ? ` · ${Math.round(entry.rows * entry.pitch.y)}×${Math.round(entry.cols * entry.pitch.x)} mm` : '';
  return {
    label: `${entry.name} — ${entry.rows}×${entry.cols}, ${entry.punched} punched, ${labelForMode(entry.mode)}${size}`,
    short: `${entry.rows}×${entry.cols}`,
    punched: entry.punched,
    rows: entry.rows,
    cols: entry.cols,
    mode: entry.mode
  };
}

// ─── the paste path ──────────────────────────────────────────────────────────

/**
 * Work out what an entry has to become before it can land on this card.
 *
 * Three independent conversions can be needed at once, and each is reported
 * separately because each is a different question a knitter would ask:
 *
 *   - different *mode*      → "my eyelets became circles, why?"
 *   - different *gauge*     → "it is 27 needles wide now, not 24"
 *   - bigger than the *card* → "where did the rest of it go?"
 *
 * Nothing here mutates the entry, so the clipboard still holds the original.
 */
export function prepareForPaste(entry, { mode, rows = Infinity, cols = Infinity, pitch = null, reGauge = true, resize = null } = {}) {
  if (!entry || !Array.isArray(entry.cells) || !entry.cells.length) {
    return { ok: false, error: 'The clipboard is empty.', warnings: [] };
  }
  const targetMode = mode || entry.mode;
  if (!isKnownMode(targetMode)) return { ok: false, error: `Unknown pattern mode "${targetMode}".`, warnings: [] };
  const warnings = [];
  let cells = entry.cells.map(row => [...row]);
  let usedMode = entry.mode;

  // Re-gauge first: converting symbols and *then* resampling would duplicate or drop
  // an eyelet that had just been created, and the error would be invisible.
  if (reGauge && entry.pitch && pitch && (Math.abs(entry.pitch.x - pitch.x) > 0.01 || Math.abs(entry.pitch.y - pitch.y) > 0.01)) {
    const turned = regaugeMatrix(cells, {
      fromPitchX: entry.pitch.x,
      fromPitchY: entry.pitch.y,
      toPitchX: pitch.x,
      toPitchY: pitch.y
    });
    if (turned.ok) {
      cells = turned.matrix;
      warnings.push(...turned.warnings);
      warnings.push(`Re-gauged from ${entry.pitch.x} mm to ${pitch.x} mm per stitch: ${turned.cols} needles wide.`);
    } else {
      warnings.push('The two machines report different needle pitches but one of them is missing, so the block was pasted at its original size.');
    }
  }

  if (resize && (resize.rows || resize.cols)) {
    const wanted = { rows: resize.rows || matrixInfo(cells).rows, cols: resize.cols || matrixInfo(cells).cols };
    if (wanted.rows > rows || wanted.cols > cols) {
      return {
        ok: false,
        error: `That would need ${wanted.rows} rows × ${wanted.cols} needles and this card is ${rows} × ${cols}.`,
        warnings
      };
    }
    const turned = regaugeMatrix(cells, {
      fromPitchX: 1,
      fromPitchY: 1,
      toPitchX: matrixInfo(cells).cols / wanted.cols,
      toPitchY: matrixInfo(cells).rows / wanted.rows
    });
    if (turned.ok) {
      cells = turned.matrix;
      warnings.push(`Resized to ${wanted.rows} × ${wanted.cols}; stitches were redistributed, never invented.`);
    }
  }

  if (usedMode !== targetMode) {
    const from = usedMode;
    // Convert the values, not just the label. Normalising straight to the target mode
    // would read a Fair Isle `1` as "not a stitch symbol" and quietly blank it, so the
    // paste would arrive empty and the warning would be a lie.
    if (isKnownMode(from)) cells = convertMatrixBetweenModes(from, targetMode, cells);
    warnings.push(
      `Converted from ${labelForMode(from)} to ${labelForMode(targetMode)}: ${
        isLaceMode(from)
          ? 'every worked symbol became a punched cell, because a punched card cannot say which operation it means.'
          : 'every punched cell became an eyelet, because a hole punched in a lace card is an eyelet until you say otherwise.'
      }`
    );
    usedMode = targetMode;
  }

  const info = matrixInfo(cells);
  if (info.rows > rows || info.cols > cols) {
    warnings.push(`Only ${Math.min(rows, info.rows)} × ${Math.min(cols, info.cols)} of it fits this card; the rest will be clipped at the edge.`);
  }

  // Normalise on the way out so a stray value from a hand-edited file cannot survive
  // into a card that is about to be compiled.
  cells = cells.map(row => row.map(value => normalizeCell(targetMode, value)));
  return { ok: true, cells, mode: targetMode, warnings, rows: info.rows, cols: info.cols };
}

/**
 * Paste an entry onto a matrix.
 *
 * Masked by default, for the same reason as `stampMotif`: a copied motif is usually
 * meant to sit *on* a background, not to punch a rectangle of blanks into it.
 */
export function pasteEntry(matrix, entry, { r = 0, c = 0, mode = null, masked = true, pitch = null, reGauge = true, flipH = false, flipV = false, rotate = 0 } = {}) {
  const prepared = prepareForPaste(entry, { mode: mode || matrixModeHint(matrix, mode), pitch, reGauge });
  if (!prepared.ok) return { ok: false, error: prepared.error, matrix, warnings: prepared.warnings || [] };
  const motif = transformMotif({ cells: prepared.cells, mode: prepared.mode }, { flipH, flipV, rotate });
  const stamped = stampMotif(matrix, motif, { r, c, mode: prepared.mode, masked });
  return {
    ok: true,
    matrix: stamped.matrix,
    placed: stamped.placed,
    clipped: stamped.clipped,
    converted: stamped.converted,
    warnings: prepared.warnings,
    name: entry.name,
    mode: prepared.mode
  };
}

function matrixModeHint(matrix, mode) {
  if (isKnownMode(mode)) return mode;
  const first = matrix && matrix[0] ? matrix[0][0] : undefined;
  if (typeof first === 'string') return 'lace';
  return 'fair_isle';
}

/** Cut = copy, then blank the source on the layer that owns it (the caller erases). */
export function eraseSource(matrix, entry, { r = 0, c = 0, mode = 'lace' } = {}) {
  const out = matrix.map(row => [...row]);
  const blank = blankValue(mode);
  let cleared = 0;
  for (let sr = 0; sr < entry.rows; sr++) {
    for (let sc = 0; sc < entry.cols; sc++) {
      const tr = r + sr;
      const tc = c + sc;
      if (!out[tr] || tc >= out[tr].length) continue;
      if (out[tr][tc] !== blank) {
        out[tr][tc] = blank;
        cleared++;
      }
    }
  }
  return { matrix: out, cleared };
}

// ─── history + slots ─────────────────────────────────────────────────────────

export function createClipboard({ limit = CLIPBOARD_LIMIT, slots = null, storage = null } = {}) {
  const clipboard = {
    entries: [],
    slots: sanitizeSlots(slots || readSlots(storage)),
    limit: Math.max(1, Math.trunc(limit) || CLIPBOARD_LIMIT),
    storage
  };
  return {
    /** Copy: push onto the history, dropping the oldest beyond `limit`. */
    copy(matrix, options = {}) {
      const entry = createEntry(matrix, options);
      clipboard.entries.unshift(entry);
      if (clipboard.entries.length > clipboard.limit) clipboard.entries.length = clipboard.limit;
      return entry;
    },
    /** Push a whole entry (from a slot, another window, or "paste previous"). */
    adopt(entry, { source = 'import' } = {}) {
      if (!entry || !Array.isArray(entry.cells)) return null;
      const copy = { ...entry, id: `clip${Date.now().toString(36)}`, source, createdAt: Date.now() };
      clipboard.entries.unshift(copy);
      if (clipboard.entries.length > clipboard.limit) clipboard.entries.length = clipboard.limit;
      return copy;
    },
    entries: clipboard.entries,
    at(index = 0) {
      return clipboard.entries[index] || null;
    },
    find(id) {
      return clipboard.entries.find(entry => entry.id === id) || null;
    },
    /**
     * Bring an older copy back to the top rather than dropping it.
     *
     * "I want the thing I copied four ago" is the request that makes a history worth
     * having, and re-ordering beats re-copying because the entry keeps its name,
     * its gauge and its mode.
     */
    restore(id) {
      const index = clipboard.entries.findIndex(entry => entry.id === id);
      if (index < 0) return null;
      const [entry] = clipboard.entries.splice(index, 1);
      clipboard.entries.unshift(entry);
      return entry;
    },
    remove(id) {
      const index = clipboard.entries.findIndex(entry => entry.id === id);
      if (index < 0) return 0;
      // Splice, never reassign: the array is handed out by reference so a panel can
      // render it live, and replacing it would leave that panel showing a history
      // that no longer receives copies.
      clipboard.entries.splice(index, 1);
      return 1;
    },
    clear() {
      const removed = clipboard.entries.length;
      clipboard.entries.length = 0;
      return removed;
    },
    saveSlot(name, entry) {
      const clean = String(name || '').trim().slice(0, 64);
      if (!clean) return { ok: false, error: 'Give the slot a name so you can find it again.' };
      if (!entry) return { ok: false, error: 'Copy something first.' };
      clipboard.slots[clean] = { ...entry, name: clean, source: 'slot' };
      writeSlots(storage, clipboard.slots);
      return { ok: true, name: clean, slots: Object.keys(clipboard.slots).length };
    },
    loadSlot(name) {
      return clipboard.slots[String(name).trim()] || null;
    },
    deleteSlot(name) {
      const key = String(name).trim();
      if (!clipboard.slots[key]) return false;
      delete clipboard.slots[key];
      writeSlots(storage, clipboard.slots);
      return true;
    },
    renameSlot(from, to) {
      const entry = clipboard.slots[from];
      const clean = String(to || '').trim().slice(0, 64);
      if (!entry || !clean) return { ok: false, error: 'Both names are needed.' };
      delete clipboard.slots[from];
      clipboard.slots[clean] = { ...entry, name: clean };
      writeSlots(storage, clipboard.slots);
      return { ok: true, name: clean };
    },
    /** Alphabetical, because a library is looked up by name, not by age. */
    slotNames() {
      return Object.keys(clipboard.slots).sort((a, b) => a.localeCompare(b));
    },
    slots: clipboard.slots,
    serialize() {
      return { entries: clipboard.entries, slots: clipboard.slots };
    },
    stats() {
      return {
        history: clipboard.entries.length,
        slots: Object.keys(clipboard.slots).length,
        limit: clipboard.limit,
        persisted: Boolean(storage)
      };
    }
  };
}

// ─── persistence ─────────────────────────────────────────────────────────────

/**
 * Validate slots read back from storage.
 *
 * A malformed entry is dropped rather than repaired: the clipboard is the one place
 * where showing nothing is better than showing a block that is subtly wrong, because
 * a wrong block gets pasted into a card and only discovered at the machine.
 */
export function sanitizeSlots(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [name, entry] of Object.entries(input)) {
    const clean = validateEntry(entry);
    if (clean) out[String(name).slice(0, 64)] = clean;
  }
  return out;
}

export function validateEntry(entry) {
  if (!entry || !isKnownMode(entry.mode)) return null;
  if (!Array.isArray(entry.cells) || !entry.cells.length || entry.cells.length > 2000) return null;
  const cols = entry.cells[0].length;
  if (!cols || cols > 2000) return null;
  const cells = [];
  for (const row of entry.cells) {
    if (!Array.isArray(row) || row.length !== cols) return null;
    cells.push(row.map(value => normalizeCell(entry.mode, value)));
  }
  let punched = 0;
  for (const row of cells) for (const value of row) if (isPunched(entry.mode, value)) punched++;
  const pitch = entry.pitch && Number.isFinite(entry.pitch.x) && Number.isFinite(entry.pitch.y) && entry.pitch.x > 0 && entry.pitch.y > 0
    ? { x: entry.pitch.x, y: entry.pitch.y }
    : null;
  return {
    id: typeof entry.id === 'string' ? entry.id : `clip${Date.now().toString(36)}`,
    name: typeof entry.name === 'string' ? entry.name.slice(0, 64) : defaultName(cells, entry.mode),
    mode: entry.mode,
    cells,
    rows: cells.length,
    cols,
    punched,
    pitch,
    profileId: typeof entry.profileId === 'string' ? entry.profileId : null,
    source: typeof entry.source === 'string' ? entry.source.slice(0, 24) : 'slot',
    createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now()
  };
}

function readSlots(storage) {
  const store = resolveStorage(storage);
  if (!store) return {};
  try {
    return JSON.parse(store.getItem(SLOT_STORAGE_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function writeSlots(storage, slots) {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(SLOT_STORAGE_KEY, JSON.stringify(slots));
    return true;
  } catch (_) {
    // Private-browsing Safari and a full quota both land here. The clipboard still
    // works for the session, which is the whole promise it makes.
    return false;
  }
}

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
  return null;
}

// ─── cross-window ────────────────────────────────────────────────────────────

/**
 * Broadcast copies between windows, so "detach this pattern into its own window"
 * can still share a clipboard with the main one.
 *
 * Degrades to nothing where `BroadcastChannel` is missing — no polling, no storage
 * event hacks, because a copy that silently never arrives is worse than a clipboard
 * that is honestly per-window. The caller is told which it got.
 */
export function createClipboardBridge({ name = 'knitcat-clipboard', onEntry = null, log = null } = {}) {
  const available = typeof globalThis !== 'undefined' && typeof globalThis.BroadcastChannel === 'function';
  let channel = null;
  const listeners = new Set();
  if (available) {
    channel = new globalThis.BroadcastChannel(name);
    channel.onmessage = event => {
      const entry = validateEntry(event && event.data && event.data.entry);
      if (!entry) return;
      for (const listener of listeners) listener(entry);
      if (onEntry) onEntry(entry);
    };
  }
  return {
    available,
    mode: available ? 'broadcast' : 'none',
    publish(entry) {
      if (!channel || !entry) return false;
      try {
        channel.postMessage({ entry, at: Date.now() });
        return true;
      } catch (_) {
        return false;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
      if (channel) {
        try {
          channel.close();
        } catch (_) {
          /* already gone */
        }
      }
      if (log) log('closed');
    }
  };
}
