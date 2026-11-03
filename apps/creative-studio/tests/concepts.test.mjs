import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateCampaignContext } from '../dist/campaign.js';
import {
  configureCreativeLibrary,
  isKnownFrameworkId,
  isKnownStyleId,
  resetCreativeLibrary,
} from '../dist/library.js';
import { DeterministicTestProvider, isLiveProviderConfigured } from '../dist/provider.js';
import { generateConcepts } from '../dist/concepts.js';
import { conceptsGenerateOutcome } from '../dist/server.js';

/**
 * Milestone 2A suite. Socket-free, no model calls: the orchestrator is
 * exercised with injected stub providers only, and the endpoint gate is
 * exercised through its pure outcome function. No live inference exists.
 */

const STYLE_IDS = ['test-style-a', 'test-style-b'];
const FRAMEWORK_IDS = ['test-fw-a', 'test-fw-b'];

function validInput(overrides = {}) {
  return {
    description: 'Acme Coffee launches cold-brew cans for commuters to drive launch-week trial.',
    product: 'Cold-brew cans',
    objective: 'Drive launch-week trial',
    facts: ['Cold-brew cans exist'],
    assumptions: [],
    ...overrides,
  };
}

function setupLibrary() {
  resetCreativeLibrary();
  configureCreativeLibrary({
    styles: STYLE_IDS.map((id) => ({ id, name: `Test ${id}` })),
    frameworks: FRAMEWORK_IDS.map((id) => ({ id, name: `Test ${id}` })),
  });
}

function testProvider() {
  return new DeterministicTestProvider({
    styleIds: [STYLE_IDS[0], STYLE_IDS[1]],
    frameworkIds: [FRAMEWORK_IDS[0], FRAMEWORK_IDS[1]],
  });
}

test('valid input generates exactly two distinct concepts', async () => {
  setupLibrary();
  const result = await generateConcepts(validInput(), testProvider(), { allowTestProvider: true });
  assert.equal(result.ok, true);
  assert.equal(result.concepts.length, 2);
  const [a, b] = result.concepts;
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.headline, b.headline);
  for (const c of [a, b]) {
    for (const f of ['id', 'angle', 'headline', 'primaryCopy', 'cta', 'visualDirection', 'photographyPrompt']) {
      assert.ok(c[f].trim().length > 0, f);
    }
    assert.ok(isKnownStyleId(c.styleId));
    assert.ok(isKnownFrameworkId(c.frameworkId));
  }
});

test('optional brand/audience may be omitted; channel is accepted', async () => {
  setupLibrary();
  const minimal = await generateConcepts(validInput(), testProvider(), { allowTestProvider: true });
  assert.equal(minimal.ok, true);
  const withChannel = await generateConcepts(
    validInput({ channel: 'Instagram', audience: 'Commuters 25-40', brand: 'Acme' }),
    testProvider(),
    { allowTestProvider: true },
  );
  assert.equal(withChannel.ok, true);
  assert.ok(withChannel.concepts[0].headline.includes('Instagram'));
});

test('invalid context fails before the provider is called', async () => {
  setupLibrary();
  let called = 0;
  const counting = { name: 'count', generate: async () => { called += 1; return []; } };
  const result = await generateConcepts({ description: 'x' }, counting, { allowTestProvider: true });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_CONTEXT');
  assert.equal(called, 0);
});

test('unknown style/framework ids are rejected', async () => {
  setupLibrary();
  const bad = {
    name: 'bad', generate: async () => [
      { id: 'c1', angle: 'a', headline: 'h1', primaryCopy: 'p', cta: 'c', visualDirection: 'v', photographyPrompt: 'pp', styleId: 'nope', frameworkId: FRAMEWORK_IDS[0] },
      { id: 'c2', angle: 'b', headline: 'h2', primaryCopy: 'q', cta: 'c', visualDirection: 'v', photographyPrompt: 'pp', styleId: STYLE_IDS[1], frameworkId: 'nope' },
    ],
  };
  const result = await generateConcepts(validInput(), bad, { allowTestProvider: true });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_PROVIDER_OUTPUT');
});

