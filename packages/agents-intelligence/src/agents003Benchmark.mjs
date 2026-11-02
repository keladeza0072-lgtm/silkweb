// AGENTS-003 benchmark (Stage 1): deterministic execution of approved
// procedures with controlled model fallback, compared against the
// preserved AGENTS-002 model baseline.
//
// Versioning is separate from AGENTS-002: this protocol, manifest
// schema, and executor carry their own versions below. The AGENTS-002
// library, scenarios, evaluator, manifest, and protocol are reused
// read-only and never modified here.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { selectProcedure } from './index.mjs';
import {
  AGENTS002_LIBRARY,
  AGENTS002_LIBRARY_VERSION,
  createAgents002Trust
} from './agents002Library.mjs';
import { AGENTS002_EVALUATOR_NAME, evaluateAgents002BenchmarkOutcome, runAgents002Benchmark } from './agents002Benchmark.mjs';
import { AGENTS002_EVALUATOR_VERSION } from './agents002Evaluator.mjs';
import {
  AGENTS002_SCENARIO_IDS,
  AGENTS002_SCENARIOS
} from './agents002Scenarios.mjs';
import {
  AGENTS003_EXECUTOR_VERSION,
  runDeterministicExecution,
  runWithControlledFallback
} from './agents003Executor.mjs';
import { runMuseBenchmark } from './museBenchmark.mjs';

export const AGENTS003_PROTOCOL_ID = 'AGENTS-003';
export const AGENTS003_MANIFEST_SCHEMA_VERSION = '1.0.0';
export const AGENTS003_CONDITIONS = Object.freeze(['deterministic', 'fallback']);

const ZERO_USAGE = Object.freeze({
  calls: 0,
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0
});

