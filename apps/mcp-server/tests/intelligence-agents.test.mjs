import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = dirname(fileURLToPath(import.meta.url));
const serverFile = join(here, '..', 'dist', 'index.js');

const textOf = (result) => result.content.find((block) => block.type === 'text')?.text ?? '';

async function withClient(env, fn) {
  const client = new Client({ name: 'silkweb-intelligence-agents-test', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverFile],
    env: { ...process.env, ...env },
  });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function callOk(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, `${name} returned an error: ${textOf(result).slice(0, 300)}`);
  return JSON.parse(textOf(result));
}

async function callErr(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true, `${name} should have failed closed`);
  return textOf(result);
}

const EXPECTED_TOOLS = [
  'get_verified_component_source',
  'inspect_verified_component',
  'ping',
  'search_verified_components',
  'silkweb_agents_select',
  'silkweb_code_lookup',
  'silkweb_data_lookup',
];

describe('silkweb intelligence + agents tools: discovery and registration', () => {
  it('exposes exactly the seven read-only tools', async () => {
    await withClient({}, async (client) => {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, EXPECTED_TOOLS);
      for (const tool of listed.tools) {
        assert.equal(
          tool.annotations?.readOnlyHint,
          true,
          `${tool.name} must stay read-only`,
        );
        assert.ok(
          typeof tool.description === 'string' && tool.description.length > 0,
          `${tool.name} needs a description`,
        );
      }
    });
  });
});

describe('silkweb_code_lookup against the real trusted registry', () => {
  it('returns verified components deterministically', async () => {
    await withClient({}, async (client) => {
      const result = await callOk(client, 'silkweb_code_lookup', {
        capabilities: ['slot-guard'],
      });
      assert.deepEqual(result.components.map((c) => c.id), ['booking-slot-guard']);
      assert.equal(result.totalTrusted, 4);
      const all = await callOk(client, 'silkweb_code_lookup', {});
      assert.deepEqual(
        all.components.map((c) => `${c.id}@${c.version}`),
        [
          'booking-schema@0.1.0',
          'booking-slot-guard@0.1.0',
          'booking-validation@0.1.0',
          'registry-loader@0.1.0',
        ],
      );
      const andSemantics = await callOk(client, 'silkweb_code_lookup', {
        capabilities: ['slot-guard', 'registry-loading'],
      });
      assert.equal(andSemantics.components.length, 0);
    });
  });
});

describe('silkweb_data_lookup: manifest-backed answers only', () => {
  it('serves registry-backed rules and reports gaps honestly', async () => {
    await withClient({}, async (client) => {
      const matched = await callOk(client, 'silkweb_data_lookup', { topic: 'booking' });
      assert.equal(matched.available, true);
      assert.ok(matched.components.length > 0);
      for (const component of matched.components) {
        assert.ok(component.rules.length > 0, `${component.id} must expose manifest rules`);
      }
      const unscoped = await callOk(client, 'silkweb_data_lookup', {});
      assert.equal(unscoped.available, true);
      assert.ok(unscoped.components.length > 0);

      const missing = await callOk(client, 'silkweb_data_lookup', {
        topic: 'zz-no-such-topic-xyz',
      });
      assert.equal(missing.available, false);
      assert.deepEqual(missing.components, []);
      assert.match(missing.note, /nothing was invented|no rules were invented/i);
    });
  });
});

