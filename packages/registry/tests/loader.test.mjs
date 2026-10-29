import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Scratch space lives inside the workspace because the sandbox runner
// cannot write to the OS temp directory.
const SCRATCH = join(dirname(fileURLToPath(import.meta.url)), 'tmp');
mkdirSync(SCRATCH, { recursive: true });
import {
  loadRegistry,
  filterRegistry,
  RegistryLoadError,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
// Tests live in packages/registry/tests; manifests in registry-data/manifests.
const MANIFEST_DIR = join(here, '..', '..', '..', 'registry-data', 'manifests');

describe('registry-loader@0.1.0', () => {
  it('loads all manifests deterministically, sorted by (id, version)', () => {
    const first = loadRegistry(MANIFEST_DIR);
    const second = loadRegistry(MANIFEST_DIR);
    assert.deepEqual(first, second);
    assert.deepEqual(
      first.map((m) => `${m.id}@${m.version}`),
      [
        'booking-reservation-kernel@0.2.0',
        'booking-schema@0.1.0',
        'booking-slot-guard@0.1.0',
        'booking-validation@0.1.0',
        'registry-loader@0.1.0',
      ],
    );
  });

  it('filters by exact version only (no ranges, no coercion)', () => {
    const manifests = loadRegistry(MANIFEST_DIR);
    assert.equal(filterRegistry(manifests, { id: 'booking-schema', version: '0.1.0' }).length, 1);
    assert.deepEqual(
      filterRegistry(manifests, { version: '0.2.0' }).map((m) => m.id),
      ['booking-reservation-kernel'],
    );
    assert.equal(filterRegistry(manifests, { id: 'booking-schema', version: '0.1' }).length, 0);
    assert.equal(filterRegistry(manifests, { version: '^0.1.0' }).length, 0);
  });

  it('filters by exact stack', () => {
    const manifests = loadRegistry(MANIFEST_DIR);
    assert.equal(filterRegistry(manifests, { stack: 'node24+sqlite' }).length, 5);
    assert.equal(filterRegistry(manifests, { stack: 'node20+sqlite' }).length, 0);
    assert.equal(filterRegistry(manifests, { stack: 'node24' }).length, 0);
  });

  it('filters by capabilities with AND semantics', () => {
    const manifests = loadRegistry(MANIFEST_DIR);
    const guard = filterRegistry(manifests, { capabilities: ['slot-guard'] });
    assert.deepEqual(guard.map((m) => m.id), ['booking-slot-guard']);
    const multi = filterRegistry(manifests, { capabilities: ['booking-creation', 'booking-cancellation'] });
    assert.deepEqual(multi.map((m) => m.id), ['booking-slot-guard']);
    assert.equal(filterRegistry(manifests, { capabilities: ['slot-guard', 'nope'] }).length, 0);
    assert.equal(filterRegistry(manifests, { capabilities: [] }).length, 5);
  });

  it('filters by exact dependencies', () => {
    const manifests = loadRegistry(MANIFEST_DIR);
    const users = filterRegistry(manifests, {
      dependencies: [{ id: 'booking-schema', version: '0.1.0' }],
    });
    assert.deepEqual(users.map((m) => m.id), ['booking-slot-guard', 'booking-validation']);
    assert.equal(
      filterRegistry(manifests, { dependencies: [{ id: 'booking-schema', version: '9.9.9' }] }).length,
      0,
    );
    assert.equal(
      filterRegistry(manifests, { dependencies: [{ id: 'booking-schema', version: '0.1' }] }).length,
      0,
    );
  });

  it('sorts results by (id, version) regardless of input order', () => {
    const manifests = loadRegistry(MANIFEST_DIR);
    const reversed = filterRegistry([...manifests].reverse(), {});
    assert.deepEqual(
      reversed.map((m) => m.id),
      ['booking-reservation-kernel', 'booking-schema', 'booking-slot-guard', 'booking-validation', 'registry-loader'],
    );
  });

  it('rejects unparsable JSON, schema violations and unknown fields', () => {
    const dir = mkdtempSync(join(SCRATCH, 'silkweb-reg-'));
    try {
      writeFileSync(join(dir, 'bad-json.json'), '{oops');
      writeFileSync(join(dir, 'missing-fields.json'), JSON.stringify({ id: 'x' }));
      writeFileSync(
        join(dir, 'extra-field.json'),
        JSON.stringify({
          id: 'x', version: '0.1.0', sourcePath: 's', dependencies: [], capabilities: [],
          invariants: [], runtime: { stack: 's', node: 'n', dependencies: {} },
          verification: { status: 'unverified', testCommand: 't', evidence: 'e' },
          surprise: 1,
        }),
      );
      assert.throws(() => loadRegistry(dir), RegistryLoadError);
      try {
        loadRegistry(dir);
        assert.fail('should have thrown');
      } catch (error) {
        assert.ok(error instanceof RegistryLoadError);
        assert.match(error.message, /bad-json\.json/);
        assert.match(error.message, /missing-fields\.json/);
        assert.match(error.message, /extra-field\.json/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads an empty directory as an empty registry', () => {
    const dir = mkdtempSync(join(SCRATCH, 'silkweb-reg-empty-'));
    try {
      assert.deepEqual(loadRegistry(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws RegistryLoadError for a missing directory', () => {
    assert.throws(() => loadRegistry(join(MANIFEST_DIR, 'does-not-exist')), RegistryLoadError);
  });
});
