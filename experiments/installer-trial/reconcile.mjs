#!/usr/bin/env node
/**
 * Local evidence reconciliation for the already-completed MUSE-INSTALL-001
 * attempt. NOT a Muse retry, not a new benchmark, and never overwrites the
 * original evaluation.json, run.json or source certification.
 *
 * The original runner wrote buildExitCode to run.json AFTER the evaluator
 * read it. We inspect the finalized record and independently recheck runtime
 * and exact file bytes, then write a distinct supplemental report.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = data => createHash('sha256').update(data).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));

export function reassessMissingBuild(original, finalizedRun) {
  if (original.trial !== 'MUSE-INSTALL-001' || finalizedRun.trial !== original.trial) {
    throw new Error('Mismatched trial identity');
  }
  if (!Array.isArray(original.checks) || original.checks.length !== 16) {
    throw new Error('Unexpected original evaluator shape/count');
  }
  const failed = original.checks.filter(check => check.passed !== true);
  if (failed.length !== 1 || failed[0].id !== 'target_build_passed' ||
      failed[0].detail !== 'exit=missing' || original.success !== false ||
      original.checksPassed !== 15) {
    throw new Error('Not the known missing-build-record issue; no reclassification permitted');
  }
  if (finalizedRun.stage !== 'evaluated' || finalizedRun.evaluatorExitCode !== 1 ||
      finalizedRun.museExitCode !== 0 || finalizedRun.buildExitCode !== 0 ||
      finalizedRun.sourceCommit !== original.sourceCommit ||
      finalizedRun.promptSha256 !== original.promptSha256) {
    throw new Error('Finalized run record does not substantiate a successful build');
  }
  return original.checks.map(check => check.id === 'target_build_passed'
    ? { id:check.id, passed:true, detail:'exit=0 from finalized original run.json; persisted after evaluation (recording-order defect)' }
    : { ...check });
}

function main() {
  const trialRoot = join(homedir(), 'Projects/muse-installer-trial-20261029');
  const op = join(trialRoot, 'operator');
  const oldPath = join(op, 'evaluation.json');
  const finalPath = join(op, 'run.json');
  const metaPath = join(op, 'preflight.json');
  const supplementPath = join(op, 'evaluation-reconciliation.json');
  if (existsSync(supplementPath)) {
    throw new Error('Supplement already exists: refusing overwrite');
  }
  const original = readJson(oldPath);
  const finalizedRun = readJson(finalPath);
  const meta = readJson(metaPath);
  if (meta.trial !== 'MUSE-INSTALL-001' || meta.sourceCommit !== original.sourceCommit ||
      meta.sourceCommit !== finalizedRun.sourceCommit ||
      meta.promptSha256 !== original.promptSha256 ||
      meta.promptSha256 !== finalizedRun.promptSha256) {
    throw new Error('Frozen preflight, original evaluation and run record disagree');
  }
  const reconciledChecks = reassessMissingBuild(original, finalizedRun);
  const buildStdout = join(op,'build.stdout.log');
  const buildStderr = join(op,'build.stderr.log');
  if (!existsSync(buildStdout) || !existsSync(buildStderr)) {
    throw new Error('Original independent build logs missing');
  }
  for (const [rel,expected] of Object.entries(meta.pinnedSha256)) {
    const file = join(meta.sourceRepo, rel);
    if (!existsSync(file) || sha(readFileSync(file)) !== expected) {
      throw new Error('Frozen trial source changed: '+rel);
    }
  }
  if (sha(readFileSync(meta.promptPath)) !== meta.promptSha256) {
    throw new Error('Frozen prompt changed');
  }
  const spec = 'booking-reservation-kernel@0.2.0';
  const installation = readJson(join(meta.candidate,'.silkweb/installations',spec+'.json'));
  const expectedNames = ['reservationKernelV2.ts','schema.ts','slotGuard.ts','validation.ts'];
  if (installation.component !== spec || installation.status !== 'installed-source' ||
      installation.files.length !== expectedNames.length) {
    throw new Error('Installed audit record does not match expected component');
  }
  const sourceChecks = expectedNames.map(name => {
    const rel = 'src/silkweb/'+name;
    const path = join(meta.candidate,rel);
    const certified = join(meta.sourceRepo,'packages/registry/src',name);
    const entry = installation.files.find(file => file.destination === rel);
    if (!entry || entry.registryPath !== 'packages/registry/src/'+name ||
        !existsSync(path) || !existsSync(certified)) {
      throw new Error('Missing exact source mapping for '+name);
    }
    const hash = sha(readFileSync(path));
    if (hash !== entry.sha256 || hash !== sha(readFileSync(certified))) {
      throw new Error('Verified installed bytes changed since the trial: '+name);
    }
    return { name, sha256:hash, passed:true };
  });
  const probe = join(meta.candidate,'dist/probe.js');
  if (!existsSync(probe)) throw new Error('Compiled agent-written probe missing');
  const execution = spawnSync(process.execPath,[probe],{
    cwd:meta.candidate,encoding:'utf8',timeout:20000,
  });
  if (execution.error || execution.status !== 0 || execution.stdout.trim() !== 'ADOPTION_OK') {
    throw new Error('Re-executed application probe failed; exit='+execution.status+
      ' stderr='+String(execution.stderr??'').slice(0,120));
  }
  const report = {
    trial:'MUSE-INSTALL-001',
    classification:'OFFLINE_RECONCILED_GUIDED_INSTALLER_ADOPTION',
    isOriginalEvaluation:false,
    isNewMuseRun:false,
    reason:'Runner initially evaluated stale run.json before persisting buildExitCode; finalized original run.json records buildExitCode=0.',
    originalEvaluation: {
      file:oldPath,
      sha256:sha(readFileSync(oldPath)),
      classification:original.classification,
      passed:original.checksPassed,
      total:original.checksTotal,
    },
    finalizedRun: {
      file:finalPath,
      sha256:sha(readFileSync(finalPath)),
      museExitCode:finalizedRun.museExitCode,
      buildExitCode:finalizedRun.buildExitCode,
      evaluatorExitCode:finalizedRun.evaluatorExitCode,
      codingSeconds:finalizedRun.codingSeconds,
    },
    sourceChecks,
    independentProbeRerun:'ADOPTION_OK',
    checks:reconciledChecks,
    checksPassed:reconciledChecks.filter(check=>check.passed).length,
    checksTotal:reconciledChecks.length,
    passed:reconciledChecks.every(check=>check.passed),
    limitation:'This is correction of a proven metadata recording-order error, not an additional Muse trial or comparative inference benchmark. Source hashes and runtime were rechecked offline.',
    createdAt:new Date().toISOString(),
  };
  writeFileSync(supplementPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({
    classification:report.classification,
    passed:report.checksPassed,
    total:report.checksTotal,
    originalPreserved:true,
    paidModelCalls:0,
    correctedIssue:'target_build_passed: exit=0 persisted after evaluator',
    auditFile:supplementPath,
  },null,2)+'\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); }
  catch (error) {
    process.stderr.write('RECONCILIATION REFUSED: '+error.message+'\n');
    process.exitCode=1;
  }
}
