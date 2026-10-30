import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bounded, opt-in bridge to the EXISTING fail-closed source installer.
 * Exactly one operator-pinned target workspace. Never accepts model-supplied
 * project paths or executes model-written shell commands.
 */
export class InstallBridgeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'InstallBridgeError';
  }
}
export interface InstalledFile {
  path: string;
  sha256: string;
  bytes: number;
  action: 'create' | 'unchanged';
}
export interface InstallResult {
  status: 'dry-run' | 'installed-source';
  component: string;
  files: InstalledFile[];
  auditReportPath: string;
  registryFingerprint: string;
  certifiedSourceHash: string;
  assurance: string;
  integrationGuidance: string;
}
function refuse(code: string, reason: string): never {
  throw new InstallBridgeError(code, reason);
}
function existingRealDir(candidate: string, label: string): string {
  if (!isAbsolute(candidate)) refuse('UNSAFE_WORKSPACE', label + ' must be absolute');
  const normalized = resolve(candidate);
  let stat;
  try { stat = lstatSync(normalized); }
  catch { refuse('UNSAFE_WORKSPACE', label + ' must exist'); }
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    refuse('UNSAFE_WORKSPACE', label + ' must be a real directory');
  }
  if (realpathSync(normalized) !== normalized) {
    refuse('UNSAFE_WORKSPACE', label + ' must have no symlinked parent directories');
  }
  return normalized;
}
function scope(): {repoRoot:string; targetRoot:string} {
  if (process.env.SILKWEB_ALLOW_INSTALL !== '1') {
    refuse('INSTALL_DISABLED', 'Install is disabled unless operator explicitly opts in');
  }
  const workspace = process.env.SILKWEB_TARGET_WORKSPACE;
  if (!workspace) {
    refuse('TARGET_NOT_CONFIGURED', 'Operator must pin SILKWEB_TARGET_WORKSPACE');
  }
  const fromServer = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const repoRoot = existingRealDir(process.env.SILKWEB_REPO_ROOT ?? fromServer, 'Registry root');
  const targetRoot = existingRealDir(workspace, 'Target workspace');
  const rel = relative(repoRoot, targetRoot);
  // Refuse ALL writes inside source repo, including apps, tests, evidence, CI.
  if (rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))) {
    refuse('PROTECTED_TARGET', 'Install target must be outside the entire Silk Web source checkout');
  }
  const executable = join(repoRoot, 'packages/installer/bin/silkweb.mjs');
  if (!existsSync(executable)) {
    refuse('INSTALLER_MISSING', 'Verified Silk Web installer is not available');
  }
  return {repoRoot, targetRoot};
}
const specPattern = /^[a-z0-9][a-z0-9-]*@\d+\.\d+\.\d+$/;
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

export function installIntoPinnedWorkspace(
  id: string, version: string, dryRun: boolean,
): InstallResult {
  const spec = id + '@' + version;
  if (!specPattern.test(spec)) refuse('INVALID_SPEC', 'Expected exact certified id@version');
  const {repoRoot,targetRoot} = scope();
  const cli = join(repoRoot, 'packages/installer/bin/silkweb.mjs');
  const args = [
    cli,'install',spec,'--registry-root',repoRoot,'--project',targetRoot,
    '--into','src/silkweb','--json',
  ];
  if (dryRun) args.push('--dry-run');
  const child = spawnSync(process.execPath, args, {
    cwd: targetRoot,
    encoding:'utf8',
    timeout:30000,
    maxBuffer:1024*1024,
    windowsHide:true,
    shell:false,
  });
  if (child.status !== 0 || child.error) {
    const msg = String(child.stderr ?? '').trim().slice(0,500);
    const match = /^silkweb: ([A-Z_]+): (.+)/s.exec(msg);
    refuse(match?.[1] ?? 'INSTALL_FAILED',
      match?.[2]?.slice(0,300) ??
      (child.error ? String(child.error.message).slice(0,300) :
        'Installer exited unsuccessfully; see operator logs'));
  }
  let data: unknown;
  try {data = JSON.parse(child.stdout);}
  catch {refuse('INSTALL_RESPONSE_INVALID','Installer did not return valid JSON');}
  const d = data as {
    status?:string;component?:string;
    files?:Array<{destination:string;sha256:string;bytes:number;action:string}>;
    reportPath?:string;
    report?:{registryFingerprint?:string;certifiedSourceHash?:string};
  };
  if (d.component !== spec || d.status !== (dryRun?'dry-run':'installed-source') ||
      !Array.isArray(d.files) || d.files.length < 1 || d.files.length > 40) {
    refuse('INSTALL_RESPONSE_INVALID','Installer reported unexpected status, component or files');
  }
  const files:InstalledFile[] = d.files.map(f => {
    if (!/^src\/silkweb\/[a-zA-Z0-9_/-]+\.ts$/.test(f.destination) ||
        f.destination.split('/').some(p=>p==='..') ||
        !/^[a-f0-9]{64}$/.test(f.sha256) ||
        !Number.isSafeInteger(f.bytes) || f.bytes < 0 ||
        !['create','unchanged'].includes(f.action)) {
      refuse('INSTALL_RESPONSE_INVALID','Unexpected installed file metadata');
    }
    // Positive byte-level attestation on disk after the installer finishes.
    // Dry run must never create any file, so only attest real installations.
    if (!dryRun) {
      const file = join(targetRoot,...f.destination.split('/'));
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || sha(readFileSync(file)) !== f.sha256) {
        refuse('POST_INSTALL_MISMATCH','Installed source failed independent byte check');
      }
    }
    return {path:f.destination,sha256:f.sha256,bytes:f.bytes,
      action:f.action as 'create'|'unchanged'};
  });
  const expectedAudit = '.silkweb/installations/' + spec + '.json';
  if (d.reportPath !== expectedAudit ||
      !/^[a-f0-9]{64}$/.test(d.report?.registryFingerprint??'') ||
      !/^[a-f0-9]{64}$/.test(d.report?.certifiedSourceHash??'')) {
    refuse('INSTALL_RESPONSE_INVALID','Unexpected certification fingerprint or audit location');
  }
  return {
    status:dryRun?'dry-run':'installed-source',
    component:spec,
    files,
    auditReportPath:expectedAudit,
    registryFingerprint:d.report!.registryFingerprint!,
    certifiedSourceHash:d.report!.certifiedSourceHash!,
    assurance: dryRun
      ? 'Preview only; no source or audit files written'
      : 'Certified source copied byte-for-byte and audited; application build and behavior NOT yet verified',
    integrationGuidance:
      'Import installed TypeScript sources via relative .js ESM paths from your application entry. ' +
      'Build and independently test the target application. Never modify src/silkweb/* if you need byte-identical provenance.',
  };
}
