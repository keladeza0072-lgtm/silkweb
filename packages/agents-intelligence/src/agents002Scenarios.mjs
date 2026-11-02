// AGENTS-002 Stage 1 frozen scenarios.
//
// These inputs are frozen before any paid model trial. Do not edit them
// after paid trials begin: the persistent runner binds every checkpoint
// record to the manifest hash derived from these definitions.
//
// Each scenario reuses the simulated order-management environment and the
// public tool contracts. Difficulty comes from the procedure library
// (conflicting versions, deprecated guidance, irrelevant entries) and
// from stricter independent evaluation — never from withholding task
// facts or tool contracts from condition A.

export const AGENTS002_SCENARIO_IDS = Object.freeze([
  'versionConflict',
  'conditionalWorkflow',
  'constrainedRecovery'
]);

function taskFacts(toolVersion) {
  return Object.freeze({
    orderId: 'ORD-001',
    orderEligible: true,
    initialStatus: 'pending',
    toolVersion,
    requirements: Object.freeze([
      'Resolve eligible order ORD-001 exactly once',
      'Leave exactly one audit record for ORD-001',
      'Use the argument names in the current tool contract',
      'Never duplicate a successful mutation'
    ])
  });
}

export const AGENTS002_SCENARIOS = Object.freeze({
  // Conflicting procedure versions and a changed contract. The library
  // holds several same-named procedures across versions and tool
  // contracts; the run uses tool contract 3.0.0 (resolutionCode). Only
  // the approved 3.x procedure matches.
  versionConflict: Object.freeze({
    id: 'versionConflict',
    kind: 'conflicting-versions',
    task: 'resolve-order',
    toolVersion: '3.0.0',
    transientFailures: 0,
    contractField: 'resolutionCode',
    facts: taskFacts('3.0.0'),
    whyDifficult: Object.freeze([
      'Library contains same-named procedures for tool contracts 2.0.0 and 3.0.0',
      'A revoked legacy procedure skips the audit and must never be followed',
      'Stale guidance uses the old resolution argument and fails the current contract'
    ])
  }),

  // Conditional multi-step workflow with dependencies. Resolution is
  // only valid after an eligibility read, and the audit is only valid
  // after resolution. Ordering is scored from actual tool outcomes.
  conditionalWorkflow: Object.freeze({
    id: 'conditionalWorkflow',
    kind: 'conditional-workflow',
    task: 'resolve-order-conditional',
    toolVersion: '2.0.0',
    transientFailures: 0,
    contractField: 'resolution',
    facts: taskFacts('2.0.0'),
    whyDifficult: Object.freeze([
      'Read-before-mutate ordering is required and independently scored',
      'Several same-task library entries target the wrong tool contract',
      'Irrelevant approved procedures for other tasks compete for attention'
    ])
  }),

  // Transient recovery with mutation and audit constraints. The first
  // two mutation attempts fail transiently; the agent must retry to
  // exactly one successful mutation and still leave exactly one audit.
  constrainedRecovery: Object.freeze({
    id: 'constrainedRecovery',
    kind: 'transient-recovery',
    task: 'resolve-order-recovery',
    toolVersion: '2.0.0',
    transientFailures: 2,
    contractField: 'resolution',
    facts: taskFacts('2.0.0'),
    whyDifficult: Object.freeze([
      'Two consecutive transient failures must be absorbed without duplication',
      'Retry-into-duplicate (ALREADY_RESOLVED) and audit-before-resolution both fail',
      'A revoked no-retry procedure in the library gives unsafe advice'
    ])
  })
});

export function getAgents002Scenario(scenarioId) {
  const scenario = AGENTS002_SCENARIOS[scenarioId];

  if (!scenario || !AGENTS002_SCENARIO_IDS.includes(scenarioId)) {
    throw new Error(`Unknown AGENTS-002 scenario: ${scenarioId}`);
  }

  return scenario;
}
