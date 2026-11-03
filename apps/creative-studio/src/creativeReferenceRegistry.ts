/**
 * SilkWeb Creative Reference Registry — M4A v1.
 *
 * Original, reusable creative directions derived from ten user-provided
 * advertising screenshots. These records are not advertisements to
 * reproduce or performance-verified winning creatives.
 *
 * Internal only. No network, inference, randomness, or UI settings.
 */

export const CREATIVE_REFERENCE_VERSION = 'm4a-v1';

export type CreativeClassId =
  | 'OUTCOME_HERO'
  | 'CULTURAL_HOOK'
  | 'BENEFIT_STACK'
  | 'LIFESTYLE_STORY'
  | 'ASPIRATIONAL_UPGRADE'
  | 'ANNOTATED_HERO'
  | 'OFFER_HERO'
  | 'VISUAL_COMPARISON';

export type EvidenceRequirement =
  | 'quantified-result'
  | 'product-facts'
  | 'genuine-offer'
  | 'testimonial'
  | 'comparative-evidence'
  | 'transformation-evidence';

export interface CreativeClass {
  id: CreativeClassId;
  name: string;
  mechanism: string;
  hierarchy: string;
  composition: string;
  typography: string;
  supportingElements: string[];
  evidenceRequired: EvidenceRequirement[];
  rules: string[];
  exclusions: string[];
  implementationTier: 'initial' | 'advanced' | 'restricted';
}

export interface CreativeReference {
  id: string;
  sourceLabel: string;
  classId: CreativeClassId;
  performanceStatus: 'unverified';
  observedPattern: string;
  reusableLesson: string;
}

export const CREATIVE_CLASSES: readonly CreativeClass[] = [
  {
    id: 'OUTCOME_HERO',
    name: 'Outcome-led hero',
    mechanism: 'Lead with one meaningful customer outcome.',
    hierarchy: 'Dominant outcome, short support, identifiable product.',
    composition: 'Large headline with product scene in remaining space.',
    typography: 'Strong size contrast and restrained supporting text.',
    supportingElements: ['product image', 'short outcome statement'],
    evidenceRequired: [],
    rules: [
      'Use qualitative benefits when no quantified result is supplied.',
      'Only show numerical results when separately substantiated.',
      'Preserve product identification.',
    ],
    exclusions: ['invented multipliers', 'guaranteed results'],
    implementationTier: 'initial',
  },
  {
    id: 'CULTURAL_HOOK',
    name: 'Relatable humor',
    mechanism: 'Connect a familiar situation to a product need.',
    hierarchy: 'Short observation first, original visual punchline second.',
    composition: 'Caption-led graphic with original supporting imagery.',
    typography: 'Conversational and immediately readable.',
    supportingElements: ['original reaction scene'],
    evidenceRequired: [],
    rules: [
      'Use original humor and imagery.',
      'Match tone to the product category.',
    ],
    exclusions: ['copied memes', 'unlicensed characters', 'disparaging stereotypes'],
    implementationTier: 'restricted',
  },
  {
    id: 'BENEFIT_STACK',
    name: 'Product and benefit stack',
    mechanism: 'Make several real product benefits easy to scan.',
    hierarchy: 'Product hero, benefit headline, concise supporting facts.',
    composition: 'Product occupies one strong zone; benefits occupy another.',
    typography: 'Clear bold headline with compact benefit labels.',
    supportingElements: ['checkmarks', 'short labels', 'icons'],
    evidenceRequired: ['product-facts'],
    rules: [
      'Only display benefits supported by the brief.',
      'Keep the product visually dominant.',
      'Avoid cluttered lists.',
    ],
    exclusions: ['invented specifications', 'unverified certifications'],
    implementationTier: 'initial',
  },
  {
    id: 'LIFESTYLE_STORY',
    name: 'Lifestyle and emotional aspiration',
    mechanism: 'Show the real-life experience associated with the product.',
    hierarchy: 'Human or lifestyle scene first, product presence second.',
    composition: 'Environmental photography with a compact text zone.',
    typography: 'Readable editorial headline over protected negative space.',
    supportingElements: ['relevant lifestyle scene'],
    evidenceRequired: [],
    rules: [
      'Keep the product recognizable.',
      'Do not invent customer quotations or ratings.',
      'Use original or properly licensed scenes.',
    ],
    exclusions: ['fabricated testimonials', 'invented star ratings'],
    implementationTier: 'advanced',
  },
  {
    id: 'ASPIRATIONAL_UPGRADE',
    name: 'Aspirational product upgrade',
    mechanism: 'Present a desirable next step from a relatable frustration.',
    hierarchy: 'Customer problem or aspiration, person or product, benefit.',
    composition: 'Human-context hero with a clear product anchor.',
    typography: 'High-contrast headline and restrained secondary copy.',
    supportingElements: ['human-context scene', 'product depiction'],
    evidenceRequired: [],
    rules: [
      'Describe general aspirations without promising unsupported outcomes.',
      'Do not imply a proven before-and-after result.',
    ],
    exclusions: ['unverified efficacy', 'fabricated transformation proof'],
    implementationTier: 'advanced',
  },
  {
    id: 'ANNOTATED_HERO',
    name: 'Annotated product hero',
    mechanism: 'Explain distinctive product attributes spatially.',
    hierarchy: 'Large product, short headline, precise attribute callouts.',
    composition: 'Central or side-aligned product with safe annotation zones.',
    typography: 'Editorial headline with simple legible callout labels.',
    supportingElements: ['connector lines', 'attribute labels'],
    evidenceRequired: ['product-facts'],
    rules: [
      'Use only facts provided by the user.',
      'Keep annotations clear of packaging and branding.',
    ],
    exclusions: ['invented features', 'obscured product details'],
    implementationTier: 'initial',
  },
  {
    id: 'OFFER_HERO',
    name: 'Offer-led promotion',
    mechanism: 'Make a genuine incentive the primary attention anchor.',
    hierarchy: 'Offer first, product second, concise reason to act.',
    composition: 'Large offer region with visible products and clean CTA.',
    typography: 'Bold promotional hierarchy with compact supporting text.',
    supportingElements: ['product grouping', 'offer block'],
    evidenceRequired: ['genuine-offer'],
    rules: [
      'Use the offer exactly as supported by the brief.',
      'Avoid invented urgency and expiry.',
    ],
    exclusions: ['fabricated discounts', 'false scarcity'],
    implementationTier: 'initial',
  },
  {
    id: 'VISUAL_COMPARISON',
    name: 'Evidence-based visual comparison',
    mechanism: 'Help viewers understand a supported difference.',
    hierarchy: 'Comparable options, visible differences, short explanation.',
    composition: 'Balanced side-by-side presentation.',
    typography: 'Parallel labels and clear comparison criteria.',
    supportingElements: ['two comparable visuals', 'parallel fact labels'],
    evidenceRequired: ['comparative-evidence'],
    rules: [
      'Require evidence for both sides.',
      'Use fair and comparable presentation.',
      'Never invent a competitor disadvantage.',
    ],
    exclusions: ['fake competitor defects', 'misleading before-and-after imagery'],
    implementationTier: 'restricted',
  },
];

