// AGENTS-002 deterministic preflight: full 3x3 A/B/C matrix against the
// mock transport. This file never imports the paid Muse transport, so it
// cannot invoke paid inference. It also re-runs to prove resume safety.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AGENTS002_CONDITIONS,
  AGENTS002_EVALUATOR_NAME,
  AGENTS002_PROTOCOL_ID,
  evaluateAgents002BenchmarkOutcome,
  prepareAgents002Benchmark
} from '../../packages/agents-intelligence/src/agents002Benchmark.mjs';
import { AGENTS002_SCENARIOS } from '../../packages/agents-intelligence/src/agents002Scenarios.mjs';
import { AGENTS002_SCENARIO_IDS } from '../../packages/agents-intelligence/src/agents002Scenarios.mjs';
import { createMockTransportFactory } from '../../packages/agents-intelligence/src/mockMuseTransport.mjs';
import {
  auditConditionEquivalence,
  readCheckpointFile,
  runPersistentABC
} from '../../packages/agents-intelligence/src/persistentAbcRunner.mjs';

const prepared = prepareAgents002Benchmark();
const checkpoint = join(
  mkdtempSync(join(tmpdir(), 'agents002-preflight-')),
  'trials.jsonl'
);

function options() {
  return {
    prepared,
    transportFactory: createMockTransportFactory({
      scenarios: AGENTS002_SCENARIOS
    }),
    checkpointPath: checkpoint,
    protocol: AGENTS002_PROTOCOL_ID,
    validConditions: [...AGENTS002_CONDITIONS],
    validScenarioIds: [...AGENTS002_SCENARIO_IDS],
    scenarios: AGENTS002_SCENARIOS,
    evaluateOutcome: evaluateAgents002BenchmarkOutcome,
    evaluatorName: AGENTS002_EVALUATOR_NAME,
    model: 'mock',
    reasoningEffort: 'none'
  };
}

const audit = auditConditionEquivalence(prepared);
console.log(`equivalence: ${audit.equivalent ? 'PASS' : 'FAIL'}`);
for (const finding of audit.findings) console.log(`  - ${finding}`);
if (!audit.equivalent) process.exit(1);

const first = await runPersistentABC(options());
console.log(`first run: ${first.newTrials} new trials`);

const second = await runPersistentABC(options());
console.log(`resume run: ${second.newTrials} new trials`);

const { trials } = readCheckpointFile(checkpoint);
const passed = trials.filter(entry => entry.success).length;
console.log(`trials: ${trials.length}, passed: ${passed}`);

if (first.newTrials !== 9 || second.newTrials !== 0 || passed !== 9) {
  console.error('PREFLIGHT FAIL');
  process.exit(1);
}

console.log('PREFLIGHT PASS: paid pilot command is cleared for use');
