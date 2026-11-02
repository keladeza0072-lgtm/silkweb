import test from 'node:test';
import assert from 'node:assert/strict';

import { digest } from '../src/index.mjs';
import {
  AGENTS003_EXECUTOR_VERSION,
  runDeterministicExecution,
  runWithControlledFallback
} from '../src/agents003Executor.mjs';
import {
  AGENTS002_CHECK_NAMES
} from '../src/agents002Evaluator.mjs';
import {
  AGENTS002_LIBRARY,
  createAgents002Trust
} from '../src/agents002Library.mjs';
import { AGENTS002_SCENARIOS } from '../src/agents002Scenarios.mjs';
import { createMockTransportFactory } from '../src/mockMuseTransport.mjs';

function queryFor(scenarioId) {
  const scenario = AGENTS002_SCENARIOS[scenarioId];

  return {
    library: AGENTS002_LIBRARY,
    trust: createAgents002Trust(),
    task: scenario.task,
    toolVersion: scenario.toolVersion,
    scenario
  };
}

function approvedLibrary(procedure) {
  const record = {
    id: 'custom-procedure',
    version: '1.0.0',
    task: 'resolve-order',
    toolVersion: '2.0.0',
    constraints: ['Synthetic AGENTS-003 fixture'],
    provenance: ['AGENTS-003 unit fixture'],
    revoked: false,
    ...procedure
  };

  return {
    library: [record],
    trust: {
      approvals: [{
        id: record.id,
        version: record.version,
        status: 'approved',
        testsPassed: true,
        evidenceId: 'agents003-fixture-evidence',
        digest: digest(record)
      }]
    },
    record
  };
}

test('executor version is pinned', () => {
  assert.equal(AGENTS003_EXECUTOR_VERSION, '1.0.0');
});

for (const scenarioId of Object.keys(AGENTS002_SCENARIOS)) {
  test(`normal execution passes every check: ${scenarioId}`, () => {
    const result = runDeterministicExecution(queryFor(scenarioId));

    assert.equal(result.status, 'DETERMINISTIC_PASS');
    assert.equal(result.executed, true);
    assert.equal(result.evaluation.passed, true);
    assert.deepEqual(Object.keys(result.evaluation.checks).sort(), [...AGENTS002_CHECK_NAMES].sort());
    assert.equal(result.snapshot.mutationCount, 1);
    assert.equal(result.modelCalls, 0);
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.fallbackReason, null);
  });
}

test('transient recovery absorbs two failures without duplication', () => {
  const result = runDeterministicExecution(queryFor('constrainedRecovery'));

  assert.equal(result.status, 'DETERMINISTIC_PASS');
  assert.equal(result.snapshot.mutationCount, 1);

  const transientAttempts = result.snapshot.trace.filter(
    entry => entry.result?.code === 'TRANSIENT_FAILURE'
  );

  assert.equal(transientAttempts.length, 2);
  assert.equal(
    result.snapshot.trace.filter(
      entry => entry.action === 'resolveOrder' && entry.result?.ok === true
    ).length,
    1
  );
});

test('missing approval fails closed without executing', () => {
  const params = queryFor('conditionalWorkflow');
  const result = runDeterministicExecution({
    ...params,
    trust: { approvals: [] }
  });

  assert.equal(result.executed, false);
  assert.equal(result.selection.status, 'NO_MATCH');
  assert.equal(result.snapshot, null);
  assert.equal(result.evaluation, null);
  assert.equal(result.fallbackReason, 'NO_APPROVED_PROCEDURE');
  assert.equal(result.modelCalls, 0);
});

test('revoked procedures are never executed', () => {
  const params = queryFor('versionConflict');
  const revoked = structuredClone(AGENTS002_LIBRARY).map(record => ({
    ...record,
    revoked: true
  }));

  const result = runDeterministicExecution({ ...params, library: revoked });

  assert.equal(result.executed, false);
  assert.equal(result.snapshot, null);
});

