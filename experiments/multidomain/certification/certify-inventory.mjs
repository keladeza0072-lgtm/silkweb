#!/usr/bin/env node
/**
 * SW-MULTI-001: one operator-authorized, ZERO-MODEL certification operation.
 * Rebuilds and tests inventory plus ALL five original components on this NEW
 * expansion branch. Preserves original frozen tag; no model calls, no retries.
 *
 * Source provenance: original inventory candidate byte-for-byte.
 * Certification: only real registry-owned executable tests and new evidence.
 * On ANY error, restore previous branch evidence and unverified manifest.
 */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const operator=join(homedir(),'Projects','silkweb-multidomain-20261030','operator');
const candidate=join(homedir(),'Projects','silkweb-multidomain-20261030','inventory');
const inputReport=join(operator,'evaluation-inventory-v2.json');
const originalReport=join(operator,'evaluation-inventory.json');
const originalPreflight=join(operator,'preflight.json');
const originalRun=join(operator,'run-inventory.json');
const outputReport=join(operator,'certification-inventory-0.1.0.json');
const manifestPath=join(repo,'registry-data/manifests/inventory-reservation-0.1.0.json');
const error=m=>{throw new Error('CERTIFICATION REFUSED: '+m)};
const assert=(ok,m)=>{if(!ok)error(m)};
const read=path=>{
  assert(existsSync(path),'Missing file '+path);
  const stat=lstatSync(path);
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<4*1024*1024,'Invalid file '+path);
  return readFileSync(path);
};
const sha=path=>createHash('sha256').update(read(path)).digest('hex');
const json=path=>JSON.parse(read(path).toString('utf8').replace(/^\uFEFF/,''));
function git(...args){
  const child=spawnSync('git',['-C',repo,...args],{encoding:'utf8',timeout:10000,windowsHide:true});
  assert(child.status===0,'Git failed: '+args.join(' '));
  return child.stdout.trim();
}
const components=[
  ['booking-schema','0.1.0','registry:booking-tests'],
  ['booking-validation','0.1.0','registry:booking-tests'],
  ['booking-slot-guard','0.1.0','registry:booking-tests'],
  ['booking-reservation-kernel','0.2.0','registry:reservation-v2-tests'],
  ['registry-loader','0.1.0','registry:loader-tests'],
  ['inventory-reservation','0.1.0','registry:inventory-tests'],
];
function main(){
  assert(process.argv.length===2,'No args accepted; run in inventory certification checkout');
  assert(Number(process.versions.node.split('.')[0])>=24,'Node.js >=24 required');
  assert(git('branch','--show-current')==='feature/multidomain-inventory-certification',
    'Must use exact new certification branch; never use frozen worktree');
  assert(git('status','--porcelain')==='','Checkout must be clean before certification');
  assert(!existsSync(outputReport),'Prior certification report exists; no overwrite');
  const originalMeta=json(originalPreflight);
  const run=json(originalRun);
  const first=json(originalReport);
  const corrected=json(inputReport);
  assert(originalMeta.suite==='SW-MULTI-001'&&run.suite==='SW-MULTI-001'&&
    run.task==='inventory'&&run.museExitCode===0&&run.buildExitCode===0,
    'Wrong original Muse source provenance');
  assert(first.checksPassed===10&&first.checksTotal===11&&first.success===false,
    'Original 10/11 report missing or altered');
  assert(corrected.classification==='OFFLINE_CORRECTED_HELDOUT_INV07_V2_NOT_A_NEW_MUSE_RUN' &&
    corrected.corrected?.success===true &&
    corrected.corrected?.checksPassed===11 &&
    corrected.corrected?.checksTotal===11 &&
    corrected.paidModelCalls===0 &&
    corrected.original?.reportSha256===sha(originalReport),
    'Original and contract-corrected reports do not match');
  assert(corrected.corrected.compiledSourceSha256===
    sha(join(candidate,'dist/inventory.js')),
    'Corrected evaluation compiled source has changed');
  assert(sha(join(candidate,'src/inventory.ts'))===
    sha(join(repo,'packages/registry/src/inventory.ts')),
    'Registry source must match original Muse candidate BYTE-FOR-BYTE');

  const manifestsDir=join(repo,'registry-data/manifests');
  const evidenceDir=join(repo,'registry-data/evidence');
  const apiPath=join(repo,'packages/registry/dist/index.js');
  const runnerBuild=join(repo,'packages/registry/dist/runner.js');
  assert(existsSync(apiPath)&&existsSync(runnerBuild),
    'First build the registry: cd packages/registry; npm.cmd ci; npm.cmd run build');
  const inventoryManifest=json(manifestPath);
  assert(inventoryManifest.id==='inventory-reservation'&&
    inventoryManifest.version==='0.1.0'&&
    inventoryManifest.verification.status==='unverified'&&
    !inventoryManifest.verification.sourceHash,
    'Inventory must start as an unverified candidate');
  const intended=components.map(([id,version])=>id+'@'+version).sort();
  const evidencePaths=components.map(([id,version])=>join(evidenceDir,id+'-'+version+'.json'));
  const backups=new Map([[manifestPath,read(manifestPath)]]);
  for(const p of evidencePaths)backups.set(p,existsSync(p)?read(p):null);
  let mutationsStarted=false;
  let success=false;
  try{
    // API is the built registry's real verifier. It cannot be supplied fake
    // evidence or a model-written test; it uses fixed command allowlists.
    const {runVerification,loadRegistry,validateComponent,
      computeArtifactFingerprint,TEST_COMMAND_ALLOWLIST}=await import(pathToFileURL(apiPath).href);
    const all=loadRegistry(manifestsDir);
    const actual=all.map(m=>m.id+'@'+m.version).sort();
    assert(JSON.stringify(actual)===JSON.stringify(intended),
      'Unexpected manifest set; refuse surprise components');
    const byKey=new Map(all.map(m=>[m.id+'@'+m.version,m]));
    for(const [id,version,commandKey] of components){
      const m=byKey.get(id+'@'+version);
      assert(!!m,'Missing component '+id);
      assert(TEST_COMMAND_ALLOWLIST[commandKey],
        'Compiled runner is missing certification command '+commandKey);
      if(id!=='inventory-reservation'){
        assert(m.verification.status==='verified',
          'Preexisting certified component downgraded: '+id);
      }
    }
    mutationsStarted=true;
    for(const [id,version,commandKey] of components){
      const m=byKey.get(id+'@'+version);
      process.stdout.write('RUN: fresh build + allowlisted tests for '+id+'@'+version+'\n');
      const result=runVerification(repo,m,all,{
        commandKey,evidenceDir:'registry-data/evidence',timeoutMs:120000,
      });
      assert(result.passed&&result.evidence.exitCode===0&&
        result.evidence.outcome==='pass',
        'Executed certification failed for '+id+'@'+version);
      const validated=validateComponent(repo,m,all,{evidenceDir:'registry-data/evidence'});
      assert(validated.valid&&validated.code==='OK',
        'Evidence validation rejected '+id+': '+validated.code+' '+validated.reason);
      process.stdout.write('PASS: '+id+' (new source+tests+compiled artifacts verified)\n');
    }
    const inventory=byKey.get('inventory-reservation@0.1.0');
    const fp=computeArtifactFingerprint(repo,inventory,all);
    const verified={
      ...inventory,verification:{
        status:'verified',
        testCommand:TEST_COMMAND_ALLOWLIST['registry:inventory-tests'].command,
        sourceHash:fp.sections.sources,
        evidence:'registry-data/evidence/inventory-reservation-0.1.0.json',
      },
    };
    writeFileSync(manifestPath,JSON.stringify(verified,null,2)+'\n');
    const final=loadRegistry(manifestsDir);
    assert(final.length===6,'Unexpected registry count after certification');
    const validations=final.map(m=>({
      id:m.id,version:m.version,claimedStatus:m.verification.status,
      result:validateComponent(repo,m,final,{evidenceDir:'registry-data/evidence'}),
    }));
    assert(validations.every(v=>v.claimedStatus==='verified'&&v.result.valid&&v.result.code==='OK'),
      'One or more registry certifications invalid after inventory promotion');
    const summary={
      schemaVersion:1,suite:'SW-MULTI-001',classification:'BRANCH_LOCAL_EXECUTED_CERTIFICATION',
      originalCandidate:'Muse Spark 1.3/high; 246.132 s authoring',
      originalAcceptance:'10/11 (preserved; defective INV07 zero-stock expectation)',
      correctedAcceptance:'11/11 (contract-aligned; original compiled candidate)',
      newlyCertified:'inventory-reservation@0.1.0',
      allCertified:validations.map(({id,version})=>id+'@'+version),
      originalFiveReverified:true,
      sourceSha256:sha(join(repo,'packages/registry/src/inventory.ts')),
      storedEvidence:components.map(([id,version])=>({
        id:id+'@'+version,evidenceSha256:sha(join(evidenceDir,id+'-'+version+'.json')),
      })),
      modelCalls:0,
      limitations:[
        'Only the SIX current registry components were reverified on this branch.',
        'Does not imply any matched with/without-Silk-Web cost or speed result.',
        'Each evidence record stores actual Node/SQLite versions and executed build hashes.',
        'The original frozen release retains historical evidence; branch has new evidence.',
      ],
      createdAt:new Date().toISOString(),
    };
    writeFileSync(outputReport,JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
    success=true;
    process.stdout.write(JSON.stringify({
      success:true,certified:6,inventory:'inventory-reservation@0.1.0',
      originalFiveReverified:true,modelCalls:0,report:outputReport,
    },null,2)+'\n');
  }finally{
    if(mutationsStarted&&!success){
      for(const [p,data] of backups){
        try{if(data===null){if(existsSync(p))unlinkSync(p);}
          else writeFileSync(p,data);}catch(e){process.stderr.write(
            'ROLLBACK PROBLEM '+p+': '+String(e)+'\n');}
      }
      process.stderr.write('REFUSED: original branch evidence and unverified inventory manifest restored.\n');
    }
  }
}
try{await main();}catch(e){
  process.stderr.write(String(e?.stack??e)+'\n');
  process.exitCode=1;
}
