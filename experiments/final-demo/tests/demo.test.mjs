import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(here,'../../..');
const prepare=join(repo,'experiments/final-demo/prepare.mjs');
const evaluate=join(repo,'experiments/final-demo/evaluate.mjs');
const roots=[];
function fresh(){
  const parent=mkdtempSync(join(tmpdir(),'silkweb-demo-test-'));
  roots.push(parent);
  return {parent,root:join(parent,'one-run')};
}
function run(file,root){
  return spawnSync(process.execPath,[file,'--root',root],{encoding:'utf8',timeout:30000});
}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

test('offline preparation creates a clean Git candidate and exact pinned prompt',()=>{
  const {root}=fresh();
  const proc=run(prepare,root);
  assert.equal(proc.status,0,proc.stderr);
  assert.match(proc.stdout,/ZERO MODEL CALLS/);
  const op=join(root,'operator');
  const meta=JSON.parse(readFileSync(join(op,'preflight.json'),'utf8'));
  assert.equal(meta.trial,'SILKWEB-DEMO-001');
  assert.equal(meta.authCopied,false,'CI must not require Muse credentials');
  assert.equal(meta.sourceRepo,repo);
  assert.equal(meta.root,root);
  assert.equal(meta.classification,'GUIDED_FINAL_PRODUCT_DEMO_NOT_A_B');
  const prompt=readFileSync(meta.promptPath,'utf8');
  assert.match(prompt,/search_verified_components/);
  assert.match(prompt,/inspect_verified_component/);
  assert.match(prompt,/verify-integration/);
  assert.match(prompt,/POST \/api\/bookings/);
  assert.match(prompt,/SILKWEB_BOOKING_DB/);
  assert(!existsSync(join(op,'run.json')));
  assert(!existsSync(join(op,'evaluation.json')));
  assert(!existsSync(join(root,'candidate','src','silkweb')));
  assert(!existsSync(join(root,'candidate','.silkweb')));
  const status=spawnSync('git',['-C',meta.candidate,'status','--porcelain'],{encoding:'utf8'});
  assert.equal(status.status,0,status.stderr);
  assert.equal(status.stdout,'');
});

test('offline preparation refuses to overwrite the prepared candidate',()=>{
  const {root}=fresh();
  const one=run(prepare,root);
  assert.equal(one.status,0,one.stderr);
  const original=readFileSync(join(root,'operator/preflight.json'));
  const two=run(prepare,root);
  assert.notEqual(two.status,0);
  assert.match(two.stderr,/Output already exists/);
  assert.deepEqual(readFileSync(join(root,'operator/preflight.json')),original);
});

test('evaluator cannot falsely claim success when no Muse or integration results exist',()=>{
  const {root}=fresh();
  assert.equal(run(prepare,root).status,0);
  const evaluated=run(evaluate,root);
  assert.equal(evaluated.status,1,'No paid Muse run means zero proof');
  const report=JSON.parse(readFileSync(join(root,'operator/evaluation.json'),'utf8'));
  assert.equal(report.success,false);
  assert.equal(report.classification,'GUIDED_FINAL_DEMO_INDEPENDENT_EVALUATION');
  assert(report.checks.some(c=>c.id==='muse_completed'&&!c.passed));
  assert(report.checks.some(c=>c.id==='phase3_integration'&&!c.passed));
  assert(report.checks.some(c=>c.id==='independent_http_runner'&&!c.passed));
  const second=run(evaluate,root);
  assert.notEqual(second.status,0);
  assert.match(second.stderr,/Evaluation exists/);
});
