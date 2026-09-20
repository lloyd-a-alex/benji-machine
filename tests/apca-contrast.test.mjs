// WCAG 3.0 colour audit.
//
// WCAG 3.0 retires the flat WCAG 2.x contrast *ratio* in favour of APCA (Lightness
// Contrast, Lc), which is asymmetric: light text on a dark background is harder to
// read than the old ratio implied. This test is the guard rail so the KNITCAT
// palette can never silently regress to a colour that only *looks* high-contrast.
//
// It reads the real design tokens straight out of css/styles.css and scores every
// text / foreground-accent pair against the actual backgrounds it sits on — the
// `body.theme-romance` block in particular, because `<body class="theme-romance">`
// redeclares the tokens on the closest ancestor and therefore shadows both :root
// and the runtime accent picker (so it is what users actually see).
//
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  apcaLc, sRGBtoY, parseHexColor, ensureContrast, rgbToHex, WCAG3_LC
} from '../js/core/apca.js';

const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');

/** Grab a `{ ... }` block that follows a selector, so token values are scoped. */
function blockOf(selectorRe) {
  const m = css.match(new RegExp(selectorRe.source + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : '';
}
/** Read one `--token: #hex;` value out of a block's text. */
function token(block, name) {
  const m = block.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{3,6})'));
  return m ? m[1] : null;
}

const root = blockOf(/:root/);
const romance = blockOf(/body\.theme-romance/);

// ── the engine itself ────────────────────────────────────────────────────────
test('the APCA engine reproduces the reference anchors', () => {
  // Black text on white is the published ceiling of ~ +106 Lc.
  assert.ok(Math.abs(apcaLc('#000000', '#ffffff') - 106) < 1.5, 'BoW anchor');
  // APCA is asymmetric: white-on-black magnitude exceeds black-on-white.
  assert.ok(Math.abs(apcaLc('#ffffff', '#000000')) > apcaLc('#000000', '#ffffff'), 'WoB is stricter in magnitude');
  // A light colour on a dark background is reported as negative (light-on-dark).
  assert.ok(apcaLc('#f8fafc', '#070a12') < 0, 'signed polarity');
  assert.deepEqual(parseHexColor('#fff'), [255, 255, 255], 'short hex');
  assert.equal(parseHexColor('rebeccapurple'), null, 'junk returns null, never throws');
});

test('ensureContrast lifts any accent to the text floor without wrecking it', () => {
  const surface = '#37114a'; // the lightest themed surface: pass here → pass everywhere
  for (const sample of ['#fb7185', '#f472b6', '#3b82f6', '#22c55e', '#a855f7', '#e11d48']) {
    const fixed = ensureContrast(sample, surface, WCAG3_LC.textMinimum);
    assert.ok(Math.abs(apcaLc(fixed, surface)) >= WCAG3_LC.textMinimum, `${sample} -> ${fixed}`);
  }
  // Already-legible colours are left untouched (no needless repaint).
  assert.equal(ensureContrast('#fde047', surface, WCAG3_LC.textMinimum), '#fde047');
});

test('ensureContrast never returns an unreadable colour, even pathological picks', () => {
  const surface = '#37114a';
  // A pure-black pick on a dark surface cannot get any darker, so the search
  // must flip to the light end instead of handing back an invisible accent.
  const black = ensureContrast('#000000', surface, WCAG3_LC.textMinimum);
  assert.ok(Math.abs(apcaLc(black, surface)) >= WCAG3_LC.textMinimum, `black pick -> ${black} still unreadable`);
  // A pick identical to the background (zero contrast) is likewise rescued.
  const same = ensureContrast(surface, surface, WCAG3_LC.textMinimum);
  assert.ok(Math.abs(apcaLc(same, surface)) >= WCAG3_LC.textMinimum, `same-as-bg pick -> ${same} still unreadable`);
});

// ── the rendered palette (romance theme is always applied) ────────────────────
const romanceBgs = ['bg-main', 'bg-surface', 'bg-panel', 'bg-surface-elevated']
  .map((n) => token(romance, n)).filter(Boolean);

function minLcOnRomance(hex) {
  return Math.min(...romanceBgs.map((bg) => Math.abs(apcaLc(hex, bg))));
}

test('every romance text tier clears its Lc floor on all purple surfaces', () => {
  assert.equal(minLcOnRomance(token(romance, 'text-primary')) >= WCAG3_LC.body, true, 'primary is body text');
  for (const t of ['text-secondary', 'text-muted']) {
    assert.ok(minLcOnRomance(token(romance, t)) >= WCAG3_LC.textMinimum, `${t} below Lc 60`);
  }
});

test('romance foreground accents clear the Lc 60 text floor', () => {
  for (const t of ['accent-cyan', 'accent-rose', 'accent-amber', 'accent-emerald', 'accent-indigo']) {
    const hex = token(romance, t);
    assert.ok(hex, `missing --${t}`);
    assert.ok(minLcOnRomance(hex) >= WCAG3_LC.textMinimum, `--${t} ${hex} below Lc 60 on the purple surfaces`);
  }
});

// ── the :root base palette (fallback + light-mode inheritance) ────────────────
const rootBgs = ['bg-main', 'bg-surface', 'bg-panel', 'bg-surface-elevated']
  .map((n) => token(root, n)).filter(Boolean);

test('the :root neutral text ramp clears the floor and keeps its hierarchy', () => {
  const lc = (t) => Math.min(...rootBgs.map((bg) => Math.abs(apcaLc(token(root, t), bg))));
  assert.ok(lc('text-primary') >= WCAG3_LC.body, 'primary body text');
  assert.ok(lc('text-secondary') >= WCAG3_LC.textMinimum, 'secondary text');
  assert.ok(lc('text-muted') >= WCAG3_LC.textMinimum, 'muted text');
  // Hierarchy survives the lift: primary > secondary > muted.
  assert.ok(lc('text-primary') > lc('text-secondary') && lc('text-secondary') > lc('text-muted'), 'levels collapse');
});
