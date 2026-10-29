import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import {
  applyInstall, loadRegistryLibrary, planInstall,
} from '../src/install.mjs';
import { verifyIntegration } from '../src/verify.mjs';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const starter=join(repoRoot,'experiments/tasks/res-001-starter');
const cli=join(repoRoot,'packages/installer/bin/silkweb.mjs');
const spec='booking-reservation-kernel@0.2.0';
let projectRoot,lib;

function invoke(args,cwd=projectRoot) {
  return spawnSync(process.execPath,args,{cwd,encoding:'utf8',timeout:85000});
}

before(async()=>{
  projectRoot=mkdtempSync(join(tmpdir(),'silkweb-phase3-'));
  for(const file of ['package.json','package-lock.json','tsconfig.json']){
    copyFileSync(join(starter,file),join(projectRoot,file));
  }
  mkdirSync(join(projectRoot,'src'),{recursive:true});
  mkdirSync(join(projectRoot,'tests'),{recursive:true});
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  const install=spawnSync(npm,['ci','--ignore-scripts'],{
    cwd:projectRoot,encoding:'utf8',shell:process.platform==='win32',timeout:120000,
  });
  assert.equal(install.status,0,'npm ci failed: '+String(install.stderr).slice(-1000));
  lib=await loadRegistryLibrary(repoRoot);
  applyInstall(planInstall({repoRoot,projectRoot,spec,lib}));
  writeFileSync(join(projectRoot,'src/probe.ts'),`
import { DatabaseSync } from 'node:sqlite';
import { initializeReservationKernel, createIdempotentBooking, cancelReservation } from './silkweb/reservationKernelV2.js';
export function prove(): string {
  const db=new DatabaseSync(':memory:');
  try {
    initializeReservationKernel(db);
    db.prepare("INSERT INTO staff (id,name) VALUES (?,?)").run(1,'Staff');
    db.prepare("INSERT INTO services (id,name,duration_minutes) VALUES (?,?,?)").run(1,'Service',30);
    const input={ idempotencyKey:'phase3-test-001',staffId:1,serviceId:1,startTime:'2026-11-05T09:00:00.000Z' };
    const first=createIdempotentBooking(db,input);
    const replay=createIdempotentBooking(db,input);
    if(replay.booking.id!==first.booking.id||!replay.replayed)throw new Error('Bad idempotency');
    if(db.prepare('SELECT COUNT(*) AS count FROM appointments').get()?.count!==1)throw new Error('Unexpected extra booking');
    cancelReservation(db,first.booking.id);
    if(createIdempotentBooking(db,input).booking.status!=='cancelled')throw new Error('Bad cancellation replay');
    return 'INTEGRATION_OK';
  } finally { db.close(); }
}
`);
  writeFileSync(join(projectRoot,'tests/booking-integration.test.mjs'),`
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prove} from '../dist/probe.js';
test('integration proves booking idempotency and cancellation',()=>assert.equal(prove(),'INTEGRATION_OK'));
`);
  writeFileSync(join(projectRoot,'tests/failing-integration.test.mjs'),`
import assert from 'node:assert/strict';
import {test} from 'node:test';
test('deliberately failed application contract',()=>assert.equal(1,2));
`);
});
after(()=>{if(projectRoot)rmSync(projectRoot,{recursive:true,force:true});});

function verify(overrides={}){
  return verifyIntegration({
    repoRoot,projectRoot,spec,lib,entry:'src/probe.ts',
    tests:['tests/booking-integration.test.mjs'],...overrides,
  });
}

test('a real target builds, imports certified source and passes behavior tests',()=>{
  const report=verify();
  assert.equal(report.status,'integration-verified');
  assert.equal(report.passed,true);
  assert.equal(report.certification.validated,true);
  assert.deepEqual(report.checks.map(c=>c.id),[
    'certification_and_installed_source_integrity',
    'application_entry_reaches_installed_source',
    'target_build','selected_application_tests',
  ]);
  assert(report.checks.every(c=>c.passed));
  assert(report.reachability.matchedCertifiedSources.includes('src/silkweb/reservationKernelV2.ts'));
  assert(report.verificationReportPath.startsWith('.silkweb/validations/'));
  const saved=JSON.parse(readFileSync(join(projectRoot,report.verificationReportPath),'utf8'));
  assert.equal(saved.status,'integration-verified');
  assert(!saved.verificationReportPath,'The evidence file is immutable after creation');
});

