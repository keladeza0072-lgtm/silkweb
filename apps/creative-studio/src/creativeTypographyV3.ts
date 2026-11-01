/**
 * SilkWeb Typography Intelligence v3 — production, opt-in.
 * Uses bundled OFL-licensed Oswald, DM Sans and Playfair Display files.
 * Sharp text's exact raster dimensions are used for layout and rendering,
 * avoiding disagreement between measured and drawn glyphs.
 * No external font resolution or network requests.
 */
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import type {CreativeDirectorChoice} from './creativeDirector.js';

const W=1080,H=1350,PAD=70;
const FONTS=resolve(dirname(fileURLToPath(import.meta.url)),'../assets/fonts');
const FONT_FILES={
  oswald:resolve(FONTS,'Oswald.ttf'),
  dm:resolve(FONTS,'DMSans.ttf'),
  playfair:resolve(FONTS,'PlayfairDisplay.ttf'),
} as const;
type FontKey=keyof typeof FONT_FILES;
export interface TypographyV3Copy{headline:string;body:string;cta:string}
export interface TypographyV3Diagnostics{
  family:string;
  headlineFont:string;
  bodyFont:string;
  headlineLines:string[];
  bodyLines:string[];
  headlineSize:number;
  bodySize:number;
  ctaSize:number;
  ctaRendered:true;
  textBottom:number;
  protectedProductRegionStarts:number;
}
export type TypographyV3Result=
  |{ok:true;pngDataUrl:string;width:1080;height:1350;diagnostics:TypographyV3Diagnostics}
  |{ok:false;reason:string};

const xml=(text:string)=>text.replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]??ch));
const compact=(text:string)=>text.trim().replace(/\s+/g,' ');

async function typeset(content:string,font:FontKey,size:number,ink:string):
 Promise<{png:Buffer;width:number;height:number}>{
  const plain=compact(content);
  if(!plain)throw Error('Copy field must not be empty.');
  const result=await sharp({
    text:{
      text:xml(plain),
      fontfile:FONT_FILES[font],
      font:(font==='oswald'?'Oswald':font==='playfair'?'Playfair Display':'DM Sans')+' '+size,
      rgba:true,dpi:72,
    },
  }).ensureAlpha().png().toBuffer();
  const m=await sharp(result).metadata();
  if(!m.width||!m.height)throw Error('Text measurement unavailable.');
  const colored=await sharp({create:{width:m.width,height:m.height,channels:4,background:ink}})
    .composite([{input:result,blend:'dest-in'}]).png().toBuffer();
  return {png:colored,width:m.width,height:m.height};
}
async function wrap(text:string,font:FontKey,size:number,maxWidth:number,maxLines:number):Promise<string[]|null>{
  const words=compact(text).split(' ').filter(Boolean);
  if(!words.length)return null;
  const lines:string[]=[];
  let current='';
  for(const word of words){
    const candidate=current?current+' '+word:word;
    if((await typeset(candidate,font,size,'#ffffff')).width<=maxWidth){current=candidate;continue;}
    if(!current)return null;
    lines.push(current);current=word;
  }
  if(current)lines.push(current);
  return lines.length<=maxLines?lines:null;
}
async function fit(text:string,font:FontKey,from:number,min:number,maxWidth:number,maxLines:number){
  for(let size=from;size>=min;size-=2){
    const lines=await wrap(text,font,size,maxWidth,maxLines);
    if(lines)return {size,lines};
  }
  throw Error('Advertising copy cannot fit safe text area.');
}
function gradient(height:number,opacity:number):Buffer{
  const stops='<stop offset="0" stop-color="#101724" stop-opacity="'+opacity+'"/>'+
    '<stop offset=".73" stop-color="#101724" stop-opacity=".84"/>'+
    '<stop offset="1" stop-color="#101724" stop-opacity="0"/>';
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="'+height+'">'+
    '<defs><linearGradient id="v" x1="0" y1="0" x2="0" y2="1">'+stops+'</linearGradient></defs>'+
    '<rect width="1080" height="'+height+'" fill="url(#v)"/></svg>');
}
/**
 * Layout variants are selected by Creative Director family, never customer controls.
 * Fails closed if a full headline/body/CTA stack cannot fit without
 * entering the product-protection region (lower 48% of the photograph).
 * This is a geometric safeguard, not automated image subject detection.
 */
export async function finishTypographyV3(
 source:Buffer,copy:TypographyV3Copy,choice:CreativeDirectorChoice
):Promise<TypographyV3Result>{
 try{
  for(const key of Object.keys(FONT_FILES) as FontKey[]){
    const bytes=await readFile(FONT_FILES[key]);
    if(bytes.length<10000)throw Error('Bundled font missing or invalid: '+key);
  }
  const isEditorial=choice.family==='tactile-editorial';
  const isStudio=choice.family==='studio-still-life';
  const headingFont:FontKey=
  choice.family==='situated-lifestyle'?'dm':
  (isEditorial||isStudio)?'playfair':
  'oswald';
  const textFont:FontKey='dm';
  const heading=await fit(copy.headline,headingFont,isEditorial?79:isStudio?87:95,46,940,3);
  const body=await fit(copy.body,textFont,34,25,940,3);
  const cta=await fit(copy.cta,textFont,39,26,470,1);
  const regionMax=685; // reserve lower 665px for product; not a content detector
  let y=58;
  const composed:{input:Buffer;left:number;top:number}[]=[];
  for(const line of heading.lines){
    const t=await typeset(line,headingFont,heading.size,'#ffffff');
    composed.push({input:t.png,left:PAD,top:y});
    y+=Math.max(t.height+9,heading.size+7);
  }
  y+=10;
  for(const line of body.lines){
    const t=await typeset(line,textFont,body.size,'#f5f7fb');
    composed.push({input:t.png,left:PAD,top:y});
    y+=Math.max(t.height+7,body.size+5);
  }
  y+=22;
  const label=await typeset(cta.lines[0],textFont,cta.size,'#ffffff');
  const buttonHeight=Math.max(70,label.height+26);
  const buttonWidth=Math.min(940,label.width+72);
  if(y+buttonHeight>regionMax)throw Error('Full copy including CTA conflicts with protected product region.');
  const isPremium=isEditorial||isStudio;
  const fill=isPremium?'#182438':'#125BE8';
  const radius=isPremium?8:16;
  const button=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="'+buttonWidth+'" height="'+buttonHeight+'"><rect width="'+buttonWidth+'" height="'+buttonHeight+'" rx="'+radius+'" fill="'+fill+'"/></svg>');
  composed.push({input:button,left:PAD,top:y});
  composed.push({input:label.png,left:PAD+36,top:y+Math.floor((buttonHeight-label.height)/2)});
  const finalBottom=y+buttonHeight;
  const base=await sharp(source).resize(W,H,{fit:'cover'}).png().toBuffer();
  const fade=gradient(Math.max(570,Math.min(750,finalBottom+100)),0.94);
  const result=await sharp(base).composite([{input:fade,left:0,top:0},...composed]).png().toBuffer();
  return {ok:true,pngDataUrl:'data:image/png;base64,'+result.toString('base64'),width:W,height:H,
   diagnostics:{family:choice.family,headlineFont:headingFont,bodyFont:textFont,
    headlineLines:heading.lines,bodyLines:body.lines,headlineSize:heading.size,
    bodySize:body.size,ctaSize:cta.size,ctaRendered:true,textBottom:finalBottom,
    protectedProductRegionStarts:regionMax}};
 }catch(e){
  return {ok:false,reason:'Typography Intelligence v3: '+(e instanceof Error?e.message:'Unknown failure')};
 }
}
