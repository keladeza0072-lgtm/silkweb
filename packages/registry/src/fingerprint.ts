import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { RegistryManifest } from './manifest.js';

/**
 * Deterministic SHA-256 artifact fingerprints for registry components.
 *
 * A fingerprint covers everything that defines what a component IS:
 * - manifest identity + functional metadata (id, version, sourcePath,
 *   sorted dependencies, sorted capabilities, invariants, runtime)
 * - source bytes of the component and every transitive component
 *   dependency (resolved through the manifest dependency closure)
 * - test files relevant to the component closure
 * - the package lockfile bytes (exact pinned dependency tree)
 * - the declared runtime/dependency environment (package.json bytes)
 *
 * Explicitly EXCLUDED: everything under `verification` (status,
 * testCommand, sourceHash, evidence). Verification results describe a past
 * check of the artifact; hashing them into the artifact would make every
 * fingerprint circular (recording evidence would change the hash the
 * evidence attests to).
 *
 * Actual runtime versions (Node, SQLite) are likewise excluded: they are
 * recorded in the evidence record, not the fingerprint, so the same source
 * tree hashes identically on any machine.
 *
 * Determinism rules:
 * - file paths are repo-relative with `/` separators, sorted byte-wise
 * - each file contributes `path + "\0" + bytes + "\0"` (null framing, so
 *   concatenation boundaries cannot collide)
 * - metadata is canonical JSON (sorted keys, no whitespace)
 * - text is hashed as UTF-8 bytes; file bytes are hashed raw
 */

export const LOCKFILE_REL = 'packages/registry/package-lock.json';
export const PACKAGE_JSON_REL = 'packages/registry/package.json';

/** Component test files for the four Day-2 registry components. */
const COMPONENT_TEST_FILES: Record<string, readonly string[]> = {
  'booking-schema': ['packages/registry/tests/schema.test.mjs'],
  'booking-validation': ['packages/registry/tests/validation.test.mjs'],
  'booking-slot-guard': ['packages/registry/tests/slotGuard.test.mjs'],
  'registry-loader': ['packages/registry/tests/loader.test.mjs'],
};

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export class FingerprintError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FingerprintError';
    this.code = code;
  }
}

/**
 * Reject any repo-relative path that could escape the checkout.
 * Throws FingerprintError with code UNSAFE_PATH.
 */
export function assertSafeRepoRelPath(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.includes('\0')) {
    throw new FingerprintError('UNSAFE_PATH', `unsafe repository path: ${JSON.stringify(raw)}`);
  }
  const normalized = raw.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:(\/|$)/.test(normalized) ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new FingerprintError('UNSAFE_PATH', `unsafe repository path: ${JSON.stringify(raw)}`);
  }
  return normalized;
}

/** Resolve a safe repo-relative path against repoRoot, staying inside it. */
export function resolveRepoPath(repoRoot: string, rel: string): string {
  const safe = assertSafeRepoRelPath(rel);
  const absolute = resolve(repoRoot, ...safe.split('/'));
  const root = resolve(repoRoot);
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    throw new FingerprintError('UNSAFE_PATH', `path escapes repository root: ${JSON.stringify(rel)}`);
  }
  return absolute;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Canonical JSON: sorted object keys, no whitespace, arrays preserved. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

export interface FingerprintSections {
  /** Manifest identity + functional metadata (verification excluded). */
  manifest: string;
  /** Source bytes of the component closure, in sorted-path order. */
  sources: string;
  /** Test files covering the component closure. */
  tests: string;
  /** Exact pinned dependency tree (lockfile bytes). */
  lockfile: string;
  /** Declared environment (package.json bytes). */
  environment: string;
}

export interface ArtifactFingerprint {
  fingerprint: string;
  sections: FingerprintSections;
  /** Every repo-relative file hashed, sorted (for test-scope records). */
  files: string[];
}

function hashFileEntry(hasher: ReturnType<typeof createHash>, rel: string, absolute: string): void {
  let data: Buffer;
  try {
    const stat = statSync(absolute);
    if (!stat.isFile()) {
      throw new FingerprintError('MISSING_FILE', `not a file: ${rel}`);
    }
    data = readFileSync(absolute);
  } catch (error: unknown) {
    if (error instanceof FingerprintError) throw error;
    throw new FingerprintError('MISSING_FILE', `cannot read fingerprinted file ${rel}: ${String(error)}`);
  }
  hasher.update(rel, 'utf8');
  hasher.update('\0');
  hasher.update(data);
  hasher.update('\0');
}

export type ManifestIndex = Map<string, RegistryManifest>;

export function indexManifests(manifests: readonly RegistryManifest[]): ManifestIndex {
  const index = new Map<string, RegistryManifest>();
  for (const manifest of manifests) index.set(`${manifest.id}@${manifest.version}`, manifest);
  return index;
}

