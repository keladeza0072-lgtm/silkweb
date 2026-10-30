#!/usr/bin/env node
/**
 * SW-MULTI-001: held-out independent evaluator, no inference.
 * Runs ONLY the operator-owned, SHA256-pinned acceptance suite.
 * NEVER runs tests from candidate and NEVER edits source/old reports.
 */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
if(args.length!==2 && args.length!==4)throw new Error(
  'Usage: node evaluate.mjs --task inventory|webhooks [--root <prepared-root>]');
if(args[0]!=='--task'||!['inventory','webhooks'].includes(args[1]))throw new Error('Invalid task');
const task=args[1];
const root=args.length===4 && args[2]==='--root'?
  resolve(args[3]):join(homedir(),'Projects','silkweb-multidomain-20261030');
const op=join(root,'operator'),candidate=join(root,task);
const original=join(op,'preflight.json');
const record=join(op,'run-'+task+'.json');
const reportPath=join(op,'evaluation-'+task+'.json');
const fail=reason=>{throw new Error('HELDOUT EVALUATION REFUSED: '+reason)};
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const readJson=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
function parseTap(output){
  const counts={tests:null,pass:null,fail:null,cancelled:null,skipped:null};
  for(const m of output.matchAll(/^# (tests|pass|fail|cancelled|skipped) (\d+)\r?$/gm)){
    counts[m[1]]=Number(m[2]);
  }
  return counts;
}
function main(){
  if(existsSync(reportPath))fail('Prior evaluation exists; no overwrite');
  if(!existsSync(original))fail('Missing frozen suite preparation');
  const meta=readJson(original);
  if(meta.suite!=='SW-MULTI-001'||meta.sourceRepo!==repo||
     resolve(meta.root)!==root||resolve(meta.tasks?.[task]?.candidate??'.')!==candidate){
    fail('Wrong source, task or candidate metadata');
  }
  const spec=meta.tasks[task];
  if(spec.expected!== (task==='inventory'?11:12))fail('Unexpected frozen test total');
  const testPath=join(repo,spec.evaluator);
  if(!existsSync(testPath)||sha(testPath)!==meta.pinnedSha256[spec.evaluator]){
    fail('Held-out test source drift; never silently rescore new tests');
  }
  let run=null;
  if(existsSync(record))run=readJson(record);
  if(run && (run.suite!=='SW-MULTI-001'||run.task!==task||
      run.promptSha256!==spec.promptSha256)){
    fail('Run record does not match frozen task and prompt');
  }
  const compiled=join(candidate,'dist',spec.entry.replace(/\.ts$/,'.js'));
  const ready=run?.museExitCode===0&&run?.buildExitCode===0&&existsSync(compiled);
  let execution=null;
  let counts={tests:null,pass:null,fail:null,cancelled:null,skipped:null};
  if(ready){
    // Prevent a parent Node test context from masking nested test failures.
    const env={...process.env,SILKWEB_CANDIDATE:candidate};
    for(const key of Object.keys(env))if(key.startsWith('NODE_TEST_'))delete env[key];
    const result=spawnSync(process.execPath,['--test','--test-reporter=tap',testPath],{
      cwd:repo,env,encoding:'utf8',shell:false,windowsHide:true,
      timeout:90000,maxBuffer:2*1024*1024,
    });
    counts=parseTap(result.stdout??'');
    execution={
      exitCode:result.status,signal:result.signal,
      error:result.error?.message??null,testsObserved:counts.tests,
      logTail:(String(result.stdout??'')+'\n'+String(result.stderr??'')).slice(-3000),
    };
  }
  const validCounts=counts.tests===spec.expected &&
    Number.isSafeInteger(counts.pass)&&Number.isSafeInteger(counts.fail)&&
    Number.isSafeInteger(counts.skipped)&&Number.isSafeInteger(counts.cancelled)&&
    counts.pass+counts.fail+counts.skipped+counts.cancelled===counts.tests;
  const passed=validCounts?counts.pass:0;
  const total=spec.expected;
  const success=ready&&validCounts&&execution?.exitCode===0 &&
    counts.pass===total&&counts.fail===0&&counts.skipped===0&&counts.cancelled===0;
  const report={
    schemaVersion:1,suite:'SW-MULTI-001',task,contractId:spec.id,
    classification:'HELDOUT_NEW_COMPONENT_AUTHORING_NOT_B_C',
    createdAt:new Date().toISOString(),
    model:run?.model??null,codingSeconds:run?.codingSeconds??null,
    museExitCode:run?.museExitCode??null,buildExitCode:run?.buildExitCode??null,
    frozenEvaluatorSha256:meta.pinnedSha256[spec.evaluator],
    frozenPromptSha256:spec.promptSha256,
    candidateCompiledSourceSha256:existsSync(compiled)?sha(compiled):null,
    checksPassed:passed,checksTotal:total,quality:Math.round(100*passed/total*100)/100,
    success,execution,observedCounts:counts,
    caveats:[
      'Single guided component authoring task; no With/Without Silk Web comparison yet.',
      'New source is NOT certified and cannot be returned by the trusted registry.',
      'Held-out test scope is limited to the explicitly frozen acceptance checks.',
      'An exit code of zero alone never constitutes certification.',
    ],
  };
  writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({
    task,success,checksPassed:passed,checksTotal:total,quality:report.quality,
    museExitCode:report.museExitCode,buildExitCode:report.buildExitCode,
    testExit:execution?.exitCode??null,
    reportPath,
  },null,2)+'\n');
  if(!success)process.exitCode=1;
}
try{main();}
catch(error){
  process.stderr.write(String(error?.message??error)+'\n');
  process.exitCode=1;
}
