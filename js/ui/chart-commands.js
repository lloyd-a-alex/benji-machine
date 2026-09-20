/**
 * KNITCAT — the Chart and Select command vocabulary.
 *
 * `js/edit/chart-ops.js` and `js/edit/select-ops.js` contain fifty-odd DOM-free
 * functions that had never been reached from the interface: every row/column
 * surgery, every whole-card transform, region flips, resampling, re-gauging,
 * interleaving, smudging, softening, and the whole expand/contract/feather/align/
 * distribute selection family. They were correct and tested and invisible.
 *
 * This module is the doorway. It owns the *ids*, the prompts and the toasts; it owns
 * none of the arithmetic. Every operation here is three steps:
 *
 *   1. read the card through `editor.matrix` (the composited stack),
 *   2. hand it to a chart-ops/select-ops function that returns a NEW matrix,
 *   3. put the result back with `editor.setMatrix(next)`.
 *
 * Step 3 is the only write path in the editor, and it already commits history,
 * repaints, fires `onChange`, recompiles the punchcard, re-runs feasibility and
 * marks autosave. So every command in this file is undoable, saved and consistent
 * for free — which is the entire reason the commands live behind the dispatcher
 * instead of in the menu bar's click handlers.
 *
 * ## Which row, which column?
 *
 * Ambiguity here is the difference between "insert a plain row" and "cut a repeat in
 * half", so the index is resolved the same way every time, in this priority:
 *
 *   1. the cell under the cursor (`ctx.cell`) — right-click on row 7 means row 7;
 *   2. the head of the current selection — you marked the row, then asked;
 *   3. a prompt — the menu-bar path, where nothing was hovered.
 *
 * A count is *always* asked for, even when it would default to 1: inserting nine
 * copies of a repeat row is the normal case and typing 9 into a dialog costs one
 * second, while discovering a silent 1 costs a redo.
 *
 * @module ui/chart-commands
 */

import { blankValue } from '../edit/modes.js';
import { MACHINE_PROFILES, profileLimits } from '../machine/profiles.js';
import {
  insertRows,
  deleteRows,
  insertColumns,
  deleteColumns,
  reverseRow,
  reverseColumn,
  swapRows,
  swapColumns,
  moveRow,
  moveColumn,
  copyRow,
  copyColumn,
  pasteRow,
  transformMatrix,
  flipRegion,
  invertRegion,
  invertCells,
  softenRegion,
  convertRegion,
  resampleMatrix,
  regaugeMatrix,
  interleaveRows,
  parseCellAddress,
  formatCellAddress,
  matrixInfo
} from '../edit/chart-ops.js';
import { rectFromKeys } from '../edit/select-ops.js';
import { openFormDialog, safePrompt, safeConfirm, promptInteger } from './dialogs.js';

/** Cell-count guard for destructive row/column deletes above this size. */
const DESTRUCTIVE_CONFIRM_CELLS = 64;

/** Human labels for the modes, used by the convert submenu and its toasts. */
const MODE_LABELS = {
  lace: 'Lace',
  fair_isle: 'Fair Isle',
  tuck: 'Tuck',
  slip: 'Slip'
};

/**
 * The full vocabulary, in the order the menus list it. Consumed by
 * {@link chartPaletteActions} so Ctrl+K can find every one of these by name without
 * a second hand-maintained list drifting from the first.
 */
export const CHART_COMMAND_IDS = [
  'chart.row.insertAbove', 'chart.row.insertBelow', 'chart.row.delete', 'chart.row.duplicate',
  'chart.row.moveUp', 'chart.row.moveDown', 'chart.row.reverse', 'chart.row.swapUp', 'chart.row.swapDown',
  'chart.col.insertLeft', 'chart.col.insertRight', 'chart.col.delete', 'chart.col.duplicate',
  'chart.col.moveLeft', 'chart.col.moveRight', 'chart.col.reverse', 'chart.col.swapLeft', 'chart.col.swapRight',
  'chart.transform.rot90cw', 'chart.transform.rot90ccw', 'chart.transform.rot180',
  'chart.transform.transpose', 'chart.transform.antitranspose',
  'chart.region.flipH', 'chart.region.flipV', 'chart.region.invert',
  'chart.region.convert.lace', 'chart.region.convert.fair_isle', 'chart.region.convert.tuck', 'chart.region.convert.slip',
  'chart.matrix.resample', 'chart.matrix.regauge', 'chart.matrix.interleave', 'chart.soften',
  'chart.smudge', 'chart.jumpTo', 'chart.info'
];

