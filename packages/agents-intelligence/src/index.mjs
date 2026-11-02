import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonical(value[key])])
    );
  }

  return value;
}

export function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

const HEX64 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function verifyProcedure(record, trust) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, reason: 'INVALID_RECORD' };
  }

  const required = [
    'id', 'version', 'task', 'toolVersion',
    'steps', 'constraints', 'provenance', 'revoked'
  ];

  if (required.some(key => !(key in record))) {
    return { valid: false, reason: 'MISSING_FIELD' };
  }

  if (
    !nonempty(record.id) ||
    !VERSION.test(record.version) ||
    !nonempty(record.task) ||
    !VERSION.test(record.toolVersion) ||
    !Array.isArray(record.steps) ||
    record.steps.length === 0 ||
    !record.steps.every(nonempty) ||
    !Array.isArray(record.constraints) ||
    !record.constraints.every(nonempty) ||
    !Array.isArray(record.provenance) ||
    record.provenance.length === 0 ||
    !record.provenance.every(nonempty) ||
    typeof record.revoked !== 'boolean'
  ) {
    return { valid: false, reason: 'INVALID_SCHEMA' };
  }

  if (record.revoked) {
    return { valid: false, reason: 'REVOKED' };
  }

  // Certification is no longer taken from the procedure itself.
  if ('verification' in record) {
    return { valid: false, reason: 'EMBEDDED_CERTIFICATION' };
  }

  if (!trust || !Array.isArray(trust.approvals)) {
    return { valid: false, reason: 'MISSING_TRUST_STORE' };
  }

  const approvals = trust.approvals.filter(
    item => item &&
      item.id === record.id &&
      item.version === record.version
  );

  if (approvals.length === 0) {
    return { valid: false, reason: 'NOT_APPROVED' };
  }

  if (approvals.length !== 1) {
    return { valid: false, reason: 'AMBIGUOUS_APPROVAL' };
  }

  const approval = approvals[0];

  if (
    approval.status !== 'approved' ||
    approval.testsPassed !== true ||
    !nonempty(approval.evidenceId) ||
    !HEX64.test(approval.digest)
  ) {
    return { valid: false, reason: 'INVALID_APPROVAL' };
  }

  if (digest(record) !== approval.digest) {
    return { valid: false, reason: 'EVIDENCE_MISMATCH' };
  }

  return { valid: true, reason: 'APPROVED' };
}

export function selectProcedure(records, query, trust) {
  if (
    !query ||
    !nonempty(query.task) ||
    !VERSION.test(query.toolVersion)
  ) {
    throw new TypeError('Valid task and toolVersion are required');
  }

  if (!Array.isArray(records)) {
    throw new TypeError('records must be an array');
  }

  const inspected = records.map(record => {
    const result = verifyProcedure(record, trust);
    let reason = result.reason;

    if (result.valid && record.task !== query.task) {
      reason = 'TASK_MISMATCH';
    } else if (result.valid && record.toolVersion !== query.toolVersion) {
      reason = 'TOOL_VERSION_MISMATCH';
    }

    return {
      id: record?.id ?? null,
      version: record?.version ?? null,
      reason,
      eligible:
        result.valid &&
        record.task === query.task &&
        record.toolVersion === query.toolVersion
    };
  });

  const eligible = inspected.filter(item => item.eligible);

  if (eligible.length !== 1) {
    return {
      status: eligible.length === 0 ? 'NO_MATCH' : 'AMBIGUOUS',
      selected: null,
      inspected
    };
  }

  const selected = records.find(record =>
    record.id === eligible[0].id &&
    record.version === eligible[0].version
  );

  return {
    status: 'SELECTED',
    selected,
    inspected
  };
}

export function loadProcedures(directory) {
  return readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')));
}
