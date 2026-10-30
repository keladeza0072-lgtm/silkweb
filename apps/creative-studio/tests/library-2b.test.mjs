import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE_FRAMEWORK_IDS,
  ACTIVE_STYLE_IDS,
  APPROVED_ADVERTISING_STYLES,
  APPROVED_COPYWRITING_FRAMEWORKS,
  buildLibraryPromptSection,
  configureCreativeLibrary,
  getFrameworkDefinition,
  getStyleDefinition,
  initializeApprovedCreativeLibrary,
  isApprovedLibraryActive,
  isKnownFrameworkId,
  isKnownStyleId,
  knownFrameworkIds,
  knownStyleIds,
  resetCreativeLibrary,
} from '../dist/library.js';
import { recommendConceptPair, recommendCreatives } from '../dist/recommend.js';
import { EXPECTED_CONCEPT_COUNT, generateConcepts } from '../dist/concepts.js';
import { DeterministicTestProvider } from '../dist/provider.js';

/**
 * Milestone 2B-1 suite. Socket-free, no model calls: the approved V1
 * library (six styles, four frameworks), the deterministic
 * recommendation rules, and their compatibility with the two-concept
 * validation path are exercised directly.
 */

const STYLE_IDS = [...ACTIVE_STYLE_IDS];
const FRAMEWORK_IDS = [...ACTIVE_FRAMEWORK_IDS];

function setupApproved() {
  resetCreativeLibrary();
  initializeApprovedCreativeLibrary();
}

function campaign(overrides = {}) {
  return {
    description: 'Acme Coffee launches cold-brew cans for commuters to drive launch-week trial.',
    product: 'Cold-brew cans',
    objective: 'Drive launch-week trial',
    facts: ['Cold-brew cans exist'],
    assumptions: [],
    ...overrides,
  };
}

test('approved library holds exactly six styles and four frameworks', () => {
  setupApproved();
  assert.equal(APPROVED_ADVERTISING_STYLES.length, 6);
  assert.equal(APPROVED_COPYWRITING_FRAMEWORKS.length, 4);
  assert.deepEqual(knownStyleIds().sort(), [...STYLE_IDS].sort());
  assert.deepEqual(knownFrameworkIds().sort(), [...FRAMEWORK_IDS].sort());
  assert.equal(isApprovedLibraryActive(), true);
  for (const style of APPROVED_ADVERTISING_STYLES) {
    for (const field of ['purpose', 'composition', 'copyRules', 'visualDirection', 'usage', 'restrictions']) {
      assert.ok(typeof style[field] === 'string' && style[field].trim().length > 0, `style ${style.id} needs ${field}`);
    }
  }
  for (const fw of APPROVED_COPYWRITING_FRAMEWORKS) {
    for (const field of ['structure', 'applicationRules', 'restrictions']) {
      assert.ok(typeof fw[field] === 'string' && fw[field].trim().length > 0, `framework ${fw.id} needs ${field}`);
    }
  }
});

test('valid initialization is idempotent; reset empties the library', () => {
  setupApproved();
  initializeApprovedCreativeLibrary();
  assert.equal(isApprovedLibraryActive(), true);
  resetCreativeLibrary();
  assert.equal(isApprovedLibraryActive(), false);
  assert.equal(isKnownStyleId(STYLE_IDS[0]), false);
  assert.equal(isKnownFrameworkId(FRAMEWORK_IDS[0]), false);
  assert.equal(getStyleDefinition(STYLE_IDS[0]), undefined);
  setupApproved();
});

test('legacy minimal configuration interface still works', () => {
  resetCreativeLibrary();
  configureCreativeLibrary({
    styles: [{ id: 's1', name: 'S1' }],
    frameworks: [{ id: 'f1', name: 'F1' }],
  });
  assert.equal(isKnownStyleId('s1'), true);
  assert.equal(getStyleDefinition('s1').name, 'S1');
  assert.throws(() => configureCreativeLibrary({ styles: [] }), Error);
  assert.throws(() => configureCreativeLibrary({ styles: [{ id: 'bad id!', name: 'x' }], frameworks: [] }), Error);
  setupApproved();
});

