import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInteractiveBenchmark
} from '../src/interactiveBenchmark.mjs';

function execute(session, tool, args) {
  return session.submitAction({ tool, args });
}

test('routine scenario succeeds through sequential tool feedback', () => {
  const session = createInteractiveBenchmark('routine');

  execute(session, 'readOrder', { id: 'ORD-001' });

  execute(session, 'resolveOrder', {
    id: 'ORD-001',
    resolution: 'approved'
  });

  execute(session, 'writeAudit', {
    id: 'ORD-001',
    note: 'Resolved'
  });

  assert.equal(session.finish().evaluation.passed, true);
});

test('agent can observe a transient failure and retry', () => {
  const session = createInteractiveBenchmark('transientRecovery');

  execute(session, 'readOrder', { id: 'ORD-001' });

  const first = execute(session, 'resolveOrder', {
    id: 'ORD-001',
    resolution: 'approved'
  });

  assert.equal(first.result.ok, false);

  const second = execute(session, 'resolveOrder', {
    id: 'ORD-001',
    resolution: 'approved'
  });

  assert.equal(second.result.ok, true);

  execute(session, 'writeAudit', {
    id: 'ORD-001',
    note: 'Recovered'
  });

  assert.equal(session.finish().evaluation.passed, true);
});

test('changed contract exposes invalid action to the agent', () => {
  const session = createInteractiveBenchmark('changedContract');

  const result = execute(session, 'resolveOrder', {
    id: 'ORD-001',
    resolution: 'approved'
  });

  assert.equal(result.result.ok, false);
  assert.equal(session.finish().evaluation.passed, false);
});

test('incomplete workflow fails independent evaluation', () => {
  const session = createInteractiveBenchmark('routine');

  execute(session, 'readOrder', { id: 'ORD-001' });

  assert.equal(session.finish().evaluation.passed, false);
});

test('invalid tool names are rejected', () => {
  const session = createInteractiveBenchmark('routine');

  const result = execute(session, 'deleteOrder', {
    id: 'ORD-001'
  });

  assert.equal(result.accepted, false);
  assert.equal(result.error, 'INVALID_ACTION');
});

test('agent cannot execute actions after finishing', () => {
  const session = createInteractiveBenchmark('routine');

  session.finish();

  assert.equal(
    execute(session, 'readOrder', {
      id: 'ORD-001'
    }).error,
    'SESSION_FINISHED'
  );
});

test('session enforces a maximum action count', () => {
  const session = createInteractiveBenchmark('routine');

  for (let i = 0; i < 12; i++) {
    execute(session, 'readOrder', {
      id: 'ORD-001'
    });
  }

  assert.equal(
    execute(session, 'readOrder', {
      id: 'ORD-001'
    }).error,
    'ACTION_LIMIT_EXCEEDED'
  );
});

test('invalid action still counts toward the action budget', () => {
  const session = createInteractiveBenchmark('routine');

  for (let i = 0; i < 12; i++) {
    execute(session, 'unknownTool', {});
  }

  assert.equal(
    execute(session, 'readOrder', {
      id: 'ORD-001'
    }).error,
    'ACTION_LIMIT_EXCEEDED'
  );
});
