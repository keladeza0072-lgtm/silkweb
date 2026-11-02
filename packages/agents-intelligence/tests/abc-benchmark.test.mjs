import test from 'node:test';
import assert from 'node:assert/strict';

import { runABC } from '../src/abcBenchmark.mjs';

test('A/B/C runner executes all nine scenario-condition pairs', async () => {
  const seen = [];

  const prepared = {
    manifestHash: 'test-manifest',
    guidanceFor(condition, scenarioId) {
      seen.push(`${scenarioId}:${condition}`);
      return condition === 'A' ? null : { steps: ['Test guidance'] };
    }
  };

  const result = await runABC({
    prepared,
    transportFactory: async () => async () => ({
      decision: { type: 'finish' },
      elapsedMs: 1,
      usage: []
    })
  });

  assert.equal(result.results.length, 9);
  assert.equal(new Set(seen).size, 9);
  assert.equal(result.manifestHash, 'test-manifest');

  for (const entry of result.results) {
    assert.equal(entry.result.outcome.evaluation.passed, false);
  }
});

test('runner rejects an unknown benchmark condition', async () => {
  await assert.rejects(
    runABC({
      prepared: {
        guidanceFor: () => null,
        manifestHash: 'test'
      },
      conditions: ['D'],
      transportFactory: async () => async () => ({
        decision: { type: 'finish' },
        usage: []
      })
    }),
    /Unknown condition/
  );
});
