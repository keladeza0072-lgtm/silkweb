import assert from 'node:assert/strict';
import {buildImageAdPlanPrompt} from '../dist/imageAdsPlan.js';
import {COPY_INTELLIGENCE_VERSION,scoreHeadlineDiagnostics} from '../dist/creativeCopyIntelligence.js';
const products=['INIU compact power bank','Gentle face serum','Roasted coffee beans','Cotton summer dress','Ceramic table lamp'];
const old=process.env.SILKWEB_CREATIVE_DIRECTOR;
try{
 process.env.SILKWEB_CREATIVE_DIRECTOR='on';
 for(const productName of products){
  const p=buildImageAdPlanPrompt({productName,objective:'launch-product',upload:null,differentiator:'',price:'',currency:'',specialOffer:''});
  assert.ok(p.length<=8000,'Prompt exceeds 8k chars: '+productName+' '+p.length);
  assert.ok(p.includes(COPY_INTELLIGENCE_VERSION));
  assert.ok(p.includes('Cialdini:'));
  assert.ok(p.includes('Product: '+productName),'Full product name must remain present');
  assert.ok(!p.includes('[facts truncated to fit prompt budget]'),'Never silently drop customer facts');
  assert.ok(p.includes('Reject generic openings'));
  assert.ok(p.includes('INTERNAL HEADLINE COMPETITION'));
  assert.ok(p.includes('at least five meaningfully different headlines'));
  assert.ok(p.includes('SELF-CRITIQUE'));
  console.log(productName, p.length);
 }
 assert.equal(scoreHeadlineDiagnostics('Considering a power bank?').pass,false);
 assert.equal(scoreHeadlineDiagnostics('Hey - it\'s here, come see').pass,false);
 assert.equal(scoreHeadlineDiagnostics('Your day. Your backup power.').pass,true);
 console.log('PASS: persuasive copy guidance active, five product prompts within budget, weak hooks flagged.');
}finally{if(old===undefined)delete process.env.SILKWEB_CREATIVE_DIRECTOR;else process.env.SILKWEB_CREATIVE_DIRECTOR=old;}
