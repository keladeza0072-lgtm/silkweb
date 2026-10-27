import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Scratch space lives inside the workspace because the sandbox runner
// cannot write to the OS temp directory. Everything this suite writes
// (fixture checkouts AND fixture evidence) stays under tests/tmp, which
// is gitignored — real evidence in registry-data/evidence is never touched.
const here = dirname(fileURLToPath(import.meta.url));
const SCRATCH = join(here, 'tmp');
mkdirSync(SCRATCH, { recursive: true });
const REAL_ROOT = join(here, '..', '..', '..');
const REAL_TSC = join(REAL_ROOT, 'packages', 'registry', 'node_modules', 'typescript', 'bin', 'tsc');
const REAL_MANIFEST_DIR = join(REAL_ROOT, 'registry-data', 'manifests');
const REAL_EVIDENCE_DIR = join(REAL_ROOT, 'registry-data', 'evidence');

import {
  computeArtifactFingerprint,
  sourceFilesForComponent,
  closureTestFiles,
  allowedCommandsFor,
  resolveEvidencePath,
  writeEvidenceFile,
  runVerification,
  validateComponent,
  loadRegistry,
  COMPONENT_EXTRA_SOURCES,
  RunnerError,
} from '../dist/index.js';

const NODE = process.execPath;

const PASS_TEST_BODY = `import { describe, it } from 'node:test';
describe('fixture', () => { it('passes', () => {}); });
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

const TSCONFIG_BODY = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      rootDir: 'src',
      outDir: 'dist',
      strict: true,
      skipLibCheck: true,
      noEmitOnError: true,
    },
    include: ['src/**/*.ts'],
  },
  null,
  2,
);

const WIDGET_OK = `export function widget(): string {\n  return 'ok';\n}\n`;
const WIDGET_BEHAVIOR_CHANGE = `export function widget(): string {\n  return 'broken';\n}\n`;
const WIDGET_SYNTAX_ERROR = `${WIDGET_OK}export const broken = ;\n`;

const WIDGET_TEST_BODY = `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { widget } from '../dist/widget.js';
describe('fixture-widget', () => { it('returns ok', () => { assert.equal(widget(), 'ok'); }); });
`;

const LOADER_SOURCE = `export function load(): string {\n  return 'loaded';\n}\n`;
const MANIFEST_SOURCE = `export const SCHEMA_VERSION = 1;\n`;
const LOADER_TEST_BODY = `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../dist/loader.js';
describe('fixture-loader', () => { it('loads', () => { assert.equal(load(), 'loaded'); }); });
`;

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

/** Write fixture files (repo-relative -> body) into a fresh scratch checkout. */
function makeFixtureRepo(files) {
  const root = mkdtempSync(join(SCRATCH, 'integrity-'));
  for (const [rel, body] of Object.entries(files)) {
    const absolute = join(root, ...rel.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, body, 'utf8');
  }
  return root;
}

const widgetFiles = (sourceBody = WIDGET_OK) => ({
  'packages/registry/src/widget.ts': sourceBody,
  'packages/registry/tests/fixture-widget.test.mjs': WIDGET_TEST_BODY,
  'packages/registry/package.json': PACKAGE_JSON_BODY('4.6.7'),
  'packages/registry/package-lock.json': LOCKFILE_BODY('4.6.7'),
  'packages/registry/tsconfig.json': TSCONFIG_BODY,
});

const widgetAllowlist = {
  'fixture:build-pass': {
    command: 'node --test tests/fixture-widget.test.mjs',
    cwdRel: 'packages/registry',
    argv: [NODE, '--test', 'tests/fixture-widget.test.mjs'],
    limitations: 'Fixture-only build-backed test; sequential same-process execution.',
    testFiles: ['packages/registry/tests/fixture-widget.test.mjs'],
    build: {
      command: 'node <tsc> -p tsconfig.json',
      argv: [NODE, REAL_TSC, '-p', 'tsconfig.json'],
      outputs: ['packages/registry/dist/widget.js'],
    },
  },
};

const loaderFiles = () => ({
  'packages/registry/src/loader.ts': LOADER_SOURCE,
  'packages/registry/src/manifest.ts': MANIFEST_SOURCE,
  'packages/registry/tests/loader.test.mjs': LOADER_TEST_BODY,
  'packages/registry/package.json': PACKAGE_JSON_BODY('4.6.7'),
  'packages/registry/package-lock.json': LOCKFILE_BODY('4.6.7'),
  'packages/registry/tsconfig.json': TSCONFIG_BODY,
});

const loaderAllowlist = {
  'registry:loader-tests': {
    command: 'node --test tests/loader.test.mjs',
    cwdRel: 'packages/registry',
    argv: [NODE, '--test', 'tests/loader.test.mjs'],
    limitations: 'Fixture-only loader test; sequential same-process execution.',
    testFiles: ['packages/registry/tests/loader.test.mjs'],
    build: {
      command: 'node <tsc> -p tsconfig.json',
      argv: [NODE, REAL_TSC, '-p', 'tsconfig.json'],
      outputs: ['packages/registry/dist/loader.js', 'packages/registry/dist/manifest.js'],
    },
  },
};

const EVIDENCE_DIR = 'registry-data/evidence';

describe('verification integrity repair', () => {
  it('changed TypeScript with stale dist cannot pass: the runner rebuilds first', () => {
    const repoRoot = makeFixtureRepo(widgetFiles());
    const manifest = manifestFor();
    const first = runVerification(repoRoot, manifest, [manifest], {
      commandKey: 'fixture:build-pass',
      evidenceDir: EVIDENCE_DIR,
      allowlist: widgetAllowlist,
    });
    assert.equal(first.passed, true);
    assert.equal(
      validateComponent(repoRoot, manifest, [manifest], {
        evidenceDir: EVIDENCE_DIR,
        allowlist: widgetAllowlist,
      }).valid,
      true,
    );

    // Change the source WITHOUT rebuilding: dist/ is now stale. The old
    // evidence must be invalid, and re-verifying must rebuild (failing
    // the tests against the new source) instead of certifying the
    // changed source with the stale compiled output.
    writeFileSync(join(repoRoot, 'packages/registry/src/widget.ts'), WIDGET_BEHAVIOR_CHANGE, 'utf8');
    const stale = validateComponent(repoRoot, manifest, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: widgetAllowlist,
    });
    assert.equal(stale.valid, false);
    assert.equal(stale.code, 'STALE_EVIDENCE');
    assert.match(stale.reason, /sources/);

    const second = runVerification(repoRoot, manifest, [manifest], {
      commandKey: 'fixture:build-pass',
      evidenceDir: EVIDENCE_DIR,
      allowlist: widgetAllowlist,
    });
    assert.equal(second.passed, false);
    assert.equal(second.evidence.outcome, 'fail');
    assert.ok(
      readFileSync(join(repoRoot, 'packages/registry/dist/widget.js'), 'utf8').includes('broken'),
      'the runner rebuilt dist/ from the changed source instead of testing stale output',
    );
    const after = validateComponent(repoRoot, manifest, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: widgetAllowlist,
    });
    assert.equal(after.valid, false);
    assert.equal(after.code, 'FAILED_TEST_EXECUTION');
  });

  it('failed compilation cannot produce passing evidence', () => {
    const repoRoot = makeFixtureRepo(widgetFiles(WIDGET_SYNTAX_ERROR));
    const manifest = manifestFor();
    assert.throws(
      () =>
        runVerification(repoRoot, manifest, [manifest], {
          commandKey: 'fixture:build-pass',
          evidenceDir: EVIDENCE_DIR,
          allowlist: widgetAllowlist,
        }),
      (error) => error instanceof RunnerError && error.code === 'BUILD_FAILED',
    );
    assert.equal(
      existsSync(resolveEvidencePath(repoRoot, EVIDENCE_DIR, manifest.id, manifest.version)),
      false,
      'a failed build must leave no evidence behind',
    );
  });

  it('altered executed build artifacts cannot silently retain valid verification', () => {
    const repoRoot = makeFixtureRepo(widgetFiles());
    const manifest = manifestFor();
    const run = runVerification(repoRoot, manifest, [manifest], {
      commandKey: 'fixture:build-pass',
      evidenceDir: EVIDENCE_DIR,
      allowlist: widgetAllowlist,
    });
    assert.equal(run.passed, true);
    assert.ok(run.evidence.build.artifacts.length > 0);

    // Behavior-preserving tampering: the tests would still pass, so
    // only the artifact hash binding can catch this.
    appendFileSync(join(repoRoot, 'packages/registry/dist/widget.js'), '\n// tamper\n', 'utf8');
    const check = validateComponent(repoRoot, manifest, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: widgetAllowlist,
    });
    assert.equal(check.valid, false);
    assert.equal(check.code, 'STALE_ARTIFACT');
  });

  it('compiler configuration changes invalidate dependent evidence', () => {
    const repoRoot = makeFixtureRepo(widgetFiles());
    const manifest = manifestFor();
    const run = runVerification(repoRoot, manifest, [manifest], {
      commandKey: 'fixture:build-pass',
      evidenceDir: EVIDENCE_DIR,
      allowlist: widgetAllowlist,
    });
    assert.equal(run.passed, true);

    appendFileSync(join(repoRoot, 'packages/registry/tsconfig.json'), '\n', 'utf8');
    const check = validateComponent(repoRoot, manifest, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: widgetAllowlist,
    });
    assert.equal(check.valid, false);
    assert.equal(check.code, 'STALE_EVIDENCE');
    assert.match(check.reason, /build/);
  });
});

describe('component-to-test mapping and shared sources', () => {
  it('a booking component cannot be verified with loader-only tests', () => {
    const repoRoot = makeFixtureRepo({
      'packages/registry/src/schema.ts': `export const x = 1;\n`,
      'packages/registry/tests/schema.test.mjs': PASS_TEST_BODY,
      'packages/registry/tests/loader.test.mjs': PASS_TEST_BODY,
      'packages/registry/package.json': PACKAGE_JSON_BODY('4.6.7'),
      'packages/registry/package-lock.json': LOCKFILE_BODY('4.6.7'),
    });
    const manifest = manifestFor({ id: 'booking-schema', sourcePath: 'packages/registry/src/schema.ts' });
    const loaderOnlyAllowlist = {
      'registry:loader-tests': {
        command: 'node --test tests/loader.test.mjs',
        cwdRel: 'packages/registry',
        argv: [NODE, '--test', 'tests/loader.test.mjs'],
        limitations: 'Loader-only scope; cannot cover booking components.',
        testFiles: ['packages/registry/tests/loader.test.mjs'],
      },
    };
    assert.throws(
      () =>
        runVerification(repoRoot, manifest, [manifest], {
          commandKey: 'registry:loader-tests',
          evidenceDir: EVIDENCE_DIR,
          allowlist: loaderOnlyAllowlist,
        }),
      (error) => error instanceof RunnerError && error.code === 'WRONG_TEST_SCOPE',
    );
    assert.equal(
      existsSync(resolveEvidencePath(repoRoot, EVIDENCE_DIR, manifest.id, manifest.version)),
      false,
      'a wrong-scope run must leave no evidence behind',
    );
  });

  it('validation rejects loader-scoped evidence for a booking component', () => {
    const repoRoot = makeFixtureRepo({
      'packages/registry/src/schema.ts': `export const x = 1;\n`,
      'packages/registry/tests/schema.test.mjs': PASS_TEST_BODY,
      'packages/registry/package.json': PACKAGE_JSON_BODY('4.6.7'),
      'packages/registry/package-lock.json': LOCKFILE_BODY('4.6.7'),
    });
    const manifest = manifestFor({ id: 'booking-schema', sourcePath: 'packages/registry/src/schema.ts' });
    const allowlist = {
      'registry:loader-tests': {
        command: 'node --test tests/loader.test.mjs',
        cwdRel: 'packages/registry',
      },
    };
    const computed = computeArtifactFingerprint(repoRoot, manifest, [manifest]);
    writeEvidenceFile(resolveEvidencePath(repoRoot, EVIDENCE_DIR, manifest.id, manifest.version), {
      schemaVersion: 1,
      componentId: manifest.id,
      componentVersion: manifest.version,
      artifactFingerprint: computed.fingerprint,
      sections: computed.sections,
      testScope: {
        command: 'node --test tests/loader.test.mjs',
        commandKey: 'registry:loader-tests',
        files: ['packages/registry/tests/loader.test.mjs'],
        limitations: 'Hand-written loader scope.',
      },
      build: { command: 'none', artifacts: [] },
      exitCode: 0,
      outcome: 'pass',
      nodeVersion: process.version,
      sqliteVersion: 'unavailable',
      executedAt: new Date().toISOString(),
    });
    const check = validateComponent(repoRoot, manifest, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist,
    });
    assert.equal(check.valid, false);
    assert.equal(check.code, 'WRONG_TEST_SCOPE');
  });

  it('changes to shared source files invalidate dependent evidence', () => {
    const repoRoot = makeFixtureRepo(loaderFiles());
    const manifest = manifestFor({
      id: 'registry-loader',
      sourcePath: 'packages/registry/src/loader.ts',
      capabilities: ['registry-loading', 'manifest-filtering'],
    });
    assert.ok(
      sourceFilesForComponent(repoRoot, manifest, [manifest]).includes('packages/registry/src/manifest.ts'),
      'registry-loader sources must include the shared manifest.ts module',
    );
    const run = runVerification(repoRoot, manifest, [manifest], {
      commandKey: 'registry:loader-tests',
      evidenceDir: EVIDENCE_DIR,
      allowlist: loaderAllowlist,
    });
    assert.equal(run.passed, true);
    assert.equal(
      validateComponent(repoRoot, manifest, [manifest], {
        evidenceDir: EVIDENCE_DIR,
        allowlist: loaderAllowlist,
      }).valid,
      true,
    );

    appendFileSync(join(repoRoot, 'packages/registry/src/manifest.ts'), '// shared change\n', 'utf8');
    const check = validateComponent(repoRoot, manifest, [manifest], {
      evidenceDir: EVIDENCE_DIR,
      allowlist: loaderAllowlist,
    });
    assert.equal(check.valid, false);
    assert.equal(check.code, 'STALE_EVIDENCE');
    assert.match(check.reason, /sources/);
  });

  it('real components bind shared modules, compiler config, and an explicit test mapping', () => {
    const manifests = loadRegistry(REAL_MANIFEST_DIR);
    assert.deepEqual(
      manifests.map((m) => `${m.id}@${m.version}`).sort(),
      [
        'booking-schema@0.1.0',
        'booking-slot-guard@0.1.0',
        'booking-validation@0.1.0',
        'registry-loader@0.1.0',
      ],
    );
    const byId = new Map(manifests.map((m) => [m.id, m]));

    const loaderFilesReal = sourceFilesForComponent(
      REAL_ROOT,
      byId.get('registry-loader'),
      manifests,
    );
    assert.ok(
      loaderFilesReal.includes('packages/registry/src/manifest.ts'),
      'registry-loader must fingerprint shared src/manifest.ts',
    );
    assert.ok(
      computeArtifactFingerprint(REAL_ROOT, byId.get('registry-loader'), manifests).files.includes(
        'packages/registry/tsconfig.json',
      ),
      'fingerprints must include the compiler configuration',
    );

    const guardFiles = sourceFilesForComponent(REAL_ROOT, byId.get('booking-slot-guard'), manifests);
    for (const expected of [
      'packages/registry/src/slotGuard.ts',
      'packages/registry/src/validation.ts',
      'packages/registry/src/schema.ts',
    ]) {
      assert.ok(guardFiles.includes(expected), `booking-slot-guard must fingerprint ${expected}`);
    }
    assert.deepEqual(
      closureTestFiles(byId.get('booking-slot-guard'), manifests),
      [
        'packages/registry/tests/schema.test.mjs',
        'packages/registry/tests/slotGuard.test.mjs',
        'packages/registry/tests/validation.test.mjs',
      ],
    );

    assert.deepEqual(COMPONENT_EXTRA_SOURCES['registry-loader'], ['packages/registry/src/manifest.ts']);
    assert.deepEqual(allowedCommandsFor('booking-schema'), ['registry:booking-tests', 'registry:all-tests']);
    assert.deepEqual(allowedCommandsFor('registry-loader'), ['registry:loader-tests', 'registry:all-tests']);
    assert.ok(!allowedCommandsFor('booking-slot-guard').includes('registry:loader-tests'));

    const realFiles = readdirSync(REAL_EVIDENCE_DIR).filter((name) => name.endsWith('.json'));
    assert.deepEqual(realFiles, [], 'integrity probes must not certify real components');
  });
});
