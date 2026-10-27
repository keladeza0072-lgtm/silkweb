import { readFileSync } from 'node:fs';
import {
  LOCKFILE_REL,
  computeArtifactFingerprint,
  indexManifests,
  resolveClosure,
  resolveRepoPath,
  FingerprintError,
} from './fingerprint.js';
import { EVIDENCE_SCHEMA_VERSION, resolveEvidencePath, readEvidenceFile, EvidenceError } from './evidence.js';
import { TEST_COMMAND_ALLOWLIST } from './runner.js';
import type { RegistryManifest } from './manifest.js';

/**
 * Verification validation (fail-closed).
 *
 * A component counts as verified ONLY when ALL of these hold against the
 * current checkout:
 * - its dependency closure resolves (every exact id@version present, no cycles)
 * - every declared runtime dependency matches the lockfile exactly
 * - a schema-valid evidence file exists for the exact id@version
 * - the evidence records an actual passing run (outcome "pass", exit 0)
 *   of a command from the explicit test-command allowlist
 * - the evidence fingerprint (per section) matches a fresh recomputation
 *   from current repository files
 * - the recorded runtime satisfies the manifest's declared Node requirement
 *
 * The manifest's own `verification.status` is NEVER trusted: a
 * "verified" claim without valid evidence is rejected (or downgraded to
 * unverified) with an explicit reason. Use `selectVerifiedManifests` for
 * verified-only consumption.
 */

export interface ValidationOptions {
  /** Repo-relative directory holding real evidence records. */
  evidenceDir: string;
  /** Explicit allowlist the evidence command must belong to. */
  allowlist?: Record<string, { command: string }>;
}

export interface ComponentValidation {
  id: string;
  version: string;
  valid: boolean;
  /** Machine-readable failure code; "OK" when valid. */
  code: string;
  /** Human-readable reason, naming the manifest claim when relevant. */
  reason: string;
  /** True when the manifest claims verified but evidence does not support it. */
  unsubstantiatedClaim: boolean;
}

const claimNote = (manifest: RegistryManifest, reason: string): string =>
  manifest.verification.status === 'verified'
    ? `${reason} The manifest claims verification.status="verified" without supporting evidence; the claim is rejected.`
    : reason;

function fail(manifest: RegistryManifest, code: string, reason: string): ComponentValidation {
  return {
    id: manifest.id,
    version: manifest.version,
    valid: false,
    code,
    reason: claimNote(manifest, reason),
    unsubstantiatedClaim: manifest.verification.status === 'verified',
  };
}

/** Lockfile's pinned version for one dependency name (or undefined). */
function lockfileVersion(lockfile: unknown, name: string): string | undefined {
  if (typeof lockfile !== 'object' || lockfile === null) return undefined;
  const packages = (lockfile as { packages?: Record<string, { version?: unknown }> }).packages;
  const entry = packages?.[`node_modules/${name}`];
  return typeof entry?.version === 'string' ? entry.version : undefined;
}

function nodeMajor(version: string): number | undefined {
  const match = /^v?(\d+)\./.exec(version.trim());
  return match ? Number(match[1]) : undefined;
}

function requiredNodeMajor(requirement: string): number | undefined {
  const match = />=\s*(\d+)/.exec(requirement.trim());
  return match ? Number(match[1]) : undefined;
}

