import assert from 'node:assert/strict';
import {buildImageAdPlanPromptWithProvenance} from '../dist/imageAdsPlan.js';
import {getPrinciple,listLivePrinciples} from '../dist/knowledgePack.js';
import {buildImageAdStrategySection} from '../dist/imageAdStrategy.js';

// Deterministic proof that every live ad plan is given at least two
// approved book-derived principles and the exact operational instructions.
// This does NOT prove the model internally followed them or validate its quality.
const briefs=[
 'INIU compact power bank',
 'Gentle face serum',
 'Roasted coffee beans',
 'Cotton summer dress',
 'Ceramic table lamp',
];
const old=process.env.SILKWEB_CREATIVE_DIRECTOR;
try{
 process.env.SILKWEB_CREATIVE_DIRECTOR='on';
 const usable=listLivePrinciples();
 assert.ok(usable.length>=8);
 for(const productName of briefs){
  const brief={productName,objective:'launch-product',upload:null,differentiator:'',price:'',currency:'',specialOffer:''};
  const {prompt,provenance}=buildImageAdPlanPromptWithProvenance(brief);
  const {section}=buildImageAdStrategySection(brief);
  assert.ok(!prompt.includes('[facts truncated to fit prompt budget]'),productName+' facts truncated');
  assert.ok(prompt.length<=8000,productName+' over prompt budget');
  assert.equal(provenance.strategies.length,3);
  assert.deepEqual(provenance.strategies.map(x=>x.audience),['cold','warm','hot']);
  const works=new Set();
  for(const strategy of provenance.strategies){
   assert.ok(strategy.principleIds.length>=2,productName+' '+strategy.audience+' lacks principle guidance');
   for(const id of strategy.principleIds){
    const p=getPrinciple(id);
    assert.ok(p, 'unknown principle '+id);
    assert.notEqual(p.verificationStatus,'pending-review',id+' unapproved');
    assert.ok(prompt.includes(id+': '+p.instruction),id+' instruction missing from actual model prompt');
    assert.ok(section.includes(id+': '+p.instruction),id+' instruction missing from strategy section');
    works.add(p.work);
   }
  }
  assert.ok(works.has('Breakthrough Advertising'));
  assert.ok(works.has('Ogilvy on Advertising'));
  assert.ok(works.has('The Adweek Copywriting Handbook'));
  assert.ok(works.has('Influence'));
  assert.ok(prompt.includes('at least five meaningfully different headlines'));
  assert.ok(prompt.includes('COPY MUST SELL THE REASON TO CARE'));
  console.log('PASS: '+productName+' | 3 internal strategies | '+works.size+' source works | '+prompt.length+' chars');
 }
 console.log('PASS: All five product briefs include approved book-inspired guidance in actual planner prompts.');
 console.log('NOTE: Editorial paraphrases, not source-verified quotations; application by the model requires qualitative evaluation.');
}finally{
 if(old===undefined) delete process.env.SILKWEB_CREATIVE_DIRECTOR;
 else process.env.SILKWEB_CREATIVE_DIRECTOR=old;
}
