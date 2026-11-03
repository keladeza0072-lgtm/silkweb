import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initializeApprovedCreativeLibrary, resetCreativeLibrary } from '../dist/library.js';
import { validateCampaignContext } from '../dist/campaign.js';
import { buildLiveConceptPrompt } from '../dist/provider.js';
import { evaluateConcepts, reviewPolicies } from '../dist/evaluate.js';
import { buildLandingPreview } from '../dist/landing.js';
import {
  conceptsGenerateOutcome,
  evaluateOutcome,
  imagesGenerateOutcome,
  landingOutcome,
} from '../dist/server.js';

/**
 * Campaign-workflow regression suite. Socket-free, no model calls:
 * preferences flow into the campaign context and the live prompt,
 * deterministic evaluation scores seven weighted criteria, policy
 * stays separate, landing repeats facts only, and the image
 * boundary never fabricates output.
 */

function setupApproved() {
  resetCreativeLibrary();
  initializeApprovedCreativeLibrary();
}

function campaign(overrides = {}) {
  return {
    description: 'Acme Coffee launches cold-brew cans for commuters to drive launch-week trial.',
    product: 'Cold-brew cans',
    objective: 'Drive launch-week trial',
    audience: 'Commuters 25-40',
    brand: 'Acme',
    facts: ['Product: Cold-brew cans', 'Audience: Commuters 25-40', 'Objective: Drive launch-week trial'],
    assumptions: [],
    ...overrides,
  };
}

function conceptsPair() {
  return [
    {
      id: 'c1', angle: 'Easy mornings for commuters', headline: 'Cold brew, ready when you are',
      primaryCopy: 'Acme cold-brew cans for commuters help you drive launch-week trial. Clean and confident.',
      cta: 'Shop now', visualDirection: 'Can in soft daylight.', photographyPrompt: 'Studio photograph of Cold-brew cans, soft daylight.',
      styleId: 'problem-solution', frameworkId: 'aida',
    },
    {
      id: 'c2', angle: 'Premium mornings for commuters', headline: 'Brewed bold for busy mornings',
      primaryCopy: 'A second take on Acme cold-brew cans for commuters and launch-week trial.',
      cta: 'Learn more', visualDirection: 'Candid morning moment.', photographyPrompt: 'Lifestyle photograph of a commuter with Cold-brew cans.',
      styleId: 'editorial', frameworkId: 'pas',
    },
  ];
}

test('campaign preferences validate and survive the context', () => {
  assert.equal(validateCampaignContext(campaign()).ok, true);
  const withPrefs = validateCampaignContext(campaign({ preferredStyleId: 'editorial', preferredFrameworkId: 'fab' }));
  assert.equal(withPrefs.ok, true);
  assert.equal(withPrefs.context.preferredStyleId, 'editorial');
  const bad = validateCampaignContext(campaign({ preferredStyleId: 'not a valid id!!' }));
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => i.field === 'preferredStyleId'));
});

test('preferred style steers the live prompt pairing when compatible', () => {
  setupApproved();
  const prompt = buildLiveConceptPrompt(campaign({ preferredStyleId: 'editorial' }));
  assert.ok(prompt.includes('editorial'), 'prompt must carry the compatible preference');
  assert.ok(prompt.includes('Recommended style ids in order: editorial'));
});

test('incompatible preference is set aside, never forced', () => {
  setupApproved();
  const prompt = buildLiveConceptPrompt(campaign({ preferredStyleId: 'notification-offer' }));
  assert.ok(prompt.includes('set aside'), 'incompatible offer style must be explained as set aside');
  assert.ok(!prompt.includes('pair concept 1 with styleId "notification-offer"'));
});

test('evaluation scores seven criteria with weights summing to 100', () => {
  setupApproved();
  const [first, second] = evaluateConcepts(campaign(), conceptsPair());
  for (const ev of [first, second]) {
    assert.equal(ev.criteria.length, 7);
    assert.equal(ev.criteria.reduce((sum, c) => sum + c.weight, 0), 100);
    for (const c of ev.criteria) {
      assert.ok(c.score >= 0 && c.score <= 100);
      assert.ok(c.detail.trim().length > 0 && c.action.trim().length > 0);
    }
    assert.ok(ev.overall >= 0 && ev.overall <= 100);
    assert.ok(['Ready', 'Nearly ready', 'Needs work', 'Blocked'].includes(ev.band));
    assert.ok(/no model/i.test(ev.method));
  }
});

test('evaluation is deterministic and flags unsupported promos', () => {
  setupApproved();
  const again = evaluateConcepts(campaign(), conceptsPair());
  assert.deepEqual(again, evaluateConcepts(campaign(), conceptsPair()));
  const shady = {
    ...conceptsPair()[0],
    primaryCopy: 'Get 50% off today, guaranteed number one results!',
  };
  const [ev] = evaluateConcepts(campaign(), [shady, conceptsPair()[1]]);
  const grounding = ev.criteria.find((c) => c.id === 'fact-grounding');
  assert.ok(grounding.score < 70, 'unbriefed discount + guarantee must score low');
});

test('policy review stays separate and never claims approval', () => {
  setupApproved();
  const [first] = reviewPolicies(campaign(), conceptsPair());
  assert.equal(first.items.length, 4);
  assert.ok(first.items.every((i) => i.status === 'pass' || i.status === 'attention'));
  assert.ok(/not legal advice/i.test(first.disclaimer));
  assert.ok(/not Meta-policy approval/i.test(first.disclaimer));
});

test('landing preview repeats facts only, never invents', () => {
  const landing = buildLandingPreview(campaign(), conceptsPair()[0]);
  assert.equal(landing.headline, conceptsPair()[0].headline);
  assert.equal(landing.cta, conceptsPair()[0].cta);
  assert.deepEqual(landing.benefits, campaign().facts.slice(0, 4));
  const text = JSON.stringify(landing).toLowerCase();
  assert.ok(!text.includes('testimonial'));
  assert.ok(!text.includes('guarantee'));
  const bare = buildLandingPreview(campaign({ facts: [] }), conceptsPair()[0]);
  assert.deepEqual(bare.benefits, []);
});

test('endpoint outcomes: evaluate, landing, images', () => {
  setupApproved();
  const evaluated = evaluateOutcome({ campaign: campaign(), concepts: conceptsPair() });
  assert.equal(evaluated.status, 200);
  assert.equal(evaluated.payload.ok, true);
  assert.equal(evaluated.payload.evaluations.length, 2);
  assert.equal(evaluated.payload.policies.length, 2);
  const badEval = evaluateOutcome({ campaign: campaign(), concepts: [conceptsPair()[0]] });
  assert.equal(badEval.status, 422);

  const preview = landingOutcome({ campaign: campaign(), concept: conceptsPair()[0] });
  assert.equal(preview.status, 200);
  assert.equal(preview.payload.ok, true);
  assert.equal(preview.payload.landing.headline, conceptsPair()[0].headline);
  assert.equal(landingOutcome({}).status, 400);

  const images = imagesGenerateOutcome();
  assert.equal(images.status, 503);
  assert.equal(images.payload.error.code, 'IMAGE_UNAVAILABLE');
});

test('concepts endpoint still refuses without a provider', () => {
  setupApproved();
  const outcome = conceptsGenerateOutcome(campaign());
  assert.equal(outcome.status, 503);
  assert.equal(outcome.payload.error.code, 'PROVIDER_UNAVAILABLE');
});
