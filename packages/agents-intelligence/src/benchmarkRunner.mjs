import { createOrderEnvironment } from './orderEnvironment.mjs';
import { evaluateOrderOutcome } from './orderEvaluator.mjs';

export const BENCHMARK_SCENARIOS = Object.freeze({
  routine: Object.freeze({
    id: 'routine',
    toolVersion: '2.0.0',
    transientFailures: 0
  }),
  changedContract: Object.freeze({
    id: 'changedContract',
    toolVersion: '3.0.0',
    transientFailures: 0
  }),
  transientRecovery: Object.freeze({
    id: 'transientRecovery',
    toolVersion: '2.0.0',
    transientFailures: 1
  })
});

const ALLOWED_TOOLS = new Set([
  'readOrder',
  'resolveOrder',
  'writeAudit'
]);

const MAX_ACTIONS = 12;

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('Agent plan must be an object');
  }

  if (!Array.isArray(plan.actions)) {
    throw new TypeError('Agent plan must contain actions');
  }

  if (plan.actions.length > MAX_ACTIONS) {
    throw new RangeError('Agent action limit exceeded');
  }

  for (const action of plan.actions) {
    if (
      !action ||
      typeof action !== 'object' ||
      !ALLOWED_TOOLS.has(action.tool) ||
      !action.args ||
      typeof action.args !== 'object' ||
      Array.isArray(action.args)
    ) {
      throw new TypeError('Invalid agent action');
    }
  }
}

export function runAgentActionPlan({
  scenarioId,
  plan
}) {
  const scenario = BENCHMARK_SCENARIOS[scenarioId];

  if (!scenario) {
    throw new Error(`Unknown benchmark scenario: ${scenarioId}`);
  }

  validatePlan(plan);

  const environment = createOrderEnvironment({
    toolVersion: scenario.toolVersion,
    transientFailures: scenario.transientFailures
  });

  const results = [];

  for (const action of plan.actions) {
    let result;

    switch (action.tool) {
      case 'readOrder':
        result = environment.readOrder(action.args.id);
        break;

      case 'resolveOrder':
        result = environment.resolveOrder(action.args);
        break;

      case 'writeAudit':
        result = environment.writeAudit(action.args);
        break;
    }

    results.push({
      tool: action.tool,
      result: structuredClone(result)
    });
  }

  const snapshot = environment.snapshot();
  const evaluation = evaluateOrderOutcome(snapshot);

  return {
    schemaVersion: '1.0.0',
    scenarioId,
    toolVersion: scenario.toolVersion,
    actionCount: plan.actions.length,
    actions: structuredClone(plan.actions),
    results,
    snapshot,
    evaluation
  };
}
