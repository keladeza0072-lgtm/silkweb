import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const base=join(repo,'experiments/multidomain');
const v1=readFileSync(join(base,'heldout/inventory.test.mjs'),'utf8');
const v2=readFileSync(join(base,'heldout/inventory-v2.test.mjs'),'utf8');

test('INV07-v2 permits zero stock exactly as frozen INV-001 contract specifies',()=>{
  const contract=readFileSync(join(base,'contracts/inventory-reservation.md'),'utf8');
  assert.match(contract,/stock must be a nonnegative safe integer/);
  assert.match(v1,/for\(const value of \[-1,0,1\.2,/);
  assert.match(v2,/for\(const value of \[-1,1\.2,/);
  assert.match(v2,/seedStock\(db,'ZERO-IS-VALID',0\)/);
  assert.match(v2,/assert\.equal\(availableStock\(db,'ZERO-IS-VALID'\),0\)/);
  assert.match(v2,/for\(const quantity of \[-1,0,1\.5,/);
  // Exact minimal correction only. Neither version's source is rewritten.
  const before=[
    '    for(const value of [-1,0,1.2,Number.MAX_SAFE_INTEGER+1,Number.NaN]){',
    "      assert.throws(()=>seedStock(db,'BAD',value),code('INVALID_INPUT'));",
    '    }',
    "    seedStock(db,'SKU-A',5);",
  ].join('\n');
  const after=[
    '    for(const value of [-1,1.2,Number.MAX_SAFE_INTEGER+1,Number.NaN]){',
    "      assert.throws(()=>seedStock(db,'BAD',value),code('INVALID_INPUT'));",
    '    }',
    '    // INV-001 contract explicitly allows zero initial stock (nonnegative).',
    '    // Regression guard: zero must be ACCEPTED, not treated as invalid.',
    "    seedStock(db,'ZERO-IS-VALID',0);",
    "    assert.equal(availableStock(db,'ZERO-IS-VALID'),0);",
    "    seedStock(db,'SKU-A',5);",
  ].join('\n');
  assert(v1.includes(before));
  assert.equal(v2,v1.replace(before,after));
});
test('offline correction cannot invent success or overwrite without original Muse evidence',()=>{
  const folder=mkdtempSync(join(tmpdir(),'silkweb-inv07-v2-negative-'));
  const root=join(folder,'attempt');
  try{
    const script=join(base,'reconcile-inventory-v2.mjs');
    const run=spawnSync(process.execPath,[script,'--root',root],{
      encoding:'utf8',timeout:15000,
    });
    assert.notEqual(run.status,0);
    assert.match(run.stderr,/CORRECTION REFUSED|Missing/);
    assert(!existsSync(join(root,'operator/evaluation-inventory-v2.json')));
  }finally{rmSync(folder,{recursive:true,force:true});}
});

test('INV07-v2 approved-delta guard works with Windows CRLF and rejects extra edits',()=>{
  const normalize=text=>text.replace(/\r\n/g,'\n');
  const before=[
    '    for(const value of [-1,0,1.2,Number.MAX_SAFE_INTEGER+1,Number.NaN]){',
    "      assert.throws(()=>seedStock(db,'BAD',value),code('INVALID_INPUT'));",
    '    }',
    "    seedStock(db,'SKU-A',5);",
  ].join('\n');
  const after=[
    '    for(const value of [-1,1.2,Number.MAX_SAFE_INTEGER+1,Number.NaN]){',
    "      assert.throws(()=>seedStock(db,'BAD',value),code('INVALID_INPUT'));",
    '    }',
    '    // INV-001 contract explicitly allows zero initial stock (nonnegative).',
    '    // Regression guard: zero must be ACCEPTED, not treated as invalid.',
    "    seedStock(db,'ZERO-IS-VALID',0);",
    "    assert.equal(availableStock(db,'ZERO-IS-VALID'),0);",
    "    seedStock(db,'SKU-A',5);",
  ].join('\n');
  const approved=(rawOriginal,rawCorrected)=>{
    const original=normalize(rawOriginal);
    const updated=normalize(rawCorrected);
    return original.includes(before) && original.replace(before,after)===updated;
  };
  assert(approved(v1,v2),'Original LF check should still pass');
  assert(approved(v1.replace(/\n/g,'\r\n'),v2.replace(/\n/g,'\r\n')),
    'Windows CRLF original + corrected should be accepted');
  assert(approved(v1.replace(/\n/g,'\r\n'),v2),
    'Mixed Git checkout line endings should be accepted');
  assert(!approved(v1.replace(/\n/g,'\r\n'),v2.replace('INV08:','INV08-BYPASS:')),
    'Unrelated edits must still be rejected');
  const reconciliation=readFileSync(join(base,'reconcile-inventory-v2.mjs'),'utf8');
  assert.match(reconciliation,/replace\(\/\\r\\n\/g,'\\n'\)/,
    'Correction script must actually normalize only CRLF line endings');
});
