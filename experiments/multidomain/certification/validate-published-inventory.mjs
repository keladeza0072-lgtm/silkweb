#!/usr/bin/env node
/**
 * Cross-platform, read-only verification of the SIX PUBLISHED certificates.
 *
 * Runs in a clean Linux checkout AFTER a deterministic registry build, but
 * BEFORE any CI-only evidence refresh. It never edits evidence, rewrites
 * manifests, runs paid models, or silently "repairs" stale certificates.
 * This is a separate proof from the operator's Windows certification.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const {loadRegistry,validateComponent,selectVerifiedManifests}=await import(
  pathToFileURL(join(repo,'packages/registry/dist/index.js')).href
);
const evidenceDir='registry-data/evidence';
const all=loadRegistry(join(repo,'registry-data/manifests'));
const expected=[
  'booking-schema@0.1.0',
  'booking-validation@0.1.0',
  'booking-slot-guard@0.1.0',
  'booking-reservation-kernel@0.2.0',
  'registry-loader@0.1.0',
  'inventory-reservation@0.1.0',
].sort();
const actual=all.map(m=>m.id+'@'+m.version).sort();
assert.deepEqual(actual,expected,'Unexpected published registry component set');
const expectedSourceHash='3bc564618668ccfccebccff9cd8507ced3e8b445f09708fd12d8c2b11126bcf0';
const sourceSha=createHash('sha256').update(readFileSync(
  join(repo,'packages/registry/src/inventory.ts')
)).digest('hex');
assert.equal(sourceSha,expectedSourceHash,
  'Published inventory source changed from independently tested Muse candidate');
for(const m of all){
  const key=m.id+'@'+m.version;
  assert.equal(m.verification.status,'verified',
    key+' is not declared verified');
  const result=validateComponent(repo,m,all,{evidenceDir});
  assert.equal(result.code,'OK',
    key+' stored certification failed on clean Linux: '+result.code+' '+result.reason);
  assert.equal(result.valid,true,key+' stored certification invalid');
  const evidenceFile=join(repo,evidenceDir,m.id+'-'+m.version+'.json');
  const evidence=JSON.parse(readFileSync(evidenceFile,'utf8'));
  assert.equal(evidence.outcome,'pass',key+' stored evidence was not a real pass');
  assert.equal(evidence.exitCode,0,key+' evidence has nonzero exit');
  assert(evidence.build.artifacts.length>0,
    key+' evidence must bind actual compiled build outputs');
  process.stdout.write('PUBLISHED CERTIFICATE VALID ON LINUX: '+key+'\n');
}
const selected=selectVerifiedManifests(repo,all,{evidenceDir});
assert.deepEqual(selected.rejected,[],
  'Certified-only registry refused at least one published component');
assert.deepEqual(selected.verified.map(m=>m.id+'@'+m.version).sort(),expected,
  'Verified-only selection must include all six published components');
process.stdout.write(
  'PASS: six original, unmodified Windows-origin evidence files validate on Linux; '+
  'inventory source SHA256='+sourceSha+'; ZERO MODEL CALLS\n'
);
