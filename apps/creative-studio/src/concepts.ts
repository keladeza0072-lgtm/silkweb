/**
 * Milestone 2A concept-generation orchestrator.
 *
 * Exactly one provider call per request, exactly two distinct
 * concepts per success. No automatic retries. Provider output is
 * strictly validated — malformed entries, unknown style/framework
 * ids, and duplicate concepts all fail with clear error codes.
 */
import { validateCampaignContext, type CampaignContext } from './campaign.js';
import { isKnownFrameworkId, isKnownStyleId } from './library.js';
import type { ConceptProvider } from './provider.js';

export interface AdConcept {
  id: string;
  angle: string;
  headline: string;
  primaryCopy: string;
  cta: string;
  visualDirection: string;
  photographyPrompt: string;
  styleId: string;
  frameworkId: string;
}

export type GenerationErrorCode =
  | 'INVALID_CONTEXT'
  | 'TEST_PROVIDER_NOT_ALLOWED'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'RESPONSE_TOO_LARGE'
  | 'INVALID_PROVIDER_OUTPUT'
  | 'DUPLICATE_CONCEPTS';

export interface GenerationIssue {
  field: string;
  message: string;
}

export interface GenerationError {
  code: GenerationErrorCode;
  message: string;
  issues?: GenerationIssue[];
}

export type GenerationResult =
  | { ok: true; concepts: [AdConcept, AdConcept]; provider: string }
  | { ok: false; error: GenerationError };

export interface GenerationOptions {
  /** Per-request timeout in ms. Defaults to 15000. */
  timeoutMs?: number;
  /**
   * Test doubles are refused unless the caller explicitly opts in.
   * The HTTP endpoint never sets this — only automated tests do.
   */
  allowTestProvider?: boolean;
}

/** At most two concepts per campaign request (contract ceiling). */
export const EXPECTED_CONCEPT_COUNT = 2;
/** Upper bound on the provider payload accepted per request. */
export const MAX_CONCEPT_RESPONSE_BYTES = 64 * 1024;
export const DEFAULT_GENERATION_TIMEOUT_MS = 15_000;

const FIELD_LIMITS: Record<keyof AdConcept, number> = {
  id: 64,
  angle: 200,
  headline: 120,
  primaryCopy: 1000,
  cta: 80,
  visualDirection: 500,
  photographyPrompt: 1000,
  styleId: 64,
  frameworkId: 64,
};

const CONCEPT_FIELDS = Object.keys(FIELD_LIMITS) as Array<keyof AdConcept>;

function fail(code: GenerationErrorCode, message: string, issues?: GenerationIssue[]): GenerationResult {
  return issues === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, issues } };
}

function validateConcept(entry: unknown, index: number): { concept?: AdConcept; issues: GenerationIssue[] } {
  const issues: GenerationIssue[] = [];
  const at = (field: string): string => `concepts[${index}].${field}`;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return { issues: [{ field: `concepts[${index}]`, message: `Concept ${index + 1} must be an object.` }] };
  }
  const record = entry as Record<string, unknown>;
  const cleaned: Record<string, string> = {};
  for (const field of CONCEPT_FIELDS) {
    const raw = record[field];
    if (typeof raw !== 'string' || !raw.trim()) {
      issues.push({ field: at(field), message: `Concept ${index + 1} needs a non-empty ${field}.` });
      continue;
    }
    const value = raw.trim();
    if (value.length > FIELD_LIMITS[field]) {
      issues.push({
        field: at(field),
        message: `Concept ${index + 1} ${field} must be ${FIELD_LIMITS[field]} characters or fewer.`,
      });
      continue;
    }
    cleaned[field] = value;
  }
  if (issues.length > 0) return { issues };
  if (!isKnownStyleId(cleaned.styleId)) {
    issues.push({ field: at('styleId'), message: `Unknown advertising style "${cleaned.styleId}".` });
  }
  if (!isKnownFrameworkId(cleaned.frameworkId)) {
    issues.push({ field: at('frameworkId'), message: `Unknown copywriting framework "${cleaned.frameworkId}".` });
  }
  if (issues.length > 0) return { issues };
  return { concept: cleaned as unknown as AdConcept, issues };
}

function fingerprint(concept: AdConcept): string {
  return [concept.angle, concept.headline, concept.primaryCopy]
    .map((part) => part.toLowerCase().replace(/\s+/g, ' ').trim())
    .join(' || ');
}

/**
 * Run one generation: validate context, call the provider exactly
 * once, validate the two concepts. Never retries on failure.
 */
export async function generateConcepts(
  input: unknown,
  provider: ConceptProvider,
  options: GenerationOptions = {},
): Promise<GenerationResult> {
  const checked = validateCampaignContext(input);
  if (!checked.ok) {
    return fail('INVALID_CONTEXT', 'Campaign context is invalid.', checked.issues);
  }
  const context: CampaignContext = checked.context;

  if (provider.testOnly === true && options.allowTestProvider !== true) {
    return fail(
      'TEST_PROVIDER_NOT_ALLOWED',
      'Test-provider output must never be served as live generation.',
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS;
  let output: unknown;
  try {
    output = await Promise.race([
      provider.generate(context),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('__creative_generation_timeout__')), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message === '__creative_generation_timeout__') {
      return fail('PROVIDER_TIMEOUT', `Provider did not respond within ${timeoutMs}ms.`);
    }
    const detail = error instanceof Error ? error.message : 'Unknown provider failure.';
    return fail('PROVIDER_ERROR', `Concept provider failed: ${detail}`.slice(0, 500));
  }

  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(output), 'utf8');
  } catch {
    return fail('INVALID_PROVIDER_OUTPUT', 'Provider output could not be read as JSON.');
  }
  if (size > MAX_CONCEPT_RESPONSE_BYTES) {
    return fail(
      'RESPONSE_TOO_LARGE',
      `Provider response (${size} bytes) exceeds the ${MAX_CONCEPT_RESPONSE_BYTES}-byte limit.`,
    );
  }

  if (!Array.isArray(output) || output.length !== EXPECTED_CONCEPT_COUNT) {
    const count = Array.isArray(output) ? output.length : 0;
    return fail(
      'INVALID_PROVIDER_OUTPUT',
      `Provider must return exactly ${EXPECTED_CONCEPT_COUNT} concepts (got ${count}).`,
    );
  }

  const concepts: AdConcept[] = [];
  const issues: GenerationIssue[] = [];
  output.forEach((entry, index) => {
    const result = validateConcept(entry, index);
    if (result.concept) concepts.push(result.concept);
    issues.push(...result.issues);
  });
  if (issues.length > 0 || concepts.length !== EXPECTED_CONCEPT_COUNT) {
    return fail('INVALID_PROVIDER_OUTPUT', 'Provider returned malformed concepts.', issues);
  }
  const [first, second] = concepts as [AdConcept, AdConcept];

  if (first.id === second.id || fingerprint(first) === fingerprint(second)) {
    return fail('DUPLICATE_CONCEPTS', 'Provider returned two identical concepts; concepts must be distinct.');
  }

  return { ok: true, concepts: [first, second], provider: provider.name };
}
