#!/usr/bin/env node
/**
 * INV-INSTALL-002: READ-ONLY paired delivery analysis.
 * Uses original held-out reports, Muse final cumulative usage, separate
 * independently captured MCP audits, and source hashes. Never runs model,
 * edits application, modifies evidence or infers provider billing.
 */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(homedir(),'Projects','inv-install-002-20261030');
const op=join(root,'operator');
const json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const numeric=x=>typeof x==='number'&&Number.isFinite(x);
function events(path){
  if(!existsSync(path))return {exists:false,entries:[],invalid:0};
  let invalid=0;const entries=[];
  for(const line of readFileSync(path,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){
    if(!line.trim())continue;
    try{entries.push(JSON.parse(line));}catch{invalid++;}
  }
  return {exists:true,entries,invalid};
}
function usage(kind){
  const e=events(join(op,'muse-'+kind+'.jsonl'));
  const totals=e.entries.filter(x=>Array.isArray(x?.payload?.models));
  if(!totals.length)return {available:false,
    events:e.entries.length,invalid:e.invalid,reason:'No final cumulative Muse usage payload'};
  const models=totals.at(-1).payload.models.map(m=>({
    model:m.model??m.name??null,
    inputTokens:numeric(m.input_tokens)?m.input_tokens:null,
    cachedTokens:numeric(m.cached_tokens)?m.cached_tokens:null,
    outputTokens:numeric(m.output_tokens)?m.output_tokens:null,
    reasoningTokens:numeric(m.reasoning_tokens)?m.reasoning_tokens:null,
    explicitCostUsd:numeric(m.cost_usd)?m.cost_usd:null,
  }));
  const sum=k=>models.every(m=>numeric(m[k]))?models.reduce((s,m)=>s+m[k],0):null;
  const input=sum('inputTokens'),cached=sum('cachedTokens');
  return {available:true,models,events:e.entries.length,
    invalid:e.invalid,finalUsageEvents:totals.length,
    inputTokens:input,cachedTokens:cached,
    uncachedTokens:numeric(input)&&numeric(cached)?input-cached:null,
    outputTokens:sum('outputTokens'),reasoningTokens:sum('reasoningTokens'),
    explicitCostUsd:sum('explicitCostUsd')};
}
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const certified=join(repo,'packages/registry/src/inventory.ts');
const expected='3bc564618668ccfccebccff9cd8507ced3e8b445f09708fd12d8c2b11126bcf0';
const haveCertified=existsSync(certified)&&sha(certified)===expected;
function candidate(kind){
  const runPath=join(op,'run-'+kind+'.json');
  const evalPath=join(op,'evaluation-'+kind+'.json');
  const auditPath=join(op,'mcp-audit-'+kind+'.jsonl');
  const wd=join(root,kind);
  const record=existsSync(runPath)?json(runPath):null;
  const quality=existsSync(evalPath)?json(evalPath):null;
  const audit=events(auditPath);
  const actions={};
  for(const event of audit.entries){
    const k=String(event.tool??'?')+':'+String(event.status??'?');
    actions[k]=(actions[k]??0)+1;
  }
  const file=join(wd,'src/silkweb/inventory.ts');
  const sourceFileExists=existsSync(file);
  const observedSha256=sourceFileExists?sha(file):null;
  const exactSourceIntegrated=observedSha256===expected;
  const code=join(wd,'src/server.ts');
  const imports=existsSync(code)?readFileSync(code,'utf8'):'';
  const reachable=/from\s*['"][^'"]*silkweb\/inventory\.js['"]/.test(imports)||
    /import\s*\(\s*['"][^'"]*silkweb\/inventory\.js['"]\s*\)/.test(imports);
  const retrieval=audit.entries.some(e=>e.tool==='get_verified_component_source'&&
    e.status==='success'&&e.component==='inventory-reservation@0.1.0'&&
    e.truncated===false&&e.files?.some(f=>
      f.path==='packages/registry/src/inventory.ts'&&
      f.sha256===expected&&f.truncated===false));
  const installation=audit.entries.some(e=>e.tool==='install_verified_component'&&
    e.status==='success'&&e.component==='inventory-reservation@0.1.0'&&
    e.installStatus==='installed-source'&&e.files?.some(f=>
      f.path==='src/silkweb/inventory.ts'&&f.sha256===expected));
  const reportFile=join(wd,'.silkweb/installations/inventory-reservation@0.1.0.json');
  let auditedBytes=false,certifiedFingerprint=null;
  if(existsSync(reportFile)){
    try{
      const rep=json(reportFile);
      auditedBytes=rep.status==='installed-source'&&
        rep.component==='inventory-reservation@0.1.0'&&
        rep.files?.some(f=>f.destination==='src/silkweb/inventory.ts'&&f.sha256===expected);
      certifiedFingerprint=rep.registryFingerprint??null;
    }catch{/* Never infer validity from unreadable report. */}
  }
  return {
    condition:kind,runRecorded:!!record,stage:record?.stage??null,
    model:record?.model??null,reasoningEffort:record?.reasoningEffort??null,
    maxModelSteps:record?.maxModelSteps??null,
    mcpEnabled:record?.mcpEnabled??null,
    deterministicInstallEnabled:record?.deterministicInstallEnabled??null,
    taskSha256:record?.taskSha256??null,
    evaluatorSha256:record?.evaluatorSha256??null,
    initialCommit:record?.initialCommit??null,
    sourceCommit:record?.sourceCommit??null,
    museExitCode:record?.museExitCode??null,
    buildExitCode:record?.buildExitCode??null,
    evaluatorExitCode:record?.evaluatorExitCode??null,
    codingSeconds:record?.codingSeconds??null,
    quality:quality?{
      score:quality.score,passedChecks:quality.passedChecks,
      expectedChecks:quality.expectedChecks,evaluatorSha256:quality.evaluatorSha256,
      failures:quality.details?.filter(c=>!c.passed).map(c=>({id:c.id,error:c.error}))??[],
    }:{score:record?.stage==='evaluated'?0:null,passedChecks:null,
      expectedChecks:20,reason:'No held-out evaluator report'},
    usage:usage(kind),
    reuseEvidence:{
      auditExists:audit.exists,auditEvents:audit.entries.length,
      malformedAuditLines:audit.invalid,toolCalls:actions,
      fullSourceRetrieved:retrieval,installerSucceeded:installation,
      sourcePresent:sourceFileExists,sourceSha256:observedSha256,
      exactCertifiedBytes:haveCertified&&exactSourceIntegrated,
      applicationStaticImport:reachable,
      installationAuditExactBytes:auditedBytes,
      certificationFingerprint:certifiedFingerprint,
      deliveryProven:kind==='I'
        ?installation&&auditedBytes&&haveCertified&&exactSourceIntegrated&&reachable
        :retrieval&&haveCertified&&exactSourceIntegrated&&reachable,
    },
  };
}
const R=candidate('R'),I=candidate('I');
const matched=R.stage==='evaluated'&&I.stage==='evaluated'&&
  R.initialCommit===I.initialCommit&&R.taskSha256===I.taskSha256&&
  R.evaluatorSha256===I.evaluatorSha256&&R.sourceCommit===I.sourceCommit&&
  R.model===I.model&&R.reasoningEffort===I.reasoningEffort&&
  R.maxModelSteps===I.maxModelSteps&&
  R.mcpEnabled===true&&I.mcpEnabled===true&&
  R.deterministicInstallEnabled===false&&I.deterministicInstallEnabled===true;
const delta=(a,b)=>numeric(a)&&numeric(b)?Number((b-a).toFixed(3)):null;
const pct=(a,b)=>numeric(a)&&numeric(b)&&a>0?Number(((a-b)/a*100).toFixed(2)):null;
const comparison=matched?{
  qualityPointsIminusR:delta(R.quality.score,I.quality.score),
  codingSecondsIminusR:delta(R.codingSeconds,I.codingSeconds),
  speedupROverI:numeric(R.codingSeconds)&&numeric(I.codingSeconds)&&I.codingSeconds>0?
    Number((R.codingSeconds/I.codingSeconds).toFixed(3)):null,
  inputTokenReductionPercent:pct(R.usage.inputTokens,I.usage.inputTokens),
  uncachedInputReductionPercent:pct(R.usage.uncachedTokens,I.usage.uncachedTokens),
  outputTokenReductionPercent:pct(R.usage.outputTokens,I.usage.outputTokens),
  reasoningTokenReductionPercent:pct(R.usage.reasoningTokens,I.usage.reasoningTokens),
  explicitCostDeltaUsd:delta(R.usage.explicitCostUsd,I.usage.explicitCostUsd),
}:null;
process.stdout.write(JSON.stringify({
  benchmark:'INV-INSTALL-002',
  classification:matched?'OBSERVED_SINGLE_PAIR_TWO_MCP_DELIVERY_METHODS':
    'PARTIAL_OR_UNMATCHED_EVIDENCE',
  matchedConditions:matched,
  originalInventorySourcePresentAndUnchanged:haveCertified,
  R,I,comparison,cautions:[
    'One pair does not prove generalized causal improvement; run variance and agent decisions matter.',
    'Both conditions can search, inspect and retrieve certified source. Only I has the opt-in installer tool.',
    'The same frozen 20-check evaluator is reused; historical INV-BENCH-001 results are unchanged.',
    'Static import reachability and byte hashes prove provenance, not actual runtime function call tracing.',
    'No inference cost claim without explicit model billing or user-recorded immediate credit boundaries.',
    'Install method is not a verified result until audit + installation report + original source bytes agree.',
  ],
},null,2)+'\n');
