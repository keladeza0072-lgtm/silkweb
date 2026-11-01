/**
 * SILKWEB-CREATIVE PRODUCT SLOT PROOF
 * Run from apps/creative-studio:
 *   node experiments/product-slot-v1.mjs --prepare "C:\path\product.webp" "portable power bank"
 *   node experiments/product-slot-v1.mjs --live "C:\path\product.webp" "portable power bank"
 *
 * --live = two Muse Image 1.0 image-generation calls, sequential, zero retries:
 * (1) make an original realistic product-free scene (owned AI generated asset)
 * (2) place the referenced actual product into that scene.
 * No public image scraping, no copying a competitor advertisement.
 */
import sharp from 'sharp';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const mode=process.argv[2],src=process.argv[3],label=(process.argv.slice(4).join(' ')||'pictured product').trim();
if(!['--prepare','--live'].includes(mode)||!src)throw Error('Usage: --prepare|--live "image path" "product name"');
if(label.length>120)throw Error('Product name too long');
if(mode==='--live'&&!process.env.MODEL_API_KEY)throw Error('MODEL_API_KEY missing. No inference attempted.');
const outputDir=resolve('../../experiments/product-slot-v1');
await mkdir(outputDir,{recursive:true});
const bytes=await readFile(src);
const image=await sharp(bytes).resize(1200,1200,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
await writeFile(resolve(outputDir,'product-reference.png'),image);
// This rule is a PRODUCT-CONTEXT SAFETY FILTER, not a fixed visual layout.
const cosmetics=/perfume|fragrance|skincare|serum|cream|lipstick|cosmetic|makeup/i.test(label);
const food=/food|drink|coffee|juice|beverage|tea|snack/i.test(label);
const portable=/power.?bank|charger|headphone|earbud|phone|camera|watch|electronics/i.test(label);
const context=cosmetics?'a luxurious beauty vanity in soft morning window light, a shallow marble table and folded pale cream silk':
  food?'a warm, natural cafe table with authentic food styling and real window light':
  portable?'a refined everyday carry scene on a warm neutral wooden cafe table beside an open canvas travel bag and notebook, with natural daylight':
  'a clean, realistically lit lifestyle tabletop scene with subtle neutral props selected to suit the product';
const scenePrompt=[
 'Produce a premium PHOTOREALISTIC 4:5 vertical advertising PHOTOGRAPH, not an illustration or digital render.',
 'This is a product-free ORIGINAL BACKGROUND PLATE for a future product insertion.',
 'Scene:',context+'.',
 'The product is NOT present yet. No objects shaped like the product. No text, logos, lettering, numbers, brand packaging, graphic overlays or artificial plinths.',
 'Have a clearly visible OPEN physical resting place on the table at the center-right; do not draw a placeholder outline, wireframe, circle, colored mask or empty product silhouette.',
 'The contact surface must be real and continuous, with the correct perspective to support a small object there.',
 'Upper-left remains calm, beautiful negative space for later editorial typography.',
 'Editorial art direction: authentic photography, tactile materials, natural lighting, intentional color harmony, convincing real-world scale and depth. Avoid neon, sci-fi, floating objects, fake smiles or generic studio gradients.',
 'Do not mimic any specific known advertisement or brand campaign.'
].join('\n');
const insertPrompt=[
 'Create the final PHOTOREALISTIC premium advertisement IMAGE, 4:5 portrait.',
 'IMAGE 1 is an original clean lifestyle scene plate and MUST define the scene, photographic lighting, camera angle, materials, scale and surrounding props.',
 'IMAGE 2 is the real customer product photo and MUST define the product appearance, proportions, printed branding, color and screen. The source photo may include a hand or background: TRANSFER THE PRODUCT ONLY, not the original hand/background.',
 'Physically position ONE actual '+label+' on the OPEN surface in the center-right of IMAGE 1. Rest it naturally in stable equilibrium with proper contact shadow, realistic scale, correct orientation, realistic occlusion with nearby objects and reflections consistent with IMAGE 1.',
 'Preserve the scene as faithfully as possible while inserting the actual object; do not replace the entire setting.',
 'It must read as ONE real commercial photograph shot with the product in the scene, not a pasted cutout. Keep physical shape, logo and display details as close to the real product photo as possible; do not invent ports, product specifications or logos.',
 'Leave the upper-left clean for editorial typography. Never render any headline, body copy, CTA, watermark, fake interface, promotional badges or extra logos.',
 'Do NOT add fantasy lighting, floating support, giant pedestal, graphic arcs, synthetic shapes, or an unrelated beauty-model scene.'
].join('\n');
const manifest={id:'PRODUCT-SLOT-V1',mode,productLabel:label,sceneSelection:{cosmetics,food,portable,context},method:'original scene + reference-guided product installation',models:['muse-image-1.0'],prompts:{scene:scenePrompt,insert:insertPrompt},status:'prepared',calls:[]};
const save=()=>writeFile(resolve(outputDir,'report.json'),JSON.stringify(manifest,null,2));
await save();
console.log('Prepared original scene and product insertion prompts.',outputDir);
if(mode==='--prepare'){console.log('OFFLINE PASS: 0 model calls.');process.exit(0);}
async function generate(id,prompt,refs){
 const started=Date.now();
 const content=[{type:'input_text',text:prompt},...refs.map(b=>({type:'input_image',image_url:'data:image/png;base64,'+b.toString('base64')}))];
 const record={id,status:'started',seconds:0};manifest.calls.push(record);
 try{
  const response=await fetch('https://api.meta.ai/v1/responses',{method:'POST',
   headers:{authorization:'Bearer '+process.env.MODEL_API_KEY,'content-type':'application/json'},
   body:JSON.stringify({model:'muse-image-1.0',store:false,input:[{role:'user',content}]}),
   signal:AbortSignal.timeout(180000)});
  record.seconds=+((Date.now()-started)/1000).toFixed(2);
  if(!response.ok){record.status='failed';record.error='HTTP '+response.status+' '+(await response.text()).slice(0,180);return null;}
  const result=await response.json();
  record.usage=result.usage??null;
  if(result.status!=='completed'){record.status='failed';record.error='Provider status '+result.status;return null;}
  const encoded=result.output?.find(x=>x.type==='image_generation_call')?.result;
  if(typeof encoded!=='string'||encoded.length<100){record.status='failed';record.error='No image_generation_call result';return null;}
  const raw=Buffer.from(encoded.replace(/^data:image\/[^;]+;base64,/,''),'base64');
  const resultPng=await sharp(raw).resize(1080,1350,{fit:'cover'}).png().toBuffer();
  record.status='completed';record.filename=id+'.png';
  await writeFile(resolve(outputDir,record.filename),resultPng);
  console.log(id,'COMPLETED',record.seconds+'s');
  return resultPng;
 }catch(error){record.status='failed';record.error=error.message;return null;}
 finally{record.seconds=+((Date.now()-started)/1000).toFixed(2);await save();}
}
const plate=await generate('01-original-scene',scenePrompt,[]);
if(!plate){console.error('Scene generation failed; product insertion skipped.');process.exit(1);}
const ad=await generate('02-product-in-scene',insertPrompt,[plate,image]);
if(!ad){console.error('Product insertion failed. Original scene saved; no retry.');process.exit(1);}
manifest.status='completed';await save();
console.log('PASS: product slot proof complete. Review 01-original-scene.png vs 02-product-in-scene.png.');
