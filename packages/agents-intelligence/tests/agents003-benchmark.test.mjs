import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENTS003_CONDITIONS,
  AGENTS003_MANIFEST_SCHEMA_VERSION,
  AGENTS003_PROTOCOL_ID,
  prepareAgents003Benchmark,
  runAgents002MockBaseline,
  summarizeAgents003Comparison
} from '../src/agents003Benchmark.mjs';
import {
  AGENTS002_CONDITIONS,
  AGENTS002_EVALUATOR_NAME,
  AGENTS002_PROTOCOL_ID,
  evaluateAgents002BenchmarkOutcome,
  prepareAgents002Benchmark,
  runAgents002Benchmark
} from '../src/agents002Benchmark.mjs';
import {
  AGENTS002_LIBRARY,
  AGENTS002_SCENARIO_PROCEDURES
} from '../src/agents002Library.mjs';
import { AGENTS002_SCENARIO_IDS, AGENTS002_SCENARIOS } from '../src/agents002Scenarios.mjs';
import { createMockTransportFactory } from '../src/mockMuseTransport.mjs';
import {
  auditConditionEquivalence,
  readCheckpointFile,
  runPersistentABC
} from '../src/persistentAbcRunner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const scratchDirs = [];

after(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function checkpointDir() {
  const dir = mkdtempSync(join(HERE, '.tmp-agents003-'));
  scratchDirs.push(dir);
  return dir;
}

function agents003Options(prepared, checkpoint) {
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

test('AGENTS-003 manifest is separately versioned', () => {
  const prepared = prepareAgents003Benchmark();

  assert.equal(prepared.manifest.protocol, 'AGENTS-003');
  assert.equal(prepared.manifest.schemaVersion, AGENTS003_MANIFEST_SCHEMA_VERSION);
  assert.equal(prepared.manifest.executorVersion, '1.0.0');
  assert.equal(prepared.manifest.evaluator, 'evaluateAgents002Outcome');
  assert.equal(prepared.manifest.inferenceAuthorized, false);
  assert.deepEqual(prepared.manifest.conditions, ['deterministic', 'fallback']);
  assert.deepEqual(prepared.manifest.scenarios, [...AGENTS002_SCENARIO_IDS]);
});

test('AGENTS-003 preparation is deterministic', () => {
  const first = prepareAgents003Benchmark();
  const second = prepareAgents003Benchmark();

  assert.equal(first.manifestHash, second.manifestHash);
  assert.deepEqual(first.manifest, second.manifest);
});

test('deterministic condition never invokes the transport', async () => {
  const prepared = prepareAgents003Benchmark();

  for (const scenarioId of AGENTS002_SCENARIO_IDS) {
    const guidance = prepared.guidanceFor('deterministic', scenarioId);
    const result = await prepared.runTrial({
      scenarioId,
      guidance,
      transport: () => {
        throw new Error('Transport must not be called');
      },
      scenarios: AGENTS002_SCENARIOS,
      evaluateOutcome: evaluateAgents002BenchmarkOutcome
    });

    assert.equal(result.result.outcome.evaluation.passed, true);
    assert.deepEqual(result.modelCalls, []);
    assert.equal(result.result.fallbackUsed, false);
  }
});

test('fallback condition passes deterministically without model calls', async () => {
  const prepared = prepareAgents003Benchmark();

  for (const scenarioId of AGENTS002_SCENARIO_IDS) {
    const guidance = prepared.guidanceFor('fallback', scenarioId);
    const result = await prepared.runTrial({
      scenarioId,
      guidance,
      transport: () => {
        throw new Error('Transport must not be called');
      },
      scenarios: AGENTS002_SCENARIOS,
      evaluateOutcome: evaluateAgents002BenchmarkOutcome
    });

    assert.equal(result.result.outcome.evaluation.passed, true);
    assert.deepEqual(result.modelCalls, []);
  }
});

test('unknown conditions and scenarios are rejected', async () => {
  const prepared = prepareAgents003Benchmark();

  assert.throws(() => prepared.guidanceFor('C', 'versionConflict'), /Unknown condition/);
  assert.throws(() => prepared.guidanceFor('deterministic', 'routine'), /Unknown scenario/);
  assert.throws(() => prepared.executeDeterministic('routine'), /Unknown scenario/);

  await assert.rejects(
    prepared.runTrial({ scenarioId: 'versionConflict', guidance: null }),
    /valid mode/
  );
});

test('checkpoint resume safety for the AGENTS-003 matrix', async () => {
  const checkpoint = join(checkpointDir(), 'trials.jsonl');
  const prepared = prepareAgents003Benchmark();

  await runPersistentABC({
    ...agents003Options(prepared, checkpoint),
    scenarioIds: ['versionConflict']
  });

  const partial = readCheckpointFile(checkpoint);

  assert.equal(partial.trials.length, 2);

  const resumed = await runPersistentABC(agents003Options(prepared, checkpoint));

  assert.equal(resumed.newTrials, 4);
  assert.equal(resumed.completedTrials, 6);

  const reread = await runPersistentABC(agents003Options(prepared, checkpoint));

  assert.equal(reread.newTrials, 0);
  assert.ok(
    readCheckpointFile(checkpoint).trials.every(entry => entry.protocol === 'AGENTS-003')
  );
  assert.ok(
    readCheckpointFile(checkpoint).trials.every(entry => entry.success === true)
  );
});

test('frozen AGENTS-002 baseline is untouched', () => {
  const prepared = prepareAgents002Benchmark();

  assert.equal(prepared.manifest.protocol, AGENTS002_PROTOCOL_ID);
  assert.equal(prepared.manifest.schemaVersion, '1.0.0');
  assert.equal(prepared.manifest.libraryVersion, '1.0.0');
  assert.deepEqual(prepared.manifest.conditions, [...AGENTS002_CONDITIONS]);
  assert.deepEqual(prepared.manifest.scenarios, [...AGENTS002_SCENARIO_IDS]);
  assert.equal(prepared.manifest.evaluator, AGENTS002_EVALUATOR_NAME);
  assert.equal(prepared.manifest.inferenceAuthorized, false);
  assert.equal(AGENTS002_LIBRARY.length, 40);

  for (const scenarioId of AGENTS002_SCENARIO_IDS) {
    const selection = prepared.guidanceFor('C', scenarioId);
    const expected = AGENTS002_SCENARIO_PROCEDURES[scenarioId];

    assert.equal(selection.id, expected.id);
    assert.equal(selection.version, expected.version);
  }

  assert.equal(auditConditionEquivalence(prepared).equivalent, true);
});

test('deterministic trials match the preserved AGENTS-002 mock baseline', async () => {
  const prepared = prepareAgents003Benchmark();
  const deterministicResults = AGENTS002_SCENARIO_IDS.map(scenarioId => ({
    scenarioId,
    ...prepared.executeDeterministic(scenarioId)
  }));

  const baseline = await runAgents002MockBaseline({
    transportFactory: createMockTransportFactory({ scenarios: AGENTS002_SCENARIOS })
  });

  assert.equal(baseline.results.length, 9);
  assert.ok(baseline.results.every(entry => entry.result.outcome.evaluation.passed));

  const comparison = summarizeAgents003Comparison({
    deterministicResults,
    baselineResults: baseline.results
  });

  assert.equal(comparison.protocol, 'AGENTS-003');
  assert.equal(comparison.baselineProtocol, 'AGENTS-002');
  assert.equal(comparison.deterministicPass, 3);
  assert.equal(comparison.baselinePass, 3);
  assert.equal(comparison.parity, true);
  assert.ok(
    comparison.rows.every(row => row.deterministicModelCalls === 0)
  );
});

test('AGENTS-002 runner entry point still passes its mock matrix', async () => {
  const result = await runAgents002Benchmark({
    prepared: prepareAgents002Benchmark(),
    transportFactory: createMockTransportFactory({ scenarios: AGENTS002_SCENARIOS })
  });

  assert.equal(result.protocol, 'AGENTS-002');
  assert.equal(result.results.length, 9);
  assert.ok(result.results.every(entry => entry.result.outcome.evaluation.passed));
});
