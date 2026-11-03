import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as z from 'zod/v4';
import { resolveRepoPath } from './fingerprint.js';

/**
 * Machine-readable verification evidence records.
 *
 * An evidence record is a plain JSON file written ONLY by the local
 * verification runner after it actually executed an allowlisted test
 * command. It binds one component version to one artifact fingerprint plus
 * the observed outcome. Validators recompute the fingerprint from the
 * current checkout and reject anything missing, mismatched, or stale.
 */

export const EVIDENCE_SCHEMA_VERSION = 1;

const testScopeSchema = z.strictObject({
  /** The exact allowlisted command that ran, e.g. "node --test tests/loader.test.mjs". */
  command: z.string().min(1),
  /** Allowlist key that produced the command (never a manifest string). */
  commandKey: z.string().min(1),
  /** Repo-relative test files the command actually executed (exact scope). */
  files: z.array(z.string().min(1)),
  /** Known limitations of the recorded run (sequential, same-process, …). */
  limitations: z.string().min(1),
});

const buildScopeSchema = z.strictObject({
  /**
   * Human-reproducible build command string that produced the executed
   * artifacts (an allowlist entry's fixed build argv, run from its
   * cwdRel), or "none" when the test command needs no build.
   */
  command: z.string().min(1),
  /** SHA-256 of every compiled artifact the tests executed, sorted by file. */
  artifacts: z.array(
    z.strictObject({
      file: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});

export const evidenceSchema = z.strictObject({
  schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
  componentId: z.string().min(1),
  componentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  artifactFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  sections: z.strictObject({
    manifest: z.string().regex(/^[0-9a-f]{64}$/),
    sources: z.string().regex(/^[0-9a-f]{64}$/),
    tests: z.string().regex(/^[0-9a-f]{64}$/),
    lockfile: z.string().regex(/^[0-9a-f]{64}$/),
    environment: z.string().regex(/^[0-9a-f]{64}$/),
    build: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  testScope: testScopeSchema,
  build: buildScopeSchema,
  exitCode: z.number().int(),
  outcome: z.enum(['pass', 'fail']),
  nodeVersion: z.string().min(1),
  sqliteVersion: z.string().min(1),
  executedAt: z.string().min(1),
});

export type VerificationEvidence = z.infer<typeof evidenceSchema>;

export class EvidenceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EvidenceError';
    this.code = code;
  }
}

export function evidenceFileName(componentId: string, componentVersion: string): string {
  return `${componentId}-${componentVersion}.json`;
}

/** Read and schema-validate one evidence file. Throws EvidenceError. */
export function readEvidenceFile(absolutePath: string): VerificationEvidence {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error: unknown) {
    throw new EvidenceError('UNREADABLE_EVIDENCE', `cannot read evidence ${absolutePath}: ${String(error)}`);
  }
  const result = evidenceSchema.safeParse(parsed);
  if (!result.success) {
    throw new EvidenceError(
      'INVALID_EVIDENCE',
      `invalid evidence ${absolutePath}: ${result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}`,
    );
  }
  return result.data;
}

/**
 * Resolve the evidence file for one component inside evidenceDir
 * (repo-relative), guarding against path traversal via component ids.
 */
export function resolveEvidencePath(
  repoRoot: string,
  evidenceDir: string,
  componentId: string,
  componentVersion: string,
): string {
  const dir = resolveRepoPath(repoRoot, evidenceDir);
  const file = evidenceFileName(componentId, componentVersion);
  if (file.includes('/') || file.includes('\\') || file.includes('..')) {
    throw new EvidenceError('UNSAFE_PATH', `unsafe evidence file name: ${JSON.stringify(file)}`);
  }
  return join(dir, file);
}

/** Write one evidence record (creates the directory when missing). */
export function writeEvidenceFile(absolutePath: string, evidence: VerificationEvidence): void {
  const checked = evidenceSchema.parse(evidence);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(checked, null, 2)}\n`, 'utf8');
}
