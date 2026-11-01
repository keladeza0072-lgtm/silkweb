/**
 * SilkWeb Image Ads — Milestone 2 creative planning adapter.
 *
 * Muse Spark 1.3 owns creative strategy and copy. This module builds
 * the planning prompt, calls Muse exactly once per generation (no
 * retries), and strictly validates the structured output: exactly
 * three plans covering the internal cold / warm / hot audiences.
 *
 * No live network happens in tests — callers inject a mock fetch.
 */

import type { ImageAdInput, ImageAdObjective } from './imageAds.js';
import { selectCreativeDirectorReferences } from './creativeDirector.js';
import { selectVisualStudyPairs } from './creativeVisualPairing.js';
import { COPY_INTELLIGENCE_VERSION } from './creativeCopyIntelligence.js';
import {
  MUSE_RESPONSES_ENDPOINT,
  MUSE_SPARK_MODEL,
  resolveModelApiKey,
} from './provider.js';
import {
  buildImageAdStrategySection,
  type ImageAdStrategyProvenance,
} from './imageAdStrategy.js';

export type ImageAdAudience = 'cold' | 'warm' | 'hot';

export interface PlannedImageAd {
  id: string;
  audience: ImageAdAudience;
  angle: string;
  headline: string;
  body: string;
  cta: string;
  visualPrompt: string;
}

export interface ImageAdPlanIssue {
  field: string;
  message: string;
}

export const IMAGE_AD_PLAN_COUNT = 3;
export const MAX_PLAN_PROMPT_CHARS = 8000;
export const MAX_PLAN_RESPONSE_BYTES = 32 * 1024;
export const DEFAULT_PLAN_TIMEOUT_MS = 15_000;

const FIELD_LIMITS: Record<keyof Omit<PlannedImageAd, 'audience'>, number> = {
  id: 64,
  angle: 200,
  headline: 120,
  body: 500,
  cta: 80,
  visualPrompt: 1000,
};

function objectiveLine(objective: ImageAdObjective['id']): string {
  switch (objective) {
    case 'drive-sales':
      return 'Drive Sales: turn existing interest into orders with a clear action.';
    case 'build-awareness':
      return 'Build Awareness: introduce the product widely with a memorable first impression.';
    case 'launch-product':
      return 'Launch a Product: introduce the product compellingly; this objective alone does NOT establish that the product is new or just released.';
    default:
      return objective;
  }
}

/**
 * Planning prompt for Muse Spark 1.3. Internal strategies only:
 * cold (discovery), warm (consideration), hot (action). The brief is
 * sent only as this request's input and the model is asked not to
 * retain it. Only supplied facts may appear in copy.
 */
/**
 * Internal provenance record for one planning-prompt build: pack
 * version, selected style/framework/principle ids with reasons, and
 * rejected evidence-dependent candidates. Recorded in memory only —
 * never part of the customer response payload and never shown in
 * the UI.
 */
export interface RecordedPlanProvenance {
  at: string;
  provenance: ImageAdStrategyProvenance;
}

const PROVENANCE_LOG: RecordedPlanProvenance[] = [];
const MAX_PROVENANCE_ENTRIES = 50;

function recordPlanProvenance(provenance: ImageAdStrategyProvenance): void {
  PROVENANCE_LOG.push({ at: new Date().toISOString(), provenance });
  while (PROVENANCE_LOG.length > MAX_PROVENANCE_ENTRIES) PROVENANCE_LOG.shift();
}

/** Most recently recorded planning provenance, or undefined when none. */
export function lastImageAdPlanProvenance(): RecordedPlanProvenance | undefined {
  const entry = PROVENANCE_LOG[Math.max(0, PROVENANCE_LOG.length - 1)];
  return entry === undefined ? undefined : { at: entry.at, provenance: entry.provenance };
}

/** Copy of the in-memory planning provenance log (newest last). */
export function recentImageAdPlanProvenance(): RecordedPlanProvenance[] {
  return PROVENANCE_LOG.map((entry) => ({ at: entry.at, provenance: entry.provenance }));
}

/** Clear the in-memory planning provenance log (tests). */
export function clearImageAdPlanProvenance(): void {
  PROVENANCE_LOG.length = 0;
}

