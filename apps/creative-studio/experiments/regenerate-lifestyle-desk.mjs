/**
 * Generate ONLY a revised lifestyle-desk candidate. One paid Muse Image call,
 * no retries; preserves every existing image and the existing manifest.
 * Output is staged as LIFESTYLE-DESK-02-candidate-v2.png and NOT approved.
 * Run from apps/creative-studio:
 * node experiments/regenerate-lifestyle-desk.mjs --prepare
 * node experiments/regenerate-lifestyle-desk.mjs --live
 */
import sharp from 'sharp';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const mode=process.argv[2];
if(!['--prepare','--live'].includes(mode))throw Error('Expected --prepare or --live');
const folder=resolve('../../experiments/silkweb-original-scenes-v1');
await mkdir(folder,{recursive:true});
const output=join(folder,'LIFESTYLE-DESK-02-candidate-v2.png');
const prompt=[
 'Generate a completely ORIGINAL, high-end photographic advertising SCENE PLATE, portrait 4:5 aspect ratio, full-bleed realistic lifestyle photography for a SMALL BLACK RECTANGULAR POWER BANK to be added in a later image-editing stage.',
 'CAMERA/COMPOSITION: eye-level three-quarter close photographic angle from just above a real contemporary cafe tabletop, 50mm editorial lens, realistic subtle depth of field, natural perspective. Carefully designed composition as a premium technology campaign, NOT a generic broad overhead stock photo.',
 'PRODUCT ZONE (VERY IMPORTANT): lower-center / center-right clear empty flat surface occupies about 35 percent of the frame, intentionally framed in sharp focus, at a believable scale suitable for setting a small power bank down. This area has real wood grain and directional window light, not a painted or glowing placeholder. The table surface remains unbroken and natural.',
 'ENVIRONMENT: stylish restrained city-cafe atmosphere, small partially visible deep navy canvas commuter bag at the far edge of frame only, out of focus and NO MORE THAN 10 percent of image area. A simple closed notebook tucked partly into the left edge, no large bulky fabric objects, no additional hero objects. Sunlit warm natural walnut tones with muted steel blue accents, subtle reflections, art-directed visual rhythm, convincing contact shadows and physical realism.',
 'TYPOGRAPHY SPACE: upper-left quadrant has a naturally calm darker slightly blurred cafe wall/background for a future short white editorial headline; composition must balance product zone with typography space. Keep surrounding visuals expressive without overpowering the future product.',
 'STRICTLY EMPTY SCENE: no device, charger, power bank, cell phone, blank rectangular product stand-in, fake cutout, hands, people in foreground, product text, words, badges, logos, branding, advertisement typography, watermark, CGI props, floating objects, neon, futuristic effects or unrealistic surfaces.',
 'Create a new original photography composition, not a reproduction of a reference image.'
].join('\n');
const briefPath=join(folder,'LIFESTYLE-DESK-02-candidate-v2-brief.txt');
await writeFile(briefPath,prompt);
if(mode==='--prepare'){console.log('PREPARED revised desk prompt. No model calls. Existing images preserved.');process.exit(0);}
if(!process.env.MODEL_API_KEY)throw Error('MODEL_API_KEY missing; no paid inference attempted');
try{await readFile(output);throw Error('Candidate already exists: refusing to overwrite '+output);}catch(e){if(e.code!=='ENOENT')throw e;}
console.log('Submitting EXACTLY ONE Muse Image scene request. No retries, no approval.');
const started=Date.now();
const response=await fetch('https://api.meta.ai/v1/responses',{
 method:'POST',
 headers:{authorization:'Bearer '+process.env.MODEL_API_KEY,'content-type':'application/json'},
 body:JSON.stringify({model:'muse-image-1.0',store:false,input:[{role:'user',content:[{type:'input_text',text:prompt}]}]}),
 signal:AbortSignal.timeout(180000),
});
if(!response.ok)throw Error('Muse Image HTTP '+response.status+' '+(await response.text()).slice(0,160));
const result=await response.json();
const b64=result.output?.find(x=>x.type==='image_generation_call')?.result;
if(typeof b64!=='string'||b64.length<200)throw Error('Muse Image response had no image_generation_call result');
const png=await sharp(Buffer.from(b64.replace(/^data:image\/[^;]+;base64,/,''),'base64')).resize(1080,1350,{fit:'cover'}).png().toBuffer();
const meta=await sharp(png).metadata();
if(meta.width!==1080||meta.height!==1350)throw Error('Candidate output dimensions invalid');
await writeFile(output,png,{flag:'wx'});
const sha256=createHash('sha256').update(png).digest('hex');
await writeFile(join(folder,'LIFESTYLE-DESK-02-candidate-v2-report.json'),JSON.stringify({
 asset:'LIFESTYLE-DESK-02',candidate:'v2',model:'muse-image-1.0',status:'awaiting-human-approval',
 output:'LIFESTYLE-DESK-02-candidate-v2.png',sha256,seconds:Math.round((Date.now()-started)/100)/10,
 usage:result.usage??null,
},null,2));
console.log('SUCCESS:',output);
console.log('SHA256:',sha256);
console.log('Approval: PENDING. Original LIFESTYLE-DESK-02.png and other two scenes are untouched.');
