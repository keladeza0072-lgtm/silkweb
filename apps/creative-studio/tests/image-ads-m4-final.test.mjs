import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { imageAdsGenerateLiveOutcome } from '../dist/imageAdsLive.js';
import { renderBlueprintAd } from '../dist/imageAdBlueprintRenderer.js';
import { selectCreativeClasses } from '../dist/imageAdCreativeSelection.js';
import { validateImageAdInput } from '../dist/imageAds.js';

const plans = [
  {
    id: 'ad-1',
    audience: 'cold',
    angle: 'Product discovery',
    headline: 'Meet Luma Candles',
    body: 'Discover the Luma Candles collection.',
    cta: 'Learn more',
    visualPrompt: 'Candle on a table in natural daylight.',
  },
  {
    id: 'ad-2',
    audience: 'warm',
    angle: 'Product details',
    headline: 'Discover Luma Candles',
    body: 'Explore the Luma Candles collection.',
    cta: 'Discover more',
    visualPrompt: 'Candle in a calm interior setting.',
  },
  {
    id: 'ad-3',
    audience: 'hot',
    angle: 'Purchase consideration',
    headline: 'Explore Luma Candles',
    body: 'Find your next candle.',
    cta: 'Shop now',
    visualPrompt: 'Product-focused candle photography.',
  },
];

async function runScenario(brief) {
  const checked = validateImageAdInput(brief);
  assert.equal(checked.ok, true);

  const input = checked.input;
  const selections = selectCreativeClasses(input).selections;

  const source = await sharp({
    create: {
      width: 1080,
      height: 1350,
      channels: 4,
      background: '#C6B5A4',
    },
  }).png().toBuffer();

  let plannerCalls = 0;
  let imageCalls = 0;

  const outcome = await imageAdsGenerateLiveOutcome(brief, {
    allowTestProviders: true,
    planner: {
      name: 'test-planner',
      testOnly: true,
      plan: async () => {
        plannerCalls++;
        return plans;
      },
    },
    images: {
      name: 'test-image-provider',
      testOnly: true,
      generate: async () => {
        imageCalls++;
        return { png: source, referenceGuided: false };
      },
    },
  });

  assert.equal(outcome.status, 200, JSON.stringify(outcome.payload));
  assert.equal(outcome.payload.ok, true);
  assert.equal(outcome.payload.ads.length, 3);
  assert.equal(plannerCalls, 1);
  assert.equal(imageCalls, 3);

  for (const ad of outcome.payload.ads) {
    const plan = plans.find(p => p.audience === ad.audience);
    const selected = selections.find(s => s.audience === ad.audience);

    assert.ok(plan);
    assert.ok(selected);

    const expected = await renderBlueprintAd(
      source,
      {
        headline: plan.headline,
        body: plan.body,
        cta: plan.cta,
      },
      selected.classId,
    );

    assert.equal(
      expected.ok,
      true,
      `${selected.classId}: ${expected.reason ?? ''}`,
    );

    assert.equal(
      ad.pngDataUrl,
      expected.pngDataUrl,
      `${ad.audience}: live pipeline did not use selected blueprint`,
    );

    assert.equal(ad.headline, plan.headline);
    assert.equal(ad.body, plan.body);
    assert.equal(ad.cta, plan.cta);

    const bytes = Buffer.from(ad.pngDataUrl.split(',')[1], 'base64');
    const meta = await sharp(bytes).metadata();

    assert.equal(meta.format, 'png');
    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1350);

    console.log(
      `VERIFIED ${ad.audience}: ${selected.classId}, ` +
      `copy preserved, 1080x1350 PNG`,
    );
  }
}

test('minimal brief follows selected blueprints for three ads', async () => {
  await runScenario({
    productName: 'Luma Candles',
    objective: 'launch-product',
  });
});

test('evidence-rich brief follows selected blueprints for three ads', async () => {
  await runScenario({
    productName: 'Luma Candles',
    objective: 'drive-sales',
    differentiator: 'Hand-poured soy wax',
    specialOffer: 'Free shipping this weekend',
  });
});
