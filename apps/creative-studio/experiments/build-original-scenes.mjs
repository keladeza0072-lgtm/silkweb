/**
 * SilkWeb Creative: original scene plate builder for the INIU power bank demo.
 *
 * --prepare: free; writes prompts and expected outputs, NO inference.
 * --live: up to three Muse Image requests, one per scene, no retries.
 * --inspect: checks completed candidate PNG images and prints hashes;
 *            does NOT approve images.
 * --approve: only after human visual review, copies valid plates to the
 *            approved directory with SHA-256 manifest. No model calls.
 *
 * Run from apps/creative-studio with:
 * node experiments/build-original-scenes.mjs --prepare
 * node experiments/build-original-scenes.mjs --live
 * node experiments/build-original-scenes.mjs --inspect
 * node experiments/build-original-scenes.mjs --approve
 */
import sharp from 'sharp';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';

const mode=process.argv[2];
if(!['--prepare','--live','--inspect','--approve'].includes(mode))throw Error('Use --prepare|--live|--inspect|--approve');
const id='silkweb-original-scenes-v1';
const root=resolve('../../experiments/'+id);
const approved=resolve('../../assets/creative-approved');
await mkdir(root,{recursive:true});
const scenes=[
 {id:'TECH-HAND-01',concept:'original authentic photo scene with hand placement',
  prompt:'Create an ORIGINAL vertical 4:5 luxury lifestyle advertising BACKGROUND photograph, authentic daylight editorial photographic realism. A stylish but ordinary adult in a contemporary city cafe walkway wearing a muted navy sleeve, one relaxed open hand in foreground at lower right, palm and fingers naturally curved as though about to hold a compact 110 x 70 mm gadget. THE HAND IS EMPTY. Warm outdoor late afternoon light, subtle real glass reflections, cafe background out of focus, natural skin texture and five-finger anatomy, editorial 50mm camera look. Keep the upper-left wall/soft out-of-focus backdrop naturally calm for future typography. This is a photographic environment PLATE for later product insertion; no product, no phone, no device, no object in hand, no dummy or blank white object. No words, text, logo, watermark, advertising layout, sci-fi special effects, neon or floating shapes. Never imitate a specific existing advertisement.'},
 {id:'LIFESTYLE-DESK-02',concept:'original believable everyday carry scene',
  prompt:'Create an ORIGINAL vertical 4:5 commercial lifestyle BACKGROUND photograph of a naturally lit cafe or coworking table. Warm oak tabletop at a natural three-quarter view, an open canvas everyday carry bag further back, one understated closed notebook and muted pen, authentic glass window light and tactile surfaces. At lower right / center-right there must be a natural, clearly empty, unbroken visible tabletop area appropriate to place a compact black power bank later, in believable perspective. Keep upper-left as a calm area with real soft light where future editorial headline can fit. No device, no gadget, no power bank, no outline/placeholder for product, no phone or exposed cables, no floating objects, no people posing, no words, text, brand or watermarks. Credible real photography, not a CGI illustration, with thoughtful prop balance and compelling commercial art direction.'},
 {id:'STUDIO-PLINTH-03',concept:'original real material supported premium hero',
  prompt:'Create an ORIGINAL vertical 4:5 premium COMMERCIAL PHOTOGRAPH background plate for adding an electronics device later. Architectural warm-light studio still life: one beautiful low light-grey matte stone block on a natural warm grey paper surface, realistic open FLAT top surface big enough to support a compact rectangular object, physically credible contact shadow, gentle lateral afternoon softbox highlights, nuanced warm cool contrast, tactile mineral material and photographic depth. Composition asymmetrical; the stone platform is at lower right to center-right, with natural open negative space in the upper-left for refined editorial typography later. The platform is EMPTY. Absolutely NO existing product, no cosmetic bottles, no placeholder object, no devices, no typography, labels, logos, decorative marketing graphic, circular sci-fi props, artificial gradients, watermarks or levitation. New original photographic composition, not a replica of a specific advertisement.'},
];
const manifest={id,model:'muse-image-1.0',purpose:'original background plates only, not products or reference studies',mode,scenes:scenes.map(({id,concept,prompt})=>({id,concept,prompt,output:id+'.png',status:'prepared'}))};
const manifestPath=join(root,'manifest.json');
if(mode==='--prepare'){await writeFile(manifestPath,JSON.stringify(manifest,null,2));console.log('PREPARED',root, '3 original background scene prompts, 0 model calls');process.exit(0);}
const hash=b=>createHash('sha256').update(b).digest('hex');
async function checkImage(path){
 const bytes=await readFile(path);
 const meta=await sharp(bytes).metadata();
 if(meta.format!=='png'||!meta.width||!meta.height||meta.width*meta.height>16_000_000||meta.width<600||meta.height<750)throw Error('Invalid scene image dimensions or format');
 return {bytes,sha256:hash(bytes),width:meta.width,height:meta.height};
}
if(mode==='--inspect'||mode==='--approve'){
 const ready=[];
 for(const scene of scenes){
  try{const result=await checkImage(join(root,scene.id+'.png'));ready.push({id:scene.id,...result});console.log('VALID:',scene.id,result.width+'x'+result.height,'SHA256:',result.sha256);}
  catch(e){console.log('MISSING/INVALID:',scene.id,e.message);}
 }
 if(mode==='--inspect'){console.log('Candidates:',ready.length,'of 3; inspect visually before approval');process.exit(ready.length===3?0:1);}
 if(ready.length!==3)throw Error('Refusing approval: must have all 3 valid images.');
 // Approval means the operator has visually inspected the generated files.
 await mkdir(approved,{recursive:true});
 const record={};
 for(const item of ready){
  await copyFile(join(root,item.id+'.png'),join(approved,item.id+'.png'));
  record[item.id]={source:'original-generated',approvedForProduction:true,sha256:item.sha256};
 }
 await writeFile(join(approved,'approvals.json'),JSON.stringify(record,null,2));
 console.log('APPROVED:',approved,'3 original assets. Point SILKWEB_APPROVED_SCENE_DIR to this path.');
 process.exit(0);
}
if(!process.env.MODEL_API_KEY)throw Error('MODEL_API_KEY missing: no paid inference attempted');
await writeFile(manifestPath,JSON.stringify(manifest,null,2));
let failures=0;
for(const [i,scene] of scenes.entries()){
 const entry=manifest.scenes[i],started=Date.now();
 try{
  const response=await fetch('https://api.meta.ai/v1/responses',{method:'POST',headers:{authorization:'Bearer '+process.env.MODEL_API_KEY,'content-type':'application/json'},
   body:JSON.stringify({model:'muse-image-1.0',store:false,input:[{role:'user',content:[{type:'input_text',text:scene.prompt}]}]}),
   signal:AbortSignal.timeout(180000)});
  entry.seconds=+((Date.now()-started)/1000).toFixed(2);
  if(!response.ok)throw Error('HTTP '+response.status+' '+(await response.text()).slice(0,160));
  const result=await response.json();
  const data=result.output?.find(x=>x.type==='image_generation_call')?.result;
  if(typeof data!=='string'||data.length<200)throw Error('No image_generation_call result');
  const png=await sharp(Buffer.from(data.replace(/^data:image\/[^;]+;base64,/,''),'base64')).resize(1080,1350,{fit:'cover'}).png().toBuffer();
  await writeFile(join(root,scene.id+'.png'),png);
  entry.status='completed';entry.sha256=hash(png);entry.usage=result.usage??null;
  console.log('COMPLETED',scene.id,'seconds',entry.seconds);
 }catch(e){entry.status='failed';entry.error=e.message;failures++;console.error('FAILED',scene.id,e.message);}
 finally{await writeFile(manifestPath,JSON.stringify(manifest,null,2));}
}
console.log('COMPLETE:',scenes.length-failures,'of',scenes.length,'original images. No approval was made.');
if(failures)process.exitCode=1;
