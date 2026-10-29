import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import {
  InstallError, applyInstall, loadRegistryLibrary, planInstall,
} from '../src/install.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const tempDirs = [];
function tempProject({ dependencies = { zod: '4.6.7' }, moduleType = 'module' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'silkweb-install-'));
  tempDirs.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'installer-test-target', private: true, type: moduleType,
    dependencies, engines: { node: '>=24' },
  }, null, 2));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', rootDir: 'src' },
    include: ['src/**/*.ts'],
  }, null, 2));
  return root;
}
afterEach(() => { for (const root of tempDirs.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sha = data => createHash('sha256').update(data).digest('hex');
const spec = 'booking-reservation-kernel@0.2.0';

async function makePlan(projectRoot, overrides = {}) {
  const lib = await loadRegistryLibrary(repoRoot);
  return planInstall({ repoRoot, projectRoot, spec, lib, ...overrides });
}

test('real certified kernel: dry-run, install, report and repeat are safe', async () => {
  const projectRoot = tempProject();
  const plan = await makePlan(projectRoot);
  assert.deepEqual(plan.report.dependencyClosure, [
    'booking-reservation-kernel@0.2.0',
    'booking-schema@0.1.0',
    'booking-slot-guard@0.1.0',
    'booking-validation@0.1.0',
  ]);
  assert.equal(plan.report.certifiedSourceHash, '592cb05ebdda504e2b2069a89fc497d76a2b0a734c6fbfbbe2ac274266b963c0');
  assert.equal(plan.files.length, 4);
  const preview = applyInstall(plan, { dryRun: true });
  assert.equal(preview.status, 'dry-run');
  assert(!existsSync(join(projectRoot, 'src')));
  assert(!existsSync(join(projectRoot, '.silkweb')));
  const installed = applyInstall(plan);
  assert.equal(installed.status, 'installed-source');
  assert.equal(installed.files.filter(f => f.action === 'create').length, 4);
  for (const file of installed.files) {
    assert.equal(sha(readFileSync(join(projectRoot, file.destination))), file.sha256);
    assert.deepEqual(readFileSync(join(projectRoot, file.destination)), readFileSync(join(repoRoot, file.registryPath)));
  }
  const reportPath = join(projectRoot, '.silkweb', 'installations', spec + '.json');
  assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')), plan.report);
  const second = await makePlan(projectRoot);
  assert(second.files.every(f => f.action === 'unchanged'));
  const again = applyInstall(second);
  assert(again.files.every(f => f.action === 'unchanged'));
});

test('tampered destination refuses overwrite and preserves existing report', async () => {
  const projectRoot = tempProject();
  applyInstall(await makePlan(projectRoot));
  const file = join(projectRoot, 'src/silkweb/reservationKernelV2.ts');
  writeFileSync(file, '// user change\n');
  const report = join(projectRoot, '.silkweb/installations', spec + '.json');
  const before = readFileSync(report);
  await assert.rejects(makePlan(projectRoot), e => e.code === 'DESTINATION_CONFLICT');
  assert.equal(readFileSync(file, 'utf8'), '// user change\n');
  assert.deepEqual(readFileSync(report), before);
});

test('preflight refuses missing or incompatible runtime dependencies without writing', async () => {
  const projectRoot = tempProject({ dependencies: {} });
  await assert.rejects(makePlan(projectRoot), e => e.code === 'RUNTIME_DEPENDENCY_MISMATCH');
  assert(!existsSync(join(projectRoot, 'src')));
  assert(!existsSync(join(projectRoot, '.silkweb')));
});

test('refuses destination collisions before writing any source file', async () => {
  const projectRoot = tempProject();
  const file = join(projectRoot, 'src/silkweb/reservationKernelV2.ts');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'unsafe overwrite target');
  await assert.rejects(makePlan(projectRoot), e => e.code === 'DESTINATION_CONFLICT');
  assert.equal(readFileSync(file, 'utf8'), 'unsafe overwrite target');
  assert(!existsSync(join(projectRoot, '.silkweb')));
});

test('refuses destination symlinks and directory traversal', async t => {
  const projectRoot = tempProject();
  const external = mkdtempSync(join(tmpdir(), 'silkweb-outside-'));
  tempDirs.push(external);
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  try {
    symlinkSync(external, join(projectRoot, 'src/silkweb'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') { t.skip('Symlink creation denied by platform'); return; }
    throw error;
  }
  await assert.rejects(makePlan(projectRoot), e => e.code === 'SYMLINK_REJECTED');
  await assert.rejects(makePlan(projectRoot, { into: '../outside' }), e => e.code === 'UNSAFE_PATH');
  assert(!existsSync(join(external, 'reservationKernelV2.ts')));
});

test('forged and uncertified dependency never pass the trust gate', async () => {
  const projectRoot = tempProject();
  const manifest = {
    id: 'bogus', version: '1.0.0', sourcePath: 'packages/registry/src/schema.ts',
    dependencies: [], verification: { status: 'verified', evidence: 'registry-data/evidence/bogus-1.0.0.json' },
    runtime: { dependencies: {} },
  };
  const lib = {
    loadRegistry: () => [manifest],
    indexManifests: list => new Map(list.map(m => [m.id + '@' + m.version, m])),
    resolveClosure: m => [m],
    validateComponent: () => ({ valid: false, code: 'STALE_EVIDENCE', reason: 'forged' }),
    sourceFilesForComponent: () => ['packages/registry/src/schema.ts'],
    computeArtifactFingerprint: () => { throw new Error('trust gate bypassed'); },
  };
  assert.throws(() => planInstall({ repoRoot, projectRoot, spec: 'bogus@1.0.0', lib }),
    e => e.code === 'UNCERTIFIED_COMPONENT' && /STALE_EVIDENCE/.test(e.message));
  manifest.verification.status = 'unverified';
  assert.throws(() => planInstall({ repoRoot, projectRoot, spec: 'bogus@1.0.0', lib }),
    e => e.code === 'UNCERTIFIED_COMPONENT');
  assert(!existsSync(join(projectRoot, '.silkweb')));
});

test('CLI machine-readable dry-run does not mutate target', () => {
  const projectRoot = tempProject();
  const cli = join(repoRoot, 'packages/installer/bin/silkweb.mjs');
  const proc = spawnSync(process.execPath, [cli, 'install', spec, '--project', projectRoot, '--dry-run', '--json'], {
    encoding: 'utf8', cwd: projectRoot,
  });
  assert.equal(proc.status, 0, proc.stderr);
  const report = JSON.parse(proc.stdout);
  assert.equal(report.status, 'dry-run');
  assert.equal(report.files.length, 4);
  assert(!existsSync(join(projectRoot, '.silkweb')));
});
