/**
 * SAM 3.1 handoff: converts a segmentation mask into an image reference.
 * The caller must obtain the mask from an actual SAM provider. No endpoint
 * or inference claim is fabricated here.
 *
 * SAM masks are often smaller than the source image. Resample to source
 * dimensions before applying alpha; no guessed crop coordinates.
 */
import sharp from 'sharp';
export interface SegmentationMaskResult {
  productCutoutPng: Buffer;
  sourceWidth:number;
  sourceHeight:number;
  maskResized:boolean;
}
export async function applySamProductMask(
  source:Buffer,
  mask:Buffer,
):Promise<SegmentationMaskResult>{
 const sourceInfo=await sharp(source,{limitInputPixels:16_000_000}).metadata();
 const maskInfo=await sharp(mask,{limitInputPixels:16_000_000}).metadata();
 const w=sourceInfo.width,h=sourceInfo.height;
 if(!w||!h||w*h>16_000_000)throw Error('Invalid SAM source image dimensions');
 if(!maskInfo.width||!maskInfo.height)throw Error('Invalid SAM mask dimensions');
 const resized=maskInfo.width!==w||maskInfo.height!==h;
 const rgba=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const alpha=await sharp(mask)
   .greyscale()
   .resize(w,h,{fit:'fill',kernel:'nearest'})
   .raw()
   .toBuffer({resolveWithObject:true});
 const pixels=rgba.data,maskPixels=alpha.data;
 const channels=rgba.info.channels,maskChannels=alpha.info.channels;
 let visible=0;
 for(let i=0;i<w*h;i++){
   const maskAlpha=maskPixels[i*maskChannels];
   pixels[i*channels+3]=Math.round(pixels[i*channels+3]*maskAlpha/255);
   if(maskAlpha>=128)visible++;
 }
 if(visible<Math.round(w*h*0.002)||visible>Math.round(w*h*0.995)){
   throw Error('SAM mask appears empty or covers the whole image');
 }
 const result=await sharp(pixels,{raw:{width:w,height:h,channels}}).png().toBuffer();
 return {productCutoutPng:result,sourceWidth:w,sourceHeight:h,maskResized:resized};
}
