export function createOrderEnvironment({
  toolVersion = '2.0.0',
  transientFailures = 0
} = {}) {
  if (!['2.0.0', '3.0.0'].includes(toolVersion)) {
    throw new Error('Unsupported tool version');
  }

  if (!Number.isInteger(transientFailures) || transientFailures < 0) {
    throw new Error('Invalid failure count');
  }

  const order = {
    id: 'ORD-001',
    status: 'pending',
    eligible: true
  };

  const audit = [];
  const trace = [];
  let mutationCount = 0;
  let remainingFailures = transientFailures;

  function record(action, args, result) {
    trace.push({
      sequence: trace.length + 1,
      action,
      args: structuredClone(args),
      result: structuredClone(result)
    });

    return result;
  }

  function readOrder(id) {
    if (id !== order.id) {
      return record('readOrder', { id }, {
        ok: false,
        code: 'ORDER_NOT_FOUND'
      });
    }

    return record('readOrder', { id }, {
      ok: true,
      order: structuredClone(order)
    });
  }

  function resolveOrder(args) {
    const expectedKey = toolVersion === '2.0.0'
      ? 'resolution'
      : 'resolutionCode';

    if (
      !args ||
      typeof args !== 'object' ||
      args.id !== order.id ||
      typeof args[expectedKey] !== 'string' ||
      !args[expectedKey].trim() ||
      Object.keys(args).sort().join(',') !==
        [expectedKey, 'id'].sort().join(',')
    ) {
      return record('resolveOrder', args ?? null, {
        ok: false,
        code: 'INVALID_TOOL_CONTRACT'
      });
    }

    if (!order.eligible) {
      return record('resolveOrder', args, {
        ok: false,
        code: 'INELIGIBLE_ORDER'
      });
    }

    if (remainingFailures > 0) {
      remainingFailures--;

      return record('resolveOrder', args, {
        ok: false,
        code: 'TRANSIENT_FAILURE'
      });
    }

    if (order.status !== 'pending') {
      return record('resolveOrder', args, {
        ok: false,
        code: 'ALREADY_RESOLVED'
      });
    }

    order.status = 'resolved';
    mutationCount++;

    return record('resolveOrder', args, {
      ok: true,
      status: order.status
    });
  }

  function writeAudit(args) {
    if (
      !args ||
      args.id !== order.id ||
      typeof args.note !== 'string' ||
      !args.note.trim()
    ) {
      return record('writeAudit', args ?? null, {
        ok: false,
        code: 'INVALID_AUDIT'
      });
    }

    if (order.status !== 'resolved') {
      return record('writeAudit', args, {
        ok: false,
        code: 'ORDER_NOT_RESOLVED'
      });
    }

    if (audit.length > 0) {
      return record('writeAudit', args, {
        ok: false,
        code: 'DUPLICATE_AUDIT'
      });
    }

    audit.push({
      orderId: order.id,
      note: args.note
    });

    return record('writeAudit', args, {
      ok: true
    });
  }

  function snapshot() {
    return structuredClone({
      toolVersion,
      order,
      audit,
      trace,
      mutationCount
    });
  }

  return Object.freeze({
    readOrder,
    resolveOrder,
    writeAudit,
    snapshot
  });
}
