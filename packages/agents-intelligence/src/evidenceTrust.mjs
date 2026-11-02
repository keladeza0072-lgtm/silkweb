import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { digest } from './index.mjs';
import { createIntelligenceHost } from './integration.mjs';
import {
  EVIDENCE_SCHEMA_VERSION,
  generateProcedureEvidence
} from './evidenceGenerator.mjs';

const IMPLEMENTATION_FILES = [
  new URL('./evidenceGenerator.mjs', import.meta.url),
  new URL('./procedureInterpreter.mjs', import.meta.url),
  new URL('./publicToolContracts.mjs', import.meta.url),
  new URL('./orderEnvironment.mjs', import.meta.url),
  new URL('./orderEvaluator.mjs', import.meta.url)
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function evaluatorFingerprint() {
  return digest(
    IMPLEMENTATION_FILES.map(url => ({
      file: url.pathname.split('/').pop(),
      sha256: sha256(readFileSync(url))
    }))
  );
}

export function generateBoundEvidence(procedure) {
  const evidence = generateProcedureEvidence(procedure);

  return {
    ...evidence,
    evaluatorFingerprint: evaluatorFingerprint()
  };
}

export function boundEvidenceId(evidence) {
  const { boundEvidenceId: ignored, ...content } = evidence;
  return digest(content);
}

export function finalizeEvidence(procedure) {
  const evidence = generateBoundEvidence(procedure);

  return {
    ...evidence,
    boundEvidenceId: boundEvidenceId(evidence)
  };
}

export function validateEvidenceApproval(
  procedure,
  evidence,
  approval
) {
  if (!procedure || !evidence || !approval) {
    return { valid: false, reason: 'MISSING_RECORD' };
  }

  if (approval.status !== 'approved') {
    return { valid: false, reason: 'NOT_APPROVED' };
  }

  // Approval requires genuinely executed passing tests, not a status
  // flag alone. Identity fields on the approval (reviewer, approver,
  // contact, or similar) are never consulted here: a name attached to
  // a record is not authentication and confers no trust.
  if (approval.testsPassed !== true) {
    return { valid: false, reason: 'INVALID_APPROVAL' };
  }

  if (evidence.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    return { valid: false, reason: 'STALE_EVIDENCE_SCHEMA' };
  }

  if (evidence.passed !== true) {
    return { valid: false, reason: 'VERIFICATION_FAILED' };
  }

  if (
    evidence.procedureId !== procedure.id ||
    evidence.procedureVersion !== procedure.version ||
    evidence.procedureDigest !== digest(procedure)
  ) {
    return { valid: false, reason: 'PROCEDURE_MISMATCH' };
  }

  if (
    evidence.evaluatorFingerprint !== evaluatorFingerprint()
  ) {
    return { valid: false, reason: 'EVALUATOR_MISMATCH' };
  }

  if (
    !evidence.boundEvidenceId ||
    evidence.boundEvidenceId !== boundEvidenceId(evidence)
  ) {
    return { valid: false, reason: 'EVIDENCE_TAMPERED' };
  }

  if (
    approval.evidenceId !== evidence.boundEvidenceId ||
    approval.procedureDigest !== evidence.procedureDigest ||
    approval.procedureId !== procedure.id ||
    approval.procedureVersion !== procedure.version
  ) {
    return { valid: false, reason: 'APPROVAL_MISMATCH' };
  }

  // Re-execute the actual declared steps against the current
  // interpreter and evaluator. This checks the reported verdict
  // rather than trusting its flag.
  const fresh = finalizeEvidence(procedure);

  if (
    fresh.boundEvidenceId !== evidence.boundEvidenceId ||
    fresh.passed !== true
  ) {
    return { valid: false, reason: 'REPLAY_MISMATCH' };
  }

  return { valid: true, reason: 'EVIDENCE_BOUND_APPROVAL' };
}

export function createEvidenceBoundHost({
  procedures,
  evidenceRecords,
  approvals
}) {
  if (
    !Array.isArray(procedures) ||
    !Array.isArray(evidenceRecords) ||
    !Array.isArray(approvals)
  ) {
    throw new TypeError('All trust inputs must be arrays');
  }

  const accepted = [];
  const selectorApprovals = [];
  const inspected = [];

  for (const procedure of procedures) {
    const evidenceMatches = evidenceRecords.filter(
      item =>
        item?.procedureId === procedure?.id &&
        item?.procedureVersion === procedure?.version
    );

    const approvalMatches = approvals.filter(
      item =>
        item?.procedureId === procedure?.id &&
        item?.procedureVersion === procedure?.version
    );

    if (
      evidenceMatches.length !== 1 ||
      approvalMatches.length !== 1
    ) {
      inspected.push({
        id: procedure?.id ?? null,
        reason: 'MISSING_OR_AMBIGUOUS_TRUST_RECORDS'
      });
      continue;
    }

    const result = validateEvidenceApproval(
      procedure,
      evidenceMatches[0],
      approvalMatches[0]
    );

    inspected.push({
      id: procedure.id,
      reason: result.reason
    });

    if (!result.valid) continue;

    accepted.push(procedure);

    selectorApprovals.push({
      id: procedure.id,
      version: procedure.version,
      status: 'approved',
      testsPassed: true,
      evidenceId: evidenceMatches[0].boundEvidenceId,
      digest: digest(procedure)
    });
  }

  const host = createIntelligenceHost({
    procedures: accepted,
    approvals: selectorApprovals
  });

  return Object.freeze({
    requestGuidance(query) {
      return host.requestGuidance(query);
    },
    verificationSummary: structuredClone(inspected)
  });
}
