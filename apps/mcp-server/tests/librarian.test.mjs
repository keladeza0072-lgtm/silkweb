import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  assertServableSourcePath,
  discoverRepoRoot,
  isTrusted,
  searchTrusted,
  sourceTrustedComponent,
} from '../dist/librarian.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverFile = join(here, '..', 'dist', 'index.js');
const repoRoot = dirname(dirname(dirname(here)));
const realManifestDir = join(repoRoot, 'registry-data', 'manifests');

const textOf = (result) => result.content.find((block) => block.type === 'text')?.text ?? '';

async function withClient(env, fn) {
  const client = new Client({ name: 'silkweb-librarian-test', version: '0.1.0' });
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

function readManifest(id, version) {
  return JSON.parse(readFileSync(join(realManifestDir, `${id}-${version}.json`), 'utf8'));
}

const scratchRoot = join(here, 'tmp');
mkdirSync(scratchRoot, { recursive: true });
const scratchDirs = [];
after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(prefix) {
  const dir = mkdtempSync(join(scratchRoot, `${prefix}-`));
  scratchDirs.push(dir);
  return dir;
}

function fixtureManifestDir(mutants) {
  const dir = scratchDir('fixture');
  for (const [name, manifest] of Object.entries(mutants)) {
    writeFileSync(join(dir, name), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return dir;
}

describe('librarian trust gate (unit)', () => {
  it('requires verified status AND valid evidence together', () => {
    const verified = { verification: { status: 'verified' } };
    const unverified = { verification: { status: 'unverified' } };
    assert.equal(isTrusted(verified, { valid: true }), true);
    // Evidence-valid but declaratively unverified: never trusted.
    assert.equal(isTrusted(unverified, { valid: true }), false);
    assert.equal(isTrusted(verified, { valid: false }), false);
    assert.equal(isTrusted(unverified, { valid: false }), false);
  });

  it('resolves the repo root independently of the caller working directory', () => {
    const serverDir = join(repoRoot, 'apps', 'mcp-server', 'dist');
    const previous = process.cwd();
    process.chdir(tmpdir());
    try {
      assert.equal(discoverRepoRoot(serverDir), repoRoot);
    } finally {
      process.chdir(previous);
    }
  });

  it('rejects unsafe and held-out source paths', () => {
    assert.equal(assertServableSourcePath('packages/registry/src/schema.ts'), 'packages/registry/src/schema.ts');
    for (const bad of [
      '../experiments/harness/secret.ts',
      '/absolute/path.ts',
      'C:/windows/path.ts',
      'packages/registry/src/../../experiments/harness/x.ts',
      'experiments/harness/steal.ts',
      'packages/harness/helper.ts',
      '',
    ]) {
      assert.throws(() => assertServableSourcePath(bad), /Refusing/, `should refuse ${JSON.stringify(bad)}`);
    }
  });

  it('search filters deterministically without touching the registry', () => {
    const selection = {
      trusted: [
        {
          id: 'b-comp', version: '0.1.0', capabilities: ['slot-guard'],
          runtime: { stack: 'node24+sqlite' }, invariants: ['Second invariant text.'],
        },
        {
          id: 'a-comp', version: '0.1.0', capabilities: ['slot-guard', 'extra'],
          runtime: { stack: 'other' }, invariants: ['First invariant text.'],
        },
      ],
      rejected: [],
    };
    const all = searchTrusted(selection, {});
    assert.deepEqual(all.components.map((c) => c.id), ['a-comp', 'b-comp']);
    assert.equal(searchTrusted(selection, { stack: 'other' }).components.length, 1);
    assert.equal(searchTrusted(selection, { capabilities: ['slot-guard', 'extra'] }).components.length, 1);
    assert.equal(searchTrusted(selection, { query: 'SECOND' }).components[0].id, 'b-comp');
    assert.equal(searchTrusted(selection, { query: 'no-such-text' }).components.length, 0);
    assert.equal(searchTrusted(selection, { limit: 1 }).components.length, 1);
  });

  it('bounds source payloads and refuses unlisted files', () => {
    const dir = scratchDir('src');
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'a.ts'), 'x'.repeat(5000), 'utf8');
    const manifest = {
      id: 'demo', version: '0.1.0', verification: { status: 'verified' },
    };
    const selection = {
      repoRoot: dir,
      all: [manifest],
      lib: {
        validateComponent: () => ({ valid: true, code: 'OK', reason: 'ok' }),
        sourceFilesForComponent: () => ['docs/a.ts'],
      },
    };
    const full = sourceTrustedComponent(selection, 'demo', '0.1.0', {});
    assert.equal(full.files.length, 1);
    assert.equal(full.files[0].truncated, false);
    const bounded = sourceTrustedComponent(selection, 'demo', '0.1.0', { maxBytesPerFile: 100, maxTotalBytes: 100 });
    assert.equal(bounded.files[0].truncated, true);
    assert.ok(bounded.files[0].content.length < 5000);
    assert.deepEqual(
      sourceTrustedComponent(selection, 'demo', '0.1.0', { maxBytesPerFile: 10 ** 9, maxTotalBytes: 10 ** 9 }).files[0].content.length,
      5000,
      'caller budgets are clamped to hard caps, not honored blindly',
    );
    const evil = {
      ...selection,
      lib: {
        validateComponent: () => ({ valid: true, code: 'OK', reason: 'ok' }),
        sourceFilesForComponent: () => ['../experiments/harness/steal.ts'],
      },
    };
    assert.throws(() => sourceTrustedComponent(evil, 'demo', '0.1.0', {}), /Refusing/);
  });
});

const REAL_COMPONENTS = [
  'booking-schema@0.1.0',
  'booking-slot-guard@0.1.0',
  'booking-validation@0.1.0',
  'registry-loader@0.1.0',
];
if (existsSync(join(realManifestDir, 'booking-reservation-kernel-0.2.0.json'))) {
  REAL_COMPONENTS.push('booking-reservation-kernel@0.2.0');
}
REAL_COMPONENTS.sort();

describe('librarian MCP tools against the certified registry', () => {
  it('lists ping plus the three librarian tools', async () => {
    await withClient({}, async (client) => {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, [
        'get_verified_component_source',
        'inspect_verified_component',
        'ping',
        'search_verified_components',
      ]);
    });
  });

  it('discovers all currently certified components with exact id/version', async () => {
    await withClient({}, async (client) => {
      const result = await callOk(client, 'search_verified_components', {});
      assert.equal(result.totalTrusted, REAL_COMPONENTS.length);
      assert.deepEqual(result.components.map((c) => `${c.id}@${c.version}`), REAL_COMPONENTS);
      for (const component of result.components) {
        assert.ok(component.capabilities.length > 0);
        assert.equal(component.stack, 'node24+sqlite');
        assert.ok(component.summary.length > 0);
      }
      assert.deepEqual(result.rejected, []);
    });
  });

  it('filters by capabilities, stack, and text query', async () => {
    await withClient({}, async (client) => {
      const byCapability = await callOk(client, 'search_verified_components', {
        capabilities: ['slot-guard'],
      });
      assert.deepEqual(byCapability.components.map((c) => c.id), ['booking-slot-guard']);

      const andSemantics = await callOk(client, 'search_verified_components', {
        capabilities: ['slot-guard', 'registry-loading'],
      });
      assert.equal(andSemantics.components.length, 0);

      const byStack = await callOk(client, 'search_verified_components', { stack: 'node24+sqlite' });
      assert.equal(byStack.components.length, REAL_COMPONENTS.length);
      const wrongStack = await callOk(client, 'search_verified_components', { stack: 'node20+postgres' });
      assert.equal(wrongStack.components.length, 0);

      const byQuery = await callOptSearch(client, 'cancellation');
      assert.ok(byQuery.components.some((c) => c.id === 'booking-slot-guard'));

      const limited = await callOk(client, 'search_verified_components', { limit: 2 });
      assert.equal(limited.components.length, 2);
      assert.equal(limited.totalTrusted, REAL_COMPONENTS.length);
    });
  });

  async function callOptSearch(client, query) {
    return callOk(client, 'search_verified_components', { query });
  }

  it('inspects every certified component contract', async () => {
    await withClient({}, async (client) => {
      for (const id of ['booking-schema', 'booking-validation', 'booking-slot-guard', 'registry-loader']) {
        const contract = await callOk(client, 'inspect_verified_component', { id, version: '0.1.0' });
        assert.equal(contract.id, id);
        assert.ok(contract.invariants.length > 0);
        assert.equal(contract.runtime.stack, 'node24+sqlite');
        assert.ok(contract.runtime.node.length > 0);
        assert.equal(contract.verification.status, 'verified');
        assert.ok(contract.verification.sourceHash?.length === 64);
        assert.equal(contract.evidence.outcome, 'pass');
        assert.equal(contract.evidence.exitCode, 0);
        assert.ok(contract.testScope.files.length > 0);
        assert.ok(contract.testScope.limitations.length > 0);
        assert.ok(contract.limitations.length > 0);
      }
      const guard = await callOk(client, 'inspect_verified_component', {
        id: 'booking-slot-guard', version: '0.1.0',
      });
      assert.deepEqual(guard.dependencies, [
        { id: 'booking-schema', version: '0.1.0' },
        { id: 'booking-validation', version: '0.1.0' },
      ]);
    });
  });

  it('retrieves bounded source including required local dependencies', async () => {
    await withClient({}, async (client) => {
      const loader = await callOk(client, 'get_verified_component_source', {
        id: 'registry-loader', version: '0.1.0',
      });
      assert.deepEqual(loader.files.map((f) => f.path), [
        'packages/registry/src/loader.ts',
        'packages/registry/src/manifest.ts',
      ]);
      assert.ok(loader.files.every((f) => f.truncated === false));

      const guard = await callOk(client, 'get_verified_component_source', {
        id: 'booking-slot-guard', version: '0.1.0',
      });
      const paths = guard.files.map((f) => f.path);
      assert.ok(paths.includes('packages/registry/src/slotGuard.ts'));
      assert.ok(paths.includes('packages/registry/src/validation.ts'));
      assert.ok(paths.includes('packages/registry/src/schema.ts'));
      const slotGuard = guard.files.find((f) => f.path.endsWith('slotGuard.ts'));
      assert.ok(slotGuard.content.includes('SlotConflictError'));
      for (const file of guard.files) {
        assert.ok(!file.path.includes('experiments') && !file.path.includes('harness'));
      }
    });
  });

  it('searches verified components with paraphrases while rejecting unrelated prose', async () => {
    await withClient({}, async (client) => {
      const cases = [
        // This EXACT query came from the failed Muse RES-001 C audit.
        // It must return the certified reservation kernel without guessing
        // which synonyms or generic API terms the coding agent will use.
        ['reservation booking appointment API', 'booking-reservation-kernel'],
        ['build a reservation booking appointment API', 'booking-reservation-kernel'],
        ['appointment idempotency', 'booking-reservation-kernel'],
        ['idempotent reservations', 'booking-reservation-kernel'],
        ['booking schema', 'booking-schema'],
        ['30-minute booking slot', 'booking-slot-guard'],
      ];
      for (const [query, expected] of cases) {
        const found = await callOk(client, 'search_verified_components', { query });
        assert.ok(found.components.some(component => component.id === expected), query);
        assert.deepEqual(found.rejected, [], 'verified catalog must remain trusted');
      }
      const exactMuseQuery = await callOk(client, 'search_verified_components', {
        query: 'reservation booking appointment API',
      });
      assert.equal(exactMuseQuery.components[0].id, 'booking-reservation-kernel',
        'V2 kernel should be first in the response for the actual Muse query');
      for (const query of [
        'interplanetary coffee roasting',
        'booking slot interplanetary coffee roasting',
        'coffee roasting API',
        'generic API server',
      ]) {
        const found = await callOk(client, 'search_verified_components', { query });
        assert.equal(found.components.length, 0, 'false-positive search: ' + query);
      }
    });
  });

  it('turns the actual failed Muse search into verified full-source retrieval', async () => {
    await withClient({}, async (client) => {
      const results = await callOk(client, 'search_verified_components', {
        query: 'reservation booking appointment API',
      });
      const discovered = results.components[0];
      assert.ok(discovered, 'exact Muse query returned no component');
      assert.equal(discovered.id, 'booking-reservation-kernel');
      assert.equal(discovered.version, '0.2.0');

      // Do not hardcode the id/version in downstream steps: use the returned
      // search result, as an actual coding agent should.
      const args = { id: discovered.id, version: discovered.version };
      const contract = await callOk(client, 'inspect_verified_component', args);
      assert.equal(contract.verification.status, 'verified');
      assert.equal(contract.verification.sourceHash, contract.evidence.sections.sources);

      const source = await callOk(client, 'get_verified_component_source', {
        ...args,
        maxBytesPerFile: 20000,
        maxTotalBytes: 100000,
      });
      assert.equal(source.truncated, false);
      assert.ok(source.files.some(file => file.path.endsWith('/reservationKernelV2.ts')));
      assert.ok(source.files.every(file => !file.truncated));
      assert.equal(source.files.length, 4);
    });
  });

  it('MCP discovers, inspects and retrieves the complete verified V2 kernel', async () => {
    await withClient({}, async (client) => {
      const discovered = await callOk(client, 'search_verified_components', {
        capabilities: ['idempotent-booking', 'multi-process-sqlite'],
      });
      assert.deepEqual(
        discovered.components.map((component) => component.id + '@' + component.version),
        ['booking-reservation-kernel@0.2.0'],
        'V2 must be discoverable by its certified capabilities'
      );
      assert.equal(discovered.totalTrusted, REAL_COMPONENTS.length);

      const contract = await callOk(client, 'inspect_verified_component', {
        id: 'booking-reservation-kernel', version: '0.2.0',
      });
      assert.equal(contract.verification.status, 'verified');
      assert.equal(contract.evidence.outcome, 'pass');
      assert.equal(contract.evidence.exitCode, 0);
      assert.equal(contract.verification.sourceHash, contract.evidence.sections.sources);
      assert.equal(contract.testScope.commandKey, 'registry:reservation-v2-tests');
      assert.ok(contract.testScope.files.includes(
        'packages/registry/tests/booking-reservation-kernel.test.mjs'
      ));
      assert.deepEqual(contract.dependencies, [{ id: 'booking-slot-guard', version: '0.1.0' }]);

      const retrieved = await callOk(client, 'get_verified_component_source', {
        id: 'booking-reservation-kernel', version: '0.2.0',
        maxBytesPerFile: 20000, maxTotalBytes: 100000,
      });
      const actualPaths = retrieved.files.map(file => file.path).sort();
      assert.deepEqual(actualPaths, [
        'packages/registry/src/reservationKernelV2.ts',
        'packages/registry/src/schema.ts',
        'packages/registry/src/slotGuard.ts',
        'packages/registry/src/validation.ts',
      ].sort());
      assert.equal(retrieved.truncated, false, 'entire V2 component closure must be available');
      assert.ok(retrieved.files.every(file => file.truncated === false));
      for (const file of retrieved.files) {
        const diskContent = readFileSync(join(repoRoot, ...file.path.split('/')), 'utf8');
        assert.equal(file.content, diskContent, 'MCP source bytes must match checkout: ' + file.path);
        assert.equal(file.bytes, diskContent.length, 'MCP source length must match checkout: ' + file.path);
      }
      assert.ok(
        retrieved.files.find(file => file.path.endsWith('/reservationKernelV2.ts'))
          ?.content.includes('createIdempotentBooking'),
        'retrieved V2 source must contain the actual new implementation'
      );
    });
  });

  it('records independent MCP provenance without logging source text', async () => {
    const auditPath = join(scratchDir('audit'), 'trace.jsonl');
    await withClient({ SILKWEB_AUDIT_LOG: auditPath }, async (client) => {
      await callOk(client, 'search_verified_components', {
        capabilities: ['idempotent-booking'],
      });
      await callOk(client, 'inspect_verified_component', {
        id: 'booking-reservation-kernel', version: '0.2.0',
      });
      await callOk(client, 'get_verified_component_source', {
        id: 'booking-reservation-kernel', version: '0.2.0',
        maxBytesPerFile: 20000, maxTotalBytes: 100000,
      });
      await callErr(client, 'inspect_verified_component', {
        id: 'not-a-real-component', version: '0.2.0',
      });
    });
    const raw = readFileSync(auditPath, 'utf8');
    assert.ok(!raw.includes('createIdempotentBooking('), 'source bodies must not be recorded');
    const events = raw.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.deepEqual(events.map(event => event.tool), [
      'search_verified_components',
      'inspect_verified_component',
      'get_verified_component_source',
      'inspect_verified_component',
    ]);
    assert.deepEqual(events.map(event => event.status), [
      'success', 'success', 'success', 'failure',
    ]);
    assert.equal(events[3].errorCode, 'NOT_FOUND');
    const retrieved = events[2];
    assert.equal(retrieved.truncated, false);
    assert.equal(retrieved.files.length, 4);
    for (const file of retrieved.files) {
      assert.equal(file.truncated, false);
      assert.equal(
        file.sha256,
        createHash('sha256')
          .update(readFileSync(join(repoRoot, ...file.path.split('/'))))
          .digest('hex'),
        'audit fingerprint must match retrieved source: ' + file.path
      );
    }
  });

  it('fails closed for wrong id/version without leaking source', async () => {
    await withClient({}, async (client) => {
      for (const args of [
        { id: 'no-such-component', version: '0.1.0' },
        { id: 'booking-schema', version: '9.9.9' },
      ]) {
        const inspectMsg = await callErr(client, 'inspect_verified_component', args);
        assert.match(inspectMsg, /NOT_FOUND/);
        const sourceMsg = await callErr(client, 'get_verified_component_source', args);
        assert.match(sourceMsg, /NOT_FOUND/);
        assert.ok(!sourceMsg.includes('CREATE TABLE'));
      }
    });
  });
});

