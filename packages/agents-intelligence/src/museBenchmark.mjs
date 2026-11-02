import { performance } from 'node:perf_hooks';
import { runAgentDecisionLoop } from './agentDecisionLoop.mjs';

export async function runMuseBenchmark({
  scenarioId,
  guidance = null,
  transport,
  maxDecisions = 12,
  scenarios = null,
  evaluateOutcome = null
}) {
  if (typeof transport !== 'function') {
    throw new TypeError('A Muse transport function is required');
  }

  const modelCalls = [];
  const start = performance.now();

  const result = await runAgentDecisionLoop({
    scenarioId,
    guidance,
    maxDecisions,
    ...(scenarios ? { scenarios } : {}),
    ...(evaluateOutcome ? { evaluateOutcome } : {}),
    decide: async ({ messages, step }) => {
      const response = await transport({
        messages,
        step
      });

      if (
        !response ||
        typeof response !== 'object' ||
        !response.decision
      ) {
        throw new Error('Invalid Muse transport response');
      }

      modelCalls.push({
        step,
        elapsedMs: response.elapsedMs ?? null,
        usage: structuredClone(response.usage ?? []),
        decision: structuredClone(response.decision)
      });

      return response.decision;
    }
  });

  const totalElapsedMs = performance.now() - start;

  const usageTotals = {
    calls: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0
  };

  for (const call of modelCalls) {
    for (const usage of call.usage) {
      usageTotals.calls += usage.calls ?? 0;

      for (const model of usage.models ?? []) {
        usageTotals.inputTokens += model.input_tokens ?? 0;
        usageTotals.cachedTokens += model.cached_tokens ?? 0;
        usageTotals.outputTokens += model.output_tokens ?? 0;
        usageTotals.reasoningTokens += model.reasoning_tokens ?? 0;
      }
    }
  }

  return {
    schemaVersion: '1.0.0',
    scenarioId,
    totalElapsedMs,
    modelCalls,
    usageTotals,
    result
  };
}
