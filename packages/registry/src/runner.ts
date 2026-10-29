import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import {
  assertSafeRepoRelPath,
  closureTestFiles,
  computeArtifactFingerprint,
  resolveRepoPath,
  sha256Hex,
} from './fingerprint.js';
import {
  EVIDENCE_SCHEMA_VERSION,
  resolveEvidencePath,
  writeEvidenceFile,
  type VerificationEvidence,
} from './evidence.js';
import type { RegistryManifest } from './manifest.js';

/**
 * Local verification runner.
 *
 * Security rule: the ONLY commands this runner ever executes are the
 * fixed argv arrays in an explicit allowlist of repository-owned test
 * and build commands, spawned with `shell: false` and a bounded
 * timeout. A manifest's `verification.testCommand` string is
 * informational only — it is never passed to any process-spawning
 * function, so a malicious manifest cannot inject shell commands. Only
 * an actual successful process exit (exit code 0) is ever recorded as
 * a pass; failures are preserved as failures.
 *
 * Integrity rule: every repository-owned entry rebuilds its executable
 * artifacts from current source before the tests run, and the evidence
 * binds the hashes of exactly what was executed. A component is only
 * ever certified against a fresh build of its own sources — changed
 * TypeScript with stale compiled output, or a failed build, can never
 * produce passing evidence. The explicit COMPONENT_ALLOWED_COMMANDS
 * map decides which test commands may certify which component.
 */

export interface AllowedBuild {
  /**
   * Human-reproducible build command string, run from the entry's
   * `cwdRel`. Example: "node node_modules/typescript/bin/tsc -p tsconfig.json".
   */
  command: string;
  /** Fixed argv (executable + args). No shell, no interpolation. */
  argv: readonly [string, ...string[]];
  /**
   * Repo-relative compiled outputs the build must (re)produce. Every
   * file is hashed after the build and bound into the evidence, so
   * later tampering invalidates verification.
   */
  outputs: readonly string[];
}

export interface AllowedTestCommand {
  /**
   * Human-reproducible command string, run from `cwdRel`.
   * Example: "node --test tests/loader.test.mjs".
   */
  command: string;
  /** Repo-relative working directory the command runs in. */
  cwdRel: string;
  /** Fixed argv (executable + args). No shell, no interpolation. */
  argv: readonly [string, ...string[]];
  /** Exact scope and known limitations of this command. */
  limitations: string;
  /**
   * Repo-relative test files this command actually executes. Recorded
   * verbatim in the evidence (never derived from the fingerprint), so
   * the record names what ran. Entries without this field keep the
   * legacy behavior (the component closure's test files); every
   * repository-owned entry declares it.
   */
  testFiles?: readonly string[];
  /**
   * Bounded fresh-build procedure run before the tests. Absent only for
   * commands whose tests need no compilation; every repository-owned
   * entry declares it, so changed TypeScript can never be certified
   * against stale compiled output.
   */
  build?: AllowedBuild;
}

const NODE = process.execPath;

/** Every compiled artifact the registry test suites execute. */
export const BUILD_OUTPUTS: readonly string[] = [
  'packages/registry/dist/evidence.js',
  'packages/registry/dist/fingerprint.js',
  'packages/registry/dist/index.js',
  'packages/registry/dist/loader.js',
  'packages/registry/dist/manifest.js',
  'packages/registry/dist/runner.js',
  'packages/registry/dist/schema.js',
  'packages/registry/dist/slotGuard.js',
  'packages/registry/dist/validate.js',
  'packages/registry/dist/validation.js',
];

