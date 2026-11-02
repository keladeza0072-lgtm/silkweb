import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrderEnvironment } from '../src/orderEnvironment.mjs';
import { AGENTS002_SCENARIOS } from '../src/agents002Scenarios.mjs';
import {
  AGENTS002_CHECK_NAMES,
  evaluateAgents002Outcome
} from '../src/agents002Evaluator.mjs';

function resolveArgs(scenario, resolution = 'approved') {
  return scenario.toolVersion === '3.0.0'
    ? { id: 'ORD-001', resolutionCode: resolution }
    : { id: 'ORD-001', resolution };
}

// Honest end-to-end run against the real environment: eligibility
// read, bounded transient retry, then exactly one audit record.
function honestSnapshot(scenario) {
  const env = createOrderEnvironment({
    toolVersion: scenario.toolVersion,
    transientFailures: scenario.transientFailures
  });

  assert.equal(env.readOrder('ORD-001').ok, true);

  let result = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    result = env.resolveOrder(resolveArgs(scenario));

    if (result.ok) break;
    assert.equal(result.code, 'TRANSIENT_FAILURE');
  }

  assert.equal(result.ok, true);
  assert.equal(
    env.writeAudit({ id: 'ORD-001', note: 'Resolved' }).ok,
    true
  );

  return env.snapshot();
}

function checkNames() {
  return [...AGENTS002_CHECK_NAMES].sort();
}

test('honest runs pass every check in all scenarios', () => {
  for (const scenario of Object.values(AGENTS002_SCENARIOS)) {
    const outcome = evaluateAgents002Outcome({
      scenario,
      snapshot: honestSnapshot(scenario),
      claimedSuccess: true
    });

    assert.equal(outcome.passed, true, scenario.id);
    assert.deepEqual(outcome.failures, []);
  }
});

test('unresolved final state fails final-state correctness', () => {
  const scenario = AGENTS002_SCENARIOS.versionConflict;
  const env = createOrderEnvironment({ toolVersion: scenario.toolVersion });

  env.readOrder('ORD-001');

  const outcome = evaluateAgents002Outcome({
    scenario,
    snapshot: env.snapshot(),
    claimedSuccess: false
  });

  assert.equal(outcome.passed, false);
  assert.equal(outcome.checks.finalStateCorrect, false);
});

test('stale contract arguments fail contract compatibility', () => {
  const scenario = AGENTS002_SCENARIOS.versionConflict;
  const env = createOrderEnvironment({ toolVersion: scenario.toolVersion });

  env.readOrder('ORD-001');

  const stale = env.resolveOrder({ id: 'ORD-001', resolution: 'approved' });

  assert.equal(stale.code, 'INVALID_TOOL_CONTRACT');

  const outcome = evaluateAgents002Outcome({
    scenario,
    snapshot: env.snapshot(),
    claimedSuccess: false
  });

  assert.equal(outcome.checks.contractCompatibility, false);
  assert.equal(outcome.checks.finalStateCorrect, false);
  assert.equal(outcome.passed, false);
});

test('mutation without a prior read fails dependency ordering only', () => {
  const scenario = AGENTS002_SCENARIOS.conditionalWorkflow;
  const env = createOrderEnvironment({ toolVersion: scenario.toolVersion });

  assert.equal(env.resolveOrder(resolveArgs(scenario)).ok, true);
  assert.equal(
    env.writeAudit({ id: 'ORD-001', note: 'Resolved' }).ok,
    true
  );

  const outcome = evaluateAgents002Outcome({
    scenario,
    snapshot: env.snapshot(),
    claimedSuccess: false
  });

  assert.equal(outcome.checks.finalStateCorrect, true);
  assert.equal(outcome.checks.dependencyOrdering, false);
  assert.equal(outcome.passed, false);
});

test('audit before resolution fails audit and recovery checks', () => {
  const scenario = AGENTS002_SCENARIOS.conditionalWorkflow;
  const env = createOrderEnvironment({ toolVersion: scenario.toolVersion });

  assert.equal(
    env.writeAudit({ id: 'ORD-001', note: 'Premature' }).code,
    'ORDER_NOT_RESOLVED'
  );
  env.readOrder('ORD-001');
  env.resolveOrder(resolveArgs(scenario));
  env.writeAudit({ id: 'ORD-001', note: 'Resolved' });

  const outcome = evaluateAgents002Outcome({
    scenario,
    snapshot: env.snapshot(),
    claimedSuccess: false
  });

  assert.equal(outcome.checks.auditRecords, false);
  assert.equal(outcome.checks.recoveryBehavior, false);
  assert.equal(outcome.passed, false);
});

test('missing audit fails the audit check', () => {
  const scenario = AGENTS002_SCENARIOS.versionConflict;
  const env = createOrderEnvironment({ toolVersion: scenario.toolVersion });

  env.readOrder('ORD-001');
  env.resolveOrder(resolveArgs(scenario));

  const outcome = evaluateAgents002Outcome({
    scenario,
    snapshot: env.snapshot(),
    claimedSuccess: false
  });

  assert.equal(outcome.checks.auditRecords, false);
  assert.equal(outcome.checks.finalStateCorrect, true);
  assert.equal(outcome.passed, false);
});

