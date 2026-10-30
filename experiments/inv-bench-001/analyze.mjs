#!/usr/bin/env node
/**
 * INV-BENCH-001 read-only comparison of observed Muse runs, independent
 * HTTP scores, C MCP audit, and hash-identical module integration.
 * Never runs Muse/quality tests or edits benchmark artifacts.
 */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,relative,resolve} from 'node:path';
const root=join(homedir(),'Projects','inv-bench-001-20261030');
const op=join(root,'operator');
const sha=data=>createHash('sha256').update(data).digest('hex');
const readJson=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
function events(path){
  if(!existsSync(path))return {found:false,rows:[],invalid:0};
  const rows=[];let invalid=0;
  for(const line of readFileSync(path,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){
    if(!line.trim())continue;
    try{rows.push(JSON.parse(line));}catch{invalid++;}
  }
  return {found:true,rows,invalid};
}
function usage(path){
  const e=events(path);
  // Final event models[] is cumulative. Never sum cumulative event totals.
  const finals=e.rows.filter(x=>Array.isArray(x?.payload?.models));
  if(!finals.length)return {available:false,parsedEvents:e.rows.length,
    invalidLines:e.invalid,reason:'No final cumulative Muse models[] usage record'};
  const models=finals.at(-1).payload.models.map(x=>({
    model:x.model??x.name??null,
    inputTokens:numeric(x.input_tokens)?x.input_tokens:null,
    cachedTokens:numeric(x.cached_tokens)?x.cached_tokens:null,
    outputTokens:numeric(x.output_tokens)?x.output_tokens:null,
    reasoningTokens:numeric(x.reasoning_tokens)?x.reasoning_tokens:null,
    explicitBilledCostUsd:numeric(x.cost_usd)?x.cost_usd:null,
  }));
  const sum=k=>models.every(x=>numeric(x[k]))?models.reduce((n,x)=>n+x[k],0):null;
  const input=sum('inputTokens'),cached=sum('cachedTokens');
  return {
    available:true,models,finalCumulativeEvents:finals.length,
    parsedEvents:e.rows.length,invalidLines:e.invalid,
    inputTokens:input,cachedTokens:cached,
    uncachedTokens:numeric(input)&&numeric(cached)?input-cached:null,
    outputTokens:sum('outputTokens'),reasoningTokens:sum('reasoningTokens'),
    explicitBilledCostUsd:sum('explicitBilledCostUsd'),
  };
}
function candidate(kind){
  const rec=join(op,'run-'+kind+'.json');
  const rep=join(op,'evaluation-'+kind+'.json');
  const result={condition:kind,runRecorded:existsSync(rec)};
  if(existsSync(rec)){
    const r=readJson(rec);
    Object.assign(result,{
      stage:r.stage,model:r.model,reasoningEffort:r.reasoningEffort,
      maxModelSteps:r.maxModelSteps,codingSeconds:r.codingSeconds,
      mcpEnabled:r.mcpEnabled,museExitCode:r.museExitCode,
      buildExitCode:r.buildExitCode,evaluatorExitCode:r.evaluatorExitCode,
      taskSha256:r.taskSha256,sourceCommit:r.sourceCommit,
      initialCommit:r.initialCommit,
    });
  }
  if(existsSync(rep)){
    const r=readJson(rep);
    result.quality={
      score:r.score,passedChecks:r.passedChecks,
      expectedChecks:r.expectedChecks,allExpected:r.observedChecks===r.expectedChecks,
      success:r.success,evaluatorSha256:r.evaluatorSha256,
      compiledServerSha256:r.compiledServerSha256,
      failures:r.details.filter(x=>!x.passed).map(x=>({id:x.id,error:x.error})),
    };
  }else{
    result.quality={score:result.stage==='evaluated'?0:null,
      passedChecks:0,expectedChecks:20,success:false,
      reason:'No independent evaluator report; if compilation failed quality is zero'};
  }
  result.usage=usage(join(op,'muse-'+kind+'.jsonl'));
  return result;
}
function sourceFiles(folder){
  const results=[];
  function traverse(dir){
    if(!existsSync(dir))return;
    for(const f of readdirSync(dir,{withFileTypes:true})){
      if(f.isSymbolicLink())continue;
      const abs=join(dir,f.name);
      if(f.isDirectory())traverse(abs);
      else if(f.isFile()&&/\.(ts|mts|js|mjs)$/.test(f.name)){
        results.push({path:relative(folder,abs).replace(/\\/g,'/'),
          sha256:sha(readFileSync(abs))});
      }
    }
  }
  traverse(join(folder,'src'));return results;
}
function adoption(){
  const records=events(join(op,'C-mcp-audit.jsonl'));
  const actions={};
  for(const e of records.rows){
    const key=String(e.tool??'?')+':'+String(e.status??'?');
    actions[key]=(actions[key]??0)+1;
  }
  const fetched=records.rows.filter(x=>
    x.tool==='get_verified_component_source'&&x.status==='success'&&
    x.component==='inventory-reservation@0.1.0'&&x.truncated===false &&
    x.files?.some(f=>f.path==='packages/registry/src/inventory.ts'&&f.truncated===false));
  const approved='3bc564618668ccfccebccff9cd8507ced3e8b445f09708fd12d8c2b11126bcf0';
  const matchingRetrieval=fetched.some(x=>x.files.some(f=>f.sha256===approved));
  const files=sourceFiles(join(root,'C'));
  const matches=files.filter(x=>x.sha256===approved);
  const server=join(root,'C','src/server.ts');
  let staticReference=false;
  if(existsSync(server)){
    const body=readFileSync(server,'utf8');
    staticReference=/from\s*['"][^'"]*silkweb\/inventory\.js['"]/.test(body)||
      /import\s*\(\s*['"][^'"]*silkweb\/inventory\.js['"]\s*\)/.test(body);
  }
  return {
    auditExists:records.found,auditEventCount:records.rows.length,
    malformedAuditLines:records.invalid,toolActions:actions,
    fullVerifiedSourceRetrieved:matchingRetrieval,
    exactSourceIntegrated:matches.length>0,
    matchingFiles:matches.map(x=>x.path),
    serverImportsCertifiedModule:staticReference,
    verifiedReuseProven:matchingRetrieval&&matches.length>0&&staticReference,
    caveat:'Static source/hash/import evidence supports reuse; no runtime call tracing.',
  };
}
const B=candidate('B'),C=candidate('C');
const proof=adoption();
const delta=(a,b)=>numeric(a)&&numeric(b)?Number((b-a).toFixed(4)):null;
const reduction=(a,b)=>numeric(a)&&numeric(b)&&a>0?Number(((a-b)/a*100).toFixed(2)):null;
const paired=B.stage==='evaluated'&&C.stage==='evaluated'&&
  B.taskSha256===C.taskSha256&&B.initialCommit===C.initialCommit&&
  B.sourceCommit===C.sourceCommit&&B.mcpEnabled===false&&C.mcpEnabled===true;
const result={
  benchmark:'INV-BENCH-001',classification:paired?
    'OBSERVED_SINGLE_PAIR_WITH_HELDOUT_BLACKBOX_EVALUATION':
    'PARTIAL_OR_UNMATCHED_OBSERVATIONS',
  fairPairObserved:paired,
  B,C,silkWebEvidence:proof,
  comparison:paired?{
    qualityPointsCMinusB:delta(B.quality.score,C.quality.score),
    codingSecondsCMinusB:delta(B.codingSeconds,C.codingSeconds),
    speedupBOverC:numeric(B.codingSeconds)&&numeric(C.codingSeconds)&&C.codingSeconds>0?
      Number((B.codingSeconds/C.codingSeconds).toFixed(3)):null,
    inputTokenReductionPercent:reduction(B.usage.inputTokens,C.usage.inputTokens),
    uncachedInputTokenReductionPercent:reduction(B.usage.uncachedTokens,C.usage.uncachedTokens),
    outputTokenReductionPercent:reduction(B.usage.outputTokens,C.usage.outputTokens),
    explicitBilledCostDeltaCMinusB:delta(B.usage.explicitBilledCostUsd,C.usage.explicitBilledCostUsd),
  }:null,
  cautions:[
    'A single B/C pair does not show statistical generalization or isolate run variance.',
    'Identical conditional instructions encourage reuse if MCP available; not default autonomous adoption.',
    'Do not infer per-run billing from balance changes without recorded immediate boundaries.',
    'Do not infer reuse from mere tool search; require retrieved source, matching source bytes and static import.',
    'This application score is independent from the inventory component authoring acceptance (11/11).',
  ],
};
process.stdout.write(JSON.stringify(result,null,2)+'\n');
