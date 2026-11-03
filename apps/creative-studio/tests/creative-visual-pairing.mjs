import assert from 'node:assert/strict';
import {selectVisualStudyPairs} from '../dist/creativeVisualPairing.js';
import {buildImageAdPlanPrompt} from '../dist/imageAdsPlan.js';
import {buildMuseImagePrompt} from '../dist/museImage.js';
const cases=[
 ['INIU compact power bank','TECH-HAND-01'],
 ['Gentle face serum','PREMIUM-PORTRAIT-05'],
 ['Roasted coffee beans','BOLD-GRAPHIC-06'],
 ['Cotton summer dress','LIFESTYLE-DESK-02'],
 ['Ceramic table lamp','STUDIO-PLINTH-03'],
];
for(const [name] of cases){
 const input={productName:name,objective:'launch-product',upload:null,differentiator:'',price:'',currency:'',specialOffer:''};
 const result=selectVisualStudyPairs(input);
 assert.equal(result.length,3);
 assert.equal(new Set(result.map(x=>x.referenceId)).size,3,'Visual studies must be distinct');
 assert.ok(result.every(x=>x.hasClearedImage===false),'Reference studies are never production-cleared images');
 assert.ok(result.every(x=>!['COMPARE-SPLIT-09','BENEFIT-STACK-08'].includes(x.referenceId)),'No unverified comparative or benefit ads');
 process.env.SILKWEB_CREATIVE_DIRECTOR='on';
 const prompt=buildImageAdPlanPrompt(input);
 assert.ok(prompt.length<=8000,'Prompt exceeds ceiling ('+prompt.length+')');
 for(const match of result){
  assert.ok(prompt.includes(match.referenceId),'Missing image study '+match.referenceId);
  const plan={id:'ad-'+match.audience,audience:match.audience,headline:'Discover the design',body:'Explore the product',cta:'Learn more',angle:'Editorial',visualPrompt:'Original brand-relevant photograph'};
  assert.ok(buildMuseImagePrompt(plan,input).includes('PRIMARY reference study: '+match.referenceId),'Generator does not use same study');
 }
 process.env.SILKWEB_CREATIVE_DIRECTOR='off';
 console.log(name, result.map(x=>x.referenceId).join(' / '),prompt.length);
}
delete process.env.SILKWEB_CREATIVE_DIRECTOR;
console.log('PASS: 5 categories, 3 distinct visual studies, reference-informed Spark plans, no unlicensed image usage.');
