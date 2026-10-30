import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BRIEF_FIELDS,
  CREATIVE_STUDIO_DEFAULT_PORT,
  GENERATION_CONNECTED,
  PHOTOGRAPHY_MODES,
  STYLE_SLOTS,
} from '../dist/config.js';
import { validateBrief } from '../dist/validate.js';
import { configPayload, healthPayload, serveStatic } from '../dist/server.js';

/**
 * Creative Studio Milestone 1 suite. Socket-free: the pure config /
 * validation layer plus the static-allowlist helper are exercised
 * directly. No model calls, no fixtures outside this app.
 */

const VALID_BRIEF = {
  brand: 'Acme Coffee',
  product: 'Cold-brew cans',
  audience: 'Commuters aged 25–40',
  objective: 'Drive launch-week trial',
  offer: '2-for-1 opening weekend',
  creativeDirection: 'Bright mornings, bold type.',
  styleId: 'style-slot-a',
  photographyMode: 'product',
};

test('config exposes six placeholder style slots', () => {
  assert.equal(STYLE_SLOTS.length, 6);
  for (const slot of STYLE_SLOTS) {
    assert.match(slot.id, /^style-slot-[a-f]$/);
    assert.equal(slot.placeholder, true);
    assert.ok(slot.name.toLowerCase().includes('temporary'), 'slot names must read as temporary');
  }
  const ids = new Set(STYLE_SLOTS.map((s) => s.id));
  assert.equal(ids.size, 6);
});

test('config exposes three photography modes', () => {
  assert.deepEqual(
    PHOTOGRAPHY_MODES.map((m) => m.id),
    ['product', 'lifestyle', 'website'],
  );
});

test('brief form covers the six required contract fields', () => {
  assert.deepEqual(
    BRIEF_FIELDS.map((f) => f.id),
    ['brand', 'product', 'audience', 'objective', 'offer', 'creativeDirection'],
  );
});

test('generation is explicitly not connected', () => {
  assert.equal(GENERATION_CONNECTED, false);
  assert.equal(healthPayload().generationConnected, false);
  assert.equal(configPayload().generationConnected, false);
});

test('health payload identifies the service', () => {
  const health = healthPayload();
  assert.equal(health.ok, true);
  assert.equal(health.service, 'creative-studio');
  assert.equal(typeof health.version, 'string');
});

test('valid brief passes validation', () => {
  const result = validateBrief({ ...VALID_BRIEF });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test('missing required fields fail with field-level issues', () => {
  const result = validateBrief({ styleId: 'style-slot-a', photographyMode: 'lifestyle' });
  assert.equal(result.ok, false);
  for (const field of ['brand', 'product', 'audience', 'objective']) {
    assert.ok(result.issues.some((i) => i.field === field), `${field} must be flagged`);
  }
});

test('unknown style and photography mode fail', () => {
  const result = validateBrief({ ...VALID_BRIEF, styleId: 'nope', photographyMode: 'nope' });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.field === 'styleId'));
  assert.ok(result.issues.some((i) => i.field === 'photographyMode'));
});

test('overlong input fails', () => {
  const result = validateBrief({ ...VALID_BRIEF, brand: 'x'.repeat(81) });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.field === 'brand'));
});

test('static server allowlists only the three frontend files', () => {
  assert.equal(serveStatic('/api/health'), null);
  assert.equal(serveStatic('/server.js'), null);
  assert.equal(serveStatic('/../package.json'), null);
});

test('default port does not clash with sibling apps', () => {
  assert.equal(CREATIVE_STUDIO_DEFAULT_PORT, 3003);
});

test('config exposes welcome prompts and elicitation defaults', async () => {
  const config = await import('../dist/config.js');
  assert.equal(config.ELICITATION_DEFAULT_MAX_QUESTIONS, 3);
  assert.ok(Array.isArray(config.EXAMPLE_PROMPTS) && config.EXAMPLE_PROMPTS.length >= 3);
  for (const prompt of config.EXAMPLE_PROMPTS) {
    assert.ok(typeof prompt === 'string' && prompt.trim().length > 20);
  }
  const payload = configPayload();
  assert.deepEqual(payload.elicitation.questionOrder, ['product', 'audience', 'objective', 'brand', 'offer']);
  assert.equal(payload.elicitation.maxQuestions, 3);
  assert.ok(Array.isArray(payload.examplePrompts) && payload.examplePrompts.length >= 3);
  assert.ok(Array.isArray(payload.policyChecks) && payload.policyChecks.length >= 3);
});

