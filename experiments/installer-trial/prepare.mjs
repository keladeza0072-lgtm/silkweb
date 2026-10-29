#!/usr/bin/env node
/**
 * MUSE-INSTALL-001: FREE preparation; never invokes Muse or touches old trials.
 * Source, prompt and target are pinned before the one paid call.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = join(homedir(), 'Projects', 'muse-installer-trial-20261029');
const operator = join(root, 'operator');
const candidate = join(root, 'candidate');
const configRoot = join(operator, 'muse-config');
const auditLog = join(operator, 'mcp-audit.jsonl');
const starterRoot = join(repo, 'experiments/tasks/res-001-starter');
const mcpEntry = join(repo, 'apps/mcp-server/dist/index.js');
const cli = join(repo, 'packages/installer/bin/silkweb.mjs');
const required = ['.gitignore', 'README.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'src/server.ts'];
const pinPaths = [
  'experiments/installer-trial/prepare.mjs',
  'experiments/installer-trial/run.ps1',
  'experiments/installer-trial/evaluate.mjs',
  'packages/installer/bin/silkweb.mjs',
  'packages/installer/src/install.mjs',
  'apps/mcp-server/src/index.ts',
  'apps/mcp-server/src/audit.ts',
  'apps/mcp-server/src/librarian.ts',
  'registry-data/manifests/booking-reservation-kernel-0.2.0.json',
  'registry-data/evidence/booking-reservation-kernel-0.2.0.json',
  ...['reservationKernelV2.ts', 'schema.ts', 'slotGuard.ts', 'validation.ts'].map(f=>'packages/registry/src/'+f),
  ...required.map(f=>'experiments/tasks/res-001-starter/'+f),
];
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const git = (...args) => execFileSync('git', ['-C',repo,...args], {encoding:'utf8'}).trim();
const refuse = msg => { throw new Error('MUSE-INSTALL-001 PREP REFUSED: '+msg); };
if (existsSync(root)) refuse('Trial folder exists; preserve prior attempts: '+root);
if (git('status','--porcelain')) refuse('Development worktree not clean');
if (!existsSync(mcpEntry) || !existsSync(join(repo, 'packages/registry/dist/index.js'))) {
  refuse('Build registry and MCP server in THIS worktree before preparation');
}
for (const rel of pinPaths) if (!existsSync(join(repo, rel))) refuse('Missing required file '+rel);
const sourceCommit = git('rev-parse','HEAD');
const pinnedSha256 = Object.fromEntries(pinPaths.map(rel=>[rel,sha(join(repo,rel))]));
for (const rel of required) {
  const target = join(candidate, rel);
  mkdirSync(dirname(target), {recursive:true});
  copyFileSync(join(starterRoot,rel),target);
  if (sha(target) !== pinnedSha256['experiments/tasks/res-001-starter/'+rel]) refuse('Starter copy mismatch '+rel);
}
// Keep a separately identifiable, immutable starter commit; agent may modify only candidate.
const cmd = (args,env={}) => execFileSync('git', args, {
  cwd:candidate, encoding:'utf8', env:{...process.env,...env},
}).trim();
cmd(['init','--quiet','--initial-branch=main']);
cmd(['add','--all']);
cmd(['-c','user.name=Silk Web Operator','-c','user.email=operator@example.invalid',
  'commit','--quiet','-m','MUSE-INSTALL-001 neutral starter'],{
    GIT_AUTHOR_DATE:'2026-10-29T00:00:00Z',
    GIT_COMMITTER_DATE:'2026-10-29T00:00:00Z',
  });
const starterCommit = cmd(['rev-parse','HEAD']);
mkdirSync(join(configRoot,'muse'), {recursive:true});
const settings = {
  schema_version:1,
  mcpServers: {
    silkweb: {
      type:'stdio',
      command:process.execPath,
      args:[mcpEntry],
      required:true,
      enabled:true,
      env:{SILKWEB_REPO_ROOT:repo,SILKWEB_AUDIT_LOG:auditLog},
    },
  },
};
writeFileSync(join(configRoot,'muse/settings.json'), JSON.stringify(settings,null,2)+'\n');
// Reuse only already-authenticated local account profile; never print credentials.
const authSources = [
  join(homedir(),'Projects/res002-fair-20261029/operator/muse-config-C/muse/auth.json'),
  join(homedir(),'Projects/silkweb-adoption-probe-20261029/operator/muse-config/muse/auth.json'),
];
const authSource = authSources.find(existsSync);
if (authSource) copyFileSync(authSource,join(configRoot,'muse/auth.json'));

const command = `node "${cli}" install booking-reservation-kernel@0.2.0 --project "${candidate}"`;
const prompt = [
  '# MUSE-INSTALL-001 — guided Muse + Silk Web installer adoption, NOT a comparative benchmark',
  '',
  'Work only in this candidate workspace. You are Meta Muse Spark 1.3.',
  'The Silk Web stdio MCP server is available for metadata searches and inspection.',
  '',
  'TASK: Build src/probe.ts as a small runnable TypeScript program proving',
  'that the certified reservation kernel can be integrated into this application.',
  '',
  'Required workflow (important: no code regeneration):',
  '1. Call MCP search_verified_components with query "reservation booking appointment API".',
  '2. Call MCP inspect_verified_component for booking-reservation-kernel@0.2.0.',
  '3. Confirm certification and runtime requirements. DO NOT call',
  '   get_verified_component_source; this trial measures installation without',
  '   sending certified source through the model context.',
  '4. Execute exactly this locally provided trusted installer command:',
  command,
  '5. Read the generated .silkweb/installations/booking-reservation-kernel@0.2.0.json',
  '   audit report from the candidate workspace. Confirm four installed files.',
  '6. Create src/probe.ts. Import initializeReservationKernel,',
  '   createIdempotentBooking and cancelReservation from',
  '   "./silkweb/reservationKernelV2.js"; do not copy, edit or rewrite',
  '   any files installed under src/silkweb/ or alter the audit report.',
  '',
  'The probe must:',
  '- use DatabaseSync from node:sqlite with an in-memory database',
  '- call initializeReservationKernel(db), then insert a staff row id=1',
  '  and a 30-minute service row id=1',
  '- create booking with idempotencyKey "muse-installer-001", staffId=1,',
  '  serviceId=1 and startTime "2026-11-05T09:00:00.000Z"',
  '- replay the same key and payload; assert only one booking was made,',
  '  same booking id and replayed=true',
  '- cancel the booking, replay the original key and assert status=cancelled',
  '- close database reliably; print ADOPTION_OK only after successful assertions',
  '- exit nonzero on any failed assertion.',
  '',
  'Run npm.cmd run build (or npm run build) and node dist/probe.js.',
  'Do not implement HTTP, unrelated features or npm dependency changes.',
  'Do not read the registry Git worktree, certification files, tests or any',
  'external files. The only external execution exception is the exact installer',
  'command above. Do not access experiments/harness or previous trial results.',
  'Report the observed outcome without inventing success.',
  '',
].join('\n');
mkdirSync(operator,{recursive:true});
const promptPath = join(operator,'PROMPT.md');
writeFileSync(promptPath,prompt,'utf8');
const meta = {
  trial:'MUSE-INSTALL-001',
  classification:'GUIDED_INSTALLER_ADOPTION_NOT_A_B_BENCHMARK',
  sourceCommit,sourceRepo:repo,root,candidate,operator,configRoot,auditLog,
  cli,installerCommand:command,
  starterCommit,promptPath,promptSha256:sha(promptPath),
  pinnedSha256,
  mcpEntry,authCopied:!!authSource,
  maxModelStepsSuggested:16,
  preparedAt:new Date().toISOString(),
};
writeFileSync(join(operator,'preflight.json'), JSON.stringify(meta,null,2)+'\n','utf8');
process.stdout.write([
  'PASS: MUSE-INSTALL-001 prepared (ZERO model calls)',
  'Source commit: '+sourceCommit,
  'Fresh candidate: '+candidate,
  'Candidate starter commit: '+starterCommit,
  'MCP: audited, read-only certified search + inspect',
  'Installer CLI: '+cli,
  'Auth copied from existing local profile: '+!!authSource,
  'Prompt SHA256: '+meta.promptSha256,
  'No earlier benchmarks or certification records changed.',
  '',
].join('\n'));
