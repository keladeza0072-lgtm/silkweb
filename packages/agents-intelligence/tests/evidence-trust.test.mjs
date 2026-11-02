import test from 'node:test';
import assert from 'node:assert/strict';

import {
  finalizeEvidence,
  validateEvidenceApproval,
  createEvidenceBoundHost
} from '../src/evidenceTrust.mjs';

function procedure() {
  return {
    id: 'order-resolution',
    version: '1.0.0',
    task: 'resolve-order',
    toolVersion: '2.0.0',
    steps: ['Read', 'Check eligibility', 'Resolve', 'Audit'],
    constraints: ['No duplicate mutation'],
    provenance: ['Milestone 7 deterministic fixture'],
    revoked: false,
    verificationPlans: {
      routine: [
        { tool: 'readOrder', args: { id: 'ORD-001' } },
        {
          tool: 'resolveOrder',
          args: { id: 'ORD-001', resolution: 'approved' }
        },
        {
          tool: 'writeAudit',
          args: { id: 'ORD-001', note: 'Routine' }
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
          args: { id: 'ORD-001', note: 'Changed contract' }
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
          args: { id: 'ORD-001', note: 'Recovered' }
        }
      ]
    }
  };
}

function approvedFixture() {
  const record = procedure();
  const evidence = finalizeEvidence(record);

  const approval = {
    procedureId: record.id,
    procedureVersion: record.version,
    procedureDigest: evidence.procedureDigest,
    evidenceId: evidence.boundEvidenceId,
    status: 'approved'
  };

  return { record, evidence, approval };
}

test('accepts matching executed evidence and explicit approval', () => {
  const { record, evidence, approval } = approvedFixture();

  assert.equal(evidence.passed, true);
  assert.equal(
    validateEvidenceApproval(record, evidence, approval).valid,
    true
  );
});

test('rejects a forged passing flag', () => {
  const { record, evidence, approval } = approvedFixture();

  evidence.scenarios[0].passed = false;
  evidence.passed = true;

  assert.equal(
    validateEvidenceApproval(record, evidence, approval).valid,
    false
  );
});

test('rejects procedure modification after verification', () => {
  const { record, evidence, approval } = approvedFixture();

  record.steps.push('Unverified instruction');

  assert.equal(
    validateEvidenceApproval(record, evidence, approval).reason,
    'PROCEDURE_MISMATCH'
  );
});

test('rejects evaluator fingerprint mismatch', () => {
  const { record, evidence, approval } = approvedFixture();

  evidence.evaluatorFingerprint = 'stale-evaluator';

  assert.equal(
    validateEvidenceApproval(record, evidence, approval).reason,
    'EVALUATOR_MISMATCH'
  );
});

test('rejects approval referencing another evidence report', () => {
  const { record, evidence, approval } = approvedFixture();

  approval.evidenceId = 'incorrect-evidence';

  assert.equal(
    validateEvidenceApproval(record, evidence, approval).reason,
    'APPROVAL_MISMATCH'
  );
});

test('rejects evidence that did not pass', () => {
  const { record, evidence, approval } = approvedFixture();

  evidence.passed = false;

  assert.equal(
    validateEvidenceApproval(record, evidence, approval).reason,
    'VERIFICATION_FAILED'
  );
});

test('host serves guidance only with evidence-bound approval', () => {
  const { record, evidence, approval } = approvedFixture();

  const host = createEvidenceBoundHost({
    procedures: [record],
    evidenceRecords: [evidence],
    approvals: [approval]
  });

  const response = host.requestGuidance({
    task: 'resolve-order',
    toolVersion: '2.0.0'
  });

  assert.equal(response.status, 'SELECTED');
  assert.equal('verificationPlans' in response.guidance, false);
  assert.equal('approvals' in response.guidance, false);
});

test('host fails closed without explicit approval', () => {
  const { record, evidence } = approvedFixture();

  const host = createEvidenceBoundHost({
    procedures: [record],
    evidenceRecords: [evidence],
    approvals: []
  });

  const response = host.requestGuidance({
    task: 'resolve-order',
    toolVersion: '2.0.0'
  });

  assert.equal(response.status, 'NO_MATCH');
});

test('host fails closed with tampered evidence', () => {
  const { record, evidence, approval } = approvedFixture();

  evidence.scenarios[0].passed = false;

  const host = createEvidenceBoundHost({
    procedures: [record],
    evidenceRecords: [evidence],
    approvals: [approval]
  });

  assert.equal(
    host.requestGuidance({
      task: 'resolve-order',
      toolVersion: '2.0.0'
    }).status,
    'NO_MATCH'
  );
});
