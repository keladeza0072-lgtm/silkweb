/**
 * SilkWeb Creative — M4C composition contract.
 *
 * Separates advertising mechanisms from executable layouts.
 * Customer-facing UX remains product + objective -> three ads.
 *
 * Status: baseline presets defined; class-specific rendering follows.
 */

import type { ImageAdAudience } from './imageAdsPlan.js';
import type { CreativeClassId } from './creativeReferenceRegistry.js';

export type CompositionPresetId =
  | 'EDITORIAL_DISCOVERY'
  | 'CONTEXTUAL_SPOTLIGHT'
  | 'BOLD_ACTION';

export interface CompositionPreset {
  id: CompositionPresetId;
  audience: ImageAdAudience;
  purpose: string;
  photoRegion: string;
  textRegion: string;
  productPriority: string;
  eligibleClasses: CreativeClassId[];
}

export const COMPOSITION_PRESETS: readonly CompositionPreset[] = [
  {
    id: 'EDITORIAL_DISCOVERY',
    audience: 'cold',
    purpose: 'Introduce the product with a memorable first impression.',
    photoRegion: 'Lower photographic area, with a protected top headline panel.',
    textRegion: 'Headline and supporting copy above photography; CTA below.',
    productPriority: 'Prominent product hero with breathing room.',
    eligibleClasses: ['OUTCOME_HERO', 'LIFESTYLE_STORY'],
  },
  {
    id: 'CONTEXTUAL_SPOTLIGHT',
    audience: 'warm',
    purpose: 'Help people understand the product in a believable context.',
    photoRegion: 'Upper photographic area, with a protected lower information panel.',
    textRegion: 'Benefit or explanation below photography.',
    productPriority: 'Recognizable product with relevant surroundings.',
    eligibleClasses: ['OUTCOME_HERO', 'BENEFIT_STACK', 'ANNOTATED_HERO'],
  },
  {
    id: 'BOLD_ACTION',
    audience: 'hot',
    purpose: 'Encourage a clear next step without fabricated urgency.',
    photoRegion: 'Upper product-focused photograph and lower action panel.',
    textRegion: 'Large headline, supporting copy, prominent CTA.',
    productPriority: 'Decisive product framing with minimal distractions.',
    eligibleClasses: ['OUTCOME_HERO', 'OFFER_HERO', 'BENEFIT_STACK'],
  },
];

export function compositionForAudience(
  audience: ImageAdAudience,
): CompositionPreset {
  const preset = COMPOSITION_PRESETS.find((item) => item.audience === audience);
  if (!preset) throw new Error(`No composition preset for ${audience}.`);
  return { ...preset, eligibleClasses: [...preset.eligibleClasses] };
}
