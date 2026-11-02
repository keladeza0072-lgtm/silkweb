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
    steps: [
      { op: 'readOrder', args: { id: 'ORD-001' } },
      {
        op: 'resolveOrder',
        args: { id: 'ORD-001', resolution: 'approved' }
      },
      {
        op: 'writeAudit',
        args: { id: 'ORD-001', note: 'Routine' }
      }
    ],
    constraints: ['No duplicate mutation'],
    provenance: ['Milestone 9 deterministic fixture'],
    revoked: false
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
    status: 'approved',
    testsPassed: true
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

  record.steps.push({ op: 'readOrder', args: { id: 'ORD-001' } });

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

test('rejects approvals without genuinely passing tests', () => {
  const { record, evidence, approval } = approvedFixture();

  approval.testsPassed = false;

  assert.equal(
    validateEvidenceApproval(record, evidence, approval).reason,
    'INVALID_APPROVAL'
  );
});

test('rejects stale evidence schemas', () => {
  const { record, evidence, approval } = approvedFixture();

  evidence.schemaVersion = '1.0.0';

  assert.equal(
    validateEvidenceApproval(record, evidence, approval).reason,
    'STALE_EVIDENCE_SCHEMA'
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