const PLAN_SAFETY_LINES: readonly string[] = [
  'You plan three image advertisements for SilkWeb Creative Studio.',
  'Return EXACTLY three plans as a single JSON array — no prose, no markdown, no extra text.',
  'Plan 1 must have audience "cold" (discovery: introduce the product).',
  'Plan 2 must have audience "warm" (consideration: help evaluation).',
  'Plan 3 must have audience "hot" (action: invite a decision now).',
  'Adapt all three to the campaign objective below. Never imply a product has just launched solely because the objective is Launch Product.',
  'Each plan object must contain exactly these string fields:',
  'id, audience, angle, headline, body, cta, visualPrompt.',
  'The three headlines, bodies, and angles must all differ from each other.',
  'Each ad must take a different strategic angle for its audience (discovery vs consideration vs action) — not merely different wording.',
  'Use ONLY the supplied facts. Never invent discounts, prices, specifications,',
  'testimonials, endorsements, deadlines, scarcity claims, or before-and-after results.',
  'A price or offer may appear in copy ONLY when it is listed in the supplied facts.',
  'Treat user-provided claims as unverified: repeat them plainly, never strengthen them.',
  'Never include SilkWeb branding in headlines, bodies, or CTAs.',
  'visualPrompt must describe a distinct photographic composition (subject, setting, light, mood)',
  'at 4:5 portrait ratio with generous space for copy; no rendered text in the image.',
  'Use this brief only to answer this request; do not store, reuse, or disclose it beyond this response.',
];

/**
 * Planning prompt plus its internal provenance. The strategy section
 * (per-audience style, framework, and knowledge-pack guidance) is
 * inserted between the safety instructions and the supplied facts.
 * The prompt budget guard truncates only the facts tail — safety
 * instructions and strategy guidance are never cut — and marks any
 * truncation explicitly instead of silently dropping text.
 */
export function buildImageAdPlanPromptWithProvenance(input: ImageAdInput): {
  prompt: string;
  provenance: ImageAdStrategyProvenance;
} {
  const product = input.productName.length > 0 ? input.productName : 'the pictured product';
  const facts: string[] = [`Product: ${product}`, `Objective: ${objectiveLine(input.objective)}`];
  if (input.differentiator) facts.push(`Differentiator: ${input.differentiator}`);
  if (input.price) facts.push(`Price: ${input.price}${input.currency ? ` ${input.currency}` : ''}`);
  if (input.specialOffer) facts.push(`Special offer (genuine, user-supplied): ${input.specialOffer}`);
  facts.push(`Product photo supplied: ${input.upload ? 'yes (reference-guided imagery preferred)' : 'no — do not fabricate branded appearance'}`);
  const { section, provenance } = buildImageAdStrategySection(input);
  const directorSection = process.env.SILKWEB_CREATIVE_DIRECTOR === 'on'
    ? (() => {
      const selection = selectCreativeDirectorReferences(input);
      // Compact director guidance: full descriptions live in the registry
      // and remain available for the image-generation stage. This section
      // must leave room for the strategy pack and all customer facts.
      const short = (value: string, max = 120): string =>
        value.length <= max ? value : value.slice(0, max).replace(/\s+\S*$/, '') + '…';
      const rows = selection.selections.map((r, i) =>
        'Ad '+(i+1)+' '+r.audience+' '+r.referenceId+': '+short(r.interaction,155)
      );
      return [
        '## SilkWeb Creative Director — ' + COPY_INTELLIGENCE_VERSION,
        'Apply Schwartz-style existing desire and awareness to make every headline an attention-grabbing, specific persuasive hook, not a generic announcement.',
        'Distinct persuasive reasons: desire (cold), consideration (warm), decision (hot); not literal Schwartz stages.',
        'Reject generic openings: What is new from; Considering a; Hey - it is here; take a first look; just announced; come see.',
        'Cialdini: social proof, authority, urgency, scarcity, reciprocity and numeric claims REQUIRE supplied supporting evidence. Never manufacture them.',
        'INTERNAL HEADLINE COMPETITION: Privately draft at least five meaningfully different headlines for EACH ad (desire, problem/tension, surprising contrast, curiosity with honest payoff, clear benefit). Score each for scroll-stopping quality, specificity, reader relevance, originality, and factual support. Do not return candidates or scores; return only the strongest credible headline for each of the three ads.',
        'SELF-CRITIQUE: Reject generic questions (Want a simple way to...), vague problem fragments (A low battery in the middle of the day.), and self-referential launches (Let us take a minute with the new launch). Reject the first serviceable sentence. Ban slogan-like filler such as Power to carry your day, Take power along, Small thing Big day, designed for everyday carry. Prefer a real human situation and a clear why-care.',
        'COHERENCE: Each winning headline must earn its supporting body copy and action. Keep language natural, fresh, precise and easy to read over an actual photograph.',
        'Write factual, original copy; no copied advertisements.',
        ...rows,
        'Visual studies: ' + selectVisualStudyPairs(input).map(p => p.audience+'='+p.referenceId).join(' ; '),
      ].join('\n');
    })()
    : '';
  recordPlanProvenance(provenance);
  const head = [...PLAN_SAFETY_LINES, '', section, ...(directorSection ? ['', directorSection] : []), '', '## Supplied facts'].join('\n');
  const room = MAX_PLAN_PROMPT_CHARS - head.length - '\n'.length - ' [facts truncated to fit prompt budget]'.length;
  if (room < 200) throw new Error('Creative Director guidance exceeds planning prompt budget.');
  let tail = facts.join('\n');
  if (room < tail.length) {
    tail = `${tail.slice(0, Math.max(0, room))} [facts truncated to fit prompt budget]`;
  }
  return { prompt: `${head}\n${tail}`, provenance };
}

