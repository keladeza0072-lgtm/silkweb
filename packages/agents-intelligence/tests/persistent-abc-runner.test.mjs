import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareABC } from '../src/abcBenchmark.mjs';
import { createBenchmarkRegistry } from '../src/benchmarkRegistry.mjs';
import {
  createMockTransportFactory
} from '../src/mockMuseTransport.mjs';
import {
  auditConditionEquivalence,
  readCheckpointFile,
  runPersistentABC,
  trialKey
} from '../src/persistentAbcRunner.mjs';

function prepared() {
  return prepareABC(createBenchmarkRegistry());
}

const HERE = dirname(fileURLToPath(import.meta.url));
const scratchDirs = [];

after(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function checkpointDir() {
  const dir = mkdtempSync(join(HERE, '.tmp-abc-'));
  scratchDirs.push(dir);
  return dir;
}

function checkpointLines(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

test('persistent runner writes complete 3x3 trial coverage', async () => {
  const checkpoint = join(checkpointDir(), 'trials.jsonl');

  const result = await runPersistentABC({
    prepared: prepared(),
    transportFactory: createMockTransportFactory(),
    checkpointPath: checkpoint,
    model: 'mock',
    reasoningEffort: 'none'
  });

  assert.equal(result.newTrials, 9);
  assert.equal(result.completedTrials, 9);

  const pairs = new Set(
    result.trials.map(entry => `${entry.scenarioId}:${entry.condition}`)
  );
  assert.equal(pairs.size, 9);

  for (const entry of result.trials) {
    assert.equal(entry.protocol, 'AGENTS-001');
    assert.equal(entry.manifestHash, result.manifestHash);
    assert.equal(entry.repeat, 0);
    assert.equal(entry.model, 'mock');
    assert.equal(entry.reasoningEffort, 'none');
    assert.equal(entry.success, true);
    assert.equal(entry.checks.orderResolved, true);
    assert.equal(typeof entry.elapsedMs, 'number');
    assert.ok(entry.inputTokens > 0);
    assert.ok(entry.outputTokens >= 0);
    assert.equal(entry.billedCost, null);
    assert.equal(entry.costAvailable, false);
    assert.equal(entry.failureReason, null);
    assert.ok(entry.trace?.snapshot);
  }
});

test('checkpoint file persists every completed trial immediately', async () => {
  const checkpoint = join(checkpointDir(), 'trials.jsonl');

  await runPersistentABC({
    prepared: prepared(),
    transportFactory: createMockTransportFactory(),
    checkpointPath: checkpoint
  });

  const lines = checkpointLines(checkpoint);
  assert.equal(lines.length, 9);

  const { trials, keys } = readCheckpointFile(checkpoint);
  assert.equal(trials.length, 9);
  assert.equal(keys.size, 9);
  assert.ok(keys.has(trialKey({
    condition: 'C',
    scenarioId: 'transientRecovery',
    repeat: 0
  })));
});

test('interrupted run resumes without duplicating completed trials', async () => {
  const checkpoint = join(checkpointDir(), 'trials.jsonl');
  const registry = prepared();

  // First run is "killed" after the routine scenario: only its three
  // trials reach the checkpoint.
  await runPersistentABC({
    prepared: registry,
    transportFactory: createMockTransportFactory(),
    checkpointPath: checkpoint,
    scenarioIds: ['routine']
  });

  assert.equal(checkpointLines(checkpoint).length, 3);

  const resumed = await runPersistentABC({
    prepared: registry,
    transportFactory: createMockTransportFactory(),
    checkpointPath: checkpoint
  });

  assert.equal(resumed.newTrials, 6);
  assert.equal(resumed.completedTrials, 9);
  assert.equal(checkpointLines(checkpoint).length, 9);

  const keys = checkpointLines(checkpoint).map(entry =>
    trialKey({
      condition: entry.condition,
      scenarioId: entry.scenarioId,
      repeat: entry.repeat
    })
  );
  assert.equal(new Set(keys).size, 9);
});

test('completed run resumes with zero new trials', async () => {
  const checkpoint = join(checkpointDir(), 'trials.jsonl');
  const registry = prepared();

  await runPersistentABC({
    prepared: registry,
    transportFactory: createMockTransportFactory(),
    checkpointPath: checkpoint
  });

  const resumed = await runPersistentABC({
    prepared: registry,
    transportFactory: createMockTransportFactory(),
    checkpointPath: checkpoint
  });

  assert.equal(resumed.newTrials, 0);
  assert.equal(checkpointLines(checkpoint).length, 9);
});

test('failing trials are recorded with a reason and do not stop the run', async () => {
  const checkpoint = join(checkpointDir(), 'trials.jsonl');

  const factory = async input => {
    if (input.condition === 'B') {
      return async () => {
        throw new Error('Simulated agent outage');
      };
    }

    return createMockTransportFactory()(input);
  };

  const result = await runPersistentABC({
    prepared: prepared(),
    transportFactory: factory,
    checkpointPath: checkpoint
  });

  assert.equal(result.newTrials, 9);

  const failures = result.trials.filter(entry => entry.condition === 'B');
  assert.equal(failures.length, 3);

  for (const entry of failures) {
    assert.equal(entry.success, false);
    assert.match(entry.failureReason, /Simulated agent outage/);
    assert.equal(entry.billedCost, null);
  }

  const passes = result.trials.filter(entry => entry.condition !== 'B');
  assert.ok(passes.every(entry => entry.success));
});

test('checkpoint from another registry is rejected', async () => {
  const checkpoint = join(checkpointDir(), 'trials.jsonl');

  writeFileSync(
    checkpoint,
    `${JSON.stringify({
      protocol: 'AGENTS-001',
      manifestHash: 'different-registry',
      condition: 'A',
      scenarioId: 'routine',
      repeat: 0
    })}\n`,
    'utf8'
  );

  await assert.rejects(
    runPersistentABC({
      prepared: prepared(),
      transportFactory: createMockTransportFactory(),
      checkpointPath: checkpoint
    }),
    /manifest mismatch/
  );

  assert.equal(checkpointLines(checkpoint).length, 1);
});

test('corrupt checkpoint lines fail closed', async () => {
  const checkpoint = join(checkpointDir(), 'trials.jsonl');

  writeFileSync(checkpoint, '{"condition": broken\n', 'utf8');

  await assert.rejects(
    runPersistentABC({
      prepared: prepared(),
      transportFactory: createMockTransportFactory(),
      checkpointPath: checkpoint
    }),
    /Corrupt checkpoint/
  );
});

test('B and C serve the same underlying procedural knowledge', () => {
  const audit = auditConditionEquivalence(prepared());

  assert.equal(audit.equivalent, true);
  assert.equal(audit.findings.length, 3);
});

test('audit fails when C content differs from the B library', () => {
  const steps = [{ op: 'readOrder', args: { id: 'ORD-001' } }];

  const tampered = {
    manifest: { scenarios: ['routine'] },
    guidanceFor(condition) {
      if (condition === 'B') {
        return {
          documentationType: 'FULL_LIBRARY',
          procedures: [{
            id: 'p',
            version: '1.0.0',
            steps,
            constraints: ['original']
          }]
        };
      }

      return {
        id: 'p',
        version: '1.0.0',
        steps,
        constraints: ['rewritten for C only']
      };
    }
  };

  const audit = auditConditionEquivalence(tampered);

  assert.equal(audit.equivalent, false);
  assert.ok(audit.findings.some(entry => entry.includes('differs')));
});
