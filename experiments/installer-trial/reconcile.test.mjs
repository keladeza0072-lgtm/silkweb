import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reassessMissingBuild } from './reconcile.mjs';

function fixture() {
  const ids = [
    'actual_muse_run_completed',
    'target_build_passed',
    'mcp_search_found_certified_kernel',
    'mcp_inspected_certified_kernel',
    'no_mcp_source_retrieval',
    'installer_report_present',
    'registry_evidence_fingerprint_matches',
    'dependency_closure_recorded',
    'installation_audit_records_four_sources',
    'source_integrity_reservationKernelV2.ts',
    'source_integrity_schema.ts',
    'source_integrity_slotGuard.ts',
    'source_integrity_validation.ts',
    'agent_adapter_imports_certified_kernel',
    'agent_adapter_runtime_scenario',
    'independent_kernel_runtime_verification',
  ];
  const original = {
    trial:'MUSE-INSTALL-001', sourceCommit:'abc', promptSha256:'def',
    success:false, checksPassed:15, checksTotal:16,
    checks:ids.map(id => ({
      id, passed:id !== 'target_build_passed',
      detail:id==='target_build_passed'?'exit=missing':'',
    })),
  };
  const run = {
    trial:'MUSE-INSTALL-001', stage:'evaluated', sourceCommit:'abc',
    promptSha256:'def', museExitCode:0, buildExitCode:0, evaluatorExitCode:1,
  };
  return {original,run};
}
test('reconcile exactly the missing-build-record issue, preserving other 15 results', () => {
  const {original,run} = fixture();
  const checks = reassessMissingBuild(original,run);
  assert.equal(checks.length,16);
  assert.equal(checks.filter(c=>c.passed).length,16);
  assert.match(checks[1].detail,/finalized original run.json/);
  assert.equal(original.checks[1].passed,false);
});
test('refuse reclassification when actual local build failed', () => {
  const {original,run} = fixture();
  run.buildExitCode = 1;
  assert.throws(()=>reassessMissingBuild(original,run),/does not substantiate/);
});
test('refuse reclassification for unrelated evaluator failures', () => {
  const {original,run} = fixture();
  original.checks[10].passed = false;
  original.checksPassed = 14;
  assert.throws(()=>reassessMissingBuild(original,run),/Not the known/);
});
test('refuse mismatched frozen prompt or incomplete run record', () => {
  const {original,run} = fixture();
  run.promptSha256 = 'changed';
  assert.throws(()=>reassessMissingBuild(original,run),/does not substantiate/);
});
