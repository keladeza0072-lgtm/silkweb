import assert from 'node:assert/strict';
import sharp from 'sharp';
import {buildMuseImagePrompt} from '../dist/museImage.js';
import {selectCreativeDirectorReferences} from '../dist/creativeDirector.js';
import {finishCreativeDirectorAd} from '../dist/creativeDirectorFinish.js';
const input={productName:'INIU compact power bank',objective:'launch-product',upload:null,differentiator:'',price:'',currency:'',specialOffer:''};
const plans=['cold','warm','hot'].map((audience,i)=>({id:'ad-'+i,audience,headline:['Carry the essentials','Made for the day','Meet your next carry'][i],body:'Discover the product.',cta:'Explore',angle:'Physical use',visualPrompt:'Real human-scale photography'}));
const selected=selectCreativeDirectorReferences(input);
assert.equal(new Set(selected.selections.map(x=>x.family)).size,3);
process.env.SILKWEB_CREATIVE_DIRECTOR='on';
for(const plan of plans){
 const prompt=buildMuseImagePrompt(plan,input);
 const reference=selected.selections.find(x=>x.audience===plan.audience);
 assert.ok(prompt.includes(reference.scene),'Correct scene must be in prompt');
 assert.ok(!prompt.includes('Reserved headline region'),'Old rigid blueprint must not leak into prompt');
 assert.ok(prompt.includes('Product interaction:'));
}
process.env.SILKWEB_CREATIVE_DIRECTOR='off';
assert.ok(buildMuseImagePrompt(plans[0],input).includes('Creative composition class:'),'Old fallback path preserved');
process.env.SILKWEB_CREATIVE_DIRECTOR='on';
const png=await sharp({create:{width:1080,height:1350,channels:3,background:'#425C78'}}).png().toBuffer();
for(const reference of selected.selections){
 const result=await finishCreativeDirectorAd(png,{headline:'Explore the everyday',body:'See what is new.',cta:'Discover more'},reference);
 assert.equal(result.ok,true,'Editorial finisher');
 assert.equal(result.width,1080);assert.equal(result.height,1350);
 const out=Buffer.from(result.pngDataUrl.split(',')[1],'base64');
 const meta=await sharp(out).metadata();assert.equal(meta.format,'png');
}
console.log('PASS: Director prompts are product-aware; 3 editorial finishes work; original fallback remains.');
