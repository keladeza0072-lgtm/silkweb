import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

import { imageAdsGenerateLiveOutcome } from '../dist/imageAdsLive.js';
import { renderBlueprintAd } from '../dist/imageAdBlueprintRenderer.js';
import { selectCreativeClasses } from '../dist/imageAdCreativeSelection.js';
import { selectCreativeDirectorReferences } from '../dist/creativeDirector.js';
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

function shortHash(dataUrl) {
  return createHash('sha256')
    .update(Buffer.from(dataUrl.split(',')[1], 'base64'))
    .digest('hex')
    .slice(0, 16);
}

async function runScenario(brief, { director }) {
  const checked = validateImageAdInput(brief);
  assert.equal(checked.ok, true, 'brief validates');

  const input = checked.input;
  const blueprintSelections = selectCreativeClasses(input).selections;
  const directorSelections = selectCreativeDirectorReferences(input).selections;

  if (director) {
    assert.equal(
      new Set(directorSelections.map((s) => s.referenceId)).size,
      3,
      'director references are differentiated',
    );
  }

  const source = await sharp({
    create: {
      width: 1080,
      height: 1350,
      channels: 4,
      background: '#C6B5A4',
    },
  }).png().toBuffer();
  const sourceDataUrl = `data:image/png;base64,${source.toString('base64')}`;

  let plannerCalls = 0;
  let imageCalls = 0;

  const outcome = await imageAdsGenerateLiveOutcome(brief, {
    allowTestProviders: true,
    env: director ? { SILKWEB_CREATIVE_DIRECTOR: 'on' } : {},
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

  assert.equal(outcome.status, 200, 'live outcome succeeds');
  assert.equal(outcome.payload.ok, true, 'payload ok');
  assert.equal(outcome.payload.ads.length, 3, 'three ads produced');
  assert.equal(plannerCalls, 1, 'planner called once');
  assert.equal(imageCalls, 3, 'image provider called three times');
  assert.deepEqual(
    outcome.payload.ads.map((a) => a.audience).sort(),
    ['cold', 'hot', 'warm'],
    'audiences preserved',
  );

  const hashes = new Set();

  for (const ad of outcome.payload.ads) {
    const plan = plans.find(p => p.audience === ad.audience);
    assert.ok(plan, `${ad.audience}: plan found`);

    assert.equal(ad.headline, plan.headline, `${ad.audience}: headline preserved`);
    assert.equal(ad.body, plan.body, `${ad.audience}: body preserved`);
    assert.equal(ad.cta, plan.cta, `${ad.audience}: CTA preserved`);
    assert.equal(ad.angle, plan.angle, `${ad.audience}: angle preserved`);
    assert.notEqual(shortHash(ad.pngDataUrl), shortHash(sourceDataUrl), `${ad.audience}: finished PNG differs from raw provider image`);
    hashes.add(shortHash(ad.pngDataUrl));

    const bytes = Buffer.from(ad.pngDataUrl.split(',')[1], 'base64');
    const meta = await sharp(bytes).metadata();

    assert.equal(meta.format, 'png', `${ad.audience}: valid PNG`);
    assert.equal(meta.width, 1080, `${ad.audience}: width 1080`);
    assert.equal(meta.height, 1350, `${ad.audience}: height 1350`);
    assert.equal(ad.width, 1080, `${ad.audience}: reported width 1080`);
    assert.equal(ad.height, 1350, `${ad.audience}: reported height 1350`);

    if (director) {
      const choice = directorSelections.find(s => s.audience === ad.audience);
      assert.ok(choice, `${ad.audience}: director reference selected`);

      const selectedClass = blueprintSelections.find(s => s.audience === ad.audience);
      const blueprint = selectedClass
        ? await renderBlueprintAd(source, { headline: plan.headline, body: plan.body, cta: plan.cta }, selectedClass.classId)
        : null;
      if (blueprint?.ok) {
        assert.notEqual(
          shortHash(ad.pngDataUrl),
          shortHash(blueprint.pngDataUrl),
          `${ad.audience}: director finisher selected, not blueprint fallback`,
        );
      }
      console.log(`VERIFIED ${ad.audience}: director ${choice.referenceId}, copy preserved, 1080x1350 PNG`);
    } else {
      const selected = blueprintSelections.find(s => s.audience === ad.audience);
      assert.ok(selected, `${ad.audience}: blueprint class selected`);

      const expected = await renderBlueprintAd(
        source,
        { headline: plan.headline, body: plan.body, cta: plan.cta },
        selected.classId,
      );

      assert.equal(expected.ok, true, `${selected.classId}: blueprint renders`);
      assert.equal(
        shortHash(ad.pngDataUrl),
        shortHash(expected.pngDataUrl),
        `${ad.audience}: legacy blueprint fallback selected`,
      );
      console.log(`VERIFIED ${ad.audience}: ${selected.classId}, copy preserved, 1080x1350 PNG`);
    }
  }

  assert.equal(hashes.size, 3, 'three differentiated finished ads');
}

test('minimal brief uses creative-director finisher for three ads', async () => {
  await runScenario({
    productName: 'Luma Candles',
    objective: 'launch-product',
  }, { director: true });
});

test('evidence-rich brief uses creative-director finisher for three ads', async () => {
  await runScenario({
    productName: 'Luma Candles',
    objective: 'drive-sales',
    differentiator: 'Hand-poured soy wax',
    specialOffer: 'Free shipping this weekend',
  }, { director: true });
});

test('minimal brief uses legacy blueprint fallback when director is off', async () => {
  await runScenario({
    productName: 'Luma Candles',
    objective: 'launch-product',
  }, { director: false });
});
