import { spawnSync } from 'node:child_process';
import { resolveRepoPath, computeArtifactFingerprint } from './fingerprint.js';
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
 * commands, spawned with `shell: false`. A manifest's
 * `verification.testCommand` string is informational only — it is never
 * passed to any process-spawning function, so a malicious manifest cannot
 * inject shell commands. Only an actual successful process exit (exit
 * code 0) is ever recorded as a pass; failures are preserved as failures.
 */

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
}

const NODE = process.execPath;

export const TEST_COMMAND_ALLOWLIST: Record<string, AllowedTestCommand> = {
  'registry:loader-tests': {
    command: 'node --test tests/loader.test.mjs',
    cwdRel: 'packages/registry',
    argv: [NODE, '--test', 'tests/loader.test.mjs'],
    limitations:
      'Runs the compiled registry-loader suite only (requires `npm run build` first); ' +
      'sequential same-process execution, no genuine concurrency coverage.',
  },
  'registry:booking-tests': {
    command: 'node --test tests/schema.test.mjs tests/validation.test.mjs tests/slotGuard.test.mjs',
    cwdRel: 'packages/registry',
    argv: [NODE, '--test', 'tests/schema.test.mjs', 'tests/validation.test.mjs', 'tests/slotGuard.test.mjs'],
    limitations:
      'Runs the compiled booking suites only (requires `npm run build` first); ' +
      'collision checks use sequential same-process connections to a temp file database, ' +
      'so no genuine simultaneous-race coverage is claimed.',
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
      'Runs the full compiled registry suite (requires `npm run build` first); ' +
      'same sequential-execution limitations as the booking suites.',
  },
};

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
 * Verify one component: recompute its artifact fingerprint from the
 * current checkout, execute the allowlisted test command, and write the
 * observed evidence. Never executes anything from the manifest.
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
  const cwd = resolveRepoPath(repoRoot, entry.cwdRel);
  const computed = computeArtifactFingerprint(repoRoot, manifest, allManifests);

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
      files: computed.files.filter((file) => file.includes('/tests/')),
      limitations: entry.limitations,
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
