#!/usr/bin/env node
/**
 * RES-002 read-only postrun analysis. Never invokes Muse or modifies data.
 * Uses exact final Muse usage payload, held-out evaluator, independent MCP
 * audit, and checksums of source files integrated into candidate C.
 *
 * Usage: node experiments/harness/res002-analyze.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const root=join(homedir(),'Projects/res002-fair-20261029');
const op=join(root,'operator');
const readJson=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const events=path=>{
  if (!existsSync(path)) return {valid:[],invalid:0};
  let invalid=0;
  const valid=[];
  for(const line of readFileSync(path,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)) {
    if(!line.trim()) continue;
    try { valid.push(JSON.parse(line)); } catch {invalid++}
  }
  return {valid,invalid};
};
const sha=content=>createHash('sha256').update(content).digest('hex');
const numeric=v=>typeof v==='number' && Number.isFinite(v);
function usageSummary(raw) {
  // Muse logs one final cumulative payload with a models[] array.
  // Do not incorrectly sum this cumulative usage over per-call events.
  const summaries=raw.filter(e=>Array.isArray(e?.payload?.models));
  if(!summaries.length) return {available:false, reason:'No final models[] usage payload observed'};
  const latest=summaries.at(-1);
  const models=latest.payload.models.map(m=>({
    model:m.model ?? m.name ?? null,
    inputTokens:numeric(m.input_tokens)?m.input_tokens:null,
    cachedTokens:numeric(m.cached_tokens)?m.cached_tokens:null,
    outputTokens:numeric(m.output_tokens)?m.output_tokens:null,
    reasoningTokens:numeric(m.reasoning_tokens)?m.reasoning_tokens:null,
    // Only use explicit reported numeric billing values; do not infer.
    costUsd:numeric(m.cost_usd)?m.cost_usd:null,
  }));
  const sum=key=>models.every(m=>numeric(m[key]))?
    models.reduce((n,m)=>n+m[key],0):null;
  const input=sum('inputTokens'),cached=sum('cachedTokens');
  const costKnown=models.every(m=>numeric(m.costUsd));
  return {
    available:true,finalUsageEventCount:summaries.length,models,
    inputTokens:input,cachedTokens:cached,
    uncachedTokens:numeric(input)&&numeric(cached)?input-cached:null,
    outputTokens:sum('outputTokens'),reasoningTokens:sum('reasoningTokens'),
    billedCostUsd:costKnown?sum('costUsd'):null,
    costNote:costKnown?'Explicit model cost supplied by Muse':
      'Muse did not expose per-run billed cost in final model usage; platform balance alone cannot allocate it',
  };
}
function filesUnder(folder) {
  const result=[];
  function visit(path) {
    if(!existsSync(path))return;
    for(const entry of readdirSync(path,{withFileTypes:true})) {
      if(['node_modules','.git','dist','coverage'].includes(entry.name))continue;
      const target=join(path,entry.name);
      if(entry.isDirectory())visit(target);
      else if(entry.isFile() && /\.(?:ts|js|mts|mjs)$/.test(entry.name))
        result.push({path:target,hash:sha(readFileSync(target))});
    }
  }
  visit(join(folder,'src'));
  return result;
}
function candidate(label) {
  const recordPath=join(op,'run-'+label+'.json');
  const reportPath=join(root,'reports',label+'-quality.json');
  const raw=events(join(op,'run-'+label+'.jsonl'));
  const r={condition:label,runExists:existsSync(recordPath)};
  if(r.runExists) {
    const rec=readJson(recordPath);
    Object.assign(r,{stage:rec.stage,model:rec.model,reasoningEffort:rec.reasoningEffort,
      maxModelSteps:rec.maxModelSteps,codingSeconds:rec.codingSeconds,
      museExitCode:rec.museExitCode,buildExitCode:rec.buildExitCode,
      session:rec.runId});
  }
  if(existsSync(reportPath)) {
    const q=readJson(reportPath);
    r.quality={
      evaluatorReportBenchmark:q.benchmark,checks:q.checks,passed:q.passed,
      weightedScore:q.weightedScore,
      failedChecks:(q.details??[]).filter(c=>!c.passed).map(c=>({
        id:c.id,weight:c.weight,error:c.error,
      })),
    };
  }
  r.eventCount=raw.valid.length;
  r.unparseableEventLines=raw.invalid;
  r.usage=usageSummary(raw.valid);
  return r;
}
const B=candidate('B'),C=candidate('C');
const audit=events(join(op,'C-mcp-audit.jsonl'));
const counts={};
for(const item of audit.valid) {
  const key=String(item.tool)+':'+String(item.status);
  counts[key]=(counts[key]??0)+1;
}
const retrieved=audit.valid.filter(e=>e.tool==='get_verified_component_source' &&
  e.status==='success' && e.component==='booking-reservation-kernel@0.2.0');
const full=retrieved.filter(e=>e.truncated===false &&
  ['reservationKernelV2.ts','schema.ts','validation.ts','slotGuard.ts'].every(
    filename=>e.files?.some(f=>f.path.endsWith('/'+filename) && f.truncated===false)));
const candidateFiles=filesUnder(join(root,'C'));
const expectedFiles=['reservationKernelV2.ts','schema.ts','validation.ts','slotGuard.ts'];
const srcProof=expectedFiles.map(name=>{
  const source=full.flatMap(e=>e.files).find(f=>f.path.endsWith('/'+name));
  const integrated=candidateFiles.filter(f=>f.hash===source?.sha256);
  return {
    filename:name,retrievedSha256:source?.sha256??null,
    exactByteCopiesInCandidate:integrated.map(f=>relative(join(root,'C'),f.path).replaceAll('\\','/')),
  };
});
// Static source-level graph: follow imports from src/server.ts to src/ modules.
// When matched files are reachable, final HTTP evaluator executes this entry
// point; this is evidence of integration, not a dynamic coverage guarantee.
const filesByPath=new Map(candidateFiles.map(f=>[resolve(f.path),f]));
function importedModules(start) {
  const reached=new Set();
  const pending=[resolve(start)];
  while(pending.length) {
    const current=pending.shift();
    if(reached.has(current) || !existsSync(current))continue;
    reached.add(current);
    const body=readFileSync(current,'utf8');
    const exp=/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g;
    for(const match of body.matchAll(exp)) {
      const spec=match[1];
      const rel=spec.replace(/\.js$/i,'.ts').replace(/\.mjs$/i,'.mts');
      const target=resolve(dirname(current),rel);
      if(filesByPath.has(target))pending.push(target);
    }
  }
  return reached;
}
const reachable=importedModules(join(root,'C/src/server.ts'));
const importedExactFiles=srcProof.filter(p=>p.exactByteCopiesInCandidate.some(
  rel=>reachable.has(resolve(join(root,'C'),rel))));
const proof={
  auditExists:existsSync(join(op,'C-mcp-audit.jsonl')),
  auditEvents:audit.valid.length,unparseableAuditLines:audit.invalid,
  eventsByType:counts,
  searchFoundKernel:audit.valid.some(e=>e.tool==='search_verified_components' &&
    e.status==='success' && e.resultIds?.includes('booking-reservation-kernel@0.2.0')),
  inspectedKernel:audit.valid.some(e=>e.tool==='inspect_verified_component' &&
    e.status==='success' && e.component==='booking-reservation-kernel@0.2.0'),
  successfulSourceRetrievals:retrieved.length,
  completeUntruncatedRetrievals:full.length,
  sourceProof:srcProof,
  identicalFilesCount:srcProof.filter(p=>p.exactByteCopiesInCandidate.length>0).length,
  sourceFilesReachableByStaticImportsFromServer:importedExactFiles.map(p=>p.filename),
  interpretation:'Hash matches and static import reachability substantiate integration; runtime scoring separately verifies HTTP behavior. No dynamic execution tracing.',
};
const difference=(a,b)=>numeric(a)&&numeric(b)?b-a:null;
const relativeReduction=(a,b)=>numeric(a)&&numeric(b)&&a>0
  ? Number((100*(a-b)/a).toFixed(2)):null;
const comparison={
  qualityDeltaPoints:difference(B.quality?.weightedScore,C.quality?.weightedScore),
  codingSecondsDelta:difference(B.codingSeconds,C.codingSeconds),
  speedupBOverC:numeric(B.codingSeconds)&&numeric(C.codingSeconds)&&C.codingSeconds>0
    ?Number((B.codingSeconds/C.codingSeconds).toFixed(3)):null,
  totalInputReductionPercent:relativeReduction(B.usage.inputTokens,C.usage.inputTokens),
  uncachedInputReductionPercent:relativeReduction(B.usage.uncachedTokens,C.usage.uncachedTokens),
  outputReductionPercent:relativeReduction(B.usage.outputTokens,C.usage.outputTokens),
  billedCostDeltaUsd:difference(B.usage.billedCostUsd,C.usage.billedCostUsd),
};
process.stdout.write(JSON.stringify({
  benchmark:'RES-002',
  classification:'READ_ONLY_INDEPENDENT_POST_RUN_COMPARISON',
  evaluator:'Existing RES-001 held-out 41-check evaluator, unchanged',
  B,C,silkWebEvidence:proof,comparison,
  caveats:[
    'Single paired run: execution variance and model sampling not controlled',
    'Instructions demand checking for verified code, equally for B and C; this is assisted-reuse performance, not autonomous default adoption',
    'Do not attribute token differences to source reuse without stronger repeated trials',
    'No inferred billed dollar cost from usage or credit balance',
  ],
},null,2)+'\n');
