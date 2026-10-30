/**
 * INV-001 held-out acceptance. Not supplied to Muse candidate.
 * Usage: SILKWEB_CANDIDATE=<absolute> node --test tests/inventory.test.mjs
 * Operator scores ONLY this independent output, never agent-written assertions.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const candidate=process.env.SILKWEB_CANDIDATE;
if(!candidate || !isAbsolute(candidate))throw new Error('SILKWEB_CANDIDATE must be an absolute path');
const modulePath=join(resolve(candidate),'dist','inventory.js');
if(!existsSync(modulePath))throw new Error('Inventory implementation is not compiled: '+modulePath);
const {
  initializeInventory,seedStock,availableStock,reserveStock,releaseStock,
}=await import(pathToFileURL(modulePath).href);
for(const [name,value] of Object.entries({initializeInventory,seedStock,
  availableStock,reserveStock,releaseStock})){
  assert.equal(typeof value,'function','Required export missing: '+name);
}
function withDb(fn){
  const db=new DatabaseSync(':memory:');
  try{return fn(db);}finally{db.close();}
}
function code(errorCode){
  return e=>e?.code===errorCode;
}
function tempDb(){
  const folder=mkdtempSync(join(tmpdir(),'silkweb-inv-accept-'));
  return {folder,file:join(folder,'inventory.sqlite')};
}
test('INV01: schema initializes twice; existing stock cannot be silently reset',()=>{
  withDb(db=>{
    initializeInventory(db);initializeInventory(db);
    seedStock(db,'SKU-A',10);
    assert.equal(availableStock(db,'SKU-A'),10);
    assert.throws(()=>seedStock(db,'SKU-A',999),code('STOCK_EXISTS'));
    assert.equal(availableStock(db,'SKU-A'),10);
  });
});
test('INV02: successful reservation subtracts exactly once with stable numeric ID',()=>{
  withDb(db=>{
    initializeInventory(db);seedStock(db,'SKU-A',5);
    const r=reserveStock(db,{key:'request-a',sku:'SKU-A',quantity:2});
    assert.equal(r.replayed,false);
    assert(Number.isSafeInteger(r.reservationId)&&r.reservationId>0);
    assert.equal(r.available,3);assert.equal(availableStock(db,'SKU-A'),3);
  });
});
test('INV03: exact retry is idempotent and does not change available quantity',()=>{
  withDb(db=>{
    initializeInventory(db);seedStock(db,'SKU-A',4);
    const first=reserveStock(db,{key:'retry-1',sku:'SKU-A',quantity:3});
    const again=reserveStock(db,{key:'retry-1',sku:'SKU-A',quantity:3});
    assert.equal(again.reservationId,first.reservationId);
    assert.equal(again.replayed,true);assert.equal(again.available,1);
    assert.equal(availableStock(db,'SKU-A'),1);
  });
});
test('INV04: reused idempotency key with different payload rejects without mutation',()=>{
  withDb(db=>{
    initializeInventory(db);seedStock(db,'SKU-A',5);seedStock(db,'SKU-B',8);
    reserveStock(db,{key:'locked',sku:'SKU-A',quantity:2});
    assert.throws(()=>reserveStock(db,{key:'locked',sku:'SKU-A',quantity:1}),code('IDEMPOTENCY_CONFLICT'));
    assert.throws(()=>reserveStock(db,{key:'locked',sku:'SKU-B',quantity:2}),code('IDEMPOTENCY_CONFLICT'));
    assert.equal(availableStock(db,'SKU-A'),3);assert.equal(availableStock(db,'SKU-B'),8);
  });
});
test('INV05: insufficient stock rejects without creating a future replay record',()=>{
  withDb(db=>{
    initializeInventory(db);seedStock(db,'SKU-A',1);
    assert.throws(()=>reserveStock(db,{key:'too-large',sku:'SKU-A',quantity:2}),code('INSUFFICIENT_STOCK'));
    const r=reserveStock(db,{key:'too-large',sku:'SKU-A',quantity:1});
    assert.equal(r.replayed,false);assert.equal(availableStock(db,'SKU-A'),0);
    assert.throws(()=>reserveStock(db,{key:'new-key',sku:'SKU-A',quantity:1}),code('INSUFFICIENT_STOCK'));
  });
});
test('INV06: release restores precisely once; key replay after release never resubtracts',()=>{
  withDb(db=>{
    initializeInventory(db);seedStock(db,'SKU-A',4);
    const r=reserveStock(db,{key:'release-key',sku:'SKU-A',quantity:3});
    assert.equal(availableStock(db,'SKU-A'),1);
    assert.deepEqual(releaseStock(db,r.reservationId),{released:true,available:4});
    assert.deepEqual(releaseStock(db,r.reservationId),{released:false,available:4});
    const again=reserveStock(db,{key:'release-key',sku:'SKU-A',quantity:3});
    assert.equal(again.reservationId,r.reservationId);assert.equal(again.replayed,true);
    assert.equal(availableStock(db,'SKU-A'),4);
  });
});
test('INV07: invalid, fractional and unsafe values are rejected before mutation',()=>{
  withDb(db=>{
    initializeInventory(db);
    for(const value of [-1,0,1.2,Number.MAX_SAFE_INTEGER+1,Number.NaN]){
      assert.throws(()=>seedStock(db,'BAD',value),code('INVALID_INPUT'));
    }
    seedStock(db,'SKU-A',5);
    for(const quantity of [-1,0,1.5,Number.MAX_SAFE_INTEGER+1,Number.NaN]){
      assert.throws(()=>reserveStock(db,{key:'invalid-'+String(quantity),sku:'SKU-A',quantity}),
        code('INVALID_INPUT'));
    }
    assert.throws(()=>reserveStock(db,{key:'',sku:'SKU-A',quantity:1}),code('INVALID_INPUT'));
    assert.throws(()=>seedStock(db,'',4),code('INVALID_INPUT'));
    assert.equal(availableStock(db,'SKU-A'),5);
  });
});
test('INV08: unknown SKU and reservation are failures, not false success',()=>{
  withDb(db=>{
    initializeInventory(db);
    assert.throws(()=>availableStock(db,'UNKNOWN'),code('STOCK_NOT_FOUND'));
    assert.throws(()=>reserveStock(db,{key:'missing',sku:'UNKNOWN',quantity:1}),code('STOCK_NOT_FOUND'));
    assert.throws(()=>releaseStock(db,999),code('RESERVATION_NOT_FOUND'));
  });
});
test('INV09: malicious SKU is a literal identifier; SQL text never executes',()=>{
  withDb(db=>{
    initializeInventory(db);
    seedStock(db,'SKU-A',3);
    const injected="SKU-X'); DROP TABLE inventory_items; --";
    // This identifier may be rejected by validation, but cannot execute SQL.
    try{seedStock(db,injected,2);}catch(e){assert.equal(e.code,'INVALID_INPUT');}
    assert.equal(availableStock(db,'SKU-A'),3);
    reserveStock(db,{key:'safe',sku:'SKU-A',quantity:1});
    assert.equal(availableStock(db,'SKU-A'),2);
  });
});
test('INV10: stock, reservation and replay survive reopened SQLite connection',()=>{
  const {folder,file}=tempDb();
  try{
    let first;
    {const db=new DatabaseSync(file);try{
      initializeInventory(db);seedStock(db,'SKU-A',7);
      first=reserveStock(db,{key:'persist-1',sku:'SKU-A',quantity:4});
    }finally{db.close();}}
    {const db=new DatabaseSync(file);try{
      initializeInventory(db);
      assert.equal(availableStock(db,'SKU-A'),3);
      const again=reserveStock(db,{key:'persist-1',sku:'SKU-A',quantity:4});
      assert.equal(again.replayed,true);assert.equal(again.reservationId,first.reservationId);
      assert.equal(availableStock(db,'SKU-A'),3);
    }finally{db.close();}}
  }finally{rmSync(folder,{recursive:true,force:true});}
});
function startWorker(worker,args){
  const child=spawn(process.execPath,[worker,...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',part=>out+=part);
  child.stderr.on('data',part=>err+=part);
  const done=new Promise(resolve=>child.on('close',exit=>resolve({exit,out,err})));
  return {done,child};
}
test('INV11: two independent Node processes cannot oversell the same unit',async()=>{
  const {folder,file}=tempDb();
  const gate=join(folder,'release');
  const worker=fileURLToPath(new URL('../workers/inventory-race.mjs',import.meta.url));
  try{
    const db=new DatabaseSync(file);
    try{initializeInventory(db);seedStock(db,'RACE',1);}finally{db.close();}
    const one=startWorker(worker,[modulePath,file,gate,'race-key-a']);
    const two=startWorker(worker,[modulePath,file,gate,'race-key-b']);
    await new Promise(r=>setTimeout(r,200));
    writeFileSync(gate,'start');
    const results=await Promise.all([one.done,two.done]);
    assert(results.every(r=>r.exit===0),JSON.stringify(results));
    const items=results.map(r=>JSON.parse(r.out.trim()));
    assert.equal(items.filter(x=>x.status==='reserved').length,1,
      'Exactly one different key may reserve one unit: '+JSON.stringify(items));
    const inspect=new DatabaseSync(file);
    try{assert.equal(availableStock(inspect,'RACE'),0);}finally{inspect.close();}
  }finally{rmSync(folder,{recursive:true,force:true});}
},{timeout:15000});
