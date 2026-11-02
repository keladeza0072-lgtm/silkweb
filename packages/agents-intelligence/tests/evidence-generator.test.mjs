import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateProcedureEvidence
} from '../src/evidenceGenerator.mjs';

function procedure() {
  return {
    id: 'order-resolution',
    version: '1.0.0',
    task: 'resolve-order',
    toolVersion: '2.0.0',
    steps: [
      'Read order',
      'Check eligibility',
      'Resolve using compatible contract',
      'Write one audit'
    ],
    constraints: ['Do not duplicate mutations'],
    provenance: ['AGENTS-001 deterministic fixture'],
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
    }
  };
}

test('generates passing evidence from executed scenarios', () => {
  const evidence = generateProcedureEvidence(procedure());

  assert.equal(evidence.passed, true);
  assert.equal(evidence.scenarios.length, 3);
  assert.equal(evidence.scenarios.every(s => s.passed), true);
  assert.match(evidence.evidenceId, /^[0-9a-f]{64}$/);
});

test('detects stale tool contract', () => {
  const record = procedure();

  record.verificationPlans['changed-contract'][1].args = {
    id: 'ORD-001',
    resolution: 'approved'
  };

  const evidence = generateProcedureEvidence(record);

  assert.equal(evidence.passed, false);

  const scenario = evidence.scenarios.find(
    item => item.scenario === 'changed-contract'
  );

  assert.equal(scenario.passed, false);
});

test('detects missing audit action', () => {
  const record = procedure();

  record.verificationPlans.routine.pop();

  const evidence = generateProcedureEvidence(record);

  assert.equal(evidence.passed, false);
});

test('detects duplicate mutation attempt', () => {
  const record = procedure();

  record.verificationPlans.routine.splice(2, 0, {
    tool: 'resolveOrder',
    args: {
      id: 'ORD-001',
      resolution: 'approved'
    }
  });

  const evidence = generateProcedureEvidence(record);

  assert.equal(evidence.passed, false);
});

test('detects missing verification scenario', () => {
  const record = procedure();

  delete record.verificationPlans['transient-recovery'];

  const evidence = generateProcedureEvidence(record);

  assert.equal(evidence.passed, false);
});

test('evidence changes when procedure content changes', () => {
  const record = procedure();

  const first = generateProcedureEvidence(record);

  record.steps.push('Additional instruction');

  const second = generateProcedureEvidence(record);

  assert.notEqual(first.procedureDigest, second.procedureDigest);
  assert.notEqual(first.evidenceId, second.evidenceId);
});
