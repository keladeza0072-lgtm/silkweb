import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCreativePrinciples,CREATIVE_EXECUTION_CRITERIA} from '../dist/creativePrincipleEvaluator.js';
import {selectImageAdStrategies} from '../dist/imageAdStrategy.js';
import {listLivePrinciples} from '../dist/knowledgePack.js';

const products=['INIU compact power bank','Gentle face serum','Roasted coffee beans','Cotton summer dress','Ceramic table lamp'];
const sample=(name)=>[
 {id:'1',audience:'cold',angle:'Everyday product discovery',headline:name+' for everyday moments',body:'See how '+name+' fits into an everyday routine.',cta:'Learn More',visualPrompt:'A realistic daylight product scene.'},
 {id:'2',audience:'warm',angle:'Product relevance and consideration',headline:'A closer look at '+name,body:'Explore the details of '+name+' before you decide.',cta:'See Details',visualPrompt:'Product on a table in soft light.'},
 {id:'3',audience:'hot',angle:'Direct action and product detail',headline:'Explore '+name+' today',body:'View the '+name+' product details.',cta:'Explore Product',visualPrompt:'Clean studio product hero.'},
];
test('each eligible book principle has concrete intent, examples and a human-review question',()=>{
 const live=listLivePrinciples();
 assert.ok(live.length>=8);
 for(const principle of live){
  const rule=CREATIVE_EXECUTION_CRITERIA[principle.id];
  assert.ok(rule,'missing criterion '+principle.id);
  for(const field of ['intent','strongExample','weakExample','observableCheck','humanReviewQuestion']){
   assert.ok(rule[field].length>15, principle.id+' missing '+field);
  }
 }
 assert.equal(CREATIVE_EXECUTION_CRITERIA['schwartz-sophistication-shift'],undefined);
});
for(const productName of products){
 test('v2 assesses three audiences with traceable book principles: '+productName,()=>{
  const brief={productName,objective:'launch-product',upload:null,differentiator:'',price:'',currency:'',specialOffer:''};
  const strategies=selectImageAdStrategies(brief).strategies;
  const result=evaluateCreativePrinciples(sample(productName),brief);
  assert.equal(result.version,'creative-intelligence-v2');
  assert.deepEqual(result.assessments.map(x=>x.principleId),strategies.flatMap(x=>x.principleIds));
  assert.ok(result.assessments.every(x=>x.work&&x.humanReviewQuestion&&x.verificationStatus!=='source-verified'));
  assert.ok(result.assessments.some(x=>x.status==='needs-human-review'),'should never claim all persuasion is objectively proven');
  assert.ok(result.note.includes('does not mean'));
 });
}
test('weak unsupported claim triggers a flagged v2 audit and prevents image eligibility',()=>{
 const brief={productName:'INIU compact power bank',objective:'launch-product',upload:null,differentiator:'',price:'',currency:'',specialOffer:''};
 const plans=sample('INIU compact power bank');
 plans[0].headline='The fastest power bank in the world';
 const r=evaluateCreativePrinciples(plans,brief);
 assert.equal(r.eligibleForImages,false);
 assert.ok(r.copyGateIssues.length>0);
 assert.ok(r.assessments.some(x=>x.status==='flagged'));
});
test('incomplete copy is flagged rather than presumed persuasive',()=>{
 const brief={productName:'INIU compact power bank',objective:'launch-product',upload:null,differentiator:'',price:'',currency:'',specialOffer:''};
 const plans=sample('INIU compact power bank');
 plans[2].cta='';
 const r=evaluateCreativePrinciples(plans,brief);
 assert.ok(r.assessments.some(x=>x.principleId==='cialdini-small-step'&&x.status==='flagged'));
});
