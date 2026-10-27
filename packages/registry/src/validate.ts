import { readFileSync, statSync } from 'node:fs';
import {
  LOCKFILE_REL,
  closureTestFiles,
  computeArtifactFingerprint,
  indexManifests,
  resolveClosure,
  resolveRepoPath,
  sha256Hex,
  FingerprintError,
} from './fingerprint.js';
import { EVIDENCE_SCHEMA_VERSION, resolveEvidencePath, readEvidenceFile, EvidenceError } from './evidence.js';
import { COMPONENT_ALLOWED_COMMANDS, TEST_COMMAND_ALLOWLIST } from './runner.js';
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
 * - the recorded command is allowed for this component by the explicit
 *   component-to-test mapping, names exactly the tests it executed,
 *   and covers the component's test scope
 * - the evidence fingerprint (per section, including shared sources and
 *   compiler configuration) matches a fresh recomputation from current
 *   repository files
 * - every recorded build artifact is still byte-identical in the
 *   current checkout (mapped components must record artifacts)
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
  /**
   * Explicit allowlist the evidence command must belong to. Entries
   * may declare the test files they execute and the build command
   * that produced the artifacts; entries without them keep the
   * legacy check (evidence files must equal the closure test scope).
   */
  allowlist?: Record<string, { command: string; testFiles?: readonly string[]; build?: { command: string } }>;
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

  // 6. The recorded command must be a current allowlist member, exactly,
  // and the component-to-test mapping must allow it for this component.
  const allowlist = options.allowlist ?? TEST_COMMAND_ALLOWLIST;
  const allowed = allowlist[evidence.testScope.commandKey];
  if (!allowed || allowed.command !== evidence.testScope.command) {
    return fail(
      manifest,
      'UNKNOWN_TEST_COMMAND',
      `Evidence test command ${JSON.stringify(evidence.testScope.command)} (key ${JSON.stringify(evidence.testScope.commandKey)}) is not an allowlisted repository-owned test command; manifest-supplied commands are never trusted.`,
    );
  }
  const mapped = COMPONENT_ALLOWED_COMMANDS[manifest.id];
  if (mapped !== undefined && !mapped.includes(evidence.testScope.commandKey)) {
    return fail(
      manifest,
      'WRONG_TEST_SCOPE',
      `Evidence test command ${JSON.stringify(evidence.testScope.commandKey)} cannot certify ${manifest.id}@${manifest.version} ` +
        `(allowed: ${mapped.map((key) => JSON.stringify(key)).join(', ')}). ` +
        `A component must be verified with tests that actually cover it — booking components never pass on loader-only tests.`,
    );
  }

  // 7. The recorded test files must be exactly what the allowlisted
  // command executes, and they must cover the component's test scope.
  // (Entries without declared testFiles keep the legacy check: the
  // evidence must name the closure's test files exactly.)
  let closureTests: string[];
  try {
    closureTests = closureTestFiles(manifest, allManifests);
  } catch (error: unknown) {
    const code = error instanceof FingerprintError ? error.code : 'DEPENDENCY_ERROR';
    return fail(manifest, code, `Cannot resolve test scope of ${manifest.id}@${manifest.version}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const declaredTestFiles = [...(allowed.testFiles ?? closureTests)].sort();
  if (JSON.stringify([...evidence.testScope.files].sort()) !== JSON.stringify(declaredTestFiles)) {
    return fail(
      manifest,
      'STALE_TEST_SCOPE',
      `Evidence test scope [${evidence.testScope.files.join(', ')}] differs from what ${JSON.stringify(evidence.testScope.commandKey)} executes [${declaredTestFiles.join(', ')}].`,
    );
  }
  const uncovered = closureTests.filter((file) => !evidence.testScope.files.includes(file));
  if (uncovered.length > 0) {
    return fail(
      manifest,
      'WRONG_TEST_SCOPE',
      `Evidence test scope [${evidence.testScope.files.join(', ')}] does not cover ${manifest.id}@${manifest.version} (missing ${uncovered.map((file) => JSON.stringify(file)).join(', ')}).`,
    );
  }
  const expectedBuildCommand = allowed.build?.command ?? 'none';
  if (evidence.build.command !== expectedBuildCommand) {
    return fail(
      manifest,
      'STALE_TEST_SCOPE',
      `Evidence build command ${JSON.stringify(evidence.build.command)} differs from the allowlisted build ${JSON.stringify(expectedBuildCommand)} for ${JSON.stringify(evidence.testScope.commandKey)}.`,
    );
  }

  // 8. Fingerprint recomputed from the current checkout must match.
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

  // 9. The executed build artifacts must still be byte-identical.
  // Components with an explicit test mapping always record artifacts;
  // evidence without them is missing its executable binding.
  if (evidence.build.artifacts.length === 0) {
    if (mapped !== undefined) {
      return fail(
        manifest,
        'MISSING_BUILD_ARTIFACTS',
        `Evidence for ${manifest.id}@${manifest.version} binds no executed build artifacts; ` +
          `only a fresh-build verification run can certify this component.`,
      );
    }
  } else {
    const seen = new Set<string>();
    for (const artifact of evidence.build.artifacts) {
      if (seen.has(artifact.file)) {
        return fail(
          manifest,
          'INVALID_EVIDENCE',
          `Evidence lists build artifact ${JSON.stringify(artifact.file)} more than once.`,
        );
      }
      seen.add(artifact.file);
      let data: Buffer;
      try {
        const absolute = resolveRepoPath(repoRoot, artifact.file);
        const stat = statSync(absolute);
        if (!stat.isFile()) {
          return fail(
            manifest,
            'STALE_ARTIFACT',
            `Executed build artifact ${JSON.stringify(artifact.file)} is missing from the current checkout; re-run verification to rebuild it.`,
          );
        }
        data = readFileSync(absolute);
      } catch (error: unknown) {
        return fail(
          manifest,
          'STALE_ARTIFACT',
          `Cannot read executed build artifact ${JSON.stringify(artifact.file)}: ${String(error)}`,
        );
      }
      if (sha256Hex(data) !== artifact.sha256) {
        return fail(
          manifest,
          'STALE_ARTIFACT',
          `Executed build artifact ${JSON.stringify(artifact.file)} changed after the verification run; ` +
            `the recorded tests did not execute this file. Re-run verification to rebuild and re-test.`,
        );
      }
    }
  }

  // 10. Recorded runtime must satisfy the declared Node requirement.
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
