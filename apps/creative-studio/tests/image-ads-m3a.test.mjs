import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CREATIVE_KNOWLEDGE_PACK,
  CREATIVE_KNOWLEDGE_PACK_VERSION,
  getPrinciple,
  listLivePrinciples,
} from '../dist/knowledgePack.js';
import {
  assessImageAdEvidence,
  buildImageAdStrategySection,
  selectImageAdStrategies,
} from '../dist/imageAdStrategy.js';
import {
  buildImageAdPlanPrompt,
  buildImageAdPlanPromptWithProvenance,
  clearImageAdPlanProvenance,
  lastImageAdPlanProvenance,
  MAX_PLAN_PROMPT_CHARS,
  MetaMuseImageAdPlanner,
  validateImageAdPlans,
} from '../dist/imageAdsPlan.js';
import { checkImageAdPolicy } from '../dist/imageAdsPolicy.js';
import { createFrame, encodePng } from '../dist/imageAds.js';
import { imageAdsGenerateLiveOutcome } from '../dist/imageAdsLive.js';

/**
 * Image Ads Milestone 3A suite. Fully offline, no paid inference:
 * deterministic strategy retrieval over the approved library plus
 * the versioned knowledge pack, evidence gating, prompt-size
 * safety, provenance, and response compatibility are exercised
 * with mocked providers only.
 */

function baseInput(overrides = {}) {
  return {
    productName: 'Luma Candles',
    objective: 'drive-sales',
    upload: null,
    differentiator: 'Small-batch soy pour',
    price: '',
    currency: '',
    specialOffer: '',
    ...overrides,
  };
}

function goodPlans() {
  return [
    { id: 'ad-1', audience: 'cold', angle: 'First look for newcomers', headline: 'Meet Luma Candles', body: 'A calm first look at Luma Candles.', cta: 'Learn more', visualPrompt: 'Candle on stone in morning light, open composition.' },
    { id: 'ad-2', audience: 'warm', angle: 'Considered evenings', headline: 'Evenings with Luma Candles', body: 'See how Luma Candles fits a quiet evening routine.', cta: 'Discover more', visualPrompt: 'Candle beside a book at dusk, warm interior.' },
    { id: 'ad-3', audience: 'hot', angle: 'Decide tonight', headline: 'Your Luma Candles tonight', body: 'Luma Candles is ready when you are — order today.', cta: 'Shop now', visualPrompt: 'Candle glowing on a table, decisive close framing.' },
  ];
}

test('m3a strategy selection is deterministic', () => {
  const first = selectImageAdStrategies(baseInput());
  const second = selectImageAdStrategies(baseInput());
  assert.deepEqual(first, second);
  const sectionA = buildImageAdStrategySection(baseInput()).section;
  const sectionB = buildImageAdStrategySection(baseInput()).section;
  assert.equal(sectionA, sectionB);
});

test('m3a covers cold, warm, and hot with distinct strategic angles', () => {
  const { strategies } = selectImageAdStrategies(baseInput());
  assert.deepEqual(strategies.map((s) => s.audience), ['cold', 'warm', 'hot']);
  for (const strategy of strategies) {
    assert.ok(strategy.styleId.length > 0);
    assert.ok(strategy.frameworkId.length > 0);
    assert.ok(strategy.principleIds.length > 0);
    assert.ok(strategy.reasons.length > 0);
  }
  const styles = strategies.map((s) => s.styleId);
  assert.equal(new Set(styles).size, 3, 'the three ads must use three different styles');
  const pairs = strategies.map((s) => `${s.styleId}+${s.frameworkId}`);
  assert.equal(new Set(pairs).size, 3, 'the three ads must differ in strategy, not just wording');
});

test('m3a knowledge pack selects live principles and excludes pending ones', () => {
  assert.equal(CREATIVE_KNOWLEDGE_PACK_VERSION, 'm3a-v1');
  const live = listLivePrinciples();
  assert.ok(live.length >= 8);
  assert.ok(live.every((p) => p.verificationStatus !== 'pending-review'));
  assert.ok(!live.some((p) => p.id === 'schwartz-sophistication-shift'));
  assert.ok(!live.some((p) => p.id === 'cialdini-authority-borrow'));
  // Pending entries are stored and inspectable, but never live-selected.
  assert.equal(getPrinciple('schwartz-sophistication-shift')?.verificationStatus, 'pending-review');
  const { strategies } = selectImageAdStrategies(baseInput());
  const selected = strategies.flatMap((s) => s.principleIds);
  assert.ok(selected.length > 0);
  assert.ok(!selected.includes('schwartz-sophistication-shift'));
  assert.ok(!selected.includes('cialdini-authority-borrow'));
  for (const id of selected) {
    assert.ok(live.some((p) => p.id === id), `selected principle ${id} must be live-cleared`);
  }
});

