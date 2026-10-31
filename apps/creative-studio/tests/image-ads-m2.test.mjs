import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createFrame,
  encodePng,
  validateImageAdInput,
} from '../dist/imageAds.js';
import {
  buildImageAdPlanPrompt,
  MetaMuseImageAdPlanner,
  validateImageAdPlans,
} from '../dist/imageAdsPlan.js';
import { checkImageAdPolicy } from '../dist/imageAdsPolicy.js';
import {
  buildMuseImagePrompt,
  finishAdPng,
  MetaMuseImageProvider,
} from '../dist/museImage.js';
import { imageAdsGenerateLiveOutcome } from '../dist/imageAdsLive.js';
import { configPayload } from '../dist/server.js';

/**
 * Image Ads Milestone 2 suite. Socket-free, no paid inference: every
 * upstream call uses an injected mock fetch. Covers extended input
 * validation, Muse Spark planning, policy checks, Muse Image
 * finishing, and the live orchestration pipeline.
 */

function baseInput(overrides = {}) {
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

function goodPlans() {
  return [
    { id: 'ad-1', audience: 'cold', angle: 'First look for newcomers', headline: 'Meet Luma Candles', body: 'A calm first look at Luma Candles.', cta: 'Learn more', visualPrompt: 'Candle on stone in morning light, open composition.' },
    { id: 'ad-2', audience: 'warm', angle: 'Considered evenings', headline: 'Evenings with Luma Candles', body: 'See how Luma Candles fits a quiet evening routine.', cta: 'Discover more', visualPrompt: 'Candle beside a book at dusk, warm interior.' },
    { id: 'ad-3', audience: 'hot', angle: 'Decide tonight', headline: 'Your Luma Candles tonight', body: 'Luma Candles is ready when you are — order today.', cta: 'Shop now', visualPrompt: 'Candle glowing on a table, decisive close framing.' },
  ];
}

function bigPng(color = [20, 40, 60]) {
  return encodePng(createFrame(1080, 1350, color));
}

function mockPlanFetch(plans, seen = []) {
  return async (url, init) => {
    seen.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', output_text: JSON.stringify(plans) }] }] }),
    };
  };
}

function imagePayload(png) {
  return JSON.stringify({ data: [{ b64_json: png.toString('base64') }] });
}

test('m2 input accepts optional details and rejects bad ones', () => {
  const ok = validateImageAdInput({ productName: 'Luma', objective: 'drive-sales', differentiator: 'Small-batch pour', price: '49.99', currency: 'USD', specialOffer: 'Free shipping this weekend' });
  assert.equal(ok.ok, true);
  assert.equal(ok.input.differentiator, 'Small-batch pour');
  assert.equal(ok.input.price, '49.99');

  const legacy = validateImageAdInput({ productName: 'Luma', objective: 'drive-sales' });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.input.differentiator, '');

  assert.equal(validateImageAdInput({ productName: 'Luma', objective: 'drive-sales', differentiator: 'x'.repeat(201) }).ok, false);
  assert.equal(validateImageAdInput({ productName: 'Luma', objective: 'drive-sales', price: 'free!!' }).ok, false);
  assert.equal(validateImageAdInput({ productName: 'Luma', objective: 'drive-sales', currency: 'dollar$$$x!' }).ok, false);
});

test('m2 plan prompt carries audiences, objective, and supplied facts', () => {
  const prompt = buildImageAdPlanPrompt(baseInput({ differentiator: 'Small-batch pour', price: '49', currency: 'USD' }));
  assert.ok(prompt.includes('"cold"') && prompt.includes('"warm"') && prompt.includes('"hot"'));
  assert.ok(prompt.includes('Drive Sales'));
  assert.ok(prompt.includes('Small-batch pour') && prompt.includes('49'));
  assert.ok(prompt.includes('do not store'));
  assert.ok(prompt.length <= 8000);
});

