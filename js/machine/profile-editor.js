/**
 * KNITCAT — custom machine profile editor.
 *
 * The profile picker shipped with a fixed set of industrial machines and a
 * placeholder "custom_parametric" entry full of hard-coded numbers. A knitter
 * with a non-standard bed (a 5mm gauge clone, a 9mm chunky, a CNC card with a
 * custom pitch) had no way to describe it. This is that way.
 *
 * The form fields mirror the shape `core/validate.js#machineProfile` checks, so
 * whatever passes here is guaranteed to satisfy every consumer that reads a
 * profile without re-checking (advisor limits, exporters, the kinematics sim).
 * On save it defers entirely to {@link registerProfile} — the editor never
 * hand-writes to the registry, so there is exactly one validation path.
 *
 * DOM-free at import; only touches the document inside `openProfileEditor`.
 *
 * @module machine/profile-editor
 */

import {
  registerProfile,
  saveCustomProfiles,
  unregisterProfile,
  listCustomProfiles,
  isBuiltInProfile,
  MACHINE_PROFILES
} from './profiles.js';
import { openFormDialog } from '../ui/dialogs.js';

const CARRIAGE_RULE_TYPES = [
  { value: 'brother_separated', label: 'Brother — separate L & K carriages' },
  { value: 'silber_mixed', label: 'Silver Reed — combined carriage' },
  { value: 'generic', label: 'Generic punchcard' }
];

/** A sensible starting point for a blank custom machine (24-stitch standard). */
function blankProfile() {
  return {
    id: '',
    name: '',
    gauge: 'Custom',
    columns: 24,
    defaultRows: 60,
    minRows: 8,
    maxRows: 240,
    pitchX: 4.5,
    pitchY: 5.08,
    holeDiameter: 3.2,
    sprocketDiameter: 3.5,
    sprocketPitchY: 5.08,
    marginSide: 6.0,
    sprocketToFirstHole: 7.5,
    marginTopBottom: 15.0,
    cardWidth: 140.0,
    beds: 1,
    bedLengthMm: 900,
    maxFloatNeedles: 9,
    maxTuckLoops: 6,
    carriageRuleType: 'brother_separated',
    cardReadingOffsetRows: 7
  };
}

/** Turn a stored/editable profile into flat form values. */
function toFormValues(p) {
  return {
    id: p.id || '',
    name: p.name || '',
    gauge: p.gauge || 'Custom',
    columns: p.columns,
    defaultRows: p.defaultRows,
    minRows: p.minRows,
    maxRows: p.maxRows,
    pitchX: p.pitchX,
    pitchY: p.pitchY,
    holeDiameter: p.holeDiameter,
    sprocketDiameter: p.sprocketDiameter,
    sprocketPitchY: p.sprocketPitchY,
    marginSide: p.marginSide,
    sprocketToFirstHole: p.sprocketToFirstHole,
    marginTopBottom: p.marginTopBottom,
    cardWidth: p.cardWidth,
    beds: String(p.beds ?? 1),
    bedLengthMm: p.bedLengthMm,
    maxFloatNeedles: p.maxFloatNeedles,
    maxTuckLoops: p.maxTuckLoops,
    carriageRuleType: p.carriageRules?.type || 'brother_separated',
    cardReadingOffsetRows: p.carriageRules?.cardReadingOffsetRows ?? 0
  };
}

/**
 * Build the field declarations for the form. `idLocked` keeps the machine id
 * stable when editing an existing custom profile so it never spawns a duplicate.
 */
function formFields({ idLocked } = {}) {
  const num = (name, label, { min = 0, max = 100000, step = 1, hint = '', value } = {}) => ({
    name, label, type: 'number', min, max, step, hint, value
  });
  return [
    {
      name: 'id',
      label: 'Machine id (a-z, 0-9, _)',
      type: 'text',
      required: true,
      hint: idLocked ? 'Locked — delete and re-add to rename.' : 'Lower-case, no spaces, e.g. "my_5mm_clone".',
      ...(idLocked ? { value: undefined } : {})
    },
    { name: 'name', label: 'Display name', type: 'text', required: true, hint: 'Shown in the machine picker.' },
    { name: 'gauge', label: 'Gauge label', type: 'text', hint: 'Free text, e.g. "Standard (4.5mm)".' },
    num('columns', 'Stitch columns on the card', { min: 1, max: 400 }),
    num('beds', 'Needle beds', { min: 1, max: 2, step: 1, hint: '1 = single bed, 2 = ribber.' }),
    num('defaultRows', 'Default rows', { min: 1, max: 2000 }),
    num('minRows', 'Minimum rows', { min: 1, max: 2000 }),
    num('maxRows', 'Maximum rows', { min: 1, max: 4000 }),
    num('pitchX', 'Needle pitch X (mm)', { min: 0.1, max: 50, step: 0.01, hint: 'Horizontal needle spacing.' }),
    num('pitchY', 'Row pitch Y (mm)', { min: 0.1, max: 50, step: 0.01, hint: 'Vertical distance per row.' }),
    num('bedLengthMm', 'Bed length (mm)', { min: 10, max: 5000, step: 1, hint: 'Derives how many needles fit.' }),
    num('holeDiameter', 'Punch hole Ø (mm)', { min: 0.1, max: 20, step: 0.01 }),
    num('sprocketDiameter', 'Sprocket hole Ø (mm)', { min: 0.1, max: 20, step: 0.01 }),
    num('sprocketPitchY', 'Sprocket pitch Y (mm)', { min: 0.1, max: 50, step: 0.01 }),
    num('marginSide', 'Side margin (mm)', { min: 0, max: 100, step: 0.1 }),
    num('sprocketToFirstHole', 'Sprocket→first hole (mm)', { min: 0, max: 100, step: 0.1 }),
    num('marginTopBottom', 'Top/bottom margin (mm)', { min: 0, max: 100, step: 0.1 }),
    num('cardWidth', 'Card width (mm)', { min: 10, max: 1000, step: 0.1 }),
    num('maxFloatNeedles', 'Max float (needles)', { min: 1, max: 200, hint: 'Advisor flags longer stranded runs.' }),
    num('maxTuckLoops', 'Max held loops (tuck)', { min: 1, max: 200 }),
    { name: 'carriageRuleType', label: 'Carriage model', type: 'select', options: CARRIAGE_RULE_TYPES },
    num('cardReadingOffsetRows', 'Card reading offset (rows)', { min: 0, max: 40, hint: 'Brother reads 7 rows below the needles.' })
  ];
}

