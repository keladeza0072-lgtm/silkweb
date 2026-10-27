import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Scratch space lives inside the workspace because the sandbox runner
// cannot write to the OS temp directory. Everything this suite writes
// (fixture checkouts AND fixture evidence) stays under tests/tmp, which
// is gitignored — real evidence in registry-data/evidence is never touched.
const here = dirname(fileURLToPath(import.meta.url));
const SCRATCH = join(here, 'tmp');
mkdirSync(SCRATCH, { recursive: true });
const REAL_EVIDENCE_DIR = join(here, '..', '..', '..', 'registry-data', 'evidence');

import {
  computeArtifactFingerprint,
  resolveEvidencePath,
  readEvidenceFile,
  writeEvidenceFile,
  runVerification,
  validateComponent,
  selectVerifiedManifests,
  EVIDENCE_SCHEMA_VERSION,
  FingerprintError,
  RunnerError,
} from '../dist/index.js';

const NODE = process.execPath;

const PASS_TEST_BODY = `import { describe, it } from 'node:test';
describe('fixture', () => { it('passes', () => {}); });
`;
const FAIL_TEST_BODY = `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
describe('fixture', () => { it('fails', () => { assert.equal(1, 2); }); });
`;

const LOCKFILE_BODY = (zodVersion) =>
  JSON.stringify(
    {
      name: '@silkweb/fixture',
      version: '0.1.0',
      lockfileVersion: 3,
      packages: {
        '': { name: '@silkweb/fixture', version: '0.1.0', dependencies: { zod: zodVersion } },
        'node_modules/zod': { version: zodVersion },
      },
    },
    null,
    2,
  );

