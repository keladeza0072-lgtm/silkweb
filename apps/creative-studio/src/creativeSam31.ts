/**
 * Optional live SAM 3.1 product segmentation adapter.
 * Reuses the proven local experiment API: OpenAI responses.create({stream:true,
 * model:'sam-3.1',metadata:{mask_encoding:'one_bit'}}) + @meta-sam/parser.
 * Requires optional installed dependencies 'openai' and '@meta-sam/parser'.
 * Never retries, never logs credentials, never blocks ad generation when called
 * through the orchestrator's explicit fallback.
 */
import sharp from 'sharp';
import type { ImageAdInput } from './imageAds.js';
export type SamSegmentation = {cutout:Buffer;maskCoverage:number};
/** SAM concept prompts are short object categories, not brand/model descriptions. */
export function samObjectConcept(productName:string):string {
 const name=productName.toLowerCase();
 if(/power[ -]?bank|portable charger/.test(name))return 'power bank';
 if(/earbud|headphone/.test(name))return 'headphones';
 if(/phone case/.test(name))return 'phone case';
 if(/face serum|serum/.test(name))return 'bottle';
 if(/perfume|fragrance/.test(name))return 'perfume bottle';
 if(/coffee/.test(name))return 'coffee bag';
 if(/shoe|sneaker/.test(name))return 'shoe';
 if(/dress/.test(name))return 'dress';
 if(/lamp/.test(name))return 'lamp';
 const words=name.replace(/[^a-z0-9 -]/g,' ').trim().split(/\s+/);
 return words.slice(-2).join(' ')||'product';
}
export type SamRaster = {raster:Uint8Array;cropWidth:number;cropHeight:number;box:{left:number;top:number;right:number;bottom:number}};
export async function projectSamBoxMask(sourcePng:Buffer,mask:SamRaster):Promise<SamSegmentation>{
 const {data,info}=await sharp(sourcePng,{limitInputPixels:8_000_000}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const w=info.width,h=info.height;
 if(info.channels!==4||w*h>8_000_000)throw Error('SAM source dimensions not supported');
 const b=mask.box,{cropWidth,cropHeight,raster}=mask;
 if(!Number.isInteger(cropWidth)||!Number.isInteger(cropHeight)||cropWidth<=0||cropHeight<=0||raster.length!==cropWidth*cropHeight)throw Error('SAM mask raster dimensions invalid');
 const left=Math.round(b.left),top=Math.round(b.top),right=Math.round(b.right),bottom=Math.round(b.bottom);
 if(![left,top,right,bottom].every(Number.isFinite)||left<0||top<0||right>=w||bottom>=h||right<left||bottom<top)throw Error('SAM bounding box is outside source image');
 const bw=right-left+1,bh=bottom-top+1;
 const alpha=await sharp(Buffer.from(raster),{raw:{width:cropWidth,height:cropHeight,channels:1}}).resize(bw,bh,{kernel:'nearest'}).raw().toBuffer();
 let selected=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let a=0;
  if(x>=left&&x<=right&&y>=top&&y<=bottom)a=alpha[(y-top)*bw+(x-left)]?255:0;
  const idx=(y*w+x)*4+3;
  data[idx]=Math.round(data[idx]*a/255);
  if(data[idx]>=128)selected++;
 }
 const coverage=selected/(w*h);
 if(coverage<0.002||coverage>0.95)throw Error('SAM mask coverage unsuitable');
 const cutout=await sharp(data,{raw:{width:w,height:h,channels:4}}).png().toBuffer();
 return {cutout,maskCoverage:coverage};
}
export async function segmentProductWithSam31(
 input:ImageAdInput,
 options:{apiKey:string;timeoutMs?:number},
):Promise<SamSegmentation>{
 if(!input.upload)throw Error('SAM needs a product photo');
 if(!options.apiKey)throw Error('SAM API key missing');
 // Late imports keep SAM strictly optional for environments without these packages.
 const openaiModule='openai',parserModule='@meta-sam/parser';
 const [{default:OpenAI},parser]=await Promise.all([import(openaiModule),import(parserModule)]);
 const sourcePng=await sharp(input.upload.bytes,{limitInputPixels:8_000_000}).png().toBuffer();
 const info=await sharp(sourcePng).metadata();
 if(!info.width||!info.height||info.width*info.height>8_000_000)throw Error('SAM source image exceeds 8MP');
 // Product name is a category label, not an instruction from the customer.
 const concept=samObjectConcept(input.productName||'product').slice(0,80);
 const client=new OpenAI({apiKey:options.apiKey,baseURL:'https://api.meta.ai/v1',timeout:options.timeoutMs??120000,maxRetries:0});
 const events=await client.responses.create({
  model:'sam-3.1',
  input:[{type:'message',role:'user',content:[
   {type:'input_text',text:concept},
   {type:'input_image',image_url:'data:image/png;base64,'+sourcePng.toString('base64')},
  ]}],
  stream:true,
  metadata:{mask_encoding:'one_bit'},
 });
 const result=await parser.parseImageStream(events).finalResult;
 const masks=parser.recordsOfKind(result.records,'mask');
 const boxes=parser.recordsOfKind(result.records,'box');
 if(result.outcome.status!=='completed'||!masks.length){
  const codes=(result.diagnostics??[]).map((d:{code:string})=>d.code).slice(0,5).join(',')||'none';
  throw Error('SAM no mask: status='+result.outcome.status+' masks='+masks.length+' boxes='+boxes.length+' diagnostics='+codes);
 }
 const record=masks[0],box=record.bounds??boxes[0];
 if(!box)throw Error('SAM mask missing its source-image bounding box');
 const raster=parser.decodeMaskToRaster(record.mask);
 return projectSamBoxMask(sourcePng,{
  raster:new Uint8Array(raster),cropWidth:record.mask.width,cropHeight:record.mask.height,
  box:{left:box.left,top:box.top,right:box.right,bottom:box.bottom},
 });
}
