import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { RegistryManifest } from './manifest.js';

/**
 * Deterministic SHA-256 artifact fingerprints for registry components.
 *
 * A fingerprint covers everything that defines what a component IS:
 * - manifest identity + functional metadata (id, version, sourcePath,
 *   sorted dependencies, sorted capabilities, invariants, runtime)
 * - source bytes of the component, every transitive component
 *   dependency (resolved through the manifest dependency closure), and
 *   every shared local module in the explicit COMPONENT_EXTRA_SOURCES
 *   map (completeness is enforced by scanning local imports)
 * - test files relevant to the component closure
 * - the package lockfile bytes (exact pinned dependency tree)
 * - the declared runtime/dependency environment (package.json bytes)
 * - the TypeScript compiler configuration (tsconfig bytes), which
 *   shapes the compiled artifacts the tests actually execute
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
/** TypeScript compiler configuration: it shapes every compiled artifact the tests execute. */
export const TSCONFIG_REL = 'packages/registry/tsconfig.json';
/** Fingerprint contribution when a checkout has no compiler configuration. */
const TSCONFIG_ABSENT_MARKER = 'no-tsconfig-present';

/** Component test files for the four Day-2 registry components. */
const COMPONENT_TEST_FILES: Record<string, readonly string[]> = {
  'booking-schema': ['packages/registry/tests/schema.test.mjs'],
  'booking-validation': ['packages/registry/tests/validation.test.mjs'],
  'booking-slot-guard': ['packages/registry/tests/slotGuard.test.mjs'],
  'registry-loader': ['packages/registry/tests/loader.test.mjs'],
  // Both the top-level suite and its independently spawned process worker
  // contribute to certification; either edit invalidates evidence.
  'inventory-reservation': [
    'packages/registry/tests/inventory-reservation.test.mjs',
    'packages/registry/tests/inventory-race-worker.mjs',
  ],
};

/**
 * Shared local TypeScript modules each component needs beyond its own
 * `sourcePath` and its manifest-dependency closure. Every relative
 * `from './…'` import found by scanning those files must be listed here;
 * anything missing fails closed with INCOMPLETE_SOURCE_MAP instead of
 * being silently left out of the fingerprint.
 *
 * - registry-loader's `src/loader.ts` imports the manifest schema from
 *   `src/manifest.ts`, which is a local module import, not a manifest
 *   dependency — without this entry, changing `manifest.ts` would leave
 *   registry-loader evidence valid.
 * - The booking sources only import each other through the manifest
 *   dependency closure (slotGuard → validation → schema), so they need
 *   no extra entries; the empty arrays document that explicitly.
 */
export const COMPONENT_EXTRA_SOURCES: Record<string, readonly string[]> = {
  'booking-schema': [],
  'booking-validation': [],
  'booking-slot-guard': [],
  'registry-loader': ['packages/registry/src/manifest.ts'],
  'inventory-reservation': [],
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
  /** Compiler configuration (tsconfig bytes) shaping executable output. */
  build: string;
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

/** Extra shared sources for one component id (explicit map, else none). */
export function extraSourcesFor(componentId: string): string[] | undefined {
  const mapped = COMPONENT_EXTRA_SOURCES[componentId];
  return mapped === undefined ? undefined : [...mapped];
}

const STATIC_IMPORT_PATTERN = /(?:import|export)[^;]*?from\s*['"](\.[^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

/** Join a relative import against its importer's repo-relative directory. */
function resolveRelativeImport(fromRel: string, specifier: string): string | undefined {
  let target = specifier;
  if (target.endsWith('.js')) target = `${target.slice(0, -3)}.ts`;
  else if (!target.endsWith('.ts')) return undefined;
  const parts: string[] = [];
  for (const segment of [...dirname(fromRel).split('/'), ...target.split('/')]) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  const resolved = parts.join('/');
  try {
    return assertSafeRepoRelPath(resolved);
  } catch {
    return undefined;
  }
}

/**
 * Local TypeScript files one source file imports via relative
 * `./…`/`../…` specifiers (compiled `.js` spellings included).
 * Bare, absolute, and non-TypeScript imports are out of scope.
 */
export function localSourceImports(repoRoot: string, fromRel: string): string[] {
  const absolute = resolveRepoPath(repoRoot, fromRel);
  let text: string;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch (error: unknown) {
    throw new FingerprintError('MISSING_FILE', `cannot read fingerprinted file ${fromRel}: ${String(error)}`);
  }
  const found = new Set<string>();
  for (const pattern of [STATIC_IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const resolved = resolveRelativeImport(fromRel, match[1]);
      if (resolved !== undefined) found.add(resolved);
    }
  }
  return [...found].sort();
}

/**
 * Every source file that materially affects one component, sorted:
 * its manifest-dependency closure `sourcePath` entries, its explicit
 * extra shared sources, and (for component ids with no explicit map)
 * transitive local imports discovered by scanning.
 *
 * Component ids WITH an explicit map are checked strictly: any scanned
 * local import not listed in the map throws INCOMPLETE_SOURCE_MAP, so a
 * new shared-module import can never slip silently out of the
 * fingerprint. Every mapped path must be safe and readable.
 */
export function sourceFilesForComponent(
  repoRoot: string,
  manifest: RegistryManifest,
  allManifests: readonly RegistryManifest[],
): string[] {
  const closure = resolveClosure(manifest, indexManifests(allManifests));
  const seed = new Set(closure.map((member) => assertSafeRepoRelPath(member.sourcePath)));
  const mapped = COMPONENT_EXTRA_SOURCES[manifest.id];
  if (mapped !== undefined) {
    for (const rel of mapped) seed.add(assertSafeRepoRelPath(rel));
  } else {
    const queue = [...seed];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const imported of localSourceImports(repoRoot, current)) {
        if (!seed.has(imported)) {
          seed.add(imported);
          queue.push(imported);
        }
      }
    }
    return [...seed].sort();
  }
  const files = [...seed].sort();
  const missing = new Set<string>();
  for (const rel of files) {
    for (const imported of localSourceImports(repoRoot, rel)) {
      if (!seed.has(imported)) missing.add(`${rel} imports unmapped ${imported}`);
    }
  }
  if (missing.size > 0) {
    throw new FingerprintError(
      'INCOMPLETE_SOURCE_MAP',
      `explicit source map for ${manifest.id}@${manifest.version} is incomplete: ${[...missing].sort().join('; ')}. ` +
        `List every shared local module in COMPONENT_EXTRA_SOURCES.`,
    );
  }
  return files;
}

