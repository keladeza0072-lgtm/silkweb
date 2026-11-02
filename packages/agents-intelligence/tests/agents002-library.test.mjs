import test from 'node:test';
import assert from 'node:assert/strict';

import {
  digest,
  verifyProcedure,
  selectProcedure
} from '../src/index.mjs';
import { validateProcedureSteps } from '../src/procedureInterpreter.mjs';
import { createBenchmarkRegistry } from '../src/benchmarkRegistry.mjs';
import { BENCHMARK_SCENARIOS } from '../src/benchmarkRunner.mjs';
import {
  AGENTS002_LIBRARY,
  AGENTS002_SCENARIO_PROCEDURES,
  createAgents002Trust,
  getAgents002Procedure
} from '../src/agents002Library.mjs';
import { AGENTS002_SCENARIOS } from '../src/agents002Scenarios.mjs';

function queryFor(scenarioId) {
  const scenario = AGENTS002_SCENARIOS[scenarioId];

  return { task: scenario.task, toolVersion: scenario.toolVersion };
}

test('library holds forty procedures', () => {
  assert.equal(AGENTS002_LIBRARY.length, 40);
});

test('every record reuses the structured procedure conventions', () => {
  for (const record of AGENTS002_LIBRARY) {
    assert.ok(typeof record.id === 'string' && record.id.length > 0);
    assert.match(record.version, /^\d+\.\d+\.\d+$/);
    assert.ok(typeof record.task === 'string' && record.task.length > 0);
    assert.match(record.toolVersion, /^\d+\.\d+\.\d+$/);
    assert.ok(Array.isArray(record.constraints) && record.constraints.length > 0);
    assert.ok(Array.isArray(record.provenance) && record.provenance.length > 0);
    assert.equal(typeof record.revoked, 'boolean');

    const validation = validateProcedureSteps(record.steps);

    assert.equal(
      validation.valid,
      true,
      `${record.id}@${record.version}: ${validation.reason}`
    );
  }
});

test('procedure identities are unique', () => {
  const keys = AGENTS002_LIBRARY.map(
    record => `${record.id}@${record.version}`
  );

  assert.equal(new Set(keys).size, AGENTS002_LIBRARY.length);
});

test('approved procedures never compete for the same task and contract', () => {
  const approved = AGENTS002_LIBRARY.filter(record => !record.revoked);
  const keys = approved.map(
    record => `${record.task}@${record.toolVersion}`
  );

  assert.equal(new Set(keys).size, keys.length);
});

test('library covers current, deprecated, versioned, and conditional entries', () => {
  const revoked = AGENTS002_LIBRARY.filter(record => record.revoked);

  assert.ok(revoked.length >= 10, `revoked: ${revoked.length}`);
  assert.ok(revoked.every(record => record.status !== 'current'));

  const versions = new Set(AGENTS002_LIBRARY.map(record => record.toolVersion));

  assert.ok(versions.has('2.0.0'));
  assert.ok(versions.has('3.0.0'));

  const scenarioTasks = new Set(
    Object.values(AGENTS002_SCENARIOS).map(scenario => scenario.task)
  );
  const irrelevant = AGENTS002_LIBRARY.filter(
    record => !record.revoked && !scenarioTasks.has(record.task)
  );

  assert.ok(irrelevant.length >= 8, `irrelevant: ${irrelevant.length}`);

  const conditional = AGENTS002_LIBRARY.filter(
    record => typeof record.applicability === 'string'
  );

  assert.ok(conditional.length >= 6, `conditional: ${conditional.length}`);
});

test('deprecated records name a live successor', () => {
  for (const record of AGENTS002_LIBRARY.filter(r => r.revoked)) {
    assert.ok(record.supersededBy, `${record.id}@${record.version} names no successor`);

    const [id, version] = record.supersededBy.split('@');
    const successor = getAgents002Procedure(id, version);

    assert.equal(successor.revoked, false);
    assert.equal(successor.task, record.task);
  }
});

test('trust store binds every approved procedure digest', () => {
  const trust = createAgents002Trust();
  const approved = AGENTS002_LIBRARY.filter(record => !record.revoked);

  assert.equal(trust.approvals.length, approved.length);

  for (const record of approved) {
    const result = verifyProcedure(record, trust);

    assert.equal(
      result.reason,
      'APPROVED',
      `${record.id}@${record.version}: ${result.reason}`
    );
  }
});

for (const scenarioId of Object.keys(AGENTS002_SCENARIOS)) {
  test(`scenario ${scenarioId} discovers its correct procedure`, () => {
    const trust = createAgents002Trust();
    const selection = selectProcedure(
      AGENTS002_LIBRARY,
      queryFor(scenarioId),
      trust
    );

    assert.equal(selection.status, 'SELECTED');

    const expected = AGENTS002_SCENARIO_PROCEDURES[scenarioId];

    assert.equal(selection.selected.id, expected.id);
    assert.equal(selection.selected.version, expected.version);
    assert.equal(
      selection.selected.toolVersion,
      AGENTS002_SCENARIOS[scenarioId].toolVersion
    );
  });
}

test('correct applicability rejects the wrong tool contract', () => {
  const trust = createAgents002Trust();
  const scenario = AGENTS002_SCENARIOS.versionConflict;

  const selection = selectProcedure(
    AGENTS002_LIBRARY,
    { task: scenario.task, toolVersion: '2.0.0' },
    trust
  );

  assert.equal(selection.status, 'SELECTED');
  assert.notEqual(
    selection.selected.version,
    AGENTS002_SCENARIO_PROCEDURES.versionConflict.version
  );
});

test('incorrect applicability: unknown task has no match', () => {
  const trust = createAgents002Trust();
  const selection = selectProcedure(
    AGENTS002_LIBRARY,
    { task: 'refund-order-express', toolVersion: '2.0.0' },
    trust
  );

  assert.equal(selection.status, 'NO_MATCH');
});

test('incorrect applicability: revoked procedures are never approved', () => {
  const trust = createAgents002Trust();
  const revoked = AGENTS002_LIBRARY.filter(record => record.revoked);

  assert.ok(revoked.length > 0);

  for (const record of revoked) {
    assert.equal(verifyProcedure(record, trust).reason, 'REVOKED');
  }
});

test('incorrect applicability: tampered guidance fails the digest binding', () => {
  const trust = createAgents002Trust();
  const expected = AGENTS002_SCENARIO_PROCEDURES.versionConflict;
  const tampered = structuredClone(getAgents002Procedure(
    expected.id,
    expected.version
  ));

  tampered.steps.push({
    op: 'writeAudit',
    args: { id: 'ORD-001', note: 'Attacker-added confirmation' }
  });

  assert.equal(
    verifyProcedure(tampered, trust).reason,
    'EVIDENCE_MISMATCH'
  );
});

test('AGENTS-001 registry and scenarios remain unchanged', () => {
  const registry = createBenchmarkRegistry();

  assert.equal(registry.procedures.length, 2);
  assert.equal(registry.approvals.length, 2);
  assert.deepEqual(
    registry.procedures.map(record => record.toolVersion).sort(),
    ['2.0.0', '3.0.0']
  );
  assert.deepEqual(
    Object.keys(BENCHMARK_SCENARIOS).sort(),
    ['changedContract', 'routine', 'transientRecovery']
  );
});