/** Selection modification, alignment and distribution. */
export const SELECT_COMMAND_IDS = [
  'select.all', 'select.none', 'select.invert', 'select.punched', 'select.cellValue',
  'select.expand', 'select.contract', 'select.feather',
  'select.align.left', 'select.align.right', 'select.align.top', 'select.align.bottom',
  'select.align.centreH', 'select.align.centreV',
  'select.distribute.h', 'select.distribute.v',
  'select.move.up', 'select.move.down', 'select.move.left', 'select.move.right',
  'select.grow', 'select.shrink', 'select.wand', 'select.lasso', 'select.bezier', 'select.spline',
  'select.snap'
];
/** Every id this module answers, for tests and for the "did that menu item do anything?" question. */
export const COMMAND_IDS = [...CHART_COMMAND_IDS, ...SELECT_COMMAND_IDS];

/**
 * Turn a chart-ops result into a toast-worthy sentence. The ops already carry
 * `warnings`/`oversize`/`blocked`, and the point of surfacing them is that a
 * silently-clamped card is worse than a refusal: the knitter would have to notice
 * the difference themselves, on a punchcard, at the machine.
 */
function describeOversize(oversize, profile) {
  if (!oversize) return null;
  const name = profile?.name || 'this machine';
  const bits = [];
  if (Number.isFinite(oversize.maxRows) && oversize.rows > oversize.maxRows) {
    bits.push(`${oversize.rows} rows (the ${name} holds ${oversize.maxRows})`);
  }
  if (Number.isFinite(oversize.maxCols) && oversize.cols > oversize.maxCols) {
    bits.push(`${oversize.cols} needles (the ${name} holds ${oversize.maxCols})`);
  }
  return bits.length ? `That would make the card ${bits.join(' and ')}.` : null;
}

/** Which index does this operation mean? See the module header for the order. */
function resolveIndex(app, ed, ctx, axis) {
  const cell = ctx && ctx.cell;
  if (cell && Number.isFinite(axis === 'row' ? cell.r : cell.c)) {
    return axis === 'row' ? cell.r : cell.c;
  }
  const keys = ed.selectionKeys;
  if (keys && keys.size) {
    const bounds = rectFromKeys(keys);
    if (bounds) return axis === 'row' ? bounds.r1 : bounds.c1;
  }
  return null;
}

/** Ask for the index the caller could not infer. `null` = cancelled. */
function askIndex(ed, axis, count = 1) {
  const max = axis === 'row' ? ed.rows : ed.cols;
  const label = axis === 'row' ? 'Row' : 'Needle column';
  const raw = safePrompt(`${label} number to act on (1\u2013${max}${count > 1 ? `, start of ${count}` : ''})`, '1');
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n - 1 > max) return undefined;
  return n - 1;
}

