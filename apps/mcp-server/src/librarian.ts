import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Librarian trust core for the local Silk Web MCP server.
 *
 * Read-only bridge between MCP tools and the Git-backed certified
 * registry. Never executes manifest-provided commands, never regenerates
 * certification evidence, and never modifies manifests.
 *
 * Trust rule (fail-closed): a component is available ONLY when its
 * manifest declares `verification.status === "verified"` AND
 * `validateComponent` confirms its current evidence against the live
 * checkout. Either condition alone is insufficient — in particular,
 * evidence-valid manifests whose declared status remains "unverified"
 * are never served.
 */

export const MANIFEST_DIR_REL = 'registry-data/manifests';
export const EVIDENCE_DIR_REL = 'registry-data/evidence';
export const REGISTRY_DIST_REL = 'packages/registry/dist/index.js';

export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 25;

export const SOURCE_DEFAULT_MAX_BYTES_PER_FILE = 12_000;
export const SOURCE_HARD_MAX_BYTES_PER_FILE = 20_000;
export const SOURCE_DEFAULT_MAX_TOTAL_BYTES = 60_000;
export const SOURCE_HARD_MAX_TOTAL_BYTES = 100_000;
export const SOURCE_MAX_FILES = 10;

export class LibrarianError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LibrarianError';
    this.code = code;
  }
}

export interface ManifestDependency {
  id: string;
  version: string;
}

export interface RegistryManifestView {
  id: string;
  version: string;
  sourcePath: string;
  dependencies: ManifestDependency[];
  capabilities: string[];
  invariants: string[];
  runtime: { stack: string; node: string; dependencies: Record<string, string> };
  verification: { status: string; testCommand: string; sourceHash?: string; evidence: string };
}

export interface ComponentValidationView {
  id: string;
  version: string;
  valid: boolean;
  code: string;
  reason: string;
}

interface RegistryLib {
  loadRegistry(dir: string): RegistryManifestView[];
  validateComponent(
    repoRoot: string,
    manifest: RegistryManifestView,
    allManifests: readonly RegistryManifestView[],
    options: { evidenceDir: string },
  ): ComponentValidationView;
  sourceFilesForComponent(
    repoRoot: string,
    manifest: RegistryManifestView,
    allManifests: readonly RegistryManifestView[],
  ): string[];
  readEvidenceFile(absolutePath: string): Record<string, unknown>;
  resolveEvidencePath(repoRoot: string, evidenceDir: string, id: string, version: string): string;
}

const libCache = new Map<string, Promise<RegistryLib>>();

/** Local build prerequisite message shared by every fail-closed path. */
export function buildPrerequisiteMessage(): string {
  return (
    'Local build prerequisite: from the repository root run ' +
    '"npm run build" in packages/registry, then "npm run build" in apps/mcp-server.'
  );
}

/**
 * Resolve the repository root independently of the caller's working
 * directory: walk up from the running server file until a directory
 * containing `registry-data/manifests` is found. SILKWEB_REPO_ROOT
 * overrides discovery (operator-controlled only, never caller input).
 */
export function discoverRepoRoot(serverFileDir: string): string {
  const override = process.env.SILKWEB_REPO_ROOT?.trim();
  if (override) {
    const root = resolve(override);
    if (!existsSync(join(root, MANIFEST_DIR_REL))) {
      throw new LibrarianError(
        'REPO_ROOT_NOT_FOUND',
        `SILKWEB_REPO_ROOT=${JSON.stringify(override)} does not contain ${MANIFEST_DIR_REL}.`,
      );
    }
    return root;
  }
  let dir = resolve(serverFileDir);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, MANIFEST_DIR_REL))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new LibrarianError(
    'REPO_ROOT_NOT_FOUND',
    `Cannot locate ${MANIFEST_DIR_REL} above ${serverFileDir}. ${buildPrerequisiteMessage()}`,
  );
}

/** Directory holding the manifest JSON files (absolute path). */
export function resolveManifestDir(repoRoot: string): string {
  const override = process.env.SILKWEB_MANIFEST_DIR?.trim();
  const dir = override ? resolve(override) : join(repoRoot, MANIFEST_DIR_REL);
  assertOperatorPathAllowed(dir, 'manifest directory');
  return dir;
}