test('m2 plan validation accepts cold/warm/hot and rejects lookalikes', () => {
  assert.equal(validateImageAdPlans(goodPlans()).ok, true);
  assert.equal(validateImageAdPlans(goodPlans().slice(0, 2)).ok, false);
  const dupAudience = goodPlans().map((p) => ({ ...p }));
  dupAudience[2] = { ...dupAudience[2], audience: 'cold' };
  assert.equal(validateImageAdPlans(dupAudience).ok, false);
  const dupCopy = goodPlans().map((p) => ({ ...p }));
  dupCopy[1] = { ...dupCopy[1], headline: dupCopy[0].headline, body: dupCopy[0].body };
  assert.equal(validateImageAdPlans(dupCopy).ok, false);
  const missing = goodPlans().map((p) => ({ ...p }));
  delete missing[0].cta;
  assert.equal(validateImageAdPlans(missing).ok, false);
});

test('m2 planner posts once to the Meta endpoint with auth and model', async () => {
  const seen = [];
  const planner = new MetaMuseImageAdPlanner({ apiKey: 'k', fetchImpl: mockPlanFetch(goodPlans(), seen) });
  const raw = await planner.plan(baseInput());
  assert.equal(raw.length, 3);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.meta.ai/v1/responses');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.authorization, 'Bearer k');
  assert.equal(JSON.parse(seen[0].init.body).model, 'muse-spark-1.3');
});

test('m2 image finishing accepts valid provider sizes and fits to 1080x1350', () => {
  const good = finishAdPng(bigPng());
  assert.equal(good.ok, true);
  assert.equal(good.fitted, false);
  assert.ok(good.pngDataUrl.startsWith('data:image/png;base64,'));
  assert.equal(good.width, 1080);
  assert.equal(good.height, 1350);
  // Valid provider output at its own resolution is contain-fitted, never rejected.
  const small = finishAdPng(encodePng(createFrame(8, 6, [1, 2, 3])), 'ads[0].png');
  assert.equal(small.ok, true);
  assert.equal(small.fitted, true);
  assert.equal(small.width, 1080);
  assert.equal(small.height, 1350);
  assert.ok(small.pngDataUrl.startsWith('data:image/png;base64,'));
  // Malformed or unsupported data is rejected.
  assert.equal(finishAdPng(Buffer.from('not a png'), 'ads[0].png').ok, false);
  assert.equal(finishAdPng(Buffer.alloc(0), 'ads[0].png').ok, false);
});

test('m2 image provider routes generations vs edits and returns PNG bytes', async () => {
  const png = bigPng([90, 10, 40]);
  const seen = [];
  const provider = new MetaMuseImageProvider({
    apiKey: 'k',
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 200, text: async () => imagePayload(png) };
    },
  });
  const plan = goodPlans()[0];
  // With a product photo: POST /v1/images/edits with a documented images entry.
  const input = baseInput({ upload: { format: 'png', bytes: Buffer.alloc(10) } });
  const prompt = buildMuseImagePrompt(plan, input);
  assert.ok(prompt.includes('No text'));
  const out = await provider.generate(plan, input);
  assert.equal(out.referenceGuided, true);
  assert.deepEqual(out.png, png);
  const editBody = JSON.parse(seen[0].init.body);
  assert.equal(seen[0].url, 'https://api.meta.ai/v1/images/edits');
  assert.ok(Array.isArray(editBody.images) && editBody.images.length === 1);
  assert.ok(typeof editBody.images[0].image_url === 'string');
  assert.ok(editBody.images[0].image_url.startsWith('data:image/png;base64,'));
  assert.ok(!('reference_image' in editBody) && !('reference_format' in editBody));
  assert.equal(editBody.output_format, 'png');
  // Without a product photo: POST /v1/images/generations, no images field.
  seen.length = 0;
  const plain = await provider.generate(plan, baseInput());
  assert.equal(plain.referenceGuided, false);
  assert.deepEqual(plain.png, png);
  const genBody = JSON.parse(seen[0].init.body);
  assert.equal(seen[0].url, 'https://api.meta.ai/v1/images/generations');
  assert.ok(!('images' in genBody));
  assert.ok(!('reference_image' in genBody));
});

