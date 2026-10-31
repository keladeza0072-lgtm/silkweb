import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhotoCompositionGuidance,
  photoDirectionForAudience,
} from '../dist/imageAdPhotoDirection.js';

import {
  buildMuseImagePrompt,
} from '../dist/museImage.js';

const audiences = ['cold', 'warm', 'hot'];

function input() {
  return {
    productName: 'Luma Candles',
    objective: 'drive-sales',
    upload: null,
    differentiator: '',
    price: '',
    currency: '',
    specialOffer: '',
  };
}

function plan(audience) {
  return {
    id: `ad-${audience}`,
    audience,
    angle: 'Product discovery',
    headline: 'Meet Luma Candles',
    body: 'Explore Luma Candles.',
    cta: 'Learn more',
    visualPrompt: 'Premium candle photographed on a table.',
  };
}

test('m4c defines distinct photographic directions for all audiences', () => {
  const directions = audiences.map(photoDirectionForAudience);

  assert.deepEqual(
    directions.map((direction) => direction.audience),
    audiences,
  );

  assert.equal(
    new Set(directions.map((direction) => direction.protectedAreas)).size,
    3,
  );
});

test('m4c photo directions match existing Sharp panel boundaries', () => {
  assert.match(buildPhotoCompositionGuidance('cold'), /424 pixels/);
  assert.match(buildPhotoCompositionGuidance('warm'), /602 pixels/);
  assert.match(buildPhotoCompositionGuidance('hot'), /560 pixels/);
});

test('m4c image prompts include audience-specific composition guidance', () => {
  for (const audience of audiences) {
    const prompt = buildMuseImagePrompt(plan(audience), input());
    const direction = photoDirectionForAudience(audience);

    assert.ok(prompt.includes(direction.productPlacement));
    assert.ok(prompt.includes(direction.protectedAreas));
    assert.ok(prompt.includes('Preserve the product appearance'));
  }
});

test('m4c prevents model-generated advertising text and logos', () => {
  for (const audience of audiences) {
    const prompt = buildMuseImagePrompt(plan(audience), input());

    assert.match(prompt, /No text, no words/);
    assert.match(prompt, /Do not generate advertising headlines/);
    assert.match(prompt, /invented logos/);
  }
});

test('m4c image prompt respects existing length limit', () => {
  for (const audience of audiences) {
    const prompt = buildMuseImagePrompt(
      {
        ...plan(audience),
        visualPrompt: 'product photography '.repeat(100),
      },
      input(),
    );

    assert.ok(prompt.length <= 4000);
  }
});

test('m4c composition guidance is deterministic', () => {
  for (const audience of audiences) {
    assert.equal(
      buildPhotoCompositionGuidance(audience),
      buildPhotoCompositionGuidance(audience),
    );
  }
});
