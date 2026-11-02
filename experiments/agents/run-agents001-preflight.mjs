// AGENTS-001 deterministic preflight: full 3x3 A/B/C matrix against the
// mock transport. This file never imports the paid Muse transport, so it
// cannot invoke paid inference. It also re-runs to prove resume safety.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareABC } from '../../packages/agents-intelligence/src/abcBenchmark.mjs';
import { createBenchmarkRegistry } from '../../packages/agents-intelligence/src/benchmarkRegistry.mjs';
import { createMockTransportFactory } from '../../packages/agents-intelligence/src/mockMuseTransport.mjs';
import {
  auditConditionEquivalence,
  readCheckpointFile,
  runPersistentABC
} from '../../packages/agents-intelligence/src/persistentAbcRunner.mjs';

const prepared = prepareABC(createBenchmarkRegistry());
const checkpoint = join(
  mkdtempSync(join(tmpdir(), 'agents001-preflight-')),
  'trials.jsonl'
);

const audit = auditConditionEquivalence(prepared);
console.log(`equivalence: ${audit.equivalent ? 'PASS' : 'FAIL'}`);
for (const finding of audit.findings) console.log(`  - ${finding}`);
if (!audit.equivalent) process.exit(1);

const first = await runPersistentABC({
  prepared,
  transportFactory: createMockTransportFactory(),
  checkpointPath: checkpoint,
  model: 'mock',
  reasoningEffort: 'none'
});
console.log(`first run: ${first.newTrials} new trials`);

const second = await runPersistentABC({
  prepared,
  transportFactory: createMockTransportFactory(),
  checkpointPath: checkpoint,
  model: 'mock',
  reasoningEffort: 'none'
});
console.log(`resume run: ${second.newTrials} new trials`);

const { trials } = readCheckpointFile(checkpoint);
const passed = trials.filter(entry => entry.success).length;
console.log(`trials: ${trials.length}, passed: ${passed}`);

if (first.newTrials !== 9 || second.newTrials !== 0 || passed !== 9) {
  console.error('PREFLIGHT FAIL');
  process.exit(1);
}

console.log('PREFLIGHT PASS: paid pilot command is cleared for use');
