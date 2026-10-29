#!/usr/bin/env node
/**
 * Independent, no-model evaluator for MUSE-INSTALL-001.
 * Never changes the candidate, registry or earlier benchmark results.
 * The report distinguishes certified source installation from app correctness.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = join(homedir(), 'Projects/muse-installer-trial-20261029');
const op = join(root,'operator');
const metadataPath = join(op,'preflight.json');
if (!existsSync(metadataPath)) throw new Error('No MUSE-INSTALL-001 preflight');
const meta = JSON.parse(readFileSync(metadataPath,'utf8'));
if (meta.trial !== 'MUSE-INSTALL-001') throw new Error('Wrong preflight');
const reportPath = join(op,'evaluation.json');
if (existsSync(reportPath)) throw new Error('Evaluation already exists: refuse overwrite');
const candidate = meta.candidate;
const sourceRoot = meta.sourceRepo;
const spec = 'booking-reservation-kernel@0.2.0';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const expectedNames = ['reservationKernelV2.ts','schema.ts','slotGuard.ts','validation.ts'];
const evidence = readJson(join(sourceRoot,'registry-data/evidence/booking-reservation-kernel-0.2.0.json'));
const report = {
  trial:'MUSE-INSTALL-001',
  design:'ONE_GUIDED_MUSE_INSTALLER_ADOPTION_NOT_A_B_COMPARISON',
  sourceCommit:meta.sourceCommit,
  promptSha256:meta.promptSha256,
  success:false,
  classification:'NOT_EVALUATED',
  checks:[],
};
function check(id, value, reason = '') {
  report.checks.push({id,passed:value === true, detail:reason});
}
function jsonl(path) {
  const events = []; let invalid = 0;
  if (!existsSync(path)) return {events, invalid};
  for (const line of readFileSync(path,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); }
    catch { invalid++; }
  }
  return {events, invalid};
}
for (const [rel,expected] of Object.entries(meta.pinnedSha256)) {
  const absolute = join(sourceRoot,rel);
  if (!existsSync(absolute) || sha(readFileSync(absolute)) !== expected) {
    throw new Error('Pinned source changed since preparation: '+rel);
  }
}
if (sha(readFileSync(meta.promptPath)) !== meta.promptSha256)
  throw new Error('Frozen prompt modified since preparation');
const runRecord = existsSync(join(op,'run.json')) ? readJson(join(op,'run.json')) : null;
report.model = runRecord?.model ?? null;
report.reasoningEffort = runRecord?.reasoningEffort ?? null;
report.maxModelSteps = runRecord?.maxModelSteps ?? null;
report.codingSeconds = runRecord?.codingSeconds ?? null;
report.museExitCode = runRecord?.museExitCode ?? null;
report.buildExitCode = runRecord?.buildExitCode ?? null;
check('actual_muse_run_completed', runRecord?.museExitCode === 0, 'exit='+String(runRecord?.museExitCode ?? 'missing'));
check('target_build_passed', runRecord?.buildExitCode === 0, 'exit='+String(runRecord?.buildExitCode ?? 'missing'));

const audit = jsonl(meta.auditLog);
const search = audit.events.filter(e=>e.tool==='search_verified_components' && e.status==='success');
const inspected = audit.events.filter(e=>e.tool==='inspect_verified_component' &&
  e.status==='success' && e.component === spec);
const sourceCalls = audit.events.filter(e=>e.tool==='get_verified_component_source');
report.audit = {
  events:audit.events.length, invalidLines:audit.invalid,
  searches:search.length, inspections:inspected.length, sourceRetrievalCalls:sourceCalls.length,
};
check('mcp_search_found_certified_kernel',
  search.some(e=>e.resultIds?.includes(spec)));
check('mcp_inspected_certified_kernel', inspected.length > 0);
check('no_mcp_source_retrieval', sourceCalls.length === 0,
  'retrieval count='+sourceCalls.length);

const installationPath = join(candidate,'.silkweb/installations',spec+'.json');
let installation = null;
try { installation = readJson(installationPath); } catch { /* recorded as failure */ }
check('installer_report_present', installation?.component === spec &&
  installation.status === 'installed-source');
check('registry_evidence_fingerprint_matches',
  installation?.registryFingerprint === evidence.artifactFingerprint &&
  installation?.certifiedSourceHash === evidence.sections.sources &&
  installation?.certificationEvidence === 'registry-data/evidence/booking-reservation-kernel-0.2.0.json');
check('dependency_closure_recorded',
  JSON.stringify(installation?.dependencyClosure) === JSON.stringify([
    'booking-reservation-kernel@0.2.0','booking-schema@0.1.0',
    'booking-slot-guard@0.1.0','booking-validation@0.1.0',
  ]));
check('installation_audit_records_four_sources',
  Array.isArray(installation?.files) && installation.files.length === 4 &&
  expectedNames.every(name=>installation.files.some(f=>f.destination === 'src/silkweb/'+name)));