/** Repo-relative evidence directory passed to validateComponent. */
export function resolveEvidenceDirRel(): string {
  const override = process.env.SILKWEB_EVIDENCE_DIR?.trim();
  const rel = override ?? EVIDENCE_DIR_REL;
  if (!isSafeRepoRelPath(rel)) {
    throw new LibrarianError('UNSAFE_PATH', `Refusing unsafe evidence directory: ${JSON.stringify(rel)}.`);
  }
  return rel.replace(/\\/g, '/');
}

/**
 * Operator-controlled paths (env overrides) must never reach into the
 * held-out experiment area.
 */
function assertOperatorPathAllowed(absoluteDir: string, what: string): void {
  const segments = absoluteDir.replace(/\\/g, '/').toLowerCase().split('/');
  if (segments.includes('experiments') || segments.includes('harness')) {
    throw new LibrarianError(
      'FORBIDDEN_PATH',
      `Refusing ${what} inside experiments/harness: ${absoluteDir}.`,
    );
  }
}

function isSafeRepoRelPath(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.includes('\0')) return false;
  const normalized = raw.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:(\/|$)/.test(normalized)) return false;
  return !normalized
    .split('/')
    .some((segment) => segment === '' || segment === '.' || segment === '..');
}

/**
 * A source file is servable only when it is a safe repo-relative path
 * and lives outside the held-out experiment area. Defense in depth on
 * top of the registry's own path checks: never experiments/, never a
 * harness segment, never anything that escapes the checkout.
 */
export function assertServableSourcePath(rel: string): string {
  const normalized = rel.replace(/\\/g, '/');
  if (!isSafeRepoRelPath(normalized)) {
    throw new LibrarianError('UNSAFE_PATH', `Refusing unsafe source path: ${JSON.stringify(rel)}.`);
  }
  const segments = normalized.toLowerCase().split('/');
  if (segments.includes('experiments') || segments.includes('harness')) {
    throw new LibrarianError(
      'FORBIDDEN_PATH',
      `Refusing source path inside experiments/harness: ${JSON.stringify(rel)}.`,
    );
  }
  return normalized;
}

/** Fail closed with build instructions when the registry dist is absent. */
export function loadRegistryLib(repoRoot: string): Promise<RegistryLib> {
  const cached = libCache.get(repoRoot);
  if (cached) return cached;
  const task = (async (): Promise<RegistryLib> => {
    const entry = join(repoRoot, REGISTRY_DIST_REL);
    if (!existsSync(entry)) {
      throw new LibrarianError(
        'REGISTRY_BUILD_MISSING',
        `Registry build artifact is missing: ${REGISTRY_DIST_REL}. ${buildPrerequisiteMessage()}`,
      );
    }
    try {
      return (await import(pathToFileURL(entry).href)) as RegistryLib;
    } catch (error: unknown) {
      throw new LibrarianError(
        'REGISTRY_BUILD_MISSING',
        `Cannot load registry build at ${entry}: ${String(error)} ${buildPrerequisiteMessage()}`,
      );
    }
  })();
  libCache.set(repoRoot, task);
  task.catch(() => {
    libCache.delete(repoRoot);
  });
  return task;
}

export interface TrustedSelection {
  repoRoot: string;
  manifestDir: string;
  evidenceDirRel: string;
  all: RegistryManifestView[];
  trusted: RegistryManifestView[];
  rejected: Array<{ id: string; version: string; code: string; reason: string }>;
  lib: RegistryLib;
}

/**
 * The trust gate: load every manifest, then keep ONLY components whose
 * manifest declares status "verified" AND whose current evidence
 * validates. Returns both sides so callers can report honestly.
 */
export function isTrusted(manifest: RegistryManifestView, validation: ComponentValidationView): boolean {
  return manifest.verification.status === 'verified' && validation.valid === true;
}

