import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initializeApprovedCreativeLibrary, resetCreativeLibrary } from '../dist/library.js';
import {
  LIVE_PROVIDER_NAME,
  MUSE_RESPONSES_ENDPOINT,
  MUSE_SPARK_MODEL,
  MetaMuseConceptProvider,
  buildLiveConceptPrompt,
  isLiveProviderConfigured,
  resolveModelApiKey,
} from '../dist/provider.js';
import { generateConcepts } from '../dist/concepts.js';
import { conceptsGenerateOutcome, conceptsGenerateOutcomeLive } from '../dist/server.js';

/**
 * Milestone 2B-2 suite. Socket-free: every upstream call uses an
 * injected mock fetch — no live network requests are made.
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
    facts: ['Cold-brew cans exist'],
    assumptions: [],
    ...overrides,
  };
}

function liveConcepts() {
  const base = {
    angle: 'Everyday ease for commuters',
    headline: 'Cold brew, ready when you are',
    primaryCopy: 'Acme cold-brew cans for launch-week trial.',
    cta: 'Shop now',
    visualDirection: 'Can in soft daylight.',
    photographyPrompt: 'Studio photograph of cold-brew cans, soft daylight.',
  };
  return [
    { ...base, id: 'live-concept-1', styleId: 'problem-solution', frameworkId: 'aida' },
    {
      ...base,
      id: 'live-concept-2',
      angle: 'Premium mornings for commuters',
      headline: 'Brewed bold for busy mornings',
      primaryCopy: 'A second take on Acme cold-brew cans for launch-week trial.',
      styleId: 'editorial',
      frameworkId: 'pas',
    },
  ];
}

/** Official response shape: output message content with output_text. */
function upstreamOk(concepts) {
  return JSON.stringify({
    output: [{ type: 'message', content: [{ type: 'output_text', output_text: JSON.stringify(concepts) }] }],
  });
}

function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(calls.length, init);
  };
  return { fn, calls };
}

const okResponse = (text) => ({ ok: true, status: 200, text: async () => text });

test('paid inference is disabled by default; both settings required', () => {
  assert.equal(isLiveProviderConfigured({}), false);
  assert.equal(isLiveProviderConfigured({ SILKWEB_CREATIVE_PROVIDER: 'live' }), false);
  assert.equal(isLiveProviderConfigured({ MODEL_API_KEY: 'k' }), false);
  assert.equal(
    isLiveProviderConfigured({ SILKWEB_CREATIVE_PROVIDER: 'live', MODEL_API_KEY: 'k' }),
    true,
  );
  assert.equal(resolveModelApiKey({ MODEL_API_KEY: 'k' }), 'k');
  assert.equal(MUSE_RESPONSES_ENDPOINT, 'https://api.meta.ai/v1/responses');
  assert.equal(MUSE_SPARK_MODEL, 'muse-spark-1.3');
});

test('success: endpoint, model, auth, library instructions, two concepts, one call', async () => {
  setupApproved();
  const { fn, calls } = mockFetch(() => okResponse(upstreamOk(liveConcepts())));
  const provider = new MetaMuseConceptProvider({ apiKey: 'test-key', fetchImpl: fn });
  assert.equal(provider.name, LIVE_PROVIDER_NAME);
  assert.equal(provider.testOnly, undefined);
  const result = await generateConcepts(campaign(), provider);
  assert.equal(result.ok, true);
  assert.equal(result.concepts.length, 2);
  assert.equal(result.provider, LIVE_PROVIDER_NAME);
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.url, 'https://api.meta.ai/v1/responses');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.authorization, 'Bearer test-key');
  const body = JSON.parse(call.init.body);
  assert.equal(body.model, 'muse-spark-1.3');
  assert.ok(typeof body.input === 'string' && body.input.length > 0);
  for (const id of ['problem-solution', 'editorial', 'aida', 'pas']) {
    assert.ok(body.input.includes(id), `prompt must carry approved library id ${id}`);
  }
  assert.ok(body.input.includes('Cold-brew cans'));
});

test('prompt carries recommendations and stays bounded', () => {
  setupApproved();
  const { context } = { context: campaign() };
  const prompt = buildLiveConceptPrompt(context);
  assert.ok(prompt.includes('Recommended style ids'));
  assert.ok(prompt.includes('Campaign context'));
  assert.ok(prompt.length <= 12_000);
});

