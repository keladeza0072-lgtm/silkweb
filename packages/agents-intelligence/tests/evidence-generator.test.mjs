import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateProcedureEvidence,
  executeVerificationScenario,
  SCENARIOS
} from '../src/evidenceGenerator.mjs';

function procedure(overrides = {}) {
  return {
    id: 'order-resolution',
    version: '1.0.0',
    task: 'resolve-order',
    toolVersion: '2.0.0',
    steps: [
      { op: 'readOrder', args: { id: 'ORD-001' } },
      {
        op: 'resolveOrder',
        args: { id: 'ORD-001', resolution: 'approved' }
      },
      {
        op: 'writeAudit',
        args: { id: 'ORD-001', note: 'Routine resolution' }
      }
    ],
    constraints: ['Do not duplicate mutations'],
    provenance: ['AGENTS-001 deterministic fixture'],
    revoked: false,
    ...overrides
  };
}

function byId(evidence, id) {
  return evidence.scenarios.find(item => item.scenario === id);
}

test('generates passing evidence by executing the declared steps', () => {
  const evidence = generateProcedureEvidence(procedure());

  assert.equal(evidence.passed, true);
  assert.equal(evidence.scenarios.length, 3);
  assert.equal(evidence.scenarios.every(s => s.passed), true);
  assert.equal(evidence.interpreterVersion, '1.0.0');
  assert.match(evidence.stepsDigest, /^[0-9a-f]{64}$/);
  assert.match(evidence.evidenceId, /^[0-9a-f]{64}$/);

  for (const scenario of evidence.scenarios) {
    assert.equal(scenario.trace.length, 3);
    assert.ok(scenario.snapshot);
    assert.equal(scenario.snapshot.mutationCount, 1);
  }
});

test('one declared step list passes under both tool contracts', () => {
  const evidence = generateProcedureEvidence(procedure());
  const changed = byId(evidence, 'changed-contract');

  assert.equal(changed.passed, true);

  const resolve = changed.trace.find(entry => entry.op === 'resolveOrder');

  assert.equal(resolve.attempts.length, 1);
  assert.deepEqual(resolve.attempts[0].args, {
    id: 'ORD-001',
    resolutionCode: 'approved'
  });
});

test('transient recovery retries the same step without duplicating mutation', () => {
  const evidence = generateProcedureEvidence(procedure());
  const recovery = byId(evidence, 'transient-recovery');

  assert.equal(recovery.passed, true);

  const resolve = recovery.trace.find(entry => entry.op === 'resolveOrder');

  assert.equal(resolve.attempts.length, 2);
  assert.equal(
    resolve.attempts[0].result.code,
    'TRANSIENT_FAILURE'
  );
  assert.equal(resolve.attempts[1].result.ok, true);
  assert.equal(recovery.snapshot.mutationCount, 1);
});

test('rejects stale literal contract arguments in steps', () => {
  const record = procedure();

  record.steps[1] = {
    op: 'resolveOrder',
    args: { id: 'ORD-001', resolutionCode: 'approved' }
  };

  const evidence = generateProcedureEvidence(record);

  assert.equal(evidence.passed, false);
  assert.ok(evidence.scenarios.every(
    item => item.reason === 'INVALID_STEP_ARGS'
  ));
});

test('detects missing audit action', () => {
  const record = procedure();

  record.steps.pop();

  const evidence = generateProcedureEvidence(record);

  assert.equal(evidence.passed, false);

  const routine = byId(evidence, 'routine');

  assert.equal(routine.reason, 'OUTCOME_FAILED');
  assert.equal(routine.checks.auditPresent, false);
});

test('detects duplicate mutation attempt without retrying it', () => {
  const record = procedure();

  record.steps.splice(2, 0, {
    op: 'resolveOrder',
    args: { id: 'ORD-001', resolution: 'approved' }
  });

  const evidence = generateProcedureEvidence(record);

  assert.equal(evidence.passed, false);

  const routine = byId(evidence, 'routine');

  assert.equal(routine.reason, 'STEP_FAILED');
  assert.equal(routine.failedCode, 'ALREADY_RESOLVED');

  const duplicate = routine.trace.at(-1);

  assert.equal(duplicate.attempts.length, 1);
});

test('rejects legacy verification plans even beside correct steps', () => {
  const record = procedure();

  record.verificationPlans = {
    routine: [
      { tool: 'readOrder', args: { id: 'ORD-001' } },
      {
        tool: 'resolveOrder',
        args: { id: 'ORD-001', resolution: 'approved' }
      },
      {
        tool: 'writeAudit',
        args: { id: 'ORD-001', note: 'Routine resolution' }
      }
    ],
    'changed-contract': [],
    'transient-recovery': []
  };

  const evidence = generateProcedureEvidence(record);

  assert.equal(evidence.passed, false);
  assert.ok(evidence.scenarios.every(
    item => item.reason === 'LEGACY_VERIFICATION_PLAN'
  ));
});

test('rejects legacy free-text steps', () => {
  const record = procedure();

  record.steps = [
    'Read order',
    'Check eligibility',
    'Resolve using compatible contract',
    'Write one audit'
  ];

  const evidence = generateProcedureEvidence(record);

  assert.equal(evidence.passed, false);
  assert.ok(evidence.scenarios.every(
    item => item.reason === 'INVALID_STEPS'
  ));
});

test('rejects unsupported operations without mutating state', () => {
  const record = procedure();

  record.steps[1] = {
    op: 'deleteOrder',
    args: { id: 'ORD-001' }
  };

  const evidence = generateProcedureEvidence(record);

  assert.equal(evidence.passed, false);

  const routine = byId(evidence, 'routine');

  assert.equal(routine.reason, 'UNSUPPORTED_OPERATION');
  assert.equal(routine.trace.length, 0);
  assert.equal(routine.snapshot.mutationCount, 0);
});

test('rejects incompatible procedure tool contracts', () => {
  const record = procedure({ toolVersion: '9.9.9' });
  const evidence = generateProcedureEvidence(record);

  assert.equal(evidence.passed, false);
  assert.ok(evidence.scenarios.every(
    item => item.reason === 'INCOMPATIBLE_TOOL_CONTRACT'
  ));
});

test('evidence changes when procedure steps change', () => {
  const record = procedure();
  const first = generateProcedureEvidence(record);

  record.steps.push({
    op: 'readOrder',
    args: { id: 'ORD-001' }
  });

  const second = generateProcedureEvidence(record);

  assert.notEqual(first.procedureDigest, second.procedureDigest);
  assert.notEqual(first.stepsDigest, second.stepsDigest);
  assert.notEqual(first.evidenceId, second.evidenceId);
});

test('scenario table matches the frozen AGENTS-001 set', () => {
  assert.deepEqual(
    SCENARIOS.map(item => item.id),
    ['routine', 'changed-contract', 'transient-recovery']
  );
  assert.equal(
    executeVerificationScenario(null, SCENARIOS[0]).reason,
    'INVALID_PROCEDURE'
  );
});