describe('silkweb_agents_select: approved procedures only', () => {
  it('selects the approved procedure for a known task and version', async () => {
    await withClient({}, async (client) => {
      const result = await callOk(client, 'silkweb_agents_select', {
        task: 'resolve-order',
        toolVersion: '3.0.0',
      });
      assert.equal(result.status, 'SELECTED');
      assert.equal(result.selected.id, 'ord-resolve-standard');
      assert.equal(result.selected.version, '3.1.0');
      assert.ok(result.selected.steps.length > 0);
      assert.ok(result.selected.constraints.length > 0);
      assert.ok(result.approvalsChecked > 0);
      assert.ok(result.toolContract !== null);
      assert.deepEqual(result.toolContract.toolVersion, '3.0.0');
    });
  });

  it('never selects a revoked procedure', async () => {
    await withClient({}, async (client) => {
      const result = await callOk(client, 'silkweb_agents_select', {
        task: 'resolve-order',
        toolVersion: '2.0.0',
      });
      assert.equal(result.status, 'SELECTED');
      assert.equal(result.selected.id, 'ord-resolve-standard');
      assert.equal(result.selected.version, '2.4.0');
      const reasons = result.inspected.map((entry) => entry.reason);
      assert.ok(reasons.includes('REVOKED'), 'revoked traps must be visibly rejected');
      assert.ok(
        !['ord-resolve-legacy', 'ord-resolve-double-commit', 'ord-resolve-audit-first'].includes(
          result.selected.id,
        ),
        'a revoked trap must never be selected',
      );
    });
  });

  it('rejects incompatible tool versions without a contract', async () => {
    await withClient({}, async (client) => {
      const result = await callOk(client, 'silkweb_agents_select', {
        task: 'resolve-order',
        toolVersion: '1.0.0',
      });
      assert.notEqual(result.status, 'SELECTED');
      assert.equal(result.selected, null);
      assert.ok(result.toolContract === null);
      assert.match(result.contractNote ?? '', /No public tool contract exists/);
    });
  });

  it('rejects unknown tasks without inventing a procedure', async () => {
    await withClient({}, async (client) => {
      const result = await callOk(client, 'silkweb_agents_select', {
        task: 'teleport-the-order',
        toolVersion: '3.0.0',
      });
      assert.equal(result.status, 'NO_MATCH');
      assert.equal(result.selected, null);
      assert.match(result.note, /None was invented|never selected/i);
    });
  });

  it('rejects invalid input fail-closed', async () => {
    await withClient({}, async (client) => {
      await callErr(client, 'silkweb_agents_select', { task: '', toolVersion: '3.0.0' });
      await callErr(client, 'silkweb_agents_select', { task: 'resolve-order', toolVersion: 'v3' });
      await callErr(client, 'silkweb_agents_select', {
        task: 'resolve-order',
        toolVersion: '3.0.0.1-extra',
      });
      await callErr(client, 'silkweb_code_lookup', { limit: 0 });
      await callErr(client, 'silkweb_data_lookup', { limit: 999 });
    });
  });
});

describe('no mutation or arbitrary execution surface', () => {
  it('offers no write/execute tools and rejects unknown tools', async () => {
    await withClient({}, async (client) => {
      const listed = await client.listTools();
      for (const tool of listed.tools) {
        assert.ok(
          !/exec|write|delete|deploy|run$/i.test(tool.name),
          `${tool.name} looks like a mutation surface`,
        );
        assert.equal(tool.annotations?.readOnlyHint, true);
      }
      await assert.rejects(() => client.callTool({ name: 'silkweb_execute', arguments: {} }));
    });
  });
});

describe('existing MCP tools remain functional', () => {
  it('ping, search, inspect, and source still serve the certified registry', async () => {
    await withClient({}, async (client) => {
      const ping = await callOk(client, 'ping', {});
      assert.deepEqual(ping, { ok: true, service: 'silkweb' });

      const search = await callOk(client, 'search_verified_components', {});
      assert.equal(search.totalTrusted, 4);

      const contract = await callOk(client, 'inspect_verified_component', {
        id: 'booking-schema',
        version: '0.1.0',
      });
      assert.equal(contract.verification.status, 'verified');
      assert.ok(contract.invariants.length > 0);

      const source = await callOk(client, 'get_verified_component_source', {
        id: 'registry-loader',
        version: '0.1.0',
      });
      assert.deepEqual(source.files.map((f) => f.path), [
        'packages/registry/src/loader.ts',
        'packages/registry/src/manifest.ts',
      ]);
    });
  });
});