const TSC_BUILD: AllowedBuild = {
  command: 'node node_modules/typescript/bin/tsc -p tsconfig.json',
  argv: [NODE, 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
  outputs: BUILD_OUTPUTS,
};

/**
 * V2 is additive: V1 build-output inventories remain unchanged.
 * The new compiled module is bound only to the V2 certification.
 */
const V2_TSC_BUILD: AllowedBuild = {
  ...TSC_BUILD,
  outputs: [...BUILD_OUTPUTS, 'packages/registry/dist/reservationKernelV2.js'],
};

const V2_TEST_FILES: readonly string[] = [
  'packages/registry/tests/schema.test.mjs',
  'packages/registry/tests/validation.test.mjs',
  'packages/registry/tests/slotGuard.test.mjs',
  'packages/registry/tests/booking-reservation-kernel.test.mjs',
];

export const TEST_COMMAND_ALLOWLIST: Record<string, AllowedTestCommand> = {
  'registry:loader-tests': {
    command: 'node --test tests/loader.test.mjs',
    cwdRel: 'packages/registry',
    argv: [NODE, '--test', 'tests/loader.test.mjs'],
    limitations:
      'Runs the freshly built registry-loader suite only; ' +
      'sequential same-process execution, no genuine concurrency coverage.',
    testFiles: ['packages/registry/tests/loader.test.mjs'],
    build: TSC_BUILD,
  },
  'registry:booking-tests': {
    command: 'node --test tests/schema.test.mjs tests/validation.test.mjs tests/slotGuard.test.mjs',
    cwdRel: 'packages/registry',
    argv: [NODE, '--test', 'tests/schema.test.mjs', 'tests/validation.test.mjs', 'tests/slotGuard.test.mjs'],
    limitations:
      'Runs the freshly built booking suites only; ' +
      'collision checks use sequential same-process connections to a temp file database, ' +
      'so no genuine simultaneous-race coverage is claimed.',
    testFiles: [
      'packages/registry/tests/schema.test.mjs',
      'packages/registry/tests/validation.test.mjs',
      'packages/registry/tests/slotGuard.test.mjs',
    ],
    build: TSC_BUILD,
  },
  'registry:reservation-v2-tests': {
    command: 'node --test tests/schema.test.mjs tests/validation.test.mjs tests/slotGuard.test.mjs tests/booking-reservation-kernel.test.mjs',
    cwdRel: 'packages/registry',
    argv: [
      NODE, '--test',
      'tests/schema.test.mjs',
      'tests/validation.test.mjs',
      'tests/slotGuard.test.mjs',
      'tests/booking-reservation-kernel.test.mjs',
    ],
    limitations:
      'Runs the freshly built V1 booking suites and V2 reservation suite. ' +
      'Two independent Node processes race against a single SQLite file. ' +
      'No claim of arbitrary concurrent load, cross-host transactions, or filesystem portability.',
    testFiles: V2_TEST_FILES,
    build: V2_TSC_BUILD,
  },
  'registry:all-tests': {
    command:
      'node --test tests/schema.test.mjs tests/validation.test.mjs tests/slotGuard.test.mjs tests/loader.test.mjs',
    cwdRel: 'packages/registry',
    argv: [
      NODE,
      '--test',
      'tests/schema.test.mjs',
      'tests/validation.test.mjs',
      'tests/slotGuard.test.mjs',
      'tests/loader.test.mjs',
    ],
    limitations:
      'Runs the full freshly built registry suite; ' +
      'same sequential-execution limitations as the booking suites.',
    testFiles: [
      'packages/registry/tests/schema.test.mjs',
      'packages/registry/tests/validation.test.mjs',
      'packages/registry/tests/slotGuard.test.mjs',
      'packages/registry/tests/loader.test.mjs',
    ],
    build: TSC_BUILD,
  },
};

/**
 * Explicit component-to-test mapping: which allowlist keys may certify
 * which component. A booking component can never pass on loader-only
 * tests, and the loader can never pass on booking-only tests; only the
 * full suite covers both. Unknown component ids (test fixtures) have no
 * mapping and rely on the executed-tests coverage check instead.
 */
export const COMPONENT_ALLOWED_COMMANDS: Record<string, readonly string[]> = {
  'booking-schema': ['registry:booking-tests', 'registry:all-tests'],
  'booking-validation': ['registry:booking-tests', 'registry:all-tests'],
  'booking-slot-guard': ['registry:booking-tests', 'registry:all-tests'],
  'booking-reservation-kernel': ['registry:reservation-v2-tests'],
  'registry-loader': ['registry:loader-tests', 'registry:all-tests'],
};

/** Allowlist keys that may certify one component id (undefined when unmapped). */
export function allowedCommandsFor(componentId: string): readonly string[] | undefined {
  const mapped = COMPONENT_ALLOWED_COMMANDS[componentId];
  return mapped === undefined ? undefined : [...mapped];
}

export class RunnerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RunnerError';
    this.code = code;
  }
}

export interface RunVerificationOptions {
  /** Allowlist key selecting the repository-owned test command. */
  commandKey: string;
  /** Repo-relative directory holding real evidence records. */
  evidenceDir: string;
  /** Explicit allowlist (defaults to TEST_COMMAND_ALLOWLIST). */
  allowlist?: Record<string, AllowedTestCommand>;
  /** Spawn timeout in ms (default 120000). */
  timeoutMs?: number;
}

export interface VerificationRun {
  evidence: VerificationEvidence;
  evidencePath: string;
  passed: boolean;
}

/**
 * Hash one freshly built artifact. Missing or unreadable output fails
 * closed: the build did not produce what the tests are about to execute.
 */
function hashBuildArtifact(repoRoot: string, rel: string): { file: string; sha256: string } {
  const safe = assertSafeRepoRelPath(rel);
  const absolute = resolveRepoPath(repoRoot, safe);
  let data: Buffer;
  try {
    const stat = statSync(absolute);
    if (!stat.isFile()) {
      throw new RunnerError('MISSING_BUILD_OUTPUT', `build did not produce executable artifact ${safe}`);
    }
    data = readFileSync(absolute);
  } catch (error: unknown) {
    if (error instanceof RunnerError) throw error;
    throw new RunnerError('MISSING_BUILD_OUTPUT', `cannot read build output ${safe}: ${String(error)}`);
  }
  return { file: safe, sha256: sha256Hex(data) };
}

/**
 * Verify one component: enforce the component-to-test mapping, rebuild
 * its executable artifacts from current source with the entry's bounded
 * allowlisted build, recompute its artifact fingerprint, execute the
 * allowlisted test command against the fresh build, and write the
 * observed evidence. Never executes anything from the manifest. Any
 * build failure, missing build output, or scope violation throws
 * without writing evidence, so it can never certify.
 */
