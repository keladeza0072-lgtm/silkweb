import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const base=join(repo,'experiments/inv-install-002');
const prepare=join(base,'prepare.mjs');
const evaluator=join(base,'evaluate.mjs');
const expectedEvaluator='b2fb7bf24638914dac2ac8a7999b40ecfde37bd51d55506874290fe7047e403b';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
function scratch(){
  const dir=mkdtempSync(join(tmpdir(),'inv-install-002-ci-'));
  return {dir,root:join(dir,'paired')};
}
function node(file,args=[],env={}){
  const variables={...process.env,...env};
  delete variables.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath,[file,...args],{
    encoding:'utf8',env:variables,timeout:90000,maxBuffer:8*1024*1024,
  });
}
test('evaluator is byte-IDENTICAL to original held-out 20-check benchmark',()=>{
  assert.equal(sha(evaluator),expectedEvaluator);
  assert.match(readFileSync(join(base,'TASK.md'),'utf8'),/install_verified_component/);
  assert.match(readFileSync(join(base,'TASK.md'),'utf8'),/get_verified_component_source/);
  assert.match(readFileSync(join(base,'TASK.md'),'utf8'),/SILKWEB_READY/);
});
test('paired preflight constructs identical immutable starters with single MCP tool permission difference',()=>{
  const {dir,root}=scratch();
  try{
    const run=node(prepare,['--root',root]);
    assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
    assert.match(run.stdout,/ZERO MODEL CALLS/);
    const meta=JSON.parse(readFileSync(join(root,'operator/preflight.json'),'utf8'));
    assert.equal(meta.benchmark,'INV-INSTALL-002');
    assert.equal(meta.candidates.R.initialCommit,meta.candidates.I.initialCommit);
    assert.equal(meta.candidates.R.initialTree,meta.candidates.I.initialTree);
    assert.equal(meta.evaluatorSha256,expectedEvaluator);
    assert.equal(sha(meta.taskPath),meta.taskSha256);
    assert.equal(meta.authPresent,Boolean(meta.authPresent));
    const envs=[];
    for(const kind of ['R','I']){
      const ws=join(root,kind);
      assert(existsSync(join(ws,'src/placeholder.ts')));
      assert(!existsSync(join(ws,'src/server.ts')));
      assert(!existsSync(join(ws,'src/silkweb/inventory.ts')));
      assert(!existsSync(join(ws,'experiments')));
      const s=JSON.parse(readFileSync(join(root,'operator/muse-config-'+kind+'/muse/settings.json'),'utf8'));
      assert.deepEqual(Object.keys(s.mcpServers),['silkweb']);
      assert.equal(s.mcpServers.silkweb.env.SILKWEB_TARGET_WORKSPACE,ws);
      assert.equal(s.mcpServers.silkweb.env.SILKWEB_REPO_ROOT,repo);
      assert.equal(s.mcpServers.silkweb.env.SILKWEB_AUDIT_LOG,
        join(root,'operator/mcp-audit-'+kind+'.jsonl'));
      envs.push(s.mcpServers.silkweb.env.SILKWEB_ALLOW_INSTALL);
      const status=spawnSync('git',['-C',ws,'status','--porcelain'],{encoding:'utf8'});
      assert.equal(status.stdout,'');
    }
    assert.deepEqual(envs,['0','1']);
    const second=node(prepare,['--root',root]);
    assert.notEqual(second.status,0,'Cannot silently overwrite starter');
    assert.match(second.stderr,/Output already exists/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('unbuilt application scores ZERO and evaluator refuses report overwrite',()=>{
  const {dir,root}=scratch();
  try{
    mkdirSync(root,{recursive:true});
    const report=join(dir,'empty.json');
    const run=node(evaluator,['--workspace',root,'--report',report]);
    assert.notEqual(run.status,0);
    const q=JSON.parse(readFileSync(report,'utf8'));
    assert.equal(q.expectedChecks,20);
    assert.equal(q.passedChecks,0);
    assert.equal(q.score,0);
    const second=node(evaluator,['--workspace',root,'--report',report]);
    assert.notEqual(second.status,0);
    assert.match(second.stderr,/refusal to overwrite/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('original independent 20-check evaluator gives reference real API 20/20',()=>{
  const {dir,root}=scratch();
  try{
    const wd=join(root,'reference');
    mkdirSync(join(wd,'dist'),{recursive:true});
    writeFileSync(join(wd,'package.json'),JSON.stringify({
      name:'calibration',private:true,type:'module',
    }));
    copyFileSync(join(base,'tests/reference-server.mjs'),join(wd,'dist/server.js'));
    const module=join(repo,'packages/registry/dist/inventory.js');
    assert(existsSync(module),'Must build certified registry first');
    const report=join(dir,'reference.json');
    const p=node(evaluator,['--workspace',wd,'--report',report],{
      INV_BENCH_INVENTORY_MODULE:module,
    });
    const q=JSON.parse(readFileSync(report,'utf8'));
    assert.equal(p.status,0,
      p.stdout+'\n'+p.stderr+'\n'+JSON.stringify(q.details.filter(x=>!x.passed)));
    assert.equal(q.passedChecks,20);
    assert.equal(q.score,100);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
