#!/usr/bin/env node
/**
 * INV-BENCH-001 black-box independent HTTP evaluator.
 * The authoring agent never sees this evaluator; scores both B and C with
 * identical frozen checks. No Muse calls, no source modification, no npm.
 *
 * Usage: node evaluate.mjs --workspace <absolute> --report <new absolute file>
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--workspace'||args[2]!=='--report'||
  !isAbsolute(args[1])||!isAbsolute(args[3])){
  throw new Error('Usage: node evaluate.mjs --workspace <absolute> --report <new absolute file>');
}
const workspace=resolve(args[1]),reportPath=resolve(args[3]);
if(existsSync(reportPath))throw new Error('Original independent report exists; refusal to overwrite');
const dist=join(workspace,'dist','server.js');
const checks=[];
const timeoutMs=65000;
const startAt=Date.now();
const temp=mkdtempSync(join(tmpdir(),'inv-bench-001-'));
const dbPath=join(temp,'inventory.sqlite');
const services=[];
const total=20;
const suitePath=fileURLToPath(import.meta.url);
const suiteSha256=createHash('sha256').update(readFileSync(suitePath)).digest('hex');
const errMessage=e=>String(e instanceof Error?e.message:e).slice(0,400);
async function startServer(){
  if(!existsSync(dist))throw new Error('NO_COMPILED_SERVER dist/server.js');
  const child=spawn(process.execPath,[dist],{
    cwd:workspace,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,INVENTORY_DB_PATH:dbPath,PORT:'0'},
  });
  services.push(child);
  let stdout='',stderr='',finished=false;
  const ready=await new Promise((resolveReady,rejectReady)=>{
    const t=setTimeout(()=>rejectReady(new Error('SERVER_READY_TIMEOUT '+stderr.slice(-700))),8000);
    function fail(msg){
      if(finished)return;
      finished=true;clearTimeout(t);rejectReady(new Error(msg));
    }
    child.on('error',e=>fail('SERVER_SPAWN '+errMessage(e)));
    child.on('exit',(code,signal)=>fail('SERVER_EXIT '+code+' '+signal+' '+stderr.slice(-700)));
    child.stdout.on('data',chunk=>{
      if(finished)return;
      stdout+=chunk.toString('utf8');
      if(stdout.length>25000)return fail('SERVER_STDOUT_TOO_LARGE');
      const m=stdout.match(/(?:^|\r?\n)SILKWEB_READY (\{"port":\d+\})\r?(?:\n|$)/);
      if(!m)return;
      let data;
      try{data=JSON.parse(m[1]);}catch(e){return fail('INVALID_READY_JSON');}
      if(!Number.isInteger(data.port)||data.port<1||data.port>65535)return fail('INVALID_READY_PORT');
      finished=true;clearTimeout(t);
      resolveReady({port:data.port,child});
    });
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString('utf8')).slice(-3000);});
  });
  return ready;
}
async function stopServer(s){
  if(!s||s.child.exitCode!==null)return;
  await new Promise(resolveStop=>{
    const t=setTimeout(resolveStop,2000);
    s.child.once('exit',()=>{clearTimeout(t);resolveStop();});
    s.child.kill();
  });
}
async function api(server,method,path,body,options={}){
  const headers={};
  if(body!==undefined && !options.contentType)headers['Content-Type']='application/json';
  if(options.contentType)headers['Content-Type']=options.contentType;
  const raw=body===undefined?undefined:options.raw?body:JSON.stringify(body);
  const res=await fetch('http://127.0.0.1:'+server.port+path,{
    method,headers,body:raw,signal:AbortSignal.timeout(3500),
  });
  const rawText=await res.text();
  let json;
  try{json=JSON.parse(rawText);}catch{json=null;}
  return {status:res.status,headers:res.headers,body:json,text:rawText};
}
function status(res,expected){
  assert.equal(res.status,expected,'HTTP '+res.status+' expected '+expected+
    ' body '+JSON.stringify(res.body??res.text).slice(0,250));
}
function failure(res,code,expected){
  status(res,expected);
  assert.equal(res.body?.error?.code,code,JSON.stringify(res.body));
}
function truthyJson(res){assert.match(res.headers.get('content-type')??'',/application\/json/i);}
async function check(id,title,fn){
  let passed=false,error=null;
  const begun=Date.now();
  try{await fn();passed=true;}catch(e){error=errMessage(e);}
  checks.push({id,title,passed,error,durationMs:Date.now()-begun});
}
async function run(){
  if(!existsSync(dist)){
    return;
  }
  let server;
  try{server=await startServer();}
  catch(e){checks.push({id:'STARTUP',title:'Compiled HTTP server starts',passed:false,
    error:errMessage(e),durationMs:Date.now()-startAt});return;}
  await check('API01','Health and JSON content type',async()=>{
    const r=await api(server,'GET','/health');
    status(r,200);truthyJson(r);assert.deepEqual(r.body,{ok:true,service:'inventory-api'});
  });
  await check('API02','Stock creation and GET stock',async()=>{
    const r=await api(server,'POST','/v1/stock',{sku:'BOOK-A',available:10});
    status(r,201);truthyJson(r);assert.deepEqual(r.body,{sku:'BOOK-A',available:10});
    const g=await api(server,'GET','/v1/stock/BOOK-A');
    status(g,200);assert.deepEqual(g.body,{sku:'BOOK-A',available:10});
  });
  await check('API03','Zero initial stock accepted; zero unit cannot reserve',async()=>{
    const r=await api(server,'POST','/v1/stock',{sku:'ZERO-A',available:0});
    status(r,201);assert.equal(r.body?.available,0);
    failure(await api(server,'POST','/v1/reservations',
      {key:'zero-res',sku:'ZERO-A',quantity:1}),'INSUFFICIENT_STOCK',409);
  });
  await check('API04','All stock listed alphabetically without mutation',async()=>{
    const a=await api(server,'POST','/v1/stock',{sku:'A-FIRST',available:3});
    status(a,201);
    const b=await api(server,'GET','/v1/stock');
    status(b,200);assert(Array.isArray(b.body?.items));
    const names=b.body.items.map(x=>x.sku);
    assert.deepEqual(names,[...names].sort());
    assert(b.body.items.some(x=>x.sku==='A-FIRST'&&x.available===3));
    assert(b.body.items.some(x=>x.sku==='ZERO-A'&&x.available===0));
  });
  await check('API05','Duplicate SKU cannot reset available',async()=>{
    failure(await api(server,'POST','/v1/stock',{sku:'BOOK-A',available:999}),'STOCK_EXISTS',409);
    const g=await api(server,'GET','/v1/stock/BOOK-A');
    assert.equal(g.body?.available,10);
  });
  await check('API06','Invalid and unsafe stock values rejected',async()=>{
    for(const available of [-1,1.3,Number.MAX_SAFE_INTEGER+1,null]){
      failure(await api(server,'POST','/v1/stock',{sku:'INVALID-A',available}),
        'INVALID_INPUT',400);
    }
    failure(await api(server,'POST','/v1/stock',{sku:'',available:2}),'INVALID_INPUT',400);
  });
  let reservationId;
  await check('API07','Successful stock allocation deducts exact quantity',async()=>{
    const r=await api(server,'POST','/v1/reservations',{key:'order-1',sku:'BOOK-A',quantity:4});
    status(r,201);
    assert.equal(r.body?.replayed,false);assert.equal(r.body?.available,6);
    assert(Number.isSafeInteger(r.body?.reservationId)&&r.body.reservationId>0);
    reservationId=r.body.reservationId;
    assert.equal((await api(server,'GET','/v1/stock/BOOK-A')).body?.available,6);
  });
  await check('API08','Identical idempotency key replays original reservation',async()=>{
    assert(reservationId,'API07 must complete');
    const r=await api(server,'POST','/v1/reservations',{key:'order-1',sku:'BOOK-A',quantity:4});
    status(r,200);assert.equal(r.body?.replayed,true);
    assert.equal(r.body?.reservationId,reservationId);
    assert.equal((await api(server,'GET','/v1/stock/BOOK-A')).body?.available,6);
  });
  await check('API09','Conflicting idempotency key cannot alter stock',async()=>{
    failure(await api(server,'POST','/v1/reservations',
      {key:'order-1',sku:'BOOK-A',quantity:5}),'IDEMPOTENCY_CONFLICT',409);
    assert.equal((await api(server,'GET','/v1/stock/BOOK-A')).body?.available,6);
  });
  await check('API10','Failed insufficient request does not consume retry key',async()=>{
    failure(await api(server,'POST','/v1/reservations',
      {key:'order-2',sku:'BOOK-A',quantity:7}),'INSUFFICIENT_STOCK',409);
    const r=await api(server,'POST','/v1/reservations',
      {key:'order-2',sku:'BOOK-A',quantity:5});
    status(r,201);assert.equal(r.body?.replayed,false);
    assert.equal(r.body?.available,1);
  });
  await check('API11','Unknown SKU rejects both read and new reservation',async()=>{
    failure(await api(server,'GET','/v1/stock/DOES-NOT-EXIST'),'STOCK_NOT_FOUND',404);
    failure(await api(server,'POST','/v1/reservations',
      {key:'unknown-key',sku:'DOES-NOT-EXIST',quantity:1}),'STOCK_NOT_FOUND',404);
  });
  await check('API12','Release reservation restores stock exactly once',async()=>{
    assert(reservationId,'Need prior reservation');
    const r=await api(server,'POST','/v1/reservations/'+reservationId+'/release');
    status(r,200);assert.deepEqual(r.body,{released:true,available:5});
  });
  await check('API13','Second release and prior key retry never restore/subtract again',async()=>{
    assert(reservationId,'Need prior reservation');
    const again=await api(server,'POST','/v1/reservations/'+reservationId+'/release');
    status(again,200);assert.deepEqual(again.body,{released:false,available:5});
    const retry=await api(server,'POST','/v1/reservations',
      {key:'order-1',sku:'BOOK-A',quantity:4});
    status(retry,200);assert.equal(retry.body?.replayed,true);
    assert.equal(retry.body?.reservationId,reservationId);
    assert.equal((await api(server,'GET','/v1/stock/BOOK-A')).body?.available,5);
  });
  await check('API14','Unknown and malformed reservation ids fail safely',async()=>{
    failure(await api(server,'POST','/v1/reservations/999999/release'),'RESERVATION_NOT_FOUND',404);
    failure(await api(server,'POST','/v1/reservations/not-an-id/release'),'INVALID_INPUT',400);
  });
  await check('API15','Unknown route and method fail with stable 404',async()=>{
    failure(await api(server,'GET','/nope'),'NOT_FOUND',404);
    failure(await api(server,'DELETE','/v1/stock/BOOK-A'),'NOT_FOUND',404);
  });
  await check('API16','Malformed JSON is a controlled client error',async()=>{
    failure(await api(server,'POST','/v1/stock','{"sku":', {raw:true}),'INVALID_JSON',400);
    assert.equal((await api(server,'GET','/health')).status,200,'server crashed on bad JSON');
  });
  await check('API17','Wrong Content-Type rejected before mutation',async()=>{
    failure(await api(server,'POST','/v1/stock','plain',{
      raw:true,contentType:'text/plain'}),'UNSUPPORTED_MEDIA_TYPE',415);
  });
  await check('API18','Large JSON bodies are bounded at 65536 bytes',async()=>{
    const huge=JSON.stringify({sku:'LONG-BODY',available:1,padding:'x'.repeat(66000)});
    failure(await api(server,'POST','/v1/stock',huge,{raw:true}),
      'PAYLOAD_TOO_LARGE',413);
    failure(await api(server,'GET','/v1/stock/LONG-BODY'),'STOCK_NOT_FOUND',404);
  });
  await check('API19','SQLite stock and replay survive fresh process restart',async()=>{
    await stopServer(server);
    server=await startServer();
    const g=await api(server,'GET','/v1/stock/BOOK-A');
    status(g,200);assert.equal(g.body?.available,5);
    const retry=await api(server,'POST','/v1/reservations',
      {key:'order-1',sku:'BOOK-A',quantity:4});
    status(retry,200);assert.equal(retry.body?.replayed,true);
    assert.equal(retry.body?.reservationId,reservationId);
  });
  await check('API20','Two independent servers sharing one DB cannot oversell',async()=>{
    const other=await startServer();
    try{
      const seed=await api(server,'POST','/v1/stock',{sku:'RACE-ONE',available:1});
      status(seed,201);
      const [left,right]=await Promise.all([
        api(server,'POST','/v1/reservations',{key:'race-a',sku:'RACE-ONE',quantity:1}),
        api(other,'POST','/v1/reservations',{key:'race-b',sku:'RACE-ONE',quantity:1}),
      ]);
      assert.deepEqual([left.status,right.status].sort((a,b)=>a-b),[201,409],
        JSON.stringify([left,right].map(x=>x.body)));
      const loser=left.status===409?left:right;
      assert.equal(loser.body?.error?.code,'INSUFFICIENT_STOCK');
      const remaining=await api(other,'GET','/v1/stock/RACE-ONE');
      assert.equal(remaining.body?.available,0);
      const winner=left.status===201?left:right;
      assert.equal(winner.body?.replayed,false);
    }finally{await stopServer(other);}
  });
  await stopServer(server);
}
try{await Promise.race([
  run(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('EVALUATOR_TIMEOUT')),timeoutMs)),
]);}
catch(e){checks.push({id:'EVALUATOR_ERROR',title:'Evaluator operation',passed:false,
 error:errMessage(e),durationMs:0});}
finally{for(const child of services){if(child.exitCode===null)child.kill();}
  rmSync(temp,{recursive:true,force:true});}
const passed=checks.filter(x=>x.passed).length;
const allExpected=checks.length===total&&checks.every((x,i)=>x.id==='API'+String(i+1).padStart(2,'0'));
const score=allExpected?Math.round(100*passed/total*100)/100:0;
const report={
  benchmark:'INV-BENCH-001',classification:'INDEPENDENT_BLACKBOX_SINGLE_CONDITION',
  evaluatorSha256:suiteSha256,compiledServerSha256:existsSync(dist)?
    createHash('sha256').update(readFileSync(dist)).digest('hex'):null,
  expectedChecks:total,observedChecks:checks.length,passedChecks:passed,
  score,success:allExpected&&passed===total,
  evaluationSeconds:Math.round((Date.now()-startAt)/10)/100,
  details:checks,createdAt:new Date().toISOString(),
  limitations:[
    'One held-out HTTP probe sequence per candidate; not a load/soak test.',
    'Coding time excludes this independent evaluation runtime.',
    'Model reuse and cost measured separately, not inferred from HTTP score.',
    'Startup/build failure is zero-scored; no synthetic successes.',
  ],
};
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({
  benchmark:report.benchmark,success:report.success,
  checksPassed:report.passedChecks,checksTotal:total,
  quality:report.score,reportPath,
  failing:checks.filter(x=>!x.passed).map(x=>({id:x.id,error:x.error})),
},null,2)+'\n');
if(!report.success)process.exitCode=1;
