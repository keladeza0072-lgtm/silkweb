import assert from 'node:assert/strict';
import { NINE_VISUAL_STUDIES, NINE_VISUAL_STUDIES_VERSION } from '../dist/creativeVisualStudies.js';
assert.equal(NINE_VISUAL_STUDIES_VERSION,'user-reference-study-v1');
assert.equal(NINE_VISUAL_STUDIES.length,9);
assert.equal(new Set(NINE_VISUAL_STUDIES.map(r=>r.id)).size,9);
assert.equal(new Set(NINE_VISUAL_STUDIES.map(r=>r.sourceFile)).size,9);
for(const r of NINE_VISUAL_STUDIES){
 assert.equal(r.rights,'reference-study-only');
 assert.ok(r.compatible.length>0&&r.composition&&r.productRelationship&&r.typography&&r.creativeInstruction);
}
const portrait=NINE_VISUAL_STUDIES.find(x=>x.id==='PREMIUM-PORTRAIT-05');
assert.ok(!portrait.compatible.includes('tech'),'Beauty portrait should not be selected as tech photography');
for(const id of ['COMPARE-SPLIT-09','BENEFIT-STACK-08']){
 const r=NINE_VISUAL_STUDIES.find(x=>x.id===id);
 assert.ok(r.avoidFor.some(x=>/unsourced|unsupported|product-name-only/.test(x)),'Evidence gate required');
}
console.log('PASS: 9 reference studies cataloged with unique files, creative metadata, category and claims/rights guards.');
