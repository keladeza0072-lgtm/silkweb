import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFrame, encodePng } from '../dist/imageAds.js';
import {
  COPY_QUALITY_LIMITS,
  COPY_QUALITY_VERSION,
  checkCopyQuality,
  findUnsupportedClaims,
  hasProductRelevance,
  headlineStructureKey,
  isGenericHeadline,
  scoreHeadlineDiagnostics,
} from '../dist/creativeCopyIntelligence.js';
import { imageAdsGenerateLiveOutcome } from '../dist/imageAdsLive.js';

/**
 * Copy-quality gate suite. Socket-free, no paid inference: the planner
 * and image providers are deterministic mocks. Every live test passes
 * an explicit `env: {}` so ambient SILKWEB_CREATIVE_PROVIDER /
 * SILKWEB_CREATIVE_DIRECTOR flags cannot leak in (SAM stays off).
 */

function bigPng() {
  return encodePng(createFrame(1080, 1350, [18, 32, 48]));
}

function mockLiveDeps(plans, counters) {
  return {
    allowTestProviders: true,
    env: {},
    planner: {
      name: 'mock-planner',
      testOnly: true,
      plan: async () => { counters.planner += 1; return plans; },
    },
    images: {
      name: 'mock-imagery',
      testOnly: true,
      generate: async () => { counters.images += 1; return { png: bigPng(), referenceGuided: false }; },
    },
  };
}

function brief(productName, differentiator, objective = 'drive-sales') {
  return { productName, objective, differentiator };
}

const POWER_BRIEF = {
  productName: 'VoltPack 20K Power Bank',
  differentiator: 'Two full phone charges',
};
const SKIN_BRIEF = {
  productName: 'Luma Gentle Face Serum',
  differentiator: 'Hyaluronic acid and vitamin B5',
};
const COFFEE_BRIEF = {
  productName: 'Northwind Cold Brew Cans',
  differentiator: 'Steeped 18 hours, no added sugar',
};
const FASHION_BRIEF = {
  productName: 'Ama Cotton Summer Dress',
  differentiator: 'Hand-loomed breathable cotton',
};
const DECOR_BRIEF = {
  productName: 'Kente Glow Ceramic Lamp',
  differentiator: 'Hand-glazed ceramic, warm 2700K light',
};

function ad(id, audience, angle, headline, body, cta, visualPrompt = 'Studio product photograph, soft daylight, open 4:5 composition.') {
  return { id, audience, angle, headline, body, cta, visualPrompt };
}

/* ---------------- Power bank ---------------- */

const POWER_GOOD = [
  ad('ad-1', 'cold', 'Dead-battery mornings on the train',
    'Your day. Your backup power.',
    'VoltPack 20K Power Bank holds two full phone charges for long days out.', 'Learn more',
    'Phone charging on a train seat at dawn, open 4:5 composition.'),
  ad('ad-2', 'warm', 'Packing light without outlet anxiety',
    'Two full charges, pocket-sized.',
    'Compare the VoltPack 20K Power Bank against your old brick on a weekend trip.', 'See details',
    'Power bank slipping into a jacket pocket, daylight.'),
  ad('ad-3', 'hot', 'The night-before-the-trip decision',
    'Leave with a full battery.',
    'Get the VoltPack 20K Power Bank before the morning commute.', 'Shop now',
    'Packed bag by the door at night, decisive framing.'),
];

const POWER_BAD = [
  ad('ad-1', 'cold', 'Big launch news for everyone',
    'What is new from VoltPack?',
    'Meet the new arrival with the best charging ever and 20000mAh power.', 'Learn more',
    'Product photograph V1.'),
  ad('ad-2', 'warm', 'Big launch news for shoppers',
    'What is new from VoltPack today?',
    'Come see the new arrival with the fastest charging ever and 20000mAh power.', 'Learn more',
    'Product photograph V2.'),
  ad('ad-3', 'hot', 'Big launch news for buyers',
    'What is new from VoltPack now?',
    'Just announced: the new arrival with the world\u2019s best charging and 20000mAh power.', 'Shop now',
    'Product photograph V3.'),
];

/* ---------------- Skincare ---------------- */

