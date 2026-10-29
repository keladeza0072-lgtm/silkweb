import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, openSync, writeFileSync, closeSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { InstallError, planInstall } from './install.mjs';

/**
 * Phase 3. Deterministic, local verification of a previously installed
 * certified component in a target application. The registry and its
 * certification evidence are read-only. Only explicitly requested local
 * compiler and test executables are invoked, without a shell.
 *
 * Assurance levels deliberately differ:
 * - certified source + exact installation audit (registry provenance)
 * - successful compilation in the target project (build compatibility)
 * - reachable import from a named app entry (static integration)
 * - selected application-level tests actually passed (bounded behavior)
 *
 * An unspecified or unexecuted test NEVER earns an integration-verified claim.
 */
const BAD = new Set(['.git','.silkweb','node_modules','experiments']);
const now = () => new Date().toISOString();

function checkedRelative(projectRoot, raw, kind, {allowNodeModules=false,allowInternalAudit=false}={}) {
  if (typeof raw !== 'string' || !raw || raw.includes('\0') || isAbsolute(raw)) {
    throw new InstallError('UNSAFE_PATH', 'Invalid '+kind+': '+JSON.stringify(raw));
  }
  const rel = raw.replace(/\\/g,'/');
  const parts = rel.split('/');
  if (/^[A-Za-z]:/.test(rel) || parts.some(part=>!part||part==='.'||part==='..') ||
      parts.some(part=>BAD.has(part) && !(allowNodeModules && part==='node_modules') &&
        !(allowInternalAudit && part==='.silkweb'))) {
    throw new InstallError('UNSAFE_PATH', 'Unsafe '+kind+': '+JSON.stringify(raw));
  }
  const root = resolve(projectRoot);
  const absolute = resolve(root,...parts);
  if (!absolute.startsWith(root+sep)) {
    throw new InstallError('UNSAFE_PATH', 'Path escapes project: '+JSON.stringify(raw));
  }
  let cursor = root;
  for (const segment of parts) {
    cursor=join(cursor,segment);
    let stat;
    try { stat=lstatSync(cursor); }
    catch(error) {
      if(error?.code==='ENOENT') break;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new InstallError('SYMLINK_REJECTED', 'Refusing link/junction in '+kind+': '+raw);
    }
  }
  return { rel, absolute };
}

function requiredFile(projectRoot, path, kind) {
  const inspected = checkedRelative(projectRoot,path,kind);
  let stat;
  try {stat=lstatSync(inspected.absolute);}
  catch(error) {
    if(error?.code==='ENOENT') throw new InstallError('MISSING_'+kind.toUpperCase().replace(/\W/g,'_'),kind+' not found: '+path);
    throw error;
  }
  if(!stat.isFile() || stat.isSymbolicLink()){
    throw new InstallError('INVALID_FILE',kind+' must be a regular file: '+path);
  }
  return inspected;
}