const PACKAGE_JSON_BODY = (zodVersion) =>
  JSON.stringify(
    {
      name: '@silkweb/fixture',
      version: '0.1.0',
      type: 'module',
      dependencies: { zod: zodVersion },
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

const WIDGET_SOURCE = `export function widget(): string { return 'widget'; }\n`;

/** Build an isolated fixture checkout mimicking the real repo layout. */
function makeFixtureRepo({ sourceBody = WIDGET_SOURCE, testBody = PASS_TEST_BODY, zodVersion = '4.6.7' } = {}) {
  const root = mkdtempSync(join(SCRATCH, 'verify-'));
  const files = {
    'packages/registry/src/widget.ts': sourceBody,
    'packages/registry/tests/fixture-widget.test.mjs': testBody,
    'packages/registry/package.json': PACKAGE_JSON_BODY(zodVersion),
    'packages/registry/package-lock.json': LOCKFILE_BODY(zodVersion),
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
  'fixture:fail': {
    command: 'node --test tests/fixture-fail.test.mjs',
    cwdRel: 'packages/registry',
    argv: [NODE, '--test', 'tests/fixture-fail.test.mjs'],
    limitations: 'Fixture-only failing test; sequential same-process execution.',
  },
};

const EVIDENCE_DIR = 'registry-data/evidence';
let repoRoot;
let manifest;
beforeEach(() => {
  repoRoot = makeFixtureRepo();
  manifest = manifestFor();
});

describe('registry verification engine', () => {
  it('produces deterministic fingerprints independent of input order and checkout path', () => {
    const manifests = [manifest, manifestFor({ id: 'fixture-other' })];
    const first = computeArtifactFingerprint(repoRoot, manifest, manifests);
    const second = computeArtifactFingerprint(repoRoot, manifest, [...manifests].reverse());
    assert.equal(first.fingerprint, second.fingerprint);
    assert.deepEqual(first.sections, second.sections);
    assert.match(first.fingerprint, /^[0-9a-f]{64}$/);

    const twinRoot = makeFixtureRepo();
    const twin = computeArtifactFingerprint(twinRoot, manifest, manifests);
    assert.equal(twin.fingerprint, first.fingerprint);
  });

  it('excludes mutable verification results from the fingerprint', () => {
    const claimed = manifestFor({
      verification: {
        status: 'verified',
        testCommand: 'anything at all',
        sourceHash: '0'.repeat(64),
        evidence: 'forged claim',
      },
    });
    assert.equal(
      computeArtifactFingerprint(repoRoot, claimed, [claimed]).fingerprint,
      computeArtifactFingerprint(repoRoot, manifest, [manifest]).fingerprint,
    );
  });

  it('verifies a component end to end after an actual successful run', () => {
    const run = runVerification(repoRoot, manifest, [manifest], {
      commandKey: 'fixture:pass',
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(run.passed, true);
    assert.equal(run.evidence.outcome, 'pass');
    assert.equal(run.evidence.exitCode, 0);
    assert.equal(run.evidence.schemaVersion, EVIDENCE_SCHEMA_VERSION);
    assert.equal(run.evidence.componentId, 'fixture-widget');
    assert.equal(run.evidence.testScope.commandKey, 'fixture:pass');
    assert.ok(run.evidence.nodeVersion.length > 0);
    assert.ok(run.evidence.sqliteVersion.length > 0);
    assert.ok(!Number.isNaN(Date.parse(run.evidence.executedAt)));
    assert.ok(run.evidence.testScope.limitations.length > 0);

    const stored = readEvidenceFile(run.evidencePath);
    assert.deepEqual(stored, run.evidence);

    const check = validateComponent(repoRoot, manifest, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(check.valid, true);
    assert.equal(check.code, 'OK');

    const selection = selectVerifiedManifests(repoRoot, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.deepEqual(selection.verified.map((m) => m.id), ['fixture-widget']);
    assert.deepEqual(selection.rejected, []);
  });

  it('rejects evidence after the source changes', () => {
    runVerification(repoRoot, manifest, [manifest], {
      commandKey: 'fixture:pass',
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    appendFileSync(join(repoRoot, 'packages/registry/src/widget.ts'), '// behavior change\n', 'utf8');
    const check = validateComponent(repoRoot, manifest, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(check.valid, false);
    assert.equal(check.code, 'STALE_EVIDENCE');
    assert.match(check.reason, /sources/);
  });

  it('rejects evidence after the lockfile or declared dependencies change', () => {
    const pinned = manifestFor({ runtime: { stack: 'node24+sqlite', node: '>=24', dependencies: { zod: '4.6.7' } } });
    runVerification(repoRoot, pinned, [pinned], {
      commandKey: 'fixture:pass',
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    // Case A: lockfile no longer pins the declared dependency version.
    writeFileSync(join(repoRoot, 'packages/registry/package-lock.json'), LOCKFILE_BODY('4.6.8'), 'utf8');
    const mismatch = validateComponent(repoRoot, pinned, [pinned], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(mismatch.valid, false);
    assert.equal(mismatch.code, 'DEPENDENCY_MISMATCH');

    // Case B: lockfile bytes change without touching the pinned version.
    writeFileSync(
      join(repoRoot, 'packages/registry/package-lock.json'),
      `${LOCKFILE_BODY('4.6.7').trim()}\n`,
      'utf8',
    );
    const stale = validateComponent(repoRoot, pinned, [pinned], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(stale.valid, false);
    assert.equal(stale.code, 'STALE_EVIDENCE');
    assert.match(stale.reason, /lockfile/);
  });

  it('rejects evidence after the tests change', () => {
    runVerification(repoRoot, manifest, [manifest], {
      commandKey: 'fixture:pass',
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    appendFileSync(
      join(repoRoot, 'packages/registry/tests/fixture-widget.test.mjs'),
      '// scope change\n',
      'utf8',
    );
    const check = validateComponent(repoRoot, manifest, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(check.valid, false);
    assert.equal(check.code, 'STALE_EVIDENCE');
    assert.match(check.reason, /tests/);
  });

  it('fails closed when evidence is missing', () => {
    const check = validateComponent(repoRoot, manifest, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(check.valid, false);
    assert.equal(check.code, 'MISSING_EVIDENCE');
    const selection = selectVerifiedManifests(repoRoot, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.deepEqual(selection.verified, []);
    assert.equal(selection.rejected.length, 1);
    assert.match(selection.rejected[0].reason, /No readable evidence/);
  });

  it('preserves failed test executions as failures', () => {
    // NOTE: this test itself runs inside `node --test`, so the runner's
    // child is a nested test process — exactly the case where Node would
    // swallow the failure exit code without NODE_TEST_* scrubbing.
    const failRoot = makeFixtureRepo({ testBody: FAIL_TEST_BODY });
    const failManifest = manifestFor({
      id: 'fixture-fail',
      sourcePath: 'packages/registry/src/widget.ts',
      verification: { status: 'unverified', testCommand: 'x', evidence: 'y' },
    });
    writeFileSync(
      join(failRoot, 'packages/registry/tests/fixture-fail.test.mjs'),
      FAIL_TEST_BODY,
      'utf8',
    );
    const run = runVerification(failRoot, failManifest, [failManifest], {
      commandKey: 'fixture:fail',
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(run.passed, false);
    assert.equal(run.evidence.outcome, 'fail');
    assert.notEqual(run.evidence.exitCode, 0);
    const check = validateComponent(failRoot, failManifest, [failManifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(check.valid, false);
    assert.equal(check.code, 'FAILED_TEST_EXECUTION');
  });

  it('rejects forged verified claims with an explicit reason', () => {
    const forged = manifestFor({ verification: { status: 'verified', testCommand: 'x', evidence: 'trust me' } });
    const selection = selectVerifiedManifests(repoRoot, [forged], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.deepEqual(selection.verified, []);
    assert.equal(selection.rejected.length, 1);
    assert.match(selection.rejected[0].reason, /claims verification\.status="verified"/);

    // Hand-written evidence with a wrong fingerprint is equally rejected.
    const run = runVerification(repoRoot, manifest, [manifest], {
      commandKey: 'fixture:pass',
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    const tampered = { ...run.evidence, artifactFingerprint: '1'.repeat(64) };
    writeEvidenceFile(
      resolveEvidencePath(repoRoot, EVIDENCE_DIR, forged.id, forged.version),
      { ...tampered, componentId: forged.id, componentVersion: forged.version },
    );
    const retry = validateComponent(repoRoot, forged, [forged], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(retry.valid, false);
    assert.equal(retry.code, 'STALE_EVIDENCE');
    assert.equal(retry.unsubstantiatedClaim, true);
  });

  it('rejects missing or incompatible dependencies', () => {
    const ghost = manifestFor({
      id: 'fixture-needy',
      dependencies: [{ id: 'fixture-ghost', version: '0.1.0' }],
    });
    assert.throws(
      () => computeArtifactFingerprint(repoRoot, ghost, [ghost]),
      (error) => error instanceof FingerprintError && error.code === 'MISSING_DEPENDENCY',
    );
    const missing = validateComponent(repoRoot, ghost, [ghost], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(missing.valid, false);
    assert.equal(missing.code, 'MISSING_DEPENDENCY');

    const wrongVersion = manifestFor({
      id: 'fixture-needy',
      dependencies: [{ id: 'fixture-widget', version: '9.9.9' }],
    });
    const incompatible = validateComponent(repoRoot, wrongVersion, [wrongVersion, manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(incompatible.valid, false);
    assert.equal(incompatible.code, 'MISSING_DEPENDENCY');
  });

  it('rejects unsafe paths and never executes manifest-supplied commands', () => {
    for (const sourcePath of ['../evil.ts', '/etc/passwd', '..\\..\\evil.ts', 'packages/registry/src/../../evil.ts']) {
      const evil = manifestFor({ sourcePath });
      assert.throws(
        () => computeArtifactFingerprint(repoRoot, evil, [evil]),
        (error) => error instanceof FingerprintError && error.code === 'UNSAFE_PATH',
        `expected UNSAFE_PATH for ${sourcePath}`,
      );
    }
    const injected = manifestFor({
      verification: {
        status: 'unverified',
        testCommand: 'node --test tests/fixture-widget.test.mjs; echo PWNED',
        evidence: 'malicious manifest command must never run',
      },
    });
    const run = runVerification(repoRoot, injected, [injected], {
      commandKey: 'fixture:pass',
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    assert.equal(run.passed, true);
    assert.equal(run.evidence.testScope.command, 'node --test tests/fixture-widget.test.mjs');
    assert.ok(!run.evidence.testScope.command.includes('PWNED'));
    assert.throws(
      () =>
        runVerification(repoRoot, manifest, [manifest], {
          commandKey: 'fixture:pass; echo PWNED',
          evidenceDir: EVIDENCE_DIR,
          allowlist: fixtureAllowlist,
        }),
      (error) => error instanceof RunnerError && error.code === 'UNKNOWN_TEST_COMMAND',
    );
  });

  it('keeps test evidence isolated from real evidence records', () => {
    runVerification(repoRoot, manifest, [manifest], {
      commandKey: 'fixture:pass',
      evidenceDir: EVIDENCE_DIR,
      allowlist: fixtureAllowlist,
    });
    mkdirSync(REAL_EVIDENCE_DIR, { recursive: true });
    const realFiles = readdirSync(REAL_EVIDENCE_DIR).filter((name) => name.endsWith('.json'));
    assert.deepEqual(realFiles, []);
  });
});