export function validateComponent(
  repoRoot: string,
  manifest: RegistryManifest,
  allManifests: readonly RegistryManifest[],
  options: ValidationOptions,
): ComponentValidation {
  // 1. Dependency closure resolves (missing/incompatible/circular fails here).
  try {
    resolveClosure(manifest, indexManifests(allManifests));
  } catch (error: unknown) {
    const code = error instanceof FingerprintError ? error.code : 'DEPENDENCY_ERROR';
    return fail(manifest, code, `Dependency closure of ${manifest.id}@${manifest.version} does not resolve: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Declared runtime dependencies match the lockfile exactly.
  let lockfile: unknown;
  try {
    lockfile = JSON.parse(readFileSync(resolveRepoPath(repoRoot, LOCKFILE_REL), 'utf8'));
  } catch (error: unknown) {
    return fail(manifest, 'LOCKFILE_UNREADABLE', `Cannot read ${LOCKFILE_REL}: ${String(error)}`);
  }
  for (const [name, declared] of Object.entries(manifest.runtime.dependencies).sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const pinned = lockfileVersion(lockfile, name);
    if (pinned === undefined) {
      return fail(
        manifest,
        'DEPENDENCY_MISMATCH',
        `Declared runtime dependency ${name}@${declared} is absent from ${LOCKFILE_REL}.`,
      );
    }
    if (pinned !== declared) {
      return fail(
        manifest,
        'DEPENDENCY_MISMATCH',
        `Declared runtime dependency ${name}@${declared} does not match lockfile-pinned ${name}@${pinned}.`,
      );
    }
  }

  // 3. Evidence exists and is schema-valid.
  let evidencePath: string;
  try {
    evidencePath = resolveEvidencePath(repoRoot, options.evidenceDir, manifest.id, manifest.version);
  } catch (error: unknown) {
    const code = error instanceof EvidenceError ? error.code : 'EVIDENCE_ERROR';
    return fail(manifest, code, `Cannot resolve evidence location: ${error instanceof Error ? error.message : String(error)}`);
  }
  let evidence;
  try {
    evidence = readEvidenceFile(evidencePath);
  } catch (error: unknown) {
    const code =
      error instanceof EvidenceError && error.code === 'INVALID_EVIDENCE'
        ? 'INVALID_EVIDENCE'
        : 'MISSING_EVIDENCE';
    if (error instanceof EvidenceError && error.code === 'UNREADABLE_EVIDENCE') {
      return fail(manifest, 'MISSING_EVIDENCE', `No readable evidence for ${manifest.id}@${manifest.version} at ${evidencePath}.`);
    }
    return fail(
      manifest,
      code,
      `Evidence for ${manifest.id}@${manifest.version} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 4. Evidence binds this exact component and schema version.
  if (
    evidence.componentId !== manifest.id ||
    evidence.componentVersion !== manifest.version ||
    evidence.schemaVersion !== EVIDENCE_SCHEMA_VERSION
  ) {
    return fail(
      manifest,
      'EVIDENCE_MISMATCH',
      `Evidence at ${evidencePath} binds ${evidence.componentId}@${evidence.componentVersion} (schema ${evidence.schemaVersion}), not ${manifest.id}@${manifest.version} (schema ${EVIDENCE_SCHEMA_VERSION}).`,
    );
  }
  if (Number.isNaN(Date.parse(evidence.executedAt))) {
    return fail(manifest, 'INVALID_EVIDENCE', `Evidence executedAt is not a valid timestamp: ${JSON.stringify(evidence.executedAt)}.`);
  }

  // 5. Only an actual successful process exit counts as a pass.
  if (evidence.outcome !== 'pass' || evidence.exitCode !== 0) {
    return fail(
      manifest,
      'FAILED_TEST_EXECUTION',
      `Evidence records outcome ${JSON.stringify(evidence.outcome)} with exit code ${evidence.exitCode}; only an actual successful run (outcome "pass", exit 0) verifies a component.`,
    );
  }

  // 6. The recorded command must be a current allowlist member, exactly.
  const allowlist = options.allowlist ?? TEST_COMMAND_ALLOWLIST;
  const allowed = allowlist[evidence.testScope.commandKey];
  if (!allowed || allowed.command !== evidence.testScope.command) {
    return fail(
      manifest,
      'UNKNOWN_TEST_COMMAND',
      `Evidence test command ${JSON.stringify(evidence.testScope.command)} (key ${JSON.stringify(evidence.testScope.commandKey)}) is not an allowlisted repository-owned test command; manifest-supplied commands are never trusted.`,
    );
  }

  // 7. Fingerprint recomputed from the current checkout must match.
  let computed;
  try {
    computed = computeArtifactFingerprint(repoRoot, manifest, allManifests);
  } catch (error: unknown) {
    const code = error instanceof FingerprintError ? error.code : 'FINGERPRINT_ERROR';
    return fail(manifest, code, `Cannot recompute artifact fingerprint: ${error instanceof Error ? error.message : String(error)}`);
  }
  const staleSections = (Object.keys(computed.sections) as Array<keyof typeof computed.sections>)
    .filter((section) => computed.sections[section] !== evidence.sections[section])
    .sort();
  if (computed.fingerprint !== evidence.artifactFingerprint || staleSections.length > 0) {
    const scope = staleSections.length > 0 ? staleSections.join(', ') : 'artifact';
    return fail(
      manifest,
      'STALE_EVIDENCE',
      `Evidence fingerprint no longer matches the current checkout (changed area: ${scope}). ` +
        `Re-run verification to refresh evidence; stale passes are not trusted.`,
    );
  }
  const currentTestFiles = computed.files.filter((file) => file.includes('/tests/')).sort();
  if (JSON.stringify([...evidence.testScope.files].sort()) !== JSON.stringify(currentTestFiles)) {
    return fail(
      manifest,
      'STALE_TEST_SCOPE',
      `Evidence test scope [${evidence.testScope.files.join(', ')}] differs from the current scope [${currentTestFiles.join(', ')}].`,
    );
  }

  // 8. Recorded runtime must satisfy the declared Node requirement.
  const required = requiredNodeMajor(manifest.runtime.node);
  const actual = nodeMajor(evidence.nodeVersion);
  if (required !== undefined && (actual === undefined || actual < required)) {
    return fail(
      manifest,
      'NODE_RUNTIME_MISMATCH',
      `Evidence runtime ${evidence.nodeVersion} does not satisfy declared requirement ${JSON.stringify(manifest.runtime.node)}.`,
    );
  }

  return {
    id: manifest.id,
    version: manifest.version,
    valid: true,
    code: 'OK',
    reason: `Evidence at ${evidencePath} matches the current checkout (fingerprint ${computed.fingerprint.slice(0, 12)}…).`,
    unsubstantiatedClaim: false,
  };
}

export interface VerifiedSelection {
  verified: RegistryManifest[];
  rejected: Array<{ manifest: RegistryManifest; code: string; reason: string }>;
}

/**
 * Verified-only selection: return ONLY components whose evidence checks
 * out against current repository files. Anything else is rejected with an
 * explicit reason — never silently accepted, even when the manifest says
 * "verified".
 */
export function selectVerifiedManifests(
  repoRoot: string,
  manifests: readonly RegistryManifest[],
  options: ValidationOptions,
): VerifiedSelection {
  const verified: RegistryManifest[] = [];
  const rejected: VerifiedSelection['rejected'] = [];
  for (const manifest of manifests) {
    const result = validateComponent(repoRoot, manifest, manifests, options);
    if (result.valid) verified.push(manifest);
    else rejected.push({ manifest, code: result.code, reason: result.reason });
  }
  verified.sort((a, b) => (`${a.id}@${a.version}` < `${b.id}@${b.version}` ? -1 : 1));
  return { verified, rejected };
}
