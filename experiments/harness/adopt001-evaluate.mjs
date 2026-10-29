#!/usr/bin/env node
/**
 * ADOPT-001 independent LOCAL evaluator: no Muse inference.
 * Establishes an actual audited source fetch, byte-identical integration
 * into candidate, module import, and successful runtime behavior.
 * Prints and stores only classification, digests, and failures.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
const root = join(homedir(), 'Projects/silkweb-adoption-probe-20261029');
const op = join(root, 'operator');
const meta = JSON.parse(readFileSync(join(op, 'preflight.json'), 'utf8'));
const candidate = meta.candidate;
const auditPath = meta.auditLog;
const reportPath = join(op, 'evaluation.json');
if (existsSync(reportPath)) throw new Error('Refusing to overwrite prior evaluation');
const report = {
  trial:'ADOPT-001', classification:'NOT_EVALUATED',
  success:false, checks:[],
  sourceCommit:meta.sourceCommit,
};
function check(id, value, detail='') {
  report.checks.push({id,passed:!!value,detail});
}
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const expectedNames = ['reservationKernelV2.ts','schema.ts','validation.ts','slotGuard.ts'];
let audit = [];
if (existsSync(auditPath)) {
  for (const line of readFileSync(auditPath,'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { audit.push(JSON.parse(line)); } catch { /* not evidence */ }
  }
}
const search = audit.filter(e=>e.tool === 'search_verified_components' && e.status==='success');
const inspect = audit.filter(e=>e.tool === 'inspect_verified_component' &&
  e.status==='success' && e.component === 'booking-reservation-kernel@0.2.0');
const retrievals = audit.filter(e=>e.tool === 'get_verified_component_source' &&
  e.status==='success' && e.component === 'booking-reservation-kernel@0.2.0');
const source = retrievals.find(e=>e.truncated === false &&
  expectedNames.every(name => e.files?.some(f => f.path.endsWith('/' + name) && f.truncated === false)));
check('search_result_lists_V2', search.some(e=>e.resultIds?.includes('booking-reservation-kernel@0.2.0')));
check('contract_inspected', inspect.length > 0);
check('full_untruncated_source_retrieved', !!source);
let allMatch = !!source;
const digests = [];
for (const name of expectedNames) {
  const target = join(candidate, 'src/verified', name);
  const sourceEntry = source?.files?.find(f=>f.path.endsWith('/' + name));
  const actualHash = existsSync(target) ? sha256(readFileSync(target)) : null;
  const originHash = existsSync(join(meta.sourceRepo,'packages/registry/src',name))
    ? sha256(readFileSync(join(meta.sourceRepo,'packages/registry/src',name))) : null;
  const matched = !!(sourceEntry?.sha256 && actualHash &&
    actualHash === sourceEntry.sha256 && actualHash === originHash);
  digests.push({name,matched,sha256:matched ? actualHash : undefined});
  check('source_exact_' + name, matched);
  allMatch &&= matched;
}
report.digests = digests;
const adapter = join(candidate,'src/probe.ts');
const adapterSource = existsSync(adapter) ? readFileSync(adapter,'utf8') : '';
const importsVerified = /(?:from\s*['"]\.\/verified\/reservationKernelV2\.js['"]|import\s*\(\s*['"]\.\/verified\/reservationKernelV2\.js['"]\s*\))/.test(adapterSource);
const usesKernel = ['initializeReservationKernel','createIdempotentBooking','cancelReservation'].every(s => adapterSource.includes(s));
check('adapter_imports_verified_kernel', importsVerified && usesKernel);
let executable = false;
let runtimeError = '';
const built = join(candidate,'dist/probe.js');
if (existsSync(built)) {
  const execution = spawnSync(process.execPath, [built], {
    cwd:candidate, encoding:'utf8', timeout:12000,
  });
  executable = execution.status === 0 && (execution.stdout ?? '').trim() === 'ADOPTION_OK';
  if (!executable) runtimeError = 'exit='+execution.status+
    ';stdout='+String(execution.stdout??'').trim().slice(0,160)+
    ';stderr='+String(execution.stderr??'').trim().slice(0,160);
} else runtimeError = 'dist/probe.js missing (build failed or not created)';
check('verified_kernel_executed_by_adapter', executable, executable?'ADOPTION_OK':runtimeError);
report.passed = report.checks.filter(c=>c.passed).length;
report.total = report.checks.length;
report.success = report.passed === report.total;
report.classification = report.success ? 'GUIDED_VERIFIED_SOURCE_REUSE_PROVEN' :
  'ADOPTION_NOT_PROVEN';
report.auditEvents = audit.length;
report.searchCalls = search.length;
report.inspectCalls = inspect.length;
report.successfulSourceRetrievals = retrievals.length;
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify(report,null,2)+'\n');
process.exitCode = report.success ? 0 : 1;
