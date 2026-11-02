import { selectCreativeClasses } from '../dist/imageAdCreativeSelection.js';
import { selectCreativeDirectorReferences } from '../dist/creativeDirector.js';
import { blueprintForClass } from '../dist/imageAdBlueprint.js';
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

function completeInput() {
  return {
    productName: 'Luma Candles',
    objective: 'drive-sales',
    differentiator: 'Hand-poured soy wax',
    specialOffer: 'Free shipping this weekend',
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

function withDirector(value, fn) {
  const previous = process.env.SILKWEB_CREATIVE_DIRECTOR;
  if (value === undefined) delete process.env.SILKWEB_CREATIVE_DIRECTOR;
  else process.env.SILKWEB_CREATIVE_DIRECTOR = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.SILKWEB_CREATIVE_DIRECTOR;
    else process.env.SILKWEB_CREATIVE_DIRECTOR = previous;
  }
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

test('m4c image prompts use actual selected creative-director references', () => {
  const brief = completeInput();
  const selections = selectCreativeDirectorReferences(brief).selections;

  assert.equal(selections.length, 3, 'one director reference per audience');
  assert.equal(
    new Set(selections.map((s) => s.referenceId)).size,
    3,
    'director references are differentiated',
  );
  assert.equal(
    new Set(selections.map((s) => s.family)).size,
    3,
    'director families are differentiated',
  );

  withDirector('on', () => {
    for (const selected of selections) {
      const prompt = buildMuseImagePrompt(
        {
          audience: selected.audience,
          visualPrompt: 'Premium candle photographed on a table.',
        },
        brief,
      );

      assert.ok(prompt.includes(selected.family), `${selected.audience}: selected family in prompt`);
      assert.ok(prompt.includes(selected.scene), `${selected.audience}: selected scene in prompt`);
      assert.ok(prompt.includes(selected.camera), `${selected.audience}: selected camera in prompt`);
      assert.ok(prompt.includes(selected.typography), `${selected.audience}: selected typography in prompt`);
      assert.ok(prompt.includes('Premium candle photographed on a table.'), `${selected.audience}: visual prompt preserved`);
    }
  });
});

test('m4c legacy blueprint guidance matches selected class when director is off', () => {
  const brief = completeInput();
  const selections = selectCreativeClasses(brief).selections;

  withDirector(undefined, () => {
    for (const selected of selections) {
      const blueprint = blueprintForClass(selected.classId);
      assert.ok(blueprint, `${selected.classId}: blueprint available for fallback guidance`);

      const prompt = buildMuseImagePrompt(
        {
          audience: selected.audience,
          visualPrompt: 'Premium candle photographed on a table.',
        },
        brief,
      );

      assert.ok(prompt.includes(`Creative composition class: ${selected.classId}.`), `${selected.audience}: selected class in prompt`);
      assert.ok(prompt.includes('Reserved product region:'), `${selected.audience}: product region reserved`);
      assert.ok(prompt.includes('Reserved headline region:'), `${selected.audience}: headline region reserved`);
      assert.ok(prompt.includes('Reserved body copy region:'), `${selected.audience}: body region reserved`);
      assert.ok(prompt.includes('Keep essential product features within the product region.'), `${selected.audience}: product kept in region`);
    }
  });
});

test('m4c prevents model-generated advertising text, logos and buttons', () => {
  const brief = completeInput();

  withDirector('on', () => {
    for (const audience of audiences) {
      const prompt = buildMuseImagePrompt(
        {
          audience,
          visualPrompt: 'Premium candle photographed on a table.',
        },
        brief,
      );

      assert.match(prompt, /NO rendered headline, paragraph, CTA, fake button/, `${audience}: model-drawn copy/CTA excluded`);
      assert.match(prompt, /Preserve product markings and geometry/, `${audience}: product identity/geometry preserved`);
      assert.match(prompt, /Never invent specifications, ports, logos, prices, discounts or outcomes/, `${audience}: no invented claims/logos`);
      assert.doesNotMatch(prompt, /A CTA element will overlap/, `${audience}: no legacy CTA overlay wording`);
    }
  });
});

test('m4c image prompt respects existing length limit', () => {
  withDirector(undefined, () => {
    for (const audience of audiences) {
      const prompt = buildMuseImagePrompt(
        {
          ...plan(audience),
          visualPrompt: 'product photography '.repeat(100),
        },
        input(),
      );

      assert.ok(prompt.length <= 4000, `${audience}: prompt within 4000 chars`);
    }
  });
});

test('m4c composition guidance is deterministic', () => {
  for (const audience of audiences) {
    assert.equal(
      buildPhotoCompositionGuidance(audience),
      buildPhotoCompositionGuidance(audience),
    );
  }
});