export async function selectTrustedComponents(): Promise<TrustedSelection> {
  const serverDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = discoverRepoRoot(serverDir);
  const manifestDir = resolveManifestDir(repoRoot);
  const evidenceDirRel = resolveEvidenceDirRel();
  const lib = await loadRegistryLib(repoRoot);
  let all: RegistryManifestView[];
  try {
    all = lib.loadRegistry(manifestDir);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LibrarianError('REGISTRY_LOAD_ERROR', `Cannot load manifests from ${manifestDir}: ${message}`);
  }
  const trusted: RegistryManifestView[] = [];
  const rejected: TrustedSelection['rejected'] = [];
  for (const manifest of all) {
    let validation: ComponentValidationView;
    try {
      validation = lib.validateComponent(repoRoot, manifest, all, { evidenceDir: evidenceDirRel });
    } catch (error: unknown) {
      rejected.push({
        id: manifest.id,
        version: manifest.version,
        code: 'VALIDATION_ERROR',
        reason: `Validator threw for ${manifest.id}@${manifest.version}: ${String(error)}`,
      });
      continue;
    }
    if (isTrusted(manifest, validation)) {
      trusted.push(manifest);
      continue;
    }
    if (manifest.verification.status !== 'verified') {
      rejected.push({
        id: manifest.id,
        version: manifest.version,
        code: 'UNVERIFIED',
        reason:
          `Manifest ${manifest.id}@${manifest.version} declares ` +
          `verification.status=${JSON.stringify(manifest.verification.status)}; ` +
          'only "verified" components with currently valid evidence are served.',
      });
      continue;
    }
    rejected.push({ id: manifest.id, version: manifest.version, code: validation.code, reason: validation.reason });
  }
  trusted.sort((a, b) => (`${a.id}@${a.version}` < `${b.id}@${b.version}` ? -1 : 1));
  return { repoRoot, manifestDir, evidenceDirRel, all, trusted, rejected, lib };
}

export interface ComponentSummary {
  id: string;
  version: string;
  capabilities: string[];
  stack: string;
  summary: string;
}

export interface SearchResult {
  components: ComponentSummary[];
  totalTrusted: number;
  rejected: Array<{ id: string; version: string; code: string }>;
}

function summarizeManifest(manifest: RegistryManifestView): ComponentSummary {
  const first = manifest.invariants[0] ?? manifest.capabilities.join(', ');
  return {
    id: manifest.id,
    version: manifest.version,
    capabilities: [...manifest.capabilities],
    stack: manifest.runtime.stack,
    summary: first.length > 200 ? `${first.slice(0, 197)}...` : first,
  };
}

const SEARCH_ALIASES: Record<string, string> = {
  appointment: 'booking',
  appointments: 'booking',
  bookings: 'booking',
  reservation: 'booking',
  reservations: 'booking',
  validators: 'validation',
  validator: 'validation',
  validate: 'validation',
  validating: 'validation',
  schemas: 'schema',
  slots: 'slot',
  mins: 'minute',
  minutes: 'minute',
  schedules: 'schedule',
  scheduling: 'schedule',
  guards: 'guard',
  // User intent expressed as behavior, not necessarily a manifest tag.
  concurrent: 'atomic',
  concurrently: 'atomic',
  concurrency: 'atomic',
  race: 'atomic',
  races: 'atomic',
  parallel: 'atomic',
  retries: 'idempotency',
  retry: 'idempotency',
  idempotent: 'idempotency',
};

// Implementation wrappers are *not* registry concepts. A coding model
// asking for a "reservation booking appointment API" means "booking",
// not "booking AND api". Remove generic transport/app words before requiring
// all meaningful tokens to match.
const SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'the', 'for', 'of', 'and', 'or', 'to', 'with', 'that',
  'which', 'find', 'me', 'need', 'component', 'components',
  'api', 'apis', 'http', 'rest', 'endpoint', 'endpoints',
  'app', 'apps', 'application', 'applications', 'backend', 'server',
  'implement', 'implementation', 'build', 'building', 'create',
  'creating', 'code', 'module', 'library', 'using', 'use',
]);

function searchTokens(value: string): string[] {
  return [...new Set(
    (value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .map(word => SEARCH_ALIASES[word] ?? word)
      .filter(word => !SEARCH_STOP_WORDS.has(word))
  )];
}

function matchesNaturalLanguageSearch(manifest: RegistryManifestView, query: string): boolean {
  const haystack =
    `${manifest.id} ${manifest.version} ${manifest.capabilities.join(' ')} ${manifest.invariants.join(' ')}`.toLowerCase();
  const normalized = query.trim().toLowerCase();

  // Preserve pre-existing literal substring search behavior.
  if (haystack.includes(normalized)) return true;

  const tokens = searchTokens(normalized);
  if (tokens.length === 0) return false;

  const available = new Set(searchTokens(haystack));
  const matched = tokens.filter(term => available.has(term)).length;

  // A matching canonical domain term is necessary. Do not fall back to
  // all components on empty/unknown queries; preserve fail-closed discovery.
  // Require all terms for short queries and >=70% for longer queries.
  return matched >= (tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.7));
}

