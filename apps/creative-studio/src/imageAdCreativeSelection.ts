/**
 * SilkWeb Creative — M4B deterministic composition selection.
 *
 * Selects evidence-compatible, implementation-ready creative classes
 * for the three internal audience stages. No inference or UI controls.
 */

import type { ImageAdInput } from './imageAds.js';
import type { ImageAdAudience } from './imageAdsPlan.js';
import {
  CREATIVE_CLASSES,
  CREATIVE_REFERENCE_VERSION,
  eligibleCreativeClasses,
  type CreativeClassId,
  type CreativeEligibility,
} from './creativeReferenceRegistry.js';

export interface SelectedCreative {
  audience: ImageAdAudience;
  classId: CreativeClassId;
  reasons: string[];
}

export interface CreativeSelectionProvenance {
  registryVersion: string;
  objective: ImageAdInput['objective'];
  evidence: CreativeEligibility;
  selected: SelectedCreative[];
  rejected: Array<{
    classId: CreativeClassId;
    reason: string;
  }>;
}

/**
 * Conservative evidence extraction.
 * Product claims are user-supplied but not independently verified.
 * Comparison, testimonial, transformation and quantified-result proof
 * cannot be established from the current brief contract.
 */
export function assessCreativeEligibility(input: ImageAdInput): CreativeEligibility {
  return {
    hasProductFacts: input.differentiator.trim().length > 0,
    hasGenuineOffer: input.specialOffer.trim().length > 0,
    hasVerifiedOutcome: false,
    hasTestimonial: false,
    hasComparativeEvidence: false,
    hasTransformationEvidence: false,
  };
}

const AUDIENCES: ImageAdAudience[] = ['cold', 'warm', 'hot'];

const CLASS_ORDER: CreativeClassId[] = [
  'OUTCOME_HERO',
  'BENEFIT_STACK',
  'ANNOTATED_HERO',
  'OFFER_HERO',
  'LIFESTYLE_STORY',
  'ASPIRATIONAL_UPGRADE',
  'VISUAL_COMPARISON',
  'CULTURAL_HOOK',
];

function score(
  id: CreativeClassId,
  audience: ImageAdAudience,
  objective: ImageAdInput['objective'],
): number {
  const base: Record<ImageAdAudience, Partial<Record<CreativeClassId, number>>> = {
    cold: {
      OUTCOME_HERO: 12,
      BENEFIT_STACK: 8,
      ANNOTATED_HERO: 7,
      OFFER_HERO: 6,
    },
    warm: {
      OUTCOME_HERO: 8,
      BENEFIT_STACK: 12,
      ANNOTATED_HERO: 11,
      OFFER_HERO: 7,
    },
    hot: {
      OUTCOME_HERO: 9,
      BENEFIT_STACK: 8,
      ANNOTATED_HERO: 7,
      OFFER_HERO: 13,
    },
  };

  let result = base[audience][id] ?? 0;

  if (objective === 'build-awareness') {
    if (id === 'OUTCOME_HERO') result += 3;
    if (id === 'ANNOTATED_HERO') result += 2;
  }

  if (objective === 'launch-product') {
    if (id === 'OUTCOME_HERO') result += 2;
    if (id === 'ANNOTATED_HERO') result += 3;
  }

  if (objective === 'drive-sales' && id === 'OFFER_HERO') {
    result += 3;
  }

  return result;
}

export function selectCreativeClasses(input: ImageAdInput): {
  selections: SelectedCreative[];
  provenance: CreativeSelectionProvenance;
} {
  const evidence = assessCreativeEligibility(input);

  const evidenceEligible = eligibleCreativeClasses(evidence);
  const evidenceEligibleIds = new Set(evidenceEligible.map((item) => item.id));

  const ready = evidenceEligible.filter((item) => item.implementationTier === 'initial');

  const readyIds = new Set(ready.map((item) => item.id));
  const rejected: CreativeSelectionProvenance['rejected'] = [];

  for (const creative of CREATIVE_CLASSES) {
    if (!evidenceEligibleIds.has(creative.id)) {
      rejected.push({
        classId: creative.id,
        reason: 'Insufficient supporting product evidence.',
      });
    } else if (!readyIds.has(creative.id)) {
      rejected.push({
        classId: creative.id,
        reason: `Implementation tier "${creative.implementationTier}" is not ready for automatic rendering.`,
      });
    }
  }

  const used = new Set<CreativeClassId>();
  const selections: SelectedCreative[] = [];

  for (const audience of AUDIENCES) {
    const ranked = [...ready].sort(
      (a, b) =>
        score(b.id, audience, input.objective) -
          score(a.id, audience, input.objective) ||
        CLASS_ORDER.indexOf(a.id) - CLASS_ORDER.indexOf(b.id),
    );

    const choice = ranked.find((item) => !used.has(item.id)) ?? ranked[0];

    if (!choice) {
      throw new Error('No evidence-compatible creative class available.');
    }

    used.add(choice.id);

    selections.push({
      audience,
      classId: choice.id,
      reasons: [
        `Selected for ${audience} audience and ${input.objective} objective.`,
        'Eligible under supplied evidence and initial implementation tier.',
        'Distinct creative classes preferred across the three advertisements.',
      ],
    });
  }

  return {
    selections,
    provenance: {
      registryVersion: CREATIVE_REFERENCE_VERSION,
      objective: input.objective,
      evidence,
      selected: selections,
      rejected,
    },
  };
}
