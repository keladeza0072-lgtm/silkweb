/**
 * SilkWeb Creative — M4C photographic composition guidance.
 *
 * Aligns Muse Image photography with the existing Sharp typography
 * regions. These directions are internal, deterministic, and do not
 * authorize unsupported product claims or new customer controls.
 *
 * These are layout-aware directions, not yet class-specific renderers.
 */

import type { ImageAdAudience } from './imageAdsPlan.js';

export interface PhotoCompositionDirection {
  audience: ImageAdAudience;
  photographRegion: string;
  productPlacement: string;
  visualHierarchy: string;
  protectedAreas: string;
}

const DIRECTIONS: Record<ImageAdAudience, PhotoCompositionDirection> = {
  cold: {
    audience: 'cold',
    photographRegion:
      'The primary photographic scene occupies the area below the upper headline panel.',
    productPlacement:
      'Make the product clearly recognizable in the middle-right portion of the photograph.',
    visualHierarchy:
      'Use an inviting product discovery composition with one dominant visual focal point.',
    protectedAreas:
      'The upper 424 pixels will be covered by an opaque headline panel. ' +
      'A CTA element will overlap the lower-left area. ' +
      'Keep the important product details away from these regions.',
  },

  warm: {
    audience: 'warm',
    photographRegion:
      'The primary photograph occupies approximately the upper 55 percent of the advertisement.',
    productPlacement:
      'Show the product clearly within the upper photographic region, with balanced surrounding context.',
    visualHierarchy:
      'Favor product understanding and contextual detail over dramatic promotional decoration.',
    protectedAreas:
      'The bottom 602 pixels will be covered by an opaque copy panel. ' +
      'Keep the product and all essential scene details above that panel.',
  },

  hot: {
    audience: 'hot',
    photographRegion:
      'The primary photograph occupies approximately the upper 59 percent of the advertisement.',
    productPlacement:
      'Use a prominent, clearly identifiable product hero in the upper photographic region.',
    visualHierarchy:
      'Make the product the immediate focal point, with decisive framing and minimal distractions.',
    protectedAreas:
      'The bottom 560 pixels will be covered by an opaque headline and CTA panel. ' +
      'Do not place essential product details in that area.',
  },
};

export function photoDirectionForAudience(
  audience: ImageAdAudience,
): PhotoCompositionDirection {
  return { ...DIRECTIONS[audience] };
}

export function buildPhotoCompositionGuidance(
  audience: ImageAdAudience,
): string {
  const direction = photoDirectionForAudience(audience);

  return [
    'Photographic composition requirements:',
    direction.photographRegion,
    direction.productPlacement,
    direction.visualHierarchy,
    direction.protectedAreas,
    'Produce photographic content only. Do not generate advertising headlines,',
    'CTA buttons, promotional text, invented logos, or decorative text.',
    'Preserve the supplied product identity whenever a reference image exists.',
  ].join('\n');
}
