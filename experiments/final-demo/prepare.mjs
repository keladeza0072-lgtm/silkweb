#!/usr/bin/env node
/** SILKWEB-DEMO-001: offline preparation. NEVER launches Muse or spends credits. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const argv=process.argv.slice(2);
const root=argv.length===0 ? join(homedir(),'Projects','silkweb-final-demo-20261030') :
  argv.length===2 && argv[0]==='--root' ? resolve(argv[1]) : null;
const fail=msg=>{throw new Error('SILKWEB-DEMO-001 PREP REFUSED: '+msg);};
if(!root)fail('Usage: node prepare.mjs [--root <new-output-folder>]');
const rel=relative(repo,root);
if(!isAbsolute(root)||rel===''||rel==='.'||
   (!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))fail('Output must be outside source');
if(existsSync(root))fail('Output already exists; preserving previous attempts: '+root);
const starter=join(repo,'experiments/tasks/res-001-starter');
const mcpEntry=join(repo,'apps/mcp-server/dist/index.js');
const registryEntry=join(repo,'packages/registry/dist/index.js');
const cli=join(repo,'packages/installer/bin/silkweb.mjs');
const candidate=join(root,'candidate'),operator=join(root,'operator');
const configRoot=join(operator,'muse-config'),auditLog=join(operator,'mcp-audit.jsonl');
const promptPath=join(operator,'PROMPT.md');
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).trim();
if(git(repo,'status','--porcelain'))fail('Source checkout must be clean');
if(!existsSync(mcpEntry)||!existsSync(registryEntry))fail('Build registry and MCP in this worktree first');
const files=['.gitignore','README.md','package.json','package-lock.json','tsconfig.json','src/server.ts'];
const pinned=[
  'experiments/final-demo/prepare.mjs','experiments/final-demo/run.ps1',
  'experiments/final-demo/evaluate.mjs',
  'apps/mcp-server/src/index.ts','apps/mcp-server/src/librarian.ts',
  'apps/mcp-server/src/audit.ts','packages/installer/src/install.mjs',
  'packages/installer/src/verify.mjs','packages/installer/bin/silkweb.mjs',
  'registry-data/manifests/booking-reservation-kernel-0.2.0.json',
  'registry-data/evidence/booking-reservation-kernel-0.2.0.json',
  ...['reservationKernelV2.ts','schema.ts','validation.ts','slotGuard.ts'].map(p=>'packages/registry/src/'+p),
  ...files.map(p=>'experiments/tasks/res-001-starter/'+p),
];
for(const p of pinned)if(!existsSync(join(repo,p)))fail('Missing frozen input: '+p);
const pinnedSha256=Object.fromEntries(pinned.map(p=>[p,sha(join(repo,p))]));
for(const p of files){
  const dest=join(candidate,p);
  mkdirSync(dirname(dest),{recursive:true});
  copyFileSync(join(starter,p),dest);
  if(sha(dest)!==pinnedSha256['experiments/tasks/res-001-starter/'+p])fail('Copied starter differs: '+p);
}
const gitLocal=(args,env={})=>execFileSync('git',args,{
  cwd:candidate,encoding:'utf8',env:{...process.env,...env},
}).trim();
gitLocal(['init','--quiet','--initial-branch=main']);
gitLocal(['add','--all']);
gitLocal(['-c','user.name=SilkWeb Demo','-c','user.email=demo@example.invalid',
  'commit','--quiet','-m','SILKWEB-DEMO-001 fresh starter'],{
  GIT_AUTHOR_DATE:'2026-10-30T00:00:00Z',GIT_COMMITTER_DATE:'2026-10-30T00:00:00Z',
});
const starterCommit=gitLocal(['rev-parse','HEAD']);
mkdirSync(join(configRoot,'muse'),{recursive:true});
writeFileSync(join(configRoot,'muse/settings.json'),JSON.stringify({
  schema_version:1,
  mcpServers:{silkweb:{
    type:'stdio',command:process.execPath,args:[mcpEntry],required:true,enabled:true,
    env:{SILKWEB_REPO_ROOT:repo,SILKWEB_AUDIT_LOG:auditLog},
  }},
},null,2)+'\n');
const authSources=[
  join(homedir(),'Projects/res002-fair-20261029/operator/muse-config-C/muse/auth.json'),
  join(homedir(),'Projects/muse-installer-trial-20261029/operator/muse-config/muse/auth.json'),
];
const auth=authSources.find(existsSync);
if(auth)copyFileSync(auth,join(configRoot,'muse/auth.json'));

const spec='booking-reservation-kernel@0.2.0';
const installCommand='node "'+cli+'" install '+spec+' --project "'+candidate+'"';
const verifyCommand='node "'+cli+'" verify-integration '+spec+
  ' --project "'+candidate+'" --entry src/server.ts --test tests/booking-integration.test.mjs --json';
const prompt=[
  '# SILKWEB-DEMO-001 — Final Muse + Silk Web product demo, NOT a comparative benchmark',
  '',
  'You are Muse Spark 1.3 coding in a fresh Node.js 24 + TypeScript workspace.',
  'Build a working JSON HTTP booking API around Silk Web certified code.',
  'Do NOT regenerate the core reservation implementation.',
  '',
  'FIRST use Silk Web:',
  '1. Call MCP search_verified_components: query "concurrent booking reservations retries idempotency".',
  '2. Call MCP inspect_verified_component for booking-reservation-kernel@0.2.0.',
  '3. Read the contract, exact Node/dependency constraints and 30-minute limitation.',
  '4. Run the exact verified source installer command:',installCommand,
  '5. Read the generated .silkweb/installations audit and confirm four installed files.',
  'Do NOT call get_verified_component_source or alter src/silkweb or its audit.',
  '',
  'Implement src/server.ts using DatabaseSync and imports from',
  '"./silkweb/reservationKernelV2.js" (initializeReservationKernel,',
  'createIdempotentBooking, cancelReservation).',
  'Use process.env.SILKWEB_BOOKING_DB when set for database path,',
  'otherwise a local booking.sqlite. Seed staff id=1 and 30-minute service',
  'id=1 idempotently. Bind 127.0.0.1 at PORT from env (default 3000).',
  '',
  'Required JSON HTTP API:',
  'GET /api/health -> 200 {"ok":true}',
  'POST /api/bookings: body with idempotencyKey, staffId, serviceId, startTime.',
  'First creation -> 201 {"booking":row,"replayed":false}; exact replay',
  '-> 200 {"booking":original row,"replayed":true}.',
  'POST /api/bookings/:id/cancel -> 200 {"booking":cancelled row}.',
  'Map bad requests, unknown references and conflicts to accurate JSON',
  '4xx statuses (400/404/409); never claim success for bad input.',
  'On SIGINT/SIGTERM close server and database cleanly.',
  '',
  'Create tests/booking-integration.test.mjs. Test actual successful booking,',
  'replay, conflict, cancellation, and invalid requests; run npm run build',
  'and the tests. This is not an evaluator; the operator will independently',
  'probe runtime HTTP behavior after coding and apply Phase 3 verification.',
  '',
  'Expected operator-only verifier (do not fabricate its result):',
  verifyCommand,
  '',
  'Do not read the registry Git checkout, old runs, external files,',
  'benchmark tasks, or evaluator files. The one exception is the specified',
  'trusted installer command; the Silk Web MCP is already available.',
  'Report observed results, including any failure, without invented claims.',
  '',
].join('\n');
mkdirSync(operator,{recursive:true});
writeFileSync(promptPath,prompt,'utf8');
const meta={
  schemaVersion:1,trial:'SILKWEB-DEMO-001',
  classification:'GUIDED_FINAL_PRODUCT_DEMO_NOT_A_B',
  sourceCommit:git(repo,'rev-parse','HEAD'),
  sourceRepo:repo,root,candidate,operator,configRoot,auditLog,mcpEntry,cli,
  installCommand,verifyCommand,starterCommit,promptPath,
  promptSha256:sha(promptPath),pinnedSha256,authCopied:!!auth,
  preparedAt:new Date().toISOString(),
};
writeFileSync(join(operator,'preflight.json'),JSON.stringify(meta,null,2)+'\n');
process.stdout.write([
  'PASS: SILKWEB-DEMO-001 offline preparation (ZERO MODEL CALLS)',
  'Candidate: '+candidate,
  'Source commit: '+meta.sourceCommit,
  'Starter commit: '+starterCommit,
  'Prompt SHA256: '+meta.promptSha256,
  'Auth profile present: '+!!auth,
  'Next prerequisite: npm.cmd ci in the disposable candidate.',
  'No Muse call initiated. No earlier benchmark or evidence changed.','',
].join('\n'));
