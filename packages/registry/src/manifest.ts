import * as z from 'zod/v4';

/**
 * Shared manifest shape for every Silk Web registry module.
 *
 * Honesty rule: `verification.status` stays `"unverified"` until passing
 * executable tests are tied to the exact source hash, lockfile/dependency
 * versions and runtime — and that evidence is recorded in the manifest.
 * Never fabricate timestamps, test results, or source hashes.
 */

const dependencySchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
});

const runtimeSchema = z.strictObject({
  /** Exact stack label, e.g. "node24+sqlite". Matched by exact equality. */
  stack: z.string().min(1),
  /** Minimum Node.js version, e.g. ">=24". */
  node: z.string().min(1),
  /** Pinned dependency versions, e.g. { "zod": "4.6.7" }. */
  dependencies: z.record(z.string(), z.string()),
});

const verificationSchema = z.strictObject({
  status: z.enum(['unverified', 'verified']),
  /** Command that reproduces the verification, e.g. "npm run check". */
  testCommand: z.string().min(1),
  /**
   * Hex sha256 over the module's source files. Absent until verified;
   * a manifest claiming status "verified" must declare the recomputed
   * fingerprint `sources`-section hash, checked by `validateComponent`
   * (code SOURCE_HASH_MISMATCH on mismatch, MISSING_SOURCE_HASH when
   * absent or malformed).
   */
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /**
   * Evidence pointer. Free text while unverified; a manifest claiming
   * status "verified" must instead name its canonical evidence file
   * `<evidenceDir>/<id>-<version>.json`, checked by `validateComponent`
   * (code EVIDENCE_REF_MISMATCH). Never a fabricated result.
   */
  evidence: z.string().min(1),
});

export const manifestSchema = z.strictObject({
  id: z.string().min(1),
  /** Exact version string, e.g. "0.1.0". Matched by exact equality. */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Repo-relative path to the module's source, e.g. "packages/registry/src/schema.ts". */
  sourcePath: z.string().min(1),
  dependencies: z.array(dependencySchema),
  capabilities: z.array(z.string().min(1)),
  invariants: z.array(z.string().min(1)),
  runtime: runtimeSchema,
  verification: verificationSchema,
});

export type RegistryManifest = z.infer<typeof manifestSchema>;
export type ManifestDependency = z.infer<typeof dependencySchema>;