/**
 * Planning prompt for Muse Spark 1.3. Internal strategies only:
 * cold (discovery), warm (consideration), hot (action). The brief is
 * sent only as this request's input and the model is asked not to
 * retain it. Only supplied facts may appear in copy.
 */
export function buildImageAdPlanPrompt(input: ImageAdInput): string {
  return buildImageAdPlanPromptWithProvenance(input).prompt;
}

function fail(message: string, issues: ImageAdPlanIssue[]): { ok: false; error: string; issues: ImageAdPlanIssue[] } {
  return { ok: false, error: message, issues };
}

/** Strict structural validation for one planned ad. */
function validatePlanEntry(entry: unknown, index: number): { plan?: PlannedImageAd; issues: ImageAdPlanIssue[] } {
  const issues: ImageAdPlanIssue[] = [];
  const at = (field: string): string => `plans[${index}].${field}`;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return { issues: [{ field: `plans[${index}]`, message: `Plan ${index + 1} must be an object.` }] };
  }
  const record = entry as Record<string, unknown>;
  const cleaned: Record<string, string> = {};
  for (const field of Object.keys(FIELD_LIMITS) as Array<keyof typeof FIELD_LIMITS>) {
    const raw = record[field];
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      issues.push({ field: at(field), message: `Plan ${index + 1} needs a non-empty ${field}.` });
      continue;
    }
    const value = raw.trim();
    if (value.length > FIELD_LIMITS[field]) {
      issues.push({ field: at(field), message: `Plan ${index + 1} ${field} must be ${FIELD_LIMITS[field]} characters or fewer.` });
      continue;
    }
    cleaned[field] = value;
  }
  const audience = record.audience;
  if (audience !== 'cold' && audience !== 'warm' && audience !== 'hot') {
    issues.push({ field: at('audience'), message: `Plan ${index + 1} audience must be cold, warm, or hot.` });
  }
  if (issues.length > 0) return { issues };
  return {
    plan: { ...(cleaned as unknown as Omit<PlannedImageAd, 'audience'>), audience: audience as ImageAdAudience },
    issues,
  };
}

/**
 * Validate raw planner output: exactly three distinct plans covering
 * cold, warm, and hot exactly once each.
 */
export function validateImageAdPlans(
  output: unknown,
): { ok: true; plans: [PlannedImageAd, PlannedImageAd, PlannedImageAd] } | { ok: false; error: string; issues: ImageAdPlanIssue[] } {
  if (!Array.isArray(output) || output.length !== IMAGE_AD_PLAN_COUNT) {
    const count = Array.isArray(output) ? output.length : 0;
    return fail(`Planner must return exactly ${IMAGE_AD_PLAN_COUNT} plans (got ${count}).`, [
      { field: 'plans', message: `Expected exactly ${IMAGE_AD_PLAN_COUNT} plans.` },
    ]);
  }
  const plans: PlannedImageAd[] = [];
  const issues: ImageAdPlanIssue[] = [];
  output.forEach((entry, index) => {
    const result = validatePlanEntry(entry, index);
    if (result.plan) plans.push(result.plan);
    issues.push(...result.issues);
  });
  if (issues.length > 0 || plans.length !== IMAGE_AD_PLAN_COUNT) {
    return fail('Planner returned malformed plans.', issues);
  }
  const audiences = plans.map((p) => p.audience).sort();
  if (audiences.join(',') !== 'cold,hot,warm') {
    return fail('Plans must cover cold, warm, and hot exactly once each.', [
      { field: 'plans.audience', message: 'Plans must cover cold, warm, and hot exactly once each.' },
    ]);
  }
  const heads = new Set(plans.map((p) => p.headline.toLowerCase().trim()));
  const bodies = new Set(plans.map((p) => p.body.toLowerCase().trim()));
  if (heads.size !== 3 || bodies.size !== 3) {
    return fail('Plans must be genuinely differentiated.', [
      { field: 'plans', message: 'Headlines and bodies must all differ.' },
    ]);
  }
  return { ok: true, plans: plans as [PlannedImageAd, PlannedImageAd, PlannedImageAd] };
}

