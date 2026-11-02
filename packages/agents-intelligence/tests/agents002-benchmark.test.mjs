import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareABC } from '../src/abcBenchmark.mjs';
import { createBenchmarkRegistry } from '../src/benchmarkRegistry.mjs';
import {
  AGENTS002_CONDITIONS,
  AGENTS002_EVALUATOR_NAME,
  AGENTS002_PROTOCOL_ID,
  evaluateAgents002BenchmarkOutcome,
  prepareAgents002Benchmark,
  runAgents002Benchmark
} from '../src/agents002Benchmark.mjs';
import { AGENTS002_LIBRARY } from '../src/agents002Library.mjs';
import { AGENTS002_SCENARIO_IDS } from '../src/agents002Scenarios.mjs';
import {
  AGENTS002_CHECK_NAMES,
  evaluateAgents002Outcome
} from '../src/agents002Evaluator.mjs';
import { createMockTransportFactory } from '../src/mockMuseTransport.mjs';
import { AGENTS002_SCENARIOS } from '../src/agents002Scenarios.mjs';
import {
  auditConditionEquivalence,
  readCheckpointFile,
  runPersistentABC,
  trialKey
} from '../src/persistentAbcRunner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const scratchDirs = [];

after(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function checkpointDir() {
  const dir = mkdtempSync(join(HERE, '.tmp-agents002-'));
  scratchDirs.push(dir);
  return dir;
}

function agents002Options(prepared, checkpoint) {
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

test('condition separation: A null, B full library, C single selection', () => {
  const prepared = prepareAgents002Benchmark();

  for (const scenarioId of AGENTS002_SCENARIO_IDS) {
    const a = prepared.guidanceFor('A', scenarioId);
    const b = prepared.guidanceFor('B', scenarioId);
    const c = prepared.guidanceFor('C', scenarioId);

    assert.equal(a, null);
    assert.equal(b.documentationType, 'FULL_LIBRARY');
    assert.equal(b.procedures.length, 40);
    assert.ok(c.id && c.version && c.steps && c.constraints);
    assert.ok(!Array.isArray(c.procedures));
  }
});

test('B exposes visible approval/revocation metadata', () => {
  const prepared = prepareAgents002Benchmark();
  const b = prepared.guidanceFor('B', AGENTS002_SCENARIO_IDS[0]);

  for (const record of b.procedures) {
    assert.equal(typeof record.revoked, 'boolean');
    assert.ok(record.approval && typeof record.approval.status === 'string');
  }

  assert.ok(b.procedures.some(record => record.revoked === true));
  assert.ok(b.procedures.some(record => record.revoked === false));
});

test('B/C knowledge equivalence: C equals its B library entry', () => {
  const prepared = prepareAgents002Benchmark();
  const audit = auditConditionEquivalence(prepared);

  assert.equal(audit.equivalent, true);

  for (const scenarioId of AGENTS002_SCENARIO_IDS) {
    const b = prepared.guidanceFor('B', scenarioId);
    const c = prepared.guidanceFor('C', scenarioId);
    const match = b.procedures.filter(
      record => record.id === c.id && record.version === c.version
    );

    assert.equal(match.length, 1);
    assert.deepEqual(match[0].steps, c.steps);
    assert.deepEqual(match[0].constraints, c.constraints);
  }
});

test('condition D is explicitly rejected', async () => {
  const prepared = prepareAgents002Benchmark();

  assert.throws(() => prepared.guidanceFor('D', 'versionConflict'), /Unknown condition/);
  assert.deepEqual(prepared.manifest.conditions, ['A', 'B', 'C']);

  await assert.rejects(
    runAgents002Benchmark({
      prepared,
      conditions: ['D'],
      transportFactory: async () => async () => ({ decision: { type: 'finish' } })
    }),
    /Unknown condition/
  );
});

test('evaluator integration: mock trials pass all seven checks', async () => {
  const prepared = prepareAgents002Benchmark();
  const result = await runAgents002Benchmark({
    prepared,
    transportFactory: createMockTransportFactory({ scenarios: AGENTS002_SCENARIOS })
  });

  assert.equal(result.results.length, 9);
  assert.equal(result.protocol, 'AGENTS-002');

  for (const entry of result.results) {
    const evaluation = entry.result.outcome.evaluation;

    assert.equal(evaluation.passed, true);
    assert.deepEqual(Object.keys(evaluation.checks).sort(), [...AGENTS002_CHECK_NAMES].sort());
  }
});

test('A retains task facts: prompt carries task and public contract', async () => {
  const prepared = prepareAgents002Benchmark();
  let captured = null;
  const guidance = prepared.guidanceFor('A', 'versionConflict');

  assert.equal(guidance, null);

  const { runMuseBenchmark } = await import('../src/museBenchmark.mjs');

  await runMuseBenchmark({
    scenarioId: 'versionConflict',
    guidance,
    transport: async input => {
      captured = input.messages;
      return { decision: { type: 'finish' }, elapsedMs: 1, usage: [] };
    },
    scenarios: AGENTS002_SCENARIOS,
    evaluateOutcome: evaluateAgents002BenchmarkOutcome
  });

  const prompt = JSON.parse(captured[1].content);

  assert.ok(prompt.task);
  assert.ok(prompt.facts);
  assert.deepEqual(prompt.tools.resolveOrder.required, ['id', 'resolutionCode']);
});

test('deterministic manifest: repeated preparation is identical', () => {
  const first = prepareAgents002Benchmark();
  const second = prepareAgents002Benchmark();

  assert.equal(first.manifestHash, second.manifestHash);
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(first.manifest.protocol, 'AGENTS-002');
  assert.deepEqual(first.manifest.scenarios, [...AGENTS002_SCENARIO_IDS]);
  assert.equal(first.manifest.evaluator, 'evaluateAgents002Outcome');
  assert.equal(first.manifest.inferenceAuthorized, false);
});

test('checkpoint resume safety: partial run resumes without duplication', async () => {
  const checkpoint = join(checkpointDir(), 'trials.jsonl');
  const prepared = prepareAgents002Benchmark();

  await runPersistentABC({
    ...agents002Options(prepared, checkpoint),
    scenarioIds: ['versionConflict']
  });

  const lines = readFileSync(checkpoint, 'utf8').split('\n').filter(l => l.trim());

  assert.equal(lines.length, 3);

  const resumed = await runPersistentABC(agents002Options(prepared, checkpoint));

  assert.equal(resumed.newTrials, 6);
  assert.equal(resumed.completedTrials, 9);
  assert.equal(resumed.protocol, 'AGENTS-002');

  const reread = await runPersistentABC(agents002Options(prepared, checkpoint));

  assert.equal(reread.newTrials, 0);
});

test('checkpoint records carry the AGENTS-002 protocol and evaluator', async () => {
  const checkpoint = join(checkpointDir(), 'trials.jsonl');

  await runPersistentABC(
    agents002Options(prepareAgents002Benchmark(), checkpoint)
  );

  const { trials } = readCheckpointFile(checkpoint);

  assert.equal(trials.length, 9);
  assert.ok(trials.every(entry => entry.protocol === 'AGENTS-002'));
  assert.ok(trials.every(entry => entry.evaluator === 'evaluateAgents002Outcome'));
  assert.ok(trials.every(entry => entry.success === true));
  assert.ok(
    trials.every(entry =>
      entry.checks && typeof entry.checks.finalStateCorrect === 'boolean'
    )
  );
  assert.ok(
    readCheckpointFile(checkpoint).keys.has(
      trialKey({ condition: 'C', scenarioId: 'constrainedRecovery', repeat: 0 })
    )
  );
});

test('foreign checkpoint is rejected, corrupt lines fail closed', async () => {
  const prepared = prepareAgents002Benchmark();

  const foreign = join(checkpointDir(), 'foreign.jsonl');

  writeFileSync(
    foreign,
    `${JSON.stringify({ protocol: 'AGENTS-001', manifestHash: prepared.manifestHash, condition: 'A', scenarioId: 'versionConflict', repeat: 0 })}\n`,
    'utf8'
  );

  await assert.rejects(
    runPersistentABC(agents002Options(prepared, foreign)),
    /manifest mismatch/
  );

  const corrupt = join(checkpointDir(), 'corrupt.jsonl');

  writeFileSync(corrupt, '{"condition": broken\n', 'utf8');

  await assert.rejects(
    runPersistentABC(agents002Options(prepared, corrupt)),
    /Corrupt checkpoint/
  );
});

test('AGENTS-001 backward compatibility: defaults unchanged', async () => {
  const checkpoint = join(checkpointDir(), 'trials.jsonl');
  const prepared = prepareABC(createBenchmarkRegistry());

  const result = await runPersistentABC({
    prepared,
    transportFactory: createMockTransportFactory(),
    checkpointPath: checkpoint,
    model: 'mock',
    reasoningEffort: 'none'
  });

  assert.equal(result.protocol, 'AGENTS-001');
  assert.equal(result.newTrials, 9);
  assert.ok(result.trials.every(entry => entry.protocol === 'AGENTS-001'));
  assert.ok(result.trials.every(entry => entry.success === true));
  assert.ok(
    AGENTS002_LIBRARY.length === 40 &&
    AGENTS002_SCENARIO_IDS.length === 3 &&
    evaluateAgents002Outcome !== undefined
  );
});
