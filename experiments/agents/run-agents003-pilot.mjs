// AGENTS-003 paid pilot. Paid inference runs ONLY with --execute.
// Without it the script prepares the deterministic benchmark, prints
// the plan, and exits before any model call.
import {
  AGENTS003_CONDITIONS,
  AGENTS003_PROTOCOL_ID,
  prepareAgents003Benchmark
} from '../../packages/agents-intelligence/src/agents003Benchmark.mjs';
import { AGENTS002_SCENARIOS } from '../../packages/agents-intelligence/src/agents002Scenarios.mjs';
import { AGENTS002_SCENARIO_IDS } from '../../packages/agents-intelligence/src/agents002Scenarios.mjs';
import { evaluateAgents002BenchmarkOutcome } from '../../packages/agents-intelligence/src/agents002Benchmark.mjs';
import { createMuseTransport } from '../../packages/agents-intelligence/src/museTransport.mjs';
import { runPersistentABC } from '../../packages/agents-intelligence/src/persistentAbcRunner.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const workspace = arg('--workspace');
const checkpoint = arg(
  '--checkpoint',
  'experiments/agents/checkpoints/agents003-pilot.jsonl'
);
const repeats = Number(arg('--repeats', '1'));
const model = arg('--model', 'muse-spark-1.3');
const reasoningEffort = arg('--reasoning-effort', 'high');
const maxDecisions = Number(arg('--max-decisions', '12'));
const execute = process.argv.includes('--execute');

if (!workspace) {
  console.error('Missing required --workspace <isolated Muse workspace>');
  process.exit(2);
}

const prepared = prepareAgents003Benchmark();
console.log(`manifest: ${prepared.manifestHash}`);
console.log(`plan: ${AGENTS003_CONDITIONS.length} conditions x 3 scenarios x ${repeats} repeat(s)`);
console.log(`conditions: deterministic (no inference) + fallback (model only when deterministic fails)`);
console.log(`checkpoint: ${checkpoint}`);

// Deterministic pre-check: free, runs before any authorization gate.
for (const scenarioId of AGENTS002_SCENARIO_IDS) {
  const result = prepared.executeDeterministic(scenarioId);

  console.log(`deterministic ${scenarioId}: ${result.status}`);
}

if (!execute) {
  console.log('Dry run: pass --execute to authorize paid inference.');
  process.exit(0);
}

const decide = createMuseTransport({
  model,
  reasoningEffort,
  workspace,
  maxModelSteps: 2,
  enabled: true
});

const result = await runPersistentABC({
  prepared,
  transportFactory: async () => decide,
  checkpointPath: checkpoint,
  runBenchmark: prepared.runTrial,
  repeats,
  model,
  reasoningEffort,
  maxDecisions,
  protocol: AGENTS003_PROTOCOL_ID,
  validConditions: [...AGENTS003_CONDITIONS],
  validScenarioIds: [...AGENTS002_SCENARIO_IDS],
  scenarios: AGENTS002_SCENARIOS,
  evaluateOutcome: evaluateAgents002BenchmarkOutcome,
  evaluatorName: 'evaluateAgents002Outcome'
});

const passed = result.trials.filter(entry => entry.success).length;
console.log(`new trials: ${result.newTrials}, passed: ${passed}`);
console.log(`checkpoint: ${result.checkpointPath}`);
