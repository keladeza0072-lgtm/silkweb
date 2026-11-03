/**
 * Zero-cost preflight for one real campaign. Validates approved scenes, SAM
 * module availability, model key presence, input photo path and flags.
 * NEVER makes a request. No file modifications.
 *
 * node experiments/preflight-creative-campaign.mjs "C:\path\product.webp"
 */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {loadApprovedSceneAsset} from '../dist/creativeApprovedScenes.js';
import {selectVisualStudyPairs} from '../dist/creativeVisualPairing.js';
const source=process.argv[2];
if(!source)throw Error('Usage: node experiments/preflight-creative-campaign.mjs "path to product image"');
const name=(process.argv[3]??'INIU compact power bank').trim();
const directory=resolve('../../assets/creative-approved');
let problems=0;
const check=(ok,label)=>{console.log(ok?'PASS':'STOP',label);if(!ok)problems++;};
const input={productName:name,objective:'launch-product',upload:null,differentiator:'',price:'',currency:'',specialOffer:''};
const selected=selectVisualStudyPairs(input);
console.log('Selected studies:',selected.map(s=>s.referenceId).join(', '));
for(const ref of selected){
 const found=await loadApprovedSceneAsset(ref.referenceId,directory);
 check(Boolean(found),'approved, hash-valid asset '+ref.referenceId);
}
try{
 const bytes=await readFile(source);
 const meta=await sharp(bytes).metadata();
 check(Boolean(meta.width&&meta.height&&meta.width*meta.height<=8_000_000),
  'product file decodes and supports SAM <=8MP');
 check(bytes.length<=1.5*1024*1024,'product file meets website 1.5MB upload cap');
}catch(e){check(false,'product file readable: '+e.message);}
for(const name of ['openai','@meta-sam/parser']){
 try{await import(name);check(true,'SAM dependency '+name);}
 catch{check(false,'SAM dependency '+name+' (install package before live run)');}
}
check(Boolean(process.env.MODEL_API_KEY),'MODEL_API_KEY set (value never printed)');
console.log('Requested configuration: SILKWEB_CREATIVE_PROVIDER=live, SILKWEB_CREATIVE_DIRECTOR=on, SILKWEB_SAM31=on, SILKWEB_APPROVED_SCENE_DIR='+directory);
console.log('NO model requests made; this was a local preflight only.');
if(problems)process.exitCode=1;
