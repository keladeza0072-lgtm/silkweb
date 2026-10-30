import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { get } from 'node:http';
import { collectEvidence } from './evidence.js';

/**
 * Silk Web Studio service layer (socket-free).
 *
 * All registry trust decisions come from the existing compiled Librarian
 * implementation (`apps/mcp-server/dist/librarian.js`), which itself calls
 * the compiled registry validator (`packages/registry/dist/index.js`).
 * This module defines NO second validator: it dynamically imports those
 * compiled functions and only adds Studio concerns (search plumbing,
 * approval persistence, freshness assessment, presentation shaping).
 */

export const STUDIO_DEFAULT_PORT = 3001;
export const BOOKING_APP_URL = 'http://127.0.0.1:3000';
export const SAMPLE_REQUIREMENT =
  'Prevent double-booking for a barbershop using fixed 30-minute appointment slots.';

const MANIFEST_SENTINEL = join('registry-data', 'manifests');
const LIBRARIAN_DIST_REL = join('apps', 'mcp-server', 'dist', 'librarian.js');
const STUDIO_DATA_REL = join('apps', 'studio', 'data', 'approvals.json');

export class StudioError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.status = status;
  }
}

/** Minimal structural view of the compiled Librarian API (types only). */
interface LibrarianManifest {
  id: string;
  version: string;
  sourcePath: string;
  dependencies: Array<{ id: string; version: string }>;
  capabilities: string[];
  invariants: string[];
  runtime: { stack: string; node: string; dependencies: Record<string, string> };
  verification: { status: string; testCommand: string; sourceHash?: string; evidence: string };
}

interface LibrarianValidation {
  valid: boolean;
  code: string;
  reason: string;
}

interface LibrarianSelection {
  repoRoot: string;
  evidenceDirRel: string;
  all: LibrarianManifest[];
  trusted: LibrarianManifest[];
  rejected: Array<{ id: string; version: string; code: string; reason: string }>;
  lib: {
    validateComponent(
      repoRoot: string,
      manifest: LibrarianManifest,
      all: readonly LibrarianManifest[],
      options: { evidenceDir: string },
    ): LibrarianValidation;
  };
}

interface LibrarianApi {
  selectTrustedComponents(): Promise<LibrarianSelection>;
  searchTrusted(
    selection: LibrarianSelection,
    options: { capabilities?: string[]; stack?: string; query?: string; limit?: number },
  ): {
    components: Array<{ id: string; version: string; capabilities: string[]; stack: string; summary: string; match?: {score:number;matchedTerms:string[];signals:string[]} }>;
    totalTrusted: number;
    rejected: Array<{ id: string; version: string; code: string }>;
  };
  inspectTrustedComponent(
    selection: LibrarianSelection,
    id: string,
    version: string,
  ): {
    id: string;
    version: string;
    sourcePath: string;
    capabilities: string[];
    invariants: string[];
    dependencies: Array<{ id: string; version: string }>;
    runtime: { stack: string; node: string; dependencies: Record<string, string> };
    verification: { status: string; testCommand: string; sourceHash?: string; evidence: string };
    evidence: Record<string, unknown>;
    testScope: { command: string; commandKey: string; files: string[]; limitations: string };
    limitations: string;
  };
}

export interface ServiceOptions {
  /** Override the approvals data file (tests use a disposable tmp path). */
  dataFile?: string;
}

/** Walk up from the running Studio file until the registry checkout is found. */
export function discoverStudioRepoRoot(startDir?: string): string {
  const override = process.env.SILKWEB_REPO_ROOT?.trim();
  if (override) {
    const root = resolve(override);
    if (!existsSync(join(root, MANIFEST_SENTINEL))) {
      throw new StudioError(
        'REPO_ROOT_NOT_FOUND',
        `SILKWEB_REPO_ROOT=${JSON.stringify(override)} does not contain registry-data/manifests.`,
        500,
      );
    }
    return root;
  }
  let dir = resolve(startDir ?? dirname(fileURLToPath(import.meta.url)));
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, MANIFEST_SENTINEL))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new StudioError(
    'REPO_ROOT_NOT_FOUND',
    'Cannot locate registry-data/manifests above the Studio server. Build prerequisites: from the repository root run "npm run build" in packages/registry, then in apps/mcp-server, then in apps/studio.',
    500,
  );
}

