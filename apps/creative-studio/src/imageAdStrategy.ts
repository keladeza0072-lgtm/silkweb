/**
 * SilkWeb Creative — Milestone 3A deterministic strategy retrieval.
 *
 * Maps an ImageAdInput onto one strategy per audience (cold / warm /
 * hot): an approved advertising style, an approved copywriting
 * framework, and a compact subset of knowledge-pack principles.
 *
 * Deterministic and evidence-gated:
 * - notification-offer is eligible only with a user-supplied offer.
 * - before-after / BAB are eligible only with concrete transformation
 *   evidence. Bare comparatives ("better", "faster", "improve") are
 *   explicitly NOT sufficient evidence.
 * - FAB is eligible only when the brief supplies real product facts.
 * - Only knowledge-pack entries cleared for live use
 *   (listLivePrinciples) are ever selected; pending entries are
 *   stored but never surface here.
 *
 * Users never choose any of this: the function takes only the
 * existing ImageAdInput and returns internal guidance plus a
 * provenance record. No network, no retries, no model calls.
 */

import type { ImageAdInput } from './imageAds.js';
import {
  APPROVED_ADVERTISING_STYLES,
  APPROVED_COPYWRITING_FRAMEWORKS,
} from './library.js';
import {
  CREATIVE_KNOWLEDGE_PACK_VERSION,
  getPrinciple,
  listLivePrinciples,
} from './knowledgePack.js';
import type { ImageAdAudience } from './imageAdsPlan.js';

export interface ImageAdEvidence {
  hasOffer: boolean;
  hasTransformationEvidence: boolean;
  hasTechnicalFacts: boolean;
}

export interface AudienceStrategy {
  audience: ImageAdAudience;
  styleId: string;
  frameworkId: string;
  principleIds: string[];
  /** Internal selection reasons (never shown in the customer UI). */
  reasons: string[];
}

export interface RejectedCandidate {
  kind: 'style' | 'framework';
  id: string;
  audience: ImageAdAudience;
  reason: string;
}

export interface ImageAdStrategyProvenance {
  knowledgePackVersion: string;
  objective: ImageAdInput['objective'];
  evidence: ImageAdEvidence;
  strategies: AudienceStrategy[];
  rejected: RejectedCandidate[];
}

const PROBLEM_CUES =
  /\b(problem|problems|struggl|pain point|painful|difficult|hard time|tired of|frustrat|challeng|stuck|stress|annoying|waste)\b/i;
const EXPLAIN_CUES = /\b(how it works|how to|explain|process|steps?|learn|guide|tutorial|works by|behind the scenes)\b/i;
const CHAT_CUES = /\b(whatsapp|chat|message|messaging|dm|conversation|conversational|instagram|tiktok|social|comment|reply)\b/i;
const PREMIUM_CUES = /\b(luxur|premium|elegant|editorial|magazine|fashion|high-end|sophisticat|atelier|couture|artisan)\b/i;

/** MVP safety: user-supplied numerical claims are not verified transformation evidence. */
function inputText(input: ImageAdInput): string {
  return [input.productName, input.differentiator, input.specialOffer].join('\n');
}

/** Strict, evidence-based assessment of what the brief actually supports. */
export function assessImageAdEvidence(input: ImageAdInput): ImageAdEvidence {

return {
    hasOffer: input.specialOffer.trim().length > 0,
    hasTransformationEvidence: false,
    hasTechnicalFacts: input.differentiator.trim().length > 0,
  };
}

const CANONICAL_STYLE_ORDER = [
  'problem-solution',
  'notification-offer',
  'chat-script',
  'whiteboard',
  'before-after',
  'editorial',
];

const CANONICAL_FRAMEWORK_ORDER = ['aida', 'pas', 'bab', 'fab'];

function styleEligible(id: string, evidence: ImageAdEvidence): boolean {
  if (id === 'notification-offer') return evidence.hasOffer;
  if (id === 'before-after') return evidence.hasTransformationEvidence;
  return true;
}

function frameworkEligible(id: string, evidence: ImageAdEvidence): boolean {
  if (id === 'bab') return evidence.hasTransformationEvidence;
  if (id === 'fab') return evidence.hasTechnicalFacts;
  return true;
}

