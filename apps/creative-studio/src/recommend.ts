/**
 * Milestone 2B-1 style/framework recommendation.
 *
 * Pure, deterministic, and fact-safe: recommendations derive only
 * from the supplied campaign context plus an optional explicit user
 * preference. Nothing is invented — no product facts, no offers, no
 * transformation outcomes. Evidence-gated styles (notification-offer
 * needs a supplied offer; before-after and BAB need transformation
 * evidence) are withheld when their evidence is absent, and an
 * incompatible explicit preference is set aside with a plain-language
 * explanation instead of being followed.
 */

import type { CampaignContext } from './campaign.js';
import { isKnownFrameworkId, isKnownStyleId } from './library.js';

export interface RecommendationPreference {
  /** Explicit user-chosen style id, when supplied. */
  styleId?: string;
  /** Explicit user-chosen framework id, when supplied. */
  frameworkId?: string;
}

export interface RankedRecommendation {
  id: string;
  /** Plain-language reason; never requires advertising terminology. */
  reason: string;
  /** True when this entry honors the user's explicit preference. */
  preferred: boolean;
}

export interface CreativeRecommendations {
  /** Eligible styles, best fit first. */
  styles: RankedRecommendation[];
  /** Eligible frameworks, best fit first. */
  frameworks: RankedRecommendation[];
  /** User-facing notes, including any set-aside preference. */
  explanations: string[];
}

/**
 * Two ready-to-use pairs for two-concept generation: the top two
 * recommended style ids and framework ids. Callers pair styles[i]
 * with frameworks[i]. Empty slots never occur under the default
 * gates (at least four styles and three frameworks stay eligible),
 * but the arrays are kept honest — never padded with duplicates.
 */
export interface ConceptPairRecommendation {
  styleIds: string[];
  frameworkIds: string[];
}

const CANONICAL_STYLE_ORDER: readonly string[] = [
  'problem-solution',
  'notification-offer',
  'chat-script',
  'whiteboard',
  'before-after',
  'editorial',
];

const CANONICAL_FRAMEWORK_ORDER: readonly string[] = ['aida', 'pas', 'bab', 'fab'];

const PROBLEM_CUES =
  /\b(problem|problems|struggl|pain point|painful|difficult|hard time|tired of|frustrat|challeng|stuck|stress|annoying|waste)\b/i;
const EXPLAIN_CUES = /\b(how it works|how to|explain|process|steps?|learn|guide|tutorial|works by|behind the scenes)\b/i;
const CHAT_CUES = /\b(whatsapp|chat|message|messaging|dm|conversation|conversational|instagram|tiktok|social|comment|reply)\b/i;
const PREMIUM_CUES =
  /\b(luxur|premium|elegant|editorial|magazine|fashion|high-end|sophisticat|atelier|couture|artisan|c timeless)\b/i;
const TRANSFORMATION_CUES =
  /\b(before|after|transform|improv|results?|progress|lose|lost|loss|growth|clearer|brighter|whiter|faster|smoother|younger|stronger|change|makeover|reduc|repair|restore|grow|fix)\b/i;

function campaignText(context: CampaignContext): string {
  return [
    context.description,
    context.product,
    context.objective,
    context.channel ?? '',
    context.audience ?? '',
    context.creativeDirection ?? '',
    ...context.facts,
    ...context.assumptions,
  ].join('\n');
}

function hasSuppliedOffer(context: CampaignContext): boolean {
  return (context.offer ?? '').trim().length > 0;
}

function hasTransformationEvidence(context: CampaignContext): boolean {
  return TRANSFORMATION_CUES.test(campaignText(context));
}

interface ScoredStyle {
  id: string;
  score: number;
  reason: string;
}

