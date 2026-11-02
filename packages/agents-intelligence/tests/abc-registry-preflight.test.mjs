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
      { op: 'readOrder', args: { id: 'ORD-001' } },
      {
        op: 'resolveOrder',
        args: { id: 'ORD-001', resolution: 'approved' }
      },
      {
        op: 'writeAudit',
        args: { id: 'ORD-001', note: 'Benchmark resolution' }
      }
    ],
    constraints: [
      'Never duplicate a successful mutation',
      'Never write the audit before resolution',
      'Use the current tool contract'
    ],
    provenance: ['AGENTS-001 benchmark fixture'],
    revoked: false
  };
}

function bundle(records) {
  const evidenceRecords = records.map(finalizeEvidence);

  const approvals = records.map((record, index) => ({
    procedureId: record.id,
    procedureVersion: record.version,
    procedureDigest: evidenceRecords[index].procedureDigest,
    evidenceId: evidenceRecords[index].boundEvidenceId,
    status: 'approved',
    testsPassed: true
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

  for (const record of records) {
    assert.equal(finalizeEvidence(record).passed, true);
  }

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

    // Served guidance is exactly the verified declared steps: the
    // single source of executable truth, with no side plans attached.
    const declared = records.find(
      record => record.id === selected.id
    );

    assert.deepEqual(selected.steps, declared.steps);
    assert.ok(selected.steps.every(
      step => typeof step.op === 'string' && step.args
    ));
    assert.equal('verificationPlans' in selected, false);
    assert.equal('verificationPlans' in full.procedures[0], false);
  }
});
