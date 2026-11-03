/**
 * Deterministic campaign elicitation for Milestone 1.5.
 *
 * Pure functions only — no AI service, no network, no randomness.
 * Every extraction rule below fires only on explicit textual cues, so
 * the module never invents product facts, prices, or claims: anything
 * not stated in the user's description stays `missing` and becomes a
 * clarification question (at most ELICITATION_DEFAULT_MAX_QUESTIONS
 * by default). Answered or skipped questions are never repeated; the
 * caller threads prior answers back into `analyzeBrief`.
 */
import { BRIEF_FIELDS } from './config.js';

export type BriefSource = 'supplied' | 'assumed' | 'missing';

export type BriefFieldId =
  | 'brand'
  | 'product'
  | 'audience'
  | 'objective'
  | 'offer'
  | 'creativeDirection';

export interface ElicitationQuestion {
  id: BriefFieldId;
  field: BriefFieldId;
  prompt: string;
  helper: string;
  suggestions: string[];
  skippable: boolean;
}

export interface Assumption {
  field: string;
  value: string;
  reason: string;
}

export interface ModeRecommendation {
  mode: 'product' | 'lifestyle' | 'website';
  explicit: boolean;
  reason: string;
}

export interface ReadinessItem {
  id: string;
  label: string;
  met: boolean;
  detail: string;
}

export type AnswersInput = Record<string, string | null | undefined>;
export type OverridesInput = Record<string, string | undefined>;

const FIELD_IDS: readonly BriefFieldId[] = [
  'brand',
  'product',
  'audience',
  'objective',
  'offer',
  'creativeDirection',
];

const MAX_LENGTHS: Record<BriefFieldId, number> = Object.fromEntries(
  BRIEF_FIELDS.map((field) => [field.id, field.maxLength]),
) as Record<BriefFieldId, number>;