const SKIN_GOOD = [
  ad('ad-1', 'cold', 'Dry winter mornings downtown',
    'Skin that drinks in the morning.',
    'Luma Gentle Face Serum layers hyaluronic acid under moisturizer.', 'Learn more',
    'Serum dropper in morning window light.'),
  ad('ad-2', 'warm', 'Reading the label with care',
    'Five ingredients you can pronounce.',
    'Compare Luma Gentle Face Serum: fragrance-free hydration for sensitive skin.', 'See details',
    'Serum bottle beside a bathroom mirror.'),
  ad('ad-3', 'hot', 'Tonight\u2019s ten-minute ritual',
    'Start tonight, glow by Friday.',
    'Add Luma Gentle Face Serum to your evening routine tonight.', 'Shop now',
    'Hands applying serum at night, close framing.'),
];

const SKIN_BAD = [
  ad('ad-1', 'cold', 'Exciting news for everyone',
    'Just announced: Luma serum!',
    'Dermatologist approved serum, clinically proven to remove wrinkles with 10% hydration.', 'Buy now!',
    'Product photograph V1.'),
  ad('ad-2', 'warm', 'Exciting news for shoppers',
    'Just announced: Luma serum today!',
    'Our 10% formula removes wrinkles and erases crow\u2019s feet fast.', 'Buy now!',
    'Product photograph V2.'),
  ad('ad-3', 'hot', 'Exciting news for buyers',
    'Just announced: Luma serum now!',
    'Miracle serum erases wrinkles instantly, shop the 10% formula.', 'Order now!',
    'Product photograph V3.'),
];

/* ---------------- Coffee ---------------- */

const COFFEE_GOOD = [
  ad('ad-1', 'cold', 'Sleepy commutes on the early train',
    'Cold mornings meet their match.',
    'Northwind Cold Brew Cans steep for 18 slow hours with no added sugar.', 'Learn more',
    'Cold brew can in a commuter\u2019s hand at dawn.'),
  ad('ad-2', 'warm', 'Comparing cans in the office fridge',
    'Smooth, never bitter, no crash.',
    'Taste Northwind Cold Brew Cans against your usual iced coffee.', 'See details',
    'Two cans side by side in office light.'),
  ad('ad-3', 'hot', 'Friday\u2019s grocery run decision',
    'Grab the weekend twelve-pack.',
    'Pick up Northwind Cold Brew Cans for the cabin trip.', 'Shop now',
    'Cans stacked in a grocery basket.'),
];

const COFFEE_BAD = [
  ad('ad-1', 'cold', 'Great news for everyone',
    'Hey - it\u2019s here, come see!',
    'Something special from Northwind for coffee lovers everywhere!', 'Click here',
    'Product photograph V1.'),
  ad('ad-2', 'warm', 'Great news for shoppers',
    'Hey - it\u2019s here, come see today!',
    'Great quality Northwind coffee for everyone, come and take a first look!', 'Click here',
    'Product photograph V2.'),
  ad('ad-3', 'hot', 'Great news for buyers',
    'Hey - it\u2019s here, come see now!',
    'Quality you can trust in every Northwind can!', 'Submit',
    'Product photograph V3.'),
];

/* ---------------- Fashion ---------------- */

const FASHION_GOOD = [
  ad('ad-1', 'cold', 'Humid market mornings in Accra',
    'Air you can wear.',
    'The Ama Cotton Summer Dress moves through heat in breathable hand-loomed cotton.', 'Learn more',
    'Dress flowing in a bright market.'),
  ad('ad-2', 'warm', 'Choosing between prints at noon',
    'One dress, three weddings.',
    'The Ama Cotton Summer Dress packs light and shakes out smooth by evening.', 'See details',
    'Dress folded beside travel sandals.'),
  ad('ad-3', 'hot', 'Saturday\u2019s fitting-room choice',
    'Take the window seat.',
    'Order the Ama Cotton Summer Dress in your size before the weekend.', 'Shop now',
    'Woman wearing the dress by a tall window.'),
];

const FASHION_BAD = [
  ad('ad-1', 'cold', 'New arrival news for all',
    'Get the Ama look today!',
    'The Ama Cotton Summer Dress is here in every color for every occasion this season.',
    'Shop now and get yours today with our amazing store',
    'Product photograph V1.'),
  ad('ad-2', 'warm', 'New arrival news for fans',
    'Get the Ama look this week!',
    'A truly amazing dress for every occasion, with amazing style for absolutely everyone.', 'Learn more',
    'Product photograph V2.'),
  ad('ad-3', 'hot', 'New arrival news for friends',
    'Get the Ama look this weekend!',
    'An amazing Ama dress with amazing style for outings, parties, and long summer days.', 'Shop now',
    'Product photograph V3.'),
];

/* ---------------- Home decor ---------------- */