test('unconfigured library rejects every id', async () => {
  resetCreativeLibrary();
  const result = await generateConcepts(validInput(), testProvider(), { allowTestProvider: true });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_PROVIDER_OUTPUT');
  assert.equal(isKnownStyleId(STYLE_IDS[0]), false);
});

test('malformed provider output is rejected (count and shape)', async () => {
  setupLibrary();
  const one = { name: 'one', generate: async () => [{ id: 'c1' }] };
  assert.equal((await generateConcepts(validInput(), one, { allowTestProvider: true })).error.code, 'INVALID_PROVIDER_OUTPUT');
  const three = { name: 'three', generate: async () => ['a', 'b', 'c'] };
  assert.equal((await generateConcepts(validInput(), three, { allowTestProvider: true })).error.code, 'INVALID_PROVIDER_OUTPUT');
  const empty = { name: 'empty', generate: async () => [] };
  assert.equal((await generateConcepts(validInput(), empty, { allowTestProvider: true })).error.code, 'INVALID_PROVIDER_OUTPUT');
});

test('duplicate concepts are rejected and the provider is called once', async () => {
  setupLibrary();
  let calls = 0;
  const dupe = {
    name: 'dupe',
    generate: async (ctx) => {
      calls += 1;
      const base = {
        id: 'same', angle: 'Same angle', headline: 'Same headline', primaryCopy: 'Same copy',
        cta: 'Shop', visualDirection: 'Same visual', photographyPrompt: 'Same prompt',
        styleId: STYLE_IDS[0], frameworkId: FRAMEWORK_IDS[0],
      };
      return [{ ...base }, { ...base }];
    },
  };
  const result = await generateConcepts(validInput(), dupe, { allowTestProvider: true });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DUPLICATE_CONCEPTS');
  assert.equal(calls, 1);
});

test('provider errors and timeouts surface clearly with no retry', async () => {
  setupLibrary();
  let boomCalls = 0;
  const boom = { name: 'boom', generate: async () => { boomCalls += 1; throw new Error('downstream broke'); } };
  const failed = await generateConcepts(validInput(), boom, { allowTestProvider: true });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'PROVIDER_ERROR');
  assert.ok(failed.error.message.includes('downstream broke'));
  assert.equal(boomCalls, 1);
  const hanging = { name: 'hanging', generate: () => new Promise(() => {}) };
  const timed = await generateConcepts(validInput(), hanging, { allowTestProvider: true, timeoutMs: 20 });
  assert.equal(timed.ok, false);
  assert.equal(timed.error.code, 'PROVIDER_TIMEOUT');
});

test('test provider is refused unless explicitly allowed', async () => {
  setupLibrary();
  const result = await generateConcepts(validInput(), testProvider());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TEST_PROVIDER_NOT_ALLOWED');
  assert.equal(testProvider().testOnly, true);
});

test('no real inference is configured during tests', () => {
  assert.equal(isLiveProviderConfigured({}), false);
  assert.equal(isLiveProviderConfigured(), false);
});

test('endpoint: valid input without a live provider is explicitly unavailable', () => {
  const outcome = conceptsGenerateOutcome(validInput({ channel: 'Instagram' }));
  assert.equal(outcome.status, 503);
  assert.equal(outcome.payload.ok, false);
  assert.equal(outcome.payload.error.code, 'PROVIDER_UNAVAILABLE');
});

test('endpoint: invalid input fails validation, never reaches a provider', () => {
  const outcome = conceptsGenerateOutcome({ description: 'Sell soap' });
  assert.equal(outcome.status, 422);
  assert.equal(outcome.payload.ok, false);
  assert.ok(outcome.payload.issues.some((i) => i.field === 'product'));
});

test('context validation keeps brand/audience/offer optional but guards limits', () => {
  assert.equal(validateCampaignContext(validInput()).ok, true);
  assert.equal(validateCampaignContext(validInput({ brand: undefined, audience: undefined })).ok, true);
  assert.equal(validateCampaignContext(validInput({ product: 'x'.repeat(121) })).ok, false);
  assert.equal(validateCampaignContext('nope').ok, false);
});
