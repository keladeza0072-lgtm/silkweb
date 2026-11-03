import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CREATIVE_REFERENCE_VERSION,
  CREATIVE_CLASSES,
  CREATIVE_REFERENCES,
  eligibleCreativeClasses,
} from '../dist/creativeReferenceRegistry.js';

function evidence(overrides = {}) {
  return {
    hasProductFacts: false,
    hasGenuineOffer: false,
    hasVerifiedOutcome: false,
    hasTestimonial: false,
    hasComparativeEvidence: false,
    hasTransformationEvidence: false,
    ...overrides,
  };
}

function ids(input) {
  return eligibleCreativeClasses(input).map((item) => item.id);
}

test('m4a registry is versioned and contains eight unique creative classes', () => {
  assert.equal(CREATIVE_REFERENCE_VERSION, 'm4a-v1');
  assert.equal(CREATIVE_CLASSES.length, 8);
  assert.equal(new Set(CREATIVE_CLASSES.map((item) => item.id)).size, 8);
});

test('m4a has ten references mapped to valid classes', () => {
  assert.equal(CREATIVE_REFERENCES.length, 10);

  const classes = new Set(CREATIVE_CLASSES.map((item) => item.id));
  const referenceIds = CREATIVE_REFERENCES.map((item) => item.id);

  assert.equal(new Set(referenceIds).size, 10);

  for (const reference of CREATIVE_REFERENCES) {
    assert.ok(classes.has(reference.classId));
    assert.equal(reference.performanceStatus, 'unverified');
    assert.ok(reference.observedPattern.length > 0);
    assert.ok(reference.reusableLesson.length > 0);
  }
});

test('m4a rejects offer, benefit, annotation and comparison classes without evidence', () => {
  const selected = ids(evidence());

  assert.ok(!selected.includes('OFFER_HERO'));
  assert.ok(!selected.includes('BENEFIT_STACK'));
  assert.ok(!selected.includes('ANNOTATED_HERO'));
  assert.ok(!selected.includes('VISUAL_COMPARISON'));
});

test('m4a admits benefit and annotated hero with product facts', () => {
  const selected = ids(evidence({ hasProductFacts: true }));

  assert.ok(selected.includes('BENEFIT_STACK'));
  assert.ok(selected.includes('ANNOTATED_HERO'));
  assert.ok(!selected.includes('OFFER_HERO'));
});

test('m4a requires a genuine offer for offer-led creative', () => {
  assert.ok(!ids(evidence()).includes('OFFER_HERO'));

  assert.ok(
    ids(evidence({ hasGenuineOffer: true })).includes('OFFER_HERO'),
  );
});

test('m4a requires comparative evidence for visual comparison', () => {
  assert.ok(!ids(evidence()).includes('VISUAL_COMPARISON'));

  assert.ok(
    ids(evidence({ hasComparativeEvidence: true }))
      .includes('VISUAL_COMPARISON'),
  );
});

test('m4a selection is deterministic and does not mutate the registry', () => {
  const input = evidence({
    hasProductFacts: true,
    hasGenuineOffer: true,
  });

  const before = JSON.stringify(CREATIVE_CLASSES);
  const first = ids(input);
  const second = ids(input);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(CREATIVE_CLASSES), before);
});

test('m4a class rules and exclusions are populated', () => {
  for (const creative of CREATIVE_CLASSES) {
    assert.ok(creative.mechanism.length > 0);
    assert.ok(creative.hierarchy.length > 0);
    assert.ok(creative.composition.length > 0);
    assert.ok(creative.typography.length > 0);
    assert.ok(creative.rules.length > 0);
    assert.ok(creative.exclusions.length > 0);
  }
});
