import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// All fixture checkouts and fixture evidence stay under tests/tmp
// (gitignored). Real evidence in registry-data/evidence is never written.
const here = dirname(fileURLToPath(import.meta.url));
const SCRATCH = join(here, 'tmp');
mkdirSync(SCRATCH, { recursive: true });
const REAL_EVIDENCE_DIR = join(here, '..', '..', '..', 'registry-data', 'evidence');

import {
  computeArtifactFingerprint,
  runVerification,
  validateComponent,
} from '../dist/index.js';

const NODE = process.execPath;

const PASS_TEST_BODY = `import { describe, it } from 'node:test';
describe('fixture', () => { it('passes', () => {}); });
`;

const LOCKFILE_BODY = JSON.stringify(
  {
    name: '@silkweb/fixture',
    version: '0.1.0',
    lockfileVersion: 3,
    packages: {
      '': { name: '@silkweb/fixture', version: '0.1.0' },
    },
  },
  null,
  2,
);

const PACKAGE_JSON_BODY = JSON.stringify(
  {
    name: '@silkweb/fixture',
    version: '0.1.0',
    type: 'module',
    engines: { node: '>=24' },
  },
  null,
  2,
);

const manifestFor = (overrides = {}) => ({
  id: 'fixture-widget',
  version: '0.1.0',
  sourcePath: 'packages/registry/src/widget.ts',
  dependencies: [],
  capabilities: ['fixture-cap'],
  invariants: ['Does fixture things.'],
  runtime: { stack: 'node24+sqlite', node: '>=24', dependencies: {} },
  verification: {
    status: 'unverified',
    testCommand: 'node --test tests/fixture-widget.test.mjs',
    evidence: 'Fixture manifest; makes no real verification claim.',
  },
  ...overrides,
});

function makeFixtureRepo() {
  const root = mkdtempSync(join(SCRATCH, 'cert-'));
  const files = {
    'packages/registry/src/widget.ts': `export function widget(): string { return 'widget'; }\n`,
    'packages/registry/tests/fixture-widget.test.mjs': PASS_TEST_BODY,
    'packages/registry/package.json': PACKAGE_JSON_BODY,
    'packages/registry/package-lock.json': LOCKFILE_BODY,
  };
  for (const [rel, body] of Object.entries(files)) {
    const absolute = join(root, ...rel.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, body, 'utf8');
  }
  return root;
}

const fixtureAllowlist = {
  'fixture:pass': {
    command: 'node --test tests/fixture-widget.test.mjs',
    cwdRel: 'packages/registry',
    argv: [NODE, '--test', 'tests/fixture-widget.test.mjs'],
    limitations: 'Fixture-only passing test; sequential same-process execution.',
  },
};

const EVIDENCE_DIR = 'registry-data/evidence';
const canonicalRef = (id, version) => `${EVIDENCE_DIR}/${id}-${version}.json`;

let repoRoot;
let manifest;
beforeEach(() => {
  repoRoot = makeFixtureRepo();
  manifest = manifestFor();
});

function verifyWithEvidence() {
  const run = runVerification(repoRoot, manifest, [manifest], {
    commandKey: 'fixture:pass',
    evidenceDir: EVIDENCE_DIR,
    allowlist: fixtureAllowlist,
  });
  assert.equal(run.passed, true);
  return run;
}

describe('manifest certification integrity (isolated fixtures)', () => {
  it('verified without a sourceHash fails closed with MISSING_SOURCE_HASH', () => {
    verifyWithEvidence();
    const claimed = manifestFor({
      verification: { status: 'verified', testCommand: 'x', evidence: canonicalRef('fixture-widget', '0.1.0') },
    });
    const check = validateComponent(repoRoot, claimed, [claimed], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(check.valid, false);
    assert.equal(check.code, 'MISSING_SOURCE_HASH');
    assert.equal(check.unsubstantiatedClaim, true);
  });

  it('verified with a malformed sourceHash fails closed with MISSING_SOURCE_HASH', () => {
    verifyWithEvidence();
    const claimed = manifestFor({
      verification: {
        status: 'verified',
        testCommand: 'x',
        sourceHash: 'not-a-hash',
        evidence: canonicalRef('fixture-widget', '0.1.0'),
      },
    });
    const check = validateComponent(repoRoot, claimed, [claimed], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(check.valid, false);
    assert.equal(check.code, 'MISSING_SOURCE_HASH');
  });

  it('verified with a non-canonical evidence reference fails with EVIDENCE_REF_MISMATCH', () => {
    verifyWithEvidence();
    const sources = computeArtifactFingerprint(repoRoot, manifest, [manifest]).sections.sources;
    const claimed = manifestFor({
      verification: {
        status: 'verified',
        testCommand: 'x',
        sourceHash: sources,
        evidence: 'trust me',
      },
    });
    const check = validateComponent(repoRoot, claimed, [claimed], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(check.valid, false);
    assert.equal(check.code, 'EVIDENCE_REF_MISMATCH');
    assert.equal(check.unsubstantiatedClaim, true);
  });

  it('verified with a mismatched sourceHash fails with SOURCE_HASH_MISMATCH', () => {
    verifyWithEvidence();
    const claimed = manifestFor({
      verification: {
        status: 'verified',
        testCommand: 'x',
        sourceHash: '0'.repeat(64),
        evidence: canonicalRef('fixture-widget', '0.1.0'),
      },
    });
    const check = validateComponent(repoRoot, claimed, [claimed], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(check.valid, false);
    assert.equal(check.code, 'SOURCE_HASH_MISMATCH');
  });

  it('verified with correct sourceHash and canonical reference validates', () => {
    verifyWithEvidence();
    const sources = computeArtifactFingerprint(repoRoot, manifest, [manifest]).sections.sources;
    const claimed = manifestFor({
      verification: {
        status: 'verified',
        testCommand: 'node --test tests/fixture-widget.test.mjs',
        sourceHash: sources,
        evidence: canonicalRef('fixture-widget', '0.1.0'),
      },
    });
    const check = validateComponent(repoRoot, claimed, [claimed], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(check.valid, true);
    assert.equal(check.code, 'OK');
    assert.equal(check.unsubstantiatedClaim, false);
  });

  it('unverified with valid evidence needs no certification metadata', () => {
    verifyWithEvidence();
    const check = validateComponent(repoRoot, manifest, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(check.valid, true);
    assert.equal(check.code, 'OK');
  });

  it('certification probes leave real evidence untouched', () => {
    mkdirSync(REAL_EVIDENCE_DIR, { recursive: true });
    const snapshot = () =>
      new Map(
        readdirSync(REAL_EVIDENCE_DIR)
          .filter((name) => name.endsWith('.json'))
          .sort()
          .map((name) => [name, readFileSync(join(REAL_EVIDENCE_DIR, name), 'utf8')]),
      );
    const before = snapshot();
    verifyWithEvidence();
    assert.deepEqual(snapshot(), before, 'certification fixtures must not modify real evidence');
  });
});