function scoreStyle(id: string, audience: ImageAdAudience, input: ImageAdInput): number {
  const text = inputText(input);
  switch (audience) {
    case 'cold':
      if (id === 'editorial') return 11 + (PREMIUM_CUES.test(text) ? 3 : 0);
      if (id === 'problem-solution') return 10 + (PROBLEM_CUES.test(text) ? 3 : 0);
      if (id === 'chat-script') return 9 + (CHAT_CUES.test(text) ? 3 : 0);
      if (id === 'notification-offer') return 8;
      if (id === 'before-after') return 11;
      return 7 + (id === 'whiteboard' && EXPLAIN_CUES.test(text) ? 3 : 0);
    case 'warm':
      if (id === 'whiteboard') return 10 + (EXPLAIN_CUES.test(text) ? 3 : 0);
      if (id === 'problem-solution') return 10 + (PROBLEM_CUES.test(text) ? 3 : 0);
      if (id === 'before-after') return 11;
      if (id === 'editorial') return 8 + (PREMIUM_CUES.test(text) ? 2 : 0);
      if (id === 'chat-script') return 8;
      return 8;
    case 'hot':
      if (id === 'notification-offer') return 13;
      if (id === 'problem-solution') return 10;
      if (id === 'before-after') return 11;
      if (id === 'editorial') return 9;
      if (id === 'chat-script') return 8;
      return 7;
  }
}

function scoreFramework(id: string, audience: ImageAdAudience, input: ImageAdInput, evidence: ImageAdEvidence): number {
  const text = inputText(input);
  const problemBoost = PROBLEM_CUES.test(text) ? 3 : 0;
  switch (audience) {
    case 'cold':
      if (id === 'aida') return 10;
      if (id === 'pas') return 8 + problemBoost;
      if (id === 'fab') return 8 + (evidence.hasTechnicalFacts ? 2 : 0);
      return 11;
    case 'warm':
      if (id === 'fab') return 11;
      if (id === 'aida') return 9;
      if (id === 'pas') return 8 + problemBoost;
      return 11;
    case 'hot':
      if (id === 'aida') return 10;
      if (id === 'pas') return 9 + problemBoost;
      if (id === 'fab') return 9;
      return 11;
  }
}

/** Principle subsets per audience purpose (live-cleared entries only). */
const PRINCIPLES_BY_AUDIENCE: Record<ImageAdAudience, string[]> = {
  cold: ['schwartz-awareness-match', 'ogilvy-headline-plain', 'sugarman-curiosity-honest'],
  warm: ['schwartz-desire-channel', 'ogilvy-facts-first', 'sugarman-slide-flow'],
  hot: ['cialdini-small-step', 'cialdini-proof-needs-evidence'],
};

const AUDIENCE_PURPOSE: Record<ImageAdAudience, string> = {
  cold: 'discovery — introduce the product to people meeting it for the first time',
  warm: 'consideration — help people evaluate the product',
  hot: 'action — invite people who are ready to decide',
};

function rankIds(ids: string[], scores: Map<string, number>, order: string[]): string[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...ids].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}

/**
 * Deterministic per-audience strategy selection. Styles and
 * frameworks prefer distinct ids across the three audiences so the
 * ads differ in strategic angle, not just wording; repeats are
 * allowed only as a fallback when evidence gates leave no fresh
 * eligible id.
 */
