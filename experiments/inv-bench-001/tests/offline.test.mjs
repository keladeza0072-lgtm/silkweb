import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const base=join(repo,'experiments/inv-bench-001');
const prepare=join(base,'prepare.mjs'),evaluate=join(base,'evaluate.mjs');
function scratch(){
  const dir=mkdtempSync(join(tmpdir(),'inv-bench-001-ci-'));
  return {dir,root:join(dir,'paired')};
}
function node(script,args=[],env={}){
  const actualEnv={...process.env,...env};
  for(const name of Object.keys(actualEnv))if(name.startsWith('NODE_TEST_'))delete actualEnv[name];
  return spawnSync(process.execPath,[script,...args],{
    encoding:'utf8',env:actualEnv,timeout:90000,maxBuffer:8*1024*1024,
    windowsHide:true,
  });
}
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');

test('shared frozen prompt is real inventory HTTP app task, never held-out test code',()=>{
  const s=readFileSync(join(base,'TASK.md'),'utf8');
  assert.match(s,/SILKWEB_READY/);
  assert.match(s,/INVENTORY_DB_PATH/);
  assert.match(s,/atomic|concurrent/i);
  assert.match(s,/get_verified_component_source/);
  assert.match(s,/If the environment exposes a \*\*Silk Web MCP Librarian\*\*/);
  assert.doesNotMatch(s,/API20|passedChecks|evaluation-inventory-v2\.json/);
});
test('offline paired preflight makes identical clean Git commits and isolated C-only MCP',()=>{
  const {dir,root}=scratch();
  try{
    const run=node(prepare,['--root',root]);
    assert.equal(run.status,0,run.stderr);
    assert.match(run.stdout,/ZERO PAID MODEL CALLS/);
    const meta=JSON.parse(readFileSync(join(root,'operator/preflight.json'),'utf8'));
    assert.equal(meta.benchmark,'INV-BENCH-001');
    assert.equal(meta.candidates.B.initialCommit,meta.candidates.C.initialCommit);
    assert.equal(meta.candidates.B.tree,meta.candidates.C.tree);
    assert.equal(sha(meta.taskPath),meta.taskSha256);
    assert.deepEqual(Object.keys(meta.candidates).sort(),['B','C']);
    for(const k of ['B','C']){
      const ws=join(root,k);
      assert(existsSync(join(ws,'src/placeholder.ts')));
      assert(!existsSync(join(ws,'src/server.ts')));
      assert(!existsSync(join(ws,'dist/server.js')));
      assert(!existsSync(join(ws,'operator')));
      assert(!existsSync(join(ws,'experiments')));
      assert.equal(spawnSync('git',['-C',ws,'status','--porcelain'],{
        encoding:'utf8'}).stdout,'');
      const settings=JSON.parse(readFileSync(join(root,'operator/muse-config-'+k+'/muse/settings.json'),'utf8'));
      if(k==='B')assert.deepEqual(settings.mcpServers,{});
      else{
        assert.deepEqual(Object.keys(settings.mcpServers),['silkweb']);
        assert.equal(settings.mcpServers.silkweb.env.SILKWEB_AUDIT_LOG,
          join(root,'operator/C-mcp-audit.jsonl'));
      }
    }
    const second=node(prepare,['--root',root]);
    assert.notEqual(second.status,0);
    assert.match(second.stderr,/Root already exists/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('independent evaluator fails closed on blank candidate with zero score',()=>{
  const {dir,root}=scratch();
  try{
    const wd=join(root,'B');mkdirSync(wd,{recursive:true});
    const report=join(dir,'blank.json');
    const run=node(evaluate,['--workspace',wd,'--report',report]);
    assert.notEqual(run.status,0);
    const r=JSON.parse(readFileSync(report,'utf8'));
    assert.equal(r.expectedChecks,20);
    assert.equal(r.passedChecks,0);
    assert.equal(r.score,0);
    assert.equal(r.success,false);
    const repeat=node(evaluate,['--workspace',wd,'--report',report]);
    assert.notEqual(repeat.status,0);
    assert.match(repeat.stderr,/refusal to overwrite/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('independent 20-check HTTP suite scores known-good reference adapter 20/20',()=>{
  const {dir,root}=scratch();
  try{
    const wd=join(root,'reference');mkdirSync(join(wd,'dist'),{recursive:true});
    writeFileSync(join(wd,'package.json'),JSON.stringify({
      name:'benchmark-calibration',private:true,type:'module',
    }));
    copyFileSync(join(base,'tests/reference-server.mjs'),join(wd,'dist/server.js'));
    const module=join(repo,'packages/registry/dist/inventory.js');
    assert(existsSync(module),'registry must be built before evaluator calibration');
    const report=join(dir,'reference.json');
    const evaluated=node(evaluate,['--workspace',wd,'--report',report],{
      INV_BENCH_INVENTORY_MODULE:module,
    });
    const r=JSON.parse(readFileSync(report,'utf8'));
    assert.equal(evaluated.status,0,evaluated.stdout+'\n'+evaluated.stderr+
      '\n'+JSON.stringify(r.details.filter(x=>!x.passed),null,2));
    assert.equal(r.passedChecks,20);
    assert.equal(r.score,100);
    assert.equal(r.success,true);
    assert.equal(r.details.length,20);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
