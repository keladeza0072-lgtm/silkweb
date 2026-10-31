import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImageAdSpecs,
  createFrame,
  decodePng,
  encodePng,
  IMAGE_AD_HEIGHT,
  IMAGE_AD_OBJECTIVES,
  IMAGE_AD_WIDTH,
  imageAdsGenerateOutcome,
  renderImageAd,
  validateImageAdInput,
} from '../dist/imageAds.js';
import { configPayload } from '../dist/server.js';

/**
 * Image Ads Milestone 1 suite. Socket-free, no model calls: input
 * validation, three differentiated claim-free specs, and real
 * 1080 x 1350 PNG output from the deterministic renderer.
 */

function tinyPngDataUrl() {
  const frame = createFrame(8, 6, [200, 30, 30]);
  const png = encodePng(frame);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function pngSize(png) {
  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.equal(png.readUInt32BE(16), IMAGE_AD_WIDTH);
  assert.equal(png.readUInt32BE(20), IMAGE_AD_HEIGHT);
}

test('image-ads config exposes three objectives defaulting to drive-sales', () => {
  assert.deepEqual(IMAGE_AD_OBJECTIVES.map((o) => o.id), ['drive-sales', 'build-awareness', 'launch-product']);
  const payload = configPayload();
  assert.equal(payload.imageAds.objectives.length, 3);
  assert.equal(payload.imageAds.defaultObjective, 'drive-sales');
  assert.equal(payload.imageAds.adWidth, 1080);
  assert.equal(payload.imageAds.adHeight, 1350);
  assert.ok(payload.imageAds.supportedFormats.includes('PNG'));
});

test('input requires a product image or a product name', () => {
  const empty = validateImageAdInput({ objective: 'drive-sales' });
  assert.equal(empty.ok, false);
  assert.ok(empty.issues.some((i) => i.field === 'productName'));

  assert.equal(validateImageAdInput({ productName: 'Luma Candles', objective: 'drive-sales' }).ok, true);
  assert.equal(validateImageAdInput({ productImage: tinyPngDataUrl(), objective: 'drive-sales' }).ok, true);
});

test('input rejects bad objectives, long names, and bad uploads', () => {
  const badObjective = validateImageAdInput({ productName: 'Soap', objective: 'go-viral' });
  assert.equal(badObjective.ok, false);
  assert.ok(badObjective.issues.some((i) => i.field === 'objective'));

  const longName = validateImageAdInput({ productName: 'x'.repeat(121), objective: 'drive-sales' });
  assert.equal(longName.ok, false);

  const badFormat = validateImageAdInput({ productName: 'Soap', objective: 'drive-sales', productImage: 'data:image/gif;base64,AAAA' });
  assert.equal(badFormat.ok, false);
  assert.ok(badFormat.issues.some((i) => i.field === 'productImage'));

  const notImage = validateImageAdInput({
    productName: 'Soap',
    objective: 'drive-sales',
    productImage: `data:image/png;base64,${Buffer.from('hello world, not a png').toString('base64')}`,
  });
  assert.equal(notImage.ok, false);

  const oversize = validateImageAdInput({
    productName: 'Soap',
    objective: 'drive-sales',
    productImage: `data:image/png;base64,${Buffer.alloc(1536 * 1024 + 1, 7).toString('base64')}`,
  });
  assert.equal(oversize.ok, false);
});

test('specs are three differentiated, claim-free directions', () => {
  for (const objective of ['drive-sales', 'build-awareness', 'launch-product']) {
    const specs = buildImageAdSpecs({ productName: 'Luma Candles', objective, upload: null });
    assert.equal(specs.length, 3);
    assert.deepEqual(specs.map((s) => s.id), ['ad-1', 'ad-2', 'ad-3']);
    assert.equal(new Set(specs.map((s) => s.headline)).size, 3);
    assert.equal(new Set(specs.map((s) => s.cta)).size, 3);
    assert.equal(new Set(specs.map((s) => s.layout)).size, 3);
    const text = JSON.stringify(specs).toLowerCase();
    assert.ok(!text.includes('discount') && !text.includes('% off'));
    assert.ok(!text.includes('testimonial') && !text.includes('guarantee'));
    assert.ok(!text.includes('best') && !text.includes('#1'));
    for (const spec of specs) {
      assert.ok(spec.headline.includes('Luma Candles'), 'copy must use the supplied product name');
    }
  }
});

test('renderer produces three valid 1080 x 1350 PNG files', () => {
  const specs = buildImageAdSpecs({ productName: 'Luma Candles', objective: 'drive-sales', upload: null });
  const rendered = specs.map((spec) => renderImageAd(spec, 'drive-sales', 'Luma Candles', null));
  assert.equal(rendered.length, 3);
  for (const png of rendered) pngSize(png);
  assert.equal(new Set(rendered.map((b) => b.toString('base64'))).size, 3, 'layouts must differ');
});

test('rendering is deterministic for the same input', () => {
  const input = { productName: 'Luma Candles', objective: 'launch-product', upload: null };
  const first = imageAdsGenerateOutcome(input);
  const second = imageAdsGenerateOutcome(input);
  assert.equal(first.status, 200);
  assert.deepEqual(first.payload, second.payload);
});

test('outcome returns three ads with download-ready PNG data URLs', () => {
  const outcome = imageAdsGenerateOutcome({ productName: 'Luma Candles', objective: 'build-awareness' });
  assert.equal(outcome.status, 200);
  assert.equal(outcome.payload.ok, true);
  assert.equal(outcome.payload.ads.length, 3);
  for (const ad of outcome.payload.ads) {
    assert.ok(ad.pngDataUrl.startsWith('data:image/png;base64,'));
    assert.ok(ad.headline.trim().length > 0 && ad.body.trim().length > 0 && ad.cta.trim().length > 0);
    pngSize(Buffer.from(ad.pngDataUrl.split(',')[1], 'base64'));
  }
  assert.equal(outcome.payload.photoComposited, false);
});

test('uploaded PNG photos are decoded and composited', () => {
  const photo = decodePng(Buffer.from(tinyPngDataUrl().split(',')[1], 'base64'));
  assert.ok(photo && photo.width === 8 && photo.height === 6);
  const outcome = imageAdsGenerateOutcome({ productName: 'Luma', objective: 'drive-sales', productImage: tinyPngDataUrl() });
  assert.equal(outcome.status, 200);
  assert.equal(outcome.payload.photoComposited, true);
  assert.equal(outcome.payload.ads.every((ad) => ad.photoComposited), true);
});

test('JPEG uploads are accepted without photo compositing', () => {
  const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 3)]);
  const outcome = imageAdsGenerateOutcome({
    productName: 'Luma',
    objective: 'drive-sales',
    productImage: `data:image/jpeg;base64,${jpegBytes.toString('base64')}`,
  });
  assert.equal(outcome.status, 200);
  assert.equal(outcome.payload.photoComposited, false);
});

test('undecodable PNG uploads fail with a field-level issue', () => {
  const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const outcome = imageAdsGenerateOutcome({
    productName: 'Luma',
    objective: 'drive-sales',
    productImage: `data:image/png;base64,${fake.toString('base64')}`,
  });
  assert.equal(outcome.status, 422);
  assert.ok(outcome.payload.issues.some((i) => i.field === 'productImage'));
});

test('outcome maps invalid requests to 422 without rendering', () => {
  assert.equal(imageAdsGenerateOutcome({}).status, 422);
  assert.equal(imageAdsGenerateOutcome(null).status, 422);
  assert.equal(imageAdsGenerateOutcome({ productName: '', objective: 'drive-sales' }).status, 422);
});
