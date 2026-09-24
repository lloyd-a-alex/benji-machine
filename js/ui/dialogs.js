/**
 * KNITCAT — the small modal dialogs the chart commands need.
 *
 * Why this is its own module: half a dozen operations genuinely cannot be one click
 * ("insert how many rows? resample to what size? which machine are we re-gauging
 * from?"). Writing a fresh DOM-building prompt inside each of them would give the app
 * six subtly different modals, six different Escape behaviours and six ways to leak
 * a focus trap. This is the one shape, reused.
 *
 * Two tiers, deliberately:
 *
 *   - {@link safePrompt} / {@link safeConfirm} for the one-field cases. They use the
 *     *browser's* own prompt/confirm, which is instant, accessible, and needs no
 *     focus management from us. They are wrapped because `window.prompt` throws in
 *     sandboxed frames and returns `null` when a person hits Cancel — both of which
 *     a chart command has to survive.
 *   - {@link openFormDialog} for anything with two or more fields, a dropdown, or a
 *     radio group. It builds a `.modal-backdrop` card in the house style, validates
 *     each field against its own declaration, and only calls `onSubmit` with a clean
 *     object.
 *
 * Nothing in here touches the editor or the matrix: a dialog reports what the person
 * asked for and lets the caller do the surgery through `editor.setMatrix()`, which
 * keeps every one of these operations undoable by definition.
 *
 * DOM-free at import, so it is unit-testable in Node like the rest of `js/ui/`.
 *
 * @module ui/dialogs
 */

import { logger } from '../core/logging.js';

const log = logger('ui/dialogs');

const DIALOG_STACK = [];

/** Escape/cancel for `window.prompt`, which can throw in embedded frames. */
export function safePrompt(title, value = '') {
  try {
    if (typeof window === 'undefined' || typeof window.prompt !== 'function') return null;
    const answer = window.prompt(title, value);
    return typeof answer === 'string' ? answer : null;
  } catch (err) {
    log.debug('window.prompt threw (sandboxed frame?) — treating it as a cancel', { error: err?.message });
    return null;
  }
}

/** Escape/cancel for `window.confirm`. Denial is the safe default. */
export function safeConfirm(message) {
  try {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true;
    return Boolean(window.confirm(message));
  } catch (err) {
    log.debug('window.confirm threw (sandboxed frame?) — defaulting to denial', { error: err?.message });
    return false;
  }
}

/** Parse a number out of a prompt answer, or return `null` — never `NaN`. */
export function parseNumber(text, { min = -Infinity, max = Infinity, integer = true, fallback = null } = {}) {
  if (text === null || text === undefined) return fallback;
  const trimmed = String(text).trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed.replace(/[^\d+\-.]/g, ''));
  if (!Number.isFinite(n)) return fallback;
  let value = integer ? Math.trunc(n) : n;
  if (value < min || value > max) return null; // explicitly out of range → caller warns
  return value;
}

/** An integer inside a range, or `null`. The most common prompt in the chart menu. */
export function promptInteger(title, { min = 0, max = 100000, value = min } = {}) {
  const raw = safePrompt(`${title} (${min}\u2013${max})`, String(value));
  if (raw === null) return null; // cancelled
  const n = parseNumber(raw, { min, max });
  return n === null ? undefined : n; // undefined means "unparseable", null means "cancelled"
}

const FIELD_TYPES = new Set(['number', 'text', 'select', 'radio', 'checkbox', 'textarea']);

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normaliseFields(fields = []) {
  return fields
    .filter(field => field && typeof field.name === 'string' && /^[a-z][a-z0-9_]{0,30}$/i.test(field.name))
    .map(field => ({
      name: field.name,
      label: field.label || field.name,
      type: FIELD_TYPES.has(field.type) ? field.type : 'text',
      value: field.value,
      default: field.default,
      min: Number.isFinite(field.min) ? field.min : -Infinity,
      max: Number.isFinite(field.max) ? field.max : Infinity,
      step: Number.isFinite(field.step) ? field.step : 1,
      hint: typeof field.hint === 'string' ? field.hint : '',
      required: Boolean(field.required),
      options: Array.isArray(field.options)
        ? field.options
          .filter(o => o && (typeof o === 'string' || (typeof o.value === 'string' && o.value)))
          .map(o => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label || o.value }))
        : []
    }));
}

