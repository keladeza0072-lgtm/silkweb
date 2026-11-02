import { digest } from './index.mjs';
import { createOrderEnvironment } from './orderEnvironment.mjs';
import { evaluateOrderOutcome } from './orderEvaluator.mjs';

const SCENARIOS = Object.freeze([
  {
    id: 'routine',
    toolVersion: '2.0.0',
    transientFailures: 0
  },
  {
    id: 'changed-contract',
    toolVersion: '3.0.0',
    transientFailures: 0
  },
  {
    id: 'transient-recovery',
    toolVersion: '2.0.0',
    transientFailures: 1
  }
]);

export function executeVerificationScenario(procedure, scenario) {
  const env = createOrderEnvironment({
    toolVersion: scenario.toolVersion,
    transientFailures: scenario.transientFailures
  });

  const actions = procedure?.verificationPlans?.[scenario.id];

  if (!Array.isArray(actions) || actions.length === 0) {
    return {
      scenario: scenario.id,
      passed: false,
      reason: 'MISSING_VERIFICATION_PLAN'
    };
  }

  const observations = [];

  for (const action of actions) {
    let result;

    switch (action?.tool) {
      case 'readOrder':
        result = env.readOrder(action.args?.id);
        break;

      case 'resolveOrder':
        result = env.resolveOrder(action.args);
        break;

      case 'writeAudit':
        result = env.writeAudit(action.args);
        break;

      default:
        return {
          scenario: scenario.id,
          passed: false,
          reason: 'UNKNOWN_TOOL'
        };
    }

    observations.push({
      tool: action.tool,
      result
    });

    if (!result?.ok && result?.code !== 'TRANSIENT_FAILURE') {
      break;
    }
  }

  const outcome = evaluateOrderOutcome(env.snapshot());

  return {
    scenario: scenario.id,
    passed: outcome.passed,
    checks: outcome.checks,
    observations,
    reason: outcome.passed ? 'PASS' : 'OUTCOME_FAILED'
  };
}

export function generateProcedureEvidence(procedure) {
  if (
    !procedure ||
    typeof procedure !== 'object' ||
    !procedure.id ||
    !procedure.version
  ) {
    throw new TypeError('Valid procedure required');
  }

  const scenarios = SCENARIOS.map(scenario =>
    executeVerificationScenario(procedure, scenario)
  );

  const passed = scenarios.every(scenario => scenario.passed);

  const report = {
    schemaVersion: '1.0.0',
    procedureId: procedure.id,
    procedureVersion: procedure.version,
    procedureDigest: digest(procedure),
    suiteId: 'AGENTS-001-DETERMINISTIC',
    suiteDigest: digest(SCENARIOS),
    passed,
    scenarios
  };

  return {
    ...report,
    evidenceId: digest(report)
  };
}