function cap(field: BriefFieldId, value: string): string {
  return value.slice(0, MAX_LENGTHS[field]);
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sentenceAround(text: string, index: number): string {
  const before = text.lastIndexOf('.', index);
  const start = before === -1 ? 0 : before + 1;
  let end = text.length;
  for (const mark of ['.', '!', '?', ';']) {
    const at = text.indexOf(mark, index);
    if (at !== -1 && at < end) end = at;
  }
  return clean(text.slice(start, end));
}

/** Words that signal an audience phrase rather than a purpose phrase. */
const AUDIENCE_CUES = [
  'parent', 'commut', 'student', 'shopper', 'famil', 'kid', 'profession',
  'athlete', 'travel', 'foodie', 'customer', 'client', 'women', 'men',
  'teen', 'senior', 'couple', 'pet', 'runner', 'gym', 'office', 'mom',
  'dad', 'audience', 'buyer', 'renter', 'homeowner', 'tourist', 'gamer',
  'hiker', 'subscriber', 'follower',
];

const TONE_CUES =
  'bright|bold|minimal|playful|luxur|elegant|cozy|vibrant|modern|retro|fun|calm|premium|rustic|cheerful|moody|edgy|sleek|warm|fresh';

/** Bare generic nouns that carry no product fact on their own. */
const GENERIC_PRODUCTS: ReadonlySet<string> = new Set([
  'business', 'businesses', 'company', 'companies', 'service', 'services',
  'product', 'products', 'stuff', 'thing', 'things', 'something', 'anything',
  'everything', 'item', 'items',
]);

/** People nouns: never mistaken for the product after a bare "our". */
const PEOPLE_WORDS: ReadonlySet<string> = new Set([
  'customer', 'customers', 'client', 'clients', 'user', 'users',
  'member', 'members', 'team', 'teams', 'staff', 'shopper', 'shoppers',
  'audience', 'audiences', 'people', 'family', 'families', 'parent', 'parents',
  'kid', 'kids', 'commuter', 'commuters', 'student', 'students',
]);

/** Outcome verbs whose object names the campaign result or audience. */
const PURPOSE_VERB =
  'attracts?|reaches?|brings?\\s+in|wins?|drives?|increases?|boosts?|grows?|gets?|finds?';

/** Words that name a deliverable rather than an outcome. */
const DELIVERABLE_WORDS = 'ads?|advertis\\w*|campaigns?|marketing';

/** Outcome-verb tails that end an audience phrase ("…to drive trials"). */
const AUDIENCE_TAIL_CUT =
  '\\s+to\\s+(?:drive|increase|boost|launch|promote|grow|get|raise|attract|reach|win|bring|find)\\b';

/** "…and wants to …" tails that end a product or audience phrase. */
const WANT_TAIL_CUT = '\\s+and\\s+(?:want|need|plan|aim|hope|would|will|wish)\\b';

/** Trim a raw product capture to the thing being sold. */
function cleanProduct(raw: string): string {
  let candidate = clean(raw);
  candidate = candidate.split(new RegExp(WANT_TAIL_CUT, 'i'))[0];
  candidate = candidate.split(/\s+for\s+/i)[0];
  candidate = candidate.split(new RegExp(`\\s+that\\s+(?:${PURPOSE_VERB})\\b`, 'i'))[0];
  candidate = clean(candidate);
  const bare = candidate
    .replace(/^(?:my|our|your|their|this|that|these|those|the|a|an)\s+/i, '')
    .toLowerCase();
  if (!candidate || GENERIC_PRODUCTS.has(bare)) return '';
  return candidate;
}

/** Trim a raw audience capture to the people being reached. */
function cleanAudience(raw: string): string {
  let candidate = clean(raw);
  candidate = candidate.split(new RegExp(WANT_TAIL_CUT, 'i'))[0];
  candidate = candidate.split(new RegExp(AUDIENCE_TAIL_CUT, 'i'))[0];
  return clean(candidate);
}

/** Capitalize a captured outcome phrase without altering its facts. */
function cleanObjective(raw: string): string {
  const phrase = clean(raw);
  if (!phrase) return '';
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * Extract only explicitly stated campaign facts from free text.
 * Conservative by design: ambiguous phrasing yields `missing`, never
 * a guess. Returned sources are `supplied` (matched) or `missing`.
 */
export function extractFromDescription(description: string): {
  values: Partial<Record<BriefFieldId, string>>;
  sources: Record<BriefFieldId, BriefSource>;
} {
  const values: Partial<Record<BriefFieldId, string>> = {};
  const sources: Record<BriefFieldId, BriefSource> = {
    brand: 'missing',
    product: 'missing',
    audience: 'missing',
    objective: 'missing',
    offer: 'missing',
    creativeDirection: 'missing',
  };
  const text = clean(description);
  if (!text) return { values, sources };

  const set = (field: BriefFieldId, value: string): void => {
    const trimmed = clean(value);
    if (trimmed) {
      values[field] = cap(field, trimmed);
      sources[field] = 'supplied';
    }
  };

  // Brand: "Acme launches …", "brand is/called Acme", "… by Acme".
  let match =
    /^([A-Z][\w&'’.-]{1,40}(?:\s+[A-Z][\w&'’.-]{1,40}){0,2})\s+(?:launches|is launching|presents|introduces|is introducing)\b/.exec(
      text,
    ) ??
    /\bbrand\s+(?:is\s+|called\s+)?([A-Z][\w&'’.-]{1,40}(?:\s+[A-Z][\w&'’.-]{1,40}){0,2})/i.exec(text) ??
    /\bby\s+([A-Z][\w&'’.-]{1,40}(?:\s+[A-Z][\w&'’.-]{1,40}){0,2})/.exec(text);
  if (match?.[1]) set('brand', match[1]);

  // Product: "I/we sell …", "sells/offers/makes …",
  // "selling/launching/our new …". "Advertise" is deliberately not a
  // product verb: "advertise my business" names no product. Bare
  // generic nouns ("my business") and people nouns after a bare
  // "our" ("for our customers") stay missing.
  const productMatch =
    /\b(?:i|we)\s+(?:sell|sells|offer|offers|make|makes)\s+([^.,;!?]{3,80})/i.exec(text) ??
    /\b(?:sells?|selling|offers?|offering|makes?|launching|introducing|introduces|launch of|our new|our)\s+([^.,;!?]{3,80})/i.exec(
      text,
    );
  if (productMatch?.[1]) {
    const product = cleanProduct(productMatch[1]);
    if (product && !/^(new|brand|latest)\s*$/i.test(product)) {
      const usedBareOur = /^our\s+/i.test(productMatch[0]);
      const firstWord = product.split(/\s+/)[0].toLowerCase();
      if (!(usedBareOur && PEOPLE_WORDS.has(firstWord))) set('product', product);
    }
  }

  // Audience: explicit targeting verbs, or a "for …" phrase with an
  // audience cue word so purpose phrases ("for launch") are ignored.
  // Trailing outcome tails ("…to drive trials") are trimmed.
  match = /\b(?:targeting|aimed at|designed for|made for)\s+([^.,;!?]{3,100})/i.exec(text);
  if (match?.[1]) {
    const audience = cleanAudience(match[1]);
    if (audience) set('audience', audience);
  } else {
    match = /\bfor\s+([^.,;!?]{3,100})/i.exec(text);
    const candidate = match?.[1] ? cleanAudience(match[1]) : '';
    if (candidate && AUDIENCE_CUES.some((cue) => candidate.toLowerCase().includes(cue))) {
      set('audience', candidate);
    }
  }
  // Outcome verbs name their audience too: "ads that attract new customers".
  if (sources.audience === 'missing') {
    const attracted = new RegExp(
      '\\b(?:attract|attracts|bring\\s+in|brings\\s+in|reach|reaches|win\\s+over|find|finds)\\s+([^.,;!?]{3,100})',
      'i',
    ).exec(text);
    const named = attracted?.[1] ? cleanAudience(attracted[1]) : '';
    if (named && AUDIENCE_CUES.some((cue) => named.toLowerCase().includes(cue))) {
      set('audience', named);
    }
  }

  // Objective: an outcome, never a deliverable. Purpose clauses
  // ("ads that attract new customers") resolve first; goal verbs
  // ("I want to grow signups") resolve next. A capture that only
  // names ads or campaigns ("want ads for my bakery") stays missing.
  const purpose = new RegExp(`\\bthat\\s+(${PURPOSE_VERB})\\s+([^.,;!?]{3,120})`, 'i').exec(text);
  if (purpose?.[2]) {
    set('objective', cleanObjective(`${purpose[1].replace(/\s+/g, ' ')} ${purpose[2]}`));
  } else {
    match =
      /\b(?:(?:my|our)\s+goal is|goal is|objective is|(?:we|i)\s+wants?|wants?\s+to|aim(?:ing)?\s+to|trying\s+to|hoping\s+to|to\s+(?:drive|increase|boost|launch|promote|grow|get|raise|attract|reach|win|bring|find))\s+([^.,;!?]{3,120})/i.exec(
        text,
      );
    if (match?.[1]) {
      const phrase = clean(match[1]);
      if (phrase) {
        if (new RegExp(`\\b(?:${DELIVERABLE_WORDS})\\b`, 'i').test(phrase)) {
          const tail = new RegExp(`(${PURPOSE_VERB})\\s+([^.,;!?]{2,100})`, 'i').exec(phrase);
          if (tail?.[0]) set('objective', cleanObjective(tail[0]));
        } else {
          set('objective', cleanObjective(phrase));
        }
      }
    }
  }

  // Offer: promo patterns only — never invent a discount.
  const offerAt = text.search(
    /\d+\s?%\s?off|2-for-1|buy one[\s,-]*get one|free shipping|free trial|\$\s?\d+\s*off|early-?bird/i,
  );
  if (offerAt !== -1) set('offer', sentenceAround(text, offerAt));

  // Creative direction: the sentence carrying the most tone cue words
  // (last wins ties), so a leading product sentence never shadows the
  // actual vibe note. Tone words match with suffixes ("luxurious").
  // Falls back to explicit tone/vibe/look notes.
  const toneRe = new RegExp(`\\b(?:${TONE_CUES})\\w*\\b`, 'gi');
  const sentences = text.split(/(?<=[.!?;])\s+/).map((s) => clean(s)).filter(Boolean);
  let best: string | null = null;
  let bestHits = 0;
  for (const sentence of sentences) {
    const hits = sentence.match(toneRe)?.length ?? 0;
    if (hits > 0 && hits >= bestHits) {
      best = sentence;
      bestHits = hits;
    }
  }
  if (best) {
    set('creativeDirection', best);
  } else {
    match = /\b(?:tone|vibe|style|feel|look|mood)(?:\s+is|\s*:)?\s+([^.,;!?]{3,200})/i.exec(text);
    if (match?.[0]) set('creativeDirection', match[0]);
  }

  return { values, sources };
}

