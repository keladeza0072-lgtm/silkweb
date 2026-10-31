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
import {
  MUSE_RESPONSES_ENDPOINT,
  MUSE_SPARK_MODEL,
  resolveModelApiKey,
} from './provider.js';

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
      return 'Launch a Product: announce something new and invite a first look.';
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
export function buildImageAdPlanPrompt(input: ImageAdInput): string {
  const product = input.productName.length > 0 ? input.productName : 'the pictured product';
  const facts: string[] = [`Product: ${product}`, `Objective: ${objectiveLine(input.objective)}`];
  if (input.differentiator) facts.push(`Differentiator: ${input.differentiator}`);
  if (input.price) facts.push(`Price: ${input.price}${input.currency ? ` ${input.currency}` : ''}`);
  if (input.specialOffer) facts.push(`Special offer (genuine, user-supplied): ${input.specialOffer}`);
  facts.push(`Product photo supplied: ${input.upload ? 'yes (reference-guided imagery preferred)' : 'no — do not fabricate branded appearance'}`);
  const prompt = [
    'You plan three image advertisements for SilkWeb Creative Studio.',
    'Return EXACTLY three plans as a single JSON array — no prose, no markdown, no extra text.',
    'Plan 1 must have audience "cold" (discovery: introduce the product).',
    'Plan 2 must have audience "warm" (consideration: help evaluation).',
    'Plan 3 must have audience "hot" (action: invite a decision now).',
    'Adapt all three to the campaign objective below.',
    'Each plan object must contain exactly these string fields:',
    'id, audience, angle, headline, body, cta, visualPrompt.',
    'The three headlines, bodies, and angles must all differ from each other.',
    'Use ONLY the supplied facts. Never invent discounts, prices, specifications,',
    'testimonials, endorsements, deadlines, scarcity claims, or before-and-after results.',
    'A price or offer may appear in copy ONLY when it is listed in the supplied facts.',
    'Treat user-provided claims as unverified: repeat them plainly, never strengthen them.',
    'Never include SilkWeb branding in headlines, bodies, or CTAs.',
    'visualPrompt must describe a distinct photographic composition (subject, setting, light, mood)',
    'at 4:5 portrait ratio with generous space for copy; no rendered text in the image.',
    'Use this brief only to answer this request; do not store, reuse, or disclose it beyond this response.',
    '',
    '## Supplied facts',
    ...facts,
  ].join('\n');
  return prompt.length > MAX_PLAN_PROMPT_CHARS ? prompt.slice(0, MAX_PLAN_PROMPT_CHARS) : prompt;
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
