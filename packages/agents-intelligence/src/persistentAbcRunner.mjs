import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync
} from 'node:fs';
import { dirname } from 'node:path';

import {
  CONDITIONS,
  SCENARIO_IDS
} from './abcBenchmark.mjs';
import { runMuseBenchmark } from './museBenchmark.mjs';

export const CHECKPOINT_SCHEMA_VERSION = '1.0.0';
export const PROTOCOL_ID = 'AGENTS-001';

export const DEFAULT_PROTOCOL = PROTOCOL_ID;
export const DEFAULT_CONDITIONS = CONDITIONS;
export const DEFAULT_SCENARIO_IDS = SCENARIO_IDS;
export const DEFAULT_EVALUATOR_NAME = 'evaluateOrderOutcome';

export function trialKey({ condition, scenarioId, repeat }) {
  return `${condition}/${scenarioId}/${repeat}`;
}

// Reads an append-only JSONL checkpoint. Returns completed trials in file
// order plus the lookup set used for resume. Unknown lines are never
// silently skipped: a corrupt line fails closed so partial evidence is
// never mistaken for a clean slate.
export function readCheckpointFile(checkpointPath) {
  if (!checkpointPath) {
    throw new TypeError('A checkpoint path is required');
  }

  if (!existsSync(checkpointPath)) {
    return { trials: [], keys: new Set() };
  }

  const text = readFileSync(checkpointPath, 'utf8');
  const trials = [];
  const keys = new Set();

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;

    let record;

    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(
        `Corrupt checkpoint line in ${checkpointPath}`
      );
    }

    trials.push(record);
    keys.add(trialKey({
      condition: record.condition,
      scenarioId: record.scenarioId,
      repeat: record.repeat
    }));
  }

  return { trials, keys };
}

function digestManifest(manifest) {
  return createHash('sha256')
    .update(JSON.stringify(manifest))
    .digest('hex');
}

// Re-verifies that B and C are packaged from the same underlying facts:
// every C selection must deep-equal the matching B library entry, and the
// B library must be identical whichever scenario is being prepared. Any
// divergence fails the audit so it can never reach a scored comparison.
export function auditConditionEquivalence(prepared) {
  const findings = [];

  if (!prepared || typeof prepared.guidanceFor !== 'function') {
    return {
      equivalent: false,
      findings: ['Prepared benchmark with guidanceFor is required']
    };
  }

  const libraryFingerprints = new Set();

  for (const scenarioId of prepared.manifest?.scenarios ?? []) {
    let full;
    let selected;

    try {
      full = prepared.guidanceFor('B', scenarioId);
      selected = prepared.guidanceFor('C', scenarioId);
    } catch (error) {
      findings.push(`${scenarioId}: guidance unavailable: ${error.message}`);
      continue;
    }

    if (!full || full.documentationType !== 'FULL_LIBRARY') {
      findings.push(`${scenarioId}: condition B is not the full library`);
      continue;
    }

    libraryFingerprints.add(digestManifest(full.procedures));

    const match = full.procedures.filter(record =>
      record.id === selected.id &&
      record.version === selected.version
    );

    if (match.length !== 1) {
      findings.push(
        `${scenarioId}: C selection ${selected.id}@${selected.version} ` +
        `appears ${match.length} times in the B library`
      );
      continue;
    }

    if (
      JSON.stringify(match[0].steps) !== JSON.stringify(selected.steps) ||
      JSON.stringify(match[0].constraints) !==
        JSON.stringify(selected.constraints)
    ) {
      findings.push(`${scenarioId}: C content differs from B library entry`);
      continue;
    }

    findings.push(`${scenarioId}: C selection equals B library entry`);
  }

  if (libraryFingerprints.size > 1) {
    return {
      equivalent: false,
      findings: [
        ...findings,
        'Condition B library differs between scenarios'
      ]
    };
  }

  const equivalent =
    findings.length > 0 &&
    findings.every(entry => entry.includes('equals B library entry'));

  if (!equivalent && findings.length === 0) {
    findings.push('No scenarios were audited');
  }

  return { equivalent, findings };
}