/**
 * Question prompts and helpers. Suggestions are intentionally empty
 * here: static cross-campaign examples (coffee, fitness apps, mugs)
 * were shown to be unrelated to the user's campaign, so
 * `analyzeBrief` attaches only suggestions grounded in the current
 * campaign context — or none at all when there is no context to
 * ground them in. Brand and offer entries are retained for API
 * compatibility but are no longer asked during elicitation: both
 * stay optional until the requested generation action requires them.
 */
export const QUESTION_BANK: readonly ElicitationQuestion[] = [
  {
    id: 'product',
    field: 'product',
    prompt: 'What product or service is this campaign for?',
    helper: 'Name the thing being advertised — one short phrase is enough.',
    suggestions: [],
    skippable: true,
  },
  {
    id: 'audience',
    field: 'audience',
    prompt: 'Who should this campaign reach?',
    helper: 'Describe the people you want to persuade, not the goal.',
    suggestions: [],
    skippable: true,
  },
  {
    id: 'objective',
    field: 'objective',
    prompt: 'What should the campaign achieve?',
    helper: 'One measurable outcome, e.g. trial, signups, or sales.',
    suggestions: [],
    skippable: true,
  },
  {
    id: 'brand',
    field: 'brand',
    prompt: 'Which brand is behind the campaign?',
    helper: 'The name that appears on the ad and landing page.',
    suggestions: [],
    skippable: true,
  },
  {
    id: 'offer',
    field: 'offer',
    prompt: 'Is there an offer to feature?',
    helper: 'A discount or perk — skip this if there is none.',
    suggestions: [],
    skippable: true,
  },
];

