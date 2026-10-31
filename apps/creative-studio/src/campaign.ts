/**
 * Typed campaign context for Milestone 2A concept generation.
 *
 * Pure validation only — no AI service, no network, no inference.
 * Brand, audience, offer, channel, and creative direction stay
 * optional so initial concept exploration is never blocked.
 * Anything not supplied stays absent; nothing is invented here.
 */

export interface CampaignContext {
  /** Original user description, verbatim. */
  description: string;
  /** Product or service being advertised. */
  product: string;
  /** Campaign objective (one measurable outcome). */
  objective: string;
  /** Advertising channel (e.g. Instagram), when supplied. */
  channel?: string;
  /** Target audience, when supplied. */
  audience?: string;
  /** Brand name, when supplied. */
  brand?: string;
  /** Offer or perk, when supplied. */
  offer?: string;
  /** Creative direction / tone notes, when supplied. */
  creativeDirection?: string;
  /** Statements taken directly from the supplied brief. */
  facts: string[];
  /** Explicit guesses marked as assumptions, never as facts. */
  assumptions: string[];
  /** Optional preferred advertising-style id (honored only when compatible). */
  preferredStyleId?: string;
  /** Optional preferred copywriting-framework id (honored only when compatible). */
  preferredFrameworkId?: string;
}

export interface ContextIssue {
  field: string;
  message: string;
}

export type CampaignValidation =
  | { ok: true; context: CampaignContext }
  | { ok: false; issues: ContextIssue[] };

const MAX_LENGTHS: Record<string, number> = {
  description: 2000,
  product: 120,
  objective: 200,
  channel: 80,
  audience: 200,
  brand: 80,
  offer: 200,
  creativeDirection: 500,
};

const MAX_FACT_CHARS = 500;
const MAX_LIST_ITEMS = 50;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function checkRequired(
  record: Record<string, unknown>,
  field: string,
  label: string,
  issues: ContextIssue[],
): string {
  const value = clean(record[field]);
  if (!value) {
    issues.push({ field, message: `${label} is required.` });
    return '';
  }
  if (value.length > MAX_LENGTHS[field]) {
    issues.push({
      field,
      message: `${label} must be ${MAX_LENGTHS[field]} characters or fewer.`,
    });
    return '';
  }
  return value;
}

function checkOptional(
  record: Record<string, unknown>,
  field: string,
  label: string,
  issues: ContextIssue[],
): string | undefined {
  const raw = record[field];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    issues.push({ field, message: `${label} must be text when supplied.` });
    return undefined;
  }
  const value = clean(raw);
  if (!value) return undefined;
  if (value.length > MAX_LENGTHS[field]) {
    issues.push({
      field,
      message: `${label} must be ${MAX_LENGTHS[field]} characters or fewer.`,
    });
    return undefined;
  }
  return value;
}

function checkOptionalId(
  record: Record<string, unknown>,
  field: string,
  label: string,
  issues: ContextIssue[],
): string | undefined {
  const raw = record[field];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' || !raw.trim()) {
    issues.push({ field, message: `${label} must be text when supplied.` });
    return undefined;
  }
  const value = raw.trim();
  if (value.length > 64 || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) {
    issues.push({ field, message: `${label} must be a valid library identifier.` });
    return undefined;
  }
  return value;
}

function checkStringList(
  record: Record<string, unknown>,
  field: string,
  label: string,
  issues: ContextIssue[],
): string[] {
  const raw = record[field];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ field, message: `${label} must be a list of text statements.` });
    return [];
  }
  if (raw.length > MAX_LIST_ITEMS) {
    issues.push({ field, message: `${label} must hold at most ${MAX_LIST_ITEMS} statements.` });
    return [];
  }
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !clean(entry)) {
      issues.push({ field, message: `${label} entries must be non-empty text.` });
      return [];
    }
    if (clean(entry).length > MAX_FACT_CHARS) {
      issues.push({
        field,
        message: `${label} entries must be ${MAX_FACT_CHARS} characters or fewer.`,
      });
      return [];
    }
    out.push(clean(entry));
  }
  return out;
}

/**
 * Validate an unknown request body into a typed CampaignContext.
 * Returns field-level issues instead of throwing.
 */
export function validateCampaignContext(input: unknown): CampaignValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ field: 'body', message: 'Campaign context must be a JSON object.' }] };
  }
  const record = input as Record<string, unknown>;
  const issues: ContextIssue[] = [];

  const description = checkRequired(record, 'description', 'Description', issues);
  const product = checkRequired(record, 'product', 'Product', issues);
  const objective = checkRequired(record, 'objective', 'Objective', issues);
  const channel = checkOptional(record, 'channel', 'Channel', issues);
  const audience = checkOptional(record, 'audience', 'Audience', issues);
  const brand = checkOptional(record, 'brand', 'Brand', issues);
  const offer = checkOptional(record, 'offer', 'Offer', issues);
  const creativeDirection = checkOptional(record, 'creativeDirection', 'Creative direction', issues);
  const facts = checkStringList(record, 'facts', 'Facts', issues);
  const assumptions = checkStringList(record, 'assumptions', 'Assumptions', issues);
  const preferredStyleId = checkOptionalId(record, 'preferredStyleId', 'Preferred style', issues);
  const preferredFrameworkId = checkOptionalId(record, 'preferredFrameworkId', 'Preferred framework', issues);

  if (issues.length > 0) return { ok: false, issues };

  const context: CampaignContext = { description, product, objective, facts, assumptions };
  if (preferredStyleId !== undefined) context.preferredStyleId = preferredStyleId;
  if (preferredFrameworkId !== undefined) context.preferredFrameworkId = preferredFrameworkId;
  if (channel !== undefined) context.channel = channel;
  if (audience !== undefined) context.audience = audience;
  if (brand !== undefined) context.brand = brand;
  if (offer !== undefined) context.offer = offer;
  if (creativeDirection !== undefined) context.creativeDirection = creativeDirection;
  return { ok: true, context };
}
