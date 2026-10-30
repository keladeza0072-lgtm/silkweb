/**
 * Creative Studio Milestone 1 configuration.
 *
 * The six advertising styles are temporary labeled slots: the exact
 * production style names are not provided yet, so each slot carries a
 * stable id plus an explicit `placeholder: true` flag. The frontend
 * renders the flag so placeholder names are never mistaken for the
 * final 42-style library. Photography modes follow CREATIVE_MVP.md.
 */

export interface StyleSlot {
  id: string;
  name: string;
  tagline: string;
  placeholder: boolean;
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

export const CREATIVE_STUDIO_VERSION = '0.1.0';
export const CREATIVE_STUDIO_DEFAULT_PORT = 3003;

/** No model inference is wired in Milestone 1. */
export const GENERATION_CONNECTED = false;

export const STYLE_SLOTS: readonly StyleSlot[] = [
  { id: 'style-slot-a', name: 'Style A — Temporary Slot', tagline: 'Placeholder slot until the final style library lands.', placeholder: true },
  { id: 'style-slot-b', name: 'Style B — Temporary Slot', tagline: 'Placeholder slot until the final style library lands.', placeholder: true },
  { id: 'style-slot-c', name: 'Style C — Temporary Slot', tagline: 'Placeholder slot until the final style library lands.', placeholder: true },
  { id: 'style-slot-d', name: 'Style D — Temporary Slot', tagline: 'Placeholder slot until the final style library lands.', placeholder: true },
  { id: 'style-slot-e', name: 'Style E — Temporary Slot', tagline: 'Placeholder slot until the final style library lands.', placeholder: true },
  { id: 'style-slot-f', name: 'Style F — Temporary Slot', tagline: 'Placeholder slot until the final style library lands.', placeholder: true },
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

export function styleSlotIds(): string[] {
  return STYLE_SLOTS.map((slot) => slot.id);
}

export function photographyModeIds(): string[] {
  return PHOTOGRAPHY_MODES.map((mode) => mode.id);
}