/** Accepted-field order kept for API compatibility (/api/config). */
export const QUESTION_ORDER: readonly BriefFieldId[] = [
  'product',
  'audience',
  'objective',
  'brand',
  'offer',
];

/**
 * Next-action relevance order for clarification. Only these fields
 * can block producing the next step (creative directions): brand,
 * offer, and precise demographics stay optional until the requested
 * generation action genuinely requires them.
 */
const ASK_ORDER: readonly BriefFieldId[] = ['product', 'objective', 'audience'];

/** Hard ceiling on clarification questions per campaign interaction. */
export const MAX_CAMPAIGN_QUESTIONS = 3;

const CHANNEL_NAMES: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /instagram/i, label: 'Instagram' },
  { pattern: /tiktok/i, label: 'TikTok' },
  { pattern: /facebook/i, label: 'Facebook' },
  { pattern: /youtube/i, label: 'YouTube' },
  { pattern: /google\b/i, label: 'Google' },
];

function channelMention(description: string): string | null {
  for (const channel of CHANNEL_NAMES) {
    if (channel.pattern.test(description)) return channel.label;
  }
  return null;
}

function shortProduct(values: Partial<Record<BriefFieldId, string>>): string {
  const product = clean(values.product ?? '');
  if (!product) return '';
  return product.length > 40 ? `${product.slice(0, 40).trim()}…` : product;
}

/**
 * Suggestions grounded in the current campaign context, or an empty
 * list when nothing known can ground them. Every suggestion reuses
 * the user's own product or channel wording — never an unrelated
 * example product or brand.
 */
export function suggestionsFor(
  field: BriefFieldId,
  values: Partial<Record<BriefFieldId, string>>,
  description: string,
): string[] {
  const product = shortProduct(values);
  if (!product) return [];
  if (field === 'objective') {
    const grounded = [`Attract new customers to ${product}`, `Drive trial of ${product}`];
    const channel = channelMention(description);
    if (channel) grounded.push(`Grow ${channel} audience for ${product}`);
    return grounded.slice(0, 3);
  }
  if (field === 'audience') {
    return [`People shopping for ${product}`, `New customers discovering ${product}`];
  }
  return [];
}

export const DEFAULT_STYLE_ID = 'problem-solution';
export const DEFAULT_PHOTOGRAPHY_MODE = 'product' as const;

const WEBSITE_CUES = ['website', 'landing page', 'homepage', 'hero banner', 'site hero', 'web banner'];
const LIFESTYLE_CUES = [
  'lifestyle', 'in use', 'people', 'wearing', 'outdoor', 'street', 'home setting', 'in the wild',
];
const PRODUCT_CUES = [
  'product shot', 'packaging', 'studio', 'bottle', 'close-up', 'closeup', 'white background', 'packshot',
];