/**
 * Deterministic search over trusted components only. Exact stack and AND
 * capability filters stay unchanged; free-text search supports exact
 * substrings plus conservative token/alias matching. No additional LLM
 * inference and no unverified component exposure.
 */
export function searchTrusted(
  selection: TrustedSelection,
  options: { capabilities?: string[]; stack?: string; query?: string; limit?: number },
): SearchResult {
  const limitRaw = options.limit ?? SEARCH_DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Math.floor(limitRaw)));
  const query = options.query?.trim().toLowerCase();
  const ordered = selection.trusted
    .slice()
    .sort((a, b) => (`${a.id}@${a.version}` < `${b.id}@${b.version}` ? -1 : 1));
  const matched = ordered.filter((manifest) => {
    if (options.stack !== undefined && manifest.runtime.stack !== options.stack) return false;
    if (options.capabilities !== undefined) {
      for (const capability of options.capabilities) {
        if (!manifest.capabilities.includes(capability)) return false;
      }
    }
    if (query && !matchesNaturalLanguageSearch(manifest, query)) return false;
    return true;
  });
  return {
    components: matched.slice(0, limit).map(summarizeManifest),
    totalTrusted: selection.trusted.length,
    rejected: selection.rejected.map(({ id, version, code }) => ({ id, version, code })),
  };
}

export interface ComponentContract {
  id: string;
  version: string;
  sourcePath: string;
  capabilities: string[];
  invariants: string[];
  dependencies: ManifestDependency[];
  runtime: { stack: string; node: string; dependencies: Record<string, string> };
  verification: { status: string; testCommand: string; sourceHash?: string; evidence: string };
  evidence: Record<string, unknown>;
  testScope: { command: string; commandKey: string; files: string[]; limitations: string };
  limitations: string;
}

/** Trust gate for single-component tools: fail closed, never serve source. */
function requireTrustedComponent(
  selection: TrustedSelection,
  id: string,
  version: string,
): RegistryManifestView {
  const manifest = selection.all.find((entry) => entry.id === id && entry.version === version);
  if (!manifest) {
    throw new LibrarianError(
      'NOT_FOUND',
      `Unknown component ${id}@${version}: no manifest declares this exact id and version.`,
    );
  }
  const validation = selection.lib.validateComponent(selection.repoRoot, manifest, selection.all, {
    evidenceDir: selection.evidenceDirRel,
  });
  if (!isTrusted(manifest, validation)) {
    if (manifest.verification.status !== 'verified') {
      throw new LibrarianError(
        'UNVERIFIED',
        `Component ${id}@${version} is not served: manifest declares ` +
          `verification.status=${JSON.stringify(manifest.verification.status)}. ` +
          'Only "verified" components with currently valid evidence are served.',
      );
    }
    throw new LibrarianError(
      validation.code || 'INVALID',
      `Component ${id}@${version} is not served: ${validation.reason}`,
    );
  }
  return manifest;
}

function evidenceFileFor(
  selection: TrustedSelection,
  manifest: RegistryManifestView,
): Record<string, unknown> {
  const absolute = selection.lib.resolveEvidencePath(
    selection.repoRoot,
    selection.evidenceDirRel,
    manifest.id,
    manifest.version,
  );
  try {
    return selection.lib.readEvidenceFile(absolute);
  } catch (error: unknown) {
    throw new LibrarianError(
      'MISSING_EVIDENCE',
      `Component ${manifest.id}@${manifest.version} is not served: ` +
        `evidence at ${absolute} is unreadable (${String(error)}).`,
    );
  }
}

