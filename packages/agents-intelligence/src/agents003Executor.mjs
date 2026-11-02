// AGENTS-003 deterministic executor (Stage 1).
//
// Executes the single approved procedure selected through the existing
// registry, trust store, and compatibility checks, then scores the real
// environment outcome with the independent AGENTS-002 evaluator.
//
// Fail-closed ordering, enforced here in addition to the interpreter:
//   1. Selection reuses selectProcedure: missing approval, revocation,
//      incompatible versions, tampered content, and unsupported
//      operations never reach an environment.
//   2. A static screen refuses procedures with more than one mutating
//      step or with dependency-violating step order before any tool runs,
//      so a duplicate irreversible mutation is never attempted.
//   3. Execution is a single interpreter pass with the interpreter's own
//      bounded transient-retry budget. There is no procedure-level retry,
//      so a successful mutation is never re-executed.
//   4. Model fallback is only invoked when deterministic execution is
//      genuinely insufficient, and model output is never treated as
//      authority: it cannot mint approvals or bypass compatibility
//      checks. Fallback trials are scored by the same independent
//      evaluator.
//
// This file adds no registry and no execution framework. It reuses
// selectProcedure, executeProcedureSteps, createOrderEnvironment, and
// evaluateAgents002Outcome.
import { performance } from 'node:perf_hooks';

import { selectProcedure } from './index.mjs';
import { executeProcedureSteps } from './procedureInterpreter.mjs';
import { createOrderEnvironment } from './orderEnvironment.mjs';
import { evaluateAgents002Outcome } from './agents002Evaluator.mjs';
import { runMuseBenchmark } from './museBenchmark.mjs';
import { evaluateAgents002BenchmarkOutcome } from './agents002Benchmark.mjs';

export const AGENTS003_EXECUTOR_VERSION = '1.0.0';

// Operations that irreversibly change order state. At most one may
// appear in an executable procedure.
const MUTATING_OPERATIONS = Object.freeze(['resolveOrder']);

const VERSION = /^\d+\.\d+\.\d+$/;

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validQuery(query) {
  return (
    query &&
    typeof query === 'object' &&
    nonempty(query.task) &&
    typeof query.toolVersion === 'string' &&
    VERSION.test(query.toolVersion)
  );
}

// Selection statuses that prove deterministic execution cannot proceed.
function selectionFallbackReason(status) {
  if (status === 'AMBIGUOUS') return 'AMBIGUOUS_PROCEDURE';
  return 'NO_APPROVED_PROCEDURE';
}

// Static pre-execution screen. Runs before any environment exists, so a
// refusal here guarantees zero tool calls and zero mutations. The
// interpreter re-validates the same steps at execution time.
function screenSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, reason: 'INVALID_STEPS', failedStep: null };
  }

  for (const step of steps) {
    if (
      !step ||
      typeof step !== 'object' ||
      Array.isArray(step) ||
      typeof step.op !== 'string' ||
      !step.args ||
      typeof step.args !== 'object' ||
      Array.isArray(step.args)
    ) {
      return { ok: false, reason: 'INVALID_STEPS', failedStep: null };
    }

    if (!['readOrder', 'resolveOrder', 'writeAudit'].includes(step.op)) {
      return { ok: false, reason: 'UNSUPPORTED_OPERATION', failedStep: null };
    }
  }

  if (steps.filter(step => MUTATING_OPERATIONS.includes(step.op)).length > 1) {
    return { ok: false, reason: 'DUPLICATE_MUTATION_RISK', failedStep: null };
  }

  const seen = new Set();

  for (let index = 0; index < steps.length; index++) {
    const op = steps[index].op;

    // A mutation is only valid after an eligibility read, and an audit
    // record is only valid after a mutation.
    if (op === 'resolveOrder' && !seen.has('readOrder')) {
      return { ok: false, reason: 'DEPENDENCY_ORDERING_RISK', failedStep: index + 1 };
    }

    if (op === 'writeAudit' && !seen.has('resolveOrder')) {
      return { ok: false, reason: 'DEPENDENCY_ORDERING_RISK', failedStep: index + 1 };
    }

    seen.add(op);
  }

  return { ok: true, reason: 'STEPS_SCREENED', failedStep: null };
}

function refused({ status, selection, fallbackReason, detail = null }) {
  return {
    executorVersion: AGENTS003_EXECUTOR_VERSION,
    status,
    executed: false,
    selection,
    execution: null,
    snapshot: null,
    evaluation: null,
    modelCalls: 0,
    fallbackUsed: false,
    fallbackReason,
    detail
  };
}

// Minimal evaluator scenario when the caller supplies no frozen scenario.
// Carries the same budget fields the evaluator reads, nothing more.
function syntheticScenario({ task, toolVersion, transientFailures }) {
  return {
    id: task,
    toolVersion,
    transientFailures,
    facts: Object.freeze({
      orderId: 'ORD-001',
      orderEligible: true,
      initialStatus: 'pending',
      toolVersion,
      requirements: Object.freeze([])
    })
  };
}

