import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runAgentActionPlan
} from '../src/benchmarkRunner.mjs';

const routinePlan = {
  actions: [
    { tool: 'readOrder', args: { id: 'ORD-001' } },
    {
      tool: 'resolveOrder',
      args: { id: 'ORD-001', resolution: 'approved' }
    },
    {
      tool: 'writeAudit',
      args: { id: 'ORD-001', note: 'Order resolved' }
    }
  ]
};

test('independently scores successful routine actions', () => {
  const result = runAgentActionPlan({
    scenarioId: 'routine',
    plan: routinePlan
  });

  assert.equal(result.evaluation.passed, true);
  assert.equal(result.actionCount, 3);
});

test('rejects stale tool contract actions', () => {
  const result = runAgentActionPlan({
    scenarioId: 'changedContract',
    plan: routinePlan
  });

  assert.equal(result.evaluation.passed, false);
});

test('scores a compatible changed-contract plan', () => {
  const plan = structuredClone(routinePlan);

  plan.actions[1].args = {
    id: 'ORD-001',
    resolutionCode: 'approved'
  };

  const result = runAgentActionPlan({
    scenarioId: 'changedContract',
    plan
  });

  assert.equal(result.evaluation.passed, true);
});

test('scores transient recovery with a retry', () => {
  const plan = structuredClone(routinePlan);

  plan.actions.splice(2, 0, {
    tool: 'resolveOrder',
    args: {
      id: 'ORD-001',
      resolution: 'approved'
    }
  });

  const result = runAgentActionPlan({
    scenarioId: 'transientRecovery',
    plan
  });

  assert.equal(result.evaluation.passed, true);
});

test('rejects missing audit', () => {
  const result = runAgentActionPlan({
    scenarioId: 'routine',
    plan: {
      actions: routinePlan.actions.slice(0, 2)
    }
  });

  assert.equal(result.evaluation.passed, false);
});

test('rejects excessive actions', () => {
  assert.throws(
    () => runAgentActionPlan({
      scenarioId: 'routine',
      plan: {
        actions: Array.from(
          { length: 13 },
          () => ({
            tool: 'readOrder',
            args: { id: 'ORD-001' }
          })
        )
      }
    }),
    /limit exceeded/
  );
});

test('rejects unauthorized tools', () => {
  assert.throws(
    () => runAgentActionPlan({
      scenarioId: 'routine',
      plan: {
        actions: [
          { tool: 'deleteOrder', args: { id: 'ORD-001' } }
        ]
      }
    }),
    /Invalid agent action/
  );
});

test('does not trust agent-reported success', () => {
  const result = runAgentActionPlan({
    scenarioId: 'routine',
    plan: {
      actions: [
        { tool: 'readOrder', args: { id: 'ORD-001' } }
      ],
      claimedSuccess: true
    }
  });

  assert.equal(result.evaluation.passed, false);
});
