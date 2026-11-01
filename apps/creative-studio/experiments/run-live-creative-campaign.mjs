/**
 * Run exactly one real SilkWeb Creative campaign through the SAME
 * production imageAdsGenerateLiveOutcome() orchestrator.
 *
 * One Muse Spark planning request, at most one SAM 3.1 request,
 * three Muse Image requests if planning/policy validation succeeds.
 * No retries. No public server, no published API key.
 *
 * node experiments/run-live-creative-campaign.mjs "C:\path\OIP.webp"
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {imageAdsGenerateLiveOutcome} from '../dist/imageAdsLive.js';
import {MetaMuseImageAdPlanner} from '../dist/imageAdsPlan.js';
import {MetaMuseImageProvider} from '../dist/museImage.js';
import {loadApprovedSceneAsset} from '../dist/creativeApprovedScenes.js';
import {selectVisualStudyPairs} from '../dist/creativeVisualPairing.js';

const path=process.argv[2];
if(!path)throw Error('Usage: node experiments/run-live-creative-campaign.mjs "C:\\path\\product.webp"');
if(!process.env.MODEL_API_KEY)throw Error('MODEL_API_KEY missing: no model calls made.');
const dir=resolve('../../assets/creative-approved');
const output=resolve('../../experiments/silkweb-first-live-campaign');
const name=(process.argv[3]??'INIU compact power bank').trim();
const objective='launch-product';
const refs=selectVisualStudyPairs({productName:name,objective,upload:null,differentiator:'',price:'',currency:'',specialOffer:''});
for(const item of refs){
 const approved=await loadApprovedSceneAsset(item.referenceId,dir);
 if(!approved)throw Error('Scene not approved or corrupted: '+item.referenceId+'. No model calls made.');
}
const raw=await readFile(path);
const meta=await sharp(raw).metadata();
const formats={jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
const mime=formats[meta.format];
if(!mime||!meta.width||!meta.height||meta.width*meta.height>8_000_000||raw.length>1536*1024)
 throw Error('Product source format, size or dimensions invalid. No model calls made.');
// Never run this test with a public URL or temporary web server.
const old={
 SILKWEB_CREATIVE_PROVIDER:process.env.SILKWEB_CREATIVE_PROVIDER,
 SILKWEB_CREATIVE_DIRECTOR:process.env.SILKWEB_CREATIVE_DIRECTOR,
 SILKWEB_SAM31:process.env.SILKWEB_SAM31,
 SILKWEB_APPROVED_SCENE_DIR:process.env.SILKWEB_APPROVED_SCENE_DIR,
};
Object.assign(process.env,{
 SILKWEB_CREATIVE_PROVIDER:'live',
 SILKWEB_CREATIVE_DIRECTOR:'on',
 SILKWEB_SAM31:'on',
 SILKWEB_APPROVED_SCENE_DIR:dir,
});
const started=Date.now();
await mkdir(output,{recursive:true});
let result;
try{
 console.log('LIVE: one Spark plan, at most one SAM segmentation, up to three Muse Image edits. No retries.');
 console.log('Product:',name,'objective:',objective,'approved scenes:',refs.map(x=>x.referenceId).join(', '));
 result=await imageAdsGenerateLiveOutcome({
   productName:name,objective,productImage:'data:'+mime+';base64,'+raw.toString('base64'),
 },{
   planner:new MetaMuseImageAdPlanner({timeoutMs:60000}),
   images:new MetaMuseImageProvider({timeoutMs:180000}),
 });
}finally{
 for(const [k,v] of Object.entries(old)){
  if(v===undefined)delete process.env[k];
  else process.env[k]=v;
 }
}
const payload=result.payload;
const report={
  case:'SILKWEB-FIRST-LIVE-001',at:new Date().toISOString(),status:result.status,
  engine:payload.engine??null,objective,productName:name,
  approvedSceneIds:refs.map(x=>x.referenceId),
  samRequested:true,
  samOutcome:'not independently recorded by current orchestrator; cutout may have fallen back',
  elapsedSeconds:Math.round((Date.now()-started)/1000),
  ads:[],failures:payload.failures??[],
  error:payload.error??null,issues:payload.issues??[],
};
if(payload.ok&&Array.isArray(payload.ads)){
 for(const [index,ad] of payload.ads.entries()){
  const bytes=Buffer.from(ad.pngDataUrl.split(',')[1],'base64');
  const out=String(index+1).padStart(2,'0')+'-'+ad.audience+'.png';
  await writeFile(join(output,out),bytes);
  report.ads.push({
   file:out,audience:ad.audience,headline:ad.headline,body:ad.body,cta:ad.cta,
   angle:ad.angle,referenceGuided:ad.referenceGuided,
   width:ad.width,height:ad.height,
   sha256:createHash('sha256').update(bytes).digest('hex'),
  });
  console.log('SAVED:',out,ad.width+'x'+ad.height,JSON.stringify(ad.headline));
 }
}
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
console.log('RESULT:',result.status,'completed ads:',report.ads.length,'of 3','failures:',report.failures.length);
console.log('REPORT:',join(output,'report.json'));
if(report.error)console.log('ERROR:',JSON.stringify(report.error));
if(report.issues?.length)console.log('ISSUES:',JSON.stringify(report.issues));
if(report.failures.length)console.log('FAILURES:',JSON.stringify(report.failures));
if(report.ads.length!==3)process.exitCode=1;