test('incompatible versions refuse without mutation', () => {
  // The 2.0.0 standard procedure is approved, but the live scenario
  // contract is 3.0.0: selection succeeds on the query yet execution
  // must refuse the contract mismatch.
  const result = runDeterministicExecution({
    library: AGENTS002_LIBRARY,
    trust: createAgents002Trust(),
    task: 'resolve-order',
    toolVersion: '2.0.0',
    scenario: AGENTS002_SCENARIOS.versionConflict
  });

  assert.equal(result.status, 'INCOMPATIBLE_VERSION');
  assert.equal(result.executed, false);
  assert.equal(result.snapshot, null);
  assert.equal(result.fallbackReason, 'INCOMPATIBLE_VERSION');
});

test('unknown tool contract has no match', () => {
  const params = queryFor('conditionalWorkflow');
  const result = runDeterministicExecution({ ...params, toolVersion: '1.0.0' });

  assert.equal(result.executed, false);
  assert.equal(result.selection.status, 'NO_MATCH');
});

test('tampered content fails the digest binding without executing', () => {
  const params = queryFor('versionConflict');
  const tampered = structuredClone(AGENTS002_LIBRARY);
  const target = tampered.find(
    record => record.id === 'ord-resolve-standard' && record.version === '3.1.0'
  );

  target.steps.push({
    op: 'writeAudit',
    args: { id: 'ORD-001', note: 'Attacker-added confirmation' }
  });

  const result = runDeterministicExecution({ ...params, library: tampered });

  assert.equal(result.executed, false);
  assert.equal(result.snapshot, null);

  const reasons = result.selection.inspected
    .filter(item => item.id === target.id)
    .map(item => item.reason);

  assert.ok(reasons.includes('EVIDENCE_MISMATCH'));
});

test('unsupported operations fail closed without executing', () => {
  const { library, trust } = approvedLibrary({
    steps: [{ op: 'deleteOrder', args: { id: 'ORD-001' } }]
  });

  const result = runDeterministicExecution({
    library,
    trust,
    task: 'resolve-order',
    toolVersion: '2.0.0',
    scenario: AGENTS002_SCENARIOS.conditionalWorkflow
  });

  assert.equal(result.executed, false);
  assert.equal(result.snapshot, null);
});

test('duplicate-mutation procedures are refused with zero mutations', () => {
  const read = { op: 'readOrder', args: { id: 'ORD-001' } };
  const resolve = {
    op: 'resolveOrder',
    args: { id: 'ORD-001', resolution: 'approved' }
  };
  const { library, trust } = approvedLibrary({
    steps: [
      read,
      resolve,
      { op: 'resolveOrder', args: { id: 'ORD-001', resolution: 'approved-confirm' } },
      { op: 'writeAudit', args: { id: 'ORD-001', note: 'Double commit' } }
    ]
  });

  // The fixture bypasses selection-level schema checks with an explicit
  // trust binding so the executor screen itself is what refuses.
  const selectionLibrary = structuredClone(library);
  const result = runDeterministicExecution({
    library: selectionLibrary,
    trust,
    task: 'resolve-order',
    toolVersion: '2.0.0',
    scenario: AGENTS002_SCENARIOS.conditionalWorkflow
  });

  assert.equal(result.status, 'PROCEDURE_REFUSED');
  assert.equal(result.fallbackReason, 'DUPLICATE_MUTATION_RISK');
  assert.equal(result.executed, false);
});

test('mutation without a prior read is refused without mutation', () => {
  const { library, trust } = approvedLibrary({
    steps: [
      { op: 'resolveOrder', args: { id: 'ORD-001', resolution: 'approved' } },
      { op: 'writeAudit', args: { id: 'ORD-001', note: 'No read first' } }
    ]
  });

  const result = runDeterministicExecution({
    library,
    trust,
    task: 'resolve-order',
    toolVersion: '2.0.0',
    scenario: AGENTS002_SCENARIOS.conditionalWorkflow
  });

  assert.equal(result.status, 'PROCEDURE_REFUSED');
  assert.equal(result.fallbackReason, 'DEPENDENCY_ORDERING_RISK');
  assert.equal(result.executed, false);
});

