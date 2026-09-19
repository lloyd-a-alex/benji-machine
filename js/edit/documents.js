/**
 * Several patterns open at once.
 *
 * A knitter rarely designs one thing: the cuff, the border and the body panel are
 * three cards for one garment, and redrawing them into a single canvas means losing
 * two of them. So the editor holds a list of documents, shows one at a time, and can
 * hand any of them to its own window.
 *
 * Detaching is done with the share link rather than `window.open(card)`, because this
 * is a static site: the new window is the same app, pointed at a `#p=` payload, which
 * means it works offline, needs no server, and can be sent to somebody else — the
 * "drag a pattern into another window" request turns out to be the same feature as
 * "send a pattern to a friend".
 *
 * The store owns *metadata and ordering*; the matrices stay wherever the caller keeps
 * them. Handing a document store a live 200×240 grid would mean two owners of the
 * same card, which is the classic way a save silently reverts an edit.
 */

export const DOCUMENT_LIMIT = 12;

let documentCounter = 0;

function nextDocId() {
  documentCounter += 1;
  return `doc${documentCounter}`;
}

export function createDocument({ name = 'Untitled card', mode = 'lace', profileId = null, rows = 0, cols = 0, id = null } = {}) {
  return {
    id: id || nextDocId(),
    name: String(name).slice(0, 80) || 'Untitled card',
    mode,
    profileId: profileId || null,
    rows: Math.max(0, Math.trunc(rows) || 0),
    cols: Math.max(0, Math.trunc(cols) || 0),
    dirty: false,
    openedAt: Date.now(),
    editedAt: Date.now(),
    savedAt: null,
    // Which panels this document is being looked at, for the split-view labels and
    // for knowing when a detached window is still open.
    views: ['chart']
  };
}

