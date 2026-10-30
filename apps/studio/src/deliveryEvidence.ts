import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Present ONLY validated local INV-INSTALL-002 evidence. A browser cannot
 * choose a path; no source, prompt, raw Muse logs or credentials are emitted.
 * Source of truth: the operator's separately preserved immutable-input
 * snapshot plus independently checked original files and installed bytes.
 */
const SOURCE_SHA='3bc564618668ccfccebccff9cd8507ced3e8b445f09708fd12d8c2b11126bcf0';
const FROZEN_TASK='f86034b61e0d496527b180953adc2c4266eeb0e1fa05939d75733e2fdff84603';
const FROZEN_EVAL='b2fb7bf24638914dac2ac8a7999b40ecfde37bd51d55506874290fe7047e403b';
const ORIGINALS=[
  'preflight.json','run-R.json','run-I.json',
  'evaluation-R.json','evaluation-I.json',
  'mcp-audit-R.jsonl','mcp-audit-I.jsonl',
  'muse-R.jsonl','muse-I.jsonl',
] as const;
const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
type Obj=Record<string,unknown>;
const obj=(v:unknown):v is Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const number=(v:unknown):number|null=>num(v)?v:null;
const fail=(reason:string)=>({available:false as const,benchmark:'INV-INSTALL-002',reason});
function bytes(path:string,max=32*1024*1024):Buffer|null{
  try{
    if(!existsSync(path))return null;
    const stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)return null;
    return readFileSync(path);
  }catch{return null;}
}
function parsed(data:Buffer|null):Obj|null{
  if(!data)return null;
  try{
    const value:unknown=JSON.parse(data.toString('utf8').replace(/^\uFEFF/,''));
    return obj(value)?value:null;
  }catch{return null;}
}
function exactAudit(path:string,tool:string,sourceExpected:boolean):boolean{
  const data=bytes(path);
  if(!data)return false;
  try{
    const rows=data.toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(s=>s.trim()).map(s=>JSON.parse(s) as unknown);
    if(rows.length!==3||rows.some(e=>!obj(e)||e['status']!=='success'))return false;
    if(!rows.some(e=>obj(e)&&e['tool']==='search_verified_components'))return false;
    if(!rows.some(e=>obj(e)&&e['tool']==='inspect_verified_component'))return false;
    const found=rows.find(e=>obj(e)&&e['tool']===tool) as Obj|undefined;
    if(!found||found['component']!=='inventory-reservation@0.1.0')return false;
    if(sourceExpected){
      if(found['truncated']!==false)return false;
    }else if(found['installStatus']!=='installed-source')return false;
    const files=found['files'];
    return Array.isArray(files)&&files.some(f=>obj(f)&&
      f['sha256']===SOURCE_SHA&&
      f['path']===(sourceExpected?'packages/registry/src/inventory.ts':'src/silkweb/inventory.ts')&&
      f['truncated']===false);
  }catch{return false;}
}
export function readDeliveryEvidence(projectsRoot:string){
  const root=join(projectsRoot,'inv-install-002-20261030');
  const dir=join(root,'operator');
  const snapshot=parsed(bytes(join(dir,'INV-INSTALL-002-final-evidence.json'),1024*1024));
  if(!snapshot)return fail('Preserved INV-INSTALL-002 snapshot is not available.');
  if(snapshot['benchmark']!=='INV-INSTALL-002'||
     snapshot['classification']!=='OBSERVED_SINGLE_PAIR')return fail('Unexpected evidence classification.');
  const digests=snapshot['originalEvidenceSha256'];
  if(!obj(digests)||Object.keys(digests).length!==ORIGINALS.length)return fail('Original evidence inventory incomplete.');
  for(const name of ORIGINALS){
    const expected=digests[name];
    if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))return fail('Original evidence hash missing.');
    const raw=bytes(join(dir,name));
    if(!raw||sha(raw)!==expected)return fail('Original evidence has changed or is missing.');
  }
  const preflight=parsed(bytes(join(dir,'preflight.json'),1024*1024));
  const runR=parsed(bytes(join(dir,'run-R.json'),1024*1024));
  const runI=parsed(bytes(join(dir,'run-I.json'),1024*1024));
  const evalR=parsed(bytes(join(dir,'evaluation-R.json'),1024*1024));
  const evalI=parsed(bytes(join(dir,'evaluation-I.json'),1024*1024));
  const analysis=snapshot['analysis'];
  if(!preflight||!runR||!runI||!evalR||!evalI||!obj(analysis))
    return fail('Incomplete original run records.');
  if(preflight['benchmark']!=='INV-INSTALL-002'||preflight['taskSha256']!==FROZEN_TASK||
     preflight['evaluatorSha256']!==FROZEN_EVAL||
     preflight['certifiedSourceSha256']!==SOURCE_SHA)
    return fail('Preflight identity mismatch.');
  if(analysis['benchmark']!=='INV-INSTALL-002'||
     analysis['matchedConditions']!==true||
     analysis['originalInventorySourcePresentAndUnchanged']!==true)
    return fail('Independent comparison not verified.');
  const aR=analysis['R'],aI=analysis['I'];
  if(!obj(aR)||!obj(aI))return fail('Missing original analysis.');
  for(const [kind,run,evaluation,analyzed] of [
    ['R',runR,evalR,aR],['I',runI,evalI,aI]
  ] as const){
    const quality=analyzed['quality'];
    if(!obj(quality)||
       run['benchmark']!=='INV-INSTALL-002'||run['condition']!==kind||
       run['stage']!=='evaluated'||run['mcpEnabled']!==true||
       run['model']!=='muse-spark-1.3'||run['reasoningEffort']!=='high'||
       run['maxModelSteps']!==55||
       run['taskSha256']!==FROZEN_TASK||
       run['evaluatorSha256']!==FROZEN_EVAL||
       run['museExitCode']!==0||run['buildExitCode']!==0||
       run['evaluatorExitCode']!==0||!num(run['codingSeconds'])||
       run['codingSeconds']<=0||
       run['quality']!==100||run['passedChecks']!==20||
       evaluation['benchmark']!=='INV-BENCH-001'||
       evaluation['success']!==true||evaluation['passedChecks']!==20||
       evaluation['expectedChecks']!==20||evaluation['score']!==100||
       evaluation['evaluatorSha256']!==FROZEN_EVAL||
       quality['score']!==100||quality['passedChecks']!==20||
       analyzed['codingSeconds']!==run['codingSeconds'])
      return fail('Run or evaluation consistency check failed.');
  }
  if(runR['deterministicInstallEnabled']!==false||
     runI['deterministicInstallEnabled']!==true||
     runR['initialCommit']!==runI['initialCommit']||
     runR['sourceCommit']!==runI['sourceCommit']||
     runR['taskSha256']!==runI['taskSha256']||
     runR['evaluatorSha256']!==runI['evaluatorSha256'])
    return fail('Conditions are not matched.');
  const rUsage=aR['usage'],iUsage=aI['usage'];
  const rProof=aR['reuseEvidence'],iProof=aI['reuseEvidence'];
  if(!obj(rUsage)||!obj(iUsage)||!obj(rProof)||!obj(iProof)||
     rUsage['available']!==true||iUsage['available']!==true||
     rProof['fullSourceRetrieved']!==true||
     rProof['exactCertifiedBytes']!==false||
     rProof['applicationStaticImport']!==true||
     iProof['deliveryProven']!==true||iProof['installerSucceeded']!==true||
     iProof['exactCertifiedBytes']!==true||
     iProof['installationAuditExactBytes']!==true||
     iProof['applicationStaticImport']!==true||
     iProof['sourceSha256']!==SOURCE_SHA)
    return fail('Source-delivery proof incomplete.');
  if(!exactAudit(join(dir,'mcp-audit-R.jsonl'),'get_verified_component_source',true)||
     !exactAudit(join(dir,'mcp-audit-I.jsonl'),'install_verified_component',false))
    return fail('MCP delivery audit does not confirm the claimed operations.');
  const source=bytes(join(root,'I','src/silkweb/inventory.ts'),256*1024);
  const report=parsed(bytes(join(root,'I','.silkweb/installations/inventory-reservation@0.1.0.json'),1024*1024));
  if(!source||sha(source)!==SOURCE_SHA||!report||
     report['status']!=='installed-source'||
     report['component']!=='inventory-reservation@0.1.0'||
     !Array.isArray(report['files'])||
     !report['files'].some(f=>obj(f)&&f['destination']==='src/silkweb/inventory.ts'&&f['sha256']===SOURCE_SHA))
    return fail('Installed certified bytes or audit report no longer match.');
  const rTime=runR['codingSeconds'] as number;
  const iTime=runI['codingSeconds'] as number;
  const reductions=(field:string)=>{
    const r=number(rUsage[field]),i=number(iUsage[field]);
    return r!==null&&i!==null&&r>0&&i>=0?
      {R:r,I:i,reductionPercent:Number(((r-i)/r*100).toFixed(2))}:null;
  };
  const credit=snapshot['creditObservations'];
  const cr=obj(credit)&&obj(credit['R'])?credit['R']:null;
  const ci=obj(credit)&&obj(credit['I'])?credit['I']:null;
  const balance=cr&&ci&&num(cr['before'])&&num(cr['after'])&&num(cr['decrease'])&&
    num(ci['before'])&&num(ci['after'])&&num(ci['decrease'])&&
    Math.abs((cr['before']-cr['after'])-cr['decrease'])<0.001&&
    Math.abs((ci['before']-ci['after'])-ci['decrease'])<0.001?
    {R:cr['decrease'] as number,I:ci['decrease'] as number}:null;
  return {
    available:true as const,
    benchmark:'INV-INSTALL-002',
    model:'Muse Spark 1.3 / high',
    design:'Single matched pair; both have Silk Web MCP. R retrieves source manually; I uses deterministic installation.',
    sourceSha256:SOURCE_SHA,
    quality:{R:100,I:100,checks:20},
    coding:{R:rTime,I:iTime,reductionPercent:Number(((rTime-iTime)/rTime*100).toFixed(2))},
    input:reductions('inputTokens'),
    uncached:reductions('uncachedTokens'),
    output:reductions('outputTokens'),
    reasoning:reductions('reasoningTokens'),
    credits:balance,
    sourceIntegrity:{R:false,I:true,installedAndAudited:true},
    caveats:[
      'Single pair is descriptive, not statistically conclusive.',
      'Both conditions have Silk Web; this is source retrieval versus deterministic installation, NOT without-versus-with Silk Web.',
      'Credit differences reflect observed account balances, not explicit per-run model billing.',
      'Exact byte reuse and static import are verified; runtime call traces were not collected.',
    ],
  };
}