/** Reassemble flat form values into the profile object the validator expects. */
function fromFormValues(v) {
  const clean = (n) => (Number.isFinite(Number(n)) ? Number(n) : undefined);
  const id = String(v.id || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const type = v.carriageRuleType || 'brother_separated';
  return {
    id,
    name: String(v.name || '').trim(),
    gauge: String(v.gauge || 'Custom').trim() || 'Custom',
    columns: clean(v.columns),
    defaultRows: clean(v.defaultRows),
    minRows: clean(v.minRows),
    maxRows: clean(v.maxRows),
    pitchX: clean(v.pitchX),
    pitchY: clean(v.pitchY),
    holeDiameter: clean(v.holeDiameter),
    sprocketDiameter: clean(v.sprocketDiameter),
    sprocketPitchY: clean(v.sprocketPitchY),
    marginSide: clean(v.marginSide),
    sprocketToFirstHole: clean(v.sprocketToFirstHole),
    marginTopBottom: clean(v.marginTopBottom),
    cardWidth: clean(v.cardWidth),
    beds: Number(v.beds) === 2 ? 2 : 1,
    bedLengthMm: clean(v.bedLengthMm),
    maxFloatNeedles: clean(v.maxFloatNeedles),
    maxTuckLoops: clean(v.maxTuckLoops),
    cardColor: '#f8fafc',
    inkColor: '#0f172a',
    carriageRules: {
      type,
      laceCarriageDirectionalTransfers: type !== 'generic',
      transfersInCarriageDirection: true,
      knitsYarnDuringLace: false,
      minPlainRowsAfterLace: 2,
      requiresEmptyNeedleSelection: true,
      cardReadingOffsetRows: clean(v.cardReadingOffsetRows) ?? 0
    },
    description: `Custom machine "${String(v.name || '').trim()}" (user-defined).`
  };
}

/**
 * Open the profile editor. Pass `profile` to edit an existing custom machine;
 * omit it to add a new one. `onApplied(profileId)` fires after a successful save
 * so the app can repopulate the picker and switch to the new machine.
 *
 * @param {object} [options]
 * @param {object} [options.profile]     existing custom profile to edit
 * @param {(id: string) => void} [options.onApplied]
 * @param {object} [options.notifier]    a NotificationCenter-shaped object
 * @returns {{close: () => void}|null} null when there is no DOM
 */
export function openProfileEditor({ profile = null, onApplied, notifier } = {}) {
  const editing = profile && profile.id && MACHINE_PROFILES[profile.id];
  if (profile && profile.id && isBuiltInProfile(profile.id)) {
    notifier?.error?.('Built-in machines cannot be edited.', {
      details: ['Duplicate it under a new id if you want to tweak one.']
    });
    return null;
  }
  const values = editing ? toFormValues(profile) : blankProfile();
  const fields = formFields({ idLocked: Boolean(editing) }).map(f =>
    values[f.name] !== undefined ? { ...f, value: values[f.name] } : f
  );

  return openFormDialog({
    id: editing ? `profile-edit-${profile.id}` : 'profile-add',
    title: editing ? `Edit ${profile.name || profile.id}` : 'Add a custom machine',
    description: 'Every number feeds the exporters, the advisor limits and the kinematics simulator. The physical fields (pitch, bed length, columns) are validated before the machine is saved.',
    fields,
    submitLabel: editing ? 'Save changes' : 'Create machine',
    notifier,
    onSubmit: (v) => {
      const candidate = editing ? { ...fromFormValues({ ...v, id: profile.id }), id: profile.id } : fromFormValues(v);
      const result = registerProfile(candidate);
      if (!result.ok) {
        return { ok: false, message: result.error || 'That profile could not be validated.' };
      }
      saveCustomProfiles();
      onApplied?.(result.profile.id);
      return { ok: true, message: editing ? 'Machine updated.' : 'Custom machine added.' };
    }
  });
}

/**
 * Delete a custom machine (never a built-in). Persists the reduced list.
 * @param {string} id
 * @param {object} [options] {notifier}
 * @returns {{ok: boolean, error?: string}}
 */
export function deleteCustomProfile(id, { notifier } = {}) {
  const result = unregisterProfile(id);
  if (result.ok) saveCustomProfiles();
  else notifier?.warn?.(result.error || 'That machine could not be removed.');
  return result;
}

export { listCustomProfiles };