/** Full component contract for exactly one trusted component. */
export function inspectTrustedComponent(
  selection: TrustedSelection,
  id: string,
  version: string,
): ComponentContract {
  const manifest = requireTrustedComponent(selection, id, version);
  const evidence = evidenceFileFor(selection, manifest);
  const scope = evidence['testScope'] as
    | { command?: unknown; commandKey?: unknown; files?: unknown; limitations?: unknown }
    | undefined;
  const files = Array.isArray(scope?.files) ? scope.files.filter((entry): entry is string => typeof entry === 'string') : [];
  const limitations = typeof scope?.limitations === 'string' ? scope.limitations : 'No recorded limitations.';
  return {
    id: manifest.id,
    version: manifest.version,
    sourcePath: manifest.sourcePath,
    capabilities: [...manifest.capabilities],
    invariants: [...manifest.invariants],
    dependencies: manifest.dependencies.map((dep) => ({ id: dep.id, version: dep.version })),
    runtime: {
      stack: manifest.runtime.stack,
      node: manifest.runtime.node,
      dependencies: { ...manifest.runtime.dependencies },
    },
    verification: {
      status: manifest.verification.status,
      testCommand: manifest.verification.testCommand,
      ...(manifest.verification.sourceHash === undefined ? {} : { sourceHash: manifest.verification.sourceHash }),
      evidence: manifest.verification.evidence,
    },
    evidence,
    testScope: {
      command: typeof scope?.command === 'string' ? scope.command : 'unknown',
      commandKey: typeof scope?.commandKey === 'string' ? scope.commandKey : 'unknown',
      files,
      limitations,
    },
    limitations,
  };
}

export interface SourceFile {
  path: string;
  bytes: number;
  truncated: boolean;
  content: string;
}

export interface ComponentSource {
  id: string;
  version: string;
  files: SourceFile[];
  totalBytes: number;
  truncated: boolean;
}

function clampInt(raw: number | undefined, fallback: number, hardMax: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(hardMax, Math.floor(raw)));
}

/**
 * Bounded source retrieval for exactly one trusted component. Serves
 * ONLY the files the registry attributes to the component (its own
 * source, its manifest-dependency closure, and required local shared
 * modules) after the servable-path guard. Untrusted components fail
 * closed before any file is read.
 */
export function sourceTrustedComponent(
  selection: TrustedSelection,
  id: string,
  version: string,
  options: { maxBytesPerFile?: number; maxTotalBytes?: number },
): ComponentSource {
  const manifest = requireTrustedComponent(selection, id, version);
  const maxPerFile = clampInt(options.maxBytesPerFile, SOURCE_DEFAULT_MAX_BYTES_PER_FILE, SOURCE_HARD_MAX_BYTES_PER_FILE);
  const maxTotal = clampInt(options.maxTotalBytes, SOURCE_DEFAULT_MAX_TOTAL_BYTES, SOURCE_HARD_MAX_TOTAL_BYTES);
  let rels: string[];
  try {
    rels = selection.lib.sourceFilesForComponent(selection.repoRoot, manifest, selection.all);
  } catch (error: unknown) {
    throw new LibrarianError(
      'UNSAFE_PATH',
      `Component ${id}@${version} is not served: cannot attribute safe source files (${String(error)}).`,
    );
  }
  const files: SourceFile[] = [];
  let totalBytes = 0;
  let truncated = false;
  for (const rel of rels.slice(0, SOURCE_MAX_FILES)) {
    const safe = assertServableSourcePath(rel);
    const remaining = maxTotal - totalBytes;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const budget = Math.min(maxPerFile, remaining);
    let text: string;
    try {
      const absolute = resolve(selection.repoRoot, ...safe.split('/'));
      const stat = statSync(absolute);
      if (!stat.isFile()) {
        throw new LibrarianError(
          'STALE_ARTIFACT',
          `Component ${id}@${version} source is unavailable: ${safe} is not a file in the current checkout.`,
        );
      }
      text = readFileSync(absolute, 'utf8');
    } catch (error: unknown) {
      if (error instanceof LibrarianError) throw error;
      throw new LibrarianError(
        'STALE_ARTIFACT',
        `Component ${id}@${version} source is unavailable: cannot read ${safe} (${String(error)}).`,
      );
    }
    const bytes = text.length;
    totalBytes += Math.min(bytes, budget);
    if (bytes > budget) {
      truncated = true;
      files.push({
        path: safe,
        bytes,
        truncated: true,
        content: `${text.slice(0, budget)}\n...[truncated to ${budget} of ${bytes} chars]`,
      });
    } else {
      files.push({ path: safe, bytes, truncated: false, content: text });
    }
  }
  if (rels.length > files.length) truncated = true;
  return { id: manifest.id, version: manifest.version, files, totalBytes, truncated };
}
