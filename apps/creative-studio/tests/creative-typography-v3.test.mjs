import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {finishTypographyV3} from '../dist/creativeTypographyV3.js';
import {selectCreativeDirectorReferences} from '../dist/creativeDirector.js';
const fonts=resolve('assets/fonts');
for(const font of ['Oswald.ttf','DMSans.ttf','PlayfairDisplay.ttf']){
 const bytes=await readFile(resolve(fonts,font));
 assert.ok(bytes.length>10000,'Missing licensed font: '+font);
}
const input={productName:'INIU compact power bank',objective:'launch-product',differentiator:'',price:'',currency:'',specialOffer:'',upload:null};
const scene=await sharp({create:{width:1080,height:1350,channels:3,background:'#d5dee8'}}).png().toBuffer();
const choices=selectCreativeDirectorReferences(input).selections;
for(const [index,choice] of choices.entries()){
 test('v3 creates complete ad with headline, body and visible CTA for '+choice.family,async()=>{
  const copy={headline:['Phone Dying Before You Get Home','The Cafe Has No Free Outlets','Keep Backup Power Within Reach'][index],
   body:'Carry your INIU compact power bank for everyday backup when you are away from home.',
   cta:['Learn More','See Details','Explore Product'][index]};
  const result=await finishTypographyV3(scene,copy,choice);
  assert.equal(result.ok,true,result.ok?'':result.reason);
  assert.equal(result.width,1080);
  assert.equal(result.height,1350);
  assert.equal(result.diagnostics.ctaRendered,true);
  assert.ok(result.diagnostics.textBottom<=result.diagnostics.protectedProductRegionStarts);
  assert.ok(result.diagnostics.headlineLines.length>=1);
  assert.ok(result.diagnostics.bodyLines.length>=1);
  const png=Buffer.from(result.pngDataUrl.split(',')[1],'base64');
  const meta=await sharp(png).metadata();
  assert.equal(meta.format,'png');
  assert.equal(meta.width,1080);
  assert.equal(meta.height,1350);
 });
}
test('v3 rejects impossible text rather than cropping or omitting the CTA',async()=>{
 const invalid='Unreasonably long promotional text repeated '.repeat(100);
 const result=await finishTypographyV3(scene,{headline:invalid,body:'Relevant body.',cta:'Learn More'},choices[0]);
 assert.equal(result.ok,false);
});