export function runDeterministicExecution({
  library,
  trust,
  task,
  toolVersion,
  scenario = null,
  transientFailures = 0,
  createEnvironment = null
} = {}) {
  const query = { task, toolVersion };

  if (!validQuery(query)) {
    return refused({
      status: 'INVALID_QUERY',
      selection: null,
      fallbackReason: 'NO_APPROVED_PROCEDURE'
    });
  }

  const selection = selectProcedure(library, query, trust);

  if (selection.status !== 'SELECTED' || !selection.selected) {
    return refused({
      status: selection.status,
      selection,
      fallbackReason: selectionFallbackReason(selection.status)
    });
  }

  const procedure = selection.selected;
  const liveToolVersion = scenario?.toolVersion ?? toolVersion;

  // Defense in depth: the live environment contract must equal the
  // approved procedure contract, even though selection already matched
  // the queried contract.
  if (procedure.toolVersion !== liveToolVersion) {
    return refused({
      status: 'INCOMPATIBLE_VERSION',
      selection,
      fallbackReason: 'INCOMPATIBLE_VERSION'
    });
  }

  const screen = screenSteps(procedure.steps);

  if (!screen.ok) {
    return refused({
      status: 'PROCEDURE_REFUSED',
      selection,
      fallbackReason: screen.reason,
      detail: screen.failedStep === null ? null : { failedStep: screen.failedStep }
    });
  }

  const budget = Number.isInteger(scenario?.transientFailures)
    ? scenario.transientFailures
    : transientFailures;

  const environment = createEnvironment
    ? createEnvironment({ toolVersion: liveToolVersion, transientFailures: budget })
    : createOrderEnvironment({ toolVersion: liveToolVersion, transientFailures: budget });

  // Single pass. No procedure-level retry: a successful mutation must
  // never be re-executed, and a failed run halts instead of retrying
  // the whole procedure into a duplicate.
  const execution = executeProcedureSteps({
    steps: procedure.steps,
    environment,
    toolVersion: liveToolVersion
  });

  const snapshot = environment.snapshot();
  const evaluation = evaluateAgents002Outcome({
    scenario: scenario ?? syntheticScenario({ task, toolVersion: liveToolVersion, transientFailures: budget }),
    snapshot,
    claimedSuccess: execution.completed
  });

  const passed = evaluation.passed === true;

  return {
    executorVersion: AGENTS003_EXECUTOR_VERSION,
    status: passed ? 'DETERMINISTIC_PASS' : 'DETERMINISTIC_FAILED',
    executed: true,
    selection,
    execution,
    snapshot,
    evaluation,
    modelCalls: 0,
    fallbackUsed: false,
    fallbackReason: passed ? null : (execution.completed ? 'OUTCOME_FAILED' : execution.reason)
  };
}

// Controlled model fallback. The deterministic attempt always runs
// first; the model is consulted only when it did not pass, only when
// the caller explicitly authorizes it, and only for actions scored by
// the independent evaluator. The deterministic selection is preserved
// on the result: model output can neither approve a procedure nor
// override a compatibility refusal.
export async function runWithControlledFallback({
  deterministic,
  allowFallback = false,
  transportFactory = null,
  scenarioId,
  scenarios = null,
  maxDecisions = 12
} = {}) {
  const start = performance.now();
  const result = runDeterministicExecution(deterministic);

  if (result.evaluation?.passed === true) {
    return { ...result, totalElapsedMs: performance.now() - start };
  }

  if (!allowFallback) {
    return { ...result, fallbackAuthorized: false, totalElapsedMs: performance.now() - start };
  }

  if (typeof transportFactory !== 'function') {
    throw new TypeError('A transport factory is required for fallback');
  }

  if (!scenarioId) {
    throw new TypeError('A scenario id is required for fallback');
  }

  // Guidance is the already-approved selection, or nothing when
  // selection itself failed. A failed selection therefore falls back
  // with no procedure authority at all.
  const guidance = result.selection?.status === 'SELECTED'
    ? structuredClone(result.selection.selected)
    : null;

  const transport = await transportFactory({ scenarioId, condition: 'fallback' });
  const benchmark = await runMuseBenchmark({
    scenarioId,
    guidance,
    transport,
    maxDecisions,
    ...(scenarios ? { scenarios } : {}),
    evaluateOutcome: evaluateAgents002BenchmarkOutcome
  });

  const evaluation = benchmark.result?.outcome?.evaluation ?? null;

  return {
    executorVersion: AGENTS003_EXECUTOR_VERSION,
    status: evaluation?.passed === true ? 'FALLBACK_PASS' : 'FALLBACK_FAILED',
    executed: result.executed,
    selection: result.selection,
    execution: result.execution,
    snapshot: benchmark.result?.outcome?.snapshot ?? result.snapshot,
    evaluation,
    modelCalls: benchmark.usageTotals?.calls ?? benchmark.modelCalls?.length ?? 0,
    fallbackUsed: true,
    fallbackAuthorized: true,
    fallbackReason: result.fallbackReason,
    totalElapsedMs: performance.now() - start
  };
}