export function runVerification(
  repoRoot: string,
  manifest: RegistryManifest,
  allManifests: readonly RegistryManifest[],
  options: RunVerificationOptions,
): VerificationRun {
  const allowlist = options.allowlist ?? TEST_COMMAND_ALLOWLIST;
  const entry = allowlist[options.commandKey];
  if (!entry) {
    throw new RunnerError(
      'UNKNOWN_TEST_COMMAND',
      `refusing to verify ${manifest.id}@${manifest.version}: ` +
        `unknown test command key ${JSON.stringify(options.commandKey)}`,
    );
  }
  const mapped = COMPONENT_ALLOWED_COMMANDS[manifest.id];
  if (mapped !== undefined && !mapped.includes(options.commandKey)) {
    throw new RunnerError(
      'WRONG_TEST_SCOPE',
      `refusing to verify ${manifest.id}@${manifest.version}: ` +
        `test command ${JSON.stringify(options.commandKey)} cannot certify this component ` +
        `(allowed: ${mapped.map((key) => JSON.stringify(key)).join(', ')})`,
    );
  }
  const cwd = resolveRepoPath(repoRoot, entry.cwdRel);

  // The child must always run as a standalone test process. When the
  // runner itself executes inside a `node --test` worker, Node marks the
  // environment (NODE_TEST_CONTEXT, NODE_TEST_WORKER_ID, …) and a nested
  // `node --test` child reports to the outer runner instead of exiting
  // nonzero on failure — a pass would be recorded for failing tests.
  // Scrubbing those internal markers restores honest exit codes.
  const childEnv: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('NODE_TEST_')) delete childEnv[key];
  }

  // Fresh build first, bounded and allowlisted: the tests below must
  // execute what the current sources compile to, never a stale dist/.
  // A failed build throws here, before any evidence exists.
  let buildCommand = 'none';
  let artifacts: Array<{ file: string; sha256: string }> = [];
  if (entry.build !== undefined) {
    buildCommand = entry.build.command;
    const built = spawnSync(entry.build.argv[0], entry.build.argv.slice(1), {
      cwd,
      shell: false,
      timeout: options.timeoutMs ?? 120_000,
      encoding: 'utf8',
      env: childEnv,
    });
    const buildExit = typeof built.status === 'number' ? built.status : 1;
    if (buildExit !== 0) {
      const detail = `${built.stderr ?? ''}${built.error ? String(built.error) : ''}`.slice(-2000);
      throw new RunnerError(
        'BUILD_FAILED',
        `refusing to verify ${manifest.id}@${manifest.version}: ` +
          `fresh build ${JSON.stringify(entry.build.command)} failed with exit ${buildExit}${detail ? `: ${detail}` : ''}`,
      );
    }
    artifacts = entry.build.outputs.map((rel) => hashBuildArtifact(repoRoot, rel));
    artifacts.sort((a, b) => (a.file < b.file ? -1 : 1));
  }

  const computed = computeArtifactFingerprint(repoRoot, manifest, allManifests);

  // The executed tests must cover the component's fingerprinted test
  // scope; a narrower run (e.g. loader-only tests for a booking
  // component) cannot certify it.
  const executedTestFiles = [...(entry.testFiles ?? computed.files.filter((file) => file.includes('/tests/')))].sort();
  if (entry.testFiles !== undefined) {
    const uncovered = computed.files
      .filter((file) => file.includes('/tests/'))
      .filter((file) => !executedTestFiles.includes(file));
    if (uncovered.length > 0) {
      throw new RunnerError(
        'WRONG_TEST_SCOPE',
        `refusing to verify ${manifest.id}@${manifest.version}: ` +
          `test command ${JSON.stringify(options.commandKey)} does not execute ${uncovered.map((file) => JSON.stringify(file)).join(', ')}`,
      );
    }
  }

  const spawned = spawnSync(entry.argv[0], entry.argv.slice(1), {
    cwd,
    shell: false,
    timeout: options.timeoutMs ?? 120_000,
    encoding: 'utf8',
    env: childEnv,
  });
  const exitCode = typeof spawned.status === 'number' ? spawned.status : 1;
  const passed = exitCode === 0;

  const evidence: VerificationEvidence = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    componentId: manifest.id,
    componentVersion: manifest.version,
    artifactFingerprint: computed.fingerprint,
    sections: computed.sections,
    testScope: {
      command: entry.command,
      commandKey: options.commandKey,
      files: executedTestFiles,
      limitations: entry.limitations,
    },
    build: {
      command: buildCommand,
      artifacts,
    },
    exitCode,
    outcome: passed ? 'pass' : 'fail',
    nodeVersion: process.version,
    sqliteVersion: (process.versions as Record<string, string | undefined>).sqlite ?? 'unavailable',
    executedAt: new Date().toISOString(),
  };
  const evidencePath = resolveEvidencePath(repoRoot, options.evidenceDir, manifest.id, manifest.version);
  writeEvidenceFile(evidencePath, evidence);
  return { evidence, evidencePath, passed };
}
