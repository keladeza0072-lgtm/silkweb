import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createOrderEnvironment
} from '../src/orderEnvironment.mjs';

import {
  evaluateOrderOutcome
} from '../src/orderEvaluator.mjs';

test('routine resolution succeeds with audit', () => {
  const env = createOrderEnvironment();

  assert.equal(env.readOrder('ORD-001').ok, true);

  assert.equal(env.resolveOrder({
    id: 'ORD-001',
    resolution: 'approved'
  }).ok, true);

  assert.equal(env.writeAudit({
    id: 'ORD-001',
    note: 'Resolved after eligibility check'
  }).ok, true);

  assert.equal(
    evaluateOrderOutcome(env.snapshot()).passed,
    true
  );
});

test('changed contract rejects stale arguments', () => {
  const env = createOrderEnvironment({
    toolVersion: '3.0.0'
  });

  const stale = env.resolveOrder({
    id: 'ORD-001',
    resolution: 'approved'
  });

  assert.equal(stale.code, 'INVALID_TOOL_CONTRACT');

  const result = evaluateOrderOutcome(env.snapshot());

  assert.equal(result.passed, false);
  assert.equal(result.checks.noInvalidContractCalls, false);
});

test('current contract succeeds after version change', () => {
  const env = createOrderEnvironment({
    toolVersion: '3.0.0'
  });

  assert.equal(env.resolveOrder({
    id: 'ORD-001',
    resolutionCode: 'approved'
  }).ok, true);

  env.writeAudit({
    id: 'ORD-001',
    note: 'Resolved with current tool contract'
  });

  assert.equal(
    evaluateOrderOutcome(env.snapshot()).passed,
    true
  );
});

test('transient failure can recover without duplicate mutation', () => {
  const env = createOrderEnvironment({
    transientFailures: 1
  });

  const args = {
    id: 'ORD-001',
    resolution: 'approved'
  };

  assert.equal(
    env.resolveOrder(args).code,
    'TRANSIENT_FAILURE'
  );

  assert.equal(env.resolveOrder(args).ok, true);

  env.writeAudit({
    id: 'ORD-001',
    note: 'Resolved after retry'
  });

  const snapshot = env.snapshot();

  assert.equal(snapshot.mutationCount, 1);
  assert.equal(
    evaluateOrderOutcome(snapshot).passed,
    true
  );
});

test('duplicate mutation attempt fails evaluation', () => {
  const env = createOrderEnvironment();

  const args = {
    id: 'ORD-001',
    resolution: 'approved'
  };

  env.resolveOrder(args);
  env.resolveOrder(args);

  env.writeAudit({
    id: 'ORD-001',
    note: 'Resolved'
  });

  assert.equal(
    evaluateOrderOutcome(env.snapshot()).passed,
    false
  );
});

test('missing audit fails evaluation', () => {
  const env = createOrderEnvironment();

  env.resolveOrder({
    id: 'ORD-001',
    resolution: 'approved'
  });

  assert.equal(
    evaluateOrderOutcome(env.snapshot()).checks.auditPresent,
    false
  );
});

test('audit before resolution fails evaluation', () => {
  const env = createOrderEnvironment();

  env.writeAudit({
    id: 'ORD-001',
    note: 'Premature audit'
  });

  assert.equal(
    evaluateOrderOutcome(env.snapshot()).checks.noProhibitedActions,
    false
  );
});
