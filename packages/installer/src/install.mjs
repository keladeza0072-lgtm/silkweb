import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Fail-closed, read-only registry consumer. This module never changes
 * certified sources, manifests, evidence or test commands.
 */
export class InstallError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InstallError';
    this.code = code;
  }
}

const MANIFESTS = 'registry-data/manifests';
const EVIDENCE_DIR = 'registry-data/evidence';
const REGISTRY_DIST = 'packages/registry/dist/index.js';
const SPEC = /^([a-z0-9][a-z0-9-]*)@(\d+\.\d+\.\d+)$/;
const BLOCKED = new Set(['.git', '.silkweb', 'node_modules', 'experiments']);
const SHA256 = (data) => createHash('sha256').update(data).digest('hex');
const sorted = (values) => [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

function assertRelativePath(raw, kind) {
  if (typeof raw !== 'string' || !raw || raw.includes('\0') || isAbsolute(raw)) {
    throw new InstallError('UNSAFE_PATH', `Invalid ${kind}: ${JSON.stringify(raw)}`);
  }
  const normalized = raw.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(normalized) ||
      normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new InstallError('UNSAFE_PATH', `Unsafe ${kind}: ${JSON.stringify(raw)}`);
  }
  return normalized;
}

function ensureContained(root, rel) {
  const absolute = resolve(root, ...rel.split('/'));
  if (absolute === root || !absolute.startsWith(root + sep)) {
    throw new InstallError('UNSAFE_PATH', `Path is outside target root: ${rel}`);
  }
  return absolute;
}

