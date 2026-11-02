import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runAgentDecisionLoop
} from '../src/agentDecisionLoop.mjs';

function scriptedDecider(decisions, received) {
  let index = 0;

  return async input => {
    received.push(input);
    return decisions[index++];
  };
}

test('model decisions execute against the interactive environment', async () => {
  const received = [];

  const result = await runAgentDecisionLoop({
    scenarioId: 'routine',
    decide: scriptedDecider([
      {
        type: 'action',
        tool: 'readOrder',
        args: { id: 'ORD-001' }
      },
      {
        type: 'action',
        tool: 'resolveOrder',
        args: { id: 'ORD-001', resolution: 'approved' }
      },
      {
        type: 'action',
        tool: 'writeAudit',
        args: { id: 'ORD-001', note: 'Resolved' }
      },
      { type: 'finish' }
    ], received)
  });

  assert.equal(result.outcome.evaluation.passed, true);
  assert.equal(result.finishReason, 'AGENT_FINISHED');
  assert.equal(received.length, 4);
});

test('next model decision receives the previous tool observation', async () => {
  const received = [];

  await runAgentDecisionLoop({
    scenarioId: 'transientRecovery',
    decide: scriptedDecider([
      {
        type: 'action',
        tool: 'readOrder',
        args: { id: 'ORD-001' }
      },
      {
        type: 'action',
        tool: 'resolveOrder',
        args: { id: 'ORD-001', resolution: 'approved' }
      },
      {
        type: 'action',
        tool: 'resolveOrder',
        args: { id: 'ORD-001', resolution: 'approved' }
      },
      {
        type: 'action',
        tool: 'writeAudit',
        args: { id: 'ORD-001', note: 'Recovered' }
      },
      { type: 'finish' }
    ], received)
  });

  const thirdPrompt = JSON.parse(received[2].messages[1].content);

  assert.equal(
    thirdPrompt.observations[1].observation.result.ok,
    false
  );
});

test('missing audit is independently scored as failure', async () => {
  const result = await runAgentDecisionLoop({
    scenarioId: 'routine',
    decide: async ({ step }) =>
      step === 0
        ? {
            type: 'action',
            tool: 'readOrder',
            args: { id: 'ORD-001' }
          }
        : { type: 'finish' }
  });

  assert.equal(result.outcome.evaluation.passed, false);
});

test('invalid decisions fail closed', async () => {
  await assert.rejects(
    runAgentDecisionLoop({
      scenarioId: 'routine',
      decide: async () => ({
        type: 'action',
        tool: 'resolveOrder'
      })
    }),
    /Invalid agent action decision/
  );
});

test('decision limit is enforced', async () => {
  const result = await runAgentDecisionLoop({
    scenarioId: 'routine',
    maxDecisions: 2,
    decide: async () => ({
      type: 'action',
      tool: 'readOrder',
      args: { id: 'ORD-001' }
    })
  });

  assert.equal(result.finishReason, 'DECISION_LIMIT');
  assert.equal(result.decisionCount, 2);
});

test('guidance is passed into model context', async () => {
  let captured;

  await runAgentDecisionLoop({
    scenarioId: 'routine',
    guidance: {
      steps: ['Read order', 'Resolve', 'Audit']
    },
    decide: async input => {
      captured = input.messages;
      return { type: 'finish' };
    }
  });

  const prompt = JSON.parse(captured[1].content);

  assert.deepEqual(
    prompt.guidance.steps,
    ['Read order', 'Resolve', 'Audit']
  );
});
