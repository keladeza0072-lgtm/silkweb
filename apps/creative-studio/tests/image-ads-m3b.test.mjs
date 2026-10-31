import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { finishLiveAdPngSharp } from '../dist/imageAdFinishSharp.js';

const W = 1080;
const H = 1350;

async function sourcePng() {
  return sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 105, g: 135, b: 160, alpha: 1 },
    },
  }).png().toBuffer();
}

function copy(overrides = {}) {
  return {
    headline: 'Meet Luma Candles',
    body: 'A calm first look at Luma Candles.',
    cta: 'Learn more',
    ...overrides,
  };
}

function outputBytes(result) {
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.ok(result.pngDataUrl.startsWith('data:image/png;base64,'));
  return Buffer.from(result.pngDataUrl.split(',')[1], 'base64');
}

test('m3b Sharp produces three valid 1080x1350 PNG layouts', async () => {
  const input = await sourcePng();
  const layouts = [
    ['cold', 'discovery'],
    ['warm', 'consideration'],
    ['hot', 'action'],
  ];

  for (const [audience, expectedLayout] of layouts) {
    const result = await finishLiveAdPngSharp(input, copy(), audience);
    const bytes = outputBytes(result);
    const metadata = await sharp(bytes).metadata();

    assert.equal(result.layout, expectedLayout);
    assert.equal(result.width, W);
    assert.equal(result.height, H);
    assert.equal(metadata.width, W);
    assert.equal(metadata.height, H);
    assert.equal(metadata.format, 'png');
    assert.equal(bytes.equals(input), false);
  }
});

test('m3b preserves a visible photography region in each layout', async () => {
  const input = await sourcePng();

  for (const audience of ['cold', 'warm', 'hot']) {
    const result = await finishLiveAdPngSharp(input, copy(), audience);
    const bytes = outputBytes(result);

    const { data, info } = await sharp(bytes)
      .extract({ left: 525, top: 570, width: 10, height: 10 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    assert.equal(info.channels, 3);
    assert.equal(data[0], 105);
    assert.equal(data[1], 135);
    assert.equal(data[2], 160);
  }
});

test('m3b output changes when headline, body, or CTA changes', async () => {
  const input = await sourcePng();
  const baseline = outputBytes(await finishLiveAdPngSharp(input, copy(), 'cold'));

  for (const changed of [
    { headline: 'A Different Headline' },
    { body: 'A completely different product benefit.' },
    { cta: 'Shop now' },
  ]) {
    const bytes = outputBytes(
      await finishLiveAdPngSharp(input, copy(changed), 'cold'),
    );
    assert.equal(bytes.equals(baseline), false);
  }
});

test('m3b handles long copy and XML characters without crashing', async () => {
  const input = await sourcePng();

  const result = await finishLiveAdPngSharp(
    input,
    copy({
      headline: 'A very long headline for a beautiful candle collection & more special moments',
      body: 'A thoughtful product for quiet evenings <indoors> and relaxing mornings. '.repeat(5),
      cta: 'Discover more & explore',
    }),
    'warm',
  );

  const metadata = await sharp(outputBytes(result)).metadata();
  assert.equal(metadata.width, W);
  assert.equal(metadata.height, H);
});

test('m3b refuses empty and invalid PNG inputs', async () => {
  for (const input of [Buffer.alloc(0), Buffer.from('not a PNG')]) {
    const result = await finishLiveAdPngSharp(input, copy(), 'cold');
    assert.equal(result.ok, false);
    assert.ok(result.issues.length > 0);
  }
});

test('m3b returns deterministic output for identical inputs', async () => {
  const input = await sourcePng();
  const first = outputBytes(await finishLiveAdPngSharp(input, copy(), 'hot'));
  const second = outputBytes(await finishLiveAdPngSharp(input, copy(), 'hot'));

  assert.equal(first.equals(second), true);
});
