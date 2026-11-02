// AGENTS-003 free preflight: deterministic matrix, fallback probe,
// checkpoint resume, and comparison against the preserved AGENTS-002
// mock baseline. This file never imports the paid Muse transport, so
// it cannot invoke paid inference.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AGENTS003_CONDITIONS,
  AGENTS003_PROTOCOL_ID,
  prepareAgents003Benchmark,
  runAgents002MockBaseline,
  summarizeAgents003Comparison
} from '../../packages/agents-intelligence/src/agents003Benchmark.mjs';
import { AGENTS002_SCENARIO_IDS } from '../../packages/agents-intelligence/src/agents002Scenarios.mjs';
import { evaluateAgents002BenchmarkOutcome } from '../../packages/agents-intelligence/src/agents002Benchmark.mjs';
import { AGENTS002_SCENARIOS } from '../../packages/agents-intelligence/src/agents002Scenarios.mjs';
import { runWithControlledFallback } from '../../packages/agents-intelligence/src/agents003Executor.mjs';
import { createMockTransportFactory } from '../../packages/agents-intelligence/src/mockMuseTransport.mjs';
import {
  AGENTS002_LIBRARY,
  createAgents002Trust
} from '../../packages/agents-intelligence/src/agents002Library.mjs';
import {
  readCheckpointFile,
  runPersistentABC
} from '../../packages/agents-intelligence/src/persistentAbcRunner.mjs';

let failures = 0;

function check(name, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);

  if (!condition) failures++;
}

const prepared = prepareAgents003Benchmark();

check('manifest protocol is AGENTS-003', prepared.manifest.protocol === 'AGENTS-003');
check('manifest schema separately versioned', prepared.manifest.schemaVersion === '1.0.0');
check('inference not authorized', prepared.manifest.inferenceAuthorized === false);
check(
  'frozen scenarios covered',
  JSON.stringify(prepared.manifest.scenarios) === JSON.stringify([...AGENTS002_SCENARIO_IDS])
);

// 1. Deterministic matrix: every frozen scenario passes with zero model calls.
const deterministicResults = [];

for (const scenarioId of AGENTS002_SCENARIO_IDS) {
  const result = prepared.executeDeterministic(scenarioId);

  deterministicResults.push({ scenarioId, ...result });
  check(
    `deterministic ${scenarioId}`,
    result.status === 'DETERMINISTIC_PASS' && result.modelCalls === 0 && !result.fallbackUsed,
    `status=${result.status} mutations=${result.snapshot?.mutationCount ?? '?'}`
  );
}

// 2. Fallback probe: genuinely insufficient deterministic input (an
// unknown task selects nothing) with fallback authorized and a mock
// transport. Proves the fallback path executes and is independently
// scored, without paid inference.
const probe = await runWithControlledFallback({
  deterministic: {
    library: AGENTS002_LIBRARY,
    trust: createAgents002Trust(),
    task: 'resolve-order-nonexistent',
    toolVersion: '2.0.0',
    scenario: AGENTS002_SCENARIOS.constrainedRecovery
  },
  allowFallback: true,
  transportFactory: createMockTransportFactory({ scenarios: AGENTS002_SCENARIOS }),
  scenarioId: 'constrainedRecovery',
  scenarios: AGENTS002_SCENARIOS
});

check(
  'fallback engages only on deterministic insufficiency',
  probe.fallbackUsed === true &&
    probe.fallbackReason === 'NO_APPROVED_PROCEDURE' &&
    probe.selection?.status !== 'SELECTED',
  `status=${probe.status} modelCalls=${probe.modelCalls}`
);
check(
  'fallback outcome independently scored',
  probe.evaluation !== null && typeof probe.evaluation.passed === 'boolean',
  `passed=${probe.evaluation?.passed}`
);

// Fallback stays off without authorization.
const gated = await runWithControlledFallback({
  deterministic: {
    library: AGENTS002_LIBRARY,
    trust: createAgents002Trust(),
    task: 'resolve-order-nonexistent',
    toolVersion: '2.0.0',
    scenario: AGENTS002_SCENARIOS.constrainedRecovery
  },
  allowFallback: false,
  transportFactory: createMockTransportFactory({ scenarios: AGENTS002_SCENARIOS }),
  scenarioId: 'constrainedRecovery',
  scenarios: AGENTS002_SCENARIOS
});

check(
  'fallback gated without authorization',
  gated.fallbackUsed === false && gated.modelCalls === 0,
  `status=${gated.status}`
);

// 3. Checkpoint resume: full conditions x scenarios matrix, then a
// resumed run that must add zero trials.
const checkpoint = join(
  mkdtempSync(join(tmpdir(), 'agents003-preflight-')),
  'trials.jsonl'
);

function options() {
  return {
    prepared,
    transportFactory: createMockTransportFactory({ scenarios: AGENTS002_SCENARIOS }),
    checkpointPath: checkpoint,
    runBenchmark: prepared.runTrial,
    protocol: AGENTS003_PROTOCOL_ID,
    validConditions: [...AGENTS003_CONDITIONS],
    validScenarioIds: [...AGENTS002_SCENARIO_IDS],
    scenarios: AGENTS002_SCENARIOS,
    evaluateOutcome: evaluateAgents002BenchmarkOutcome,
    evaluatorName: 'evaluateAgents002Outcome',
    model: 'mock',
    reasoningEffort: 'none'
  };
}

const first = await runPersistentABC(options());
const second = await runPersistentABC(options());
const { trials } = readCheckpointFile(checkpoint);
const passed = trials.filter(entry => entry.success).length;

check('checkpoint first run records 6 trials', first.newTrials === 6, `${first.newTrials} new`);
check('checkpoint resume adds 0 trials', second.newTrials === 0, `${second.newTrials} new`);
check(
  'checkpoint trials carry AGENTS-003 protocol',
  trials.length === 6 && trials.every(entry => entry.protocol === 'AGENTS-003'),
  `${passed}/${trials.length} passed`
);

// 4. Preserved AGENTS-002 baseline comparison (mock transport, free).
const baseline = await runAgents002MockBaseline({
  transportFactory: createMockTransportFactory({ scenarios: AGENTS002_SCENARIOS })
});
const comparison = summarizeAgents003Comparison({
  deterministicResults,
  baselineResults: baseline.results
});

console.log('comparison: deterministic vs AGENTS-002 condition C (mock)');
for (const row of comparison.rows) {
  console.log(
    `  - ${row.scenarioId}: deterministic=${row.deterministicPass ? 'PASS' : 'FAIL'} ` +
    `modelCalls=${row.deterministicModelCalls} baselineC=${row.baselinePass ? 'PASS' : 'FAIL'}`
  );
}

check(
  'deterministic parity with baseline',
  comparison.parity && comparison.baselinePass === comparison.scenarios,
  `${comparison.deterministicPass}/${comparison.scenarios} vs baseline ${comparison.baselinePass}/${comparison.scenarios}`
);

if (failures > 0) {
  console.error(`PREFLIGHT FAIL: ${failures} check(s) failed`);
  process.exit(1);
}

console.log('PREFLIGHT PASS: paid pilot command is cleared for use');
