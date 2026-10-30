#!/usr/bin/env node
/**
 * INV-INSTALL-002 zero-credit matched comparison. R and I have the SAME
 * task, neutral Git starter, model options, installed dependencies and
 * certified MCP; only I receives explicit opt-in installer permission.
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
const root=args.length===0?join(homedir(),'Projects','inv-install-002-20261030'):
  args.length===2&&args[0]==='--root'?resolve(args[1]):null;
const fail=m=>{throw Error('INV-INSTALL-002 PREP REFUSED: '+m)};
if(!root||!isAbsolute(root))fail('Usage: node prepare.mjs [--root <absolute new path>]');
const rel=relative(repo,root);
if(rel===''||rel==='.'||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))
  fail('Output must be outside entire Silk Web repository');
if(existsSync(root))fail('Output already exists; no overwrite: '+root);
const git=(cwd,...a)=>execFileSync('git',['-C',cwd,...a],{encoding:'utf8'}).trim();
if(git(repo,'status','--porcelain'))fail('Source repo must be clean');
const base='34bf9e8d815cd6a02e35f5654f944565003a5538';
execFileSync('git',['-C',repo,'merge-base','--is-ancestor',base,'HEAD']);
const sourceCommit=git(repo,'rev-parse','HEAD');
const paths=[
  'experiments/inv-install-002/TASK.md',
  'experiments/inv-install-002/evaluate.mjs',
  'experiments/inv-install-002/prepare.mjs',
  'experiments/inv-install-002/run.ps1',
  'experiments/inv-install-002/analyze.mjs',
  'experiments/tasks/res-001-starter/package.json',
  'experiments/tasks/res-001-starter/package-lock.json',
  'experiments/tasks/res-001-starter/tsconfig.json',
  'experiments/tasks/res-001-starter/.gitignore',
  'packages/registry/src/inventory.ts',
  'registry-data/manifests/inventory-reservation-0.1.0.json',
  'registry-data/evidence/inventory-reservation-0.1.0.json',
  'apps/mcp-server/src/index.ts',
  'apps/mcp-server/src/install.ts',
  'packages/installer/src/install.mjs',
];
for(const p of paths)if(!existsSync(join(repo,p)))fail('Missing pinned path: '+p);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const shaCanonicalLF=p=>createHash('sha256').update(readFileSync(p,'utf8').replace(/\r\n/g,'\n')).digest('hex');
const frozenEvaluator='ac10951bc1bd7254d7915e61aff1b3cf44fa138c3f3eb365bb52e87a04d40dc5';
if(shaCanonicalLF(join(repo,'experiments/inv-install-002/evaluate.mjs'))!==frozenEvaluator)
  fail('Held-out API evaluator differs from ORIGINAL INV-BENCH-001');
const frozenModule='3bc564618668ccfccebccff9cd8507ced3e8b445f09708fd12d8c2b11126bcf0';
if(sha(join(repo,'packages/registry/src/inventory.ts'))!==frozenModule)
  fail('Certified Muse inventory implementation drift');
const registry=join(repo,'packages/registry/dist/index.js');
const mcp=join(repo,'apps/mcp-server/dist/index.js');
if(!existsSync(registry)||!existsSync(mcp))
  fail('First npm ci + npm run build in registry AND MCP source');
const lib=await import(pathToFileURL(registry).href);
const manifests=lib.loadRegistry(join(repo,'registry-data/manifests'));
const trusted=lib.selectVerifiedManifests(repo,manifests,{evidenceDir:'registry-data/evidence'});
if(manifests.length!==6||trusted.verified.length!==6||trusted.rejected.length!==0||
   !trusted.verified.some(m=>m.id==='inventory-reservation'&&m.version==='0.1.0'))
  fail('Original six certifications must validate without regeneration');
const sourceStarter='experiments/tasks/res-001-starter';
const packageJson=JSON.parse(readFileSync(join(repo,sourceStarter,'package.json'),'utf8'));
const lock=JSON.parse(readFileSync(join(repo,sourceStarter,'package-lock.json'),'utf8'));
packageJson.name='inv-install-002-neutral';
lock.name=packageJson.name;
lock.packages[''].name=packageJson.name;
const readStarter=p=>readFileSync(join(repo,sourceStarter,p),'utf8');
const op=join(root,'operator');
mkdirSync(op,{recursive:true});
const promptPath=join(op,'TASK.md');
copyFileSync(join(repo,'experiments/inv-install-002/TASK.md'),promptPath);
const authOptions=[
  join(homedir(),'Projects/inv-bench-001-20261030/operator/muse-config-C/muse/auth.json'),
  join(homedir(),'Projects/res002-fair-20261029/operator/muse-config-C/muse/auth.json'),
  join(homedir(),'Projects/silkweb-multidomain-20261030/operator/muse-config-inventory/muse/auth.json'),
];
const auth=authOptions.find(existsSync);
const candidates={},configRoots={},auditLogs={};
for(const kind of ['R','I']){
  const wd=join(root,kind);
  mkdirSync(join(wd,'src'),{recursive:true});
  const files={
    'package.json':JSON.stringify(packageJson,null,2)+'\n',
    'package-lock.json':JSON.stringify(lock,null,2)+'\n',
    'tsconfig.json':readStarter('tsconfig.json'),
    '.gitignore':readStarter('.gitignore'),
    'README.md':'# Inventory API\n\nIdentical empty starter for INV-INSTALL-002.\n',
    'src/placeholder.ts':'export {};\n',
  };
  for(const [name,bytes] of Object.entries(files)){
    const f=join(wd,name);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,bytes);
  }
  const init=(a,extra={})=>execFileSync('git',a,{
    cwd:wd,encoding:'utf8',env:{...process.env,...extra},
  }).trim();
  init(['init','--quiet','--initial-branch=main']);
  init(['add','--all']);
  init(['-c','user.name=Silk Web Delivery Study',
    '-c','user.email=benchmark@example.invalid',
    'commit','--quiet','-m','INV-INSTALL-002 neutral starter'],{
    GIT_AUTHOR_DATE:'2026-10-30T00:00:00Z',
    GIT_COMMITTER_DATE:'2026-10-30T00:00:00Z',
  });
  candidates[kind]={
    workspace:wd,initialCommit:init(['rev-parse','HEAD']),
    initialTree:init(['rev-parse','HEAD^{tree}']),
    installEnabled:kind==='I',
  };
  if(init(['status','--porcelain']))fail('Initial candidate unexpectedly dirty '+kind);
  const configRoot=join(op,'muse-config-'+kind);
  const museDir=join(configRoot,'muse');
  mkdirSync(museDir,{recursive:true});
  const audit=join(op,'mcp-audit-'+kind+'.jsonl');
  const settings={schema_version:1,mcpServers:{silkweb:{
    type:'stdio',command:process.execPath,args:[mcp],
    required:true,enabled:true,env:{
      SILKWEB_REPO_ROOT:repo,
      SILKWEB_AUDIT_LOG:audit,
      SILKWEB_ALLOW_INSTALL:kind==='I'?'1':'0',
      SILKWEB_TARGET_WORKSPACE:wd,
    },
  }}};
  writeFileSync(join(museDir,'settings.json'),JSON.stringify(settings,null,2)+'\n');
  if(auth)copyFileSync(auth,join(museDir,'auth.json'));
  configRoots[kind]=configRoot;
  auditLogs[kind]=audit;
}
if(candidates.R.initialCommit!==candidates.I.initialCommit ||
   candidates.R.initialTree!==candidates.I.initialTree)
  fail('Candidates must start with identical Git commit and tree');
const meta={
  benchmark:'INV-INSTALL-002',classification:'FROZEN_TWO_MCP_DELIVERY_METHODS',
  sourceRepo:repo,sourceCommit,baseCommit:base,root,operator:op,
  taskPath:promptPath,taskSha256:sha(promptPath),
  evaluatorPath:join(repo,'experiments/inv-install-002/evaluate.mjs'),
  evaluatorSha256:sha(join(repo,'experiments/inv-install-002/evaluate.mjs')),
  evaluatorCanonicalLFSha256:frozenEvaluator,certifiedSourceSha256:frozenModule,
  pinnedSha256:Object.fromEntries(paths.map(p=>[p,sha(join(repo,p))])),
  candidates,configRoots,auditLogs,authPresent:!!auth,
  preparedAt:new Date().toISOString(),
};
writeFileSync(join(op,'preflight.json'),JSON.stringify(meta,null,2)+'\n');
process.stdout.write([
  'PASS INV-INSTALL-002 OFFLINE PAIRED PREFLIGHT — ZERO MODEL CALLS',
  'Frozen source: '+sourceCommit,
  'Original unchanged held-out evaluator canonical LF SHA256: '+frozenEvaluator,
  'Shared task SHA256: '+meta.taskSha256,
  'Same starter commit: '+candidates.R.initialCommit,
  'Same starter tree: '+candidates.R.initialTree,
  'Both MCP-enabled; R: source retrieval only; I: deterministic install tool additionally enabled',
  'Operator workspace pins: R='+candidates.R.workspace+' I='+candidates.I.workspace,
  'Credentials available: '+!!auth,
  'Install dependencies with npm.cmd ci in BOTH, then STOP before Muse.',
  '',
].join('\n'));
