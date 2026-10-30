#!/usr/bin/env node
/**
 * SILKWEB-DEMO-001: OFFLINE, ADDITIVE post-run correction.
 *
 * Windows PowerShell 5.1 redirects stdout as UTF-16LE with BOM, while the
 * original evaluator parsed redirected Phase 3 JSON as UTF-8. This may yield
 * a single false "phase3_integration" failure despite a successful verifier.
 *
 * This script does not execute Muse, rerun evaluation/tests, edit old evidence
 * or modify the candidate. It validates BOTH the original CLI report and
 * the immutable target-side Phase 3 report, then creates a separate,
 * exclusive reconciliation file. Missing/inconsistent evidence fails closed.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
const root=args.length===0
  ? join(homedir(),'Projects','silkweb-final-demo-20261030')
  : args.length===2 && args[0]==='--root' ? resolve(args[1]) : null;
const refuse=message=>{ throw new Error('OFFLINE RECONCILIATION REFUSED: '+message); };
if(!root)refuse('Usage: node reconcile.mjs [--root <prior-demo-root>]');
const operator=join(root,'operator');
const originalPath=join(operator,'evaluation.json');
const runnerPath=join(operator,'run.json');
const metaPath=join(operator,'preflight.json');
const stdoutPath=join(operator,'phase3-verification.json');
const correctionPath=join(operator,'evaluation-reconciliation.json');
const spec='booking-reservation-kernel@0.2.0';
const expectedEntry='src/server.ts';
const expectedTest='tests/booking-integration.test.mjs';
const expectedIds=[
  'certification_and_installed_source_integrity',
  'application_entry_reaches_installed_source',
  'target_build',
  'selected_application_tests',
];

function readStrict(path,maxBytes=2*1024*1024){
  if(!existsSync(path))refuse('Missing required evidence file: '+basename(path));
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes){
    refuse('Unsafe or oversized evidence file: '+basename(path));
  }
  return readFileSync(path);
}
function sha(path){return createHash('sha256').update(readStrict(path)).digest('hex');}
function json(path){
  const bytes=readStrict(path);
  let encoding='utf8';
  let decoded;
  if(bytes[0]===0xff && bytes[1]===0xfe){
    encoding='utf16le-bom';
    decoded=bytes.subarray(2).toString('utf16le');
  }else if(bytes[0]===0xfe && bytes[1]===0xff){
    refuse('Unsupported UTF-16BE evidence; preserve bytes for manual diagnosis');
  }else{
    encoding=bytes[0]===0xef && bytes[1]===0xbb && bytes[2]===0xbf?'utf8-bom':'utf8';
    decoded=bytes.toString('utf8').replace(/^\uFEFF/,'');
  }
  let data;
  try{data=JSON.parse(decoded);}
  catch{refuse('JSON parse failed for '+basename(path)+' using '+encoding);}
  if(data===null||typeof data!=='object'||Array.isArray(data)){
    refuse('Evidence is not a JSON object: '+basename(path));
  }
  return {data,encoding};
}
function assert(ok,reason){if(!ok)refuse(reason);}
function checkedRelative(rootFolder,relativePath){
  assert(typeof relativePath==='string' && relativePath.startsWith('.silkweb/validations/'),
    'Unrecognized target-side Phase 3 report path');
  assert(/^\.silkweb\/validations\/[0-9a-f-]{36}\.json$/i.test(relativePath),
    'Invalid Phase 3 report path');
  const full=resolve(rootFolder,relativePath);
  const rel=relative(rootFolder,full);
  assert(rel && !rel.startsWith('..'+sep) && !rel.startsWith('..') && !rel.includes('..'+sep),
    'Phase 3 report escapes candidate');
  return full;
}
function checkScope(report,which,includeGeneratedPath){
  assert(report.component===spec,which+': wrong component');
  assert(report.status==='integration-verified'&&report.passed===true,
    which+': verification not fully passed');
  assert(report.entry===expectedEntry,which+': incorrect app entry');
  assert(Array.isArray(report.selectedTests) &&
    report.selectedTests.length===1&&report.selectedTests[0]===expectedTest,
    which+': incorrect selected application test scope');
  assert(report.certification?.validated===true &&
    typeof report.certification.certifiedSourceHash==='string' &&
    /^[0-9a-f]{64}$/i.test(report.certification.certifiedSourceHash),
    which+': invalid certification provenance');
  assert(Array.isArray(report.installedFiles) && report.installedFiles.length===4 &&
    report.installedFiles.every(f=>typeof f.path==='string'&&
      f.path.startsWith('src/silkweb/')&&/^[0-9a-f]{64}$/i.test(f.sha256)),
    which+': four installed certified files not recorded');
  assert(Array.isArray(report.checks)&&report.checks.length===expectedIds.length &&
    expectedIds.every(id=>report.checks.some(c=>c.id===id&&c.passed===true)),
    which+': some required Phase 3 check is missing or failed');
  assert(report.reachability?.reachable===true &&
    report.reachability?.traversalLimitReached===false &&
    report.reachability?.matchedCertifiedSources?.includes('src/silkweb/reservationKernelV2.ts'),
    which+': app entry did not reach trusted kernel');
  const test=report.checks.find(c=>c.id==='selected_application_tests');
  assert(test?.completedRealTests===true &&
    Number.isSafeInteger(test.testCounts?.tests)&&test.testCounts.tests>0 &&
    test.testCounts.pass>0&&test.testCounts.fail===0&&test.testCounts.cancelled===0 &&
    test.exitCode===0,which+': selected application tests not actually executed/passed');
  assert(typeof report.verifiedAt==='string'&&!Number.isNaN(Date.parse(report.verifiedAt)),
    which+': missing event time');
  if(includeGeneratedPath)assert(typeof report.verificationReportPath==='string',
    which+': target evidence path absent');
}
function main(){
  assert(!existsSync(correctionPath),'A reconciliation exists; never overwrite');
  const meta=json(metaPath).data;
  const run=json(runnerPath).data;
  const original=json(originalPath).data;
  const cli=json(stdoutPath);
  assert(meta.trial==='SILKWEB-DEMO-001'&&resolve(meta.sourceRepo)===repo,
    'Wrong original demo source checkout');
  assert(resolve(meta.root)===root && resolve(meta.candidate)===join(root,'candidate'),
    'Original candidate path mismatch');
  assert(run.trial==='SILKWEB-DEMO-001'&&run.stage==='evaluated' &&
    run.museExitCode===0 && run.buildExitCode===0 && run.phase3ExitCode===0,
    'Muse, build, evaluator, or Phase 3 command not recorded as completed successfully');
  assert(original.trial==='SILKWEB-DEMO-001'&&original.success===false &&
    original.checksPassed===18&&original.checksTotal===19,
    'Original evaluation was not the exact preserved 18/19 result');
  assert(Array.isArray(original.checks)&&original.checks.length===19 &&
    original.checks.filter(c=>c.passed!==true).length===1 &&
    original.checks.find(c=>c.passed!==true)?.id==='phase3_integration',
    'Original evaluation has additional failures; cannot reconcile');
  assert(original.checks.every(c=>c.id==='phase3_integration'||c.passed===true),
    'Original independent HTTP/source checks are not all passing');
  const phase3=cli.data;
  checkScope(phase3,'CLI Phase 3 evidence',true);
  assert(resolve(phase3.projectRoot)===resolve(meta.candidate),
    'CLI Phase 3 project differs from trial candidate');
  const evidencePath=checkedRelative(meta.candidate,phase3.verificationReportPath);
  const saved=json(evidencePath);
  checkScope(saved.data,'Immutable target-side Phase 3 report',false);
  assert(saved.data.verificationReportPath===undefined,
    'Target-side report unexpectedly modified after initial write');
  for(const field of ['component','status','entry','verifiedAt','passed']){
    assert(JSON.stringify(saved.data[field])===JSON.stringify(phase3[field]),
      'CLI and immutable target-side reports disagree: '+field);
  }
  assert(JSON.stringify(saved.data.checks)===JSON.stringify(phase3.checks),
    'CLI and target-side report disagree on actual check results');
  assert(JSON.stringify(saved.data.certification)===JSON.stringify(phase3.certification),
    'CLI and target-side certification provenance disagree');
  assert(JSON.stringify(saved.data.installedFiles)===JSON.stringify(phase3.installedFiles),
    'CLI and target-side installed source hashes disagree');
  assert(JSON.stringify(saved.data.selectedTests)===JSON.stringify(phase3.selectedTests),
    'CLI and target-side test scope disagree');

  // The original evaluator is left untouched. This supplement records
  // the complete proof and exact input digests instead of relabeling history.
  const result={
    schemaVersion:1,
    trial:'SILKWEB-DEMO-001',
    classification:'OFFLINE_RECONCILED_PHASE3_REPORT_DECODING',
    isOriginalEvaluation:false,
    isNewMuseRun:false,
    paidModelCalls:0,
    originalEvaluation:{
      sha256:sha(originalPath),checksPassed:original.checksPassed,
      checksTotal:original.checksTotal,success:false,
      preserved:true,
    },
    sourceEvidence:{
      museRunSha256:sha(runnerPath),
      cliOutputSha256:sha(stdoutPath),
      cliOutputEncoding:cli.encoding,
      immutableVerificationSha256:sha(evidencePath),
      immutableVerificationRelPath:phase3.verificationReportPath,
      component:spec,
      status:phase3.status,
      verifiedAt:phase3.verifiedAt,
      testCounts:phase3.checks.find(c=>c.id==='selected_application_tests')?.testCounts,
    },
    correctedIssue:'Original Node evaluator read PowerShell-redirected Phase 3 JSON as UTF-8; this supplement decoded and cross-checked both primary reports without rerunning any test.',
    reconciledChecksPassed:19,reconciledChecksTotal:19,
    success:true,
    limitation:'One guided Muse demonstration; original evaluation 18/19 is preserved. Reconciliation changes only report interpretation, not application source, tests or Muse inference.',
    createdAt:new Date().toISOString(),
  };
  writeFileSync(correctionPath,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({
    trial:result.trial,classification:result.classification,
    original:'18/19 (preserved)',reconciled:'19/19 (validated against original Phase 3 evidence)',
    cliEncoding:cli.encoding,phase3Status:phase3.status,
    paidModelCalls:0,
    reconciliationPath:correctionPath,
  },null,2)+'\n');
}
try{main();}
catch(error){
  process.stderr.write((error instanceof Error?error.message:String(error))+'\n');
  process.exitCode=1;
}
