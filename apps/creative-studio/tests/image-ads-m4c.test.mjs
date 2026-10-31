import { selectCreativeClasses } from '../dist/imageAdCreativeSelection.js';
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

test('m4c image prompts use class-specific spatial blueprints', () => {
  const completeInput = {
    productName: 'Luma Candles',
    objective: 'drive-sales',
    differentiator: 'Hand-poured soy wax',
    specialOffer: 'Free shipping this weekend',
  };
  const selections = selectCreativeClasses(completeInput).selections;

  for (const selected of selections) {
    const prompt = buildMuseImagePrompt(
      {
        audience: selected.audience,
        visualPrompt: 'Premium candle photographed on a table.',
      },
      completeInput,
    );

    assert.ok(prompt.includes(
      `Creative composition class: ${selected.classId}.`
    ));
    assert.ok(prompt.includes('Reserved product region:'));
    assert.ok(prompt.includes('Reserved headline region:'));
    assert.ok(prompt.includes('Reserved body copy region:'));
    assert.ok(prompt.includes('Keep essential product features within the product region.'));
  }
});

test('m4c prevents model-generated advertising text, logos and buttons', () => {
  const completeInput = {
    productName: 'Luma Candles',
    objective: 'drive-sales',
    differentiator: 'Hand-poured soy wax',
    specialOffer: 'Free shipping this weekend',
  };
  for (const audience of ['cold', 'warm', 'hot']) {
    const prompt = buildMuseImagePrompt(
      {
        audience,
        visualPrompt: 'Premium candle photographed on a table.',
      },
      completeInput,
    );

    assert.match(prompt, /No text, captions, logos, CTA buttons, or invented claims/);
    assert.match(prompt, /Preserve the supplied product identity/);
    assert.doesNotMatch(prompt, /A CTA element will overlap/);
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
