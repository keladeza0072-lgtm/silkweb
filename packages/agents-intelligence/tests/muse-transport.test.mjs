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

test('parses actual Muse 1.4.13 event envelope', () => {
  const decision = JSON.stringify({
    type: 'action',
    tool: 'readOrder',
    args: { id: 'ORD-001' }
  });

  const stdout = [
    JSON.stringify({
      record_type: 'status',
      payload_type: 'run.output.delta',
      payload: {
        kind: 'run_output_delta',
        text: decision
      }
    }),
    JSON.stringify({
      record_type: 'status',
      payload_type: 'run.usage',
      payload: {
        kind: 'run_usage',
        calls: 1,
        completed_calls: 1,
        models: [{
          model: 'muse-spark-1.3',
          input_tokens: 100,
          cached_tokens: 20,
          output_tokens: 30,
          reasoning_tokens: 5,
          calls: 1
        }]
      }
    }),
    JSON.stringify({
      record_type: 'event',
      payload_type: 'run.terminal.completed',
      payload: {
        kind: 'run_terminal',
        terminal: 'completed',
        text: decision
      }
    })
  ].join('\n');

  const parsed = extractMuseOutput(stdout);

  assert.equal(parsed.decision.tool, 'readOrder');
  assert.equal(parsed.usage.length, 1);
  assert.equal(parsed.usage[0].models[0].input_tokens, 100);
});

test('rejects echo output as a real agent decision', () => {
  const stdout = JSON.stringify({
    record_type: 'event',
    payload_type: 'run.terminal.completed',
    payload: {
      kind: 'run_terminal',
      terminal: 'completed',
      text: 'echo: Return JSON'
    }
  });

  assert.throws(
    () => extractMuseOutput(stdout),
    /No valid structured Muse decision/
  );
});