async function loadLibrarian(repoRoot: string): Promise<LibrarianApi> {
  const entry = join(repoRoot, LIBRARIAN_DIST_REL);
  if (!existsSync(entry)) {
    throw new StudioError(
      'LIBRARIAN_BUILD_MISSING',
      `Compiled Librarian is missing at ${LIBRARIAN_DIST_REL}. From the repository root run "npm run build" in packages/registry, then in apps/mcp-server.`,
      500,
    );
  }
  return (await import(pathToFileURL(entry).href)) as unknown as LibrarianApi;
}

async function selectTrusted(): Promise<{ api: LibrarianApi; selection: LibrarianSelection }> {
  const repoRoot = discoverStudioRepoRoot();
  const api = await loadLibrarian(repoRoot);
  const selection = await api.selectTrustedComponents();
  return { api, selection };
}

export interface SearchOptions {
  capabilities?: string[];
  query?: string;
  stack?: string;
  limit?: number;
}

export interface MatchedComponent {
  id: string;
  version: string;
  capabilities: string[];
  stack: string;
  summary: string;
  /** Always true here: results come only from the trust gate's trusted set. */
  certificationEligible: boolean;
  match?: {score:number;matchedTerms:string[];signals:string[]};
}

export interface SearchOutcome {
  components: MatchedComponent[];
  totalTrusted: number;
  rejected: Array<{ id: string; version: string; code: string }>;
  deterministicNote: string;
}

/**
 * Deterministic capability search over trusted components only.
 * Exact capability filters use AND matching. Natural-language task text
 * uses the certified-only deterministic metadata ranking from Phase 2.
 * This is NOT an LLM/embedding semantic search.
 */
