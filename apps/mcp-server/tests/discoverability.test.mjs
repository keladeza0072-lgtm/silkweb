import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/index.ts', import.meta.url),
  'utf8'
);

function description(name) {
  const pattern = new RegExp(
    String.raw`server\.registerTool\(\s*'${name}'\s*,\s*\{\s*description:\s*([\s\S]*?)\s*inputSchema:`
  );

  const match = source.match(pattern);
  assert.ok(match, `Missing tool description: ${name}`);

  const expression = match[1];
  const literals = [...expression.matchAll(/'([^']*)'/g)];

  assert.ok(literals.length > 0, `Empty description: ${name}`);

  const remaining = expression
    .replace(/'[^']*'/g, '')
    .replace(/[\s+,]/g, '');

  assert.equal(remaining, '', `Unexpected expression: ${name}`);

  return literals.map((item) => item[1]).join('');
}

test('all four MCP tools remain registered', () => {
  const registrations = source.match(/server\.registerTool\s*\(/g) ?? [];
  assert.equal(registrations.length, 4);
});

test('search advertises reusable verified components', () => {
  const text = description('search_verified_components');

  assert.match(text, /before writing equivalent code/i);
  assert.match(text, /currently valid evidence/i);
  assert.match(text, /inspect promising matches/i);
  assert.match(text, /deterministic \(id, version\) order/i);
});

test('inspection advertises compatibility and safety', () => {
  const text = description('inspect_verified_component');

  assert.match(text, /contract fits the task/i);
  assert.match(text, /limitations before retrieving/i);
  assert.match(text, /fails closed/i);
});

test('retrieval advertises integration and testing', () => {
  const text = description('get_verified_component_source');

  assert.match(text, /integration into the coding task/i);
  assert.match(text, /integrate and test/i);
  assert.match(text, /allowlisted component sources/i);
});

test('ping retains its connectivity purpose', () => {
  const text = description('ping');

  assert.match(text, /connectivity check/i);
  assert.match(text, /no API calls/i);
});
