// The shared HTML escaper — one rule for every surface that interpolates
// user-authored strings (project names, labels) into markup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escHtml } from '../js/ui/text.js';

test('escapes all five HTML-significant characters', () => {
  assert.equal(escHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('neutralises tag injection in a project name', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const out = escHtml(evil);
  assert.ok(!out.includes('<') && !out.includes('>'), 'no raw angle brackets survive');
  assert.equal(out, '&lt;img src=x onerror=alert(1)&gt;');
});

test('nullish input becomes the empty string, other values stringify', () => {
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(undefined), '');
  assert.equal(escHtml(0), '0');
  assert.equal(escHtml(['a&b']), 'a&amp;b');
});

test('plain text passes through untouched', () => {
  assert.equal(escHtml('Benji ♥ lace card — 64×64'), 'Benji ♥ lace card — 64×64');
});
