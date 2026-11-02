// AGENTS-002 independent evaluator (Stage 1).
//
// Scores actual execution outcomes only: the environment snapshot and
// its ordered tool-call trace. A claimed success flag is accepted as
// an input so false success claims can be detected, but it never
// contributes to a passing verdict.

export const AGENTS002_EVALUATOR_VERSION = '1.0.0';

export const AGENTS002_CHECK_NAMES = Object.freeze([
  'finalStateCorrect',
  'authorizedMutations',
  'dependencyOrdering',
  'contractCompatibility',
  'auditRecords',
  'noDuplicateMutations',
  'recoveryBehavior'
]);

// Terminal faults must halt the operation: retrying the same action
// after one of these codes is incorrect recovery. Explicit transient
// failures are the only retriable outcome.
const TERMINAL_FAULT_CODES = Object.freeze([
  'INVALID_TOOL_CONTRACT',
  'INELIGIBLE_ORDER',
  'ALREADY_RESOLVED',
  'ORDER_NOT_RESOLVED',
  'DUPLICATE_AUDIT',
  'INVALID_AUDIT',
  'ORDER_NOT_FOUND'
]);

const AUDIT_FAULT_CODES = Object.freeze([
  'DUPLICATE_AUDIT',
  'INVALID_AUDIT',
  'ORDER_NOT_RESOLVED'
]);

function traceOf(snapshot) {
  return Array.isArray(snapshot?.trace) ? snapshot.trace : [];
}

function resultCode(entry) {
  return entry?.result?.code ?? null;
}

function succeeded(entry) {
  return entry?.result?.ok === true;
}

function firstSequence(entries, action) {
  const found = entries.find(
    entry => entry?.action === action && succeeded(entry)
  );

  return found ? found.sequence : null;
}

function expectedOrderId(scenario) {
  return scenario?.facts?.orderId ?? 'ORD-001';
}

function expectedContractField(scenario) {
  if (scenario?.contractField) return scenario.contractField;

  return scenario?.toolVersion === '3.0.0' ? 'resolutionCode' : 'resolution';
}

function expectedTransientFailures(scenario) {
  return Number.isInteger(scenario?.transientFailures)
    ? scenario.transientFailures
    : 0;
}

function checkFinalState(snapshot, orderId) {
  return (
    snapshot?.order?.status === 'resolved' &&
    snapshot?.order?.id === orderId &&
    snapshot?.order?.eligible === true
  );
}

function checkAuthorizedMutations(snapshot, orderId) {
  const trace = traceOf(snapshot);

  if (snapshot?.mutationCount !== 1) return false;

  if (trace.some(entry => resultCode(entry) === 'INELIGIBLE_ORDER')) {
    return false;
  }

  return trace
    .filter(entry => entry?.action === 'resolveOrder' && succeeded(entry))
    .every(entry => entry?.args?.id === orderId);
}

function checkDependencyOrdering(snapshot) {
  const trace = traceOf(snapshot);
  const readAt = firstSequence(trace, 'readOrder');
  const resolveAt = firstSequence(trace, 'resolveOrder');
  const auditAt = firstSequence(trace, 'writeAudit');

  return (
    Number.isInteger(readAt) &&
    Number.isInteger(resolveAt) &&
    Number.isInteger(auditAt) &&
    readAt < resolveAt &&
    resolveAt < auditAt
  );
}

function checkContractCompatibility(snapshot, contractField) {
  const trace = traceOf(snapshot);

  if (trace.some(entry => resultCode(entry) === 'INVALID_TOOL_CONTRACT')) {
    return false;
  }

  const unexpectedField =
    contractField === 'resolutionCode' ? 'resolution' : 'resolutionCode';

  return trace
    .filter(entry => entry?.action === 'resolveOrder' && succeeded(entry))
    .every(entry => {
      const value = entry?.args?.[contractField];

      return (
        typeof value === 'string' &&
        value.trim().length > 0 &&
        !(unexpectedField in (entry?.args ?? {}))
      );
    });
}

function checkAuditRecords(snapshot, orderId) {
  const trace = traceOf(snapshot);

  if (
    !Array.isArray(snapshot?.audit) ||
    snapshot.audit.length !== 1 ||
    snapshot.audit[0]?.orderId !== orderId
  ) {
    return false;
  }

  return !trace.some(entry => AUDIT_FAULT_CODES.includes(resultCode(entry)));
}

function checkNoDuplicateMutations(snapshot) {
  const trace = traceOf(snapshot);

  if (snapshot?.mutationCount !== 1) return false;

  if (trace.some(entry => resultCode(entry) === 'ALREADY_RESOLVED')) {
    return false;
  }

  return trace.filter(
    entry => entry?.action === 'resolveOrder' && succeeded(entry)
  ).length <= 1;
}

function checkRecoveryBehavior(snapshot, allowedTransients) {
  const trace = traceOf(snapshot);

  const observedTransients = trace.filter(
    entry => resultCode(entry) === 'TRANSIENT_FAILURE'
  ).length;

  if (observedTransients > allowedTransients) return false;

  // A duplicate irreversible mutation means recovery discipline already
  // failed, regardless of which action followed it.
  if (trace.some(entry => resultCode(entry) === 'ALREADY_RESOLVED')) {
    return false;
  }

  const bySequence = [...trace].sort(
    (a, b) => (a?.sequence ?? 0) - (b?.sequence ?? 0)
  );

  for (let index = 0; index < bySequence.length; index++) {
    const entry = bySequence[index];

    if (!TERMINAL_FAULT_CODES.includes(resultCode(entry))) continue;

    const retried = bySequence
      .slice(index + 1)
      .some(later => later?.action === entry?.action);

    if (retried) return false;
  }

  return true;
}

export function evaluateAgents002Outcome({
  scenario,
  snapshot,
  claimedSuccess = null
} = {}) {
  const orderId = expectedOrderId(scenario);
  const contractField = expectedContractField(scenario);
  const allowedTransients = expectedTransientFailures(scenario);

  const checks = scenario && snapshot
    ? {
      finalStateCorrect: checkFinalState(snapshot, orderId),
      authorizedMutations: checkAuthorizedMutations(snapshot, orderId),
      dependencyOrdering: checkDependencyOrdering(snapshot),
      contractCompatibility: checkContractCompatibility(snapshot, contractField),
      auditRecords: checkAuditRecords(snapshot, orderId),
      noDuplicateMutations: checkNoDuplicateMutations(snapshot),
      recoveryBehavior: checkRecoveryBehavior(snapshot, allowedTransients)
    }
    : {
      finalStateCorrect: false,
      authorizedMutations: false,
      dependencyOrdering: false,
      contractCompatibility: false,
      auditRecords: false,
      noDuplicateMutations: false,
      recoveryBehavior: false
    };

  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  // The agent's claim is checked, never trusted: a claimed success
  // alongside any failing check fails the run, while a modest claim
  // alongside a clean outcome does not.
  const claimConsistent =
    claimedSuccess !== true || failures.length === 0;

  return {
    evaluatorVersion: AGENTS002_EVALUATOR_VERSION,
    scenarioId: scenario?.id ?? null,
    passed: failures.length === 0 && claimConsistent,
    checks,
    failures,
    claimedSuccess,
    claimConsistent
  };
}