function fieldHtml(field) {
  const id = `kx-form-${field.name}`;
  const current = field.value !== undefined && field.value !== null ? field.value : field.default;
  const hint = field.hint ? `<div class="kx-form-hint">${esc(field.hint)}</div>` : '';
  const label = `<label class="kx-form-label" for="${id}">${esc(field.label)}</label>`;
  if (field.type === 'select') {
    return `<div class="kx-form-field">${label}
      <select id="${id}" data-field="${esc(field.name)}">
        ${field.options.map(o => `<option value="${esc(o.value)}"${String(o.value) === String(current) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>${hint}</div>`;
  }
  if (field.type === 'radio') {
    // Real radios rather than a dropdown: a two-choice sampling method is a
    // decision you want to see both halves of before committing to one.
    return `<div class="kx-form-field">${label}
      <div class="kx-form-radios" role="radiogroup" aria-label="${esc(field.label)}">
        ${field.options.map((o, i) => `<label class="kx-form-radio"><input type="radio" name="${esc(field.name)}" value="${esc(o.value)}"${String(o.value) === String(current) || (current === undefined && i === 0) ? ' checked' : ''} /> <span>${esc(o.label)}</span></label>`).join('')}
      </div>${hint}</div>`;
  }
  if (field.type === 'checkbox') {
    return `<div class="kx-form-field kx-form-field-inline"><label class="kx-form-label kx-form-check"><input type="checkbox" id="${id}" data-field="${esc(field.name)}"${current ? ' checked' : ''} /> ${esc(field.label)}</label>${hint}</div>`;
  }
  if (field.type === 'textarea') {
    return `<div class="kx-form-field">${label}<textarea id="${id}" data-field="${esc(field.name)}" rows="3">${esc(current ?? '')}</textarea>${hint}</div>`;
  }
  const inputType = field.type === 'number' ? 'number' : 'text';
  const numeric = field.type === 'number'
    ? ` min="${esc(field.min)}" max="${esc(field.max)}" step="${esc(field.step)}"`
    : '';
  return `<div class="kx-form-field">${label}<input type="${inputType}" id="${id}" data-field="${esc(field.name)}" value="${esc(current ?? '')}"${numeric} />${hint}</div>`;
}

/** Read + validate the form. Returns {ok, values, errors}. */
export function collectFormValues(root, fields) {
  const values = {};
  const errors = [];
  for (const field of fields) {
    if (field.type === 'radio') {
      const checked = root.querySelector(`input[name="${field.name}"]:checked`);
      const raw = checked ? checked.value : (field.options[0] ? field.options[0].value : '');
      values[field.name] = raw;
      continue;
    }
    const input = root.querySelector(`[data-field="${field.name}"]`);
    if (!input) {
      errors.push(`${field.label}: this field is missing from the dialog.`);
      continue;
    }
    if (field.type === 'checkbox') {
      values[field.name] = Boolean(input.checked);
      continue;
    }
    if (field.type === 'number') {
      if (input.value === '' && !field.required) {
        values[field.name] = null;
        continue;
      }
      const parsed = parseNumber(input.value, { min: field.min, max: field.max, integer: field.step === 1 || !Number.isFinite(field.step), fallback: null });
      if (parsed === null) {
        errors.push(`${field.label}: enter a number between ${field.min} and ${field.max}.`);
        continue;
      }
      values[field.name] = parsed;
      continue;
    }
    const text = String(input.value ?? '').trim();
    if (field.required && !text) {
      errors.push(`${field.label}: this cannot be empty.`);
      continue;
    }
    values[field.name] = text;
  }
  return { ok: errors.length === 0, values, errors };
}

/**
 * Open a form dialog.
 *
 * @param {object} spec
 * @param {string} spec.title           heading text
 * @param {string} [spec.description]   one calm sentence under the heading
 * @param {Array}  spec.fields          see {@link normaliseFields}
 * @param {string} [spec.submitLabel]
 * @param {(values: object) => ({ok?: boolean, message?: string, details?: string}|void)} [spec.onSubmit]
 *        return `{ok:false}` to keep the dialog open and show `message` instead
 * @param {() => void} [spec.onCancel]
 * @returns {{close: () => void, element: HTMLElement}|null} null when there is no DOM
 */
export function openFormDialog(spec = {}) {
  if (typeof document === 'undefined' || !document.body) return null;
  const fields = normaliseFields(spec.fields);
  const id = `kx-form-dialog-${String(spec.id || 'field').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'field'}`;

  // One dialog per id: re-opening "Resample" must stack a second copy of it.
  document.getElementById(id)?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop active kx-form-backdrop';
  backdrop.id = id;
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', spec.title || 'Settings');
  backdrop.innerHTML = `<div class="modal-card kx-form-card" style="width:min(520px,94vw)">
    <div class="modal-header">
      <div class="modal-title">${esc(spec.title || 'Settings')}</div>
      <button class="modal-close" type="button" aria-label="Close">&times;</button>
    </div>
    <div class="modal-body">
      ${spec.description ? `<p class="kx-form-desc">${esc(spec.description)}</p>` : ''}
      <form class="kx-form" novalidate>
        ${fields.map(fieldHtml).join('\n')}
        <div class="kx-form-error" id="${id}-error" role="alert" aria-live="polite" hidden></div>
        <div class="kx-form-actions">
          <button type="button" class="btn-action kx-form-cancel">${esc(spec.cancelLabel || 'Cancel')}</button>
          <button type="button" class="btn-action btn-primary kx-form-submit">${esc(spec.submitLabel || 'Apply')}</button>
        </div>
      </form>
    </div>
  </div>`;
  document.body.appendChild(backdrop);

  const errorBox = backdrop.querySelector('.kx-form-error');
  const close = () => {
    backdrop.remove();
    const index = DIALOG_STACK.indexOf(handle);
    if (index >= 0) DIALOG_STACK.splice(index, 1);
    document.removeEventListener('keydown', onKey, true);
  };
  const showError = messages => {
    errorBox.hidden = !messages.length;
    errorBox.textContent = messages.join(' ');
  };
  const submit = () => {
    const collected = collectFormValues(backdrop, fields);
    if (!collected.ok) {
      showError(collected.errors);
      return;
    }
    showError([]);
    const result = spec.onSubmit ? spec.onSubmit(collected.values) : undefined;
    if (result && result.ok === false) {
      showError([result.message || 'That did not work.']);
      return;
    }
    if (result && result.message) notify(spec, result);
    close();
  };
  function onKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      if (spec.onCancel) spec.onCancel();
    } else if (event.key === 'Enter' && event.target && event.target.tagName !== 'TEXTAREA') {
      event.preventDefault();
      submit();
    }
  }

  backdrop.addEventListener('mousedown', event => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.querySelector('.kx-form-cancel').addEventListener('click', () => {
    close();
    if (spec.onCancel) spec.onCancel();
  });
  backdrop.querySelector('.kx-form-submit').addEventListener('click', submit);
  backdrop.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    submit();
  });
  document.addEventListener('keydown', onKey, true);

  const handle = { close, element: backdrop, id };
  DIALOG_STACK.push(handle);
  setTimeout(() => {
    const first = backdrop.querySelector('input, select, textarea, button');
    try { first?.focus?.({ preventScroll: true }); } catch (_) { first?.focus?.(); }
  }, 0);
  return handle;
}

/** Report the outcome of a submitted form through whatever notifier the caller gave. */
function notify(spec, result) {
  const notifier = spec.notifier;
  const kind = result.ok === false ? 'warn' : (result.kind || 'success');
  try {
    (notifier?.[kind] || notifier?.info || (() => {})).call(notifier, result.message, { details: result.details });
  } catch (err) {
    /* a dialog must never fail because a toast did */
    log.warn('a dialog result could not be reported through the notifier', { kind, error: err?.message });
  }
}

/** Close every form dialog this module opened (used by app-level Escape handling). */
export function closeAllFormDialogs() {
  let closed = 0;
  while (DIALOG_STACK.length) {
    const top = DIALOG_STACK.pop();
    try { top.close(); closed += 1; } catch (_) { /* already gone */ }
  }
  return closed;
}

export function hasOpenFormDialog() {
  return DIALOG_STACK.length > 0;
}
