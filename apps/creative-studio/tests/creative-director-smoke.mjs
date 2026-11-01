import assert from 'node:assert/strict';
import {selectCreativeDirectorReferences,inferProductCategory,buildDirectorImagePrompt} from '../dist/creativeDirector.js';
const cases=[
 ['INIU compact power bank','tech'],
 ['Gentle face serum','beauty'],
 ['Cotton summer dress','fashion'],
 ['Roasted coffee beans','food'],
 ['Ceramic table lamp','home']
];
for(const [productName,category] of cases){
 const input={productName,objective:'launch-product',upload:null,differentiator:'',price:'',currency:'',specialOffer:''};
 const result=selectCreativeDirectorReferences(input);
 assert.equal(inferProductCategory(productName),category);
 assert.equal(result.category,category);
 assert.equal(result.selections.length,3);
 assert.equal(new Set(result.selections.map(x=>x.referenceId)).size,3);
 assert.equal(new Set(result.selections.map(x=>x.family)).size,3);
 const plan={id:'ad-1',audience:'cold',headline:'Discover the details',body:'Explore the product.',cta:'Learn more',angle:'Discovery',visualPrompt:'Authentic commercial story'};
 for(const item of result.selections){
  const prompt=buildDirectorImagePrompt(plan,input,item);
  assert.ok(prompt.includes(item.interaction));
  assert.ok(prompt.includes('physically plausible'));
  assert.ok(!prompt.includes('opaque headline panel'));
 }
 console.log(category.padEnd(8),productName);
 for(const item of result.selections)console.log(' ',item.audience.padEnd(5),item.referenceId.padEnd(19),item.family);
}
console.log('PASS: Five categories, unique reference matching, diverse scenes, physically grounded prompts.');
