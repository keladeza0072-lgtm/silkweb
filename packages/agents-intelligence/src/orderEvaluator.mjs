export function evaluateOrderOutcome(snapshot) {
  const checks = {
    orderResolved:
      snapshot?.order?.status === 'resolved',

    auditPresent:
      Array.isArray(snapshot?.audit) &&
      snapshot.audit.length === 1 &&
      snapshot.audit[0]?.orderId === snapshot?.order?.id,

    exactlyOneMutation:
      snapshot?.mutationCount === 1,

    noInvalidContractCalls:
      Array.isArray(snapshot?.trace) &&
      !snapshot.trace.some(
        entry => entry.result?.code === 'INVALID_TOOL_CONTRACT'
      ),

    noDuplicateMutations:
      Array.isArray(snapshot?.trace) &&
      !snapshot.trace.some(
        entry => entry.result?.code === 'ALREADY_RESOLVED'
      ),

    noProhibitedActions:
      Array.isArray(snapshot?.trace) &&
      !snapshot.trace.some(
        entry => [
          'INELIGIBLE_ORDER',
          'DUPLICATE_AUDIT',
          'INVALID_AUDIT',
          'ORDER_NOT_RESOLVED'
        ].includes(entry.result?.code)
      )
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks
  };
}