test('m2 reference data URLs support PNG, JPEG, and WebP', async () => {
  const seen = [];
  const provider = new MetaMuseImageProvider({
    apiKey: 'k',
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 200, text: async () => imagePayload(bigPng()) };
    },
  });
  const plan = goodPlans()[0];
  const cases = [
    [{ format: 'png', bytes: Buffer.alloc(10) }, 'data:image/png;base64,'],
    [{ format: 'jpeg', bytes: Buffer.alloc(10) }, 'data:image/jpeg;base64,'],
    [{ format: 'webp', bytes: Buffer.alloc(10) }, 'data:image/webp;base64,'],
  ];
  for (const [upload, prefix] of cases) {
    seen.length = 0;
    const result = await provider.generate(plan, baseInput({ upload }));
    assert.equal(result.referenceGuided, true);
    assert.equal(seen[0].url, 'https://api.meta.ai/v1/images/edits');
    const body = JSON.parse(seen[0].init.body);
    assert.ok(body.images[0].image_url.startsWith(prefix));
  }
});

test('m2 policy flags invented claims but allows supplied offers', () => {
  const input = baseInput();
  const bad = [{ ...goodPlans()[0], body: 'Get 50% off today, limited time — guaranteed number one results, loved by celebrities!' }];
  const findings = checkImageAdPolicy(bad, input);
  assert.ok(findings.length >= 3);

  const priced = [{ ...goodPlans()[0], body: 'Luma Candles for $49.' }];
  assert.ok(checkImageAdPolicy(priced, input).some((f) => f.message.includes('price')));
  assert.equal(checkImageAdPolicy(priced, baseInput({ price: '49', currency: 'USD' })).length, 0);

  const branded = [{ ...goodPlans()[0], headline: 'SilkWeb presents Luma' }];
  assert.ok(checkImageAdPolicy(branded, input).some((f) => f.message.includes('SilkWeb')));

  const offered = [{ ...goodPlans()[0], body: 'Free shipping this weekend on Luma Candles.' }];
  assert.equal(checkImageAdPolicy(offered, baseInput({ specialOffer: 'Free shipping this weekend' })).length, 0);
});

test('m2 live outcome runs the full mocked pipeline with meta engine label', async () => {
  const pngs = [bigPng([10, 20, 30]), bigPng([40, 50, 60]), bigPng([70, 80, 90])];
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
  const outcome = await imageAdsGenerateLiveOutcome({ productName: 'Luma Candles', objective: 'launch-product' }, deps);
  assert.equal(outcome.status, 200);
  assert.equal(outcome.payload.ok, true);
  assert.equal(outcome.payload.ads.length, 3);
  assert.deepEqual(outcome.payload.ads.map((a) => a.audience).sort(), ['cold', 'hot', 'warm']);
  assert.equal(new Set(outcome.payload.ads.map((a) => a.headline)).size, 3);
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(Buffer.from(outcome.payload.ads[i].pngDataUrl.split(',')[1], 'base64'), pngs[i]);
    assert.ok(!JSON.stringify(outcome.payload.ads[i]).toLowerCase().includes('silkweb'));
  }
  assert.equal(outcome.payload.engine.kind, 'meta');
  assert.equal(imageCalls, 3);
});

