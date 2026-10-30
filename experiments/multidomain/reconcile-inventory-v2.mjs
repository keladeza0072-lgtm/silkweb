#!/usr/bin/env node
/**
 * SW-MULTI-001 / INV07-v2: versioned offline acceptance correction.
 * Original contract ALLOWS zero starting stock; original INV07 wrongly
 * expected zero to throw INVALID_INPUT. Preserve the original 10/11 result.
 * Test the ORIGINAL compiled candidate against corrected held-out tests.
 * No model inference, rebuild, candidate edits, or certification.
 */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
const root=args.length===0 ? join(homedir(),'Projects','silkweb-multidomain-20261030') :
  args.length===2&&args[0]==='--root' ? resolve(args[1]) : null;
const refuse=m=>{throw new Error('INV07-v2 CORRECTION REFUSED: '+m)};
if(!root)refuse('Usage: node reconcile-inventory-v2.mjs [--root <original-root>]');
const operator=join(root,'operator');
const metaPath=join(operator,'preflight.json');
const runPath=join(operator,'run-inventory.json');
const originalReportPath=join(operator,'evaluation-inventory.json');
const correctionPath=join(operator,'evaluation-inventory-v2.json');
const candidate=join(root,'inventory');
const compiled=join(candidate,'dist','inventory.js');
const source=join(candidate,'src','inventory.ts');
const v1Rel='experiments/multidomain/heldout/inventory.test.mjs';
const v2Rel='experiments/multidomain/heldout/inventory-v2.test.mjs';
const contractRel='experiments/multidomain/contracts/inventory-reservation.md';

