/**
 * SilkWeb Creative Director image finishing v1.
 * No rigid white panel, no fake CTA button. Copy is exact and placed
 * using scene-aware editorial variants. The full body/CTA still travel
 * in the API response if an image needs restraint.
 */
import sharp from 'sharp';
import type {CreativeDirectorChoice} from './creativeDirector.js';
const W=1080,H=1350;
const clean=(value:string)=>value.replace(/[\u0000-\u001f\u007f]/g,' ').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
type AdCopy={headline:string;body:string;cta:string};
function textWidth(s:string,size:number):number{return [...s].reduce((n,c)=>n+size*(c===' '?0.31:/[ilI\.,!]/.test(c)?0.28:/[MW@]/.test(c)?0.86:0.54),0);}
function fitWords(input:string,width:number,maxLines:number,initialSize:number){
 for(let size=initialSize;size>=28;size-=2){
  const lines:string[]=[];let current='';
  for(const word of input.trim().split(/\s+/)){
   const candidate=current?current+' '+word:word;
   if(textWidth(candidate,size)<=width)current=candidate;
   else{if(current)lines.push(current);current=word;}
  }
  if(current)lines.push(current);
  if(lines.length<=maxLines&&lines.every(x=>textWidth(x,size)<=width))return {lines,size};
 }
 return {lines:[input.trim().slice(0,54)],size:28};
}
export async function finishCreativeDirectorAd(
 png:Buffer,copy:AdCopy,choice:CreativeDirectorChoice
):Promise<{ok:true;pngDataUrl:string;width:number;height:number}|{ok:false;reason:string}>{
 try{
  // Normalize to the final pixel canvas before cropping: Sharp may reorder
  // chained resize/extract operations and reject the extraction bounds.
  const base=await sharp(png).resize(W,H,{fit:'cover'}).png().toBuffer();
  const sample=await sharp(base).extract({left:40,top:42,width:450,height:245})
    .resize(1,1).removeAlpha().raw().toBuffer();
  const luma=0.2126*sample[0]+0.7152*sample[1]+0.0722*sample[2];
  const light=luma<138;
  const ink=light?'#FFFFFF':'#182A3C',secondary=light?'#F2F5F8':'#374C60';
  const isTactile=choice.family==='tactile-editorial';
  const isGraphic=choice.family==='graphic-editorial';
  const isStudio=choice.family==='studio-still-life';
  const headlineSize=isTactile?64:isGraphic?91:isStudio?75:70;
  const fit=fitWords(copy.headline,900,3,headlineSize);
  const x=isTactile?86:72;
  const y=isTactile?145:136;
  const step=fit.size*1.13;
  const family=isTactile?'Georgia, Times New Roman, serif':'Arial, Helvetica, sans-serif';
  const weight=isTactile?500:isGraphic?850:750;
  const header=fit.lines.map((line,i)=>'<text x="'+x+'" y="'+Math.round(y+i*step)+'" font-family="'+family+'" font-size="'+fit.size+'" font-weight="'+weight+'" fill="'+ink+'" letter-spacing="'+(isTactile?'-1':'-1.5')+'">'+clean(line)+'</text>').join('');
  const bodyY=Math.round(y+(fit.lines.length)*step+28);
  const safeBody=copy.body.trim();
  // Only overlay body text when brief and likely to fit; complete copy remains API metadata.
  const body=safeBody.length<=85?'<text x="'+x+'" y="'+bodyY+'" font-family="Arial,Helvetica,sans-serif" font-size="29" fill="'+secondary+'">'+clean(safeBody)+'</text>':'';
  const overlay=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'">'+header+body+'</svg>');
  const out=await sharp(base).composite([{input:overlay,left:0,top:0}]).png().toBuffer();
  return {ok:true,pngDataUrl:'data:image/png;base64,'+out.toString('base64'),width:W,height:H};
 }catch(error){return {ok:false,reason:'Creative Director typography finishing failed: '+(error instanceof Error?error.message:'Unknown image error')};}
}