function extractBilledCost(modelCalls) {
  let total = 0;
  let found = false;

  for (const call of modelCalls ?? []) {
    for (const usage of call.usage ?? []) {
      for (const model of usage.models ?? [usage]) {
        for (const key of [
          'cost', 'billedCost', 'billed_cost',
          'costUsd', 'cost_usd', 'price'
        ]) {
          if (typeof model?.[key] === 'number') {
            total += model[key];
            found = true;
          }
        }
      }
    }
  }

  // Cost is reported only when the transport supplies it. Token counts
  // are never converted into money here.
  return found
    ? { billedCost: total, costAvailable: true }
    : { billedCost: null, costAvailable: false };
}

function successRecord({
  prepared,
  condition,
  scenarioId,
  repeat,
  model,
  reasoningEffort,
  benchmark,
  protocol = PROTOCOL_ID,
  evaluatorName = DEFAULT_EVALUATOR_NAME
}) {
  const evaluation = benchmark.result?.outcome?.evaluation ?? null;
  const checks = evaluation?.checks ?? {};
  const failed = Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const { billedCost, costAvailable } = extractBilledCost(
    benchmark.modelCalls
  );

  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    protocol,
    manifestHash: prepared.manifestHash,
    condition,
    scenarioId,
    repeat,
    model,
    reasoningEffort,
    success: evaluation?.passed === true,
    checks: structuredClone(checks),
    evaluator: evaluatorName,
    elapsedMs: benchmark.totalElapsedMs,
    inputTokens: benchmark.usageTotals.inputTokens,
    cachedTokens: benchmark.usageTotals.cachedTokens,
    outputTokens: benchmark.usageTotals.outputTokens,
    reasoningTokens: benchmark.usageTotals.reasoningTokens,
    modelCalls: benchmark.usageTotals.calls,
    billedCost,
    costAvailable,
    finishReason: benchmark.result?.finishReason ?? null,
    decisionCount: benchmark.result?.decisionCount ?? null,
    trace: structuredClone({
      history: benchmark.result?.history ?? null,
      snapshot: benchmark.result?.outcome?.snapshot ?? null
    }),
    failureReason: failed.length === 0
      ? null
      : `CHECKS_FAILED:${failed.sort().join(',')}`,
    recordedAt: new Date().toISOString()
  };
}

function failureRecord({
  prepared,
  condition,
  scenarioId,
  repeat,
  model,
  reasoningEffort,
  error,
  protocol = PROTOCOL_ID,
  evaluatorName = DEFAULT_EVALUATOR_NAME
}) {
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    protocol,
    manifestHash: prepared.manifestHash,
    condition,
    scenarioId,
    repeat,
    model,
    reasoningEffort,
    success: false,
    checks: {},
    evaluator: evaluatorName,
    elapsedMs: null,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    modelCalls: 0,
    billedCost: null,
    costAvailable: false,
    finishReason: null,
    decisionCount: null,
    trace: null,
    failureReason: `ERROR:${error?.message ?? String(error)}`,
    recordedAt: new Date().toISOString()
  };
}