export function createDocuments({ limit = DOCUMENT_LIMIT, activeId = null } = {}) {
  const store = {
    list: [],
    limit: Math.max(1, Math.trunc(limit) || DOCUMENT_LIMIT),
    activeId: activeId || null
  };

  const api = {
    get docs() {
      return store.list;
    },
    get activeId() {
      return store.activeId;
    },
    list() {
      return store.list;
    },
    find(id) {
      return store.list.find(doc => doc.id === id) || null;
    },
    byName(name) {
      const wanted = String(name || '').trim().toLowerCase();
      return store.list.find(doc => doc.name.toLowerCase() === wanted) || null;
    },
    active() {
      return api.find(store.activeId);
    },

    /**
     * Open a document, or focus the one already open with that name.
     *
     * Two tabs called "cuff" is a mistake, not a feature, so a name collision focuses
     * the existing document and says so; the caller can offer to rename.
     */
    open(spec) {
      const named = spec.name ? api.byName(spec.name) : null;
      if (named && !spec.force) {
        store.activeId = named.id;
        return { ok: true, document: named, focused: true, reason: `"${named.name}" was already open.` };
      }
      if (store.list.length >= store.limit) {
        return {
          ok: false,
          error: `Only ${store.limit} patterns can be open at once. Close one, or save it to a file first.`
        };
      }
      const doc = createDocument(spec);
      store.list.push(doc);
      store.activeId = doc.id;
      return { ok: true, document: doc, focused: false };
    },

    close(id) {
      const index = store.list.findIndex(doc => doc.id === id);
      if (index < 0) return { ok: false, error: 'That pattern is not open.' };
      const [doc] = store.list.splice(index, 1);
      if (!doc) return { ok: false, error: 'That pattern is not open.' };
      if (store.activeId === id) {
        const next = store.list[Math.min(index, store.list.length - 1)];
        store.activeId = next ? next.id : null;
      }
      // Unsaved work is the caller's problem to raise, but it is this module's problem
      // to *detect*, or the warning would be written three times.
      return { ok: true, closed: doc, wasDirty: doc.dirty };
    },

    closeAll() {
      const closed = store.list.length;
      const dirty = store.list.filter(doc => doc.dirty).length;
      store.list.length = 0;
      store.activeId = null;
      return { closed, dirty };
    },

    setActive(id) {
      if (!api.find(id)) return false;
      store.activeId = id;
      return true;
    },

    rename(id, name) {
      const doc = api.find(id);
      if (!doc) return { ok: false, error: 'That pattern is not open.' };
      const clean = String(name || '').trim().slice(0, 80);
      if (!clean) return { ok: false, error: 'A pattern needs a name.' };
      const clash = api.byName(clean);
      if (clash && clash.id !== id) return { ok: false, error: `"${clean}" is already open.`, clash: clash.id };
      doc.name = clean;
      return { ok: true, document: doc };
    },

    /** Record what the caller is currently looking at, so a detached tab can be refocused. */
    setViews(id, views) {
      const doc = api.find(id);
      if (!doc) return { ok: false, error: 'That pattern is not open.' };
      const allowed = ['chart', 'punchcard', 'yarn', 'brother', 'toolpath'];
      doc.views = (Array.isArray(views) ? views : []).filter(view => allowed.includes(view));
      return { ok: true, views: doc.views };
    },

    /** Every edit goes through here, or the "unsaved" dot is a lie. */
    touch(id, { rows, cols, mode } = {}) {
      const doc = api.find(id);
      if (!doc) return null;
      doc.dirty = true;
      doc.editedAt = Date.now();
      if (Number.isFinite(rows)) doc.rows = Math.trunc(rows);
      if (Number.isFinite(cols)) doc.cols = Math.trunc(cols);
      if (mode) doc.mode = mode;
      return doc;
    },

    markSaved(id) {
      const doc = api.find(id);
      if (!doc) return null;
      doc.dirty = false;
      doc.savedAt = Date.now();
      return doc;
    },

    reorder(id, toIndex) {
      const from = store.list.findIndex(doc => doc.id === id);
      if (from < 0) return { ok: false, error: 'That pattern is not open.' };
      const target = Math.max(0, Math.min(store.list.length - 1, Math.trunc(toIndex)));
      const [doc] = store.list.splice(from, 1);
      store.list.splice(target, 0, doc);
      return { ok: true, from, to: target };
    },

    unsaved() {
      return store.list.filter(doc => doc.dirty);
    },

    /**
     * What a "detach into its own window" action needs.
     *
     * Deliberately *not* a URL: this module knows nothing about the site's path, and a
     * static site deployed under a project subpath gets that wrong the first time
     * somebody renames the repository. The caller builds the link with the share
     * module and this payload.
     */
    detachTarget(id) {
      const doc = api.find(id);
      if (!doc) return { ok: false, error: 'That pattern is not open.' };
      return {
        ok: true,
        title: doc.name,
        payload: { docId: doc.id, name: doc.name, mode: doc.mode, rows: doc.rows, cols: doc.cols, detached: true }
      };
    },

    serialize() {
      return {
        version: 1,
        activeId: store.activeId,
        documents: store.list.map(doc => ({
          id: doc.id,
          name: doc.name,
          mode: doc.mode,
          profileId: doc.profileId,
          rows: doc.rows,
          cols: doc.cols,
          views: doc.views,
          savedAt: doc.savedAt
        }))
      };
    },

    stats() {
      return { open: store.list.length, unsaved: api.unsaved().length, limit: store.limit };
    }
  };

  return api;
}

/**
 * Read a saved document list.
 *
 * `savedAt` is kept but `dirty` is never restored: a file on disk is by definition
 * saved, and a card that opens claiming to have unsaved work trains the user to
 * ignore the indicator that matters.
 */
export function deserializeDocuments(input, { limit = DOCUMENT_LIMIT } = {}) {
  const list = Array.isArray(input && input.documents) ? input.documents : [];
  const clean = [];
  for (const item of list.slice(0, Math.max(1, limit))) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.name === 'string' ? item.name.slice(0, 80) : '';
    if (!name) continue;
    clean.push({
      ...createDocument({
        name,
        mode: typeof item.mode === 'string' ? item.mode : 'lace',
        profileId: typeof item.profileId === 'string' ? item.profileId : null,
        rows: Number(item.rows) || 0,
        cols: Number(item.cols) || 0,
        id: typeof item.id === 'string' ? item.id : null
      }),
      dirty: false,
      views: Array.isArray(item.views) ? item.views.filter(view => typeof view === 'string') : ['chart'],
      savedAt: Number.isFinite(item.savedAt) ? item.savedAt : null
    });
  }
  const activeId = clean.some(doc => doc.id === input.activeId) ? input.activeId : clean.length ? clean[0].id : null;
  return { documents: clean, activeId };
}
