/**
 * Offline proof of layout and bundled fonts. This is NOT the production renderer.
 * Loads the previously reviewed clean product photograph and approved text report.
 * No providers, network access or inference.
 */
import sharp from 'sharp';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

const base=process.env.SILKWEB_SOURCE_REPO;
if(!base)throw Error('SILKWEB_SOURCE_REPO is required');
const fontDir=process.env.SILKWEB_FONT_DIR||resolve('assets/fonts');
const photo=join(base,'experiments/creative-real-scenes-v1/01-human-contact-raw.png');
const reportPath=resolve('../../experiments/final-copy-evaluation/copy-report-v3.json');
const out=resolve('../../experiments/final-typography-v3');
const report=JSON.parse(await readFile(reportPath,'utf8'));
if(!report.structureValid||!report.copyGatePassed||report.plans?.length!==3)throw Error('Copy gate failed');
const ad=report.plans[0];
const photoBytes=await readFile(photo);
const photoHash=createHash('sha256').update(photoBytes).digest('hex');
const font={
 title:join(fontDir,'Oswald.ttf'),
 body:join(fontDir,'DMSans.ttf'),
 editorial:join(fontDir,'PlayfairDisplay.ttf'),
};
for(const f of Object.values(font)){
 const data=await readFile(f);
 if(data.byteLength<10000)throw Error('Font missing/invalid: '+f);
}
const W=1080,H=1350;
const margin=70, maxWidth=940;
const esc=s=>s.replace(/[&<>]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[x]));
async function typeset(text,file,size,color){
 const png=await sharp({text:{text:esc(text),fontfile:file,font:(file===font.title?'Oswald':'DM Sans')+' '+size,rgba:true,dpi:72}})
   .ensureAlpha().png().toBuffer();
 const m=await sharp(png).metadata();
 if(!m.width||!m.height)throw Error('Text image has no dimensions');
 // tint the alpha mask with opaque ink; Sharp ensures same exact measured glyph width
 return {png:await sharp({create:{width:m.width,height:m.height,channels:4,background:color}})
   .composite([{input:png,blend:'dest-in'}]).png().toBuffer(),width:m.width,height:m.height};
}
async function wrap(text,file,size,width,maxLines){
 const words=text.trim().split(/\s+/);
 const lines=[];let line='';
 for(const word of words){
  const test=line?line+' '+word:word;
  if((await typeset(test,file,size,'#ffffff')).width<=width){line=test;continue;}
  if(!line) return null;
  lines.push(line);line=word;
 }
 if(line)lines.push(line);
 return lines.length>maxLines?null:lines;
}
async function fit(text,file,from,to,width,lines){
 for(let size=from;size>=to;size-=2){
  const wrapped=await wrap(text,file,size,width,lines);
  if(wrapped)return {size,lines:wrapped};
 }
 throw Error('Text cannot fit: '+text);
}
const heading=await fit(ad.headline,font.title,95,56,maxWidth,3);
const body=await fit(ad.body,font.body,34,26,maxWidth,3);
const cta=await fit(ad.cta,font.body,39,29,480,1);
const img=await sharp(photoBytes).resize(W,H,{fit:'cover'}).png().toBuffer();
// Full top atmosphere is purposefully controlled: a soft black-to-transparent
// gradient gives white text a predictable visual background without boxing it in.
const overlay=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101722" stop-opacity=".93"/><stop offset=".53" stop-color="#101722" stop-opacity=".80"/><stop offset="1" stop-color="#101722" stop-opacity="0"/></linearGradient></defs><rect width="1080" height="590" fill="url(#fade)"/></svg>');
const layers=[{input:overlay,left:0,top:0}];
let y=60;
for(const line of heading.lines){
 const t=await typeset(line,font.title,heading.size,'#ffffff');
 layers.push({input:t.png,left:margin,top:y}); y+=Math.max(t.height+9,heading.size+7);
}
y+=12;
for(const line of body.lines){
 const t=await typeset(line,font.body,body.size,'#f4f6fa');
 layers.push({input:t.png,left:margin,top:y});y+=Math.max(t.height+8,body.size+5);
}
y+=26;
const ctaText=await typeset(cta.lines[0],font.body,cta.size,'#ffffff');
const buttonWidth=Math.min(W-margin*2,ctaText.width+72);
const buttonHeight=Math.max(72,ctaText.height+26);
if(y+buttonHeight>610)throw Error('CTA region intersects protected product zone; reduce copy height before proceeding');
const pill=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="'+buttonWidth+'" height="'+buttonHeight+'"><rect width="'+buttonWidth+'" height="'+buttonHeight+'" rx="17" fill="#125BE8"/></svg>');
layers.push({input:pill,left:margin,top:y});
layers.push({input:ctaText.png,left:margin+36,top:y+Math.floor((buttonHeight-ctaText.height)/2)});
await mkdir(out,{recursive:true});
const filename=join(out,'01-product-visible-cta.png');
const result=await sharp(img).composite(layers).png().toBuffer();
await writeFile(filename,result);
const metrics={photo,photoSha256:photoHash,headline:ad.headline,headlineLines:heading.lines,headlineSize:heading.size,
 body:ad.body,bodyLines:body.lines,bodySize:body.size,cta:ad.cta,ctaSize:cta.size,ctaTop:y,ctaBottom:y+buttonHeight,
 fonts:['Oswald','DM Sans'],size:[W,H],photoVisibleAreaStarts:610,output:filename};
await writeFile(join(out,'01-diagnostics.json'),JSON.stringify(metrics,null,2));
console.log('PASS: Offline advertising typography proof rendered with bundled fonts.');
console.log('SOURCE PHOTO SHA256:',photoHash);
console.log('HEADLINE:',ad.headline,'(',heading.size,'px)');
console.log('BODY LINES:',body.lines.length,'(',body.size,'px)');
console.log('CTA:',ad.cta,'(',cta.size,'px)');
console.log('CTA BOTTOM:',y+buttonHeight,'(protected product zone starts at 610)');
console.log('OUTPUT:',filename);
console.log('No paid inference or API calls.');
