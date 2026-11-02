import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateProcedureEvidence
} from '../src/evidenceGenerator.mjs';
import {
  finalizeEvidence,
  validateEvidenceApproval
} from '../src/evidenceTrust.mjs';
import { createOrderEnvironment } from '../src/orderEnvironment.mjs';
import {
  executeProcedureSteps,
  MAX_TRANSIENT_RETRIES
} from '../src/procedureInterpreter.mjs';

function correctSteps() {
  return [
    { op: 'readOrder', args: { id: 'ORD-001' } },
    {
      op: 'resolveOrder',
      args: { id: 'ORD-001', resolution: 'approved' }
    },
    {
      op: 'writeAudit',
      args: { id: 'ORD-001', note: 'Adversarial fixture' }
    }
  ];
}

function correctPlans() {
  return {
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
    'changed-contract': [
      { tool: 'readOrder', args: { id: 'ORD-001' } },
      {
        tool: 'resolveOrder',
        args: { id: 'ORD-001', resolutionCode: 'approved' }
      },
      {
        tool: 'writeAudit',
        args: { id: 'ORD-001', note: 'Current contract' }
      }
    ],
    'transient-recovery': [
      { tool: 'readOrder', args: { id: 'ORD-001' } },
      {
        tool: 'resolveOrder',
        args: { id: 'ORD-001', resolution: 'approved' }
      },
      {
        tool: 'resolveOrder',
        args: { id: 'ORD-001', resolution: 'approved' }
      },
      {
        tool: 'writeAudit',
        args: { id: 'ORD-001', note: 'Recovered safely' }
      }
    ]
  };
}

function record(steps) {
  return {
    id: 'adversarial-resolution',
    version: '1.0.0',
    task: 'resolve-order',
    toolVersion: '2.0.0',
    steps,
    constraints: ['No duplicate mutation'],
    provenance: ['Milestone 9 adversarial fixture'],
    revoked: false
  };
}

test('incorrect steps cannot pass through a separate successful plan', () => {
  const bad = record(correctSteps());

  bad.steps.pop();
  bad.verificationPlans = correctPlans();

  const withPlan = generateProcedureEvidence(bad);

  assert.equal(withPlan.passed, false);
  assert.ok(withPlan.scenarios.every(
    item => item.reason === 'LEGACY_VERIFICATION_PLAN'
  ));

  delete bad.verificationPlans;

  const withoutPlan = generateProcedureEvidence(bad);

  assert.equal(withoutPlan.passed, false);
  assert.equal(byId(withoutPlan, 'routine').reason, 'OUTCOME_FAILED');
});

function byId(evidence, id) {
  return evidence.scenarios.find(item => item.scenario === id);
}

test('sabotaged plans are never read during verification', () => {
  const good = record(correctSteps());

  good.verificationPlans = {
    routine: [{ tool: 'deleteOrder', args: { id: 'ORD-001' } }],
    'changed-contract': [],
    'transient-recovery': 'not-an-array'
  };

  const sabotaged = generateProcedureEvidence(good);

  assert.equal(sabotaged.passed, false);
  assert.ok(sabotaged.scenarios.every(
    item => item.reason === 'LEGACY_VERIFICATION_PLAN'
  ));

  delete good.verificationPlans;

  assert.equal(generateProcedureEvidence(good).passed, true);
});

test('tampered steps fail replay after approval', () => {
  const original = record(correctSteps());
  const evidence = finalizeEvidence(original);
  const approval = {
    procedureId: original.id,
    procedureVersion: original.version,
    procedureDigest: evidence.procedureDigest,
    evidenceId: evidence.boundEvidenceId,
    status: 'approved',
    testsPassed: true
  };

  original.steps.pop();

  assert.equal(
    validateEvidenceApproval(original, evidence, approval).reason,
    'PROCEDURE_MISMATCH'
  );
});

test('an identity field neither grants nor replaces approval', () => {
  const original = record(correctSteps());
  const evidence = finalizeEvidence(original);
  const approval = {
    procedureId: original.id,
    procedureVersion: original.version,
    procedureDigest: evidence.procedureDigest,
    evidenceId: evidence.boundEvidenceId,
    status: 'approved',
    testsPassed: true,
    reviewer: 'trusted-admin'
  };

  assert.equal(
    validateEvidenceApproval(original, evidence, approval).valid,
    true
  );

  const forged = { ...approval, evidenceId: 'incorrect-evidence' };

  assert.equal(
    validateEvidenceApproval(original, evidence, forged).reason,
    'APPROVAL_MISMATCH'
  );
});

test('unsupported operations halt before any mutation', () => {
  const env = createOrderEnvironment();

  const result = executeProcedureSteps({
    steps: [{ op: 'deleteOrder', args: { id: 'ORD-001' } }],
    environment: env,
    toolVersion: '2.0.0'
  });

  assert.equal(result.completed, false);
  assert.equal(result.reason, 'UNSUPPORTED_OPERATION');
  assert.equal(result.trace.length, 0);
  assert.equal(env.snapshot().mutationCount, 0);
});

test('retries are bounded and transient-only', () => {
  assert.ok(MAX_TRANSIENT_RETRIES >= 1 && MAX_TRANSIENT_RETRIES <= 3);

  const exhausted = createOrderEnvironment({
    transientFailures: MAX_TRANSIENT_RETRIES + 1
  });

  const result = executeProcedureSteps({
    steps: [{
      op: 'resolveOrder',
      args: { id: 'ORD-001', resolution: 'approved' }
    }],
    environment: exhausted,
    toolVersion: '2.0.0'
  });

  assert.equal(result.completed, false);
  assert.equal(result.reason, 'TRANSIENT_RETRIES_EXHAUSTED');
  assert.equal(
    result.trace[0].attempts.length,
    MAX_TRANSIENT_RETRIES + 1
  );

  const permanent = createOrderEnvironment();
  const args = { id: 'ORD-001', resolution: 'approved' };

  permanent.resolveOrder(args);

  const single = executeProcedureSteps({
    steps: [
      { op: 'resolveOrder', args },
      { op: 'resolveOrder', args }
    ],
    environment: permanent,
    toolVersion: '2.0.0'
  });

  assert.equal(single.reason, 'STEP_FAILED');
  assert.equal(single.failedCode, 'ALREADY_RESOLVED');
  assert.equal(single.trace.at(-1).attempts.length, 1);
});