const digestResults = [];
for (const name of expectedNames) {
  const rel = 'src/silkweb/'+name;
  const file = join(candidate,rel);
  const origin = join(sourceRoot,'packages/registry/src',name);
  const expected = installation?.files?.find(f=>f.destination === rel);
  const actual = existsSync(file) ? sha(readFileSync(file)) : null;
  const certified = sha(readFileSync(origin));
  const matched = !!expected && expected.sha256 === actual && actual === certified &&
    expected.registryPath === 'packages/registry/src/'+name;
  check('source_integrity_'+name, matched);
  digestResults.push({path:rel,sha256:actual,matched});
}
report.integratedFiles = digestResults;
let adapterText = '';
try { adapterText = readFileSync(join(candidate,'src/probe.ts'),'utf8'); } catch {}
const imported = /from\s*['"]\.\/silkweb\/reservationKernelV2\.js['"]/.test(adapterText);
const used = ['initializeReservationKernel','createIdempotentBooking','cancelReservation']
  .every(token=>adapterText.includes(token));
check('agent_adapter_imports_certified_kernel', imported && used);

function runProbe() {
  const built = join(candidate,'dist/probe.js');
  if (!existsSync(built)) return {pass:false,detail:'dist/probe.js missing'};
  const run = spawnSync(process.execPath, [built], {
    cwd:candidate, encoding:'utf8', timeout:20000,
  });
  return {pass:run.status === 0 && run.stdout.trim() === 'ADOPTION_OK',
    detail:'exit='+run.status+' stdout='+run.stdout.trim().slice(0,120)+
      ' stderr='+String(run.stderr??'').trim().slice(0,140)};
}
const probe = runProbe();
check('agent_adapter_runtime_scenario', probe.pass, probe.detail);

// Independent tester exercises the installed compiled kernel, rather than
// relying solely on a model-written "ADOPTION_OK" assertion.
const independentCode = [
  'import assert from "node:assert/strict";',
  'import { DatabaseSync } from "node:sqlite";',
  'import { initializeReservationKernel, createIdempotentBooking, cancelReservation } from "./dist/silkweb/reservationKernelV2.js";',
  'const db=new DatabaseSync(":memory:");',
  'try {',
  '  initializeReservationKernel(db);',
  '  db.prepare("INSERT INTO staff (id,name) VALUES (?,?)").run(1,"Agent");',
  '  db.prepare("INSERT INTO services (id,name,duration_minutes) VALUES (?,?,?)").run(1,"Cut",30);',
  '  const input={idempotencyKey:"independent-test-001",staffId:1,serviceId:1,startTime:"2026-11-05T10:00:00.000Z"};',
  '  const first=createIdempotentBooking(db,input);',
  '  assert.equal(first.replayed,false);',
  '  const second=createIdempotentBooking(db,input);',
  '  assert.equal(second.replayed,true);',
  '  assert.equal(second.booking.id,first.booking.id);',
  '  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM appointments").get().n,1);',
  '  cancelReservation(db,first.booking.id);',
  '  assert.equal(createIdempotentBooking(db,input).booking.status,"cancelled");',
  '  console.log("INDEPENDENT_KERNEL_OK");',
  '} finally { db.close(); }',
].join('\n');
const kernel = spawnSync(process.execPath,['--input-type=module','-e',independentCode],{
  cwd:candidate,encoding:'utf8',timeout:20000,
});
check('independent_kernel_runtime_verification',
  kernel.status === 0 && kernel.stdout.trim() === 'INDEPENDENT_KERNEL_OK',
  'exit='+kernel.status+' stderr='+String(kernel.stderr??'').trim().slice(0,150));

const log = jsonl(join(op,'muse.jsonl'));
const usageEvents = log.events.filter(e=>Array.isArray(e?.payload?.models));
const models = usageEvents.at(-1)?.payload.models ?? [];
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const sum = key => models.length && models.every(m=>numeric(m[key]))
  ? models.reduce((total,m)=>total+m[key],0) : null;
const input = sum('input_tokens');
const cached = sum('cached_tokens');
report.usage = {
  available:models.length>0,
  finalUsageEvents:usageEvents.length,
  completedModelCalls:usageEvents.at(-1)?.payload?.total_completed_calls ?? null,
  inputTokens:input,
  cachedInputTokens:cached,
  uncachedInputTokens:numeric(input)&&numeric(cached)?input-cached:null,
  outputTokens:sum('output_tokens'),
  reasoningTokens:sum('reasoning_tokens'),
  explicitBilledUsd:sum('cost_usd'),
  billingNote:'Only direct per-session cost_usd is billing evidence. Credit-balance changes are approximate.',
  note:'No B/control run: token figures are descriptive, not evidence of savings.',
};
report.checksPassed = report.checks.filter(x=>x.passed).length;
report.checksTotal = report.checks.length;
report.success = report.checksPassed === report.checksTotal;
report.classification = report.success
  ? 'GUIDED_MUSE_VERIFIED_INSTALL_AND_EXECUTION_PROVEN'
  : 'ADOPTION_NOT_FULLY_PROVEN';
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({
  trial:report.trial,
  classification:report.classification,
  passed:report.checksPassed,
  total:report.checksTotal,
  failedChecks:report.checks.filter(x=>!x.passed),
  audit:report.audit,
  usage:report.usage,
  reportPath,
},null,2)+'\n');
process.exitCode = report.success ? 0 : 1;