export async function searchComponents(options: SearchOptions = {}): Promise<SearchOutcome> {
  const { api, selection } = await selectTrusted();
  const capabilities = (options.capabilities ?? []).map((c) => c.trim()).filter((c) => c.length > 0);
  const result = api.searchTrusted(selection, {
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(options.query?.trim() ? { query: options.query.trim() } : {}),
    ...(options.stack?.trim() ? { stack: options.stack.trim() } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });
  return {
    components: result.components.map((entry) => ({ ...entry, certificationEligible: true })),
    totalTrusted: result.totalTrusted,
    rejected: result.rejected,
    deterministicNote:
      'Deterministic metadata ranking with conservative task-intent aliases; exact capability tags use AND semantics. ' +
      'This is not semantic AI search.',
  };
}

/** Distinct capability tags across currently trusted components, sorted. */
export async function listCapabilities(): Promise<{ capabilities: string[]; totalTrusted: number }> {
  const { selection } = await selectTrusted();
  const tags = new Set<string>();
  for (const manifest of selection.trusted) {
    for (const capability of manifest.capabilities) tags.add(capability);
  }
  return { capabilities: [...tags].sort(), totalTrusted: selection.trusted.length };
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function checkIdentity(id: string, version: string): void {
  if (!ID_PATTERN.test(id) || !VERSION_PATTERN.test(version)) {
    throw new StudioError(
      'INVALID_IDENTITY',
      `Refusing unsafe component identity ${JSON.stringify(`${id}@${version}`)}: ids use [a-z0-9-] and versions are SemVer.`,
      400,
    );
  }
  if (id === 'experiments' || id.includes('harness')) {
    throw new StudioError('FORBIDDEN_PATH', 'Component identities inside experiments/harness are never served.', 403);
  }
}

export interface ContractEvidence {
  outcome: unknown;
  executedAt: unknown;
  testCommand: unknown;
  testFiles: string[];
  nodeVersion: unknown;
  sqliteVersion: unknown;
  sourceHash: unknown;
  artifactFingerprint: unknown;
  limitations: string;
}

export interface ContractView {
  id: string;
  version: string;
  sourcePath: string;
  capabilities: string[];
  invariants: string[];
  dependencies: Array<{ id: string; version: string }>;
  runtime: { stack: string; node: string; dependencies: Record<string, string> };
  verification: { status: string; testCommand: string; sourceHash?: string; evidence: string };
  limitations: string;
  evidence: ContractEvidence | null;
  validation: { valid: boolean; code: string; reason: string };
  trusted: boolean;
}

function shapeEvidence(raw: Record<string, unknown>, limitations: string): ContractEvidence {
  const scope = (raw['testScope'] ?? {}) as Record<string, unknown>;
  return {
    outcome: raw['outcome'] ?? null,
    executedAt: raw['executedAt'] ?? null,
    testCommand: (scope['command'] as unknown) ?? null,
    testFiles: Array.isArray(scope['files'])
      ? (scope['files'] as unknown[]).filter((entry): entry is string => typeof entry === 'string')
      : [],
    nodeVersion: raw['nodeVersion'] ?? null,
    sqliteVersion: raw['sqliteVersion'] ?? null,
    sourceHash: (raw['sections'] as Record<string, unknown> | undefined)?.['sources'] ?? null,
    artifactFingerprint: raw['artifactFingerprint'] ?? null,
    limitations,
  };
}

/**
 * Full contract for one component. Evidence is attached ONLY when the
 * component passes the current trust gate; otherwise the failure is
 * returned explicitly (never a green status).
 */
export async function getContract(id: string, version: string): Promise<ContractView> {
  checkIdentity(id, version);
  const { api, selection } = await selectTrusted();
  const manifest = selection.all.find((entry) => entry.id === id && entry.version === version);
  if (!manifest) {
    throw new StudioError('NOT_FOUND', `Unknown component ${id}@${version}: no manifest declares this exact id and version.`, 404);
  }
  const validation = selection.lib.validateComponent(selection.repoRoot, manifest, selection.all, {
    evidenceDir: selection.evidenceDirRel,
  });
  const trusted = manifest.verification.status === 'verified' && validation.valid === true;
  if (!trusted) {
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
      limitations: 'Unavailable: the component did not pass the current trust gate, so no certified limitations are served.',
      evidence: null,
      validation: { valid: validation.valid, code: validation.code, reason: validation.reason },
      trusted: false,
    };
  }
  const inspected = api.inspectTrustedComponent(selection, id, version);
  return {
    id: inspected.id,
    version: inspected.version,
    sourcePath: inspected.sourcePath,
    capabilities: [...inspected.capabilities],
    invariants: [...inspected.invariants],
    dependencies: inspected.dependencies.map((dep) => ({ id: dep.id, version: dep.version })),
    runtime: {
      stack: inspected.runtime.stack,
      node: inspected.runtime.node,
      dependencies: { ...inspected.runtime.dependencies },
    },
    verification: {
      status: inspected.verification.status,
      testCommand: inspected.verification.testCommand,
      ...(inspected.verification.sourceHash === undefined ? {} : { sourceHash: inspected.verification.sourceHash }),
      evidence: inspected.verification.evidence,
    },
    limitations: inspected.limitations,
    evidence: shapeEvidence(inspected.evidence, inspected.limitations),
    validation: { valid: validation.valid, code: validation.code, reason: validation.reason },
    trusted: true,
  };
}

export interface ApprovalRecord {
  id: string;
  requirementText: string;
  capability: string;
  componentId: string;
  componentVersion: string;
  sourceHash: string;
  artifactFingerprint: string;
  evidenceRef: string;
  approvedAt: string;
}

export interface ApprovalView extends ApprovalRecord {
  stale: boolean;
  staleReason: string | null;
  current: {
    sourceHash: string | null;
    artifactFingerprint: string | null;
    valid: boolean;
    status: string | null;
  };
}

export interface CreateApprovalInput {
  requirementText: string;
  capability: string;
  id: string;
  version: string;
  acknowledgedLimitations: boolean;
}

/**
 * Resolve the approvals file. Writes stay inside apps/studio/: the
 * default data file or a caller override that must resolve under
 * <repoRoot>/apps/studio/ (data/ or tests/tmp/). Anything else is refused.
 */
export function resolveDataFile(repoRoot: string, override?: string): string {
  const fromEnv = (process.env.STUDIO_DATA_FILE ?? '').trim();
  const raw = (override ?? fromEnv) || STUDIO_DATA_REL;
  const absolute = resolve(repoRoot, raw);
  const studioRoot = resolve(repoRoot, join('apps', 'studio')) + sep;
  if (absolute !== studioRoot.slice(0, -1) && !absolute.startsWith(studioRoot)) {
    throw new StudioError(
      'UNSAFE_PATH',
      'Refusing approvals file outside apps/studio/ (allowed: apps/studio/data/ or apps/studio/tests/tmp/).',
      403,
    );
  }
  if (absolute.toLowerCase().replace(/\\/g, '/').includes('/experiments/')) {
    throw new StudioError('FORBIDDEN_PATH', 'Refusing approvals file inside experiments/harness.', 403);
  }
  return absolute;
}

function readApprovals(dataFile: string): ApprovalRecord[] {
  if (!existsSync(dataFile)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(dataFile, 'utf8'));
  } catch (error: unknown) {
    throw new StudioError('APPROVALS_UNREADABLE', `Cannot read approvals file: ${String(error)}`, 500);
  }
  if (!Array.isArray(parsed)) {
    throw new StudioError('APPROVALS_UNREADABLE', 'Approvals file must hold a JSON array.', 500);
  }
  return parsed as ApprovalRecord[];
}

