#!/usr/bin/env node
/**
 * SW-MULTI-001: OFFLINE task preparation. No model calls, no paid services.
 * The authoring agent sees only the frozen contract, never held-out tests.
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
const root=args.length===0 ? join(homedir(),'Projects','silkweb-multidomain-20261030') :
  args.length===2 && args[0]==='--root' ? resolve(args[1]) : null;
const fail=m=>{throw new Error('SW-MULTI PREP REFUSED: '+m);};
if(!root)fail('Usage: node prepare.mjs [--root <new-absolute-folder>]');
const rel=relative(repo,root);
if(!isAbsolute(root)||rel===''||rel==='.'||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel))){
  fail('Output must be outside Silk Web source worktree');
}
if(existsSync(root))fail('Output already exists; no silent overwrite: '+root);
const git=(cwd,...a)=>execFileSync('git',['-C',cwd,...a],{encoding:'utf8'}).trim();
if(git(repo,'status','--porcelain'))fail('Source worktree must be clean before freezing a Muse task');
const starter=join(repo,'experiments/tasks/res-001-starter');
const files=['.gitignore','README.md','package.json','package-lock.json','tsconfig.json'];
const tasks={
  inventory:{
    id:'INV-001',name:'inventory-reservation',entry:'inventory.ts',
    contract:'experiments/multidomain/contracts/inventory-reservation.md',
    evaluator:'experiments/multidomain/heldout/inventory.test.mjs',
    expected:11,
  },
  webhooks:{
    id:'WHK-001',name:'signed-webhook-inbox',entry:'webhooks.ts',
    contract:'experiments/multidomain/contracts/signed-webhook-inbox.md',
    evaluator:'experiments/multidomain/heldout/webhooks.test.mjs',
    expected:12,
  },
};
const pinned=[
  'experiments/multidomain/use-cases.json','experiments/multidomain/prepare.mjs',
  'experiments/multidomain/evaluate.mjs','experiments/multidomain/run.ps1',
  'experiments/multidomain/workers/inventory-race.mjs',
  ...Object.values(tasks).flatMap(t=>[t.contract,t.evaluator]),
  ...files.map(f=>'experiments/tasks/res-001-starter/'+f),
];
for(const p of pinned)if(!existsSync(join(repo,p)))fail('Missing pinned input '+p);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const digests=Object.fromEntries(pinned.map(p=>[p,sha(join(repo,p))]));
const operator=join(root,'operator');
mkdirSync(operator,{recursive:true});
const settings={};
const authPaths=[
  join(homedir(),'Projects/silkweb-final-demo-20261030/operator/muse-config/muse/auth.json'),
  join(homedir(),'Projects/res002-fair-20261029/operator/muse-config-C/muse/auth.json'),
];
const auth=authPaths.find(existsSync);
for(const [key,task] of Object.entries(tasks)){
  const candidate=join(root,key);
  for(const f of files){
    const dest=join(candidate,f);
    mkdirSync(dirname(dest),{recursive:true});
    copyFileSync(join(starter,f),dest);
    if(sha(dest)!==digests['experiments/tasks/res-001-starter/'+f])fail('Starter copy mismatch '+f);
  }
  const placeholder=join(candidate,'src','placeholder.ts');
  mkdirSync(dirname(placeholder),{recursive:true});
  writeFileSync(placeholder,'// Neutral starter: replace only by adding the requested domain module.\nexport {};\n');
  const cmd=(a,extra={})=>execFileSync('git',a,{
    cwd:candidate,encoding:'utf8',env:{...process.env,...extra},
  }).trim();
  cmd(['init','--quiet','--initial-branch=main']);cmd(['add','--all']);
  cmd(['-c','user.name=Silk Web Multi-Domain','-c','user.email=multidomain@example.invalid',
    'commit','--quiet','-m','SW-MULTI-001 neutral '+key+' starter'],{
    GIT_AUTHOR_DATE:'2026-10-30T00:00:00Z',
    GIT_COMMITTER_DATE:'2026-10-30T00:00:00Z',
  });
  task.starterCommit=cmd(['rev-parse','HEAD']);
  task.candidate=candidate;
  const configRoot=join(operator,'muse-config-'+key);
  mkdirSync(join(configRoot,'muse'),{recursive:true});
  const audit=join(operator,'mcp-audit-'+key+'.jsonl');
  const mcpEntry=join(repo,'apps/mcp-server/dist/index.js');
  writeFileSync(join(configRoot,'muse','settings.json'),JSON.stringify({
    schema_version:1,
    mcpServers:{silkweb:{
      type:'stdio',command:process.execPath,args:[mcpEntry],required:true,enabled:true,
      env:{SILKWEB_REPO_ROOT:repo,SILKWEB_AUDIT_LOG:audit},
    }},
  },null,2)+'\n');
  if(auth)copyFileSync(auth,join(configRoot,'muse','auth.json'));
  const prompt=[
    '# SW-MULTI-001 '+task.id+' Meta Muse Spark 1.3/high authoring task',
    '',
    'Implement ONE new reusable TypeScript module in a clean Node.js 24 workspace.',
    'Use this contract exactly. Write robust production-oriented code, not a toy stub.',
    'You are building a candidate; it is NOT YET certified or in the Silk Web registry.',
    '',
    'First call Silk Web MCP search_verified_components with a short query for the domain.',
    'Do not claim a certified component exists unless the search returns it.',
    'If a relevant verified component is returned, inspect its contract with',
    'inspect_verified_component. Do not call get_verified_component_source.',
    '',
    readFileSync(join(repo,task.contract),'utf8'),
    '',
    'Important: implement '+task.entry+' inside src/. No other output source is required.',
    'You may adjust files in this candidate workspace only when necessary for build.',
    'Do not read the parent Silk Web repo, past experiment logs, held-out evaluator',
    'sources, other candidates, benchmark artifacts, or any outside files.',
    'Do not alter package dependency versions unless genuinely needed.',
    'Run npm run build. Write useful local tests only if budget allows.',
    'There are independently held-out operator tests not visible to you.',
    'Report your observed build status and any limitations without invented checks.',
    '',
  ].join('\n');
  task.promptPath=join(operator,'PROMPT-'+key+'.md');
  writeFileSync(task.promptPath,prompt,'utf8');
  task.promptSha256=sha(task.promptPath);
  task.configRoot=configRoot;task.auditLog=audit;
}
const meta={
  schemaVersion:1,suite:'SW-MULTI-001',
  kind:'FROZEN_NEW_COMPONENT_AUTHORING_NOT_BENCHMARK',
  sourceRepo:repo,sourceCommit:git(repo,'rev-parse','HEAD'),
  root,operator,tasks,pinnedSha256:digests,
  authPresent:!!auth,preparedAt:new Date().toISOString(),
};
writeFileSync(join(operator,'preflight.json'),JSON.stringify(meta,null,2)+'\n');
process.stdout.write([
  'PASS: SW-MULTI-001 two-domain offline authoring preflight (ZERO MODEL CALLS)',
  'Suite: '+meta.suite+'; source commit: '+meta.sourceCommit,
  'Inventory starter: '+tasks.inventory.starterCommit,
  'Webhooks starter: '+tasks.webhooks.starterCommit,
  'Prompts pinned separately; held-out tests NOT copied to candidates.',
  'Existing Muse auth available: '+!!auth,
  'Next: npm.cmd ci in BOTH new candidates, then STOP before paid sessions.',
  '',
].join('\n'));
