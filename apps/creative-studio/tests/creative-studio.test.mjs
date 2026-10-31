import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BRIEF_FIELDS,
  CREATIVE_STUDIO_DEFAULT_PORT,
  FRAMEWORK_SLOTS,
  GENERATION_CONNECTED,
  PHOTOGRAPHY_MODES,
  STYLE_SLOTS,
} from '../dist/config.js';
import { validateBrief } from '../dist/validate.js';
import { configPayload, healthPayload, serveStatic } from '../dist/server.js';

/**
 * Creative Studio shell suite. Socket-free: the pure config /
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
  styleId: 'problem-solution',
  photographyMode: 'product',
};

test('config exposes the six approved advertising styles', () => {
  assert.equal(STYLE_SLOTS.length, 6);
  assert.deepEqual(
    STYLE_SLOTS.map((s) => s.id),
    ['problem-solution', 'notification-offer', 'chat-script', 'whiteboard', 'before-after', 'editorial'],
  );
  for (const slot of STYLE_SLOTS) {
    assert.equal(slot.placeholder, false, `${slot.id} must not be a placeholder slot`);
    assert.ok(slot.name.trim().length > 0);
    assert.ok(slot.tagline.trim().length > 0);
    assert.ok(!slot.name.toLowerCase().includes('temporary'), 'approved names must not read as temporary');
  }
});

test('config exposes the four approved copywriting frameworks', () => {
  assert.equal(FRAMEWORK_SLOTS.length, 4);
  assert.deepEqual(
    FRAMEWORK_SLOTS.map((f) => f.id),
    ['aida', 'pas', 'bab', 'fab'],
  );
  for (const fw of FRAMEWORK_SLOTS) {
    assert.ok(fw.name.trim().length > 0);
    assert.ok(fw.tagline.trim().length > 0);
  }
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
  const result = validateBrief({ styleId: 'problem-solution', photographyMode: 'lifestyle' });
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

test('legacy placeholder style slots are rejected', () => {
  const result = validateBrief({ ...VALID_BRIEF, styleId: 'style-slot-a' });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.field === 'styleId'));
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
  assert.equal(payload.styles.length, 6);
  assert.ok(payload.styles.every((s) => s.placeholder === false));
  assert.ok(!JSON.stringify(payload.styles).includes('style-slot'), 'no placeholder slots in the visible config');
  assert.equal(payload.frameworks.length, 4);
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
  assert.deepEqual(first.questions.map((q) => q.field), ['product', 'objective', 'audience']);
  for (const q of first.questions) {
    assert.ok(Array.isArray(q.suggestions));
    assert.equal(q.skippable, true);
    for (const s of q.suggestions) {
      assert.ok(!/coffee|fitness|ceramic mug|farmers market/i.test(s), `suggestion must be grounded: ${s}`);
    }
  }
  const second = analyzeBrief({
    description: 'I want ads for my bakery',
    answers: { product: null, audience: 'Neighbors near the shop' },
  });
  assert.ok(!second.questions.some((q) => q.field === 'product'));
  assert.ok(!second.questions.some((q) => q.field === 'audience'));
  assert.equal(second.values.audience, 'Neighbors near the shop');
  assert.deepEqual(second.questions.map((q) => q.field), ['objective']);
});

test('question budget holds across the whole interaction', async () => {
  const { analyzeBrief } = await import('../dist/elicit.js');
  const turn2 = analyzeBrief({
    description: 'Help me advertise my business.',
    answers: { product: 'Handmade soap' },
  });
  assert.ok(turn2.questions.length <= 2, 'one settled answer leaves at most two questions');
  const turn3 = analyzeBrief({
    description: 'Help me advertise my business.',
    answers: { product: 'Handmade soap', objective: 'Attract new customers' },
  });
  assert.ok(turn3.questions.length <= 1, 'two settled answers leave at most one question');
  const turn4 = analyzeBrief({
    description: 'Help me advertise my business.',
    answers: { product: 'Handmade soap', objective: 'Attract new customers', audience: 'Neighbors' },
  });
  assert.deepEqual(turn4.questions, []);
});

test('suggestions reuse campaign context or are omitted', async () => {
  const { analyzeBrief, suggestionsFor } = await import('../dist/elicit.js');
  assert.deepEqual(suggestionsFor('product', {}, 'Help me advertise my business.'), []);
  assert.deepEqual(suggestionsFor('objective', {}, 'Help me advertise my business.'), []);
  const plan = analyzeBrief({
    description: 'Help me advertise my business.',
    answers: { product: 'Handmade soap' },
  });
  for (const q of plan.questions) {
    for (const s of q.suggestions) {
      assert.ok(s.includes('Handmade soap'), `suggestion must reuse campaign wording: ${s}`);
    }
  }
  const objective = plan.questions.find((q) => q.field === 'objective');
  assert.ok(objective && objective.suggestions.length > 0);
});

test('scenario A: skincare brief is recognized with no repeat questions', async () => {
  const { analyzeBrief, extractFromDescription } = await import('../dist/elicit.js');
  const description =
    'I sell premium handmade skincare products and want to create Instagram ads that attract new customers. ' +
    'I want the campaign to feel luxurious, natural, and trustworthy.';
  const ext = extractFromDescription(description);
  assert.equal(ext.values.product, 'premium handmade skincare products');
  assert.ok(ext.values.objective.toLowerCase().includes('attract new customers'));
  assert.ok(ext.values.audience.toLowerCase().includes('customer'));
  assert.ok(ext.values.creativeDirection.toLowerCase().includes('luxurious'));
  const plan = analyzeBrief({ description });
  assert.ok(!plan.questions.some((q) => q.field === 'product'), 'must not re-ask the product');
  assert.ok(!plan.questions.some((q) => q.field === 'objective'), 'must not re-ask the objective');
  assert.deepEqual(plan.questions, []);
  for (const q of plan.questions) {
    for (const s of q.suggestions) {
      assert.ok(!/coffee|fitness|ceramic mug/i.test(s));
    }
  }
  const followUp = analyzeBrief({
    description,
    answers: { product: 'The entire skincare collection.' },
  });
  assert.equal(followUp.values.product, 'The entire skincare collection.');
  assert.ok(!followUp.questions.some((q) => q.field === 'product'));
});

test('scenario B: fully specified launch needs no follow-up', async () => {
  const { analyzeBrief, extractFromDescription } = await import('../dist/elicit.js');
  const description =
    'Acme Coffee is launching cold-brew cans for commuters aged 25-40 to drive launch-week trials.';
  const ext = extractFromDescription(description);
  assert.equal(ext.values.brand, 'Acme Coffee');
  assert.equal(ext.values.product, 'cold-brew cans');
  assert.ok(ext.values.audience.includes('commuters aged 25-40'));
  assert.ok(ext.values.objective.toLowerCase().includes('launch-week trial'));
  const plan = analyzeBrief({ description });
  assert.deepEqual(plan.questions, []);
});

test('scenario C: vague brief asks blocking questions, at most three', async () => {
  const { analyzeBrief, extractFromDescription } = await import('../dist/elicit.js');
  const description = 'Help me advertise my business.';
  const ext = extractFromDescription(description);
  assert.equal(ext.values.product ?? '', '', 'generic "business" is not a product fact');
  assert.equal(ext.values.objective ?? '', '');
  const plan = analyzeBrief({ description });
  assert.ok(plan.questions.length > 0 && plan.questions.length <= 3);
  assert.equal(plan.questions[0].field, 'product');
  assert.deepEqual(plan.questions.map((q) => q.field), ['product', 'objective', 'audience']);
  assert.ok(!plan.questions.some((q) => q.field === 'brand'));
  assert.ok(!plan.questions.some((q) => q.field === 'offer'));
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
