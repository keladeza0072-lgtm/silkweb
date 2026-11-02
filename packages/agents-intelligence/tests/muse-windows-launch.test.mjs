import test from 'node:test';
import assert from 'node:assert/strict';

import { createMuseTransport } from '../src/museTransport.mjs';

test('transport accepts an explicit provider without executing it', () => {
  const transport = createMuseTransport({
    provider: 'echo',
    workspace: process.cwd(),
    enabled: false
  });

  assert.equal(typeof transport, 'function');
});

test('transport remains disabled by default', async () => {
  const transport = createMuseTransport({
    provider: 'echo',
    workspace: process.cwd()
  });

  await assert.rejects(
    transport({ messages: [] }),
    /disabled/
  );
});