const DECOR_GOOD = [
  ad('ad-1', 'cold', 'Rainy evenings on the balcony',
    'A warm corner, on purpose.',
    'The Kente Glow Ceramic Lamp pools warm 2700K light over reading chairs.', 'Learn more',
    'Lamp glowing on a balcony table at dusk.'),
  ad('ad-2', 'warm', 'Comparing lamps by lamplight',
    'Glaze that holds the glow.',
    'The Kente Glow Ceramic Lamp is hand-glazed, so no two read exactly alike.', 'See details',
    'Close crop of the glazed ceramic base.'),
  ad('ad-3', 'hot', 'Tonight\u2019s bedside-table swap',
    'Dim the ceiling lights.',
    'Bring the Kente Glow Ceramic Lamp home for softer nights.', 'Shop now',
    'Lamp on a bedside table, soft night framing.'),
];

const DECOR_BAD = [
  ad('ad-1', 'cold', 'Special deal news for all',
    'Best glow for your room!',
    'Get the Kente Glow Ceramic Lamp for 29 with free shipping, a designer favorite!', 'Order now!',
    'Product photograph V1.'),
  ad('ad-2', 'warm', 'Special deal news for fans',
    'Best light for your room!',
    'The fastest-selling lamp of the season at 29, a true designer favorite!', 'Order now!',
    'Product photograph V2.'),
  ad('ad-3', 'hot', 'Special deal news for friends',
    'Best corner for your room!',
    'Our miracle showstopper, the Kente lamp with the ceramic glow everyone wants, just 29!', 'Buy now!',
    'Product photograph V3.'),
];

const CASES = [
  ['power bank', POWER_BRIEF, POWER_GOOD, POWER_BAD],
  ['skincare', SKIN_BRIEF, SKIN_GOOD, SKIN_BAD],
  ['coffee', COFFEE_BRIEF, COFFEE_GOOD, COFFEE_BAD],
  ['fashion', FASHION_BRIEF, FASHION_GOOD, FASHION_BAD],
  ['home decor', DECOR_BRIEF, DECOR_GOOD, DECOR_BAD],
];

test('gate version is pinned and headline diagnostics preserve known behavior', () => {
  assert.equal(COPY_QUALITY_VERSION, 'silkweb-copy-quality-gate-v1');
  assert.equal(scoreHeadlineDiagnostics('Considering a power bank?').pass, false);
  assert.equal(scoreHeadlineDiagnostics('Hey - it\u2019s here, come see').pass, false);
  // Short, creative, product-free hooks are never failures on shortness alone.
  assert.equal(scoreHeadlineDiagnostics('Your day. Your backup power.').pass, true);
});

test('generic filler headlines are detected; real hooks are not', () => {
  for (const filler of [
    'What is new from VoltPack?',
    'Considering a serum?',
    'Hey - it\u2019s here, come see!',
    'Just announced: Luma serum!',
    'Take a first look at our drop',
    'Buy now!',
    'Something special for you',
  ]) {
    assert.equal(isGenericHeadline(filler), true, filler);
  }
  for (const hook of [
    'Your day. Your backup power.',
    'Air you can wear.',
    'Glaze that holds the glow.',
    'Meet Luma Candles',
    'Skin that drinks in the morning.',
  ]) {
    assert.equal(isGenericHeadline(hook), false, hook);
  }
});

test('product relevance does not require brand-name repetition', () => {
  // "backup power" carries the power-bank cue without naming VoltPack.
  assert.equal(hasProductRelevance('Your day. Your backup power.', POWER_BRIEF), true);
  assert.equal(
    hasProductRelevance('Great vibes for great days. Good times for everyone, every day.', POWER_BRIEF),
    false,
  );
});

test('unsupported claims are flagged only when facts do not support them', () => {
  assert.ok(findUnsupportedClaims('The best charging ever', {}).length > 0);
  assert.equal(findUnsupportedClaims('The best charging ever', { productName: 'X', differentiator: 'The best charging ever' }).length, 0);
  assert.ok(findUnsupportedClaims('20000mAh power', {}).length > 0);
  assert.ok(findUnsupportedClaims('Dermatologist approved results', {}).length > 0);
});

