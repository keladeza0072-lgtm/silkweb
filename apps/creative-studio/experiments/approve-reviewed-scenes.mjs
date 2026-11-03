/**
 * Approve exactly the three visually reviewed ORIGINAL scene plates.
 * Uses the reviewed v2 desk candidate, never the old desk image.
 * Verifies SHA-256 values observed in the review; does not overwrite
 * the original experiment images, and never makes API calls.
 *
 * node experiments/approve-reviewed-scenes.mjs
 */
import {readFile,writeFile,mkdir,copyFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const root=resolve('../../experiments/silkweb-original-scenes-v1');
const destination=resolve('../../assets/creative-approved');
const reviewed=[
 {id:'TECH-HAND-01',file:'TECH-HAND-01.png',hash:'118ec151dc29ca89e2c49ba7483988b387e63fa1a6dfdcf45ce6fd431ec586b6'},
 {id:'LIFESTYLE-DESK-02',file:'LIFESTYLE-DESK-02-candidate-v2.png',hash:'0a4f511525ee4c5322a11066c84f0f6d2edc6e07defaf0b0fb75e8d05a171895'},
 {id:'STUDIO-PLINTH-03',file:'STUDIO-PLINTH-03.png',hash:'4b1235741a9e705fd3b6ba0892234ad0090d0fa5b8ab6a095100ccdb4bcabc6b'},
];
const entries=[];
for(const item of reviewed){
 const source=join(root,item.file);
 const bytes=await readFile(source);
 const sha=createHash('sha256').update(bytes).digest('hex');
 if(sha!==item.hash)throw Error('STOP: '+item.file+' differs from the reviewed image. Nothing approved.');
 const meta=await sharp(bytes).metadata();
 if(meta.format!=='png'||meta.width!==1080||meta.height!==1350)
   throw Error('STOP: '+item.file+' is not the reviewed 1080x1350 PNG.');
 entries.push({...item,source,sha});
}
await mkdir(destination,{recursive:true});
try{await readFile(join(destination,'approvals.json'));throw Error('STOP: approved library already exists. Refusing to overwrite; inspect it manually.');}
catch(e){if(e.code!=='ENOENT')throw e;}
const manifest={};
for(const item of entries){
 const target=join(destination,item.id+'.png');
 try{await readFile(target);throw Error('STOP: '+target+' already exists. Refusing overwrite.');}
 catch(e){if(e.code!=='ENOENT')throw e;}
}
for(const item of entries){
 await copyFile(item.source,join(destination,item.id+'.png'));
 manifest[item.id]={source:'original-generated',approvedForProduction:true,sha256:item.sha};
 console.log('APPROVED',item.id,'from',item.file);
}
await writeFile(join(destination,'approvals.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
console.log('PASS: 3 reviewed scene plates approved with hash locking. No paid calls.');
console.log('APPROVED SCENE DIR:',destination);
