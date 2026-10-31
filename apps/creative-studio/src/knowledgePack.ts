/**
 * SilkWeb Creative — Milestone 3A book-derived knowledge pack.
 *
 * A small, versioned set of advertising principles paraphrased from
 * widely known practitioner books. Every summary below is an original
 * editorial paraphrase written for this pack: there are no copied
 * passages, no quotations, and no page references.
 *
 * Verification honesty: pack entries carry one of three statuses.
 * - "editorial-review": an original editorial paraphrase classified
 *   for safety and planning use. Usable in live planning prompts.
 * - "pending-review": stored for completeness but NOT usable in live
 *   planning and never presented as verified.
 * - "source-verified": independently checked against the source.
 *   No entry in this pack claims this status.
 *
 * Only "editorial-review" (and, in future, "source-verified")
 * entries are ever selected for live planning prompts. Pending
 * entries are retrievable by id for inspection but excluded from
 * every planning path by listLivePrinciples().
 */

/** Version tag of this knowledge pack; recorded in planning provenance. */
export const CREATIVE_KNOWLEDGE_PACK_VERSION = 'm3a-v1';

export type PrincipleVerificationStatus =
  | 'editorial-review'
  | 'pending-review'
  | 'source-verified';

export interface CreativePrinciple {
  /** Stable identifier, never renamed once published. */
  id: string;
  /** Pack version this entry was introduced in. */
  version: string;
  /** Author attribution (person only — no quotations or page refs). */
  author: string;
  /** Source work title only. No quotations, page numbers, or claims of verification. */
  work: string;
  /** Short original-language summary (editorial paraphrase, not a quotation). */
  summary: string;
  /** Conditions under which the principle applies. */
  appliesWhen: string[];
  /** Concrete instruction for the planning model. */
  instruction: string;
  /** What the principle must never be used to justify. */
  restrictions: string;
  /** Verification tier; only non-pending entries reach live prompts. */
  verificationStatus: PrincipleVerificationStatus;
}

function reviewed(entry: Omit<CreativePrinciple, 'version' | 'verificationStatus'>): CreativePrinciple {
  return { ...entry, version: CREATIVE_KNOWLEDGE_PACK_VERSION, verificationStatus: 'editorial-review' };
}

function pending(entry: Omit<CreativePrinciple, 'version' | 'verificationStatus'>): CreativePrinciple {
  return { ...entry, version: CREATIVE_KNOWLEDGE_PACK_VERSION, verificationStatus: 'pending-review' };
}

