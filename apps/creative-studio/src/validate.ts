/**
 * Campaign-brief validation shared by the API and (via /api/config)
 * the browser form. Milestone 1 validates only — it never generates
 * concepts, images, scores, or landing pages.
 */
import { BRIEF_FIELDS, PHOTOGRAPHY_MODES, STYLE_SLOTS } from './config.js';

export interface BriefInput {
  brand: unknown;
  product: unknown;
  audience: unknown;
  objective: unknown;
  offer: unknown;
  creativeDirection: unknown;
  styleId: unknown;
  photographyMode: unknown;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface BriefValidation {
  ok: boolean;
  issues: ValidationIssue[];
}

const STYLE_IDS = new Set(STYLE_SLOTS.map((slot) => slot.id));
const PHOTOGRAPHY_IDS = new Set<string>(PHOTOGRAPHY_MODES.map((mode) => mode.id));

export function validateBrief(input: Partial<BriefInput>): BriefValidation {
  const issues: ValidationIssue[] = [];

  for (const field of BRIEF_FIELDS) {
    const raw = (input as Record<string, unknown>)[field.id];
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (field.required && trimmed.length === 0) {
      issues.push({ field: field.id, message: `${field.label} is required.` });
    } else if (trimmed.length > field.maxLength) {
      issues.push({
        field: field.id,
        message: `${field.label} must be ${field.maxLength} characters or fewer.`,
      });
    }
  }

  if (typeof input.styleId !== 'string' || !STYLE_IDS.has(input.styleId)) {
    issues.push({ field: 'styleId', message: 'Choose one of the six listed advertising styles.' });
  }
  if (typeof input.photographyMode !== 'string' || !PHOTOGRAPHY_IDS.has(input.photographyMode)) {
    issues.push({ field: 'photographyMode', message: 'Choose a photography mode: product, lifestyle, or website.' });
  }

  return { ok: issues.length === 0, issues };
}

export function briefSummary(input: Partial<BriefInput>): string {
  const parts = [input.brand, input.product, input.audience, input.objective]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());
  return parts.join(' · ');
}
