import { createOrderEnvironment } from './orderEnvironment.mjs';
import { evaluateOrderOutcome } from './orderEvaluator.mjs';
import { BENCHMARK_SCENARIOS } from './benchmarkRunner.mjs';

const ALLOWED_TOOLS = new Set([
  'readOrder',
  'resolveOrder',
  'writeAudit'
]);

const MAX_ACTIONS = 12;

function validAction(action) {
  return (
    action &&
    typeof action === 'object' &&
    !Array.isArray(action) &&
    ALLOWED_TOOLS.has(action.tool) &&
    action.args &&
    typeof action.args === 'object' &&
    !Array.isArray(action.args)
  );
}

export function createInteractiveBenchmark(scenarioId) {
  const scenario = BENCHMARK_SCENARIOS[scenarioId];

  if (!scenario) {
    throw new Error(`Unknown benchmark scenario: ${scenarioId}`);
  }

  const environment = createOrderEnvironment({
    toolVersion: scenario.toolVersion,
    transientFailures: scenario.transientFailures
  });

  const history = [];
  let finished = false;

  function submitAction(action) {
    if (finished) {
      return {
        accepted: false,
        error: 'SESSION_FINISHED'
      };
    }

    if (history.length >= MAX_ACTIONS) {
      finished = true;

      return {
        accepted: false,
        error: 'ACTION_LIMIT_EXCEEDED'
      };
    }

    if (!validAction(action)) {
      history.push({
        action: structuredClone(action ?? null),
        accepted: false,
        error: 'INVALID_ACTION'
      });

      return {
        accepted: false,
        error: 'INVALID_ACTION'
      };
    }

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

    const event = {
      action: structuredClone(action),
      accepted: true,
      result: structuredClone(result)
    };

    history.push(event);

    return structuredClone(event);
  }

  function finish() {
    if (finished) {
      return {
        error: 'SESSION_FINISHED'
      };
    }

    finished = true;

    const snapshot = environment.snapshot();
    const evaluation = evaluateOrderOutcome(snapshot);

    return {
      scenarioId,
      toolVersion: scenario.toolVersion,
      actionCount: history.length,
      history: structuredClone(history),
      snapshot,
      evaluation
    };
  }

  return Object.freeze({
    scenarioId,
    toolVersion: scenario.toolVersion,
    submitAction,
    finish
  });
}
