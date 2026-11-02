import { createHash } from 'node:crypto';

import { createEvidenceBoundHost } from './evidenceTrust.mjs';
import { runMuseBenchmark } from './museBenchmark.mjs';
import { BENCHMARK_SCENARIOS } from './benchmarkRunner.mjs';

export const CONDITIONS = Object.freeze(['A', 'B', 'C']);

export const SCENARIO_IDS = Object.freeze([
  'routine',
  'changedContract',
  'transientRecovery'
]);

function publicProcedure(record) {
  return {
    id: record.id,
    version: record.version,
    task: record.task,
    toolVersion: record.toolVersion,
    steps: structuredClone(record.steps),
    constraints: structuredClone(record.constraints)
  };
}

function hash(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

export function prepareABC({ procedures, evidenceRecords, approvals }) {
  if (
    !Array.isArray(procedures) ||
    !Array.isArray(evidenceRecords) ||
    !Array.isArray(approvals) ||
    procedures.length === 0
  ) {
    throw new Error('A nonempty evidence-backed registry bundle is required');
  }

  const frozenProcedures = structuredClone(procedures);
  const frozenEvidence = structuredClone(evidenceRecords);
  const frozenApprovals = structuredClone(approvals);

  const host = createEvidenceBoundHost({
    procedures: frozenProcedures,
    evidenceRecords: frozenEvidence,
    approvals: frozenApprovals
  });

  const library = frozenProcedures.map(publicProcedure);

  // The same source library is used by B and C.
  // C must retrieve the applicable entry through the evidence-bound host.
  for (const scenarioId of SCENARIO_IDS) {
    const scenario = BENCHMARK_SCENARIOS[scenarioId];

    if (!scenario) {
      throw new Error(`Missing scenario: ${scenarioId}`);
    }

    const selection = host.requestGuidance({
      task: 'resolve-order',
      toolVersion: scenario.toolVersion
    });

    if (selection.status !== 'SELECTED' || !selection.guidance) {
      throw new Error(
        `Evidence-bound guidance unavailable for ${scenarioId}: ${selection.status}`
      );
    }

    const matching = library.filter(record =>
      record.id === selection.guidance.id &&
      record.version === selection.guidance.version
    );

    if (matching.length !== 1) {
      throw new Error(`B/C knowledge mismatch: ${scenarioId}`);
    }

    if (
      JSON.stringify(matching[0].steps) !==
        JSON.stringify(selection.guidance.steps) ||
      JSON.stringify(matching[0].constraints) !==
        JSON.stringify(selection.guidance.constraints)
    ) {
      throw new Error(`B/C procedure content mismatch: ${scenarioId}`);
    }
  }

  const manifest = {
    protocol: 'AGENTS-001',
    schemaVersion: '1.0.0',
    scenarios: [...SCENARIO_IDS],
    conditions: [...CONDITIONS],
    publicLibrary: library,
    evidenceIds: frozenEvidence.map(record => record.boundEvidenceId),
    evaluator: 'evaluateOrderOutcome',
    inferenceAuthorized: false
  };

  return {
    manifest: structuredClone(manifest),
    manifestHash: hash(manifest),

    guidanceFor(condition, scenarioId) {
      if (!CONDITIONS.includes(condition)) {
        throw new Error(`Unknown condition: ${condition}`);
      }

      const scenario = BENCHMARK_SCENARIOS[scenarioId];

      if (!scenario || !SCENARIO_IDS.includes(scenarioId)) {
        throw new Error(`Unknown scenario: ${scenarioId}`);
      }

      if (condition === 'A') {
        return null;
      }

      if (condition === 'B') {
        return {
          documentationType: 'FULL_LIBRARY',
          procedures: structuredClone(library)
        };
      }

      const selection = host.requestGuidance({
        task: 'resolve-order',
        toolVersion: scenario.toolVersion
      });

      if (selection.status !== 'SELECTED') {
        throw new Error(`SilkWeb guidance rejected: ${selection.status}`);
      }

      return structuredClone(selection.guidance);
    }
  };
}

export async function runABC({
  prepared,
  transportFactory,
  conditions = CONDITIONS,
  scenarioIds = SCENARIO_IDS,
  maxDecisions = 12
}) {
  if (!prepared || typeof prepared.guidanceFor !== 'function') {
    throw new TypeError('A prepared benchmark is required');
  }

  if (typeof transportFactory !== 'function') {
    throw new TypeError('A transport factory is required');
  }

  const results = [];

  for (const scenarioId of scenarioIds) {
    if (!SCENARIO_IDS.includes(scenarioId)) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }

    for (const condition of conditions) {
      if (!CONDITIONS.includes(condition)) {
        throw new Error(`Unknown condition: ${condition}`);
      }

      const guidance = prepared.guidanceFor(condition, scenarioId);

      const transport = await transportFactory({
        scenarioId,
        condition
      });

      const result = await runMuseBenchmark({
        scenarioId,
        guidance,
        transport,
        maxDecisions
      });

      results.push({
        condition,
        scenarioId,
        ...result
      });
    }
  }

  return {
    protocol: 'AGENTS-001',
    manifestHash: prepared.manifestHash,
    results
  };
}
