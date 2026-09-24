// Light-mode colour audit for the unified shell.
//
// The dark romance palette is guarded by tests/apca-contrast.test.mjs, but the
// additive light theme (js/features/extras.js) is a completely separate set of
// token values written against WHITE surfaces — where the old ratio model and the
// dark palette's assumptions no longer hold. This test is the counterpart guard:
// it reads the real light tokens out of extras.js and scores every text tier and
// every foreground accent with APCA against the light surfaces they actually sit
// on, plus the accent-filled active states (white label on a coloured chip).
//
// It also pins the structural fix: the light tokens must be redeclared on `body`,
// because body.theme-romance re-declares them on the closest ancestor and shadows
// anything set only on <html> — which is exactly why the shell used to stay dark.
//
// Run just this file:  node --test tests/light-theme-contrast.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { apcaLc, WCAG3_LC } from '../js/core/apca.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extras = await readFile(path.join(ROOT, 'js', 'features', 'extras.js'), 'utf8');

/** Grab the declaration block that follows a selector, so values stay scoped. */
function blockOf(re) {
  const m = extras.match(new RegExp(re.source + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : '';
}
function token(block, name) {
  const m = block.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{3,8})'));
  return m ? m[1] : null;
}

const bodyBlock = blockOf(/html\[data-theme="light"\] body/);

test('the light tokens are redeclared on <body>, not only on <html>', () => {
  // Without this the whole shell silently keeps the dark romance values.
  assert.ok(/html\[data-theme="light"\] body\s*\{/.test(extras),
    'light tokens must also land on body to beat body.theme-romance in the cascade');
  assert.ok(bodyBlock.includes('--bg-inset'), 'the recessed field token must be re-themed too, not left dark');
});

// The light surfaces content sits on (the near-white set).
const lightBgs = ['bg-main', 'bg-surface', 'bg-panel', 'bg-surface-elevated', 'bg-inset']
  .map((n) => token(bodyBlock, n)).filter(Boolean);

function minLcOnLight(hex) {
  return Math.min(...lightBgs.map((bg) => Math.abs(apcaLc(hex, bg))));
}

test('every light text tier clears its APCA floor on all light surfaces', () => {
  assert.ok(minLcOnLight(token(bodyBlock, 'text-primary')) >= WCAG3_LC.body, 'primary body text');
  for (const t of ['text-secondary', 'text-muted']) {
    assert.ok(minLcOnLight(token(bodyBlock, t)) >= WCAG3_LC.textMinimum, `${t} below Lc ${WCAG3_LC.textMinimum} on white`);
  }
  // Hierarchy survives: primary > secondary > muted (darker = higher Lc on light).
  const l = (t) => minLcOnLight(token(bodyBlock, t));
  assert.ok(l('text-primary') > l('text-secondary') && l('text-secondary') > l('text-muted'), 'light text ramp collapsed');
});

test('every light foreground accent clears the Lc 60 text floor on white', () => {
  for (const t of ['accent-cyan', 'accent-rose', 'accent-amber', 'accent-emerald', 'accent-indigo']) {
    const hex = token(bodyBlock, t);
    assert.ok(hex, `missing --${t} in the light block`);
    assert.ok(minLcOnLight(hex) >= WCAG3_LC.textMinimum, `--${t} ${hex} below Lc 60 on light surfaces`);
  }
});

test('white labels on the accent-filled active states stay readable', () => {
  // chrome.js renders .sr-btn.is-active / .ps-chip.is-on / .cb-act--primary with a
  // solid accent background; light mode paints those labels white, so the pair
  // must clear the floor just like any other text.
  const fill = token(bodyBlock, 'accent-cyan');
  assert.ok(Math.abs(apcaLc('#ffffff', fill)) >= WCAG3_LC.textMinimum, `white on --accent-cyan ${fill} is unreadable`);
});