function writeApprovals(dataFile: string, records: ApprovalRecord[]): void {
  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(dataFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
}

function assessFreshness(
  record: ApprovalRecord,
  current: { sourceHash: string | null; artifactFingerprint: string | null; valid: boolean; status: string | null },
): { stale: boolean; staleReason: string | null } {
  if (current.status !== 'verified' || !current.valid) {
    return {
      stale: true,
      staleReason: `Component ${record.componentId}@${record.componentVersion} is not currently certified (status=${JSON.stringify(current.status)}, valid=${current.valid}).`,
    };
  }
  if (current.sourceHash !== record.sourceHash) {
    return { stale: true, staleReason: 'Recorded sourceHash no longer matches the current registry manifest.' };
  }
  if (current.artifactFingerprint !== record.artifactFingerprint) {
    return { stale: true, staleReason: 'Recorded evidence fingerprint no longer matches current verification evidence.' };
  }
  return { stale: false, staleReason: null };
}

async function currentFingerprint(
  api: LibrarianApi,
  selection: LibrarianSelection,
  id: string,
  version: string,
): Promise<{ sourceHash: string | null; artifactFingerprint: string | null; valid: boolean; status: string | null }> {
  const manifest = selection.all.find((entry) => entry.id === id && entry.version === version);
  if (!manifest) return { sourceHash: null, artifactFingerprint: null, valid: false, status: null };
  const validation = selection.lib.validateComponent(selection.repoRoot, manifest, selection.all, {
    evidenceDir: selection.evidenceDirRel,
  });
  const trusted = manifest.verification.status === 'verified' && validation.valid === true;
  if (!trusted) {
    return {
      sourceHash: manifest.verification.sourceHash ?? null,
      artifactFingerprint: null,
      valid: false,
      status: manifest.verification.status,
    };
  }
  const inspected = api.inspectTrustedComponent(selection, id, version);
  return {
    sourceHash: inspected.verification.sourceHash ?? null,
    artifactFingerprint:
      typeof inspected.evidence['artifactFingerprint'] === 'string'
        ? (inspected.evidence['artifactFingerprint'] as string)
        : null,
    valid: true,
    status: inspected.verification.status,
  };
}

/**
 * Record a contract approval. Revalidates the component immediately
 * before accepting; requires explicit limitation acknowledgment.
 * This records the user's reviewed contract — it does not retroactively
 * enforce a gate in the existing booking app.
 */
export async function createApproval(input: CreateApprovalInput, options: ServiceOptions = {}): Promise<ApprovalView> {
  const requirementText = input.requirementText?.trim() ?? '';
  const capability = input.capability?.trim() ?? '';
  if (!requirementText) throw new StudioError('MISSING_REQUIREMENT', 'A requirement text is required to approve a contract.', 400);
  if (!capability) throw new StudioError('MISSING_CAPABILITY', 'A capability tag is required to approve a contract.', 400);
  if (input.acknowledgedLimitations !== true) {
    throw new StudioError(
      'ACKNOWLEDGMENT_REQUIRED',
      'Approval requires explicitly acknowledging the component limitations.',
      400,
    );
  }
  checkIdentity(input.id, input.version);
  const contract = await getContract(input.id, input.version);
  if (!contract.trusted) {
    throw new StudioError(
      'NOT_CERTIFIED',
      `Cannot approve ${input.id}@${input.version}: it did not pass the current trust gate (${contract.validation.code}: ${contract.validation.reason}).`,
      409,
    );
  }
  if (typeof contract.verification.sourceHash !== 'string' || typeof contract.evidence?.artifactFingerprint !== 'string') {
    throw new StudioError('NOT_CERTIFIED', 'Cannot approve: current source hash or evidence fingerprint is unavailable.', 409);
  }
  const repoRoot = discoverStudioRepoRoot();
  const dataFile = resolveDataFile(repoRoot, options.dataFile);
  const records = readApprovals(dataFile);
  const record: ApprovalRecord = {
    id: `approval-${randomUUID()}`,
    requirementText,
    capability,
    componentId: contract.id,
    componentVersion: contract.version,
    sourceHash: contract.verification.sourceHash,
    artifactFingerprint: contract.evidence.artifactFingerprint,
    evidenceRef: contract.verification.evidence,
    approvedAt: new Date().toISOString(),
  };
  records.push(record);
  writeApprovals(dataFile, records);
  const current = {
    sourceHash: contract.verification.sourceHash,
    artifactFingerprint: contract.evidence.artifactFingerprint,
    valid: true,
    status: contract.verification.status,
  };
  return { ...record, stale: false, staleReason: null, current };
}

/** All recorded approvals with live freshness against the current registry. */
export async function listApprovals(options: ServiceOptions = {}): Promise<{ approvals: ApprovalView[] }> {
  const repoRoot = discoverStudioRepoRoot();
  const dataFile = resolveDataFile(repoRoot, options.dataFile);
  const records = readApprovals(dataFile);
  if (records.length === 0) return { approvals: [] };
  const { api, selection } = await selectTrusted();
  const views: ApprovalView[] = [];
  for (const record of records) {
    const current = await currentFingerprint(api, selection, record.componentId, record.componentVersion);
    const { stale, staleReason } = assessFreshness(record, current);
    views.push({ ...record, stale, staleReason, current });
  }
  return { approvals: views };
}

export interface VerificationView {
  id: string;
  version: string;
  found: boolean;
  certified: boolean;
  contract: ContractView | null;
  validation: { valid: boolean; code: string; reason: string } | null;
  approvals: ApprovalView[];
}

/** Real evidence plus the live trust-gate verdict for one component. */
export async function getVerification(id: string, version: string, options: ServiceOptions = {}): Promise<VerificationView> {
  checkIdentity(id, version);
  let contract: ContractView | null = null;
  try {
    contract = await getContract(id, version);
  } catch (error: unknown) {
    if (error instanceof StudioError && error.code === 'NOT_FOUND') {
      return { id, version, found: false, certified: false, contract: null, validation: null, approvals: [] };
    }
    throw error;
  }
  const { approvals } = await listApprovals(options);
  return {
    id,
    version,
    found: true,
    certified: contract.trusted,
    contract,
    validation: contract.validation,
    approvals: approvals.filter((entry) => entry.componentId === id && entry.componentVersion === version),
  };
}

/**
 * Injectable booking-demo probe. The default performs the real
 * `/api/health` HTTP check; tests pass a deterministic in-process stub
 * so the suite never opens a socket or touches the network.
 */
export type BookingProbe = (healthUrl: string, timeoutMs: number) => Promise<{ ok: boolean; status?: number }>;

export function liveBookingProbe(healthUrl: string, timeoutMs: number): Promise<{ ok: boolean; status?: number }> {
  return new Promise((resolvePromise) => {
    const request = get(healthUrl, { timeout: timeoutMs }, (response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      resolvePromise({ ok: status === 200, status });
    });
    request.on('timeout', () => {
      request.destroy();
      resolvePromise({ ok: false });
    });
    request.on('error', () => {
      resolvePromise({ ok: false });
    });
  });
}

/** Probe the separate booking demo without ever claiming it runs unchecked. */
export async function checkBookingApp(
  url = BOOKING_APP_URL,
  timeoutMs = 1500,
  probe: BookingProbe = liveBookingProbe,
): Promise<{ running: boolean; url: string; status?: number }> {
  const healthUrl = `${url.replace(/\/+$/, '')}/api/health`;
  let observed: { ok: boolean; status?: number };
  try {
    observed = await probe(healthUrl, timeoutMs);
  } catch {
    observed = { ok: false };
  }
  if (observed.ok) return { running: true, url, status: observed.status };
  return observed.status === undefined ? { running: false, url } : { running: false, url, status: observed.status };
}

/** Short integrity digest of an approvals file (for tests and debugging). */
export function approvalsDigest(records: ApprovalRecord[]): string {
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

/**
 * Studio v2 read-only dashboard. The registry still uses the existing
 * authoritative compiled Librarian trust gate. Historical operator evidence
 * is sanitized by collectEvidence and may be entirely absent.
 */
export async function getStudioDashboard() {
  const [catalog, caps] = await Promise.all([
    searchComponents({limit:25}),
    listCapabilities(),
  ]);
  return {
    schemaVersion:1,
    registry:{
      components:catalog.components,
      totalTrusted:catalog.totalTrusted,
      rejected:catalog.rejected,
      capabilities:caps.capabilities,
      searchNote:catalog.deterministicNote,
    },
    ...collectEvidence(),
  };
}
