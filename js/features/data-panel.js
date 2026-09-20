/**
 * Work & Backup — autosave, crash recovery, versions, recent cards, backup file.
 *
 * Self-contained the way the other feature layers are: it builds its own DOM,
 * injects its own styles, no-ops on missing elements, and never throws into the
 * core CAD app. If storage is unavailable it says so in the status chip instead
 * of pretending to save.
 *
 * The UI exists to make three promises visible:
 *   1. nothing you drew is lost (autosave + the chip that proves it)
 *   2. a crash is recovered, not re-lived (banner offering the last save back)
 *   3. you can always take everything with you (one JSON archive)
 */

import { openDriver, STORES } from '../project/storage.js';
import {
  createDataService, diffMatrices, describeDiff, toProjectDocument,
  AUTOSAVE_KEY, MAX_SNAPSHOTS, MAX_RECENTS
} from '../project/backups.js';

const STYLE_ID = 'knitcat-data-style';
const PANEL_ID = 'kx-data-panel';
const ENABLE_KEY = 'autosave.enabled';

const CSS = `
.kx-data{display:flex;flex-direction:column;gap:8px}
.kx-data-chip{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;
  letter-spacing:.04em;text-transform:uppercase;padding:3px 8px;border-radius:999px;
  border:1px solid var(--border-subtle,#1e293b);color:var(--text-secondary,#94a3b8);cursor:default}
.kx-data-chip--ok{color:var(--accent-emerald,#34d399);border-color:rgba(52,211,153,.45)}
.kx-data-chip--busy{color:var(--accent-cyan,#38bdf8);border-color:rgba(56,189,248,.45)}
.kx-data-chip--bad{color:var(--accent-rose,#f43f5e);border-color:rgba(244,63,94,.5)}
.kx-data-row{display:flex;flex-wrap:wrap;gap:6px}
.kx-data-row .btn-action{flex:1 1 auto;font-size:11px;padding:7px 9px}
.kx-data-note{font-size:10px;color:var(--text-muted,#64748b);line-height:1.5}
.kx-data-toggle{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary,#94a3b8)}
.kx-version-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;
  max-height:min(46vh,420px);overflow:auto}
.kx-version{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-subtle,#1e293b);
  border-radius:var(--radius-md,8px);background:var(--bg-panel,#131d33)}
.kx-version-main{flex:1 1 auto;min-width:0}
.kx-version-label{font-size:12px;font-weight:600;color:var(--text-primary,#f8fafc);overflow-wrap:anywhere}
.kx-version-meta{font-size:10px;color:var(--text-muted,#64748b)}
.kx-version-diff{font-size:10px;color:var(--accent-amber,#fbbf24);margin-top:2px}
.kx-mini{border:1px solid var(--border-subtle,#1e293b);background:transparent;color:var(--text-secondary,#94a3b8);
  border-radius:6px;padding:5px 8px;font-size:11px;cursor:pointer;font-family:inherit;flex:0 0 auto}
.kx-mini:hover{color:var(--text-primary,#f8fafc);border-color:var(--border-active,#38bdf8)}
.kx-mini--danger:hover{color:#fecdd3;border-color:var(--accent-rose,#f43f5e)}
.kx-banner{display:flex;align-items:flex-start;gap:12px;flex:0 0 auto;margin:8px 8px 0;padding:13px 15px;
  border-radius:var(--radius-lg,12px);border:1px solid color-mix(in srgb,var(--accent-amber,#fbbf24) 55%,transparent);
  background:linear-gradient(180deg,rgba(251,191,36,.15),rgba(251,191,36,.06));
  color:var(--text-primary,#f8fafc);box-shadow:0 10px 28px -14px rgba(0,0,0,.65)}
.kx-banner[hidden]{display:none}
.kx-banner-icon{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;
  width:34px;height:34px;border-radius:50%;font-size:18px;line-height:1;
  background:color-mix(in srgb,var(--accent-amber,#fbbf24) 20%,transparent);color:var(--accent-amber,#fbbf24)}
.kx-banner-body{flex:1 1 auto;min-width:0}
.kx-banner-title{font-size:13px;font-weight:700;letter-spacing:.01em}
.kx-banner-text{font-size:11px;color:var(--text-secondary,#94a3b8);margin-top:4px;line-height:1.55}
.kx-banner-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
@media (max-width:720px){
  .kx-banner{margin:6px 6px 0;flex-direction:column}
  .kx-banner-actions .btn-action{flex:1 1 46%}
}
@media (forced-colors:active){
  .kx-banner,.kx-version,.kx-data-chip,.kx-mini{border-color:CanvasText}
  .kx-banner{background:Canvas}
}
`;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** "just now" / "4 min ago" / "yesterday" / "12 Mar 2026" — no date library. */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return 'never';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return 'unknown';
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 45) return 'just now';
  if (secs < 5400) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`;
  if (secs < 172800) return 'yesterday';
  const d = new Date(at);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function downloadText(text, filename, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function stamp(prefix) {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * @param {object} context
 * @param {object} context.notifier
 * @param {() => object} context.snapshot           current editor state for saving
 * @param {(doc: object, label: string) => boolean} context.applyDocument  restore a document
 * @param {() => boolean} [context.isReady]         editor exists yet
 * @param {object} [context.driverOptions]          passed to openDriver (tests inject here)
 */
export async function initDataPanel(context = {}) {
  const { notifier = null, snapshot = () => ({}), applyDocument = () => false, isReady = () => true } = context;
  if (typeof document === 'undefined') return null;
  injectStyles();

  const { driver, warning } = await openDriver(context.driverOptions || {});
  const service = createDataService({
    driver,
    snapshot,
    notifier,
    onListener: status => renderStatus(status)
  });

  let enabled = true;
  let restoredAt = 0;

  // ── panel ──────────────────────────────────────────────────────────────────
  const sidebar = document.getElementById('right-sidebar');
  let chip = null;
  if (sidebar) {
    const panel = document.createElement('div');
    panel.className = 'sidebar-panel';
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="sidebar-title">
        <span>Work &amp; Backup</span>
        <span class="kx-data-chip" id="kx-autosave-chip" role="status" aria-live="polite">starting</span>
      </div>
      <div class="kx-data">
        <div class="kx-data-row">
          <button type="button" class="btn-action" id="kx-btn-checkpoint"
            title="Keep this version — nothing is ever overwritten, so you can come back to it">Checkpoint</button>
          <button type="button" class="btn-action" id="kx-btn-versions" title="Every saved version of this card">Versions</button>
        </div>
        <div class="kx-data-row">
          <button type="button" class="btn-action" id="kx-btn-recent" title="Cards you opened on this device">Recent</button>
          <button type="button" class="btn-action" id="kx-btn-backup"
            title="One JSON file with every card, version, note and setting on this device">Backup all</button>
        </div>
        <div class="kx-data-row">
          <label class="btn-action" for="kx-btn-restore" style="flex:1 1 auto;justify-content:center;cursor:pointer"
            title="Restore a KNITCAT backup file">Restore backup
            <input type="file" id="kx-btn-restore" accept=".kbak,.json" style="display:none">
          </label>
        </div>
        <label class="kx-data-toggle" for="kx-autosave-toggle">
          <input type="checkbox" id="kx-autosave-toggle" checked>
          <span>Autosave this card as I work</span>
        </label>
        <p class="kx-data-note" id="kx-data-note"></p>
      </div>`;
    sidebar.insertBefore(panel, sidebar.lastElementChild);
    chip = panel.querySelector('#kx-autosave-chip');

    panel.querySelector('#kx-btn-checkpoint').addEventListener('click', () => checkpoint());
    panel.querySelector('#kx-btn-versions').addEventListener('click', () => openVersions());
    panel.querySelector('#kx-btn-recent').addEventListener('click', () => openRecents());
    panel.querySelector('#kx-btn-backup').addEventListener('click', () => backupAll());
    panel.querySelector('#kx-btn-restore').addEventListener('change', e => restoreFromFile(e.target.files?.[0]));
    const toggle = panel.querySelector('#kx-autosave-toggle');
    toggle.addEventListener('change', async () => {
      enabled = toggle.checked;
      await service.setKv(ENABLE_KEY, enabled);
      if (enabled) service.schedule('autosave-enabled');
      renderStatus(service.status());
    });
  }

  // ── banner ─────────────────────────────────────────────────────────────────
  const banner = document.createElement('div');
  banner.className = 'kx-banner';
  banner.id = 'kx-recovery-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Recovered work');
  banner.hidden = true;
  const workspace = document.getElementById('viewport-workspace');
  if (workspace) workspace.insertBefore(banner, workspace.firstChild);

  banner.addEventListener('click', e => {
    const action = e.target.closest?.('[data-kx-act]')?.dataset.kxAct;
    if (action === 'restore') {
      const doc = banner._document;
      hideBanner();
      if (doc && applyDocument(doc, 'recovered card')) {
        notifier?.success?.('Your recovered card is back — nothing was lost.', { duration: 6000 });
      }
    } else if (action === 'discard') {
      service.clearAutosave();
      hideBanner();
    } else if (action === 'keep') {
      hideBanner();
    }
  });

  function hideBanner() {
    banner.hidden = true;
    banner._document = null;
  }

  function showBanner(doc, diff) {
    banner._document = doc;
    const when = relativeTime(doc.timestamp);
    banner.innerHTML = `
      <div class="kx-banner-icon" aria-hidden="true">\u21ba</div>
      <div class="kx-banner-body">
        <div class="kx-banner-title">This card was not saved when the tab closed</div>
        <div class="kx-banner-text">
          Last autosave ${when}: ${doc.rows}&#215;${doc.cols} ${doc.mode ? `· ${doc.mode}` : ''}
          ${diff ? `· ${esc(describeDiff(diff))} from what is on screen now` : ''}
        </div>
        <div class="kx-banner-actions">
          <button type="button" class="btn-action btn-primary" data-kx-act="restore">Restore it</button>
          <button type="button" class="btn-action" data-kx-act="keep">Keep what is on screen</button>
          <button type="button" class="btn-action" data-kx-act="discard">Throw the autosave away</button>
        </div>
      </div>`;
    banner.hidden = false;
    banner.querySelector('[data-kx-act="restore"]')?.focus({ preventScroll: true });
  }

  // ── status ─────────────────────────────────────────────────────────────────
  function renderStatus(status = service.status()) {
    const note = document.getElementById('kx-data-note');
    if (!chip) return;
    const label = chip;
    label.classList.remove('kx-data-chip--ok', 'kx-data-chip--busy', 'kx-data-chip--bad');
    if (!enabled) {
      label.textContent = 'off';
      label.title = 'Autosave is switched off — remember to save a project file';
      if (note) note.textContent = 'Autosave is off, so nothing is kept unless you save it.';
      return;
    }
    if (status.saving) {
      label.classList.add('kx-data-chip--busy');
      label.textContent = 'saving';
      return;
    }
    if (status.failing) {
      label.classList.add('kx-data-chip--bad');
      label.textContent = 'save failed';
      label.title = status.lastError || 'the browser refused the write';
      if (note) note.textContent = 'The browser refused to store anything. Use "Save Project" — autosave cannot protect this card.';
      return;
    }
    if (!status.lastSavedAt) {
      label.textContent = 'not saved yet';
      if (note) note.textContent = 'Your first change is stored locally within two seconds.';
      return;
    }
    restoredAt = status.lastSavedAt;
    label.classList.add('kx-data-chip--ok');
    label.textContent = `saved ${relativeTime(new Date(status.lastSavedAt).toISOString())}`;
    label.title = `Autosaved to ${status.kind}`;
    if (note) {
      note.textContent = status.kind === 'memory'
        ? 'This browser will not let KNITCAT store anything, so autosave lasts only this session. Save a project file before you close the tab.'
        : `Kept on this device in ${status.kind}. Nothing is uploaded anywhere.`;
    }
  }

  // ── versions ───────────────────────────────────────────────────────────────
  async function checkpoint(label) {
    let name = label;
    if (name === undefined) {
      const typed = typeof window !== 'undefined' && typeof window.prompt === 'function'
        ? window.prompt('What should this version be called?', 'Checkpoint')
        : 'Checkpoint';
      if (typed === null) return null; // cancelled — never checkpoint silently
      name = typed;
    }
    const id = await service.takeSnapshot(String(name).trim().slice(0, 80) || 'Checkpoint');
    notifier?.success?.('Version kept.', { details: `${MAX_SNAPSHOTS} versions are kept; the oldest rolls off.` });
    renderVersionList();
    return id;
  }

  function modalShell(id, title, body) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'modal-backdrop active';
    el.id = id;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', title);
    el.innerHTML = `
      <div class="modal-card" style="width:min(680px,94vw)">
        <div class="modal-header">
          <div class="modal-title">${esc(title)}</div>
          <button class="modal-close" type="button" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">${body}</div>
      </div>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    el.querySelector('.modal-close').addEventListener('click', close);
    el.addEventListener('mousedown', e => { if (e.target === el) close(); });
    el._close = close;
    setTimeout(() => el.querySelector('button:not(.modal-close)')?.focus({ preventScroll: true }), 0);
    return el;
  }

  let versionsModal = null;
  async function openVersions() {
    versionsModal = modalShell('kx-versions-modal', 'Saved versions of this card', `
      <p class="kx-data-note" style="margin:0 0 10px">
        Each version is a complete copy of the chart, with its own name and time. Comparing shows
        exactly how many cells differ, so "did I already fix that row?" has an answer.
      </p>
      <div class="kx-data-row" style="margin-bottom:10px">
        <button type="button" class="btn-action" id="kx-ver-add">Checkpoint now</button>
      </div>
      <ul class="kx-version-list" id="kx-version-list"></ul>`);
    versionsModal.querySelector('#kx-ver-add').addEventListener('click', async () => {
      await checkpoint('Manual checkpoint');
      renderVersionList();
    });
    await renderVersionList();
  }

  async function renderVersionList() {
    const list = versionsModal?.querySelector('#kx-version-list');
    if (!list) return;
    const entries = await service.listSnapshots();
    if (!entries.length) {
      list.innerHTML = '<li class="kx-data-note">No versions yet. A checkpoint costs nothing and can never be overwritten by a later edit.</li>';
      return;
    }
    list.innerHTML = '';
    for (const entry of entries.slice().reverse()) {
      const doc = entry.document || {};
      const li = document.createElement('li');
      li.className = 'kx-version';
      li.innerHTML = `
        <div class="kx-version-main">
          <div class="kx-version-label">${esc(doc.label || 'Checkpoint')}</div>
          <div class="kx-version-meta">${esc(relativeTime(entry.at))} · ${esc(doc.rows || 0)}&#215;${esc(doc.cols || 0)} · ${esc(doc.mode || 'lace')}</div>
          <div class="kx-version-diff" hidden></div>
        </div>
        <button type="button" class="kx-mini" data-act="diff">Compare</button>
        <button type="button" class="kx-mini" data-act="restore">Restore</button>
        <button type="button" class="kx-mini kx-mini--danger" data-act="delete" aria-label="Delete this version">Delete</button>`;
      li.addEventListener('click', async e => {
        const act = e.target.closest?.('[data-act]')?.dataset.act;
        if (!act) return;
        if (act === 'restore') {
          hideBanner();
          versionsModal?._close?.();
          applyDocument(doc, doc.label || 'saved version');
        } else if (act === 'delete') {
          await service.deleteSnapshot(entry.id);
          await renderVersionList();
        } else if (act === 'diff') {
          const { diff } = await service.diffSnapshot(entry.id);
          const out = li.querySelector('.kx-version-diff');
          out.hidden = false;
          out.textContent = `vs now — ${describeDiff(diff)}`;
        }
      });
      list.appendChild(li);
    }
  }

  // ── recents ────────────────────────────────────────────────────────────────
  async function openRecents() {
    const modal = modalShell('kx-recent-modal', 'Recently opened on this device', `
      <p class="kx-data-note" style="margin:0 0 10px">
        A web page cannot remember where your files live, so KNITCAT keeps the card itself.
        Up to ${MAX_RECENTS} of them; the oldest fall off as you open new ones.
      </p>
      <ul class="kx-version-list" id="kx-recent-list"></ul>`);
    const list = modal.querySelector('#kx-recent-list');
    const entries = await service.listRecents();
    if (!entries.length) {
      list.innerHTML = '<li class="kx-data-note">Nothing yet — open a .kcard and it will appear here.</li>';
      return;
    }
    list.innerHTML = '';
    for (const entry of entries.slice().reverse()) {
      const li = document.createElement('li');
      li.className = 'kx-version';
      li.innerHTML = `
        <div class="kx-version-main">
          <div class="kx-version-label">${esc(entry.name)}</div>
          <div class="kx-version-meta">${esc(relativeTime(entry.openedAt))} · ${esc(entry.rows || 0)}&#215;${esc(entry.cols || 0)} · ${esc(entry.mode || 'lace')}</div>
        </div>
        <button type="button" class="kx-mini" data-act="open">Open</button>
        <button type="button" class="kx-mini kx-mini--danger" data-act="forget" aria-label="Remove ${esc(entry.name)} from the list">Forget</button>`;
      li.addEventListener('click', async e => {
        const act = e.target.closest?.('[data-act]')?.dataset.act;
        if (act === 'open') {
          modal._close?.();
          if (!applyDocument(entry.document, entry.name)) return;
          await service.rememberRecent(entry);
        } else if (act === 'forget') {
          await service.forgetRecent(entry.id);
          li.remove();
        }
      });
      list.appendChild(li);
    }
  }

  // ── backup / restore ───────────────────────────────────────────────────────
  async function backupAll() {
    const archive = await service.buildArchive();
    downloadText(JSON.stringify(archive, null, 2), `${stamp('knitcat-backup')}.kbak`, 'application/json');
    notifier?.success?.('Backup written.', {
      details: [
        `${archive.counts.snapshots} versions, ${archive.counts.recents} recents, ${archive.counts.projects} named cards, ${archive.counts.kv} notes.`,
        'This file is everything KNITCAT knows. Keep it somewhere you trust.'
      ],
      duration: 7000
    });
  }

  async function restoreFromFile(file) {
    if (!file) return;
    const text = await file.text();
    const result = await service.restoreArchive(text, { replace: false });
    if (!result.ok) {
      notifier?.error?.('That backup could not be restored.', { details: result.error });
      return;
    }
    notifier?.success?.('Backup merged into this device.', {
      details: [
        `From ${relativeTime(result.createdAt)}: ${result.written.snapshots} versions, ${result.written.recents} recents, ${result.written.projects} named cards.`,
        'Nothing already here was overwritten.'
      ],
      duration: 8000
    });
    renderVersionList();
  }

  // ── boot sequence ──────────────────────────────────────────────────────────
  /**
   * Auto-backup on open: at most one untitled version per day, so even someone
   * who never touches the Checkpoint button has a trail to go back along. The
   * named checkpoints people take are never counted or replaced by this.
   */
  async function rollAutoBackup() {
    try {
      const entries = await service.listSnapshots();
      const last = entries[entries.length - 1];
      const dayAgo = Date.now() - 86400000;
      if (last && Date.parse(last.at) > dayAgo) return false;
      await service.takeSnapshot('Auto-backup on open');
      return true;
    } catch (_) {
      return false; // a missing auto-backup must never block opening the app
    }
  }

  service.beginSession();
  enabled = (await service.getKv(ENABLE_KEY, true)) !== false;
  const toggle = document.getElementById('kx-autosave-toggle');
  if (toggle) toggle.checked = enabled;

  const verdict = await service.recover();
  const api = {
    service,
    driver,
    enabled: () => enabled,
    setEnabled(value) {
      enabled = Boolean(value);
      if (toggle) toggle.checked = enabled;
      service.setKv(ENABLE_KEY, enabled);
      renderStatus(service.status());
    },
    checkpoint,
    /** The autosave read at boot, before anything was applied. */
    pendingAutosave: () => verdict.saved || null,
    /** File a document away as a version without touching what is on screen. */
    keepVersion: (doc, label = 'Kept') => service.keepVersion(doc, label),
    openVersions,
    openRecents,
    backupAll,
    restoreFromFile,
    status: () => ({ ...service.status(), warning, enabled }),
    banner,

    /**
     * Called once the editor exists. A crash asks; a clean close simply resumes,
     * because being asked every time you reload would be noise, not safety.
     *
     * `ignoreAutosave` is for the case where something more authoritative than a
     * background resume has already been applied — opening a shared link, say. The
     * autosave is left exactly where it is rather than silently overwritten.
     */
    async settle(options = {}) {
      await rollAutoBackup();
      if (options.ignoreAutosave) {
        renderStatus(service.status());
        return { action: 'deferred', saved: verdict.saved || null };
      }
      if (!verdict.saved) { renderStatus(service.status()); return { action: 'none' }; }
      const current = toProjectDocument(snapshot());
      const diff = diffMatrices(verdict.saved.stitchMatrix || [], current.stitchMatrix || []);
      if (verdict.action === 'ask') {
        showBanner(verdict.saved, diff);
        return { action: 'ask', diff };
      }
      if (diff.identical) {
        renderStatus({ ...service.status(), lastSavedAt: Date.parse(verdict.saved.timestamp) || service.status().lastSavedAt });
        return { action: 'none' };
      }
      const applied = applyDocument(verdict.saved, 'your last session');
      if (applied) notifier?.info?.('Picked up where you left off.', { duration: 4200 });
      return { action: 'resume', applied };
    },

    /** Called on every edit. */
    touch() {
      if (enabled) {
        try { service.schedule('edit'); } catch (_) { /* a failed timer must never break drawing */ }
      }
    },
    /** Called after a .kcard/file open. Fire-and-forget by design. */
    remember(name, doc) {
      return service.rememberRecent({
        name,
        document: doc,
        mode: doc?.mode,
        profileId: doc?.profileId,
        rows: doc?.rows,
        cols: doc?.cols
      }).catch(() => false);
    },
    async closeEverything(reason) {
      await service.close(reason);
    }
  };

  // Unload hooks. `pagehide` is the reliable one on mobile; `visibilitychange`
  // catches a phone tab backgrounded and never unloaded.
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => service.close('pagehide'));
    window.addEventListener('beforeunload', () => service.close('beforeunload'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') service.flush();
      else renderStatus(service.status());
    });
  }

  renderStatus(service.status());
  if (warning === 'memory-only') {
    notifier?.warn?.('This browser will not store anything for KNITCAT.', {
      details: 'Autosave lasts only this tab. Save a project file before you close it.',
      duration: 9000
    });
  }

  return api;
}

/** Autosave key used by the recovery flow, exported so tests can assert on it. */
export { AUTOSAVE_KEY, STORES };
