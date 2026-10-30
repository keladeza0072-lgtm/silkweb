import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectEvidence } from '../dist/evidence.js';

const roots=[];
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'silkweb-studio-v2-'));
  roots.push(root);
  return root;
}
function save(root,path,body){
  const dest=join(root,path);
  mkdirSync(dirname(dest),{recursive:true});
  writeFileSync(dest, typeof body==='string'?body:JSON.stringify(body),'utf8');
}
after(()=>roots.forEach(root=>rmSync(root,{recursive:true,force:true})));

test('missing operator evidence is unavailable, never a fabricated success',()=>{
  const root=fixture();
  const view=collectEvidence({projectsRoot:root});
  assert.equal(view.performance.available,false);
  assert.equal(view.installation,null);
  assert.equal(view.activity.events.length,0);
  assert(view.activity.sessions.every(s=>s.available===false));
});

test('paired RES-002 evidence yields computed quality, time and token differences',()=>{
  const root=fixture();
  const folder='res002-fair-20261029/operator/';
  for(const [side,time,quality] of [['B',410,98.5],['C',347,100]]){
    save(root,folder+'run-'+side+'.json',{
      benchmark:'RES-002',condition:side,mcpEnabled:side==='C',
      stage:'evaluated',museExitCode:0,model:'muse-spark-1.3',reasoningEffort:'high',
      sourceCommit:'c'.repeat(40),evaluatorSha256:'d'.repeat(64),
      taskPromptSha256:'a'.repeat(64),startingGitCommit:'b'.repeat(40),
      codingSeconds:time,weightedScore:quality,
      passedChecks:side==='B'?40:41,totalChecks:41,
    });
  }
  const mkUsage=(input,cached,output)=>JSON.stringify({payload:{models:[{
    input_tokens:input,cached_tokens:cached,output_tokens:output,reasoning_tokens:10,
  }]}})+'\n';
  save(root,folder+'run-B.jsonl',mkUsage(1000,200,300));
  save(root,folder+'run-C.jsonl',mkUsage(750,350,200));
  const result=collectEvidence({projectsRoot:root});
  const p=result.performance;
  assert.equal(p.available,true);
  assert.equal(p.control.quality,98.5);
  assert.equal(p.treatment.quality,100);
  assert.equal(p.deltas.qualityPoints,1.5);
  assert.equal(p.deltas.uncachedInputReductionPercent,50);
  assert.equal(p.deltas.outputReductionPercent,33.33);
  assert.equal(p.deltas.codingTimeReductionPercent,15.37);
  assert.equal(p.control.usage.directlyReportedCostUsd,null,
    'No billing cost should be invented from token counts');
});

test('nonmatching B/C task or incomplete score prevents comparison',()=>{
  const root=fixture();
  const folder='res002-fair-20261029/operator/';
  for(const [side,prompt] of [['B','alpha'],['C','bravo']]){
    save(root,folder+'run-'+side+'.json',{
      benchmark:'RES-002',condition:side,mcpEnabled:side==='C',
      stage:'evaluated',museExitCode:0,model:'muse-spark-1.3',reasoningEffort:'high',
      sourceCommit:'source',evaluatorSha256:'eval',
      taskPromptSha256:prompt,startingGitCommit:'start',
      codingSeconds:100,weightedScore:99,
    });
  }
  assert.equal(collectEvidence({projectsRoot:root}).performance.available,false);
});

test('audit telemetry exposes only allowlisted metadata, never source or secrets',()=>{
  const root=fixture();
  const folder='muse-installer-trial-20261029/operator/';
  save(root,folder+'run.json',{trial:'MUSE-INSTALL-001',model:'muse-spark-1.3',codingSeconds:108.269});
  save(root,folder+'evaluation-reconciliation.json',{passed:true,total:16});
  const privateText='private-agent-prompt-or-api-secret';
  save(root,folder+'mcp-audit.jsonl',[
    JSON.stringify({timestamp:'2026-10-30T00:00:00.000Z',tool:'search_verified_components',
      status:'success',query:privateText,resultIds:['booking-reservation-kernel@0.2.0']}),
    JSON.stringify({timestamp:'2026-10-30T00:00:01.000Z',tool:'inspect_verified_component',
      status:'success',component:'booking-reservation-kernel@0.2.0',content:privateText}),
    JSON.stringify({timestamp:'2026-10-30T00:00:02.000Z',tool:'arbitrary_sensitive_tool',
      status:'success',content:privateText}),
  ].join('\n')+'\n');
  const result=collectEvidence({projectsRoot:root});
  assert.equal(result.activity.sessions[0].status,'offline-reconciled');
  assert.equal(result.activity.sessions[0].checksPassed,16);
  assert.equal(result.activity.events.length,2);
  assert(!JSON.stringify(result).includes(privateText));
});

test('latest install record is presented as build-only without claiming integration',()=>{
  const root=fixture();
  const dir='silkweb-installer-demo/.silkweb/validations/';
  save(root,dir+'6fbec248-be52-4c9a-b030-c57ce13786e1.json',{
    schemaVersion:1,component:'booking-reservation-kernel@0.2.0',status:'build-only',
    passed:true,verifiedAt:'2026-10-30T00:07:44.139Z',
    assurance:'Application behavior and import reachability NOT verified',
    checks:[{id:'certification_and_installed_source_integrity',passed:true},
      {id:'target_build',passed:true}],
  });
  const proof=collectEvidence({projectsRoot:root}).installation;
  assert.equal(proof.status,'build-only');
  assert.equal(proof.checks.length,2);
  assert(!JSON.stringify(proof).includes('integration-verified'));
});
