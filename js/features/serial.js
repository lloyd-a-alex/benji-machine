/**
 * KNITCAT — "Send to machine" over Web Serial.
 *
 * The final cable. Everything the app can already *export* to a file (the AYAB
 * bitstream from `FormatsExporter.generateAyabFormat`) can, on a Chromium browser,
 * be streamed straight down a serial port to an AYAB-style shield instead of being
 * saved and carried over on a memory card. This module is only the transfer — the
 * format, the bytes, the card matrix all already exist elsewhere.
 *
 * Web Serial is:
 *   • available only over a secure context and only in Chromium-family browsers,
 *   • gated behind a user gesture (the browser's own port-picker), and
 *   • capable of throwing at any moment (unplugged mid-transfer, permission revoked).
 *
 * So the whole surface is guarded, feature-detected at call time (never at import —
 * this file must stay loadable under `node --test` where there is no `navigator`),
 * and it never leaves a half-open port behind: `finally` closes the writer and the
 * port no matter how the transfer ended.
 *
 * @module features/serial
 */

/** Default AYAB / Arduino serial line rate. Configurable per connection. */
export const DEFAULT_BAUD_RATE = 115200;

/**
 * Is Web Serial available in this browser right now? Feature-detects rather than
 * sniffing a user-agent, so a future Firefox with Serial works unchanged.
 * @returns {boolean}
 */
export function isSerialSupported() {
  return typeof navigator !== 'undefined' && !!navigator.serial && typeof navigator.serial.requestPort === 'function';
}

/**
 * Turn a string into the UTF-8 byte stream we push down the wire. Kept separate
 * (and exported) so a test can pin the exact bytes without a serial port.
 * @param {string} text
 * @returns {Uint8Array}
 */
export function textToBytes(text) {
  const body = String(text == null ? '' : text);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(body);
  // Extremely defensive fallback (no TextEncoder is essentially never true in a
  // browser, but this module may be imported in odd harnesses).
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff;
  return out;
}

/**
 * A single live serial connection. Create one with {@link createSerialSender} and
 * drive it from the UI: `connect()` (asks the browser for a port), `send(bytes)`
 * (streams with progress), `disconnect()` (hands the port back to the OS).
 *
 * @param {{ baudRate?:number, notifier?:{info?:Function,warn?:Function,error?:Function,success?:Function}, onState?:Function }} [opts]
 */
