#!/usr/bin/env node
/**
 * ADOPT-001: isolated, low-step Muse MCP adoption probe.
 * PREPARATION ONLY: NO Muse model requests or billing.
 * Does not touch RES-001 candidates, logs, settings or score.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = join(homedir(), 'Projects', 'silkweb-adoption-probe-20261029');
const starter = join(repo, 'experiments/tasks/res-001-starter');
const operator = join(root, 'operator');
const candidate = join(root, 'candidate');
const configRoot = join(operator, 'muse-config');
const auditLog = join(operator, 'mcp-audit.jsonl');
const originalCAuth = join(homedir(), 'Projects/res001-preflight-20261029/operator/muse-config-C/muse/auth.json');
function fail(message) { throw new Error('ADOPT-001 preparation refused: ' + message); }
if (existsSync(root)) fail('probe root already exists: ' + root);
if (!existsSync(join(repo, 'apps/mcp-server/dist/index.js')) ||
    !existsSync(join(repo, 'packages/registry/dist/reservationKernelV2.js'))) {
  fail('adoption worktree MCP/registry dist missing; run both local checks first');
}
if (!existsSync(join(starter, 'package-lock.json'))) fail('starter missing');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) fail('source worktree has changes');
const revision = git('rev-parse', 'HEAD');
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const pinPaths = [
  'registry-data/evidence/registry-loader-0.1.0.json',
  'registry-data/manifests/booking-reservation-kernel-0.2.0.json',
  'packages/registry/src/reservationKernelV2.ts',
  'apps/mcp-server/src/index.ts',
  'apps/mcp-server/src/librarian.ts',
];
const pinned = Object.fromEntries(pinPaths.map(p => [p, sha256(join(repo, p))]));
cpSync(starter, candidate, { recursive: true });
mkdirSync(join(configRoot, 'muse'), { recursive: true });
const settings = {
  schema_version: 1,
  mcpServers: {
    silkweb: {
      type: 'stdio',
      command: process.execPath,
      args: [join(repo, 'apps/mcp-server/dist/index.js')],
      required: true,
      enabled: true,
      env: { SILKWEB_REPO_ROOT: repo, SILKWEB_AUDIT_LOG: auditLog },
    },
  },
};
writeFileSync(join(configRoot, 'muse/settings.json'), JSON.stringify(settings, null, 2) + '\n');
let authCopied = false;
// Copy only the already-authorized credential into an ISOLATED local profile.
// Never print or commit its contents. No network request.
if (existsSync(originalCAuth)) {
  cpSync(originalCAuth, join(configRoot, 'muse/auth.json'));
  authCopied = true;
}
const prompt = [
  '# ADOPT-001 — guided source-adoption test, NOT an A/B performance benchmark',
  '',
  'Use the enabled Silk Web MCP tools. Do not read any file outside this',
  'workspace; do not fetch source from the local Silk Web repo or the web.',
  'The only permitted source of reusable implementation is MCP tool output.',
  '',
  'First call search_verified_components with query:',
  'reservation booking appointment API',
  '',
  'Select booking-reservation-kernel@0.2.0 from the actual returned results.',
  'Call inspect_verified_component using the returned id and version.',
  'Check verification.status is verified. Then call',
  'get_verified_component_source with that same id and version and large',
  'enough bounds to retrieve ALL source files without truncation.',
  '',
  'Copy the four returned source files UNCHANGED into src/verified/ with',
  'their original basenames: reservationKernelV2.ts, schema.ts,',
  'validation.ts, slotGuard.ts. Do not rewrite or independently regenerate',
  'them; preserve the original imports. Do not use filesystem copying from',
  'the Silk Web repo. Source content must originate from the MCP retrieval.',
  '',
  'Create src/probe.ts importing initializeReservationKernel,',
  'createIdempotentBooking, cancelReservation from',
  "'./verified/reservationKernelV2.js' (not self-written replacements).",
  'Make it an executable that:',
  '- opens an in-memory DatabaseSync from node:sqlite',
  '- initializes the kernel and inserts staff id 1 and service id 1,',
  '  the latter with exactly 30 minutes duration',
  '- creates idempotent booking adoption-001 for staff 1/service 1',
  '  at 2026-11-05T09:00:00.000Z',
  '- replays the same key/payload, asserts the ID is unchanged, replayed',
  '  is true and only one booking row exists',
  '- cancels it, replays the original key, and asserts status cancelled',
  '- prints exactly ADOPTION_OK after assertions pass; exits nonzero',
  '  on errors and closes the database',
  '',
  'Do not implement HTTP, unrelated features or extra dependencies.',
  'Run npm run build and node dist/probe.js. Never claim untested success.',
  '',
].join('\n');
const promptPath = join(operator, 'PROMPT.md');
writeFileSync(promptPath, prompt);
const result = {
  trial: 'ADOPT-001',
  class: 'GUIDED_ADOPTION_PROBE_NOT_RES_001_BENCHMARK',
  createdAt: new Date().toISOString(),
  sourceCommit: revision, sourceRepo: repo, candidate, operator,
  configRoot, auditLog, promptPath, promptSha256: sha256(promptPath),
  pinnedSha256: pinned,
  reusedAuthenticatedProfile: authCopied,
  maxModelStepsSuggested: 20,
};
writeFileSync(join(operator, 'preflight.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(
  'PASS: ADOPT-001 separate candidate and audited MCP profile prepared\n' +
  'Source commit: ' + revision + '\n' +
  'Workspace: ' + candidate + '\n' +
  'MCP server: ' + settings.mcpServers.silkweb.args[0] + '\n' +
  'Auth: ' + (authCopied ? 'copied from isolated RES-001 C profile (not inspected)' : 'missing: run Muse login within new profile') + '\n' +
  'No inference launched. No RES-001 files modified.\n',
);
