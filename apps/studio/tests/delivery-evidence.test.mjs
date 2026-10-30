import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,test} from 'node:test';
import {readDeliveryEvidence} from '../dist/deliveryEvidence.js';
import {collectEvidence} from '../dist/evidence.js';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const original=join(repo,'packages/registry/src/inventory.ts');
const sourceSha='3bc564618668ccfccebccff9cd8507ced3e8b445f09708fd12d8c2b11126bcf0';
assert.equal(createHash('sha256').update(readFileSync(original)).digest('hex'),sourceSha);
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const roots=[];
afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'silkweb-delivery-evidence-'));
  roots.push(root);
  return root;
}
function save(root,rel,value){
  const path=join(root,rel);mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
  return path;
}
function goodEvidence(root){
  const base='inv-install-002-20261030/';
  const op=base+'operator/';
  const task='f86034b61e0d496527b180953adc2c4266eeb0e1fa05939d75733e2fdff84603';
  const evaluator='b2fb7bf24638914dac2ac8a7999b40ecfde37bd51d55506874290fe7047e403b';
  const preflight={
    benchmark:'INV-INSTALL-002',taskSha256:task,evaluatorSha256:evaluator,
    certifiedSourceSha256:sourceSha,
  };
  save(root,op+'preflight.json',preflight);
  const rawUsage={available:true,inputTokens:2606576,cachedTokens:2518139,
    uncachedTokens:88437,outputTokens:42136,reasoningTokens:19852};
  const newUsage={available:true,inputTokens:2160970,cachedTokens:2082246,
    uncachedTokens:78724,outputTokens:34585,reasoningTokens:13283};
  const runs={},evaluations={};
  for(const kind of ['R','I']){
    const isI=kind==='I';
    const run={
      benchmark:'INV-INSTALL-002',condition:kind,stage:'evaluated',
      mcpEnabled:true,deterministicInstallEnabled:isI,
      model:'muse-spark-1.3',reasoningEffort:'high',maxModelSteps:55,
      taskSha256:task,evaluatorSha256:evaluator,
      museExitCode:0,buildExitCode:0,evaluatorExitCode:0,
      codingSeconds:isI?332.718:377.441,
      quality:100,passedChecks:20,initialCommit:'same',
      sourceCommit:'same-source',
    };
    const evaluation={
      benchmark:'INV-BENCH-001',success:true,passedChecks:20,
      expectedChecks:20,score:100,evaluatorSha256:evaluator,
    };
    runs[kind]=run;evaluations[kind]=evaluation;
    save(root,op+'run-'+kind+'.json',run);
    save(root,op+'evaluation-'+kind+'.json',evaluation);
    const third=isI?{
      tool:'install_verified_component',status:'success',
      component:'inventory-reservation@0.1.0',installStatus:'installed-source',
      files:[{path:'src/silkweb/inventory.ts',sha256:sourceSha,truncated:false}],
    }:{
      tool:'get_verified_component_source',status:'success',
      component:'inventory-reservation@0.1.0',truncated:false,
      files:[{path:'packages/registry/src/inventory.ts',sha256:sourceSha,truncated:false}],
    };
    const audit=[
      {tool:'search_verified_components',status:'success',timestamp:'2026-10-30T13:00:00Z',query:'PRIVATE-PROMPT'},
      {tool:'inspect_verified_component',status:'success',timestamp:'2026-10-30T13:00:01Z',
        component:'inventory-reservation@0.1.0'},
      {...third,timestamp:'2026-10-30T13:00:02Z'},
    ];
    save(root,op+'mcp-audit-'+kind+'.jsonl',audit.map(x=>JSON.stringify(x)).join('\n')+'\n');
    save(root,op+'muse-'+kind+'.jsonl',JSON.stringify({private:'PRIVATE-MUSE-SESSION'})+'\n');
  }
  const sourceFile=join(root,base,'I/src/silkweb/inventory.ts');
  mkdirSync(dirname(sourceFile),{recursive:true});
  copyFileSync(original,sourceFile);
  save(root,base+'I/.silkweb/installations/inventory-reservation@0.1.0.json',{
    status:'installed-source',component:'inventory-reservation@0.1.0',
    files:[{destination:'src/silkweb/inventory.ts',sha256:sourceSha}],
  });
  const analysis={
    benchmark:'INV-INSTALL-002',matchedConditions:true,
    originalInventorySourcePresentAndUnchanged:true,
    R:{codingSeconds:runs.R.codingSeconds,quality:{score:100,passedChecks:20},
      usage:rawUsage,reuseEvidence:{
        fullSourceRetrieved:true,exactCertifiedBytes:false,
        applicationStaticImport:true,
      }},
    I:{codingSeconds:runs.I.codingSeconds,quality:{score:100,passedChecks:20},
      usage:newUsage,reuseEvidence:{
        deliveryProven:true,installerSucceeded:true,exactCertifiedBytes:true,
        installationAuditExactBytes:true,applicationStaticImport:true,
        sourceSha256:sourceSha,
      }},
  };
  const originalEvidenceSha256={};
  for(const name of ['preflight.json','run-R.json','run-I.json',
    'evaluation-R.json','evaluation-I.json','mcp-audit-R.jsonl','mcp-audit-I.jsonl',
    'muse-R.jsonl','muse-I.jsonl']){
    originalEvidenceSha256[name]=digest(join(root,op,name));
  }
  const snapshot={
    benchmark:'INV-INSTALL-002',classification:'OBSERVED_SINGLE_PAIR',
    originalEvidenceSha256,
    creditObservations:{R:{before:121.28,after:120.63,decrease:0.65},
      I:{before:120.62,after:120.07,decrease:0.55}},
    analysis,
  };
  save(root,op+'INV-INSTALL-002-final-evidence.json',snapshot);
  return {root,base,op};
}
test('missing snapshot means no invented performance claims, sessions or MCP audit events',()=>{
  const root=fixture();
  const proof=readDeliveryEvidence(root);
  assert.equal(proof.available,false);
  const dashboard=collectEvidence({projectsRoot:root});
  assert.equal(dashboard.deliveryComparison.available,false);
  assert(!dashboard.activity.sessions.some(s=>s.id.startsWith('INV-INSTALL-002')));
});
test('valid source, original evidence digests and snapshots produce sanitized matching metrics',()=>{
  const {root}=goodEvidence(fixture());
  const proof=readDeliveryEvidence(root);
  assert.equal(proof.available,true,proof.reason);
  assert.equal(proof.quality.R,100);
  assert.equal(proof.quality.I,100);
  assert.equal(proof.coding.reductionPercent,11.85);
  assert.equal(proof.input.reductionPercent,17.1);
  assert.equal(proof.sourceIntegrity.I,true);
  assert.equal(proof.credits.I,0.55);
  const dashboard=collectEvidence({projectsRoot:root});
  assert.equal(dashboard.deliveryComparison.available,true);
  assert.equal(dashboard.activity.sessions.filter(s=>s.id.startsWith('INV-INSTALL-002')).length,2);
  assert.equal(dashboard.activity.events.filter(e=>e.origin.includes('INV-INSTALL-002')).length,6);
  assert(!JSON.stringify(dashboard).includes('PRIVATE-PROMPT'));
  assert(!JSON.stringify(dashboard).includes('PRIVATE-MUSE-SESSION'));
});
test('tampered original evidence forces unavailable state, never a green badge',()=>{
  const {root,op}=goodEvidence(fixture());
  const path=join(root,op,'evaluation-I.json');
  writeFileSync(path,JSON.stringify({score:100,passedChecks:20})+'\n');
  const proof=readDeliveryEvidence(root);
  assert.equal(proof.available,false);
  assert.match(proof.reason,/changed|missing/);
  const output=collectEvidence({projectsRoot:root});
  assert.equal(output.deliveryComparison.available,false);
  assert(!output.activity.events.some(e=>e.origin.includes('INV-INSTALL-002')));
});
test('certified target byte mutation invalidates delivery claim even with original snapshot present',()=>{
  const {root,base}=goodEvidence(fixture());
  const target=join(root,base,'I/src/silkweb/inventory.ts');
  writeFileSync(target,'// tampered\n');
  const proof=readDeliveryEvidence(root);
  assert.equal(proof.available,false);
  assert.match(proof.reason,/Installed certified bytes/);
});
test('forged source operation audit invalidates proof even when snapshot hashes are updated',()=>{
  const {root,op}=goodEvidence(fixture());
  const file=join(root,op,'mcp-audit-I.jsonl');
  const log=readFileSync(file,'utf8').replace(/install_verified_component/g,'get_verified_component_source');
  writeFileSync(file,log);
  const snapshotPath=join(root,op,'INV-INSTALL-002-final-evidence.json');
  const snap=JSON.parse(readFileSync(snapshotPath,'utf8'));
  snap.originalEvidenceSha256['mcp-audit-I.jsonl']=digest(file);
  writeFileSync(snapshotPath,JSON.stringify(snap,null,2)+'\n');
  const proof=readDeliveryEvidence(root);
  assert.equal(proof.available,false);
  assert.match(proof.reason,/audit/);
});
