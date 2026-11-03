import test from 'node:test';
import assert from 'node:assert/strict';

import { runMuseBenchmark } from '../src/museBenchmark.mjs';

function mockTransport(decisions) {
  let index = 0;

  return async () => ({
    decision: decisions[index++],
    elapsedMs: 10,
    usage: [{
      calls: 1,
      models: [{
        input_tokens: 100,
        cached_tokens: 20,
        output_tokens: 30,
        reasoning_tokens: 5
      }]
    }]
  });
}

test('integrated benchmark executes decisions and evaluates outcome', async () => {
  const result = await runMuseBenchmark({
    scenarioId: 'routine',
    transport: mockTransport([
      {
        type: 'action',
        tool: 'readOrder',
        args: { id: 'ORD-001' }
      },
      {
        type: 'action',
        tool: 'resolveOrder',
        args: {
          id: 'ORD-001',
          resolution: 'approved'
        }
      },
      {
        type: 'action',
        tool: 'writeAudit',
        args: {
          id: 'ORD-001',
          note: 'Resolved'
        }
      },
      { type: 'finish' }
    ])
  });

  assert.equal(result.result.outcome.evaluation.passed, true);
  assert.equal(result.modelCalls.length, 4);
  assert.equal(result.usageTotals.calls, 4);
  assert.equal(result.usageTotals.inputTokens, 400);
  assert.equal(result.usageTotals.cachedTokens, 80);
  assert.equal(result.usageTotals.outputTokens, 120);
});

test('integrated benchmark preserves failed tool observations', async () => {
  const prompts = [];

  const decisions = [
    {
      type: 'action',
      tool: 'readOrder',
      args: { id: 'ORD-001' }
    },
    {
      type: 'action',
      tool: 'resolveOrder',
      args: {
        id: 'ORD-001',
        resolution: 'approved'
      }
    },
    {
      type: 'action',
      tool: 'resolveOrder',
      args: {
        id: 'ORD-001',
        resolution: 'approved'
      }
    },
    {
      type: 'action',
      tool: 'writeAudit',
      args: {
        id: 'ORD-001',
        note: 'Recovered'
      }
    },
    { type: 'finish' }
  ];

  let index = 0;

  const result = await runMuseBenchmark({
    scenarioId: 'transientRecovery',
    transport: async input => {
      prompts.push(input.messages);

      return {
        decision: decisions[index++],
        elapsedMs: 10,
        usage: []
      };
    }
  });

  const thirdPrompt = JSON.parse(prompts[2][1].content);

  assert.equal(
    thirdPrompt.observations[1].observation.result.ok,
    false
  );

  assert.equal(result.result.outcome.evaluation.passed, true);
});

test('integrated benchmark rejects missing transport', async () => {
  await assert.rejects(
    runMuseBenchmark({ scenarioId: 'routine' }),
    /transport function is required/
  );
});

test('integrated benchmark does not trust an invalid transport response', async () => {
  await assert.rejects(
    runMuseBenchmark({
      scenarioId: 'routine',
      transport: async () => ({})
    }),
    /Invalid Muse transport response/
  );
});
