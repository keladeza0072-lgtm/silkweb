import { BENCHMARK_SCENARIOS } from './benchmarkRunner.mjs';

// Deterministic stand-in for the paid Muse transport. It plays a fixed,
// contract-correct decision script per scenario and never touches the
// network, so preflight and tests prove the harness without paid inference.
export function decisionsForScenario(
  scenarioId,
  { scenarios = BENCHMARK_SCENARIOS } = {}
) {
  const registry = scenarios ?? BENCHMARK_SCENARIOS;
  const scenario = registry[scenarioId];

  if (!scenario) {
    throw new Error(`Unknown benchmark scenario: ${scenarioId}`);
  }

  const resolveArgs = scenario.toolVersion === '3.0.0'
    ? { id: 'ORD-001', resolutionCode: 'approved' }
    : { id: 'ORD-001', resolution: 'approved' };

  const script = [
    { type: 'action', tool: 'readOrder', args: { id: 'ORD-001' } },
    { type: 'action', tool: 'resolveOrder', args: resolveArgs }
  ];

  // Each injected transient failure is absorbed by one immediate retry
  // of the same contract-correct mutation, exactly as a recovering
  // agent must, before the audit is written.
  for (let attempt = 0; attempt < scenario.transientFailures; attempt++) {
    script.push({ type: 'action', tool: 'resolveOrder', args: resolveArgs });
  }

  script.push(
    {
      type: 'action',
      tool: 'writeAudit',
      args: { id: 'ORD-001', note: 'Mock resolution' }
    },
    { type: 'finish' }
  );

  return script;
}

function mockUsage(callIndex) {
  return [{
    calls: 1,
    models: [{
      model: 'mock',
      input_tokens: 100 + callIndex,
      cached_tokens: 10,
      output_tokens: 20,
      reasoning_tokens: 5
    }]
  }];
}

export function createMockTransportFactory({
  model = 'mock',
  reasoningEffort = 'none',
  scenarios = null
} = {}) {
  return async function mockTransportFactory({ scenarioId }) {
    const script = decisionsForScenario(
      scenarioId,
      scenarios ? { scenarios } : undefined
    );
    let index = 0;

    const transport = async () => {
      const decision = script[Math.min(index, script.length - 1)];
      const usage = mockUsage(index);
      index += 1;

      return {
        decision: structuredClone(decision),
        elapsedMs: 1,
        usage,
        mock: true
      };
    };

    transport.mock = true;
    transport.model = model;
    transport.reasoningEffort = reasoningEffort;

    return transport;
  };
}
