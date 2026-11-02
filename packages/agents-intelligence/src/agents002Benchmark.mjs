import { createHash } from 'node:crypto';

import { selectProcedure } from './index.mjs';
import {
  AGENTS002_LIBRARY,
  AGENTS002_LIBRARY_VERSION,
  createAgents002Trust
} from './agents002Library.mjs';
import {
  AGENTS002_SCENARIO_IDS,
  AGENTS002_SCENARIOS
} from './agents002Scenarios.mjs';
import {
  AGENTS002_EVALUATOR_VERSION,
  evaluateAgents002Outcome
} from './agents002Evaluator.mjs';
import { runMuseBenchmark } from './museBenchmark.mjs';

export const AGENTS002_CONDITIONS = Object.freeze(['A', 'B', 'C']);
export const AGENTS002_PROTOCOL_ID = 'AGENTS-002';
export const AGENTS002_EVALUATOR_NAME = 'evaluateAgents002Outcome';
export const AGENTS002_MANIFEST_SCHEMA_VERSION = '1.0.0';

// Condition A receives the task plus complete public contracts through
// the scenario registry (wired into the runner, never into guidance).
// Condition B receives the full library with approval/revocation
// metadata visible. Condition C receives the single selected, verified,
// approved procedure. There is no condition D implementation: any
// request for it fails closed.
function publicAgents002Procedure(record) {
  const view = {
    id: record.id,
    version: record.version,
    task: record.task,
    toolVersion: record.toolVersion,
    steps: structuredClone(record.steps),
    constraints: structuredClone(record.constraints),
    provenance: structuredClone(record.provenance),
    revoked: record.revoked,
    status: record.status ?? null,
    approval: record.revoked === true
      ? { status: 'revoked', testsPassed: false }
      : { status: 'approved', testsPassed: true }
  };

  if (record.applicability !== undefined) {
    view.applicability = record.applicability;
  }

  if (record.supersededBy !== undefined) {
    view.supersededBy = record.supersededBy;
  }

  return view;
}

function hash(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function queryForScenario(scenario) {
  return { task: scenario.task, toolVersion: scenario.toolVersion };
}

export function prepareAgents002Benchmark({
  library = AGENTS002_LIBRARY,
  trust = createAgents002Trust(),
  scenarios = AGENTS002_SCENARIOS
} = {}) {
  if (!Array.isArray(library) || library.length === 0) {
    throw new Error('A nonempty AGENTS-002 procedure library is required');
  }

  const frozenLibrary = structuredClone(library);
  const libraryView = frozenLibrary.map(publicAgents002Procedure);

  // Every frozen scenario must resolve to exactly one approved,
  // version-compatible procedure, and that selection must deep-equal
  // the matching B library entry: B and C share one knowledge source.
  for (const scenarioId of AGENTS002_SCENARIO_IDS) {
    const scenario = scenarios?.[scenarioId];

    if (!scenario) {
      throw new Error(`Missing AGENTS-002 scenario: ${scenarioId}`);
    }

    const selection = selectProcedure(
      frozenLibrary,
      queryForScenario(scenario),
      trust
    );

    if (selection.status !== 'SELECTED' || !selection.selected) {
      throw new Error(
        `AGENTS-002 guidance unavailable for ${scenarioId}: ${selection.status}`
      );
    }

    const matching = libraryView.filter(record =>
      record.id === selection.selected.id &&
      record.version === selection.selected.version
    );

    if (matching.length !== 1) {
      throw new Error(`B/C knowledge mismatch: ${scenarioId}`);
    }

    if (
      JSON.stringify(matching[0].steps) !==
        JSON.stringify(selection.selected.steps) ||
      JSON.stringify(matching[0].constraints) !==
        JSON.stringify(selection.selected.constraints)
    ) {
      throw new Error(`B/C procedure content mismatch: ${scenarioId}`);
    }
  }

  const manifest = {
    protocol: AGENTS002_PROTOCOL_ID,
    schemaVersion: AGENTS002_MANIFEST_SCHEMA_VERSION,
    libraryVersion: AGENTS002_LIBRARY_VERSION,
    scenarios: [...AGENTS002_SCENARIO_IDS],
    conditions: [...AGENTS002_CONDITIONS],
    publicLibrary: structuredClone(libraryView),
    evaluator: AGENTS002_EVALUATOR_NAME,
    evaluatorVersion: AGENTS002_EVALUATOR_VERSION,
    inferenceAuthorized: false
  };

  return {
    manifest: structuredClone(manifest),
    manifestHash: hash(manifest),

    guidanceFor(condition, scenarioId) {
      if (!AGENTS002_CONDITIONS.includes(condition)) {
        throw new Error(`Unknown condition: ${condition}`);
      }

      const scenario = scenarios?.[scenarioId];

      if (!scenario || !AGENTS002_SCENARIO_IDS.includes(scenarioId)) {
        throw new Error(`Unknown scenario: ${scenarioId}`);
      }

      // A: task + complete public contracts only. The runner supplies
      // the scenario facts and tool contracts; no facts are withheld.
      if (condition === 'A') {
        return null;
      }

      if (condition === 'B') {
        return {
          documentationType: 'FULL_LIBRARY',
          procedures: structuredClone(libraryView)
        };
      }

      const selection = selectProcedure(
        frozenLibrary,
        queryForScenario(scenario),
        trust
      );

      if (selection.status !== 'SELECTED') {
        throw new Error(`SilkWeb guidance rejected: ${selection.status}`);
      }

      const entry = libraryView.find(record =>
        record.id === selection.selected.id &&
        record.version === selection.selected.version
      );

      if (!entry) {
        throw new Error(`B/C knowledge mismatch: ${scenarioId}`);
      }

      return structuredClone(entry);
    }
  };
}

// Adapter so the shared runner scores AGENTS-002 trials with the
// independent seven-check evaluator.
export function evaluateAgents002BenchmarkOutcome(scenario, snapshot) {
  const outcome = evaluateAgents002Outcome({
    scenario,
    snapshot,
    claimedSuccess: null
  });

  return { passed: outcome.passed, checks: outcome.checks };
}

export async function runAgents002Benchmark({
  prepared,
  transportFactory,
  conditions = AGENTS002_CONDITIONS,
  scenarioIds = AGENTS002_SCENARIO_IDS,
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
    if (!AGENTS002_SCENARIO_IDS.includes(scenarioId)) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }

    for (const condition of conditions) {
      if (!AGENTS002_CONDITIONS.includes(condition)) {
        throw new Error(`Unknown condition: ${condition}`);
      }

      const guidance = prepared.guidanceFor(condition, scenarioId);
      const transport = await transportFactory({ scenarioId, condition });
      const result = await runMuseBenchmark({
        scenarioId,
        guidance,
        transport,
        maxDecisions,
        scenarios: AGENTS002_SCENARIOS,
        evaluateOutcome: evaluateAgents002BenchmarkOutcome
      });

      results.push({ condition, scenarioId, ...result });
    }
  }

  return {
    protocol: AGENTS002_PROTOCOL_ID,
    manifestHash: prepared.manifestHash,
    results
  };
}