test('no behavior tests never claims integration even when build and imports pass',()=>{
  const report=verify({tests:[],saveReport:false});
  assert.equal(report.status,'build-and-entry-verified');
  assert.equal(report.passed,true);
  assert.equal(report.checks.some(c=>c.id==='selected_application_tests'),false);
});

test('no declared app entry never claims fully validated integration',()=>{
  const report=verify({entry:undefined,saveReport:false});
  assert.equal(report.status,'selected-tests-passed');
  assert.equal(report.passed,true);
});

test('failed integration test is reported as failed rather than certified',()=>{
  const report=verify({tests:['tests/failing-integration.test.mjs'],saveReport:false});
  assert.equal(report.status,'verification-failed');
  assert.equal(report.passed,false);
  const check=report.checks.find(x=>x.id==='selected_application_tests');
  assert.equal(check.passed,false);
  assert.notEqual(check.exitCode,0);
});

test('entry without import reachability cannot claim integration',()=>{
  writeFileSync(join(projectRoot,'src/unrelated.ts'),'export const unrelated=1;\n');
  const report=verify({entry:'src/unrelated.ts',saveReport:false});
  assert.equal(report.status,'verification-failed');
  assert.equal(report.checks.find(x=>x.id==='application_entry_reaches_installed_source').passed,false);
  assert.equal(report.checks.find(x=>x.id==='selected_application_tests').skipped,true);
});

test('source tampering and audit tampering both fail before compiling or testing',()=>{
  const source=join(projectRoot,'src/silkweb/schema.ts');
  const originalSource=readFileSync(source);
  try{
    writeFileSync(source,'// changed by attacker\n');
    assert.throws(()=>verify({saveReport:false}),e=>e.code==='DESTINATION_CONFLICT');
  }finally{writeFileSync(source,originalSource);}
  const reportFile=join(projectRoot,'.silkweb/installations',spec+'.json');
  const originalReport=readFileSync(reportFile);
  try{
    writeFileSync(reportFile,'{}\n');
    assert.throws(()=>verify({saveReport:false}),e=>e.code==='REPORT_CONFLICT');
  }finally{writeFileSync(reportFile,originalReport);}
});

test('uninstalled project cannot gain integration verification by building alone',()=>{
  const file=join(projectRoot,'.silkweb/installations',spec+'.json');
  const original=readFileSync(file);
  try{
    rmSync(file);
    assert.throws(()=>verify({saveReport:false}),e=>e.code==='NOT_INSTALLED');
  }finally{writeFileSync(file,original);}
});

test('test files are explicitly scoped to local tests folders, no traversal',()=>{
  for(const candidate of ['../escape.test.mjs','src/probe.ts','.silkweb/validations/file.test.mjs']){
    assert.throws(()=>verify({tests:[candidate],saveReport:false}),e=>
      ['UNSAFE_PATH','UNSAFE_TEST','MISSING_TEST'].includes(e.code),candidate);
  }
  assert.throws(()=>verify({tests:['tests/booking-integration.test.mjs','tests/booking-integration.test.mjs'],saveReport:false}),
    e=>e.code==='DUPLICATE_TEST');
});

test('CLI prints machine-readable verified scope and returns zero',()=>{
  const proc=invoke([cli,'verify-integration',spec,'--project',projectRoot,'--entry','src/probe.ts',
    '--test','tests/booking-integration.test.mjs','--json']);
  assert.equal(proc.status,0,proc.stderr);
  const result=JSON.parse(proc.stdout);
  assert.equal(result.status,'integration-verified');
  assert.equal(result.passed,true);
  assert(existsSync(join(projectRoot,result.verificationReportPath)));
});

test('failed CLI selected tests cause non-zero exit (not a silent pass)',()=>{
  const proc=invoke([cli,'verify-integration',spec,'--project',projectRoot,'--entry','src/probe.ts',
    '--test','tests/failing-integration.test.mjs','--json']);
  assert.equal(proc.status,1,proc.stderr);
  const result=JSON.parse(proc.stdout);
  assert.equal(result.status,'verification-failed');
});

test('repeated audits create new immutable records, never overwrite previous result',()=>{
  const a=verify({tests:[],entry:undefined});
  const b=verify({tests:[],entry:undefined});
  assert.notEqual(a.verificationReportPath,b.verificationReportPath);
  assert(existsSync(join(projectRoot,a.verificationReportPath)));
  assert(existsSync(join(projectRoot,b.verificationReportPath)));
  assert.equal(JSON.parse(readFileSync(join(projectRoot,a.verificationReportPath),'utf8')).status,'build-only');
});