export function createSerialSender(opts = {}) {
  const { baudRate = DEFAULT_BAUD_RATE, notifier = null, onState } = opts;
  let port = null;
  let writer = null;
  let reading = false;
  let readLoopAbort = null;

  const say = (kind, msg, extra) => {
    try { notifier?.[kind]?.(msg, extra); } catch (_) { /* notifier may be absent */ }
  };
  const emit = (state, detail) => {
    try { onState && onState({ state, detail, supported: isSerialSupported() }); } catch (_) { /* UI hook is optional */ }
  };

  /** Stop the background read loop (AYAB devices echo status lines we drain). */
  async function stopReading() {
    if (!reading) return;
    reading = false;
    try { readLoopAbort && readLoopAbort(); } catch (_) { /* already gone */ }
  }

  async function readLoop() {
    if (!port || !port.readable) return;
    const reader = port.readable.getReader();
    let cancelled = false;
    readLoopAbort = () => { cancelled = true; try { reader.cancel(); } catch (_) { /* noop */ } };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done || cancelled) break;
        // We surface device chatter as a toast-able log but never block on it.
        if (value && value.length) emit('device', value);
      }
    } catch (_) {
      /* a read error simply ends the loop; disconnect() does the teardown */
    } finally {
      try { reader.releaseLock(); } catch (_) { /* port may already be closed */ }
    }
  }

  return {
    get supported() { return isSerialSupported(); },
    get connected() { return !!port; },

    /**
     * Ask the browser to pick a port and open it. Returns { ok, error }.
     * A user cancelling the picker is reported as `{ ok: false, cancelled: true }`
     * so the UI can stay quiet rather than scream "error" at an intentional No.
     */
    async connect() {
      if (!isSerialSupported()) {
        const error = 'This browser has no Web Serial support. Use Chrome or Edge on desktop, or export the AYAB file instead.';
        say('warn', error);
        emit('unsupported', error);
        return { ok: false, unsupported: true, error };
      }
      try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate });
        emit('connected');
        say('success', 'Machine connected.', { duration: 4000 });
        // Start draining device echoes; ignore failures (some devices send nothing).
        readLoop().catch(() => { /* contained */ });
        return { ok: true, info: safeInfo(port) };
      } catch (err) {
        const name = err && err.name;
        const cancelled = name === 'NotFoundError'; // user closed the picker
        const error = cancelled ? 'No port was chosen.' : `Could not open the port: ${err && err.message ? err.message : err}`;
        if (!cancelled) say('error', error, { details: [String(err && err.message || err)] });
        emit(cancelled ? 'cancelled' : 'error', error);
        port = null;
        return { ok: false, cancelled, error };
      }
    },

    /**
     * Stream a string (typically the AYAB bitstream) to the machine. Chunked so a
     * large card raises progress rather than freezing, and `onProgress(0..1)` lets
     * the UI draw a bar. Returns { ok, bytes, error }.
     */
    async send(text, { onProgress } = {}) {
      if (!port || !port.writable) {
        const error = 'Not connected to a machine yet.';
        say('warn', error);
        return { ok: false, error };
      }
      const bytes = textToBytes(text);
      if (!bytes.length) {
        const error = 'There was nothing to send.';
        say('warn', error);
        return { ok: false, error };
      }
      const CHUNK = 256;
      try {
        writer = port.writable.getWriter();
        // Small preamble so a device that boots on a break signal wakes first.
        await writer.write(new Uint8Array([0x0a]));
        for (let offset = 0; offset < bytes.length; offset += CHUNK) {
          const slice = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
          await writer.write(slice);
          if (onProgress) onProgress(Math.min(1, (offset + slice.length) / bytes.length));
          // Yield to the event loop so the tab stays responsive on a big card.
          await new Promise(r => setTimeout(r, 0));
        }
        // Terminating newline; many firmware line-readers need it to commit.
        await writer.write(new Uint8Array([0x0a]));
        say('success', `Sent ${bytes.length} bytes to the machine.`, { duration: 5000 });
        emit('sent', { bytes: bytes.length });
        return { ok: true, bytes: bytes.length };
      } catch (err) {
        const error = `The transfer stopped: ${err && err.message ? err.message : err}`;
        say('error', error, { details: [String(err && err.message || err)] });
        emit('error', error);
        return { ok: false, error, bytes: bytes.length };
      } finally {
        try { writer && writer.releaseLock(); } catch (_) { /* port closing */ }
        writer = null;
      }
    },

    /** Close the read loop, the port, and forget the handle. Idempotent. */
    async disconnect() {
      await stopReading();
      const wasConnected = !!port;
      try { if (port && port.close) await port.close(); } catch (_) { /* already gone */ }
      port = null;
      writer = null;
      if (wasConnected) {
        emit('disconnected');
        say('info', 'Machine disconnected.', { duration: 3500 });
      }
      return { ok: true };
    }
  };
}

/** Read the port's USB identifiers defensively (they can throw on some platforms). */
function safeInfo(p) {
  try { return p.getInfo ? p.getInfo() : null; } catch (_) { return null; }
}

/**
 * The one-call convenience the app uses: check support, and if present return a
 * ready sender. Returns `null` when the browser cannot do Serial at all, mirroring
 * the plan's feature-detection contract (`if (!('serial' in navigator)) return null;`).
 * @param {object} opts  forwarded to {@link createSerialSender}
 * @returns {ReturnType<typeof createSerialSender>|null}
 */
export function openSerialIfSupported(opts) {
  if (!isSerialSupported()) return null;
  return createSerialSender(opts);
}