export function selectImageAdStrategies(input: ImageAdInput): {
  strategies: AudienceStrategy[];
  provenance: ImageAdStrategyProvenance;
} {
  const evidence = assessImageAdEvidence(input);
  const liveIds = new Set(listLivePrinciples().map((principle) => principle.id));
  const rejected: RejectedCandidate[] = [];

  const audiences: ImageAdAudience[] = ['cold', 'warm', 'hot'];
  for (const audience of audiences) {
    if (!evidence.hasOffer) {
      rejected.push({
        kind: 'style',
        id: 'notification-offer',
        audience,
        reason: 'Withheld: no user-supplied genuine offer in the brief.',
      });
    }
    if (!evidence.hasTransformationEvidence) {
      rejected.push({
        kind: 'style',
        id: 'before-after',
        audience,
        reason: 'Withheld: no supplied evidence of a real transformation; bare comparatives do not qualify.',
      });
      rejected.push({
        kind: 'framework',
        id: 'bab',
        audience,
        reason: 'Withheld: no supplied evidence of a real transformation.',
      });
    }
    if (!evidence.hasTechnicalFacts) {
      rejected.push({
        kind: 'framework',
        id: 'fab',
        audience,
        reason: 'Withheld: no supplied product facts to lead from.',
      });
    }
  }

  const strategies: AudienceStrategy[] = [];
  const usedStyles = new Set<string>();
  const usedFrameworks = new Set<string>();

  for (const audience of audiences) {
    const eligibleStyles = CANONICAL_STYLE_ORDER.filter((id) => styleEligible(id, evidence));
    const styleScores = new Map(eligibleStyles.map((id) => [id, scoreStyle(id, audience, input)]));
    const rankedStyles = rankIds(eligibleStyles, styleScores, CANONICAL_STYLE_ORDER);
    const styleId = rankedStyles.find((id) => !usedStyles.has(id)) ?? rankedStyles[0];
    usedStyles.add(styleId);

    const eligibleFrameworks = CANONICAL_FRAMEWORK_ORDER.filter((id) => frameworkEligible(id, evidence));
    const frameworkScores = new Map(
      eligibleFrameworks.map((id) => [id, scoreFramework(id, audience, input, evidence)]),
    );
    const rankedFrameworks = rankIds(eligibleFrameworks, frameworkScores, CANONICAL_FRAMEWORK_ORDER);
    const frameworkId = rankedFrameworks.find((id) => !usedFrameworks.has(id)) ?? rankedFrameworks[0];
    usedFrameworks.add(frameworkId);

    const principleIds = PRINCIPLES_BY_AUDIENCE[audience].filter((id) => liveIds.has(id));

    const reasons = [
      `${audience} (${AUDIENCE_PURPOSE[audience]}): style "${styleId}" selected from evidence-eligible styles with diversity considered.`,
      `Framework "${frameworkId}" selected from evidence-eligible frameworks with diversity considered for ${audience}.`,
      `Principles ${principleIds.join(', ')} selected for the ${audience} purpose from pack ${CREATIVE_KNOWLEDGE_PACK_VERSION}.`,
    ];
    strategies.push({ audience, styleId, frameworkId, principleIds, reasons });
  }

  return {
    strategies,
    provenance: {
      knowledgePackVersion: CREATIVE_KNOWLEDGE_PACK_VERSION,
      objective: input.objective,
      evidence,
      strategies,
      rejected,
    },
  };
}

function styleLine(id: string): string {
  const entry = APPROVED_ADVERTISING_STYLES.find((style) => style.id === id);
  if (!entry) return `${id}.`;
  return `${id} (${entry.name}): ${entry.usage} Copy: ${entry.copyRules}`;
}

function frameworkLine(id: string): string {
  const entry = APPROVED_COPYWRITING_FRAMEWORKS.find((framework) => framework.id === id);
  if (!entry) return `${id}.`;
  return `${id} (${entry.name}, ${entry.structure}): ${entry.applicationRules}`;
}

function principleLine(id: string): string {
  const entry = getPrinciple(id);
  if (!entry || entry.verificationStatus === 'pending-review') return '';
  return `${id}: ${entry.instruction}`;
}

/**
 * Compact per-audience strategy section for the Muse Spark planning
 * prompt. Internal guidance only — customer-facing copy rules are
 * unchanged, and no internal labels are exposed in the UI.
 */
export function buildImageAdStrategySection(input: ImageAdInput): {
  section: string;
  provenance: ImageAdStrategyProvenance;
} {
  const { strategies, provenance } = selectImageAdStrategies(input);
  const lines: string[] = ['## Creative strategy (apply per audience; keep customer copy free of these labels)'];
  for (const strategy of strategies) {
    lines.push(
      `${strategy.audience} (${AUDIENCE_PURPOSE[strategy.audience]}):`,
      `Style — ${styleLine(strategy.styleId)}`,
      `Framework — ${frameworkLine(strategy.frameworkId)}`,
      ...strategy.principleIds.map((id) => `Principle — ${principleLine(id)}`).filter((line) => line.length > 0),
    );
  }
  if (!provenance.evidence.hasOffer) {
    lines.push('Evidence note: no genuine offer was supplied — never write offer-led copy for any ad.');
  }
  if (!provenance.evidence.hasTransformationEvidence) {
    lines.push('Evidence note: no transformation evidence was supplied — never write before/after or improvement-result copy.');
  }
  return { section: lines.join('\n'), provenance };
}