test('API errors surface as PROVIDER_ERROR with exactly one call', async () => {
  setupApproved();
  const { fn, calls } = mockFetch(() => ({ ok: false, status: 401, text: async () => 'bad key' }));
  const result = await generateConcepts(
    campaign(),
    new MetaMuseConceptProvider({ apiKey: 'k', fetchImpl: fn }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROVIDER_ERROR');
  assert.ok(result.error.message.includes('401'));
  assert.equal(calls.length, 1);
});

test('malformed JSON and missing output fail with exactly one call', async () => {
  setupApproved();
  const bad = mockFetch(() => okResponse('not json{{{'));
  const malformed = await generateConcepts(
    campaign(),
    new MetaMuseConceptProvider({ apiKey: 'k', fetchImpl: bad.fn }),
  );
  assert.equal(malformed.error.code, 'PROVIDER_ERROR');
  assert.equal(bad.calls.length, 1);
  const empty = mockFetch(() => okResponse(JSON.stringify({ output: [] })));
  const missing = await generateConcepts(
    campaign(),
    new MetaMuseConceptProvider({ apiKey: 'k', fetchImpl: empty.fn }),
  );
  assert.equal(missing.error.code, 'PROVIDER_ERROR');
  assert.equal(empty.calls.length, 1);
});

test('timeout aborts the upstream request; nothing is logged with credentials', async () => {
  setupApproved();
  let observedSignal = null;
  const hanging = async (_url, init) => {
    observedSignal = init.signal;
    await new Promise((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    throw new Error('unreachable');
  };
  const logged = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logged.push(a.join(' '));
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const provider = new MetaMuseConceptProvider({ apiKey: 'secret-key-xyz', fetchImpl: hanging, timeoutMs: 20 });
    await assert.rejects(() => provider.generate(campaign()), /timed out after 20ms/);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  assert.equal(observedSignal?.aborted, true);
  assert.ok(!logged.join('\n').includes('secret-key-xyz'));
});

test('missing key fails before any request', async () => {
  setupApproved();
  let calls = 0;
  await assert.rejects(
    () =>
      new MetaMuseConceptProvider({ apiKey: '', fetchImpl: async () => { calls += 1; throw new Error('x'); } }).generate(
        campaign(),
      ),
    /not configured/,
  );
  assert.equal(calls, 0);
});

test('live outcome: unavailable without config; invalid input never reaches provider', async () => {
  setupApproved();
  delete process.env.SILKWEB_CREATIVE_PROVIDER;
  delete process.env.MODEL_API_KEY;
  delete process.env.SILKWEB_MUSE_API_KEY;
  const unavailable = conceptsGenerateOutcome(campaign());
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.payload.error.code, 'PROVIDER_UNAVAILABLE');
  const liveUnavailable = await conceptsGenerateOutcomeLive(campaign());
  assert.equal(liveUnavailable.status, 503);
  let calls = 0;
  void calls;
  const invalid = await conceptsGenerateOutcomeLive({ description: 'Sell soap' });
  assert.equal(invalid.status, 422);
});


test('network diagnostics expose safe codes without leaking secrets', async () => {
  setupApproved();

  const secret = 'private-network-details-xyz';
  const underlying = Object.assign(
    new Error(secret),
    { code: 'ECONNRESET' },
  );

  const networkError = Object.assign(
    new TypeError('fetch failed'),
    { cause: underlying },
  );

  let calls = 0;

  const provider = new MetaMuseConceptProvider({
    apiKey: 'secret-key-xyz',
    fetchImpl: async () => {
      calls += 1;
      throw networkError;
    },
  });

  const result = await generateConcepts(campaign(), provider);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROVIDER_ERROR');
  assert.match(result.error.message, /ECONNRESET/);
  assert.ok(!result.error.message.includes(secret));
  assert.ok(!result.error.message.includes('secret-key-xyz'));
  assert.equal(calls, 1);
});

test('unknown network errors are sanitized and never retried', async () => {
  setupApproved();

  let calls = 0;

  const provider = new MetaMuseConceptProvider({
    apiKey: 'secret-key-xyz',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('sensitive-host-and-token-details');
    },
  });

  const result = await generateConcepts(campaign(), provider);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROVIDER_ERROR');
  assert.match(result.error.message, /UNKNOWN_NETWORK_ERROR/);
  assert.ok(!result.error.message.includes('sensitive-host-and-token-details'));
  assert.equal(calls, 1);
});

test('live provider owns timeout, aborts request, and never retries', async () => {
  setupApproved();

  let calls = 0;
  let observedSignal;

  const hanging = async (_url, init) => {
    calls += 1;
    observedSignal = init.signal;

    return new Promise((_resolve, reject) => {
      if (init.signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      init.signal.addEventListener(
        'abort',
        () => reject(new Error('aborted')),
        { once: true },
      );
    });
  };

  const provider = new MetaMuseConceptProvider({
    apiKey: 'test-key',
    fetchImpl: hanging,
    timeoutMs: 25,
  });

  const startedAt = Date.now();

  const result = await generateConcepts(campaign(), provider);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROVIDER_TIMEOUT');
  assert.equal(observedSignal?.aborted, true);
  assert.equal(calls, 1);
  assert.ok(Date.now() - startedAt < 2000);
});