test('audit before resolution is refused without mutation', () => {
  const { library, trust } = approvedLibrary({
    steps: [
      { op: 'readOrder', args: { id: 'ORD-001' } },
      { op: 'writeAudit', args: { id: 'ORD-001', note: 'Premature' } },
      { op: 'resolveOrder', args: { id: 'ORD-001', resolution: 'approved' } }
    ]
  });

  const result = runDeterministicExecution({
    library,
    trust,
    task: 'resolve-order',
    toolVersion: '2.0.0',
    scenario: AGENTS002_SCENARIOS.conditionalWorkflow
  });

  assert.equal(result.status, 'PROCEDURE_REFUSED');
  assert.equal(result.fallbackReason, 'DEPENDENCY_ORDERING_RISK');
  assert.equal(result.executed, false);
});

test('invalid queries fail closed instead of throwing', () => {
  for (const params of [
    { library: AGENTS002_LIBRARY, trust: createAgents002Trust() },
    { library: AGENTS002_LIBRARY, trust: createAgents002Trust(), task: '', toolVersion: '2.0.0' },
    { library: AGENTS002_LIBRARY, trust: createAgents002Trust(), task: 'resolve-order', toolVersion: 'x' }
  ]) {
    const result = runDeterministicExecution(params);

    assert.equal(result.status, 'INVALID_QUERY');
    assert.equal(result.executed, false);
  }
});

test('fallback stays off without authorization', async () => {
  const result = await runWithControlledFallback({
    deterministic: {
      library: AGENTS002_LIBRARY,
      trust: createAgents002Trust(),
      task: 'resolve-order-nonexistent',
      toolVersion: '2.0.0',
      scenario: AGENTS002_SCENARIOS.constrainedRecovery
    },
    allowFallback: false,
    transportFactory: createMockTransportFactory({ scenarios: AGENTS002_SCENARIOS }),
    scenarioId: 'constrainedRecovery',
    scenarios: AGENTS002_SCENARIOS
  });

  assert.equal(result.fallbackUsed, false);
  assert.equal(result.modelCalls, 0);
  assert.equal(result.fallbackReason, 'NO_APPROVED_PROCEDURE');
});

test('fallback engages on genuine insufficiency and is independently scored', async () => {
  const result = await runWithControlledFallback({
    deterministic: {
      library: AGENTS002_LIBRARY,
      trust: createAgents002Trust(),
      task: 'resolve-order-nonexistent',
      toolVersion: '2.0.0',
      scenario: AGENTS002_SCENARIOS.constrainedRecovery
    },
    allowFallback: true,
    transportFactory: createMockTransportFactory({ scenarios: AGENTS002_SCENARIOS }),
    scenarioId: 'constrainedRecovery',
    scenarios: AGENTS002_SCENARIOS
  });

  assert.equal(result.fallbackUsed, true);
  assert.equal(result.fallbackAuthorized, true);
  assert.equal(result.fallbackReason, 'NO_APPROVED_PROCEDURE');
  assert.ok(result.modelCalls > 0);

  // The failed selection is preserved: model output grants nothing.
  assert.equal(result.selection.status, 'NO_MATCH');
  assert.equal(result.evaluation !== null, true);
  assert.deepEqual(Object.keys(result.evaluation.checks).sort(), [...AGENTS002_CHECK_NAMES].sort());
});

test('fallback is skipped when deterministic execution passes', async () => {
  let factoryCalled = false;

  const result = await runWithControlledFallback({
    deterministic: queryFor('versionConflict'),
    allowFallback: true,
    transportFactory: async params => {
      factoryCalled = true;
      return createMockTransportFactory({ scenarios: AGENTS002_SCENARIOS })(params);
    },
    scenarioId: 'versionConflict',
    scenarios: AGENTS002_SCENARIOS
  });

  assert.equal(result.status, 'DETERMINISTIC_PASS');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.modelCalls, 0);
  assert.equal(factoryCalled, false);
});