test('m2 live outcome maps policy, input, and gating failures', async () => {
  const png = bigPng();
  const mockImages = () => ({ name: 'm', testOnly: true, generate: async () => ({ png, referenceGuided: false }) });
  const badPlans = [{ ...goodPlans()[0], body: '50% off, guaranteed!' }, goodPlans()[1], goodPlans()[2]];
  const policyOutcome = await imageAdsGenerateLiveOutcome(
    { productName: 'Luma', objective: 'drive-sales' },
    { allowTestProviders: true, planner: { name: 'm', testOnly: true, plan: async () => badPlans }, images: mockImages() },
  );
  assert.equal(policyOutcome.status, 422);

  const invalid = await imageAdsGenerateLiveOutcome(
    {},
    { allowTestProviders: true, planner: { name: 'm', testOnly: true, plan: async () => goodPlans() }, images: mockImages() },
  );
  assert.equal(invalid.status, 422);

  const gated = await imageAdsGenerateLiveOutcome(
    { productName: 'Luma', objective: 'drive-sales' },
    { planner: { name: 'meta-muse-spark-1.3', plan: async () => goodPlans() }, images: { name: 'meta-muse-image-1.0', generate: async () => ({ png, referenceGuided: false }) }, env: {} },
  );
  assert.equal(gated.status, 503);
  assert.equal(gated.payload.error.code, 'PROVIDER_UNAVAILABLE');
});

test('m2 live outcome returns truthful partial results without retries', async () => {
  const pngs = [bigPng([10, 20, 30]), bigPng([70, 80, 90])];
  let calls = 0;
  const deps = {
    allowTestProviders: true,
    planner: { name: 'mock-planner', testOnly: true, plan: async () => goodPlans() },
    images: {
      name: 'mock-imagery',
      testOnly: true,
      generate: async (plan) => {
        calls += 1;
        if (plan.audience === 'warm') throw new Error('Muse Image API error: HTTP 500 overloaded');
        return { png: plan.audience === 'cold' ? pngs[0] : pngs[1], referenceGuided: false };
      },
    },
  };
  const outcome = await imageAdsGenerateLiveOutcome({ productName: 'Luma Candles', objective: 'drive-sales' }, deps);
  assert.equal(outcome.status, 206);
  assert.equal(outcome.payload.ok, true);
  assert.equal(outcome.payload.partial, true);
  assert.equal(outcome.payload.ads.length, 2);
  assert.equal(outcome.payload.failures.length, 1);
  assert.equal(outcome.payload.failures[0].audience, 'warm');
  assert.ok(outcome.payload.warning.length > 0);
  assert.equal(calls, 3);
  for (const ad of outcome.payload.ads) {
    assert.ok(ad.pngDataUrl.startsWith('data:image/png;base64,'));
  }
});

test('m2 live outcome reports total image failure without discarding the error', async () => {
  const deps = {
    allowTestProviders: true,
    planner: { name: 'mock-planner', testOnly: true, plan: async () => goodPlans() },
    images: { name: 'm', testOnly: true, generate: async () => { throw new Error('boom'); } },
  };
  const outcome = await imageAdsGenerateLiveOutcome({ productName: 'Luma', objective: 'drive-sales' }, deps);
  assert.equal(outcome.status, 502);
  assert.equal(outcome.payload.ok, false);
  assert.equal(outcome.payload.error.code, 'IMAGE_ERROR');
});

test('m2 live inference is disabled by default with real providers', async () => {
  let fetched = 0;
  const fetchImpl = async () => { fetched += 1; return { ok: true, status: 200, text: async () => '{}' }; };
  const { MetaMuseImageAdPlanner } = await import('../dist/imageAdsPlan.js');
  const { MetaMuseImageProvider } = await import('../dist/museImage.js');
  const outcome = await imageAdsGenerateLiveOutcome(
    { productName: 'Luma', objective: 'drive-sales' },
    {
      planner: new MetaMuseImageAdPlanner({ fetchImpl }),
      images: new MetaMuseImageProvider({ fetchImpl }),
      env: {},
    },
  );
  assert.equal(outcome.status, 503);
  assert.equal(outcome.payload.error.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(fetched, 0);
});

test('m2 config exposes fixed quantity of three', () => {
  assert.equal(configPayload().imageAds.adCount, 3);
});