/** Recommend a photography mode from explicit setting cues; otherwise default. */
export function recommendPhotographyMode(
  description: string,
  values?: Partial<Record<BriefFieldId, string>>,
): ModeRecommendation {
  const haystack = `${description} ${values?.creativeDirection ?? ''} ${values?.product ?? ''}`.toLowerCase();
  if (WEBSITE_CUES.some((cue) => haystack.includes(cue))) {
    return {
      mode: 'website',
      explicit: true,
      reason: 'Description mentions a website or hero setting, so Website framing fits.',
    };
  }
  if (LIFESTYLE_CUES.some((cue) => haystack.includes(cue))) {
    return {
      mode: 'lifestyle',
      explicit: true,
      reason: 'Description mentions people or a real-life setting, so Lifestyle fits.',
    };
  }
  if (PRODUCT_CUES.some((cue) => haystack.includes(cue))) {
    return {
      mode: 'product',
      explicit: true,
      reason: 'Description mentions a product or studio shot, so Product fits.',
    };
  }
  return {
    mode: DEFAULT_PHOTOGRAPHY_MODE,
    explicit: false,
    reason: 'No setting cues in the description — defaulted to Product. Change it under advanced settings.',
  };
}

export interface AnalyzedBrief {
  values: Record<BriefFieldId, string>;
  sources: Record<BriefFieldId, BriefSource>;
  questions: ElicitationQuestion[];
  totalMissing: number;
  recommendedPhotographyMode: ModeRecommendation;
  recommendedStyleId: string;
  assumptions: Assumption[];
  readiness: ReadinessItem[];
}

/**
 * Merge description extraction with prior answers (custom or suggested)
 * and explicit review-stage overrides. Keys present in `answers` —
 * including skips (`null`) — are settled and never asked again.
 */
export function analyzeBrief(options: {
  description: string;
  answers?: AnswersInput;
  overrides?: OverridesInput;
  maxQuestions?: number;
}): AnalyzedBrief {
  const { description } = options;
  const answers = options.answers ?? {};
  const overrides = options.overrides ?? {};
  const maxQuestions = options.maxQuestions ?? 3;

  const extracted = extractFromDescription(description);
  const values: Record<BriefFieldId, string> = {
    brand: extracted.values.brand ?? '',
    product: extracted.values.product ?? '',
    audience: extracted.values.audience ?? '',
    objective: extracted.values.objective ?? '',
    offer: extracted.values.offer ?? '',
    creativeDirection: extracted.values.creativeDirection ?? '',
  };
  const sources: Record<BriefFieldId, BriefSource> = { ...extracted.sources };

  for (const field of FIELD_IDS) {
    const override = overrides[field];
    if (typeof override === 'string' && clean(override)) {
      values[field] = cap(field, clean(override));
      sources[field] = 'supplied';
      continue;
    }
    const answer = answers[field];
    if (typeof answer === 'string' && clean(answer)) {
      values[field] = cap(field, clean(answer));
      sources[field] = 'supplied';
    }
  }

  const settled = (field: BriefFieldId): boolean =>
    values[field].length > 0 || field in answers || field in overrides;

  // Next-action relevance: only fields that block the next step are
  // asked, in relevance order. Answered or skipped questions (keys
  // present in `answers`/`overrides`) are never repeated. The
  // lifetime cap holds across the whole interaction: questions
  // already settled through answers consume the same budget of
  // MAX_CAMPAIGN_QUESTIONS, so follow-up calls can only add what
  // remains — the total across every turn never exceeds three.
  const missing = ASK_ORDER.filter((field) => !settled(field));
  const settledCount = FIELD_IDS.filter(
    (field) => field in answers || field in overrides,
  ).length;
  const remaining = Math.max(
    0,
    Math.min(MAX_CAMPAIGN_QUESTIONS, maxQuestions) - settledCount,
  );
  const questions = missing.slice(0, remaining).map((field) => {
    const entry = QUESTION_BANK.find((question) => question.field === field)!;
    return {
      ...entry,
      suggestions: suggestionsFor(field, values, description),
    };
  });

  const mode = recommendPhotographyMode(description, values);
  const assumptions: Assumption[] = [
    {
      field: 'styleId',
      value: DEFAULT_STYLE_ID,
      reason: 'Default preference — Problem vs. Solution fits most campaigns; change it under creative preferences.',
    },
    {
      field: 'photographyMode',
      value: mode.mode,
      reason: mode.reason,
    },
  ];

  return {
    values,
    sources,
    questions,
    totalMissing: missing.length,
    recommendedPhotographyMode: mode,
    recommendedStyleId: DEFAULT_STYLE_ID,
    assumptions,
    readiness: evaluateReadiness(values),
  };
}

