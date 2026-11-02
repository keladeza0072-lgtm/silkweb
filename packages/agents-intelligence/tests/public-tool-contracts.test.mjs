import test from 'node:test';
import assert from 'node:assert/strict';

import {
  publicToolContracts
} from '../src/publicToolContracts.mjs';

test('v2 exposes the resolution argument', () => {
  const contracts = publicToolContracts('2.0.0');

  assert.deepEqual(
    contracts.tools.resolveOrder.required,
    ['id', 'resolution']
  );
});

test('v3 exposes the changed resolutionCode argument', () => {
  const contracts = publicToolContracts('3.0.0');

  assert.deepEqual(
    contracts.tools.resolveOrder.required,
    ['id', 'resolutionCode']
  );
});

test('unsupported tool versions fail closed', () => {
  assert.throws(
    () => publicToolContracts('4.0.0'),
    /Unsupported tool version/
  );
});
