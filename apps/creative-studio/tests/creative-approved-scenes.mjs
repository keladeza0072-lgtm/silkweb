import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {loadApprovedSceneAsset} from '../dist/creativeApprovedScenes.js';
import {buildMuseImageRequest,MetaMuseImageProvider} from '../dist/museImage.js';
const root=await mkdtemp(join(tmpdir(),'silkweb-approved-'));
const id='TECH-HAND-01';
const productPng=await sharp({create:{width:120,height:150,channels:3,background:'#172238'}}).png().toBuffer();
const scenePng=await sharp({create:{width:240,height:300,channels:3,background:'#aaa49a'}}).png().toBuffer();
const hash=createHash('sha256').update(scenePng).digest('hex');
const input={productName:'INIU compact power bank',objective:'launch-product',upload:{format:'png',bytes:productPng},differentiator:'',price:'',currency:'',specialOffer:''};
const plan={id:'1',audience:'cold',headline:'Power on the go',body:'Designed to carry',cta:'Learn more',angle:'Everyday',visualPrompt:'A real everyday scene'};
try{
 assert.equal(await loadApprovedSceneAsset(id,root),null,'unapproved is never loaded');
 await writeFile(join(root,id+'.png'),scenePng);
 assert.equal(await loadApprovedSceneAsset(id,root),null,'raw study scene never auto-approved');
 await writeFile(join(root,'approvals.json'),JSON.stringify({[id]:{source:'original-generated',approvedForProduction:true,sha256:'0'.repeat(64)}}));
 assert.equal(await loadApprovedSceneAsset(id,root),null,'wrong hash must fail closed');
 await writeFile(join(root,'approvals.json'),JSON.stringify({[id]:{source:'original-generated',approvedForProduction:true,sha256:hash}}));
 const approved=await loadApprovedSceneAsset(id,root);assert.ok(approved,'correctly approved scene loads');
 const request=buildMuseImageRequest(plan,input,{approvedSceneDataUrl:approved.dataUrl});
 assert.ok(request.endpoint.endsWith('/edits'));
 assert.equal(request.body.images.length,2);
 assert.equal(request.body.images[0].image_url,approved.dataUrl,'first reference is approved scene');
 assert.ok(request.body.images[1].image_url.includes(productPng.toString('base64')),'second reference is customer product');
 const legacy=buildMuseImageRequest(plan,input);
 assert.equal(legacy.body.images.length,1,'existing product-only path remains');
 const previousDir=process.env.SILKWEB_APPROVED_SCENE_DIR,previousFlag=process.env.SILKWEB_CREATIVE_DIRECTOR;
 try{
  process.env.SILKWEB_APPROVED_SCENE_DIR=root;
  process.env.SILKWEB_CREATIVE_DIRECTOR='on';
  let posted;
  const imagePng=await sharp({create:{width:100,height:125,channels:3,background:'#abc123'}}).png().toBuffer();
  const provider=new MetaMuseImageProvider({apiKey:'test-only-not-real',fetchImpl:async (url,init)=>{
    posted=JSON.parse(init.body);
    return {ok:true,status:200,text:async()=>JSON.stringify({data:[{b64_json:imagePng.toString('base64')}]})};
  }});
  const result=await provider.generate(plan,input);
  assert.ok(result.referenceGuided);
  assert.equal(posted.images.length,2,'real provider adapter sends both references');
  assert.equal(posted.images[0].image_url,approved.dataUrl);
 }finally{
  if(previousDir===undefined)delete process.env.SILKWEB_APPROVED_SCENE_DIR;else process.env.SILKWEB_APPROVED_SCENE_DIR=previousDir;
  if(previousFlag===undefined)delete process.env.SILKWEB_CREATIVE_DIRECTOR;else process.env.SILKWEB_CREATIVE_DIRECTOR=previousFlag;
 }
 console.log('PASS: rights gate, SHA-256 protection, 2-image Muse edit request and original product-only fallback.');
}finally{await rm(root,{recursive:true,force:true});}