function scoreStyles(context: CampaignContext): ScoredStyle[] {
  const text = campaignText(context);
  const offer = hasSuppliedOffer(context);
  const transformation = hasTransformationEvidence(context);
  const out: ScoredStyle[] = [
    {
      id: 'problem-solution',
      score: 10 + (PROBLEM_CUES.test(text) ? 5 : 0),
      reason: PROBLEM_CUES.test(text)
        ? 'Your brief names a real customer problem, so opening with that problem fits.'
        : 'A clear problem-to-solution story fits most campaigns like yours.',
    },
    {
      id: 'chat-script',
      score: 8 + (CHAT_CUES.test(text) ? 4 : 0),
      reason: CHAT_CUES.test(text)
        ? 'Your channel and tone suit a friendly back-and-forth conversation.'
        : 'A short, friendly conversation format keeps the message easy to follow.',
    },
    {
      id: 'whiteboard',
      score: 8 + (EXPLAIN_CUES.test(text) ? 4 : 0),
      reason: EXPLAIN_CUES.test(text)
        ? 'Your brief asks for an explanation, so a step-by-step walkthrough fits.'
        : 'A simple step-by-step explainer works when buyers need the basics first.',
    },
    {
      id: 'editorial',
      score: 8 + (PREMIUM_CUES.test(text) ? 4 : 0),
      reason: PREMIUM_CUES.test(text)
        ? 'Your premium tone suits photography-led storytelling.'
        : 'Photography-led storytelling gives the brand a polished feel.',
    },
  ];
  if (offer) {
    out.push({
      id: 'notification-offer',
      score: 14,
      reason: 'You supplied a real offer, so leading with it is fair and effective.',
    });
  }
  if (transformation) {
    out.push({
      id: 'before-after',
      score: 12,
      reason: 'Your brief describes a change buyers can see, so a side-by-side comparison fits.',
    });
  }
  const rank = new Map(CANONICAL_STYLE_ORDER.map((id, index) => [id, index]));
  return out.sort((a, b) => b.score - a.score || (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

interface ScoredFramework {
  id: string;
  score: number;
  reason: string;
}

function scoreFrameworks(context: CampaignContext): ScoredFramework[] {
  const text = campaignText(context);
  const transformation = hasTransformationEvidence(context);
  const withFeatures = context.facts.length > 0;
  const out: ScoredFramework[] = [
    {
      id: 'aida',
      score: 10,
      reason: 'A proven four-step flow: catch attention, build interest, then ask for action.',
    },
    {
      id: 'pas',
      score: 8 + (PROBLEM_CUES.test(text) ? 4 : 0),
      reason: PROBLEM_CUES.test(text)
        ? 'Your brief names a real problem, so naming it before the solution fits.'
        : 'Naming the problem before the solution keeps the copy grounded.',
    },
    {
      id: 'fab',
      score: 8 + (withFeatures ? 4 : 0),
      reason: withFeatures
        ? 'You supplied real product facts, so feature-led copy stays truthful.'
        : 'Feature-led copy works as long as every feature comes from your brief.',
    },
  ];
  if (transformation) {
    out.push({
      id: 'bab',
      score: 11,
      reason: 'Your brief supports a real change, so a before-and-after story fits.',
    });
  }
  const rank = new Map(CANONICAL_FRAMEWORK_ORDER.map((id, index) => [id, index]));
  return out.sort((a, b) => b.score - a.score || (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

function applyStylePreference(
  ranked: ScoredStyle[],
  context: CampaignContext,
  preference: string | undefined,
  explanations: string[],
): RankedRecommendation[] {
  const eligible = ranked.map((entry) => ({
    id: entry.id,
    reason: entry.reason,
    preferred: false,
  }));
  if (preference === undefined || preference.trim() === '') return eligible;
  const wanted = preference.trim();
  if (!isKnownStyleId(wanted)) {
    explanations.push(
      `Your chosen style "${wanted}" is not in the approved library, so the closest approved fits are suggested instead.`,
    );
    return eligible;
  }
  const match = eligible.find((entry) => entry.id === wanted);
  if (match) {
    match.preferred = true;
    match.reason = `Your chosen style fits this campaign. ${match.reason}`;
    eligible.sort((a, b) => Number(b.preferred) - Number(a.preferred));
    return eligible;
  }
  if (wanted === 'notification-offer' && !hasSuppliedOffer(context)) {
    explanations.push(
      'Your chosen offer style needs a real promotion in the brief, and none was supplied — ' +
        'so it was set aside and other fits are suggested instead. Add an offer to unlock it.',
    );
  } else if (wanted === 'before-after' && !hasTransformationEvidence(context)) {
    explanations.push(
      'Your chosen comparison style needs a supportable change in the brief, and none was found — ' +
        'so it was set aside rather than inventing results. Describe the change to unlock it.',
    );
  } else {
    explanations.push(
      `Your chosen style "${wanted}" does not fit this brief, so other fits are suggested instead.`,
    );
  }
  return eligible;
}

function applyFrameworkPreference(
  ranked: ScoredFramework[],
  context: CampaignContext,
  preference: string | undefined,
  explanations: string[],
): RankedRecommendation[] {
  const eligible = ranked.map((entry) => ({
    id: entry.id,
    reason: entry.reason,
    preferred: false,
  }));
  if (preference === undefined || preference.trim() === '') return eligible;
  const wanted = preference.trim();
  if (!isKnownFrameworkId(wanted)) {
    explanations.push(
      `Your chosen copy approach "${wanted}" is not in the approved library, so the closest approved fits are suggested instead.`,
    );
    return eligible;
  }
  const match = eligible.find((entry) => entry.id === wanted);
  if (match) {
    match.preferred = true;
    match.reason = `Your chosen copy approach fits this campaign. ${match.reason}`;
    eligible.sort((a, b) => Number(b.preferred) - Number(a.preferred));
    return eligible;
  }
  if (wanted === 'bab' && !hasTransformationEvidence(context)) {
    explanations.push(
      'Your chosen before-and-after copy needs a supportable change in the brief, and none was found — ' +
        'so it was set aside rather than inventing results.',
    );
  } else {
    explanations.push(
      `Your chosen copy approach "${wanted}" does not fit this brief, so other fits are suggested instead.`,
    );
  }
  return eligible;
}

/**
 * Recommend eligible styles and frameworks for a campaign context.
 * Never recommends notification-offer without a supplied offer, and
 * never recommends before-after / BAB without transformation
 * evidence. Explicit preferences win only when compatible.
 */
export function recommendCreatives(
  context: CampaignContext,
  preferences: RecommendationPreference = {},
): CreativeRecommendations {
  const explanations: string[] = [];
  const styles = applyStylePreference(scoreStyles(context), context, preferences.styleId, explanations);
  const frameworks = applyFrameworkPreference(
    scoreFrameworks(context),
    context,
    preferences.frameworkId,
    explanations,
  );
  if (!hasSuppliedOffer(context)) {
    explanations.push(
      'No offer was supplied, so the offer-led style was left out — it only runs on real promotions.',
    );
  }
  return { styles, frameworks, explanations };
}

/** Top-two style/framework ids for two-concept generation (distinct ids, best fit first). */
export function recommendConceptPair(
  context: CampaignContext,
  preferences: RecommendationPreference = {},
): ConceptPairRecommendation {
  const advice = recommendCreatives(context, preferences);
  return {
    styleIds: [...new Set(advice.styles.map((entry) => entry.id))].slice(0, 2),
    frameworkIds: [...new Set(advice.frameworks.map((entry) => entry.id))].slice(0, 2),
  };
}
