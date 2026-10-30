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
];

const TONE_CUES =
  'bright|bold|minimal|playful|luxur|elegant|cozy|vibrant|modern|retro|fun|calm|premium|rustic|cheerful|moody|edgy|sleek|warm|fresh';

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

  // Product: "selling/launching/our new …" — strip a trailing "for …" clause.
  match =
    /\b(?:selling|launching|introducing|introduces|launch of|our new|our)\s+([^.,;!?]{3,80})/i.exec(text);
  if (match?.[1]) {
    const product = clean(match[1].split(/\s+for\s+/i)[0]);
    if (product && !/^(new|brand|latest)\s*$/i.test(product)) set('product', product);
  }

  // Audience: explicit targeting verbs, or a "for …" phrase with an
  // audience cue word so purpose phrases ("for launch") are ignored.
  match = /\b(?:targeting|aimed at|designed for|made for)\s+([^.,;!?]{3,100})/i.exec(text);
  if (match?.[1]) {
    set('audience', match[1]);
  } else {
    match = /\bfor\s+([^.,;!?]{3,100})/i.exec(text);
    const candidate = match?.[1] ? clean(match[1]) : '';
    if (candidate && AUDIENCE_CUES.some((cue) => candidate.toLowerCase().includes(cue))) {
      set('audience', candidate);
    }
  }

  // Objective: goal verbs ("drive more signups", "goal is …").
  match =
    /\b(?:goal is|objective is|we want(?: to)?|aim(?:ing)? to|to (?:drive|increase|boost|launch|promote|grow|get|raise))\s+([^.,;!?]{3,120})/i.exec(
      text,
    );
  if (match?.[1]) {
    const phrase = clean(match[1]);
    if (phrase) set('objective', phrase.charAt(0).toUpperCase() + phrase.slice(1));
  }

  // Offer: promo patterns only — never invent a discount.
  const offerAt = text.search(
    /\d+\s?%\s?off|2-for-1|buy one[\s,-]*get one|free shipping|free trial|\$\s?\d+\s*off|early-?bird/i,
  );
  if (offerAt !== -1) set('offer', sentenceAround(text, offerAt));

  // Creative direction: tone cue words or explicit tone/vibe/look notes.
  const toneAt = text.search(new RegExp(`\\b(?:${TONE_CUES})\\b`, 'i'));
  if (toneAt !== -1) {
    set('creativeDirection', sentenceAround(text, toneAt));
  } else {
    match = /\b(?:tone|vibe|style|feel|look|mood)(?:\s+is|\s*:)?\s+([^.,;!?]{3,200})/i.exec(text);
    if (match?.[0]) set('creativeDirection', match[0]);
  }

  return { values, sources };
}

export const QUESTION_BANK: readonly ElicitationQuestion[] = [
  {
    id: 'product',
    field: 'product',
    prompt: 'What product or service is this campaign for?',
    helper: 'Name the thing being advertised — one short phrase is enough.',
    suggestions: [
      'Cold-brew coffee cans',
      'A mobile fitness app',
      'Handmade ceramic mugs',
      'A weekend farmers market',
    ],
    skippable: true,
  },
  {
    id: 'audience',
    field: 'audience',
    prompt: 'Who should this campaign reach?',
    helper: 'Describe the people you want to persuade, not the goal.',
    suggestions: [
      'Commuters aged 25–40',
      'Busy parents aged 28–45',
      'College students',
      'First-time home buyers',
    ],
    skippable: true,
  },
  {
    id: 'objective',
    field: 'objective',
    prompt: 'What should the campaign achieve?',
    helper: 'One measurable outcome, e.g. trial, signups, or sales.',
    suggestions: [
      'Drive launch-week trial',
      'Grow newsletter signups',
      'Boost holiday sales',
      'Increase store foot traffic',
    ],
    skippable: true,
  },
  {
    id: 'brand',
    field: 'brand',
    prompt: 'Which brand is behind the campaign?',
    helper: 'The name that appears on the ad and landing page.',
    suggestions: ['Acme Coffee', 'Northwind Outfitters', 'Brightline Studio'],
    skippable: true,
  },
  {
    id: 'offer',
    field: 'offer',
    prompt: 'Is there an offer to feature?',
    helper: 'A discount or perk — skip this if there is none.',
    suggestions: [
      '20% off launch weekend',
      'Free shipping over $50',
      '2-for-1 opening weekend',
    ],
    skippable: true,
  },
];

/** Priority order for missing-field questions. */
export const QUESTION_ORDER: readonly BriefFieldId[] = [
  'product',
  'audience',
  'objective',
  'brand',
  'offer',
];

export const DEFAULT_STYLE_ID = 'style-slot-a';
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

  const missing = QUESTION_ORDER.filter((field) => !settled(field));
  const questions = missing
    .slice(0, Math.max(0, Math.min(5, maxQuestions)))
    .map((field) => QUESTION_BANK.find((entry) => entry.field === field)!)
    .filter(Boolean);

  const mode = recommendPhotographyMode(description, values);
  const assumptions: Assumption[] = [
    {
      field: 'styleId',
      value: DEFAULT_STYLE_ID,
      reason: 'Advanced setting — style slots are optional until the final style library lands.',
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
      detail: has('brand') ? 'Brand supplied.' : 'Missing — asked during clarification.',
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
      detail: 'Defaults to Style A (temporary slot) — adjustable under advanced settings.',
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
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 5) {
      issues.push({ field: 'maxQuestions', message: 'maxQuestions must be an integer from 0 to 5.' });
    }
  }
  return { ok: issues.length === 0, issues };
}
