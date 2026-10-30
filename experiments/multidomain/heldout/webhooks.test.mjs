/**
 * WHK-001 held-out signed-webhook inbox acceptance.
 * Not copied to Muse workspace. Requires SILKWEB_CANDIDATE=<absolute>.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash,createHmac } from 'node:crypto';
import { existsSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute,join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const candidate=process.env.SILKWEB_CANDIDATE;
if(!candidate||!isAbsolute(candidate))throw new Error('SILKWEB_CANDIDATE must be absolute');
const modulePath=join(resolve(candidate),'dist','webhooks.js');
if(!existsSync(modulePath))throw new Error('No compiled webhook implementation: '+modulePath);
const {
  initializeWebhookInbox,acceptWebhook,getWebhookState,markWebhookProcessed,
}=await import(pathToFileURL(modulePath).href);
for(const [name,value] of Object.entries({
  initializeWebhookInbox,acceptWebhook,getWebhookState,markWebhookProcessed,
}))assert.equal(typeof value,'function','Missing export: '+name);
const secret='a genuine secret: shh × UTF8';
const signature=(payload,key=secret)=>'sha256='+createHmac('sha256',key).update(Buffer.from(payload,'utf8')).digest('hex');
const payload='{"kind":"payment.created","amount":1250}';
const request=(overrides={})=>({
  provider:'payments-a',eventId:'evt-123',payload,signature:signature(payload),secret,
  ...overrides,
});
function withDb(fn){
  const db=new DatabaseSync(':memory:');
  try{return fn(db);}finally{db.close();}
}
const code=value=>error=>error?.code===value;
test('WHK01: init is idempotent; valid signed event is persisted pending',()=>{
  withDb(db=>{
    initializeWebhookInbox(db);initializeWebhookInbox(db);
    assert.deepEqual(acceptWebhook(db,request()),{accepted:true,duplicate:false});
    assert.deepEqual(getWebhookState(db,'payments-a','evt-123'),{
      status:'pending',payloadSha256:createHash('sha256').update(payload).digest('hex'),
    });
  });
});
test('WHK02: exact retry is a duplicate with no additional processing',()=>{
  withDb(db=>{
    initializeWebhookInbox(db);
    acceptWebhook(db,request());
    assert.deepEqual(acceptWebhook(db,request()),{accepted:true,duplicate:true});
    assert.equal(getWebhookState(db,'payments-a','evt-123').status,'pending');
  });
});
test('WHK03: malformed, missing or incorrect HMAC is rejected BEFORE dedupe',()=>{
  withDb(db=>{
    initializeWebhookInbox(db);acceptWebhook(db,request());
    for(const broken of [
      '', 'sha256=x', 'sha256='+'0'.repeat(64),
      'SHA256='+signature(payload).slice(7),
      signature(payload).replace('sha256=',''),
      signature(payload).toUpperCase(),
    ]){
      assert.throws(()=>acceptWebhook(db,request({signature:broken})),code('INVALID_SIGNATURE'));
    }
    assert.equal(getWebhookState(db,'payments-a','evt-123').status,'pending');
  });
});
test('WHK04: valid HMAC for altered payload cannot hijack eventId',()=>{
  withDb(db=>{
    initializeWebhookInbox(db);acceptWebhook(db,request());
    const changed='{"kind":"payment.created","amount":100000}';
    assert.throws(()=>acceptWebhook(db,request({
      payload:changed,signature:signature(changed),
    })),code('EVENT_CONFLICT'));
    assert.equal(getWebhookState(db,'payments-a','evt-123').payloadSha256,
      createHash('sha256').update(payload).digest('hex'));
  });
});
test('WHK05: same event id is independent across providers',()=>{
  withDb(db=>{
    initializeWebhookInbox(db);
    acceptWebhook(db,request());
    const other=request({provider:'payments-b'});
    assert.deepEqual(acceptWebhook(db,other),{accepted:true,duplicate:false});
    assert.equal(getWebhookState(db,'payments-b','evt-123').status,'pending');
    assert.equal(getWebhookState(db,'payments-a','evt-123').status,'pending');
  });
});
test('WHK06: processing is atomic and cannot return true twice',()=>{
  withDb(db=>{
    initializeWebhookInbox(db);acceptWebhook(db,request());
    assert.deepEqual(markWebhookProcessed(db,'payments-a','evt-123'),{processed:true});
    assert.deepEqual(markWebhookProcessed(db,'payments-a','evt-123'),{processed:false});
    assert.equal(getWebhookState(db,'payments-a','evt-123').status,'processed');
  });
});
test('WHK07: replay after processing never resets state',()=>{
  withDb(db=>{
    initializeWebhookInbox(db);acceptWebhook(db,request());
    markWebhookProcessed(db,'payments-a','evt-123');
    assert.deepEqual(acceptWebhook(db,request()),{accepted:true,duplicate:true});
    assert.equal(getWebhookState(db,'payments-a','evt-123').status,'processed');
  });
});
test('WHK08: missing events are distinct from accepted events',()=>{
  withDb(db=>{
    initializeWebhookInbox(db);
    assert.equal(getWebhookState(db,'payments-a','not-found'),null);
    assert.throws(()=>markWebhookProcessed(db,'payments-a','not-found'),code('EVENT_NOT_FOUND'));
  });
});
test('WHK09: invalid identifiers and secrets do not create records',()=>{
  withDb(db=>{
    initializeWebhookInbox(db);
    for(const fields of [{provider:''},{eventId:''},{secret:''},{payload:null}]){
      assert.throws(()=>acceptWebhook(db,request(fields)),code('INVALID_INPUT'));
    }
    assert.equal(getWebhookState(db,'payments-a','evt-123'),null);
  });
});
test('WHK10: HMAC uses raw UTF-8 bytes and resists serialization changes',()=>{
  withDb(db=>{
    initializeWebhookInbox(db);
    const accented='{"name":"Zoë","emoji":"🐠"}';
    assert.deepEqual(acceptWebhook(db,request({
      eventId:'unicode',payload:accented,signature:signature(accented),
    })),{accepted:true,duplicate:false});
    const newOrder='{"emoji":"🐠","name":"Zoë"}';
    assert.throws(()=>acceptWebhook(db,request({
      eventId:'unicode',payload:newOrder,signature:signature(accented),
    })),code('INVALID_SIGNATURE'));
    assert.throws(()=>acceptWebhook(db,request({
      eventId:'unicode',payload:newOrder,signature:signature(newOrder),
    })),code('EVENT_CONFLICT'));
  });
});
test('WHK11: events, digests and status survive SQLite reopen',()=>{
  const folder=mkdtempSync(join(tmpdir(),'silkweb-webhooks-'));
  const file=join(folder,'events.sqlite');
  try{
    {const db=new DatabaseSync(file);try{
      initializeWebhookInbox(db);acceptWebhook(db,request());
      markWebhookProcessed(db,'payments-a','evt-123');
    }finally{db.close();}}
    {const db=new DatabaseSync(file);try{
      initializeWebhookInbox(db);
      assert.equal(getWebhookState(db,'payments-a','evt-123').status,'processed');
      assert.deepEqual(acceptWebhook(db,request()),{accepted:true,duplicate:true});
    }finally{db.close();}}
  }finally{rmSync(folder,{recursive:true,force:true});}
});
test('WHK12: attempted SQL injection in an event id cannot execute SQL',()=>{
  withDb(db=>{
    initializeWebhookInbox(db);acceptWebhook(db,request());
    const injected="evt'); DROP TABLE webhook_events; --";
    const rogue=request({eventId:injected});
    try{acceptWebhook(db,rogue);}
    catch(error){assert.equal(error?.code,'INVALID_INPUT');}
    assert.equal(getWebhookState(db,'payments-a','evt-123').status,'pending');
  });
});
