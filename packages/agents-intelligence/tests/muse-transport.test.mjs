import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DECISION_SCHEMA,
  parseMuseDecision,
  extractMuseOutput,
  createMuseTransport
} from '../src/museTransport.mjs';

test('schema requires a structured decision', () => {
  assert.deepEqual(
    DECISION_SCHEMA.required,
    ['type', 'tool', 'args']
  );
});

test('parses valid tool action', () => {
  const decision = parseMuseDecision({
    type: 'action',
    tool: 'readOrder',
    args: { id: 'ORD-001' }
  });

  assert.equal(decision.tool, 'readOrder');
});

test('normalizes finish response', () => {
  assert.deepEqual(
    parseMuseDecision({
      type: 'finish',
      tool: null,
      args: null
    }),
    { type: 'finish' }
  );
});

test('rejects unauthorized tools', () => {
  assert.throws(
    () => parseMuseDecision({
      type: 'action',
      tool: 'deleteOrder',
      args: {}
    }),
    /Invalid Muse action/
  );
});

test('extracts structured result from JSONL', () => {
  const stdout = [
    JSON.stringify({ type: 'session_started' }),
    JSON.stringify({
      type: 'result',
      result: {
        type: 'action',
        tool: 'readOrder',
        args: { id: 'ORD-001' }
      }
    })
  ].join('\n');

  const parsed = extractMuseOutput(stdout);

  assert.equal(parsed.decision.tool, 'readOrder');
  assert.equal(parsed.events.length, 2);
});

test('fails closed when output lacks a decision', () => {
  assert.throws(
    () => extractMuseOutput(
      JSON.stringify({ type: 'session_started' })
    ),
    /No valid structured Muse decision/
  );
});

test('transport refuses execution without explicit opt-in', async () => {
  const transport = createMuseTransport({
    workspace: process.cwd()
  });

  await assert.rejects(
    transport({ messages: [] }),
    /disabled/
  );
});
