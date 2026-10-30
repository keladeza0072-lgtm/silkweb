import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,test} from 'node:test';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const script=join(repo,'experiments/final-demo/reconcile.mjs');
const roots=[];
const file=(root,name)=>join(root,name);
function save(root,name,data,encoding='utf8'){
  const p=file(root,name);
  mkdirSync(dirname(p),{recursive:true});
  const contents=typeof data==='string'?data:JSON.stringify(data,null,2)+'\n';
  writeFileSync(p,encoding==='utf16le-bom'?
    Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(contents,'utf16le')]):
    contents);
  return p;
}
function fixture(){
  const parent=mkdtempSync(join(tmpdir(),'sw-reconcile-'));
  roots.push(parent);
  const root=join(parent,'trial');
  const candidate=join(root,'candidate');
  const op='operator/';
  const spec='booking-reservation-kernel@0.2.0';
  const immutableRel='.silkweb/validations/6fbec248-be52-4c9a-b030-c57ce13786e1.json';
  const checks=[
    {id:'certification_and_installed_source_integrity',passed:true},
    {id:'application_entry_reaches_installed_source',passed:true},
    {id:'target_build',passed:true},
    {id:'selected_application_tests',passed:true,exitCode:0,
      completedRealTests:true,testCounts:{tests:5,pass:5,fail:0,cancelled:0,skipped:0}},
  ];
  const report={
    schemaVersion:1,component:spec,projectRoot:candidate,
    status:'integration-verified',passed:true,entry:'src/server.ts',
    selectedTests:['tests/booking-integration.test.mjs'],
    certification:{validated:true,certifiedSourceHash:'a'.repeat(64)},
    installedFiles:['reservationKernelV2.ts','schema.ts','slotGuard.ts','validation.ts']
      .map(path=>({path:'src/silkweb/'+path,sha256:'c'.repeat(64)})),
    reachability:{reachable:true,traversalLimitReached:false,
      matchedCertifiedSources:['src/silkweb/reservationKernelV2.ts']},
    checks,verifiedAt:'2026-10-30T00:05:00.000Z',
  };
  const originalChecks=Array.from({length:18},(_,i)=>({id:'other-'+i,passed:true}));
  originalChecks.push({id:'phase3_integration',passed:false});
  save(root,op+'preflight.json',{
    trial:'SILKWEB-DEMO-001',sourceRepo:repo,root,candidate,
  });
  save(root,op+'run.json',{
    trial:'SILKWEB-DEMO-001',stage:'evaluated',
    museExitCode:0,buildExitCode:0,phase3ExitCode:0,
  });
  save(root,op+'evaluation.json',{
    trial:'SILKWEB-DEMO-001',success:false,checksPassed:18,checksTotal:19,
    checks:originalChecks,
  });
  save(root,immutableRel.replace(/^/,'candidate/'),report);
  save(root,op+'phase3-verification.json',{
    ...report,verificationReportPath:immutableRel,
  },'utf16le-bom');
  return {root,report,immutableRel,originalChecks};
}
function reconcile(root){
  return spawnSync(process.execPath,[script,'--root',root],{
    encoding:'utf8',timeout:15000,
  });
}
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));

test('recovers verified Phase 3 from UTF-16LE and preserves original 18/19',()=>{
  const {root}=fixture();
  const original=readFileSync(file(root,'operator/evaluation.json'));
  const cli=readFileSync(file(root,'operator/phase3-verification.json'));
  const p=reconcile(root);
  assert.equal(p.status,0,p.stderr);
  const output=JSON.parse(p.stdout);
  assert.equal(output.cliEncoding,'utf16le-bom');
  assert.equal(output.reconciled,'19/19 (validated against original Phase 3 evidence)');
  const result=JSON.parse(readFileSync(file(root,'operator/evaluation-reconciliation.json')));
  assert.equal(result.success,true);
  assert.equal(result.originalEvaluation.checksPassed,18);
  assert.equal(result.reconciledChecksPassed,19);
  assert.equal(result.paidModelCalls,0);
  assert.deepEqual(readFileSync(file(root,'operator/evaluation.json')),original);
  assert.deepEqual(readFileSync(file(root,'operator/phase3-verification.json')),cli);
  const second=reconcile(root);
  assert.notEqual(second.status,0,'No overwrite or rerun permitted');
});

test('refuses CLI report if immutable target-side Phase 3 evidence disagrees',()=>{
  const {root,report,immutableRel}=fixture();
  save(root,'candidate/'+immutableRel,{...report,checks:
    report.checks.map(c=>c.id==='selected_application_tests'?{...c,passed:false}:c)});
  const r=reconcile(root);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/target-side|disagree|not actually executed/);
  assert(!existsSync(file(root,'operator/evaluation-reconciliation.json')));
});

test('refuses supplement when selected behavioral tests were not executed',()=>{
  const {root,report,immutableRel}=fixture();
  const bad={...report,checks:report.checks.map(c=>
    c.id==='selected_application_tests'?{...c,completedRealTests:false}:c)};
  save(root,'candidate/'+immutableRel,bad);
  save(root,'operator/phase3-verification.json',
    {...bad,verificationReportPath:immutableRel},'utf16le-bom');
  const r=reconcile(root);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/not actually executed/);
  assert(!existsSync(file(root,'operator/evaluation-reconciliation.json')));
});

test('does not reconcile if original evaluation has multiple independent failures',()=>{
  const {root,originalChecks}=fixture();
  save(root,'operator/evaluation.json',{
    trial:'SILKWEB-DEMO-001',success:false,checksPassed:17,checksTotal:19,
    checks:originalChecks.map((c,i)=>i===0?{...c,passed:false}:c),
  });
  const r=reconcile(root);
  assert.notEqual(r.status,0);
  assert(!existsSync(file(root,'operator/evaluation-reconciliation.json')));
});

test('refuses bogus positive Phase 3 CLI report and preserves all artifacts',()=>{
  const {root,report,immutableRel}=fixture();
  save(root,'operator/phase3-verification.json',{
    ...report,status:'build-only',verificationReportPath:immutableRel,
  },'utf16le-bom');
  const r=reconcile(root);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/verification not fully passed/);
  assert(!existsSync(file(root,'operator/evaluation-reconciliation.json')));
});
