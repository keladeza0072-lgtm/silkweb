/**
 * SilkWeb Gradient Hero 01: original compositional ad family.
 * Generates a studio gradient locally; composites an actual transparent
 * product cutout and measures every text line before rendering.
 *
 * This is NOT product segmentation. The source must ALREADY have a
 * genuine alpha channel (e.g. validated SAM output). Refuse opaque photos
 * rather than creating an obvious rectangle on a gradient.
 */
import sharp from 'sharp';
export type HeroVariant='top-product-bottom'|'text-left-product-right'|'product-left-text-right';
export type HeroCopy={headline:string;body:string;cta:string};
export type HeroDiagnostics={variant:HeroVariant;headlineLines:string[];headlineSize:number;bodyLines:string[];productBox:{left:number;top:number;width:number;height:number};textBox:{left:number;top:number;width:number;height:number};};
const W=1080,H=1350;
const esc=(s:string)=>s.replace(/[\u0000-\u001f\u007f]/g,' ').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
const WIDTH_CACHE=new Map<string,number>();
async function width(s:string,size:number,bold:boolean):Promise<number>{
 const key=(bold?'b':'r')+'|'+size+'|'+s;const cached=WIDTH_CACHE.get(key);
 if(cached!==undefined)return cached;
 const m=await sharp({text:{text:esc(s),font:'Arial '+(bold?'Bold ':'')+size,rgba:true}}).metadata();
 const w=m.width??Infinity;WIDTH_CACHE.set(key,w);return w;
}
async function fitText(s:string,maxWidth:number,start:number,min:number,maxLines:number,bold:boolean){
 const words=clean(s).split(' ').filter(Boolean);if(!words.length)throw Error('Empty headline');
 for(let size=start;size>=min;size-=2){
  let line='';const lines:string[]=[];
  let invalid=false;
  for(const word of words){
   if(await width(word,size,bold)>maxWidth*.95){invalid=true;break;}
   const next=line?line+' '+word:word;
   if(await width(next,size,bold)<=maxWidth*.94)line=next;
   else{if(line)lines.push(line);line=word;}
  }
  if(line)lines.push(line);
  if(!invalid&&lines.length<=maxLines)return {lines,size};
 }
 throw Error('Text cannot fit safely; full copy remains available separately.');
}
function geometry(variant:HeroVariant){
 if(variant==='top-product-bottom')return {
  text:{left:86,top:100,width:908,height:440},
  product:{left:185,top:550,width:710,height:720},
  centered:true,
 };
 if(variant==='text-left-product-right')return {
  text:{left:70,top:295,width:460,height:590},
  product:{left:535,top:240,width:515,height:860},
  centered:false,
 };
 return {
  text:{left:570,top:300,width:440,height:590},
  product:{left:30,top:240,width:510,height:860},
  centered:false,
 };
}
export async function renderGradientHero(
 product:Buffer,copy:HeroCopy,variant:HeroVariant='top-product-bottom',
):Promise<{ok:true;png:Buffer;diagnostics:HeroDiagnostics}|{ok:false;reason:string}>{
 try{
  const meta=await sharp(product,{limitInputPixels:16_000_000}).metadata();
  if(!meta.width||!meta.height||meta.width*meta.height>16_000_000||!meta.hasAlpha)
   throw Error('A valid transparent product PNG is required; SAM segmentation must succeed or an equivalent cutout must be supplied.');
  const {data,info}=await sharp(product).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let opaque=0,minx=info.width,miny=info.height,maxx=-1,maxy=-1;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
   const a=data[(y*info.width+x)*4+3];
   if(a>128){opaque++;minx=Math.min(minx,x);miny=Math.min(miny,y);maxx=Math.max(maxx,x);maxy=Math.max(maxy,y);}
  }
  const coverage=opaque/(info.width*info.height);
  if(coverage<=.002||coverage>=.97||maxx<minx||maxy<miny)throw Error('Product transparency is not suitable for compositing.');
  const g=geometry(variant);
  const crop=await sharp(product).extract({left:minx,top:miny,width:maxx-minx+1,height:maxy-miny+1}).png().toBuffer();
  const scale=Math.min(g.product.width/(maxx-minx+1),g.product.height/(maxy-miny+1));
  const pw=Math.max(1,Math.round((maxx-minx+1)*scale)),ph=Math.max(1,Math.round((maxy-miny+1)*scale));
  const px=Math.round(g.product.left+(g.product.width-pw)/2),py=Math.round(g.product.top+(g.product.height-ph)/2);
  const cutout=await sharp(crop).resize(pw,ph,{fit:'fill'}).png().toBuffer();
  const headline=await fitText(copy.headline,g.text.width,g.centered?85:69,34,g.centered?3:5,true);
  const lineHeight=Math.round(headline.size*1.14);
  let body=null;
  const bodyText=clean(copy.body);
  if(bodyText&&bodyText.length<=160){
   try{body=await fitText(bodyText,g.text.width,27,20,g.centered?2:3,false);}
   catch{/* body remains available in structured ad copy */}
  }
  const total=headline.lines.length*lineHeight+(body?38+body.lines.length*Math.round(body.size*1.35):0);
  if(total>g.text.height-35)body=null;
  const linesSvg=headline.lines.map((line,i)=>'<text x="'+(g.centered?g.text.left+g.text.width/2:g.text.left)+'" y="'+(g.text.top+headline.size+i*lineHeight)+'" text-anchor="'+(g.centered?'middle':'start')+'" font-family="Arial,Helvetica,sans-serif" font-size="'+headline.size+'" font-weight="800" fill="#172238">'+esc(line)+'</text>').join('');
  const bodyTop=g.text.top+headline.lines.length*lineHeight+headline.size*.5+30;
  const bodySvg=body?body.lines.map((line,i)=>'<text x="'+(g.centered?g.text.left+g.text.width/2:g.text.left)+'" y="'+Math.round(bodyTop+i*body.size*1.35)+'" text-anchor="'+(g.centered?'middle':'start')+'" font-family="Arial,Helvetica,sans-serif" font-size="'+body.size+'" fill="#384659">'+esc(line)+'</text>').join(''):'';
  const background=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'"><defs><radialGradient id="studio" cx="55%" cy="30%" r="90%"><stop offset="0" stop-color="#f9fbff"/><stop offset=".57" stop-color="#dbe7f4"/><stop offset="1" stop-color="#a8bfd7"/></radialGradient><linearGradient id="floor" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#d5e1ef" stop-opacity="0"/><stop offset="1" stop-color="#91a9c6" stop-opacity=".42"/></linearGradient></defs><rect width="'+W+'" height="'+H+'" fill="url(#studio)"/><rect y="900" width="'+W+'" height="450" fill="url(#floor)"/></svg>');
  const base=await sharp(background).png().toBuffer();
  // Soft grounding shadow contained entirely within the product zone.
  const shadow=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'"><defs><filter id="blur"><feGaussianBlur stdDeviation="27"/></filter></defs><ellipse cx="'+(px+pw/2)+'" cy="'+Math.min(1320,py+ph-9)+'" rx="'+Math.max(55,pw*.39)+'" ry="27" fill="#405976" opacity=".24" filter="url(#blur)"/></svg>');
  const typography=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'">'+linesSvg+bodySvg+'</svg>');
  const png=await sharp(base).composite([{input:shadow,left:0,top:0},{input:cutout,left:px,top:py},{input:typography,left:0,top:0}]).png().toBuffer();
  return {ok:true,png,diagnostics:{variant,headlineLines:headline.lines,headlineSize:headline.size,bodyLines:body?.lines??[],
   productBox:{left:px,top:py,width:pw,height:ph},textBox:g.text}};
 }catch(e){return {ok:false,reason:'Gradient Hero: '+(e instanceof Error?e.message:'Unknown issue')};}
}
