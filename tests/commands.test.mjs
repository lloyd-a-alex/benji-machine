// The command dispatcher — the single vocabulary the menu bar and the context menu
// both route through — driven against a fake app under a minimal document stub.
// Proves the extraction to ui/commands.js keeps behaviour, contains async failures
// and never depends on a real browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STITCH_TYPE } from '../js/math/knit-topology.js';
import { runCommand } from '../js/ui/commands.js';

// A minimal DOM stand-in: commands only ever query by id/selector, and here
// nothing exists, so those branches degrade silently — exactly as in a bare page.
function installDocStub() {
  globalThis.document = {
    querySelector: () => null,
    getElementById: () => null
  };
}

function makeApp(overrides = {}) {
  const calls = [];
  const ed = {
    matrix: [
      [STITCH_TYPE.KNIT, STITCH_TYPE.EYELET],
      [STITCH_TYPE.KNIT, STITCH_TYPE.KNIT]
    ],
    rows: 2,
    cols: 2,
    clipboard: null,
    selection: null,
    setMatrix(m) { this.matrix = m; calls.push('setMatrix'); },
    render() {},
    undo() { calls.push('undo'); },
    redo() { calls.push('redo'); },
    clear() { calls.push('clear'); },
    invert() { calls.push('invert'); },
    deleteSelection() { calls.push('deleteSelection'); },
    cutSelection() { calls.push('cut'); return true; },
    copySelection() { calls.push('copy'); return true; },
    pasteClipboard() { calls.push('paste'); return true; },
    getSelectionBounds() { return this.selection; },
    setHighlight() { calls.push('setHighlight'); }
  };
  const app = Object.assign({
    editor: ed,
    currentMode: 'lace',
    calls,
    recompile() { calls.push('recompile'); },
    notifications: { success: m => calls.push('notify:' + m), info: m => calls.push('notify:' + m) },
    menubar: { refresh() { calls.push('menubarRefresh'); } },
    _refreshRecentProjects() { calls.push('recentRefresh'); },
    _resetPanelPositions() { calls.push('resetPanels'); }
  }, overrides);
  return app;
}

test('runCommand is a no-op without a document (importable, server-safe)', () => {
  const saved = globalThis.document;
  delete globalThis.document;
  try {
    const boom = new Proxy({}, { get() { throw new Error('must not touch the app'); } });
    assert.doesNotThrow(() => runCommand(boom, 'edit.undo'));
  } finally {
    if (saved) globalThis.document = saved;
  }
  installDocStub();
});

test('edit verbs delegate straight to the editor', () => {
  const app = makeApp();
  runCommand(app, 'edit.undo');
  runCommand(app, 'edit.redo');
  runCommand(app, 'edit.invert');
  assert.deepEqual(app.calls.filter(c => ['undo', 'redo', 'invert'].includes(c)), ['undo', 'redo', 'invert']);
});

test('cell.toggle punches a blank needle and blanks a punched one (lace-aware)', () => {
  const app = makeApp();
  runCommand(app, 'cell.toggle', { cell: { r: 0, c: 0 } }); // KNIT → EYELET
  assert.equal(app.editor.matrix[0][0], STITCH_TYPE.EYELET);
  runCommand(app, 'cell.toggle', { cell: { r: 0, c: 1 } }); // EYELET → KNIT
  assert.equal(app.editor.matrix[0][1], STITCH_TYPE.KNIT);
});

test('cell.fillRow floods the whole row via one setMatrix (undoable)', () => {
  const app = makeApp();
  runCommand(app, 'cell.fillRow', { cell: { r: 1, c: 1 } });
  assert.equal(app.calls.filter(c => c === 'setMatrix').length, 1);
  assert.deepEqual(app.editor.matrix[1], [STITCH_TYPE.EYELET, STITCH_TYPE.EYELET]);
});

test('file.close clears the canvas when there is no confirm dialog to answer', () => {
  const app = makeApp();
  runCommand(app, 'file.close');
  assert.ok(app.calls.includes('clear'));
  assert.ok(app.calls.includes('recompile'));
});

test('selection cut copies and notifies; win.bringForward raises the z-index', () => {
  const app = makeApp({ clipShelf: { capture: () => app.calls.push('shelfCapture') } });
  runCommand(app, 'edit.cut');
  assert.ok(app.calls.includes('cut') && app.calls.includes('shelfCapture'));
  const anchor = { style: {} };
  runCommand(app, 'win.bringForward', { anchor });
  assert.ok(Number(anchor.style.zIndex) >= 9100, 'handle sits above the app chrome');
});

test('async project failures are contained — never an unhandled rejection', async () => {
  const failures = [];
  const trap = err => failures.push(err);
  process.on('unhandledRejection', trap);
  const app = makeApp({
    projects: { commit: () => Promise.reject(new Error('IndexedDB exploded')) }
  });
  runCommand(app, 'file.save');
  await new Promise(r => setTimeout(r, 10));
  process.off('unhandledRejection', trap);
  assert.deepEqual(failures, [], 'a rejected project op must not escape the dispatcher');
});

test('recent-changing commands refresh the flyout and the bar state on the way out', () => {
  const app = makeApp({ projects: { commit: () => Promise.resolve({ name: 'x' }) } });
  runCommand(app, 'project.snapshot');
  assert.ok(app.calls.includes('recentRefresh'));
  assert.ok(app.calls.includes('menubarRefresh'));
});

test('unknown ids are inert but still leave the menus honest', () => {
  const app = makeApp();
  assert.doesNotThrow(() => runCommand(app, 'not.a.command'));
  assert.ok(app.calls.includes('menubarRefresh'));
});
