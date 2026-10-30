#!/usr/bin/env node
/**
 * CI ONLY: refresh the ORIGINAL FIVE verified components in an ephemeral
 * GitHub Actions checkout after modifications to registry runner/test scope.
 * Real allowlisted builds/tests and source fingerprints are re-run.
 * No model calls. CI never commits or publishes refreshed evidence.
 * Inventory remains UNVERIFIED until the operator's separate provenance gate.
 */
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const {loadRegistry,runVerification,validateComponent}=await import(
  pathToFileURL(join(repo,'packages/registry/dist/index.js')).href
);
const list=[
  ['booking-schema','0.1.0','registry:booking-tests'],
  ['booking-validation','0.1.0','registry:booking-tests'],
  ['booking-slot-guard','0.1.0','registry:booking-tests'],
  ['booking-reservation-kernel','0.2.0','registry:reservation-v2-tests'],
  ['registry-loader','0.1.0','registry:loader-tests'],
];
const all=loadRegistry(join(repo,'registry-data/manifests'));
const inventory=all.find(x=>x.id==='inventory-reservation');
const verifiedCount=all.filter(x=>x.verification.status==='verified').length;
if(all.length!==6|| !inventory ||
  !['unverified','verified'].includes(inventory.verification.status) ||
  verifiedCount!==(inventory.verification.status==='verified'?6:5)){
  throw new Error('CI trust preflight refused unexpected manifest inventory/status');
}
for(const [id,version,commandKey] of list){
  const manifest=all.find(x=>x.id===id&&x.version===version);
  if(!manifest)throw new Error('Missing '+id);
  const result=runVerification(repo,manifest,all,{
    commandKey,evidenceDir:'registry-data/evidence',
  });
  if(!result.passed)throw new Error('Failed real CI re-verification for '+id);
  const checked=validateComponent(repo,manifest,all,{evidenceDir:'registry-data/evidence'});
  if(!checked.valid||checked.code!=='OK')throw new Error(
    'Invalid CI evidence for '+id+': '+checked.code+' '+checked.reason);
  process.stdout.write('CI-ONLY REVERIFIED: '+id+'\n');
}
if(inventory.verification.status==='verified'){
  const checked=validateComponent(repo,inventory,all,{evidenceDir:'registry-data/evidence'});
  if(!checked.valid||checked.code!=='OK')throw new Error(
    'Certified inventory rejected by CI: '+checked.code+' '+checked.reason);
  process.stdout.write('CI VERIFIED: inventory certificate is valid; no inference\n');
}else{
  process.stdout.write('CI VERIFIED: inventory remains UNVERIFIED and unservable\n');
}
process.stdout.write('CI-ONLY: Original five really reverified; ZERO MODEL CALLS\n');
