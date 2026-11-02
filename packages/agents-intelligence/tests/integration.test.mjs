import test from 'node:test';
import assert from 'node:assert/strict';

import { digest } from '../src/index.mjs';
import { createIntelligenceHost } from '../src/integration.mjs';
import {
  runDeterministicWorkflow
} from '../src/deterministicDriver.mjs';

function setup({
  toolVersion = '2.0.0',
  approved = true
} = {}) {
  const procedure = {
    id: 'resolve-order-procedure',
    version: '1.0.0',
    task: 'resolve-order',
    toolVersion,
    steps: [
      'Read the order before mutation',
      'Confirm eligibility',
      'Resolve using the current tool contract',
      'Write exactly one audit record'
    ],
    constraints: [
      'Do not resolve an ineligible order',
      'Do not duplicate a successful mutation'
    ],
    provenance: ['Synthetic Milestone 5 integration fixture'],
    revoked: false
  };

  const approval = {
    id: procedure.id,
    version: procedure.version,
    status: 'approved',
    testsPassed: true,
    evidenceId: 'synthetic-integration-test',
    digest: digest(procedure)
  };

  const host = createIntelligenceHost({
    procedures: [procedure],
    approvals: approved ? [approval] : []
  });

  return { host, procedure, approval };
}

test('approved guidance reaches workflow and produces valid outcome', () => {
  const { host } = setup();

  const result = runDeterministicWorkflow({ host });

  assert.equal(result.selection.status, 'SELECTED');
  assert.equal(result.outcome.passed, true);
  assert.equal(result.snapshot.mutationCount, 1);
});

test('unapproved guidance fails closed before mutation', () => {
  const { host } = setup({ approved: false });

  const result = runDeterministicWorkflow({ host });

  assert.equal(result.selection.status, 'NO_MATCH');
  assert.equal(result.snapshot, null);
});

test('changed tool contract selects compatible guidance', () => {
  const { host } = setup({ toolVersion: '3.0.0' });

  const result = runDeterministicWorkflow({
    host,
    toolVersion: '3.0.0'
  });

  assert.equal(result.selection.status, 'SELECTED');
  assert.equal(result.outcome.passed, true);
});

test('transient failure recovers without duplicate mutation', () => {
  const { host } = setup();

  const result = runDeterministicWorkflow({
    host,
    transientFailures: 1
  });

  assert.equal(result.outcome.passed, true);
  assert.equal(result.snapshot.mutationCount, 1);
});

test('agent-facing guidance does not expose approvals', () => {
  const { host } = setup();

  const response = host.requestGuidance({
    task: 'resolve-order',
    toolVersion: '2.0.0'
  });

  assert.equal(response.status, 'SELECTED');
  assert.equal('approvals' in response.guidance, false);
  assert.equal('verification' in response.guidance, false);
  assert.equal('digest' in response.guidance, false);
});

test('host copies procedure and approval inputs', () => {
  const procedure = {
    id: 'immutable-procedure',
    version: '1.0.0',
    task: 'resolve-order',
    toolVersion: '2.0.0',
    steps: ['Read', 'Resolve', 'Audit'],
    constraints: ['No duplicate mutation'],
    provenance: ['Synthetic test'],
    revoked: false
  };

  const approval = {
    id: procedure.id,
    version: procedure.version,
    status: 'approved',
    testsPassed: true,
    evidenceId: 'synthetic-test',
    digest: digest(procedure)
  };

  const host = createIntelligenceHost({
    procedures: [procedure],
    approvals: [approval]
  });

  procedure.steps.push('Malicious instruction');
  approval.status = 'revoked';

  const result = host.requestGuidance({
    task: 'resolve-order',
    toolVersion: '2.0.0'
  });

  assert.equal(result.status, 'SELECTED');
  assert.equal(
    result.guidance.steps.includes('Malicious instruction'),
    false
  );
});
