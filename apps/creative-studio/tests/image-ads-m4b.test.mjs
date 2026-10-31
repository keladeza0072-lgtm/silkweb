import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessCreativeEligibility,
  selectCreativeClasses,
} from '../dist/imageAdCreativeSelection.js';

import {
  CREATIVE_CLASSES,
  CREATIVE_REFERENCE_VERSION,
} from '../dist/creativeReferenceRegistry.js';

function input(overrides = {}) {
  return {
    productName: 'Luma Candles',
    objective: 'drive-sales',
    upload: null,
    differentiator: '',
    price: '',
    currency: '',
    specialOffer: '',
    ...overrides,
  };
}

function selected(inputValue) {
  return selectCreativeClasses(inputValue).selections;
}

test('m4b returns one class for each internal audience', () => {
  const result = selected(input());

  assert.deepEqual(
    result.map((entry) => entry.audience),
    ['cold', 'warm', 'hot'],
  );
  assert.equal(result.length, 3);
});

test('m4b product-name-only input cannot invent supporting evidence', () => {
  const evidence = assessCreativeEligibility(input());

  assert.deepEqual(evidence, {
    hasProductFacts: false,
    hasGenuineOffer: false,
    hasVerifiedOutcome: false,
    hasTestimonial: false,
    hasComparativeEvidence: false,
    hasTransformationEvidence: false,
  });

  assert.deepEqual(
    selected(input()).map((entry) => entry.classId),
    ['OUTCOME_HERO', 'OUTCOME_HERO', 'OUTCOME_HERO'],
  );
});

test('m4b factual differentiator unlocks benefit and annotation classes', () => {
  const result = selected(input({
    differentiator: 'Hand-poured soy wax',
  }));

  const ids = result.map((entry) => entry.classId);

  assert.ok(ids.includes('BENEFIT_STACK'));
  assert.ok(ids.includes('ANNOTATED_HERO'));
  assert.equal(new Set(ids).size, 3);
});

test('m4b genuine offer can unlock an offer-led class', () => {
  const result = selected(input({
    differentiator: 'Hand-poured soy wax',
    specialOffer: 'Free shipping this weekend',
  }));

  assert.ok(result.some((entry) => entry.classId === 'OFFER_HERO'));
});

test('m4b never unlocks unsupported comparison or transformation', () => {
  const result = selectCreativeClasses(input({
    differentiator: 'Better than competitors, twice as fast',
    specialOffer: 'Save 10%',
  }));

  assert.equal(result.provenance.evidence.hasVerifiedOutcome, false);
  assert.equal(result.provenance.evidence.hasComparativeEvidence, false);
  assert.equal(result.provenance.evidence.hasTransformationEvidence, false);
  assert.ok(
    !result.selections.some((entry) =>
      entry.classId === 'VISUAL_COMPARISON'
    ),
  );
});

test('m4b excludes advanced and restricted classes', () => {
  const classes = new Map(
    CREATIVE_CLASSES.map((creative) => [creative.id, creative]),
  );

  for (const objective of [
    'drive-sales',
    'build-awareness',
    'launch-product',
  ]) {
    const selections = selected(input({
      objective,
      differentiator: 'Hand-poured soy wax',
      specialOffer: 'Free shipping this weekend',
    }));

    for (const selection of selections) {
      assert.equal(
        classes.get(selection.classId).implementationTier,
        'initial',
      );
    }
  }
});

test('m4b provenance documents registry version and rejected classes', () => {
  const { provenance } = selectCreativeClasses(input());

  assert.equal(provenance.registryVersion, CREATIVE_REFERENCE_VERSION);
  assert.equal(provenance.objective, 'drive-sales');
  assert.equal(provenance.selected.length, 3);

  const rejected = provenance.rejected.map((entry) => entry.classId);

  assert.ok(rejected.includes('OFFER_HERO'));
  assert.ok(rejected.includes('VISUAL_COMPARISON'));
  assert.ok(rejected.includes('LIFESTYLE_STORY'));
});

test('m4b selection is deterministic across repeated calls', () => {
  const brief = input({
    objective: 'launch-product',
    differentiator: 'Hand-poured soy wax',
  });

  const first = selectCreativeClasses(brief);
  const second = selectCreativeClasses(brief);

  assert.deepEqual(first, second);
});
