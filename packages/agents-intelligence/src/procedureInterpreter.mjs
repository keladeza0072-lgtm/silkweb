import { publicToolContracts } from './publicToolContracts.mjs';

export const INTERPRETER_VERSION = '1.0.0';

export const MAX_TRANSIENT_RETRIES = 2;

export const SUPPORTED_OPERATIONS = Object.freeze([
  'readOrder',
  'resolveOrder',
  'writeAudit'
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function exactKeys(value, keys) {
  if (!isPlainObject(value)) return false;

  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
  );
}

function validArgs(op, args) {
  if (op === 'readOrder') {
    return (
      exactKeys(args, ['id']) &&
      isNonEmptyString(args.id)
    );
  }

  if (op === 'resolveOrder') {
    // Canonical logical arguments only. The interpreter renders the
    // contract-specific field (resolution vs resolutionCode) itself,
    // so stale contract literals in steps fail closed here.
    return (
      exactKeys(args, ['id', 'resolution']) &&
      isNonEmptyString(args.id) &&
      isNonEmptyString(args.resolution)
    );
  }

  if (op === 'writeAudit') {
    return (
      exactKeys(args, ['id', 'note']) &&
      isNonEmptyString(args.id) &&
      isNonEmptyString(args.note)
    );
  }

  return false;
}

export function validateProcedureSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { valid: false, reason: 'INVALID_STEPS', failedStep: null };
  }

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];

    if (!isPlainObject(step) || !exactKeys(step, ['op', 'args'])) {
      return {
        valid: false,
        reason: 'INVALID_STEPS',
        failedStep: index + 1
      };
    }

    if (!SUPPORTED_OPERATIONS.includes(step.op)) {
      return {
        valid: false,
        reason: 'UNSUPPORTED_OPERATION',
        failedStep: index + 1
      };
    }

    if (!validArgs(step.op, step.args)) {
      return {
        valid: false,
        reason: 'INVALID_STEP_ARGS',
        failedStep: index + 1
      };
    }
  }

  return { valid: true, reason: 'STEPS_VALID', failedStep: null };
}

function renderArgs(op, args, toolVersion) {
  if (op === 'resolveOrder') {
    const field = toolVersion === '3.0.0' ? 'resolutionCode' : 'resolution';

    return { id: args.id, [field]: args.resolution };
  }

  return { ...args };
}

export function executeProcedureSteps({ steps, environment, toolVersion }) {
  if (!environment || typeof environment !== 'object') {
    throw new TypeError('An order environment is required');
  }

  if (typeof toolVersion !== 'string') {
    throw new TypeError('A tool version is required');
  }

  try {
    publicToolContracts(toolVersion);
  } catch {
    return {
      completed: false,
      reason: 'INCOMPATIBLE_TOOL_CONTRACT',
      failedStep: null,
      failedCode: null,
      trace: []
    };
  }

  const validation = validateProcedureSteps(steps);

  if (!validation.valid) {
    return {
      completed: false,
      reason: validation.reason,
      failedStep: validation.failedStep,
      failedCode: null,
      trace: []
    };
  }

  const trace = [];

  for (let index = 0; index < steps.length; index++) {
    const { op, args } = steps[index];
    const rendered = renderArgs(op, args, toolVersion);
    const attempts = [];
    let result = null;
    let retries = 0;

    for (;;) {
      if (op === 'readOrder') {
        result = environment.readOrder(rendered.id);
      } else if (op === 'resolveOrder') {
        result = environment.resolveOrder(rendered);
      } else {
        result = environment.writeAudit(rendered);
      }

      attempts.push({
        args: structuredClone(rendered),
        result: structuredClone(result ?? null)
      });

      if (result && result.ok) break;

      // Only an explicit transient failure may be retried, and only
      // up to a fixed bound. Every other failure halts immediately
      // with no retry, so faults can never be retried into success.
      if (!result || result.code !== 'TRANSIENT_FAILURE') {
        trace.push({
          step: index + 1,
          op,
          args: structuredClone(args),
          attempts,
          ok: false
        });

        return {
          completed: false,
          reason: 'STEP_FAILED',
          failedStep: index + 1,
          failedCode: result?.code ?? 'INVALID_TOOL_RESULT',
          trace
        };
      }

      if (retries >= MAX_TRANSIENT_RETRIES) {
        trace.push({
          step: index + 1,
          op,
          args: structuredClone(args),
          attempts,
          ok: false
        });

        return {
          completed: false,
          reason: 'TRANSIENT_RETRIES_EXHAUSTED',
          failedStep: index + 1,
          failedCode: 'TRANSIENT_FAILURE',
          trace
        };
      }

      retries++;
    }

    trace.push({
      step: index + 1,
      op,
      args: structuredClone(args),
      attempts,
      ok: true
    });
  }

  return {
    completed: true,
    reason: 'STEPS_COMPLETED',
    failedStep: null,
    failedCode: null,
    trace
  };
}
