// The machine knowledge base is the single well of prose that the feasibility
// advisor, the machine-universe analyzer and the diagnostics all drink from. If a
// shipped profile has no entry it silently degrades to the GENERIC stub, and if a
// field is thin or missing the whole "over-stuffed reference" premise rots. These
// tests pin the field contract so adding a machine obliges adding a full dossier,
// and so the detail can never quietly regress to a one-liner.
//
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MACHINE_KNOWLEDGE, knowledgeFor, capabilitiesFor, techniqueSupported,
  TECHNIQUES, PHILOSOPHIES, phil, universalEnvelope
} from '../js/machine/machine-knowledge.js';
import { MACHINE_PROFILES, profileLimits } from '../js/machine/profiles.js';

// The four techniques KNITCAT actually compiles guidance for — every machine must
// speak to each of them so the advisor never has to fall back to silence.
const MODELED_MODES = ['lace', 'fair_isle', 'slip', 'tuck'];

// Fields a dossier must carry, and the kind of detail we demand of each. Scalars
// are prose and must clear a real sentence, not a placeholder token.
const REQUIRED_STRINGS = ['brand', 'family', 'era', 'history', 'carriage', 'tension', 'yarnGauge'];
const REQUIRED_ARRAYS = ['aka', 'yarnWeights', 'accessories', 'strengths', 'caveats', 'commonFailures'];

test('every shipped machine profile has its own knowledge entry (no silent GENERIC)', () => {
  for (const id of Object.keys(MACHINE_PROFILES)) {
    assert.ok(MACHINE_KNOWLEDGE[id], `profile "${id}" is missing from MACHINE_KNOWLEDGE and would fall back to GENERIC`);
  }
});

test('no knowledge entry is orphaned (keys match real profiles)', () => {
  for (const id of Object.keys(MACHINE_KNOWLEDGE)) {
    assert.ok(MACHINE_PROFILES[id], `MACHINE_KNOWLEDGE has "${id}" but no such profile exists`);
  }
});

test('every dossier fills the full field contract with real, non-terse prose', () => {
  for (const [id, k] of Object.entries(MACHINE_KNOWLEDGE)) {
    for (const field of REQUIRED_STRINGS) {
      assert.equal(typeof k[field], 'string', `${id}.${field} must be a string`);
      assert.ok(k[field].trim().length >= 2, `${id}.${field} is empty: "${k[field]}"`);
    }
    // The prose-bearing fields must carry an actual sentence, not a label.
    assert.ok(k.history.length >= 80, `${id}.history is too thin to be a real dossier (${k.history.length} chars)`);
    assert.ok(k.carriage.length >= 40, `${id}.carriage guidance is too thin (${k.carriage.length} chars)`);
    assert.ok(k.tension.length >= 30, `${id}.tension guidance is too thin (${k.tension.length} chars)`);
    for (const field of REQUIRED_ARRAYS) {
      assert.ok(Array.isArray(k[field]) && k[field].length > 0, `${id}.${field} must be a non-empty array`);
      k[field].forEach((v, i) => assert.equal(typeof v, 'string', `${id}.${field}[${i}] must be a string`));
    }
  }
});

test('every dossier gives mode-by-mode guidance for all four compiled techniques', () => {
  for (const [id, k] of Object.entries(MACHINE_KNOWLEDGE)) {
    assert.ok(k.notesForMode, `${id} has no notesForMode`);
    for (const mode of MODELED_MODES) {
      const note = k.notesForMode[mode];
      assert.equal(typeof note, 'string', `${id}.notesForMode.${mode} missing`);
      assert.ok(note.trim().length >= 15, `${id}.notesForMode.${mode} is a stub: "${note}"`);
    }
  }
});

test('capabilities cover every known technique as a boolean', () => {
  for (const [id, k] of Object.entries(MACHINE_KNOWLEDGE)) {
    for (const tech of TECHNIQUES) {
      assert.equal(
        typeof k.capabilities[tech], 'boolean',
        `${id}.capabilities.${tech} must be an explicit boolean (got ${k.capabilities[tech]})`
      );
    }
  }
});

test('ribbing is only promised on double-bed-capable machines, and techniqueSupported agrees', () => {
  // Physics guard: a single bed that has not described a ribber cannot do ribbing.
  const passap = { id: 'passap_duo_40' };
  const brother = { id: 'brother_standard_24' };
  assert.equal(techniqueSupported(passap, 'ribbing'), true);
  assert.equal(techniqueSupported(brother, 'ribbing'), false);
  // capabilitiesFor must layer GENERIC defaults under the real entry, never drop keys.
  const caps = capabilitiesFor(brother);
  for (const m of MODELED_MODES) assert.equal(typeof caps[m], 'boolean');
});

test('an unknown profile still yields a shape-complete object the UI can read blind', () => {
  const g = knowledgeFor({ id: 'does_not_exist' });
  for (const field of REQUIRED_STRINGS) assert.equal(typeof g[field], 'string', `GENERIC.${field} wrong type`);
  for (const field of REQUIRED_ARRAYS) assert.ok(Array.isArray(g[field]), `GENERIC.${field} must be an array`);
  assert.equal(typeof g.capabilities, 'object');
  assert.equal(typeof g.notesForMode, 'object');
  // capabilitiesFor fills the modelled modes from GENERIC defaults.
  const caps = capabilitiesFor({ id: 'does_not_exist' });
  MODELED_MODES.forEach((m) => assert.equal(caps[m], true));
});

test('knowledgeFor(null) degrades safely rather than throwing', () => {
  assert.equal(knowledgeFor(null).brand, 'Unknown');
});

test('universalEnvelope takes the strictest colour gate across the whole fleet', () => {
  // A card that must knit on EVERY machine may only assume the fewest feeders any one
  // has (the punchcard two), or the "portable" badge would lie about a colour changer.
  const env = universalEnvelope(Object.values(MACHINE_PROFILES));
  assert.equal(env.maxColors, 2, 'the strictest bed is a two-feeder punchcard');
  assert.ok(env.maxColors <= Math.min(...Object.values(MACHINE_PROFILES).map(p => profileLimits(p).maxColors)));
  // A single-profile envelope just mirrors that profile.
  assert.equal(universalEnvelope([MACHINE_PROFILES.brother_maxi_60]).maxColors, 6);
});

test('every advisory philosophy is a [name, gloss] pair and phil() formats it', () => {
  for (const [key, p] of Object.entries(PHILOSOPHIES)) {
    assert.ok(Array.isArray(p) && p.length === 2, `PHILOSOPHIES.${key} must be [name, gloss]`);
    p.forEach((s) => assert.equal(typeof s, 'string'));
  }
  const first = Object.keys(PHILOSOPHIES)[0];
  assert.equal(phil(first), `${PHILOSOPHIES[first][0]} — ${PHILOSOPHIES[first][1]}`);
  assert.equal(phil('not-a-real-philosophy'), '');
});
