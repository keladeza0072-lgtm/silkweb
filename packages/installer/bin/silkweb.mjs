#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InstallError, applyInstall, assertSupportedRuntime, discoverRepoRoot,
  loadRegistryLibrary, planInstall,
} from '../src/install.mjs';

const HELP = `Silk Web verified source installer (Node.js 24+)

Usage:
  silkweb install <id@version> [--project <path>] [--into <relative/path>] [--dry-run] [--json]
  silkweb --help

Options:
  --project <path>        Target project root (default: current directory)
  --into <relative/path>  Copy certified TypeScript files here (default: src/silkweb)
  --registry-root <path>  Explicit Silk Web registry checkout (normally auto-discovered)
  --dry-run               Validate and preview without modifying the project
  --json                  Emit machine-readable JSON report on stdout

Prerequisites: build packages/registry with npm ci && npm run build.
Installation copies verified source but does not execute npm or assert that
the target application builds or passes tests.
`;

function parseArgs(args) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') return null;
  if (args[0] !== 'install' || !args[1] || args[1].startsWith('--')) {
    throw new InstallError('USAGE_ERROR', 'Expected silkweb install <id@version>. Use --help for options.');
  }
  const result = { spec: args[1], project: process.cwd(), into: 'src/silkweb', dryRun: false, json: false };
  const seen = new Set();
  for (let i = 2; i < args.length; i++) {
    const token = args[i];
    if (seen.has(token)) throw new InstallError('USAGE_ERROR', `Duplicate option: ${token}`);
    seen.add(token);
    if (token === '--dry-run') result.dryRun = true;
    else if (token === '--json') result.json = true;
    else if (['--project', '--into', '--registry-root'].includes(token)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) {
        throw new InstallError('USAGE_ERROR', `Missing value for ${token}`);
      }
      if (token === '--project') result.project = value;
      else if (token === '--into') result.into = value;
      else result.registryRoot = value;
    } else {
      throw new InstallError('USAGE_ERROR', `Unknown option: ${token}`);
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stdout.write(HELP);
    return;
  }
  assertSupportedRuntime();
  const repoRoot = args.registryRoot
    ? resolve(args.registryRoot)
    : discoverRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const lib = await loadRegistryLibrary(repoRoot);
  const plan = planInstall({
    repoRoot,
    projectRoot: args.project,
    spec: args.spec,
    into: args.into,
    lib,
  });
  const result = applyInstall(plan, { dryRun: args.dryRun });
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`${result.status}: ${result.component}\n`);
    for (const f of result.files) process.stdout.write(`  ${f.action}: ${f.destination} (${f.sha256.slice(0, 12)}…)\n`);
    process.stdout.write(`Audit report: ${result.reportPath}${args.dryRun ? ' (preview only)' : ''}\n`);
    process.stdout.write('Note: Registry certification verified; target build and application tests not yet verified.\n');
  }
}

main().catch(error => {
  const code = error instanceof InstallError ? error.code : 'UNEXPECTED_ERROR';
  process.stderr.write(`silkweb: ${code}: ${error.message}\n`);
  process.exitCode = 1;
});
