/**
 * SilkWeb Typography Intelligence v2.
 * Accurate Pango glyph measurement through Sharp (same rendering stack);
 * conservative SVG layout, responsive line wrapping, background contrast
 * analysis, no image-edge overflow, and audience-dependent editorial type.
 * No remote model calls. Customer-facing body/CTA remain in response even
 * if the composition omits body text to avoid clutter.
 */
import sharp from 'sharp';
import type {CreativeDirectorChoice} from './creativeDirector.js';
const W=1080,H=1350;
const PAD=72;
export type TypeCopy={headline:string;body:string;cta:string};
export type TypeDiagnostics={
  layout:'editorial-left'|'centered-hero'|'studio-editorial';
  headlineLines:string[];
  headlineFontSize:number;
  bodyLines:string[];
  bodyFontSize:number;
  font:string;
  headlineWidths:number[];
  textBox:{left:number;top:number;width:number;height:number};
  contrastRatio:number;
  scrimApplied:boolean;
  bodyRendered:boolean;
};
const escapeXml=(s:string)=>s.replace(/[\u0000-\u001f\u007f]/g,' ').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
const clamp=(n:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,n));
const luminance=(r:number,g:number,b:number)=>{
 const channels=[r,g,b].map(v=>{const s=v/255;return s<=0.04045?s/12.92:Math.pow((s+0.055)/1.055,2.4);});
 return 0.2126*channels[0]+0.7152*channels[1]+0.0722*channels[2];
};
const contrast=(a:number,b:number)=>(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
type Rect={left:number;top:number;width:number;height:number};
async function sceneLuminance(png:Buffer,rect:Rect):Promise<number[]>{
 const pixels=await sharp(png).extract(rect).removeAlpha().resize(9,4,{fit:'fill'}).raw().toBuffer({resolveWithObject:true});
 const values:number[]=[];
 for(let i=0;i<pixels.info.width*pixels.info.height;i++){
  const n=i*pixels.info.channels;
  values.push(luminance(pixels.data[n],pixels.data[n+1],pixels.data[n+2]));
 }
 return values;
}
// Pango gives the true measured text geometry on the render host,
// unlike the v1 per-character guesswork.
const widths=new Map<string,number>();
async function measured(s:string,size:number,font:string,weight:'normal'|'bold'):Promise<number>{
 if(!s)return 0;
 const key=font+'|'+weight+'|'+size+'|'+s;
 const cached=widths.get(key);if(cached!==undefined)return cached;
 const spec=font+' '+(weight==='bold'?'Bold ':'')+size;
 const meta=await sharp({text:{text:escapeXml(s),font:spec,rgba:true}}).metadata();
 const width=meta.width??Infinity;
 if(widths.size>1200)widths.clear();
 widths.set(key,width);
 return width;
}
async function wrapExact(text:string,maxWidth:number,size:number,maxLines:number,font:string,weight:'normal'|'bold'):
 Promise<{lines:string[];widths:number[]}|null>{
 const words=clean(text).split(' ').filter(Boolean);
 if(!words.length)return null;
 const lines:string[]=[];
 let line='';
 for(const word of words){
  if(await measured(word,size,font,weight)>maxWidth*0.96)return null;
  const candidate=line?line+' '+word:word;
  if(await measured(candidate,size,font,weight)<=maxWidth*0.94)line=candidate;
  else{if(line)lines.push(line);line=word;}
 }
 if(line)lines.push(line);
 if(lines.length>maxLines)return null;
 const actual=await Promise.all(lines.map(x=>measured(x,size,font,weight)));
 if(actual.some(w=>w>maxWidth*0.96))return null;
 return {lines,widths:actual};
}
async function fit(text:string,width:number,start:number,min:number,maxLines:number,font:string,weight:'normal'|'bold'){
 for(let size=start;size>=min;size-=2){
  const value=await wrapExact(text,width,size,maxLines,font,weight);
  if(value)return {...value,size};
 }
 throw Error('Headline cannot fit safely at minimum size; original copy preserved for user.');
}
export async function finishTypographyV2(
 source:Buffer,copy:TypeCopy,choice:CreativeDirectorChoice,
):Promise<{ok:true;pngDataUrl:string;width:number;height:number;diagnostics:TypeDiagnostics}|{ok:false;reason:string}>{
 try{
  const png=await sharp(source).resize(W,H,{fit:'cover'}).png().toBuffer();
  const centered=choice.family==='studio-still-life'||choice.family==='tactile-editorial';
  const serif=choice.family==='tactile-editorial';
  const layout:TypeDiagnostics['layout']=choice.family==='studio-still-life'?'studio-editorial':centered?'centered-hero':'editorial-left';
  const font=serif?'Georgia':'Arial';
  const x=centered?W/2:PAD;
  const boxWidth=centered?W-2*100:W-2*PAD;
  const start=choice.family==='graphic-editorial'?84:choice.family==='studio-still-life'?73:70;
  const headline=await fit(copy.headline,boxWidth,start,32,3,font,serif?'normal':'bold');
  const step=Math.ceil(headline.size*1.17);
  const firstBase=120;
  const lastBase=firstBase+(headline.lines.length-1)*step;
  const bodyText=clean(copy.body);
  let body:{lines:string[];widths:number[];size:number}|null=null;
  if(bodyText.length<=160){
   for(let size=30;size>=23;size-=2){
    const candidate=await wrapExact(bodyText,boxWidth-20,size,2,'Arial','normal');
    if(candidate){body={...candidate,size};break;}
   }
  }
  const bodyStart=lastBase+headline.size*0.75+36;
  const bodyStep=body?Math.ceil(body.size*1.38):0;
  const bottom=body?bodyStart+(body.lines.length-1)*bodyStep+body.size*0.4:lastBase+headline.size*0.3;
  const region:Rect={left:PAD-20,top:55,width:W-2*(PAD-20),height:clamp(Math.ceil(bottom-30),160,450)};
  // Sample text area rather than top-left pixel; choose the ink offering
  // the strongest readable contrast across the photographic background.
  const values=await sceneLuminance(png,region);
  const darkMin=Math.min(...values.map(l=>contrast(l,0.012)));
  const lightMin=Math.min(...values.map(l=>contrast(l,1)));
  const darkAvg=values.reduce((n,l)=>n+contrast(l,0.012),0)/values.length;
  const lightAvg=values.reduce((n,l)=>n+contrast(l,1),0)/values.length;
  const useWhite=lightAvg>darkAvg;
  const minRatio=useWhite?lightMin:darkMin;
  const scrim=minRatio<4.5;
  const ink=useWhite?'#ffffff':'#152333';
  const muted=useWhite?'#f2f6f9':'#233747';
  const align=centered?'middle':'start';
  const text=(value:string,y:number,size:number,fill:string,bold:boolean,face:string)=>
   '<text x="'+x+'" y="'+Math.round(y)+'" text-anchor="'+align+'" font-family="'+face+'" font-size="'+size+'" font-weight="'+(bold?'700':'400')+'" fill="'+fill+'">'+escapeXml(value)+'</text>';
  const headlineSvg=headline.lines.map((line,i)=>text(line,firstBase+i*step,headline.size,ink,!serif,font)).join('');
  const bodySvg=body?body.lines.map((line,i)=>text(line,bodyStart+i*bodyStep,body.size,muted,false,'Arial')).join(''):'';
  // Gentle atmospheric contrast treatment, not a rectangular text card.
  // Full-width gradient fades into the photograph before the product zone.
  const scrimSvg=scrim?'<defs><linearGradient id="textveil" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="'+(useWhite?'#09111a':'#ffffff')+'" stop-opacity=".62"/><stop offset="1" stop-color="'+(useWhite?'#09111a':'#ffffff')+'" stop-opacity="0"/></linearGradient></defs><rect x="0" y="0" width="'+W+'" height="530" fill="url(#textveil)"/>':'';
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'">'+scrimSvg+headlineSvg+bodySvg+'</svg>');
  const output=await sharp(png).composite([{input:svg,left:0,top:0}]).png().toBuffer();
  return {ok:true,width:W,height:H,pngDataUrl:'data:image/png;base64,'+output.toString('base64'),
   diagnostics:{layout,headlineLines:headline.lines,headlineFontSize:headline.size,
    bodyLines:body?.lines??[],bodyFontSize:body?.size??0,font,
    headlineWidths:headline.widths,
    textBox:{left:centered?100:PAD,top:65,width:boxWidth,height:Math.ceil(bottom-55)},
    contrastRatio:+minRatio.toFixed(2),scrimApplied:scrim,bodyRendered:!!body}};
 }catch(e){return {ok:false,reason:'Typography Intelligence v2: '+(e instanceof Error?e.message:'Unknown failure')};}
}
