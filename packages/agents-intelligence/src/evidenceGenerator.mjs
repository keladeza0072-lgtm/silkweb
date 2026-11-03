import { digest } from './index.mjs';
import { createOrderEnvironment } from './orderEnvironment.mjs';
import { evaluateOrderOutcome } from './orderEvaluator.mjs';
import {
  INTERPRETER_VERSION,
  executeProcedureSteps
} from './procedureInterpreter.mjs';

export const EVIDENCE_SCHEMA_VERSION = '2.0.0';

export const SCENARIOS = Object.freeze([
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

function baseScenarioResult(scenario) {
  return {
    scenario: scenario?.id ?? null,
    toolVersion: scenario?.toolVersion ?? null,
    transientFailures: scenario?.transientFailures ?? null,
    trace: [],
    snapshot: null
  };
}

export function executeVerificationScenario(procedure, scenario) {
  const base = baseScenarioResult(scenario);

  if (
    !scenario ||
    typeof scenario !== 'object' ||
    !['2.0.0', '3.0.0'].includes(scenario.toolVersion) ||
    !Number.isInteger(scenario.transientFailures) ||
    scenario.transientFailures < 0
  ) {
    return { ...base, passed: false, reason: 'INVALID_SCENARIO' };
  }

  if (!procedure || typeof procedure !== 'object') {
    return { ...base, passed: false, reason: 'INVALID_PROCEDURE' };
  }

  // Legacy verificationPlans are never executed and never count as
  // evidence. Their presence fails the scenario closed so they cannot
  // certify steps they were never bound to.
  if ('verificationPlans' in procedure) {
    return {
      ...base,
      passed: false,
      reason: 'LEGACY_VERIFICATION_PLAN'
    };
  }

  if (!['2.0.0', '3.0.0'].includes(procedure.toolVersion)) {
    return {
      ...base,
      passed: false,
      reason: 'INCOMPATIBLE_TOOL_CONTRACT'
    };
  }

  const env = createOrderEnvironment({
    toolVersion: scenario.toolVersion,
    transientFailures: scenario.transientFailures
  });

  // The declared procedure steps are the single source of executable
  // truth: they are what the interpreter runs here, and they are what
  // the registry serves to agents. Nothing else is executed.
  const execution = executeProcedureSteps({
    steps: procedure.steps,
    environment: env,
    toolVersion: scenario.toolVersion
  });

  const snapshot = env.snapshot();

  if (!execution.completed) {
    return {
      ...base,
      passed: false,
      reason: execution.reason,
      failedStep: execution.failedStep,
      failedCode: execution.failedCode,
      trace: execution.trace,
      snapshot
    };
  }

  // Final environment state is evaluated independently of the
  // interpreter's own success claims.
  const outcome = evaluateOrderOutcome(snapshot);

  return {
    ...base,
    passed: outcome.passed,
    reason: outcome.passed ? 'PASS' : 'OUTCOME_FAILED',
    checks: outcome.checks,
    trace: execution.trace,
    snapshot
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
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    procedureId: procedure.id,
    procedureVersion: procedure.version,
    procedureDigest: digest(procedure),
    stepsDigest: digest(procedure.steps ?? null),
    suiteId: 'AGENTS-001-DETERMINISTIC',
    suiteDigest: digest(SCENARIOS),
    interpreterVersion: INTERPRETER_VERSION,
    passed,
    scenarios
  };

  return {
    ...report,
    evidenceId: digest(report)
  };
}