/**
 * Seven-criterion brief-completeness checklist. Deterministic and
 * local: it measures what the brief contains, never model quality.
 * Real model scoring stays disconnected in this milestone.
 */
export function evaluateReadiness(values: Record<BriefFieldId, string>): ReadinessItem[] {
  const has = (field: BriefFieldId): boolean => values[field].trim().length > 0;
  return [
    {
      id: 'brand',
      label: 'Brand is named',
      met: has('brand'),
      detail: has('brand') ? 'Brand supplied.' : 'Missing — optional for now; add it at the review step.',
    },
    {
      id: 'product',
      label: 'Product is described',
      met: has('product'),
      detail: has('product') ? 'Product supplied.' : 'Missing — asked during clarification.',
    },
    {
      id: 'audience',
      label: 'Audience is defined',
      met: has('audience'),
      detail: has('audience') ? 'Audience supplied.' : 'Missing — asked during clarification.',
    },
    {
      id: 'objective',
      label: 'Objective is measurable',
      met: has('objective'),
      detail: has('objective') ? 'Objective supplied.' : 'Missing — asked during clarification.',
    },
    {
      id: 'enrichment',
      label: 'Offer or creative direction adds punch',
      met: has('offer') || has('creativeDirection'),
      detail:
        has('offer') || has('creativeDirection')
          ? 'Enrichment supplied.'
          : 'Optional — skipped offers never block progress.',
    },
    {
      id: 'style',
      label: 'Advertising style chosen',
      met: true,
      detail: 'Defaults to Problem vs. Solution — adjustable under creative preferences.',
    },
    {
      id: 'photography',
      label: 'Photography mode fits the brief',
      met: true,
      detail: 'Auto-recommended from setting cues — adjustable under advanced settings.',
    },
  ];
}

/** Advertising policy reminders shown next to the (disabled) review. */
export const POLICY_CHECKS: readonly string[] = [
  'Only supplied brief facts are used — no invented prices, discounts, or claims.',
  'No before/after or guaranteed-result language.',
  'No targeting of sensitive personal attributes.',
  'Landing-page copy repeats only brief-approved wording.',
];

const ANALYZABLE_FIELDS: ReadonlySet<string> = new Set([...QUESTION_ORDER, 'creativeDirection']);

export interface AnalyzeInputValidation {
  ok: boolean;
  issues: { field: string; message: string }[];
}

/** Validate the /api/elicit/analyze request body (loops back locally). */
export function validateAnalyzeInput(body: unknown): AnalyzeInputValidation {
  const issues: { field: string; message: string }[] = [];
  if (typeof body !== 'object' || body === null) {
    return { ok: false, issues: [{ field: 'body', message: 'Request body must be a JSON object.' }] };
  }
  const record = body as Record<string, unknown>;
  if (typeof record.description !== 'string' || !clean(record.description)) {
    issues.push({ field: 'description', message: 'A campaign description is required.' });
  } else if (record.description.length > 2000) {
    issues.push({ field: 'description', message: 'Description must be 2000 characters or fewer.' });
  }
  for (const key of ['answers', 'overrides'] as const) {
    const group = record[key];
    if (group === undefined) continue;
    if (typeof group !== 'object' || group === null || Array.isArray(group)) {
      issues.push({ field: key, message: `${key} must be an object of field names to text answers.` });
      continue;
    }
    for (const [field, value] of Object.entries(group)) {
      if (!ANALYZABLE_FIELDS.has(field)) {
        issues.push({ field: key, message: `Unknown field "${field}".` });
      } else if (key === 'answers' && value === null) {
        continue; // skipped question — settled, never repeated
      } else if (typeof value !== 'string') {
        issues.push({ field: key, message: `Answer for "${field}" must be text or null (skip).` });
      } else if (value.length > 500) {
        issues.push({ field: key, message: `Answer for "${field}" must be 500 characters or fewer.` });
      }
    }
  }
  if (record.maxQuestions !== undefined) {
    const n = record.maxQuestions;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 3) {
      issues.push({ field: 'maxQuestions', message: 'maxQuestions must be an integer from 0 to 3.' });
    }
  }
  return { ok: issues.length === 0, issues };
}
