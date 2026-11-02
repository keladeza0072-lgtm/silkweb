import { createOrderEnvironment } from './orderEnvironment.mjs';
import { evaluateOrderOutcome } from './orderEvaluator.mjs';

export function runDeterministicWorkflow({
  host,
  task = 'resolve-order',
  toolVersion = '2.0.0',
  transientFailures = 0
}) {
  const selection = host.requestGuidance({
    task,
    toolVersion
  });

  if (selection.status !== 'SELECTED') {
    return {
      selection,
      outcome: null,
      snapshot: null
    };
  }

  const guidance = selection.guidance;

  const env = createOrderEnvironment({
    toolVersion,
    transientFailures
  });

  const read = env.readOrder('ORD-001');

  if (!read.ok || !read.order.eligible) {
    return {
      selection,
      outcome: evaluateOrderOutcome(env.snapshot()),
      snapshot: env.snapshot()
    };
  }

  // This is a deterministic integration driver, not an AI agent.
  // It uses a fixed execution policy and does not interpret the
  // natural-language steps in the guidance.
  const args = {
    id: 'ORD-001',
    ...(toolVersion === '3.0.0'
      ? { resolutionCode: 'approved' }
      : { resolution: 'approved' })
  };

  let result;

  for (let attempt = 0; attempt < 3; attempt++) {
    result = env.resolveOrder(args);

    if (result.ok) break;

    if (result.code !== 'TRANSIENT_FAILURE') break;
  }

  if (result?.ok) {
    env.writeAudit({
      id: 'ORD-001',
      note: `Resolved under procedure ${guidance.id}`
    });
  }

  const snapshot = env.snapshot();

  return {
    selection,
    outcome: evaluateOrderOutcome(snapshot),
    snapshot
  };
}