test('m3a pack carries no fabricated quotations, page refs, or verification claims', () => {
  assert.ok(!CREATIVE_KNOWLEDGE_PACK.some((p) => p.verificationStatus === 'source-verified'));
  for (const principle of CREATIVE_KNOWLEDGE_PACK) {
    for (const field of [principle.summary, principle.instruction, principle.restrictions]) {
      assert.ok(!/\bpage\b/i.test(field), `${principle.id} must not cite pages`);
      assert.ok(!/\bpp?\.\s*\d/i.test(field), `${principle.id} must not cite page numbers`);
      assert.ok(!/["“”]/.test(field), `${principle.id} must not contain quotations`);
      assert.ok(!/source-verified|verified against|confirmed in the source/i.test(field),
        `${principle.id} must not claim source verification`);
    }
    assert.ok(principle.version.length > 0);
    assert.ok(principle.author.length > 0);
  }
});

test('m3a withholds offer-led styles without a genuine supplied offer', () => {
  const bare = selectImageAdStrategies(baseInput());
  assert.equal(assessImageAdEvidence(baseInput()).hasOffer, false);
  assert.ok(!bare.strategies.some((s) => s.styleId === 'notification-offer'));
  assert.ok(bare.provenance.rejected.some(
    (r) => r.kind === 'style' && r.id === 'notification-offer' && /no user-supplied genuine offer/i.test(r.reason),
  ));

  const offered = selectImageAdStrategies(baseInput({ specialOffer: 'Free shipping this weekend' }));
  assert.equal(assessImageAdEvidence(baseInput({ specialOffer: 'Free shipping this weekend' })).hasOffer, true);
  const hot = offered.strategies.find((s) => s.audience === 'hot');
  assert.equal(hot?.styleId, 'notification-offer');
});

test('m3a bare comparatives are not transformation evidence', () => {
  const hype = baseInput({ differentiator: 'Better mornings, faster routine, improved focus' });
  assert.equal(assessImageAdEvidence(hype).hasTransformationEvidence, false);
  const { strategies, provenance } = selectImageAdStrategies(hype);
  assert.ok(!strategies.some((s) => s.styleId === 'before-after'));
  assert.ok(!strategies.some((s) => s.frameworkId === 'bab'));
  assert.ok(provenance.rejected.some((r) => r.id === 'before-after' && /bare comparatives/i.test(r.reason)));

  const unverifiedClaim = baseInput({ differentiator: 'Noticeably calmer evenings in 7 days of nightly use' });
  assert.equal(assessImageAdEvidence(unverifiedClaim).hasTransformationEvidence, false);
  const withoutProof = selectImageAdStrategies(unverifiedClaim);
  assert.ok(!withoutProof.strategies.some((s) => s.styleId === 'before-after'));
  assert.ok(!withoutProof.strategies.some((s) => s.frameworkId === 'bab'));
});

test('m3a feature-led framework needs supplied product facts', () => {
  const noFacts = selectImageAdStrategies(baseInput({ differentiator: '' }));
  assert.equal(assessImageAdEvidence(baseInput({ differentiator: '' })).hasTechnicalFacts, false);
  assert.ok(!noFacts.strategies.some((s) => s.frameworkId === 'fab'));
  assert.ok(noFacts.provenance.rejected.some((r) => r.id === 'fab'));

  const withFacts = selectImageAdStrategies(baseInput());
  assert.ok(withFacts.strategies.some((s) => s.frameworkId === 'fab'));
});

test('m3a existing claim-safety checks are not weakened', () => {
  const input = baseInput();
  const priced = [{ ...goodPlans()[0], body: 'Luma Candles for $49.' }];
  assert.ok(checkImageAdPolicy(priced, input).some((f) => f.message.includes('price')));
  const discounted = [{ ...goodPlans()[0], body: 'Get 50% off today, limited time only!' }];
  assert.ok(checkImageAdPolicy(discounted, input).length >= 1);
  const proofy = [{ ...goodPlans()[0], body: 'Loved by celebrities, guaranteed number one results!' }];
  assert.ok(checkImageAdPolicy(proofy, input).length >= 1);
  // Supplied facts still pass.
  const honest = [{ ...goodPlans()[0], body: 'Small-batch soy pour from Luma Candles.' }];
  assert.equal(checkImageAdPolicy(honest, input).length, 0);
});

test('m3a planning prompt carries strategy guidance within budget and keeps safety intact', () => {
  const prompt = buildImageAdPlanPrompt(baseInput());
  assert.ok(prompt.length <= MAX_PLAN_PROMPT_CHARS);
  assert.ok(prompt.length <= 8000);
  for (const audience of ['"cold"', '"warm"', '"hot"']) assert.ok(prompt.includes(audience));
  assert.ok(prompt.includes('do not store'));
  assert.ok(prompt.includes('Use ONLY the supplied facts'));
  assert.ok(prompt.includes('A price or offer may appear in copy ONLY when it is listed in the supplied facts'));
  assert.ok(prompt.includes('## Creative strategy'));
  assert.ok(prompt.includes('Small-batch soy pour'));
  assert.ok(prompt.includes('never write offer-led copy') || prompt.includes('Evidence note'));
  assert.ok(!prompt.includes('schwartz-sophistication-shift'));
  assert.ok(!prompt.includes('cialdini-authority-borrow'));
});

test('m3a provenance records pack version, selections, reasons, and rejections', () => {
  clearImageAdPlanProvenance();
  const { prompt, provenance } = buildImageAdPlanPromptWithProvenance(baseInput());
  assert.ok(prompt.length > 0);
  assert.equal(provenance.knowledgePackVersion, 'm3a-v1');
  assert.equal(provenance.objective, 'drive-sales');
  assert.equal(provenance.strategies.length, 3);
  for (const strategy of provenance.strategies) {
    assert.ok(strategy.styleId.length > 0);
    assert.ok(strategy.frameworkId.length > 0);
    assert.ok(strategy.principleIds.length > 0);
    assert.ok(strategy.reasons.length >= 3);
    assert.ok(strategy.reasons.every((r) => typeof r === 'string' && r.length > 0));
  }
  assert.ok(provenance.rejected.length > 0);
  assert.ok(provenance.rejected.every((r) => r.reason.length > 0));

  const recorded = lastImageAdPlanProvenance();
  assert.ok(recorded);
  assert.deepEqual(recorded.provenance, provenance);
});

test('m3a provenance stays internal: never in the customer payload', async () => {
  const pngs = [0, 1, 2].map((n) => encodePng(createFrame(1080, 1350, [10 + n, 20, 30])));
  let imageCalls = 0;
  const deps = {
    allowTestProviders: true,
    planner: { name: 'mock-planner', testOnly: true, plan: async () => goodPlans() },
    images: {
      name: 'mock-imagery',
      testOnly: true,
      generate: async () => ({ png: pngs[imageCalls++], referenceGuided: false }),
    },
  };
  const outcome = await imageAdsGenerateLiveOutcome({ productName: 'Luma Candles', objective: 'drive-sales' }, deps);
  assert.equal(outcome.status, 200);
  assert.equal(outcome.payload.ok, true);
  assert.equal(outcome.payload.ads.length, 3);
  assert.ok(!('provenance' in outcome.payload));
  assert.ok(!JSON.stringify(outcome.payload).toLowerCase().includes('provenance'));
  assert.ok(!JSON.stringify(outcome.payload).toLowerCase().includes('schwartz-'));
});

test('m3a planner posts once with the strategy-guided prompt', async () => {
  const seen = [];
  const planner = new MetaMuseImageAdPlanner({
    apiKey: 'k',
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', output_text: JSON.stringify(goodPlans()) }] }] }),
      };
    },
  });
  const raw = await planner.plan(baseInput());
  assert.equal(raw.length, 3);
  assert.equal(seen.length, 1);
  const sentPrompt = JSON.parse(seen[0].init.body).input;
  assert.ok(sentPrompt.includes('## Creative strategy'));
  assert.ok(sentPrompt.includes('Use ONLY the supplied facts'));
  assert.equal(validateImageAdPlans(raw).ok, true);
});

test('m3a response contract still validates exactly three cold/warm/hot plans', () => {
  assert.equal(validateImageAdPlans(goodPlans()).ok, true);
  assert.equal(validateImageAdPlans(goodPlans().slice(0, 2)).ok, false);
});