/** Minimal fetch surface the planner needs (injectable for tests). */
export interface PlanFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface PlanFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type PlanFetchFn = (url: string, init: PlanFetchInit) => Promise<PlanFetchResponse>;

export interface ImageAdPlanner {
  readonly name: string;
  readonly testOnly?: boolean;
  plan(input: ImageAdInput): Promise<unknown>;
}

export interface MusePlanOptions {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: PlanFetchFn;
  env?: NodeJS.ProcessEnv;
}

function defaultFetch(url: string, init: PlanFetchInit): Promise<PlanFetchResponse> {
  return globalThis.fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
}

function stripFences(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? text).trim();
}

function extractText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.output_text === 'string' && record.output_text.trim()) return record.output_text.trim();
  if (Array.isArray(record.output)) {
    const parts: string[] = [];
    for (const item of record.output) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.output_text === 'string' && entry.output_text.trim()) parts.push(entry.output_text);
      else if (typeof entry.text === 'string' && entry.text.trim()) parts.push(entry.text);
      else {
        for (const key of ['content', 'message'] as const) {
          const bucket = entry[key];
          if (!Array.isArray(bucket)) continue;
          for (const part of bucket) {
            if (typeof part !== 'object' || part === null) continue;
            const pr = part as Record<string, unknown>;
            if (typeof pr.output_text === 'string' && pr.output_text.trim()) parts.push(pr.output_text);
            else if (typeof pr.text === 'string' && pr.text.trim()) parts.push(pr.text);
          }
        }
      }
    }
    const joined = parts.join('\n').trim();
    return joined ? joined : null;
  }
  return null;
}

/**
 * Real Muse Spark 1.3 planning provider. Exactly one upstream POST
 * per plan() call, AbortSignal timeout, no retries. Returns raw
 * parsed JSON — the caller validates it via validateImageAdPlans.
 */
export class MetaMuseImageAdPlanner implements ImageAdPlanner {
  readonly name = 'meta-muse-spark-1.3';
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: PlanFetchFn;

  constructor(options: MusePlanOptions = {}) {
    const env = options.env ?? process.env;
    this.apiKey = options.apiKey ?? resolveModelApiKey(env);
    this.endpoint = options.endpoint ?? MUSE_RESPONSES_ENDPOINT;
    this.model = options.model ?? MUSE_SPARK_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PLAN_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
  }

  async plan(input: ImageAdInput): Promise<unknown> {
    if (!this.apiKey) {
      throw new Error('Live planning is not configured. Set SILKWEB_CREATIVE_PROVIDER=live with MODEL_API_KEY to enable it.');
    }
    const prompt = buildImageAdPlanPrompt(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: PlanFetchResponse;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: prompt }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`Meta Muse request timed out after ${this.timeoutMs}ms.`);
      throw new Error('Meta Muse network request failed (UNKNOWN_NETWORK_ERROR).');
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_PLAN_RESPONSE_BYTES) {
      throw new Error(`Meta Muse response exceeds the ${MAX_PLAN_RESPONSE_BYTES}-byte limit.`);
    }
    if (!response.ok) {
      throw new Error(`Meta Muse API error: HTTP ${response.status} ${text.trim().slice(0, 200)}`.slice(0, 400));
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('Meta Muse returned malformed JSON.');
    }
    const outputText = extractText(body);
    if (!outputText) throw new Error('Meta Muse response contained no output text.');
    try {
      return JSON.parse(stripFences(outputText));
    } catch {
      throw new Error('Meta Muse output text was not valid plan JSON.');
    }
  }
}
