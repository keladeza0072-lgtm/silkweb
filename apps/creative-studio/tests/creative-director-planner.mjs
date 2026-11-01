import assert from 'node:assert/strict';
import {buildImageAdPlanPrompt} from '../dist/imageAdsPlan.js';
import {selectCreativeDirectorReferences} from '../dist/creativeDirector.js';
const products=['INIU compact power bank','Gentle face serum','Roasted coffee beans','Cotton summer dress'];
for(const productName of products){
 const input={productName,objective:'launch-product',upload:null,differentiator:'',price:'',currency:'',specialOffer:''};
 const selections=selectCreativeDirectorReferences(input).selections;
 process.env.SILKWEB_CREATIVE_DIRECTOR='on';
 const enhanced=buildImageAdPlanPrompt(input);
 assert.ok(enhanced.length<=8000,'Prompt exceeds existing 8000 character ceiling: '+enhanced.length);
 assert.ok(enhanced.includes('SilkWeb Creative Director'));
 for(const selection of selections){
  assert.ok(enhanced.includes(selection.referenceId),'Missing chosen reference '+selection.referenceId);
  assert.ok(enhanced.includes(selection.interaction),'Missing product interaction');
 }
 process.env.SILKWEB_CREATIVE_DIRECTOR='off';
 const previous=buildImageAdPlanPrompt(input);
 assert.ok(!previous.includes('SilkWeb Creative Director —'));
 assert.ok(previous.includes('Supplied facts'));
 console.log('PASS',productName,enhanced.length+' chars','references:',selections.map(x=>x.referenceId).join(', '));
}
delete process.env.SILKWEB_CREATIVE_DIRECTOR;
console.log('PASS: Four categories, Spark plan context, prompt budget and off-flag behavior.');