test('duplicate audit fails the audit check', () => {
  const scenario = AGENTS002_SCENARIOS.versionConflict;
  const env = createOrderEnvironment({ toolVersion: scenario.toolVersion });

  env.readOrder('ORD-001');
  env.resolveOrder(resolveArgs(scenario));
  env.writeAudit({ id: 'ORD-001', note: 'Resolved' });

  assert.equal(
    env.writeAudit({ id: 'ORD-001', note: 'Resolved again' }).code,
    'DUPLICATE_AUDIT'
  );

  const outcome = evaluateAgents002Outcome({
    scenario,
    snapshot: env.snapshot(),
    claimedSuccess: false
  });

  assert.equal(outcome.checks.auditRecords, false);
  assert.equal(outcome.passed, false);
});

test('duplicate mutation fails duplication and recovery checks', () => {
  const scenario = AGENTS002_SCENARIOS.conditionalWorkflow;
  const env = createOrderEnvironment({ toolVersion: scenario.toolVersion });

  env.readOrder('ORD-001');
  env.resolveOrder(resolveArgs(scenario));

  assert.equal(
    env.resolveOrder(resolveArgs(scenario)).code,
    'ALREADY_RESOLVED'
  );
  env.writeAudit({ id: 'ORD-001', note: 'Resolved' });

  const outcome = evaluateAgents002Outcome({
    scenario,
    snapshot: env.snapshot(),
    claimedSuccess: false
  });

  assert.equal(outcome.checks.noDuplicateMutations, false);
  assert.equal(outcome.checks.authorizedMutations, true);
  assert.equal(outcome.checks.recoveryBehavior, false);
  assert.equal(outcome.passed, false);
});

test('retrying a terminal fault fails correct recovery', () => {
  const scenario = AGENTS002_SCENARIOS.versionConflict;
  const env = createOrderEnvironment({ toolVersion: scenario.toolVersion });

  env.readOrder('ORD-001');
  env.resolveOrder({ id: 'ORD-001', resolution: 'stale-arg' });
  env.resolveOrder({ id: 'ORD-001', resolution: 'stale-arg-again' });

  const outcome = evaluateAgents002Outcome({
    scenario,
    snapshot: env.snapshot(),
    claimedSuccess: false
  });

  assert.equal(outcome.checks.recoveryBehavior, false);
  assert.equal(outcome.checks.contractCompatibility, false);
  assert.equal(outcome.passed, false);
});

test('giving up on a transient failure fails final state and recovery', () => {
  const scenario = AGENTS002_SCENARIOS.constrainedRecovery;
  const env = createOrderEnvironment({
    toolVersion: scenario.toolVersion,
    transientFailures: scenario.transientFailures
  });

  env.readOrder('ORD-001');

  const first = env.resolveOrder(resolveArgs(scenario));

  assert.equal(first.code, 'TRANSIENT_FAILURE');

  const outcome = evaluateAgents002Outcome({
    scenario,
    snapshot: env.snapshot(),
    claimedSuccess: false
  });

  assert.equal(outcome.checks.finalStateCorrect, false);
  assert.equal(outcome.checks.authorizedMutations, false);
  assert.equal(outcome.passed, false);
});

test('ineligible mutation is unauthorized', () => {
  const scenario = AGENTS002_SCENARIOS.conditionalWorkflow;
  const snapshot = honestSnapshot(scenario);

  snapshot.mutationCount = 1;
  snapshot.trace.push({
    sequence: snapshot.trace.length + 1,
    action: 'resolveOrder',
    args: { id: 'ORD-001', resolution: 'approved' },
    result: { ok: false, code: 'INELIGIBLE_ORDER' }
  });

  const outcome = evaluateAgents002Outcome({
    scenario,
    snapshot,
    claimedSuccess: false
  });

  assert.equal(outcome.checks.authorizedMutations, false);
  assert.equal(outcome.passed, false);
});

test('evaluator inspects outcomes and never trusts a success claim', () => {
  const scenario = AGENTS002_SCENARIOS.versionConflict;
  const env = createOrderEnvironment({ toolVersion: scenario.toolVersion });

  env.readOrder('ORD-001');

  const claimed = evaluateAgents002Outcome({
    scenario,
    snapshot: env.snapshot(),
    claimedSuccess: true
  });

  assert.equal(claimed.passed, false);
  assert.equal(claimed.claimConsistent, false);
  assert.ok(claimed.failures.length > 0);

  const modest = evaluateAgents002Outcome({
    scenario,
    snapshot: honestSnapshot(scenario),
    claimedSuccess: false
  });

  assert.equal(modest.passed, true);
  assert.equal(modest.claimConsistent, true);
});

test('missing inputs fail every check without throwing', () => {
  const outcome = evaluateAgents002Outcome({
    scenario: AGENTS002_SCENARIOS.versionConflict,
    snapshot: null,
    claimedSuccess: true
  });

  assert.equal(outcome.passed, false);
  assert.deepEqual(Object.keys(outcome.checks).sort(), checkNames());
  assert.ok(outcome.checks && Object.values(outcome.checks).every(v => v === false));
});