/** Sorted test files covering one component's dependency closure. */
export function closureTestFiles(
  manifest: RegistryManifest,
  allManifests: readonly RegistryManifest[],
): string[] {
  const closure = resolveClosure(manifest, indexManifests(allManifests));
  return [...new Set(closure.flatMap((member) => testFilesFor(member.id)))].sort();
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

  const sourceRels = sourceFilesForComponent(repoRoot, manifest, allManifests);
  const sourceHasher = createHash('sha256');
  for (const rel of sourceRels) hashFileEntry(sourceHasher, rel, resolveRepoPath(repoRoot, rel));

  const testRels = [...new Set(closure.flatMap((member) => testFilesFor(member.id)))].sort();
  const testHasher = createHash('sha256');
  for (const rel of testRels) hashFileEntry(testHasher, rel, resolveRepoPath(repoRoot, rel));

  const lockfileHasher = createHash('sha256');
  hashFileEntry(lockfileHasher, LOCKFILE_REL, resolveRepoPath(repoRoot, LOCKFILE_REL));

  const envHasher = createHash('sha256');
  hashFileEntry(envHasher, PACKAGE_JSON_REL, resolveRepoPath(repoRoot, PACKAGE_JSON_REL));

  const buildHasher = createHash('sha256');
  let tsconfigBytes: Buffer | undefined;
  try {
    const stat = statSync(resolveRepoPath(repoRoot, TSCONFIG_REL));
    if (stat.isFile()) tsconfigBytes = readFileSync(resolveRepoPath(repoRoot, TSCONFIG_REL));
  } catch {
    tsconfigBytes = undefined;
  }
  if (tsconfigBytes === undefined) {
    buildHasher.update(TSCONFIG_ABSENT_MARKER, 'utf8');
  } else {
    buildHasher.update(TSCONFIG_REL, 'utf8');
    buildHasher.update('\0');
    buildHasher.update(tsconfigBytes);
    buildHasher.update('\0');
  }

  const sections: FingerprintSections = {
    manifest: manifestHasher.digest('hex'),
    sources: sourceHasher.digest('hex'),
    tests: testHasher.digest('hex'),
    lockfile: lockfileHasher.digest('hex'),
    environment: envHasher.digest('hex'),
    build: buildHasher.digest('hex'),
  };
  const top = createHash('sha256');
  for (const name of ['manifest', 'sources', 'tests', 'lockfile', 'environment', 'build'] as const) {
    top.update(name, 'utf8');
    top.update('\0');
    top.update(sections[name], 'utf8');
    top.update('\0');
  }
  const hashedFiles = [...sourceRels, ...testRels, LOCKFILE_REL, PACKAGE_JSON_REL];
  if (tsconfigBytes !== undefined) hashedFiles.push(TSCONFIG_REL);
  return {
    fingerprint: top.digest('hex'),
    sections,
    files: hashedFiles.sort(),
  };
}
