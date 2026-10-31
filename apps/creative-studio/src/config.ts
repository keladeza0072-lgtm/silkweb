/**
 * Creative Studio configuration.
 *
 * The visible style and framework lists come from the approved V1
 * creative library (CREATIVE_LIBRARY_V1.md): six advertising styles
 * and four copywriting frameworks. Temporary placeholder slots are
 * gone from the product — unknown ids stay rejected.
 */

export interface StyleSlot {
  id: string;
  name: string;
  tagline: string;
  placeholder: boolean;
}

export interface FrameworkSlot {
  id: string;
  name: string;
  tagline: string;
}

export interface PhotographyMode {
  id: 'product' | 'lifestyle' | 'website';
  name: string;
  description: string;
}

export interface BriefField {
  id: string;
  label: string;
  maxLength: number;
  required: boolean;
}

export const CREATIVE_STUDIO_VERSION = '0.3.0';
export const CREATIVE_STUDIO_DEFAULT_PORT = 3003;

/** No model inference is wired in by default. */
export const GENERATION_CONNECTED = false;

/**
 * The six approved V1 advertising styles, in library order.
 * Taglines restate each style's V1 purpose for the picker UI.
 */
export const STYLE_SLOTS: readonly StyleSlot[] = [
  { id: 'problem-solution', name: 'Problem vs. Solution', tagline: 'Connect an identifiable problem to a relevant solution.', placeholder: false },
  { id: 'notification-offer', name: 'Offer / Notification Offer', tagline: 'Highlight a genuine promotional incentive. Needs a real offer in the brief.', placeholder: false },
  { id: 'chat-script', name: 'WhatsApp / Chat Script', tagline: 'Present advertising as a relatable conversation.', placeholder: false },
  { id: 'whiteboard', name: 'Whiteboard', tagline: 'Explain a product, process, or service step by step.', placeholder: false },
  { id: 'before-after', name: 'Before vs. After', tagline: 'Contrast a situation, process, or experience. Needs supportable change.', placeholder: false },
  { id: 'editorial', name: 'Editorial / Magazine', tagline: 'Premium photography-led brand storytelling.', placeholder: false },
];

/** The four approved V1 copywriting frameworks, in library order. */
export const FRAMEWORK_SLOTS: readonly FrameworkSlot[] = [
  { id: 'aida', name: 'AIDA', tagline: 'Attention → Interest → Desire → Action.' },
  { id: 'pas', name: 'PAS', tagline: 'Problem → Agitation → Solution.' },
  { id: 'bab', name: 'BAB', tagline: 'Before → After → Bridge.' },
  { id: 'fab', name: 'FAB', tagline: 'Features → Advantages → Benefits.' },
];

export const PHOTOGRAPHY_MODES: readonly PhotographyMode[] = [
  { id: 'product', name: 'Product', description: 'Studio-style product shot on a clean backdrop.' },
  { id: 'lifestyle', name: 'Lifestyle', description: 'Product in a real-life setting with people and context.' },
  { id: 'website', name: 'Website', description: 'Wide hero-style composition framed for a landing page.' },
];

export const BRIEF_FIELDS: readonly BriefField[] = [
  { id: 'brand', label: 'Brand', maxLength: 80, required: true },
  { id: 'product', label: 'Product', maxLength: 120, required: true },
  { id: 'audience', label: 'Audience', maxLength: 200, required: true },
  { id: 'objective', label: 'Objective', maxLength: 200, required: true },
  { id: 'offer', label: 'Offer', maxLength: 200, required: false },
  { id: 'creativeDirection', label: 'Creative direction', maxLength: 500, required: false },
];

export const MAX_BODY_BYTES = 64 * 1024;

/** Default cap on clarification questions per campaign (user-adjustable 0–5). */
export const ELICITATION_DEFAULT_MAX_QUESTIONS = 3;
export const ELICITATION_MAX_DESCRIPTION_LENGTH = 2000;
export const ELICITATION_MAX_ANSWER_LENGTH = 500;

/** One-tap starters for the brief stage. Plain examples — never sent anywhere. */
export const EXAMPLE_PROMPTS: readonly string[] = [
  'Acme Coffee is launching cold-brew cans for commuters aged 25–40 to drive launch-week trial with 2-for-1 opening weekend.',
  'Northwind Outfitters is introducing a waterproof trail jacket for weekend hikers; goal is to boost holiday sales with free shipping over $50.',
  'Brightline Studio sells handmade ceramic mugs for cozy home offices and wants to grow newsletter signups with a warm, minimal vibe.',
];

export function styleSlotIds(): string[] {
  return STYLE_SLOTS.map((slot) => slot.id);
}

export function frameworkSlotIds(): string[] {
  return FRAMEWORK_SLOTS.map((slot) => slot.id);
}

export function photographyModeIds(): string[] {
  return PHOTOGRAPHY_MODES.map((mode) => mode.id);
}
