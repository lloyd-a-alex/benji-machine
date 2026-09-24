// The guided handbook is pure data + a "no dead links" promise. It is asserted here
// without a browser: every "try it" button must resolve to a command the dispatcher
// actually implements (MENUBAR_ACTIONS) or a tab that really exists (GUIDE_TABS), so
// the handbook can never advertise a button that leads nowhere.
// Run with:  node --test tests/guide.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GUIDE_CHAPTERS,
  GUIDE_TABS,
  allSections,
  sectionById,
  chapterById,
  collectGuideLinks,
  searchGuide,
  guideStats
} from '../js/docs/guide-content.js';
import { MENUBAR_ACTIONS } from '../js/ui/menubar.js';

test('chapters are well-formed and section ids are globally unique', () => {
  assert.ok(GUIDE_CHAPTERS.length >= 8, `expected a broad handbook, got ${GUIDE_CHAPTERS.length} chapters`);
  const chapterIds = GUIDE_CHAPTERS.map(c => c.id);
  assert.equal(new Set(chapterIds).size, chapterIds.length, 'duplicate chapter id');
  const sectionIds = allSections().map(s => s.id);
  assert.equal(new Set(sectionIds).size, sectionIds.length, 'duplicate section id');
  for (const c of GUIDE_CHAPTERS) {
    assert.ok(c.title && c.glyph && c.blurb, `chapter ${c.id} missing title/glyph/blurb`);
    assert.ok(c.sections.length >= 2, `chapter ${c.id} should hold several sections`);
  }
});

test('every section carries real prose and looks up by id', () => {
  for (const s of allSections()) {
    assert.ok(s.body && s.body.length > 40, `section ${s.id} body is too thin`);
    assert.ok(s.title, `section ${s.id} has no title`);
    assert.equal(sectionById(s.id).id, s.id, 'sectionById round-trip');
  }
  assert.equal(sectionById('does-not-exist'), undefined);
  assert.equal(chapterById('does-not-exist'), undefined);
});

test('no deep-link is malformed', () => {
  const { bad } = collectGuideLinks();
  assert.deepEqual(bad, [], `links that are neither command: nor tab: → ${bad.join(', ')}`);
});

test('every "command:" deep-link is a real, declared action (no dead links)', () => {
  const { commands } = collectGuideLinks();
  assert.ok(commands.length >= 25, `the handbook should deep-link a lot of the app, saw ${commands.length}`);
  const dead = commands.filter(id => !MENUBAR_ACTIONS.has(id));
  assert.deepEqual(dead, [], `handbook advertises unknown commands:\n${dead.join('\n')}`);
});

test('every "tab:" deep-link names a real app tab', () => {
  const { tabs } = collectGuideLinks();
  assert.ok(tabs.length >= 3, 'several chapters should jump across tabs');
  const bad = tabs.filter(t => !GUIDE_TABS.includes(t));
  assert.deepEqual(bad, [], `links to non-existent tabs: ${bad.join(', ')}`);
});

test('searchGuide finds prose and titles, case-insensitively', () => {
  assert.deepEqual(searchGuide('   '), [], 'a blank query returns nothing');
  assert.deepEqual(searchGuide('zzqqxy'), [], 'a nonsense query returns nothing');
  const hits = searchGuide('paper-bridge');
  assert.ok(hits.some(h => h.section.id === 'image'), 'the image section body mentions paper-bridge protection');
  assert.ok(searchGuide('SYMMETRIC').some(h => h.section.id === 'true'), 'search is case-insensitive across prose');
});

test('guideStats agrees with the raw data', () => {
  const s = guideStats();
  assert.equal(s.chapters, GUIDE_CHAPTERS.length);
  assert.equal(s.sections, allSections().length);
  const { commands, tabs } = collectGuideLinks();
  assert.equal(s.deepLinks, commands.length + tabs.length);
});
