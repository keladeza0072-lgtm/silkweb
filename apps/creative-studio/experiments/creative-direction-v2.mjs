import sharp from 'sharp';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
// Usage: node experiments/creative-direction-v2.mjs --prepare|--live "C:\path\OIP.webp"
// --prepare never calls Meta. --live makes up to 3 Muse requests, no retries.
const mode=process.argv[2], file=process.argv[3];
if(!['--prepare','--live'].includes(mode)||!file) throw Error('Usage: --prepare|--live "path to product image"');
if(mode==='--live'&&!process.env.MODEL_API_KEY) throw Error('MODEL_API_KEY missing; no inference attempted');
const width=1080,height=1350;
const root=resolve('../../experiments/creative-direction-v2');
await mkdir(root,{recursive:true});
const product=await sharp(await readFile(file)).resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).png().toBuffer();
await writeFile(resolve(root,'product.png'),product);
const concepts=[
 {id:'01-premium',audience:'cold',headline:['Meet your new','everyday carry'],body:'Get to know this compact power bank.',cta:'Explore the product',ink:'#FFFFFF',muted:'#D7E9FF',size:75,
 bg:'#0A1630',accent:'#2468D9',shape:'#79C9FF',position:'top',
 direction:'Dramatic luxury consumer-electronics product launch. Deep midnight navy, electric blue neon edge lights, luminous pedestal, realistic three-quarter angled power bank placed center-lower, powerful editorial atmosphere, crisp material reflections. Visually arresting premium technology campaign.'},
 {id:'02-lifestyle',audience:'warm',headline:['Small enough','to come along'],body:'Meet a power bank made to travel.',cta:'View the product',ink:'#182A43',muted:'#3F5A6F',size:74,
 bg:'#F4F0E8',accent:'#C9E1E3',shape:'#E0BBA2',position:'top',
 direction:'Beautiful sunlit lifestyle editorial. Stage the black power bank large on a warm limestone cafe tabletop near a canvas travel bag, notebook, blurred sunlit city window. Natural convincing contact shadows, thoughtful props, realistic commercial light. Not a catalog photo.'},
 {id:'03-bold',audience:'hot',headline:['Ready when','you are'],body:'A closer look at your everyday power bank.',cta:'Discover more',ink:'#FFFFFF',muted:'#E5EFFF',size:83,
 bg:'#123FD8',accent:'#F0A2D6',shape:'#91D9FF',position:'top',
 direction:'Bold art-directed high-end graphic tech ad. Saturated cobalt blue, huge dimensional sculptural pink arc behind a large dynamic angled black power bank, sharp blue rim light, believable realistic reflections, intentional shadows and playful energy. Stunning contemporary DTC campaign aesthetic.'}
];
const escapeXml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const guide=c=>'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="'+c.bg+'"/><path d="M0 460 Q500 600 1080 375 V1350 H0Z" fill="'+c.accent+'"/><circle cx="670" cy="880" r="390" fill="'+c.shape+'" opacity=".75"/><g transform="translate(410 435) rotate(-12 150 340)"><rect width="300" height="680" rx="65" fill="#101B2C"/><rect x="28" y="30" width="244" height="200" rx="28" fill="#315073"/></g></svg>';
const typeSvg=c=>'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><g font-family="Arial, Helvetica, sans-serif" font-weight="800" fill="'+c.ink+'" letter-spacing="-2"><text x="74" y="140" font-size="'+c.size+'">'+escapeXml(c.headline[0])+'</text><text x="74" y="228" font-size="'+c.size+'">'+escapeXml(c.headline[1])+'</text></g><text x="77" y="310" font-family="Arial, Helvetica, sans-serif" font-size="29" fill="'+c.muted+'">'+escapeXml(c.body)+'</text></svg>';
const shared='IMAGE 1 is the actual power bank and is authoritative for shape, glossy top, digital battery display, casing and visible identity. IMAGE 2 is a loose visual composition and color guide, not a final template. Transform the original source into a NEW commercial scene, do not reproduce the original hand or background. Produce sophisticated, finished photorealistic art direction. Large clear product in middle-lower two thirds (at least 35 percent of frame height); leave upper-left 30 percent completely free of objects and high detail for typography to be added afterward. Vertical 4:5. The guide silhouette is a POSITION MARKER only, not the physical product to copy. No writing, lettering, fake buttons, logos not on the source product, discounts, fabricated specs, badges or watermarks. Avoid plain white rectangles, text panels and stock-photo compositions. ';
const manifest={id:'CREATIVE-DIRECTION-V2',mode,createdAt:new Date().toISOString(),model:'muse-image-1.0',ads:[]};
for(const c of concepts){
 const g=await sharp(Buffer.from(guide(c))).png().toBuffer();
 await writeFile(resolve(root,c.id+'-guide.png'),g);
 manifest.ads.push({id:c.id,audience:c.audience,headline:c.headline.join(' '),body:c.body,cta:c.cta,prompt:shared+c.direction,status:'prepared'});
}
await writeFile(resolve(root,'manifest.json'),JSON.stringify(manifest,null,2));
console.log('Prepared 3 concepts, guides and detailed prompts in',root);
if(mode==='--prepare'){console.log('OFFLINE PASS: zero model calls.');process.exit(0);}
console.log('Live run: at most 3 paid image requests, no retries.');
for(let i=0;i<concepts.length;i++){
 const c=concepts[i],ad=manifest.ads[i],g=await readFile(resolve(root,c.id+'-guide.png'));const started=Date.now();
 try{
  const response=await fetch('https://api.meta.ai/v1/responses',{method:'POST',headers:{authorization:'Bearer '+process.env.MODEL_API_KEY,'content-type':'application/json'},body:JSON.stringify({model:'muse-image-1.0',store:false,input:[{role:'user',content:[{type:'input_text',text:ad.prompt},{type:'input_image',image_url:'data:image/png;base64,'+product.toString('base64')},{type:'input_image',image_url:'data:image/png;base64,'+g.toString('base64')}]}]}),signal:AbortSignal.timeout(180000)});
  ad.seconds=Number(((Date.now()-started)/1000).toFixed(2));
  if(!response.ok){ad.status='failed';ad.error='HTTP '+response.status+' '+(await response.text()).slice(0,200);console.log(ad.id,ad.error);continue;}
  const result=await response.json();ad.usage=result.usage??null;
  const b64=result.output?.find(x=>x.type==='image_generation_call')?.result;
  if(!b64){ad.status='failed';ad.error='No image output';console.log(ad.id,ad.error);continue;}
  const raw=await sharp(Buffer.from(b64.replace(/^data:image\/[^;]+;base64,/,''),'base64')).resize(width,height,{fit:'cover'}).png().toBuffer();
  await writeFile(resolve(root,c.id+'-raw.png'),raw);
  const finished=await sharp(raw).composite([{input:Buffer.from(typeSvg(c)),left:0,top:0}]).png().toBuffer();
  await writeFile(resolve(root,c.id+'-finished.png'),finished);
  ad.status='completed';ad.output=c.id+'-finished.png';console.log(ad.id,'COMPLETED in',ad.seconds,'seconds');
 }catch(e){ad.status='failed';ad.error=e.message;console.log(ad.id,'FAILED',ad.error);}
 finally{await writeFile(resolve(root,'manifest.json'),JSON.stringify(manifest,null,2));}
}
if(manifest.ads.some(a=>a.status!=='completed'))process.exitCode=1;