describe('librarian fail-closed fixtures (isolated, real records untouched)', () => {
  it('rejects a forged verified status without valid evidence', async () => {
    const forged = readManifest('booking-schema', '0.1.0');
    forged.verification.sourceHash = '0'.repeat(64);
    const dir = fixtureManifestDir({ 'booking-schema-0.1.0.json': forged });
    await withClient({ SILKWEB_MANIFEST_DIR: dir }, async (client) => {
      const result = await callOk(client, 'search_verified_components', {});
      assert.equal(result.components.length, 0);
      assert.deepEqual(result.rejected.map((r) => r.code), ['SOURCE_HASH_MISMATCH']);
      const msg = await callErr(client, 'get_verified_component_source', {
        id: 'booking-schema', version: '0.1.0',
      });
      assert.match(msg, /SOURCE_HASH_MISMATCH/);
      assert.ok(!msg.includes('CREATE TABLE'));
    });
  });

  it('rejects stale evidence after the manifest changes', async () => {
    const stale = readManifest('booking-validation', '0.1.0');
    stale.invariants = [...stale.invariants, 'Forged invariant added after certification.'];
    const dir = fixtureManifestDir({
      'booking-schema-0.1.0.json': readManifest('booking-schema', '0.1.0'),
      'booking-validation-0.1.0.json': stale,
    });
    await withClient({ SILKWEB_MANIFEST_DIR: dir }, async (client) => {
      const result = await callOk(client, 'search_verified_components', {});
      assert.deepEqual(result.components.map((c) => c.id), ['booking-schema']);
      assert.deepEqual(
        result.rejected.filter((r) => r.id === 'booking-validation').map((r) => r.code),
        ['STALE_EVIDENCE'],
      );
      const msg = await callErr(client, 'inspect_verified_component', {
        id: 'booking-validation', version: '0.1.0',
      });
      assert.match(msg, /STALE_EVIDENCE/);
    });
  });

  it('rejects a verified claim with missing evidence', async () => {
    const ghost = readManifest('booking-schema', '0.1.0');
    ghost.id = 'fixture-ghost';
    ghost.verification.evidence = 'registry-data/evidence/fixture-ghost-0.1.0.json';
    const dir = fixtureManifestDir({ 'fixture-ghost-0.1.0.json': ghost });
    await withClient({ SILKWEB_MANIFEST_DIR: dir }, async (client) => {
      const msg = await callErr(client, 'get_verified_component_source', {
        id: 'fixture-ghost', version: '0.1.0',
      });
      assert.match(msg, /MISSING_EVIDENCE/);
      assert.ok(!msg.includes('CREATE TABLE'));
    });
  });

  it('rejects an unverified manifest even though the label is the only change', async () => {
    const flipped = readManifest('registry-loader', '0.1.0');
    flipped.verification.status = 'unverified';
    const dir = fixtureManifestDir({ 'registry-loader-0.1.0.json': flipped });
    await withClient({ SILKWEB_MANIFEST_DIR: dir }, async (client) => {
      const result = await callOk(client, 'search_verified_components', {});
      assert.equal(result.components.length, 0);
      const msg = await callErr(client, 'get_verified_component_source', {
        id: 'registry-loader', version: '0.1.0',
      });
      assert.match(msg, /(UNVERIFIED|STALE_EVIDENCE)/);
      assert.ok(!msg.includes('readdirSync'));
    });
  });

  it('never serves source through an unsafe sourcePath', async () => {
    const evil = readManifest('booking-schema', '0.1.0');
    evil.id = 'fixture-evil';
    evil.sourcePath = '../experiments/harness/steal.ts';
    evil.verification.evidence = 'registry-data/evidence/fixture-evil-0.1.0.json';
    const dir = fixtureManifestDir({ 'fixture-evil-0.1.0.json': evil });
    await withClient({ SILKWEB_MANIFEST_DIR: dir }, async (client) => {
      const msg = await callErr(client, 'get_verified_component_source', {
        id: 'fixture-evil', version: '0.1.0',
      });
      assert.match(msg, /(MISSING_EVIDENCE|UNSAFE_PATH|FINGERPRINT_ERROR|MISSING_FILE)/);
      assert.ok(!msg.includes('steal'));
    });
  });
});