test('extraction finds explicitly stated facts only', async () => {
  const { extractFromDescription } = await import('../dist/elicit.js');
  const rich = extractFromDescription(
    'Acme Coffee is launching cold-brew cans for commuters aged 25–40 to drive launch-week trial with 2-for-1 opening weekend.',
  );
  assert.equal(rich.values.brand, 'Acme Coffee');
  assert.equal(rich.values.product, 'cold-brew cans');
  assert.ok(rich.values.audience.includes('commuters'));
  assert.ok(rich.values.objective.toLowerCase().includes('launch-week trial'));
  assert.ok(rich.values.offer.includes('2-for-1'));
  assert.equal(rich.sources.brand, 'supplied');
});

test('vague input yields missing fields, never invented facts', async () => {
  const { extractFromDescription } = await import('../dist/elicit.js');
  const vague = extractFromDescription('something cool for everyone');
  assert.equal(vague.values.brand ?? '', '');
  assert.equal(vague.values.product ?? '', '');
  assert.equal(vague.values.objective ?? '', '');
  assert.equal(vague.values.offer ?? '', '');
  assert.equal(vague.sources.brand, 'missing');
});

test('elicitation asks at most three questions and never repeats settled ones', async () => {
  const { analyzeBrief } = await import('../dist/elicit.js');
  const first = analyzeBrief({ description: 'I want ads for my bakery' });
  assert.ok(first.questions.length <= 3 && first.questions.length > 0);
  assert.deepEqual(first.questions.map((q) => q.field), ['product', 'audience', 'objective']);
  for (const q of first.questions) {
    assert.ok(Array.isArray(q.suggestions) && q.suggestions.length > 0);
    assert.equal(q.skippable, true);
  }
  const second = analyzeBrief({
    description: 'I want ads for my bakery',
    answers: { product: null, audience: 'Neighbors near the shop' },
  });
  assert.ok(!second.questions.some((q) => q.field === 'product'));
  assert.ok(!second.questions.some((q) => q.field === 'audience'));
  assert.equal(second.values.audience, 'Neighbors near the shop');
  assert.deepEqual(second.questions.map((q) => q.field), ['objective', 'brand', 'offer']);
});

test('rich descriptions skip straight to review with assumptions marked', async () => {
  const { analyzeBrief } = await import('../dist/elicit.js');
  const plan = analyzeBrief({
    description: 'Acme Coffee is launching cold-brew cans for commuters aged 25–40 to drive launch-week trial with 2-for-1 opening weekend.',
  });
  assert.deepEqual(plan.questions, []);
  assert.ok(plan.assumptions.some((a) => a.field === 'styleId'));
  assert.ok(plan.assumptions.some((a) => a.field === 'photographyMode'));
  assert.equal(plan.readiness.length, 7);
});

test('photography recommendation follows explicit cues, defaults otherwise', async () => {
  const { recommendPhotographyMode } = await import('../dist/elicit.js');
  const explicit = recommendPhotographyMode('a hero banner for our landing page', {});
  assert.equal(explicit.mode, 'website');
  assert.equal(explicit.explicit, true);
  const fallback = recommendPhotographyMode('Selling soap', {});
  assert.equal(fallback.mode, 'product');
  assert.equal(fallback.explicit, false);
});

test('analyze input validation guards the endpoint contract', async () => {
  const { validateAnalyzeInput } = await import('../dist/elicit.js');
  assert.equal(validateAnalyzeInput({}).ok, false);
  assert.equal(validateAnalyzeInput({ description: '   ' }).ok, false);
  assert.equal(validateAnalyzeInput({ description: 'x'.repeat(2001) }).ok, false);
  assert.equal(validateAnalyzeInput({ description: 'Sell soap', answers: { nope: 'x' } }).ok, false);
  assert.equal(validateAnalyzeInput({ description: 'Sell soap', maxQuestions: 9 }).ok, false);
  assert.equal(
    validateAnalyzeInput({ description: 'Sell soap', answers: { offer: null }, maxQuestions: 2 }).ok,
    true,
  );
});
