// AGENTS-001 first REAL paid 3x3 pilot. Paid inference runs ONLY with
// --execute. Without it the script prepares the registry, prints the plan,
// and exits before any model call.
import { prepareABC } from '../../packages/agents-intelligence/src/abcBenchmark.mjs';
import { createBenchmarkRegistry } from '../../packages/agents-intelligence/src/benchmarkRegistry.mjs';
import { createMuseTransport } from '../../packages/agents-intelligence/src/museTransport.mjs';
import { runPersistentABC } from '../../packages/agents-intelligence/src/persistentAbcRunner.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const workspace = arg('--workspace');
const checkpoint = arg(
  '--checkpoint',
  'experiments/agents/checkpoints/agents001-pilot.jsonl'
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

const prepared = prepareABC(createBenchmarkRegistry());
console.log(`manifest: ${prepared.manifestHash}`);
console.log(`plan: 3 conditions x 3 scenarios x ${repeats} repeat(s)`);
console.log(`checkpoint: ${checkpoint}`);

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
  repeats,
  model,
  reasoningEffort,
  maxDecisions
});

const passed = result.trials.filter(entry => entry.success).length;
console.log(`new trials: ${result.newTrials}, passed: ${passed}`);
console.log(`checkpoint: ${result.checkpointPath}`);
