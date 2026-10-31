/**
 * Deterministic landing-page preview builder for Creative Studio.
 *
 * Pure functions only — no AI service, no network, no randomness.
 * The preview is assembled from the supplied campaign context and
 * the chosen concept: hero copy comes from the concept, supporting
 * points come ONLY from brief-supplied facts, and anything unknown
 * is labeled as missing instead of invented. No testimonials,
 * discounts, statistics, or endorsements are ever added.
 */

import type { CampaignContext } from './campaign.js';
import type { AdConcept } from './concepts.js';

export interface LandingPreview {
  brand: string;
  headline: string;
  subhead: string;
  cta: string;
  /** Verified points, each quoted from the brief. Empty when none supplied. */
  benefits: string[];
  /** Honest one-line summary of the campaign goal, when supplied. */
  goalLine: string | null;
  /** Audience line, only when an audience was supplied. */
  audienceLine: string | null;
  styleId: string;
  frameworkId: string;
  conceptId: string;
  method: string;
}

export const LANDING_METHOD_LABEL =
  'Assembled locally from your brief and the chosen concept — no copy was invented.';

/**
 * Build the preview content. Benefits are the brief's own facts
 * (at most four); with no facts the list stays empty and the UI
 * must say so instead of inventing points.
 */
export function buildLandingPreview(
  campaign: CampaignContext,
  concept: AdConcept,
): LandingPreview {
  const benefits = campaign.facts.slice(0, 4);
  const audience = (campaign.audience ?? '').trim();
  const objective = campaign.objective.trim();
  return {
    brand: (campaign.brand ?? '').trim() || 'Your brand',
    headline: concept.headline,
    subhead: concept.primaryCopy,
    cta: concept.cta,
    benefits,
    goalLine: objective ? `This campaign's goal: ${objective}.` : null,
    audienceLine: audience ? `Made for ${audience}.` : null,
    styleId: concept.styleId,
    frameworkId: concept.frameworkId,
    conceptId: concept.id,
    method: LANDING_METHOD_LABEL,
  };
}

/** Validate the preview endpoint input without throwing. */
export function validateLandingInput(input: unknown): {
  ok: boolean;
  issues: Array<{ field: string; message: string }>;
} {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ field: 'body', message: 'Landing request must be a JSON object.' }] };
  }
  const record = input as Record<string, unknown>;
  if (typeof record.campaign !== 'object' || record.campaign === null) {
    return { ok: false, issues: [{ field: 'campaign', message: 'A campaign context is required.' }] };
  }
  if (typeof record.concept !== 'object' || record.concept === null) {
    return { ok: false, issues: [{ field: 'concept', message: 'A chosen concept is required.' }] };
  }
  return { ok: true, issues: [] };
}