// Runs the full conditions x scenarios x repeats matrix, appending each
// completed trial to an append-only JSONL checkpoint immediately. A run
// resumed with the same checkpoint path and manifest skips completed
// trials instead of duplicating them; a manifest change fails closed.
// AGENTS-002 supplies its own protocol, scenario registry, evaluator,
// and benchmark runner through the optional overrides below. Defaults
// preserve the AGENTS-001 behavior exactly.
export async function runPersistentABC({
  prepared,
  transportFactory,
  checkpointPath,
  conditions = undefined,
  scenarioIds = undefined,
  repeats = 1,
  model = 'muse-spark-1.3',
  reasoningEffort = 'high',
  maxDecisions = 12,
  protocol = PROTOCOL_ID,
  validConditions = undefined,
  validScenarioIds = undefined,
  scenarios = null,
  evaluateOutcome = null,
  runBenchmark = runMuseBenchmark,
  evaluatorName = DEFAULT_EVALUATOR_NAME
}) {
  if (!prepared || typeof prepared.guidanceFor !== 'function') {
    throw new TypeError('A prepared benchmark is required');
  }

  if (typeof transportFactory !== 'function') {
    throw new TypeError('A transport factory is required');
  }

  if (!checkpointPath) {
    throw new TypeError('A checkpoint path is required');
  }

  if (typeof runBenchmark !== 'function') {
    throw new TypeError('A benchmark runner is required');
  }

  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new RangeError('repeats must be a positive integer');
  }

  // Default the trial matrix from the prepared manifest so an AGENTS-002
  // prepared benchmark never inherits AGENTS-001 scenario defaults.
  // Explicit arguments still win; unknown IDs are still rejected below.
  // Falls back to the AGENTS-001 constants when the manifest is absent,
  // preserving AGENTS-001 backward compatibility exactly.
  const manifestScenarios = prepared?.manifest?.scenarios;
  const manifestConditions = prepared?.manifest?.conditions;
  const effectiveScenarioIds = scenarioIds
    ?? (Array.isArray(manifestScenarios) ? [...manifestScenarios] : [...SCENARIO_IDS]);
  const effectiveConditions = conditions
    ?? (Array.isArray(manifestConditions) ? [...manifestConditions] : [...CONDITIONS]);
  const effectiveValidScenarioIds = validScenarioIds
    ?? (Array.isArray(manifestScenarios) ? [...manifestScenarios] : [...SCENARIO_IDS]);
  const effectiveValidConditions = validConditions
    ?? (Array.isArray(manifestConditions) ? [...manifestConditions] : [...CONDITIONS]);

  for (const scenarioId of effectiveScenarioIds) {
    if (!effectiveValidScenarioIds.includes(scenarioId)) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }
  }

  for (const condition of effectiveConditions) {
    if (!effectiveValidConditions.includes(condition)) {
      throw new Error(`Unknown condition: ${condition}`);
    }
  }

  const existing = readCheckpointFile(checkpointPath);

  for (const trial of existing.trials) {
    if (
      trial.protocol !== protocol ||
      trial.manifestHash !== prepared.manifestHash
    ) {
      throw new Error(
        'Checkpoint manifest mismatch: refusing to mix runs from ' +
        'different protocols or registries'
      );
    }
  }

  mkdirSync(dirname(checkpointPath), { recursive: true });

  const completed = new Set(existing.keys);
  const fresh = [];

  for (const scenarioId of effectiveScenarioIds) {
    for (const condition of effectiveConditions) {
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        const key = trialKey({ condition, scenarioId, repeat });

        if (completed.has(key)) continue;

        let record;

        try {
          const guidance = prepared.guidanceFor(condition, scenarioId);
          const transport = await transportFactory({
            scenarioId,
            condition,
            repeat
          });
          const benchmark = await runBenchmark({
            scenarioId,
            guidance,
            transport,
            maxDecisions,
            ...(scenarios ? { scenarios } : {}),
            ...(evaluateOutcome ? { evaluateOutcome } : {})
          });

          record = successRecord({
            prepared,
            condition,
            scenarioId,
            repeat,
            model,
            reasoningEffort,
            benchmark,
            protocol,
            evaluatorName
          });
        } catch (error) {
          record = failureRecord({
            prepared,
            condition,
            scenarioId,
            repeat,
            model,
            reasoningEffort,
            error,
            protocol,
            evaluatorName
          });
        }

        appendFileSync(
          checkpointPath,
          `${JSON.stringify(record)}\n`,
          'utf8'
        );

        completed.add(key);
        fresh.push(record);
      }
    }
  }

  return {
    protocol,
    manifestHash: prepared.manifestHash,
    checkpointPath,
    completedTrials: completed.size,
    newTrials: fresh.length,
    trials: fresh
  };
}
