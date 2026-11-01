/**
 * Optional approved original/rights-cleared scene asset loader.
 * The nine user-supplied study photographs are NEVER loaded by this module.
 * Assets are local server-controlled files; never filenames supplied by customers.
 */
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {NINE_VISUAL_STUDIES} from './creativeVisualStudies.js';
export interface SceneAsset {id:string;dataUrl:string;sha256:string;}
type Approval={source:'original-generated'|'commercially-licensed';approvedForProduction:true;sha256:string};
const IDS=new Set(NINE_VISUAL_STUDIES.map(s=>s.id));
/**
 * The asset must be both in the fixed reference catalog and listed in
 * an explicit rights manifest with a matching hash. Failure is closed.
 */
export async function loadApprovedSceneAsset(id:string,root:string):Promise<SceneAsset|null>{
 if(!IDS.has(id)||!root.trim())return null;
 const base=resolve(root);
 let approvals:Record<string,unknown>;
 try{approvals=JSON.parse(await readFile(join(base,'approvals.json'),'utf8')) as Record<string,unknown>;}
 catch{return null;}
 const approval=approvals[id] as Partial<Approval>|undefined;
 if(!approval || approval.approvedForProduction!==true ||
    !['original-generated','commercially-licensed'].includes(approval.source??'') ||
    typeof approval.sha256!=='string'|| !/^[a-f0-9]{64}$/.test(approval.sha256))return null;
 let bytes:Buffer;
 try{bytes=await readFile(join(base,id+'.png'));}
 catch{return null;}
 if(bytes.length<64||bytes.length>6*1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')return null;
 const hash=createHash('sha256').update(bytes).digest('hex');
 if(hash!==approval.sha256)return null;
 try{
  const meta=await sharp(bytes).metadata();
  if(meta.format!=='png'||!meta.width||!meta.height||meta.width*meta.height>16_000_000)return null;
 }catch{return null;}
 return {id,dataUrl:'data:image/png;base64,'+bytes.toString('base64'),sha256:hash};
}
