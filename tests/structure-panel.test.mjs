// The Card Structure panel's analysis core.
//
// The panel itself is DOM (asserted by boot guards elsewhere), but every number it
// shows comes from the pure `analyzeCard`, which is where the real risk lives: a
// wrong "does it tile?" or a wrong physical size would send a knitter to the machine
// with bad arithmetic. So the analysis is pinned here against the same subsystems it
// claims to integrate — documents, layers, guides and measure — with no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCard } from '../js/ui/structure-panel.js';
import { STITCH_TYPE } from '../js/math/knit-topology.js';
import { MACHINE_PROFILES } from '../js/machine/profiles.js';

const K = STITCH_TYPE.KNIT;
const O = STITCH_TYPE.EYELET;
const TL = STITCH_TYPE.TRANSFER_LEFT;
const brother = MACHINE_PROFILES.brother_standard_24;

test('an empty card is described as empty without throwing', () => {
  const r = analyzeCard({ matrix: [], mode: 'lace', profile: brother });
  assert.equal(r.rows, 0);
  assert.equal(r.cols, 0);
  assert.equal(r.worked, 0);
  assert.equal(r.fit.ok, false, 'no repeat is set, so there is nothing to tile');
});

test('the worked count is what the layer composite actually reads back', () => {
  // Two punched marks (an eyelet and a transfer) out of four cells in a lace card.
  const matrix = [[K, O], [TL, K]];
  const r = analyzeCard({ matrix, mode: 'lace', profile: brother, name: 'Swatch' });
  assert.equal(r.rows, 2);
  assert.equal(r.cols, 2);
  assert.equal(r.worked, 2, 'blank (KNIT) cells are not counted; eyelet and transfer are');
  assert.equal(r.layers.worked, 2, 'the layers pipeline agrees with the headline count');
  assert.equal(r.document.name, 'Swatch');
  assert.equal(r.document.mode, 'lace');
});

test('physical size follows the profile pitch', () => {
  const matrix = Array.from({ length: 10 }, () => new Array(24).fill(0));
  const r = analyzeCard({ matrix, mode: 'fair_isle', profile: brother });
  assert.equal(r.size.widthMm, 24 * 4.5, 'needles × pitchX');
  assert.ok(Math.abs(r.size.heightMm - 10 * 5.08) < 1e-9, 'rows × pitchY');
  assert.equal(r.size.widthLabel, '108.0 mm');
});

test('a repeat that divides the card tiles exactly', () => {
  const matrix = Array.from({ length: 8 }, () => new Array(24).fill(0));
  const r = analyzeCard({ matrix, mode: 'fair_isle', profile: brother, repeat: { rows: 4, cols: 6 } });
  assert.equal(r.fit.ok, true);
  assert.equal(r.fit.across, 4);
  assert.equal(r.fit.down, 2);
  assert.equal(r.fit.coversWholeCard, true);
  assert.match(r.fit.summary, /exact fit/);
});

test('a repeat that leaves a sliver says so out loud', () => {
  const matrix = Array.from({ length: 10 }, () => new Array(20).fill(0));
  const r = analyzeCard({ matrix, mode: 'fair_isle', profile: brother, repeat: { rows: 3, cols: 6 } });
  assert.equal(r.fit.across, 3, '20 / 6 = 3 whole tiles across');
  assert.equal(r.fit.down, 3, '10 / 3 = 3 whole tiles down');
  assert.equal(r.fit.coversWholeCard, false);
  assert.match(r.fit.summary, /left over/);
});

test('a malformed repeat is refused, not guessed at', () => {
  const matrix = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const r = analyzeCard({ matrix, mode: 'lace', profile: brother, repeat: { rows: 0, cols: 4 } });
  assert.equal(r.fit.ok, false);
  assert.equal(r.repeat, null);
});
