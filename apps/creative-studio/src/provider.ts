/**
 * Provider boundary for Milestone 2A concept generation.
 *
 * Real Meta Muse inference stays disabled until provider
 * configuration is explicitly verified. The deterministic test
 * provider below is marked `testOnly` and must never be served
 * as live AI output — the orchestrator refuses it unless the
 * caller explicitly opts in, and the HTTP endpoint never opts in.
 */
import type { CampaignContext } from './campaign.js';
import { buildLibraryPromptSection } from './library.js';
import { recommendConceptPair, recommendCreatives } from './recommend.js';

export interface ConceptProvider {
  readonly name: string;
  /** Test doubles set this; live paths must reject them. */
  readonly testOnly?: boolean;
  generate(context: CampaignContext): Promise<unknown>;
}

export interface TestProviderIds {
  styleIds: [string, string];
  frameworkIds: [string, string];
}

/**
 * Injected deterministic test double. Output derives only from the
 * supplied campaign context plus explicitly configured ids — the
 * same input always yields the same two concepts. Never wire this
 * into a live response path.
 */
export class DeterministicTestProvider implements ConceptProvider {
  readonly name = 'deterministic-test';
  readonly testOnly = true as const;
  private readonly ids: TestProviderIds;

  constructor(ids: TestProviderIds) {
    this.ids = ids;
  }

  async generate(context: CampaignContext): Promise<unknown> {
    const audience = context.audience ?? 'new customers';
    const channel = context.channel ?? 'paid social';
    const direction = context.creativeDirection ?? 'clean and confident';
    const brand = context.brand ? ` from ${context.brand}` : '';
    const offer = context.offer ? ` Plus ${context.offer}.` : '';
    return [
      {
        id: 'test-concept-1',
        angle: `Everyday ease with ${context.product} for ${audience}`,
        headline: `Meet ${context.product} built for ${channel}`,
        primaryCopy: `Discover ${context.product}${brand}, made to help you ${context.objective}. ${direction}.${offer}`,
        cta: 'Shop now',
        visualDirection: `Close crop of ${context.product} in soft daylight, ${direction} mood.`,
        photographyPrompt: `Studio photograph of ${context.product}, soft daylight, minimal backdrop, ${direction}.`,
        styleId: this.ids.styleIds[0],
        frameworkId: this.ids.frameworkIds[0],
      },
      {
        id: 'test-concept-2',
        angle: `Social proof weekend with ${context.product} for ${audience}`,
        headline: `Why ${audience} choose ${context.product}`,
        primaryCopy: `See how ${context.product}${brand} fits real routines on ${channel} and helps you ${context.objective}.${offer}`,
        cta: 'Learn more',
        visualDirection: `Candid ${channel} moment featuring ${context.product}, warm ${direction} grade.`,
        photographyPrompt: `Lifestyle photograph of a person using ${context.product} outdoors, candid ${channel} feel, ${direction}.`,
        styleId: this.ids.styleIds[1],
        frameworkId: this.ids.frameworkIds[1],
      },
    ];
  }
}

/**
 * Canonical server-side credential for paid Meta Muse inference.
 * MODEL_API_KEY is the documented variable; SILKWEB_MUSE_API_KEY
 * is accepted as a legacy alias. Values are only read here and
 * passed as an Authorization header — never logged, never sent to
 * the browser, never written to disk.
 */
export function resolveModelApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.MODEL_API_KEY ?? env.SILKWEB_MUSE_API_KEY ?? '';
}

/**
 * Real inference is enabled only when BOTH the provider selector
 * (`SILKWEB_CREATIVE_PROVIDER=live`) and a credentials variable
 * are explicitly set. Paid inference stays disabled by default:
 * when either setting is absent, no upstream request is made.
 */
export function isLiveProviderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SILKWEB_CREATIVE_PROVIDER === 'live' && resolveModelApiKey(env).length > 0;
}