export const CREATIVE_REFERENCES: readonly CreativeReference[] = [
  {
    id: 'CR-001',
    sourceLabel: 'Hootsuite outcome advertisement',
    classId: 'OUTCOME_HERO',
    performanceStatus: 'unverified',
    observedPattern: 'Large quantified headline above a phone-in-use visual.',
    reusableLesson: 'Give one supported outcome the strongest visual weight.',
  },
  {
    id: 'CR-002',
    sourceLabel: 'Underwear purchasing meme',
    classId: 'CULTURAL_HOOK',
    performanceStatus: 'unverified',
    observedPattern: 'Relatable caption paired with a recognizable reaction image.',
    reusableLesson: 'A concise cultural observation can create immediate recognition.',
  },
  {
    id: 'CR-003',
    sourceLabel: 'Clean Pan checklist advertisement',
    classId: 'BENEFIT_STACK',
    performanceStatus: 'unverified',
    observedPattern: 'Large cookware visual with aligned feature checkmarks.',
    reusableLesson: 'Place a few factual attributes beside a strong product hero.',
  },
  {
    id: 'CR-004',
    sourceLabel: 'Solo Stove lifestyle testimonial',
    classId: 'LIFESTYLE_STORY',
    performanceStatus: 'unverified',
    observedPattern: 'People gathered around the product with testimonial treatment.',
    reusableLesson: 'Show the desired experience while keeping claims authentic.',
  },
  {
    id: 'CR-005',
    sourceLabel: 'Curology skincare advertisement',
    classId: 'ASPIRATIONAL_UPGRADE',
    performanceStatus: 'unverified',
    observedPattern: 'Bold upgrade headline with person and product together.',
    reusableLesson: 'Connect a product to a relatable aspiration.',
  },
  {
    id: 'CR-006',
    sourceLabel: 'Jones Road product annotations',
    classId: 'ANNOTATED_HERO',
    performanceStatus: 'unverified',
    observedPattern: 'Central product with short spatial feature callouts.',
    reusableLesson: 'Explain verified attributes without overwhelming the product.',
  },
  {
    id: 'CR-007',
    sourceLabel: 'Surreal cereal bundle promotion',
    classId: 'OFFER_HERO',
    performanceStatus: 'unverified',
    observedPattern: 'Prominent discount, multiple products, benefit annotations.',
    reusableLesson: 'Lead with a real offer and support it with visible products.',
  },
  {
    id: 'CR-008',
    sourceLabel: 'Gruns product benefit advertisement',
    classId: 'BENEFIT_STACK',
    performanceStatus: 'unverified',
    observedPattern: 'Distinctive packaging with short icon-led facts.',
    reusableLesson: 'Use packaging identity and supported benefits together.',
  },
  {
    id: 'CR-009',
    sourceLabel: 'Almond Cow coffee comparison',
    classId: 'VISUAL_COMPARISON',
    performanceStatus: 'unverified',
    observedPattern: 'Two contrasting product outcomes presented side by side.',
    reusableLesson: 'Let a fair, supported comparison communicate the difference.',
  },
  {
    id: 'CR-010',
    sourceLabel: 'Probiotic comparison advertisement',
    classId: 'VISUAL_COMPARISON',
    performanceStatus: 'unverified',
    observedPattern: 'Parallel columns with products and comparison checklists.',
    reusableLesson: 'Keep the comparison symmetrical and evidence-based.',
  },
];

export interface CreativeEligibility {
  hasProductFacts: boolean;
  hasGenuineOffer: boolean;
  hasVerifiedOutcome: boolean;
  hasTestimonial: boolean;
  hasComparativeEvidence: boolean;
  hasTransformationEvidence: boolean;
}

export function eligibleCreativeClasses(
  evidence: CreativeEligibility,
): CreativeClass[] {
  return CREATIVE_CLASSES.filter((creative) =>
    creative.evidenceRequired.every((requirement) => {
      switch (requirement) {
        case 'product-facts': return evidence.hasProductFacts;
        case 'genuine-offer': return evidence.hasGenuineOffer;
        case 'quantified-result': return evidence.hasVerifiedOutcome;
        case 'testimonial': return evidence.hasTestimonial;
        case 'comparative-evidence': return evidence.hasComparativeEvidence;
        case 'transformation-evidence': return evidence.hasTransformationEvidence;
      }
    })
  );
}