test('unknown identifiers are rejected', () => {
  setupApproved();
  assert.equal(isKnownStyleId('style-slot-a'), false);
  assert.equal(isKnownStyleId('before_after'), false);
  assert.equal(isKnownStyleId('aida'), false);
  assert.equal(isKnownFrameworkId('problem-solution'), false);
  assert.equal(isKnownFrameworkId('pas '), false);
  assert.equal(getStyleDefinition('nope'), undefined);
  assert.equal(getFrameworkDefinition('nope'), undefined);
});

test('no offer means no notification-offer recommendation', () => {
  setupApproved();
  const advice = recommendCreatives(campaign());
  assert.ok(!advice.styles.some((s) => s.id === 'notification-offer'));
  assert.ok(advice.explanations.some((e) => /no offer/i.test(e)));
  const withOffer = recommendCreatives(campaign({ offer: '2-for-1 opening weekend' }));
  assert.ok(withOffer.styles.some((s) => s.id === 'notification-offer'));
});

test('unsupported transformations withhold before-after and BAB', () => {
  setupApproved();
  const plain = recommendCreatives(campaign());
  assert.ok(!plain.styles.some((s) => s.id === 'before-after'));
  assert.ok(!plain.frameworks.some((f) => f.id === 'bab'));
  const changed = recommendCreatives(campaign({
    description: 'Helps commuters transform slow mornings: visible results in a week.',
    objective: 'Show before and after progress',
    facts: ['Customers report smoother mornings after one week'],
  }));
  assert.ok(changed.styles.some((s) => s.id === 'before-after'));
  assert.ok(changed.frameworks.some((f) => f.id === 'bab'));
});

test('compatible preferences win; incompatible ones are set aside with reasons', () => {
  setupApproved();
  const honored = recommendCreatives(campaign(), { styleId: 'editorial', frameworkId: 'aida' });
  assert.equal(honored.styles[0].id, 'editorial');
  assert.equal(honored.styles[0].preferred, true);
  assert.equal(honored.frameworks[0].id, 'aida');
  assert.equal(honored.frameworks[0].preferred, true);
  const blocked = recommendCreatives(campaign(), { styleId: 'notification-offer', frameworkId: 'bab' });
  assert.ok(!blocked.styles.some((s) => s.id === 'notification-offer'));
  assert.ok(!blocked.frameworks.some((f) => f.id === 'bab'));
  assert.ok(blocked.explanations.length >= 2);
  const unknown = recommendCreatives(campaign(), { styleId: 'mega-style', frameworkId: 'mega-fw' });
  assert.ok(unknown.styles.every((s) => STYLE_IDS.includes(s.id)));
  assert.ok(unknown.frameworks.every((f) => FRAMEWORK_IDS.includes(f.id)));
  assert.ok(unknown.explanations.length >= 2);
});

test('recommendations never invent offers or discounts', () => {
  setupApproved();
  const advice = recommendCreatives(campaign());
  const text = [...advice.explanations, ...advice.styles.map((s) => s.reason)].join(' ');
  assert.ok(!/%|\b\d+\s*off\b|free shipping|buy one/i.test(text));
});

test('concept pairs are distinct, known, and pass two-concept validation', async () => {
  setupApproved();
  const pair = recommendConceptPair(campaign({ offer: '2-for-1 opening weekend' }));
  assert.equal(pair.styleIds.length, 2);
  assert.equal(pair.frameworkIds.length, 2);
  assert.ok(pair.styleIds.every((id) => isKnownStyleId(id)));
  assert.ok(pair.frameworkIds.every((id) => isKnownFrameworkId(id)));
  assert.notEqual(pair.styleIds[0], pair.styleIds[1]);
  const provider = new DeterministicTestProvider({
    styleIds: [pair.styleIds[0], pair.styleIds[1]],
    frameworkIds: [pair.frameworkIds[0], pair.frameworkIds[1]],
  });
  const result = await generateConcepts(campaign({ offer: '2-for-1 opening weekend' }), provider, { allowTestProvider: true });
  assert.equal(result.ok, true);
  assert.equal(result.concepts.length, EXPECTED_CONCEPT_COUNT);
});

test('provider brief exposes every approved definition and no placeholders', () => {
  const brief = buildLibraryPromptSection();
  for (const id of [...STYLE_IDS, ...FRAMEWORK_IDS]) assert.ok(brief.includes(id), `brief must cover ${id}`);
  assert.ok(/never invent/i.test(brief));
  assert.ok(!brief.includes('style-slot'));
  assert.ok(!brief.includes('test-concept'));
});