function maybeStat(absolute) {
  try { return lstatSync(absolute); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/** Check every existing path segment without following symlink/junction targets. */
function inspectPath(root, rel) {
  const rootStat = maybeStat(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new InstallError('UNSAFE_TARGET', `Project root must be a real directory: ${root}`);
  }
  let current = root;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const info = maybeStat(current);
    if (!info) continue;
    if (info.isSymbolicLink()) {
      throw new InstallError('SYMLINK_REJECTED', `Refusing symlink path: ${current}`);
    }
    if (i < parts.length - 1 && !info.isDirectory()) {
      throw new InstallError('UNSAFE_TARGET', `Parent is not a directory: ${current}`);
    }
  }
  return maybeStat(current);
}

function readJson(absolute, what) {
  let data;
  try { data = JSON.parse(readFileSync(absolute, 'utf8')); }
  catch (error) {
    throw new InstallError('PROJECT_METADATA_INVALID', `Cannot read ${what} at ${absolute}: ${error.message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new InstallError('PROJECT_METADATA_INVALID', `${what} must be a JSON object`);
  }
  return data;
}

function checkProject(projectRoot, requiredPackages) {
  const packagePath = 'package.json';
  const packageStat = inspectPath(projectRoot, packagePath);
  if (!packageStat?.isFile()) {
    throw new InstallError('PROJECT_METADATA_MISSING', 'Project must contain package.json');
  }
  const pkg = readJson(join(projectRoot, packagePath), packagePath);
  if (pkg.type !== 'module') {
    throw new InstallError('INCOMPATIBLE_PROJECT', 'Target package.json must use "type": "module" for .js ESM imports');
  }
  const tsconfigStat = inspectPath(projectRoot, 'tsconfig.json');
  if (!tsconfigStat?.isFile()) {
    throw new InstallError('INCOMPATIBLE_PROJECT', 'Target must contain tsconfig.json; TypeScript build compatibility is checked separately in Phase 3');
  }
  const actual = { ...pkg.devDependencies, ...pkg.dependencies };
  for (const [name, version] of Object.entries(requiredPackages)) {
    if (actual[name] !== version) {
      throw new InstallError(
        'RUNTIME_DEPENDENCY_MISMATCH',
        `Target must declare exactly ${name}@${version} (found ${JSON.stringify(actual[name] ?? null)}). Add the pinned dependency and update the target lockfile before installing.`,
      );
    }
  }
}

function rejectProtectedTarget(repoRoot, projectRoot) {
  const rel = relative(repoRoot, projectRoot).replace(/\\/g, '/');
  if (rel === '' || rel === 'registry-data' || rel.startsWith('registry-data/') ||
      rel === 'experiments' || rel.startsWith('experiments/') ||
      rel === 'packages/registry' || rel.startsWith('packages/registry/')) {
    throw new InstallError('PROTECTED_TARGET', 'Cannot install into the registry, benchmark experiments or Silk Web repository root');
  }
}

function sourceDestination(sourceRel, into) {
  const prefix = 'packages/registry/src/';
  if (!sourceRel.startsWith(prefix) || !sourceRel.endsWith('.ts')) {
    throw new InstallError('UNSUPPORTED_SOURCE_LAYOUT', `Cannot install source outside ${prefix}: ${sourceRel}`);
  }
  const within = assertRelativePath(sourceRel.slice(prefix.length), 'source location');
  return `${into}/${within}`;
}

function safeSource(repoRoot, sourceRel) {
  const rel = assertRelativePath(sourceRel, 'registry source');
  if (!rel.startsWith('packages/registry/src/')) {
    throw new InstallError('UNSUPPORTED_SOURCE_LAYOUT', `Unsupported source: ${rel}`);
  }
  const file = ensureContained(repoRoot, rel);
  const info = inspectPath(repoRoot, rel);
  if (!info?.isFile()) {
    throw new InstallError('SOURCE_UNAVAILABLE', `Verified registry source is missing or not a file: ${rel}`);
  }
  return readFileSync(file);
}

/**
 * Plan from the registry's existing authoritative validator. Caller-supplied
 * `lib` is for local unit tests only; the CLI always loads the built registry.
 */
export function planInstall({ repoRoot, projectRoot, spec, into = 'src/silkweb', lib }) {
  repoRoot = resolve(repoRoot);
  projectRoot = resolve(projectRoot);
  const match = SPEC.exec(spec ?? '');
  if (!match) {
    throw new InstallError('INVALID_SPEC', 'Expected exact component spec: id@major.minor.patch');
  }
  const location = assertRelativePath(into, 'destination');
  if (location.split('/').some(part => BLOCKED.has(part))) {
    throw new InstallError('UNSAFE_PATH', `Destination contains a protected directory: ${location}`);
  }
  if (!maybeStat(projectRoot)?.isDirectory()) {
    throw new InstallError('UNSAFE_TARGET', `Project does not exist: ${projectRoot}`);
  }
  rejectProtectedTarget(repoRoot, projectRoot);
  const manifests = lib.loadRegistry(join(repoRoot, MANIFESTS));
  const selected = manifests.find(m => m.id === match[1] && m.version === match[2]);
  if (!selected) {
    throw new InstallError('COMPONENT_NOT_FOUND', `No registered component ${spec}`);
  }
  let closure;
  try { closure = lib.resolveClosure(selected, lib.indexManifests(manifests)); }
  catch (error) {
    throw new InstallError('DEPENDENCY_ERROR', error.message);
  }
  for (const manifest of closure) {
    const key = `${manifest.id}@${manifest.version}`;
    if (manifest.verification.status !== 'verified') {
      throw new InstallError('UNCERTIFIED_COMPONENT', `Component or dependency ${key} does not declare verified status`);
    }
    let checked;
    try { checked = lib.validateComponent(repoRoot, manifest, manifests, { evidenceDir: EVIDENCE_DIR }); }
    catch (error) {
      throw new InstallError('VERIFICATION_ERROR', `Certification validator failed for ${key}: ${error.message}`);
    }
    if (checked?.valid !== true) {
      throw new InstallError('UNCERTIFIED_COMPONENT', `Component or dependency ${key} rejected: ${checked?.code ?? 'UNKNOWN'}: ${checked?.reason ?? ''}`);
    }
  }
  const requiredPackages = {};
  for (const manifest of closure) {
    for (const [name, version] of Object.entries(manifest.runtime.dependencies)) {
      if (requiredPackages[name] && requiredPackages[name] !== version) {
        throw new InstallError('DEPENDENCY_CONFLICT', `Certified components disagree about ${name} versions`);
      }
      requiredPackages[name] = version;
    }
  }
  checkProject(projectRoot, requiredPackages);
  const sourcePaths = sorted(new Set(lib.sourceFilesForComponent(repoRoot, selected, manifests)));
  if (sourcePaths.length === 0) throw new InstallError('EMPTY_COMPONENT', 'No certified source files returned');
  const files = sourcePaths.map((sourceRel) => {
    const bytes = safeSource(repoRoot, sourceRel);
    const destRel = sourceDestination(sourceRel, location);
    const stat = inspectPath(projectRoot, destRel);
    if (stat && !stat.isFile()) {
      throw new InstallError('DESTINATION_CONFLICT', `Destination is not a regular file: ${destRel}`);
    }
    const digest = SHA256(bytes);
    let action = 'create';
    if (stat) {
      const actual = SHA256(readFileSync(ensureContained(projectRoot, destRel)));
      if (actual !== digest) {
        throw new InstallError('DESTINATION_CONFLICT', `Refusing to overwrite a modified file: ${destRel}`);
      }
      action = 'unchanged';
    }
    return { registryPath: sourceRel, destination: destRel, sha256: digest, bytes: bytes.length, action, content: bytes };
  });
  const evidenceRef = selected.verification.evidence;
  if (evidenceRef !== `${EVIDENCE_DIR}/${spec.replace('@', '-')}.json`) {
    throw new InstallError('EVIDENCE_REF_MISMATCH', `Unexpected evidence path for ${spec}`);
  }
  const reportRel = `.silkweb/installations/${spec}.json`;
  const report = {
    schemaVersion: 1,
    status: 'installed-source',
    component: spec,
    registryFingerprint: lib.computeArtifactFingerprint(repoRoot, selected, manifests).fingerprint,
    certifiedSourceHash: selected.verification.sourceHash,
    certificationEvidence: evidenceRef,
    dependencyClosure: closure.map(m => `${m.id}@${m.version}`).sort(),
    runtimeDependencies: Object.fromEntries(Object.entries(requiredPackages).sort(([a], [b]) => a.localeCompare(b))),
    files: files.map(({registryPath, destination, sha256, bytes}) => ({registryPath, destination, sha256, bytes})),
    assurance: 'Certified registry source verified; target build and application behavior NOT yet verified',
  };
  const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  const reportStat = inspectPath(projectRoot, reportRel);
  if (reportStat) {
    if (!reportStat.isFile() ||
        !readFileSync(ensureContained(projectRoot, reportRel)).equals(reportBytes)) {
      throw new InstallError('REPORT_CONFLICT', `Refusing to overwrite an existing audit report: ${reportRel}`);
    }
  }
  return { repoRoot, projectRoot, spec, into: location, files, reportRel, report, reportBytes, reportExists: !!reportStat };
}

function makeParents(root, rel, createdDirs) {
  const parts = dirname(rel).replace(/\\/g, '/').split('/');
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const stat = inspectPath(root, current);
    if (!stat) {
      mkdirSync(ensureContained(root, current));
      createdDirs.push(ensureContained(root, current));
    } else if (!stat.isDirectory()) {
      throw new InstallError('UNSAFE_TARGET', `Parent is not a directory: ${current}`);
    }
  }
}

function createExclusive(root, rel, content, createdFiles, createdDirs) {
  makeParents(root, rel, createdDirs);
  if (inspectPath(root, rel)) {
    throw new InstallError('DESTINATION_RACE', `Destination appeared during installation: ${rel}`);
  }
  const absolute = ensureContained(root, rel);
  const fd = openSync(absolute, 'wx', 0o644);
  createdFiles.push(absolute);
  try { writeFileSync(fd, content); }
  finally { closeSync(fd); }
  if (!readFileSync(absolute).equals(content)) {
    throw new InstallError('POSTWRITE_MISMATCH', `Written bytes differ: ${rel}`);
  }
}

/** No mutations on dry-run. Exclusive writes + rollback of newly created paths. */
export function applyInstall(plan, { dryRun = false } = {}) {
  const actions = plan.files.map(({registryPath, destination, sha256, bytes, action}) =>
    ({registryPath, destination, sha256, bytes, action}));
  if (dryRun) return { status: 'dry-run', component: plan.spec, files: actions, report: plan.report, reportPath: plan.reportRel };
  const createdFiles = [], createdDirs = [];
  try {
    // Recheck preflight just before writing; never replace existing source files.
    for (const file of plan.files) {
      const stat = inspectPath(plan.projectRoot, file.destination);
      if (file.action === 'create' && stat) {
        throw new InstallError('DESTINATION_RACE', `New destination appeared: ${file.destination}`);
      }
      if (file.action === 'unchanged' &&
          (!stat?.isFile() || SHA256(readFileSync(ensureContained(plan.projectRoot, file.destination))) !== file.sha256)) {
        throw new InstallError('DESTINATION_RACE', `Previously matching file changed: ${file.destination}`);
      }
    }
    const reportStat = inspectPath(plan.projectRoot, plan.reportRel);
    if ((plan.reportExists && (!reportStat?.isFile() ||
      !readFileSync(ensureContained(plan.projectRoot, plan.reportRel)).equals(plan.reportBytes))) ||
      (!plan.reportExists && reportStat)) {
      throw new InstallError('REPORT_CONFLICT', 'Audit report changed during preflight');
    }
    for (const file of plan.files) {
      if (file.action === 'create') {
        createExclusive(plan.projectRoot, file.destination, file.content, createdFiles, createdDirs);
      }
    }
    if (!plan.reportExists) {
      createExclusive(plan.projectRoot, plan.reportRel, plan.reportBytes, createdFiles, createdDirs);
    }
    return { status: 'installed-source', component: plan.spec, files: actions, report: plan.report, reportPath: plan.reportRel };
  } catch (error) {
    for (const file of createdFiles.reverse()) {
      try { unlinkSync(file); } catch { /* rollback is best effort */ }
    }
    for (const dir of createdDirs.reverse()) {
      try { rmdirSync(dir); } catch { /* never remove pre-existing data */ }
    }
    throw error;
  }
}

export async function loadRegistryLibrary(repoRoot) {
  const file = join(resolve(repoRoot), REGISTRY_DIST);
  if (!existsSync(file)) {
    throw new InstallError('REGISTRY_BUILD_MISSING', 'Run npm ci && npm run build in packages/registry first; certified build artifacts are required');
  }
  try { return await import(pathToFileURL(file).href); }
  catch (error) {
    throw new InstallError('REGISTRY_BUILD_MISSING', `Cannot load built registry: ${error.message}`);
  }
}

export function discoverRepoRoot(fromDir) {
  let current = resolve(fromDir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, MANIFESTS))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new InstallError('REPO_ROOT_NOT_FOUND', 'Cannot locate Silk Web registry; use --registry-root');
}

export function assertSupportedRuntime() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 24) {
    throw new InstallError('UNSUPPORTED_NODE', `Silk Web installer requires Node.js 24+; running ${process.version}`);
  }
}
