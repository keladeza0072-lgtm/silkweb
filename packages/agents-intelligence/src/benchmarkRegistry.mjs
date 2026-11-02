import { finalizeEvidence } from './evidenceTrust.mjs';

function registryProcedure(toolVersion) {
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
    provenance: ['AGENTS-001 benchmark registry'],
    revoked: false
  };
}

// Single shared source of evidence-approved procedural knowledge for the
// AGENTS-001 A/B/C comparison. Preflight, tests, and the paid pilot all
// build their registry from here so B and C can never be sourced from
// different facts. One procedure per tool version keeps selection
// unambiguous for every frozen scenario.
export function createBenchmarkRegistry() {
  const procedures = [
    registryProcedure('2.0.0'),
    registryProcedure('3.0.0')
  ];

  const evidenceRecords = procedures.map(finalizeEvidence);

  const approvals = procedures.map((record, index) => ({
    procedureId: record.id,
    procedureVersion: record.version,
    procedureDigest: evidenceRecords[index].procedureDigest,
    evidenceId: evidenceRecords[index].boundEvidenceId,
    status: 'approved',
    testsPassed: true
  }));

  return { procedures, evidenceRecords, approvals };
}
