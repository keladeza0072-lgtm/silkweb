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
