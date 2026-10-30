import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,test} from 'node:test';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const rootScript=join(repo,'experiments/multidomain');
const prep=join(rootScript,'prepare.mjs');
const evaluate=join(rootScript,'evaluate.mjs');
const roots=[];
function scratch(){
  const parent=mkdtempSync(join(tmpdir(),'silkweb-multi-ci-'));
  roots.push(parent);
  return {parent,root:join(parent,'fresh')};
}
function run(script,args){
  return spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:35000});
}
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));

test('all six use cases are declared as planned and not silently certified',()=>{
  const spec=JSON.parse(readFileSync(join(rootScript,'use-cases.json'),'utf8'));
  assert.equal(spec.suite,'SW-MULTI-001');
  assert.equal(spec.domains.length,6);
  assert.equal(new Set(spec.domains.map(x=>x.id)).size,6);
  assert.equal(spec.domains.filter(x=>x.level==='phase1').length,2);
  assert.equal(spec.domains.filter(x=>x.level==='phase2').length,4);
  assert(spec.domains.every(x=>x.knownLimits&&x.proof.length>=3));
  assert(spec.domains.every(x=>!x.certified&&!x.benchmarked));
  for(const filename of ['inventory-reservation','signed-webhook-inbox',
    'leased-job-queue','api-rate-limiter','workflow-state-machine',
    'tamper-evident-audit-log']){
    const contract=join(rootScript,'contracts',filename+'.md');
    assert(existsSync(contract),contract+' is missing');
    assert.match(readFileSync(contract,'utf8'),/unverified|not verified/i);
  }
});
test('offline preflight makes two clean isolated Git starters with no paid run',()=>{
  const {root}=scratch();
  const result=run(prep,['--root',root]);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/ZERO MODEL CALLS/);
  const op=join(root,'operator');
  const meta=JSON.parse(readFileSync(join(op,'preflight.json'),'utf8'));
  assert.equal(meta.suite,'SW-MULTI-001');
  assert.equal(meta.kind,'FROZEN_NEW_COMPONENT_AUTHORING_NOT_BENCHMARK');
  assert.equal(meta.root,root);assert.equal(meta.sourceRepo,repo);
  assert.deepEqual(Object.keys(meta.tasks).sort(),['inventory','webhooks']);
  for(const [key,task] of Object.entries(meta.tasks)){
    assert(task.promptSha256&&task.promptPath&&task.starterCommit);
    assert(existsSync(task.promptPath));
    assert(!existsSync(join(root,key,'src',task.entry)));
    assert(!existsSync(join(op,'run-'+key+'.json')));
    assert(!existsSync(join(op,'evaluation-'+key+'.json')));
    assert(!existsSync(join(root,key,'tests')));
    assert(!existsSync(join(root,key,'heldout')));
    const status=spawnSync('git',['-C',task.candidate,'status','--porcelain'],{encoding:'utf8'});
    assert.equal(status.status,0,status.stderr);assert.equal(status.stdout,'');
    const prompt=readFileSync(task.promptPath,'utf8');
    assert.match(prompt,/Muse Spark 1.3/);
    assert.match(prompt,/search_verified_components/);
    assert.doesNotMatch(prompt,/test\('INV\d\d|test\('WHK\d\d/);
  }
});
test('preflight cannot overwrite existing authoring attempt',()=>{
  const {root}=scratch();
  const first=run(prep,['--root',root]);
  assert.equal(first.status,0,first.stderr);
  const original=readFileSync(join(root,'operator/preflight.json'));
  const second=run(prep,['--root',root]);
  assert.notEqual(second.status,0);
  assert.match(second.stderr,/Output already exists/);
  assert.deepEqual(readFileSync(join(root,'operator/preflight.json')),original);
});
test('held-out evaluator fails closed without a real Muse run for each domain',()=>{
  const {root}=scratch();
  const p=run(prep,['--root',root]);
  assert.equal(p.status,0,p.stderr);
  for(const [task,total] of [['inventory',11],['webhooks',12]]){
    const result=run(evaluate,['--task',task,'--root',root]);
    assert.equal(result.status,1,'No Muse run must never be scored as pass');
    const report=JSON.parse(readFileSync(join(root,'operator/evaluation-'+task+'.json'),'utf8'));
    assert.equal(report.checksTotal,total);
    assert.equal(report.checksPassed,0);
    assert.equal(report.success,false);
    assert.equal(report.classification,'HELDOUT_NEW_COMPONENT_AUTHORING_NOT_B_C');
    assert.equal(report.execution,null);
    const repeat=run(evaluate,['--task',task,'--root',root]);
    assert.notEqual(repeat.status,0);
    assert.match(repeat.stderr,/Prior evaluation exists/);
  }
});
test('held-out acceptance requires actual compiled source and never accepts starter stub',()=>{
  const {root}=scratch();
  assert.equal(run(prep,['--root',root]).status,0);
  for(const [key,file] of [['inventory','inventory.test.mjs'],['webhooks','webhooks.test.mjs']]){
    const testFile=join(rootScript,'heldout',file);
    // Node's parent test context can mask nested node --test exit codes.
    // Remove internal NODE_TEST_* keys so failures remain failures.
    const env={...process.env,SILKWEB_CANDIDATE:join(root,key)};
    for(const name of Object.keys(env))if(name.startsWith('NODE_TEST_'))delete env[name];
    const result=spawnSync(process.execPath,['--test',testFile],{
      encoding:'utf8',timeout:15000,env,
    });
    assert.notEqual(result.status,0,'Blank candidates must not pass held-out suites');
  }
});