test('unreasonable lengths are blocked per field', () => {
  const base = { angle: 'A distinct reason to care', headline: 'Air you can wear.', body: 'The Ama Cotton Summer Dress moves through heat.', cta: 'Shop now' };
  const longHeadline = { ...base, headline: 'Power for travel. '.repeat(6).trim() };
  assert.ok(longHeadline.headline.length > COPY_QUALITY_LIMITS.headlineChars);
  const headlineResult = checkCopyQuality([longHeadline], POWER_BRIEF);
  assert.equal(headlineResult.ok, false);
  assert.ok(headlineResult.issues.some((i) => i.field === 'plans[0].headline' && i.message.includes('too long')));

  const longBody = { ...base, body: 'VoltPack 20K Power Bank. '.repeat(12).trim() };
  assert.ok(longBody.body.length > COPY_QUALITY_LIMITS.bodyChars);
  const bodyResult = checkCopyQuality([longBody], POWER_BRIEF);
  assert.equal(bodyResult.ok, false);
  assert.ok(bodyResult.issues.some((i) => i.field === 'plans[0].body'));

  const longCta = { ...base, cta: 'Shop now for amazing deals today only' };
  assert.ok(longCta.cta.length > COPY_QUALITY_LIMITS.ctaChars);
  const ctaResult = checkCopyQuality([longCta], POWER_BRIEF);
  assert.equal(ctaResult.ok, false);
  assert.ok(ctaResult.issues.some((i) => i.field === 'plans[0].cta'));
});

test('near-paraphrase headlines across three ads are blocked as one repeated idea', () => {
  const plans = [
    ad('ad-1', 'cold', 'Dead batteries at dawn', 'Power your day with VoltPack',
      'VoltPack 20K Power Bank charges a phone twice.', 'Learn more'),
    ad('ad-2', 'warm', 'Weekend trips without outlets', 'Power your day with VoltPack today',
      'A VoltPack 20K Power Bank refills phones on long trips.', 'See details'),
    ad('ad-3', 'hot', 'The gift for travelers', 'Power your day with VoltPack now',
      'Keep a VoltPack 20K Power Bank in every travel bag.', 'Shop now'),
  ];
  assert.equal(headlineStructureKey(plans[0].headline), headlineStructureKey(plans[1].headline));
  const result = checkCopyQuality(plans, POWER_BRIEF);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.message.includes('near-paraphrases')));
});

test('repeated creative angles across ads are blocked', () => {
  const plans = [
    ad('ad-1', 'cold', 'Big launch news for everyone', 'Your day. Your backup power.',
      'VoltPack 20K Power Bank holds two full phone charges.', 'Learn more'),
    ad('ad-2', 'warm', 'Big launch news for shoppers', 'Two full charges, pocket-sized.',
      'Compare the VoltPack 20K Power Bank on a weekend trip.', 'See details'),
    ad('ad-3', 'hot', 'Big launch news for buyers', 'Leave with a full battery.',
      'Get the VoltPack 20K Power Bank before the commute.', 'Shop now'),
  ];
  const result = checkCopyQuality(plans, POWER_BRIEF);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.message.includes('repeat one creative angle')));
});

for (const [name, productBrief, good, bad] of CASES) {
  test(`${name}: strong three-ad copy passes the gate`, () => {
    const result = checkCopyQuality(good, productBrief);
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.issues)}`);
  });

  test(`${name}: weak three-ad copy fails the gate`, () => {
    const result = checkCopyQuality(bad, productBrief);
    assert.equal(result.ok, false, `${name}: expected blocking issues`);
    assert.ok(result.issues.length > 0);
  });

  test(`${name}: invalid copy plan triggers ZERO image-provider calls`, async () => {
    const counters = { planner: 0, images: 0 };
    const outcome = await imageAdsGenerateLiveOutcome(
      brief(productBrief.productName, productBrief.differentiator),
      mockLiveDeps(bad, counters),
    );
    assert.equal(counters.planner, 1);
    assert.equal(counters.images, 0);
    assert.equal(outcome.status, 422);
    assert.equal(outcome.payload.ok, false);
    assert.ok(outcome.payload.issues.length > 0);
  });

  test(`${name}: strong copy plan completes the live pipeline`, async () => {
    const counters = { planner: 0, images: 0 };
    const outcome = await imageAdsGenerateLiveOutcome(
      brief(productBrief.productName, productBrief.differentiator),
      mockLiveDeps(good, counters),
    );
    assert.equal(outcome.status, 200, JSON.stringify(outcome.payload).slice(0, 500));
    assert.equal(outcome.payload.ok, true);
    assert.equal(outcome.payload.ads.length, 3);
    assert.equal(counters.planner, 1);
    assert.equal(counters.images, 3);
  });
}