function requireFile(path,max=2*1024*1024){
  if(!existsSync(path))refuse('Missing '+path);
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)refuse('Unsafe or oversized '+path);
  return readFileSync(path);
}
function hash(path){return createHash('sha256').update(requireFile(path)).digest('hex');}
function readJson(path){
  try{return JSON.parse(requireFile(path).toString('utf8').replace(/^\uFEFF/,''));}
  catch(error){refuse('Cannot read JSON from '+path+': '+String(error));}
}
function assert(ok,message){if(!ok)refuse(message);}
function parseTap(output){
  const counts={tests:null,pass:null,fail:null,cancelled:null,skipped:null};
  for(const m of output.matchAll(/^# (tests|pass|fail|cancelled|skipped) (\d+)\r?$/gm)){
    counts[m[1]]=Number(m[2]);
  }
  return counts;
}
function gitHead(repoPath){
  const result=spawnSync('git',['-C',repoPath,'rev-parse','HEAD'],{
    encoding:'utf8',windowsHide:true,timeout:10000,
  });
  assert(result.status===0,'Cannot verify Git revision at '+repoPath);
  return result.stdout.trim();
}
function main(){
  assert(!existsSync(correctionPath),'Corrected evaluation already exists; no overwrites');
  const meta=readJson(metaPath);
  const run=readJson(runPath);
  const original=readJson(originalReportPath);
  const originalRepo=resolve(meta.sourceRepo??'.');
  assert(meta.suite==='SW-MULTI-001'&&resolve(meta.root??'.')===root,
    'Wrong original authoring suite');
  assert(resolve(meta.tasks?.inventory?.candidate??'.')===candidate,
    'Wrong original inventory candidate');
  assert(gitHead(originalRepo)===meta.sourceCommit,
    'Original source worktree no longer matches frozen revision');
  assert(typeof meta.tasks.inventory.promptSha256==='string' &&
    run.promptSha256===meta.tasks.inventory.promptSha256 &&
    run.task==='inventory'&&run.suite==='SW-MULTI-001' &&
    run.museExitCode===0&&run.buildExitCode===0&&run.evaluationExitCode===1,
    'Not the original single paid inventory attempt');
  assert(original.suite==='SW-MULTI-001'&&original.task==='inventory' &&
    original.classification==='HELDOUT_NEW_COMPONENT_AUTHORING_NOT_B_C' &&
    original.success===false&&original.checksPassed===10 &&
    original.checksTotal===11&&original.observedCounts?.fail===1,
    'Not the preserved 10/11 inventory evaluation');
  assert(original.execution?.exitCode===1 &&
    typeof original.execution.logTail==='string' &&
    original.execution.logTail.includes('not ok 7 - INV07:') &&
    original.execution.logTail.includes('inventory.test.mjs:100:14') &&
    original.execution.logTail.includes('Missing expected exception'),
    'Original failure does not match exact known INV07 assertion');
  assert(hash(join(originalRepo,v1Rel))===meta.pinnedSha256?.[v1Rel],
    'Original held-out test has changed');
  assert(hash(join(originalRepo,contractRel))===meta.pinnedSha256?.[contractRel],
    'Original contract has changed');
  const contract=requireFile(join(originalRepo,contractRel)).toString('utf8');
  assert(contract.includes('stock must be a nonnegative safe integer'),
    'Original contract does not permit zero initial stock');
  assert(existsSync(source)&&existsSync(compiled)&&
    hash(compiled)===original.candidateCompiledSourceSha256,
    'Candidate compiled source changed after original evaluation');
  // Original trial may be on Windows where Git checkout uses CRLF.
  // Keep the ORIGINAL raw SHA-256 verification above; normalize only for
  // the narrow semantic source comparison. Any other change still fails.
  const asLf=buffer=>buffer.toString('utf8').replace(/\r\n/g,'\n');
  const v1=asLf(requireFile(join(originalRepo,v1Rel)));
  const v2=asLf(requireFile(join(repo,v2Rel)));
  const before=[
    '    for(const value of [-1,0,1.2,Number.MAX_SAFE_INTEGER+1,Number.NaN]){',
    "      assert.throws(()=>seedStock(db,'BAD',value),code('INVALID_INPUT'));",
    '    }',
    "    seedStock(db,'SKU-A',5);",
  ].join('\n');
  const after=[
    '    for(const value of [-1,1.2,Number.MAX_SAFE_INTEGER+1,Number.NaN]){',
    "      assert.throws(()=>seedStock(db,'BAD',value),code('INVALID_INPUT'));",
    '    }',
    '    // INV-001 contract explicitly allows zero initial stock (nonnegative).',
    '    // Regression guard: zero must be ACCEPTED, not treated as invalid.',
    "    seedStock(db,'ZERO-IS-VALID',0);",
    "    assert.equal(availableStock(db,'ZERO-IS-VALID'),0);",
    "    seedStock(db,'SKU-A',5);",
  ].join('\n');
  assert(v1.includes(before)&&v1.replace(before,after)===v2,
    'Corrected suite changes more than the one approved INV07 assertion');
  // No Muse, no rebuild, and no candidate writes: only pinned held-out tests.
  const env={...process.env,SILKWEB_CANDIDATE:candidate};
  for(const key of Object.keys(env))if(key.startsWith('NODE_TEST_'))delete env[key];
  const result=spawnSync(process.execPath,[
    '--test','--test-reporter=tap',join(repo,v2Rel),
  ],{cwd:repo,encoding:'utf8',windowsHide:true,env,
    timeout:90000,maxBuffer:2*1024*1024,shell:false});
  const stdout=String(result.stdout??'');
  const stderr=String(result.stderr??'');
  const counts=parseTap(stdout);
  const fullCounts=counts.tests===11 &&
    Number.isSafeInteger(counts.pass)&&Number.isSafeInteger(counts.fail)&&
    Number.isSafeInteger(counts.cancelled)&&Number.isSafeInteger(counts.skipped)&&
    counts.pass+counts.fail+counts.cancelled+counts.skipped===counts.tests;
  const success=fullCounts&&result.status===0&&counts.pass===11 &&
    counts.fail===0&&counts.cancelled===0&&counts.skipped===0;
  const report={
    schemaVersion:1,suite:'SW-MULTI-001',task:'inventory',
    classification:'OFFLINE_CORRECTED_HELDOUT_INV07_V2_NOT_A_NEW_MUSE_RUN',
    sourceCommit:gitHead(repo),originalSourceCommit:meta.sourceCommit,
    original:{reportSha256:hash(originalReportPath),checksPassed:10,
      checksTotal:11,success:false,preserved:true},
    corrected:{
      checksPassed:fullCounts?counts.pass:0,checksTotal:11,success,
      suitePath:v2Rel,suiteSha256:hash(join(repo,v2Rel)),
      originalSuiteSha256:meta.pinnedSha256[v1Rel],
      contractSha256:meta.pinnedSha256[contractRel],
      compiledSourceSha256:hash(compiled),
      processExitCode:result.status,counts,
      logTail:(stdout+'\n'+stderr).slice(-5500),
    },
    paidModelCalls:0,recompiledCandidate:false,
    limitation:'Only INV07 corrected to allow initial stock=0 per frozen contract. Original 10/11 preserved. Not yet certified or a matched A/B comparison.',
    createdAt:new Date().toISOString(),
  };
  writeFileSync(correctionPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({
    task:'inventory',original:'10/11 (preserved)',
    corrected:String(report.corrected.checksPassed)+'/11 (corrected contract, offline)',
    success,paidModelCalls:0,candidateRebuilt:false,correctionPath,
  },null,2)+'\n');
  if(!success)process.exitCode=1;
}
try{main();}catch(error){
  process.stderr.write(String(error?.message??error)+'\n');
  process.exitCode=1;
}
