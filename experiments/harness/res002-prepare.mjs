#!/usr/bin/env node
/**
 * RES-002 preparation only. Two identical Git starters, one shared prompt,
 * unchanged held-out RES-001 evaluator, separately authenticated profiles.
 * All outputs outside source. Does not invoke Muse inference or spend credits.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = join(homedir(), 'Projects/res002-fair-20261029');
const operator = join(root, 'operator');
const starter = join(repo, 'experiments/tasks/res-001-starter');
const promptPath = join(repo, 'experiments/tasks/RES-002-PROMPT.md');
const evaluatorPath = join(repo, 'experiments/harness/res001-evaluate.mjs');
const mcpEntry = join(repo, 'apps/mcp-server/dist/index.js');
const registryEntry = join(repo, 'packages/registry/dist/index.js');
const previousOperator = join(homedir(), 'Projects/res001-preflight-20261029/operator');
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const requiredStarterFiles = ['.gitignore', 'package.json', 'package-lock.json',
  'tsconfig.json', 'README.md', 'src/server.ts'];
const pinnedPaths = [
  'experiments/tasks/RES-002-PROMPT.md',
  'experiments/harness/res001-evaluate.mjs',
  ...requiredStarterFiles.map(s => 'experiments/tasks/res-001-starter/' + s),
  'apps/mcp-server/src/index.ts',
  'apps/mcp-server/src/librarian.ts',
  'apps/mcp-server/src/audit.ts',
  'registry-data/manifests/booking-reservation-kernel-0.2.0.json',
  'registry-data/evidence/booking-reservation-kernel-0.2.0.json',
  'registry-data/evidence/registry-loader-0.1.0.json',
  'packages/registry/src/reservationKernelV2.ts',
];
function fail(s) { throw new Error('RES-002 preflight refused: ' + s); }
if (existsSync(root)) fail('output root exists, no overwrite: ' + root);
if (!existsSync(mcpEntry) || !existsSync(registryEntry))
  fail('source worktree MCP/registry build missing: run both npm checks first');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding:'utf8' }).trim();
if (git(repo, 'status','--porcelain')) fail('source worktree not clean');
const revision = git(repo, 'rev-parse','HEAD');
const rel = relative(repo, root);
if (rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)))
  fail('output must be outside source repository');
for (const path of pinnedPaths) if (!existsSync(join(repo, path))) fail('missing pinned input ' + path);
const digests = Object.fromEntries(pinnedPaths.map(p => [p, sha(join(repo,p))]));
const prompt = readFileSync(promptPath);
const conditions = {};
for (const kind of ['B','C']) {
  const cwd = join(root,kind);
  mkdirSync(cwd, {recursive:true});
  for (const file of requiredStarterFiles) {
    const dest = join(cwd,file);
    mkdirSync(dirname(dest), {recursive:true});
    copyFileSync(join(starter,file),dest);
    if (sha(dest) !== digests['experiments/tasks/res-001-starter/' + file])
      fail('copy hash mismatch ' + kind + ' / ' + file);
  }
  const run = (args,extra={}) => execFileSync('git',args,{
    cwd,encoding:'utf8',env:{...process.env,...extra},
  }).trim();
  run(['init','--quiet','--initial-branch=main']);
  run(['add','--all']);
  run(['-c','user.name=SilkWeb RES-002',
    '-c','user.email=benchmark@example.invalid',
    'commit','--quiet','--message=RES-002 neutral starter'],{
    GIT_AUTHOR_DATE:'2026-10-29T00:00:00Z',
    GIT_COMMITTER_DATE:'2026-10-29T00:00:00Z',
  });
  if (run(['status','--porcelain'])) fail('dirty starter in ' + kind);
  conditions[kind] = {
    workspace:cwd,
    initialCommit:run(['rev-parse','HEAD']),
    initialTree:run(['rev-parse','HEAD^{tree}']),
    silkWebMcp:kind==='C',
  };
}
if (conditions.B.initialCommit!==conditions.C.initialCommit ||
    conditions.B.initialTree!==conditions.C.initialTree) {
  fail('B/C starter commits unexpectedly differ');
}
mkdirSync(operator,{recursive:true});
mkdirSync(join(root,'reports'),{recursive:true});
const savedPrompt = join(operator,'PROMPT.md');
writeFileSync(savedPrompt,prompt);
const configs = {};
for(const kind of ['B','C']) {
  const configRoot = join(operator,'muse-config-'+kind);
  const museDir = join(configRoot,'muse');
  mkdirSync(museDir,{recursive:true});
  const auditLog = join(operator,'C-mcp-audit.jsonl');
  const settings = {
    schema_version:1,
    mcpServers:kind==='C' ? {
      silkweb:{
        type:'stdio',command:process.execPath,args:[mcpEntry],
        required:true,enabled:true,
        env:{SILKWEB_REPO_ROOT:repo,SILKWEB_AUDIT_LOG:auditLog},
      },
    } : {},
  };
  writeFileSync(join(museDir,'settings.json'),JSON.stringify(settings,null,2)+'\n');
  const existingAuth = join(previousOperator, 'muse-config-'+kind,'muse/auth.json');
  const copiedAuth = existsSync(existingAuth);
  if(copiedAuth) copyFileSync(existingAuth, join(museDir,'auth.json'));
  configs[kind] = {configRoot,settings,credentialAvailable:copiedAuth};
}
const preflight={
  benchmark:'RES-002',
  design:'IDENTICAL_CONDITIONAL_INSTRUCTIONS_B_WITHOUT_MCP_C_WITH_CERTIFIED_MCP',
  createdAt:new Date().toISOString(),
  sourceCommit:revision,sourceRepo:repo,root,
  evaluator:'RES-001 held-out 41-check evaluator v1, unchanged',
  evaluatorPath,
  promptPath:savedPrompt,promptSha256:sha(savedPrompt),
  pinnedFilesSha256:digests,
  conditions,
  mcpAuditLog:join(operator,'C-mcp-audit.jsonl'),
  configRoots:Object.fromEntries(Object.entries(configs).map(([k,v])=>[k,v.configRoot])),
};
writeFileSync(join(operator,'preflight.json'),JSON.stringify(preflight,null,2)+'\n');
process.stdout.write(
  'RES-002 PREFLIGHT PASS (no Muse inference)\n' +
  'Pinned source revision: '+revision+'\n' +
  'Same task prompt SHA256: '+preflight.promptSha256+'\n' +
  'Identical starter Git commit: '+conditions.B.initialCommit+'\n' +
  'B configured MCP servers: NONE\n' +
  'C configured MCP servers: silkweb via '+mcpEntry+'\n' +
  'Candidate workspaces: '+root+'/{B,C}\n' +
  'Credential files present: B='+configs.B.credentialAvailable+' C='+configs.C.credentialAvailable+'\n' +
  'Held-out evaluator SHA256: '+digests['experiments/harness/res001-evaluate.mjs']+'\n' +
  'No original benchmark or adoption evidence touched.\n'
);
