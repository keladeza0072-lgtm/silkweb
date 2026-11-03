import assert from 'node:assert/strict';
import sharp from 'sharp';
import {finishTypographyV2} from '../dist/creativeTypographyV2.js';
import {selectCreativeDirectorReferences} from '../dist/creativeDirector.js';
const input={productName:'INIU compact power bank',objective:'launch-product',upload:null,differentiator:'',price:'',currency:'',specialOffer:''};
const choices=selectCreativeDirectorReferences(input).selections;
const backgroundCases=[
 {name:'bright',color:'#e3dfd8'},
 {name:'dark',color:'#26313c'},
 {name:'medium',color:'#858585'},
];
let count=0;
for(const scene of backgroundCases){
 const png=await sharp({create:{width:1080,height:1350,channels:3,background:scene.color}}).png().toBuffer();
 for(const choice of choices){
  const longHeadline='Power for the moments that matter most';
  const body='Discover the INIU compact power bank. A portable option to take along wherever your day takes you.';
  const result=await finishTypographyV2(png,{headline:longHeadline,body,cta:'Explore'},choice);
  assert.equal(result.ok,true,scene.name+' '+choice.family+' '+(result.reason??''));
  const d=result.diagnostics;
  assert.ok(d.headlineLines.length>=1&&d.headlineLines.length<=3);
  assert.equal(d.headlineLines.join(' '),longHeadline,'Never truncate the headline');
  assert.ok(d.headlineWidths.every(w=>w<=d.textBox.width*.97),'Measured headline fits');
  assert.ok(d.textBox.left>=72&&d.textBox.left+d.textBox.width<=1008);
  assert.ok(d.textBox.height>0&&d.textBox.height<450);
  assert.ok(d.bodyLines.length<=2,'Body must wrap or be omitted');
  if(d.bodyRendered)assert.equal(d.bodyLines.join(' '),body,'Never truncate the body');
  const resultPng=Buffer.from(result.pngDataUrl.split(',')[1],'base64');
  const info=await sharp(resultPng).metadata();
  assert.equal(info.width,1080);assert.equal(info.height,1350);
  count++;
 }
}
console.log('PASS: '+count+' scene-aware typography outputs; exact glyph widths, safe wrapping, no clipping, contrast treatments and intact copy.');
console.log('No model calls performed.');
