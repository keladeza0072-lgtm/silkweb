import assert from 'node:assert/strict';
import sharp from 'sharp';
import {renderGradientHero} from '../dist/creativeGradientHero.js';
const W=400,H=520;
const alpha=Buffer.alloc(W*H*4);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
 const i=(y*W+x)*4;
 alpha[i]=29;alpha[i+1]=39;alpha[i+2]=58;
 alpha[i+3]=(x>58&&x<342&&y>30&&y<490)?255:0;
}
const cutout=await sharp(alpha,{raw:{width:W,height:H,channels:4}}).png().toBuffer();
const variants=['top-product-bottom','text-left-product-right','product-left-text-right'];
let n=0;
for(const variant of variants){
 const result=await renderGradientHero(cutout,{
  headline:'Power for the moments that matter',
  body:'Meet the compact INIU power bank. Keep your day moving.',
  cta:'Discover more',
 },variant);
 assert.equal(result.ok,true,variant+': '+(result.reason??''));
 const d=result.diagnostics;
 assert.equal(d.headlineLines.join(' '),'Power for the moments that matter','Headline stays complete');
 const t=d.textBox,p=d.productBox;
 assert.ok(t.left>=0&&t.top>=0&&t.left+t.width<=1080&&t.top+t.height<=1350,'Text box inside frame');
 assert.ok(p.left>=0&&p.top>=0&&p.left+p.width<=1080&&p.top+p.height<=1350,'Product box inside frame');
 assert.ok(p.left>=t.left+t.width||t.left>=p.left+p.width||p.top>=t.top+t.height||t.top>=p.top+p.height,
  'Text and product protected zones must not overlap');
 const meta=await sharp(result.png).metadata();
 assert.equal(meta.width,1080);assert.equal(meta.height,1350);
 console.log('PASS',variant,'headline:',d.headlineLines.join(' / '),'product:',p.width+'x'+p.height);
 n++;
}
const opaque=await sharp({create:{width:200,height:300,channels:3,background:'#ffffff'}}).png().toBuffer();
const rejected=await renderGradientHero(opaque,{headline:'Power on the go',body:'Hello',cta:'Explore'});
assert.equal(rejected.ok,false,'Opaque image must not be placed as visible rectangle');
console.log('PASS:',n,'real gradient compositions and fail-closed opaque upload guard. No paid inference.');
