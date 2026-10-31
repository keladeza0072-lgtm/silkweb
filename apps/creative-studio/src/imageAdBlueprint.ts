/**
 * SilkWeb Creative — deterministic spatial blueprints.
 * Coordinate units are normalized fractions of a 1080x1350 ad.
 * These are internal composition constraints, not UI options.
 */

import type { CreativeClassId } from './creativeReferenceRegistry.js';

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CreativeBlueprint {
  classId: CreativeClassId;
  headline: Region;
  product: Region;
  body: Region;
  headlineMaxLines: number;
  headlineMinFontPx: number;
  headlineMaxFontPx: number;
  productMinWidthRatio: number;
  productMinHeightRatio: number;
  embeddedCta: boolean;
  evidenceDependent: boolean;
}

export const CREATIVE_BLUEPRINTS: readonly CreativeBlueprint[] = [
  {
    classId: 'OUTCOME_HERO',
    headline: { x: .07, y: .05, w: .86, h: .15 },
    product: { x: .12, y: .33, w: .76, h: .49 },
    body: { x: .07, y: .22, w: .86, h: .08 },
    headlineMaxLines: 3,
    headlineMinFontPx: 42,
    headlineMaxFontPx: 86,
    productMinWidthRatio: .35,
    productMinHeightRatio: .30,
    embeddedCta: false,
    evidenceDependent: false,
  },
  {
    classId: 'BENEFIT_STACK',
    headline: { x: .055, y: .08, w: .38, h: .25 },
    product: { x: .48, y: .12, w: .48, h: .71 },
    body: { x: .055, y: .43, w: .38, h: .31 },
    headlineMaxLines: 4,
    headlineMinFontPx: 30,
    headlineMaxFontPx: 65,
    productMinWidthRatio: .30,
    productMinHeightRatio: .40,
    embeddedCta: false,
    evidenceDependent: true,
  },
  {
    classId: 'ANNOTATED_HERO',
    headline: { x: .065, y: .05, w: .87, h: .14 },
    product: { x: .15, y: .25, w: .70, h: .55 },
    body: { x: .55, y: .82, w: .40, h: .12 },
    headlineMaxLines: 2,
    headlineMinFontPx: 38,
    headlineMaxFontPx: 72,
    productMinWidthRatio: .35,
    productMinHeightRatio: .35,
    embeddedCta: false,
    evidenceDependent: true,
  },
  {
    classId: 'OFFER_HERO',
    headline: { x: .09, y: .055, w: .82, h: .17 },
    product: { x: .12, y: .34, w: .76, h: .53 },
    body: { x: .09, y: .23, w: .82, h: .07 },
    headlineMaxLines: 3,
    headlineMinFontPx: 40,
    headlineMaxFontPx: 83,
    productMinWidthRatio: .35,
    productMinHeightRatio: .35,
    embeddedCta: false,
    evidenceDependent: true,
  },
];

export function blueprintForClass(
  classId: CreativeClassId,
): CreativeBlueprint | undefined {
  const found = CREATIVE_BLUEPRINTS.find(b => b.classId === classId);
  if (!found) return undefined;
  return {
    ...found,
    headline: { ...found.headline },
    product: { ...found.product },
    body: { ...found.body },
  };
}

export function regionsOverlap(a: Region, b: Region): boolean {
  return a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y;
}

export function validateBlueprint(b: CreativeBlueprint): string[] {
  const errors: string[] = [];

  for (const [label, region] of [
    ['headline', b.headline],
    ['product', b.product],
    ['body', b.body],
  ] as const) {
    if (![region.x, region.y, region.w, region.h].every(Number.isFinite)) {
      errors.push(`${label}: non-finite coordinate`);
      continue;
    }
    if (
      region.x < 0 || region.y < 0 ||
      region.w <= 0 || region.h <= 0 ||
      region.x + region.w > 1.000001 ||
      region.y + region.h > 1.000001
    ) {
      errors.push(`${label}: outside canvas`);
    }
  }

  if (regionsOverlap(b.headline, b.product)) {
    errors.push('headline overlaps product');
  }
  if (regionsOverlap(b.body, b.product)) {
    errors.push('body overlaps product');
  }
  if (b.headlineMinFontPx > b.headlineMaxFontPx ||
      b.headlineMinFontPx <= 0) {
    errors.push('invalid headline font bounds');
  }
  if (b.product.w < b.productMinWidthRatio ||
      b.product.h < b.productMinHeightRatio) {
    errors.push('product region below minimum');
  }
  if (b.headlineMaxLines < 1) {
    errors.push('invalid headline line limit');
  }
  return errors;
}