function hash(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function queryForScenario(scenario) {
  return { task: scenario.task, toolVersion: scenario.toolVersion };
}

function publicSelection(record) {
  return {
    id: record.id,
    version: record.version,
    task: record.task,
    toolVersion: record.toolVersion,
    steps: structuredClone(record.steps),
    constraints: structuredClone(record.constraints)
  };
}

export function prepareAgents003Benchmark({
  library = AGENTS002_LIBRARY,
  trust = createAgents002Trust(),
  scenarios = AGENTS002_SCENARIOS
} = {}) {
  if (!Array.isArray(library) || library.length === 0) {
    throw new Error('A nonempty procedure library is required');
  }

  const frozenLibrary = structuredClone(library);

  // Every frozen scenario must resolve to exactly one approved,
  // version-compatible procedure before any trial runs.
  for (const scenarioId of AGENTS002_SCENARIO_IDS) {
    const scenario = scenarios?.[scenarioId];

    if (!scenario) {
      throw new Error(`Missing AGENTS-003 scenario: ${scenarioId}`);
    }

    const selection = selectProcedure(
      frozenLibrary,
      queryForScenario(scenario),
      trust
    );

    if (selection.status !== 'SELECTED' || !selection.selected) {
      throw new Error(
        `AGENTS-003 deterministic guidance unavailable for ${scenarioId}: ${selection.status}`
      );
    }
  }

  const manifest = {
    protocol: AGENTS003_PROTOCOL_ID,
    schemaVersion: AGENTS003_MANIFEST_SCHEMA_VERSION,
    libraryVersion: AGENTS002_LIBRARY_VERSION,
    executorVersion: AGENTS003_EXECUTOR_VERSION,
    scenarios: [...AGENTS002_SCENARIO_IDS],
    conditions: [...AGENTS003_CONDITIONS],
    evaluator: AGENTS002_EVALUATOR_NAME,
    evaluatorVersion: AGENTS002_EVALUATOR_VERSION,
    inferenceAuthorized: false
  };

  return {
    manifest: structuredClone(manifest),
    manifestHash: hash(manifest),

    // Runs one scenario deterministically: no transport, no inference.
    executeDeterministic(scenarioId) {
      const scenario = scenarios?.[scenarioId];

      if (!scenario || !AGENTS002_SCENARIO_IDS.includes(scenarioId)) {
        throw new Error(`Unknown scenario: ${scenarioId}`);
      }

      return runDeterministicExecution({
        library: frozenLibrary,
        trust,
        task: scenario.task,
        toolVersion: scenario.toolVersion,
        scenario
      });
    },

    // Guidance understood by the persistent trial runner below. The
    // mode travels inside guidance because the shared checkpoint runner
    // passes no condition to its benchmark callback: 'deterministic'
    // never calls the transport, 'fallback' authorizes a model attempt
    // only when deterministic execution did not pass.
    guidanceFor(condition, scenarioId) {
      if (!AGENTS003_CONDITIONS.includes(condition)) {
        throw new Error(`Unknown condition: ${condition}`);
      }

      const scenario = scenarios?.[scenarioId];

      if (!scenario || !AGENTS002_SCENARIO_IDS.includes(scenarioId)) {
        throw new Error(`Unknown scenario: ${scenarioId}`);
      }

      const selection = selectProcedure(
        frozenLibrary,
        queryForScenario(scenario),
        trust
      );

      if (selection.status !== 'SELECTED') {
        throw new Error(`SilkWeb guidance rejected: ${selection.status}`);
      }

      return { mode: condition, procedure: publicSelection(selection.selected) };
    },

    // Trial callback shaped for runPersistentABC's runBenchmark
    // override: ({ scenarioId, guidance, transport, maxDecisions,
    // scenarios, evaluateOutcome }).
    async runTrial({
      scenarioId,
      guidance = null,
      transport,
      maxDecisions = 12,
      scenarios: trialScenarios = null,
      evaluateOutcome = null
    }) {
      const start = performance.now();
      const registry = trialScenarios ?? scenarios;
      const scenario = registry?.[scenarioId];

      if (!scenario || !AGENTS002_SCENARIO_IDS.includes(scenarioId)) {
        throw new Error(`Unknown scenario: ${scenarioId}`);
      }

      if (!guidance || !AGENTS003_CONDITIONS.includes(guidance.mode)) {
        throw new Error('AGENTS-003 trial guidance with a valid mode is required');
      }

      const deterministic = runDeterministicExecution({
        library: frozenLibrary,
        trust,
        task: scenario.task,
        toolVersion: scenario.toolVersion,
        scenario
      });

      const outcomeShape = result => ({
        scenarioId,
        toolVersion: scenario.toolVersion,
        actionCount: result.execution?.trace?.length ?? 0,
        history: structuredClone(result.execution?.trace ?? []),
        snapshot: structuredClone(result.snapshot),
        evaluation: structuredClone(result.evaluation)
      });

      if (deterministic.evaluation?.passed === true || guidance.mode === 'deterministic') {
        return {
          schemaVersion: '1.0.0',
          scenarioId,
          totalElapsedMs: performance.now() - start,
          modelCalls: [],
          usageTotals: { ...ZERO_USAGE },
          result: {
            schemaVersion: '1.0.0',
            scenarioId,
            finishReason: deterministic.evaluation?.passed === true
              ? 'DETERMINISTIC_COMPLETED'
              : 'DETERMINISTIC_FAILED',
            decisionCount: deterministic.execution?.trace?.length ?? 0,
            history: structuredClone(deterministic.execution?.trace ?? []),
            outcome: outcomeShape(deterministic),
            fallbackUsed: false,
            fallbackReason: deterministic.fallbackReason
          }
        };
      }

      // Fallback condition with genuine deterministic insufficiency:
      // the model acts, the independent evaluator scores. Model output
      // is never trusted for approval or compatibility.
      if (typeof transport !== 'function') {
        throw new Error('A transport function is required for fallback');
      }

      const benchmark = await runMuseBenchmark({
        scenarioId,
        guidance: guidance.procedure,
        transport,
        maxDecisions,
        scenarios: registry,
        evaluateOutcome: evaluateOutcome ?? evaluateAgents002BenchmarkOutcome
      });

      return {
        ...benchmark,
        result: {
          ...benchmark.result,
          fallbackUsed: true,
          fallbackReason: deterministic.fallbackReason,
          deterministicOutcome: outcomeShape(deterministic)
        }
      };
    }
  };
}

// Side-by-side summary of AGENTS-003 deterministic trials against the
// preserved AGENTS-002 mock baseline. Counts only; no averaging hides
// individual outcomes.
export function summarizeAgents003Comparison({
  deterministicResults,
  baselineResults
}) {
  if (!Array.isArray(deterministicResults) || !Array.isArray(baselineResults)) {
    throw new TypeError('Result arrays are required');
  }

  const byScenario = {};

  for (const entry of deterministicResults) {
    byScenario[entry.scenarioId] = {
      scenarioId: entry.scenarioId,
      deterministicPass: entry.evaluation?.passed === true,
      deterministicModelCalls: entry.modelCalls ?? 0
    };
  }

  // Baseline condition C entries carry { condition, scenarioId, result }.
  const baselineC = baselineResults.filter(entry => entry.condition === 'C');

  for (const entry of baselineC) {
    const row = byScenario[entry.scenarioId] ?? { scenarioId: entry.scenarioId };

    row.baselinePass = entry.result?.outcome?.evaluation?.passed === true;
    byScenario[entry.scenarioId] = row;
  }

  const rows = Object.values(byScenario);
  const deterministicPass = rows.filter(row => row.deterministicPass).length;
  const baselinePass = rows.filter(row => row.baselinePass).length;

  return {
    protocol: AGENTS003_PROTOCOL_ID,
    baselineProtocol: 'AGENTS-002',
    scenarios: rows.length,
    deterministicPass,
    baselinePass,
    parity: rows.length > 0 && deterministicPass === rows.length,
    rows
  };
}

// Preserved AGENTS-002 baseline: the frozen benchmark run with the
// deterministic mock transport. Used only for comparison; the AGENTS-002
// implementation is exercised, never altered.
export async function runAgents002MockBaseline({ transportFactory }) {
  const { prepareAgents002Benchmark } = await import('./agents002Benchmark.mjs');
  const prepared = prepareAgents002Benchmark();

  return runAgents002Benchmark({ prepared, transportFactory });
}

export { runWithControlledFallback };
