#!/usr/bin/env node
/**
 * RES-001 zero-inference workspace preparation.
 *
 * Copies ONLY the published neutral starter into two sibling workspaces.
 * Both candidates use byte-identical inputs and one shared prompt file
 * kept in a private operator directory outside the agent workspaces.
 * Refuses to overwrite existing output or run with dirty source checkout.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message) { throw new Error('RES-001 PREPARE: ' + message); }
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output') {
  fail('usage: node experiments/harness/res001-prepare.mjs --output ABSOLUTE_NEW_DIRECTORY');
}
const outputArg = args[1];
if (!isAbsolute(outputArg)) fail('--output must be an absolute path');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const targetRoot = resolve(outputArg);
function contains(parent, target) {
  const diff = relative(parent, target);
  return diff === '' || (!diff.startsWith('..' + sep) && diff !== '..' && !isAbsolute(diff));
}
if (contains(repoRoot, targetRoot) || contains(targetRoot, repoRoot)) {
  fail('output must be outside and not an ancestor of the Silk Web repository');
}
if (existsSync(targetRoot)) fail('output already exists; refusing overwrite: ' + targetRoot);

function git(...arguments_) {
  return execFileSync('git', arguments_, { cwd: repoRoot, encoding: 'utf8' }).trim();
}
const status = git('status', '--porcelain');
if (status) fail('source repo has uncommitted changes; freeze source before copying');

const head = git('rev-parse', 'HEAD');
const branch = git('branch', '--show-current');
if (branch !== 'reservation-kernel-v2') {
  fail('expected reservation-kernel-v2 branch; currently ' + branch);
}
const relFiles = [
  '.gitignore',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'README.md',
  'src/server.ts',
];
const starter = join(repoRoot, 'experiments', 'tasks', 'res-001-starter');
const promptPath = join(repoRoot, 'experiments', 'tasks', 'RES-001-PROMPT.md');
const evaluatorPath = join(repoRoot, 'experiments', 'harness', 'res001-evaluate.mjs');
const operatorSpecPath = join(repoRoot, 'experiments', 'tasks', 'RES-001.md');
const filesToHash = [promptPath, evaluatorPath, operatorSpecPath,
  ...relFiles.map(file => join(starter, ...file.split('/')))];
for (const source of filesToHash) {
  if (!existsSync(source)) fail('required source absent: ' + source);
}
const digest = data => createHash('sha256').update(data).digest('hex');
const hashes = Object.fromEntries(
  filesToHash.map(path => [relative(repoRoot, path).replace(/\\/g, '/'), digest(readFileSync(path))]),
);
const prompt = readFileSync(promptPath);
if (prompt.includes('Silk Web') || prompt.includes('## Experimental design')) {
  fail('agent prompt includes operator-only treatment details');
}

const copies = ['B', 'C'];
for (const kind of copies) {
  const folder = join(targetRoot, kind);
  mkdirSync(folder, { recursive: true });
  for (const file of relFiles) {
    const source = join(starter, ...file.split('/'));
    const destination = join(folder, ...file.split('/'));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    if (digest(readFileSync(source)) !== digest(readFileSync(destination))) {
      fail(kind + ' starter copy byte mismatch: ' + file);
    }
  }
}
for (const file of relFiles) {
  const a = readFileSync(join(targetRoot, 'B', ...file.split('/')));
  const b = readFileSync(join(targetRoot, 'C', ...file.split('/')));
  if (!a.equals(b)) fail('B/C starter files unexpectedly differ: ' + file);
}
// Each agent gets a separate Git repo, but the exact SAME starter
// tree and commit object. Git history and changes stay isolated.
function initWorkspace(kind) {
  const cwd = join(targetRoot, kind);
  const run = (args, extra = {}) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...extra },
    }).trim();
  run(['init', '--quiet', '--initial-branch=main']);
  run(['add', '--all']);
  const committedAt = {
    GIT_AUTHOR_DATE: '2026-10-29T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-10-29T00:00:00Z',
  };
  run([
    '-c', 'user.name=RES-001 Benchmark',
    '-c', 'user.email=benchmark@example.invalid',
    'commit', '--quiet', '--message=RES-001 identical starter',
  ], committedAt);
  if (run(['status', '--porcelain'])) fail(kind + ' starter repo is dirty');
  return {
    initialCommit: run(['rev-parse', 'HEAD']),
    initialTree: run(['rev-parse', 'HEAD^{tree}']),
  };
}
const B = initWorkspace('B');
const C = initWorkspace('C');
if (B.initialTree !== C.initialTree || B.initialCommit !== C.initialCommit) {
  fail('B and C have different initial Git commits/trees');
}
const operator = join(targetRoot, 'operator');
mkdirSync(operator, { recursive: true });
mkdirSync(join(targetRoot, 'reports'), { recursive: true });
writeFileSync(join(operator, 'PROMPT.md'), prompt);
const record = {
  benchmark: 'RES-001',
  stage: 'prepared — NO Muse inference run',
  createdAt: new Date().toISOString(),
  sourceBranch: branch,
  sourceCommit: head,
  nodeVersion: process.version,
  platform: process.platform,
  taskPromptSha256: digest(prompt),
  filesSha256: hashes,
  conditions: {
    B: { workspace: join(targetRoot, 'B'), silkWebMcp: false, ...B },
    C: { workspace: join(targetRoot, 'C'), silkWebMcp: true, ...C },
  },
  agentPromptFile: join(operator, 'PROMPT.md'),
  evaluatorFile: evaluatorPath,
  auditLogForC: join(operator, 'C-mcp-audit.jsonl'),
  evidenceStatus: 'unrun; quality and costs not measured',
};
writeFileSync(join(operator, 'preflight.json'), JSON.stringify(record, null, 2) + '\n');
process.stdout.write(
  'RES-001 PREPARATION PASS\n' +
  'Source commit: ' + head + '\n' +
  'Prompt SHA-256: ' + record.taskPromptSha256 + '\n' +
  'B/C starter copies and initial Git commit: IDENTICAL (' + B.initialCommit.slice(0, 12) + ')\n' +
  'Workspace B: ' + record.conditions.B.workspace + '\n' +
  'Workspace C: ' + record.conditions.C.workspace + '\n' +
  'Operator evidence: ' + operator + '\n' +
  'NO Muse model calls, no evaluator copied to agent workspaces.\n',
);
