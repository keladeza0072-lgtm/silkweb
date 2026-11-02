import test from 'node:test';
import assert from 'node:assert/strict';

import { prepareABC } from '../src/abcBenchmark.mjs';
import { finalizeEvidence } from '../src/evidenceTrust.mjs';

function procedure(toolVersion) {
  return {
    id: `order-resolution-${toolVersion}`,
    version: '1.0.0',
    task: 'resolve-order',
    toolVersion,
    steps: [
      'Read ORD-001 before making changes',
      'Confirm the order is eligible',
      toolVersion === '3.0.0'
        ? 'Resolve using resolutionCode'
        : 'Resolve using resolution',
      'If a transient failure occurs before mutation, retry safely',
      'Write the audit record after successful resolution',
      'Do not resolve the order more than once'
    ],
    constraints: [
      'Never duplicate a successful mutation',
      'Never write the audit before resolution',
      'Use the current tool contract'
    ],
    provenance: ['AGENTS-001 benchmark fixture'],
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

function bundle(records) {
  const evidenceRecords = records.map(finalizeEvidence);

  const approvals = records.map((record, index) => ({
    procedureId: record.id,
    procedureVersion: record.version,
    procedureDigest: evidenceRecords[index].procedureDigest,
    evidenceId: evidenceRecords[index].boundEvidenceId,
    status: 'approved'
  }));

  return {
    procedures: records,
    evidenceRecords,
    approvals
  };
}

test('incomplete registry cannot prepare all benchmark scenarios', () => {
  const records = [procedure('2.0.0')];

  assert.throws(
    () => prepareABC(bundle(records)),
    /Evidence-bound guidance unavailable/
  );
});

test('complete evidence-approved registry prepares all nine comparisons', () => {
  const records = [
    procedure('2.0.0'),
    procedure('3.0.0')
  ];

  const prepared = prepareABC(bundle(records));

  assert.equal(prepared.manifest.conditions.length, 3);
  assert.equal(prepared.manifest.scenarios.length, 3);
  assert.equal(prepared.manifest.publicLibrary.length, 2);

  for (const scenarioId of prepared.manifest.scenarios) {
    assert.equal(prepared.guidanceFor('A', scenarioId), null);

    const full = prepared.guidanceFor('B', scenarioId);
    const selected = prepared.guidanceFor('C', scenarioId);

    assert.equal(full.procedures.length, 2);

    assert.ok(
      full.procedures.some(record =>
        record.id === selected.id &&
        record.toolVersion === selected.toolVersion
      )
    );

    assert.equal('verificationPlans' in selected, false);
    assert.equal('verificationPlans' in full.procedures[0], false);
  }
});