export function runChartCommand(app, id, ctx = {}) {
  const ed = app && app.editor;
  if (!ed || !COMMAND_IDS.includes(id)) return false;

  const mode = ed.mode || app.currentMode || 'lace';
  const profile = app.currentProfile || null;
  const limits = profileLimits(profile) || { minRows: 1, maxRows: 4000, minCols: 1, maxCols: ed.cols };
  const say = (message, opts) => app._editorNotice?.(message, opts) || app.notifications?.info?.(message, opts);
  const ok = (message, opts) => say(message, { ...opts, kind: 'success' });
  const warn = (message, opts) => say(message, { ...opts, kind: 'warn', duration: 8000 });

  /** Commit a new card through the one undoable write path. */
  const apply = (next, label) => {
    ed.setLabel(label);
    ed.setMatrix(next);
  };

  /**
   * Run a chart-ops function that returns `{ok, matrix, warnings, oversize}` and
   * turn its result into exactly one honest toast.
   */
  const runOp = (op, label, { expectSize = null } = {}) => {
    let result;
    try {
      result = op();
    } catch (err) {
      warn(`That could not be done: ${err?.message || err}.`, { details: 'Your card is unchanged.' });
      return false;
    }
    if (!result) return false;
    if (result.ok === false) {
      const oversize = describeOversize(result.oversize, profile);
      warn(oversize || result.error || `That ${label.toLowerCase()} could not be applied.`, {
        details: oversize ? 'Nothing on the card was changed.' : undefined
      });
      return false;
    }
    if (result.matrix) apply(result.matrix, label);
    const warning = (result.warnings && result.warnings[0]) || null;
    const detail = expectSize ? `${label} \u00b7 card is now ${expectSize.rows}\u00d7${expectSize.cols}.` : `${label}.`;
    if (warning) say(`${detail} ${warning}`, { kind: 'info', duration: 9000 });
    else ok(detail);
    return true;
  };

  const cellCount = matrix => {
    const info = matrixInfo(matrix || []);
    return info.rows * info.cols;
  };

  const askCount = (title, current, max) => {
    const raw = promptInteger(title, { min: 1, max: Math.max(1, max), value: Math.min(4, Math.max(1, current)) });
    if (raw === null) return null; // cancelled
    if (raw === undefined) {
      warn('That was not a number, so nothing was changed.');
      return null;
    }
    return raw;
  };

  const indexOrAsk = axis => {
    let index = resolveIndex(app, ed, ctx, axis);
    if (index === null) index = askIndex(ed, axis);
    if (index === null) return null; // dialog cancelled
    if (index === undefined) {
      warn('That row number is off the card, so nothing was changed.');
      return null;
    }
    return index;
  };

  const insertAxis = (axis, before) => {
    const span = axis === 'row' ? ed.rows : ed.cols;
    const index = indexOrAsk(axis);
    if (index === null) return;
    const count = askCount(`How many ${axis === 'row' ? 'rows' : 'needle columns'} to insert`, 1, limits.maxRows || 4000);
    if (count === null) return;
    const at = before ? index : Math.min(span - 1, index) + 1;
    const label = `${before ? 'Insert' : 'Insert after'} ${axis === 'row' ? 'row' : 'column'}`;
    runOp(
      () => (axis === 'row'
        ? insertRows(ed.matrix, at, count, { mode, maxRows: limits.maxRows, maxCols: limits.maxCols })
        : insertColumns(ed.matrix, at, count, { mode, maxRows: limits.maxRows, maxCols: limits.maxCols })),
      label,
      { expectSize: { rows: ed.rows + (axis === 'row' ? count : 0), cols: ed.cols + (axis === 'row' ? 0 : count) } }
    );
  };

  const deleteAxis = axis => {
    const index = indexOrAsk(axis);
    if (index === null) return;
    const count = askCount(`How many ${axis === 'row' ? 'rows' : 'needle columns'} to delete`, 1, axis === 'row' ? ed.rows : ed.cols);
    if (count === null) return;
    const matrix = ed.matrix;
    // Deleting rows of a tuck-stitch card is how repeats get silently broken, so a
    // delete that would remove worked cells above a trivial size asks first.
    let removing = 0;
    for (let i = 0; i < count; i++) {
      const line = axis === 'row' ? matrix[index + i] : null;
      if (axis === 'row') {
        if (line) removing += line.filter(v => v !== blankValue(mode)).length;
      } else {
        for (let r = 0; r < matrix.length; r++) if (matrix[r] && matrix[r][index + i] !== blankValue(mode)) removing += 1;
      }
    }
    if (removing >= DESTRUCTIVE_CONFIRM_CELLS) {
      const noun = axis === 'row' ? 'row' : 'column';
      if (!safeConfirm(`Delete ${count} ${noun}${count === 1 ? '' : 's'} holding ${removing} worked cell${removing === 1 ? '' : 's'}? Undo brings them back.`)) {
        say('Cancelled — nothing was deleted.');
        return;
      }
    }
    runOp(
      () => (axis === 'row' ? deleteRows(matrix, index, count) : deleteColumns(matrix, index, count)),
      `Delete ${nounOr(axis)}`,
      { expectSize: { rows: ed.rows - (axis === 'row' ? count : 0), cols: ed.cols - (axis === 'row' ? 0 : count) } }
    );
  };

  const nounOr = axis => (axis === 'row' ? 'rows' : 'columns');

  const moveAxis = (axis, delta) => {
    const index = indexOrAsk(axis);
    if (index === null) return;
    const to = index + delta;
    if (to < 0 || to >= (axis === 'row' ? ed.rows : ed.cols)) {
      say(`That ${axis} is already at the edge of the card.`);
      return;
    }
    runOp(
      () => (axis === 'row' ? moveRow(ed.matrix, index, to) : moveColumn(ed.matrix, index, to)),
      `Move ${axis} ${delta < 0 ? 'up/left' : 'down/right'}`
    );
  };

  const swapAxis = (axis, delta) => {
    const index = indexOrAsk(axis);
    if (index === null) return;
    const other = index + delta;
    if (other < 0 || other >= (axis === 'row' ? ed.rows : ed.cols)) {
      say(`There is nothing to swap with past the ${delta < 0 ? 'start' : 'end'} of the card.`);
      return;
    }
    runOp(
      () => (axis === 'row' ? swapRows(ed.matrix, index, other) : swapColumns(ed.matrix, index, other)),
      `Swap ${axis} ${index + 1} \u21c4 ${other + 1}`
    );
  };

  const reverseAxis = axis => {
    const index = indexOrAsk(axis);
    if (index === null) return;
    runOp(
      () => (axis === 'row' ? reverseRow(ed.matrix, index, { mode }) : reverseColumn(ed.matrix, index, { mode })),
      `Reverse ${axis === 'row' ? `row ${index + 1}` : `needle column ${index + 1}`}`
    );
  };

  const duplicateAxis = axis => {
    const index = indexOrAsk(axis);
    if (index === null) return;
    const matrix = ed.matrix;
    if (axis === 'row') {
      const captured = copyRow(matrix, index);
      runOp(
        () => pasteRow(matrix, index + 1, captured.cells, { op: 'insert', mode }),
        `Duplicate row ${index + 1}`,
        { expectSize: { rows: ed.rows + 1, cols: ed.cols } }
      );
    } else {
      const captured = copyColumn(matrix, index);
      runOp(
        () => copyColumnInto(matrix, captured.cells, index + 1, mode),
        `Duplicate needle column ${index + 1}`,
        { expectSize: { rows: ed.rows, cols: ed.cols + 1 } }
      );
    }
  };

  /** Insert one column and write a copied column's cells into it. */
  const copyColumnInto = (matrix, cells, at, currentMode) => {
    const inserted = insertColumns(matrix, at, 1, { mode: currentMode });
    if (!inserted || inserted.ok === false) return inserted;
    const next = inserted.matrix.map(row => [...row]);
    for (let r = 0; r < next.length; r++) if (Number.isFinite(cells[r])) next[r][at] = cells[r];
    return { ...inserted, matrix: next };
  };

  const transform = kind => {
    runOp(
      () => transformMatrix(ed.matrix, kind, { mode, maxRows: limits.maxRows, maxCols: limits.maxCols }),
      `Transform: ${kind}`
    );
  };

  /** A region op needs a marquee; without one there is nothing to act on. */
  const regionOr = () => {
    const keys = ed.selectionKeys;
    if (!keys || !keys.size) {
      warn('Select something first — a marquee, the wand or the lasso.', {
        details: 'S, W or K puts you in the right tool.'
      });
      return null;
    }
    return rectFromKeys(keys);
  };

  const regionFlip = axis => {
    const rect = regionOr();
    if (!rect) return;
    runOp(() => flipRegion(ed.matrix, rect, axis, { mode }), `Flip selection ${axis === 'h' ? 'horizontally' : 'vertically'}`);
  };

  const regionInvert = () => {
    const keys = ed.selectionKeys;
    if (!keys || !keys.size) {
      runOp(() => invertRegion(ed.matrix, null, { mode }), 'Invert card');
      return;
    }
    const result = invertCells(ed.matrix, keys, { mode });
    if (result && result.matrix) {
      apply(result.matrix, 'Invert selection');
      ok(`Inverted ${result.changed} cell${result.changed === 1 ? '' : 's'} in the selection.`);
    }
  };

  const regionConvert = to => {
    const rect = regionOr();
    if (!rect) return;
    if (to === mode) {
      say(`The card is already in ${MODE_LABELS[to] || to} mode.`);
      return;
    }
    runOp(() => convertRegion(ed.matrix, rect, { from: mode, to }), `Convert selection to ${MODE_LABELS[to] || to}`);
  };

  // ── the modal-backed matrix operations ─────────────────────────────────────
  const resampleDialog = () => {
    openFormDialog({
      id: 'resample',
      title: 'Resample the card',
      description: 'Resize the chart itself. “Tile” repeats the design like a stitch multiple; “nearest” stretches it like a photocopy.',
      notifier: app.notifications,
      fields: [
        { name: 'rows', label: 'Rows', type: 'number', min: 1, max: limits.maxRows || 4000, value: ed.rows },
        { name: 'cols', label: 'Needles', type: 'number', min: 1, max: limits.maxCols || ed.cols, value: ed.cols },
        {
          name: 'method',
          label: 'Method',
          type: 'radio',
          options: [
            { value: 'nearest', label: 'Stretch (nearest cell)' },
            { value: 'repeat', label: 'Tile the repeat' }
          ],
          value: 'nearest'
        }
      ],
      submitLabel: 'Resample',
      onSubmit: values => {
        const result = resampleMatrix(ed.matrix, { rows: values.rows, cols: values.cols, method: values.method });
        if (!result || result.ok === false) return { ok: false, message: result?.error || 'That could not be resampled.' };
        apply(result.matrix, `Resample to ${values.rows}\u00d7${values.cols}`);
        return { ok: true, message: `Resampled to ${result.matrix.length}\u00d7${result.matrix[0].length}.` };
      }
    });
  };

  const regaugeDialog = () => {
    const options = Object.values(MACHINE_PROFILES || {}).map(p => ({
      value: p.id,
      label: `${p.name} \u00b7 ${p.pitchX}\u00d7${p.pitchY} mm`
    }));
    if (!options.length) {
      warn('No machine profiles are loaded, so there is nothing to re-gauge between.');
      return;
    }
    openFormDialog({
      id: 'regauge',
      title: 'Re-gauge for another machine',
      description: 'Keeps the finished measurements in millimetres and changes the stitch count to match a different needle pitch.',
      notifier: app.notifications,
      fields: [
        { name: 'from', label: 'Gauged for', type: 'select', options: options, value: profile?.id || options[0].value },
        { name: 'to', label: 'Knit on', type: 'select', options: options, value: (options[1] || options[0]).value },
        {
          name: 'method',
          label: 'Sampling',
          type: 'radio',
          options: [
            { value: 'nearest', label: 'Nearest cell' },
            { value: 'repeat', label: 'Tile the repeat' }
          ],
          value: 'nearest'
        }
      ],
      submitLabel: 'Re-gauge',
      onSubmit: values => {
        const from = MACHINE_PROFILES[values.from];
        const to = MACHINE_PROFILES[values.to];
        if (!from || !to) return { ok: false, message: 'Pick two known machines.' };
        const result = regaugeMatrix(ed.matrix, {
          fromPitchX: from.pitchX,
          fromPitchY: from.pitchY,
          toPitchX: to.pitchX,
          toPitchY: to.pitchY,
          method: values.method
        });
        if (!result || result.ok === false) return { ok: false, message: result?.error || 'That could not be re-gauged.' };
        apply(result.matrix, `Re-gauge ${from.name} \u2192 ${to.name}`);
        const note = (result.warnings || [])[0];
        return {
          ok: true,
          kind: 'info',
          message: `Now ${result.rows}\u00d7${result.cols} for the ${to.name} (${result.widthMm ? `${Math.round(result.widthMm)} mm wide` : 'width unknown'}).`,
          details: note
        };
      }
    });
  };

  const interleaveDialog = () => {
    const matrix = ed.matrix;
    const overlayOptions = [
      { value: 'selection', label: 'The current selection' },
      { value: 'row1', label: 'Row 1 (the cast-on edge)' },
      ...Array.from({ length: Math.max(0, Math.min(matrix.length, 48)) }, (_, i) => ({
        value: String(i),
        label: `Row ${i + 1}`
      }))
    ];
    openFormDialog({
      id: 'interleave',
      title: 'Interleave a repeat row',
      description: 'Weaves an overlay row through the card every N rows — how a mailles endroit row is slipped between two decreases rows.',
      notifier: app.notifications,
      fields: [
        { name: 'source', label: 'Read the overlay from', type: 'select', options: overlayOptions, value: 'row1' },
        { name: 'every', label: 'Every how many rows', type: 'number', min: 1, max: 64, value: 2 },
        { name: 'offset', label: 'Starting after row', type: 'number', min: 0, max: Math.max(0, matrix.length - 1), value: 0 }
      ],
      submitLabel: 'Interleave',
      onSubmit: values => {
        let overlay = null;
        if (values.source === 'selection') {
          const rect = regionOr();
          if (!rect) return { ok: false, message: 'Nothing is selected to weave in.' };
          overlay = [];
          for (let r = rect.r1; r <= rect.r2; r++) overlay.push(matrix[r].slice(rect.c1, rect.c2 + 1));
          // A wide selection cannot be woven into a narrower card row by row; it is
          // tiled from the left, which is what a repeat strip means.
        } else if (values.source === 'row1') {
          overlay = [matrix[0].slice()];
        } else {
          const r = Number(values.source);
          overlay = [matrix[r] ? matrix[r].slice() : []];
        }
        const result = interleaveRows(matrix, overlay, { every: values.every, offset: values.offset, mode });
        if (!result || result.ok === false) return { ok: false, message: result?.error || 'That could not be interleaved.' };
        apply(result.matrix, `Interleave every ${values.every} rows`);
        return { ok: true, message: `Inserted ${(result.inserted || []).length} row${(result.inserted || []).length === 1 ? '' : 's'}.` };
      }
    });
  };

  const jumpTo = () => {
    const raw = safePrompt('Jump to — “row 4, col 12” or “4,12”', '1,1');
    if (raw === null) return;
    const parsed = parseCellAddress(raw);
    if (!parsed.ok) {
      warn(parsed.error || 'That is not a row-and-needle address.', { details: 'Try “row 4, needle 12”.' });
      return;
    }
    if (parsed.r >= ed.rows || parsed.c >= ed.cols) {
      warn(`${formatCellAddress(parsed.r, parsed.c).label} is off this card (${ed.rows}\u00d7${ed.cols}).`);
      return;
    }
    ed.setHighlight?.([[parsed.r, parsed.c]], { label: formatCellAddress(parsed.r, parsed.c).label, color: '#38bdf8' });
    ed.scrollToCells?.([[parsed.r, parsed.c]]);
    ed.render();
    ok(`Jumped to ${formatCellAddress(parsed.r, parsed.c).label}.`);
  };

  const chartInfo = () => {
    const matrix = ed.matrix;
    const info = matrixInfo(matrix);
    const blank = blankValue(mode);
    let punched = 0;
    for (const row of matrix) for (const value of row) if (value !== blank) punched += 1;
    const total = Math.max(1, info.rows * info.cols);
    const size = app._cardSizeSummary ? app._cardSizeSummary(info) : null;
    say(
      `Card ${info.rows}\u00d7${info.cols} \u00b7 ${punched} worked cell${punched === 1 ? '' : 's'} (${Math.round((punched / total) * 100)}% of the bed)${size ? ` \u00b7 ${size}` : ''}` +
        (info.ragged ? ' \u26a0 the card is ragged, which should not happen' : ''),
      { kind: 'info', details: `${ed.getLayers().length} layer(s), ${ed.tree?.nodes?.size || 0} history node(s).` }
    );
  };

  // ── selection family ───────────────────────────────────────────────────────
  const requireSelection = () => {
    const keys = ed.selectionKeys;
    if (!keys || !keys.size) {
      warn('Nothing is selected yet.', { details: 'Drag a marquee (S), click with the wand (W) or lasso a shape (K).' });
      return false;
    }
    return true;
  };
  
  const moveSelection = (dr, dc) => {
    if (!requireSelection()) return;
    const result = ed.moveSelectionContent(dr, dc);
    if (result === false) say('That move would put a selected cell off the card.');
    else if (result && result.ok === false) warn(result.error || 'The selection cannot go that far.');
    else ok(`Moved the selection ${Math.abs(dc) > 0 ? `${Math.abs(dc)} needle(s) ${dc > 0 ? 'right' : 'left'}` : `${Math.abs(dr)} row(s) ${dr > 0 ? 'down' : 'up'}`}.`);
  };
  
  const align = (target, words) => {
    if (!requireSelection()) return;
    if (ed.alignSelection(target) === true) ok(`Aligned the selected regions ${words}.`);
    else warn('Alignment needs two or more separate shapes in the selection.', {
      details: 'Select two motifs and choose Align again.'
    });
  };
  
  const distribute = axis => {
    if (!requireSelection()) return;
    if (ed.distributeSelection(axis) === true) ok('Evened out the gaps between the shapes.');
    else warn('Distribution needs three or more separate shapes in the selection.');
  };
  
  /** One-ring grow / shrink, the no-prompt sibling of the Modify dialogs. */
  const nudgeSelection = (kind, passes) => {
    if (!requireSelection()) return;
    const before = ed.selectionKeys.size;
    const after = kind === 'expand' ? ed.expandSelection(passes) : ed.contractSelection(passes);
    if (!after) {
      warn(kind === 'expand' ? 'The selection already covers the card.' : 'Contracting once more would empty the selection.', {
        details: 'Select → Expand first, then contract from a bigger shape.'
      });
      return;
    }
    ok(`${before} → ${after} cell(s).`);
  };
  
  const modify = kind => {
    if (!requireSelection()) return;
    const before = ed.selectionKeys.size;
    const raw = safePrompt(`How many ${kind === 'expand' ? 'rings to add' : kind === 'contract' ? 'rings to remove' : 'feather passes'}?`, '1');
    if (raw === null) return;
    const passes = Math.max(1, Math.min(24, parseInt(raw, 10) || 1));
    const after = kind === 'expand' ? ed.expandSelection(passes)
      : kind === 'contract' ? ed.contractSelection(passes)
        : before + ed.featherSelection(passes);
    ok(`${kind === 'expand' ? 'Expanded' : kind === 'contract' ? 'Contracted' : 'Feathered'} the selection: ${before} \u2192 ${after} cell(s).`);
  };
  
  const selectValueUnderCursor = () => {
    const cell = ctx && ctx.cell;
    if (!cell) {
      const typed = safePrompt('Select every cell holding which symbol? (K, O, −, /, \\ …)', 'O');
      if (typed === null) return;
      const n = ed.selectMatchingValue(typed.trim());
      ok(`Selected ${n} cell(s) marked "${typed.trim()}".`);
      return;
    }
    const value = ed.matrix[cell.r] && ed.matrix[cell.r][cell.c];
    const result = ed.selectMatchingValue(value);
    const label = typeof value === 'string' ? value : value === 1 ? 'punched' : 'blank';
    ok(`Selected ${result ?? 0} cell(s) marked ${label}.`, { details: 'Ctrl+C captures them to the clip shelf.' });
  };

  try {
    switch (id) {
      // ── rows ───────────────────────────────────────────────────────────────
      case 'chart.row.insertAbove': insertAxis('row', true); break;
      case 'chart.row.insertBelow': insertAxis('row', false); break;
      case 'chart.row.delete': deleteAxis('row'); break;
      case 'chart.row.duplicate': duplicateAxis('row'); break;
      case 'chart.row.moveUp': moveAxis('row', -1); break;
      case 'chart.row.moveDown': moveAxis('row', 1); break;
      case 'chart.row.swapUp': swapAxis('row', -1); break;
      case 'chart.row.swapDown': swapAxis('row', 1); break;
      case 'chart.row.reverse': reverseAxis('row'); break;

      // ── columns ────────────────────────────────────────────────────────────
      case 'chart.col.insertLeft': insertAxis('col', true); break;
      case 'chart.col.insertRight': insertAxis('col', false); break;
      case 'chart.col.delete': deleteAxis('col'); break;
      case 'chart.col.duplicate': duplicateAxis('col'); break;
      case 'chart.col.moveLeft': moveAxis('col', -1); break;
      case 'chart.col.moveRight': moveAxis('col', 1); break;
      case 'chart.col.swapLeft': swapAxis('col', -1); break;
      case 'chart.col.swapRight': swapAxis('col', 1); break;
      case 'chart.col.reverse': reverseAxis('col'); break;

      // ── whole-card transforms ──────────────────────────────────────────────
      case 'chart.transform.rot90cw': transform('rot90cw'); break;
      case 'chart.transform.rot90ccw': transform('rot90ccw'); break;
      case 'chart.transform.rot180': transform('rot180'); break;
      case 'chart.transform.transpose': transform('transpose'); break;
      case 'chart.transform.antitranspose': transform('antitranspose'); break;

      // ── region ─────────────────────────────────────────────────────────────
      case 'chart.region.flipH': regionFlip('h'); break;
      case 'chart.region.flipV': regionFlip('v'); break;
      case 'chart.region.invert': regionInvert(); break;
      case 'chart.region.convert.lace': regionConvert('lace'); break;
      case 'chart.region.convert.fair_isle': regionConvert('fair_isle'); break;
      case 'chart.region.convert.tuck': regionConvert('tuck'); break;
      case 'chart.region.convert.slip': regionConvert('slip'); break;

      // ── matrix modals ──────────────────────────────────────────────────────
      case 'chart.matrix.resample': resampleDialog(); break;
      case 'chart.matrix.regauge': regaugeDialog(); break;
      case 'chart.matrix.interleave': interleaveDialog(); break;
      case 'chart.soften': {
        const rect = regionOr();
        if (!rect) break;
        const raw = safePrompt('Soften passes (each pass is one majority vote over the 8 neighbours)', '1');
        if (raw === null) break;
        const passes = Math.max(1, Math.min(8, parseInt(raw, 10) || 1));
        runOp(() => softenRegion(ed.matrix, rect, { passes, mode }), `Soften selection \u00d7${passes}`);
        break;
      }
      case 'chart.smudge':
        if (app._selectTool && app._selectTool('smudge')) say('Smudge tool — drag across the card and the stitches follow.');
        break;
      case 'chart.jumpTo': jumpTo(); break;
      case 'chart.info': chartInfo(); break;

      // ── select ─────────────────────────────────────────────────────────────
      case 'select.all': ed.selectAll(); ok(`Selected the whole card (${ed.selectionKeys.size} cells).`); break;
      case 'select.none': ed.clearSelection(); ed.render(); say('Selection cleared.'); break;
      case 'select.invert': {
        if (!ed.selectionKeys || !ed.selectionKeys.size) { warn('Nothing is selected to invert.'); break; }
        ed.invertSelection();
        ok(`Inverted: ${ed.selectionKeys.size} cell(s) selected.`);
        break;
      }
      case 'select.punched': {
        const n = ed.selectPunched();
        ok(`Selected ${n ?? 0} punched cell${n === 1 ? '' : 's'}.`);
        break;
      }
      case 'select.cellValue': selectValueUnderCursor(); break;
      case 'select.expand': modify('expand'); break;
      case 'select.contract': modify('contract'); break;
      case 'select.feather': modify('feather'); break;
      case 'select.align.left': align('min-col', 'to the left edge'); break;
      case 'select.align.right': align('max-col', 'to the right edge'); break;
      case 'select.align.top': align('min-row', 'to the top'); break;
      case 'select.align.bottom': align('max-row', 'to the bottom'); break;
      case 'select.align.centreH': align('centre-col', 'centred horizontally'); break;
      case 'select.align.centreV': align('centre-row', 'centred vertically'); break;
      case 'select.distribute.h': distribute('h'); break;
      case 'select.distribute.v': distribute('v'); break;
      case 'select.move.up': moveSelection(-1, 0); break;
      case 'select.move.down': moveSelection(1, 0); break;
      case 'select.move.left': moveSelection(0, -1); break;
      case 'select.move.right': moveSelection(0, 1); break;
      case 'select.grow': nudgeSelection('expand', 1); break;
      case 'select.shrink': nudgeSelection('contract', 1); break;
      case 'select.wand': app._selectTool?.('wand'); say('Magic wand — click a cell to take its whole contiguous region.'); break;
      case 'select.lasso': app._selectTool?.('lasso'); say('Lasso — draw a loop around what you want, release to select it.'); break;
      case 'select.bezier': app._selectTool?.('bezier'); say('Bezier — click four points: start, two handles, end.'); break;
      case 'select.spline': app._selectTool?.('spline'); say('Spline — click through your points, Enter to draw the curve.'); break;
      case 'select.snap': {
        ed.snapGuides = !ed.snapGuides;
        ed.render();
        say(`Snapping to guides and repeats is ${ed.snapGuides ? 'on' : 'off'}.`);
        break;
      }
      default: return false;
    }
  } catch (err) {
    warn(`That chart operation failed: ${err?.message || err}.`, { details: 'Your card is unchanged.' });
  }
  // Any of these can have changed the selection or the card; the menu bar and the
  // structure panel read live state, so both are told to look again.
  try { app.menubar?.refresh?.(); } catch (_) { /* contained */ }
  try { app.structurePanel?.refresh?.(); } catch (_) { /* contained */ }
  return true;
}

/**
 * Ctrl+K entries for the whole vocabulary, built from the same tables the menus use
 * so the palette cannot fall behind a newly added command.
 */
export function chartPaletteActions(app) {
  const label = id => {
    const parts = id.split('.');
    const tail = parts[parts.length - 1];
    return tail.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
  };
  const groupFor = id => (id.startsWith('select.') ? 'Select' : 'Chart');
  return COMMAND_IDS.map(id => ({
    label: `${groupFor(id)}: ${label(id)}`,
    group: groupFor(id),
    keywords: `${id} ${label(id)} ${groupFor(id)} chart edit rows columns needles transform region matrix select`.toLowerCase(),
    run: () => app.runCommand(id)
  }));
}
