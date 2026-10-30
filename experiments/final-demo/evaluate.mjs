#!/usr/bin/env node
/**
 * SILKWEB-DEMO-001 independent, offline post-run evaluator.
 * Does not change the candidate, run Muse, or read old benchmark evidence.
 * Executes HTTP assertions against a temporary local server and separately
 * checks Phase 3 verification plus MCP audit provenance.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const root=process.argv.length===4 && process.argv[2]==='--root'
  ? resolve(process.argv[3])
  : join(process.env.USERPROFILE||process.env.HOME||'','Projects','silkweb-final-demo-20261030');
const operator=join(root,'operator');
const readJson=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const reportFile=join(operator,'evaluation.json');
const checks=[];
function check(id,passed,detail=''){
  checks.push({id,passed:passed===true,detail:String(detail).slice(0,250)});
}
function rows(path){
  if(!existsSync(path))return [];
  const result=[];
  for(const line of readFileSync(path,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){
    if(!line.trim())continue;
    try{result.push(JSON.parse(line));}catch{/* invalid lines excluded */}
  }
  return result;
}
async function port(){
  const s=createServer();
  await new Promise((yes,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',yes);});
  const selected=s.address().port;
  await new Promise(yes=>s.close(yes));
  return selected;
}
async function probeApp(candidate){
  const probeLog=[];
  const selected=await port();
  const db=join(operator,'independent-demo-probe.sqlite');
  if(existsSync(db))throw new Error('Independent probe DB exists; refusing repeat: '+db);
  const child=spawn(process.execPath,['dist/server.js'],{
    cwd:candidate,stdio:'ignore',windowsHide:true,
    env:{...process.env,PORT:String(selected),SILKWEB_BOOKING_DB:db},
  });
  let exited=false;child.once('exit',()=>{exited=true;});
  const url='http://127.0.0.1:'+selected;
  async function hit(method,path,body) {
    const response=await fetch(url+path,{
      method,headers:{'content-type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(4000),
    });
    const data=await response.json();
    probeLog.push({method,path,status:response.status});
    return {status:response.status,data};
  }
  try{
    let healthy=false;
    for(let i=0;i<35;i++){
      if(exited)break;
      try{const r=await hit('GET','/api/health');if(r.status===200 && r.data?.ok===true){healthy=true;break;}}
      catch{/* process not listening yet */}
      await new Promise(r=>setTimeout(r,90));
    }
    check('http_health',healthy,'GET /api/health returns 200 with ok:true');
    if(!healthy)return probeLog;
    const body={idempotencyKey:'demo-independent-key-1',staffId:1,serviceId:1,
      startTime:'2026-11-05T09:00:00.000Z'};
    let first;
    try {
      first=await hit('POST','/api/bookings',body);
      check('http_new_booking',first.status===201 &&
        Number.isSafeInteger(first.data?.booking?.id) && first.data.replayed===false,
        'New booking must be HTTP 201 and actually contain a booking id.');
    }catch(error){check('http_new_booking',false,String(error));return probeLog;}
    if(!Number.isSafeInteger(first.data?.booking?.id))return probeLog;
    const id=first.data.booking.id;
    try{
      const replay=await hit('POST','/api/bookings',body);
      check('http_exact_replay',replay.status===200 && replay.data?.replayed===true &&
        replay.data?.booking?.id===id,'Same-key, same-payload must reuse the original booking.');
    }catch(error){check('http_exact_replay',false,String(error));}
    try{
      const mismatched=await hit('POST','/api/bookings',{
        ...body,startTime:'2026-11-05T09:30:00.000Z'});
      check('http_changed_payload_conflict',mismatched.status===409,
        'Reusing key with changed payload must return HTTP 409.');
    }catch(error){check('http_changed_payload_conflict',false,String(error));}
    try{
      const conflicting=await hit('POST','/api/bookings',{
        ...body,idempotencyKey:'demo-independent-key-2'});
      check('http_active_slot_conflict',conflicting.status===409,
        'A different key cannot double-book the active staff/slot.');
    }catch(error){check('http_active_slot_conflict',false,String(error));}
    try{
      const cancelled=await hit('POST','/api/bookings/'+id+'/cancel',{});
      check('http_cancel',cancelled.status===200 && cancelled.data?.booking?.status==='cancelled',
        'Cancellation must persist.');
      const after=await hit('POST','/api/bookings',body);
      check('http_cancelled_replay',after.status===200 &&
        after.data?.replayed===true && after.data?.booking?.status==='cancelled' &&
        after.data?.booking?.id===id,'Replay after cancellation must NOT reinstate the original.');
    }catch(error){check('http_cancel_and_replay',false,String(error));}
    try{
      const bad=await hit('POST','/api/bookings',{
        ...body,idempotencyKey:'bad-input-key',startTime:'not-a-date'});
      check('http_invalid_input_rejected',bad.status>=400 && bad.status<500,
        'Invalid timestamp must not return 2xx.');
    }catch(error){check('http_invalid_input_rejected',false,String(error));}
    return probeLog;
  }finally{
    if(!exited){child.kill('SIGTERM');}
    await Promise.race([
      new Promise(yes=>child.once('exit',yes)),
      new Promise(yes=>setTimeout(yes,1500)),
    ]);
    if(!exited)child.kill('SIGKILL');
  }
}

async function main(){
  if(existsSync(reportFile))throw new Error('Evaluation exists; refusing overwrite');
  const meta=readJson(join(operator,'preflight.json'));
  if(meta.trial!=='SILKWEB-DEMO-001'||resolve(meta.sourceRepo)!==repo){
    throw new Error('Unrecognized demo preflight');
  }
  const run=existsSync(join(operator,'run.json'))?readJson(join(operator,'run.json')):null;
  check('muse_completed',run?.museExitCode===0,'Muse exit code must equal zero.');
  check('target_build',run?.buildExitCode===0,'Post-Muse independent target build must pass.');
  const events=rows(meta.auditLog);
  check('mcp_search',events.some(e=>e.tool==='search_verified_components'&&
    e.status==='success'&&e.resultIds?.includes('booking-reservation-kernel@0.2.0')),
    'Actual MCP search must return certified kernel.');
  check('mcp_inspect',events.some(e=>e.tool==='inspect_verified_component'&&
    e.status==='success'&&e.component==='booking-reservation-kernel@0.2.0'),
    'Actual MCP inspect must confirm the kernel.');
  check('source_delivered_via_installer',!events.some(e=>e.tool==='get_verified_component_source'),
    'This demo uses the audited installer for source, not MCP source serialization.');
  const install=join(meta.candidate,'.silkweb','installations',
    'booking-reservation-kernel@0.2.0.json');
  const installation=existsSync(install)?readJson(install):null;
  check('installer_audit',installation?.component==='booking-reservation-kernel@0.2.0' &&
    Array.isArray(installation.files) && installation.files.length===4,
    'Installer report records four exact certified source files.');
  if(installation?.files){
    for(const f of installation.files){
      const rel=f.destination;
      const path=join(meta.candidate,rel);
      const certified=join(repo,f.registryPath);
      check('source_sha256_'+rel,rel.startsWith('src/silkweb/') &&
        f.registryPath.startsWith('packages/registry/src/') &&
        existsSync(path)&&existsSync(certified)&&sha(path)===f.sha256 &&
        sha(certified)===f.sha256,'Installed bytes equal certified source.');
    }
  }
  const verificationPath=join(operator,'phase3-verification.json');
  let phase3=null;
  try{phase3=readJson(verificationPath);}catch{/* explicit failure */}
  check('phase3_integration',phase3?.status==='integration-verified' &&
    phase3?.passed===true && phase3?.entry==='src/server.ts' &&
    phase3?.selectedTests?.includes('tests/booking-integration.test.mjs') &&
    phase3?.checks?.every(c=>c.passed===true),
    'Phase 3 must show successful build, entry linkage, selected app tests.');
  let traffic=[];
  if(run?.buildExitCode===0 && existsSync(join(meta.candidate,'dist','server.js'))){
    try{traffic=await probeApp(meta.candidate);}
    catch(error){check('independent_http_runner',false,String(error));}
  }else{check('independent_http_runner',false,'No buildable target server.');}
  const report={
    schemaVersion:1,trial:'SILKWEB-DEMO-001',
    classification:'GUIDED_FINAL_DEMO_INDEPENDENT_EVALUATION',
    originalBenchmarkUnchanged:true,notAControlledComparison:true,
    paidModelRun:run?.museExitCode===0,model:run?.model??null,
    codingSeconds:run?.codingSeconds??null,
    checksPassed:checks.filter(x=>x.passed).length,checksTotal:checks.length,
    success:checks.length>0&&checks.every(x=>x.passed),checks,
    traffic,
    limitations:'One guided demonstration; not a new speed/cost A/B benchmark. App tests and independent HTTP probes evaluate selected behavior, not security or untested features.',
    completedAt:new Date().toISOString(),
  };
  writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({
    trial:report.trial,classification:report.classification,
    success:report.success,checksPassed:report.checksPassed,checksTotal:report.checksTotal,
    failedChecks:checks.filter(c=>!c.passed).map(c=>({id:c.id,detail:c.detail})),
    reportPath:reportFile,
  },null,2)+'\n');
  if(!report.success)process.exitCode=1;
}
main().catch(error=>{
  process.stderr.write('DEMO EVALUATION REFUSED: '+error.message+'\n');
  process.exitCode=1;
});
