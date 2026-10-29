import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discover } from '../dist/discovery.js';

const manifests = [
  {
    id:'booking-slot-guard',version:'0.1.0',
    capabilities:['booking-creation','slot-guard','booking-cancellation'],
    invariants:['BEGIN IMMEDIATE transaction prevents duplicate active bookings; 30 minute slots.'],
    runtime:{stack:'node24+sqlite',node:'>=24',dependencies:{zod:'4.6.7'}},
  },
  {
    id:'booking-reservation-kernel',version:'0.2.0',
    capabilities:['booking-creation','atomic-slot-conflict-prevention','idempotent-booking',
      'atomic-cancellation','multi-process-sqlite'],
    invariants:['Retries never double book an appointment with atomic slots and idempotency.'],
    runtime:{stack:'node24+sqlite',node:'>=24',dependencies:{zod:'4.6.7'}},
  },
  {
    id:'booking-schema',version:'0.1.0',capabilities:['booking-schema','sqlite-tables'],
    invariants:['SQLite tables for 30 minute bookings.'],
    runtime:{stack:'node24+sqlite',node:'>=24',dependencies:{zod:'4.6.7'}},
  },
  {
    id:'registry-loader',version:'0.1.0',capabilities:['registry-loading','manifest-filtering'],
    invariants:['Loads JSON manifests with deterministic filtering.'],
    runtime:{stack:'node24+sqlite',node:'>=24',dependencies:{zod:'4.6.7'}},
  },
];

const ids = (q)=>discover(manifests,q).map(x=>x.manifest.id);
test('inventory ordering is deterministic and backward compatible', ()=>{
  assert.deepEqual(ids({}),['booking-reservation-kernel','booking-schema','booking-slot-guard','registry-loader']);
  assert.deepEqual(ids({capabilities:['slot-guard']}),['booking-slot-guard']);
  assert.deepEqual(ids({stack:'node20+postgres'}),[]);
  assert.deepEqual(ids({capabilities:['slot-guard','idempotent-booking']}),[]);
});
test('exact ID lookup outranks all partial matches',()=>{
  const exact=discover(manifests,{query:'booking-slot-guard@0.1.0'});
  assert.equal(exact[0].manifest.id,'booking-slot-guard');
  assert.equal(exact[0].match.score,1000);
  assert.deepEqual(exact[0].match.signals,['exact-component-id']);
});
test('Muse booking query prioritizes certified reservation kernel deterministically', ()=>{
  const query='reservation booking appointment API';
  for(let i=0;i<5;i++){
    const results=discover([...manifests].reverse(),{query});
    assert.equal(results[0].manifest.id,'booking-reservation-kernel');
    assert(results[0].match.score>results[1].match.score);
    assert(results[0].match.matchedTerms.includes('booking'));
  }
});
test('intent matching recognizes retries, concurrency, idempotency and schema',()=>{
  for (const query of [
    'concurrent bookings with retries API',
    'idempotent reservations',
    'reservation with exactly-once requests',
    'appointment idempotency',
    'prevent double booking with retries',
  ]) {
    assert.equal(ids({query})[0],'booking-reservation-kernel',query);
  }
  assert.equal(ids({query:'booking schema'})[0],'booking-schema');
  assert.equal(ids({query:'30-minute booking slot'})[0],'booking-slot-guard');
});
test('unrelated and generic queries do not return noisy components',()=>{
  for(const query of [
    'interplanetary coffee roasting',
    'booking slot interplanetary coffee roasting',
    'coffee roasting API',
    'generic API server',
    'API',
    'payment processor',
    'cloud distributed caches',
  ]) assert.deepEqual(ids({query}),[],query);
});
test('Node version comparison enforces >=24 and rejects invalid/unsupported requirements',()=>{
  assert.equal(ids({nodeVersion:'v24.15.0'}).length,4);
  assert.deepEqual(ids({nodeVersion:'23.9.0'}),[]);
  assert.equal(ids({nodeVersion:'25.0.0'}).length,4);
  const minimum = {...manifests[0],runtime:{...manifests[0].runtime,node:'>=24.15.1'}};
  assert.deepEqual(discover([minimum],{nodeVersion:'24.15.0'}),[]);
  assert.equal(discover([minimum],{nodeVersion:'24.15.1'}).length,1);
  const unsupported = {...minimum,runtime:{...minimum.runtime,node:'^24'}};
  assert.deepEqual(discover([unsupported],{nodeVersion:'24.15.1'}),[]);
  assert.deepEqual(ids({nodeVersion:'not-a-version'}),[]);
});
test('target installed dependencies use exact, all-required matching',()=>{
  assert.equal(ids({installedDependencies:{zod:'4.6.7'}}).length,4);
  assert.deepEqual(ids({installedDependencies:{zod:'4.6.6'}}),[]);
  assert.deepEqual(ids({installedDependencies:{}}),[]);
  assert.deepEqual(ids({installedDependencies:{zod:'^4.6.7'}}),[]);
  assert.deepEqual(ids({nodeVersion:'23',installedDependencies:{zod:'4.6.7'}}),[]);
});
test('match reasons are grounded metadata signals, bounded and free of source text',()=>{
  const hits=discover(manifests,{query:'concurrent bookings with retries API'});
  assert(hits.length>0);
  for(const {match} of hits){
    assert(Number.isInteger(match.score) && match.score>=0);
    assert(match.signals.length<=8);
    for(const signal of match.signals) assert.match(signal,/^(id|capability|invariant):[a-z0-9]+$/);
  }
});