export const CREATIVE_KNOWLEDGE_PACK: readonly CreativePrinciple[] = [
  reviewed({
    id: 'schwartz-awareness-match',
    author: 'Eugene Schwartz',
    work: 'Breakthrough Advertising',
    summary:
      'Match the message to how much the audience already knows: people meeting ' +
      'a product for the first time need orientation, while people already ' +
      'considering it can handle specifics and a direct next step.',
    appliesWhen: ['cold/discovery audiences', 'warm/consideration audiences', 'hot/action audiences'],
    instruction:
      'Cold plans orient first (what it is, who it is for); warm plans help ' +
      'comparison; hot plans ask for the decision directly.',
    restrictions: 'Never use awareness as an excuse to invent claims for any audience tier.',
  }),
  reviewed({
    id: 'schwartz-desire-channel',
    author: 'Eugene Schwartz',
    work: 'Breakthrough Advertising',
    summary:
      'Effective copy channels a want the audience already feels instead of ' +
      'trying to manufacture a brand-new want inside a single advertisement.',
    appliesWhen: ['warm/consideration audiences', 'cold/discovery audiences'],
    instruction:
      'Name the existing want in plain words (rest, ease, confidence in a ' +
      'choice) using only supplied facts; do not lecture the reader into caring.',
    restrictions: 'Never invent audience pains or desires the brief does not support.',
  }),
  reviewed({
    id: 'ogilvy-headline-plain',
    author: 'David Ogilvy',
    work: 'Ogilvy on Advertising',
    summary:
      'The headline does the heaviest lifting, so it should state the news ' +
      'plainly — what the product is and why it matters — rather than hiding ' +
      'behind wordplay.',
    appliesWhen: ['cold/discovery audiences', 'hot/action audiences'],
    instruction:
      'Write headlines that a stranger understands on first reading; keep ' +
      'cleverness only when the plain meaning survives.',
    restrictions: 'A plain headline must still use only supplied facts; plainness never licenses invention.',
  }),
  reviewed({
    id: 'ogilvy-facts-first',
    author: 'David Ogilvy',
    work: 'Ogilvy on Advertising',
    summary:
      'Strong advertising is built on homework: gather the real facts about ' +
      'the product and its buyers first, then write only what those facts support.',
    appliesWhen: ['warm/consideration audiences', 'cold/discovery audiences'],
    instruction:
      'Treat the supplied brief as the whole research file; every concrete ' +
      'claim in copy must trace back to it.',
    restrictions: 'Never present supplied marketing claims as independently tested findings.',
  }),
  reviewed({
    id: 'sugarman-slide-flow',
    author: 'Joseph Sugarman',
    work: 'The Adweek Copywriting Handbook',
    summary:
      'Copy should read like a slide: short lines in a deliberate order where ' +
      'each line earns the reader’s attention for the next one, ending at the call to action.',
    appliesWhen: ['warm/consideration audiences', 'hot/action audiences'],
    instruction:
      'Order headline, body, and CTA as one short chain (hook, reason, ask); ' +
      'cut any line the next line does not need.',
    restrictions: 'Flow must never carry the reader past what the facts support.',
  }),
  reviewed({
    id: 'sugarman-curiosity-honest',
    author: 'Joseph Sugarman',
    work: 'The Adweek Copywriting Handbook',
    summary:
      'Curiosity keeps people reading, but it has to be paid off honestly: ' +
      'tease only what the advertisement actually delivers.',
    appliesWhen: ['cold/discovery audiences'],
    instruction:
      'Open cold ads with a genuine question or inviting detail drawn from ' +
      'supplied facts; answer it within the same ad.',
    restrictions: 'No clickbait gaps, no withheld essentials, no mystery the copy never resolves.',
  }),
  reviewed({
    id: 'cialdini-proof-needs-evidence',
    author: 'Robert Cialdini',
    work: 'Influence',
    summary:
      'Claims that lean on other people — popularity, reviews, endorsements, ' +
      'results — persuade only when they are true, so they require real ' +
      'evidence before they appear in copy.',
    appliesWhen: ['warm/consideration audiences', 'hot/action audiences'],
    instruction:
      'Use people-based proof only when the brief supplies it; otherwise ' +
      'persuade with plain product facts and a clear next step.',
    restrictions:
      'Never invent testimonials, review counts, endorsements, rankings, or results.',
  }),
  reviewed({
    id: 'cialdini-small-step',
    author: 'Robert Cialdini',
    work: 'Influence',
    summary:
      'A small, concrete, low-effort next step is easier to say yes to than ' +
      'a large vague one, especially for audiences close to deciding.',
    appliesWhen: ['hot/action audiences'],
    instruction:
      'Give hot ads one specific easy action (shop, order, explore the ' +
      'launch) tied to supplied facts such as price or offer when present.',
    restrictions: 'An easy step must still be a real one; never invent urgency or scarcity.',
  }),
  pending({
    id: 'schwartz-sophistication-shift',
    author: 'Eugene Schwartz',
    work: 'Breakthrough Advertising',
    summary:
      'As buyers see more competing claims, messages need a fresh angle to ' +
      'stand out — a restatement rather than a louder repetition.',
    appliesWhen: ['cold/discovery audiences'],
    instruction: 'Not cleared for live planning use.',
    restrictions: 'Pending review: must not appear in planning prompts.',
  }),
  pending({
    id: 'cialdini-authority-borrow',
    author: 'Robert Cialdini',
    work: 'Influence',
    summary:
      'Expert or authority signals can support a message when the authority ' +
      'is real and relevant to the claim being made.',
    appliesWhen: ['warm/consideration audiences'],
    instruction: 'Not cleared for live planning use.',
    restrictions: 'Pending review: must not appear in planning prompts.',
  }),
];

/** True only for entries cleared for live planning prompts. */
export function isLivePrinciple(principle: CreativePrinciple): boolean {
  return principle.verificationStatus === 'editorial-review' || principle.verificationStatus === 'source-verified';
}

/** Principles cleared for live planning, in pack order. Pending entries are excluded. */
export function listLivePrinciples(): CreativePrinciple[] {
  return CREATIVE_KNOWLEDGE_PACK.filter(isLivePrinciple).map((entry) => ({ ...entry }));
}

/** Full entry by stable id (any status), or undefined when unknown. */
export function getPrinciple(id: string): CreativePrinciple | undefined {
  const entry = CREATIVE_KNOWLEDGE_PACK.find((principle) => principle.id === id);
  return entry === undefined ? undefined : { ...entry };
}
