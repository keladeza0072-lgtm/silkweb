/**
 * Deterministic creative evaluation for Creative Studio.
 *
 * Pure functions only — no AI service, no network, no randomness.
 * Scores derive from explicit weighted rules over the supplied
 * campaign context and the two validated concepts. Every result
 * carries a plain-language explanation of what was checked, and
 * callers must surface the "local check" disclaimer: no model
 * performed this evaluation.
 *
 * Advertising-policy concerns live in `reviewPolicy`, kept
 * separate from readiness scoring. Neither function grants legal
 * or Meta-policy approval — results say so explicitly.
 */

import type { CampaignContext } from './campaign.js';
import type { AdConcept } from './concepts.js';
import { recommendCreatives } from './recommend.js';

/** How this evaluation describes itself in user-facing copy. */
export const EVALUATION_METHOD_LABEL =
  'Local deterministic check — no model evaluated this work.';

export const POLICY_DISCLAIMER =
  'Heuristic checklist only. Not legal advice and not Meta-policy approval.';

export interface CriterionScore {
  id: string;
  label: string;
  /** Weight in overall score; all weights sum to 100. */
  weight: number;
  /** 0–100 for this criterion. */
  score: number;
  /** Concrete observation behind the score. */
  detail: string;
  /** What to do next when the score is low. */
  action: string;
}

export interface ConceptEvaluation {
  conceptId: string;
  overall: number;
  band: string;
  criteria: CriterionScore[];
  method: string;
}

export interface PolicyItem {
  id: string;
  label: string;
  status: 'pass' | 'attention';
  note: string;
}

export interface PolicyReview {
  conceptId: string;
  items: PolicyItem[];
  disclaimer: string;
}