/** Official Meta Muse responses endpoint (Milestone 2B-2). */
export const MUSE_RESPONSES_ENDPOINT = 'https://api.meta.ai/v1/responses';
/** Official paid inference model for this milestone. */
export const MUSE_SPARK_MODEL = 'muse-spark-1.3';
/** Live provider name — deliberately distinct from `deterministic-test`. */
export const LIVE_PROVIDER_NAME = 'meta-muse-spark-1.3';
/** Upper bound on the prompt sent upstream (bounded input). */
export const MAX_LIVE_PROMPT_CHARS = 12_000;
/** Upper bound on the upstream response accepted (mirrors the orchestrator ceiling). */
export const MAX_LIVE_RESPONSE_BYTES = 64 * 1024;
/** Per-attempt upstream timeout in ms. No retries on top of this. */
export const DEFAULT_LIVE_TIMEOUT_MS = 15_000;

/** Minimal fetch surface the live provider needs (injectable for tests). */
export interface LiveFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface LiveFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type LiveFetchFn = (url: string, init: LiveFetchInit) => Promise<LiveFetchResponse>;

function defaultLiveFetch(url: string, init: LiveFetchInit): Promise<LiveFetchResponse> {
  return globalThis.fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
}

export interface MetaMuseProviderOptions {
  /** Server-side credential. Defaults to MODEL_API_KEY (alias: SILKWEB_MUSE_API_KEY). */
  apiKey?: string;
  /** Upstream endpoint. Defaults to MUSE_RESPONSES_ENDPOINT. */
  endpoint?: string;
  /** Model id. Defaults to MUSE_SPARK_MODEL. */
  model?: string;
  /** Per-attempt timeout in ms (AbortSignal). Defaults to DEFAULT_LIVE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Injectable fetch — tests MUST inject a mock; no live network in tests. */
  fetchImpl?: LiveFetchFn;
  /** Environment the apiKey default is read from. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…[truncated]` : value;
}

function extractOutputText(body: unknown): string | null {
  const parts: string[] = [];
  const collectContent = (content: unknown): void => {
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue;
      const record = part as Record<string, unknown>;
      // Official shape: content entries carrying `output_text`.
      if (typeof record.output_text === 'string' && record.output_text.trim()) {
        parts.push(record.output_text);
        continue;
      }
      if (typeof record.text === 'string' && record.text.trim()) {
        parts.push(record.text);
      }
    }
  };
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text.trim();
  }
  if (Array.isArray(record.output)) {
    for (const item of record.output) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.output_text === 'string' && entry.output_text.trim()) {
        parts.push(entry.output_text);
        continue;
      }
      if (typeof entry.text === 'string' && entry.text.trim()) {
        parts.push(entry.text);
        continue;
      }
      collectContent(entry.content);
      collectContent(entry.message);
    }
  } else {
    collectContent(record.content);
    collectContent(record.message);
  }
  const joined = parts.join('\n').trim();
  return joined ? joined : null;
}

function stripCodeFences(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? text).trim();
}

/**
 * Structured concept instructions for Meta Muse Spark 1.3.
 *
 * Combines the approved V1 library brief, the context-aware
 * style/framework recommendations, and the bounded campaign
 * context into one prompt. The campaign brief is sent ONLY as
 * this request's input (as the provider contract requires) and
 * is never persisted elsewhere; the instructions ask the model
 * not to retain it beyond the response.
 */
export function buildLiveConceptPrompt(context: CampaignContext): string {
  const preferences = {
    styleId: context.preferredStyleId,
    frameworkId: context.preferredFrameworkId,
  };
  const pair = recommendConceptPair(context, preferences);
  const advice = recommendCreatives(context, preferences);
  const campaignJson = truncate(JSON.stringify(context), 6000);
  const recommendationLines = [
    `Recommended style ids in order: ${pair.styleIds.join(', ')}.`,
    `Recommended framework ids in order: ${pair.frameworkIds.join(', ')}.`,
    ...advice.explanations.map((line) => `Note: ${line}`),
  ].join('\n');
  const prompt = [
    'You generate advertising concepts for SilkWeb Creative Studio.',
    'Return EXACTLY two genuinely distinct concepts as a single JSON array — no prose, no markdown, no extra text.',
    'Each concept object must contain exactly these string fields:',
    'id, angle, headline, primaryCopy, cta, visualDirection, photographyPrompt, styleId, frameworkId.',
    `Pair concept 1 with styleId "${pair.styleIds[0] ?? ''}" and frameworkId "${pair.frameworkIds[0] ?? ''}";`,
    `pair concept 2 with styleId "${pair.styleIds[1] ?? ''}" and frameworkId "${pair.frameworkIds[1] ?? ''}".`,
    'The two concepts must differ in id, angle, headline, and primaryCopy.',
    'Use only facts supplied in the campaign context. Never invent product claims, discounts,',
    'testimonials, certifications, factual benefits, or guaranteed outcomes.',
    'Use this response only to answer the request; do not store, reuse, or disclose the campaign',
    'brief beyond this response.',
    '',
    '## Context-aware recommendations',
    recommendationLines,
    '',
    buildLibraryPromptSection(),
    '',
    '## Campaign context (JSON)',
    campaignJson,
  ].join('\n');
  return truncate(prompt, MAX_LIVE_PROMPT_CHARS);
}

/**
 * Real Meta Muse Spark 1.3 concept provider over native fetch.
 *
 * Exactly one upstream POST per generate() call, no automatic
 * retries, AbortSignal timeout. Raw provider output is returned
 * unvalidated — the existing orchestrator (generateConcepts)
 * validates count, shape, approved ids, and distinctness.
 * This class never logs credentials or authorization headers.
 */
export class MetaMuseConceptProvider implements ConceptProvider {
  readonly timeoutControlled = true;
  readonly name = LIVE_PROVIDER_NAME;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: LiveFetchFn;

