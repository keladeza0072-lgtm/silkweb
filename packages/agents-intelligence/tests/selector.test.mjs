import test from 'node:test';
import assert from 'node:assert/strict';

import {
  digest,
  verifyProcedure,
  selectProcedure
} from '../src/index.mjs';

function fixture(overrides = {}) {
  const record = {
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
    constraints: ['Never mutate twice'],
    provenance: ['AGENTS-001 synthetic fixture'],
    revoked: false,
    ...overrides
  };

  const trust = {
    approvals: [{
      id: record.id,
      version: record.version,
      status: 'approved',
      testsPassed: true,
      evidenceId: 'synthetic-test-evidence',
      digest: digest(record)
    }]
  };

  return { record, trust };
}

test('selects an independently approved procedure', () => {
  const { record, trust } = fixture();

  const result = selectProcedure(
    [record],
    { task: 'resolve-order', toolVersion: '2.0.0' },
    trust
  );

  assert.equal(result.status, 'SELECTED');
});

test('rejects missing trust store', () => {
  const { record } = fixture();

  assert.equal(
    verifyProcedure(record).reason,
    'MISSING_TRUST_STORE'
  );
});

test('rejects unapproved procedure', () => {
  const { record } = fixture();

  assert.equal(
    verifyProcedure(record, { approvals: [] }).reason,
    'NOT_APPROVED'
  );
});

test('rejects revoked procedure', () => {
  const { record, trust } = fixture({ revoked: true });

  assert.equal(
    verifyProcedure(record, trust).reason,
    'REVOKED'
  );
});

test('rejects changed tool version', () => {
  const { record, trust } = fixture();

  const result = selectProcedure(
    [record],
    { task: 'resolve-order', toolVersion: '3.0.0' },
    trust
  );

  assert.equal(result.status, 'NO_MATCH');
  assert.equal(
    result.inspected[0].reason,
    'TOOL_VERSION_MISMATCH'
  );
});

test('detects tampered procedure', () => {
  const { record, trust } = fixture();

  record.steps.push({
    op: 'writeAudit',
    args: { id: 'ORD-001', note: 'Unauthorized action' }
  });

  assert.equal(
    verifyProcedure(record, trust).reason,
    'EVIDENCE_MISMATCH'
  );
});

test('rejects self-certified procedures', () => {
  const { record, trust } = fixture();

  record.verification = {
    status: 'verified',
    digest: digest(record)
  };

  assert.equal(
    verifyProcedure(record, trust).reason,
    'EMBEDDED_CERTIFICATION'
  );
});

test('rejects approvals without passed tests', () => {
  const { record, trust } = fixture();

  trust.approvals[0].testsPassed = false;

  assert.equal(
    verifyProcedure(record, trust).reason,
    'INVALID_APPROVAL'
  );
});

test('rejects duplicate approvals', () => {
  const { record, trust } = fixture();

  trust.approvals.push({ ...trust.approvals[0] });

  assert.equal(
    verifyProcedure(record, trust).reason,
    'AMBIGUOUS_APPROVAL'
  );
});

test('rejects ambiguous applicable procedures', () => {
  const first = fixture();
  const second = fixture({ id: 'alternate-resolution' });

  const result = selectProcedure(
    [first.record, second.record],
    { task: 'resolve-order', toolVersion: '2.0.0' },
    {
      approvals: [
        ...first.trust.approvals,
        ...second.trust.approvals
      ]
    }
  );

  assert.equal(result.status, 'AMBIGUOUS');
});

test('rejects missing evidence reference', () => {
  const { record, trust } = fixture();

  trust.approvals[0].evidenceId = '';

  assert.equal(
    verifyProcedure(record, trust).reason,
    'INVALID_APPROVAL'
  );
});

test('accepts valid structured steps', () => {
  const { record, trust } = fixture();

  assert.equal(verifyProcedure(record, trust).reason, 'APPROVED');
});

test('rejects legacy string steps', () => {
  const { record, trust } = fixture({
    steps: ['Read order', 'Resolve order']
  });

  assert.equal(
    verifyProcedure(record, trust).reason,
    'INVALID_SCHEMA'
  );
});

test('rejects unsupported structured operations', () => {
  const { record, trust } = fixture({
    steps: [{ op: 'deleteOrder', args: { id: 'ORD-001' } }]
  });

  assert.equal(
    verifyProcedure(record, trust).reason,
    'INVALID_SCHEMA'
  );
});

test('rejects malformed structured steps', () => {
  for (const steps of [
    [],
    [{ op: 'readOrder', args: {} }],
    [{ op: 'readOrder', args: { id: 'ORD-001' }, extra: true }],
    [{ op: 'resolveOrder', args: { id: 'ORD-001' } }],
    [null]
  ]) {
    const { record, trust } = fixture({ steps });

    assert.equal(
      verifyProcedure(record, trust).reason,
      'INVALID_SCHEMA'
    );
  }
});
