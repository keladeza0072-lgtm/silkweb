#!/usr/bin/env node
/**
 * INV-BENCH-001: ZERO-CREDIT paired Muse task preflight. Two byte-identical
 * Git starters, one frozen task, identical compiler deps, separate Muse config.
 * Neither candidate sees held-out evaluator or registry source; condition C
 * alone can access the read-only verified MCP Librarian. No model calls.
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const root=join(homedir(),'Projects','inv-bench-001-20261030');
const op=join(root,'operator');
const base='experiments/inv-bench-001/';
const task=base+'TASK.md';
const evaluator=base+'evaluate.mjs';
const pinned=[
  task,evaluator,base+'prepare.mjs',base+'run.ps1',base+'analyze.mjs',
  'experiments/tasks/res-001-starter/package.json',
  'experiments/tasks/res-001-starter/package-lock.json',
  'experiments/tasks/res-001-starter/tsconfig.json',
  'experiments/tasks/res-001-starter/.gitignore',
  'registry-data/manifests/inventory-reservation-0.1.0.json',
  'registry-data/evidence/inventory-reservation-0.1.0.json',
  'packages/registry/src/inventory.ts',
  'apps/mcp-server/src/librarian.ts',
  'apps/mcp-server/src/audit.ts',
];
const fail=reason=>{throw new Error('INV-BENCH-001 PREFLIGHT REFUSED: '+reason)};
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();
const rel=relative(repo,root);
if(rel==='' || (!rel.startsWith('..'+sep)&&rel!=='..'&&!resolve(root).startsWith(resolve(repo)+'\\'))){
  fail('Output must be outside source repository');
}
if(existsSync(root))fail('Root already exists, refusing overwrite: '+root);
if(git(repo,'status','--porcelain'))fail('Source worktree dirty');
const freeze=git(repo,'rev-parse','inventory-cert-6-freeze^{}');
const child=execFileSync('git',['-C',repo,'merge-base','--is-ancestor',freeze,'HEAD']);
if(!freeze||child===null){} // command exits nonzero on divergence
const sourceCommit=git(repo,'rev-parse','HEAD');
for(const file of pinned)if(!existsSync(join(repo,file)))fail('Missing frozen input '+file);
const registry=join(repo,'packages/registry/dist/index.js');
const mcp=join(repo,'apps/mcp-server/dist/index.js');
if(!existsSync(registry)||!existsSync(mcp))
  fail('Build registry and MCP server locally before preparing paired tasks');
const lib=await import(pathToFileURL(registry).href);
const manifests=lib.loadRegistry(join(repo,'registry-data/manifests'));
const trusted=lib.selectVerifiedManifests(repo,manifests,{evidenceDir:'registry-data/evidence'});
if(manifests.length!==6||trusted.verified.length!==6||trusted.rejected.length>0||
  !trusted.verified.some(m=>m.id==='inventory-reservation'&&m.version==='0.1.0')){
  fail('Six certified components not verified in current source build');
}
const expectedSource='3bc564618668ccfccebccff9cd8507ced3e8b445f09708fd12d8c2b11126bcf0';
if(sha(join(repo,'packages/registry/src/inventory.ts'))!==expectedSource)
  fail('Inventory Muse source digest does not match the certified candidate');
const hashes=Object.fromEntries(pinned.map(p=>[p,sha(join(repo,p))]));
const starter='experiments/tasks/res-001-starter';
const packageJson=JSON.parse(readFileSync(join(repo,starter,'package.json'),'utf8'));
packageJson.name='inv-bench-001-neutral';
const packageLock=JSON.parse(readFileSync(join(repo,starter,'package-lock.json'),'utf8'));
packageLock.name='inv-bench-001-neutral';
packageLock.packages[''].name='inv-bench-001-neutral';
const candidates={};
mkdirSync(op,{recursive:true});
const savedTask=join(op,'TASK.md');copyFileSync(join(repo,task),savedTask);
const config={};
const possibleAuth=[
  join(homedir(),'Projects/res002-fair-20261029/operator/muse-config-B/muse/auth.json'),
  join(homedir(),'Projects/silkweb-final-demo-20261030/operator/muse-config/muse/auth.json'),
  join(homedir(),'Projects/silkweb-multidomain-20261030/operator/muse-config-inventory/muse/auth.json'),
];
const auth=possibleAuth.find(existsSync);
for(const kind of ['B','C']){
  const wd=join(root,kind);
  mkdirSync(join(wd,'src'),{recursive:true});
  const neutralFiles={
    'package.json':JSON.stringify(packageJson,null,2)+'\n',
    'package-lock.json':JSON.stringify(packageLock,null,2)+'\n',
    'tsconfig.json':readFileSync(join(repo,starter,'tsconfig.json'),'utf8'),
    '.gitignore':readFileSync(join(repo,starter,'.gitignore'),'utf8'),
    'README.md':'# Inventory Allocation API\n\nNeutral empty TypeScript starter; the frozen task is supplied by Muse separately.\n',
    'src/placeholder.ts':'export {};\n',
  };
  for(const [p,body] of Object.entries(neutralFiles)){
    const target=join(wd,p);mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,body,'utf8');
  }
  const run=(args,extra={})=>execFileSync('git',args,{
    cwd:wd,encoding:'utf8',env:{...process.env,...extra},
  }).trim();
  run(['init','--quiet','--initial-branch=main']);
  run(['add','--all']);
  run(['-c','user.name=Silk Web Inventory Benchmark',
    '-c','user.email=benchmark@example.invalid',
    'commit','--quiet','-m','INV-BENCH-001 neutral starter'],{
    GIT_AUTHOR_DATE:'2026-10-30T00:00:00Z',
    GIT_COMMITTER_DATE:'2026-10-30T00:00:00Z',
  });
  const initialCommit=run(['rev-parse','HEAD']);
  const tree=run(['rev-parse','HEAD^{tree}']);
  if(run(['status','--porcelain']))fail('Dirty neutral starter '+kind);
  candidates[kind]={workspace:wd,initialCommit,tree,mcp:kind==='C'};
  const configRoot=join(op,'muse-config-'+kind);
  mkdirSync(join(configRoot,'muse'),{recursive:true});
  const audit=join(op,'C-mcp-audit.jsonl');
  const settings={
    schema_version:1,mcpServers:kind==='C'?{
      silkweb:{type:'stdio',command:process.execPath,args:[mcp],
        required:true,enabled:true,
        env:{SILKWEB_REPO_ROOT:repo,SILKWEB_AUDIT_LOG:audit}},
    }:{},
  };
  writeFileSync(join(configRoot,'muse/settings.json'),JSON.stringify(settings,null,2)+'\n');
  if(auth)copyFileSync(auth,join(configRoot,'muse/auth.json'));
  config[kind]={configRoot,credentialPresent:!!auth};
}
if(candidates.B.initialCommit!==candidates.C.initialCommit||
   candidates.B.tree!==candidates.C.tree){
  fail('B/C initial commits or trees differ');
}
const meta={
  benchmark:'INV-BENCH-001',classification:'FROZEN_PAIRED_AUTHORING_PREFLIGHT',
  design:'IDENTICAL_TASK_AND_STARTER_B_WITHOUT_MCP_C_WITH_SIX_CERTIFIED_COMPONENT_MCP',
  sourceRepo:repo,sourceCommit,frozenCertificationCommit:freeze,
  preparedAt:new Date().toISOString(),root,operator:op,
  taskPath:savedTask,taskSha256:sha(savedTask),evaluatorPath:join(repo,evaluator),
  hashes,candidates,configRoots:Object.fromEntries(Object.entries(config).map(([k,v])=>[k,v.configRoot])),
  auditLog:join(op,'C-mcp-audit.jsonl'),
};
writeFileSync(join(op,'preflight.json'),JSON.stringify(meta,null,2)+'\n');
process.stdout.write([
  'PASS INV-BENCH-001 FAIR PAIRED PREFLIGHT — ZERO PAID MODEL CALLS',
  'Six verified components; inventory source digest: '+expectedSource,
  'Source commit: '+sourceCommit,
  'Shared task SHA256: '+meta.taskSha256,
  'Same starter commit: '+candidates.B.initialCommit,
  'Same starter tree: '+candidates.B.tree,
  'B MCP servers: NONE; C MCP servers: ONLY audited verified Silk Web',
  'Auth present: '+Boolean(auth),
  'New isolated workspaces: '+root+'/{B,C}',
  'Install dependencies in B and C with npm.cmd ci, then STOP.',
  '',
].join('\n'));
