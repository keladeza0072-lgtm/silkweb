import sharp from 'sharp';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
// Usage: node experiments/creative-real-scenes-v1.mjs --prepare|--live-one|--live "C:\path\OIP.webp"
// --prepare never calls Meta. --live makes up to 3 Muse requests, no retries.
const mode=process.argv[2], file=process.argv[3];
if(!['--prepare','--live-one','--live'].includes(mode)||!file) throw Error('Usage: --prepare|--live-one|--live "path to product image"');
if(mode!=='--prepare'&&!process.env.MODEL_API_KEY) throw Error('MODEL_API_KEY missing; no inference attempted');
const width=1080,height=1350;
const root=resolve('../../experiments/creative-real-scenes-v1');
await mkdir(root,{recursive:true});
const product=await sharp(await readFile(file)).resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).png().toBuffer();
await writeFile(resolve(root,'product.png'),product);
const concepts=[
 {id:'01-human-contact',audience:'cold',headline:['Power to','take along'],body:'Get to know this compact power bank.',cta:'Explore the product',ink:'#FFFFFF',muted:'#EDF3F8',size:79,
 direction:'REALISTIC HUMAN INTERACTION. Premium natural editorial photograph outdoors near a cafe or commuter walkway. One believable adult human hand gently holds the actual compact black power bank upright; thumb and fingers wrap naturally around the edges without hiding its distinctive display or front face. Correct five-finger hand anatomy, natural skin texture, genuine contact and believable scale. Person is only partially visible: forearm, sleeve, perhaps soft-focus torso, no need for a recognizable face. Soft morning daylight, natural depth of field. Product fills the lower-right half, sharp, face angled toward viewer. Upper-left is clean darker soft-focus background for white copy. Not a studio render, not floating, no magical light streaks, no abstract circles.'},
 {id:'02-situated-lifestyle',audience:'warm',headline:['Small enough','for the day'],body:'A close-up of this power bank.',cta:'See the details',ink:'#1A2A3C',muted:'#24384B',size:75,
 direction:'REALISTIC SITUATED PRODUCT PHOTOGRAPHY. A believable documentary-style product shot on a wooden outdoor bench beside a folded tennis towel and sports bag, with a softly blurred real tennis court in the distant background. The compact black power bank rests flat and stably on the dry bench, with natural gravity and visible contact shadow. No claim that the product has sports-specific features. Subtle daylight and true-to-life product scale; camera angled three-quarter slightly from above. Product in lower-left/middle, sharp and prominent. Reserve the top quarter as calm, naturally light space for dark headline. No synthetic stage, neon trails, surreal sculpture or floating product.'},
 {id:'03-tactile-editorial',audience:'hot',headline:['Details worth','a closer look'],body:'Discover this power bank.',cta:'Discover more',ink:'#142338',muted:'#334B60',size:74,
 direction:'TACTILE PREMIUM PRODUCT SHOOT. True overhead flat-lay commercial photography on an elegant warm ivory tabletop. A rich matte pale-blue silk fabric lies naturally draped beneath and partially around the compact black power bank (the silk does NOT cover the brand logo or display), with folds, seams, and realistic shadows. The power bank is lying physically flat, with the exact original body silhouette and clear unobstructed front face; realistic top-down perspective, no levitation, no digital holographic effects. Elegant restrained premium textures, sharp product detail, subtle directional window light. Place product in lower-right third, with clean textured ivory space on upper-left for dark typography. Fabric interacts with the product through real contact and compression, not magical wrapping.'}
];
const escapeXml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const typeSvg=c=>'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><g font-family="Arial, Helvetica, sans-serif" font-weight="800" fill="'+c.ink+'" letter-spacing="-2"><text x="74" y="140" font-size="'+c.size+'">'+escapeXml(c.headline[0])+'</text><text x="74" y="228" font-size="'+c.size+'">'+escapeXml(c.headline[1])+'</text></g><text x="77" y="310" font-family="Arial, Helvetica, sans-serif" font-size="29" fill="'+c.muted+'">'+escapeXml(c.body)+'</text></svg>';
const shared='Use IMAGE 1 as the authoritative photograph of this specific compact black INIU power bank. Preserve recognizable product geometry, display, logo and branding; no invented features, dimensions, ports, colors or labels. Create a NEW believable human-scale commercial photograph with a tangible physical relationship between the product and hand, fabric, or supporting surface. The product must be held or supported by gravity, with consistent shadows, perspective, human anatomy and material contact. This is a realistic advertising PHOTOGRAPH, not an illustration, 3D render, surreal composite, suspended product, sci-fi scene, neon effects or floating pedestal. Realistic environment and human presence should enrich product context without overpowering the product. 4:5 vertical ad. NO advertising text, generated labels, prices, false promises, fake badges, logos not in the original, CTA buttons or watermarks. Leave the specified negative space calm for separately composed copy. ';
const manifest={id:'CREATIVE-REAL-SCENES-V1',mode,createdAt:new Date().toISOString(),model:'muse-image-1.0',ads:[]};
for(const c of concepts){
 manifest.ads.push({id:c.id,audience:c.audience,headline:c.headline.join(' '),body:c.body,cta:c.cta,prompt:shared+c.direction,status:'prepared'});
}
await writeFile(resolve(root,'manifest.json'),JSON.stringify(manifest,null,2));
console.log('Prepared three physically realistic scene briefs in',root);
if(mode==='--prepare'){console.log('OFFLINE PASS: zero model calls.');process.exit(0);}
console.log('Live run: one or three paid requests depending on mode; no retries.');
for(let i=0;i<(mode==='--live-one'?1:concepts.length);i++){
 const c=concepts[i],ad=manifest.ads[i];const started=Date.now();
 try{
  const response=await fetch('https://api.meta.ai/v1/responses',{method:'POST',headers:{authorization:'Bearer '+process.env.MODEL_API_KEY,'content-type':'application/json'},body:JSON.stringify({model:'muse-image-1.0',store:false,input:[{role:'user',content:[{type:'input_text',text:ad.prompt},{type:'input_image',image_url:'data:image/png;base64,'+product.toString('base64')}]}]}),signal:AbortSignal.timeout(180000)});
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
if(manifest.ads.slice(0,mode==='--live-one'?1:3).some(a=>a.status!=='completed'))process.exitCode=1;