  constructor(options: MetaMuseProviderOptions = {}) {
    const env = options.env ?? process.env;
    this.apiKey = options.apiKey ?? resolveModelApiKey(env);
    this.endpoint = options.endpoint ?? MUSE_RESPONSES_ENDPOINT;
    this.model = options.model ?? MUSE_SPARK_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? defaultLiveFetch;
  }

  async generate(context: CampaignContext): Promise<unknown> {
    if (!this.apiKey) {
      throw new Error(
        'Live concept generation is not configured. Set SILKWEB_CREATIVE_PROVIDER=live with MODEL_API_KEY to enable it.',
      );
    }
    const prompt = buildLiveConceptPrompt(context);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: LiveFetchResponse;
    try {
      // The single upstream request for this generation attempt — never retried.
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, input: prompt }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Meta Muse request timed out after ${this.timeoutMs}ms.`);
      }
      // Expose only known-safe transport codes, never raw error details.
      const cause = error instanceof Error
        ? (error as Error & { cause?: unknown }).cause
        : undefined;
      const rawCode = cause && typeof cause === 'object' && 'code' in cause
        ? cause.code
        : undefined;
      const safeCodes = new Set([
        'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED',
        'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH',
        'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT', 'CERT_HAS_EXPIRED',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      ]);
      const code = typeof rawCode === 'string' && safeCodes.has(rawCode)
        ? rawCode
        : 'UNKNOWN_NETWORK_ERROR';
      throw new Error(`Meta Muse network request failed (${code}).`);
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_LIVE_RESPONSE_BYTES) {
      throw new Error(
        `Meta Muse response exceeds the ${MAX_LIVE_RESPONSE_BYTES}-byte limit.`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `Meta Muse API error: HTTP ${response.status} ${truncate(text.trim(), 300)}`.slice(0, 500),
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('Meta Muse returned malformed JSON.');
    }
    const outputText = extractOutputText(body);
    if (!outputText) {
      throw new Error('Meta Muse response contained no output text.');
    }
    try {
      return JSON.parse(stripCodeFences(outputText));
    } catch {
      throw new Error('Meta Muse output text was not valid concept JSON.');
    }
  }
}