/**
 * Resolve the transitive component dependency closure (the component
 * itself plus every direct/transitive dependency), sorted by
 * `id@version`. Throws on missing dependencies and dependency cycles.
 */
export function resolveClosure(
  manifest: RegistryManifest,
  index: ManifestIndex,
): RegistryManifest[] {
  const members = new Map<string, RegistryManifest>();
  const visiting: string[] = [];
  const visit = (current: RegistryManifest): void => {
    const key = `${current.id}@${current.version}`;
    if (members.has(key)) return;
    const cycleAt = visiting.indexOf(key);
    if (cycleAt !== -1) {
      throw new FingerprintError(
        'CIRCULAR_DEPENDENCY',
        `circular dependency: ${[...visiting.slice(cycleAt), key].join(' -> ')}`,
      );
    }
    visiting.push(key);
    for (const dep of current.dependencies) {
      const depKey = `${dep.id}@${dep.version}`;
      const resolved = index.get(depKey);
      if (!resolved) {
        throw new FingerprintError(
          'MISSING_DEPENDENCY',
          `${current.id}@${current.version} requires missing dependency ${depKey}`,
        );
      }
      visit(resolved);
    }
    visiting.pop();
    members.set(key, current);
  };
  visit(manifest);
  return [...members.values()].sort((a, b) =>
    `${a.id}@${a.version}` < `${b.id}@${b.version}` ? -1 : 1,
  );
}

/** Test files relevant to one component id (explicit map, else convention). */
export function testFilesFor(componentId: string): string[] {
  const mapped = COMPONENT_TEST_FILES[componentId];
  if (mapped) return [...mapped];
  if (!SAFE_ID_PATTERN.test(componentId)) {
    throw new FingerprintError('UNSAFE_PATH', `unsafe component id: ${JSON.stringify(componentId)}`);
  }
  return [`packages/registry/tests/${componentId}.test.mjs`];
}

function manifestProjection(manifest: RegistryManifest): string {
  return canonicalJson({
    capabilities: [...manifest.capabilities].sort(),
    dependencies: [...manifest.dependencies]
      .map((dep) => ({ id: dep.id, version: dep.version }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.version < b.version ? -1 : 1)),
    id: manifest.id,
    invariants: manifest.invariants,
    runtime: manifest.runtime,
    sourcePath: manifest.sourcePath,
    version: manifest.version,
  });
}

/**
 * Compute the deterministic artifact fingerprint of one component in the
 * current checkout. Pure read-only function of (repoRoot files, manifests).
 */
export function computeArtifactFingerprint(
  repoRoot: string,
  manifest: RegistryManifest,
  allManifests: readonly RegistryManifest[],
): ArtifactFingerprint {
  const closure = resolveClosure(manifest, indexManifests(allManifests));

  const manifestHasher = createHash('sha256');
  for (const member of closure) {
    manifestHasher.update(member.id, 'utf8');
    manifestHasher.update('\0');
    manifestHasher.update(member.version, 'utf8');
    manifestHasher.update('\0');
    manifestHasher.update(manifestProjection(member), 'utf8');
    manifestHasher.update('\0');
  }

  const sourceRels = closure.map((member) => assertSafeRepoRelPath(member.sourcePath)).sort();
  const sourceHasher = createHash('sha256');
  for (const rel of sourceRels) hashFileEntry(sourceHasher, rel, resolveRepoPath(repoRoot, rel));

  const testRels = [...new Set(closure.flatMap((member) => testFilesFor(member.id)))].sort();
  const testHasher = createHash('sha256');
  for (const rel of testRels) hashFileEntry(testHasher, rel, resolveRepoPath(repoRoot, rel));

  const lockfileHasher = createHash('sha256');
  hashFileEntry(lockfileHasher, LOCKFILE_REL, resolveRepoPath(repoRoot, LOCKFILE_REL));

  const envHasher = createHash('sha256');
  hashFileEntry(envHasher, PACKAGE_JSON_REL, resolveRepoPath(repoRoot, PACKAGE_JSON_REL));

  const sections: FingerprintSections = {
    manifest: manifestHasher.digest('hex'),
    sources: sourceHasher.digest('hex'),
    tests: testHasher.digest('hex'),
    lockfile: lockfileHasher.digest('hex'),
    environment: envHasher.digest('hex'),
  };
  const top = createHash('sha256');
  for (const name of ['manifest', 'sources', 'tests', 'lockfile', 'environment'] as const) {
    top.update(name, 'utf8');
    top.update('\0');
    top.update(sections[name], 'utf8');
    top.update('\0');
  }
  return {
    fingerprint: top.digest('hex'),
    sections,
    files: [...sourceRels, ...testRels, LOCKFILE_REL, PACKAGE_JSON_REL].sort(),
  };
}