const DISCOUNT_PATTERN = /\d+\s?%\s?off|2-for-1|buy one[\s,-]*get one|free shipping|free trial|\$\s?\d+\s*off|early-?bird|discount|promo code|coupon/i;
const GUARANTEE_PATTERN = /\b(guarantee[sd]?|guaranteed|#1\b|number one|best ever|miracle|overnight|instant results|risk-free|no risk)\b/i;
const CTA_VERBS = [
  'shop', 'get', 'try', 'learn', 'sign', 'book', 'start', 'discover',
  'join', 'buy', 'order', 'claim', 'visit', 'explore', 'grab', 'see',
];
const SENSITIVE_PATTERN = /\b(race|ethnic|religion|religious|political|sexual orientation|disability|medical condition|pregnant)\b/i;

function conceptText(concept: AdConcept): string {
  return [concept.angle, concept.headline, concept.primaryCopy, concept.cta].join('\n');
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function gradeBand(overall: number): string {
  if (overall >= 85) return 'Ready';
  if (overall >= 70) return 'Nearly ready';
  if (overall >= 50) return 'Needs work';
  return 'Blocked';
}

function scoreMessageClarity(concept: AdConcept): CriterionScore {
  const headlineLen = concept.headline.trim().length;
  const copyLen = concept.primaryCopy.trim().length;
  let score = 100;
  const notes: string[] = [];
  if (headlineLen < 8) {
    score -= 30;
    notes.push('headline is very short');
  } else if (headlineLen > 80) {
    score -= 10;
    notes.push('headline is long for paid placements');
  }
  if (copyLen < 40) {
    score -= 30;
    notes.push('primary copy is very short');
  }
  if (!concept.cta.trim()) {
    score -= 20;
    notes.push('call to action is missing');
  }
  return {
    id: 'message-clarity',
    label: 'Message is clear',
    weight: 20,
    score: clampScore(score),
    detail:
      notes.length > 0
        ? `Checked headline (${headlineLen} chars) and primary copy (${copyLen} chars): ${notes.join('; ')}.`
        : `Headline (${headlineLen} chars) and primary copy (${copyLen} chars) read as complete statements.`,
    action: 'Tighten the headline to one idea and keep primary copy to two or three sentences.',
  };
}

function scoreFactGrounding(campaign: CampaignContext, concept: AdConcept): CriterionScore {
  const text = conceptText(concept);
  const hasOffer = (campaign.offer ?? '').trim().length > 0;
  const problems: string[] = [];
  if (DISCOUNT_PATTERN.test(text) && !hasOffer) {
    problems.push('mentions a promotion with no offer in the brief');
  }
  if (GUARANTEE_PATTERN.test(text)) {
    problems.push('uses guarantee or superlative language the brief does not support');
  }
  const score = problems.length > 0 ? 35 : 95;
  return {
    id: 'fact-grounding',
    label: 'Copy stays inside supplied facts',
    weight: 20,
    score,
    detail:
      problems.length > 0
        ? `Found wording the brief does not support: ${problems.join('; ')}.`
        : 'No discount, guarantee, or superlative wording was found beyond what the brief supplies.',
    action:
      'Remove the unsupported claim, or add the missing proof (offer, fact) to the brief and regenerate.',
  };
}

function scoreCtaStrength(concept: AdConcept): CriterionScore {
  const cta = concept.cta.trim();
  const firstWord = cta.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  const hasVerb = CTA_VERBS.includes(firstWord);
  let score = 100;
  const notes: string[] = [];
  if (!cta) {
    score = 20;
    notes.push('no call to action');
  } else {
    if (!hasVerb) {
      score -= 35;
      notes.push('does not start with a clear action verb');
    }
    if (cta.length > 40) {
      score -= 15;
      notes.push('is long for a button or link');
    }
  }
  return {
    id: 'cta-strength',
    label: 'Call to action is direct',
    weight: 15,
    score: clampScore(score),
    detail:
      notes.length > 0
        ? `CTA "${cta || '(missing)'}": ${notes.join('; ')}.`
        : `CTA "${cta}" starts with an action verb and fits a button.`,
    action: 'Start the CTA with one verb (Shop, Try, Book, Learn) and keep it under 40 characters.',
  };
}

function scoreAudienceFit(campaign: CampaignContext, concept: AdConcept): CriterionScore {
  const audience = (campaign.audience ?? '').trim();
  if (!audience) {
    return {
      id: 'audience-fit',
      label: 'Audience fit',
      weight: 10,
      score: 60,
      detail: 'No audience was supplied, so fit could not be checked against named buyers.',
      action: 'Name the audience in the brief (who you want to persuade) and regenerate.',
    };
  }
  const tokens = audience.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3);
  const text = conceptText(concept).toLowerCase();
  const hits = tokens.filter((t) => text.includes(t));
  const score = hits.length > 0 ? 95 : 55;
  return {
    id: 'audience-fit',
    label: 'Audience fit',
    weight: 10,
    score,
    detail:
      hits.length > 0
        ? `Concept echoes the brief's audience wording (${hits.slice(0, 3).join(', ')}).`
        : 'Concept never echoes the brief\u2019s audience wording — it may read as generic.',
    action: 'Name the audience or their situation once in the primary copy.',
  };
}

function scoreStyleFrameworkFit(campaign: CampaignContext, concept: AdConcept): CriterionScore {
  const advice = recommendCreatives(campaign);
  const styleRank = advice.styles.findIndex((s) => s.id === concept.styleId);
  const frameworkRank = advice.frameworks.findIndex((f) => f.id === concept.frameworkId);
  const rankScore = (rank: number, total: number): number => {
    if (rank === -1) return 35;
    if (rank === 0) return 100;
    if (rank === 1) return 85;
    return Math.max(60, 85 - rank * 5 + (total > 0 ? 0 : 0));
  };
  const score = Math.round((rankScore(styleRank, advice.styles.length) + rankScore(frameworkRank, advice.frameworks.length)) / 2);
  return {
    id: 'style-framework-fit',
    label: 'Style and framework suit the brief',
    weight: 15,
    score,
    detail:
      styleRank <= 1 && frameworkRank <= 1
        ? `Style "${concept.styleId}" and framework "${concept.frameworkId}" are both top recommendations for this brief.`
        : `Style "${concept.styleId}" (rank ${styleRank + 1}) and framework "${concept.frameworkId}" (rank ${frameworkRank + 1}) are approved but not the top fits.`,
    action: 'Compare with the other concept\u2019s pairing, or adjust the brief so the pairing fits better.',
  };
}

function scoreVisualFeasibility(campaign: CampaignContext, concept: AdConcept): CriterionScore {
  const prompt = concept.photographyPrompt.toLowerCase();
  const product = campaign.product.toLowerCase();
  const productWords = product.split(/\s+/).filter((w) => w.length > 3);
  const namesProduct = productWords.some((w) => prompt.includes(w));
  const len = concept.photographyPrompt.trim().length;
  let score = 70;
  const notes: string[] = [];
  if (namesProduct) {
    score += 25;
    notes.push('names the product');
  } else {
    notes.push('never names the product');
  }
  if (len < 40) {
    score -= 20;
    notes.push('is too short to guide a shoot');
  } else if (len <= 1000) {
    score += 5;
    notes.push(`${len} chars — specific enough to shoot from`);
  }
  return {
    id: 'visual-feasibility',
    label: 'Visual direction is shootable',
    weight: 10,
    score: clampScore(score),
    detail: `Photography prompt ${notes.join('; ')}.`,
    action: 'Name the product, setting, light, and mood in one or two sentences.',
  };
}

function scoreCopyCompleteness(concept: AdConcept): CriterionScore {
  const fields: Array<[string, string]> = [
    ['angle', concept.angle],
    ['headline', concept.headline],
    ['primaryCopy', concept.primaryCopy],
    ['cta', concept.cta],
    ['visualDirection', concept.visualDirection],
    ['photographyPrompt', concept.photographyPrompt],
  ];
  const empty = fields.filter(([, v]) => !v.trim()).map(([k]) => k);
  const score = empty.length > 0 ? 40 : 95;
  return {
    id: 'copy-completeness',
    label: 'Concept is complete',
    weight: 10,
    score,
    detail:
      empty.length > 0
        ? `Missing fields: ${empty.join(', ')}.`
        : 'All six copy and direction fields are filled.',
    action: 'Fill every field before exporting — empty fields block handoff.',
  };
}

/**
 * Score one concept against the campaign context with seven
 * weighted criteria (weights sum to 100). Deterministic: the same
 * inputs always produce the same scores.
 */
export function evaluateConcept(campaign: CampaignContext, concept: AdConcept): ConceptEvaluation {
  const criteria: CriterionScore[] = [
    scoreMessageClarity(concept),
    scoreFactGrounding(campaign, concept),
    scoreCtaStrength(concept),
    scoreAudienceFit(campaign, concept),
    scoreStyleFrameworkFit(campaign, concept),
    scoreVisualFeasibility(campaign, concept),
    scoreCopyCompleteness(concept),
  ];
  const overall = Math.round(criteria.reduce((sum, c) => sum + (c.score * c.weight) / 100, 0));
  return { conceptId: concept.id, overall, band: gradeBand(overall), criteria, method: EVALUATION_METHOD_LABEL };
}

/** Score both concepts of a generation with the same rules. */
export function evaluateConcepts(
  campaign: CampaignContext,
  concepts: [AdConcept, AdConcept],
): [ConceptEvaluation, ConceptEvaluation] {
  return [evaluateConcept(campaign, concepts[0]), evaluateConcept(campaign, concepts[1])];
}

/**
 * Separate advertising-policy checklist for one concept.
 * Heuristic text checks only — a flag here means "look closely",
 * and a pass never means approved.
 */
export function reviewPolicy(campaign: CampaignContext, concept: AdConcept): PolicyReview {
  const text = conceptText(concept);
  const hasOffer = (campaign.offer ?? '').trim().length > 0;
  const items: PolicyItem[] = [];
  items.push({
    id: 'substantiated-offers',
    label: 'Offers are substantiated',
    status: DISCOUNT_PATTERN.test(text) && !hasOffer ? 'attention' : 'pass',
    note:
      DISCOUNT_PATTERN.test(text) && !hasOffer
        ? 'Concept mentions a promotion with no offer in the brief — confirm or remove it.'
        : 'No unbriefed promotion wording detected.',
  });
  items.push({
    id: 'no-guaranteed-outcomes',
    label: 'No guaranteed outcomes',
    status: GUARANTEE_PATTERN.test(text) ? 'attention' : 'pass',
    note: GUARANTEE_PATTERN.test(text)
      ? 'Concept uses guarantee or superlative language — soften it or supply proof.'
      : 'No guarantee or "#1 / best ever" language detected.',
  });
  const audienceText = `${campaign.audience ?? ''} ${text}`;
  items.push({
    id: 'respectful-targeting',
    label: 'Respectful targeting',
    status: SENSITIVE_PATTERN.test(audienceText) ? 'attention' : 'pass',
    note: SENSITIVE_PATTERN.test(audienceText)
      ? 'Copy or audience wording touches a sensitive attribute — rephrase before publishing.'
      : 'No sensitive-attribute targeting detected.',
  });
  items.push({
    id: 'honest-conversation',
    label: 'Conversation is not a fake testimonial',
    status: concept.styleId === 'chat-script' ? 'attention' : 'pass',
    note: concept.styleId === 'chat-script'
      ? 'Chat-style ads must read as illustration, never as genuine customer messages.'
      : 'Not a conversation-style concept — no testimonial risk from this style.',
  });
  return { conceptId: concept.id, items, disclaimer: POLICY_DISCLAIMER };
}

/** Policy checklists for both concepts, kept separate from scores. */
export function reviewPolicies(
  campaign: CampaignContext,
  concepts: [AdConcept, AdConcept],
): [PolicyReview, PolicyReview] {
  return [reviewPolicy(campaign, concepts[0]), reviewPolicy(campaign, concepts[1])];
}