function localCompiler(projectRoot) {
  // The local TS compiler is selected by a fixed executable path. No npm
  // scripts, shell interpolation, package.json commands, or registry commands.
  const path = join(projectRoot,'node_modules/typescript/bin/tsc');
  const statPath = checkedRelative(projectRoot,'node_modules/typescript/bin/tsc',
    'compiler',{allowNodeModules:true});
  let stat;
  try {stat=lstatSync(path);} catch(error){
    if(error?.code==='ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new InstallError('INVALID_COMPILER','Local TypeScript compiler must be a regular file');
  return statPath.absolute;
}

function outcome(kind, proc) {
  const successful=proc.status===0 && !proc.error;
  return {
    id:kind,
    passed:successful,
    exitCode:proc.status,
    timedOut:proc.error?.code==='ETIMEDOUT',
    stdout:String(proc.stdout??'').slice(-1000),
    stderr:String(proc.stderr??'').slice(-1000),
    error:proc.error ? String(proc.error.message).slice(0,300) : undefined,
  };
}

/** Resolve only local static ESM import edges; no evaluation or file execution. */
function importReachability(projectRoot, entryRel, targetPaths) {
  const root=resolve(projectRoot);
  const start=requiredFile(root,entryRel,'entry');
  if (!start.rel.startsWith('src/') || !/\.(?:ts|mts)$/.test(start.rel)) {
    throw new InstallError('UNSAFE_ENTRY','Entry must be a project src/*.ts or src/*.mts file');
  }
  const pending=[start.rel];
  const visited=new Set();
  const targets=new Set(targetPaths);
  let directHits=0;
  while(pending.length && visited.size<250) {
    const rel=pending.shift();
    if(visited.has(rel))continue;
    visited.add(rel);
    if(targets.has(rel)) {directHits++; continue;}
    const f=requiredFile(root,rel,'imported source');
    const source=readFileSync(f.absolute,'utf8');
    const regex=/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.[^'"]+)['"]/g;
    for(const match of source.matchAll(regex)) {
      const spec=match[1];
      const rootTarget=resolve(dirname(f.absolute),spec);
      const candidate=extname(rootTarget)==='.js'
        ? rootTarget.slice(0,-3)+'.ts' : rootTarget;
      const relToRoot=relative(root,candidate).replace(/\\/g,'/');
      if(!relToRoot.startsWith('src/')||!candidate.startsWith(root+sep))continue;
      if(!/\.ts$/.test(relToRoot))continue;
      const inspected=checkedRelative(root,relToRoot,'imported source');
      if(existsSync(inspected.absolute)) pending.push(inspected.rel);
    }
  }
  return {
    entry:start.rel,
    reachable:directHits>0,
    matchedCertifiedSources:[...visited].filter(path=>targets.has(path)).sort(),
    traversedModules:visited.size,
    traversalLimitReached:pending.length>0,
  };
}

function buildReport({projectRoot,spec,plan,entry,tests}) {
  return {
    schemaVersion:1,
    component:spec,
    projectRoot,
    status:'preflight-passed',
    certification:{
      validated:true,
      fingerprint:plan.report.registryFingerprint,
      certifiedSourceHash:plan.report.certifiedSourceHash,
      evidence:plan.report.certificationEvidence,
    },
    installedFiles:plan.report.files.map(f=>({
      path:f.destination,sha256:f.sha256,bytes:f.bytes,
    })),
    checks:[{
      id:'certification_and_installed_source_integrity',
      passed:true,
      detail:'Registry evidence, closure, local installation record and every installed source byte were revalidated.',
    }],
    entry:entry??null,
    selectedTests:tests,
    assurance:'Certified source installed; target build and selected application behavior require separate successful checks.',
    verifiedAt:now(),
  };
}

function recordResult(projectRoot,result) {
  const relDir='.silkweb/validations';
  const base=checkedRelative(projectRoot,relDir,'verification record parent',{allowInternalAudit:true});
  const reportRel=relDir+'/'+randomUUID()+'.json';
  const file=checkedRelative(projectRoot,reportRel,'verification record',{allowInternalAudit:true});
  if(!existsSync(base.absolute)) mkdirSync(base.absolute,{recursive:true});
  // Exclusive creation: never overwrite existing evidence. The operator's
  // explicitly selected target is the only place this command writes reports.
  const data=Buffer.from(JSON.stringify(result,null,2)+'\n');
  const fd=openSync(file.absolute,'wx',0o644);
  try{writeFileSync(fd,data);}finally{closeSync(fd);}
  return reportRel;
}

export function verifyIntegration({
  repoRoot, projectRoot, spec, into='src/silkweb', lib,
  entry, tests=[], saveReport=true, timeoutMs=45000,
}) {
  repoRoot=resolve(repoRoot);
  projectRoot=resolve(projectRoot);
  if (!Array.isArray(tests) || tests.length>16) {
    throw new InstallError('INVALID_TEST_SCOPE','At most 16 selected test files are allowed');
  }
  if (!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000) {
    throw new InstallError('INVALID_TIMEOUT','Timeout must be between 1000 and 120000 milliseconds');
  }
  // The existing installer trust gate enforces every certificate in the
  // closure, source fingerprint, target package dependencies, exact on-disk
  // file hashes, symlink safety and an unchanged installation audit record.
  const plan=planInstall({repoRoot,projectRoot,spec,into,lib});
  if(!plan.reportExists || plan.files.some(f=>f.action!=='unchanged')) {
    throw new InstallError('NOT_INSTALLED','A matching certified installation report and every source file are required');
  }
  const selectedTests=tests.map(t=>{
    const file=requiredFile(projectRoot,t,'test');
    if(!/^(?:tests|test)\/.+\.test\.(?:mjs|cjs|js)$/.test(file.rel)) {
      throw new InstallError('UNSAFE_TEST','Only explicitly named tests/*.test.{js,mjs,cjs} files are permitted');
    }
    return file;
  });
  const duplicate=new Set(selectedTests.map(t=>t.rel));
  if(duplicate.size!==selectedTests.length)throw new InstallError('DUPLICATE_TEST','Duplicate test path');
  const result=buildReport({
    projectRoot,spec,plan,entry,
    tests:selectedTests.map(t=>t.rel),
  });
  if(entry!==undefined){
    const reach=importReachability(projectRoot,entry,plan.files.map(f=>f.destination));
    result.reachability=reach;
    result.checks.push({
      id:'application_entry_reaches_installed_source',
      passed:reach.reachable&&!reach.traversalLimitReached,
      detail:reach.reachable
        ? 'Static import graph reaches '+reach.matchedCertifiedSources.join(', ')
        : 'No verified source file reachable from named application entry.',
    });
  }
  const tsc=localCompiler(projectRoot);
  if(!tsc){
    result.checks.push({id:'target_build',passed:false,detail:'Local TypeScript compiler missing. Run npm ci in target.'});
  }else{
    const run=spawnSync(process.execPath,[tsc,'-p','tsconfig.json'],{
      cwd:projectRoot,encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024,
      shell:false,windowsHide:true,
    });
    result.checks.push({...outcome('target_build',run),command:'node node_modules/typescript/bin/tsc -p tsconfig.json'});
  }
  const buildPass=result.checks.find(c=>c.id==='target_build')?.passed===true;
  const entryPass=entry===undefined || result.checks.find(c=>c.id==='application_entry_reaches_installed_source')?.passed===true;
  if(buildPass&&entryPass&&selectedTests.length){
    // Recheck test files/parents after build; operator-selected code executes
    // only here, never from component manifest or installation report.
    for(const test of selectedTests)requiredFile(projectRoot,test.rel,'test');
    const run=spawnSync(process.execPath,['--test',...selectedTests.map(t=>t.absolute)],{
      cwd:projectRoot,encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024,
      shell:false,windowsHide:true,
    });
    result.checks.push({...outcome('selected_application_tests',run),
      command:'node --test '+selectedTests.map(t=>t.rel).join(' ')});
  } else if(selectedTests.length){
    result.checks.push({id:'selected_application_tests',passed:false,skipped:true,
      detail:'Skipped because target build or declared entry reachability failed.'});
  }
  result.passed=result.checks.every(c=>c.passed===true);
  if(!result.passed){
    result.status='verification-failed';
    result.assurance='Target build, static integration reachability, or selected application tests FAILED; no integration assertion.';
  }else if(entry!==undefined&&selectedTests.length){
    result.status='integration-verified';
    result.assurance='Certification and installed bytes confirmed; target TypeScript build passed; named entry statically reaches installed source; explicitly selected application tests passed. Test quality and production behavior are NOT certified.';
  }else if(selectedTests.length){
    result.status='selected-tests-passed';
    result.assurance='Certified source and target build passed with selected tests, but no application-entry import reachability was supplied; complete integration NOT asserted.';
  }else if(entry!==undefined){
    result.status='build-and-entry-verified';
    result.assurance='Certified source, build and static import reachability passed; no application behavioral tests executed.';
  }else{
    result.status='build-only';
    result.assurance='Certified source and target TypeScript build passed; application behavior and import reachability NOT verified.';
  }
  if(saveReport)result.verificationReportPath=recordResult(projectRoot,result);
  return result;
}
